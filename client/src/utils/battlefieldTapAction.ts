import type { BattlefieldPermanent, KnownCardRef } from '../../../shared/src';
import {
  canActivateTapAbility,
  getConditionalManaAbilityStatus,
  getThresholdActivationStatus,
  parseActivatedAbilities,
  type ActivationContext,
  type ParsedActivatedAbility,
} from './activatedAbilityParser';
import { hasCurrentHaste, isCurrentlyCreature } from './creatureUtils';

export type BattlefieldTapActionDecision =
  | { kind: 'tap' }
  | { kind: 'activate'; ability: ParsedActivatedAbility }
  | { kind: 'disabled'; reason: string };

function normalizeAbilitySignaturePart(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.;]+$/, '')
    .trim();
}

function normalizeAbilitySignature(ability: ParsedActivatedAbility): string {
  const cost = normalizeAbilitySignaturePart(ability.cost || '');
  const effect = normalizeAbilitySignaturePart(ability.effect || '');
  return `${cost}=>${effect}`;
}

function getAbilityPreferenceRank(ability: ParsedActivatedAbility): number {
  const abilityId = String(ability.id || '');
  if (/-ability-\d+$/i.test(abilityId)) return 0;
  if (/-mana-[wubrgc]-\d+$/i.test(abilityId)) return 1;
  if (/^native_/i.test(abilityId)) return 2;
  return 3;
}

function dedupeTapManaAbilities(abilities: ParsedActivatedAbility[]): ParsedActivatedAbility[] {
  const bySignature = new Map<string, ParsedActivatedAbility>();

  for (const ability of abilities) {
    const signature = normalizeAbilitySignature(ability);
    const existing = bySignature.get(signature);
    if (!existing || getAbilityPreferenceRank(ability) < getAbilityPreferenceRank(existing)) {
      bySignature.set(signature, ability);
    }
  }

  return Array.from(bySignature.values());
}

export function getBattlefieldTapActionDecision(
  permanent: BattlefieldPermanent,
  battlefield: readonly BattlefieldPermanent[] | undefined,
  context: Omit<ActivationContext, 'isTapped' | 'hasSummoningSickness' | 'hasHaste'>,
): BattlefieldTapActionDecision {
  const card = permanent.card as KnownCardRef | undefined;
  if (!card) {
    return { kind: 'tap' };
  }

  const abilities = parseActivatedAbilities(card, permanent.grantedAbilities);
  const battlefieldList = Array.isArray(battlefield) ? [...battlefield] : [];
  const tapManaAbilities = dedupeTapManaAbilities(
    abilities.filter((ability) => ability.isManaAbility && ability.requiresTap),
  );
  if (tapManaAbilities.length === 0) {
    return { kind: 'tap' };
  }

  const activationContext: ActivationContext = {
    ...context,
    isTapped: !!permanent.tapped,
    hasSummoningSickness: !!permanent.summoningSickness && isCurrentlyCreature(permanent),
    hasHaste: hasCurrentHaste(permanent, battlefieldList),
  };

  const activatableTapManaAbilities = tapManaAbilities.filter((ability) => {
    const tapCheck = canActivateTapAbility(ability.requiresTap, activationContext, true);
    if (!tapCheck.canActivate) {
      return false;
    }

    const thresholdCheck = getThresholdActivationStatus(ability, permanent);
    if (!thresholdCheck.canActivate) {
      return false;
    }

    const conditionalCheck = getConditionalManaAbilityStatus(ability, permanent, battlefieldList);
    if (!conditionalCheck.canActivate) {
      return false;
    }

    if (ability.timingRestriction === 'sorcery') {
      return context.isMainPhase && context.isOwnTurn && context.stackEmpty;
    }

    return true;
  });

  if (activatableTapManaAbilities.length === 1) {
    return { kind: 'activate', ability: activatableTapManaAbilities[0] };
  }

  if (activatableTapManaAbilities.length > 1) {
    return {
      kind: 'disabled',
      reason: 'Multiple tap mana abilities; choose one below.',
    };
  }

  const disabledReason = tapManaAbilities
    .map((ability) => {
      const tapCheck = canActivateTapAbility(ability.requiresTap, activationContext, true);
      if (!tapCheck.canActivate) {
        return tapCheck.reason;
      }

      const thresholdCheck = getThresholdActivationStatus(ability, permanent);
      if (!thresholdCheck.canActivate) {
        return thresholdCheck.reason;
      }

      const conditionalCheck = getConditionalManaAbilityStatus(ability, permanent, battlefieldList);
      if (!conditionalCheck.canActivate) {
        return conditionalCheck.reason;
      }

      if (ability.timingRestriction === 'sorcery') {
        return 'Sorcery timing required';
      }

      return undefined;
    })
    .find((reason): reason is string => typeof reason === 'string' && reason.length > 0);

  return {
    kind: 'disabled',
    reason: disabledReason || 'No tappable mana ability is currently available.',
  };
}