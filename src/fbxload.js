// Shared FBX loading utilities. Real-world FBX files (Blender/Unity/VRChat
// exports) routinely reference textures by absolute paths from the author's
// machine ("C:\Users\…\WadeMain.png"). In a browser those 404 — or worse.
// This loader rewrites every texture request to look for the bare filename
// next to the .fbx, and after loading strips any texture that still failed,
// so materials fall back to their plain colors instead of rendering black.
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const IMG_RE = /\.(png|jpe?g|tga|bmp|gif|webp|dds)(\?.*)?$/i;

// Largest texture side we ever upload. Character art often ships at 4096² —
// nine of those is ~¾ GB of VRAM, which spills to system RAM on ordinary
// GPUs and makes every frame crawl. 2048 is indistinguishable at our
// viewport sizes and costs a quarter of the memory.
const MAX_TEX_SIZE = 2048;

function capTexture(tex) {
  const img = tex?.image;
  if (!img || !img.width || Math.max(img.width, img.height) <= MAX_TEX_SIZE) return;
  const scale = MAX_TEX_SIZE / Math.max(img.width, img.height);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.width * scale));
  c.height = Math.max(1, Math.round(img.height * scale));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  tex.image = c;
  tex.needsUpdate = true;
}

// filename (lowercased) → blob URL, fed by drag-dropped image files; lets a
// visitor (or the portfolio owner) supply textures the FBX references but
// that aren't hosted next to it
const textureOverrides = new Map();

export function registerTextureOverrides(files) {
  let n = 0;
  for (const f of files) {
    if (!IMG_RE.test(f.name)) continue;
    const key = f.name.trim().toLowerCase();
    if (textureOverrides.has(key)) URL.revokeObjectURL(textureOverrides.get(key));
    textureOverrides.set(key, URL.createObjectURL(f));
    n++;
  }
  return n;
}

export async function loadFBXSafe(source, { onProgress = null, onTexturesSettled = null } = {}) {
  const isFile = source instanceof Blob;
  const baseDir = isFile ? '' : String(source).slice(0, String(source).lastIndexOf('/') + 1);
  const missing = new Set();

  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    if (IMG_RE.test(url)) {
      // absolute OS paths / foreign locations → bare filename beside the fbx
      let u;
      try { u = decodeURIComponent(url); } catch { u = url; }
      const base = u.split(/[\\/]/).pop();
      const override = textureOverrides.get(base.trim().toLowerCase());
      return override || baseDir + encodeURIComponent(base);
    }
    return url;
  });
  manager.onError = (url) => {
    let u;
    try { u = decodeURIComponent(url); } catch { u = url; }
    if (IMG_RE.test(u)) missing.add(u.split(/[\\/]/).pop());
  };

  const loader = new FBXLoader(manager);

  // FBXLoader warns once PER VERTEX about >4 skin weights — a 190k-vertex
  // model emits tens of thousands of console.warn calls, which alone costs
  // seconds and bloats the console. Collapse them into one summary.
  const realWarn = console.warn;
  let squelched = 0;
  console.warn = (...args) => {
    if (typeof args[0] === 'string' && args[0].includes('skinning weights')) { squelched++; return; }
    realWarn(...args);
  };
  let obj;
  try {
    obj = isFile
      ? loader.parse(await source.arrayBuffer(), baseDir)
      : await loader.loadAsync(source, (e) => {
          if (e.lengthComputable) onProgress?.(e.loaded / e.total);
        });
  } finally {
    console.warn = realWarn;
    if (squelched) console.info(`FBXLoader: capped skin weights on ${squelched.toLocaleString()} vertices (>4 per vertex)`);
  }

  // FBX exports are usually UNINDEXED: every triangle carries three private
  // vertices, so smooth surfaces duplicate each vertex ~6×. Welding true
  // duplicates shrinks vertex, skinning and morph work with zero visual
  // change (only exact-match vertices merge).
  obj.traverse((n) => {
    if (!n.isMesh || n.geometry.index) return;
    if ((n.geometry.attributes.position?.count || 0) < 20000) return;
    try {
      const before = n.geometry.attributes.position.count;
      const merged = mergeVertices(n.geometry);
      if (merged.attributes.position.count < before * 0.9) {
        n.geometry = merged;
        console.info(`welded ${n.name || 'mesh'}: ${before.toLocaleString()} → ${merged.attributes.position.count.toLocaleString()} vertices`);
      }
    } catch { /* exotic attribute layouts: keep the original */ }
  });

  // once every queued texture has settled, drop the ones that never got data
  let settled = false;
  const strip = () => {
    if (settled) return;
    settled = true;
    // does anything render with a real texture? (decides the black-lift below)
    let anyTextured = false;
    obj.traverse((n) => {
      if (!n.isMesh) return;
      for (const m of Array.isArray(n.material) ? n.material : [n.material]) {
        if (m?.map?.image && (m.map.image.width || m.map.image.videoWidth)) anyTextured = true;
      }
    });
    obj.traverse((n) => {
      if (!n.isMesh) return;
      for (const m of Array.isArray(n.material) ? n.material : [n.material]) {
        if (!m) continue;
        for (const slot of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'specularMap', 'bumpMap']) {
          const tex = m[slot];
          if (tex && !(tex.image && (tex.image.width || tex.image.videoWidth))) {
            m[slot] = null;
            m.needsUpdate = true;
          } else if (tex) {
            capTexture(tex);           // 4K+ art → 2048, quarter the VRAM
          }
        }
        // hair cards & cutout parts: alpha-blended skin meshes z-fight badly;
        // alpha-test cutout renders crisp and sorts correctly
        if (m.map && (m.transparent || m.alphaMap)) {
          m.alphaTest = Math.max(m.alphaTest || 0, 0.4);
          m.transparent = false;
          m.depthWrite = true;
          m.needsUpdate = true;
        }
        // game exports often have flipped normals on cards/shells — single-
        // sided rendering makes those parts vanish; double-sided shows all
        m.side = THREE.DoubleSide;
        // Blender FBX exports routinely carry a junk uniform vertex-color
        // layer that multiplies (tints) everything gray — kill it, and let
        // textures speak with a white base color instead of the exporter's
        // viewport tint
        m.vertexColors = false;
        if (m.map) m.color.setHex(0xffffff);
        // FBX Phong gloss (shininess up to 100 + bright specular) blows out
        // into milky highlights — eyes look like cataracts, fur like vinyl.
        // Clamp to a matte finish with a small catchlight.
        if (m.isMeshPhongMaterial) {
          m.shininess = Math.min(m.shininess || 0, 18);
          m.specular?.setRGB(0.06, 0.06, 0.06);
        }
        m.needsUpdate = true;
        // a fully untextured model that ships pure black reads terribly under
        // our show lighting — lift it to neutral plastic. But on a textured
        // model, black slots are authored (pupils, claws) — leave them be.
        if (!anyTextured && !m.map && m.color && m.color.getHex() === 0x000000) m.color.setHex(0x9aa0a8);
      }
    });
    obj.userData.missingTextures = [...missing];
    onTexturesSettled?.([...missing]);
  };
  manager.onLoad = strip;
  setTimeout(strip, 4000);   // belt & braces if the manager settled early

  obj.traverse((n) => { if (n.isMesh) { n.castShadow = true; n.frustumCulled = false; } });
  return obj;
}

/**
 * Drop morph targets we never drive. Avatar exports often ship 100+ visemes
 * and expression keys; every one is a full per-vertex delta stream uploaded
 * to (and blended on) the GPU each frame — a massive hidden cost on
 * high-poly meshes. Pass regexes of names to keep ([] strips everything,
 * which is right for static showcase models).
 */
export function pruneMorphs(root, keepPatterns = []) {
  let kept = 0, dropped = 0;
  root.traverse((m) => {
    if (!m.isMesh || !m.morphTargetDictionary) return;
    const geo = m.geometry;
    const entries = Object.entries(m.morphTargetDictionary);   // name → index
    const keep = entries.filter(([n]) => keepPatterns.some((r) => r.test(n.trim())));
    if (keep.length === entries.length) { kept += keep.length; return; }
    const attrs = {};
    for (const key of Object.keys(geo.morphAttributes || {})) {
      const list = keep.map(([, i]) => geo.morphAttributes[key][i]).filter(Boolean);
      if (list.length) attrs[key] = list;
    }
    geo.morphAttributes = attrs;
    const dict = {};
    keep.forEach(([n], i) => { dict[n] = i; });
    m.morphTargetDictionary = dict;
    m.morphTargetInfluences = new Array(keep.length).fill(0);
    kept += keep.length;
    dropped += entries.length - keep.length;
  });
  return { kept, dropped };
}

/**
 * ON-THE-FLY DECIMATION via index clustering: vertices are snapped to a
 * spatial grid and triangles re-pointed at one representative per cell;
 * degenerate triangles vanish. Crucially this only builds a NEW INDEX —
 * every vertex attribute (positions, UVs, normals, skin weights, morph
 * deltas) is untouched and shared, so skinned + morphed meshes decimate
 * safely and the swap back to full quality is instant.
 */
export function buildLodIndex(geo, div = 56) {
  const pos = geo.attributes.position;
  const idx = geo.index;
  if (!idx || !pos || pos.count < 1000) return null;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const sx = (maxX - minX) || 1e-6, sy = (maxY - minY) || 1e-6, sz = (maxZ - minZ) || 1e-6;
  const repr = new Map();
  const remap = new Uint32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const cx = Math.min(div - 1, ((pos.getX(i) - minX) / sx * div) | 0);
    const cy = Math.min(div - 1, ((pos.getY(i) - minY) / sy * div) | 0);
    const cz = Math.min(div - 1, ((pos.getZ(i) - minZ) / sz * div) | 0);
    const key = (cx * div + cy) * div + cz;
    let r = repr.get(key);
    if (r === undefined) { r = i; repr.set(key, i); }
    remap[i] = r;
  }
  const out = [];
  for (let i = 0; i < idx.count; i += 3) {
    const a = remap[idx.getX(i)], b = remap[idx.getX(i + 1)], c = remap[idx.getX(i + 2)];
    if (a !== b && b !== c && a !== c) out.push(a, b, c);
  }
  if (out.length >= idx.count * 0.9) return null;   // decimation didn't help
  return new THREE.BufferAttribute(new Uint32Array(out), 1);
}

/** Lazily prepare LOD indices for every big mesh under a root. */
export function prepareLods(root, minTris = 12000) {
  root?.traverse?.((n) => {
    if (!n.isMesh || n.userData._lodTried) return;
    n.userData._lodTried = true;
    const g = n.geometry;
    if (!g.index || g.index.count / 3 < minTris) return;
    const lod = buildLodIndex(g);
    if (lod) {
      n.userData.fullIndex = g.index;
      n.userData.lodIndex = lod;
    }
  });
}

/** Swap prepared LOD indices in (true) or out (false). */
export function applyLod(root, on) {
  let swapped = 0;
  root?.traverse?.((n) => {
    if (!n.isMesh || !n.userData.lodIndex) return;
    const want = on ? n.userData.lodIndex : n.userData.fullIndex;
    if (n.geometry.index !== want) { n.geometry.setIndex(want); swapped++; }
  });
  return swapped;
}

/**
 * TEXTURE CRUNCHING under heavy load: shrink every live texture to `max`
 * px (stashing the previous image), quartering sampling cost + VRAM.
 * restoreTextures() puts the originals back when the frame rate recovers.
 */
export function crunchTextures(root, max = 1024) {
  root?.traverse?.((n) => {
    if (!n.isMesh) return;
    for (const m of Array.isArray(n.material) ? n.material : [n.material]) {
      if (!m) continue;
      for (const slot of ['map', 'normalMap', 'emissiveMap', 'alphaMap', 'specularMap', 'bumpMap']) {
        const tex = m[slot];
        const img = tex?.image;
        if (!img?.width || Math.max(img.width, img.height) <= max) continue;
        if (!tex.userData._fullImage) tex.userData._fullImage = img;
        const scale = max / Math.max(img.width, img.height);
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * scale));
        c.height = Math.max(1, Math.round(img.height * scale));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        tex.image = c;
        tex.dispose();        // GPU texture is size-locked — free it so it reallocates
        tex.needsUpdate = true;
      }
    }
  });
}

export function restoreTextures(root) {
  root?.traverse?.((n) => {
    if (!n.isMesh) return;
    for (const m of Array.isArray(n.material) ? n.material : [n.material]) {
      if (!m) continue;
      for (const slot of ['map', 'normalMap', 'emissiveMap', 'alphaMap', 'specularMap', 'bumpMap']) {
        const tex = m[slot];
        if (tex?.userData?._fullImage) {
          tex.image = tex.userData._fullImage;
          delete tex.userData._fullImage;
          tex.dispose();      // same: reallocate at the restored size
          tex.needsUpdate = true;
        }
      }
    }
  });
}

/** Geometry/rig statistics — the "tech sheet" the brains read out. */
export function computeModelStats(obj) {
  let tris = 0, verts = 0, meshes = 0, bones = 0, morphs = 0;
  const mats = new Set();
  obj.traverse((n) => {
    if (n.isBone) bones++;
    if (!n.isMesh) return;
    meshes++;
    const g = n.geometry;
    verts += g.attributes.position?.count || 0;
    tris += Math.round((g.index ? g.index.count : (g.attributes.position?.count || 0)) / 3);
    (Array.isArray(n.material) ? n.material : [n.material]).forEach(m => m && mats.add(m.uuid));
    morphs += Object.keys(n.morphTargetDictionary || {}).length;
  });
  const size = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
  return {
    triangles: tris, vertices: verts, meshes, materials: mats.size, bones, morphs,
    size: { x: +size.x.toFixed(2), y: +size.y.toFixed(2), z: +size.z.toFixed(2) },
  };
}

/** Human-readable stat lines (used by the chat brains and the HUD). */
export function statsToLines(s) {
  if (!s) return [];
  const fmt = (n) => n.toLocaleString('en-US');
  return [
    `${fmt(s.triangles)} triangles / ${fmt(s.vertices)} vertices across ${s.meshes} mesh${s.meshes === 1 ? '' : 'es'}`,
    `${s.materials} material${s.materials === 1 ? '' : 's'}, ${s.bones} bone${s.bones === 1 ? '' : 's'}, ${s.morphs} blendshape${s.morphs === 1 ? '' : 's'}`,
  ];
}
