// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: applyExchangeControlStep, resolveCopyPermanentSourceObject,
// normalizeCopyPermanentTargetText, applyCopyPermanentStep.
// Public entries: applyExchangeControlStep, applyCopyPermanentStep.

import type { GameState, BattlefieldPermanent } from '../../shared/src';
import type { OracleEffectStep, OracleObjectSelector } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type {
  BattlefieldStepHandlerResult,
  RecentBattlefieldRuntime,
} from './oracleIRExecutorBattlefieldStepTypes';
import { collectBoundBattlefieldIds } from './oracleIRExecutorBattlefieldBoundIds';
import { readCharacteristicNumber } from './oracleIRExecutorBattlefieldCharacteristicNumber';
import { normalizeBattlefieldTargetReferenceText } from './oracleIRExecutorBattlefieldTargetReferenceText';
import { resolveDirectBattlefieldPermanents } from './oracleIRExecutorBattlefieldPermanentSelectors';
import { permanentMatchesType } from './oracleIRExecutorBattlefieldOps';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';
import { getCardTypeLineLower } from './oracleIRExecutorPlayerUtils';
import { findCardsExiledWithSource } from './oracleIRExecutorZoneOps';
import { trySpecialCopyPermanentStep } from './oracleIRExecutorSpecialTargetHandlers';
import { tryApplyMassExchangeControlStep } from './oracleIRExecutorBattlefieldExchangeMassSteps';
import { registerExchangeControlEffects } from './controlEffectRegistry';

const EXCHANGE_PERMANENT_CARD_TYPES = [
  'artifact',
  'battle',
  'creature',
  'enchantment',
  'land',
  'planeswalker',
] as const;

function exchangeRequiresSharedCardType(step: Extract<OracleEffectStep, { kind: 'exchange_control' }>): boolean {
  const blob = [
    String(step.raw || ''),
    String((step.first as any)?.text || ''),
    String((step.second as any)?.text || ''),
  ].join(' ');
  return /\bshare\s+a\s+(?:card|permanent)\s+type\b/i.test(blob);
}

function exchangePermanentCardTypes(permanent: any): Set<string> {
  const typeLine = getExecutorTypeLineLower(permanent);
  const cardTypeSegment = typeLine.split(/[—-]/)[0] || typeLine;
  return new Set(
    EXCHANGE_PERMANENT_CARD_TYPES.filter((cardType) => new RegExp(`\\b${cardType}\\b`, 'i').test(cardTypeSegment)),
  );
}

function exchangeTargetsShareCardType(first: any, second: any): boolean {
  const firstTypes = exchangePermanentCardTypes(first);
  const secondTypes = exchangePermanentCardTypes(second);
  if (firstTypes.size === 0 || secondTypes.size === 0) return false;
  for (const cardType of firstTypes) {
    if (secondTypes.has(cardType)) return true;
  }
  return false;
}

export function applyExchangeControlStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'exchange_control' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const mass = tryApplyMassExchangeControlStep(state, step, ctx);
  if (mass) return mass;

  const battlefieldView = (state.battlefield || []) as BattlefieldPermanent[];

  const resolveExchangePermanentId = (selector: OracleObjectSelector | undefined): string => {
    if (!selector) return '';
    if (selector.kind === 'raw') {
      const text = String(selector.text || '').trim().toLowerCase();
      if (/^this creature$|^this permanent$|^this enchantment$|^this artifact$|^this equipment$/i.test(text)) {
        return String(ctx.sourceId || '').trim();
      }
      if (/^first target|^first of those|^second target|^second of those/i.test(text)) {
        const chosenIds = Array.isArray(ctx.selectorContext?.chosenObjectIds)
          ? ctx.selectorContext.chosenObjectIds.map((id) => String(id || '').trim()).filter(Boolean)
          : [];
        const creatureIds = chosenIds.filter((id) => {
          const permanent = battlefieldView.find((entry) => String((entry as any)?.id || '').trim() === id);
          if (!permanent) return false;
          const typeLine = String((permanent as any)?.type_line || (permanent as any)?.card?.type_line || '').toLowerCase();
          return typeLine.includes('creature');
        });
        const pool = creatureIds.length >= 2 ? creatureIds : chosenIds;
        const index = /^first/i.test(text) ? 0 : 1;
        return pool[index] || '';
      }
    }
    const matches = resolveDirectBattlefieldPermanents(battlefieldView, selector as any, ctx);
    if (matches.length === 1) return String((matches[0] as any)?.id || '').trim();
    if (matches.length > 1 && selector.kind === 'raw' && /^target\b/i.test(String(selector.text || ''))) {
      return String((matches[0] as any)?.id || '').trim();
    }
    return '';
  };

  const chosenIds = Array.isArray(ctx.selectorContext?.chosenObjectIds)
    ? ctx.selectorContext.chosenObjectIds.map(id => String(id || '').trim()).filter(Boolean)
    : [];
  const creatureChosenIds = chosenIds.filter((id) => {
    const permanent = battlefieldView.find((entry) => String((entry as any)?.id || '').trim() === id);
    if (!permanent) return false;
    const typeLine = String((permanent as any)?.type_line || (permanent as any)?.card?.type_line || '').toLowerCase();
    return typeLine.includes('creature');
  });
  const exchangeChosenIds = creatureChosenIds.length >= 2 ? creatureChosenIds : chosenIds;
  const battlefieldIdSet = new Set(
    battlefieldView.map((permanent) => String((permanent as any)?.id || '').trim()).filter(Boolean)
  );
  const boundChosenIds =
    exchangeChosenIds.length >= 2 &&
    exchangeChosenIds[0] !== exchangeChosenIds[1] &&
    battlefieldIdSet.has(exchangeChosenIds[0]) &&
    battlefieldIdSet.has(exchangeChosenIds[1])
      ? exchangeChosenIds
      : null;
  const firstPermanentId =
    boundChosenIds?.[0] ||
    resolveExchangePermanentId(step.first) ||
    chosenIds[0] ||
    String(ctx.sourceId || ctx.targetPermanentId || '').trim();
  const secondPermanentId =
    boundChosenIds?.[1] || resolveExchangePermanentId(step.second) || chosenIds[1] || '';

  if (!firstPermanentId || !secondPermanentId) {
    return {
      applied: false,
      message: `Skipped exchange-control (needs two deterministic targets): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const firstIndex = battlefield.findIndex(permanent => String((permanent as any)?.id || '').trim() === firstPermanentId);
  const secondIndex = battlefield.findIndex(permanent => String((permanent as any)?.id || '').trim() === secondPermanentId);
  if (firstIndex < 0 || secondIndex < 0 || firstIndex === secondIndex) {
    return {
      applied: false,
      message: `Skipped exchange-control (targets not on battlefield): ${step.raw}`,
      reason: 'impossible_action',
    };
  }

  const firstPermanent = battlefield[firstIndex] as any;
  const secondPermanent = battlefield[secondIndex] as any;
  const firstController = String(firstPermanent?.controller || '').trim();
  const secondController = String(secondPermanent?.controller || '').trim();
  if (exchangeRequiresSharedCardType(step) && !exchangeTargetsShareCardType(firstPermanent, secondPermanent)) {
    return {
      applied: true,
      state,
      log: [`Skipped exchange-control (do not share a card type): ${step.raw}`],
    };
  }
  if (!firstController || !secondController) {
    return {
      applied: false,
      message: `Skipped exchange-control (target missing controller): ${step.raw}`,
      reason: 'impossible_action',
    };
  }

  battlefield[firstIndex] = { ...firstPermanent, controller: secondController, summoningSickness: true } as BattlefieldPermanent;
  battlefield[secondIndex] = { ...secondPermanent, controller: firstController, summoningSickness: true } as BattlefieldPermanent;
  const nextState: any = {
    ...(state as any),
    battlefield,
    permanentControlEffects: [...(((state as any).permanentControlEffects || []) as any[])],
  };
  if (firstController !== secondController) {
    // Layer 2: one paired, timestamped effect for both halves of the exchange.
    registerExchangeControlEffects(nextState, [
      { permanentId: firstPermanentId, originalController: firstController, newController: secondController, duration: 'permanent' },
      { permanentId: secondPermanentId, originalController: secondController, newController: firstController, duration: 'permanent' },
    ]);
  }

  return {
    applied: true,
    state: nextState as GameState,
    log: [`${firstPermanentId} and ${secondPermanentId} exchange control`],
  };
}

function resolveCopyPermanentSourceObject(
  step: Extract<OracleEffectStep, { kind: 'copy_permanent' }>,
  runtime?: RecentBattlefieldRuntime,
  state?: GameState,
  ctx?: OracleIRExecutionContext
): any | null {
  if (step.source.kind !== 'raw') return null;
  const reference = String(step.source.text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+for as long as\b.*$/i, '')
    .replace(/\s+until this aura leaves the battlefield\b.*$/i, '');
  const movedCards = Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : [];

  if (reference === 'that card' || reference === 'it' || reference === 'the exiled card') {
    if (movedCards.length === 1) return movedCards[0];
    if (state && ctx) {
      const sourceId = String(ctx.sourceId || '').trim();
      const linked = sourceId ? findCardsExiledWithSource(state, sourceId, { cardType: 'any' }) : [];
      if (linked.length > 0) {
        const chosenObjectIds = Array.isArray(ctx.selectorContext?.chosenObjectIds)
          ? ctx.selectorContext.chosenObjectIds.map(id => String(id || '').trim()).filter(Boolean)
          : [];
        const preferred = linked.find(match => chosenObjectIds.includes(String(match.cardId || '').trim()));
        const creatureLinked = linked.find(match => getCardTypeLineLower(match.card).includes('creature'));
        const resolved = preferred || creatureLinked || (linked.length === 1 ? linked[0] : undefined);
        if (resolved) {
          const linkedCard = resolved.card || resolved;
          return linkedCard || null;
        }
      }
    }
    return null;
  }

  if (
    (reference === 'that creature' || reference === 'the creature') &&
    state &&
    ctx
  ) {
    const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
    const matches = resolveDirectBattlefieldPermanents(
      battlefield,
      { kind: 'raw', text: reference },
      ctx
    );
    if (matches.length === 1) {
      const match = matches[0] as any;
      return match?.card || match;
    }
  }

  if (
    (reference.includes('exiled with it') || reference.includes('creature card exiled with')) &&
    state &&
    ctx
  ) {
    const sourceId = String(ctx.sourceId || '').trim();
    const linked = sourceId ? findCardsExiledWithSource(state, sourceId, { cardType: 'creature' }) : [];
    if (linked.length > 0) {
      const chosenObjectIds = Array.isArray(ctx.selectorContext?.chosenObjectIds)
        ? ctx.selectorContext.chosenObjectIds.map(id => String(id || '').trim()).filter(Boolean)
        : [];
      const preferred = linked.find(match => chosenObjectIds.includes(String(match.cardId || '').trim()));
      const resolved = preferred || (linked.length === 1 ? linked[0] : undefined);
      if (resolved) {
        const linkedCard = resolved.card || resolved;
        return linkedCard || null;
      }
    }
  }

  if (
    (reference.includes('crewed it this turn') || reference.includes('that crewed it')) &&
    state &&
    ctx
  ) {
    const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
    const sourceId = String(ctx.sourceId || '').trim();
    const sourcePermanent = sourceId
      ? battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === sourceId)
      : undefined;
    const crewedId = String(
      (sourcePermanent as any)?.crewedThisTurnCreatureId ||
      (sourcePermanent as any)?.lastCrewedCreatureId ||
      ctx.targetCreatureId ||
      ctx.selectorContext?.targetCreatureId ||
      ''
    ).trim();
    if (crewedId) {
      const crewedPermanent = battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === crewedId);
      if (crewedPermanent && permanentMatchesType(crewedPermanent, 'creature')) {
        return (crewedPermanent as any)?.card || crewedPermanent;
      }
    }
    const boundIds = collectBoundBattlefieldIds(ctx);
    const crewedCandidates = battlefield.filter((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (!boundIds.includes(permanentId) || permanentId === sourceId) return false;
      if (!permanentMatchesType(perm, 'creature')) return false;
      return !/\blegendary\b/i.test(getExecutorTypeLineLower(perm));
    });
    if (crewedCandidates.length === 1) {
      return (crewedCandidates[0] as any)?.card || crewedCandidates[0];
    }
  }

  return null;
}

function normalizeCopyPermanentTargetText(value: string): string {
  const trimmed = normalizeBattlefieldTargetReferenceText(value)
    .replace(/^until (?:end of turn|your next turn),\s*/i, '')
    .replace(/^as this creature transforms into this permanent,\s*it becomes a copy of .+$/i, 'this permanent')
    .replace(/\s+becomes a copy of .+$/i, '')
    .trim();
  if (/^this (vehicle|creature|permanent|artifact)$/i.test(trimmed)) return trimmed;
  return trimmed;
}

export function applyCopyPermanentStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'copy_permanent' }>,
  ctx: OracleIRExecutionContext,
  runtime?: RecentBattlefieldRuntime
): BattlefieldStepHandlerResult {
  const special = trySpecialCopyPermanentStep(state, step, ctx, runtime);
  if (special) return special;

  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const normalizedCopyTargetText = (() => {
    const raw = String(step.raw || '');
    if (/transforms into this permanent/i.test(raw)) return 'this permanent';
    return normalizeCopyPermanentTargetText(String((step.target as any)?.text || raw));
  })();
  const normalizedCopyTarget = {
    ...(step.target as any),
    text: normalizedCopyTargetText,
  };
  const boundTokenTargets =
    /^target token you control$/i.test(normalizedCopyTargetText)
      ? battlefield.filter((perm: any) => {
          const permanentId = String((perm as any)?.id || '').trim();
          if (!collectBoundBattlefieldIds(ctx).includes(permanentId)) return false;
          return Boolean((perm as any)?.isToken) || /\btoken\b/i.test(getExecutorTypeLineLower(perm));
        })
      : [];
  const directTargets =
    boundTokenTargets.length > 0
      ? boundTokenTargets.slice(0, 1)
      : resolveDirectBattlefieldPermanents(battlefield, normalizedCopyTarget as any, ctx);
  const targetIds = Array.from(
    new Set(
      directTargets
        .map((perm: any) => String((perm as any)?.id || '').trim())
        .filter(Boolean)
    )
  );

  if (targetIds.length !== 1) {
    return {
      applied: false,
      message: `Skipped copy permanent (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  const sourceObject = resolveCopyPermanentSourceObject(step, runtime, state, ctx);
  if (!sourceObject) {
    return {
      applied: false,
      message: `Skipped copy permanent (copy source unavailable): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  const sourceCard = ((sourceObject as any)?.card || sourceObject || {}) as any;
  const sourceTypeLine = String(sourceCard?.type_line || (sourceObject as any)?.type_line || '').trim();
  const sourceOracleText = String(sourceCard?.oracle_text || (sourceObject as any)?.oracle_text || '').trim();
  const rawRetainedAbilityText = String(step.retainAbilityText || '').trim();
  const copiedName = String(sourceCard?.name || (sourceObject as any)?.name || '').trim();
  const copiedPower = readCharacteristicNumber(
    (sourceObject as any)?.basePower,
    (sourceObject as any)?.power,
    sourceCard?.power
  );
  const copiedToughness = readCharacteristicNumber(
    (sourceObject as any)?.baseToughness,
    (sourceObject as any)?.toughness,
    sourceCard?.toughness
  );

  const nextBattlefield = battlefield.map((perm: any) => {
    const permanentId = String((perm as any)?.id || '').trim();
    if (!targetIds.includes(permanentId)) return perm;

    const retainedAbilityText = /^it has this ability$/i.test(rawRetainedAbilityText)
      ? String((perm as any)?.card?.oracle_text || (perm as any)?.oracle_text || step.raw || '').trim()
      : rawRetainedAbilityText;
    const copiedOracleText = [sourceOracleText, retainedAbilityText].filter(Boolean).join('\n').trim();

    const grantedAbilities = Array.isArray((perm as any)?.grantedAbilities)
      ? (perm as any).grantedAbilities
          .map((entry: unknown) => String(entry || '').trim())
          .filter(Boolean)
      : [];
    if (retainedAbilityText && !grantedAbilities.includes(retainedAbilityText)) {
      grantedAbilities.push(retainedAbilityText);
    }

    const existingCard =
      (perm as any)?.card && typeof (perm as any).card === 'object'
        ? { ...(perm as any).card }
        : {};
    const nextCard = {
      ...existingCard,
      ...(copiedName ? { name: copiedName } : {}),
      ...(sourceTypeLine ? { type_line: sourceTypeLine } : {}),
      ...(copiedOracleText ? { oracle_text: copiedOracleText } : {}),
      ...(Array.isArray(sourceCard?.colors) ? { colors: [...sourceCard.colors] } : {}),
      ...(sourceCard?.mana_cost || sourceCard?.manaCost
        ? { mana_cost: sourceCard?.mana_cost ?? sourceCard?.manaCost, manaCost: sourceCard?.mana_cost ?? sourceCard?.manaCost }
        : {}),
      ...(copiedPower !== undefined ? { power: String(copiedPower) } : {}),
      ...(copiedToughness !== undefined ? { toughness: String(copiedToughness) } : {}),
      id: String(existingCard?.id || (perm as any)?.id || sourceCard?.id || '').trim() || existingCard?.id,
    };

    return {
      ...perm,
      ...(copiedName ? { name: copiedName } : {}),
      ...(sourceTypeLine ? { cardType: sourceTypeLine, type_line: sourceTypeLine } : {}),
      ...(copiedOracleText ? { oracle_text: copiedOracleText } : {}),
      ...(Array.isArray(sourceCard?.colors) ? { colors: [...sourceCard.colors] } : {}),
      ...(sourceCard?.mana_cost || sourceCard?.manaCost
        ? { manaCost: sourceCard?.mana_cost ?? sourceCard?.manaCost }
        : {}),
      ...(copiedPower !== undefined
        ? { power: copiedPower, basePower: copiedPower, effectivePower: undefined }
        : {}),
      ...(copiedToughness !== undefined
        ? { toughness: copiedToughness, baseToughness: copiedToughness, effectiveToughness: undefined }
        : {}),
      ...(grantedAbilities.length > 0 ? { grantedAbilities } : {}),
      copiedFromCardId: String(sourceCard?.id || '').trim() || undefined,
      card: nextCard,
    } as BattlefieldPermanent;
  });

  return {
    applied: true,
    state: {
      ...(state as any),
      battlefield: nextBattlefield as any,
    } as GameState,
    log: [`${targetIds[0]} became a copy of ${copiedName || 'the exiled card'}`],
  };
}

