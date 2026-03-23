import type { GameState, PlayerID, BattlefieldPermanent, OracleAutomationGap } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type {
  OracleIRExecutionContext,
  OracleIRExecutionEventHint,
  OracleIRExecutionOptions,
  OracleIRExecutionResult,
  OracleIRSelectorContext,
} from './oracleIRExecutionTypes';
import {
  appendOracleAutomationGapRecords,
  createOracleAutomationGapRecord,
} from './oracleIRAutomationGaps';
import {
  parseSimpleBattlefieldSelector,
  parseSimplePermanentTypeFromText,
} from './oracleIRExecutorBattlefieldParser';
import type { SimpleBattlefieldSelector, SimplePermanentType } from './oracleIRExecutorBattlefieldParser';
import {
  getCardsFromPlayerZone,
  getContextExcludedId,
  getContextSourceObject,
  getContextTargetObject,
} from './oracleIRExecutorContextRefUtils';
import {
  collectCommandZoneObjects as collectCommandZoneObjectsFromUtils,
  getHighestCommanderTaxForController,
  isCommanderObject as isCommanderObjectFromUtils,
} from './oracleIRExecutorCommanderUtils';
import { applyChooseModeStep } from './oracleIRExecutorChooseModeStepHandlers';
import {
  applyDestroyStep,
  applyExileStep,
  applySacrificeStep,
  applyTapOrUntapStep,
} from './oracleIRExecutorBattlefieldStepHandlers';
import {
  getProcessedBattlefield,
  countControlledByClass,
  normalizeControlledClassKey,
} from './oracleIRExecutorCreatureStepUtils';
import { applyDealDamageStep } from './oracleIRExecutorDamageStepHandlers';
import { applyExileTopStep, applyImpulseExileTopStep } from './oracleIRExecutorExileStepHandlers';
import { applyGoadStep } from './oracleIRExecutorGoadStepHandlers';
import {
  countCardsByClasses as countCardsByClassesFromUtils,
  countNegatedClass as countNegatedClassFromUtils,
  countPermanentsByClasses as countPermanentsByClassesFromUtils,
  greatestManaValueAmongCards as greatestManaValueAmongCardsFromUtils,
  greatestPowerAmongCreatureCards as greatestPowerAmongCreatureCardsFromUtils,
  greatestSharedCreatureSubtypeCount as greatestSharedCreatureSubtypeCountFromUtils,
  greatestStatAmongCreatures as greatestStatAmongCreaturesFromUtils,
  highestManaValueAmongPermanents as highestManaValueAmongPermanentsFromUtils,
  leastStatAmongCreatures as leastStatAmongCreaturesFromUtils,
  lowestManaValueAmongPermanents as lowestManaValueAmongPermanentsFromUtils,
  parseCardClassList as parseCardClassListFromUtils,
  parseClassList as parseClassListFromUtils,
  parseColorQualifiedClassSpec as parseColorQualifiedClassSpecFromUtils,
} from './oracleIRExecutorModifyPtClassUtils';
import { evaluateModifyPtCondition } from './oracleIRExecutorModifyPtCondition';
import { applyModifyPtPerRevealedStep, applyModifyPtStep } from './oracleIRExecutorModifyPtStepHandlers';
import {
  findObjectByIdInState as findObjectByIdFromState,
  findObjectByNameInState as findObjectByNameFromState,
  getCounterCountOnObject as getCounterCountOnObjectFromState,
  getCreatureSubtypeKeys as getCreatureSubtypeKeysFromState,
  hasFlyingKeyword as hasFlyingKeywordFromState,
  isAttackingObject as isAttackingObjectFromState,
  normalizeModifyPtWhereRaw,
  resolveContextPlayerFromState as resolveContextPlayerFromStateHelper,
} from './oracleIRExecutorModifyPtWhereUtils';
import {
  countManaSymbolsInManaCost as countManaSymbolsInManaCostFromUtils,
  getAmountOfManaSpent as getAmountOfManaSpentFromUtils,
  getAmountOfSpecificManaSymbolSpent as getAmountOfSpecificManaSymbolSpentFromUtils,
  getColorsFromObject as getColorsFromObjectFromUtils,
  getColorsOfManaSpent as getColorsOfManaSpentFromUtils,
  normalizeManaColorCode as normalizeManaColorCodeFromUtils,
} from './oracleIRExecutorManaUtils';
import {
  applyAddManaStep,
  applyDiscardStep,
  applyDrawStep,
  applyGainLifeStep,
  applyLoseLifeStep,
  applyMillStep,
  applyScryStep,
  applySurveilStep,
} from './oracleIRExecutorPlayerStepHandlers';
import { applyMoveZoneStep } from './oracleIRExecutorMoveZoneStepHandlers';
import { applyCreateTokenStep } from './oracleIRExecutorTokenStepHandlers';
import {
  getExecutorTypeLineLower,
  hasExecutorClass as hasExecutorClassFromPermanentUtils,
  isExecutorCreature,
} from './oracleIRExecutorPermanentUtils';
import {
  countCardsExiledWithSource,
  getCardTypeLineLower,
  getCardManaValue,
  getCardTypesFromTypeLine,
  normalizeOracleText,
  quantityToNumber,
  resolvePlayers,
} from './oracleIRExecutorPlayerUtils';
import { findPlayerById as findPlayerByIdFromState } from './oracleIRExecutorStateUtils';

export type {
  OracleIRExecutionContext,
  OracleIRExecutionEventHint,
  OracleIRExecutionOptions,
  OracleIRExecutionResult,
  OracleIRSelectorContext,
} from './oracleIRExecutionTypes';

/**
 * Build/augment an execution context from trigger/target event hints.
 *
 * This keeps selector binding logic in one place so callers can pass whichever
 * event fields they already have, and relational selectors like
 * "each of those opponents" can resolve with minimal glue code.
 */
export function buildOracleIRExecutionContext(
  base: OracleIRExecutionContext,
  hint?: OracleIRExecutionEventHint
): OracleIRExecutionContext {
  const normalizeId = (value: unknown): PlayerID | undefined => {
    if (typeof value !== 'string' && typeof value !== 'number') return undefined;
    const normalized = String(value).trim();
    return normalized ? (normalized as PlayerID) : undefined;
  };

  const normalizedControllerId = normalizeId(base.controllerId) ?? base.controllerId;
  const baseSel = base.selectorContext;

  const dedupe = (ids: readonly PlayerID[] | undefined): readonly PlayerID[] | undefined => {
    if (!Array.isArray(ids) || ids.length === 0) return undefined;
    const out: PlayerID[] = [];
    const seen = new Set<PlayerID>();
    for (const id of ids) {
      const normalized = normalizeId(id);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
    }
    return out.length > 0 ? out : undefined;
  };

  const normalizeSpellTypes = (value: unknown): readonly string[] | undefined => {
    if (typeof value !== 'string') return undefined;
    const lower = value.toLowerCase();
    const known = ['artifact', 'battle', 'creature', 'enchantment', 'instant', 'kindred', 'land', 'planeswalker', 'sorcery'];
    const out = known.filter(type => lower.includes(type));
    if (lower.includes('tribal') && !out.includes('kindred')) out.push('kindred');
    return out.length > 0 ? out : undefined;
  };

  const hintTargetOpponentId = normalizeId(hint?.targetOpponentId);
  const hintTargetPlayerId = normalizeId(hint?.targetPlayerId);
  const hintTargetPermanentId = normalizeId(hint?.targetPermanentId);
  const baseTargetOpponentId = normalizeId(baseSel?.targetOpponentId);
  const baseTargetPlayerId = normalizeId(baseSel?.targetPlayerId);

  const eachOfThoseOpponents =
    dedupe(hint?.affectedOpponentIds) ??
    dedupe(hint?.opponentsDealtDamageIds) ??
    dedupe(hint?.affectedPlayerIds) ??
    dedupe(hintTargetOpponentId ? [hintTargetOpponentId] : undefined) ??
    dedupe(hintTargetPlayerId ? [hintTargetPlayerId] : undefined) ??
    baseSel?.eachOfThoseOpponents;

  const sanitizedEachOfThoseOpponents = eachOfThoseOpponents
    ? dedupe(eachOfThoseOpponents.filter(id => id !== normalizedControllerId))
    : undefined;

  const singleton = (ids: readonly PlayerID[] | undefined): PlayerID | undefined =>
    Array.isArray(ids) && ids.length === 1 ? ids[0] : undefined;

  const dedupedAffectedPlayers = dedupe(hint?.affectedPlayerIds);
  const dedupedAffectedOpponents = dedupe(
    (hint?.affectedOpponentIds || []).filter(id => normalizeId(id) !== normalizedControllerId) as PlayerID[]
  );
  const dedupedOpponentsDealtDamage = dedupe(
    (hint?.opponentsDealtDamageIds || []).filter(id => normalizeId(id) !== normalizedControllerId) as PlayerID[]
  );
  const explicitTargetOpponentId =
    hintTargetOpponentId && hintTargetOpponentId !== normalizedControllerId
      ? hintTargetOpponentId
      : undefined;
  const inferredTargetOpponentId =
    singleton(sanitizedEachOfThoseOpponents) ??
    singleton(dedupedAffectedOpponents) ??
    singleton(dedupedOpponentsDealtDamage);
  const inferredTargetPlayerId =
    singleton(dedupedAffectedPlayers) ??
    inferredTargetOpponentId;
  const baseTargetFromOpponent = baseTargetOpponentId;
  const baseTargetFromPlayer =
    baseTargetPlayerId && baseTargetPlayerId !== normalizedControllerId
      ? baseTargetPlayerId
      : undefined;

  const selectorContext: OracleIRSelectorContext = {
    targetPlayerId:
      hintTargetPlayerId ??
      explicitTargetOpponentId ??
      inferredTargetPlayerId ??
      baseTargetPlayerId ??
      baseTargetFromOpponent,
    targetOpponentId:
      explicitTargetOpponentId ??
      inferredTargetOpponentId ??
      baseTargetOpponentId ??
      baseTargetFromPlayer,
    ...(sanitizedEachOfThoseOpponents ? { eachOfThoseOpponents: sanitizedEachOfThoseOpponents } : {}),
    ...(Array.isArray(baseSel?.chosenObjectIds) && baseSel.chosenObjectIds.length > 0
      ? {
          chosenObjectIds: baseSel.chosenObjectIds
            .map(id => String(id || '').trim())
            .filter(Boolean),
        }
      : {}),
  };

  const referenceSpellTypes =
    normalizeSpellTypes(hint?.spellType) ??
    (Array.isArray(base.referenceSpellTypes) && base.referenceSpellTypes.length > 0
      ? base.referenceSpellTypes
      : undefined);

  if (!selectorContext.targetPlayerId && !selectorContext.targetOpponentId && !selectorContext.eachOfThoseOpponents) {
    if (
      normalizedControllerId === base.controllerId &&
      !referenceSpellTypes &&
      !hintTargetPermanentId &&
      !hint?.tapOrUntapChoice
    ) {
      return base;
    }
    return {
      ...base,
      controllerId: normalizedControllerId,
      ...(hintTargetPermanentId ? { targetPermanentId: hintTargetPermanentId } : {}),
      ...(hint?.tapOrUntapChoice ? { tapOrUntapChoice: hint.tapOrUntapChoice } : {}),
      ...(referenceSpellTypes ? { referenceSpellTypes } : {}),
    };
  }

  return {
    ...base,
    controllerId: normalizedControllerId,
    selectorContext,
    ...(hintTargetPermanentId ? { targetPermanentId: hintTargetPermanentId } : {}),
    ...(hint?.tapOrUntapChoice ? { tapOrUntapChoice: hint.tapOrUntapChoice } : {}),
    ...(referenceSpellTypes ? { referenceSpellTypes } : {}),
  };
}

function evaluateModifyPtWhereX(
  state: GameState,
  controllerId: PlayerID,
  whereRaw: string,
  targetCreatureId?: string,
  ctx?: OracleIRExecutionContext,
  runtime?: {
    readonly lastRevealedCardCount?: number;
    readonly lastDiscardedCardCount?: number;
    readonly lastExiledCardCount?: number;
    readonly lastExiledCards?: readonly any[];
    readonly lastGoadedCreatures?: readonly BattlefieldPermanent[];
    readonly lastSacrificedCreaturesPowerTotal?: number;
    readonly lastExcessDamageDealtThisWay?: number;
    readonly lastScryLookedAtCount?: number;
  },
  depth = 0
): number | null {
  if (depth > 3) return null;

  const raw = normalizeModifyPtWhereRaw(whereRaw);

  const battlefield = getProcessedBattlefield(state);
  const controlled = battlefield.filter((p: any) => String((p as any)?.controller || '').trim() === controllerId);
  const opponentsControlled = battlefield.filter((p: any) => String((p as any)?.controller || '').trim() !== controllerId);
  const typeLineLower = (p: any): string => getExecutorTypeLineLower(p);
  const isAttackingObject = (obj: any): boolean => isAttackingObjectFromState(obj);
  const hasFlyingKeyword = (obj: any): boolean => hasFlyingKeywordFromState(obj);
  const getCreatureSubtypeKeys = (obj: any): readonly string[] => getCreatureSubtypeKeysFromState(obj, typeLineLower);

  const resolveContextPlayer = (): any | null => resolveContextPlayerFromStateHelper(state, ctx);

  const findPlayerById = (playerIdRaw: string): any | null => findPlayerByIdFromState(state, playerIdRaw);

  const findObjectById = (idRaw: string): any | null => findObjectByIdFromState(state, battlefield, idRaw);

  const findObjectByName = (nameRaw: string): any | null => findObjectByNameFromState(state, battlefield, nameRaw, ctx);

  const getExcludedId = (): string => getContextExcludedId(targetCreatureId, ctx);

  const getSourceRef = (): any | null => getContextSourceObject(ctx, findObjectById);

  const getTargetRef = (): any | null => getContextTargetObject(targetCreatureId, findObjectById);


  {
    const m = raw.match(/^x is the damage dealt to your opponents this turn$/i);
    if (m) {
      const stateAny: any = state as any;
      const byPlayer = stateAny?.damageTakenThisTurnByPlayer;
      if (!byPlayer || typeof byPlayer !== 'object') return null;

      return (state.players || []).reduce((sum: number, p: any) => {
        const id = String((p as any)?.id || '').trim();
        if (!id || id === controllerId) return sum;
        const dealt = Number((byPlayer as Record<string, unknown>)[id]);
        if (!Number.isFinite(dealt)) return sum;
        return sum + Math.max(0, dealt);
      }, 0);
    }
  }

  const getCounterCountOnObject = (obj: any, counterNameRaw: string): number | null => getCounterCountOnObjectFromState(obj, counterNameRaw);

  const isCommanderObject = (obj: any): boolean => isCommanderObjectFromUtils(obj);

  const collectCommandZoneObjects = (): readonly any[] =>
    collectCommandZoneObjectsFromUtils(state, controllerId, findObjectById);

  const countCardsByClasses = (cards: readonly any[], classes: readonly string[]): number =>
    countCardsByClassesFromUtils(cards, classes, typeLineLower);

  const getColorsFromObject = (obj: any): readonly string[] => getColorsFromObjectFromUtils(obj);

  const getColorsFromPermanent = (perm: any): readonly string[] => getColorsFromObject(perm);

  const countManaSymbolsInManaCost = (obj: any, colorSymbol: string): number =>
    countManaSymbolsInManaCostFromUtils(obj, colorSymbol);

  const normalizeManaColorCode = (value: unknown): string | null => normalizeManaColorCodeFromUtils(value);

  const getColorsOfManaSpent = (obj: any): number | null => getColorsOfManaSpentFromUtils(obj);

  const getAmountOfManaSpent = (obj: any): number | null => getAmountOfManaSpentFromUtils(obj);

  const getAmountOfSpecificManaSymbolSpent = (obj: any, symbolRaw: string): number | null =>
    getAmountOfSpecificManaSymbolSpentFromUtils(obj, symbolRaw);

  const parseCardClassList = (text: string): readonly string[] | null => parseCardClassListFromUtils(text);

  const evaluateInner = (expr: string): number | null => {
    return evaluateModifyPtWhereX(state, controllerId, `x is ${expr}`, targetCreatureId, ctx, runtime, depth + 1);
  };

  {
    const m = raw.match(/^x is (one|\d+) plus (.+)$/i);
    if (m) {
      const addend = String(m[1] || '').toLowerCase() === 'one' ? 1 : parseInt(String(m[1] || '0'), 10) || 0;
      const inner = evaluateInner(String(m[2] || ''));
      if (inner === null) return null;
      return inner + addend;
    }
  }

  {
    const m = raw.match(/^x is (one|\d+) minus (.+)$/i);
    if (m) {
      const minuend = String(m[1] || '').toLowerCase() === 'one' ? 1 : parseInt(String(m[1] || '0'), 10) || 0;
      const inner = evaluateInner(String(m[2] || ''));
      if (inner === null) return null;
      return minuend - inner;
    }
  }

  {
    const m = raw.match(/^x is (.+) minus (.+)$/i);
    if (m) {
      const minuend = evaluateInner(String(m[1] || ''));
      if (minuend !== null) {
        const subtrahend = evaluateInner(String(m[2] || ''));
        if (subtrahend !== null) return minuend - subtrahend;
      }
    }
  }

  {
    const m = raw.match(/^x is twice (.+)$/i);
    if (m) {
      const inner = evaluateInner(String(m[1] || ''));
      if (inner === null) return null;
      return inner * 2;
    }
  }

  {
    const m = raw.match(/^x is half (?:the|this|that) (.+?)(?:, rounded (up|down))?$/i);
    if (m) {
      const expr = String(m[1] || '').trim();
      let inner = evaluateInner(expr);
      if (inner === null && !/^the\s+/i.test(expr)) {
        inner = evaluateInner(`the ${expr}`);
      }
      if (inner === null) return null;
      const mode = String(m[2] || '').toLowerCase();
      if (mode === 'up') return Math.ceil(inner / 2);
      return Math.floor(inner / 2);
    }
  }

  {
    const m = raw.match(/^x is (.+) minus (one|\d+)$/i);
    if (m) {
      const inner = evaluateInner(String(m[1] || ''));
      if (inner === null) return null;
      const subtrahend = String(m[2] || '').toLowerCase() === 'one' ? 1 : parseInt(String(m[2] || '0'), 10) || 0;
      return inner - subtrahend;
    }
  }

  const parseClassList = (text: string): readonly string[] | null => parseClassListFromUtils(text);

  const parseColorQualifiedClassSpec = (
    text: string
  ): { readonly classes: readonly string[]; readonly requiredColor?: string } | null =>
    parseColorQualifiedClassSpecFromUtils(text, normalizeManaColorCode);

  const countByClasses = (
    permanents: readonly BattlefieldPermanent[],
    classes: readonly string[],
    requiredColor?: string
  ): number => countPermanentsByClassesFromUtils(permanents, classes, getColorsFromPermanent, typeLineLower, requiredColor);

  const hasExecutorClass = (permanent: BattlefieldPermanent | any, klass: string): boolean =>
    hasExecutorClassFromPermanentUtils(permanent, klass);

  const countNegatedClass = (
    permanents: readonly BattlefieldPermanent[],
    base: 'creature' | 'permanent',
    excludedQualifier: string,
    excludedId?: string
  ): number => countNegatedClassFromUtils(permanents, base, excludedQualifier, hasExecutorClass, typeLineLower, excludedId);

  const leastStatAmongCreatures = (
    permanents: readonly BattlefieldPermanent[],
    which: 'power' | 'toughness',
    opts?: { readonly excludedId?: string; readonly excludedSubtype?: string }
  ): number => leastStatAmongCreaturesFromUtils(permanents, which, hasExecutorClass, typeLineLower, opts);

  const greatestStatAmongCreatures = (
    permanents: readonly BattlefieldPermanent[],
    which: 'power' | 'toughness',
    opts?: { readonly excludedId?: string; readonly excludedSubtype?: string }
  ): number => greatestStatAmongCreaturesFromUtils(permanents, which, hasExecutorClass, typeLineLower, opts);

  const greatestPowerAmongCreatureCards = (cards: readonly any[]): number =>
    greatestPowerAmongCreatureCardsFromUtils(cards, typeLineLower);

  const greatestManaValueAmongCards = (cards: readonly any[]): number =>
    greatestManaValueAmongCardsFromUtils(cards, getCardManaValue);

  const greatestSharedCreatureSubtypeCount = (permanents: readonly BattlefieldPermanent[]): number =>
    greatestSharedCreatureSubtypeCountFromUtils(permanents, hasExecutorClass, getCreatureSubtypeKeys);

  const lowestManaValueAmongPermanents = (
    permanents: readonly BattlefieldPermanent[],
    opts?: { readonly excludedId?: string; readonly excludedQualifier?: string }
  ): number => lowestManaValueAmongPermanentsFromUtils(permanents, getCardManaValue, hasExecutorClass, typeLineLower, opts);

  const highestManaValueAmongPermanents = (
    permanents: readonly BattlefieldPermanent[],
    opts?: { readonly excludedId?: string; readonly excludedQualifier?: string }
  ): number => highestManaValueAmongPermanentsFromUtils(permanents, getCardManaValue, hasExecutorClass, typeLineLower, opts);

  {
    const m = raw.match(/^x is the number of (other )?non[- ]?([a-z][a-z-]*) creatures you control$/i);
    if (m) {
      const isOther = Boolean(String(m[1] || '').trim());
      const excludedQualifier = String(m[2] || '').toLowerCase();
      const excludedId = isOther ? getExcludedId() : '';
      return countNegatedClass(controlled, 'creature', excludedQualifier, excludedId || undefined);
    }
  }

  {
    const m = raw.match(/^x is the number of (other )?non[- ]?([a-z][a-z-]*) creatures (?:your opponents control|an opponent controls|you don['’]?t control|you do not control)$/i);
    if (m) {
      const isOther = Boolean(String(m[1] || '').trim());
      const excludedQualifier = String(m[2] || '').toLowerCase();
      const excludedId = isOther ? getExcludedId() : '';
      return countNegatedClass(opponentsControlled, 'creature', excludedQualifier, excludedId || undefined);
    }
  }

  {
    const m = raw.match(/^x is the number of (other )?non[- ]?([a-z][a-z-]*) creatures on (?:the )?battlefield$/i);
    if (m) {
      const isOther = Boolean(String(m[1] || '').trim());
      const excludedQualifier = String(m[2] || '').toLowerCase();
      const excludedId = isOther ? getExcludedId() : '';
      return countNegatedClass(battlefield, 'creature', excludedQualifier, excludedId || undefined);
    }
  }

  {
    const m = raw.match(/^x is the number of (other )?non[- ]?([a-z][a-z-]*) permanents you control$/i);
    if (m) {
      const isOther = Boolean(String(m[1] || '').trim());
      const excludedQualifier = String(m[2] || '').toLowerCase();
      const excludedId = isOther ? getExcludedId() : '';
      return countNegatedClass(controlled, 'permanent', excludedQualifier, excludedId || undefined);
    }
  }

  {
    const m = raw.match(/^x is the number of (other )?non[- ]?([a-z][a-z-]*) permanents (?:your opponents control|an opponent controls|you don['’]?t control|you do not control)$/i);
    if (m) {
      const isOther = Boolean(String(m[1] || '').trim());
      const excludedQualifier = String(m[2] || '').toLowerCase();
      const excludedId = isOther ? getExcludedId() : '';
      return countNegatedClass(opponentsControlled, 'permanent', excludedQualifier, excludedId || undefined);
    }
  }

  {
    const m = raw.match(/^x is the number of (other )?non[- ]?([a-z][a-z-]*) permanents on (?:the )?battlefield$/i);
    if (m) {
      const isOther = Boolean(String(m[1] || '').trim());
      const excludedQualifier = String(m[2] || '').toLowerCase();
      const excludedId = isOther ? getExcludedId() : '';
      return countNegatedClass(battlefield, 'permanent', excludedQualifier, excludedId || undefined);
    }
  }

  {
    const m = raw.match(/^x is the number of (.+) you control plus (?:the number of )?(.+) cards? in your graveyard$/i);
    if (m) {
      const controlledClasses = parseClassList(String(m[1] || ''));
      const graveyardClasses = parseCardClassList(String(m[2] || ''));
      if (!controlledClasses || !graveyardClasses) return null;

      const controller = findPlayerById(controllerId);
      if (!controller) return null;
      const gy = Array.isArray(controller.graveyard) ? controller.graveyard : [];

      return countByClasses(controlled, controlledClasses) + countCardsByClasses(gy, graveyardClasses);
    }
  }

  {
    const m = raw.match(/^x is the number of mounts and vehicles(?: you control)?$/i);
    if (m) {
      return countByClasses(controlled, ['mount', 'vehicle']);
    }
  }

  {
    const m = raw.match(/^x is the number of opponents who control (?:(?:an?|the)\s+)?(.+)$/i);
    if (m) {
      const spec = parseColorQualifiedClassSpec(String(m[1] || ''));
      if (!spec) {
        // Fall through to more specific phrase handlers.
      } else {
        const opponentIds = (state.players || [])
          .map((p: any) => String((p as any)?.id || '').trim())
          .filter(pid => pid.length > 0 && pid !== controllerId);

        let opponentCount = 0;
        for (const opponentId of opponentIds) {
          const oppPermanents = battlefield.filter((p: any) => String((p as any)?.controller || '').trim() === opponentId);
          const hasMatchingPermanent = countByClasses(oppPermanents, spec.classes, spec.requiredColor) > 0;
          if (hasMatchingPermanent) opponentCount += 1;
        }

        return opponentCount;
      }
    }
  }

  {
    const m = raw.match(/^x is the number of (.+) you control$/i);
    if (m) {
      const spec = parseColorQualifiedClassSpec(String(m[1] || ''));
      if (spec) {
        return countByClasses(controlled, spec.classes, spec.requiredColor);
      }
    }
  }

  {
    const m = raw.match(/^x is the number of (.+) your opponents control$/i);
    if (m) {
      const spec = parseColorQualifiedClassSpec(String(m[1] || ''));
      if (spec) {
        return countByClasses(opponentsControlled, spec.classes, spec.requiredColor);
      }
    }
  }

  {
    const m = raw.match(/^x is the number of (.+) target opponent controls$/i);
    if (m) {
      const spec = parseColorQualifiedClassSpec(String(m[1] || ''));
      if (spec) {
        const targetOpponentId = String(ctx?.selectorContext?.targetOpponentId || '').trim();
        if (!targetOpponentId) return null;
        const targetControlled = battlefield.filter((p: any) => String((p as any)?.controller || '').trim() === targetOpponentId);
        return countByClasses(targetControlled, spec.classes, spec.requiredColor);
      }
    }
  }

  {
    const m = raw.match(/^x is the number of (.+) (?:the )?defending player controls$/i);
    if (m) {
      const spec = parseColorQualifiedClassSpec(String(m[1] || ''));
      if (spec) {
        const targetOpponentId = String(ctx?.selectorContext?.targetOpponentId || '').trim();
        if (!targetOpponentId) return null;
        const targetControlled = battlefield.filter((p: any) => String((p as any)?.controller || '').trim() === targetOpponentId);
        return countByClasses(targetControlled, spec.classes, spec.requiredColor);
      }
    }
  }

  {
    const m = raw.match(/^x is the number of (.+) (?:that player controls|they control)$/i);
    if (m) {
      const spec = parseColorQualifiedClassSpec(String(m[1] || ''));
      if (spec) {
        const player = resolveContextPlayer();
        if (!player) return null;
        const playerId = String((player as any)?.id || '').trim();
        if (!playerId) return null;
        const targetControlled = battlefield.filter((p: any) => String((p as any)?.controller || '').trim() === playerId);
        return countByClasses(targetControlled, spec.classes, spec.requiredColor);
      }
    }
  }

  {
    const m = raw.match(/^x is the number of (.+) (?:those opponents|all of those opponents|all those opponents|each of those opponents) control$/i);
    if (m) {
      const spec = parseColorQualifiedClassSpec(String(m[1] || ''));
      if (spec) {
        const ids = Array.isArray(ctx?.selectorContext?.eachOfThoseOpponents)
          ? (ctx?.selectorContext?.eachOfThoseOpponents || []).map(id => String(id || '').trim()).filter(Boolean)
          : [];
        if (ids.length === 0) return null;
        const idSet = new Set(ids);
        const pool = battlefield.filter((p: any) => idSet.has(String((p as any)?.controller || '').trim()));
        return countByClasses(pool, spec.classes, spec.requiredColor);
      }
    }
  }

  {
    const m = raw.match(/^x is the number of opponents you have$/i);
    if (m) {
      return Math.max(0, (state.players || []).filter(p => p.id !== controllerId).length);
    }
  }

  {
    const m = raw.match(/^x is the number of (tapped|untapped) (.+) you control$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase();
      const classes = parseClassList(String(m[2] || ''));
      if (!classes) return null;
      return controlled.filter((p: any) => {
        const tapped = Boolean((p as any)?.tapped);
        if (which === 'tapped' ? !tapped : tapped) return false;
        return classes.some((klass) => hasExecutorClass(p, klass));
      }).length;
    }
  }

  {
    const m = raw.match(/^x is the number of (tapped|untapped) creatures you control$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase();
      return controlled.filter((p: any) => {
        if (!hasExecutorClass(p, 'creature')) return false;
        const tapped = Boolean((p as any)?.tapped);
        return which === 'tapped' ? tapped : !tapped;
      }).length;
    }
  }

  {
    const m = raw.match(/^x is the number of other creatures you control$/i);
    if (m) {
      const excludedId = getExcludedId();
      return controlled.filter((p: any) => {
        if (excludedId && String((p as any)?.id || '').trim() === excludedId) return false;
        return hasExecutorClass(p, 'creature');
      }).length;
    }
  }

  {
    const m = raw.match(/^x is the number of legendary creatures you control$/i);
    if (m) {
      return controlled.filter((p: any) => {
        const tl = typeLineLower(p);
        return tl.includes('legendary') && hasExecutorClass(p, 'creature');
      }).length;
    }
  }

  {
    const m = raw.match(/^x is the number of creatures you control with defender$/i);
    if (m) {
      return controlled.filter((p: any) => {
        const tl = typeLineLower(p);
        const keywords = String((p as any)?.keywords || (p as any)?.card?.keywords || '').toLowerCase();
        return hasExecutorClass(p, 'creature') && (tl.includes('defender') || keywords.includes('defender'));
      }).length;
    }
  }

  {
    const m = raw.match(/^x is the number of permanents you control with oil counters on them$/i);
    if (m) {
      return controlled.filter((p: any) => {
        const counters = (p as any)?.counters;
        if (!counters || typeof counters !== 'object') return false;
        const entries = Object.entries(counters as Record<string, unknown>);
        for (const [key, value] of entries) {
          if (String(key || '').trim().toLowerCase() !== 'oil') continue;
          const n = Number(value);
          return Number.isFinite(n) && n > 0;
        }
        return false;
      }).length;
    }
  }

  {
    const m = raw.match(/^x is the total (power|toughness) of (other )?creatures you control$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase();
      const isOther = Boolean(String(m[2] || '').trim());
      const excludedId = isOther ? getExcludedId() : '';

      return controlled.reduce((sum: number, p: any) => {
        if (!hasExecutorClass(p, 'creature')) return sum;
        if (excludedId && String((p as any)?.id || '').trim() === excludedId) return sum;
        const n = Number(which === 'power' ? (p as any)?.power : (p as any)?.toughness);
        return sum + (Number.isFinite(n) ? n : 0);
      }, 0);
    }
  }

  {
    const m = raw.match(/^x is the number of creatures you control with power (\d+) or greater$/i);
    if (m) {
      const threshold = Math.max(0, parseInt(String(m[1] || '0'), 10) || 0);
      return controlled.filter((p: any) => {
        if (!hasExecutorClass(p, 'creature')) return false;
        const n = Number((p as any)?.power);
        return Number.isFinite(n) && n >= threshold;
      }).length;
    }
  }

  {
    const m = raw.match(/^x is the number of differently named lands you control$/i);
    if (m) {
      const seen = new Set<string>();
      for (const p of controlled as any[]) {
        if (!hasExecutorClass(p, 'land')) continue;
        const name = String((p as any)?.name || (p as any)?.card?.name || '').trim().toLowerCase();
        if (!name) continue;
        seen.add(name);
      }
      return seen.size;
    }
  }

  {
    const m = raw.match(/^x is the number of (.+)$/i);
    if (m) {
      const phrase = String(m[1] || '').toLowerCase();
      const mentionsAttackingCreatures = /\bcreatures?\b/.test(phrase) && /\battacking\b/.test(phrase);
      if (mentionsAttackingCreatures && !/\bwith\s+flying\b/.test(phrase) && !/\battacking\s+you\b/.test(phrase)) {
        const isOther = /\bother\b/.test(phrase);
        const excludedId = isOther ? getExcludedId() : '';
        const useOpponents = /\b(?:your opponents control|an opponent controls|you don['’]?t control|you do not control)\b/.test(phrase);
        const useControlled = /\byou control\b/.test(phrase);
        const pool = useOpponents ? opponentsControlled : useControlled ? controlled : battlefield;
        return pool.filter((p: any) => {
          if (excludedId && String((p as any)?.id || '').trim() === excludedId) return false;
          if (!hasExecutorClass(p, 'creature')) return false;
          return String((p as any)?.attacking || '').trim().length > 0;
        }).length;
      }
    }
  }

  {
    const m = raw.match(/^x is the number of creatures attacking you$/i);
    if (m) {
      return battlefield.filter((p: any) => {
        if (!hasExecutorClass(p, 'creature')) return false;
        if (!isAttackingObject(p)) return false;
        const attackedId = String((p as any)?.attacking || (p as any)?.attackingPlayerId || (p as any)?.defendingPlayerId || '').trim();
        return attackedId === controllerId;
      }).length;
    }
  }

  {
    const m = raw.match(/^x is the difference between the chosen creatures' powers$/i);
    if (m) {
      const chosenIds = Array.isArray(ctx?.selectorContext?.chosenObjectIds)
        ? ctx.selectorContext.chosenObjectIds.map(id => String(id || '').trim()).filter(Boolean)
        : [];
      if (chosenIds.length < 2) return null;

      const chosenCreatures = chosenIds
        .map(id => findObjectById(id))
        .filter((obj): obj is any => Boolean(obj) && hasExecutorClass(obj, 'creature'));
      if (chosenCreatures.length < 2) return null;

      const powerValues = chosenCreatures.slice(0, 2).map(obj => Number((obj as any)?.power ?? (obj as any)?.card?.power));
      if (powerValues.some(value => !Number.isFinite(value))) return null;
      return Math.abs(Number(powerValues[0]) - Number(powerValues[1]));
    }
  }

  {
    const m = raw.match(/^x is the total (power|toughness) of (other )?attacking creatures$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase();
      const isOther = Boolean(String(m[2] || '').trim());
      const excludedId = isOther ? getExcludedId() : '';

      return battlefield.reduce((sum: number, p: any) => {
        if (!hasExecutorClass(p, 'creature')) return sum;
        if (!isAttackingObject(p)) return sum;
        if (excludedId && String((p as any)?.id || '').trim() === excludedId) return sum;
        const n = Number(which === 'power' ? (p as any)?.power : (p as any)?.toughness);
        return sum + (Number.isFinite(n) ? n : 0);
      }, 0);
    }
  }

  {
    const m = raw.match(/^x is the number of attacking creatures with flying$/i);
    if (m) {
      return battlefield.filter((p: any) => {
        if (!hasExecutorClass(p, 'creature')) return false;
        if (!isAttackingObject(p)) return false;
        return hasFlyingKeyword(p);
      }).length;
    }
  }

  {
    const m = raw.match(/^x is the number of players being attacked$/i);
    if (m) {
      const playerIds = new Set((state.players || []).map((p: any) => String((p as any)?.id || '').trim()).filter(Boolean));
      const attacked = new Set<string>();
      for (const p of battlefield as any[]) {
        if (!isAttackingObject(p)) continue;
        const candidates = [
          (p as any)?.attacking,
          (p as any)?.attackingPlayerId,
          (p as any)?.defendingPlayerId,
        ];
        for (const value of candidates) {
          const id = String(value || '').trim();
          if (id && playerIds.has(id)) attacked.add(id);
        }
      }
      return attacked.size;
    }
  }

  {
    const m = raw.match(/^x is the number of basic land types among lands you control$/i);
    if (m) {
      const basicLandTypes = ['plains', 'island', 'swamp', 'mountain', 'forest'];
      const seen = new Set<string>();
      for (const p of controlled as any[]) {
        const tl = typeLineLower(p);
        if (!hasExecutorClass(p, 'land')) continue;
        for (const basic of basicLandTypes) {
          if (tl.includes(basic)) seen.add(basic);
        }
      }
      return seen.size;
    }
  }

  {
    const m = raw.match(/^x is the number of nonbasic land types among lands (?:that player controls|they control)$/i);
    if (m) {
      const targetPlayerId = String(
        ctx?.selectorContext?.targetPlayerId ||
        ctx?.selectorContext?.targetOpponentId ||
        ''
      ).trim();
      if (!targetPlayerId) return null;

      const targetControlled = battlefield.filter((p: any) => String((p as any)?.controller || '').trim() === targetPlayerId);
      const basicLandTypes = ['plains', 'island', 'swamp', 'mountain', 'forest'];
      const seen = new Set<string>();
      for (const p of targetControlled as any[]) {
        const tl = typeLineLower(p);
        if (!hasExecutorClass(p, 'land')) continue;
        for (const basic of basicLandTypes) {
          if (tl.includes(basic)) seen.add(basic);
        }
      }
      return seen.size;
    }
  }

  {
    const m = raw.match(/^x is the number of creatures in your party$/i);
    if (m) {
      const partyRoles = ['cleric', 'rogue', 'warrior', 'wizard'];
      const filled = new Set<string>();
      for (const p of controlled as any[]) {
        const tl = typeLineLower(p);
        if (!hasExecutorClass(p, 'creature')) continue;
        for (const role of partyRoles) {
          if (tl.includes(role)) filled.add(role);
        }
      }
      return filled.size;
    }
  }

  {
    const m = raw.match(/^x is your devotion to (white|blue|black|red|green)$/i);
    if (m) {
      const colorName = String(m[1] || '').toLowerCase();
      const colorSymbolByName: Record<string, string> = {
        white: 'W',
        blue: 'U',
        black: 'B',
        red: 'R',
        green: 'G',
      };
      const colorSymbol = colorSymbolByName[colorName];
      if (!colorSymbol) return null;

      let devotion = 0;
      for (const p of controlled as any[]) {
        devotion += countManaSymbolsInManaCost(p, colorSymbol);
      }

      return devotion;
    }
  }

  {
    const m = raw.match(/^x is the number of (white|blue|black|red|green) mana symbols in the mana costs of permanents you control$/i);
    if (m) {
      const colorName = String(m[1] || '').toLowerCase();
      const colorSymbolByName: Record<string, string> = {
        white: 'W',
        blue: 'U',
        black: 'B',
        red: 'R',
        green: 'G',
      };
      const colorSymbol = colorSymbolByName[colorName];
      if (!colorSymbol) return null;

      return controlled.reduce((sum: number, permanent: any) => sum + countManaSymbolsInManaCost(permanent, colorSymbol), 0);
    }
  }

  {
    const m = raw.match(/^x is the number of colors among permanents you control$/i);
    if (m) {
      const seen = new Set<string>();
      for (const p of controlled as any[]) {
        for (const color of getColorsFromPermanent(p)) {
          seen.add(color);
        }
      }
      return seen.size;
    }
  }

  {
    const m = raw.match(/^x is the number of (.+) counters? on this (creature|artifact|enchantment|land|planeswalker|battle|permanent)$/i);
    if (m) {
      const counterName = String(m[1] || '');
      const expectedType = String(m[2] || '').toLowerCase();
      const sourceObj = getSourceRef();
      const targetObj = getTargetRef();

      const matchesExpectedType = (obj: any): boolean => {
        if (!obj) return false;
        if (expectedType === 'permanent') return true;
        return hasExecutorClass(obj, expectedType);
      };

      const objectToRead =
        (expectedType === 'creature' && matchesExpectedType(targetObj) ? targetObj : null) ||
        (matchesExpectedType(sourceObj) ? sourceObj : null) ||
        (matchesExpectedType(targetObj) ? targetObj : null);

      if (!objectToRead) return null;
      return getCounterCountOnObject(objectToRead, counterName);
    }
  }

  {
    const m = raw.match(/^x is the number of (.+) counters? on it$/i);
    if (m) {
      const counterName = String(m[1] || '');
      const targetObj = getTargetRef();
      const sourceObj = getSourceRef();
      const obj = targetObj || sourceObj;
      if (!obj) return null;
      return getCounterCountOnObject(obj, counterName);
    }
  }

  {
    const m = raw.match(/^x is the number of (.+) counters? on ([a-z0-9 ,.'-]+)$/i);
    if (m) {
      const counterName = String(m[1] || '');
      const objectName = String(m[2] || '').trim();
      if (!objectName) return null;

      const normalizedObjectName = normalizeOracleText(objectName);
      if (
        normalizedObjectName === 'it' ||
        normalizedObjectName === 'this' ||
        normalizedObjectName === 'that' ||
        /^this\s+/.test(normalizedObjectName) ||
        /^that\s+/.test(normalizedObjectName)
      ) {
        // Let pronoun/antecedent-specific matchers resolve these forms.
      } else {
        const obj = findObjectByName(objectName);
        if (!obj) return null;
        return getCounterCountOnObject(obj, counterName);
      }
    }
  }

  {
    const m = raw.match(/^x is the number of untapped lands (?:that player controls|they control)$/i);
    if (m) {
      const targetPlayerId = String(
        ctx?.selectorContext?.targetPlayerId ||
        ctx?.selectorContext?.targetOpponentId ||
        ''
      ).trim();
      if (!targetPlayerId) return null;

      return battlefield.filter((p: any) => {
        if (String((p as any)?.controller || '').trim() !== targetPlayerId) return false;
        if (!hasExecutorClass(p, 'land')) return false;
        return (p as any)?.tapped !== true;
      }).length;
    }
  }

  {
    const m = raw.match(/^x is the number of untapped lands (?:that player|they) controlled at the beginning of this turn$/i);
    if (m) {
      const targetPlayerId = String(
        ctx?.selectorContext?.targetPlayerId ||
        ctx?.selectorContext?.targetOpponentId ||
        ''
      ).trim();
      if (!targetPlayerId) return null;

      const stateAny: any = state as any;
      const snapshot = Array.isArray(stateAny.turnStartBattlefieldSnapshot)
        ? stateAny.turnStartBattlefieldSnapshot
        : Array.isArray(stateAny.beginningOfTurnBattlefieldSnapshot)
          ? stateAny.beginningOfTurnBattlefieldSnapshot
          : null;
      if (!snapshot) return null;

      return snapshot.filter((p: any) => {
        if (String((p as any)?.controller || '').trim() !== targetPlayerId) return false;
        if (!hasExecutorClass(p, 'land')) return false;
        return (p as any)?.tapped !== true;
      }).length;
    }
  }

  {
    const m = raw.match(/^x is the number of cards? in your (graveyard|hand|library|exile)$/i);
    if (m) {
      const zone = String(m[1] || '').toLowerCase();
      const controller = findPlayerById(controllerId);
      if (!controller) return null;
      if (zone === 'graveyard') return Array.isArray(controller.graveyard) ? controller.graveyard.length : 0;
      if (zone === 'hand') return Array.isArray(controller.hand) ? controller.hand.length : 0;
      if (zone === 'library') return Array.isArray(controller.library) ? controller.library.length : 0;
      if (zone === 'exile') return Array.isArray(controller.exile) ? controller.exile.length : 0;
      return null;
    }
  }

  {
    const m = raw.match(/^x is the number of cards? in (?:that player's|their) (graveyard|hand|library|exile)$/i);
    if (m) {
      const zone = String(m[1] || '').toLowerCase();
      const player = resolveContextPlayer();
      if (!player) return null;
      if (zone === 'graveyard') return Array.isArray(player.graveyard) ? player.graveyard.length : 0;
      if (zone === 'hand') return Array.isArray(player.hand) ? player.hand.length : 0;
      if (zone === 'library') return Array.isArray(player.library) ? player.library.length : 0;
      if (zone === 'exile') return Array.isArray(player.exile) ? player.exile.length : 0;
      return null;
    }
  }

  {
    const m = raw.match(/^x is the number of cards? in all graveyards$/i);
    if (m) {
      return (state.players || []).reduce((sum, p: any) => {
        const gy = Array.isArray(p?.graveyard) ? p.graveyard.length : 0;
        return sum + gy;
      }, 0);
    }
  }

  {
    const m = raw.match(/^x is the number of cards? in (?:(?:all\s+)?opponents?'?\s+graveyards|your\s+opponents?'?\s+graveyards)$/i);
    if (m) {
      return (state.players || []).reduce((sum, p: any) => {
        const id = String((p as any)?.id || '').trim();
        if (!id || id === controllerId) return sum;
        const gy = Array.isArray((p as any)?.graveyard) ? (p as any).graveyard.length : 0;
        return sum + gy;
      }, 0);
    }
  }

  {
    const m = raw.match(/^x is (?:the total number|the number) of cards? in all players'? hands?$/i);
    if (m) {
      return (state.players || []).reduce((sum, p: any) => {
        const hand = Array.isArray(p?.hand) ? p.hand.length : 0;
        return sum + hand;
      }, 0);
    }
  }

  {
    const m = raw.match(/^x is the number of cards? in (?:(?:all\s+)?opponents?'?\s+hands|your\s+opponents?'?\s+hands)$/i);
    if (m) {
      return (state.players || []).reduce((sum, p: any) => {
        const id = String((p as any)?.id || '').trim();
        if (!id || id === controllerId) return sum;
        const hand = Array.isArray((p as any)?.hand) ? (p as any).hand.length : 0;
        return sum + hand;
      }, 0);
    }
  }

  {
    const m = raw.match(/^x is the number of (.+) cards? in all graveyards$/i);
    if (m) {
      const classes = parseCardClassList(String(m[1] || ''));
      if (!classes) return null;
      return (state.players || []).reduce((sum, p: any) => {
        const gy = Array.isArray(p?.graveyard) ? p.graveyard : [];
        return sum + countCardsByClasses(gy, classes);
      }, 0);
    }
  }

  {
    const m = raw.match(/^x is the number of card types among cards? in your graveyard$/i);
    if (m) {
      const controller = findPlayerById(controllerId);
      if (!controller) return null;
      const gy = Array.isArray(controller.graveyard) ? controller.graveyard : [];
      const seen = new Set<string>();
      for (const card of gy as any[]) {
        const types = getCardTypesFromTypeLine(card);
        if (!types) continue;
        for (const type of types) {
          seen.add(type);
        }
      }
      return seen.size;
    }
  }

  {
    const m = raw.match(/^x is the number of cards? in all graveyards with the same name as that spell$/i);
    if (m) {
      const sourceId = String(ctx?.sourceId || '').trim();
      if (!sourceId) return null;
      const ref = findObjectById(sourceId);
      if (!ref) return null;
      const refName = String(
        (ref as any)?.cardName ||
        (ref as any)?.name ||
        (ref as any)?.card?.name ||
        (ref as any)?.spell?.cardName ||
        (ref as any)?.spell?.name ||
        ''
      ).trim().toLowerCase();
      if (!refName) return null;
      return (state.players || []).reduce((sum, p: any) => {
        const gy = Array.isArray((p as any)?.graveyard) ? (p as any).graveyard : [];
        const count = gy.filter((card: any) => String((card as any)?.name || '').trim().toLowerCase() === refName).length;
        return sum + count;
      }, 0);
    }
  }

  {
    const m = raw.match(/^x is the number of cards? named ([a-z0-9 ,.'-]+) in all graveyards(?: as you cast this spell)?$/i);
    if (m) {
      const wantedName = normalizeOracleText(String(m[1] || ''));
      if (!wantedName) return null;
      return (state.players || []).reduce((sum, p: any) => {
        const gy = Array.isArray((p as any)?.graveyard) ? (p as any).graveyard : [];
        const count = gy.filter((card: any) => normalizeOracleText(String((card as any)?.name || '')) === wantedName).length;
        return sum + count;
      }, 0);
    }
  }

  {
    const m = raw.match(/^x is the number of cards? named ([a-z0-9 ,.'-]+) in your graveyard$/i);
    if (m) {
      const wantedName = normalizeOracleText(String(m[1] || ''));
      if (!wantedName) return null;
      const controller = findPlayerById(controllerId);
      if (!controller) return null;
      const gy = Array.isArray(controller.graveyard) ? controller.graveyard : [];
      return gy.filter((card: any) => normalizeOracleText(String((card as any)?.name || '')) === wantedName).length;
    }
  }

  {
    const m = raw.match(/^x is the amount of life your opponents(?:['’])?(?: have)? gained(?: this turn)?$/i);
    if (m) {
      const stateAny: any = state as any;

      const fromRecordSumOpponents = (value: any): number | null => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

        const players = Array.isArray(state.players) ? state.players : [];
        if (players.length > 0) {
          return players.reduce((sum: number, player: any) => {
            const pid = String((player as any)?.id || '').trim();
            if (!pid || pid === controllerId) return sum;
            const n = Number((value as any)[pid]);
            return sum + (Number.isFinite(n) ? Math.max(0, n) : 0);
          }, 0);
        }

        return Object.entries(value as Record<string, unknown>).reduce((sum, [pid, amount]) => {
          if (String(pid).trim() === controllerId) return sum;
          const n = Number(amount);
          return sum + (Number.isFinite(n) ? Math.max(0, n) : 0);
        }, 0);
      };

      const candidates: Array<number | null> = [
        fromRecordSumOpponents(stateAny.lifeGainedThisTurn),
        fromRecordSumOpponents(stateAny.lifeGained),
        fromRecordSumOpponents(stateAny.turnStats?.lifeGained),
      ];

      for (const candidate of candidates) {
        if (candidate !== null) return candidate;
      }

      return null;
    }
  }

  {
    const m = raw.match(/^x is the amount of life you gained(?: this turn)?$/i);
    if (m) {
      const stateAny: any = state as any;

      const fromRecord = (value: any): number | null => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const n = Number(value[controllerId]);
        return Number.isFinite(n) ? n : null;
      };

      const candidates: Array<number | null> = [
        fromRecord(stateAny.lifeGainedThisTurn),
        fromRecord(stateAny.lifeGained),
        fromRecord(stateAny.turnStats?.lifeGained),
      ];

      for (const candidate of candidates) {
        if (candidate !== null) return Math.max(0, candidate);
      }

      return null;
    }
  }

  {
    const m = raw.match(/^x is the amount of life your opponents(?:['’])?(?: have)? lost(?: this turn)?$/i);
    if (m) {
      const stateAny: any = state as any;

      const fromRecordSumOpponents = (value: any): number | null => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

        const players = Array.isArray(state.players) ? state.players : [];
        if (players.length > 0) {
          return players.reduce((sum: number, player: any) => {
            const pid = String((player as any)?.id || '').trim();
            if (!pid || pid === controllerId) return sum;
            const n = Number((value as any)[pid]);
            return sum + (Number.isFinite(n) ? Math.max(0, n) : 0);
          }, 0);
        }

        return Object.entries(value as Record<string, unknown>).reduce((sum, [pid, amount]) => {
          if (String(pid).trim() === controllerId) return sum;
          const n = Number(amount);
          return sum + (Number.isFinite(n) ? Math.max(0, n) : 0);
        }, 0);
      };

      const candidates: Array<number | null> = [
        fromRecordSumOpponents(stateAny.lifeLostThisTurn),
        fromRecordSumOpponents(stateAny.lifeLost),
        fromRecordSumOpponents(stateAny.turnStats?.lifeLost),
      ];

      for (const candidate of candidates) {
        if (candidate !== null) return candidate;
      }

      return null;
    }
  }

  {
    const m = raw.match(/^x is the amount of life (?:you(?:['’]ve| have)|you) lost(?: this turn)?$/i);
    if (m) {
      const stateAny: any = state as any;

      const fromRecord = (value: any): number | null => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const n = Number(value[controllerId]);
        return Number.isFinite(n) ? n : null;
      };

      const candidates: Array<number | null> = [
        fromRecord(stateAny.lifeLostThisTurn),
        fromRecord(stateAny.lifeLost),
        fromRecord(stateAny.turnStats?.lifeLost),
      ];

      for (const candidate of candidates) {
        if (candidate !== null) return Math.max(0, candidate);
      }

      return null;
    }
  }

  {
    const m = raw.match(/^x is the number of cards? (?:you(?:['’]ve| have)|you) discarded this turn$/i);
    if (m) {
      const stateAny: any = state as any;

      const fromRecord = (value: any): number | null => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const key = String(controllerId);
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          const n = Number(value[key]);
          return Number.isFinite(n) ? Math.max(0, n) : 0;
        }
        return 0;
      };

      const candidates: Array<number | null> = [
        fromRecord(stateAny.cardsDiscardedThisTurn),
        fromRecord(stateAny.cardsDiscarded),
        fromRecord(stateAny.turnStats?.cardsDiscarded),
      ];

      for (const candidate of candidates) {
        if (candidate !== null) return candidate;
      }

      return null;
    }
  }

  {
    const m = raw.match(/^x is the number of cards? your opponents have discarded this turn$|^x is the number of cards? your opponents discarded this turn$/i);
    if (m) {
      const stateAny: any = state as any;

      const fromRecordSumOpponents = (value: any): number | null => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

        const players = Array.isArray(state.players) ? state.players : [];
        if (players.length > 0) {
          return players.reduce((sum: number, player: any) => {
            const pid = String((player as any)?.id || '').trim();
            if (!pid || pid === controllerId) return sum;
            const n = Number((value as any)[pid]);
            return sum + (Number.isFinite(n) ? Math.max(0, n) : 0);
          }, 0);
        }

        return Object.entries(value as Record<string, unknown>).reduce((sum, [pid, amount]) => {
          if (String(pid).trim() === controllerId) return sum;
          const n = Number(amount);
          return sum + (Number.isFinite(n) ? Math.max(0, n) : 0);
        }, 0);
      };

      const candidates: Array<number | null> = [
        fromRecordSumOpponents(stateAny.cardsDiscardedThisTurn),
        fromRecordSumOpponents(stateAny.cardsDiscarded),
        fromRecordSumOpponents(stateAny.turnStats?.cardsDiscarded),
      ];

      for (const candidate of candidates) {
        if (candidate !== null) return candidate;
      }

      return null;
    }
  }

  {
    const m = raw.match(/^x is the number of cards? (?:you(?:['’]ve| have)|you) drawn this turn$|^x is the number of cards? you drew this turn$/i);
    if (m) {
      const stateAny: any = state as any;

      const fromRecord = (value: any): number | null => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const key = String(controllerId);
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          const n = Number(value[key]);
          return Number.isFinite(n) ? Math.max(0, n) : 0;
        }
        return 0;
      };

      const candidates: Array<number | null> = [
        fromRecord(stateAny.cardsDrawnThisTurn),
        fromRecord(stateAny.cardsDrawn),
        fromRecord(stateAny.turnStats?.cardsDrawn),
      ];

      for (const candidate of candidates) {
        if (candidate !== null) return candidate;
      }

      return null;
    }
  }

  {
    const m = raw.match(/^x is the number of cards? your opponents have drawn this turn$|^x is the number of cards? your opponents drew this turn$/i);
    if (m) {
      const stateAny: any = state as any;

      const fromRecordSumOpponents = (value: any): number | null => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

        const players = Array.isArray(state.players) ? state.players : [];
        if (players.length > 0) {
          return players.reduce((sum: number, player: any) => {
            const pid = String((player as any)?.id || '').trim();
            if (!pid || pid === controllerId) return sum;
            const n = Number((value as any)[pid]);
            return sum + (Number.isFinite(n) ? Math.max(0, n) : 0);
          }, 0);
        }

        return Object.entries(value as Record<string, unknown>).reduce((sum, [pid, amount]) => {
          if (String(pid).trim() === controllerId) return sum;
          const n = Number(amount);
          return sum + (Number.isFinite(n) ? Math.max(0, n) : 0);
        }, 0);
      };

      const candidates: Array<number | null> = [
        fromRecordSumOpponents(stateAny.cardsDrawnThisTurn),
        fromRecordSumOpponents(stateAny.cardsDrawn),
        fromRecordSumOpponents(stateAny.turnStats?.cardsDrawn),
      ];

      for (const candidate of candidates) {
        if (candidate !== null) return candidate;
      }

      return null;
    }
  }

  {
    const m = raw.match(/^x is the number of spells? (?:you(?:['’]ve| have)|you) cast this turn$|^x is the number of spells? you cast this turn$/i);
    if (m) {
      const stateAny: any = state as any;

      const fromRecord = (value: any): number | null => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const key = String(controllerId);
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          const n = Number(value[key]);
          return Number.isFinite(n) ? Math.max(0, n) : 0;
        }
        return 0;
      };

      const candidates: Array<number | null> = [
        fromRecord(stateAny.spellsCastThisTurn),
        fromRecord(stateAny.spellsCast),
        fromRecord(stateAny.turnStats?.spellsCast),
      ];

      for (const candidate of candidates) {
        if (candidate !== null) return candidate;
      }

      return null;
    }
  }

  {
    const m = raw.match(/^x is the number of spells? your opponents have cast this turn$|^x is the number of spells? your opponents cast this turn$/i);
    if (m) {
      const stateAny: any = state as any;

      const fromRecordSumOpponents = (value: any): number | null => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

        const players = Array.isArray(state.players) ? state.players : [];
        if (players.length > 0) {
          return players.reduce((sum: number, player: any) => {
            const pid = String((player as any)?.id || '').trim();
            if (!pid || pid === controllerId) return sum;
            const n = Number((value as any)[pid]);
            return sum + (Number.isFinite(n) ? Math.max(0, n) : 0);
          }, 0);
        }

        return Object.entries(value as Record<string, unknown>).reduce((sum, [pid, amount]) => {
          if (String(pid).trim() === controllerId) return sum;
          const n = Number(amount);
          return sum + (Number.isFinite(n) ? Math.max(0, n) : 0);
        }, 0);
      };

      const candidates: Array<number | null> = [
        fromRecordSumOpponents(stateAny.spellsCastThisTurn),
        fromRecordSumOpponents(stateAny.spellsCast),
        fromRecordSumOpponents(stateAny.turnStats?.spellsCast),
      ];

      for (const candidate of candidates) {
        if (candidate !== null) return candidate;
      }

      return null;
    }
  }

  // ── All-players spells cast this turn (no “you”/“opponents” qualifier) ───────────
  {
    const m = raw.match(/^x is the number of spells? cast this turn$/i);
    if (m) {
      const stateAny: any = state as any;

      const fromRecordSumAll = (value: any): number | null => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        return Object.values(value as Record<string, unknown>).reduce<number>((sum, amount) => {
          const n = Number(amount);
          return sum + (Number.isFinite(n) ? Math.max(0, n) : 0);
        }, 0);
      };

      const candidates: Array<number | null> = [
        fromRecordSumAll(stateAny.spellsCastThisTurn),
        fromRecordSumAll(stateAny.spellsCast),
        fromRecordSumAll(stateAny.turnStats?.spellsCast),
      ];

      for (const candidate of candidates) {
        if (candidate !== null) return candidate;
      }

      return null;
    }
  }

  {
    const m = raw.match(/^x is the number of lands? (?:you(?:['’]ve| have)|you) played this turn$|^x is the number of lands? you played this turn$/i);
    if (m) {
      const stateAny: any = state as any;

      const fromRecord = (value: any): number | null => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const key = String(controllerId);
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          const n = Number(value[key]);
          return Number.isFinite(n) ? Math.max(0, n) : 0;
        }
        return 0;
      };

      const candidates: Array<number | null> = [
        fromRecord(stateAny.landsPlayedThisTurn),
        fromRecord(stateAny.landsPlayed),
        fromRecord(stateAny.turnStats?.landsPlayed),
      ];

      for (const candidate of candidates) {
        if (candidate !== null) return candidate;
      }

      return null;
    }
  }

  {
    const m = raw.match(/^x is the number of lands? your opponents have played this turn$|^x is the number of lands? your opponents played this turn$/i);
    if (m) {
      const stateAny: any = state as any;

      const fromRecordSumOpponents = (value: any): number | null => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

        const players = Array.isArray(state.players) ? state.players : [];
        if (players.length > 0) {
          return players.reduce((sum: number, player: any) => {
            const pid = String((player as any)?.id || '').trim();
            if (!pid || pid === controllerId) return sum;
            const n = Number((value as any)[pid]);
            return sum + (Number.isFinite(n) ? Math.max(0, n) : 0);
          }, 0);
        }

        return Object.entries(value as Record<string, unknown>).reduce((sum, [pid, amount]) => {
          if (String(pid).trim() === controllerId) return sum;
          const n = Number(amount);
          return sum + (Number.isFinite(n) ? Math.max(0, n) : 0);
        }, 0);
      };

      const candidates: Array<number | null> = [
        fromRecordSumOpponents(stateAny.landsPlayedThisTurn),
        fromRecordSumOpponents(stateAny.landsPlayed),
        fromRecordSumOpponents(stateAny.turnStats?.landsPlayed),
      ];

      for (const candidate of candidates) {
        if (candidate !== null) return candidate;
      }

      return null;
    }
  }

  {
    const m = raw.match(/^x is the number of cards? revealed this way$/i);
    if (m) {
      const revealed = Number(runtime?.lastRevealedCardCount ?? 0);
      return Number.isFinite(revealed) ? Math.max(0, revealed) : 0;
    }
  }

  {
    const m = raw.match(/^x is the number of cards? discarded this way$/i);
    if (m) {
      const discarded = Number(runtime?.lastDiscardedCardCount ?? 0);
      return Number.isFinite(discarded) ? Math.max(0, discarded) : 0;
    }
  }

  {
    const m = raw.match(/^x is the number of cards? exiled this way$/i);
    if (m) {
      const exiled = Number(runtime?.lastExiledCardCount ?? 0);
      return Number.isFinite(exiled) ? Math.max(0, exiled) : 0;
    }
  }

  {
    const m = raw.match(/^x is the total power of (?:the )?cards? exiled this way$/i);
    if (m) {
      const exiledCards = Array.isArray(runtime?.lastExiledCards) ? runtime.lastExiledCards : [];
      return exiledCards.reduce((sum: number, card: any) => {
        const n = Number((card as any)?.power ?? (card as any)?.card?.power);
        return sum + (Number.isFinite(n) ? n : 0);
      }, 0);
    }
  }

  {
    const m = raw.match(/^x is the total power of (?:the )?creatures? goaded this way$/i);
    if (m) {
      const goadedCreatures = Array.isArray(runtime?.lastGoadedCreatures) ? runtime.lastGoadedCreatures : [];
      return goadedCreatures.reduce((sum: number, creature: any) => {
        const n = Number((creature as any)?.power ?? (creature as any)?.card?.power);
        return sum + (Number.isFinite(n) ? n : 0);
      }, 0);
    }
  }

  {
    const m = raw.match(/^x is the total power of (?:the )?creatures? sacrificed this way$/i);
    if (m) {
      const totalPower = Number(runtime?.lastSacrificedCreaturesPowerTotal ?? 0);
      return Number.isFinite(totalPower) ? Math.max(0, totalPower) : 0;
    }
  }

  {
    const m = raw.match(/^x is (?:the )?amount of excess damage dealt this way$|^x is the excess damage dealt this way$/i);
    if (m) {
      const excess = Number(runtime?.lastExcessDamageDealtThisWay ?? 0);
      return Number.isFinite(excess) ? Math.max(0, excess) : 0;
    }
  }

  {
    const m = raw.match(/^x is the number of cards? looked at while scrying this way$/i);
    if (m) {
      const looked = Number(runtime?.lastScryLookedAtCount ?? 0);
      return Number.isFinite(looked) ? Math.max(0, looked) : 0;
    }
  }

  {
    const m = raw.match(/^x is the number of creatures that died this turn$/i);
    if (m) {
      const stateAny: any = state as any;
      const byController = stateAny.creaturesDiedThisTurnByController;
      if (byController && typeof byController === 'object' && !Array.isArray(byController)) {
        const values = Object.values(byController as Record<string, unknown>) as unknown[];
        return values.reduce<number>((sum, value) => {
          const n = Number(value);
          return sum + (Number.isFinite(n) ? Math.max(0, n) : 0);
        }, 0);
      }

      const boolFallback = Boolean(stateAny.creatureDiedThisTurn);
      return boolFallback ? 1 : 0;
    }
  }

  {
    const m = raw.match(/^x is the number of creatures that died under your control(?: this turn)?$/i);
    if (m) {
      const stateAny: any = state as any;
      const byController = stateAny.creaturesDiedThisTurnByController;
      if (!byController || typeof byController !== 'object' || Array.isArray(byController)) return null;
      const n = Number((byController as Record<string, unknown>)[controllerId]);
      return Number.isFinite(n) ? Math.max(0, n) : 0;
    }
  }

  {
    const m = raw.match(/^x is the number of creatures that died under (?:(?:your )?opponents(?:['’])?|an opponent(?:['’]s)?) control(?: this turn)?$/i);
    if (m) {
      const stateAny: any = state as any;
      const byController = stateAny.creaturesDiedThisTurnByController;
      if (!byController || typeof byController !== 'object' || Array.isArray(byController)) return null;

      const players = Array.isArray(state.players) ? state.players : [];
      if (players.length > 0) {
        return players.reduce((sum: number, player: any) => {
          const pid = String((player as any)?.id || '').trim();
          if (!pid || pid === controllerId) return sum;
          const n = Number((byController as Record<string, unknown>)[pid]);
          return sum + (Number.isFinite(n) ? Math.max(0, n) : 0);
        }, 0);
      }

      return Object.entries(byController as Record<string, unknown>).reduce((sum, [pid, amount]) => {
        if (String(pid).trim() === controllerId) return sum;
        const n = Number(amount);
        return sum + (Number.isFinite(n) ? Math.max(0, n) : 0);
      }, 0);
    }
  }

  {
    const m = raw.match(/^x is the number of creatures you control that died(?: this turn)?$/i);
    if (m) {
      const stateAny: any = state as any;
      const byController = stateAny.creaturesDiedThisTurnByController;
      if (!byController || typeof byController !== 'object' || Array.isArray(byController)) return null;
      const n = Number((byController as Record<string, unknown>)[controllerId]);
      return Number.isFinite(n) ? Math.max(0, n) : 0;
    }
  }

  {
    const m = raw.match(/^x is the number of creatures your opponents control that died(?: this turn)?$/i);
    if (m) {
      const stateAny: any = state as any;
      const byController = stateAny.creaturesDiedThisTurnByController;
      if (!byController || typeof byController !== 'object' || Array.isArray(byController)) return null;

      const players = Array.isArray(state.players) ? state.players : [];
      if (players.length > 0) {
        return players.reduce((sum: number, player: any) => {
          const pid = String((player as any)?.id || '').trim();
          if (!pid || pid === controllerId) return sum;
          const n = Number((byController as Record<string, unknown>)[pid]);
          return sum + (Number.isFinite(n) ? Math.max(0, n) : 0);
        }, 0);
      }

      return Object.entries(byController as Record<string, unknown>).reduce((sum, [pid, amount]) => {
        if (String(pid).trim() === controllerId) return sum;
        const n = Number(amount);
        return sum + (Number.isFinite(n) ? Math.max(0, n) : 0);
      }, 0);
    }
  }

  {
    const m = raw.match(/^x is the number of permanents (?:you(?:['’]ve| have)|you) sacrificed(?: this turn)?$/i);
    if (m) {
      const stateAny: any = state as any;
      const byController = stateAny.permanentsSacrificedThisTurn;
      if (!byController || typeof byController !== 'object' || Array.isArray(byController)) return null;
      const n = Number((byController as Record<string, unknown>)[controllerId]);
      return Number.isFinite(n) ? Math.max(0, n) : 0;
    }
  }

  {
    const m = raw.match(/^x is the number of permanents your opponents have sacrificed(?: this turn)?$|^x is the number of permanents your opponents sacrificed(?: this turn)?$/i);
    if (m) {
      const stateAny: any = state as any;
      const byController = stateAny.permanentsSacrificedThisTurn;
      if (!byController || typeof byController !== 'object' || Array.isArray(byController)) return null;

      const players = Array.isArray(state.players) ? state.players : [];
      if (players.length > 0) {
        return players.reduce((sum: number, player: any) => {
          const pid = String((player as any)?.id || '').trim();
          if (!pid || pid === controllerId) return sum;
          const n = Number((byController as Record<string, unknown>)[pid]);
          return sum + (Number.isFinite(n) ? Math.max(0, n) : 0);
        }, 0);
      }

      return Object.entries(byController as Record<string, unknown>).reduce((sum, [pid, amount]) => {
        if (String(pid).trim() === controllerId) return sum;
        const n = Number(amount);
        return sum + (Number.isFinite(n) ? Math.max(0, n) : 0);
      }, 0);
    }
  }

  {
    const m = raw.match(/^x is the sacrificed creature'?s (power|toughness|mana value)$/i);
    if (m) {
      const sourceId = String(ctx?.sourceId || '').trim();
      if (!sourceId) return null;
      const ref = findObjectById(sourceId);
      if (!ref) return null;

      const refCard = (ref as any)?.card || ref;
      const tl = typeLineLower(refCard);
      if (!tl.includes('creature')) return null;

      const which = String(m[1] || '').toLowerCase();
      if (which === 'mana value') {
        const mv = getCardManaValue(refCard);
        return mv === null ? null : mv;
      }

      const rawValue = which === 'power'
        ? ((refCard as any)?.power ?? (ref as any)?.power)
        : ((refCard as any)?.toughness ?? (ref as any)?.toughness);
      const n = Number(rawValue);
      return Number.isFinite(n) ? n : null;
    }
  }

  {
    const m = raw.match(/^x is the sacrificed artifact'?s mana value$/i);
    if (m) {
      const sourceId = String(ctx?.sourceId || '').trim();
      if (!sourceId) return null;
      const ref = findObjectById(sourceId);
      if (!ref) return null;

      const refCard = (ref as any)?.card || ref;
      const tl = typeLineLower(refCard);
      if (!tl.includes('artifact')) return null;

      const mv = getCardManaValue(refCard);
      return mv === null ? null : mv;
    }
  }

  {
    const m = raw.match(/^x is the greatest mana value of a commander you own on the battlefield or in the command zone$/i);
    if (m) {
      const ownedBattlefieldCommanders = (battlefield as any[]).filter((p: any) => {
        const ownerId = String((p as any)?.ownerId || (p as any)?.owner || '').trim();
        return (!ownerId || ownerId === controllerId) && isCommanderObject(p);
      });
      const ownedCommandZoneCommanders = collectCommandZoneObjects().filter((obj: any) => {
        const ownerId = String((obj as any)?.ownerId || (obj as any)?.owner || '').trim();
        return (!ownerId || ownerId === controllerId) && isCommanderObject(obj);
      });
      return greatestManaValueAmongCards([
        ...ownedBattlefieldCommanders,
        ...ownedCommandZoneCommanders,
      ]);
    }
  }

  {
    const m = raw.match(/^x is your highest commander tax among your commanders$/i);
    if (m) {
      return getHighestCommanderTaxForController(state, controllerId);
    }
  }

  {
    const m = raw.match(/^x is your life total$/i);
    if (m) {
      const controller = findPlayerById(controllerId);
      if (!controller) return null;
      const life = Number(controller.life);
      return Number.isFinite(life) ? life : null;
    }
  }

  {
    const m = raw.match(/^x is your speed$/i);
    if (m) {
      const stateAny: any = state as any;
      const controller = findPlayerById(controllerId);

      const candidates: unknown[] = [
        controller?.speed,
        controller?.playerSpeed,
        stateAny?.speed?.[controllerId],
        stateAny?.playerSpeed?.[controllerId],
        stateAny?.speedByPlayer?.[controllerId],
      ];

      for (const value of candidates) {
        const n = Number(value);
        if (Number.isFinite(n)) return Math.max(0, n);
      }

      return null;
    }
  }

  {
    const m = raw.match(/^x is the number of times this creature has mutated$/i);
    if (m) {
      const sourceId = String(ctx?.sourceId || '').trim();
      const sourceObj = sourceId ? findObjectById(sourceId) : null;
      const targetObj = targetCreatureId ? findObjectById(targetCreatureId) : null;

      const isCreature = (obj: any): boolean => {
        return Boolean(obj) && hasExecutorClass(obj, 'creature');
      };

      const host =
        (isCreature(targetObj) ? targetObj : null) ||
        (isCreature(sourceObj) ? sourceObj : null);

      if (!host) return null;

      const candidates: unknown[] = [
        (host as any)?.mutationCount,
        (host as any)?.timesMutated,
        (host as any)?.mutateCount,
      ];

      for (const value of candidates) {
        const n = Number(value);
        if (Number.isFinite(n)) return Math.max(0, n);
      }

      const stack = (host as any)?.mutatedStack;
      if (Array.isArray(stack)) {
        return Math.max(0, stack.length - 1);
      }

      return null;
    }
  }

  {
    const m = raw.match(/^x is the number of experience counters you have$/i);
    if (m) {
      const stateAny: any = state as any;
      const controller = findPlayerById(controllerId);

      const candidates: unknown[] = [
        controller?.experienceCounters,
        controller?.counters?.experience,
        stateAny?.experienceCounters?.[controllerId],
        stateAny?.experience?.[controllerId],
        stateAny?.playerCounters?.experience?.[controllerId],
      ];

      for (const value of candidates) {
        const n = Number(value);
        if (Number.isFinite(n)) return Math.max(0, n);
      }

      return null;
    }
  }

  {
    const m = raw.match(/^x is the result$/i);
    if (m) {
      const stateAny: any = state as any;

      const toFinite = (value: unknown): number | null => {
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
      };

      const perPlayer = stateAny?.lastDieRollByPlayer?.[controllerId];
      const perPlayerResult = toFinite(perPlayer?.result);
      if (perPlayerResult !== null) return Math.max(0, perPlayerResult);

      const globalLast = toFinite(stateAny?.lastDieRoll?.result);
      if (globalLast !== null) return Math.max(0, globalLast);

      const turnRollsRaw = stateAny?.dieRollsThisTurn?.[controllerId];
      const turnRolls = Array.isArray(turnRollsRaw) ? turnRollsRaw : [];
      for (let i = turnRolls.length - 1; i >= 0; i -= 1) {
        const result = toFinite((turnRolls[i] as any)?.result);
        if (result !== null) return Math.max(0, result);
      }

      return null;
    }
  }

  {
    const m = raw.match(/^x is the number of (.+) cards? in your (graveyard|hand|library|exile)$/i);
    if (m) {
      const classes = parseCardClassList(String(m[1] || ''));
      if (!classes) return null;
      const zone = String(m[2] || '').toLowerCase();
      const controller = findPlayerById(controllerId);
      if (!controller) return null;

      const cards = getCardsFromPlayerZone(controller, zone);
      if (!cards) return null;

      return countCardsByClasses(cards, classes);
    }
  }

  {
    const m = raw.match(/^x is the number of (.+) cards? in its controller['’]?s graveyard$/i);
    if (m) {
      const classes = parseCardClassList(String(m[1] || ''));
      if (!classes) return null;
      const sourceObj = getSourceRef();
      if (!sourceObj) return null;
      const sourceControllerId = String((sourceObj as any)?.controller || (sourceObj as any)?.controllerId || '').trim();
      if (!sourceControllerId) return null;
      const player = findPlayerById(sourceControllerId);
      if (!player) return null;
      const gy = Array.isArray(player.graveyard) ? player.graveyard : [];
      return countCardsByClasses(gy, classes);
    }
  }

  {
    const m = raw.match(/^x is the number of (.+) cards? in target (?:opponent|player)['’]?s (graveyard|hand|library|exile)$/i);
    if (m) {
      const classes = parseCardClassList(String(m[1] || ''));
      if (!classes) return null;
      const zone = String(m[2] || '').toLowerCase();
      const player = resolveContextPlayer();
      if (!player) return null;

      const cards = getCardsFromPlayerZone(player, zone);
      if (!cards) return null;

      return countCardsByClasses(cards, classes);
    }
  }

  {
    const m = raw.match(/^x is the number of (.+) cards? in (?:that player's|their) (graveyard|hand|library|exile)$/i);
    if (m) {
      const classes = parseCardClassList(String(m[1] || ''));
      if (!classes) return null;
      const zone = String(m[2] || '').toLowerCase();
      const player = resolveContextPlayer();
      if (!player) return null;

      const cards = getCardsFromPlayerZone(player, zone);
      if (!cards) return null;

      return countCardsByClasses(cards, classes);
    }
  }

  {
    const m = raw.match(/^x is the number of (.+) on the battlefield$/i);
    if (m) {
      const classes = parseClassList(String(m[1] || ''));
      if (classes) {
        return countByClasses(battlefield, classes);
      }
    }
  }

  {
    const m = raw.match(/^x is the number of other creatures on (?:the )?battlefield$/i);
    if (m) {
      const sourceId = String(ctx?.sourceId || '').trim();
      if (!sourceId) return null;
      return battlefield.filter((p: any) => {
        const id = String((p as any)?.id || '').trim();
        if (!id || id === sourceId) return false;
        return hasExecutorClass(p, 'creature');
      }).length;
    }
  }

  {
    const m = raw.match(/^x is half your life total(?:, rounded (up|down))?$/i);
    if (m) {
      const controller = findPlayerById(controllerId);
      if (!controller) return null;
      const life = Number(controller.life);
      if (!Number.isFinite(life)) return null;
      const mode = String(m[1] || '').toLowerCase();
      if (mode === 'down') return Math.floor(life / 2);
      return Math.ceil(life / 2);
    }
  }

  {
    const m = raw.match(/^x is (?:that|this|its) creature'?s (power|toughness)$/i);
    if (m) {
      if (!targetCreatureId) return null;
      const target = battlefield.find((p: any) => p.id === targetCreatureId) as any;
      if (!target) return null;
      const which = String(m[1] || '').toLowerCase();
      const rawValue = which === 'power' ? target.power : target.toughness;
      const val = Number(rawValue);
      return Number.isFinite(val) ? val : null;
    }
  }

  {
    const m = raw.match(/^x is its mana value$/i);
    if (m) {
      const sourceId = String(ctx?.sourceId || '').trim();
      const targetId = String(targetCreatureId || '').trim();
      const refId = sourceId || targetId;
      if (!refId) return null;
      const ref = findObjectById(refId);
      if (!ref) return null;
      const mv = getCardManaValue(ref);
      return Number.isFinite(mv as number) ? (mv as number) : null;
    }
  }

  {
    const m = raw.match(/^x is that spell'?s mana value$/i);
    if (m) {
      const ref = getSourceRef();
      if (!ref) return null;
      const mv = getCardManaValue((ref as any)?.spell || (ref as any)?.card || ref);
      return Number.isFinite(mv as number) ? (mv as number) : null;
    }
  }

  {
    const m = raw.match(/^x is the number of colors that spell is$/i);
    if (m) {
      const ref = getSourceRef();
      if (!ref) return null;
      return getColorsFromObject((ref as any)?.spell || (ref as any)?.card || ref).length;
    }
  }

  {
    const m = raw.match(/^x is the number of colors that (creature|card|permanent) was$/i);
    if (m) {
      const ref = getSourceRef();
      if (!ref) return null;

      const subject = String(m[1] || '').toLowerCase();
      const refCard = (ref as any)?.card || ref;
      const tl = typeLineLower(refCard);
      if (subject === 'creature' && !hasExecutorClass(ref, 'creature')) return null;
      if (subject === 'permanent') {
        const isPermanent = hasExecutorClass(ref, 'permanent');
        if (!isPermanent) return null;
      }

      return getColorsFromObject(refCard).length;
    }
  }

  {
    const m = raw.match(/^x is this spell'?s intensity$/i);
    if (m) {
      const ref = getSourceRef();
      if (!ref) return null;
      const n = Number((ref as any)?.intensity ?? (ref as any)?.intensityValue ?? (ref as any)?.card?.intensity ?? (ref as any)?.card?.intensityValue);
      return Number.isFinite(n) ? Math.max(0, n) : null;
    }
  }

  {
    const m = raw.match(/^x is the number of colors of mana spent to cast (?:this|that) spell$/i);
    if (m) {
      const ref = getSourceRef();
      if (!ref) return null;
      return getColorsOfManaSpent(ref);
    }
  }

  {
    const m = raw.match(/^x is the amount of mana spent to cast (?:this|that) spell$/i);
    if (m) {
      const ref = getSourceRef();
      if (!ref) return null;
      return getAmountOfManaSpent(ref);
    }
  }

  {
    const m = raw.match(/^x is the amount of \{([wubrgcs])\} spent to cast (?:this|that) spell$/i);
    if (m) {
      const ref = getSourceRef();
      if (!ref) return null;
      return getAmountOfSpecificManaSymbolSpent(ref, String(m[1] || ''));
    }
  }

  {
    const m = raw.match(
      /^x is the (?:(?:total )?amount of mana paid this way|(?:total )?amount of mana that player paid this way)$/i
    );
    if (m) {
      const ref = getSourceRef();
      if (!ref) return null;
      return getAmountOfManaSpent(ref);
    }
  }

  {
    const m = raw.match(/^x is the amount of \{([wubrgcse])\} paid this way$/i);
    if (m) {
      const ref = getSourceRef();
      if (!ref) return null;
      return getAmountOfSpecificManaSymbolSpent(ref, String(m[1] || ''));
    }
  }

  // ── Generic (colorless numeric) mana in that spell’s mana cost ────────────────────
  {
    const m = raw.match(/^x is the amount of generic mana in (?:that|this) spell['\u2019]?s mana cost$/i);
    if (m) {
      const ref = getSourceRef();
      if (!ref) return null;
      const manaCostStr = String(
        (ref as any)?.manaCost ||
        (ref as any)?.mana_cost ||
        (ref as any)?.card?.manaCost ||
        (ref as any)?.card?.mana_cost ||
        ''
      );
      if (!manaCostStr) return 0;
      let generic = 0;
      for (const mt of manaCostStr.matchAll(/\{(\d+)\}/g)) {
        generic += Number(mt[1]);
      }
      return generic;
    }
  }

  {
    const m = raw.match(/^x is that card'?s mana value$/i);
    if (m) {
      const ref = getSourceRef();
      if (!ref) return null;
      const mv = getCardManaValue((ref as any)?.card || ref);
      return Number.isFinite(mv as number) ? (mv as number) : null;
    }
  }

  {
    const m = raw.match(/^x is (?:the )?(?:mana value of the exiled card|exiled card'?s mana value|revealed card'?s mana value|discarded card'?s mana value)$/i);
    if (m) {
      const ref = getSourceRef();
      if (!ref) return null;
      const mv = getCardManaValue((ref as any)?.card || ref);
      return Number.isFinite(mv as number) ? (mv as number) : null;
    }
  }

  {
    const m = raw.match(/^x is ([a-z0-9 ,.'-]+)'s (power|toughness|mana value|intensity)$/i);
    if (m) {
      const ownerName = String(m[1] || '').trim();
      const which = String(m[2] || '').toLowerCase();
      if (!ownerName) return null;
      const normalizedOwner = normalizeOracleText(ownerName);
      if (
        normalizedOwner === 'this' ||
        normalizedOwner === 'that' ||
        normalizedOwner === 'its' ||
        normalizedOwner === 'it' ||
        /^(?:this|that|its)\s+\w+/.test(normalizedOwner)
      ) {
        // Let dedicated pronoun/antecedent matchers handle these forms.
      } else {
        const ref = findObjectByName(ownerName);
        if (!ref) return null;
        const refCard = (ref as any)?.card || ref;

        if (which === 'intensity') {
          const intensity = Number((ref as any)?.intensity ?? (ref as any)?.intensityValue ?? (refCard as any)?.intensity ?? (refCard as any)?.intensityValue);
          return Number.isFinite(intensity) ? intensity : null;
        }

        if (which === 'mana value') {
          const mv = getCardManaValue(refCard);
          return Number.isFinite(mv as number) ? (mv as number) : null;
        }

        const rawValue = which === 'power'
          ? ((refCard as any)?.power ?? (ref as any)?.power)
          : ((refCard as any)?.toughness ?? (ref as any)?.toughness);
        const n = Number(rawValue);
        return Number.isFinite(n) ? n : null;
      }
    }
  }

  {
    const m = raw.match(/^x is (that|this|its) (creature|permanent|artifact|enchantment|planeswalker|card)'?s (power|toughness|mana value|intensity)$/i);
    if (m) {
      const refWord = String(m[1] || '').toLowerCase();
      const objectWord = String(m[2] || '').toLowerCase();
      const statWord = String(m[3] || '').toLowerCase();

      let refId = '';
      if (refWord === 'that' && objectWord === 'creature' && targetCreatureId) {
        refId = String(targetCreatureId);
      } else if ((refWord === 'this' || refWord === 'its') && String(ctx?.sourceId || '').trim()) {
        refId = String(ctx?.sourceId || '').trim();
      } else if (targetCreatureId) {
        refId = String(targetCreatureId);
      }

      if (!refId) return null;
      const target = battlefield.find((p: any) => String(p?.id || '').trim() === refId) as any;
      if (!target) return null;

      if (statWord === 'mana value') {
        return getCardManaValue(target?.card || target);
      }

      if (statWord === 'intensity') {
        const intensity = Number(target?.intensity ?? target?.intensityValue ?? target?.card?.intensity ?? target?.card?.intensityValue);
        return Number.isFinite(intensity) ? intensity : null;
      }

      const rawValue = statWord === 'power' ? target.power : target.toughness;
      const val = Number(rawValue);
      return Number.isFinite(val) ? val : null;
    }
  }

  {
    const m = raw.match(/^x is its (power|toughness)$/i);
    if (m) {
      if (!targetCreatureId) return null;
      const target = battlefield.find((p: any) => p.id === targetCreatureId) as any;
      if (!target) return null;
      const which = String(m[1] || '').toLowerCase();
      const rawValue = which === 'power' ? target.power : target.toughness;
      const val = Number(rawValue);
      return Number.isFinite(val) ? val : null;
    }
  }

  {
    const m = raw.match(/^x is the number of ([+\-\d/]+|[a-z][a-z0-9+\-/ ]*) counters on (?:this|that|it)(?: (creature|artifact|enchantment|planeswalker|permanent|card))?$/i);
    if (m) {
      const counterType = String(m[1] || '').toLowerCase().trim();
      const objectWord = String(m[2] || '').toLowerCase().trim();
      const sourceId = String(ctx?.sourceId || '').trim();
      let targetId: string | undefined;
      if (objectWord === 'creature') {
        targetId = targetCreatureId || sourceId || undefined;
      } else if (objectWord) {
        targetId = sourceId || targetCreatureId || undefined;
      } else {
        targetId = targetCreatureId || sourceId || undefined;
      }
      if (!targetId || !counterType) return null;
      const target = battlefield.find((p: any) => String(p?.id || '').trim() === targetId) as any;
      if (!target) return null;
      const counters = (target as any)?.counters;
      if (!counters || typeof counters !== 'object') return 0;
      const value = Number((counters as any)[counterType]);
      return Number.isFinite(value) ? Math.max(0, value) : 0;
    }
  }

  {
    const m = raw.match(/^x is the number of counters on (?:this|that) creature$/i);
    if (m) {
      const targetId = getExcludedId() || undefined;
      if (!targetId) return null;
      const target = battlefield.find((p: any) => p.id === targetId) as any;
      if (!target) return null;
      const counters = (target as any).counters;
      if (!counters || typeof counters !== 'object') return 0;
      return (Object.values(counters) as any[]).reduce((sum: number, v: any) => {
        const n = Number(v);
        return sum + (Number.isFinite(n) ? Math.max(0, n) : 0);
      }, 0);
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (power|toughness) among creatures on (?:the )?battlefield$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      return greatestStatAmongCreatures(battlefield, which);
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (power|toughness) among other creatures on (?:the )?battlefield$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      const excludedId = getExcludedId();
      return greatestStatAmongCreatures(battlefield, which, { excludedId: excludedId || undefined });
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (?:mana value|converted mana cost) among (other )?non[- ]?([a-z][a-z-]*) permanents you control$/i);
    if (m) {
      const isOther = Boolean(String(m[1] || '').trim());
      const excludedQualifier = String(m[2] || '').toLowerCase();
      const excludedId = isOther ? getExcludedId() : '';
      return highestManaValueAmongPermanents(controlled, {
        excludedId: excludedId || undefined,
        excludedQualifier,
      });
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (?:mana value|converted mana cost) among (other )?non[- ]?([a-z][a-z-]*) permanents (?:your opponents control|an opponent controls|you don['’]?t control|you do not control)$/i);
    if (m) {
      const isOther = Boolean(String(m[1] || '').trim());
      const excludedQualifier = String(m[2] || '').toLowerCase();
      const excludedId = isOther ? getExcludedId() : '';
      return highestManaValueAmongPermanents(opponentsControlled, {
        excludedId: excludedId || undefined,
        excludedQualifier,
      });
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (?:mana value|converted mana cost) among (other )?non[- ]?([a-z][a-z-]*) permanents on (?:the )?battlefield$/i);
    if (m) {
      const isOther = Boolean(String(m[1] || '').trim());
      const excludedQualifier = String(m[2] || '').toLowerCase();
      const excludedId = isOther ? getExcludedId() : '';
      return highestManaValueAmongPermanents(battlefield, {
        excludedId: excludedId || undefined,
        excludedQualifier,
      });
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (?:mana value|converted mana cost) among permanents on (?:the )?battlefield$/i);
    if (m) {
      return highestManaValueAmongPermanents(battlefield);
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (?:mana value|converted mana cost) among other permanents on (?:the )?battlefield$/i);
    if (m) {
      const excludedId = getExcludedId();
      return highestManaValueAmongPermanents(battlefield, { excludedId: excludedId || undefined });
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (?:mana value|converted mana cost) among other permanents you control$/i);
    if (m) {
      const excludedId = getExcludedId();
      return highestManaValueAmongPermanents(controlled, { excludedId: excludedId || undefined });
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (?:mana value|converted mana cost) among other permanents (?:your opponents control|an opponent controls|you don['’]?t control|you do not control)$/i);
    if (m) {
      const excludedId = getExcludedId();
      return highestManaValueAmongPermanents(opponentsControlled, { excludedId: excludedId || undefined });
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (?:mana value|converted mana cost) among artifacts you control$/i);
    if (m) {
      const artifacts = (controlled as any[]).filter((p: any) => hasExecutorClass(p, 'artifact')) as BattlefieldPermanent[];
      return highestManaValueAmongPermanents(artifacts);
    }
  }

  {
    const m = raw.match(/^x is the greatest number of creatures you control that have a creature type in common$/i);
    if (m) {
      return greatestSharedCreatureSubtypeCount(controlled);
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (?:mana value|converted mana cost) among permanents you control$/i);
    if (m) {
      return highestManaValueAmongPermanents(controlled);
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (?:mana value|converted mana cost) among permanents (?:your opponents control|an opponent controls|you don['’]?t control|you do not control)$/i);
    if (m) {
      return highestManaValueAmongPermanents(opponentsControlled);
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (power|toughness) among creatures you control$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      return leastStatAmongCreatures(controlled, which);
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (power|toughness) among creatures (?:your opponents control|an opponent controls|you don['’]?t control|you do not control)$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      return leastStatAmongCreatures(opponentsControlled, which);
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (power|toughness) among creatures on (?:the )?battlefield$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      return leastStatAmongCreatures(battlefield, which);
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (power|toughness) among other creatures you control$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      const excludedId = getExcludedId();
      return leastStatAmongCreatures(controlled, which, { excludedId: excludedId || undefined });
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (power|toughness) among other creatures (?:your opponents control|an opponent controls|you don['’]?t control|you do not control)$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      const excludedId = getExcludedId();
      return leastStatAmongCreatures(opponentsControlled, which, { excludedId: excludedId || undefined });
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (power|toughness) among other creatures on (?:the )?battlefield$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      const excludedId = getExcludedId();
      return leastStatAmongCreatures(battlefield, which, { excludedId: excludedId || undefined });
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (power|toughness) among (other )?non[- ]?([a-z][a-z-]*) creatures you control$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      const isOther = Boolean(String(m[2] || '').trim());
      const excludedSubtype = String(m[3] || '').toLowerCase();
      const excludedId = isOther ? getExcludedId() : '';
      return leastStatAmongCreatures(controlled, which, { excludedId: excludedId || undefined, excludedSubtype });
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (power|toughness) among (other )?non[- ]?([a-z][a-z-]*) creatures (?:your opponents control|an opponent controls|you don['’]?t control|you do not control)$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      const isOther = Boolean(String(m[2] || '').trim());
      const excludedSubtype = String(m[3] || '').toLowerCase();
      const excludedId = isOther ? getExcludedId() : '';
      return leastStatAmongCreatures(opponentsControlled, which, { excludedId: excludedId || undefined, excludedSubtype });
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (power|toughness) among (other )?non[- ]?([a-z][a-z-]*) creatures on (?:the )?battlefield$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      const isOther = Boolean(String(m[2] || '').trim());
      const excludedSubtype = String(m[3] || '').toLowerCase();
      const excludedId = isOther ? getExcludedId() : '';
      return leastStatAmongCreatures(battlefield, which, { excludedId: excludedId || undefined, excludedSubtype });
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (?:mana value|converted mana cost) among other permanents you control$/i);
    if (m) {
      const excludedId = getExcludedId();
      return lowestManaValueAmongPermanents(controlled, { excludedId: excludedId || undefined });
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (?:mana value|converted mana cost) among other permanents (?:your opponents control|an opponent controls|you don['’]?t control|you do not control)$/i);
    if (m) {
      const excludedId = getExcludedId();
      return lowestManaValueAmongPermanents(opponentsControlled, { excludedId: excludedId || undefined });
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (?:mana value|converted mana cost) among other permanents on (?:the )?battlefield$/i);
    if (m) {
      const excludedId = getExcludedId();
      return lowestManaValueAmongPermanents(battlefield, { excludedId: excludedId || undefined });
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (?:mana value|converted mana cost) among (other )?non[- ]?([a-z][a-z-]*) permanents you control$/i);
    if (m) {
      const isOther = Boolean(String(m[1] || '').trim());
      const excludedQualifier = String(m[2] || '').toLowerCase();
      const excludedId = isOther ? getExcludedId() : '';
      return lowestManaValueAmongPermanents(controlled, {
        excludedId: excludedId || undefined,
        excludedQualifier,
      });
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (?:mana value|converted mana cost) among (other )?non[- ]?([a-z][a-z-]*) permanents (?:your opponents control|an opponent controls|you don['’]?t control|you do not control)$/i);
    if (m) {
      const isOther = Boolean(String(m[1] || '').trim());
      const excludedQualifier = String(m[2] || '').toLowerCase();
      const excludedId = isOther ? getExcludedId() : '';
      return lowestManaValueAmongPermanents(opponentsControlled, {
        excludedId: excludedId || undefined,
        excludedQualifier,
      });
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (?:mana value|converted mana cost) among (other )?non[- ]?([a-z][a-z-]*) permanents on (?:the )?battlefield$/i);
    if (m) {
      const isOther = Boolean(String(m[1] || '').trim());
      const excludedQualifier = String(m[2] || '').toLowerCase();
      const excludedId = isOther ? getExcludedId() : '';
      return lowestManaValueAmongPermanents(battlefield, {
        excludedId: excludedId || undefined,
        excludedQualifier,
      });
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (?:mana value|converted mana cost) among permanents you control$/i);
    if (m) {
      return lowestManaValueAmongPermanents(controlled);
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (?:mana value|converted mana cost) among permanents (?:your opponents control|an opponent controls|you don['’]?t control|you do not control)$/i);
    if (m) {
      return lowestManaValueAmongPermanents(opponentsControlled);
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (?:mana value|converted mana cost) among permanents on (?:the )?battlefield$/i);
    if (m) {
      return lowestManaValueAmongPermanents(battlefield);
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (power|toughness) among (other )?non[- ]?([a-z][a-z-]*) creatures you control$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      const isOther = Boolean(String(m[2] || '').trim());
      const excludedSubtype = String(m[3] || '').toLowerCase();
      const excludedId = isOther ? getExcludedId() : '';
      return greatestStatAmongCreatures(controlled, which, {
        excludedId: excludedId || undefined,
        excludedSubtype,
      });
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (power|toughness) among (other )?non[- ]?([a-z][a-z-]*) creatures (?:your opponents control|an opponent controls|you don['’]?t control|you do not control)$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      const isOther = Boolean(String(m[2] || '').trim());
      const excludedSubtype = String(m[3] || '').toLowerCase();
      const excludedId = isOther ? getExcludedId() : '';
      return greatestStatAmongCreatures(opponentsControlled, which, {
        excludedId: excludedId || undefined,
        excludedSubtype,
      });
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (power|toughness) among (other )?non[- ]?([a-z][a-z-]*) creatures on (?:the )?battlefield$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      const isOther = Boolean(String(m[2] || '').trim());
      const excludedSubtype = String(m[3] || '').toLowerCase();
      const excludedId = isOther ? getExcludedId() : '';
      return greatestStatAmongCreatures(battlefield, which, {
        excludedId: excludedId || undefined,
        excludedSubtype,
      });
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (power|toughness) among other creatures you control$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      const excludedId = getExcludedId();
      return greatestStatAmongCreatures(controlled, which, { excludedId: excludedId || undefined });
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (power|toughness) among other creatures (?:your opponents control|an opponent controls|you don['’]?t control|you do not control)$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      const excludedId = getExcludedId();
      return greatestStatAmongCreatures(opponentsControlled, which, { excludedId: excludedId || undefined });
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (power|toughness) among creatures you control$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      return greatestStatAmongCreatures(controlled, which);
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (power|toughness) among creatures (?:your opponents control|an opponent controls|you don['’]?t control|you do not control)$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      return greatestStatAmongCreatures(opponentsControlled, which);
    }
  }

  {
    const m = raw.match(/^x is the number of (?:(nonland permanent|permanent|artifact|battle|creature|enchantment|instant|land|planeswalker|sorcery) )?cards? exiled with this (?:permanent|creature|artifact|enchantment|planeswalker|card)?$/i);
    if (m) {
      const sourceId = String(ctx?.sourceId || '').trim();
      if (!sourceId) return null;
      return countCardsExiledWithSource(state, sourceId, m[1]);
    }
  }

  // ── Cards exiled by a named permanent ────────────────────────────────────────
  {
    const m = raw.match(/^x is the number of (?:(nonland permanent|permanent|artifact|battle|creature|enchantment|instant|land|planeswalker|sorcery) )?cards? exiled with (?!this\b)([a-z][a-z0-9 ,.'\u2019-]*)$/i);
    if (m) {
      const wantedName = normalizeOracleText(String(m[2] || ''));
      if (!wantedName) return null;
      const namedPermanent = (battlefield as any[]).find((p: any) => {
        const name = normalizeOracleText(String((p as any)?.name || (p as any)?.card?.name || ''));
        return Boolean(name && name === wantedName);
      });
      const namedId = String((namedPermanent as any)?.id || '').trim();
      if (!namedId) return null;

      return countCardsExiledWithSource(state, namedId, m[1]);
    }
  }

  // ── Greatest power/toughness among [subtype] you/they control ─────────────
  {
    const m = raw.match(/^x is the (?:greatest|highest) (power|toughness) among ([\w]+(?:\s+[\w]+)*?)\s+(?:you control|they control|your opponents control|an opponent controls)$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      const subtypeRaw = String(m[2] || '').trim().toLowerCase();
      const controllerClause = String(m[0] || '').toLowerCase();
      const pool = /they control|your opponents control|an opponent controls/.test(controllerClause)
        ? opponentsControlled
        : controlled;
      const matching = (pool as any[]).filter((permanent: any) => {
        if (!hasExecutorClass(permanent, 'creature')) return false;
        const subtypes = getCreatureSubtypeKeys(permanent);
        return subtypes.some(subtype => subtype === subtypeRaw || subtypeRaw.startsWith(subtype) || subtype.startsWith(subtypeRaw.replace(/s$/, '')));
      }) as BattlefieldPermanent[];
      return greatestStatAmongCreatures(matching, which);
    }
  }

  // ── Greatest power among other attacking creatures ─────────────────────────
  {
    const m = raw.match(/^x is the (?:greatest|highest) (power|toughness) among other attacking creatures$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      const excludedId = getExcludedId();
      const attackingCreatures = (controlled as any[]).filter(permanent => isAttackingObject(permanent)) as BattlefieldPermanent[];
      return greatestStatAmongCreatures(attackingCreatures, which, { excludedId: excludedId || undefined });
    }
  }

  // ── Greatest power among tapped creatures opponents control ────────────────
  {
    const m = raw.match(/^x is the (?:greatest|highest) (power|toughness) among tapped creatures (?:your opponents control|an opponent controls|you don['']?t control|you do not control)$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      const tappedCreatures = (opponentsControlled as any[]).filter(permanent => (permanent as any)?.tapped || (permanent as any)?.isTapped) as BattlefieldPermanent[];
      return greatestStatAmongCreatures(tappedCreatures, which);
    }
  }

  // ── Greatest power among creature cards in graveyard ──────────────────────
  {
    const m = raw.match(/^x is the (?:greatest|highest) power among creature cards? in (?:your graveyard|all graveyards|(?:your opponents?|their) graveyard)$/i);
    if (m) {
      const clause = String(m[0] || '').toLowerCase();
      const allGy = /all graveyards/.test(clause);
      const cards: any[] = [];
      for (const player of (state.players || []) as any[]) {
        const pid = String((player as any)?.id || '').trim();
        if (!allGy && pid !== controllerId) continue;
        const gy = Array.isArray((player as any)?.graveyard) ? (player as any).graveyard : [];
        cards.push(...gy);
      }
      return greatestPowerAmongCreatureCards(cards);
    }
  }

  // ── Greatest power among creature cards exiled this way ───────────────────
  {
    const m = raw.match(/^x is the (?:greatest|highest) power among creature cards? exiled this way$/i);
    if (m) {
      const runtimeCards = Array.isArray(runtime?.lastExiledCards) ? runtime.lastExiledCards : null;
      if (runtimeCards) {
        return greatestPowerAmongCreatureCards(runtimeCards);
      }

      const sourceId = String(ctx?.sourceId || '').trim();
      const cards: any[] = [];
      for (const player of (state.players || []) as any[]) {
        const exile = Array.isArray((player as any)?.exile) ? (player as any).exile : [];
        for (const card of exile as any[]) {
          if (sourceId && String((card as any)?.exiledBy || '').trim() !== sourceId) continue;
          cards.push(card);
        }
      }
      return greatestPowerAmongCreatureCards(cards);
    }
  }

  // ── Greatest MV among cards in graveyard / discarded this way / exiled this way ──
  {
    const m = raw.match(/^x is the (?:greatest|highest) mana value among cards? (?:in your graveyard|discarded this way|exiled this way)$/i);
    if (m) {
      const clause = String(m[0] || '').toLowerCase();
      if (/exiled this way/.test(clause) && Array.isArray(runtime?.lastExiledCards)) {
        return greatestManaValueAmongCards(runtime.lastExiledCards);
      }

      const sourceId = String(ctx?.sourceId || '').trim();
      const cards: any[] = [];
      for (const player of (state.players || []) as any[]) {
        const pid = String((player as any)?.id || '').trim();
        if (pid !== controllerId) continue;
        const isExile = /exiled this way/.test(clause);
        const zone: readonly any[] = isExile
          ? (Array.isArray((player as any)?.exile) ? (player as any).exile : [])
          : (Array.isArray((player as any)?.graveyard) ? (player as any).graveyard : []);
        for (const card of zone as any[]) {
          if (isExile && sourceId && String((card as any)?.exiledBy || '').trim() !== sourceId) continue;
          cards.push(card);
        }
      }
      return greatestManaValueAmongCards(cards);
    }
  }

  // ── Greatest MV among elementals you control ──────────────────────────────
  {
    const m = raw.match(/^x is the (?:greatest|highest) mana value among elementals? you control$/i);
    if (m) {
      const elementals = (controlled as any[]).filter((p: any) =>
        getCreatureSubtypeKeys(p).includes('elemental')
      ) as BattlefieldPermanent[];
      return highestManaValueAmongPermanents(elementals);
    }
  }

  // ── Greatest MV among other artifacts you control ────────────────────────
  {
    const m = raw.match(/^x is the (?:greatest|highest) mana value among other artifacts? you control$/i);
    if (m) {
      const excludedId = getExcludedId();
      const artifacts = (controlled as any[]).filter((p: any) => hasExecutorClass(p, 'artifact')) as BattlefieldPermanent[];
      return highestManaValueAmongPermanents(artifacts, { excludedId: excludedId || undefined });
    }
  }

  // ── Greatest MV among your commanders ────────────────────────────────────
  {
    const m = raw.match(/^x is the (?:greatest|highest) mana value among (?:your |the )?commanders?$/i);
    if (m) {
      const commanders = [
        ...(controlled as any[]).filter((p: any) => isCommanderObject(p)),
        ...collectCommandZoneObjects().filter((obj: any) => {
          const ownerId = String((obj as any)?.ownerId || (obj as any)?.owner || (obj as any)?.controllerId || '').trim();
          return (!ownerId || ownerId === controllerId) && isCommanderObject(obj);
        }),
      ];
      return greatestManaValueAmongCards(commanders);
    }
  }

  // ── Greatest MV among instant and sorcery spells you've cast this turn ────
  {
    const m = raw.match(/^x is the (?:greatest|highest) mana value among instant(?:\s+and\s+sorcery)?\s+(?:and sorcery\s+)?spells? (?:you(?:'ve)? cast|cast) (?:from\s+.+\s+)?this turn$/i);
    if (m) {
      const spells: readonly any[] = Array.isArray((state as any)?.spellsCastThisTurn)
        ? (state as any).spellsCastThisTurn
        : [];
      const matchingSpells = spells.filter((spell: any) => {
        const spellControllerId = String((spell as any)?.controllerId || (spell as any)?.controller || '').trim();
        if (spellControllerId && spellControllerId !== controllerId) return false;
        const tl = typeLineLower(spell);
        return tl.includes('instant') || tl.includes('sorcery');
      });
      return greatestManaValueAmongCards(matchingSpells);
    }
  }

  // ── Greatest number of artifacts an opponent controls ─────────────────────
  {
    const m = raw.match(/^x is the greatest number of artifacts? (?:an? )?opponent(?:s?) controls?$/i);
    if (m) {
      const artifactCountsByOpponent = new Map<string, number>();
      for (const permanent of battlefield as any[]) {
        const permanentControllerId = String((permanent as any)?.controller || '').trim();
        if (!permanentControllerId || permanentControllerId === controllerId) continue;
        if (!hasExecutorClass(permanent, 'artifact')) continue;
        artifactCountsByOpponent.set(
          permanentControllerId,
          (artifactCountsByOpponent.get(permanentControllerId) || 0) + 1
        );
      }

      return Array.from(artifactCountsByOpponent.values()).reduce(
        (greatest, count) => Math.max(greatest, count),
        0
      );
    }
  }

  // ── Number of [type] counters on [named card] ────────────────────────────
  {
    const m = raw.match(/^x is (?:the number of|the amount of) (.+?) counters? on ([a-z0-9][a-z0-9 ,'.-]{2,60})$/i);
    if (m) {
      const counterType = String(m[1] || '').trim();
      const cardName = String(m[2] || '').trim();
      const ref = findObjectByName(cardName);
      if (!ref) return null;
      return getCounterCountOnObject(ref, counterType);
    }
  }

  // ── Difference between power and toughness ────────────────────────────────
  {
    const m = raw.match(/^x is the difference between (?:its|that creature'?s|this creature'?s) power and toughness$/i);
    if (m) {
      const refId = getExcludedId();
      if (!refId) return null;
      const target = battlefield.find((p: any) => String((p as any)?.id || '').trim() === refId) as any;
      if (!target) return null;
      const pw = Number(target?.power);
      const tg = Number(target?.toughness);
      if (!Number.isFinite(pw) || !Number.isFinite(tg)) return null;
      return Math.abs(pw - tg);
    }
  }

  // ── Loyalty stat of a named planeswalker ─────────────────────────────────
  {
    const m = raw.match(/^x is ([a-z0-9 ,.'-]+)'s loyalty$/i);
    if (m) {
      const walkerName = String(m[1] || '').trim();
      const ref = findObjectByName(walkerName) as any;
      if (!ref) return null;
      const loyalty = Number(ref?.loyalty ?? ref?.card?.loyalty ?? ref?.loyaltyCounters ?? ref?.counters?.loyalty);
      return Number.isFinite(loyalty) ? loyalty : null;
    }
  }

  // ── Difference between those players’ life totals ───────────────────────────────────
  {
    const m = raw.match(/^x is the difference between those players['’] life totals?$/i);
    if (m) {
      const ids: readonly string[] = Array.isArray(ctx?.selectorContext?.eachOfThoseOpponents)
        ? (ctx?.selectorContext?.eachOfThoseOpponents || []).map(id => String(id || '').trim()).filter(Boolean)
        : [];
      if (ids.length < 2) return null;

      const lifes: number[] = [];
      for (const pid of ids.slice(0, 2)) {
        const player = findPlayerById(pid);
        if (!player) return null;
        const life = Number(player?.life ?? player?.lifeTotal ?? 0);
        if (!Number.isFinite(life)) return null;
        lifes.push(life);
      }
      if (lifes.length < 2) return null;
      return Math.abs(lifes[0] - lifes[1]);
    }
  }

  // ── Amount of {E} energy you have ────────────────────────────────────────
  {
    const m = raw.match(/^x is the amount of \{e\} you have$/i);
    if (m) {
      const player = findPlayerById(controllerId);
      if (!player) return null;
      const energy = Number(player?.energyCounters ?? player?.energy ?? player?.counters?.energy ?? 0);
      return Number.isFinite(energy) ? energy : 0;
    }
  }

  // ── Damage dealt to this creature / it this turn ─────────────────────────
  {
    const m = raw.match(/^x is the amount of damage dealt to (it|this creature) this turn$/i);
    if (m) {
      const refId = getExcludedId();
      if (!refId) return null;
      const ref = battlefield.find((p: any) => String((p as any)?.id || '').trim() === refId) as any;
      if (!ref) return null;
      const damage = Number(ref?.damage ?? ref?.markedDamage ?? 0);
      return Number.isFinite(damage) ? Math.max(0, damage) : null;
    }
  }

  // ── Damage this creature / it dealt to that player ───────────────────────
  {
    const m = raw.match(/^x is the amount of damage (?:this creature|that creature|it) dealt to that player$/i);
    if (m) {
      const creatureId = getExcludedId();
      if (!creatureId) return null;

      const playerId = String(
        ctx?.selectorContext?.targetPlayerId ||
        ctx?.selectorContext?.targetOpponentId ||
        ''
      ).trim();
      if (!playerId) return null;

      const stateAny: any = state as any;
      const byPlayer = stateAny?.creaturesThatDealtDamageToPlayer;
      if (!byPlayer || typeof byPlayer !== 'object' || Array.isArray(byPlayer)) return null;

      const perPlayer = (byPlayer as Record<string, any>)[playerId];
      if (!perPlayer || typeof perPlayer !== 'object' || Array.isArray(perPlayer)) return 0;

      const totalDamage = Number(perPlayer?.[creatureId]?.totalDamage ?? 0);
      return Number.isFinite(totalDamage) ? Math.max(0, totalDamage) : null;
    }
  }

  // ── How far below 0 its power is (negative power) ────────────────────────
  {
    const m = raw.match(/^x is how (?:far below 0|much less than 0) its power is$/i);
    if (m) {
      const refId = getExcludedId();
      if (!refId) return null;
      const target = battlefield.find((p: any) => String((p as any)?.id || '').trim() === refId) as any;
      if (!target) return null;
      const pw = Number(target?.power);
      if (!Number.isFinite(pw)) return null;
      return pw < 0 ? Math.abs(pw) : 0;
    }
  }

  // ── Random number from a range ───────────────────────────────────────────
  {
    const m =
      raw.match(/^x is a number from (\d+) to (\d+) chosen at random(?: each time)?$/i) ||
      raw.match(/^x is a number chosen at random from (\d+) to (\d+)(?: each time)?$/i);
    if (m) {
      const sourceId = String(ctx?.sourceId || '').trim();
      if (!sourceId) return null;
      const a = parseInt(String(m[1] || '0'), 10);
      const b = parseInt(String(m[2] || '0'), 10);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
      const min = Math.min(a, b);
      const max = Math.max(a, b);
      return Math.floor(Math.random() * (max - min + 1)) + min;
    }
  }

  // ── Safe-skips (non-deterministic or complex context) ────────────────────
  // Random numbers
  if (/^x is a number chosen at random$/i.test(raw)) return null;
  // Noted numbers
  if (/^x is the (?:noted number|highest number you noted)/i.test(raw)) return null;
  // Chosen number (player choice)
  if (/^x is the chosen number$/i.test(raw)) return null;
  // First/second chosen result pair
  if (/^x is the first chosen result/i.test(raw)) return null;
  // Number in creature's text box
  if (/^x is a number in the sacrificed creature'?s text box$/i.test(raw)) return null;
  // Complex structural counts
  if (/^x is the greatest number of (?:consecutive|stored results)/i.test(raw)) return null;
  // Specific total-damage tracking (requires complex event log)
  if (/^x is the greatest amount of damage dealt by a source/i.test(raw)) return null;

  return null;
}

function parseSacrificeWhat(what: { readonly kind: string; readonly text?: string; readonly raw?: string }):
  | { readonly mode: 'all'; readonly type: SimplePermanentType }
  | { readonly mode: 'count'; readonly count: number; readonly type: SimplePermanentType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase();

  // Shorthand deterministic forms (no explicit "all" / count) that still mean a fixed set:
  // - "your creatures" / "your artifacts" / ...
  // - "creatures you control" / "artifacts under your control" / ...
  // Note: By rules, a player can only sacrifice permanents they control; reject opponent-scoped text.
  {
    const normalized = cleaned.replace(/\u2019/g, "'");
    const normalizedLower = normalized.toLowerCase();

    const mentionsOpponentControl =
      /^(?:your\s+)?opponents?['’]s?\s+/i.test(normalized) ||
      /^opponent['’]s?\s+/i.test(normalized) ||
      /\b(?:your opponents|opponents)\s+control\b/i.test(normalized) ||
      /\b(?:an opponent|each opponent)\s+controls\b/i.test(normalized) ||
      /\byou\s+(?:don'?t|do not)\s+control\b/i.test(normalized);

    if (!mentionsOpponentControl && (/^your\s+/i.test(normalized) || /\b(?:you control|under your control)\b/i.test(normalized))) {
      const stripped = normalized
        .replace(/^your\s+/i, '')
        .replace(/\s+you\s+control\b/gi, '')
        .replace(/\s+under\s+your\s+control\b/gi, '')
        .trim();
      const type = parseSimplePermanentTypeFromText(stripped);
      if (type) return { mode: 'all', type };
    }
  }

  if (/^all\b/i.test(lower)) {
    const type = parseSimplePermanentTypeFromText(cleaned);
    return type ? { mode: 'all', type } : null;
  }

  // Deterministic-forced only when player controls <= N matching permanents.
  const mCount = cleaned.match(/^(a|an|\d+)\s+(.+)$/i);
  if (!mCount) return null;
  const countRaw = String(mCount[1] || '').toLowerCase();
  const rest = String(mCount[2] || '').trim();

  const count = countRaw === 'a' || countRaw === 'an' ? 1 : parseInt(countRaw, 10);
  if (!Number.isFinite(count) || count <= 0) return null;

  const type = parseSimplePermanentTypeFromText(rest);
  if (!type) return null;
  return { mode: 'count', count: Math.max(1, count | 0), type };
}

/**
 * Best-effort executor for Oracle Effect IR.
 *
 * Purposefully conservative:
 * - Only applies steps that can be executed without player choices.
 * - Skips optional ("You may") steps unless allowOptional=true.
 * - Skips targeting-dependent steps for now.
 */
export function applyOracleIRStepsToGameState(
  state: GameState,
  steps: readonly OracleEffectStep[],
  ctx: OracleIRExecutionContext,
  options: OracleIRExecutionOptions = {}
): OracleIRExecutionResult {
  const log: string[] = [];
  const appliedSteps: OracleEffectStep[] = [];
  const skippedSteps: OracleEffectStep[] = [];
  const localAutomationGaps: OracleAutomationGap[] = [];
  const automationGaps: OracleAutomationGap[] = [];
  const controllerId = (String(ctx.controllerId || '').trim() || ctx.controllerId) as PlayerID;
  let lastRevealedCardCount = 0;
  let lastDiscardedCardCount = 0;
  let lastExiledCardCount = 0;
  let lastExiledCards: any[] = [];
  let lastGoadedCreatures: BattlefieldPermanent[] = [];
  let lastSacrificedCreaturesPowerTotal = 0;
  let lastExcessDamageDealtThisWay = 0;
  let lastScryLookedAtCount = 0;

  let nextState = state;
  const pendingOptionalSteps: OracleEffectStep[] = [];
  let automationGapSequence = 0;

  const recordSkippedStep = (
    step: OracleEffectStep,
    message: string,
    reasonCode: string,
    options: {
      readonly pending?: boolean;
      readonly classification?: 'unsupported' | 'ambiguous' | 'player_choice' | 'invalid_input';
      readonly metadata?: Record<string, string | number | boolean | null | readonly string[]>;
      readonly persist?: boolean;
    } = {}
  ): void => {
    skippedSteps.push(step);
    if (options.pending) {
      pendingOptionalSteps.push(step);
    }
    log.push(message);

    if (options.persist === false) {
      return;
    }

    const gap = createOracleAutomationGapRecord({
      state: nextState,
      ctx,
      step,
      reasonCode,
      message,
      sequence: ++automationGapSequence,
      classification: options.classification,
      metadata: options.metadata,
    });
    localAutomationGaps.push(gap);
    automationGaps.push(gap);
  };

  const applyHandledStepResult = (
    step: OracleEffectStep,
    result: any,
    onApplied?: (appliedResult: any) => void
  ): boolean => {
    if ('message' in result) {
      recordSkippedStep(step, result.message, result.reason, result.options);
      return false;
    }

    nextState = result.state;
    onApplied?.(result);
    log.push(...result.log);
    appliedSteps.push(step);
    return true;
  };

  const applyModifyPtStepResult = (
    step: OracleEffectStep,
    result: any
  ): boolean => {
    if (result.kind === 'recorded_skip') {
      recordSkippedStep(step, result.message, result.reason);
      return false;
    }
    if (result.kind === 'unrecorded_skip') {
      skippedSteps.push(step);
      log.push(result.log);
      return false;
    }
    if (result.kind !== 'applied') {
      return false;
    }

    nextState = result.state;
    log.push(...result.log);
    appliedSteps.push(step);
    return true;
  };

  for (const step of steps) {
    const isOptional = Boolean((step as any).optional);
    if (isOptional && !options.allowOptional) {
      recordSkippedStep(
        step,
        `Skipped optional step (needs player choice): ${(step as any).raw ?? step.kind}`,
        'optional_step_requires_player_choice',
        {
          pending: true,
          classification: 'player_choice',
        }
      );
      continue;
    }

    switch (step.kind) {
      case 'exile_top': {
        const result = applyExileTopStep(nextState, step, ctx);
        applyHandledStepResult(step, result, (appliedResult) => {
          lastExiledCardCount = Math.max(0, Number(appliedResult.lastExiledCardCount) || 0);
          lastExiledCards = [...appliedResult.lastExiledCards];
        });
        break;
      }

      case 'impulse_exile_top': {
        const result = applyImpulseExileTopStep(nextState, step, ctx);
        applyHandledStepResult(step, result, (appliedResult) => {
          lastExiledCardCount = Math.max(0, Number(appliedResult.lastExiledCardCount) || 0);
          lastExiledCards = [...appliedResult.lastExiledCards];
        });
        break;
      }

      case 'goad': {
        const result = applyGoadStep(nextState, step, ctx, controllerId);
        applyHandledStepResult(step, result, (appliedResult) => {
          lastGoadedCreatures = [...appliedResult.lastGoadedCreatures];
        });
        break;
      }

      case 'draw': {
        const result = applyDrawStep(nextState, step, ctx);
        applyHandledStepResult(step, result);
        break;
      }

      case 'add_mana': {
        const result = applyAddManaStep(nextState, step, ctx);
        applyHandledStepResult(step, result);
        break;
      }

      case 'scry': {
        const result = applyScryStep(nextState, step, ctx);
        applyHandledStepResult(step, result, (appliedResult) => {
          lastScryLookedAtCount = Math.max(0, Number(appliedResult.lastScryLookedAtCount) || 0);
        });
        break;
      }

      case 'surveil': {
        const result = applySurveilStep(nextState, step, ctx);
        applyHandledStepResult(step, result);
        break;
      }

      case 'mill': {
        const result = applyMillStep(nextState, step, ctx);
        if ('message' in result) {
          recordSkippedStep(step, result.message, result.reason, result.options);
          break;
        }

        nextState = result.state;
        if (typeof result.lastRevealedCardCount === 'number') {
          lastRevealedCardCount = Math.max(0, Number(result.lastRevealedCardCount) || 0);
        }
        log.push(...result.log);
        appliedSteps.push(step);
        break;
      }

      case 'modify_pt': {
        const result = applyModifyPtStep(
          nextState,
          step,
          ctx,
          controllerId,
          {
            lastRevealedCardCount,
            lastDiscardedCardCount,
            lastExiledCardCount,
            lastExiledCards,
            lastGoadedCreatures,
            lastSacrificedCreaturesPowerTotal,
            lastExcessDamageDealtThisWay,
            lastScryLookedAtCount,
          },
          evaluateModifyPtWhereX,
          evaluateModifyPtCondition
        );
        applyModifyPtStepResult(step, result);
        break;
      }

      case 'modify_pt_per_revealed': {
        const result = applyModifyPtPerRevealedStep(nextState, step, ctx, lastRevealedCardCount);
        applyModifyPtStepResult(step, result);
        break;
      }

      case 'discard': {
        const result = applyDiscardStep(nextState, step, ctx);
        applyHandledStepResult(step, result, (appliedResult) => {
          lastDiscardedCardCount = Math.max(0, Number(appliedResult.lastDiscardedCardCount) || 0);
        });
        break;
      }

      case 'gain_life': {
        const result = applyGainLifeStep(nextState, step, ctx);
        applyHandledStepResult(step, result);
        break;
      }

      case 'lose_life': {
        const result = applyLoseLifeStep(nextState, step, ctx);
        applyHandledStepResult(step, result);
        break;
      }

      case 'deal_damage': {
        const result = applyDealDamageStep(nextState, step, ctx);
        applyHandledStepResult(step, result, (appliedResult) => {
          lastExcessDamageDealtThisWay = Math.max(0, Number(appliedResult.excessDamageDealtThisWay) || 0);
        });
        break;
      }

      case 'tap_or_untap': {
        const result = applyTapOrUntapStep(nextState, step, ctx);
        applyHandledStepResult(step, result);
        break;
      }

      case 'move_zone': {
        const result = applyMoveZoneStep(nextState, step, ctx);
        applyHandledStepResult(step, result);
        break;
      }

      case 'create_token': {
        const result = applyCreateTokenStep(nextState, step, ctx);
        applyHandledStepResult(step, result);
        break;
      }

      case 'destroy': {
        const result = applyDestroyStep(nextState, step, ctx);
        applyHandledStepResult(step, result);
        break;
      }

      case 'exile': {
        const result = applyExileStep(nextState, step, ctx);
        applyHandledStepResult(step, result);
        break;
      }

      case 'sacrifice': {
        const result = applySacrificeStep(nextState, step, ctx);
        applyHandledStepResult(step, result, (appliedResult) => {
          lastSacrificedCreaturesPowerTotal = Math.max(
            0,
            Number(appliedResult.lastSacrificedCreaturesPowerTotal) || 0
          );
        });
        break;
      }

      case 'choose_mode':
        {
          const result = applyChooseModeStep(nextState, step, ctx, options, applyOracleIRStepsToGameState);
          if (result.kind === 'recorded_skip') {
            recordSkippedStep(step, result.message, result.reason, result.options);
            break;
          }

          nextState = result.state;
          log.push(...result.log);
          appliedSteps.push(...result.appliedSteps);
          skippedSteps.push(...result.skippedSteps);
          automationGaps.push(...result.automationGaps);
          pendingOptionalSteps.push(...result.pendingOptionalSteps);
        }
        break;

      default:
        recordSkippedStep(step, `Skipped unsupported step: ${step.raw}`, 'unsupported_step');
        break;
    }
  }

  nextState = appendOracleAutomationGapRecords(nextState, localAutomationGaps);

  return { state: nextState, log, appliedSteps, skippedSteps, automationGaps, pendingOptionalSteps };
}





