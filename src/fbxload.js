// Shared FBX loading utilities. Real-world FBX files (Blender/Unity/VRChat
// exports) routinely reference textures by absolute paths from the author's
// machine ("C:\Users\…\WadeMain.png"). In a browser those 404 — or worse.
// This loader rewrites every texture request to look for the bare filename
// next to the .fbx, and after loading strips any texture that still failed,
// so materials fall back to their plain colors instead of rendering black.
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

const IMG_RE = /\.(png|jpe?g|tga|bmp|gif|webp|dds)(\?.*)?$/i;

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
  const obj = isFile
    ? loader.parse(await source.arrayBuffer(), baseDir)
    : await loader.loadAsync(source, (e) => {
        if (e.lengthComputable) onProgress?.(e.loaded / e.total);
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
