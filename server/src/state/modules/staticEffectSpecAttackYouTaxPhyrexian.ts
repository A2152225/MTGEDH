// Origin parent: server/src/state/modules/staticEffectSpecAttackYouTax.ts
// Cluster: Norn's Annex `{W/P}` attack-you tax (color or 2 life per creature).
// Public: parseAttackYouTaxPhyrexianGrant, collectAttackYouTaxPhyrexianForDefender
// Leaf must not import staticEffectSpec.ts implementations beyond types/collect.

import type { BattlefieldPermanent } from '../../../../shared/src/index.js';
import {
  bindKeywordResolver,
  collectStaticEffectSpecsFromState,
  type StaticEffectGrant,
  type StaticEffectSpec,
} from './staticEffectSpec.js';
import {
  specMatchesStaticCondition,
  type StaticConditionState,
} from './staticEffectSpecConditionEval.js';
import {
  parseAttackYouTaxPhyrexianGrant,
  type AttackYouTaxPhyrexianColor,
  type AttackYouTaxPhyrexianGrant,
  type AttackYouTaxPhyrexianSymbol,
} from './staticEffectSpecAttackYouTaxPhyrexianParse.js';

export {
  parseAttackYouTaxPhyrexianGrant,
};
export type {
  AttackYouTaxPhyrexianColor,
  AttackYouTaxPhyrexianGrant,
  AttackYouTaxPhyrexianSymbol,
};

export interface AttackYouTaxPhyrexianItem {
  color: AttackYouTaxPhyrexianColor;
  symbol: AttackYouTaxPhyrexianSymbol;
  life: number;
  source: string;
}

export interface AttackYouTaxPhyrexianForDefender {
  items: AttackYouTaxPhyrexianItem[];
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

export function isPhyrexianAttackYouTaxGrant(grant: StaticEffectGrant | null | undefined): boolean {
  const phyrexian = grant?.attackYouTaxPhyrexian;
  if (!phyrexian) return false;
  const life = Number(phyrexian.life);
  return Boolean(phyrexian.symbol) && Number.isFinite(life) && life > 0;
}

/**
 * Per-creature `{W/P}` taxes to attack `defenderId`. One item per matching spec
 * (two Annexes on the same defender yield two items).
 */
export function collectAttackYouTaxPhyrexianForDefender(
  state: StaticConditionState & { battlefield?: readonly BattlefieldPermanent[] },
  defenderId: string,
  attacker?: BattlefieldPermanent,
): AttackYouTaxPhyrexianForDefender {
  const controller = String(defenderId || '').trim();
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  if (!controller) return { items: [] };

  const specs = collectStaticEffectSpecsFromState(state);
  const keywordResolver = bindKeywordResolver(specs, state);
  const items: AttackYouTaxPhyrexianItem[] = [];
  for (const spec of specs) {
    if (String(spec.sourceController || '') !== controller) continue;
    if (!isPhyrexianAttackYouTaxGrant(spec.grant)) continue;
    if (!specAppliesToAttacker(spec, attacker)) continue;
    if (staticConditionRequiresAttacker(spec) && !attacker) continue;
    const conditionPermanent = conditionPermanentForSpec(spec, battlefield, attacker);
    if (!specMatchesStaticCondition(conditionPermanent, spec, state, keywordResolver)) {
      continue;
    }
    const phyrexian = spec.grant.attackYouTaxPhyrexian as AttackYouTaxPhyrexianGrant;
    items.push({
      color: phyrexian.color,
      symbol: phyrexian.symbol,
      life: Number(phyrexian.life) || 2,
      source: String(spec.sourceName || spec.id || 'an effect'),
    });
  }
  return { items };
}
