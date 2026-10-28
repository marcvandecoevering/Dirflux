// Match droppy's modifier precedence, including modifiers held at drag start.
export function dropOperation(event, started = null) {
  if (started === 'copy' || event.ctrlKey || event.metaKey || event.altKey) return 'copy';
  if (started === 'move' || event.shiftKey) return 'move';
  return null;
}

export function readInternalDrop(raw) {
  let item;
  try { item = JSON.parse(raw); } catch { throw new Error('Invalid drag data.'); }
  if (!item || typeof item.path !== 'string' || !item.path ||
      item.path.includes('\\') || item.path.includes('\0') ||
      item.path.split('/').some(part => !part || part === '.' || part === '..') ||
      typeof item.directory !== 'boolean' ||
      (item.operation != null && !['copy', 'move'].includes(item.operation))) {
    throw new Error('Invalid drag data.');
  }
  // Derive the target name from the path rather than trusting another payload field.
  return { path:item.path, name:item.path.split('/').at(-1), directory:item.directory, operation:item.operation ?? null };
}

export function dropTransfer(item, destination, operation) {
  if (!['copy', 'move'].includes(operation)) throw new Error('Invalid drag operation.');
  const target = [destination, item.name].filter(Boolean).join('/');
  if (operation === 'move' && item.path === target) return null;
  return { source:item.path, target, operation, conflict:'rename' };
}
