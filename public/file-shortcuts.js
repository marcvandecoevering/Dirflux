// Decide whether a browser shortcut belongs to the file list. Preserve native
// text selection, modified browser commands and input-method composition.
export function fileShortcut(event, { selected = false, clipboard = false, textSelected = false, writable = true } = {}) {
  if (event.defaultPrevented || event.isComposing || event.altKey || event.shiftKey || !(event.ctrlKey || event.metaKey)) return null;
  const key = event.key.toLowerCase();
  if (textSelected && (key === 'c' || key === 'x')) return null;
  if (key === 'c' && selected) return 'copy';
  if (key === 'x' && selected && writable) return 'move';
  if (key === 'v' && clipboard && writable) return 'paste';
  return null;
}
