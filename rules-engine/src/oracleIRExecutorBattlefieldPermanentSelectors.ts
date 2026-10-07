// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: resolveDirectBattlefieldPermanents, resolveGrantTemporaryMassTargets.
// Public entries: those two resolvers.

import type { BattlefieldPermanent } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { resolveDeterministicArmyCreatureSelection } from './oracleIRExecutorBattlefieldArmySelection';
import { resolveAttachedStaticAbilityGrantTargets } from './oracleIRExecutorBattlefieldAttachedGrantTargets';
import { collectBoundBattlefieldIds } from './oracleIRExecutorBattlefieldBoundIds';
import { readCharacteristicNumber } from './oracleIRExecutorBattlefieldCharacteristicNumber';
import {
  resolveBoundSelectorMatches,
  resolveContextualBattlefieldPermanents,
} from './oracleIRExecutorBattlefieldContextualResolvers';
import { buildContextualBattlefieldTargetIds } from './oracleIRExecutorBattlefieldContextualTargets';
import { buildNameReferenceAliases } from './oracleIRExecutorBattlefieldNameAliases';
import {
  battlefieldPermanentHasFlying,
  isAttackingBattlefieldPermanent,
  permanentHasBattlefieldCounters,
} from './oracleIRExecutorBattlefieldPermanentMatchers';
import {
  parseSimpleBattlefieldSelector,
  parseSimplePermanentTypeFromText,
} from './oracleIRExecutorBattlefieldParser';
import { permanentMatchesSelector, permanentMatchesType } from './oracleIRExecutorBattlefieldOps';
import { resolveSubtypeOrCompoundBattlefieldPermanents } from './oracleIRExecutorBattlefieldSubtypeCompoundResolvers';
import { typeLineHasSubtype } from './oracleIRExecutorBattlefieldSubtypeUtils';
import { normalizeBattlefieldTargetReferenceText } from './oracleIRExecutorBattlefieldTargetReferenceText';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';
import { readCurrentPowerFromHook, readCurrentToughnessFromHook } from './currentPowerToughnessHook';
import {
  resolveAttachedReferenceTargets,
  resolveMassCreatureRestrictionTargets,
  resolveTargetPrefixedPermanents,
} from './oracleIRExecutorExtendedTargetResolution';

export function resolveDirectBattlefieldPermanents(
  battlefield: readonly BattlefieldPermanent[],
  target:
    | { readonly kind: string; readonly text?: string; readonly raw?: string }
    | undefined,
  ctx: OracleIRExecutionContext
): BattlefieldPermanent[] {
  if (!target) return [];
  const normalizedTarget =
    target.kind === 'raw'
      ? {
          ...target,
          text: normalizeBattlefieldTargetReferenceText(String((target as any).text || '')),
        }
      : target;
  const targetText = normalizedTarget.kind === 'raw' ? String((normalizedTarget as any).text || '') : '';

  const typedYouControlMatch = targetText.match(
    /^target (land|creature|artifact|enchantment|planeswalker|battle|vehicle) you control$/i,
  );
  if (typedYouControlMatch) {
    const parsedType = parseSimplePermanentTypeFromText(String(typedYouControlMatch[1] || ''));
    if (!parsedType) return [];
    const boundIds = collectBoundBattlefieldIds(ctx);
    const controllerId = String(ctx.controllerId || '').trim();
    const fromBound = battlefield.filter((perm: any) => {
      const permanentId = String(perm?.id || '').trim();
      if (!boundIds.includes(permanentId)) return false;
      if (controllerId && String(perm?.controller || '').trim() !== controllerId) return false;
      return permanentMatchesType(perm, parsedType);
    });
    if (fromBound.length > 0) return fromBound.slice(0, 1);
    const controlledMatches = battlefield.filter((perm: any) => {
      if (controllerId && String(perm?.controller || '').trim() !== controllerId) return false;
      return permanentMatchesType(perm, parsedType);
    });
    if (controlledMatches.length === 1) return controlledMatches;
  }

  const compoundRestricted = resolveCompoundTypesOrRestrictedCreatureTarget(battlefield, targetText, ctx);
  if (compoundRestricted !== null) return compoundRestricted;

  const attachedMatches = resolveAttachedReferenceTargets(battlefield, targetText, ctx);
  if (attachedMatches !== null) return attachedMatches;

  const massRestrictionMatches = resolveMassCreatureRestrictionTargets(battlefield, targetText, ctx);
  if (massRestrictionMatches !== null) return massRestrictionMatches;

  const grantMassMatches = resolveGrantTemporaryMassTargets(
    battlefield,
    targetText.toLowerCase(),
    '',
    ctx
  );
  if (grantMassMatches !== null) return grantMassMatches;

  const targetPrefixedMatches = resolveTargetPrefixedPermanents(
    battlefield,
    targetText,
    ctx,
    (selector) => resolveBoundSelectorMatches(battlefield, selector, ctx)
  );
  if (targetPrefixedMatches !== null) return targetPrefixedMatches;

  const armyMatches = resolveDeterministicArmyCreatureSelection(battlefield, normalizedTarget, ctx);
  if (armyMatches) return armyMatches;
  const selector = parseSimpleBattlefieldSelector(normalizedTarget as any);
  if (selector) {
    if (/^target\b/i.test(targetText)) {
      const boundMatches = resolveBoundSelectorMatches(battlefield, selector, ctx);
      if (boundMatches.length > 0) return boundMatches.slice(0, 1);
      const matched = battlefield.filter(perm => permanentMatchesSelector(perm, selector, ctx));
      if (matched.length > 1) return [];
      return matched.length > 0 ? matched.slice(0, 1) : [];
    }
    return battlefield.filter(perm => permanentMatchesSelector(perm, selector, ctx));
  }
  const subtypeOrCompoundMatches = resolveSubtypeOrCompoundBattlefieldPermanents(
    battlefield,
    normalizedTarget as any,
    ctx
  );
  if (subtypeOrCompoundMatches) return subtypeOrCompoundMatches;
  return resolveContextualBattlefieldPermanents(battlefield, normalizedTarget, ctx);
}

export function resolveGrantTemporaryMassTargets(
  battlefield: readonly BattlefieldPermanent[],
  normalizedTargetText: string,
  stepRaw: string,
  ctx: OracleIRExecutionContext
): BattlefieldPermanent[] | null {
  let effectiveTargetText = normalizedTargetText;
  if (/that creature gains/i.test(stepRaw)) effectiveTargetText = 'that creature';
  if (/the chosen creature gains/i.test(stepRaw)) effectiveTargetText = 'the chosen creature';
  if (/the creature that attacked gains/i.test(stepRaw)) effectiveTargetText = 'the creature that attacked';
  if (/that mount or vehicle/i.test(stepRaw)) effectiveTargetText = 'that mount or vehicle';
  if (/for each other result, it gains/i.test(stepRaw)) effectiveTargetText = 'it';
  if (/^have this creature$/i.test(effectiveTargetText) || /this creature become a copy of that creature/i.test(stepRaw)) {
    effectiveTargetText = 'this creature';
  }
  if (/this creature(?:'s base power)?/i.test(stepRaw) && /become equal to that creature's power/i.test(stepRaw)) {
    effectiveTargetText = 'this creature';
  }

  if (/^that creature$/i.test(effectiveTargetText)) {
    const matches = resolveDirectBattlefieldPermanents(battlefield, { kind: 'raw', text: 'that creature' }, ctx);
    return matches.length > 0 ? matches : null;
  }

  if (/^it$/i.test(effectiveTargetText)) {
    const matches = resolveDirectBattlefieldPermanents(battlefield, { kind: 'raw', text: 'it' }, ctx);
    return matches.length > 0 ? matches : null;
  }

  if (/^this creature$/i.test(effectiveTargetText)) {
    const matches = resolveDirectBattlefieldPermanents(battlefield, { kind: 'raw', text: 'this creature' }, ctx);
    return matches.length > 0 ? matches : null;
  }

  if (/^other clues you control$/i.test(effectiveTargetText)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const matches = battlefield.filter(perm => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (sourceId && permanentId === sourceId) return false;
      if (
        !permanentMatchesSelector(
          perm,
          { kind: 'battlefield_selector', types: ['artifact'], controllerFilter: 'you' },
          ctx
        )
      ) {
        return false;
      }
      return typeLineHasSubtype(perm, 'clue');
    });
    return matches.length > 0 ? matches : null;
  }

  const otherSubtypeMatch = effectiveTargetText.match(/^other ([a-z][a-z -]+) you control$/i);
  if (otherSubtypeMatch) {
    const subtype = String(otherSubtypeMatch[1] || '').trim();
    const matches = battlefield.filter(
      perm =>
        permanentMatchesSelector(
          perm,
          { kind: 'battlefield_selector', types: ['creature'], controllerFilter: 'you', excludeSourceId: true },
          ctx
        ) && typeLineHasSubtype(perm, subtype)
    );
    return matches.length > 0 ? matches : null;
  }

  const otherPowerMatch = effectiveTargetText.match(/^other creatures you control with power (\d+) or greater$/i);
  if (otherPowerMatch) {
    const minPower = Number(otherPowerMatch[1] || 0);
    const matches = battlefield.filter(perm => {
      if (
        !permanentMatchesSelector(
          perm,
          { kind: 'battlefield_selector', types: ['creature'], controllerFilter: 'you', excludeSourceId: true },
          ctx
        )
      ) {
        return false;
      }
      const power =
        readCharacteristicNumber(
          (perm as any)?.effectivePower,
          (perm as any)?.basePower,
          (perm as any)?.card?.power,
          (perm as any)?.power
        ) ?? 0;
      return power >= minPower;
    });
    return matches.length > 0 ? matches : null;
  }

  if (/^treasures you control$/i.test(effectiveTargetText)) {
    const matches = battlefield.filter(
      perm =>
        permanentMatchesSelector(
          perm,
          { kind: 'battlefield_selector', types: ['artifact'], controllerFilter: 'you' },
          ctx
        ) && typeLineHasSubtype(perm, 'treasure')
    );
    return matches.length > 0 ? matches : null;
  }

  if (/become a copy of another creature you control/i.test(stepRaw)) {
    const selfMatches = resolveDirectBattlefieldPermanents(
      battlefield,
      { kind: 'raw', text: /^have it$/i.test(effectiveTargetText) ? 'it' : 'this creature' },
      ctx
    );
    return selfMatches.length > 0 ? selfMatches : null;
  }

  if (/^each equipped creature and equipment you control$/i.test(effectiveTargetText)) {
    const equipment = battlefield.filter(
      perm =>
        permanentMatchesSelector(
          perm,
          { kind: 'battlefield_selector', types: ['artifact'], controllerFilter: 'you' },
          ctx
        ) && /\bequipment\b/i.test(getExecutorTypeLineLower(perm))
    );
    const equippedCreatureIds = new Set(
      equipment.map(eq => String((eq as any)?.attachedTo || '').trim()).filter(Boolean)
    );
    const equippedCreatures = battlefield.filter(perm =>
      equippedCreatureIds.has(String((perm as any)?.id || '').trim())
    );
    const combined = [...equipment, ...equippedCreatures];
    return combined.length > 0 ? combined : null;
  }

  if (/^each attacking human$/i.test(effectiveTargetText)) {
    const matches = battlefield.filter(perm => {
      if (
        !permanentMatchesSelector(
          perm,
          { kind: 'battlefield_selector', types: ['creature'], controllerFilter: 'you' },
          ctx
        )
      ) {
        return false;
      }
      if (!typeLineHasSubtype(perm, 'human')) return false;
      return Boolean(
        (perm as any)?.attacking ||
        (perm as any)?.attackedThisTurn ||
        (perm as any)?.attackingPlayerId
      );
    });
    return matches.length > 0 ? matches : null;
  }

  if (/^creatures of the chosen creature type you control$/i.test(effectiveTargetText)) {
    const chosenType = String(ctx.selectorContext?.chosenCreatureType || '').trim().toLowerCase();
    if (!chosenType) return null;
    const matches = battlefield.filter(
      perm =>
        permanentMatchesSelector(
          perm,
          { kind: 'battlefield_selector', types: ['creature'], controllerFilter: 'you' },
          ctx
        ) && typeLineHasSubtype(perm, chosenType)
    );
    return matches.length > 0 ? matches : null;
  }

  if (/^creatures you control of the chosen type$/i.test(effectiveTargetText)) {
    const chosenType = String(ctx.selectorContext?.chosenCreatureType || '').trim().toLowerCase();
    if (!chosenType) return null;
    const matches = battlefield.filter(
      perm =>
        permanentMatchesSelector(
          perm,
          { kind: 'battlefield_selector', types: ['creature'], controllerFilter: 'you' },
          ctx
        ) && typeLineHasSubtype(perm, chosenType)
    );
    return matches.length > 0 ? matches : null;
  }

  if (/^creatures target player controls$/i.test(effectiveTargetText)) {
    const targetPlayerId = String(ctx.selectorContext?.targetPlayerId || ctx.targetPlayerId || '').trim();
    if (!targetPlayerId) return null;
    const matches = battlefield.filter(
      (perm) =>
        permanentMatchesSelector(
          perm,
          { kind: 'battlefield_selector', types: ['creature'], controllerFilter: 'any' },
          ctx
        )
        && String((perm as any)?.controller || '').trim() === targetPlayerId,
    );
    return matches.length > 0 ? matches : null;
  }

  const subtypeCreaturesMatch = effectiveTargetText.match(/^([a-z][a-z -]+) creatures you control$/i);
  if (subtypeCreaturesMatch) {
    const subtype = String(subtypeCreaturesMatch[1] || '').trim();
    const matches = battlefield.filter(
      perm =>
        permanentMatchesSelector(
          perm,
          { kind: 'battlefield_selector', types: ['creature'], controllerFilter: 'you' },
          ctx
        ) && typeLineHasSubtype(perm, subtype)
    );
    return matches.length > 0 ? matches : null;
  }

  if (/^creature tokens you control$/i.test(effectiveTargetText)) {
    const matches = battlefield.filter(
      perm =>
        permanentMatchesSelector(
          perm,
          { kind: 'battlefield_selector', types: ['creature'], controllerFilter: 'you' },
          ctx
        ) &&
        (Boolean((perm as any)?.isToken) || /\btoken\b/i.test(getExecutorTypeLineLower(perm)))
    );
    return matches.length > 0 ? matches : null;
  }

  if (/^attacking creatures$/i.test(effectiveTargetText)) {
    const matches = battlefield.filter(
      perm =>
        permanentMatchesType(perm, 'creature') &&
        Boolean(
          (perm as any)?.attacking ||
          (perm as any)?.attackedThisTurn ||
          (perm as any)?.attackingPlayerId
        )
    );
    return matches.length > 0 ? matches : null;
  }

  if (/^gorgons and snakes you control$/i.test(effectiveTargetText)) {
    const matches = battlefield.filter(
      perm =>
        permanentMatchesSelector(
          perm,
          { kind: 'battlefield_selector', types: ['creature'], controllerFilter: 'you' },
          ctx
        ) && (typeLineHasSubtype(perm, 'gorgon') || typeLineHasSubtype(perm, 'snake'))
    );
    return matches.length > 0 ? matches : null;
  }

  if (/^the chosen creature$/i.test(effectiveTargetText)) {
    const chosenIds = collectBoundBattlefieldIds(ctx);
    const matches = battlefield.filter((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      return chosenIds.includes(permanentId) && permanentMatchesType(perm, 'creature');
    });
    return matches.length > 0 ? matches.slice(0, 1) : null;
  }

  if (/^the creature that attacked$/i.test(effectiveTargetText)) {
    const controllerId = String(ctx.controllerId || '').trim();
    const contextualIds = buildContextualBattlefieldTargetIds(battlefield, ctx, false, 'creature');
    const contextualMatches = battlefield.filter((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      return contextualIds.includes(permanentId) && permanentMatchesType(perm, 'creature');
    });
    if (contextualMatches.length > 0) return contextualMatches.slice(0, 1);
    const attacking = battlefield.filter((perm: any) => {
      if (String((perm as any)?.controller || '').trim() !== controllerId) return false;
      if (!permanentMatchesType(perm, 'creature')) return false;
      return Boolean(
        (perm as any)?.attacking ||
        (perm as any)?.attackedThisTurn ||
        (perm as any)?.attackingPlayerId
      );
    });
    return attacking.length > 0 ? attacking.slice(0, 1) : null;
  }

  if (/^that attacking creature$/i.test(effectiveTargetText)) {
    const controllerId = String(ctx.controllerId || '').trim();
    const contextualIds = buildContextualBattlefieldTargetIds(battlefield, ctx, false, 'creature');
    const contextualMatches = battlefield.filter((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (!contextualIds.includes(permanentId)) return false;
      if (!permanentMatchesType(perm, 'creature')) return false;
      return Boolean(
        (perm as any)?.attacking ||
        (perm as any)?.attackedThisTurn ||
        (perm as any)?.attackingPlayerId
      );
    });
    if (contextualMatches.length > 0) return contextualMatches.slice(0, 1);
    const attacking = battlefield.filter((perm: any) => {
      if (String((perm as any)?.controller || '').trim() !== controllerId) return false;
      if (!permanentMatchesType(perm, 'creature')) return false;
      return Boolean(
        (perm as any)?.attacking ||
        (perm as any)?.attackedThisTurn ||
        (perm as any)?.attackingPlayerId
      );
    });
    return attacking.length > 0 ? attacking.slice(0, 1) : null;
  }

  const otherThanSelfSubtypeMatch = effectiveTargetText.match(
    /^([a-z][a-z -]+) you control other than this creature$/i
  );
  if (otherThanSelfSubtypeMatch) {
    const subtype = String(otherThanSelfSubtypeMatch[1] || '').trim();
    const sourceId = String(ctx.sourceId || '').trim();
    const matches = battlefield.filter(
      perm =>
        permanentMatchesSelector(
          perm,
          { kind: 'battlefield_selector', types: ['creature'], controllerFilter: 'you' },
          ctx
        ) &&
        typeLineHasSubtype(perm, subtype) &&
        String((perm as any)?.id || '').trim() !== sourceId
    );
    return matches.length > 0 ? matches : null;
  }

  const eachSingularWithQualifierMatch = effectiveTargetText.match(/^each creature you control with (.+)$/i);
  if (eachSingularWithQualifierMatch) {
    const qualifierTarget = `creatures you control with ${String(eachSingularWithQualifierMatch[1] || '').trim()}`;
    const qualifierMatches = resolveGrantTemporaryMassTargets(
      battlefield,
      qualifierTarget,
      stepRaw,
      ctx
    );
    return qualifierMatches && qualifierMatches.length > 0 ? qualifierMatches : null;
  }

  const withQualifierMatch = effectiveTargetText.match(/^creatures you control with (.+)$/i);
  if (withQualifierMatch) {
    const qualifier = String(withQualifierMatch[1] || '').trim().toLowerCase();
    const sourceId = String(ctx.sourceId || '').trim();
    const sourcePermanent = sourceId
      ? battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === sourceId)
      : undefined;
    const sourcePower =
      readCharacteristicNumber(
        (sourcePermanent as any)?.effectivePower,
        (sourcePermanent as any)?.basePower,
        (sourcePermanent as any)?.card?.power,
        (sourcePermanent as any)?.power
      ) ?? 0;
    const matches = battlefield.filter(perm => {
      if (
        !permanentMatchesSelector(
          perm,
          { kind: 'battlefield_selector', types: ['creature'], controllerFilter: 'you' },
          ctx
        )
      ) {
        return false;
      }
      if (qualifier === 'flying') return battlefieldPermanentHasFlying(perm);
      if (qualifier === 'defender') {
        const keywordValues: unknown[] = [
          ...(Array.isArray((perm as any)?.keywords) ? (perm as any).keywords : []),
          ...(Array.isArray((perm as any)?.card?.keywords) ? (perm as any).card.keywords : []),
          ...(Array.isArray((perm as any)?.grantedAbilities) ? (perm as any).grantedAbilities : []),
        ];
        return (
          /\bdefender\b/i.test(getExecutorTypeLineLower(perm)) ||
          keywordValues.some(value => /\bdefender\b/i.test(String(value || '')))
        );
      }
      if (/counters? on them/.test(qualifier)) return permanentHasBattlefieldCounters(perm);
      const powerAtMost = qualifier.match(/^power (\d+) or less$/);
      if (powerAtMost) {
        const power =
          readCharacteristicNumber(
            (perm as any)?.effectivePower,
            (perm as any)?.basePower,
            (perm as any)?.card?.power,
            (perm as any)?.power
          ) ?? 0;
        return power <= Number(powerAtMost[1] || 0);
      }
      const toughnessAtLeast = qualifier.match(/^toughness (\d+) or greater$/);
      if (toughnessAtLeast) {
        const toughness =
          readCharacteristicNumber(
            (perm as any)?.effectiveToughness,
            (perm as any)?.baseToughness,
            (perm as any)?.card?.toughness,
            (perm as any)?.toughness
          ) ?? 0;
        return toughness >= Number(toughnessAtLeast[1] || 0);
      }
      const powerAtLeast = qualifier.match(/^power (\d+) or greater$/);
      if (powerAtLeast) {
        const power =
          readCharacteristicNumber(
            (perm as any)?.effectivePower,
            (perm as any)?.basePower,
            (perm as any)?.card?.power,
            (perm as any)?.power
          ) ?? 0;
        return power >= Number(powerAtLeast[1] || 0);
      }
      if (/power less than this permanent'?s power/.test(qualifier)) {
        const power =
          readCharacteristicNumber(
            (perm as any)?.effectivePower,
            (perm as any)?.basePower,
            (perm as any)?.card?.power,
            (perm as any)?.power
          ) ?? 0;
        return power < sourcePower;
      }
      return false;
    });
    return matches.length > 0 ? matches : null;
  }

  if (/^attacking creatures you control$/i.test(effectiveTargetText)) {
    const matches = battlefield.filter(
      perm =>
        permanentMatchesSelector(
          perm,
          { kind: 'battlefield_selector', types: ['creature'], controllerFilter: 'you' },
          ctx
        ) && isAttackingBattlefieldPermanent(perm)
    );
    return matches.length > 0 ? matches : null;
  }

  if (/^other red attacking creatures you control$/i.test(effectiveTargetText)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const matches = battlefield.filter(perm => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (sourceId && permanentId === sourceId) return false;
      if (
        !permanentMatchesSelector(
          perm,
          { kind: 'battlefield_selector', types: ['creature'], controllerFilter: 'you' },
          ctx
        )
      ) {
        return false;
      }
      if (!isAttackingBattlefieldPermanent(perm)) return false;
      const colors = Array.isArray((perm as any)?.colors)
        ? (perm as any).colors
        : Array.isArray((perm as any)?.card?.colors)
          ? (perm as any).card.colors
          : [];
      return colors.map((c: unknown) => String(c || '').trim().toUpperCase()).includes('R');
    });
    return matches.length > 0 ? matches : null;
  }

  if (/^other attacking creatures(?: you control)?$/i.test(effectiveTargetText)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const matches = battlefield.filter(perm => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (sourceId && permanentId === sourceId) return false;
      return (
        permanentMatchesSelector(
          perm,
          { kind: 'battlefield_selector', types: ['creature'], controllerFilter: 'you' },
          ctx
        ) && isAttackingBattlefieldPermanent(perm)
      );
    });
    return matches.length > 0 ? matches : null;
  }

  const subtypeYouControlOnly = effectiveTargetText.match(/^([a-z][a-z -]+) you control$/i);
  if (subtypeYouControlOnly && !/creatures?$/i.test(String(subtypeYouControlOnly[1] || ''))) {
    const subtype = String(subtypeYouControlOnly[1] || '').trim();
    const matches = battlefield.filter(perm => {
      if (!permanentMatchesSelector(perm, { kind: 'battlefield_selector', types: ['creature', 'land', 'artifact'], controllerFilter: 'you' }, ctx)) {
        return false;
      }
      return typeLineHasSubtype(perm, subtype) || typeLineHasSubtype(perm, subtype.replace(/s$/i, ''));
    });
    return matches.length > 0 ? matches : null;
  }

  if (/^up to x target attacking creatures$/i.test(effectiveTargetText)) {
    const xValue = Number(ctx.xValue);
    const maxCount = Number.isFinite(xValue) ? Math.max(0, Math.floor(xValue)) : 1;
    const boundIds = collectBoundBattlefieldIds(ctx);
    let matches = battlefield.filter((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (!boundIds.includes(permanentId)) return false;
      if (!permanentMatchesType(perm, 'creature')) return false;
      return isAttackingBattlefieldPermanent(perm);
    });
    if (matches.length === 0) {
      matches = battlefield.filter(
        perm =>
          permanentMatchesSelector(
            perm,
            { kind: 'battlefield_selector', types: ['creature'], controllerFilter: 'you' },
            ctx
          ) && isAttackingBattlefieldPermanent(perm)
      );
    }
    return maxCount > 0 && matches.length > 0 ? matches.slice(0, maxCount) : null;
  }

  const globalSubtypeCreatures = effectiveTargetText.match(/^([a-z][a-z -]+) creatures$/i);
  if (globalSubtypeCreatures && !/^up to\b/i.test(effectiveTargetText)) {
    const subtype = String(globalSubtypeCreatures[1] || '').trim();
    const matches = battlefield.filter(
      perm => permanentMatchesType(perm, 'creature') && typeLineHasSubtype(perm, subtype)
    );
    return matches.length > 0 ? matches : null;
  }

  if (/^creatures you control with counters on them$/i.test(effectiveTargetText)) {
    const matches = battlefield.filter(
      perm =>
        permanentMatchesSelector(
          perm,
          { kind: 'battlefield_selector', types: ['creature'], controllerFilter: 'you' },
          ctx
        ) && permanentHasBattlefieldCounters(perm)
    );
    return matches.length > 0 ? matches : null;
  }

  if (/^creatures you control with defender$/i.test(effectiveTargetText)) {
    const matches = battlefield.filter(
      perm =>
        permanentMatchesSelector(
          perm,
          { kind: 'battlefield_selector', types: ['creature'], controllerFilter: 'you' },
          ctx
        ) &&
        (/\bdefender\b/i.test(getExecutorTypeLineLower(perm)) ||
          (Array.isArray((perm as any)?.grantedAbilities) &&
            (perm as any).grantedAbilities.some((entry: unknown) =>
              /\bdefender\b/i.test(String(entry || ''))
            )))
    );
    return matches.length > 0 ? matches : null;
  }

  if (/^that artifact$/i.test(effectiveTargetText)) {
    const chosenIds = new Set(collectBoundBattlefieldIds(ctx));
    const matches = battlefield.filter((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (!chosenIds.has(permanentId)) return false;
      return permanentMatchesType(perm, 'artifact');
    });
    return matches.length > 0 ? matches.slice(0, 1) : null;
  }

  if (/^creatures you control$/i.test(effectiveTargetText)) {
    const matches = battlefield.filter(perm =>
      permanentMatchesSelector(
        perm,
        { kind: 'battlefield_selector', types: ['creature'], controllerFilter: 'you' },
        ctx
      )
    );
    return matches.length > 0 ? matches : null;
  }

  const eachMultiSubtypeMatch = effectiveTargetText.match(
    /^each ([a-z][a-z -]+(?:,\s*[a-z][a-z -]+)*(?:,?\s+and\s+[a-z][a-z -]+)?) you control$/i
  );
  if (eachMultiSubtypeMatch) {
    const subtypes = String(eachMultiSubtypeMatch[1] || '')
      .split(/,|\sand\s/i)
      .map(value => value.trim())
      .filter(Boolean);
    const matches = battlefield.filter(
      perm =>
        permanentMatchesSelector(
          perm,
          { kind: 'battlefield_selector', types: ['creature'], controllerFilter: 'you' },
          ctx
        ) && subtypes.some(subtype => typeLineHasSubtype(perm, subtype))
    );
    return matches.length > 0 ? matches : null;
  }

  const eachWithQualifierMatch = effectiveTargetText.match(/^each (creatures you control with .+)$/i);
  if (eachWithQualifierMatch) {
    const qualifierTarget = String(eachWithQualifierMatch[1] || '').trim();
    const qualifierMatches = resolveGrantTemporaryMassTargets(
      battlefield,
      qualifierTarget,
      stepRaw,
      ctx
    );
    return qualifierMatches && qualifierMatches.length > 0 ? qualifierMatches : null;
  }

  if (/^creatures named this permanent$/i.test(effectiveTargetText)) {
    const aliases = new Set(buildNameReferenceAliases(String(ctx.sourceName || '')));
    const matches = battlefield.filter(perm => {
      if (!permanentMatchesType(perm, 'creature')) return false;
      const name = String((perm as any)?.name || (perm as any)?.card?.name || '').trim().toLowerCase();
      return aliases.has(name);
    });
    return matches.length > 0 ? matches : null;
  }

  if (/^all creatures banded with it$/i.test(effectiveTargetText)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const bandIds = new Set(collectBoundBattlefieldIds(ctx));
    const matches = battlefield.filter((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (!permanentId || !bandIds.has(permanentId)) return false;
      if (!permanentMatchesType(perm, 'creature')) return false;
      return permanentId === sourceId || bandIds.has(permanentId);
    });
    return matches.length > 0 ? matches : null;
  }

  if (/^enchanted creature$/i.test(effectiveTargetText)) {
    const attached = resolveAttachedStaticAbilityGrantTargets(
      battlefield,
      { kind: 'raw', text: 'enchanted creature' },
      ctx
    );
    return attached.length > 0 ? attached : null;
  }

  if (/^that mount or vehicle$/i.test(effectiveTargetText)) {
    const isMountOrVehicle = (perm: BattlefieldPermanent): boolean =>
      permanentMatchesType(perm, 'vehicle') ||
      typeLineHasSubtype(perm, 'mount') ||
      /\bvehicle\b/i.test(getExecutorTypeLineLower(perm));
    const chosenIds = new Set(collectBoundBattlefieldIds(ctx));
    let matches = battlefield.filter((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (!chosenIds.has(permanentId)) return false;
      return isMountOrVehicle(perm);
    });
    if (matches.length === 0) {
      const controllerId = String(ctx.controllerId || '').trim();
      matches = battlefield.filter((perm: any) => {
        if (String((perm as any)?.controller || '').trim() !== controllerId) return false;
        return isMountOrVehicle(perm);
      });
    }
    return matches.length > 0 ? matches.slice(0, 1) : null;
  }

  return null;
}

/**
 * "target artifact, enchantment, or creature with power 4 or greater" (Exorcise) - the
 * stat restriction binds only to the final "creature"; the other listed types are
 * unrestricted. Returns null when the text is not this template.
 */
function resolveCompoundTypesOrRestrictedCreatureTarget(
  battlefield: readonly BattlefieldPermanent[],
  targetText: string,
  ctx: OracleIRExecutionContext,
): BattlefieldPermanent[] | null {
  const match = String(targetText || '').trim().match(
    /^target ((?:[a-z]+,\s*)*[a-z]+),?\s+or\s+creature with (power|toughness|mana value) (\d+) or (greater|less)$/i,
  );
  if (!match) return null;
  const otherTypes = String(match[1] || '')
    .split(/\s*,\s*/)
    .map((word) => parseSimplePermanentTypeFromText(word))
    .filter((type): type is NonNullable<typeof type> => Boolean(type));
  if (otherTypes.length === 0) return null;
  const stat = String(match[2] || '').toLowerCase();
  const threshold = Number(match[3]);
  const atLeast = String(match[4] || '').toLowerCase() === 'greater';
  const pseudoState = { battlefield };
  const readStat = (perm: any): number | undefined => {
    if (stat === 'mana value') {
      return readCharacteristicNumber(perm?.card?.cmc, perm?.card?.mana_value, perm?.cmc);
    }
    const counters = perm?.counters || {};
    const counterDelta = Number(counters['+1/+1'] || 0) - Number(counters['-1/-1'] || 0);
    const hooked = stat === 'power'
      ? readCurrentPowerFromHook(pseudoState, perm)
      : readCurrentToughnessFromHook(pseudoState, perm);
    if (hooked !== null) return hooked;
    const printed = readCharacteristicNumber(perm?.[stat], perm?.card?.[stat]);
    return printed === undefined ? undefined : printed + counterDelta;
  };
  const isLegal = (perm: any): boolean => {
    if (otherTypes.some((type) => permanentMatchesType(perm, type))) return true;
    if (!permanentMatchesType(perm, 'creature')) return false;
    const value = readStat(perm);
    if (value === undefined) return false;
    return atLeast ? value >= threshold : value <= threshold;
  };
  const boundIds = collectBoundBattlefieldIds(ctx);
  const bound = battlefield.filter((perm: any) => boundIds.includes(String(perm?.id || '').trim()) && isLegal(perm));
  if (bound.length > 0) return bound.slice(0, 1);
  if (boundIds.length > 0) return [];
  const legal = battlefield.filter(isLegal);
  return legal.length === 1 ? legal : [];
}
