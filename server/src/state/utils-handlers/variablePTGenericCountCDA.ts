// server/src/state/utils-handlers/variablePTGenericCountCDA.ts
// Generic "~'s power and toughness are each equal to [N plus] [twice] the number of X" CDAs, where X is one of
// a small grammar of counted things (counters on it, permanents you/opponents control, named creatures,
// graveyard cards) or "the total mana value of other creatures you control".
// Examples: Tidewalker, Rusting Golem, Mwonvuli Ooze, Plague Rats, Regal Bunnicorn, Keldon Warlord,
// Gaea's Avenger, Fungal Behemoth, Detritivore, Ancient Ooze.
// Public entry symbols: parseGenericCountCDA, calculateGenericCountCDA.

import { landAwareTypeLine } from '../modules/effectiveLandTypeLine.js';
import { countDifferentlyNamedLands, countFederationCreatureTypes } from '../../../../rules-engine/src/trekCountBases.js';

export type GenericCountCDA = {
  base: number;
  multiplier: number;
  measure: 'count' | 'mana_value';
  subject:
    | { kind: 'self_counters'; counter: string }
    | { kind: 'counters_on_your_creatures'; counter: string }
    | { kind: 'permanents'; who: 'you' | 'opponents' | 'all'; filter: string; other: boolean }
    | { kind: 'named_self' }
    | { kind: 'opponent_graveyard_cards'; filter: string }
    | { kind: 'graveyard_cards'; who: 'you' | 'all'; filter: string }
    | { kind: 'exiled_with_self' }
  | { kind: 'differently_named_lands' }
  | { kind: 'federation_types' }
    | { kind: 'sum'; parts: GenericCountCDA[] };
};

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const PERMANENT_FILTERS = new Set(['nonland permanents', 'permanents', 'creatures', 'non-wall creatures', 'artifacts', 'enchantments', 'lands', 'nonbasic lands', 'planeswalkers']);

/** Plain type / subtype words joined by and / or ("zombies", "soldiers and warriors", "forests"). */
function isGenericTypeFilter(filter: string): boolean {
  return /^[a-z]+(?: (?:and|or|and\/or) [a-z]+)*$/.test(filter) && !/\b(?:cards?|other|the|chosen)\b/.test(filter);
}

function genericTypeWords(filter: string): string[] {
  return filter.split(/ (?:and\/or|and|or) /).flatMap((w) => [w, w.replace(/s$/, ''), w.replace(/es$/, ''), w.replace(/ies$/, 'y'), w.replace(/ves$/, 'f')]);
}

function num(raw: string | undefined): number {
  if (!raw) return 0;
  return /^\d+$/.test(raw) ? Number(raw) : (WORDS[raw] ?? NaN);
}

/** Parses the clause after "each equal to" (name already replaced by ~, lowercased, no trailing period). */
export function parseGenericCountCDA(clause: string): GenericCountCDA | null {
  const c = String(clause || '').trim().replace(/\u2019/g, "'").replace(/\.$/, '');
  const plusAt = c.indexOf(' plus the number of ', c.indexOf('the number of ') + 1);
  if (plusAt > 0) {
    const left = parseGenericCountCDA(c.slice(0, plusAt));
    const right = parseGenericCountCDA(c.slice(plusAt + ' plus '.length));
    if (!left || !right) return null;
    return { base: 0, multiplier: 1, measure: 'count', subject: { kind: 'sum', parts: [left, right] } };
  }
  const m = /^(?:(\d+|one|two|three|four|five|six|seven|eight|nine|ten) plus )?(twice )?the (number|total mana value) of (.+)$/.exec(c);
  if (!m) return null;
  const base = num(m[1]);
  if (!Number.isFinite(base)) return null;
  const multiplier = m[2] ? 2 : 1;
  const measure = m[3] === 'number' ? 'count' : 'mana_value';
  const rest = m[4];
  let r: RegExpExecArray | null;
  if (measure === 'mana_value') {
    if (rest === 'other creatures you control') return { base, multiplier, measure, subject: { kind: 'permanents', who: 'you', filter: 'creatures', other: true } };
    return null;
  }
  if ((r = /^([a-z+\-/0-9]+) counters on (?:it|~)$/.exec(rest))) return { base, multiplier, measure, subject: { kind: 'self_counters', counter: r[1] } };
  if ((r = /^([+\-]1\/[+\-]1) counters on creatures you control$/.exec(rest))) return { base, multiplier, measure, subject: { kind: 'counters_on_your_creatures', counter: r[1] } };
  if (rest === 'differently named lands you control') return { base, multiplier, measure, subject: { kind: 'differently_named_lands' } };
  if (rest === 'creature types among non-borg creatures you control') return { base, multiplier, measure, subject: { kind: 'federation_types' } };
  if (rest === 'cards exiled with it' || rest === 'cards exiled with ~') return { base, multiplier, measure, subject: { kind: 'exiled_with_self' } };
  if ((r = /^([a-z]+) cards in (all graveyards|your graveyard)$/.exec(rest)) && isGenericTypeFilter(r[1])) return { base, multiplier, measure, subject: { kind: 'graveyard_cards', who: r[2] === 'your graveyard' ? 'you' : 'all', filter: r[1] } };
  if (rest === 'creatures named ~ on the battlefield') return { base, multiplier, measure, subject: { kind: 'named_self' } };
  if ((r = /^(nonbasic land|creature|land|artifact) cards in your opponents' graveyards$/.exec(rest))) return { base, multiplier, measure, subject: { kind: 'opponent_graveyard_cards', filter: r[1] } };
  if ((r = /^(other )?([a-z\- ]+?) (you control|your opponents control|on the battlefield)$/.exec(rest)) && (PERMANENT_FILTERS.has(r[2]) || isGenericTypeFilter(r[2]))) {
    const who = r[3] === 'you control' ? 'you' : r[3] === 'your opponents control' ? 'opponents' : 'all';
    return { base, multiplier, measure, subject: { kind: 'permanents', who, filter: r[2], other: !!r[1] } };
  }
  return null;
}

function typeLine(card: any): string {
  return String(card?.type_line || '').toLowerCase();
}

function matchesFilter(card: any, filter: string, typeLineOverride?: string): boolean {
  const t = typeLineOverride ?? typeLine(card);
  switch (filter) {
    case 'permanents': return true;
    case 'nonland permanents': return !/\bland\b/.test(t);
    case 'creatures': return /\bcreature\b/.test(t);
    case 'non-wall creatures': return /\bcreature\b/.test(t) && !/\bwall\b/.test(t);
    case 'artifacts': case 'artifact': return /\bartifact\b/.test(t);
    case 'enchantments': return /\benchantment\b/.test(t);
    case 'lands': case 'land': return /\bland\b/.test(t);
    case 'nonbasic lands': case 'nonbasic land': return /\bland\b/.test(t) && !/\bbasic\b/.test(t);
    case 'planeswalkers': return /\bplaneswalker\b/.test(t);
    case 'creature': return /\bcreature\b/.test(t);
    default: return isGenericTypeFilter(filter) && genericTypeWords(filter).some((w) => w.length > 1 && new RegExp(`\\b${w}\\b`).test(t));
  }
}

function manaValue(card: any): number {
  const n = Number(card?.cmc ?? card?.mana_value ?? card?.manaValue);
  return Number.isFinite(n) ? n : 0;
}

/** Computes the CDA for a card whose oracle contains a supported clause; undefined otherwise. */
export function calculateGenericCountCDA(card: any, oracleLower: string, battlefield: any[], gameState: any, controllerId: string): { power: number; toughness: number } | undefined {
  const name = String(card?.name || '').split(' // ')[0].trim().toLowerCase();
  let text = String(oracleLower || '').replace(/\u2019/g, "'");
  if (name) text = text.split(name).join('~');
  const m = /(?:^|\n)(?:[a-z' ]+ [\u2014-] )?(?:~|this creature)'s power and toughness are each equal to ([^.\n]+)\./.exec(text);
  if (!m) return undefined;
  const spec = parseGenericCountCDA(m[1]);
  if (!spec) return undefined;
  const self = battlefield.find((p: any) => p?.card === card || (card?.id && (p?.card?.id === card.id || p?.id === card.id)));
  const total = evaluateGenericCountCDA(spec, self, name, battlefield, gameState, controllerId);
  return { power: total, toughness: total };
}

function evaluateGenericCountCDA(spec: GenericCountCDA, self: any, name: string, battlefield: any[], gameState: any, controllerId: string): number {
  const s = spec.subject;
  let value = 0;
  if (s.kind === 'self_counters') {
    value = Number(self?.counters?.[s.counter] ?? 0) || 0;
  } else if (s.kind === 'counters_on_your_creatures') {
    for (const p of battlefield) if (String(p?.controller) === String(controllerId) && matchesFilter(p?.card, 'creatures')) value += Number(p?.counters?.[s.counter] ?? 0) || 0;
  } else if (s.kind === 'named_self') {
    value = battlefield.filter((p: any) => matchesFilter(p?.card, 'creatures') && String(p?.card?.name || '').split(' // ')[0].trim().toLowerCase() === name).length;
  } else if (s.kind === 'sum') {
    value = s.parts.reduce((acc, part) => acc + evaluateGenericCountCDA(part, self, name, battlefield, gameState, controllerId), 0);
  } else if (s.kind === 'differently_named_lands') {
    value = countDifferentlyNamedLands(battlefield, controllerId);
  } else if (s.kind === 'federation_types') {
    value = countFederationCreatureTypes(battlefield, controllerId);
  } else if (s.kind === 'exiled_with_self') {
    const selfId = String(self?.id || '');
    const pool: any[] = [...(Array.isArray(self?.exiledCards) ? self.exiledCards : [])];
    for (const zone of Object.values<any>(gameState?.zones || {})) if (Array.isArray(zone?.exile)) pool.push(...zone.exile);
    const seen = new Set<any>();
    for (const c of pool) {
      const linked = String(c?.exiledWithSourceId || c?.card?.exiledWithSourceId || c?.exiledWith || '');
      const key = c?.id || c;
      if (selfId && linked === selfId && !seen.has(key)) { seen.add(key); value++; }
    }
  } else if (s.kind === 'graveyard_cards') {
    for (const [pid, zone] of Object.entries<any>(gameState?.zones || {})) {
      if (s.who === 'you' && String(pid) !== String(controllerId)) continue;
      value += (Array.isArray(zone?.graveyard) ? zone.graveyard : []).filter((c: any) => matchesFilter(c, s.filter)).length;
    }
  } else if (s.kind === 'opponent_graveyard_cards') {
    for (const [pid, zone] of Object.entries<any>(gameState?.zones || {})) {
      if (String(pid) === String(controllerId)) continue;
      value += (Array.isArray(zone?.graveyard) ? zone.graveyard : []).filter((c: any) => matchesFilter(c, s.filter)).length;
    }
  } else {
    for (const p of battlefield) {
      if (!p?.card) continue;
      const ctl = String(p.controller);
      if (s.who === 'you' && ctl !== String(controllerId)) continue;
      if (s.who === 'opponents' && ctl === String(controllerId)) continue;
      if (s.other && self && p === self) continue;
      if (!matchesFilter(p.card, s.filter, landAwareTypeLine(gameState, p))) continue;
      value += spec.measure === 'mana_value' ? manaValue(p.card) : 1;
    }
  }
  return spec.base + spec.multiplier * value;
}
