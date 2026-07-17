// ============ BOWMAN.EXE site configuration ============
// Everything a portfolio owner usually wants to tweak lives here.
export const CONFIG = {
  brandName: 'BOWMAN Megatrends',
  appName: 'BOWMANPORTFOLIO.EXE',
  guideName: 'Bowman',

  // Preset guide character: URL to an .fbx rig. Leave '' to use the built-in
  // procedural robot. Mixamo-style and MMD-style (Japanese) bone names are
  // both auto-mapped and retargeted; morph targets like "aa"/"blink"
  // (or あ/まばたき) are picked up for facial expression.
  // Visitors can still override per-visit with ?character=URL,
  // and drag-and-drop of .fbx files onto the viewer always works.
  // NOTE: must be a URL the browser can fetch (relative to index.html or
  // https://…), not an OS path like H:\… — the file below ships in src/.
  characterFBX: 'src/FORCOMMANDER17 - Copy.fbx',
  characterHeight: 1.55,          // metres the rig is normalized to

  // Local LLM (WebLLM model id) used when the visitor opts in.
  llmModel: 'Ministral-3-3B-Reasoning-2512-q4f32_1-MLC',
};
