/**
 * Delayed "when you next cast ... this turn" riders (rule 603.7): parsed from the resolving
 * spell, activated/loyalty ability or triggered ability text, stored on
 * state.delayedSpellCopiesThisTurn, and consumed by the next qualifying cast
 * (consumeDelayedSpellCopiesForCast).
 *
 * Entry kinds:
 *  - copy entries (one entry per copy): Galvanic Iteration, Doublecast, Complete the Circuit
 *    ("twice"), Storm King's Thunder ("X times"), Howl of the Horde raid ("an additional time"),
 *    Dual Strike ("with mana value N or less"), Loki ("less than or equal to ~'s power").
 *  - effect entries ("when you next cast a spell this turn, <effect>"): Ride the Avalanche;
 *    the effect is queued as a triggered ability when the spell is cast.
 */

import { resolveCommanderCastsFromCommandZoneThisGame } from '../../../../rules-engine/src/oracleIRExecutorCommanderCastCount.js';

export type NextCastSpellType = 'instant_or_sorcery' | 'instant' | 'any';

export interface NextCastEntry {
  controllerId: string;
  spellType: NextCastSpellType;
  sourceName: string;
  sourceId?: string;
  originId?: string;
  allowRetargeting: boolean;
  maxManaValue?: number;
  effect?: string;
}

export interface NextCastRiderOptions {
  controllerId: string;
  sourceName: string;
  sourceId?: string;
  /** Resolving stack item id; prevents registering the same rider twice for one resolution. */
  originId?: string;
  xValue?: number;
  attackedThisTurn?: boolean;
  sourcePower?: number;
  /** Thunderclap Drake: "copy it for each time you've cast your commander from the command zone this game". */
  commanderCastCount?: number;
}

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

const NEXT_CAST = /(?:^|[.:]\s*|\n)\s*((?:raid\s*(?:\u2014|--?)\s*)?if you attacked this turn,\s*|if you do,\s*)?when you next cast (an instant or sorcery spell|an instant spell|a spell)( with mana value (\d+|[a-z]+) or less| with mana value less than or equal to [^,]*?'s power)? this turn,\s*([^.]+)\.(\s*you may choose new targets for the cop(?:y|ies)\.)?/gi;

function copyCountOf(effect: string, opts: NextCastRiderOptions): number | null {
  const m = /^copy (?:that spell|it)(?: (twice|three times|x times|an additional time|for each time you've cast your commander from the command zone this game))?(?: and you may choose new targets for the cop(?:y|ies))?$/i.exec(effect.trim());
  if (!m) return null;
  const word = String(m[1] || '').toLowerCase();
  if (word === 'twice') return 2;
  if (word === 'three times') return 3;
  if (word === 'x times') return Math.max(0, Math.floor(Number(opts.xValue) || 0));
  if (word.startsWith('for each time')) return Math.max(0, Math.floor(Number(opts.commanderCastCount) || 0));
  return 1;
}

/** Parses every next-cast rider in the text into delayed entries (one per copy). */
export function buildNextCastEntries(text: string, opts: NextCastRiderOptions): NextCastEntry[] {
  const out: NextCastEntry[] = [];
  const source = String(text || '').replace(/\u2212/g, '-');
  NEXT_CAST.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NEXT_CAST.exec(source)) !== null) {
    const prefix = String(m[1] || '').toLowerCase();
    // "If you do" depends on an optional payment the caller has not modelled; leave it to the legacy prompt.
    if (/^if you do/.test(prefix)) continue;
    if (/attacked this turn/.test(prefix) && !opts.attackedThisTurn) continue;
    const kind = m[2].toLowerCase();
    const spellType: NextCastSpellType = kind === 'a spell' ? 'any' : kind === 'an instant spell' ? 'instant' : 'instant_or_sorcery';
    let maxManaValue: number | undefined;
    if (m[4]) maxManaValue = /^\d+$/.test(m[4]) ? Number(m[4]) : NUMBER_WORDS[m[4].toLowerCase()];
    else if (m[3] && /power/i.test(m[3])) maxManaValue = Math.max(0, Math.floor(Number(opts.sourcePower) || 0));
    const effect = m[5].trim();
    const base = {
      controllerId: opts.controllerId,
      spellType,
      sourceName: opts.sourceName,
      ...(opts.sourceId ? { sourceId: opts.sourceId } : {}),
      ...(opts.originId ? { originId: opts.originId } : {}),
      ...(maxManaValue !== undefined ? { maxManaValue } : {}),
    };
    const count = copyCountOf(effect, opts);
    if (count !== null) {
      const allowRetargeting = /choose new targets/i.test(effect + String(m[6] || ''));
      for (let i = 0; i < count; i++) out.push({ ...base, allowRetargeting });
    } else {
      out.push({ ...base, allowRetargeting: false, effect });
    }
  }
  return out;
}

/** Appends entries unless this resolution (originId) already registered them. Returns the number added. */
export function registerNextCastEntries(state: any, entries: readonly NextCastEntry[]): number {
  if (!state || entries.length === 0) return 0;
  const list: any[] = Array.isArray(state.delayedSpellCopiesThisTurn) ? state.delayedSpellCopiesThisTurn : [];
  state.delayedSpellCopiesThisTurn = list;
  const origin = entries[0]?.originId;
  if (origin && list.some((e: any) => e?.originId === origin)) return 0;
  list.push(...entries);
  return entries.length;
}

function manaValueOf(card: any): number {
  const n = Number(card?.cmc ?? card?.mana_value ?? card?.manaValue);
  return Number.isFinite(n) ? n : 0;
}

/** Whether a cast spell satisfies a delayed next-cast entry. */
export function delayedNextCastEntryMatches(entry: any, spellCard: any, casterId: string): boolean {
  if (!entry || String(entry?.controllerId || '') !== String(casterId || '')) return false;
  const typeLine = String(spellCard?.type_line || '').toLowerCase();
  const spellType = String(entry?.spellType || '').trim();
  let typeOk = false;
  if (spellType === 'instant_or_sorcery') typeOk = typeLine.includes('instant') || typeLine.includes('sorcery');
  else if (spellType === 'instant') typeOk = typeLine.includes('instant');
  else if (spellType === 'any') typeOk = true;
  if (!typeOk) return false;
  if (typeof entry?.maxManaValue === 'number' && manaValueOf(spellCard) > entry.maxManaValue) return false;
  return true;
}

/** Builds the triggered-ability stack item for an effect entry; "X ... where X is the mana value of that spell" is resolved now. */
export function buildNextCastEffectStackItem(entry: any, spellCard: any, casterId: string, triggeringStackItemId: string, id: string): any {
  const mv = manaValueOf(spellCard);
  let effect = String(entry?.effect || '').trim();
  if (/,?\s*where x is the mana value of that spell$/i.test(effect)) {
    effect = effect.replace(/,?\s*where x is the mana value of that spell$/i, '').replace(/\bX\b/g, String(mv));
  }
  return {
    id,
    type: 'triggered_ability',
    controller: casterId,
    source: String(entry?.sourceId || ''),
    sourceName: String(entry?.sourceName || 'Delayed trigger'),
    description: effect,
    effect,
    triggerType: 'next_cast_delayed',
    mandatory: !/^you may\b/i.test(effect),
    triggeringStackItemId,
    triggeringSpellManaValue: mv,
  };
}

/** Player-level "you attacked this turn" (raid). */
export function controllerAttackedThisTurn(state: any, controllerId: string): boolean {
  const c = String(controllerId || '');
  const flag = state?.attackedThisTurn?.[c];
  if (flag === true || (typeof flag === 'number' && flag > 0)) return true;
  if (Number(state?.creaturesAttackedThisTurn?.[c] || 0) > 0) return true;
  return (Array.isArray(state?.players) ? state.players : []).some((p: any) => String(p?.id || '') === c && p?.attackedThisTurn === true);
}

/** Parses and registers the next-cast riders in a resolving text; mirrors the list onto ctx. */
export function applyNextCastRiders(ctx: any, text: string, opts: Omit<NextCastRiderOptions, 'attackedThisTurn'> & { attackedThisTurn?: boolean }): number {
  const state = ctx?.state;
  if (!state || !/when you next cast/i.test(String(text || ''))) return 0;
  const entries = buildNextCastEntries(text, {
    ...opts,
    attackedThisTurn: opts.attackedThisTurn ?? controllerAttackedThisTurn(state, opts.controllerId),
    commanderCastCount: opts.commanderCastCount ?? (/cast your commander from the command zone/i.test(text)
      ? Number(resolveCommanderCastsFromCommandZoneThisGame(state, opts.controllerId)) || 0
      : 0),
  });
  const added = registerNextCastEntries(state, entries);
  if (added > 0) ctx.delayedSpellCopiesThisTurn = state.delayedSpellCopiesThisTurn;
  return added;
}
