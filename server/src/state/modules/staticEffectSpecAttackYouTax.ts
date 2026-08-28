// Origin parent: server/src/state/modules/staticEffectSpec.ts
// Cluster: live pillowfort attack-you tax / prohibition from declarative StaticEffectSpec
// (no card-name routing). Parse lives in staticEffectSpecOracleParsingAttackYouTax.ts.
// Public entry symbols: collectAttackYouTaxForDefender,
// collectAttackYouProhibitionForAttacker, collectAttackYouMaxAttackersForDefender,
// collectMaxAttackersEachCombat, collectMaxBlockersEachCombat, collectBlockTax.

import type { BattlefieldPermanent } from '../../../../shared/src/index.js';
import {
  bindKeywordResolver,
  collectStaticEffectSpecsFromState,
  type StaticEffectAttackYouTaxCountBasis,
  type StaticEffectSpec,
} from './staticEffectSpec.js';
import {
  specMatchesStaticCondition,
  type StaticConditionState,
} from './staticEffectSpecConditionEval.js';
import { collectThisTurnBlockTax } from './staticEffectSpecBlockTaxThisTurn.js';

const BASIC_LAND_TYPES = ['plains', 'island', 'swamp', 'mountain', 'forest'] as const;

export interface AttackYouTaxForDefender {
  cost: number;
  sources: string[];
}

function typeLineOf(permanent: BattlefieldPermanent): string {
  return String((permanent as any)?.card?.type_line || (permanent as any)?.type_line || '').toLowerCase();
}

function countEnchantmentsYouControl(
  battlefield: readonly BattlefieldPermanent[],
  controller: string,
): number {
  return battlefield.filter((perm) => {
    if (String(perm.controller || '') !== controller) return false;
    return typeLineOf(perm).includes('enchantment');
  }).length;
}

function countBasicLandTypesYouControl(
  battlefield: readonly BattlefieldPermanent[],
  controller: string,
): number {
  const types = new Set<string>();
  for (const perm of battlefield) {
    if (String(perm.controller || '') !== controller) continue;
    const typeLine = typeLineOf(perm);
    if (!typeLine.includes('land')) continue;
    for (const landType of BASIC_LAND_TYPES) {
      if (new RegExp(`\\b${landType}\\b`).test(typeLine)) types.add(landType);
    }
  }
  return types.size;
}

function resolveAttackYouTaxAmount(
  spec: StaticEffectSpec,
  battlefield: readonly BattlefieldPermanent[],
  defenderId: string,
): number {
  const base = Number(spec.grant.attackYouTaxGeneric || 0);
  if (!Number.isFinite(base) || base <= 0) return 0;
  const basis: StaticEffectAttackYouTaxCountBasis | undefined = spec.grant.attackYouTaxCountBasis;
  if (basis === 'enchantments_you_control') {
    return base * countEnchantmentsYouControl(battlefield, defenderId);
  }
  if (basis === 'basic_land_types_you_control') {
    return base * countBasicLandTypesYouControl(battlefield, defenderId);
  }
  return base;
}

function specAppliesToAttacker(
  spec: StaticEffectSpec,
  attacker: BattlefieldPermanent | undefined,
): boolean {
  if (spec.scope.kind === 'self') {
    if (!attacker) return false;
    return String(attacker.id || '') === String(spec.sourcePermanentId || '');
  }
  return true;
}

function staticConditionRequiresAttacker(spec: StaticEffectSpec): boolean {
  return String(spec.condition?.kind || '').startsWith('target_');
}

function conditionPermanentForSpec(
  spec: StaticEffectSpec,
  battlefield: readonly BattlefieldPermanent[],
  attacker: BattlefieldPermanent | undefined,
): BattlefieldPermanent {
  if (attacker) return attacker;
  const source = battlefield.find((perm) => String(perm.id || '') === String(spec.sourcePermanentId || ''));
  if (source) return source;
  return (battlefield[0] || { id: spec.sourcePermanentId }) as BattlefieldPermanent;
}

/**
 * Per-creature generic tax to attack `defenderId`, summed from oracle StaticEffectSpec.
 * Color-gated specs (Elephant Grass) evaluate `target_*` conditions on `attacker`.
 */
export function collectAttackYouTaxForDefender(
  state: StaticConditionState & { battlefield?: readonly BattlefieldPermanent[] },
  defenderId: string,
  attacker?: BattlefieldPermanent,
): AttackYouTaxForDefender {
  const controller = String(defenderId || '').trim();
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  if (!controller) return { cost: 0, sources: [] };

  const specs = collectStaticEffectSpecsFromState(state);
  const keywordResolver = bindKeywordResolver(specs, state);
  const sources: string[] = [];
  let cost = 0;
  for (const spec of specs) {
    if (String(spec.sourceController || '') !== controller) continue;
    if (typeof spec.grant.attackYouTaxGeneric !== 'number') continue;
    if (!specAppliesToAttacker(spec, attacker)) continue;
    if (staticConditionRequiresAttacker(spec) && !attacker) continue;
    const conditionPermanent = conditionPermanentForSpec(spec, battlefield, attacker);
    if (!specMatchesStaticCondition(conditionPermanent, spec, state, keywordResolver)) {
      continue;
    }
    const amount = resolveAttackYouTaxAmount(spec, battlefield, controller);
    if (amount <= 0) continue;
    cost += amount;
    sources.push(String(spec.sourceName || spec.id || 'an effect'));
  }
  return { cost, sources };
}

const ATTACK_YOU_PROHIBITED_EXCEPT_KEYWORDS = 'attackYouProhibitedExceptKeywords';

function lastingEffectKeywords(effect: { keywords?: unknown }): string[] {
  if (!Array.isArray(effect.keywords)) return [];
  return effect.keywords
    .map((keyword) => String(keyword || '').trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Per-attacker hard lock against attacking `defenderId` (Blazing Archon /
 * Elephant Grass black creatures). Returns the source name, or null.
 */
export function collectAttackYouProhibitionForAttacker(
  state: StaticConditionState & {
    battlefield?: readonly BattlefieldPermanent[];
    lastingEffects?: readonly unknown[];
  },
  defenderId: string,
  attacker: BattlefieldPermanent | undefined,
): string | null {
  const controller = String(defenderId || '').trim();
  if (!controller || !attacker) return null;
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const specs = collectStaticEffectSpecsFromState(state);
  const keywordResolver = bindKeywordResolver(specs, state);

  for (const spec of specs) {
    if (String(spec.sourceController || '') !== controller) continue;
    if (!spec.grant.attackYouProhibited) continue;
    if (!specAppliesToAttacker(spec, attacker)) continue;
    if (staticConditionRequiresAttacker(spec) && !attacker) continue;
    const conditionPermanent = conditionPermanentForSpec(spec, battlefield, attacker);
    if (!specMatchesStaticCondition(conditionPermanent, spec, state, keywordResolver)) continue;
    return String(spec.sourceName || spec.id || 'an effect');
  }

  const lastingEffects = Array.isArray(state.lastingEffects) ? state.lastingEffects : [];
  for (const entry of lastingEffects) {
    const effect = entry as {
      type?: string;
      targetPlayer?: string;
      keywords?: unknown;
      source?: string;
    };
    if (String(effect?.type || '') !== ATTACK_YOU_PROHIBITED_EXCEPT_KEYWORDS) continue;
    if (String(effect.targetPlayer || '') !== controller) continue;
    const keywords = lastingEffectKeywords(effect);
    if (keywords.length === 0) continue;
    const lacksAll = keywords.every((keyword) => !keywordResolver(attacker, keyword));
    if (!lacksAll) continue;
    return String(effect.source || 'an effect');
  }
  return null;
}

export interface AttackYouMaxAttackersForDefender {
  max: number | null;
  sources: string[];
}

/**
 * Lowest "no more than N creatures can attack you" cap for this defender
 * (Crawlspace). Null max means no cap.
 */
export function collectAttackYouMaxAttackersForDefender(
  state: StaticConditionState & { battlefield?: readonly BattlefieldPermanent[] },
  defenderId: string,
): AttackYouMaxAttackersForDefender {
  const controller = String(defenderId || '').trim();
  if (!controller) return { max: null, sources: [] };

  const specs = collectStaticEffectSpecsFromState(state);
  const keywordResolver = bindKeywordResolver(specs, state);
  const dummy = { id: '' } as BattlefieldPermanent;
  let max: number | null = null;
  const sources: string[] = [];
  for (const spec of specs) {
    if (String(spec.sourceController || '') !== controller) continue;
    const cap = Number(spec.grant.attackYouMaxAttackers);
    if (!Number.isFinite(cap) || cap <= 0) continue;
    if (!specMatchesStaticCondition(dummy, spec, state, keywordResolver)) continue;
    if (max === null || cap < max) {
      max = cap;
      sources.length = 0;
      sources.push(String(spec.sourceName || spec.id || 'an effect'));
    } else if (cap === max) {
      sources.push(String(spec.sourceName || spec.id || 'an effect'));
    }
  }
  return { max, sources };
}

/**
 * Lowest global "no more than N creatures can attack each combat" cap
 * (Silent Arbiter / Dueling Grounds). Null max means no cap.
 */
export function collectMaxAttackersEachCombat(
  state: StaticConditionState & { battlefield?: readonly BattlefieldPermanent[] },
): AttackYouMaxAttackersForDefender {
  const specs = collectStaticEffectSpecsFromState(state);
  const keywordResolver = bindKeywordResolver(specs, state);
  const dummy = { id: '' } as BattlefieldPermanent;
  let max: number | null = null;
  const sources: string[] = [];
  for (const spec of specs) {
    const cap = Number(spec.grant.maxAttackersEachCombat);
    if (!Number.isFinite(cap) || cap <= 0) continue;
    if (!specMatchesStaticCondition(dummy, spec, state, keywordResolver)) continue;
    if (max === null || cap < max) {
      max = cap;
      sources.length = 0;
      sources.push(String(spec.sourceName || spec.id || 'an effect'));
    } else if (cap === max) {
      sources.push(String(spec.sourceName || spec.id || 'an effect'));
    }
  }
  return { max, sources };
}

/**
 * Lowest global "no more than N creatures can block each combat" cap
 * (Silent Arbiter / Dueling Grounds). Null max means no cap.
 */
export function collectMaxBlockersEachCombat(
  state: StaticConditionState & { battlefield?: readonly BattlefieldPermanent[] },
): AttackYouMaxAttackersForDefender {
  const specs = collectStaticEffectSpecsFromState(state);
  const keywordResolver = bindKeywordResolver(specs, state);
  const dummy = { id: '' } as BattlefieldPermanent;
  let max: number | null = null;
  const sources: string[] = [];
  for (const spec of specs) {
    const cap = Number(spec.grant.maxBlockersEachCombat);
    if (!Number.isFinite(cap) || cap <= 0) continue;
    if (!specMatchesStaticCondition(dummy, spec, state, keywordResolver)) continue;
    if (max === null || cap < max) {
      max = cap;
      sources.length = 0;
      sources.push(String(spec.sourceName || spec.id || 'an effect'));
    } else if (cap === max) {
      sources.push(String(spec.sourceName || spec.id || 'an effect'));
    }
  }
  return { max, sources };
}

/**
 * Per-blocker generic tax from oracle StaticEffectSpec (Archangel of Tithes
 * while attacking) plus this-turn lastingEffects.blockTaxGeneric (War Cadence).
 * Global — any attacking source taxes all blockers.
 */
export function collectBlockTax(
  state: StaticConditionState & {
    battlefield?: readonly BattlefieldPermanent[];
    lastingEffects?: readonly unknown[];
  },
): AttackYouTaxForDefender {
  const specs = collectStaticEffectSpecsFromState(state);
  const keywordResolver = bindKeywordResolver(specs, state);
  const dummy = { id: '' } as BattlefieldPermanent;
  const sources: string[] = [];
  let cost = 0;
  for (const spec of specs) {
    const amount = Number(spec.grant.blockTaxGeneric);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    if (!specMatchesStaticCondition(dummy, spec, state, keywordResolver)) continue;
    cost += amount;
    sources.push(String(spec.sourceName || spec.id || 'an effect'));
  }
  const thisTurn = collectThisTurnBlockTax(state);
  cost += thisTurn.cost;
  sources.push(...thisTurn.sources);
  return { cost, sources };
}
