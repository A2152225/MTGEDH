// server/src/state/modules/longTailStaticSourceIndex.ts
//
// Origin: new module (no parent). Serves the per-permanent "does any battlefield source grant
// this?" loops in batch97GrantedEquipmentAbilities.ts and batch104Apply.ts … batch112Apply.ts
// that stampLayer4TypeSetting (layer4TypeSetting.ts) runs for every permanent.
//
// Public entry symbols:
//   createLongTailStaticSourceFilter, parseExportsOf,
//   withLongTailStaticSourceIndex, longTailStaticSources
//
// Why: those loops visit every battlefield source for every permanent, for 8 type questions and
// 66 keyword questions each. With 229 permanents (200 Borg tokens) that is about four million
// source visits and 20 seconds for ONE continuous-effects recompute, although no source on the
// board had any of the texts being looked for.
//
// A source can only matter to a batch when at least one of that batch's parsers finds something
// in its text. This module asks that once per distinct text (remembered), builds the short list
// of sources that can matter once per stamp, and hands the loops that list instead of the whole
// battlefield. Counting helpers ("as long as you control six or more creatures") still read the
// full battlefield; only the "which sources do I ask" loop is shortened.

type LineParser = (line: string) => unknown;

const MAX_REMEMBERED_LINES = 20_000;

/** A parser found nothing: null/undefined/false/0/'' or an empty array, Set or Map. */
function parsedNothing(value: unknown): boolean {
  if (value == null || value === false || value === 0 || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (value instanceof Set || value instanceof Map) return value.size === 0;
  return false;
}

/** Every exported `parse*` function of a parser module (they all take the text as first argument). */
export function parseExportsOf(parserModule: Record<string, unknown>): LineParser[] {
  const out: LineParser[] = [];
  for (const [name, value] of Object.entries(parserModule)) {
    if (typeof value === 'function' && /^parse[A-Z0-9]/.test(name)) out.push(value as LineParser);
  }
  return out;
}

export interface LongTailStaticSourceFilter {
  readonly id: string;
  /** True when none of the batch's parsers finds anything in `line`, so the source cannot matter. */
  isInertLine(line: unknown): boolean;
}

/**
 * `parsers` is called lazily on first use so parser modules are fully loaded. Pass every parser the
 * shortened loops consult (use parseExportsOf for a whole parser module: more than needed is safe,
 * fewer is not).
 */
export function createLongTailStaticSourceFilter(id: string, parsers: () => LineParser[]): LongTailStaticSourceFilter {
  let resolved: LineParser[] | null = null;
  const remembered = new Map<string, boolean>();
  return {
    id,
    isInertLine(line: unknown): boolean {
      if (typeof line !== 'string') return false;
      const known = remembered.get(line);
      if (known !== undefined) return known;
      if (!resolved) resolved = parsers();
      let inert = resolved.length > 0;
      for (const parse of resolved) {
        try {
          if (!parsedNothing(parse(line))) {
            inert = false;
            break;
          }
        } catch {
          // A parser that cannot handle the text is treated as "might matter".
          inert = false;
          break;
        }
      }
      if (remembered.size >= MAX_REMEMBERED_LINES) remembered.clear();
      remembered.set(line, inert);
      return inert;
    },
  };
}

let activeIndex: { battlefield: unknown[]; lists: Map<string, any[]> } | null = null;

/**
 * Run `fn` with per-batch source lists shared across every permanent. Only valid while `fn` neither
 * adds/removes battlefield permanents nor changes their oracle text (the layer 4 stamp does neither).
 */
export function withLongTailStaticSourceIndex<T>(state: any, fn: () => T): T {
  const battlefield = state?.battlefield;
  if (activeIndex || !Array.isArray(battlefield)) return fn();
  activeIndex = { battlefield, lists: new Map() };
  try {
    return fn();
  } finally {
    activeIndex = null;
  }
}

/**
 * Sources a batch's loop has to visit. Inside withLongTailStaticSourceIndex for this battlefield:
 * only the sources whose text one of the batch's parsers reacts to. Anywhere else: the whole
 * battlefield, exactly as before.
 */
export function longTailStaticSources(
  state: any,
  filter: LongTailStaticSourceFilter,
  lineOf: (source: any) => string,
): any[] {
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  if (!activeIndex || activeIndex.battlefield !== battlefield) return battlefield;
  let list = activeIndex.lists.get(filter.id);
  if (!list) {
    list = battlefield.filter((source) => source && !filter.isInertLine(lineOf(source)));
    activeIndex.lists.set(filter.id, list);
  }
  return list;
}
