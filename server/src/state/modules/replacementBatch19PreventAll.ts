// Batch 19: prevent-all lines the Batch 18 parser leaves alone (CR 615).
//  - "as long as COND, prevent all ..." conditions: full party (Multiclass Baldric), a permanent of each color
//    (Spirit of Resistance), another creature (Bronze Horse), ~ has a COUNTER counter (Woolly Razorback),
//    a/an [artifact ]creature you control is attacking.
//  - "prevent all combat damage ~/it would deal" (Woolly Razorback).
//  - By-filters: "by sources with the chosen name" (Gideon's Intervention), "by sources of the [last ]chosen color"
//    (Chromatic Armor, Prismatic Ward), "by spells that target it" (Bronze Horse),
//    "prevent all damage that would be dealt by instant and sorcery spells" (Energy Storm).
// Specs reuse metadata.batch18PreventAll for the recipient and add metadata.batch19PreventAll for the rest.
// Spell sources are found on the stack (id / card id) or as an instant/sorcery card in any zone.
// Public entry symbols: parseBatch19PreventAllSentence, matchesBatch19PreventAll, Batch19PreventAllMeta.

import { getResolvingSpellSource } from './replacementResolvingSpellSource.js';
import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { batch18PreventAllSpec, parseBatch18Recipient, type Batch18PreventAllMeta } from './replacementBatch18PreventAll.js';

type SpecBody = Omit<ReplacementEffectSpec, 'id' | 'sourcePermanentId' | 'sourceController' | 'sourceName'>;

export type B19Condition =
  | { kind: 'full_party' }
  | { kind: 'each_color' }
  | { kind: 'another_creature' }
  | { kind: 'self_counter'; counter: string }
  | { kind: 'controlled_attacking'; types: string[] };
export type B19By = 'chosen_name' | 'chosen_color' | 'spells_targeting_it' | 'instant_sorcery_spells';
export interface Batch19PreventAllMeta { condition?: B19Condition; by?: B19By }

function parseCondition(raw: string): B19Condition | null {
  if (raw === 'you have a full party') return { kind: 'full_party' };
  if (raw === 'you control a permanent of each color') return { kind: 'each_color' };
  if (raw === 'you control another creature') return { kind: 'another_creature' };
  let m = raw.match(/^~ has (?:a|an|one or more) ([a-z+/0-9-]+) counters? on it$/);
  if (m) return { kind: 'self_counter', counter: m[1] };
  m = raw.match(/^(?:a|an) (artifact )?creature you control is attacking$/);
  if (m) return { kind: 'controlled_attacking', types: m[1] ? ['artifact', 'creature'] : ['creature'] };
  return null;
}

const BY: Record<string, B19By> = {
  'sources with the chosen name': 'chosen_name',
  'sources of the chosen color': 'chosen_color',
  'sources of the last chosen color': 'chosen_color',
  'spells that target it': 'spells_targeting_it',
};

function body(id: string, b18: Batch18PreventAllMeta, b19: Batch19PreventAllMeta, combat?: string): SpecBody {
  const base = batch18PreventAllSpec(id, b18, combat, false);
  return { ...base, reason: 'batch19_prevent_all', metadata: { ...(base.metadata || {}), batch19PreventAll: b19 } };
}

export function parseBatch19PreventAllSentence(sentence: string): SpecBody[] {
  let s = sentence;
  let condition: B19Condition | undefined;
  const cm = s.match(/^as long as (.+?), (prevent all .+)$/);
  if (cm) {
    const c = parseCondition(cm[1]);
    if (!c) return [];
    condition = c;
    s = cm[2];
  }
  const tag = condition ? `-if-${condition.kind}` : '';
  if (s === 'prevent all damage that would be dealt by instant and sorcery spells') {
    return [body(`b19-prevent-instant-sorcery-spell-damage${tag}`, {}, { condition, by: 'instant_sorcery_spells' })];
  }
  const own = s.match(/^prevent all (combat )?damage (?:~|it) would deal(?: and it has [a-z ]+)?$/);
  if (own) {
    return [body(`b19-prevent-self-${own[1] ? 'combat-' : ''}damage-dealt${tag}`, { dealtBy: { self: true } }, { condition }, own[1] ? 'combat' : undefined)];
  }
  const m = s.match(/^prevent all (?:(combat|noncombat) )?damage that would be dealt to (.+?)(?: by (.+))?$/);
  if (!m) return [];
  const [, combat, recipRaw, byRaw] = m;
  const by = byRaw ? BY[byRaw] : undefined;
  if (byRaw && !by) return [];
  if (!by && !condition) return []; // Batch 18 / older templates own unconditional, unfiltered lines
  const recip = recipRaw === 'you and permanents you control'
    ? { toPlayer: true, toPermanent: { controlled: true } }
    : parseBatch18Recipient(recipRaw);
  if (!recip) return [];
  const slug = `${combat || 'all'}-${recipRaw}${byRaw ? '-by-' + byRaw : ''}`.replace(/[^a-z0-9~]+/g, '-').replace(/~/g, 'self');
  return [body(`b19-prevent-${slug}${tag}`, recip, { condition, by }, combat)];
}

// ---- matching ----

interface B19Card { id?: string; name?: string; type_line?: string; colors?: string[] }
interface B19Perm extends B19Card {
  controller?: string; phasedOut?: boolean; attacking?: unknown; isAttacking?: boolean; counters?: Record<string, number>;
  chosenCardName?: string; chosenName?: string; chosenColor?: string; card?: B19Card;
}
interface B19StackItem { id?: string; card?: B19Card; targets?: unknown[] }
interface B19State { battlefield?: B19Perm[]; stack?: B19StackItem[]; zones?: Record<string, Record<string, unknown>> }

const COLOR_LETTER: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G', w: 'W', u: 'U', b: 'B', r: 'R', g: 'G' };
const letter = (c: unknown): string => COLOR_LETTER[String(c || '').trim().toLowerCase()] || '';
const tl = (c?: B19Card): string => String(c?.type_line || '').toLowerCase();
const permTl = (p: B19Perm): string => tl(p.card) || tl(p);
const permColors = (p: B19Perm): string[] => (p.colors || p.card?.colors || []).map(letter).filter(Boolean);
const norm = (s: unknown): string => String(s || '').trim().toLowerCase();
const isAttacking = (p: B19Perm): boolean => p.isAttacking === true || (p.attacking != null && p.attacking !== false && p.attacking !== '');

function fullParty(perms: B19Perm[]): boolean {
  const roles = ['cleric', 'rogue', 'warrior', 'wizard'];
  const cands = perms.filter((p) => /\bcreature\b/.test(permTl(p))).map((p) => roles.filter((r) => new RegExp(`\\b${r}\\b`).test(permTl(p))));
  const used = new Set<number>();
  const assign = (ri: number): boolean => {
    if (ri === roles.length) return true;
    for (let i = 0; i < cands.length; i++) {
      if (used.has(i) || !cands[i].includes(roles[ri])) continue;
      used.add(i);
      if (assign(ri + 1)) return true;
      used.delete(i);
    }
    return false;
  };
  return assign(0);
}

function conditionHolds(c: B19Condition, src: B19Perm | undefined, controller: string, bf: B19Perm[]): boolean {
  const mine = bf.filter((p) => p && p.phasedOut !== true && String(p.controller || '') === controller);
  switch (c.kind) {
    case 'full_party': return fullParty(mine);
    case 'each_color': return ['W', 'U', 'B', 'R', 'G'].every((col) => mine.some((p) => permColors(p).includes(col)));
    case 'another_creature': return mine.some((p) => String(p.id || '') !== String(src?.id || '') && /\bcreature\b/.test(permTl(p)));
    case 'self_counter': return Number(src?.counters?.[c.counter] || 0) > 0;
    case 'controlled_attacking': return mine.some((p) => isAttacking(p) && c.types.every((t) => new RegExp(`\\b${t}\\b`).test(permTl(p))));
  }
}

/** Damage source as a card: battlefield permanent, stack spell, or a card in any zone (spells already resolved). */
function findSourceCard(state: B19State, id: string): { card?: B19Card; perm?: B19Perm; stack?: B19StackItem } {
  if (!id) return {};
  const perm = (state.battlefield || []).find((p) => String(p?.id || '') === id);
  if (perm) return { card: perm.card || perm, perm };
  const stack = (state.stack || []).find((s) => String(s?.id || '') === id || String(s?.card?.id || '') === id);
  if (stack) return { card: stack.card, stack };
  for (const zones of Object.values(state.zones || {})) {
    for (const zone of Object.values(zones || {})) {
      if (!Array.isArray(zone)) continue;
      const hit: unknown = zone.find((c: unknown) => c && typeof c === 'object' && String(Reflect.get(c, 'id') || '') === id);
      if (hit && typeof hit === 'object') return { card: hit };
    }
  }
  return {};
}

const isSpellCard = (c?: B19Card): boolean => /\b(?:instant|sorcery)\b/.test(tl(c));

/** True when the spec has no Batch 19 metadata or the damage event matches it. */
export function matchesBatch19PreventAll(
  spec: ReplacementEffectSpec,
  input: { damageDealer: string; damageReceiver: string; damageSourcePermanentId?: string; targetPermanentId?: string },
  state?: unknown,
): boolean {
  const meta = (spec.metadata as { batch19PreventAll?: Batch19PreventAllMeta } | undefined)?.batch19PreventAll;
  if (!meta) return true;
  const st: B19State = state && typeof state === 'object' ? state : {};
  const bf = Array.isArray(st.battlefield) ? st.battlefield : [];
  const srcId = String(spec.sourcePermanentId || '').trim();
  const self = bf.find((p) => String(p?.id || '') === srcId);
  if (meta.condition && !conditionHolds(meta.condition, self, String(spec.sourceController || ''), bf)) return false;
  if (!meta.by) return true;
  const dmgId = String(input.damageSourcePermanentId || '').trim();
  const resolving = getResolvingSpellSource(st, dmgId);
  const dmg = resolving ? { card: resolving.card, perm: undefined, stack: undefined } : findSourceCard(st, dmgId);
  switch (meta.by) {
    case 'chosen_name': {
      const chosen = norm(self?.chosenCardName || self?.chosenName);
      return !!chosen && norm(dmg.card?.name) === chosen;
    }
    case 'chosen_color': {
      const chosen = letter(self?.chosenColor);
      const cols = dmg.perm ? permColors(dmg.perm) : (dmg.card?.colors || []).map(letter);
      return !!chosen && cols.includes(chosen);
    }
    case 'instant_sorcery_spells':
      return !dmg.perm && isSpellCard(dmg.card);
    case 'spells_targeting_it': {
      if (dmg.perm || !dmg.card) return false;
      const targets = resolving ? resolving.targets : (dmg.stack?.targets || []).map((t) => (t && typeof t === 'object' ? String(Reflect.get(t, 'id') || '') : String(t || '')));
      return targets.includes(srcId) && String(input.targetPermanentId || '') === srcId;
    }
  }
}