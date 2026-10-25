/**
 * Batch 20: a stable source id for a resolving spell. While a spell's effects execute, the stack item may already
 * be gone, so damage replacement matchers ("spells that target it", "instant and sorcery spells") read this
 * snapshot keyed by the stack item id or the spell card id.
 */
export interface ResolvingSpellSource {
  id: string;
  cardId: string;
  card?: { name?: string; type_line?: string; colors?: string[] };
  targets: string[];
}

const KEY = 'batch20ResolvingSpellSource';
/** Batch 24: bounded history of spells that resolved, so damage dealt after resolution keeps its source. */
const HISTORY_KEY = 'batch24RecordedSpellSources';
const HISTORY_LIMIT = 64;

function isSpellSource(v: unknown): v is ResolvingSpellSource {
  return !!v && typeof v === 'object' && typeof Reflect.get(v, 'id') === 'string';
}

function recordSpellSource(state: object, src: ResolvingSpellSource): void {
  const prev: unknown = Reflect.get(state, HISTORY_KEY);
  const list = Array.isArray(prev) ? prev.filter(isSpellSource).filter((e) => e.id !== src.id) : [];
  list.push(src);
  Reflect.set(state, HISTORY_KEY, list.slice(-HISTORY_LIMIT));
}

/** A spell recorded while it resolved (by stack item id or card id), even after it left the stack. */
export function getRecordedSpellSource(state: unknown, id: string): ResolvingSpellSource | undefined {
  if (!id || !state || typeof state !== 'object') return undefined;
  const list: unknown = Reflect.get(state, HISTORY_KEY);
  if (!Array.isArray(list)) return undefined;
  for (let i = list.length - 1; i >= 0; i--) {
    const e: unknown = list[i];
    if (isSpellSource(e) && (e.id === id || (!!e.cardId && e.cardId === id))) return e;
  }
  return undefined;
}

export function targetIdsOf(targets: unknown): string[] {
  if (!Array.isArray(targets)) return [];
  return targets
    .map((t: unknown) => (t && typeof t === 'object' ? String(Reflect.get(t, 'id') || '') : String(t || '')))
    .filter((id) => id.length > 0);
}

export function setResolvingSpellSource(state: unknown, src: ResolvingSpellSource): void {
  if (state && typeof state === 'object') {
    Reflect.set(state, KEY, src);
    recordSpellSource(state, src);
  }
}

export function clearResolvingSpellSource(state: unknown): void {
  if (state && typeof state === 'object') Reflect.deleteProperty(state, KEY);
}

export function getResolvingSpellSource(state: unknown, id: string): ResolvingSpellSource | undefined {
  if (!id || !state || typeof state !== 'object') return undefined;
  const raw: unknown = Reflect.get(state, KEY);
  if (!raw || typeof raw !== 'object') return undefined;
  const src = raw as ResolvingSpellSource;
  return src.id === id || (!!src.cardId && src.cardId === id) ? src : undefined;
}

/** Record `src` while `fn` runs, restoring any outer resolving spell afterwards. */
export function withResolvingSpellSource<T>(state: unknown, src: ResolvingSpellSource, fn: () => T): T {
  const prev: unknown = state && typeof state === 'object' ? Reflect.get(state, KEY) : undefined;
  setResolvingSpellSource(state, src);
  try {
    return fn();
  } finally {
    if (prev && typeof prev === 'object') setResolvingSpellSource(state, prev as ResolvingSpellSource);
    else clearResolvingSpellSource(state);
  }
}
