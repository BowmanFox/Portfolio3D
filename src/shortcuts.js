// Global keyboard shortcuts. Plain keys only (no Alt/Ctrl combos — the host
// page or browser owns those, especially inside a carrd iframe). Disabled
// while any text field has focus.
export const SHORTCUT_HELP = [
  ['F1 / H', 'Open Help'],
  ['1 … 5', 'Open Viewer / Chat / Projects / Media Player / Settings'],
  ['← / →', 'Previous / next project model'],
  ['Space', 'Ask Spotty to present the current project'],
  ['G', 'Spotty dances (groove.exe)'],
  ['T', 'Toss the model (physics!)'],
  ['M', 'Toggle lo-fi beat'],
  ['B', 'Mute / unmute all sound'],
  ['W', 'Change wallpaper'],
  ['R', 'Refresh desktop'],
  ['A', 'Auto-arrange icons'],
  ['D', 'Minimize all (show desktop)'],
  ['Tab', 'Cycle windows'],
  ['Esc', 'Close menus'],
];

export function initShortcuts(actions) {
  window.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.ctrlKey || e.metaKey || e.altKey) return;
    // games (Snake, Minesweeper…) own the keyboard while focused
    if (document.querySelector('.win.focused[data-trapkeys]')) return;

    const k = e.key.toLowerCase();
    const fire = (fn) => { e.preventDefault(); fn?.(); };

    switch (k) {
      case 'f1': case 'h': return fire(actions.help);
      case '1': return fire(actions.openViewer);
      case '2': return fire(actions.openChat);
      case '3': return fire(actions.openProjects);
      case '4': return fire(actions.openPlayer);
      case '5': return fire(actions.openSettings);
      case 'arrowleft': return fire(actions.prevProject);
      case 'arrowright': return fire(actions.nextProject);
      case ' ': return fire(actions.present);
      case 'g': return fire(actions.dance);
      case 't': return fire(actions.toss);
      case 'm': return fire(actions.music);
      case 'b': return fire(actions.mute);
      case 'w': return fire(actions.wallpaper);
      case 'r': return fire(actions.refresh);
      case 'a': return fire(actions.arrange);
      case 'd': return fire(actions.minimizeAll);
      case 'tab': return fire(actions.cycleWindows);
    }
  });
}
