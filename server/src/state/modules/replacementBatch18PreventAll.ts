// Batch 18: generic single-card "prevent all damage" lines (CR 615) that the older prevention templates miss.
//   "[during your turn, ]prevent all [combat |noncombat ]damage that would be dealt (to|to and dealt by) RECIPIENT
//    [by SOURCE-FILTER][ during your turn]" and "prevent all damage that ~ would deal to (snow|COLOR) creatures".
// Recipients: you, ~, you and [other] permanents/creatures you control, creatures, [other] attacking [TYPE]
//   creatures/SUBTYPEs you control, creature tokens you control, SUBTYPEs you control, creatures you control,
//   equipped creature, enchanted creature (filtered only).
// Filters: SUBTYPEs (deserts, walls), artifact sources, artifact creatures, enchanted creatures, creatures blocking
//   it, creatures with first strike, sources you [don't] control.
// Specs carry metadata.batch18PreventAll; matchesBatch18PreventAll evaluates it inside matchesDamagePreventionExtras.
// Public entry symbols: parseBatch18PreventAllSentence, matchesBatch18PreventAll, Batch18PreventAllMeta.

import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';

type SpecBody = Omit<ReplacementEffectSpec, 'id' | 'sourcePermanentId' | 'sourceController' | 'sourceName'>;

export interface B18PermFilter {
  self?: boolean; controlled?: boolean; other?: boolean; attacking?: boolean; token?: boolean;
  types?: string[]; subtypes?: string[]; supertypes?: string[]; colors?: string[]; equipped?: boolean; enchanted?: boolean;
}
export interface B18SourceFilter {
  subtypes?: string[]; types?: string[]; artifactSource?: boolean; isEnchanted?: boolean; blockingSelf?: boolean;
  firstStrike?: boolean; controlledBySourceController?: boolean;
}
export interface Batch18PreventAllMeta {
  toPlayer?: boolean;
  toPermanent?: B18PermFilter;
  dealtBy?: B18PermFilter;
  by?: B18SourceFilter;
}

const COLOR_LETTERS: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
const singular = (w: string): string => w.replace(/ies$/, 'y').replace(/s$/, '');

export function parseBatch18Recipient(raw: string): Pick<Batch18PreventAllMeta, 'toPlayer' | 'toPermanent'> | null {
  if (raw === 'you') return { toPlayer: true };
  if (raw === '~') return { toPermanent: { self: true } };
  if (raw === 'equipped creature') return { toPermanent: { equipped: true } };
  if (raw === 'enchanted creature') return { toPermanent: { enchanted: true } };
  if (raw === 'creatures') return { toPermanent: { types: ['creature'] } };
  let m = raw.match(/^you and (other )?(permanents|creatures) you control$/);
  if (m) return { toPlayer: true, toPermanent: { controlled: true, other: !!m[1], ...(m[2] === 'creatures' ? { types: ['creature'] } : {}) } };
  if (raw === 'creature tokens you control') return { toPermanent: { controlled: true, token: true, types: ['creature'] } };
  m = raw.match(/^(other )?(attacking )?((?:artifact )?creatures|[a-z]+) you control$/);
  if (m) {
    const word = m[3];
    const base: B18PermFilter = { controlled: true, other: !!m[1], attacking: !!m[2] };
    if (word === 'creatures') return { toPermanent: { ...base, types: ['creature'] } };
    if (word === 'artifact creatures') return { toPermanent: { ...base, types: ['artifact', 'creature'] } };
    if (['permanents', 'lands', 'tokens'].includes(word)) return null;
    return { toPermanent: { ...base, subtypes: [singular(word)] } };
  }
  return null;
}

function parseSourceFilter(raw: string): B18SourceFilter | null {
  if (raw === 'artifact sources') return { artifactSource: true };
  if (raw === 'artifact creatures') return { types: ['artifact', 'creature'] };
  if (raw === 'enchanted creatures') return { types: ['creature'], isEnchanted: true };
  if (raw === 'creatures blocking it') return { types: ['creature'], blockingSelf: true };
  if (raw === 'creatures with first strike') return { types: ['creature'], firstStrike: true };
  if (raw === 'sources you control') return { controlledBySourceController: true };
  if (raw === "sources you don't control") return { controlledBySourceController: false };
  if (/^[a-z]+s$/.test(raw) && !['creatures', 'sources', 'spells'].includes(raw)) return { subtypes: [singular(raw)] };
  return null;
}

export function batch18PreventAllSpec(id: string, meta: Batch18PreventAllMeta, combat: string | undefined, duringTurn: boolean): SpecBody {
  return {
    event: 'damage',
    match: {
      ...(combat === 'combat' ? { combatDamageOnly: true } : {}),
      ...(combat === 'noncombat' ? { noncombatDamageOnly: true } : {}),
      ...(duringTurn ? { duringSourceControllerTurn: true } : {}),
    },
    instead: { modify: 'cap', value: 0 },
    effectId: id,
    reason: 'batch18_prevent_all',
    metadata: { batch18PreventAll: meta },
  };
}

export function parseBatch18PreventAllSentence(sentence: string): SpecBody[] {
  let s = sentence;
  let duringTurn = false;
  if (s.startsWith('during your turn, ')) { duringTurn = true; s = s.slice('during your turn, '.length); }
  if (s.endsWith(' during your turn')) { duringTurn = true; s = s.slice(0, -' during your turn'.length); }
  const src = s.match(/^prevent all damage that ~ would deal to (snow|white|blue|black|red|green) creatures$/);
  if (src) {
    const to: B18PermFilter = src[1] === 'snow' ? { types: ['creature'], supertypes: ['snow'] } : { types: ['creature'], colors: [COLOR_LETTERS[src[1]]] };
    return [batch18PreventAllSpec(`b18-prevent-self-damage-to-${src[1]}-creatures`, { dealtBy: { self: true }, toPermanent: to }, undefined, duringTurn)];
  }
  const m = s.match(/^prevent all (?:(combat|noncombat) )?damage that would be dealt (to and dealt by|to) (.+?)(?: by (.+))?$/);
  if (!m) return [];
  const [, combat, mode, recipRaw, byRaw] = m;
  const recip = parseBatch18Recipient(recipRaw);
  if (!recip) return [];
  const by = byRaw ? parseSourceFilter(byRaw) : undefined;
  if (byRaw && !by) return [];
  if (!by && !duringTurn && !combat && (recipRaw === 'you' || recipRaw === '~')) return []; // older templates own these
  const slug = `${combat || 'all'}-${recipRaw}${byRaw ? '-by-' + byRaw : ''}`.replace(/[^a-z0-9~]+/g, '-').replace(/~/g, 'self');
  const out = [batch18PreventAllSpec(`b18-prevent-${slug}`, { ...recip, ...(by ? { by } : {}) }, combat, duringTurn)];
  if (mode === 'to and dealt by' && !by) {
    const dealer = recip.toPermanent;
    if (!dealer || recip.toPlayer) return [];
    out.push(batch18PreventAllSpec(`b18-prevent-by-${slug}`, { dealtBy: dealer }, combat, duringTurn));
  }
  return out;
}

// ---- matching ----

interface B18Perm {
  id?: string; controller?: string; attachedTo?: string; attacking?: unknown; isAttacking?: boolean; isToken?: boolean;
  blocking?: unknown[]; type_line?: string; colors?: string[]; keywords?: string[];
  card?: { type_line?: string; colors?: string[]; keywords?: string[]; oracle_text?: string };
}
interface B18State { battlefield?: B18Perm[] }

function typeLine(p: B18Perm): string { return String(p.card?.type_line || p.type_line || '').toLowerCase(); }
function hasWord(line: string, w: string): boolean { return new RegExp(`\\b${w}s?\\b`).test(line); }
function colorsOf(p: B18Perm): string[] { return (p.colors || p.card?.colors || []).map((c) => String(c).toUpperCase()); }

function permMatches(f: B18PermFilter, p: B18Perm | undefined, ctx: { sourceId: string; controller: string; bf: B18Perm[] }): boolean {
  if (!p) return false;
  const id = String(p.id || '');
  const tl = typeLine(p);
  if (f.self && id !== ctx.sourceId) return false;
  if (f.other && id === ctx.sourceId) return false;
  if (f.controlled && String(p.controller || '') !== ctx.controller) return false;
  if (f.attacking && !(p.isAttacking === true || (p.attacking != null && p.attacking !== false && p.attacking !== ''))) return false;
  if (f.token && !(p.isToken === true || tl.includes('token'))) return false;
  for (const t of [...(f.types || []), ...(f.subtypes || []), ...(f.supertypes || [])]) if (!hasWord(tl, t)) return false;
  for (const c of f.colors || []) if (!colorsOf(p).includes(c)) return false;
  if (f.equipped || f.enchanted) {
    const holder = ctx.bf.find((x) => String(x.id || '') === ctx.sourceId);
    if (!holder || String(holder.attachedTo || '') !== id) return false;
  }
  return true;
}

function sourceMatches(f: B18SourceFilter, dmg: B18Perm | undefined, dealer: string, ctx: { sourceId: string; controller: string; bf: B18Perm[] }): boolean {
  if (typeof f.controlledBySourceController === 'boolean') {
    const ctl = dmg ? String(dmg.controller || '') : dealer;
    if (!ctl || (ctl === ctx.controller) !== f.controlledBySourceController) return false;
    if (Object.keys(f).length === 1) return true;
  }
  if (!dmg) return false;
  const tl = typeLine(dmg);
  for (const t of [...(f.types || []), ...(f.subtypes || [])]) if (!hasWord(tl, t)) return false;
  if (f.artifactSource && !hasWord(tl, 'artifact')) return false;
  if (f.firstStrike) {
    const kws = (dmg.keywords || dmg.card?.keywords || []).map((k) => String(k).toLowerCase());
    if (!kws.includes('first strike') && !/\bfirst strike\b/i.test(String(dmg.card?.oracle_text || ''))) return false;
  }
  if (f.blockingSelf && !(dmg.blocking || []).map(String).includes(ctx.sourceId)) return false;
  if (f.isEnchanted && !ctx.bf.some((x) => String(x.attachedTo || '') === String(dmg.id || '') && hasWord(typeLine(x), 'aura'))) return false;
  return true;
}

/** True when the spec has no Batch 18 metadata or the damage event matches it. */
export function matchesBatch18PreventAll(
  spec: ReplacementEffectSpec,
  input: { damageDealer: string; damageReceiver: string; damageSourcePermanentId?: string; targetPermanentId?: string },
  state?: unknown,
): boolean {
  const meta = (spec.metadata as { batch18PreventAll?: Batch18PreventAllMeta } | undefined)?.batch18PreventAll;
  if (!meta) return true;
  const bf = Array.isArray((state as B18State | undefined)?.battlefield) ? (state as B18State).battlefield! : [];
  const ctx = { sourceId: String(spec.sourcePermanentId || '').trim(), controller: String(spec.sourceController || ''), bf };
  const find = (id?: string) => { const k = String(id || '').trim(); return k ? bf.find((p) => String(p?.id || '') === k) : undefined; };
  const targetId = String(input.targetPermanentId || '').trim();
  const dmg = find(input.damageSourcePermanentId);
  if (meta.dealtBy && !permMatches(meta.dealtBy, dmg, ctx)) return false;
  if (meta.toPlayer || meta.toPermanent) {
    const okPlayer = !!meta.toPlayer && !targetId && String(input.damageReceiver || '') === ctx.controller;
    const okPerm = !!meta.toPermanent && !!targetId && permMatches(meta.toPermanent, find(targetId), ctx);
    if (!okPlayer && !okPerm) return false;
  }
  if (meta.by && !sourceMatches(meta.by, dmg, String(input.damageDealer || ''), ctx)) return false;
  return true;
}