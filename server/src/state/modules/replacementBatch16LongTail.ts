// Batch 16: replacement-effect long tail that does not fit an existing template table.
//  - noncombat "+N" / double damage to an opponent or a permanent an opponent controls (Tomik, Artist's Talent, Solphim)
//    -> BATCH16_DAMAGE_TEMPLATES, appended to ORACLE_DAMAGE_REPLACEMENT_TEMPLATES' collect loop.
//  - "If a player would begin an extra turn, that player skips that turn instead" (Gerrard's Hourglass Pendant,
//    Ugin's Nexus) -> dropSkippedExtraTurns, called from nextTurn before an extra turn is taken.
//  - "If ~ would be destroyed, regenerate it" (Knight/Clergy of the Holy Nimbus, Mossbridge Troll)
//    -> tryStaticRegenerateInsteadOfDestroy, called from destroyPermanent and the lethal-damage SBA.
// Public entry symbols: BATCH16_DAMAGE_TEMPLATES, extraTurnSkipSourceName, dropSkippedExtraTurns,
//   hasStaticRegenerateInsteadOfDestroy, tryStaticRegenerateInsteadOfDestroy.
// Leaf: must not import replacementEffectSpec.ts or replacementEffectSpec-handlers/index.ts.

import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { debug } from '../../utils/debug.js';
import { dropOpponentSkippedExtraTurns } from './replacementBatch18ExtraTurnSkip.js';

export interface Batch16DamageTemplate {
  templateId: string;
  oracleMustIncludeAll: readonly string[];
  spec: Omit<ReplacementEffectSpec, 'id' | 'sourcePermanentId' | 'sourceController' | 'sourceName'>;
}

const NONCOMBAT_TO_OPP = 'if a source you control would deal noncombat damage to an opponent or a permanent an opponent controls';
const noncombatMatch = {
  dealingPlayerIsSourceController: true,
  receivingPlayerIsOpponentOfSource: true,
  noncombatDamageOnly: true,
} as const;

export const BATCH16_DAMAGE_TEMPLATES: readonly Batch16DamageTemplate[] = [
  ...[1, 2, 3].map((n) => ({
    // Tomik, Izzet Sparkmage (+1) / Artist's Talent level 3 (+2)
    templateId: `noncombat-damage-to-opponent-plus-${n}`,
    oracleMustIncludeAll: [NONCOMBAT_TO_OPP, `that much damage plus ${n} instead`],
    spec: {
      event: 'damage' as const,
      match: { ...noncombatMatch },
      instead: { modify: 'add_flat' as const, value: n },
      effectId: `noncombat-damage-to-opponent-plus-${n}`,
      reason: `noncombat_damage_to_opponent_plus_${n}`,
    },
  })),
  {
    // Solphim, Mayhem Dominus
    templateId: 'noncombat-damage-to-opponent-double',
    oracleMustIncludeAll: [NONCOMBAT_TO_OPP, 'deals double that damage'],
    spec: {
      event: 'damage',
      match: { ...noncombatMatch },
      instead: { modify: 'double' },
      effectId: 'noncombat-damage-to-opponent-double',
      reason: 'noncombat_damage_to_opponent_double',
    },
  },
];

function oracleOf(perm: any): string {
  return String(perm?.card?.oracle_text || perm?.oracle_text || '').toLowerCase().replace(/[\u2019]/g, "'");
}

function liveBattlefield(state: any): any[] {
  const bf = Array.isArray(state?.battlefield) ? state.battlefield : [];
  return bf.filter((p: any) => p && p.phasedOut !== true);
}

const SKIP_EXTRA_TURN_RE = /if a player would begin an extra turn, that player skips that turn instead/;

/** Name of the first permanent whose replacement skips extra turns, or null. */
export function extraTurnSkipSourceName(state: any): string | null {
  const src = liveBattlefield(state).find((p) => SKIP_EXTRA_TURN_RE.test(oracleOf(p)));
  return src ? String(src.card?.name || 'Unknown') : null;
}

/**
 * Removes every pending extra turn while a skip replacement is on the battlefield (each one would begin
 * and be skipped in turn). Records them on state.skippedExtraTurns for the log/UI. Returns the count removed.
 */
export function dropSkippedExtraTurns(state: any, extraTurns: any[]): number {
  if (!Array.isArray(extraTurns) || extraTurns.length === 0) return 0;
  const source = extraTurnSkipSourceName(state);
  if (!source) return dropOpponentSkippedExtraTurns(state, extraTurns);
  const removed = extraTurns.splice(0, extraTurns.length);
  state.skippedExtraTurns = Array.isArray(state.skippedExtraTurns) ? state.skippedExtraTurns : [];
  for (const t of removed) {
    state.skippedExtraTurns.push({ playerId: String(t?.playerId || ''), sourceName: source, timestamp: Date.now() });
  }
  debug(2, `[extraTurnSkip] ${source}: skipped ${removed.length} extra turn(s)`);
  return removed.length;
}

const REGEN_INSTEAD_RE = /if (?:~|this creature|this permanent|it) would be destroyed, regenerate it\b/;

function regenSentences(perm: any): string {
  const name = String(perm?.card?.name || '').toLowerCase();
  let o = oracleOf(perm);
  if (name) o = o.split(name).join('~');
  return o;
}

function cantBeRegenerated(perm: any): boolean {
  if (perm?.cantBeRegenerated === true || perm?.cantRegenerate === true || perm?.cantBeRegeneratedThisTurn === true) return true;
  const temps = Array.isArray(perm?.temporaryEffects) ? perm.temporaryEffects : [];
  return temps.some((e: any) => /can(?:'|\u2019|no)t be regenerated/i.test(String(e?.description || '')));
}

export function hasStaticRegenerateInsteadOfDestroy(perm: any): boolean {
  return !!perm && REGEN_INSTEAD_RE.test(regenSentences(perm)) && !cantBeRegenerated(perm);
}

function hasLethalDamageMarked(perm: any): boolean {
  const counters = perm?.counters && typeof perm.counters === 'object' ? perm.counters : {};
  return Number(perm?.markedDamage) > 0 || Number(perm?.damage) > 0 || Number(perm?.damageMarked) > 0
    || Number(counters.damage) > 0 || perm?.deathtouchDamageMarked === true;
}

/**
 * CR 701.19: "If ~ would be destroyed, regenerate it." Taps the permanent, removes all damage and removes it
 * from combat instead of destroying it. `lethalDamageOnly` is for the SBA path, where a 0-toughness death
 * (no damage marked) is not a destruction and must not be replaced.
 */
export function tryStaticRegenerateInsteadOfDestroy(
  state: any,
  permanentId: string,
  opts: { lethalDamageOnly?: boolean } = {},
): boolean {
  const id = String(permanentId || '').trim();
  const perm = liveBattlefield(state).find((p) => String(p.id || '') === id);
  if (!perm || !hasStaticRegenerateInsteadOfDestroy(perm)) return false;
  if (opts.lethalDamageOnly && !hasLethalDamageMarked(perm)) return false;
  perm.tapped = true;
  perm.damage = 0;
  perm.markedDamage = 0;
  perm.damageMarked = 0;
  perm.deathtouchDamageMarked = false;
  if (perm.counters && typeof perm.counters === 'object' && 'damage' in perm.counters) delete perm.counters.damage;
  perm.attacking = undefined;
  perm.attackingPlayerId = undefined;
  perm.defendingPlayerId = undefined;
  if (Array.isArray(perm.blocking)) perm.blocking = [];
  if (Array.isArray(perm.blockedBy)) perm.blockedBy = [];
  perm.regeneratedThisTurn = true;
  state.regenerationLog = Array.isArray(state.regenerationLog) ? state.regenerationLog : [];
  state.regenerationLog.push({ permanentId: id, cardName: String(perm.card?.name || ''), source: 'static-replacement', timestamp: Date.now() });
  debug(2, `[regenerate] ${perm.card?.name || id} regenerated instead of being destroyed`);
  return true;
}