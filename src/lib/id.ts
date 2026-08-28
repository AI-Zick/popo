let counter = 0;

/** Short, sortable, collision-safe-enough id for in-browser records. */
export function newId(prefix = 'r'): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}`;
}
