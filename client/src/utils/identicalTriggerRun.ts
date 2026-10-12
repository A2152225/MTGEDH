/**
 * Client mirror of server/src/socket/identicalTriggerBulkResolve.ts grouping:
 * how many identical no-choice triggers sit on top of the stack. The server
 * re-validates; this only decides whether to show "Resolve all identical (xN)".
 */
const CHOICE_EFFECT_RE = /\b(?:target|you may|choose|chosen by|any number|divided|distribute|vote|unless|in any order|of your choice|of their choice)\b|\bX\b/i;

function hasEntries(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value as object).length > 0;
  return Boolean(value);
}

export function identicalTriggerRunKey(item: any): string | null {
  if (!item || item.type !== 'triggered_ability') return null;
  if (item.mandatory === false || item.optional === true) return null;
  if (hasEntries(item.targets) || hasEntries(item.targetIds) || item.requiresTarget === true) return null;
  if (hasEntries(item.modes) || item.isModal === true || item.isCopy === true) return null;
  const effect = String(item.effect || item.description || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!effect || CHOICE_EFFECT_RE.test(effect)) return null;
  const source = String(item.source || item.sourceId || item.permanentId || '').trim();
  const sourceName = String(item.sourceName || item.card?.name || '').trim().toLowerCase();
  return [String(item.controller || ''), source, sourceName, String(item.triggerType || ''), effect].join('|');
}

/** Stack is bottom-first (top = last element), as on the server. */
export function countIdenticalTopTriggerRun(stack: readonly any[] | undefined): number {
  const items = Array.isArray(stack) ? stack : [];
  if (items.length === 0) return 0;
  const key = identicalTriggerRunKey(items[items.length - 1]);
  if (!key) return 0;
  let count = 0;
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (identicalTriggerRunKey(items[i]) !== key) break;
    count += 1;
  }
  return count;
}
