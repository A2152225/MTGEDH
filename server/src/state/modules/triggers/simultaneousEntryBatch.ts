/**
 * triggers/simultaneousEntryBatch.ts
 *
 * "Whenever one or more <things> enter" triggers fire ONCE per simultaneous event
 * (rule 603.2c-style batching): creating N tokens at once, mass reanimation, or anything
 * entering during one resolution. Plain "Whenever a creature enters" still fires per
 * permanent, because only "one or more" clauses are deduplicated.
 *
 * Usage: wrap a simultaneous-entry operation in runWithSimultaneousEntryBatch(); queue
 * paths call filterOneOrMoreEntryDuplicates() before pushing ETB triggers.
 * The same batch covers "Whenever one or more ... die / are put into a graveyard" via
 * isOneOrMoreBatchDuplicate().
 * Public entry symbols: runWithSimultaneousEntryBatch, filterOneOrMoreEntryDuplicates,
 * isOneOrMoreEntryTriggerItem, isOneOrMoreBatchDuplicate, claimSimultaneousBatchKey.
 */

interface EntryBatch {
  fired: Set<string>;
}

const batchStack: EntryBatch[] = [];

/** Run fn as one simultaneous entry event. Nested calls share the outermost batch. */
export function runWithSimultaneousEntryBatch<T>(fn: () => T): T {
  if (batchStack.length > 0) return fn();
  batchStack.push({ fired: new Set<string>() });
  try {
    return fn();
  } finally {
    batchStack.pop();
  }
}

/**
 * Record a caller-built key in the active batch. 'first' the first time, 'duplicate' after,
 * 'none' outside a batch (nothing is deduplicated then).
 */
export function claimSimultaneousBatchKey(key: string): 'first' | 'duplicate' | 'none' {
  const batch = batchStack[batchStack.length - 1];
  if (!batch) return 'none';
  if (batch.fired.has(key)) return 'duplicate';
  batch.fired.add(key);
  return 'first';
}

function norm(text: unknown): string {
  return String(text || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9+/{} ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ONE_OR_MORE_ENTER_HEADER_RE = /\bwhenever one or more\b[^,.]*?\benters?\b/i;
const ONE_OR_MORE_ENTER_CLAUSE_RE = /\bwhenever one or more\b[^,.]*?\benters?\b[^,.]*,\s*([^.]+)/gi;

/** True when the stack item came from a "Whenever one or more ... enter" clause. */
export function isOneOrMoreEntryTriggerItem(item: any): boolean {
  if (!item) return false;
  const description = String(item.description || '');
  if (ONE_OR_MORE_ENTER_HEADER_RE.test(description)) return true;
  const effect = norm(item.effect || item.description);
  if (!effect) return false;
  const oracle = String(item.card?.oracle_text || item.sourcePermanentSnapshot?.card?.oracle_text || '');
  if (!/\bone or more\b/i.test(oracle)) return false;
  ONE_OR_MORE_ENTER_CLAUSE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ONE_OR_MORE_ENTER_CLAUSE_RE.exec(oracle)) !== null) {
    const clauseEffect = norm(match[1]);
    if (!clauseEffect) continue;
    const probe = effect.slice(0, Math.min(effect.length, 24));
    if (clauseEffect.startsWith(probe) || effect.startsWith(clauseEffect.slice(0, 24)) || clauseEffect.includes(effect)) {
      return true;
    }
  }
  return false;
}

function batchKey(item: any): string {
  const source = String(item?.source || item?.permanentId || item?.sourceName || '');
  return `${source}|${norm(item?.effect || item?.description)}`;
}

/**
 * Drop "one or more ... enter" triggers that already fired in the active simultaneous
 * batch (same source, same ability). Outside a batch everything is kept.
 */
export function filterOneOrMoreEntryDuplicates<T>(items: readonly T[]): T[] {
  const batch = batchStack[batchStack.length - 1];
  if (!batch) return [...items];
  const out: T[] = [];
  for (const item of items) {
    if (!isOneOrMoreEntryTriggerItem(item)) {
      out.push(item);
      continue;
    }
    const key = batchKey(item);
    if (batch.fired.has(key)) continue;
    batch.fired.add(key);
    out.push(item);
  }
  return out;
}

const ONE_OR_MORE_EVENT_CLAUSE_RE: Record<'dies', RegExp> = {
  dies: /\bwhenever one or more\b[^,.]*?\b(?:die|dies|(?:are|is) put into (?:a |your |an opponent's |their )?graveyards?)\b[^,]*,\s*([^.]+)/gi,
};

/**
 * For a "Whenever one or more ... die" trigger (source oracle + effect), true when the same
 * source already triggered for this simultaneous batch, i.e. this one must be dropped.
 * Records the first occurrence. Outside a batch nothing is a duplicate.
 */
export function isOneOrMoreBatchDuplicate(
  kind: 'dies',
  sourceId: string,
  effect: string,
  sourceOracle: string,
): boolean {
  const batch = batchStack[batchStack.length - 1];
  if (!batch) return false;
  const normalizedEffect = norm(effect);
  if (!normalizedEffect || !/\bone or more\b/i.test(sourceOracle)) return false;
  const re = ONE_OR_MORE_EVENT_CLAUSE_RE[kind];
  re.lastIndex = 0;
  let matched = false;
  let match: RegExpExecArray | null;
  while ((match = re.exec(sourceOracle)) !== null) {
    const clauseEffect = norm(match[1]);
    if (!clauseEffect) continue;
    const probe = normalizedEffect.slice(0, Math.min(normalizedEffect.length, 24));
    if (clauseEffect.startsWith(probe) || normalizedEffect.startsWith(clauseEffect.slice(0, 24))) {
      matched = true;
      break;
    }
  }
  if (!matched) return false;
  const key = `${kind}|${sourceId}|${normalizedEffect}`;
  if (batch.fired.has(key)) return true;
  batch.fired.add(key);
  return false;
}
