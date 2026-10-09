/**
 * Origin parent: rules-engine/src/oracleIRParserParseOracleTextToIRLatePasses.ts
 * Cluster: rewrite split/incomplete Phase 4 leftover families onto generic
 *   all-or-nothing steps after clause splitting and graveyard-permission
 *   lowering would otherwise emit destroy-without-choice, unconditional
 *   12 damage, or wrong-zone free-cast.
 * Public: rewritePhase4ChoiceFamilyAbilities
 */

import type { OracleEffectStep, OracleIRAbility } from './oracleIR';
import { tryParseEachPlayerChooseThenDestroyRest } from './oracleIRParserEachPlayerChooseDestroyRest';
import { tryParseMayCastFromAmong } from './oracleIRParserMayCastFromAmong';
import { tryParseMayRevealHandWinIfOwnNamed } from './oracleIRParserMayRevealHandWinIfOwnNamed';
import { tryParseSecretEachPlayerNumber } from './oracleIRParserSecretEachPlayerNumber';
import { tryParseSecretOpponentChoiceDamage } from './oracleIRParserSecretOpponentChoiceDamage';
import { normalizeOracleText } from './oracleIRParserUtils';

const identity = <T extends OracleEffectStep>(step: T): T => step;

function isSpellLikeAbility(ability: OracleIRAbility): boolean {
  const type = String((ability as { type?: string }).type || '').toLowerCase();
  return type === 'spell' || type === '' || type === 'triggered' || type === 'activated';
}

function rewriteAbilitySteps(
  ability: OracleIRAbility,
  nextSteps: readonly OracleEffectStep[],
): OracleIRAbility {
  return {
    ...ability,
    steps: [...nextSteps],
  };
}

export function rewritePhase4ChoiceFamilyAbilities(
  abilities: readonly OracleIRAbility[],
  oracleText: string,
): OracleIRAbility[] {
  const normalized = normalizeOracleText(String(oracleText || '')).replace(/\s+/g, ' ').trim();
  const identityArgs = { clause: normalized, rawClause: String(oracleText || '').trim(), withMeta: identity };

  const divine = tryParseEachPlayerChooseThenDestroyRest(identityArgs);
  if (divine) {
    let replaced = false;
    return abilities.flatMap((ability) => {
      if (!isSpellLikeAbility(ability)) return [ability];
      const steps = ability.steps || [];
      const looksLikeFamily = steps.some((step) =>
        step.kind === 'destroy'
        || step.kind === 'grant_static_ability'
        || /each\s+player\s+chooses/i.test(String(step.raw || ability.text || '')),
      );
      if (!looksLikeFamily) return [ability];
      if (replaced) return [];
      replaced = true;
      return [rewriteAbilitySteps(ability, [divine])];
    });
  }

  const secret = tryParseSecretOpponentChoiceDamage(identityArgs);
  if (secret) {
    let replaced = false;
    return abilities.flatMap((ability) => {
      if (!isSpellLikeAbility(ability)) return [ability];
      const steps = ability.steps || [];
      const looksLikeFamily = steps.some((step) =>
        step.kind === 'deal_damage'
        || step.kind === 'conditional'
        || step.kind === 'grant_static_ability'
        || /secretly\s+chooses/i.test(String(step.raw || ability.text || '')),
      );
      if (!looksLikeFamily) return [ability];
      if (replaced) return [];
      replaced = true;
      return [rewriteAbilitySteps(ability, [secret])];
    });
  }

  const secretNumber = tryParseSecretEachPlayerNumber(identityArgs);
  if (secretNumber) {
    let replaced = false;
    return abilities.flatMap((ability) => {
      if (!isSpellLikeAbility(ability)) return [ability];
      const steps = ability.steps || [];
      const looksLikeFamily = steps.some((step) =>
        step.kind === 'draw'
        || step.kind === 'deal_damage'
        || step.kind === 'grant_static_ability'
        || /secretly\s+chooses\s+a\s+number/i.test(String(step.raw || ability.text || '')),
      ) || /secretly\s+chooses\s+a\s+number/i.test(String(ability.text || ability.effectText || ''));
      if (!looksLikeFamily) return [ability];
      if (replaced) return [];
      replaced = true;
      return [rewriteAbilitySteps(ability, [secretNumber])];
    });
  }

  const revealWin = tryParseMayRevealHandWinIfOwnNamed(identityArgs);
  if (revealWin) {
    return abilities.map((ability) => {
      if (!isSpellLikeAbility(ability)) return ability;
      const steps = ability.steps || [];
      if (steps.some((step) => step.kind === 'may_reveal_hand_then_win_if_own_named_in_zones')) {
        return ability;
      }
      const looksLikeFamily = steps.some((step) =>
        step.kind === 'reveal_hand'
        || step.kind === 'win_game'
        || step.kind === 'conditional'
        || /may\s+reveal\s+your\s+hand/i.test(String(step.raw || ability.text || '')),
      ) || /may\s+reveal\s+your\s+hand/i.test(String(ability.text || ability.effectText || ''));
      if (!looksLikeFamily) return ability;
      return rewriteAbilitySteps(ability, [revealWin]);
    });
  }

  const millAmongMayCast = /mill\s+x\s+cards/i.test(normalized)
    && /from\s+among/i.test(normalized)
    && /without\s+paying\s+its\s+mana\s+cost/i.test(normalized);
  if (!millAmongMayCast) return [...abilities];

  const amongClause = 'You may cast an instant or sorcery spell with mana value X or less from among them without paying its mana cost.';
  const amongStep = tryParseMayCastFromAmong({
    clause: amongClause,
    rawClause: amongClause,
    withMeta: identity,
  });
  if (!amongStep) return [...abilities];

  return abilities.map((ability) => {
    const steps = ability.steps || [];
    if (steps.length === 0) return ability;
    const withoutWrongZoneCast = steps.filter((step) => step.kind !== 'grant_graveyard_permission');
    if (withoutWrongZoneCast.some((step) => step.kind === 'may_cast_from_among')) {
      return withoutWrongZoneCast.length === steps.length
        ? ability
        : rewriteAbilitySteps(ability, withoutWrongZoneCast);
    }
    const hasAmassOrMill = withoutWrongZoneCast.some((step) =>
      step.kind === 'mill'
      || step.kind === 'create_token'
      || step.kind === 'add_counter'
      || step.kind === 'add_types'
      || step.kind === 'conditional',
    );
    if (!hasAmassOrMill) return ability;
    return rewriteAbilitySteps(ability, [...withoutWrongZoneCast, amongStep]);
  });
}
