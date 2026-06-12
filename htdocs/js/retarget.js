// Bone mapping + retargeting. Any imported FBX rig (Mixamo, Biped, Blender
// Rigify, Synty, etc.) is normalized onto one canonical humanoid armature so
// the Animator can drive every character identically. Rest pose is captured
// at bind time and pose offsets are applied relative to it — that's what
// makes one pose library work across differently-oriented rigs.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

export const CANONICAL = [
  'Hips', 'Spine', 'Chest', 'Neck', 'Head',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot',
  'RightUpLeg', 'RightLeg', 'RightFoot',
];

// alias → canonical, after normalize() (lowercased, separators stripped,
// vendor prefixes removed, l/r folded into "left"/"right" prefix)
const ALIASES = {
  hips: 'Hips', pelvis: 'Hips', root: 'Hips', cog: 'Hips',
  spine: 'Spine', spine0: 'Spine', spine01: 'Spine', spine1: 'Spine', abdomen: 'Spine', torso: 'Spine',
  spine2: 'Chest', spine02: 'Chest', spine3: 'Chest', chest: 'Chest', upperchest: 'Chest',
  neck: 'Neck', neck1: 'Neck',
  head: 'Head',
  leftshoulder: 'LeftShoulder', leftclavicle: 'LeftShoulder', leftcollar: 'LeftShoulder',
  leftarm: 'LeftArm', leftupperarm: 'LeftArm', leftuparm: 'LeftArm', leftshoulderarm: 'LeftArm',
  leftforearm: 'LeftForeArm', leftlowerarm: 'LeftForeArm', leftelbow: 'LeftForeArm',
  lefthand: 'LeftHand', leftwrist: 'LeftHand',
  rightshoulder: 'RightShoulder', rightclavicle: 'RightShoulder', rightcollar: 'RightShoulder',
  rightarm: 'RightArm', rightupperarm: 'RightArm', rightuparm: 'RightArm',
  rightforearm: 'RightForeArm', rightlowerarm: 'RightForeArm', rightelbow: 'RightForeArm',
  righthand: 'RightHand', rightwrist: 'RightHand',
  leftupleg: 'LeftUpLeg', leftthigh: 'LeftUpLeg', leftupperleg: 'LeftUpLeg', lefthip: 'LeftUpLeg',
  leftleg: 'LeftLeg', leftcalf: 'LeftLeg', leftshin: 'LeftLeg', leftknee: 'LeftLeg', leftlowerleg: 'LeftLeg',
  leftfoot: 'LeftFoot', leftankle: 'LeftFoot',
  rightupleg: 'RightUpLeg', rightthigh: 'RightUpLeg', rightupperleg: 'RightUpLeg', righthip: 'RightUpLeg',
  rightleg: 'RightLeg', rightcalf: 'RightLeg', rightshin: 'RightLeg', rightknee: 'RightLeg', rightlowerleg: 'RightLeg',
  rightfoot: 'RightFoot', rightankle: 'RightFoot',
  // English-translated MMD exports
  center: 'Hips', lowerbody: 'Hips', waist: 'Hips',
  upperbody: 'Spine', upperbody2: 'Chest', upperbody3: 'Chest',
  leftelbow2: 'LeftForeArm', rightelbow2: 'RightForeArm',
};

// MikuMikuDance rigs keep their original Japanese bone names through most
// FBX conversions — matched verbatim (no normalization). IK/D-helper bones
// (左足ＩＫ, 左足D, …) are deliberately absent so they never get claimed.
const MMD_ALIASES = {
  '下半身': 'Hips', '腰': 'Hips',
  '上半身': 'Spine', '上半身2': 'Chest', '上半身２': 'Chest',
  '首': 'Neck', '頭': 'Head',
  '左肩': 'LeftShoulder', '左腕': 'LeftArm', '左ひじ': 'LeftForeArm', '左肘': 'LeftForeArm', '左手首': 'LeftHand',
  '右肩': 'RightShoulder', '右腕': 'RightArm', '右ひじ': 'RightForeArm', '右肘': 'RightForeArm', '右手首': 'RightHand',
  '左足': 'LeftUpLeg', '左ひざ': 'LeftLeg', '左膝': 'LeftLeg', '左足首': 'LeftFoot',
  '右足': 'RightUpLeg', '右ひざ': 'RightLeg', '右膝': 'RightLeg', '右足首': 'RightFoot',
};

/** "mixamorig:LeftForeArm" | "Bip01 L Forearm" | "forearm.L" → "leftforearm" */
export function normalizeBoneName(raw) {
  let n = raw.toLowerCase()
    // vendor prefixes only when followed by a separator, so "rig" can never
    // eat the start of "right…"
    .replace(/^(armature|skeleton|character\d*|rig)(?=[\s:|_.\-])[\s:|_.\-]*/, '')
    .replace(/^mixamorig\d*[:_]?/, '')
    .replace(/^bip\d*[\s:|_.\-]+/, '');

  // tokenize on separators so side markers ("l", "r", "left", "right") are
  // unambiguous — never confused with words ending in l/r like "shoulder"
  const parts = n.split(/[\s._:\-|]+/).filter(Boolean);
  const sideTok = (t) => (t === 'l' || t === 'left') ? 'left' : (t === 'r' || t === 'right') ? 'right' : null;
  let side = '';
  if (parts.length > 1) {
    const first = sideTok(parts[0]), last = sideTok(parts[parts.length - 1]);
    if (first) { side = first; parts.shift(); }
    else if (last) { side = last; parts.pop(); }
  }
  n = parts.join('');

  // glued-on side prefix without separators: "leftarm", "rightupleg"
  if (!side) {
    const m = n.match(/^(left|right)(.+)$/);
    if (m && m[2].length > 2) { side = m[1]; n = m[2]; }
  }
  return side + n;
}

/**
 * Walk a model, find its bones, and return { canonicalName: Bone }.
 * Works on any Object3D tree (SkinnedMesh skeletons or plain Bone groups).
 */
export function buildBoneMap(root) {
  // pass 1: collect candidates in traversal order
  const candidates = [];
  const norms = new Set();
  let centerFallback = null;
  root.traverse((node) => {
    const raw = (node.name || '').trim();
    const mmd = MMD_ALIASES[raw] ?? MMD_ALIASES[raw.replace(/^(armature|skeleton)[|:_\s]+/i, '')];
    if (!node.isBone && !mmd && !(node.isObject3D && /bone|bip|rig/i.test(raw))) return;
    const norm = normalizeBoneName(raw);
    norms.add(norm);
    candidates.push({ node, mmd, norm });
    if (!centerFallback && /^センター$/.test(raw)) centerFallback = node;
  });

  // context rules for ambiguous names: Unity/VRChat rigs call the thigh
  // "Left leg" and the shin "Left knee" — when a knee bone exists, "leg"
  // must mean the upper leg
  const overrides = {};
  for (const s of ['left', 'right']) {
    const S = s === 'left' ? 'Left' : 'Right';
    if (norms.has(s + 'knee')) overrides[s + 'leg'] = S + 'UpLeg';
  }

  // pass 2: assign, first claim wins
  const map = {};
  const claimed = new Set();
  for (const { node, mmd, norm } of candidates) {
    const canon = mmd ?? overrides[norm] ?? ALIASES[norm];
    if (canon && !claimed.has(canon)) {
      map[canon] = node;
      claimed.add(canon);
    }
  }
  if (!map.Hips && centerFallback) map.Hips = centerFallback;
  return map;
}

/**
 * Snapshot the rest pose so the animator can pose *relative* to it:
 * bone.quaternion = rest ⊗ offset. Returns { canon: {bone, rest} }.
 */
export function bindRestPose(boneMap) {
  const rig = {};
  for (const [canon, bone] of Object.entries(boneMap)) {
    rig[canon] = { bone, rest: bone.quaternion.clone() };
  }
  return rig;
}

/**
 * Many rigs (Mixamo et al.) bind in a T-pose, which makes "idle" look like a
 * scarecrow. If the upper arms point sideways at bind time, bake a world-space
 * swing toward "down" into the captured rest quaternion (leaving a slight
 * A-pose). Pose offsets still apply on top, so animation is unaffected.
 */
export function relaxTPose(rig, root) {
  root.updateMatrixWorld(true);
  const down = new THREE.Vector3(0, -1, 0);
  for (const side of ['Left', 'Right']) {
    const arm = rig[side + 'Arm'], fore = rig[side + 'ForeArm'];
    if (!arm || !fore) continue;
    const aw = arm.bone.getWorldPosition(new THREE.Vector3());
    const fw = fore.bone.getWorldPosition(new THREE.Vector3());
    const dir = fw.sub(aw).normalize();
    if (Math.abs(dir.y) > 0.55) continue;                    // already hangs down
    const angle = Math.acos(THREE.MathUtils.clamp(dir.dot(down), -1, 1)) - 0.15;
    const axis = new THREE.Vector3().crossVectors(dir, down);
    if (axis.lengthSq() < 1e-5 || angle <= 0) continue;
    axis.normalize();
    const qSwing = new THREE.Quaternion().setFromAxisAngle(axis, angle);
    const qParent = arm.bone.parent.getWorldQuaternion(new THREE.Quaternion());
    const qLocal = qParent.clone().invert().multiply(qSwing).multiply(qParent);
    arm.rest.premultiply(qLocal);
  }
}

/** Coverage report — which canonical bones an import resolved. */
export function mapReport(boneMap) {
  const found = Object.keys(boneMap);
  const missing = CANONICAL.filter(c => !found.includes(c));
  return { found, missing, ratio: found.length / CANONICAL.length };
}

/**
 * Retarget animation clips that shipped inside an FBX onto another rig
 * (e.g. play a Mixamo idle on the procedural robot). Thin wrapper over
 * SkeletonUtils.retargetClip with our name normalization as the bone map.
 */
export function retargetClip(targetSkinnedMesh, sourceRoot, clip) {
  const sourceSkin = findSkinned(sourceRoot);
  if (!sourceSkin) return null;
  const names = {};
  for (const b of targetSkinnedMesh.skeleton.bones) {
    const canon = ALIASES[normalizeBoneName(b.name)];
    if (!canon) continue;
    const src = sourceSkin.skeleton.bones.find(sb => ALIASES[normalizeBoneName(sb.name)] === canon);
    if (src) names[b.name] = src.name;
  }
  try {
    return SkeletonUtils.retargetClip(targetSkinnedMesh, sourceSkin, clip, { names, useFirstFramePosition: true });
  } catch (err) {
    console.warn('retargetClip failed:', err);
    return null;
  }
}

export function findSkinned(root) {
  let found = null;
  root.traverse((n) => { if (!found && n.isSkinnedMesh) found = n; });
  return found;
}
