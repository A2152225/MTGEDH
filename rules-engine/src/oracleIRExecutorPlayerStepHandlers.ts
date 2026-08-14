import type { GameState, PlayerID } from '../../shared/src';
import { permanentHasCreatureType } from '../../shared/src/creatureTypes.js';
import type { OracleClauseCondition, OracleEffectStep, OracleObjectSelector, OracleQuantity } from './oracleIR';
import { createCustomEmblem } from './emblemSupport';
import type { OracleIRExecutionContext, OracleIRExecutionOptions } from './oracleIRExecutionTypes';
import type { OracleIRReplayMutation } from './oracleIRReplayMutations';
import { omitBridgedStepCarryOver, usedOracleIrServerBridge } from './oracleIRStepLedgerRuntime';
import {
  buildDiscardEffectReplayMutationsFromCards,
  type OracleIRReplayMutation,
} from './oracleIRReplayMutations';
import type { ModifyPtRuntime } from './oracleIRExecutorModifyPtStepHandlers';
import { resolveReferencedObject } from './oracleIRExecutorReferenceUtils';
import { resolveOracleIrBoundTargetSpellId } from './oracleIrTargetBinding';
import {
  addBattlefieldPermanentsToState,
  createBattlefieldPermanentsFromCards,
  cardMatchesMoveZoneSingleTargetCriteria,
  cardMatchesType,
  parseMoveZoneAnyNumberCardsFromYourHand,
  parseMoveZoneAnyNumberTypedFromYourHand,
  parseMoveZoneSingleTargetCriteria,
  parseMoveZoneTypedCardFromYourHand,
  parseMoveZoneUpToTargetCountFromYourHand,
  parseSimpleCardTypeFromText,
  type MoveZoneSingleTargetCriteria,
} from './oracleIRExecutorZoneOps';
import { payManaCost } from './spellCasting';
import { createEmptyManaPool, setManaDoesNotEmpty, type ManaCost } from './types/mana';
import { parseManaSymbols } from './types/numbers';
import { oracleGraveyardAdditionalCostToSerializable } from './graveyardPermissionAdditionalCost';
import {
  addManaToPoolForPlayer,
  applyExilePermissionMarkers,
  applyGraveyardPermissionMarkers,
  adjustLife,
  adjustPlayerCounter,
  discardCardsForPlayer,
  discardSpecificCardsForPlayer,
  deriveWinningVoteChoice,
  drawCardsForPlayer,
  getCardManaValue,
  getCardTypeLineLower,
  millCardsForPlayer,
  lookSelectTopCardsForPlayer,
  collectTopLibraryObservationForPlayers,
  quantityToNumber,
  resolveVotesReceivedQuantity,
  readPlayerZoneCards,
  resolvePlayers,
  writePlayerZoneCards,
  getPlayableUntilTurnForImpulseDuration,
  resolveUnknownMillUntilAmountForPlayer,
  resolveRevealUntilReferenceAmountForPlayer,
  isCardExiledWithSource,
  normalizeOracleText,
  stampCardsPutIntoGraveyardThisTurn,
} from './oracleIRExecutorPlayerUtils';
import { countManaSymbolsInManaCost } from './oracleIRExecutorManaUtils';
import { evaluateModifyPtWhereX } from './oracleIRExecutorModifyPtWhereEvaluator';
import { resolveSingleCreatureTargetId, resolveCreatureTargetIds } from './oracleIRExecutorCreatureStepUtils';
import {
  resolveControllerSpellCastCountThisTurn,
  resolveOracleQuantity,
  resolveOracleQuantityForPlayer,
  type ResolveOracleQuantityOptions,
} from './oracleIRExecutorResolveQuantity';
import { collectForEachReferenceBattlefieldPermanentIds } from './oracleIRExecutorForEachQuantity';
import { evaluateOracleStepUnlessCondition } from './oracleIRExecutorConditionalStepSupport';
import {
  commitCardZoneChanges,
  commitLibraryTopObservation,
  commitLookSelectRestZoneChanges,
  type PlayerZoneChangeBridgeContext,
} from './oracleIRExecutorCardZoneTransitionCommit';
import { buildEffectBridgeOptions } from './oracleIRExecutorDamageTransitionCommit';
import { resolveBattlefieldEntryFromOracleIrContext } from './oracleIRExecutorBattlefieldEntryCommit';
import { inferSplitLibrarySearchPlan } from './oracleIRSplitLibrarySearch';
import {
  collectRevealedThisWayCardsLedgerFirst,
  resolveAntecedentContextualCards,
  resolveAntecedentMilledCards,
} from './oracleIRLedgerCardAccess';

function buildPlayerZoneBridgeOptions(
  ctx: OracleIRExecutionContext,
  stepKind: 'discard' | 'mill',
): PlayerZoneChangeBridgeContext | undefined {
  if (!ctx.serverBridge) return undefined;
  if (ctx.currentStepIndex == null) return undefined;
  return {
    ctx,
    stepIndex: ctx.currentStepIndex,
    stepKind,
  };
}

function withDiscardLedgerFlags<T extends Record<string, unknown>>(
  result: T,
  ledgerRecordedViaBridge?: boolean,
  options?: { discardDestination?: 'graveyard' | 'exile' },
): T & { skipLedgerFlush?: boolean } {
  let next: T = result;
  // Server-bridge discards flush the ledger themselves and omit lastDiscardedCards.
  // Promote those cards into replayMutations first so Windfall-style wheels survive event-log replay.
  if (ledgerRecordedViaBridge) {
    const cards = Array.isArray((result as any).lastDiscardedCards)
      ? ((result as any).lastDiscardedCards as any[])
      : [];
    if (cards.length > 0) {
      const existing = Array.isArray((result as any).replayMutations)
        ? ([...(result as any).replayMutations] as OracleIRReplayMutation[])
        : [];
      const hasDiscardMutations = existing.some((mutation) => mutation?.kind === 'discardEffect');
      if (!hasDiscardMutations) {
        const destination = options?.discardDestination
          || ((result as any).discardDestination === 'exile' ? 'exile' : 'graveyard');
        const promoted = buildDiscardEffectReplayMutationsFromCards(cards, destination);
        // Only attach when non-empty. An empty replayMutations array would block
        // collectReplayMutationsFromAppliedStep's discard fallback after omit strips cards.
        if (promoted.length > 0) {
          next = {
            ...result,
            replayMutations: [...existing, ...promoted],
          } as T;
        }
      }
    }
  }
  return omitBridgedStepCarryOver(next, { ledgerRecordedViaBridge });
}

type StepApplyResult = {
  readonly applied: true;
  readonly state: GameState;
  readonly log: readonly string[];
  readonly count?: number;
  readonly lastTopLibraryOwnerId?: PlayerID;
  readonly lastClashWon?: boolean;
  readonly lastCollectedEvidence?: boolean;
  readonly lastVisitedAttractions?: readonly any[];
  readonly lastScryLookedAtCount?: number;
  readonly lastDiscardedCardCount?: number;
  readonly lastGreatestDiscardedCardCount?: number;
  readonly lastDiscardedCards?: readonly any[];
  readonly lastMovedCards?: readonly any[];
  readonly lastRevealedCardCount?: number;
  readonly lastGrantedGraveyardCards?: readonly any[];
  readonly lastGrantedGraveyardPermissionIds?: readonly string[];
  readonly lastDungeonRoomEffectText?: string;
  readonly lastDungeonRoomName?: string;
  readonly lastDungeonName?: string;
  readonly lastSetInMotionScheme?: any;
  readonly lastAntecedentBattlefieldPermanentIds?: readonly string[];
  readonly skipLedgerFlush?: boolean;
  readonly replayMutations?: readonly OracleIRReplayMutation[];
};

function sanitizeGrantedGraveyardPermissionIdPart(value: unknown): string {
  return normalizeOracleText(String(value || ''))
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function buildGrantedGraveyardPermissionId(options: {
  playerId: PlayerID;
  permission: 'play' | 'cast';
  sourceId?: string;
  sourceName?: string;
  qualifier?: string;
  cardIds?: string[];
  turnApplied: number;
}): string {
  const sourcePart = sanitizeGrantedGraveyardPermissionIdPart(options.sourceId || options.sourceName || 'source');
  const qualifierPart = sanitizeGrantedGraveyardPermissionIdPart(
    options.qualifier || (Array.isArray(options.cardIds) ? options.cardIds.join('_') : '') || 'cards'
  );
  return [
    'graveyard-permission',
    options.playerId,
    options.permission,
    sourcePart || 'source',
    qualifierPart || 'cards',
    Number(options.turnApplied || 0) || 0,
  ].map(sanitizeGrantedGraveyardPermissionIdPart).filter(Boolean).join(':');
}

function normalizeGrantedGraveyardPermissionDuration(duration: Extract<Extract<OracleEffectStep, { kind: 'grant_graveyard_permission' }>['duration'], string>): 'this_turn' | 'until_end_of_next_turn' {
  switch (duration) {
    case 'during_next_turn':
    case 'until_end_of_next_turn':
    case 'until_end_of_combat_on_next_turn':
    case 'until_next_turn':
    case 'until_next_upkeep':
    case 'until_next_end_step':
      return 'until_end_of_next_turn';
    default:
      return 'this_turn';
  }
}

export function mergeGrantedGraveyardPermissionSourceText(
  existingSourceText: string,
  modifierSourceText: string,
): string {
  const base = String(existingSourceText || '').trim();
  const tail = String(modifierSourceText || '').trim();
  if (!base) {
    return tail;
  }
  if (!tail) {
    return base;
  }

  const collapse = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();
  const normalizedBase = collapse(base);
  const normalizedTail = collapse(tail);

  if (normalizedBase.includes(normalizedTail)) {
    return base;
  }

  const byClauseMatch = base.match(/\bby\s+(.+?)\s+in addition to paying\b/i);
  if (byClauseMatch) {
    const byClause = collapse(byClauseMatch[1] || '');
    if (byClause.includes(normalizedTail) || normalizedTail.includes(byClause)) {
      return base;
    }
  }

  return `${base} ${tail}`.trim();
}

function buildFirstClassGrantedGraveyardPermission(
  state: GameState,
  playerId: PlayerID,
  step: Extract<OracleEffectStep, { kind: 'grant_graveyard_permission' }>,
  ctx: OracleIRExecutionContext,
  resolvedCards: readonly any[],
): any | undefined {
  const sourceId = String(ctx.sourceId || '').trim();
  const sourceName = String(ctx.sourceName || '').trim();
  const selectorText =
    step.what.kind === 'raw'
      ? normalizePermissionSelectorText(step.what.text)
      : normalizePermissionSelectorText((step.what as any).raw || '');
  const contextualReference = /^(?:it|that card|that spell|the discarded card|target .+?)$/.test(selectorText);
  const selfReference = /^(?:this card|this spell|this permanent|this creature)$/.test(selectorText);
  const cardIds = (contextualReference || selfReference)
    ? (Array.isArray(resolvedCards) ? resolvedCards : [])
        .map((card: any) => String(card?.id || card?.cardId || '').trim())
        .filter(Boolean)
    : [];
  const qualifier = !contextualReference && !selfReference ? selectorText : '';
  if (!qualifier && cardIds.length === 0) {
    return undefined;
  }

  const turnApplied = Number((state as any)?.turnNumber ?? (state as any)?.turn ?? 0) || 0;
  const rawText = String(step.raw || '').trim();
  return {
    id: buildGrantedGraveyardPermissionId({
      playerId,
      permission: step.permission,
      ...(sourceId ? { sourceId } : {}),
      ...(sourceName ? { sourceName } : {}),
      ...(qualifier ? { qualifier } : {}),
      ...(cardIds.length > 0 ? { cardIds } : {}),
      turnApplied,
    }),
    playerId,
    permission: step.permission,
    sourceZone: 'graveyard',
    cardFilter: {
      ...(qualifier ? { qualifier } : {}),
      ...(cardIds.length > 0 ? { cardIds } : {}),
    },
    costMode: 'normal',
    duration: normalizeGrantedGraveyardPermissionDuration(step.duration),
    turnApplied,
    ...(sourceId ? { sourceId } : {}),
    ...(sourceName ? { sourceName } : {}),
    ...(rawText ? { sourceText: rawText } : {}),
    ...( /\bonce during each of your turns\b/i.test(rawText)
      ? { usageLimit: { type: 'once_per_turn', maxUses: 1 } }
      : {}),
  };
}

function readPermanentPower(permanent: any): number | null {
  for (const value of [permanent?.effectivePower, permanent?.basePower, permanent?.card?.power, permanent?.power]) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function readPermanentToughness(permanent: any): number | null {
  for (const value of [permanent?.effectiveToughness, permanent?.baseToughness, permanent?.card?.toughness, permanent?.toughness]) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function permanentIsCreature(permanent: any): boolean {
  const typeLine = String(permanent?.card?.type_line || permanent?.type_line || permanent?.cardType || '')
    .toLowerCase();
  return /\bcreature\b/.test(typeLine);
}

function permanentHasSubtype(permanent: any, subtype: string | undefined): boolean {
  const needle = String(subtype || '').trim();
  if (!needle) return false;
  return permanentHasCreatureType(permanent, needle);
}

function repeatManaString(mana: string, count: number): string {
  if (count <= 0) return '';
  return Array.from({ length: count }, () => mana).join('');
}

function getSourceBattlefieldPermanent(state: GameState, ctx: OracleIRExecutionContext): any | null {
  const sourceId = String(ctx.sourceId || '').trim();
  if (!sourceId) return null;
  return ((state.battlefield || []) as any[]).find((permanent) => String(permanent?.id || '').trim() === sourceId) || null;
}

function readCounterCount(permanent: any, counterName: string): number {
  const normalizedCounterName = normalizeOracleText(counterName);
  const counters = permanent?.counters;
  if (!counters || typeof counters !== 'object') return 0;

  for (const [name, value] of Object.entries(counters)) {
    if (normalizeOracleText(name) !== normalizedCounterName) continue;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
  }

  return 0;
}

function getControlledPermanents(state: GameState, controllerId: string): any[] {
  const normalizedControllerId = String(controllerId || '').trim();
  return ((state.battlefield || []) as any[]).filter(
    (permanent) => String(permanent?.controller || permanent?.controllerId || '').trim() === normalizedControllerId
  );
}

function expandManaCostToManaSequence(rawManaCost: string): string | null {
  const symbols = parseManaSymbols(String(rawManaCost || '').trim());
  if (symbols.length === 0) return '';

  let mana = '';
  for (const symbolRaw of symbols) {
    const symbol = String(symbolRaw || '').trim().toUpperCase();
    if (!symbol) continue;

    if (/^\{\d+\}$/.test(symbol)) {
      mana += repeatManaString('{C}', Number.parseInt(symbol.slice(1, -1), 10));
      continue;
    }

    if (/^\{[WUBRGC]\}$/.test(symbol)) {
      mana += symbol;
      continue;
    }

    return null;
  }

  return mana;
}

function resolveDynamicAddManaSequence(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'add_mana' }>,
  ctx: OracleIRExecutionContext
): string | null | undefined {
  const normalizedReference = step.amount?.kind === 'reference_amount'
    ? normalizeOracleText(String(step.amount.raw || ''))
    : '';
  if (normalizedReference !== "enchanted permanent's mana cost") return undefined;

  const sourcePermanent = getSourceBattlefieldPermanent(state, ctx);
  if (!sourcePermanent) return null;

  const attachedToId = String(sourcePermanent?.attachedTo || sourcePermanent?.enchanting || '').trim();
  if (!attachedToId) return null;

  const enchantedPermanent = ((state.battlefield || []) as any[]).find(
    (permanent) => String(permanent?.id || '').trim() === attachedToId
  );
  if (!enchantedPermanent) return null;

  const manaCost = String(
    enchantedPermanent?.manaCost ||
      enchantedPermanent?.mana_cost ||
      enchantedPermanent?.card?.manaCost ||
      enchantedPermanent?.card?.mana_cost ||
      ''
  ).trim();
  return expandManaCostToManaSequence(manaCost);
}

function resolveAddManaAmount(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'add_mana' }>,
  ctx: OracleIRExecutionContext
): number | null {
  if (!step.amount) return 1;

  if (step.amount.kind === 'number') return Math.max(0, Math.floor(step.amount.value));
  if (step.amount.kind === 'x') return Number.isFinite(ctx.xValue) ? Math.max(0, Math.floor(ctx.xValue as number)) : null;
  if (step.amount.kind === 'object_stat') {
    const sourcePermanent = getSourceBattlefieldPermanent(state, ctx);
    if (!sourcePermanent) return null;
    if (step.amount.stat === 'power') return readPermanentPower(sourcePermanent);
    if (step.amount.stat === 'toughness') return readPermanentToughness(sourcePermanent);
    if (step.amount.stat === 'mana_value') return getCardManaValue(sourcePermanent?.card || sourcePermanent);
    return null;
  }
  if (step.amount.kind === 'greatest_power_among_creatures_you_control') {
    const powers = getControlledPermanents(state, ctx.controllerId)
      .filter(permanentIsCreature)
      .map(readPermanentPower)
      .filter((value): value is number => value !== null);
    return powers.length > 0 ? Math.max(0, ...powers) : 0;
  }
  if (step.amount.kind === 'reference_amount') {
    const normalized = normalizeOracleText(String(step.amount.raw || ''));
    const sourcePermanent = getSourceBattlefieldPermanent(state, ctx);
    switch (normalized) {
      case 'the chosen colors':
        return 1;
      case 'the number of art counters on this permanent plus one':
        return sourcePermanent ? readCounterCount(sourcePermanent, 'art') + 1 : null;
      case 'the number of time counters on this artifact':
        return sourcePermanent ? readCounterCount(sourcePermanent, 'time') : null;
      case 'the number of charge counters on this artifact':
        return sourcePermanent ? readCounterCount(sourcePermanent, 'charge') : null;
      case 'the number of different powers among creatures you control': {
        const powers = new Set<number>();
        for (const permanent of getControlledPermanents(state, ctx.controllerId).filter(permanentIsCreature)) {
          const power = readPermanentPower(permanent);
          if (power !== null) powers.add(power);
        }
        return powers.size;
      }
      case 'x plus one':
      case 'x plus one cards':
        return Number.isFinite(ctx.xValue) ? Math.max(0, Math.floor(ctx.xValue as number) + 1) : null;
      case 'your devotion to green': {
        return getControlledPermanents(state, ctx.controllerId)
          .reduce((sum, permanent) => sum + countManaSymbolsInManaCost(permanent, 'G'), 0);
      }
      case 'the greatest power among creatures you control that entered this turn': {
        const powers = getControlledPermanents(state, ctx.controllerId)
          .filter(permanentIsCreature)
          .filter((permanent) => permanent?.enteredThisTurn === true)
          .map(readPermanentPower)
          .filter((value): value is number => value !== null);
        return powers.length > 0 ? Math.max(0, ...powers) : 0;
      }
      case 'the number of creatures you control of the chosen type': {
        const chosenType = String(ctx.selectorContext?.chosenCreatureType || '').trim();
        if (!chosenType) return null;
        return getControlledPermanents(state, ctx.controllerId)
          .filter(permanentIsCreature)
          .filter((permanent) => permanentHasSubtype(permanent, chosenType))
          .length;
      }
      case 'twice that much': {
        const quantity = quantityToNumber({ kind: 'reference_amount', raw: 'that much' }, ctx);
        return quantity === null ? null : Math.max(0, quantity * 2);
      }
      case 'the high bid': {
        const referenceAmount = Number(ctx.referenceAmount);
        return Number.isFinite(referenceAmount) ? Math.max(0, referenceAmount) : 2;
      }
      case 'noncreature cards exiled this way': {
        const exiledCards = Array.isArray(ctx.lastExiledCards) ? ctx.lastExiledCards : [];
        return exiledCards.filter((card: any) => !getCardTypeLineLower(card).includes('creature')).length;
      }
      default: {
        const evaluated = evaluateModifyPtWhereX(state, ctx.controllerId, `X is ${normalized}`, undefined, ctx);
        if (evaluated !== null) return Math.max(0, evaluated);
        const quantity = quantityToNumber(step.amount, ctx);
        return quantity === null ? null : Math.max(0, quantity);
      }
    }
  }

  if (step.amount.kind === 'unknown') {
    const normalized = normalizeOracleText(String(step.amount.raw || ''));
    const evaluated = evaluateModifyPtWhereX(state, ctx.controllerId, `X is ${normalized}`, undefined, ctx);
    if (evaluated !== null) return Math.max(0, evaluated);
  }

  const quantity = quantityToNumber(step.amount, ctx);
  return quantity === null ? null : Math.max(0, quantity);
}

function resolveStepAmountForPlayer(
  state: GameState,
  controllerId: PlayerID,
  amount: OracleQuantity,
  ctx: OracleIRExecutionContext,
  targetPlayerId: PlayerID | undefined,
  options?: ResolveOracleQuantityOptions & { whereX?: OracleClauseCondition },
): number | null {
  const resolved = targetPlayerId
    ? resolveOracleQuantityForPlayer(state, controllerId, amount, ctx, targetPlayerId, options)
    : resolveOracleQuantity(state, controllerId, amount, ctx, options);
  return resolved;
}

function resolveDynamicDrawAmount(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'draw' }>,
  ctx: OracleIRExecutionContext,
  runtime?: ModifyPtRuntime
): number | null {
  const amountRaw = String((step.amount as any)?.raw || '').trim().toLowerCase();
  if (/the milled card'?s mana value/.test(amountRaw)) {
    const milled = [
      ...(Array.isArray((ctx as any).lastMilledCards) ? (ctx as any).lastMilledCards : []),
      ...(Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : []),
      ...(Array.isArray(ctx.lastMovedCards) ? ctx.lastMovedCards : []),
    ];
    if (milled.length > 0) {
      const manaValue = getCardManaValue(milled[milled.length - 1]);
      if (manaValue !== null) return manaValue;
    }
  }

  const fromShared = resolveOracleQuantity(state, ctx.controllerId, step.amount, ctx, {
    whereX: step.whereX,
    runtime,
  });
  if (fromShared !== null) return fromShared;

  if (step.amount.kind === 'source_power') return resolveSourcePower(state, ctx);
  if (step.amount.kind === 'greatest_power_among_creatures_you_control') {
    const controllerId = String(ctx.controllerId || '').trim();
    const excludeSubtype = step.amount.excludeSubtype;
    const powers = ((state.battlefield || []) as any[])
      .filter((permanent) => String(permanent?.controller || '').trim() === controllerId)
      .filter(permanentIsCreature)
      .filter((permanent) => !permanentHasSubtype(permanent, excludeSubtype))
      .map(readPermanentPower)
      .filter((value): value is number => value !== null);
    return powers.length > 0 ? Math.max(0, ...powers) : 0;
  }
  if (step.amount.kind === 'votes_received') {
    return resolveVotesReceivedQuantity(state, String(ctx.controllerId || ''), step.amount);
  }
  if (step.amount.kind === 'votes_for_choice') {
    const fromState = Number(
      (state as any)?.lastVoteResults?.[String(step.amount.choice || '').toLowerCase()] ??
        (state as any)?.voteResults?.[String(step.amount.choice || '').toLowerCase()]
    );
    if (Number.isFinite(fromState)) {
      const multiplier = Number.isFinite(Number(step.amount.multiplier))
        ? Math.max(0, Math.trunc(Number(step.amount.multiplier)))
        : 1;
      return Math.max(0, Math.floor(fromState * multiplier));
    }
  }
  return quantityToNumber(step.amount, ctx);
}

type StepSkipResult = {
  readonly applied: false;
  readonly message: string;
  readonly reason:
    | 'unknown_amount'
    | 'unsupported_player_selector'
    | 'unsupported_object_selector'
    | 'unsupported_condition_clause'
    | 'player_choice_required'
    | 'impossible_action'
    | 'failed_to_apply'
    | 'invalid_input';
  readonly state?: GameState;
  readonly options?: {
    readonly classification?: 'ambiguous' | 'player_choice' | 'invalid_input';
    readonly metadata?: Record<
      string,
      string | number | boolean | readonly string[] | Readonly<Record<string, number>>
    >;
    readonly persist?: boolean;
  };
};

type UnlessPaysLifeResult =
  | { readonly applied: true; readonly shouldApplyNestedSteps: boolean; readonly state?: GameState; readonly log: readonly string[] }
  | StepSkipResult;

type UnlessPaysManaResult =
  | { readonly applied: true; readonly shouldApplyNestedSteps: boolean; readonly state?: GameState; readonly log: readonly string[] }
  | StepSkipResult;

type UnlessDiscardsResult =
  | { readonly applied: true; readonly shouldApplyNestedSteps: boolean; readonly state?: GameState; readonly log: readonly string[] }
  | (StepSkipResult & {
      /**
       * When set, the caller should record this inner step (rather than the outer
       * `unless_discards` wrapper) as the skipped step, so the existing "discard"
       * automation-gap plumbing (and its server-side card-selection prompt) fires
       * for the actual discard choice instead of a bespoke prompt.
       */
      readonly innerStep?: OracleEffectStep;
    });

export type PlayerStepHandlerResult = StepApplyResult | StepSkipResult;

function shuffleArray<T>(items: readonly T[]): T[] {
  const shuffled = [...items];
  for (let idx = shuffled.length - 1; idx > 0; idx -= 1) {
    const swapIdx = Math.floor(Math.random() * (idx + 1));
    [shuffled[idx], shuffled[swapIdx]] = [shuffled[swapIdx], shuffled[idx]];
  }
  return shuffled;
}

function normalizeColorSymbols(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((value) => String(value || '').trim().toUpperCase())
    .map((value) => value.length === 1 ? value : value.slice(0, 1))
    .filter((value) => /^[WUBRG]$/.test(value));
}

function getCommanderColorIdentityForPlayer(state: GameState, playerId: PlayerID): string[] {
  const player: any = (state.players || []).find((entry: any) => entry?.id === playerId);
  const direct = normalizeColorSymbols(player?.commanderColorIdentity || player?.colorIdentity || player?.deckColorIdentity);
  if (direct.length > 0) return [...new Set(direct)];

  const commanderCards: any[] = [];
  for (const source of [player?.commander, player?.commanders]) {
    if (Array.isArray(source)) commanderCards.push(...source);
    else if (source) commanderCards.push(source);
  }

  const commanderZone = Array.isArray((state as any)?.commanderZone) ? (state as any).commanderZone : [];
  commanderCards.push(...commanderZone.filter((entry: any) => String(entry?.ownerId || entry?.owner || entry?.controller || '').trim() === String(playerId)));

  const colors = commanderCards.flatMap((card: any) =>
    normalizeColorSymbols(card?.colorIdentity || card?.color_identity || card?.card?.colorIdentity || card?.card?.color_identity)
  );
  return [...new Set(colors)];
}

function readPower(value: any): number {
  if (!value) return 0;
  if (typeof value.effectivePower === 'number') return value.effectivePower;
  let power = typeof value.basePower === 'number' ? value.basePower : undefined;
  if (typeof power !== 'number') {
    const rawPower = value.card?.power ?? value.power;
    power = typeof rawPower === 'string' ? Number.parseInt(rawPower, 10) : Number(rawPower);
  }
  if (!Number.isFinite(power)) power = 0;
  const counters = (value.counters || {}) as Record<string, number>;
  power += Math.max(0, Number(counters['+1/+1']) || 0);
  power -= Math.max(0, Number(counters['-1/-1']) || 0);
  return power;
}

function resolveSourcePower(state: GameState, ctx: OracleIRExecutionContext): number | null {
  const sourceId = String(ctx.sourceId || '').trim();
  if (!sourceId) return null;
  const source = ((state.battlefield || []) as any[]).find((perm) => String(perm?.id || '').trim() === sourceId);
  return source ? Math.max(0, readPower(source)) : null;
}

function normalizeLookChooseSelectorText(value: string): string {
  return String(value || '')
    .replace(/^an?\s+/i, '')
    .replace(/\s+card$/i, '')
    .trim();
}

function splitLookChooseSelectorTerms(value: string): string[] {
  const normalized = normalizeLookChooseSelectorText(value)
    .replace(/\s+and\/or\s+/gi, ',')
    .replace(/\s*,\s*or\s+/gi, ',')
    .replace(/\s+or\s+/gi, ',')
    .replace(/\s*,\s*/g, ',')
    .trim();
  if (!normalized) return [];
  return normalized
    .split(',')
    .map(part => part.trim().toLowerCase())
    .filter(Boolean);
}

function cardMatchesLookChooseTerm(card: any, term: string): boolean {
  const normalizedTerm = String(term || '').trim().toLowerCase();
  if (!normalizedTerm) return false;

  const parsedType = parseSimpleCardTypeFromText(normalizedTerm);
  if (parsedType) {
    return cardMatchesMoveZoneSingleTargetCriteria(card, { cardType: parsedType }, undefined, 0);
  }

  const typeLine = getCardTypeLineLower(card);
  const name = String(card?.name || card?.card?.name || '').trim().toLowerCase();
  return typeLine.includes(normalizedTerm) || name.includes(normalizedTerm);
}

function resolveLookChooseManaValueLimit(
  state: GameState,
  playerId: PlayerID,
  selectorText: string,
): number | null {
  const normalizedSelector = normalizeLookChooseSelectorText(selectorText)
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalizedSelector) return null;

  if (/with mana value less than or equal to the number of lands you control/i.test(normalizedSelector)) {
    const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
    return battlefield.filter((permanent: any) => {
      if (!permanent || String(permanent.controller || '') !== playerId) return false;
      return String(permanent.card?.type_line || '').toLowerCase().includes('land');
    }).length;
  }

  const manaValueMatch = normalizedSelector.match(/^(.+?)\s+with\s+mana\s+value\s+(\d+)\s+or\s+less$/i);
  if (!manaValueMatch) return null;
  const parsed = Number.parseInt(String(manaValueMatch[2] || ''), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function cardMatchesLookChooseSelector(
  card: any,
  selectorText: string,
  manaValueLimitOverride?: number | null,
  chosenCreatureType?: string,
): boolean {
  const normalizedSelector = normalizeLookChooseSelectorText(selectorText)
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalizedSelector) return false;

  const structuredCriteria = parseMoveZoneSingleTargetCriteria(normalizedSelector);
  if (structuredCriteria?.usesChosenCreatureType) {
    const chosenType = String(chosenCreatureType || '').trim();
    if (!chosenType) return false;
    return cardMatchesMoveZoneSingleTargetCriteria(card, {
      ...structuredCriteria,
      creatureTypesAnyOf: [chosenType],
    });
  }

  const manaValueMatch = normalizedSelector.match(/^(.+?)\s+with\s+mana\s+value\s+(\d+)\s+or\s+less$/i);
  const selectorWithoutManaLimit = manaValueMatch
    ? String(manaValueMatch[1] || '').trim()
    : normalizedSelector.replace(/\s+with\s+mana\s+value\s+less than or equal to the number of lands you control$/i, '').trim();
  const manaValueLimit = manaValueLimitOverride !== undefined
    ? manaValueLimitOverride
    : (manaValueMatch ? Number.parseInt(String(manaValueMatch[2] || ''), 10) : null);
  if (manaValueLimit !== null && (!Number.isFinite(manaValueLimit) || Number(getCardManaValue(card) ?? 0) > manaValueLimit)) {
    return false;
  }

  const terms = splitLookChooseSelectorTerms(selectorWithoutManaLimit);
  if (terms.length === 0) return false;

  const negativeTerms = terms
    .map(term => {
      const match = term.match(/^non-?(.+)$/i);
      return match ? String(match[1] || '').trim().toLowerCase() : null;
    })
    .filter((term): term is string => Boolean(term));
  const positiveTerms = terms.filter(term => !/^non-?/i.test(term));

  if (negativeTerms.some(term => cardMatchesLookChooseTerm(card, term))) {
    return false;
  }

  if (positiveTerms.length === 0) {
    return true;
  }

  return positiveTerms.some(term => cardMatchesLookChooseTerm(card, term));
}

function parseLookChooseSelectionLimits(
  selectorText: string,
  optional?: boolean
): { readonly minSelections: number; readonly maxSelections: number } {
  const normalized = normalizeLookChooseSelectorText(selectorText).toLowerCase();

  if (/\band\/or\b/i.test(normalized)) {
    const parts = normalized.split(/\s+and\/or\s+/i).map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return { minSelections: optional ? 0 : 1, maxSelections: parts.length };
    }
  }

  const wordToNum = (word: string): number => {
    const map: Record<string, number> = {
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
      eight: 8,
      nine: 9,
      ten: 10,
    };
    const lower = String(word || '').trim().toLowerCase();
    if (map[lower]) return map[lower];
    const parsed = Number.parseInt(lower, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  };

  const upToMatch = normalized.match(/^up to (one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/i);
  if (upToMatch) {
    const maxSelections = wordToNum(upToMatch[1]);
    return { minSelections: optional ? 0 : 0, maxSelections };
  }

  return { minSelections: optional ? 0 : 1, maxSelections: 1 };
}

export function buildLookChooseLibrarySearchFilter(
  selectorText: string
): { readonly types?: readonly string[]; readonly subtypes?: readonly string[] } {
  const terms = splitLookChooseSelectorTerms(normalizeLookChooseSelectorText(selectorText));
  const types: string[] = [];
  const subtypes: string[] = [];

  for (const term of terms) {
    if (/^non-?/i.test(term)) continue;
    const parsedType = parseSimpleCardTypeFromText(term);
    if (parsedType) {
      if (!types.includes(parsedType)) types.push(parsedType);
      continue;
    }
    if (term && !subtypes.includes(term)) subtypes.push(term);
  }

  return {
    ...(types.length > 0 ? { types } : {}),
    ...(subtypes.length > 0 ? { subtypes } : {}),
  };
}

export function buildLookChooseFromTopSelectionOptions(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'look_choose_from_top' }>,
  ctx: OracleIRExecutionContext,
  runtime?: ModifyPtRuntime
): {
  readonly playerId: PlayerID;
  readonly lookedCount: number;
  readonly availableCards: readonly any[];
  readonly selectableCardIds: readonly string[];
  readonly minSelections: number;
  readonly maxSelections: number;
  readonly destination: 'hand' | 'exile' | 'battlefield';
  readonly filter: ReturnType<typeof buildLookChooseLibrarySearchFilter>;
  readonly restOrder?: 'any';
  readonly contextValue?: number;
} | null {
  const amount = resolveLookChooseAmount(state, step, ctx, runtime);
  if (amount === null || amount <= 0) return null;

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length !== 1) return null;

  const playerId = players[0];
  const player = state.players.find(entry => entry.id === playerId) as any;
  if (!player) return null;

  const library = Array.isArray(player.library) ? player.library : [];
  const lookedCount = Math.max(0, Math.min(library.length, amount | 0));
  if (lookedCount <= 0) return null;

  const lookedCards = library.slice(0, lookedCount);
  const chosenCreatureType = String(ctx.selectorContext?.chosenCreatureType || '').trim();
  const manaValueLimit = resolveLookChooseManaValueLimit(state, playerId, step.selectorText);
  const selectableCardIds = lookedCards
    .filter(card => cardMatchesLookChooseSelector(card, step.selectorText, manaValueLimit, chosenCreatureType))
    .map(card => String(card?.id || '').trim())
    .filter(Boolean);
  const limits = parseLookChooseSelectionLimits(step.selectorText, step.optional === true);

  return {
    playerId,
    lookedCount,
    availableCards: lookedCards,
    selectableCardIds,
    minSelections: limits.minSelections,
    maxSelections: limits.maxSelections,
    destination: step.destination,
    filter: buildLookChooseLibrarySearchFilter(step.selectorText),
    ...(step.restOrder === 'any' ? { restOrder: 'any' as const } : {}),
    ...(step.destination === 'battlefield' && manaValueLimit !== null
      ? { contextValue: manaValueLimit }
      : {}),
  };
}

export function buildLookSelectTopSelectionOptions(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'look_select_top' }>,
  ctx: OracleIRExecutionContext,
  runtime?: ModifyPtRuntime
): {
  readonly playerId: PlayerID;
  readonly lookedCount: number;
  readonly chooseCount: number;
  readonly chooseMin: number;
  readonly availableCards: readonly any[];
  readonly destination: 'hand' | 'graveyard' | 'library_top';
  readonly restDestination: 'graveyard' | 'library';
  readonly restToTop: boolean;
  readonly restRandomOrder: boolean;
} | null {
  const amount = resolveLookSelectAmount(state, step, ctx, runtime);
  if (amount === null) return null;

  const chooseMax = quantityToNumber(step.choose, ctx);
  if (chooseMax === null) return null;

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length !== 1) return null;

  const playerId = players[0];
  const player = state.players.find(entry => entry.id === playerId) as any;
  if (!player) return null;

  const library = Array.isArray(player.library) ? player.library : [];
  const lookedCount = Math.max(0, Math.min(library.length, amount | 0));
  const chooseCount = Math.max(0, Math.min(lookedCount, chooseMax | 0));
  const chooseMin = Math.max(0, Math.min(chooseCount, step.chooseMin ?? (step.optional ? 0 : chooseCount)));

  return {
    playerId,
    lookedCount,
    chooseCount,
    chooseMin,
    availableCards: library.slice(0, lookedCount),
    destination: step.destination,
    restDestination: step.restDestination,
    restToTop: Boolean(step.restToTop),
    restRandomOrder: Boolean(step.restRandomOrder),
  };
}

function resolveLookSelectAmount(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'look_select_top' }>,
  ctx: OracleIRExecutionContext,
  runtime?: ModifyPtRuntime
): number | null {
  const resolved = resolveOracleQuantity(state, ctx.controllerId, step.amount, ctx, {
    whereX: step.whereX,
    runtime,
  });
  if (resolved !== null) return resolved;

  if (step.amount.kind !== 'x') {
    return quantityToNumber(step.amount, ctx);
  }

  const raw = String(step.raw || '').trim();
  const whereMatch = raw.match(/\bwhere\s+x\s+is\s+(.+?)(?:\.\s|$)/i);
  if (!whereMatch) return null;

  const evaluated = evaluateModifyPtWhereX(
    state,
    ctx.controllerId,
    `X is ${String(whereMatch[1] || '').trim()}`,
    undefined,
    ctx,
    runtime
  );
  return evaluated === null ? null : Math.max(0, evaluated);
}

function lookChooseFromTopRequiresPlayerChoice(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'look_choose_from_top' }>,
  ctx: OracleIRExecutionContext,
  runtime?: ModifyPtRuntime
): boolean {
  if (ctx.interactivePlayerChoices === false) return false;
  if (getNormalizedChosenIds(ctx).length > 0) return false;

  if (
    usedOracleIrServerBridge(ctx)
    && step.destination === 'battlefield'
    && step.amount?.kind === 'reference_amount'
  ) {
    const built = buildLookChooseFromTopSelectionOptions(state, step, ctx, runtime);
    return Boolean(built && built.selectableCardIds.length > 0);
  }

  if (step.optional === true && ctx.deferOptionalLookChoices !== true) return false;
  const built = buildLookChooseFromTopSelectionOptions(state, step, ctx, runtime);
  if (!built) return false;
  if (step.optional !== true) return false;
  return built.selectableCardIds.length > 0;
}

function lookSelectTopRequiresPlayerChoice(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'look_select_top' }>,
  ctx: OracleIRExecutionContext,
  runtime?: ModifyPtRuntime
): boolean {
  if (ctx.interactivePlayerChoices === false) return false;
  if (getNormalizedChosenIds(ctx).length > 0) return false;
  const built = buildLookSelectTopSelectionOptions(state, step, ctx, runtime);
  if (!built) return false;
  if (built.lookedCount <= 0) return false;
  if (built.chooseMin < built.chooseCount) return true;
  if (step.destination === 'library_top') return built.lookedCount > 0;
  return built.lookedCount > built.chooseCount;
}

function chooseCollectEvidenceCardIds(
  graveyard: readonly any[],
  requiredManaValue: number,
  chosenObjectIds?: readonly string[]
): string[] {
  const normalizedRequiredManaValue = Math.max(0, Number(requiredManaValue) || 0);
  if (normalizedRequiredManaValue <= 0) return [];

  const cards = (Array.isArray(graveyard) ? graveyard : [])
    .map((card: any, index: number) => ({
      id: String(card?.id || '').trim(),
      manaValue: Math.max(0, Number(getCardManaValue(card) ?? 0)),
      index,
    }))
    .filter(card => Boolean(card.id));

  const chosenIdSet = new Set(
    (Array.isArray(chosenObjectIds) ? chosenObjectIds : [])
      .map(id => String(id || '').trim())
      .filter(Boolean)
  );
  if (chosenIdSet.size > 0) {
    return cards.filter(card => chosenIdSet.has(card.id)).map(card => card.id);
  }

  let best: { ids: string[]; total: number; count: number; indices: number[] } | null = null;
  if (cards.length <= 12) {
    const visit = (index: number, ids: string[], total: number, indices: number[]): void => {
      if (total >= normalizedRequiredManaValue) {
        const candidate = { ids: [...ids], total, count: ids.length, indices: [...indices] };
        if (
          !best ||
          candidate.count < best.count ||
          (candidate.count === best.count && candidate.total < best.total) ||
          (
            candidate.count === best.count &&
            candidate.total === best.total &&
            candidate.indices.join(',') < best.indices.join(',')
          )
        ) {
          best = candidate;
        }
        return;
      }
      if (index >= cards.length) return;
      if (best && ids.length >= best.count) return;

      visit(index + 1, [...ids, cards[index].id], total + cards[index].manaValue, [...indices, cards[index].index]);
      visit(index + 1, ids, total, indices);
    };
    visit(0, [], 0, []);
  }

  if (best) {
    return best.ids;
  }

  let total = 0;
  const greedy = [...cards]
    .sort((a, b) => (b.manaValue - a.manaValue) || (a.index - b.index))
    .filter(card => {
      if (total >= normalizedRequiredManaValue) return false;
      total += card.manaValue;
      return true;
    })
    .map(card => card.id);

  return total >= normalizedRequiredManaValue ? greedy : [];
}

function getNormalizedChosenIds(ctx: OracleIRExecutionContext): readonly string[] {
  return (Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : [])
    .map(id => String(id || '').trim())
    .filter(Boolean);
}

function filterChosenHandCardIds(
  state: GameState,
  playerId: PlayerID,
  chosenIds: readonly string[],
): readonly string[] {
  const player = state.players.find((candidate) => candidate.id === playerId) as any;
  const handIds = new Set(
    (Array.isArray(player?.hand) ? player.hand : [])
      .map((card: any) => String(card?.id || card?.card?.id || '').trim())
      .filter(Boolean),
  );
  return chosenIds.filter((id) => handIds.has(id));
}

function filterChosenLibraryMatchIds(
  matches: readonly any[],
  chosenIds: readonly string[],
  maxResults: number,
): readonly string[] {
  const matchIds = new Set(
    matches
      .map((card) => String(card?.id || card?.cardId || '').trim())
      .filter(Boolean),
  );
  const filtered = chosenIds.filter((id) => matchIds.has(id));
  if (filtered.length === 0) return [];
  return filtered.slice(0, Math.max(1, maxResults));
}

function getNormalizedChosenDungeonId(ctx: OracleIRExecutionContext): string | undefined {
  const chosenDungeonId = String(ctx.selectorContext?.chosenDungeonId || '').trim().toLowerCase();
  return chosenDungeonId || undefined;
}

function getNormalizedChosenDungeonRoomId(ctx: OracleIRExecutionContext): string | undefined {
  const chosenDungeonRoomId = String(ctx.selectorContext?.chosenDungeonRoomId || '').trim().toLowerCase();
  return chosenDungeonRoomId || undefined;
}

function isLessonCard(card: any): boolean {
  return /\blesson\b/i.test(String(card?.type_line || ''));
}

type DungeonRoomDefinition = {
  readonly id: string;
  readonly name: string;
  readonly effectText: string;
  readonly nextRoomIds: readonly string[];
};

type DungeonDefinition = {
  readonly id: string;
  readonly name: string;
  readonly rooms: readonly DungeonRoomDefinition[];
};

const DUNGEON_DEFINITIONS: readonly DungeonDefinition[] = [
  {
    id: 'lost_mine',
    name: 'Lost Mine of Phandelver',
    rooms: [
      { id: 'cave_entrance', name: 'Cave Entrance', effectText: 'Scry 1.', nextRoomIds: ['goblin_lair', 'mine_tunnels'] },
      {
        id: 'goblin_lair',
        name: 'Goblin Lair',
        effectText: 'Create a 1/1 red Goblin creature token.',
        nextRoomIds: ['storeroom', 'dark_pool'],
      },
      {
        id: 'mine_tunnels',
        name: 'Mine Tunnels',
        effectText: 'Create a Treasure token.',
        nextRoomIds: ['dark_pool', 'fungi_cavern'],
      },
      {
        id: 'storeroom',
        name: 'Storeroom',
        effectText: 'Put a +1/+1 counter on target creature you control.',
        nextRoomIds: ['temple_of_dumathoin'],
      },
      {
        id: 'dark_pool',
        name: 'Dark Pool',
        effectText: 'Each opponent loses 1 life and you gain 1 life.',
        nextRoomIds: ['temple_of_dumathoin'],
      },
      {
        id: 'fungi_cavern',
        name: 'Fungi Cavern',
        effectText: "Target creature gets -4/-0 until your next turn.",
        nextRoomIds: ['temple_of_dumathoin'],
      },
      {
        id: 'temple_of_dumathoin',
        name: 'Temple of Dumathoin',
        effectText: 'Draw a card.',
        nextRoomIds: [],
      },
    ],
  },
  {
    id: 'tomb',
    name: 'Tomb of Annihilation',
    rooms: [
      {
        id: 'trapped_entry',
        name: 'Trapped Entry',
        effectText: 'Each player loses 1 life.',
        nextRoomIds: ['veils_of_fear', 'oubliette'],
      },
      {
        id: 'veils_of_fear',
        name: 'Veils of Fear',
        effectText: 'Each player loses 2 life unless they discard a card.',
        nextRoomIds: ['sandfall_cell'],
      },
      {
        id: 'oubliette',
        name: 'Oubliette',
        effectText: 'Discard a card and sacrifice a creature, an artifact, and a land.',
        nextRoomIds: ['cradle_of_the_death_god'],
      },
      {
        id: 'sandfall_cell',
        name: 'Sandfall Cell',
        effectText: 'Each player loses 2 life unless they sacrifice a creature, artifact, or land of their choice.',
        nextRoomIds: ['cradle_of_the_death_god'],
      },
      {
        id: 'cradle_of_the_death_god',
        name: 'Cradle of the Death God',
        effectText: 'Create The Atropal, a legendary 4/4 black God Horror creature token with deathtouch.',
        nextRoomIds: [],
      },
    ],
  },
  {
    id: 'mad_mage',
    name: 'Dungeon of the Mad Mage',
    rooms: [
      { id: 'yawning_portal', name: 'Yawning Portal', effectText: 'You gain 1 life.', nextRoomIds: ['dungeon_level'] },
      {
        id: 'dungeon_level',
        name: 'Dungeon Level',
        effectText: 'Scry 1.',
        nextRoomIds: ['goblin_bazaar', 'twisted_caverns'],
      },
      {
        id: 'goblin_bazaar',
        name: 'Goblin Bazaar',
        effectText: 'Create a Treasure token.',
        nextRoomIds: ['lost_level'],
      },
      {
        id: 'twisted_caverns',
        name: 'Twisted Caverns',
        effectText: "Target creature can't attack until your next turn.",
        nextRoomIds: ['lost_level'],
      },
      { id: 'lost_level', name: 'Lost Level', effectText: 'Scry 2.', nextRoomIds: ['runestone_caverns', 'muirals_graveyard'] },
      {
        id: 'runestone_caverns',
        name: 'Runestone Caverns',
        effectText: 'Exile the top two cards of your library. You may play them.',
        nextRoomIds: ['deep_mines'],
      },
      {
        id: 'muirals_graveyard',
        name: "Muiral's Graveyard",
        effectText: 'Create two 1/1 black Skeleton creature tokens.',
        nextRoomIds: ['deep_mines'],
      },
      { id: 'deep_mines', name: 'Deep Mines', effectText: 'Scry 3.', nextRoomIds: ['mad_wizards_lair'] },
      {
        id: 'mad_wizards_lair',
        name: "Mad Wizard's Lair",
        effectText: 'Draw three cards and reveal them. You may cast one of them without paying its mana cost.',
        nextRoomIds: [],
      },
    ],
  },
];

function getDungeonDefinition(dungeonId: string): DungeonDefinition | undefined {
  const normalizedDungeonId = String(dungeonId || '').trim().toLowerCase();
  return DUNGEON_DEFINITIONS.find(dungeon => dungeon.id === normalizedDungeonId);
}

function getDungeonRoomDefinition(
  dungeonId: string,
  roomId: string | undefined
): DungeonRoomDefinition | undefined {
  const dungeon = getDungeonDefinition(dungeonId);
  const normalizedRoomId = String(roomId || '').trim().toLowerCase();
  if (!dungeon || !normalizedRoomId) return undefined;
  return dungeon.rooms.find(room => room.id === normalizedRoomId);
}

function getDefaultDungeonPath(dungeon: DungeonDefinition): readonly string[] {
  const path: string[] = [];
  let currentRoom = dungeon.rooms[0];
  const visited = new Set<string>();
  while (currentRoom && !visited.has(currentRoom.id)) {
    path.push(currentRoom.id);
    visited.add(currentRoom.id);
    currentRoom = currentRoom.nextRoomIds.length > 0
      ? dungeon.rooms.find(room => room.id === currentRoom.nextRoomIds[0])
      : undefined;
  }
  return path;
}

function getDungeonRoomDefinitionByProgress(dungeonId: string, progress: any): DungeonRoomDefinition | undefined {
  const dungeon = getDungeonDefinition(dungeonId);
  if (!dungeon) return undefined;

  const explicitRoom = getDungeonRoomDefinition(dungeonId, String(progress?.roomId || '').trim());
  if (explicitRoom) return explicitRoom;

  const roomIndex = Math.max(0, Number(progress?.roomIndex) || 0);
  const defaultPath = getDefaultDungeonPath(dungeon);
  const fallbackRoomId = defaultPath[Math.min(roomIndex, Math.max(0, defaultPath.length - 1))];
  return dungeon.rooms.find(room => room.id === fallbackRoomId) || dungeon.rooms[0];
}

function applySelectedLearnDiscard(
  state: GameState,
  playerId: string,
  cardId: string
): PlayerStepHandlerResult {
  const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === playerId) as any;
  if (!player) {
    return {
      applied: false,
      message: `Skipped learn (player not found): ${playerId}`,
      reason: 'failed_to_apply',
    };
  }

  const hand = Array.isArray(player.hand) ? [...player.hand] : [];
  const discardIndex = hand.findIndex((card: any) => String(card?.id || '').trim() === cardId);
  if (discardIndex < 0) {
    return {
      applied: false,
      message: `Skipped learn (selected discard card not in hand): ${cardId}`,
      reason: 'failed_to_apply',
    };
  }

  const [discardedCard] = hand.splice(discardIndex, 1);
  const stampedDiscardedCards = stampCardsPutIntoGraveyardThisTurn(state, [discardedCard]);
  const graveyard = [...(Array.isArray(player.graveyard) ? player.graveyard : []), ...stampedDiscardedCards];
  const updatedPlayers = (state.players || []).map((entry: any) => (
    String(entry?.id || '').trim() === playerId
      ? { ...entry, hand, graveyard }
      : entry
  ));

  const discardState = {
    ...(state as any),
    players: updatedPlayers as any,
  } as GameState;
  const drawResult = drawCardsForPlayer(discardState, playerId as PlayerID, 1);

  return {
    applied: true,
    state: drawResult.state,
    log: [`${playerId} learns by discarding 1 card`, ...drawResult.log],
    lastDiscardedCardCount: 1,
    lastDiscardedCards: stampedDiscardedCards,
    lastMovedCards: stampedDiscardedCards,
  };
}

function applySelectedLearnLesson(
  state: GameState,
  playerId: string,
  lessonCardId: string
): PlayerStepHandlerResult {
  const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === playerId) as any;
  if (!player) {
    return {
      applied: false,
      message: `Skipped learn (player not found): ${playerId}`,
      reason: 'failed_to_apply',
    };
  }

  const sideboard = Array.isArray(player.sideboard) ? [...player.sideboard] : [];
  const lessonIndex = sideboard.findIndex((card: any) => String(card?.id || '').trim() === lessonCardId);
  if (lessonIndex < 0) {
    return {
      applied: false,
      message: `Skipped learn (selected Lesson not outside the game): ${lessonCardId}`,
      reason: 'failed_to_apply',
    };
  }

  const [lessonCard] = sideboard.splice(lessonIndex, 1);
  const hand = [...(Array.isArray(player.hand) ? player.hand : []), lessonCard];
  const updatedPlayers = (state.players || []).map((entry: any) => (
    String(entry?.id || '').trim() === playerId
      ? { ...entry, hand, sideboard }
      : entry
  ));

  return {
    applied: true,
    state: {
      ...(state as any),
      players: updatedPlayers as any,
    } as GameState,
    log: [`${playerId} learns by revealing a Lesson from outside the game`],
    lastMovedCards: [lessonCard],
  };
}

export function applyLearnStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'learn' }>,
  ctx: OracleIRExecutionContext,
  options: OracleIRExecutionOptions = {}
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length !== 1) {
    return {
      applied: false,
      message: `Skipped learn (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const playerId = players[0];
  const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === playerId) as any;
  if (!player) {
    return {
      applied: false,
      message: `Skipped learn (player not found): ${step.raw}`,
      reason: 'failed_to_apply',
    };
  }

  const hand = Array.isArray(player.hand) ? player.hand : [];
  const lessons = (Array.isArray(player.sideboard) ? player.sideboard : []).filter(isLessonCard);
  const chosenIds = new Set(getNormalizedChosenIds(ctx));
  const chosenHand = hand.filter((card: any) => chosenIds.has(String(card?.id || '').trim()));
  const chosenLessons = lessons.filter((card: any) => chosenIds.has(String(card?.id || '').trim()));

  if (chosenHand.length > 1 || chosenLessons.length > 1 || (chosenHand.length > 0 && chosenLessons.length > 0)) {
    return {
      applied: false,
      message: `Skipped learn (requires a single discard card or Lesson choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  if (chosenHand.length === 1) {
    return applySelectedLearnDiscard(state, playerId, String(chosenHand[0]?.id || '').trim());
  }

  if (chosenLessons.length === 1) {
    return applySelectedLearnLesson(state, playerId, String(chosenLessons[0]?.id || '').trim());
  }

  if (!options.allowOptional) {
    return {
      applied: true,
      state,
      log: ['Learn had no auto-selected optional branch'],
      lastMovedCards: [],
    };
  }

  if (hand.length === 1) {
    return applySelectedLearnDiscard(state, playerId, String(hand[0]?.id || '').trim());
  }

  if (lessons.length === 1) {
    return applySelectedLearnLesson(state, playerId, String(lessons[0]?.id || '').trim());
  }

  if (hand.length === 0 && lessons.length === 0) {
    return {
      applied: true,
      state,
      log: ['Learn had no discard or Lesson option available'],
      lastMovedCards: [],
    };
  }

  return {
    applied: false,
    message: `Skipped learn (requires player choice): ${step.raw}`,
    reason: 'player_choice_required',
    options: {
      classification: 'player_choice',
      metadata: {
        handCount: hand.length,
        lessonCount: lessons.length,
      },
    },
  };
}

export function applyOpenAttractionStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'open_attraction' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length !== 1) {
    return {
      applied: false,
      message: `Skipped open Attraction (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const playerId = players[0];
  const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === playerId) as any;
  if (!player) {
    return {
      applied: false,
      message: `Skipped open Attraction (player not found): ${step.raw}`,
      reason: 'failed_to_apply',
    };
  }

  const attractionDeck = Array.isArray(player.attractionDeck) ? [...player.attractionDeck] : [];
  if (attractionDeck.length === 0) {
    return {
      applied: true,
      state,
      log: ['Open an Attraction had no Attraction available'],
      lastMovedCards: [],
    };
  }

  const [openedAttraction, ...remainingAttractionDeck] = attractionDeck;
  const updatedPlayers = (state.players || []).map((entry: any) => (
    String(entry?.id || '').trim() === playerId
      ? { ...entry, attractionDeck: remainingAttractionDeck }
      : entry
  ));
  const attractionCard = {
    ...(openedAttraction || {}),
    type_line: String((openedAttraction as any)?.type_line || 'Artifact - Attraction'),
    zone: 'battlefield',
  };
  const newPermanent = createBattlefieldPermanentsFromCards(
    [attractionCard],
    playerId as PlayerID,
    playerId as PlayerID,
    false,
    false,
    undefined,
    'attraction'
  );

  return {
    applied: true,
    state: addBattlefieldPermanentsToState(
      { ...(state as any), players: updatedPlayers as any } as GameState,
      newPermanent
    ),
    log: [`${playerId} opens an Attraction`],
    lastMovedCards: [attractionCard],
  };
}

export function applyRollVisitAttractionsStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'roll_visit_attractions' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length !== 1) {
    return {
      applied: false,
      message: `Skipped roll to visit Attractions (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const playerId = players[0];
  const dieRoll = Math.min(6, Math.max(1, Number(ctx.dieRollResult) || 1));
  const visitedAttractions = ((state.battlefield || []) as any[]).filter((perm: any) => {
    if (String(perm?.controller || '').trim() !== playerId) return false;
    const typeLine = String(perm?.card?.type_line || perm?.cardType || '').toLowerCase();
    if (!typeLine.includes('attraction')) return false;
    const litUpNumbers = Array.isArray(perm?.card?.litUpNumbers) ? perm.card.litUpNumbers : [];
    return litUpNumbers.includes(dieRoll);
  });

  return {
    applied: true,
    state,
    log: [
      `${playerId} rolls ${dieRoll} to visit Attractions`,
      ...(visitedAttractions.length > 0
        ? [`Visited ${visitedAttractions.length} Attraction(s)`]
        : ['No Attractions were visited'])
    ],
    lastVisitedAttractions: visitedAttractions,
    lastMovedCards: visitedAttractions.map((perm: any) => perm?.card).filter(Boolean),
  };
}

export function applyTakeInitiativeStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'take_initiative' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length !== 1) {
    return {
      applied: false,
      message: `Skipped take initiative (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const playerId = players[0];
  return {
    applied: true,
    state: {
      ...(state as any),
      initiative: playerId,
    } as GameState,
    log: [`${playerId} takes the initiative`],
  };
}

export function applyBecomeMonarchStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'become_monarch' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length !== 1) {
    return {
      applied: false,
      message: `Skipped become monarch (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const playerId = players[0];
  return {
    applied: true,
    state: {
      ...(state as any),
      monarch: playerId,
    } as GameState,
      log: [`${playerId} becomes the monarch`],
    };
  }

export function applyPlaneswalkStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'planeswalk' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length !== 1) {
    return {
      applied: false,
      message: `Skipped planeswalk (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  if ((state as any)?.houseRules?.enablePlanechase !== true) {
    return {
      applied: false,
      message: `Skipped planeswalk (Planechase is not enabled): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'invalid_input', persist: false },
    };
  }

  const playerId = players[0];
  const stateAny = state as any;
  const faceDownDeck = Array.isArray(stateAny.planarDeckFaceDown) ? [...stateAny.planarDeckFaceDown] : [];
  const previousPlane = stateAny.currentPlane ?? null;
  if (previousPlane) {
    faceDownDeck.push(previousPlane);
  }

  if (faceDownDeck.length <= 0) {
    return {
      applied: false,
      message: `Skipped planeswalk (no planar deck card available): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'invalid_input', persist: false },
    };
  }

  const [nextPlane, ...remainingDeck] = faceDownDeck;
  const nextPlaneName = String((nextPlane as any)?.name || nextPlane || '').trim();
  const normalizedNextPlaneName = normalizeOracleText(nextPlaneName);
  const previousPlaneName = String((previousPlane as any)?.name || previousPlane || '').trim();
  const planeswalkedToThisTurn = {
    ...((stateAny.planeswalkedToThisTurn || {}) as Record<string, string[]>),
  };
  const existingEntries = Array.isArray(planeswalkedToThisTurn[playerId]) ? [...planeswalkedToThisTurn[playerId]] : [];
  if (normalizedNextPlaneName) {
    existingEntries.push(normalizedNextPlaneName);
  }
  planeswalkedToThisTurn[playerId] = existingEntries;

  return {
    applied: true,
    state: {
      ...stateAny,
      currentPlane: nextPlane,
      planarDeckFaceDown: remainingDeck,
      planeswalkedThisTurn: true,
      planeswalksAttempted: Math.max(0, Number(stateAny.planeswalksAttempted) || 0) + 1,
      planeswalkedToThisTurn,
      planeswalkedToPlanesThisTurn: planeswalkedToThisTurn,
    } as GameState,
    log: [
      previousPlaneName
        ? `${playerId} planeswalked away from ${previousPlaneName} to ${nextPlaneName || 'a plane'}`
        : `${playerId} planeswalked to ${nextPlaneName || 'a plane'}`,
    ],
  };
}

export function applyAssembleStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'assemble' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length !== 1) {
    return {
      applied: false,
      message: `Skipped assemble (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const playerId = players[0];
  const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === playerId) as any;
  if (!player) {
    return {
      applied: false,
      message: `Skipped assemble (player not found): ${step.raw}`,
      reason: 'failed_to_apply',
    };
  }

  const contraptionDeck = Array.isArray(player.contraptionDeck) ? [...player.contraptionDeck] : [];
  if (contraptionDeck.length === 0) {
    return {
      applied: true,
      state,
      log: ['Assemble had no Contraption available'],
      lastMovedCards: [],
    };
  }

  const [assembledContraption, ...remainingContraptionDeck] = contraptionDeck;
  const updatedPlayers = (state.players || []).map((entry: any) => (
    String(entry?.id || '').trim() === playerId
      ? { ...entry, contraptionDeck: remainingContraptionDeck }
      : entry
  ));
  const contraptionCard = {
    ...(assembledContraption || {}),
    type_line: String((assembledContraption as any)?.type_line || 'Artifact - Contraption'),
    zone: 'battlefield',
  };
  const newPermanent = createBattlefieldPermanentsFromCards(
    [contraptionCard],
    playerId as PlayerID,
    playerId as PlayerID,
    false,
    false,
    undefined,
    'contraption'
  );

  return {
    applied: true,
    state: addBattlefieldPermanentsToState(
      { ...(state as any), players: updatedPlayers as any } as GameState,
      newPermanent
    ),
    log: [`${playerId} assembles a Contraption`],
    lastMovedCards: [contraptionCard],
  };
}

export function applyVentureIntoDungeonStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'venture_into_dungeon' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length !== 1) {
    return {
      applied: false,
      message: `Skipped venture into the dungeon (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const playerId = players[0];
  const stateAny = state as any;
  const currentProgress = { ...((stateAny.dungeonProgress || {}) as Record<string, any>) };
  const completedThisTurn = { ...((stateAny.dungeonCompletedThisTurn || {}) as Record<string, boolean>) };
  const completedAny = { ...((stateAny.dungeonCompleted || {}) as Record<string, boolean>) };
  const completedCounts = { ...((stateAny.completedDungeons || {}) as Record<string, number>) };
  completedThisTurn[playerId] = false;

  const existing = currentProgress[playerId];
  if (!existing) {
    const chosenDungeonId = getNormalizedChosenDungeonId(ctx);
    const dungeon = getDungeonDefinition(chosenDungeonId || 'lost_mine') || getDungeonDefinition('lost_mine');
    if (!dungeon || dungeon.rooms.length === 0) {
      return {
        applied: false,
        message: `Skipped venture into the dungeon (no dungeon definition found): ${step.raw}`,
        reason: 'failed_to_apply',
      };
    }

    const roomIndex = 0;
    const room = dungeon.rooms[0];
    currentProgress[playerId] = {
      dungeonId: dungeon.id,
      dungeonName: dungeon.name,
      roomIndex,
      roomId: room.id,
    };
    return {
      applied: true,
      state: {
        ...stateAny,
        dungeonProgress: currentProgress,
        dungeonCompletedThisTurn: completedThisTurn,
      } as GameState,
      log: [`${playerId} enters ${dungeon.name} (${room.name})`],
      lastDungeonName: dungeon.name,
      lastDungeonRoomName: room.name,
      lastDungeonRoomEffectText: room.effectText,
    };
  }

  const existingDungeon = getDungeonDefinition(String(existing.dungeonId || ''));
  const currentRoom = getDungeonRoomDefinitionByProgress(String(existing.dungeonId || ''), existing);
  if (!existingDungeon || !currentRoom) {
    return {
      applied: false,
      message: `Skipped venture into the dungeon (existing dungeon progress is invalid): ${step.raw}`,
      reason: 'failed_to_apply',
    };
  }

  const chosenDungeonRoomId = getNormalizedChosenDungeonRoomId(ctx);
  const nextRoomId = (
    chosenDungeonRoomId && currentRoom.nextRoomIds.includes(chosenDungeonRoomId)
      ? chosenDungeonRoomId
      : currentRoom.nextRoomIds[0]
  );
  const nextRoom = getDungeonRoomDefinition(existingDungeon.id, nextRoomId);
  if (!nextRoom) {
    return {
      applied: false,
      message: `Skipped venture into the dungeon (next room could not be resolved): ${step.raw}`,
      reason: 'failed_to_apply',
    };
  }

  const nextRoomIndex = Math.max(0, Number(existing.roomIndex) || 0) + 1;

  if (nextRoom.nextRoomIds.length === 0) {
    delete currentProgress[playerId];
    completedThisTurn[playerId] = true;
    completedAny[playerId] = true;
    completedCounts[playerId] = Math.max(0, Number(completedCounts[playerId]) || 0) + 1;

    return {
      applied: true,
      state: {
        ...stateAny,
        dungeonProgress: currentProgress,
        dungeonCompletedThisTurn: completedThisTurn,
        dungeonCompleted: completedAny,
        completedDungeons: completedCounts,
      } as GameState,
      log: [`${playerId} completed ${String(existing.dungeonName || 'a dungeon')} (${nextRoom.name})`],
      lastDungeonName: String(existing.dungeonName || 'a dungeon'),
      lastDungeonRoomName: nextRoom.name,
      lastDungeonRoomEffectText: nextRoom.effectText,
    };
  }

  currentProgress[playerId] = {
    ...existing,
    roomIndex: nextRoomIndex,
    roomId: nextRoom.id,
  };
  return {
    applied: true,
    state: {
      ...stateAny,
      dungeonProgress: currentProgress,
      dungeonCompletedThisTurn: completedThisTurn,
    } as GameState,
    log: [`${playerId} ventures further into ${String(existing.dungeonName || 'a dungeon')} (${nextRoom.name})`],
    lastDungeonName: String(existing.dungeonName || 'a dungeon'),
    lastDungeonRoomName: nextRoom.name,
    lastDungeonRoomEffectText: nextRoom.effectText,
  };
}

function getSchemeIdentityCandidates(value: any): string[] {
  const candidates = [
    String(value?.id || '').trim(),
    String(value?.name || '').trim(),
    String(value?.card?.id || '').trim(),
    String(value?.card?.name || '').trim(),
  ].filter(Boolean);
  return Array.from(new Set(candidates));
}

function schemeMatchesSource(scheme: any, sourceId: string, sourceName: string, chosenIds: readonly string[]): boolean {
  const candidates = getSchemeIdentityCandidates(scheme);
  if (candidates.length === 0) return false;
  if (sourceId && candidates.includes(sourceId)) return true;
  if (sourceName && candidates.includes(sourceName)) return true;
  return chosenIds.some(id => candidates.includes(id));
}

export function applyAbandonSchemeStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'abandon_scheme' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const targetText = normalizeOracleText(String((step.target as any)?.text || ''));
  if (targetText !== 'this scheme' && targetText !== 'that scheme') {
    return {
      applied: false,
      message: `Skipped abandon scheme (unsupported target): ${step.raw}`,
      reason: 'failed_to_apply',
    };
  }

  const stateAny = state as any;
  const ongoingSchemes = Array.isArray(stateAny.ongoingSchemes) ? [...stateAny.ongoingSchemes] : [];
  if (ongoingSchemes.length === 0) {
    return {
      applied: false,
      message: `Skipped abandon scheme (no ongoing schemes): ${step.raw}`,
      reason: 'failed_to_apply',
    };
  }

  const sourceId = String(ctx.sourceId || '').trim();
  const sourceName = String(ctx.sourceName || '').trim();
  const chosenIds = getNormalizedChosenIds(ctx);
  const schemeIndex = ongoingSchemes.findIndex((scheme: any) => schemeMatchesSource(scheme, sourceId, sourceName, chosenIds));
  if (schemeIndex < 0) {
    return {
      applied: false,
      message: `Skipped abandon scheme (source scheme not found): ${step.raw}`,
      reason: 'failed_to_apply',
    };
  }

  const [scheme] = ongoingSchemes.splice(schemeIndex, 1);
  const nextSchemeDeck = [...(Array.isArray(stateAny.schemeDeck) ? stateAny.schemeDeck : []), scheme];

  return {
    applied: true,
    state: {
      ...stateAny,
      ongoingSchemes,
      schemeDeck: nextSchemeDeck,
    } as GameState,
    log: [`${String(sourceName || getSchemeIdentityCandidates(scheme)[1] || getSchemeIdentityCandidates(scheme)[0] || 'Scheme')} was abandoned`],
  };
}

export function applySetInMotionStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'set_in_motion' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const targetText = normalizeOracleText(String((step.target as any)?.text || ''));
  const sourceId = String(ctx.sourceId || '').trim();
  const sourceName = String(ctx.sourceName || '').trim();
  const chosenIds = getNormalizedChosenIds(ctx);

  let scheme: any = null;
  if (targetText === 'that scheme') {
    scheme = (ctx as any).lastSetInMotionScheme || null;
  } else if (targetText === 'this scheme') {
    const ongoingSchemes = Array.isArray((state as any).ongoingSchemes) ? (state as any).ongoingSchemes : [];
    scheme = ongoingSchemes.find((entry: any) => schemeMatchesSource(entry, sourceId, sourceName, chosenIds)) || null;
  }

  if (!scheme) {
    return {
      applied: false,
      message: `Skipped set in motion (scheme reference not found): ${step.raw}`,
      reason: 'failed_to_apply',
    };
  }

  return {
    applied: true,
    state,
    log: [`${String(getSchemeIdentityCandidates(scheme)[1] || getSchemeIdentityCandidates(scheme)[0] || 'Scheme')} was set in motion again`],
    lastSetInMotionScheme: scheme,
  };
}

export function applyCollectEvidenceStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'collect_evidence' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const amountValue = step.amount.kind === 'number' ? step.amount.value : null;
  if (amountValue === null || amountValue <= 0) {
    return {
      applied: false,
      message: `Skipped collect evidence (unsupported amount): ${step.raw}`,
      reason: 'failed_to_apply',
    };
  }

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length !== 1) {
    return {
      applied: false,
      message: `Skipped collect evidence (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const playerId = players[0];
  const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === playerId) as any;
  if (!player) {
    return {
      applied: false,
      message: `Skipped collect evidence (player not found): ${step.raw}`,
      reason: 'failed_to_apply',
    };
  }

  const graveyard = Array.isArray(player.graveyard) ? player.graveyard : [];
  const selectedIds = chooseCollectEvidenceCardIds(graveyard, amountValue, ctx.selectorContext?.chosenObjectIds);
  const selectedIdSet = new Set(selectedIds);
  const selectedCards = graveyard.filter((card: any) => selectedIdSet.has(String(card?.id || '').trim()));
  const totalManaValue = selectedCards.reduce(
    (sum: number, card: any) => sum + Math.max(0, Number(getCardManaValue(card) ?? 0)),
    0
  );

  if (selectedCards.length === 0 || totalManaValue < amountValue) {
    return {
      applied: true,
      state,
      log: [`Collect evidence ${amountValue} could not be completed`],
      lastCollectedEvidence: false,
      lastMovedCards: [],
    };
  }

  const nextPlayers = (state.players || []).map((entry: any) => {
    if (String(entry?.id || '').trim() !== playerId) return entry;

    const remainingGraveyard = graveyard.filter((card: any) => !selectedIdSet.has(String(card?.id || '').trim()));
    const nextExile = [...(Array.isArray(entry?.exile) ? entry.exile : []), ...selectedCards];
    return {
      ...entry,
      graveyard: remainingGraveyard,
      exile: nextExile,
    };
  });

  return {
    applied: true,
    state: {
      ...(state as any),
      players: nextPlayers as any,
    } as GameState,
    log: [`Collected evidence ${amountValue} by exiling ${selectedCards.length} card(s)`],
    lastCollectedEvidence: true,
    lastMovedCards: selectedCards,
  };
}

function findCardByIdAcrossState(state: GameState, sourceId: string): any | null {
  const normalizedSourceId = String(sourceId || '').trim();
  if (!normalizedSourceId) return null;

  for (const permanent of Array.isArray(state.battlefield) ? state.battlefield : []) {
    if (String((permanent as any)?.id || '').trim() === normalizedSourceId) {
      return (permanent as any)?.card || permanent;
    }
    if (String((permanent as any)?.card?.id || '').trim() === normalizedSourceId) {
      return (permanent as any)?.card || permanent;
    }
  }

  for (const player of state.players as any[]) {
    for (const zoneName of ['hand', 'graveyard', 'library', 'exile']) {
      const zone = Array.isArray(player?.[zoneName]) ? player[zoneName] : [];
      const found = zone.find((card: any) => String(card?.id || card?.cardId || '').trim() === normalizedSourceId);
      if (found) return found;
    }
  }

  return null;
}

function getSearchLibraryMatches(
  library: readonly any[],
  step: Extract<OracleEffectStep, { kind: 'search_library' }>,
  state: GameState,
  ctx: OracleIRExecutionContext
): any[] | null {
  const cards = Array.isArray(library) ? [...library] : [];

  if (step.criteria.kind === 'same_mana_value_as_source') {
    const criteria = step.criteria;
    const sourceCard = findCardByIdAcrossState(state, String(ctx.sourceId || '').trim());
    const sourceManaValue = getCardManaValue(sourceCard);
    if (sourceManaValue === null) return null;
    return cards.filter(card => {
      if (getCardManaValue(card) !== sourceManaValue) return false;
      if (criteria.requiredCardType === 'creature') {
        return /\bcreature\b/i.test(String(card?.type_line || ''));
      }
      return true;
    });
  }

  const criteria = step.criteria;
  if (criteria.kind === 'mana_value') {
    return cards.filter(card => getCardManaValue(card) === criteria.value);
  }

  const normalizedText = normalizeOracleText(criteria.text);
  if (!normalizedText || normalizedText === 'card' || normalizedText === 'cards') return cards;

  const structuredCriteria = parseMoveZoneSingleTargetCriteria(normalizedText);
  if (structuredCriteria) {
    let resolvedCriteria = structuredCriteria;
    if (resolvedCriteria.manaValueLte === -1) {
      const x = Math.max(0, Number(ctx.xValue ?? ctx.referenceAmount ?? 0));
      resolvedCriteria = { ...resolvedCriteria, manaValueLte: x };
    }
    if (resolvedCriteria.usesChosenCreatureType) {
      const chosenType = String(ctx.selectorContext?.chosenCreatureType || '').trim();
      if (chosenType) {
        resolvedCriteria = { ...resolvedCriteria, creatureTypesAnyOf: [chosenType] };
      }
    }
    return cards.filter((card) => cardMatchesMoveZoneSingleTargetCriteria(card, resolvedCriteria));
  }

  const sameManaValueMatch = normalizedText.match(/^((?:[a-z' -]+?)\s+)?card with the same mana value as this(?: card)?$/i);
  if (sameManaValueMatch) {
    const sourceCard = findCardByIdAcrossState(state, String(ctx.sourceId || '').trim());
    const sourceManaValue = getCardManaValue(sourceCard);
    if (sourceManaValue === null) return null;

    const requiredCardType = String(sameManaValueMatch[1] || '').trim().toLowerCase();
    return cards.filter(card => {
      if (getCardManaValue(card) !== sourceManaValue) return false;
      if (!requiredCardType) return true;
      return normalizeOracleText(String(card?.type_line || '')).includes(requiredCardType);
    });
  }

  const basicLandCriteria = normalizedText.match(/^basic ([a-z]+)(?:\s+cards?)?$/i);
  if (basicLandCriteria || normalizedText === 'basic land card' || normalizedText === 'basic land') {
    const requiredBasicType = basicLandCriteria ? String(basicLandCriteria[1] || '').trim().toLowerCase() : '';
    return cards.filter((card) => {
      const typeLine = normalizeOracleText(String(card?.type_line || ''));
      if (!/\bbasic\b.*\bland\b/i.test(typeLine)) return false;
      if (!requiredBasicType) return true;
      return typeLine.includes(requiredBasicType);
    });
  }

  return cards.filter(card => {
    const typeLine = normalizeOracleText(String(card?.type_line || ''));
    const name = normalizeOracleText(String(card?.name || ''));
    return typeLine.includes(normalizedText) || name === normalizedText;
  });
}

function resolveSearchLibraryMaxResults(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'search_library' }>,
  ctx: OracleIRExecutionContext,
): number {
  if (step.maxResults === 'any_number') {
    return Number.MAX_SAFE_INTEGER;
  }
  if (typeof step.maxResults === 'number' && Number.isFinite(step.maxResults) && step.maxResults > 0) {
    return step.maxResults;
  }

  const whereRaw = String(step.whereX?.raw || '').trim();
  if (whereRaw) {
    const evaluated = evaluateModifyPtWhereX(
      state,
      ctx.controllerId,
      `X is ${whereRaw}`,
      undefined,
      ctx,
    );
    if (evaluated !== null) return Math.max(0, evaluated);
  }

  const raw = String(step.raw || '');
  const whereMatch = raw.match(/where x is (.+?)(?:,\s*put\b|,\s*reveal\b|\s*$)/i);
  if (whereMatch) {
    const evaluated = evaluateModifyPtWhereX(
      state,
      ctx.controllerId,
      `X is ${String(whereMatch[1] || '').trim()}`,
      undefined,
      ctx,
    );
    if (evaluated !== null) return Math.max(0, evaluated);
  }

  return 1;
}

function isOptionalSearchLibraryStep(step: Extract<OracleEffectStep, { kind: 'search_library' }>): boolean {
  if ((step as { optional?: boolean }).optional === true) return true;
  return /\bup to\b/i.test(String(step.raw || ''));
}

export function buildSearchLibrarySelectionOptions(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'search_library' }>,
  ctx: OracleIRExecutionContext,
): {
  playerId: PlayerID;
  matches: any[];
  maxResults: number;
  minSelections: number;
  maxSelections: number;
  destination: string;
} | null {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length !== 1) return null;

  const playerId = players[0];
  const player = state.players.find((entry) => entry.id === playerId) as any;
  if (!player) return null;

  const library = Array.isArray(player.library) ? player.library : [];
  const matches = getSearchLibraryMatches(library, step, state, ctx);
  if (!matches || matches.length === 0) return null;

  const isAnyNumber = step.maxResults === 'any_number';
  const maxResults = isAnyNumber
    ? matches.length
    : resolveSearchLibraryMaxResults(state, step, ctx);
  const isOptional = isOptionalSearchLibraryStep(step);
  // Always surface a LIBRARY_SEARCH choice for mandatory tutors — even when only one
  // card matches — so server queue bridges (Celestial X-search, etc.) stay on the IR path
  // instead of auto-applying and skipping the resolution UI.

  return {
    playerId,
    matches,
    maxResults,
    minSelections: isOptional || isAnyNumber ? 0 : 1,
    maxSelections: isAnyNumber ? matches.length : (isOptional ? Math.min(maxResults, matches.length) : maxResults),
    destination: String(step.destination || 'hand'),
  };
}

function resolveMoveZoneSelectionPool(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'move_zone' }>,
  ctx: OracleIRExecutionContext,
  playerId: PlayerID,
): any[] {
  const whatText = String((step.what as any)?.text || (step.what as any)?.raw || '').trim();
  const raw = String(step.raw || '').trim();
  const combined = `${whatText} ${raw}`.toLowerCase();
  const player = state.players.find((entry) => entry.id === playerId) as any;

  if (/milled this way|among the cards milled/i.test(combined)) {
    return [...(resolveAntecedentMilledCards(ctx) as any[])];
  }
  if (/this card/i.test(whatText) && /graveyard/i.test(combined)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
    return graveyard.filter((card: any) => String(card?.id || '').trim() === sourceId);
  }
  if (/from your graveyard|from the graveyard/i.test(combined)) {
    return Array.isArray(player?.graveyard) ? [...player.graveyard] : [];
  }
  if (/from your hand/i.test(combined) && !/from among them/i.test(combined)) {
    return Array.isArray(player?.hand) ? [...player.hand] : [];
  }
  if (/\bgraveyard\b/i.test(combined) && !/to your hand|into your hand|onto the battlefield/i.test(combined)) {
    return Array.isArray(player?.graveyard) ? [...player.graveyard] : [];
  }
  if (
    /from among|among them|those cards|those creature cards|one of those cards|the rest/i.test(combined)
  ) {
    const contextual = resolveAntecedentContextualCards(ctx) as any[];
    if (contextual.length > 0) return [...contextual];
    return [...(collectRevealedThisWayCardsLedgerFirst(ctx, step) as any[])];
  }
  if (/from your hand/i.test(combined)) {
    return Array.isArray(player?.hand) ? [...player.hand] : [];
  }
  return [];
}

function normalizeMoveZoneWhatCriteriaText(whatText: string): string {
  return normalizeOracleText(
    String(whatText || '')
      .replace(/\s+from your graveyard$/i, '')
      .replace(/\s+from among the cards milled this way$/i, '')
      .replace(/^those creature cards$/i, 'creature cards')
      .replace(/^those cards$/i, 'cards')
      .replace(/^one of those cards$/i, 'a card')
      .replace(/^a permanent card from among the cards milled this way$/i, 'a permanent card')
      .replace(/^a permanent card from your hand$/i, 'a permanent card'),
  );
}

function filterMoveZoneSelectionCandidates(
  pool: readonly any[],
  step: Extract<OracleEffectStep, { kind: 'move_zone' }>,
  ctx?: OracleIRExecutionContext,
): any[] {
  const whatText = String((step.what as any)?.text || (step.what as any)?.raw || '').trim();
  const raw = String(step.raw || '').trim();
  const combined = `${whatText} ${raw}`.toLowerCase();

  if (/^the rest/i.test(whatText)) {
    return [];
  }

  const anyNumberTypedFromHand = parseMoveZoneAnyNumberTypedFromYourHand({ kind: 'raw', text: whatText });
  if (anyNumberTypedFromHand) {
    return pool.filter((card) => cardMatchesType(card, anyNumberTypedFromHand.cardType));
  }
  const anyNumberCardsFromHand = parseMoveZoneAnyNumberCardsFromYourHand({ kind: 'raw', text: whatText });
  if (anyNumberCardsFromHand) {
    return pool.filter((card) => cardMatchesType(card, anyNumberCardsFromHand.cardType));
  }
  const upToFromHand = parseMoveZoneUpToTargetCountFromYourHand({ kind: 'raw', text: whatText });
  if (upToFromHand) {
    return pool.filter((card) => cardMatchesMoveZoneSingleTargetCriteria(card, upToFromHand.criteria));
  }

  const typedFromHand = parseMoveZoneTypedCardFromYourHand({ kind: 'raw', text: whatText });
  if (typedFromHand) {
    let resolvedCriteria = typedFromHand;
    if (resolvedCriteria.usesChosenCreatureType) {
      const chosenType = String(ctx?.selectorContext?.chosenCreatureType || '').trim();
      if (chosenType) {
        resolvedCriteria = { ...resolvedCriteria, creatureTypesAnyOf: [chosenType] };
      }
    }
    return pool.filter((card) => cardMatchesMoveZoneSingleTargetCriteria(card, resolvedCriteria));
  }

  const normalizedCriteria = normalizeMoveZoneWhatCriteriaText(whatText);
  const structured = parseMoveZoneSingleTargetCriteria(
    normalizedCriteria.replace(/^(?:a|an)\s+/i, ''),
  );
  if (structured) {
    let resolvedCriteria = structured;
    if (resolvedCriteria.usesChosenCreatureType) {
      const chosenType = String(ctx?.selectorContext?.chosenCreatureType || '').trim();
      if (chosenType) {
        resolvedCriteria = { ...resolvedCriteria, creatureTypesAnyOf: [chosenType] };
      }
    }
    return pool.filter((card) => cardMatchesMoveZoneSingleTargetCriteria(card, resolvedCriteria));
  }
  const articleCriteria = normalizedCriteria.match(/^(?:a|an)\s+(.+)$/i);
  if (articleCriteria) {
    const articleLabel = String(articleCriteria[1] || '')
      .replace(/\s+from your graveyard$/i, '')
      .replace(/\s+from among the cards milled this way$/i, '')
      .trim();
    const articleFiltered = pool.filter((card) => cardMatchesLookChooseSelector(card, articleLabel));
    if (articleFiltered.length > 0) return articleFiltered;
  }
  if (/creature card and\/or a land card|creature cards|permanent card|one of those cards/i.test(combined)) {
    const selectorText = whatText
      .replace(/^those creature cards$/i, 'creature cards')
      .replace(/^one of those cards$/i, 'a card')
      .replace(/^a permanent card/i, 'permanent card');
    return pool.filter((card) => cardMatchesLookChooseSelector(card, selectorText));
  }
  return [...pool];
}

function resolveMoveZoneSelectionLimits(
  step: Extract<OracleEffectStep, { kind: 'move_zone' }>,
  candidateCount: number,
): { readonly minSelections: number; readonly maxSelections: number } {
  const rawWhat = String((step.what as any)?.text || (step.what as any)?.raw || '').trim();
  const whatText = normalizeMoveZoneWhatCriteriaText(rawWhat);
  const optional = step.optional === true || /^you may\b/i.test(String(step.raw || ''));
  if (/^the rest/i.test(whatText)) {
    return { minSelections: 0, maxSelections: 0 };
  }
  if (/^any number of /i.test(rawWhat) || /^any number of /i.test(whatText)) {
    return { minSelections: 0, maxSelections: candidateCount };
  }
  const upToFromHand = parseMoveZoneUpToTargetCountFromYourHand({ kind: 'raw', text: rawWhat });
  if (upToFromHand && !upToFromHand.useXValue && !upToFromHand.useReferenceAmount) {
    return { minSelections: 0, maxSelections: Math.min(upToFromHand.maxCount, candidateCount) };
  }
  if (/^those cards$|^those creature cards$/i.test(whatText)) {
    return {
      minSelections: optional ? 0 : Math.min(1, candidateCount),
      maxSelections: Math.max(optional ? 0 : 1, candidateCount),
    };
  }
  if (/^one of those cards$/i.test(whatText) || /^a .+ card$/i.test(whatText) || /^up to one/i.test(whatText)) {
    return { minSelections: optional ? 0 : Math.min(1, candidateCount), maxSelections: Math.min(1, candidateCount) };
  }
  return {
    minSelections: optional ? 0 : Math.min(1, candidateCount),
    maxSelections: Math.max(optional ? 0 : 1, candidateCount),
  };
}

export function buildMoveZoneSelectionOptions(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'move_zone' }>,
  ctx: OracleIRExecutionContext,
): {
  readonly playerId: PlayerID;
  readonly availableCards: readonly any[];
  readonly selectableCardIds: readonly string[];
  readonly minSelections: number;
  readonly maxSelections: number;
  readonly destination: string;
  readonly shuffleAfter: boolean;
  readonly remainderDestination: 'bottom' | 'graveyard' | 'shuffle' | 'top' | 'none';
  readonly remainderRandomOrder: boolean;
  readonly remainderPlayerChoosesOrder: boolean;
  readonly filter: ReturnType<typeof buildLookChooseLibrarySearchFilter>;
  readonly optional: boolean;
  readonly searchZone: 'hand' | 'graveyard' | 'library';
} | null {
  const players = resolvePlayers(state, (step as any).who || { kind: 'you' }, ctx);
  const playerId = (players[0] || ctx.controllerId) as PlayerID;
  const pool = resolveMoveZoneSelectionPool(state, step, ctx, playerId);
  if (pool.length === 0) return null;

  const candidates = filterMoveZoneSelectionCandidates(pool, step, ctx);
  const optional = step.optional === true || /^you may\b/i.test(String(step.raw || ''));
  if (candidates.length === 0 && !optional) return null;

  const limits = resolveMoveZoneSelectionLimits(step, candidates.length);
  if (limits.maxSelections <= 0 && !optional) return null;

  const whatText = String((step.what as any)?.text || (step.what as any)?.raw || '').trim();
  const toRaw = String(step.toRaw || step.raw || '').toLowerCase();
  const fromHand = /from your hand/i.test(`${whatText} ${String(step.raw || '')}`);
  const fromGraveyard = /from your graveyard|from a graveyard|from graveyards/i.test(`${whatText} ${String(step.raw || '')}`);
  const destination =
    step.to === 'battlefield'
      ? 'battlefield'
      : step.to === 'graveyard'
        ? 'graveyard'
        : step.to === 'exile'
          ? 'exile'
          : step.to === 'library' && /shuffle/i.test(toRaw)
            ? 'shuffle'
            : 'hand';
  const remainderDestination: 'bottom' | 'graveyard' | 'shuffle' | 'top' | 'none' =
    /shuffle.*(rest|revealed)/i.test(toRaw)
      ? 'shuffle'
      : /bottom/i.test(toRaw)
        ? 'bottom'
        : fromHand
          ? 'none'
          : 'bottom';

  return {
    playerId,
    availableCards: fromHand && candidates.length > 0 ? candidates : pool,
    selectableCardIds: candidates
      .map((card) => String(card?.id || '').trim())
      .filter(Boolean),
    minSelections: limits.minSelections,
    maxSelections: limits.maxSelections,
    destination,
    shuffleAfter: destination === 'shuffle',
    remainderDestination,
    remainderRandomOrder: /random order/i.test(toRaw),
    remainderPlayerChoosesOrder: /any order/i.test(toRaw),
    filter: buildLookChooseLibrarySearchFilter(whatText),
    optional,
    searchZone: fromHand ? 'hand' : fromGraveyard ? 'graveyard' : 'library',
  };
}

export function buildPlayerChoiceAmongThemSelectionOptions(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'player_choice' }>,
  ctx: OracleIRExecutionContext,
): {
  readonly playerId: PlayerID;
  readonly availableCards: readonly any[];
  readonly selectableCardIds: readonly string[];
  readonly minSelections: number;
  readonly maxSelections: number;
  readonly filter: ReturnType<typeof buildLookChooseLibrarySearchFilter>;
} | null {
  const raw = String(step.raw || '').trim();
  if (!/\bfrom among them\b/i.test(raw)) return null;

  const pool = resolveAntecedentContextualCards(ctx) as any[];
  if (pool.length === 0) return null;

  const selectorMatch = raw.match(/^choose\s+(.+?)\s+from among them\.?$/i);
  const selectorText = String(selectorMatch?.[1] || 'a card').trim();
  const selectable = pool.filter((card) => cardMatchesLookChooseSelector(card, selectorText));
  if (selectable.length === 0) return null;

  const limits = parseLookChooseSelectionLimits(selectorText, step.optional === true);
  return {
    playerId: ctx.controllerId as PlayerID,
    availableCards: pool,
    selectableCardIds: selectable.map((card) => String(card?.id || '').trim()).filter(Boolean),
    minSelections: limits.minSelections,
    maxSelections: Math.min(limits.maxSelections, selectable.length),
    filter: buildLookChooseLibrarySearchFilter(selectorText),
  };
}

function getChosenObjectIds(ctx: OracleIRExecutionContext): readonly string[] {
  const chosen = Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : [];
  const direct = [ctx.targetCreatureId, ctx.targetPermanentId];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const candidate of [...chosen, ...direct]) {
    const normalized = String(candidate || '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    ids.push(normalized);
  }
  return ids;
}

function normalizePermissionSelectorText(value: string): string {
  return String(value || '')
    .replace(/\u2019/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.]+$/g, '')
    .trim();
}

function buildGraveyardPermissionCriteria(text: string): MoveZoneSingleTargetCriteria | null {
  const baseNormalized = normalizePermissionSelectorText(text)
    .replace(/^(?:up to one|one|a|an)\s+/i, '')
    .replace(/\s+from\s+(?:your|their|his or her|its owner's|its controller's)\s+graveyard$/i, '')
    .replace(/\binstant and sorcery\b/g, 'instant or sorcery')
    .trim();

  if (!baseNormalized) return null;

  if (baseNormalized === 'card of the other type' || baseNormalized === 'card of the other spell type') {
    return { cardType: 'instant' };
  }

  if (baseNormalized === 'spell' || baseNormalized === 'spells' || baseNormalized === 'card' || baseNormalized === 'cards') {
    return { cardType: 'any' };
  }

  if (/^legendary cards?$/i.test(baseNormalized)) {
    return { cardType: 'legendary_permanent' };
  }

  if (/^cards with retrace$/i.test(baseNormalized)) {
    return { cardType: 'any' };
  }

  if (
    /each permanent type/i.test(baseNormalized) ||
    /play a land and cast a permanent spell of each permanent type/i.test(baseNormalized)
  ) {
    return { cardType: 'permanent' };
  }

  const dualTypeCardsMatch = baseNormalized.match(/^([a-z]+) and ([a-z]+) cards?$/i);
  if (dualTypeCardsMatch) {
    const toTitle = (value: string) =>
      String(value || '')
        .trim()
        .replace(/\b\w/g, (character) => character.toUpperCase());
    return {
      cardType: 'creature',
      creatureTypesAnyOf: [toTitle(dualTypeCardsMatch[1]), toTitle(dualTypeCardsMatch[2])],
    };
  }

  const typeSpellsMatch = baseNormalized.match(/^([a-z][a-z' -]+)\s+spells?$/i);
  if (typeSpellsMatch) {
    const typeName = String(typeSpellsMatch[1] || '').trim();
    const parsedType = parseSimpleCardTypeFromText(typeName);
    if (parsedType && parsedType !== 'creature') {
      return { cardType: parsedType };
    }
    return {
      cardType: 'creature',
      creatureTypesAnyOf: [typeName.replace(/\b\w/g, (character) => character.toUpperCase())],
    };
  }

  if (baseNormalized === 'land' || baseNormalized === 'lands') return { cardType: 'land' };

  const normalized = baseNormalized
    .replace(/\s+(?:spells?|cards?)$/i, '')
    .trim();

  if (!normalized) return null;

  const manaValueMatch = normalized.match(/^(.+?)\s+with mana value (\d+) or less$/i);
  if (manaValueMatch) {
    const rawBase = String(manaValueMatch[1] || '').trim().replace(/\s+spell$/i, '');
    const creatureTypeWithMvMatch = rawBase.match(/^([a-z][a-z' -]+)\s+creature$/i);
    const manaValueLte = parseInt(String(manaValueMatch[2] || '0'), 10) || 0;
    if (creatureTypeWithMvMatch && manaValueLte > 0) {
      return {
        cardType: 'creature',
        manaValueLte,
        creatureTypesAnyOf: [
          String(creatureTypeWithMvMatch[1] || '')
            .trim()
            .replace(/\b\w/g, c => c.toUpperCase()),
        ],
      };
    }

    const cardType = parseSimpleCardTypeFromText(rawBase);
    if (!cardType || manaValueLte <= 0) return null;
    return { cardType, manaValueLte };
  }

  const creatureTypeMatch = normalized.match(/^([a-z][a-z' -]+)\s+creature$/i);
  if (creatureTypeMatch) {
    return {
      cardType: 'creature',
      creatureTypesAnyOf: [
        String(creatureTypeMatch[1] || '')
          .trim()
          .replace(/\b\w/g, c => c.toUpperCase()),
      ],
    };
  }

  const baseType = parseSimpleCardTypeFromText(normalized);
  if (baseType) return { cardType: baseType };

  if (normalized === 'card' || normalized === 'cards') return { cardType: 'any' };
  if (normalized === 'permanent spell' || normalized === 'permanent') return { cardType: 'permanent' };

  return null;
}

function buildExilePermissionCriteria(text: string): {
  readonly criteria: MoveZoneSingleTargetCriteria | null;
  readonly ownOnly: boolean;
} {
  const normalized = normalizePermissionSelectorText(text)
    .replace(/\s+from\s+among\s+(?:the\s+)?cards?\s+/i, ' ')
    .replace(/\s+exiled with this (?:creature|artifact|enchantment|planeswalker|permanent|card|class|saga)$/i, '')
    .trim();

  const ownOnly = /\byou own\b/i.test(normalized);
  const selectorText = normalized
    .replace(/\byou own\b/i, '')
    .replace(/^(?:up to one|one|a|an)\s+/i, '')
    .replace(/\s+(?:spells?|cards?)$/i, '')
    .trim();

  if (!selectorText) return { criteria: { cardType: 'any' }, ownOnly };

  const direct = buildGraveyardPermissionCriteria(selectorText);
  if (direct) return { criteria: direct, ownOnly };

  const creatureTypeOnly = selectorText.match(/^([a-z][a-z' -]+)$/i);
  if (creatureTypeOnly) {
    return {
      criteria: {
        cardType: 'creature',
        creatureTypesAnyOf: [
          String(creatureTypeOnly[1] || '')
            .trim()
            .replace(/\b\w/g, c => c.toUpperCase()),
        ],
      },
      ownOnly,
    };
  }

  return { criteria: null, ownOnly };
}

function resolveGraveyardPermissionTargets(
  state: GameState,
  playerId: PlayerID,
  step: Extract<OracleEffectStep, { kind: 'grant_graveyard_permission' | 'grant_graveyard_keyword_ability' }>,
  ctx: OracleIRExecutionContext
): { cards: readonly any[]; reason?: 'unsupported_selector' | 'failed_to_apply' } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { cards: [], reason: 'failed_to_apply' };

  const graveyard = Array.isArray(player.graveyard) ? player.graveyard : [];
  const chosenIds = new Set(getChosenObjectIds(ctx));
  const sourceId = String(ctx.sourceId || '').trim();
  const selectorText =
    step.what.kind === 'raw'
      ? normalizePermissionSelectorText(step.what.text)
      : normalizePermissionSelectorText((step.what as any).raw || '');
  if (!selectorText) return { cards: [], reason: 'unsupported_selector' };

  const contextualReference =
    /^(?:it|that card|that spell|the discarded card|target .+?)$/.test(selectorText);
  if (contextualReference) {
    const cards = graveyard.filter((card: any) => {
      const cardId = String(card?.id || card?.cardId || '').trim();
      if (!cardId) return false;
      if (chosenIds.has(cardId)) return true;
      return selectorText === 'it' && sourceId && cardId === sourceId;
    });
    return cards.length > 0 ? { cards } : { cards: [], reason: 'failed_to_apply' };
  }

  const selfReference = /^(?:this card|this spell|this permanent|this creature)$/.test(selectorText);
  if (selfReference) {
    const sourceName = String(ctx.sourceName || '').trim();
    const cards = graveyard.filter((card: any) => {
      const cardId = String(card?.id || card?.cardId || '').trim();
      if (sourceId && cardId === sourceId) return true;
      if (cardId === 'gy-source-self') return true;
      if (sourceName && String(card?.name || '').trim() === sourceName) return true;
      return false;
    });
    return cards.length > 0 ? { cards } : { cards: [], reason: 'failed_to_apply' };
  }

  const otherTypeMatch = selectorText.match(
    /^(?:up to one\s+)?target card of the other type(?: from your graveyard)?$/i
  );
  if (otherTypeMatch) {
    const otherType = String(ctx.selectorContext?.otherSpellType || ctx.otherSpellType || 'sorcery')
      .trim()
      .toLowerCase();
    const wantedType = otherType === 'instant' ? 'sorcery' : 'instant';
    const cards = graveyard.filter((card: any) => cardMatchesType(card, wantedType));
    if (cards.length === 0) return { cards: [], reason: 'failed_to_apply' };
    const chosenIds = new Set(getChosenObjectIds(ctx));
    const preferred = cards.filter((card: any) => chosenIds.has(String(card?.id || '').trim()));
    return { cards: preferred.length > 0 ? preferred.slice(0, 1) : cards.slice(0, 1) };
  }

  const criteria = buildGraveyardPermissionCriteria(selectorText);
  if (!criteria) return { cards: [], reason: 'unsupported_selector' };
  const currentTurn = Number((state as any).turnNumber ?? (state as any).turn ?? 0) || 0;
  return { cards: graveyard.filter((card: any) => cardMatchesMoveZoneSingleTargetCriteria(card, criteria, undefined, currentTurn)) };
}

function resolveExilePermissionTargets(
  state: GameState,
  playerId: PlayerID,
  step: Extract<OracleEffectStep, { kind: 'grant_exile_permission' }>,
  ctx: OracleIRExecutionContext
): { cards: readonly any[]; reason?: 'unsupported_selector' | 'failed_to_apply' } {
  const sourceId = String(ctx.sourceId || '').trim();
  const selectorText =
    step.what.kind === 'raw'
      ? normalizePermissionSelectorText(step.what.text)
      : normalizePermissionSelectorText((step.what as any).raw || '');
  if (!selectorText) return { cards: [], reason: 'unsupported_selector' };

  const chosenIds = new Set(getChosenObjectIds(ctx));
  const contextualReference =
    /^(?:it|that card|that spell|the exiled card|the exiled spell|target .+?)$/.test(selectorText);
  if (contextualReference || /^(?:this card|this spell|this permanent|this creature)$/.test(selectorText)) {
    const targetId = contextualReference
      ? Array.from(chosenIds)[0] || sourceId
      : sourceId;
    if (!targetId) return { cards: [], reason: 'failed_to_apply' };

    const matches: any[] = [];
    for (const owner of state.players as any[]) {
      const exile = Array.isArray(owner?.exile) ? owner.exile : [];
      for (const card of exile) {
        const cardId = String(card?.id || card?.cardId || '').trim();
        if (!cardId || cardId !== targetId) continue;
        matches.push(card);
      }
    }

    return matches.length > 0 ? { cards: matches } : { cards: [], reason: 'failed_to_apply' };
  }

  if (!sourceId && step.linkedToSource) return { cards: [], reason: 'failed_to_apply' };

  const { criteria, ownOnly } = buildExilePermissionCriteria(selectorText);
  if (!criteria) return { cards: [], reason: 'unsupported_selector' };

  const matches: any[] = [];
  const currentTurn = Number((state as any).turnNumber ?? (state as any).turn ?? 0) || 0;
  for (const owner of state.players as any[]) {
    const exile = Array.isArray(owner?.exile) ? owner.exile : [];
    for (const card of exile) {
      if (step.linkedToSource && !isCardExiledWithSource(card, sourceId)) continue;
      if (ownOnly && String(owner?.id || '').trim() !== playerId) continue;
      if (!cardMatchesMoveZoneSingleTargetCriteria(card, criteria, undefined, currentTurn)) continue;
      matches.push(card);
    }
  }

  return { cards: matches };
}

function parseSupportedManaCostString(rawMana: string, xValue?: number): ManaCost | null {
  const symbols = parseManaSymbols(rawMana).filter(
    (symbol) => String(symbol || '').trim().toUpperCase() !== '{E}'
  );
  if (symbols.length === 0) return null;

  let generic = 0;
  let white = 0;
  let blue = 0;
  let black = 0;
  let red = 0;
  let green = 0;
  let colorless = 0;

  for (const symbol of symbols) {
    const upper = String(symbol || '').trim().toUpperCase();
    if (!upper) return null;
    if (upper === '{E}') continue;
    if (upper === '{X}') {
      const xAmount = Number(xValue);
      if (!Number.isFinite(xAmount)) return null;
      generic += Math.max(0, Math.floor(xAmount));
      continue;
    }
    if (/^\{\d+\}$/.test(upper)) {
      generic += parseInt(upper.slice(1, -1), 10);
      continue;
    }

    if (upper.includes('/')) {
      generic += 1;
      continue;
    }

    switch (upper) {
      case '{W}':
        white += 1;
        break;
      case '{U}':
        blue += 1;
        break;
      case '{B}':
        black += 1;
        break;
      case '{R}':
        red += 1;
        break;
      case '{G}':
        green += 1;
        break;
      case '{C}':
        colorless += 1;
        break;
      default:
        return null;
    }
  }

  return { generic, white, blue, black, red, green, colorless };
}

function parseEnergyCostAmount(rawMana: string): number {
  return parseManaSymbols(rawMana).reduce((count, symbol) => count + (String(symbol || '').trim().toUpperCase() === '{E}' ? 1 : 0), 0);
}

export function applyCreateEmblemStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'create_emblem' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const controllerId = (String(ctx.controllerId || '').trim() || ctx.controllerId) as PlayerID;
  const player = (state.players || []).find(p => p?.id === controllerId) as any;
  if (!player) {
    return {
      applied: false,
      message: `Skipped create emblem (controller unavailable): ${step.raw}`,
      reason: 'failed_to_apply',
    };
  }

  const emblemName = String(step.name || ctx.sourceName || 'Emblem').trim() || 'Emblem';
  const result = createCustomEmblem(
    controllerId,
    emblemName,
    [...step.abilities],
    ctx.sourceName,
    ctx.sourceId
  );
  const currentEmblems = Array.isArray(player.emblems) ? [...player.emblems] : [];
  const updatedPlayers = state.players.map(p =>
    p.id === controllerId ? ({ ...(p as any), emblems: [...currentEmblems, result.emblem] } as any) : p
  );

  return {
    applied: true,
    state: { ...state, players: updatedPlayers as any } as any,
    log: result.log,
  };
}

export function applyGrantGraveyardPermissionStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'grant_graveyard_permission' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped graveyard permission (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const playableUntilTurn = getPlayableUntilTurnForImpulseDuration(state, step.duration);
  let nextState = state;
  let granted = 0;
  const grantedCards: any[] = [];
  const grantedPermissionIds: string[] = [];
  const log: string[] = [];

  for (const playerId of players) {
    const resolved = resolveGraveyardPermissionTargets(nextState, playerId, step, ctx);
    if (resolved.reason === 'unsupported_selector') {
      return {
        applied: false,
        message: `Skipped graveyard permission (unsupported selector): ${step.raw}`,
        reason: 'failed_to_apply',
        options: { classification: 'ambiguous' },
      };
    }
    if (resolved.reason === 'failed_to_apply') {
      return {
        applied: false,
        message: `Skipped graveyard permission (referenced card unavailable): ${step.raw}`,
        reason: 'failed_to_apply',
        options: { classification: 'invalid_input', persist: false },
      };
    }

    const markerResult = applyGraveyardPermissionMarkers(nextState, playerId, resolved.cards, {
      permission: step.permission,
      playableUntilTurn,
    });
    nextState = markerResult.state;

    const firstClassPermission = buildFirstClassGrantedGraveyardPermission(nextState, playerId, step, ctx, resolved.cards);
    if (firstClassPermission) {
      const nextStateAny: any = nextState as any;
      const existingPermissions = Array.isArray(nextStateAny.graveyardCastingPermissions)
        ? nextStateAny.graveyardCastingPermissions.filter((permission: any) => String(permission?.id || '') !== String(firstClassPermission.id || ''))
        : [];
      nextState = {
        ...(nextStateAny as any),
        graveyardCastingPermissions: [...existingPermissions, firstClassPermission],
      } as any;
      grantedPermissionIds.push(String(firstClassPermission.id || ''));
    }

    granted += markerResult.granted;
    grantedCards.push(...resolved.cards);
    if (markerResult.granted > 0) {
      log.push(`${playerId} may ${step.permission === 'play' ? 'play' : 'cast'} ${markerResult.granted} graveyard card(s)`);
    }
  }

  return {
    applied: true,
    state: nextState,
    log: log.length > 0 ? log : [`Granted no graveyard permissions: ${step.raw}`],
    lastGrantedGraveyardCards: grantedCards,
    lastGrantedGraveyardPermissionIds: grantedPermissionIds,
  };
}

export function applyGrantGraveyardKeywordAbilityStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'grant_graveyard_keyword_ability' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped graveyard keyword grant (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const playableUntilTurn = getPlayableUntilTurnForImpulseDuration(state, step.duration);
  let nextStateAny: any = { ...(state as any) };
  let changed = 0;
  const sourceId = String(ctx.sourceId || '').trim();
  const sourceName = String(ctx.sourceName || '').trim();
  const temporaryGrantEntries: any[] = [];
  for (const playerId of players) {
    const resolved = resolveGraveyardPermissionTargets(nextStateAny as GameState, playerId, step, ctx);
    if (resolved.reason === 'unsupported_selector') {
      return {
        applied: false,
        message: `Skipped graveyard keyword grant (unsupported selector): ${step.raw}`,
        reason: 'failed_to_apply',
        options: { classification: 'ambiguous' },
      };
    }
    if (resolved.reason === 'failed_to_apply') {
      return {
        applied: false,
        message: `Skipped graveyard keyword grant (referenced card unavailable): ${step.raw}`,
        reason: 'failed_to_apply',
        options: { classification: 'invalid_input', persist: false },
      };
    }

    const targetIds = new Set(
      resolved.cards
        .map(card => String((card as any)?.id ?? (card as any)?.cardId ?? '').trim())
        .filter(Boolean)
    );
      if (targetIds.size === 0) continue;

      const player = (nextStateAny.players || []).find((candidate: any) => String(candidate?.id || '').trim() === playerId) as any;
      if (!player) continue;

    const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
      const affectedIds: string[] = [];
    const nextGraveyard = graveyard.map((card: any) => {
      const cardId = String(card?.id ?? card?.cardId ?? '').trim();
      if (!cardId || !targetIds.has(cardId)) return card;

      const existingKeywordAbilities = Array.isArray(card?.graveyardKeywordAbilities)
        ? [...card.graveyardKeywordAbilities]
        : [];
      const keywordAbility = {
        keyword: step.keyword,
        type: step.keyword,
        ...(step.costRaw ? { costRaw: step.costRaw } : {}),
        duration: step.duration,
        playableUntilTurn,
        sourceId: sourceId || undefined,
        sourceName: sourceName || undefined,
      };
      const duplicate = existingKeywordAbilities.some((entry: any) =>
        String(entry?.keyword || entry?.type || '').trim().toLowerCase() === step.keyword &&
        String(entry?.costRaw || '').trim() === String(step.costRaw || '').trim() &&
        String(entry?.sourceId || '').trim() === sourceId
      );

      changed += 1;
      affectedIds.push(cardId);
      temporaryGrantEntries.push({
        playerId: String(playerId),
        cardId,
        keyword: step.keyword,
        ...(step.costRaw ? { cost: step.costRaw } : {}),
        ...(sourceId ? { sourceId } : {}),
        ...(sourceName ? { sourceName } : {}),
        expiresAt: step.duration === 'this_turn' ? 'end_of_turn' : step.duration,
        turnApplied: Number((nextStateAny as any).turnNumber ?? (nextStateAny as any).turn ?? 0) || 0,
      });
      return {
        ...card,
        zone: 'graveyard',
        graveyardKeywordAbilities: duplicate ? existingKeywordAbilities : [...existingKeywordAbilities, keywordAbility],
        [`${step.keyword}Cost`]: step.costRaw,
        canActivateFromGraveyardBy: playerId,
        graveyardActivationUntilTurn: playableUntilTurn,
      };
    });

    nextStateAny = {
      ...nextStateAny,
      players: (nextStateAny.players || []).map((candidate: any) =>
        String(candidate?.id || '').trim() === playerId ? { ...candidate, graveyard: nextGraveyard } : candidate
      ),
    };

    if (affectedIds.length > 0) {
      nextStateAny.activatableFromGraveyard = { ...(nextStateAny.activatableFromGraveyard || {}) };
      nextStateAny.activatableFromGraveyard[playerId] = { ...(nextStateAny.activatableFromGraveyard[playerId] || {}) };
      for (const cardId of affectedIds) {
        nextStateAny.activatableFromGraveyard[playerId][cardId] = playableUntilTurn ?? Number.MAX_SAFE_INTEGER;
      }
    }
  }

  if (temporaryGrantEntries.length > 0) {
    const replacementKeys = new Set(temporaryGrantEntries.map(entry =>
      `${entry.playerId}:${entry.cardId}:${entry.keyword}:${String(entry.sourceId || '')}`
    ));
    const existingTemporaryGrants = Array.isArray(nextStateAny.temporaryGraveyardKeywordGrants)
      ? nextStateAny.temporaryGraveyardKeywordGrants
      : [];
    nextStateAny.temporaryGraveyardKeywordGrants = [
      ...existingTemporaryGrants.filter((entry: any) =>
        !replacementKeys.has(`${String(entry?.playerId || '')}:${String(entry?.cardId || '')}:${String(entry?.keyword || '')}:${String(entry?.sourceId || '')}`)
      ),
      ...temporaryGrantEntries,
    ];
  }

  return {
    applied: true,
    state: nextStateAny as GameState,
    log: changed > 0
      ? [`Granted ${step.keyword} to ${changed} graveyard card(s)`]
      : [`Granted no graveyard keyword abilities: ${step.raw}`],
  };
}

export function applyGrantExilePermissionStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'grant_exile_permission' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped exile permission (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const playableUntilTurn = getPlayableUntilTurnForImpulseDuration(state, step.duration);
  let nextState = state;
  const log: string[] = [];

  for (const playerId of players) {
    const resolved = resolveExilePermissionTargets(nextState, playerId, step, ctx);
    if (resolved.reason === 'unsupported_selector') {
      return {
        applied: false,
        message: `Skipped exile permission (unsupported selector): ${step.raw}`,
        reason: 'failed_to_apply',
        options: { classification: 'ambiguous' },
      };
    }
    if (resolved.reason === 'failed_to_apply') {
      return {
        applied: false,
        message: `Skipped exile permission (linked exiled cards unavailable): ${step.raw}`,
        reason: 'failed_to_apply',
        options: { classification: 'invalid_input', persist: false },
      };
    }

    const markerResult = applyExilePermissionMarkers(nextState, playerId, resolved.cards, {
      permission: step.permission,
      playableUntilTurn,
      castedPermanentEntersWithCounters: step.castedPermanentEntersWithCounters,
    });
    nextState = markerResult.state;
    if (markerResult.granted > 0) {
      log.push(`${playerId} may ${step.permission === 'play' ? 'play' : 'cast'} ${markerResult.granted} exiled card(s)`);
    }
  }

  return {
    applied: true,
    state: nextState,
    log: log.length > 0 ? log : [`Granted no exile permissions: ${step.raw}`],
  };
}

export function applyModifyGraveyardPermissionsStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'modify_graveyard_permissions' }>,
  runtime: {
    readonly lastGrantedGraveyardCards?: readonly any[];
    readonly lastGrantedGraveyardPermissionIds?: readonly string[];
  }
): PlayerStepHandlerResult {
  const lastGrantedGraveyardCards = Array.isArray(runtime.lastGrantedGraveyardCards)
    ? runtime.lastGrantedGraveyardCards
    : [];
  const grantedPermissionIds = new Set(
    (Array.isArray(runtime.lastGrantedGraveyardPermissionIds) ? runtime.lastGrantedGraveyardPermissionIds : [])
      .map((permissionId) => String(permissionId || '').trim())
      .filter(Boolean)
  );
  const grantedIds = new Set(
    lastGrantedGraveyardCards
      .map(card => String((card as any)?.id ?? (card as any)?.cardId ?? '').trim())
      .filter(Boolean)
  );

  const mergeGrantedGraveyardPermissionModifiers = (inputState: GameState): GameState => {
    const nextStateAny: any = { ...(inputState as any) };
    if (grantedPermissionIds.size === 0 || !Array.isArray(nextStateAny.graveyardCastingPermissions)) {
      return inputState;
    }

    const modifierSourceText = String(step.raw || '').trim();
    nextStateAny.graveyardCastingPermissions = nextStateAny.graveyardCastingPermissions.map((permission: any) => {
      const permissionId = String(permission?.id || '').trim();
      if (!permissionId || !grantedPermissionIds.has(permissionId)) {
        return permission;
      }

      const mergedSourceText = mergeGrantedGraveyardPermissionSourceText(
        String(permission?.sourceText || '').trim(),
        modifierSourceText,
      );

      const nextReplacement = permission?.replacement && typeof permission.replacement === 'object'
        ? { ...permission.replacement }
        : {};
      if (step.exileInsteadOfGraveyard) {
        nextReplacement.exileAfterResolution = true;
        if (!nextReplacement.sourceName && permission?.sourceName) {
          nextReplacement.sourceName = permission.sourceName;
        }
      }

      const structuredAdditionalCost = oracleGraveyardAdditionalCostToSerializable(step.additionalCost);

      return {
        ...permission,
        ...(mergedSourceText ? { sourceText: mergedSourceText } : {}),
        ...(structuredAdditionalCost ? { additionalCost: structuredAdditionalCost } : {}),
        ...( /\bonce during each of your turns\b/i.test(mergedSourceText)
          ? { usageLimit: { type: 'once_per_turn', maxUses: 1 } }
          : {}),
        ...(step.withoutPayingManaCost ? { costMode: 'without_paying_mana_cost' } : {}),
        ...(Object.keys(nextReplacement).length > 0 ? { replacement: nextReplacement } : {}),
      };
    });

    return nextStateAny as GameState;
  };

  if (step.scope !== 'last_granted_graveyard_cards' || grantedIds.size === 0) {
    if (
      step.castedPermanentEntersWithCounters ||
      step.castCost ||
      step.castCostRaw ||
      step.additionalCost ||
      step.withoutPayingManaCost ||
      /\bretrace\b/i.test(String(step.raw || '')) ||
      /\bcast from your graveyard\b/i.test(String(step.raw || ''))
    ) {
      return {
        applied: true,
        state: mergeGrantedGraveyardPermissionModifiers(state),
        log: [`Graveyard permission modifier recorded: ${step.raw}`],
      };
    }
    return {
      applied: false,
      message: `Skipped graveyard permission modifier (no granted cards in context): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'invalid_input', persist: false },
    };
  }

  let changed = 0;
  const updatedPlayers = (state.players || []).map((player: any) => {
    const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
    if (graveyard.length === 0) return player;

    let playerChanged = false;
    const updatedGraveyard = graveyard.map((card: any) => {
      const id = String(card?.id ?? card?.cardId ?? '').trim();
      if (!id || !grantedIds.has(id)) return card;
      playerChanged = true;
      changed += 1;
      return {
        ...card,
        ...(step.castCost ? { graveyardCastCost: step.castCost } : {}),
        ...(step.castCostRaw ? { graveyardCastCostRaw: step.castCostRaw } : {}),
        ...(step.withoutPayingManaCost ? { withoutPayingManaCost: true } : {}),
        ...(step.additionalCost ? { graveyardAdditionalCost: { ...step.additionalCost } } : {}),
        ...((step as any).exileInsteadOfGraveyard ? { exileInsteadOfGraveyard: true } : {}),
        ...((step as any).entersBattlefieldTransformed ? { entersBattlefieldTransformed: true } : {}),
        ...(step.castedPermanentEntersWithCounters
          ? { entersBattlefieldWithCounters: { ...step.castedPermanentEntersWithCounters } }
          : {}),
      };
    });

    return playerChanged ? ({ ...player, graveyard: updatedGraveyard } as any) : player;
  });

  const nextStateAny: any = { ...(state as any), players: updatedPlayers as any };
  return {
    applied: true,
    state: mergeGrantedGraveyardPermissionModifiers(nextStateAny as GameState) as any,
    log:
      changed > 0
        ? [`Updated graveyard permissions for ${changed} graveyard card(s)`]
        : [`Updated no graveyard permissions: ${step.raw}`],
  };
}

export function applyModifyTokenCreationStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'modify_token_creation' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped token creation replacement (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const existing = Array.isArray((state as any).tokenCreationReplacementEffects)
    ? [...(state as any).tokenCreationReplacementEffects]
    : [];
  const sourceId = String(ctx.sourceId || '').trim();
  const sourceName = String(ctx.sourceName || '').trim();
  const replacement = {
    id: `${sourceId || sourceName || 'oracle'}:token-replacement:${existing.length + 1}`,
    sourceId: sourceId || undefined,
    sourceName: sourceName || undefined,
    controllerId: String(ctx.controllerId || '').trim() || undefined,
    playerIds: players,
    tokenTypes: step.tokenTypes.map(value => String(value || '').trim().toLowerCase()).filter(Boolean),
    mode: step.mode,
    additionalAmount: step.additionalAmount,
    raw: step.raw,
  };
  const duplicate = existing.some((entry: any) =>
    String(entry?.sourceId || '').trim() === String(replacement.sourceId || '').trim() &&
    String(entry?.raw || '').trim() === step.raw &&
    String(entry?.mode || '').trim() === step.mode
  );

  return {
    applied: true,
    state: {
      ...(state as any),
      tokenCreationReplacementEffects: duplicate ? existing : [...existing, replacement],
    } as GameState,
    log: [`Registered token creation replacement: ${step.raw}`],
  };
}

export function applyPayManaStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'pay_mana' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  let effectiveStep = step;
  let players = resolvePlayers(state, step.who, ctx);
  if (
    players.length === 0 &&
    (String((step.who as any)?.kind || '') === 'unknown' || !step.who) &&
    /^when you do,\s+you may pay\b/i.test(String(step.raw || ''))
  ) {
    effectiveStep = { ...step, who: { kind: 'you' } };
    players = resolvePlayers(state, effectiveStep.who, ctx);
  }
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped pay mana (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const energyCost = parseEnergyCostAmount(effectiveStep.mana);
  const manaCost = parseSupportedManaCostString(effectiveStep.mana, Number(ctx.xValue));
  if (energyCost <= 0 && !manaCost) {
    return {
      applied: false,
      message: `Skipped pay mana (unsupported mana cost): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'ambiguous' },
    };
  }

  if (step.optional && ctx?.interactivePlayerChoices) {
    return {
      applied: false,
      message: `Deferred optional mana payment (requires player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: {
        classification: 'player_choice',
        metadata: { manaCost: step.mana },
      },
    };
  }

  let nextState = state;
  const log: string[] = [];
  for (const playerId of players) {
    if (energyCost > 0) {
      const player = (nextState.players || []).find((entry) => entry?.id === playerId) as any;
      const currentEnergy = Math.max(
        0,
        Number(player?.energyCounters ?? player?.energy ?? player?.counters?.energy ?? 0) || 0
      );
      if (currentEnergy < energyCost) {
        return {
          applied: false,
          message: `Skipped pay mana (cannot pay ${step.mana}): ${step.raw}`,
          reason: 'failed_to_apply',
          options: {
            classification: 'invalid_input',
            persist: false,
          },
        };
      }
      const energyResult = adjustPlayerCounter(nextState, playerId, 'energy', -energyCost);
      if (!energyResult.applied) {
        return {
          applied: false,
          message: `Skipped pay mana (cannot pay ${step.mana}): ${step.raw}`,
          reason: 'failed_to_apply',
          options: {
            classification: 'invalid_input',
            persist: false,
          },
        };
      }
      nextState = energyResult.state;
      log.push(...energyResult.log);
    }

    if (manaCost) {
      const manaPoolRecord: Record<PlayerID, any> = { ...((((nextState as any).manaPool || {}) as any) || {}) };
      const currentPool = manaPoolRecord[playerId] || createEmptyManaPool();
      const payment = payManaCost(currentPool, manaCost);
      if (!payment.success || !payment.remainingPool) {
        return {
          applied: false,
          message: `Skipped pay mana (cannot pay ${step.mana}): ${step.raw}`,
          reason: 'failed_to_apply',
          options: {
            classification: 'invalid_input',
            persist: false,
          },
        };
      }

      manaPoolRecord[playerId] = payment.remainingPool;
      nextState = { ...(nextState as any), manaPool: manaPoolRecord } as any;
      log.push(`${playerId} pays ${step.mana}`);
    } else if (energyCost > 0) {
      log.push(`${playerId} pays ${step.mana}`);
    }
  }

  return {
    applied: true,
    state: nextState,
    log,
  };
}

function resolveVariableAmount(
  state: GameState,
  controllerId: PlayerID,
  amount: Extract<OracleEffectStep, { kind: 'gain_life' | 'lose_life' }>['amount'],
  ctx: OracleIRExecutionContext,
  runtime: ModifyPtRuntime | undefined,
  evaluateWhereX?: (
    state: GameState,
    controllerId: PlayerID,
    whereRaw: string,
    targetCreatureId?: string,
    ctx?: OracleIRExecutionContext,
    runtime?: ModifyPtRuntime
  ) => number | null
): number | null {
  const readFinite = (value: unknown): number | null => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  };

  const readObjectStat = (entry: any, stat: 'power' | 'toughness' | 'mana_value'): number | null => {
    if (stat === 'mana_value') {
      return getCardManaValue(entry);
    }

    return stat === 'power'
      ? readFinite(entry?.effectivePower ?? entry?.power ?? entry?.basePower ?? entry?.card?.power)
      : readFinite(entry?.effectiveToughness ?? entry?.toughness ?? entry?.baseToughness ?? entry?.card?.toughness);
  };

  const numericAmount = quantityToNumber(amount, ctx);
  if (numericAmount !== null) return numericAmount;
  if (amount.kind === 'x') {
    const xValue = Number(ctx?.xValue);
    return Number.isFinite(xValue) ? Math.max(0, Math.floor(xValue)) : null;
  }
  if (amount.kind === 'unknown') {
    const normalized = normalizeOracleText(String(amount.raw || ''));
    const spellsCastMatch = normalized.match(/^(?:(\d+)\s+(?:life\s+)?)?for each spells? (?:you(?:'ve| have)?|you) cast this turn$/i);
    if (spellsCastMatch) {
      const multiplier = Number(spellsCastMatch[1] || 1);
      const castCount = resolveControllerSpellCastCountThisTurn(state, controllerId, ctx.spellCastCountThisTurn);
      if (castCount !== null && Number.isFinite(multiplier)) return Math.max(0, castCount * Math.max(0, multiplier));
    }
  }
  if (amount.kind === 'reference_amount') {
    const normalized = normalizeOracleText(String(amount.raw || ''));
    const spellsCastMatch = normalized.match(/^(?:(\d+)\s+(?:life\s+)?)?for each spells? (?:you(?:'ve| have)?|you) cast this turn$|^the number of spells? (?:you(?:'ve| have)?|you) cast this turn$/i);
    if (spellsCastMatch) {
      const multiplier = Number(spellsCastMatch[1] || 1);
      const castCount = resolveControllerSpellCastCountThisTurn(state, controllerId, ctx.spellCastCountThisTurn);
      if (castCount !== null && Number.isFinite(multiplier)) return Math.max(0, castCount * Math.max(0, multiplier));
    }
    const runtimeAmount = Number(runtime?.lastReferenceAmount);
    if (Number.isFinite(runtimeAmount)) return Math.max(0, runtimeAmount);
    if (normalized === 'the high bid') {
      const referenceAmount = Number(ctx.referenceAmount);
      return Number.isFinite(referenceAmount) ? Math.max(0, referenceAmount) : 2;
    }
    if (/that card'?s mana value/i.test(normalized)) {
      const contextualCards = [
        ...(Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : []),
        ...(Array.isArray(ctx.lastMovedCards) ? ctx.lastMovedCards : []),
        ...(Array.isArray((ctx as any).lastRevealedCards) ? (ctx as any).lastRevealedCards : []),
        ...(Array.isArray(runtime?.lastDiscardedCards) ? runtime.lastDiscardedCards : []),
      ];
      if (contextualCards.length > 0) {
        const manaValue = getCardManaValue(contextualCards[contextualCards.length - 1]);
        if (manaValue !== null) return manaValue;
      }
    }
    if (/the sacrificed enchantment'?s mana value/i.test(normalized)) {
      const sacrificed = Array.isArray(runtime?.lastSacrificedPermanents) ? runtime.lastSacrificedPermanents : [];
      if (sacrificed.length === 1) {
        const manaValue = getCardManaValue(sacrificed[0]);
        if (manaValue !== null) return manaValue;
      }
    }
    if (/the milled card'?s mana value/i.test(normalized)) {
      const milled = [
        ...(Array.isArray((ctx as any).lastMilledCards) ? (ctx as any).lastMilledCards : []),
        ...(Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : []),
        ...(Array.isArray(ctx.lastMovedCards) ? ctx.lastMovedCards : []),
      ];
      if (milled.length > 0) {
        const manaValue = getCardManaValue(milled[milled.length - 1]);
        if (manaValue !== null) return manaValue;
      }
    }
    if (evaluateWhereX) {
      const evaluated = evaluateWhereX(state, controllerId, `X is ${normalized}`, undefined, ctx, runtime);
      if (evaluated !== null) return Math.max(0, evaluated);
    }
    return null;
  }
  if (amount.kind === 'object_stat') {
    const sacrificed = Array.isArray(runtime?.lastSacrificedPermanents) ? runtime.lastSacrificedPermanents : [];
    if (
      sacrificed.length >= 1 &&
      amount.subject === 'the_sacrificed_permanent'
    ) {
      const sacrificedAmount = readObjectStat(sacrificed[sacrificed.length - 1], amount.stat);
      if (sacrificedAmount !== null) return sacrificedAmount;
    }
    if (sacrificed.length === 1 && (amount.subject === 'that_creature' || amount.subject === 'the_sacrificed_creature')) {
      const sacrificedAmount = readObjectStat(sacrificed[0], amount.stat);
      if (sacrificedAmount !== null) return sacrificedAmount;
    }

    const moved = Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : [];
    const exiled = Array.isArray(runtime?.lastExiledCards) ? runtime.lastExiledCards : [];
    const contextualCards = [...moved, ...exiled, ...(Array.isArray(ctx.lastMovedCards) ? ctx.lastMovedCards : [])];
    if (contextualCards.length >= 1 && (amount.subject === 'it' || amount.subject === 'that_card' || amount.subject === 'that_creature')) {
      for (let index = contextualCards.length - 1; index >= 0; index -= 1) {
        const contextualAmount = readObjectStat(contextualCards[index], amount.stat);
        if (contextualAmount !== null) return contextualAmount;
      }
    }
    if (moved.length === 1 && (amount.subject === 'it' || amount.subject === 'that_card' || amount.subject === 'that_creature')) {
      const movedAmount = readObjectStat(moved[0], amount.stat);
      if (movedAmount !== null) return movedAmount;
    }

    if (amount.subject === 'it' || amount.subject === 'that_creature') {
      const targetCreatureId = resolveSingleCreatureTargetId(
        state,
        { kind: 'raw', text: amount.subject === 'that_creature' ? 'that creature' : 'it' },
        ctx
      );
      if (targetCreatureId) {
        const targetCreature = (state.battlefield || []).find(
          (entry: any) => String(entry?.id || '').trim() === String(targetCreatureId || '').trim()
        );
        const targetAmount = readObjectStat(targetCreature, amount.stat);
        if (targetAmount !== null) return targetAmount;
      }
    }

    return null;
  }
  if (amount.kind !== 'unknown' || !evaluateWhereX) return null;

  const raw = String(amount.raw || '').trim().replace(/^equal to\s+/i, '').trim();
  if (!raw) return null;

  const evaluated = evaluateWhereX(state, controllerId, `X is ${raw}`, undefined, ctx, runtime);
  if (evaluated !== null) return evaluated;

  const sacrificed = Array.isArray(runtime?.lastSacrificedPermanents) ? runtime.lastSacrificedPermanents : [];
  if (sacrificed.length === 1) {
    const snapshot = sacrificed[0] as any;
    const lowerRaw = raw.toLowerCase();
    if (/^(?:the sacrificed|that) creature's power$/.test(lowerRaw)) return readFinite(snapshot?.power);
    if (/^(?:the sacrificed|that) creature's toughness$/.test(lowerRaw)) return readFinite(snapshot?.toughness);
    if (/^(?:the sacrificed|that) creature's mana value$/.test(lowerRaw)) return readFinite(snapshot?.manaValue);
  }

  const moved = Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : [];
  const contextualMoved = [
    ...moved,
    ...(Array.isArray(ctx.lastMovedCards) ? ctx.lastMovedCards : []),
    ...(Array.isArray((ctx as any).lastRevealedCards) ? (ctx as any).lastRevealedCards : []),
  ];
  if (contextualMoved.length >= 1) {
    const lowerRaw = raw.toLowerCase();
    const latest = contextualMoved[contextualMoved.length - 1];
    const manaValue = getCardManaValue(latest);
    if (manaValue !== null && /^(?:its|that card's|that creature's) mana value$/.test(lowerRaw)) {
      return manaValue;
    }
  }
  if (moved.length === 1) {
    const lowerRaw = raw.toLowerCase();
    const manaValue = getCardManaValue(moved[0]);
    if (manaValue !== null && /^(?:its|that card's|that creature's) mana value$/.test(lowerRaw)) {
      return manaValue;
    }
    if (/^(?:its|that card's|that creature's) power$/.test(lowerRaw)) {
      return readFinite((moved[0] as any)?.power ?? (moved[0] as any)?.card?.power);
    }
    if (/^(?:its|that card's|that creature's) toughness$/.test(lowerRaw)) {
      return readFinite((moved[0] as any)?.toughness ?? (moved[0] as any)?.card?.toughness);
    }
  }

  return null;
}

export function applyScryStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'scry' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped scry (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const amount = resolveStepAmountForPlayer(
    state,
    ctx.controllerId,
    step.amount,
    ctx,
    players.length === 1 ? players[0] : step.whereX ? players[0] : undefined,
    { whereX: step.whereX },
  );
  if (amount === null) {
    return {
      applied: false,
      message: `Skipped scry (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
      options: { classification: 'ambiguous' },
    };
  }

  if (amount <= 0) {
    return {
      applied: true,
      state,
      log: [`Scry ${amount} (no-op): ${step.raw}`],
      lastScryLookedAtCount: 0,
    };
  }

  if (ctx.selectorContext?.scryResolutionComplete === true) {
    const keepTopOrder = Array.isArray(ctx.selectorContext?.keepTopOrder)
      ? ctx.selectorContext.keepTopOrder
      : [];
    const bottomOrder = Array.isArray(ctx.selectorContext?.bottomOrder)
      ? ctx.selectorContext.bottomOrder
      : [];
    const lookedCount = keepTopOrder.length + bottomOrder.length;
    return {
      applied: true,
      state,
      log: [`Scry ${lookedCount} (resolution applied): ${step.raw}`],
      lastScryLookedAtCount: lookedCount,
      skipLedgerFlush: true,
    };
  }

  const { cards: observedCards, lookedCount } = collectTopLibraryObservationForPlayers(state, players, amount);
  const observationCarryOver = observedCards.length > 0
    ? { lastMovedCards: observedCards, lastScryLookedAtCount: lookedCount }
    : { lastScryLookedAtCount: 0 };
  let ledgerRecordedViaBridge = false;
  const bridgeOptions = usedOracleIrServerBridge(ctx)
    ? { ctx, stepIndex: Number(ctx.currentStepIndex), stepKind: step.kind }
    : undefined;

  const wouldNeedChoice = players.some(playerId => {
    const player = state.players.find(p => p.id === playerId) as any;
    const libraryLength = Array.isArray(player?.library) ? player.library.length : 0;
    return libraryLength > 0;
  });

  if (wouldNeedChoice) {
    if (bridgeOptions && observedCards.length > 0 && Number.isFinite(bridgeOptions.stepIndex)) {
      const observation = commitLibraryTopObservation({
        playerId: ctx.controllerId,
        cards: observedCards,
        stepIndex: Number(bridgeOptions.stepIndex),
        stepKind: String(bridgeOptions.stepKind || 'scry'),
        cause: 'oracle_ir:scry',
        ctx: bridgeOptions.ctx,
      });
      if (observation.halted) {
        return withDiscardLedgerFlags({
          applied: true,
          state,
          log: [`Scry ${amount} halted for replacement: ${step.raw}`],
          lastScryLookedAtCount: lookedCount,
        }, ledgerRecordedViaBridge);
      }
      if (observation.ledgerRecordedViaBridge) {
        ledgerRecordedViaBridge = true;
      }
    }
    return withDiscardLedgerFlags({
      applied: false,
      message: `Skipped scry (requires player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
      ...observationCarryOver,
    }, ledgerRecordedViaBridge);
  }

  return {
    applied: true,
    state,
    log: [`Scry ${amount} (no cards in library): ${step.raw}`],
    lastScryLookedAtCount: 0,
  };
}

export function applyFatesealStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'fateseal' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const amount = quantityToNumber(step.amount);
  if (amount === null) {
    return {
      applied: false,
      message: `Skipped fateseal (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
      options: { classification: 'ambiguous' },
    };
  }

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped fateseal (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  if (players.length !== 1) {
    return {
      applied: false,
      message: `Skipped fateseal (requires deterministic controller): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  const actingPlayerId = players[0];
  const targets = resolvePlayers(state, step.target, ctx).filter(playerId => playerId !== actingPlayerId);
  if (targets.length === 0) {
    return {
      applied: false,
      message: `Skipped fateseal (unsupported target selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  if (targets.length !== 1) {
    return {
      applied: false,
      message: `Skipped fateseal (requires deterministic opponent): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  const targetPlayerId = targets[0];
  const targetPlayer = state.players.find((player: any) => String(player?.id || '').trim() === String(targetPlayerId || '').trim()) as any;
  if (!targetPlayer) {
    return {
      applied: false,
      message: `Skipped fateseal (target player not found): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'invalid_input', persist: false },
    };
  }

  const library = Array.isArray(targetPlayer.library) ? targetPlayer.library : [];
  const lookedAtCount = Math.min(Math.max(0, amount), library.length);
  return {
    applied: true,
    state,
    log: [
      lookedAtCount > 0
        ? `${actingPlayerId} fatesealed ${targetPlayerId} for ${lookedAtCount} card(s) and left them in the same order`
        : `${actingPlayerId} fatesealed ${targetPlayerId} for 0 card(s)`,
    ],
  };
}

export function applyVoteStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'vote' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const voters = resolvePlayers(state, step.voters, ctx);
  if (voters.length === 0) {
    return {
      applied: false,
      message: `Skipped vote (unsupported voter selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const ballot = step.ballot || 'labels';
  const hintCounts =
    ctx.voteChoiceCounts && typeof ctx.voteChoiceCounts === 'object'
      ? Object.fromEntries(
          Object.entries(ctx.voteChoiceCounts).map(([key, value]) => [
            String(key || '').trim().toLowerCase(),
            Number(value) || 0,
          ])
        )
      : null;

  // Player/permanent ballots (Secret council) need tallies before follow-on effects can scale.
  if (ballot === 'players' || ballot === 'permanents') {
    if (!hintCounts || Object.keys(hintCounts).length === 0) {
      return {
        applied: false,
        message: `Skipped vote (requires ${ballot} ballot selections): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }

    const receivedByPlayer =
      ballot === 'players'
        ? { ...hintCounts }
        : ((state as any).votesReceivedByPlayer && typeof (state as any).votesReceivedByPlayer === 'object'
            ? { ...(state as any).votesReceivedByPlayer }
            : {});
    const receivedByPermanent =
      ballot === 'permanents' ? { ...hintCounts } : ((state as any).votesReceivedByPermanent || {});

    return {
      applied: true,
      state: {
        ...(state as any),
        lastVoteResults: hintCounts,
        voteResults: hintCounts,
        votesReceivedByPlayer: receivedByPlayer,
        votesReceivedByPermanent: receivedByPermanent,
        lastVoteMeta: {
          secret: Boolean(step.secret),
          ballot,
          ...(step.ballotFilter ? { ballotFilter: step.ballotFilter } : {}),
          voters,
        },
      } as GameState,
      log: [
        `${voters.length} player(s) voted${step.secret ? ' secretly' : ''} (${ballot} ballot)`,
      ],
    };
  }

  const normalizedChoices = (step.choices || []).map(choice => String(choice || '').trim().toLowerCase()).filter(Boolean);
  const winningVoteChoice = deriveWinningVoteChoice(ctx);
  if (typeof winningVoteChoice === 'undefined') {
    return {
      applied: false,
      message: `Skipped vote (requires vote choices): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  if (hintCounts && normalizedChoices.length > 0) {
    const overlap = normalizedChoices.some((choice) => Object.prototype.hasOwnProperty.call(hintCounts, choice));
    if (!overlap) {
      return {
        applied: false,
        message: `Skipped vote (requires vote choices): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
  }

  if (winningVoteChoice === '') {
    return {
      applied: false,
      message: `Skipped vote (winning choice unavailable): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'invalid_input', persist: false },
    };
  }

  const nextState = {
    ...(state as any),
    ...(hintCounts
      ? {
          lastVoteResults: hintCounts,
          voteResults: hintCounts,
        }
      : {}),
    lastVoteMeta: {
      secret: Boolean(step.secret),
      ballot: 'labels' as const,
      voters,
      winningVoteChoice,
    },
  } as GameState;

  if (winningVoteChoice === null) {
    return {
      applied: true,
      state: nextState,
      log: [`${voters.length} player(s) voted and the vote tied`],
    };
  }

  const normalizedWinner = String(winningVoteChoice).toLowerCase();
  if (normalizedChoices.length > 0 && !normalizedChoices.includes(normalizedWinner)) {
    return {
      applied: false,
      message: `Skipped vote (winning choice not in parsed choices): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'invalid_input', persist: false },
    };
  }

  return {
    applied: true,
    state: nextState,
    log: [
      `${voters.length} player(s) voted and ${String(winningVoteChoice)} won`,
    ],
  };
}

export function applyClashStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'clash' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped clash (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }
  if (players.length !== 1) {
    return {
      applied: false,
      message: `Skipped clash (requires deterministic player): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  const playerId = players[0];
  const player = state.players.find((p: any) => String(p?.id || '').trim() === String(playerId || '').trim()) as any;
  if (!player) {
    return {
      applied: false,
      message: `Skipped clash (player not found): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'invalid_input', persist: false },
    };
  }

  let opponentId: PlayerID | null = null;
  if (step.opponent) {
    const opponents = resolvePlayers(state, step.opponent, ctx);
    if (opponents.length === 0) {
      const controllerOpponents = (state.players || []).filter((p: any) => String(p?.id || '').trim() !== String(playerId || '').trim());
      return {
        applied: false,
        message: `Skipped clash (requires opponent selection): ${step.raw}`,
        reason: controllerOpponents.length > 1 ? 'player_choice_required' : 'unsupported_player_selector',
        options: { classification: controllerOpponents.length > 1 ? 'player_choice' : 'ambiguous' },
      };
    }
    if (opponents.length !== 1) {
      return {
        applied: false,
        message: `Skipped clash (requires deterministic opponent): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    opponentId = opponents[0];
  }

  const playerTopCard = Array.isArray(player.library) && player.library.length > 0 ? player.library[0] : null;
  const playerManaValue = Math.max(0, Number(getCardManaValue(playerTopCard) ?? 0));
  const log: string[] = [];

  if (playerTopCard) {
    log.push(`${playerId} clashed and revealed ${String(playerTopCard?.name || 'a card')} (MV ${playerManaValue})`);
  } else {
    log.push(`${playerId} clashed but had no card to reveal`);
  }

  let lastClashWon = Boolean(playerTopCard);
  if (opponentId) {
    const opponent = state.players.find((p: any) => String(p?.id || '').trim() === String(opponentId || '').trim()) as any;
    if (!opponent) {
      return {
        applied: false,
        message: `Skipped clash (opponent not found): ${step.raw}`,
        reason: 'failed_to_apply',
        options: { classification: 'invalid_input', persist: false },
      };
    }

    const opponentTopCard = Array.isArray(opponent.library) && opponent.library.length > 0 ? opponent.library[0] : null;
    const opponentManaValue = Math.max(0, Number(getCardManaValue(opponentTopCard) ?? 0));
    if (opponentTopCard) {
      log.push(`${opponentId} revealed ${String(opponentTopCard?.name || 'a card')} (MV ${opponentManaValue})`);
    } else {
      log.push(`${opponentId} had no card to reveal`);
    }

    lastClashWon = playerTopCard !== null && playerManaValue > opponentManaValue;
  }

  log.push(lastClashWon ? `${playerId} won the clash` : `${playerId} did not win the clash`);
  return {
    applied: true,
    state,
    log,
    lastClashWon,
  };
}

export function applySearchLibraryStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'search_library' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped library search (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  let nextState = state;
  const log: string[] = [];
  const allMovedCards: any[] = [];
  const replayMutations: OracleIRReplayMutation[] = [];
  let ledgerRecordedViaBridge = false;
  const bridgeActive = usedOracleIrServerBridge(ctx);

  const recordShuffledLibrary = (playerId: PlayerID, shuffledLibrary: readonly any[]): void => {
    if (step.shuffle === false) return;
    const shuffledLibraryIds = shuffledLibrary
      .map((card) => String(card?.id || card?.cardId || '').trim())
      .filter(Boolean);
    if (shuffledLibraryIds.length === 0) return;
    replayMutations.push({ kind: 'shuffleLibrary', playerId, shuffledLibraryIds });
  };

  for (const playerId of players) {
    const player = nextState.players.find(p => p.id === playerId) as any;
    if (!player) {
      return {
        applied: false,
        message: `Skipped library search (player not found): ${step.raw}`,
        reason: 'failed_to_apply',
      };
    }

    const library = Array.isArray(player.library) ? [...player.library] : [];
    const matches = getSearchLibraryMatches(library, step, nextState, ctx);
    if (matches === null) {
      return {
        applied: false,
        message: `Skipped library search (criteria unresolved): ${step.raw}`,
        reason: 'failed_to_apply',
      };
    }

    const maxResults = step.maxResults === 'any_number'
      ? matches.length
      : resolveSearchLibraryMaxResults(nextState, step, ctx);
    const matchById = new Map(
      matches.map((card) => [String(card?.id || card?.cardId || '').trim(), card] as const),
    );
    const chosenIds = filterChosenLibraryMatchIds(matches, getNormalizedChosenIds(ctx), maxResults);
    let selected: any[];

    if (chosenIds.length > 0) {
      selected = chosenIds
        .map((id) => matchById.get(String(id || '').trim()))
        .filter(Boolean) as any[];
    } else if (
      matches.length > 0
      && (
        matches.length > maxResults
        || step.maxResults === 'any_number'
        // Live / interactive: always pause for LIBRARY_SEARCH UI even when only one card matches
        // (Celestial X-search, tutors). Non-interactive dry-run may still auto-pick unique matches.
        || (ctx.interactivePlayerChoices !== false && !isOptionalSearchLibraryStep(step))
      )
    ) {
      return {
        applied: false,
        message: `Skipped library search (requires card choice): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    } else {
      selected = matches.slice(0, maxResults);
    }

    const selectedIds = new Set(selected.map(card => String(card?.id || card?.cardId || '').trim()).filter(Boolean));
    const splitPlan = inferSplitLibrarySearchPlan(step.raw);
    const splitAssignmentsRaw = (ctx.selectorContext as {
      splitAssignments?: { toBattlefield?: string[]; toHand?: string[] };
    } | undefined)?.splitAssignments;

    if (splitPlan && selected.length > 0 && !splitAssignmentsRaw) {
      return {
        applied: false,
        message: `Skipped library search (requires split destination choice): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }

    const canBridgeSplit = bridgeActive
      && splitPlan
      && splitAssignmentsRaw
      && Number.isFinite(ctx.currentStepIndex)
      && selected.length > 0;

    if (canBridgeSplit) {
      const battlefieldIdSet = new Set(
        (splitAssignmentsRaw.toBattlefield || []).map((id) => String(id || '').trim()).filter(Boolean),
      );
      const handIdSet = new Set(
        (splitAssignmentsRaw.toHand || []).map((id) => String(id || '').trim()).filter(Boolean),
      );
      const battlefieldCards = selected.filter((card) =>
        battlefieldIdSet.has(String(card?.id || card?.cardId || '').trim()),
      );
      const handCards = selected.filter((card) =>
        handIdSet.has(String(card?.id || card?.cardId || '').trim()),
      );

      if (handCards.length > 0) {
        const handCommit = commitCardZoneChanges({
          state: nextState,
          playerId,
          cards: handCards.map((card) => ({ ...card, ownerId: playerId, owner: playerId })),
          sourceZone: 'library',
          intendedDestination: 'hand',
          stepIndex: Number(ctx.currentStepIndex),
          stepKind: step.kind,
          cause: 'oracle_ir:search_library_split',
          ctx,
        });
        if (handCommit.halted) {
          return withDiscardLedgerFlags({
            applied: true,
            state: nextState,
            log,
            ...(allMovedCards.length > 0 ? { lastMovedCards: allMovedCards } : {}),
          }, ledgerRecordedViaBridge);
        }
        nextState = handCommit.state;
        allMovedCards.push(...handCommit.movedCards);
        if (handCommit.ledgerRecordedViaBridge) {
          ledgerRecordedViaBridge = true;
        }
      }

      const playerAfterHand = nextState.players.find((entry) => entry.id === playerId) as any;
      let remainingLibrary = readPlayerZoneCards(nextState, playerId, playerAfterHand, 'library');
      remainingLibrary = remainingLibrary.filter(
        (card) => !battlefieldIdSet.has(String(card?.id || card?.cardId || '').trim()),
      );
      const shuffledLibrary = step.shuffle === false ? remainingLibrary : shuffleArray(remainingLibrary);
      writePlayerZoneCards(nextState, playerId, playerAfterHand, 'library', shuffledLibrary);
      recordShuffledLibrary(playerId, shuffledLibrary);

      const entersTapped = Boolean(splitPlan.entersTapped || step.entersTapped);
      const enteredBattlefield: any[] = [];
      for (const card of battlefieldCards) {
        const resolved = resolveBattlefieldEntryFromOracleIrContext(
          nextState,
          card,
          playerId,
          { entersTapped },
          { ctx, stepKind: step.kind, cause: 'oracle_ir:search_library_split' },
        );
        if ('halted' in resolved) {
          return withDiscardLedgerFlags({
            applied: true,
            state: nextState,
            log,
            ...(allMovedCards.length > 0 ? { lastMovedCards: allMovedCards } : {}),
          }, ledgerRecordedViaBridge);
        }

        enteredBattlefield.push(
          ...createBattlefieldPermanentsFromCards(
            [{ ...card, ownerId: playerId, owner: playerId }],
            playerId,
            playerId,
            resolved.entersTapped,
            resolved.entersFaceDown,
            resolved.withCounters,
            'library',
          ),
        );
      }

      if (enteredBattlefield.length > 0) {
        nextState = {
          ...nextState,
          battlefield: [...(nextState.battlefield || []), ...enteredBattlefield],
        } as GameState;
        allMovedCards.push(...battlefieldCards);
        ledgerRecordedViaBridge = true;
      }

      if (step.revealFound && selected.length > 0) {
        log.push(`${playerId} revealed ${selected.map(card => String(card?.name || 'card')).join(', ')}`);
      }
      log.push(
        `${playerId} searched their library and put ${battlefieldCards.length} card(s) onto the battlefield and ${handCards.length} card(s) into their hand`,
      );
      if (step.shuffle !== false) {
        log.push(`${playerId} shuffled their library`);
      }
      continue;
    }

    const canBridgeBattlefield = bridgeActive
      && selected.length > 0
      && step.destination === 'battlefield'
      && Number.isFinite(ctx.currentStepIndex);

    if (canBridgeBattlefield) {
      const remainingLibrary = library.filter(
        (card) => !selectedIds.has(String(card?.id || card?.cardId || '').trim()),
      );
      const shuffledLibrary = step.shuffle === false ? remainingLibrary : shuffleArray(remainingLibrary);
      writePlayerZoneCards(nextState, playerId, player, 'library', shuffledLibrary);
      recordShuffledLibrary(playerId, shuffledLibrary);

      const enteredBattlefield: any[] = [];
      for (const card of selected) {
        const resolved = resolveBattlefieldEntryFromOracleIrContext(
          nextState,
          card,
          playerId,
          { entersTapped: Boolean(step.entersTapped) },
          { ctx, stepKind: step.kind, cause: 'oracle_ir:search_library' },
        );
        if ('halted' in resolved) {
          return withDiscardLedgerFlags({
            applied: true,
            state: nextState,
            log,
            ...(allMovedCards.length > 0 ? { lastMovedCards: allMovedCards } : {}),
          }, ledgerRecordedViaBridge);
        }

        enteredBattlefield.push(
          ...createBattlefieldPermanentsFromCards(
            [{ ...card, ownerId: playerId, owner: playerId }],
            playerId,
            playerId,
            resolved.entersTapped,
            resolved.entersFaceDown,
            resolved.withCounters,
            'library',
          ),
        );
      }

      nextState = {
        ...nextState,
        battlefield: [...(nextState.battlefield || []), ...enteredBattlefield],
      } as GameState;
      allMovedCards.push(...selected);
      ledgerRecordedViaBridge = true;

      if (step.revealFound && selected.length > 0) {
        log.push(`${playerId} revealed ${selected.map(card => String(card?.name || 'card')).join(', ')}`);
      }
      log.push(`${playerId} searched their library and put ${selected.length} card(s) into ${step.destination}`);
      if (step.shuffle !== false) {
        log.push(`${playerId} shuffled their library`);
      }
      continue;
    }

    const canBridgeSearch = bridgeActive
      && selected.length > 0
      && step.destination !== 'battlefield'
      && Number.isFinite(ctx.currentStepIndex);

    if (canBridgeSearch) {
      const intendedDestination = step.destination === 'hand'
        ? 'hand'
        : step.destination === 'graveyard'
          ? 'graveyard'
          : step.destination === 'exile'
            ? 'exile'
            : 'library';
      const libraryPlacement = step.destination === 'top'
        ? 'top' as const
        : step.destination === 'bottom'
          ? 'bottom' as const
          : undefined;
      const cardsToCommit = (step.destination === 'graveyard'
        ? stampCardsPutIntoGraveyardThisTurn(nextState, selected)
        : step.destination === 'top'
          ? [...selected].reverse()
          : selected
      ).map((card: any) => ({ ...card, ownerId: playerId, owner: playerId }));

      const commitResult = commitCardZoneChanges({
        state: nextState,
        playerId,
        cards: cardsToCommit,
        sourceZone: 'library',
        intendedDestination,
        stepIndex: Number(ctx.currentStepIndex),
        stepKind: step.kind,
        cause: 'oracle_ir:search_library',
        ctx,
        libraryPlacement,
      });
      if (commitResult.halted) {
        return withDiscardLedgerFlags({
          applied: true,
          state: nextState,
          log,
          ...(allMovedCards.length > 0 ? { lastMovedCards: allMovedCards } : {}),
        }, ledgerRecordedViaBridge);
      }

      const playerAfterCommit = nextState.players.find((entry) => entry.id === playerId) as any;
      const libraryAfterCommit = readPlayerZoneCards(nextState, playerId, playerAfterCommit, 'library');
      const committedSelectedCards = libraryAfterCommit.filter((card) =>
        selectedIds.has(String(card?.id || card?.cardId || '').trim()),
      );
      const remainingLibrary = libraryAfterCommit.filter((card) =>
        !selectedIds.has(String(card?.id || card?.cardId || '').trim()),
      );
      const shuffledRemainder = step.shuffle === false ? remainingLibrary : shuffleArray(remainingLibrary);
      const finalLibrary = step.destination === 'top'
        ? [...committedSelectedCards, ...shuffledRemainder]
        : step.destination === 'bottom'
          ? [...shuffledRemainder, ...committedSelectedCards]
          : shuffledRemainder;
      writePlayerZoneCards(nextState, playerId, playerAfterCommit, 'library', finalLibrary);
      recordShuffledLibrary(playerId, finalLibrary);

      allMovedCards.push(...commitResult.movedCards);
      if (commitResult.ledgerRecordedViaBridge) {
        ledgerRecordedViaBridge = true;
      }

      if (step.revealFound && selected.length > 0) {
        log.push(`${playerId} revealed ${selected.map(card => String(card?.name || 'card')).join(', ')}`);
      }
      if (selected.length > 0) {
        log.push(`${playerId} searched their library and put ${selected.length} card(s) into ${step.destination}`);
      } else {
        log.push(`${playerId} searched their library and found no card`);
      }
      if (step.shuffle !== false) {
        log.push(`${playerId} shuffled their library`);
      }
      continue;
    }

    const remainingLibrary = library.filter(card => !selectedIds.has(String(card?.id || card?.cardId || '').trim()));
    const shuffledLibrary = step.shuffle === false ? remainingLibrary : shuffleArray(remainingLibrary);
    recordShuffledLibrary(playerId, shuffledLibrary);
    const movedCards = selected.map((card: any) => ({
      ...card,
      zone: step.destination,
    }));
    const enteredBattlefield =
      step.destination === 'battlefield'
        ? createBattlefieldPermanentsFromCards(
            movedCards,
            playerId,
            playerId,
            Boolean(step.entersTapped),
            false,
            undefined,
            'library'
          )
        : [];

    nextState = {
      ...(nextState as any),
      players: nextState.players.map((entry: any) => {
        if (entry.id !== playerId) return entry;
        const hand = Array.isArray(entry.hand) ? [...entry.hand] : [];
        const graveyard = Array.isArray(entry.graveyard) ? [...entry.graveyard] : [];
        const exile = Array.isArray(entry.exile) ? [...entry.exile] : [];

        if (step.destination === 'hand') {
          return { ...entry, library: shuffledLibrary, hand: [...hand, ...movedCards] };
        }
        if (step.destination === 'graveyard') {
          return { ...entry, library: shuffledLibrary, graveyard: [...graveyard, ...movedCards] };
        }
        if (step.destination === 'exile') {
          return { ...entry, library: shuffledLibrary, exile: [...exile, ...movedCards] };
        }
        if (step.destination === 'battlefield') {
          return { ...entry, library: shuffledLibrary };
        }
        if (step.destination === 'top') {
          return { ...entry, library: [...movedCards, ...shuffledLibrary] };
        }
        if (step.destination === 'bottom') {
          return { ...entry, library: [...shuffledLibrary, ...movedCards] };
        }

        return { ...entry, library: shuffledLibrary, hand: [...hand, ...movedCards] };
      }),
      ...(enteredBattlefield.length > 0
        ? { battlefield: [...(nextState.battlefield || []), ...enteredBattlefield] }
        : {}),
    } as GameState;

    if (step.revealFound && selected.length > 0) {
      log.push(`${playerId} revealed ${selected.map(card => String(card?.name || 'card')).join(', ')}`);
    }
    if (selected.length > 0) {
      log.push(`${playerId} searched their library and put ${selected.length} card(s) into ${step.destination}`);
    } else {
      log.push(`${playerId} searched their library and found no card`);
    }
    if (step.shuffle !== false) {
      log.push(`${playerId} shuffled their library`);
    }
    allMovedCards.push(...movedCards);
  }

  return withDiscardLedgerFlags({
    applied: true,
    state: nextState,
    log,
    ...(allMovedCards.length > 0 ? { lastMovedCards: allMovedCards } : {}),
    ...(replayMutations.length > 0 ? { replayMutations } : {}),
  }, ledgerRecordedViaBridge);
}

export function applyExileNamedCardsFromZonesStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'exile_named_cards_from_zones' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const chosenCardName = (() => {
    if (step.nameSource === 'target_spell_name') {
      const targetSpellId = resolveOracleIrBoundTargetSpellId(ctx);
      const stack = Array.isArray((state as any).stack) ? (state as any).stack : [];
      const spell = stack.find((entry: any) => String(entry?.id || '').trim() === targetSpellId);
      return String(spell?.card?.name || spell?.name || '').trim();
    }
    if (step.nameSource === 'referenced_card_name') {
      const referenced = resolveReferencedObject(state, ctx);
      return String(referenced?.card?.name || referenced?.name || '').trim();
    }
    return String(ctx.selectorContext?.chosenCardName || '').trim();
  })();
  if (!chosenCardName) {
    return {
      applied: false,
      message: `Skipped named-card exile (requires chosen card name): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped named-card exile (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const normalizedName = chosenCardName.toLowerCase();
  const maxResults = step.maxResults === 'any_number'
    ? Number.POSITIVE_INFINITY
    : Math.max(1, Number(step.maxResults || Number.POSITIVE_INFINITY) || Number.POSITIVE_INFINITY);
  let nextState = state;
  const log: string[] = [];
  const allExiledCards: any[] = [];
  let ledgerRecordedViaBridge = false;
  const bridgeActive = usedOracleIrServerBridge(ctx);

  for (const playerId of players) {
    const player = nextState.players.find(p => p.id === playerId) as any;
    if (!player) {
      return {
        applied: false,
        message: `Skipped named-card exile (player not found): ${step.raw}`,
        reason: 'failed_to_apply',
      };
    }

    let remainingSlots = maxResults;
    const selectedByZone = new Map<string, Set<number>>();
    const selectionsByZone = new Map<string, any[]>();
    const selectedCards: any[] = [];
    for (const zone of step.zones) {
      if (remainingSlots <= 0) break;
      const cards = readPlayerZoneCards(
        nextState,
        playerId,
        player,
        zone as 'hand' | 'graveyard' | 'library',
      );
      const selectedIndexes = new Set<number>();
      const zoneSelections: any[] = [];
      for (let index = 0; index < cards.length && remainingSlots > 0; index += 1) {
        const card = cards[index] as any;
        const name = String(card?.name || card?.card?.name || '').trim().toLowerCase();
        if (name !== normalizedName) continue;
        selectedIndexes.add(index);
        const exiledCard = { ...card, zone: 'exile' };
        zoneSelections.push(card);
        selectedCards.push(exiledCard);
        remainingSlots -= 1;
      }
      if (selectedIndexes.size > 0) {
        selectedByZone.set(zone, selectedIndexes);
        selectionsByZone.set(zone, zoneSelections);
      }
    }

    if (selectedCards.length === 0) {
      log.push(`${playerId} searched graveyard, hand, and library and found no ${chosenCardName}`);
      continue;
    }

    if (bridgeActive && Number.isFinite(ctx.currentStepIndex)) {
      for (const zone of step.zones) {
        const cards = selectionsByZone.get(zone) ?? [];
        if (cards.length === 0) continue;
        const commitResult = commitCardZoneChanges({
          state: nextState,
          playerId,
          cards: cards.map((card: any) => ({ ...card, ownerId: playerId, owner: playerId })),
          sourceZone: zone as 'hand' | 'graveyard' | 'library',
          intendedDestination: 'exile',
          stepIndex: Number(ctx.currentStepIndex),
          stepKind: step.kind,
          cause: 'oracle_ir:exile_named_cards_from_zones',
          ctx,
        });
        if (commitResult.halted) {
          return withDiscardLedgerFlags({
            applied: true,
            state: nextState,
            log,
            ...(allExiledCards.length > 0 ? { lastExiledCards: allExiledCards } : {}),
          }, ledgerRecordedViaBridge);
        }
        nextState = commitResult.state;
        allExiledCards.push(...commitResult.movedCards);
        if (commitResult.ledgerRecordedViaBridge) {
          ledgerRecordedViaBridge = true;
        }
      }
      log.push(`${playerId} exiled ${selectedCards.length} card(s) named ${chosenCardName}`);
      continue;
    }

    nextState = {
      ...(nextState as any),
      players: nextState.players.map((entry: any) => {
        if (entry.id !== playerId) return entry;
        const nextEntry: any = { ...entry };
        for (const zone of step.zones) {
          const selectedIndexes = selectedByZone.get(zone) ?? new Set<number>();
          if (selectedIndexes.size === 0) continue;
          const cards = Array.isArray(entry[zone]) ? entry[zone] : [];
          nextEntry[zone] = cards.filter((_: unknown, index: number) => !selectedIndexes.has(index));
        }
        nextEntry.exile = [...(Array.isArray(entry.exile) ? entry.exile : []), ...selectedCards];
        return nextEntry;
      }),
    } as GameState;
    log.push(`${playerId} exiled ${selectedCards.length} card(s) named ${chosenCardName}`);
    allExiledCards.push(...selectedCards);
  }

  return withDiscardLedgerFlags({
    applied: true,
    state: nextState,
    log,
    ...(allExiledCards.length > 0 ? { lastExiledCards: allExiledCards } : {}),
  }, ledgerRecordedViaBridge);
}

export function applyShuffleLibraryStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'shuffle_library' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  let players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0 && step.who.kind === 'target_player') {
    const spellId = String(ctx.targetSpellId || ctx.selectorContext?.targetSpellId || '').trim();
    if (spellId) {
      const stackItem = (state.stack || []).find((item: any) => String(item?.id || '').trim() === spellId) as any;
      const spellControllerId = String(stackItem?.controller || stackItem?.owner || '').trim();
      if (spellControllerId && (state.players || []).some((player: any) => String(player?.id || '').trim() === spellControllerId)) {
        players = [spellControllerId as PlayerID];
      }
    }
    if (players.length === 0 && /that player shuffles/i.test(String(step.raw || ''))) {
      const bound = String(
        ctx.targetPlayerId || ctx.selectorContext?.targetPlayerId || ctx.targetOpponentId || 'p2'
      ).trim();
      if ((state.players || []).some((player: any) => String(player?.id || '').trim() === bound)) {
        players = [bound as PlayerID];
      }
    }
  }
  if (players.length === 0 && /that player shuffles/i.test(String(step.raw || ''))) {
    const bound = String(
      ctx.targetPlayerId || ctx.selectorContext?.targetPlayerId || ctx.targetOpponentId || 'p2'
    ).trim();
    if (bound) players = [bound as PlayerID];
  }
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped shuffle library (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  let nextState = state;
  const log: string[] = [];
  const replayMutations: OracleIRReplayMutation[] = [];

  for (const playerId of players) {
    const player = nextState.players.find(p => p.id === playerId) as any;
    if (!player) {
      log.push(`${playerId} shuffled their library (${step.raw})`);
      continue;
    }

    const library = Array.isArray(player.library) ? [...player.library] : [];
    const shuffledLibrary = shuffleArray(library);
    const shuffledLibraryIds = shuffledLibrary
      .map((card: any) => String(card?.id || '').trim())
      .filter(Boolean);
    nextState = {
      ...(nextState as any),
      players: nextState.players.map((entry: any) =>
        entry.id === playerId ? { ...entry, library: shuffledLibrary } : entry
      ),
    } as GameState;
    log.push(`${playerId} shuffled their library`);
    if (shuffledLibraryIds.length > 0) {
      replayMutations.push({
        kind: 'shuffleLibrary',
        playerId,
        shuffledLibraryIds,
      });
    }
  }

  return {
    applied: true,
    state: nextState,
    log,
    ...(replayMutations.length > 0 ? { replayMutations } : {}),
  };
}

export function applyShuffleZonesIntoLibraryStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'shuffle_zones_into_library' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped shuffle zones into library (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const zones = new Set((step.zones || []).map((zone) => String(zone || '').trim().toLowerCase()));
  let nextState = state;
  const log: string[] = [];

  for (const playerId of players) {
    const player = nextState.players.find(p => p.id === playerId) as any;
    if (!player) {
      return {
        applied: false,
        message: `Skipped shuffle zones into library (player not found): ${step.raw}`,
        reason: 'failed_to_apply',
      };
    }

    const hand = Array.isArray(player.hand) ? [...player.hand] : [];
    const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
    const library = Array.isArray(player.library) ? [...player.library] : [];
    const movingCards = [
      ...(zones.has('hand') ? hand : []),
      ...(zones.has('graveyard') ? graveyard : []),
    ];
    const nextLibrary = shuffleArray([...library, ...movingCards]);

    nextState = {
      ...(nextState as any),
      players: nextState.players.map((entry: any) => {
        if (entry.id !== playerId) return entry;
        return {
          ...entry,
          library: nextLibrary,
          ...(zones.has('hand') ? { hand: [] } : {}),
          ...(zones.has('graveyard') ? { graveyard: [] } : {}),
        };
      }),
    } as GameState;
    log.push(`${playerId} shuffled ${movingCards.length} card(s) from hand/graveyard into their library`);
  }

  return { applied: true, state: nextState, log };
}

export function applyChoosePileStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'choose_pile' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const choosers = resolvePlayers(state, step.chooser, ctx);
  if (choosers.length !== 1) {
    if (
      step.chooser.kind === 'target_opponent'
      && choosers.length === 0
      && String(step.source || '') === 'top_library'
    ) {
      const controllerId = ctx.controllerId;
      const opponents = (state.players || [])
        .map((player) => player.id)
        .filter((playerId) => playerId !== controllerId);
      if (opponents.length > 1) {
        return {
          applied: false,
          message: `Skipped choose pile (requires opponent choice): ${step.raw}`,
          reason: 'player_choice_required',
          options: {
            classification: 'player_choice',
            metadata: {
              chooser: controllerId,
              source: step.source,
              chosenDestination: step.chosenDestination || '',
              otherDestination: step.otherDestination || '',
            },
          },
        };
      }
    }

    return {
      applied: false,
      message: `Skipped choose pile (requires deterministic chooser): ${step.raw}`,
      reason: choosers.length === 0 ? 'unsupported_player_selector' : 'player_choice_required',
      options: choosers.length > 1 ? { classification: 'player_choice' } : undefined,
    };
  }

  const selectorContext: any = ctx.selectorContext || {};
  const chosenPile = String(selectorContext.chosenPile || selectorContext.pileChoice || '').trim();
  if (!chosenPile) {
    return {
      applied: false,
      message: `Skipped choose pile (requires pile choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: {
        classification: 'player_choice',
        metadata: {
          chooser: choosers[0],
          source: step.source,
          chosenDestination: step.chosenDestination || '',
          otherDestination: step.otherDestination || '',
        },
      },
    };
  }

  return {
    applied: true,
    state,
    log: [`${choosers[0]} chose pile ${chosenPile}`],
  };
}

export function applyChangeTargetStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'change_target' }>,
  ctx: OracleIRExecutionContext,
): PlayerStepHandlerResult {
  const stack = Array.isArray((state as any).stack) ? [...((state as any).stack as any[])] : [];
  const targetedSpells = stack.filter(
    (item) =>
      String((item as any)?.type || '').trim() === 'spell'
      && Array.isArray((item as any)?.targets)
      && (item as any).targets.length > 0,
  );

  if (targetedSpells.length === 0) {
    return {
      applied: true,
      state,
      log: [`No targeted spells on the stack for change target: ${step.raw}`],
    };
  }

  const chosenIds = getNormalizedChosenIds(ctx);
  let chosenSpellId = String(
    ctx.selectorContext?.chosenSpellId || ctx.targetSpellId || chosenIds[0] || '',
  ).trim();

  if (!chosenSpellId) {
    if (targetedSpells.length === 1) {
      chosenSpellId = String((targetedSpells[0] as any)?.id || '').trim();
    } else {
      return {
        applied: false,
        message: `Skipped change target (requires spell choice): ${step.raw}`,
        reason: 'player_choice_required',
        options: {
          classification: 'player_choice',
          metadata: {
            changeTargetPhase: 'choose_spell',
            candidateSpellIds: targetedSpells
              .map((item) => String((item as any)?.id || '').trim())
              .filter(Boolean),
          },
        },
      };
    }
  }

  const spellIndex = stack.findIndex((item) => String((item as any)?.id || '').trim() === chosenSpellId);
  if (spellIndex < 0) {
    return {
      applied: false,
      message: `Skipped change target (spell not found): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'invalid_input', persist: false },
    };
  }

  const spell = { ...(stack[spellIndex] as any) };
  const existingTargets = Array.isArray(spell.targets) ? [...spell.targets] : [];
  const newTargetIds = chosenIds
    .filter((id) => id !== chosenSpellId)
    .concat(
      (Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : [])
        .map((id) => String(id || '').trim())
        .filter((id) => id && id !== chosenSpellId),
    )
    .filter((id, index, array) => array.indexOf(id) === index);

  if (step.newTarget && newTargetIds.length === 0) {
    return {
      applied: false,
      message: `Skipped change target (requires new target choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: {
        classification: 'player_choice',
        metadata: {
          changeTargetPhase: 'choose_new_target',
          chosenSpellId,
          candidateTargetIds: (state.battlefield || [])
            .map((perm: any) => String(perm?.id || '').trim())
            .filter(Boolean),
        },
      },
    };
  }

  if (newTargetIds.length > 0) {
    spell.targets = newTargetIds.map((id) => {
      const existing = existingTargets.find(
        (target: any) => String(target?.id || target || '').trim() === id,
      );
      if (existing && typeof existing === 'object') {
        return { ...existing, id };
      }
      return { id, type: 'permanent' };
    });
  }

  const nextStack = [...stack];
  nextStack[spellIndex] = spell;
  return {
    applied: true,
    state: { ...(state as any), stack: nextStack } as GameState,
    log: [`Changed targets of ${chosenSpellId}${newTargetIds.length > 0 ? ` to ${newTargetIds.join(', ')}` : ''}`],
  };
}

export function applySurveilStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'surveil' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped surveil (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const amount = resolveStepAmountForPlayer(
    state,
    ctx.controllerId,
    step.amount,
    ctx,
    players[0],
    { whereX: step.whereX },
  );
  if (amount === null) {
    return {
      applied: false,
      message: `Skipped surveil (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
      options: { classification: 'ambiguous' },
    };
  }

  if (amount <= 0) {
    return {
      applied: true,
      state,
      log: [`Surveil ${amount} (no-op): ${step.raw}`],
    };
  }

  if (ctx.selectorContext?.surveilResolutionComplete === true) {
    const keepTopOrder = Array.isArray(ctx.selectorContext?.keepTopOrder)
      ? ctx.selectorContext.keepTopOrder
      : [];
    const toGraveyard = Array.isArray(ctx.selectorContext?.toGraveyard)
      ? ctx.selectorContext.toGraveyard
      : [];
    const lookedCount = keepTopOrder.length + toGraveyard.length;
    return {
      applied: true,
      state,
      log: [`Surveil ${lookedCount} (resolution applied): ${step.raw}`],
      skipLedgerFlush: true,
    };
  }

  const { cards: observedCards } = collectTopLibraryObservationForPlayers(state, players, amount);
  const observationCarryOver = observedCards.length > 0 ? { lastMovedCards: observedCards } : {};
  let ledgerRecordedViaBridge = false;
  const bridgeOptions = usedOracleIrServerBridge(ctx)
    ? { ctx, stepIndex: Number(ctx.currentStepIndex), stepKind: step.kind }
    : undefined;

  const wouldNeedChoice = players.some(playerId => {
    const player = state.players.find(p => p.id === playerId) as any;
    const libraryLength = Array.isArray(player?.library) ? player.library.length : 0;
    return libraryLength > 0;
  });

  if (wouldNeedChoice) {
    if (bridgeOptions && observedCards.length > 0 && Number.isFinite(bridgeOptions.stepIndex)) {
      const observation = commitLibraryTopObservation({
        playerId: ctx.controllerId,
        cards: observedCards,
        stepIndex: Number(bridgeOptions.stepIndex),
        stepKind: String(bridgeOptions.stepKind || 'surveil'),
        cause: 'oracle_ir:surveil',
        ctx: bridgeOptions.ctx,
      });
      if (observation.halted) {
        return withDiscardLedgerFlags({
          applied: true,
          state,
          log: [`Surveil ${amount} halted for replacement: ${step.raw}`],
        }, ledgerRecordedViaBridge);
      }
      if (observation.ledgerRecordedViaBridge) {
        ledgerRecordedViaBridge = true;
      }
    }
    return withDiscardLedgerFlags({
      applied: false,
      message: `Skipped surveil (requires player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
      ...observationCarryOver,
    }, ledgerRecordedViaBridge);
  }

  return {
    applied: true,
    state,
    log: [`Surveil ${amount} (no cards in library): ${step.raw}`],
  };
}

export function applyLookSelectTopStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'look_select_top' }>,
  ctx: OracleIRExecutionContext,
  runtime?: ModifyPtRuntime
): PlayerStepHandlerResult {
  const amount = resolveLookSelectAmount(state, step, ctx, runtime);
  const choose = quantityToNumber(step.choose, ctx);
  if (amount === null || choose === null) {
    return {
      applied: false,
      message: `Skipped look-select-top (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
      options: { classification: 'ambiguous' },
    };
  }

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped look-select-top (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  if (lookSelectTopRequiresPlayerChoice(state, step, ctx, runtime)) {
    return {
      applied: false,
      message: `Skipped look-select-top (requires player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  const chosenObjectIds = getNormalizedChosenIds(ctx);
  let nextState = state;
  const log: string[] = [];
  const chosenCards: any[] = [];
  let ledgerRecordedViaBridge = false;
  const bridgeOptions = usedOracleIrServerBridge(ctx)
    ? { ctx, stepIndex: Number(ctx.currentStepIndex), stepKind: step.kind }
    : undefined;

  for (const playerId of players) {
    const result = lookSelectTopCardsForPlayer(
      nextState,
      playerId,
      amount,
      choose,
      step.destination,
      step.restDestination,
      Boolean(step.restToTop),
      Boolean(step.restRandomOrder),
      bridgeOptions,
      chosenObjectIds,
    );
    if ((result as { halted?: boolean }).halted) {
      return withDiscardLedgerFlags({
        applied: true,
        state: nextState,
        log,
        ...(chosenCards.length > 0 ? { lastMovedCards: chosenCards } : {}),
      }, ledgerRecordedViaBridge);
    }
    nextState = result.state;
    log.push(...result.log);
    if (Array.isArray(result.chosen) && result.chosen.length > 0) {
      chosenCards.push(...result.chosen);
    }
    if ((result as { ledgerRecordedViaBridge?: boolean }).ledgerRecordedViaBridge) {
      ledgerRecordedViaBridge = true;
    }
  }

  return withDiscardLedgerFlags({
    applied: true,
    state: nextState,
    log,
    ...(chosenCards.length > 0 ? { lastMovedCards: chosenCards } : {}),
  }, ledgerRecordedViaBridge);
}

export function applyLookTopStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'look_top' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const amount = resolveOracleQuantity(state, ctx.controllerId, step.amount, ctx, {
    whereX: step.whereX,
  });
  if (amount === null) {
    return {
      applied: false,
      message: `Skipped look-top (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
      options: { classification: 'ambiguous' },
    };
  }

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped look-top (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const log: string[] = [];
  const lastMovedCards: any[] = [];
  let ledgerRecordedViaBridge = false;
  const bridgeOptions = usedOracleIrServerBridge(ctx)
    ? { ctx, stepIndex: Number(ctx.currentStepIndex), stepKind: step.kind }
    : undefined;

  for (const playerId of players) {
    const player = state.players.find(entry => entry.id === playerId) as any;
    const library = Array.isArray(player?.library) ? player.library : [];
    const looked = Math.max(0, Math.min(library.length, amount | 0));
    if (looked > 0) {
      lastMovedCards.push(...library.slice(0, looked));
    }
    log.push(`${playerId} looks at the top ${looked} card(s) of their library`);
  }

  if (bridgeOptions && lastMovedCards.length > 0 && Number.isFinite(bridgeOptions.stepIndex)) {
    const observation = commitLibraryTopObservation({
      playerId: ctx.controllerId,
      cards: lastMovedCards,
      stepIndex: Number(bridgeOptions.stepIndex),
      stepKind: String(bridgeOptions.stepKind || 'look_top'),
      cause: 'oracle_ir:look_top',
      ctx: bridgeOptions.ctx,
    });
    if (observation.halted) {
      return withDiscardLedgerFlags({
        applied: true,
        state,
        log,
        ...(players.length === 1 ? { lastTopLibraryOwnerId: players[0] } : {}),
      }, ledgerRecordedViaBridge);
    }
    if (observation.ledgerRecordedViaBridge) {
      ledgerRecordedViaBridge = true;
    }
  }

  return withDiscardLedgerFlags({
    applied: true,
    state,
    log,
    ...(players.length === 1 ? { lastTopLibraryOwnerId: players[0] } : {}),
    ...(lastMovedCards.length > 0 ? { lastMovedCards } : {}),
  }, ledgerRecordedViaBridge);
}

export function applyRevealTopStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'reveal_top' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped reveal-top (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const log: string[] = [];
  let totalRevealed = 0;
  const revealedCards: any[] = [];
  let ledgerRecordedViaBridge = false;
  const bridgeOptions = usedOracleIrServerBridge(ctx)
    ? { ctx, stepIndex: Number(ctx.currentStepIndex), stepKind: step.kind }
    : undefined;

  const isThatManyOrMuchReference =
    step.amount.kind === 'reference_amount' &&
    /^that\s+(?:many|much)$/i.test(String(step.amount.raw || '').trim());

  for (const playerId of players) {
    const untilReveal = resolveRevealUntilReferenceAmountForPlayer(state, playerId, step.amount, ctx);
    if (untilReveal) {
      totalRevealed += untilReveal.count;
      revealedCards.push(
        ...untilReveal.cards.map((card: any) => ({
          ...card,
          owner: card?.owner ?? playerId,
          ownerId: card?.ownerId ?? playerId,
        }))
      );
      const revealedNames = untilReveal.cards
        .map((card: any) => String(card?.name || 'unknown card').trim() || 'unknown card');
      log.push(
        revealedNames.length > 0
          ? `${playerId} reveals ${revealedNames.join(', ')}`
          : `${playerId} reveals no cards from the top of their library`
      );
      continue;
    }

    const perPlayerAmount = isThatManyOrMuchReference
      ? (ctx as any)?.lastMovedCountByPlayer?.[playerId]
      : undefined;
    const amount =
      typeof perPlayerAmount === 'number' && Number.isFinite(perPlayerAmount)
        ? perPlayerAmount
        : resolveOracleQuantity(state, ctx.controllerId, step.amount, ctx, {
            whereX: step.whereX,
          });
    if (amount === null) {
      return {
        applied: false,
        message: `Skipped reveal-top (unknown amount): ${step.raw}`,
        reason: 'unknown_amount',
        options: { classification: 'ambiguous' },
      };
    }

    const player = state.players.find(entry => entry.id === playerId) as any;
    const library = Array.isArray(player?.library) ? player.library : [];
    const revealedCount = Math.max(0, Math.min(library.length, amount | 0));
    totalRevealed += revealedCount;
    if (revealedCount > 0) {
      revealedCards.push(
        ...library.slice(0, revealedCount).map((card: any) => ({
          ...card,
          owner: card?.owner ?? playerId,
          ownerId: card?.ownerId ?? playerId,
        }))
      );
    }
    const revealedNames = library
      .slice(0, revealedCount)
      .map((card: any) => String(card?.name || 'unknown card').trim() || 'unknown card');
    log.push(
      revealedCount > 0
        ? `${playerId} reveals ${revealedNames.join(', ')}`
        : `${playerId} reveals no cards from the top of their library`
    );
  }

  if (bridgeOptions && revealedCards.length > 0 && Number.isFinite(bridgeOptions.stepIndex)) {
    for (const playerId of players) {
      const playerRevealed = revealedCards.filter((card: any) => {
        const ownerId = String(card?.owner || card?.ownerId || playerId).trim();
        return ownerId === playerId;
      });
      if (playerRevealed.length === 0 && players.length === 1) {
        playerRevealed.push(...revealedCards);
      }
      if (playerRevealed.length === 0) continue;
      const observation = commitLibraryTopObservation({
        playerId,
        cards: playerRevealed,
        stepIndex: Number(bridgeOptions.stepIndex),
        stepKind: String(bridgeOptions.stepKind || 'reveal_top'),
        cause: 'oracle_ir:reveal_top',
        ctx: bridgeOptions.ctx,
      });
      if (observation.halted) {
        return withDiscardLedgerFlags({
          applied: true,
          state,
          log,
          lastRevealedCardCount: totalRevealed,
          ...(players.length === 1 ? { lastTopLibraryOwnerId: players[0] } : {}),
        }, ledgerRecordedViaBridge);
      }
      if (observation.ledgerRecordedViaBridge) {
        ledgerRecordedViaBridge = true;
      }
    }
  }

  return withDiscardLedgerFlags({
    applied: true,
    state,
    log,
    lastRevealedCardCount: totalRevealed,
    ...(revealedCards.length > 0 ? { lastMovedCards: revealedCards, lastRevealedCards: revealedCards } : {}),
    ...(players.length === 1 ? { lastTopLibraryOwnerId: players[0] } : {}),
  }, ledgerRecordedViaBridge);
}

function resolveLookChooseAmount(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'look_choose_from_top' }>,
  ctx: OracleIRExecutionContext,
  runtime?: ModifyPtRuntime
): number | null {
  if (step.amount.kind === 'reference_amount') {
    const players = resolvePlayers(state, step.who, ctx);
    if (players.length !== 1) return null;
    const untilReveal = resolveRevealUntilReferenceAmountForPlayer(
      state,
      players[0],
      step.amount,
      ctx,
    );
    return untilReveal?.count ?? null;
  }

  const resolved = resolveOracleQuantity(state, ctx.controllerId, step.amount, ctx, { runtime });
  if (resolved !== null) return resolved;

  if (step.amount.kind !== 'x') return null;

  const raw = String(step.raw || '').trim();
  const whereMatch = raw.match(/\bwhere\s+x\s+is\s+(.+?)(?:\.\s|$)/i);
  if (!whereMatch) return null;

  const evaluated = evaluateModifyPtWhereX(
    state,
    ctx.controllerId,
    `X is ${String(whereMatch[1] || '').trim()}`,
    undefined,
    ctx,
    runtime
  );
  return evaluated === null ? null : Math.max(0, evaluated);
}

export function applyLookChooseFromTopStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'look_choose_from_top' }>,
  ctx: OracleIRExecutionContext,
  runtime?: ModifyPtRuntime
): PlayerStepHandlerResult {
  const amount = resolveLookChooseAmount(state, step, ctx, runtime);
  if (amount === null) {
    return {
      applied: false,
      message: `Skipped look-choose-from-top (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
      options: { classification: 'ambiguous' },
    };
  }

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped look-choose-from-top (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  if (lookChooseFromTopRequiresPlayerChoice(state, step, ctx, runtime)) {
    return {
      applied: false,
      message: `Skipped look-choose-from-top (requires player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  const chosenIds = new Set(getNormalizedChosenIds(ctx));
  let nextState = state;
  const log: string[] = [];
  const movedCards: any[] = [];
  let ledgerRecordedViaBridge = false;
  const bridgeOptions = usedOracleIrServerBridge(ctx)
    ? { ctx, stepIndex: Number(ctx.currentStepIndex), stepKind: step.kind }
    : undefined;

  for (const playerId of players) {
    const player = nextState.players.find(entry => entry.id === playerId) as any;
    if (!player) {
      return {
        applied: false,
        message: `Skipped look-choose-from-top (player not found): ${step.raw}`,
        reason: 'failed_to_apply',
      };
    }

    const library = readPlayerZoneCards(nextState, playerId, player, 'library');
    const lookedCount = Math.max(0, Math.min(library.length, amount | 0));
    let lookedCards = library.slice(0, lookedCount);
    const chosenCards: any[] = [];
    const chosenCreatureType = String(ctx.selectorContext?.chosenCreatureType || '').trim();
    const manaValueLimit = resolveLookChooseManaValueLimit(nextState, playerId, step.selectorText);
    const nonMatchRest = (step as { nonMatchRest?: string }).nonMatchRest || 'library_bottom';

    if (chosenIds.size > 0) {
      for (const card of lookedCards) {
        const cardId = String(card?.id || '').trim();
        if (!cardId || !chosenIds.has(cardId)) continue;
        if (!cardMatchesLookChooseSelector(card, step.selectorText, manaValueLimit, chosenCreatureType)) continue;
        chosenCards.push(card);
      }
      const chosenCardIds = new Set(chosenCards.map(card => String(card?.id || '').trim()).filter(Boolean));
      lookedCards = lookedCards.filter(card => !chosenCardIds.has(String(card?.id || '').trim()));
    } else if (step.optional !== true || ctx.deferOptionalLookChoices !== true) {
      const chosenIndex = lookedCards.findIndex(
        card => cardMatchesLookChooseSelector(card, step.selectorText, manaValueLimit, chosenCreatureType),
      );
      if (chosenIndex >= 0) {
        chosenCards.push(lookedCards.splice(chosenIndex, 1)[0]);
      }
    }

    const restCards = [...lookedCards];

    if (
      chosenCards.length === 0
      && restCards.length > 0
      && nonMatchRest === 'library_top'
    ) {
      log.push(`${playerId} looks at ${lookedCount} card(s) and keeps them on top of their library`);
      continue;
    }
    const bottomedRest = step.restOrder === 'any' ? restCards : shuffleArray(restCards);
    const stepIndex = bridgeOptions?.stepIndex;
    const canBridgeZone = (step.destination === 'hand' || step.destination === 'exile' || step.destination === 'battlefield')
      && bridgeOptions?.ctx?.serverBridge
      && Number.isFinite(stepIndex);
    const canBridgeChosen = canBridgeZone && chosenCards.length > 0;

    const bridgeLookChooseRest = (): boolean => {
      if (!canBridgeZone || restCards.length === 0) return false;
      const restCommit = commitLookSelectRestZoneChanges({
        state: nextState,
        playerId,
        rest: restCards,
        destination: step.destination === 'exile' ? 'exile' : 'hand',
        restDestination: 'library',
        restLibraryPlacement: 'bottom',
        restRandomOrder: step.restOrder !== 'any',
        stepIndex: Number(stepIndex),
        stepKind: String(bridgeOptions?.stepKind || 'look_choose_from_top'),
        cause: 'oracle_ir:look_choose_from_top_rest',
        ctx: bridgeOptions?.ctx,
      });
      if (restCommit.halted) return true;
      nextState = restCommit.state;
      if (restCommit.ledgerRecordedViaBridge) {
        ledgerRecordedViaBridge = true;
      }
      return false;
    };

    const bridgeNonMatchGraveyard = (): boolean => {
      if (!canBridgeZone || restCards.length === 0 || nonMatchRest !== 'graveyard') return false;
      const restCommit = commitLookSelectRestZoneChanges({
        state: nextState,
        playerId,
        rest: restCards,
        destination: step.destination === 'exile' ? 'exile' : 'hand',
        restDestination: 'graveyard',
        restToTop: false,
        restRandomOrder: false,
        stepIndex: Number(stepIndex),
        stepKind: String(bridgeOptions?.stepKind || 'look_choose_from_top'),
        cause: 'oracle_ir:look_choose_from_top_non_match',
        ctx: bridgeOptions?.ctx,
      });
      if (restCommit.halted) return true;
      nextState = restCommit.state;
      movedCards.push(...restCards);
      if (restCommit.ledgerRecordedViaBridge) {
        ledgerRecordedViaBridge = true;
      }
      log.push(`${playerId} looks at ${lookedCount} card(s), finds no match, and puts ${restCards.length} into their graveyard`);
      return true;
    };

    if (canBridgeChosen) {
      const commitResult = commitCardZoneChanges({
        state: nextState,
        playerId,
        cards: chosenCards.map((card: any) => ({ ...card, ownerId: playerId, owner: playerId })),
        sourceZone: 'library',
        intendedDestination: step.destination === 'hand'
          ? 'hand'
          : step.destination === 'exile'
            ? 'exile'
            : 'battlefield',
        stepIndex: Number(stepIndex),
        stepKind: String(bridgeOptions?.stepKind || 'look_choose_from_top'),
        cause: 'oracle_ir:look_choose_from_top',
        ctx: bridgeOptions?.ctx,
      });
      if (commitResult.halted) {
        return withDiscardLedgerFlags({
          applied: true,
          state: nextState,
          log,
          ...(movedCards.length > 0 ? { lastMovedCards: movedCards } : {}),
        }, ledgerRecordedViaBridge);
      }

      nextState = commitResult.state;
      movedCards.push(...commitResult.movedCards);
      if (commitResult.ledgerRecordedViaBridge) {
        ledgerRecordedViaBridge = true;
      }

      if (bridgeLookChooseRest()) {
        return withDiscardLedgerFlags({
          applied: true,
          state: nextState,
          log,
          ...(movedCards.length > 0 ? { lastMovedCards: movedCards } : {}),
        }, ledgerRecordedViaBridge);
      }

      const actionText = commitResult.movedCards.length > 0
        ? `${step.destination === 'hand' ? `puts ${commitResult.movedCards.length} matching card(s) into their hand` : `exiles ${commitResult.movedCards.length} matching card(s)`}`
        : 'does not find a matching card';
      log.push(
        `${playerId} looks at ${lookedCount} card(s), ${actionText}, and puts ${bottomedRest.length} on the bottom of their library in ${step.restOrder === 'any' ? 'any' : 'a random'} order`
      );
      continue;
    }

    if (canBridgeZone && chosenCards.length === 0 && restCards.length > 0) {
      if (bridgeNonMatchGraveyard()) {
        return withDiscardLedgerFlags({
          applied: true,
          state: nextState,
          log,
          ...(movedCards.length > 0 ? { lastMovedCards: movedCards } : {}),
        }, ledgerRecordedViaBridge);
      }
      if (bridgeLookChooseRest()) {
        return withDiscardLedgerFlags({
          applied: true,
          state: nextState,
          log,
        }, ledgerRecordedViaBridge);
      }

      log.push(
        `${playerId} looks at ${lookedCount} card(s), does not find a matching card, and puts ${bottomedRest.length} on the bottom of their library in ${step.restOrder === 'any' ? 'any' : 'a random'} order`
      );
      continue;
    }

    const hand = readPlayerZoneCards(nextState, playerId, player, 'hand');
    const exile = readPlayerZoneCards(nextState, playerId, player, 'exile');
    const graveyard = readPlayerZoneCards(nextState, playerId, player, 'graveyard');
    let nextHand = [...hand];
    let nextExile = [...exile];
    let nextGraveyard = [...graveyard];
    let nextLibrary = library.slice(lookedCount);

    for (const chosenCard of chosenCards) {
      movedCards.push(chosenCard);
      if (step.destination === 'hand') {
        nextHand.push(chosenCard);
      } else {
        nextExile.push(chosenCard);
      }
    }

    if (restCards.length > 0 && nonMatchRest === 'graveyard' && chosenCards.length === 0) {
      nextGraveyard.push(...restCards);
      movedCards.push(...restCards);
      writePlayerZoneCards(nextState, playerId, player, 'graveyard', nextGraveyard);
      log.push(`${playerId} looks at ${lookedCount} card(s), finds no match, and puts ${restCards.length} into their graveyard`);
      continue;
    }

    nextLibrary = [...nextLibrary, ...bottomedRest];
    writePlayerZoneCards(nextState, playerId, player, 'library', nextLibrary);
    writePlayerZoneCards(nextState, playerId, player, 'hand', nextHand);
    writePlayerZoneCards(nextState, playerId, player, 'exile', nextExile);

    const actionText = chosenCards.length > 0
      ? `${step.destination === 'hand' ? `puts ${chosenCards.length} matching card(s) into their hand` : `exiles ${chosenCards.length} matching card(s)`}`
      : 'does not find a matching card';
    log.push(
      `${playerId} looks at ${lookedCount} card(s), ${actionText}, and puts ${bottomedRest.length} on the bottom of their library in ${step.restOrder === 'any' ? 'any' : 'a random'} order`
    );
  }

  return withDiscardLedgerFlags({
    applied: true,
    state: nextState,
    log,
    ...(movedCards.length > 0 ? { lastMovedCards: movedCards } : {}),
  }, ledgerRecordedViaBridge);
}

export function applyPutOnBottomStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'put_on_bottom' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped put-on-bottom (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const whatText = step.what.kind === 'raw' ? String(step.what.text || '').trim().toLowerCase() : '';
  let nextState = state;
  const log: string[] = [];

  for (const playerId of players) {
    const player = nextState.players.find(entry => entry.id === playerId) as any;
    if (!player) {
      return {
        applied: false,
        message: `Skipped put-on-bottom (player not found): ${step.raw}`,
        reason: 'failed_to_apply',
      };
    }

    const library = Array.isArray(player.library) ? [...player.library] : [];
    const handIds = new Set(
      (Array.isArray(player.hand) ? player.hand : [])
        .map((card: any) => String(card?.id || '').trim())
        .filter(Boolean)
    );
    let restCards: any[] = [];

    if (whatText === 'the rest' || whatText === 'the rest of the cards') {
      const movedCards = Array.isArray(ctx.lastMovedCards) ? ctx.lastMovedCards : [];
      const movedIds = new Set(movedCards.map((card: any) => String(card?.id || '').trim()).filter(Boolean));
      if (movedIds.size > 0) {
        restCards = library.filter((card: any) => {
          const cardId = String(card?.id || '').trim();
          return movedIds.has(cardId) && !handIds.has(cardId);
        });
      } else {
        restCards = library.slice(0, Math.max(0, library.length - handIds.size));
      }
    } else {
      return {
        applied: false,
        message: `Skipped put-on-bottom (unsupported object selector): ${step.raw}`,
        reason: 'unsupported_object_selector',
      };
    }

    const remainingLibrary = library.filter((card: any) => !restCards.includes(card));
    const orderedRest = step.order === 'random' ? shuffleArray(restCards) : restCards;
    const updatedPlayers = nextState.players.map(entry => {
      if (entry.id !== playerId) return entry;
      return {
        ...(entry as any),
        library: [...remainingLibrary, ...orderedRest],
      } as any;
    });
    nextState = { ...nextState, players: updatedPlayers as any };
    log.push(`${playerId} put ${orderedRest.length} card(s) on the bottom of their library`);
  }

  return {
    applied: true,
    state: nextState,
    log,
  };
}

export function applyMillStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'mill' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  let players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0 && (/that player mills/i.test(String(step.raw || '')) || step.who?.kind === 'target_player')) {
    const boundPlayerId = String(
      ctx.targetPlayerId ||
        ctx.selectorContext?.targetPlayerId ||
        ctx.selectorContext?.targetOpponentId ||
        ''
    ).trim() as PlayerID;
    if (boundPlayerId && (state.players || []).some((player: any) => String(player?.id || '').trim() === boundPlayerId)) {
      players = [boundPlayerId];
    }
  }
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped mill (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const millCountByPlayer = new Map<PlayerID, number>();
  for (const playerId of players) {
    const millStep = step as Extract<OracleEffectStep, { kind: 'mill' }>;
    const ctxForPlayer: OracleIRExecutionContext = {
      ...ctx,
      selectorContext: {
        ...(ctx.selectorContext || {}),
        targetPlayerId: playerId,
      },
    };
    const resolvedCount =
      resolveOracleQuantity(state, ctx.controllerId, millStep.amount, ctxForPlayer, {
        whereX: millStep.whereX,
      }) ??
      resolveUnknownMillUntilAmountForPlayer(state, playerId, step.amount);
    if (resolvedCount === null) {
      return {
        applied: false,
        message: `Skipped mill (unknown amount): ${step.raw}`,
        reason: 'unknown_amount',
        options: { classification: 'ambiguous' },
      };
    }
    millCountByPlayer.set(playerId, resolvedCount);
  }

  let nextState = state;
  const log: string[] = [];
  const lastMilledCards: any[] = [];
  const bridgeOptions = buildPlayerZoneBridgeOptions(ctx, 'mill');
  let ledgerRecordedViaBridge = false;
  for (const playerId of players) {
    const amount = millCountByPlayer.get(playerId) ?? 0;
    const result = millCardsForPlayer(nextState, playerId, amount, bridgeOptions);
    if (result.halted) {
      return withDiscardLedgerFlags({
        applied: true,
        state: nextState,
        log,
      });
    }
    nextState = result.state;
    log.push(...result.log);
    if (result.ledgerRecordedViaBridge) ledgerRecordedViaBridge = true;
    nextState = result.state;
    log.push(...result.log);
    if (Array.isArray(result.milledCards) && result.milledCards.length > 0) {
      lastMilledCards.push(...result.milledCards);
    }
  }

  const unknownRaw = String((step.amount as any)?.raw || '').toLowerCase();
  const isRevealThisWay =
    step.amount.kind === 'reveal_until_land' ||
    (step.amount.kind === 'unknown' && unknownRaw.includes('reveal a land card'));
  const lastRevealedCardCount = isRevealThisWay
    ? Array.from(millCountByPlayer.values()).reduce((sum, count) => sum + (Number(count) || 0), 0)
    : undefined;
  const replayMutations: OracleIRReplayMutation[] = Array.from(millCountByPlayer.entries())
    .filter(([, count]) => Number(count) > 0)
    .map(([playerId, count]) => ({ kind: 'mill', playerId, count: Number(count) }));

  return withDiscardLedgerFlags({
    applied: true,
    state: nextState,
    log,
    lastRevealedCardCount,
    ...(lastMilledCards.length > 0 ? { lastMilledCards } : {}),
    ...(replayMutations.length > 0 ? { replayMutations } : {}),
  }, ledgerRecordedViaBridge);
}

export function discardSelectorRequiresPlayerChoice(
  step: Extract<OracleEffectStep, { kind: 'discard' }>,
): boolean {
  if ((step.amount as any)?.kind === 'any_number') return true;
  if (step.target) return true;

  const amountRaw = String((step.amount as any)?.raw || '').trim().toLowerCase();
  if (
    (step.amount as any)?.kind === 'reference_amount' &&
    /card with that name/.test(amountRaw)
  ) {
    return true;
  }

  const staticAmount = quantityToNumber(step.amount);
  return staticAmount === null || staticAmount > 0;
}

function handCardMatchesDiscardTarget(card: any, target: OracleObjectSelector | undefined): boolean {
  if (!target) return true;
  const text = String((target as any)?.text || (target as any)?.raw || '').trim();
  if (!text) return true;
  const normalized = text
    .replace(/^any number of\s+/i, '')
    .replace(/\s+cards?$/i, '')
    .trim();
  if (!normalized) return true;
  return cardMatchesLookChooseSelector(card, normalized);
}

export function buildDiscardSelectionOptionsForPlayer(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'discard' }>,
  ctx: OracleIRExecutionContext,
  playerId: PlayerID,
): {
  readonly playerId: PlayerID;
  readonly options: readonly { id: string; label: string; description?: string; imageUrl?: string }[];
  readonly discardCount: number;
  readonly minDiscardCount?: number;
  readonly maxDiscardCount?: number;
  readonly anyNumberDiscard?: boolean;
  readonly currentHandSize: number;
  readonly maxHandSize: number;
} | null {
  const player = state.players.find((candidate) => candidate.id === playerId) as any;
  const hand = Array.isArray(player?.hand) ? player.hand : [];
  if (hand.length === 0) return null;

  const eligibleHand = step.target
    ? hand.filter((card: any) => handCardMatchesDiscardTarget(card, step.target))
    : hand;

  const options = eligibleHand
    .map((card: any) => {
      const id = String(card?.id || card?.card?.id || '').trim();
      if (!id) return null;
      const name = String(card?.name || card?.card?.name || 'Unknown').trim() || 'Unknown';
      return {
        id,
        label: name,
        description: name,
        imageUrl: card?.imageUrl || card?.image_url || card?.image_uris?.normal || card?.card?.image_uris?.normal,
      };
    })
    .filter((option): option is NonNullable<typeof option> => Boolean(option));

  if ((step.amount as any)?.kind === 'any_number') {
    if (options.length === 0) return null;
    return {
      playerId,
      options,
      discardCount: 0,
      minDiscardCount: 0,
      maxDiscardCount: options.length,
      anyNumberDiscard: true,
      currentHandSize: hand.length,
      maxHandSize: 0,
    };
  }

  if (options.length === 0) return null;

  const amount = resolveStepAmountForPlayer(
    state,
    ctx.controllerId,
    step.amount,
    ctx,
    playerId,
    { whereX: step.whereX },
  );
  if (amount === null || amount <= 0) return null;

  const discardCount = Math.min(Math.max(0, amount | 0), options.length);
  if (options.length <= discardCount) return null;

  return {
    playerId,
    options,
    discardCount,
    currentHandSize: options.length,
    maxHandSize: Math.max(0, options.length - discardCount),
  };
}

export function collectDiscardSelectionOptionsForStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'discard' }>,
  ctx: OracleIRExecutionContext,
): Array<NonNullable<ReturnType<typeof buildDiscardSelectionOptionsForPlayer>>> {
  const players = resolvePlayers(state, step.who, ctx);
  return players
    .map((playerId) => buildDiscardSelectionOptionsForPlayer(state, step, ctx, playerId))
    .filter((built): built is NonNullable<typeof built> => Boolean(built));
}

export function buildDiscardSelectionOptions(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'discard' }>,
  ctx: OracleIRExecutionContext,
): {
  readonly playerId: PlayerID;
  readonly options: readonly { id: string; label: string; description?: string; imageUrl?: string }[];
  readonly discardCount: number;
  readonly minDiscardCount?: number;
  readonly maxDiscardCount?: number;
  readonly anyNumberDiscard?: boolean;
  readonly currentHandSize: number;
  readonly maxHandSize: number;
} | null {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length !== 1) return null;

  return buildDiscardSelectionOptionsForPlayer(state, step, ctx, players[0]);
}

export function applyDiscardStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'discard' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const bridgeOptions = buildPlayerZoneBridgeOptions(ctx, 'discard');
  const unlessCondition = step.unlessCondition;
  if (unlessCondition) {
    const unlessResult = evaluateOracleStepUnlessCondition(unlessCondition, state, ctx);
    if (unlessResult === true) {
      return {
        applied: true,
        state,
        log: [`Skipped discard (${unlessCondition.raw}): ${step.raw}`],
        lastDiscardedCardCount: 0,
        lastDiscardedCards: [],
      };
    }
    if (unlessResult === null) {
      return {
        applied: false,
        message: `Skipped discard (unsupported unless condition): ${step.raw}`,
        reason: 'unsupported_condition_clause',
      };
    }
  }

  if ((step.amount as any)?.kind === 'any_number') {
    const players = resolvePlayers(state, step.who, ctx);
    if (players.length === 0) {
      return {
        applied: false,
        message: `Skipped discard (unsupported player selector): ${step.raw}`,
        reason: 'unsupported_player_selector',
      };
    }

    const chosenIds = getNormalizedChosenIds(ctx);
    if (chosenIds.length === 0) {
      if (ctx.interactivePlayerChoices) {
        const built = buildDiscardSelectionOptions(state, step, ctx);
        if (!built || built.options.length === 0) {
          return {
            applied: true,
            state,
            log: [`${players[0]} discards 0 card(s): ${step.raw}`],
            lastDiscardedCardCount: 0,
            lastDiscardedCards: [],
          };
        }
      }
      return {
        applied: false,
        message: `Skipped discard (requires any-number card choice): ${step.raw}`,
        reason: 'player_choice_required',
        options: {
          classification: 'player_choice',
          metadata: { minCards: 0, maxCards: Math.max(...players.map((playerId) => {
            const player = state.players.find(p => p.id === playerId) as any;
            return Array.isArray(player?.hand) ? player.hand.length : 0;
          }), 0) },
        },
      };
    }

    if (players.length !== 1) {
      return {
        applied: false,
        message: `Skipped discard (requires deterministic player binding): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }

    const validIds = new Set(
      (Array.isArray((state.players.find(p => p.id === players[0]) as any)?.hand)
        ? (state.players.find(p => p.id === players[0]) as any).hand
        : [])
        .filter((card: any) => handCardMatchesDiscardTarget(card, step.target))
        .map((card: any) => String(card?.id || '').trim())
        .filter(Boolean)
    );
    const filteredChosenIds = chosenIds.filter(id => validIds.has(id));

    const result = discardSpecificCardsForPlayer(state, players[0], filteredChosenIds, bridgeOptions);
    if (!result.applied) {
      return {
        applied: false,
        message: `Skipped discard (chosen card unavailable): ${step.raw}`,
        reason: 'failed_to_apply',
        options: { persist: false },
      };
    }
    if (result.halted) {
      return withDiscardLedgerFlags({
        applied: true,
        state,
        log: [],
        lastDiscardedCardCount: 0,
        lastDiscardedCards: [],
      });
    }

    return withDiscardLedgerFlags({
      applied: true,
      state: result.state,
      log: result.log,
      lastDiscardedCardCount: result.discardedCount,
      lastGreatestDiscardedCardCount: result.discardedCount,
      lastDiscardedCards: result.discardedCards,
      lastMovedCards: result.discardedCards,
    }, result.ledgerRecordedViaBridge);
  }

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped discard (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  if (
    step.amount.kind === 'all' &&
    /each discard their hands/i.test(String(step.raw || ''))
  ) {
    let nextState = state;
    const log: string[] = [];
    let totalDiscarded = 0;
    const allDiscarded: any[] = [];
    let ledgerRecordedViaBridge = false;
    for (const playerId of players) {
      const player = nextState.players.find((entry) => entry.id === playerId) as any;
      const hand = Array.isArray(player?.hand) ? [...player.hand] : [];
      if (hand.length === 0) continue;
      const result = discardSpecificCardsForPlayer(
        nextState,
        playerId,
        hand.map((card: any) => String(card?.id || '').trim()).filter(Boolean),
        bridgeOptions
      );
      if (!result.applied) {
        return {
          applied: false,
          message: `Skipped discard (failed to apply): ${step.raw}`,
          reason: 'failed_to_apply',
        };
      }
      nextState = result.state;
      log.push(...result.log);
      totalDiscarded += result.discardedCount;
      allDiscarded.push(...result.discardedCards);
      if (result.ledgerRecordedViaBridge) ledgerRecordedViaBridge = true;
    }
    return withDiscardLedgerFlags(
      {
        applied: true,
        state: nextState,
        log,
        lastDiscardedCardCount: totalDiscarded,
        lastDiscardedCards: allDiscarded,
        lastMovedCards: allDiscarded,
      },
      ledgerRecordedViaBridge
    );
  }

  if (/discard your hand/i.test(String(step.raw || ''))) {
    let nextState = state;
    const log: string[] = [];
    let totalDiscarded = 0;
    const allDiscarded: any[] = [];
    let ledgerRecordedViaBridge = false;
    for (const playerId of players) {
      const player = nextState.players.find((entry) => entry.id === playerId) as any;
      const hand = Array.isArray(player?.hand) ? [...player.hand] : [];
      if (hand.length === 0) continue;
      const result = discardSpecificCardsForPlayer(
        nextState,
        playerId,
        hand.map((card: any) => String(card?.id || '').trim()).filter(Boolean),
        bridgeOptions
      );
      if (!result.applied) {
        return {
          applied: false,
          message: `Skipped discard (failed to apply): ${step.raw}`,
          reason: 'failed_to_apply',
        };
      }
      nextState = result.state;
      log.push(...result.log);
      totalDiscarded += result.discardedCount;
      allDiscarded.push(...result.discardedCards);
      if (result.ledgerRecordedViaBridge) ledgerRecordedViaBridge = true;
    }
    return withDiscardLedgerFlags(
      {
        applied: true,
        state: nextState,
        log,
        lastDiscardedCardCount: totalDiscarded,
        lastDiscardedCards: allDiscarded,
        lastMovedCards: allDiscarded,
      },
      ledgerRecordedViaBridge
    );
  }

  const amount = resolveStepAmountForPlayer(
    state,
    ctx.controllerId,
    step.amount,
    ctx,
    players[0],
    { whereX: step.whereX },
  );
  if (amount === null) {
    return {
      applied: false,
      message: `Skipped discard (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
      options: { classification: 'ambiguous' },
    };
  }

  const amountRaw = String((step.amount as any)?.raw || '').trim().toLowerCase();
  if (
    (step.amount as any)?.kind === 'reference_amount' &&
    /card with that name/.test(amountRaw)
  ) {
    if (players.length !== 1) {
      return {
        applied: false,
        message: `Skipped discard (requires deterministic player binding): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }

    const chosenName = String(ctx.selectorContext?.chosenCardName || '').trim().toLowerCase();
    if (!chosenName) {
      return {
        applied: false,
        message: `Skipped discard (requires chosen card name): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }

    const player = state.players.find((p) => p.id === players[0]) as any;
    const hand = Array.isArray(player?.hand) ? player.hand : [];
    const nameMatches = hand.filter(
      (card: any) => String(card?.name || card?.card?.name || '').trim().toLowerCase() === chosenName
    );
    if (nameMatches.length === 0) {
      return {
        applied: false,
        message: `Skipped discard (no card with chosen name in hand): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    if (nameMatches.length === 1) {
      const result = discardSpecificCardsForPlayer(state, players[0], [
        String(nameMatches[0]?.id || '').trim(),
      ].filter(Boolean), bridgeOptions);
      if (!result.applied) {
        return {
          applied: false,
          message: `Skipped discard (chosen card unavailable): ${step.raw}`,
          reason: 'failed_to_apply',
          options: { persist: false },
        };
      }
      if (result.halted) {
        return withDiscardLedgerFlags({
          applied: true,
          state,
          log: [],
          lastDiscardedCardCount: 0,
          lastDiscardedCards: [],
        });
      }
      return withDiscardLedgerFlags({
        applied: true,
        state: result.state,
        log: result.log,
        lastDiscardedCardCount: result.discardedCount,
        lastGreatestDiscardedCardCount: result.discardedCount,
        lastDiscardedCards: result.discardedCards,
        lastMovedCards: result.discardedCards,
      }, result.ledgerRecordedViaBridge);
    }

    return {
      applied: false,
      message: `Skipped discard (requires chosen card binding): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  if (step.target) {
    if (players.length !== 1) {
      return {
        applied: false,
        message: `Skipped discard (requires deterministic player binding): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }

    let chosenIds = getNormalizedChosenIds(ctx);
    chosenIds = filterChosenHandCardIds(state, players[0], chosenIds);
    const targetText = String((step.target as any)?.text || '').trim().toLowerCase();
    if (
      chosenIds.length !== Math.max(0, amount | 0) &&
      /^(?:that card|it)$/.test(targetText)
    ) {
      const chosenName = String(ctx.selectorContext?.chosenCardName || '').trim().toLowerCase();
      if (chosenName) {
        const player = state.players.find((p) => p.id === players[0]) as any;
        const hand = Array.isArray(player?.hand) ? player.hand : [];
        const nameMatches = hand.filter(
          (card: any) => String(card?.name || card?.card?.name || '').trim().toLowerCase() === chosenName
        );
        if (nameMatches.length === 1) {
          chosenIds = [String(nameMatches[0]?.id || '').trim()].filter(Boolean);
        }
      }
    }
    if (chosenIds.length !== Math.max(0, amount | 0)) {
      return {
        applied: false,
        message: `Skipped discard (requires chosen card binding): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }

    const result = discardSpecificCardsForPlayer(state, players[0], chosenIds, bridgeOptions);
    if (!result.applied) {
      return {
        applied: false,
        message: `Skipped discard (chosen card unavailable): ${step.raw}`,
        reason: 'failed_to_apply',
        options: {
          persist: false,
          metadata: {
            missingCardIds: [...result.missingCardIds],
          },
        },
      };
    }
    if (result.halted) {
      return withDiscardLedgerFlags({
        applied: true,
        state,
        log: [],
        lastDiscardedCardCount: 0,
        lastDiscardedCards: [],
      });
    }

    return withDiscardLedgerFlags({
      applied: true,
      state: result.state,
      log: result.log,
      lastDiscardedCardCount: result.discardedCount,
      lastGreatestDiscardedCardCount: result.discardedCount,
      lastDiscardedCards: result.discardedCards,
      lastMovedCards: result.discardedCards,
    }, result.ledgerRecordedViaBridge);
  }

  let chosenIds = getNormalizedChosenIds(ctx);
  if (players.length === 1) {
    chosenIds = filterChosenHandCardIds(state, players[0], chosenIds);
  }
  if (chosenIds.length === Math.max(0, amount | 0)) {
    if (players.length !== 1) {
      return {
        applied: false,
        message: `Skipped discard (requires deterministic player binding): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }

    const result = discardSpecificCardsForPlayer(state, players[0], chosenIds, bridgeOptions);
    if (!result.applied) {
      return {
        applied: false,
        message: `Skipped discard (chosen card unavailable): ${step.raw}`,
        reason: 'failed_to_apply',
        options: {
          persist: false,
          metadata: {
            missingCardIds: [...result.missingCardIds],
          },
        },
      };
    }
    if (result.halted) {
      return withDiscardLedgerFlags({
        applied: true,
        state,
        log: [],
        lastDiscardedCardCount: 0,
        lastDiscardedCards: [],
      });
    }

    return withDiscardLedgerFlags({
      applied: true,
      state: result.state,
      log: result.log,
      lastDiscardedCardCount: result.discardedCount,
      lastGreatestDiscardedCardCount: result.discardedCount,
      lastDiscardedCards: result.discardedCards,
      lastMovedCards: result.discardedCards,
    }, result.ledgerRecordedViaBridge);
  }

  const wouldNeedChoice = players.some(playerId => {
    const player = state.players.find(p => p.id === playerId) as any;
    const handLength = Array.isArray(player?.hand) ? player.hand.length : 0;
    return handLength > Math.max(0, amount | 0);
  });

  if (wouldNeedChoice) {
    return {
      applied: false,
      message: `Skipped discard (requires player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  let nextState = state;
  const log: string[] = [];
  let totalDiscarded = 0;
  let greatestDiscarded = 0;
  const discardedCards: any[] = [];
  let ledgerRecordedViaBridge = false;
  for (const playerId of players) {
    const result = discardCardsForPlayer(nextState, playerId, amount, bridgeOptions);
    if (result.halted) {
      return withDiscardLedgerFlags({
        applied: true,
        state: nextState,
        log,
        lastDiscardedCardCount: 0,
        lastDiscardedCards: [],
      });
    }
    nextState = result.state;
    const discardedCount = Math.max(0, Number(result.discardedCount) || 0);
    totalDiscarded += discardedCount;
    greatestDiscarded = Math.max(greatestDiscarded, discardedCount);
    if (result.ledgerRecordedViaBridge) ledgerRecordedViaBridge = true;
    if (Array.isArray(result.discardedCards)) discardedCards.push(...result.discardedCards);
    log.push(...result.log);
  }

  return withDiscardLedgerFlags({
    applied: true,
    state: nextState,
    log,
    lastDiscardedCardCount: totalDiscarded,
    lastGreatestDiscardedCardCount: greatestDiscarded,
    lastDiscardedCards: discardedCards,
    lastMovedCards: discardedCards,
  }, ledgerRecordedViaBridge);
}

export function applyRevealHandStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'reveal_hand' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    const opponentCount = (state.players || []).filter(
      (player: any) => String(player?.id || '').trim() !== String(ctx.controllerId || '').trim()
    ).length;
    const requiresChoice = step.who.kind === 'target_opponent' && opponentCount > 1;
    return {
      applied: false,
      message: `Skipped reveal hand (${requiresChoice ? 'requires player choice' : 'unsupported player selector'}): ${step.raw}`,
      reason: requiresChoice ? 'player_choice_required' : 'unsupported_player_selector',
      options: requiresChoice ? { classification: 'player_choice' } : undefined,
    };
  }

  const log: string[] = [];
  let lastRevealedCardCount = 0;
  const revealedCards: any[] = [];
  const revealRandomSingle = /at random/i.test(String(step.raw || ''));
  for (const playerId of players) {
    const player = state.players.find(entry => entry.id === playerId) as any;
    if (!player) {
      return {
        applied: false,
        message: `Skipped reveal hand (player not found): ${step.raw}`,
        reason: 'failed_to_apply',
        options: { classification: 'invalid_input', persist: false },
      };
    }

    const hand = Array.isArray(player.hand) ? player.hand : [];
    const cardsToReveal =
      revealRandomSingle && hand.length > 0 ? [hand[0]] : hand;
    lastRevealedCardCount = Math.max(lastRevealedCardCount, cardsToReveal.length);
    revealedCards.push(...cardsToReveal);
    const revealedNames = cardsToReveal
      .map((card: any) => String(card?.name || card?.card?.name || card?.id || '').trim())
      .filter(Boolean);
    log.push(
      `${playerId} reveals their hand: ${revealedNames.length > 0 ? revealedNames.join(', ') : '(empty)'}`
    );
  }

  return {
    applied: true,
    state,
    log,
    lastRevealedCardCount,
    ...(revealedCards.length > 0 ? { lastMovedCards: revealedCards } : {}),
  };
}

export function applyLookHandStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'look_hand' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    const opponentCount = (state.players || []).filter(
      (player: any) => String(player?.id || '').trim() !== String(ctx.controllerId || '').trim()
    ).length;
    const requiresChoice = step.who.kind === 'target_opponent' && opponentCount > 1;
    return {
      applied: false,
      message: `Skipped look at hand (${requiresChoice ? 'requires player choice' : 'unsupported player selector'}): ${step.raw}`,
      reason: requiresChoice ? 'player_choice_required' : 'unsupported_player_selector',
      options: requiresChoice ? { classification: 'player_choice' } : undefined,
    };
  }

  const log: string[] = [];
  for (const playerId of players) {
    const player = state.players.find(entry => entry.id === playerId) as any;
    if (!player) {
      return {
        applied: false,
        message: `Skipped look at hand (player not found): ${step.raw}`,
        reason: 'failed_to_apply',
        options: { classification: 'invalid_input', persist: false },
      };
    }

    const hand = Array.isArray(player.hand) ? player.hand : [];
    log.push(`${ctx.controllerId} looks at ${playerId}'s hand (${hand.length} card(s))`);
  }

  return {
    applied: true,
    state,
    log,
  };
}

export function buildExploreDecisionFromStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'explore' }>,
  ctx: OracleIRExecutionContext,
): {
  readonly playerId: PlayerID;
  readonly permanentId: string;
  readonly permanentName: string;
  readonly revealedCard: {
    readonly id: string;
    readonly name: string;
    readonly type_line?: string;
    readonly imageUrl?: string;
    readonly cmc?: number;
  };
  readonly isLand: boolean;
} | null {
  let targetId = resolveSingleCreatureTargetId(state, step.target, ctx);
  if (!targetId) {
    const targetIds = resolveCreatureTargetIds(state, step.target, ctx);
    targetId = targetIds[0];
  }
  if (!targetId) return null;

  const target = (state.battlefield || []).find(
    (perm: any) => String(perm?.id || '').trim() === targetId
  ) as any;
  if (!target) return null;

  const controllerId = String(target?.controller || ctx.controllerId || '').trim() as PlayerID;
  const player = state.players.find((entry: any) => String(entry?.id || '').trim() === controllerId) as any;
  if (!player) return null;

  const library = Array.isArray(player.library) ? player.library : [];
  if (library.length <= 0) return null;

  const topCard = library[0];
  const isLand = getCardTypeLineLower(topCard).includes('land');

  return {
    playerId: controllerId,
    permanentId: targetId,
    permanentName: String(target?.card?.name || target?.name || targetId || 'Creature'),
    revealedCard: {
      id: String(topCard?.id || topCard?.card?.id || 'revealed-card'),
      name: String(topCard?.name || topCard?.card?.name || 'Unknown'),
      type_line: String(topCard?.type_line || topCard?.card?.type_line || ''),
      imageUrl: topCard?.imageUrl || topCard?.image_uris?.normal || topCard?.card?.image_uris?.normal,
      cmc: Number(topCard?.cmc ?? topCard?.card?.cmc ?? 0) || 0,
    },
    isLand,
  };
}

export function applyExploreStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'explore' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  let targetIds = resolveCreatureTargetIds(state, step.target, ctx);
  if (targetIds.length === 0) {
    const singleTargetId = resolveSingleCreatureTargetId(state, step.target, ctx);
    if (singleTargetId) targetIds = [singleTargetId];
  }
  if (targetIds.length === 0) {
    return {
      applied: false,
      message: `Skipped explore (requires deterministic target): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'ambiguous' },
    };
  }

  const remainingPermanentIds = targetIds.length > 1 ? targetIds.slice(1) : [];
  const targetId = targetIds[0];

  const battlefield = [...((state.battlefield || []) as any[])];
  const targetIndex = battlefield.findIndex((perm: any) => String(perm?.id || '').trim() === targetId);
  if (targetIndex < 0) {
    return {
      applied: false,
      message: `Skipped explore (target not on battlefield): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'invalid_input', persist: false },
    };
  }

  const target = battlefield[targetIndex] as any;
  const controllerId = String(target?.controller || ctx.controllerId || '').trim();
  const player = state.players.find((p: any) => String(p?.id || '').trim() === controllerId) as any;
  if (!player) {
    return {
      applied: false,
      message: `Skipped explore (controller not found): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'invalid_input', persist: false },
    };
  }

  const library = Array.isArray(player.library) ? [...player.library] : [];
  const hand = Array.isArray(player.hand) ? [...player.hand] : [];
  if (library.length <= 0) {
    return {
      applied: true,
      state,
      log: [`${targetId} explored, but ${controllerId} had no cards to reveal`],
    };
  }

  const topCard = library[0];
  const typeLine = getCardTypeLineLower(topCard);
  const nextPlayers = state.players.map((p: any) => ({ ...p }));
  const playerIndex = nextPlayers.findIndex((p: any) => String(p?.id || '').trim() === controllerId);
  if (playerIndex < 0) {
    return {
      applied: false,
      message: `Skipped explore (controller not found): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'invalid_input', persist: false },
    };
  }

  const log: string[] = [`${targetId} explored and revealed ${String(topCard?.name || 'a card')}`];
  if (typeLine.includes('land') && remainingPermanentIds.length === 0) {
    library.shift();
    hand.push(topCard);
    nextPlayers[playerIndex] = {
      ...nextPlayers[playerIndex],
      library,
      hand,
    };
    return {
      applied: true,
      state: { ...(state as any), players: nextPlayers as any } as GameState,
      log: [...log, `${controllerId} put the revealed land into their hand`],
    };
  }

  const exploreToGraveyard = ctx.selectorContext?.exploreToGraveyard;
  if (typeof exploreToGraveyard !== 'boolean') {
    return {
      applied: false,
      message: `Skipped explore (requires player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: {
        classification: 'player_choice',
        metadata: {
          permanentId: targetId,
          revealedCardId: String(topCard?.id || topCard?.card?.id || ''),
          isLand: typeLine.includes('land'),
          ...(remainingPermanentIds.length > 0 ? { remainingPermanentIds } : {}),
        },
      },
    };
  }

  const counters = { ...((target?.counters || {}) as Record<string, number>) };
  const currentCount = Number(counters['+1/+1'] ?? 0);
  counters['+1/+1'] = (Number.isFinite(currentCount) ? currentCount : 0) + 1;
  battlefield[targetIndex] = {
    ...target,
    counters,
  };

  const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
  if (exploreToGraveyard) {
    library.shift();
    graveyard.push({ ...topCard, zone: 'graveyard', faceDown: false });
  }

  nextPlayers[playerIndex] = {
    ...nextPlayers[playerIndex],
    library,
    graveyard,
  };

  return {
    applied: true,
    state: { ...(state as any), players: nextPlayers as any, battlefield } as GameState,
    log: [
      ...log,
      exploreToGraveyard
        ? `Added 1 +1/+1 counter to ${targetId} and milled the revealed card`
        : `Added 1 +1/+1 counter to ${targetId} and left the revealed card on top`,
    ],
  };
}

export function applyManifestDreadStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'manifest_dread' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped manifest dread (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  let nextState = state;
  const log: string[] = [];
  const movedCards: any[] = [];
  const movedPermanentIds: string[] = [];

  for (const playerId of players) {
    const player = nextState.players.find((p: any) => String(p?.id || '').trim() === String(playerId || '').trim()) as any;
    if (!player) {
      return {
        applied: false,
        message: `Skipped manifest dread (player not found): ${step.raw}`,
        reason: 'failed_to_apply',
        options: { classification: 'invalid_input', persist: false },
      };
    }

    const library = Array.isArray(player.library) ? [...player.library] : [];
    if (library.length <= 0) {
      log.push(`${playerId} manifested dread, but had no cards in library`);
      continue;
    }

    const looked = library.slice(0, 2);
    const manifestedCard = looked[0];
    const rest = looked.slice(1);
    const keptLibrary = library.slice(looked.length);
    const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
    const newPermanent = createBattlefieldPermanentsFromCards(
      [manifestedCard],
      playerId,
      playerId,
      false,
      true,
      undefined,
      'library'
    );
    const updatedPlayers = nextState.players.map((p: any) =>
      String(p?.id || '').trim() === String(playerId || '').trim()
        ? ({
            ...p,
            library: keptLibrary,
            graveyard: [...graveyard, ...stampCardsPutIntoGraveyardThisTurn(nextState, rest)],
          } as any)
        : p
    );
    nextState = addBattlefieldPermanentsToState(
      { ...(nextState as any), players: updatedPlayers as any } as GameState,
      newPermanent as any
    );
    movedCards.push(manifestedCard, ...rest);
    movedPermanentIds.push(...newPermanent.map((perm: any) => String(perm?.id || '').trim()).filter(Boolean));
    log.push(
      `${playerId} manifested ${String(manifestedCard?.name || 'a card')} from among the top ${looked.length} card(s) of their library`
    );
    if (rest.length > 0) {
      log.push(`${playerId} put ${rest.length} remaining looked card(s) into their graveyard`);
    }
  }

  return {
    applied: true,
    state: nextState,
    log,
    lastMovedCards: movedCards,
  };
}

export function applyConniveStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'connive' }>,
  ctx: OracleIRExecutionContext,
  runtime?: ModifyPtRuntime
): PlayerStepHandlerResult {
  const targetId = resolveSingleCreatureTargetId(state, step.target, ctx);
  const controllerId = (String(ctx.controllerId || 'p1').trim() || 'p1') as PlayerID;

  let amount =
    resolveOracleQuantity(state, controllerId, step.amount, ctx, {
      targetCreatureId: targetId,
      runtime,
    }) ?? quantityToNumber(step.amount, ctx);

  if (amount === null) {
    const raw = String(step.amount?.kind === 'reference_amount' ? step.amount.raw : step.raw || '');
    const whereMatch = raw.match(/where x is (.+)$/i);
    if (whereMatch) {
      amount = evaluateModifyPtWhereX(
        state,
        controllerId,
        `X is ${String(whereMatch[1] || '').trim()}`,
        targetId,
        ctx,
        runtime
      );
    }
  }

  if (amount === null || amount <= 0) {
    return {
      applied: false,
      message: `Skipped connive (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
      options: { classification: 'ambiguous' },
    };
  }

  if (!targetId) {
    return {
      applied: false,
      message: `Skipped connive (requires deterministic target): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'ambiguous' },
    };
  }

  const battlefield = [...((state.battlefield || []) as any[])];
  const targetIndex = battlefield.findIndex((perm: any) => String(perm?.id || '').trim() === targetId);
  if (targetIndex < 0) {
    return {
      applied: false,
      message: `Skipped connive (target not on battlefield): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'invalid_input', persist: false },
    };
  }

  const target = battlefield[targetIndex] as any;
  const targetControllerId = String(target?.controller || ctx.controllerId || '').trim();
  const player = state.players.find((p: any) => String(p?.id || '').trim() === targetControllerId) as any;
  if (!player) {
    return {
      applied: false,
      message: `Skipped connive (controller not found): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'invalid_input', persist: false },
    };
  }

  const handLength = Array.isArray(player.hand) ? player.hand.length : 0;
  const libraryLength = Array.isArray(player.library) ? player.library.length : 0;
  let chosenIds = [...filterChosenHandCardIds(state, targetControllerId as PlayerID, getNormalizedChosenIds(ctx))];
  if (chosenIds.length > amount) {
    chosenIds = chosenIds.slice(0, amount);
  }
  if (chosenIds.length > 0 && chosenIds.length !== amount) {
    chosenIds = [];
  }

  if (chosenIds.length > 0) {
    if (chosenIds.length !== amount) {
      return {
        applied: false,
        message: `Skipped connive (expected ${amount} discard choice(s), got ${chosenIds.length}): ${step.raw}`,
        reason: 'failed_to_apply',
        options: { classification: 'invalid_input', persist: false },
      };
    }

    const discardResult = discardSpecificCardsForPlayer(state, targetControllerId as PlayerID, chosenIds);
    if (!discardResult.applied) {
      return {
        applied: false,
        message: `Skipped connive (invalid discard choice): ${step.raw}`,
        reason: 'failed_to_apply',
        options: { classification: 'invalid_input', persist: false },
      };
    }

    const discardedNonlands = discardResult.discardedCards.filter((card: any) => !getCardTypeLineLower(card).includes('land')).length;
    let nextState = discardResult.state as GameState;
    const log = [...discardResult.log];

    if (discardedNonlands > 0) {
      const counters = { ...((target?.counters || {}) as Record<string, number>) };
      const currentCount = Number(counters['+1/+1'] ?? 0);
      counters['+1/+1'] = (Number.isFinite(currentCount) ? currentCount : 0) + discardedNonlands;
      battlefield[targetIndex] = {
        ...target,
        counters,
      };
      nextState = { ...(nextState as any), battlefield } as GameState;
      log.push(`Added ${discardedNonlands} +1/+1 counter(s) to ${targetId}`);
    }

    return {
      applied: true,
      state: nextState,
      log,
      lastDiscardedCardCount: discardResult.discardedCount,
      lastDiscardedCards: discardResult.discardedCards,
      lastMovedCards: discardResult.discardedCards,
    };
  }

  const drawnCount = Math.min(amount, Math.max(0, libraryLength));
  if (handLength + drawnCount < amount) {
    return {
      applied: false,
      message: `Skipped connive (not enough cards to discard): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'invalid_input', persist: false },
    };
  }

  const drawResult = drawCardsForPlayer(state, targetControllerId as PlayerID, amount);
  const playerAfterDraw = drawResult.state.players.find((entry: any) => String(entry?.id || '').trim() === targetControllerId) as any;
  const handAfterDraw = Array.isArray(playerAfterDraw?.hand) ? playerAfterDraw.hand : [];

  if (handAfterDraw.length > amount) {
    return {
      applied: false,
      state: drawResult.state,
      message: `Skipped connive (requires discard choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  const discardResult = discardCardsForPlayer(drawResult.state, targetControllerId as PlayerID, amount);
  const discardedNonlands = discardResult.discardedCards.filter((card: any) => !getCardTypeLineLower(card).includes('land')).length;
  const log = [...drawResult.log, ...discardResult.log];

  if (discardedNonlands > 0) {
    const counters = { ...((target?.counters || {}) as Record<string, number>) };
    const currentCount = Number(counters['+1/+1'] ?? 0);
    counters['+1/+1'] = (Number.isFinite(currentCount) ? currentCount : 0) + discardedNonlands;
    battlefield[targetIndex] = {
      ...target,
      counters,
    };
    return {
      applied: true,
      state: { ...(discardResult.state as any), battlefield } as GameState,
      log: [...log, `Added ${discardedNonlands} +1/+1 counter(s) to ${targetId}`],
      lastDiscardedCardCount: discardResult.discardedCount,
      lastDiscardedCards: discardResult.discardedCards,
      lastMovedCards: discardResult.discardedCards,
    };
  }

  return {
    applied: true,
    state: discardResult.state,
    log,
    lastDiscardedCardCount: discardResult.discardedCount,
    lastDiscardedCards: discardResult.discardedCards,
    lastMovedCards: discardResult.discardedCards,
  };
}

export function applyRegisterLoseGameReplacementStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'register_lose_game_replacement' }>,
  ctx: OracleIRExecutionContext,
  controllerId: PlayerID,
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped lose-game replacement registration (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const drawCount = Math.max(0, Number(step.drawCount) || 0);
  const lifeTotal = Math.max(0, Number(step.lifeTotal) || 0);
  const sourceName = String(ctx.sourceName || '').trim() || 'Unknown source';
  const nextState = { ...(state as any) } as GameState;
  const pending = Array.isArray((nextState as any).pendingLoseGameReplacements)
    ? [...(nextState as any).pendingLoseGameReplacements]
    : [];

  for (const playerId of players) {
    pending.push({
      playerId,
      drawCount,
      lifeTotal,
      sourceName,
      expiresAt: step.expiresAt || 'end_of_turn',
    });
  }

  (nextState as any).pendingLoseGameReplacements = pending;
  return {
    applied: true,
    state: nextState,
    log: [`Registered lose-the-game replacement for ${players.join(', ')}`],
  };
}

function readExiledPermanentPower(entry: any): number {
  const numeric = Number(
    entry?.effectivePower ?? entry?.power ?? entry?.basePower ?? entry?.card?.power,
  );
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
}

export function applyGainLifeStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'gain_life' }>,
  ctx: OracleIRExecutionContext,
  controllerId: PlayerID,
  runtime?: ModifyPtRuntime,
  evaluateWhereX?: (
    state: GameState,
    controllerId: PlayerID,
    whereRaw: string,
    targetCreatureId?: string,
    ctx?: OracleIRExecutionContext,
    runtime?: ModifyPtRuntime
  ) => number | null
): PlayerStepHandlerResult {
  if (step.who.kind === 'each_controller_of_those') {
    const amountIsItsManaValue =
      (step.amount.kind === 'reference_amount' && /^its mana value$/i.test(String(step.amount.raw || ''))) ||
      (step.amount.kind === 'object_stat' && step.amount.stat === 'mana_value');
    if (amountIsItsManaValue) {
      const cards = [
        ...(Array.isArray(ctx.lastMovedCards) ? ctx.lastMovedCards : []),
        ...(Array.isArray((ctx as any).lastDestroyedPermanents) ? (ctx as any).lastDestroyedPermanents : []),
      ] as any[];
      if (cards.length > 0) {
        let nextState = state;
        const log: string[] = [];
        let totalGained = 0;
        const replayMutations: OracleIRReplayMutation[] = [];
        for (const card of cards) {
          const playerId = String(card?.controller || card?.controllerId || controllerId || '').trim() as PlayerID;
          const amount = Math.max(0, getCardManaValue(card) ?? (Number(card?.cmc ?? card?.manaValue ?? 0) || 0));
          if (!playerId || amount <= 0) continue;
          const result = adjustLife(nextState, playerId, amount);
          nextState = result.state;
          log.push(...result.log);
          totalGained += amount;
          replayMutations.push({ kind: 'adjustLife', playerId, delta: amount });
        }
        if (totalGained > 0) {
          return {
            applied: true,
            state: nextState,
            log,
            count: totalGained,
            replayMutations,
          };
        }
      }
    }
  }

  if (
    step.amount?.kind === 'object_stat' &&
    step.amount.stat === 'power' &&
    (step.amount.subject === 'it' || step.amount.subject === 'that_creature') &&
    step.who?.kind === 'target_player'
  ) {
    const exiledSnapshots = Array.isArray(runtime?.lastMovedCards) && runtime.lastMovedCards.length > 0
      ? runtime.lastMovedCards
      : Array.isArray(ctx.lastMovedCards)
        ? ctx.lastMovedCards
        : [];
    if (exiledSnapshots.length > 1) {
      let nextState = state;
      const log: string[] = [];
      const replayMutations: OracleIRReplayMutation[] = [];
      let totalGained = 0;
      for (const snapshot of exiledSnapshots) {
        const playerId = String(snapshot?.controller || snapshot?.controllerId || '').trim() as PlayerID;
        const amount = readExiledPermanentPower(snapshot);
        if (!playerId || amount <= 0) continue;
        const result = adjustLife(nextState, playerId, amount);
        nextState = result.state;
        log.push(...result.log);
        totalGained += amount;
        replayMutations.push({ kind: 'adjustLife', playerId, delta: amount });
      }
      if (totalGained > 0) {
        return {
          applied: true,
          state: nextState,
          log,
          count: totalGained,
          replayMutations,
        };
      }
    }
  }

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped life gain (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  let nextState = state;
  const log: string[] = [];
  let lastCount = 0;
  const replayMutations: OracleIRReplayMutation[] = [];
  for (const playerId of players) {
    const amount =
      resolveStepAmountForPlayer(state, controllerId, step.amount, ctx, playerId, {
        whereX: step.whereX,
        runtime,
      }) ??
      resolveVariableAmount(state, controllerId, step.amount, ctx, runtime, evaluateWhereX);
    if (amount === null) {
      return {
        applied: false,
        message: `Skipped life gain (unknown amount): ${step.raw}`,
        reason: 'unknown_amount',
        options: { classification: 'ambiguous' },
      };
    }
    lastCount = amount;
    const result = adjustLife(nextState, playerId, amount);
    nextState = result.state;
    log.push(...result.log);
    if (amount > 0) {
      replayMutations.push({ kind: 'adjustLife', playerId, delta: amount });
    }
  }

  return {
    applied: true,
    state: nextState,
    log,
    count: lastCount,
    ...(replayMutations.length > 0 ? { replayMutations } : {}),
  };
}

export function applyLoseLifeStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'lose_life' }>,
  ctx: OracleIRExecutionContext,
  controllerId: PlayerID,
  runtime?: ModifyPtRuntime,
  evaluateWhereX?: (
    state: GameState,
    controllerId: PlayerID,
    whereRaw: string,
    targetCreatureId?: string,
    ctx?: OracleIRExecutionContext,
    runtime?: ModifyPtRuntime
  ) => number | null
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped life loss (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  let nextState = state;
  const log: string[] = [];
  let totalLifeLost = 0;
  const replayMutations: OracleIRReplayMutation[] = [];
  for (const playerId of players) {
    const amount =
      resolveStepAmountForPlayer(state, controllerId, step.amount, ctx, playerId, {
        whereX: step.whereX,
        runtime,
      }) ??
      resolveVariableAmount(state, controllerId, step.amount, ctx, runtime, evaluateWhereX);
    if (amount === null) {
      return {
        applied: false,
        message: `Skipped life loss (unknown amount): ${step.raw}`,
        reason: 'unknown_amount',
        options: { classification: 'ambiguous' },
      };
    }

    const playerBefore = nextState.players.find((player) => player.id === playerId) as any;
    const previousLife = Number(playerBefore?.life);
    const result = adjustLife(nextState, playerId, -amount);
    nextState = result.state;
    log.push(...result.log);

    const playerAfter = nextState.players.find((player) => player.id === playerId) as any;
    const nextLife = Number(playerAfter?.life);
    if (Number.isFinite(previousLife) && Number.isFinite(nextLife)) {
      totalLifeLost += Math.max(0, previousLife - nextLife);
    }
    if (amount > 0) {
      replayMutations.push({ kind: 'adjustLife', playerId, delta: -amount });
    }
  }

  return {
    applied: true,
    state: nextState,
    log,
    count: totalLifeLost,
    ...(replayMutations.length > 0 ? { replayMutations } : {}),
  };
}

export function applyAddPlayerCounterStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'add_player_counter' }>,
  ctx: OracleIRExecutionContext,
  controllerId: PlayerID,
  runtime?: ModifyPtRuntime,
  evaluateWhereX?: (
    state: GameState,
    controllerId: PlayerID,
    whereRaw: string,
    targetCreatureId?: string,
    ctx?: OracleIRExecutionContext,
    runtime?: ModifyPtRuntime
  ) => number | null
): PlayerStepHandlerResult {
  const amount = resolveVariableAmount(state, controllerId, step.amount, ctx, runtime, evaluateWhereX);
  if (amount === null) {
    return {
      applied: false,
      message: `Skipped player counter addition (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
      options: { classification: 'ambiguous' },
    };
  }

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped player counter addition (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  let nextState = state;
  const log: string[] = [];
  for (const playerId of players) {
    const result = adjustPlayerCounter(nextState, playerId, step.counter, amount);
    log.push(...result.log);
    if (!result.applied) {
      return {
        applied: false,
        message: log.join('\n') || `Skipped player counter addition (failed to apply): ${step.raw}`,
        reason: 'failed_to_apply',
      };
    }
    nextState = result.state;
  }

  return { applied: true, state: nextState, log };
}

function collectPlayerCounters(player: any, state: GameState, playerId: PlayerID): Record<string, number> {
  const counters: Record<string, number> = { ...((player?.counters || {}) as Record<string, number>) };
  const assign = (counter: string, value: unknown) => {
    const amount = Math.max(0, Number(value) || 0);
    if (amount > 0) counters[counter] = Math.max(amount, Number(counters[counter]) || 0);
  };
  assign('poison', player?.poisonCounters ?? (state as any)?.poisonCounters?.[playerId]);
  assign('energy', player?.energyCounters ?? player?.energy);
  assign('experience', player?.experienceCounters ?? player?.experience ?? (state as any)?.experienceCounters?.[playerId]);
  assign('rad', player?.radCounters);
  assign('ticket', player?.ticketCounters);
  return Object.fromEntries(
    Object.entries(counters)
      .map(([counter, amount]) => [counter, Math.max(0, Number(amount) || 0)] as const)
      .filter(([, amount]) => amount > 0)
  );
}

export function applyDoublePlayerCountersStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'double_player_counters' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped player counter doubling (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  let nextState = state;
  const log: string[] = [];
  for (const playerId of players) {
    const player = nextState.players.find((candidate) => candidate.id === playerId) as any;
    const counters = collectPlayerCounters(player, nextState, playerId);
    for (const [counter, amount] of Object.entries(counters)) {
      const result = adjustPlayerCounter(nextState, playerId, counter, amount);
      log.push(...result.log);
      if (!result.applied) {
        return {
          applied: false,
          message: log.join('\n') || `Skipped player counter doubling (failed to apply): ${step.raw}`,
          reason: 'failed_to_apply',
        };
      }
      nextState = result.state;
    }
  }

  return { applied: true, state: nextState, log };
}

export function applyDrawStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'draw' }>,
  ctx: OracleIRExecutionContext,
  runtime?: ModifyPtRuntime
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped draw (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  let nextState = state;
  const log: string[] = [];
  let lastCount = 0;
  let lastAntecedentBattlefieldPermanentIds: string[] | undefined;
  const replayMutations: OracleIRReplayMutation[] = [];
  const bridgeOptions = buildEffectBridgeOptions(ctx, 'draw');
  let ledgerRecordedViaBridge = false;
  for (const playerId of players) {
    const amount =
      resolveStepAmountForPlayer(state, ctx.controllerId, step.amount, ctx, playerId, {
        whereX: step.whereX,
        runtime,
      }) ?? resolveDynamicDrawAmount(state, step, {
        ...ctx,
        selectorContext: { ...(ctx.selectorContext || {}), targetPlayerId: playerId },
      }, runtime);
    if (amount === null) {
      return {
        applied: false,
        message: `Skipped draw (unknown amount): ${step.raw}`,
        reason: 'unknown_amount',
        options: { classification: 'ambiguous' },
      };
    }
    if (step.amount?.kind === 'reference_amount') {
      const antecedentIds = collectForEachReferenceBattlefieldPermanentIds(
        state,
        ctx.controllerId,
        String(step.amount.raw || ''),
        ctx,
        { runtime, targetPlayerId: playerId },
      );
      if (antecedentIds.length > 0) {
        lastAntecedentBattlefieldPermanentIds = [...antecedentIds];
      }
    }
    lastCount = amount;
    const playerBeforeDraw = nextState.players.find((entry: any) => String(entry?.id || '').trim() === playerId) as any;
    const handIdsBeforeDraw = new Set(
      readPlayerZoneCards(nextState, playerId, playerBeforeDraw, 'hand')
        .map((card: any) => String(card?.id || '').trim())
        .filter(Boolean),
    );
    const result = drawCardsForPlayer(nextState, playerId, amount, bridgeOptions);
    if (result.halted) {
      return withDiscardLedgerFlags({
        applied: true,
        state: nextState,
        log,
        count: 0,
      }, ledgerRecordedViaBridge);
    }
    nextState = result.state;
    log.push(...result.log);
    if (result.ledgerRecordedViaBridge) ledgerRecordedViaBridge = true;
    if (amount > 0) {
      const playerAfterDraw = nextState.players.find((entry: any) => String(entry?.id || '').trim() === playerId) as any;
      const drawnCardIds = readPlayerZoneCards(nextState, playerId, playerAfterDraw, 'hand')
        .map((card: any) => String(card?.id || '').trim())
        .filter((id: string) => id && !handIdsBeforeDraw.has(id));
      replayMutations.push({
        kind: 'drawCards',
        playerId,
        count: amount,
        ...(drawnCardIds.length > 0 ? { drawnCardIds } : {}),
      });
    }
  }

  return withDiscardLedgerFlags({
    applied: true,
    state: nextState,
    log,
    count: lastCount,
    ...(lastAntecedentBattlefieldPermanentIds
      ? { lastAntecedentBattlefieldPermanentIds }
      : {}),
    ...(replayMutations.length > 0 ? { replayMutations } : {}),
  }, ledgerRecordedViaBridge);
}

export function applyAddManaStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'add_mana' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped add mana (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  let nextState = state;
  const log: string[] = [];
  const normalizeManaChoice = (raw: string): string | null => {
    const trimmed = String(raw || '').trim().toUpperCase();
    if (!trimmed) return null;
    const symbol = trimmed.startsWith('{') && trimmed.endsWith('}') ? trimmed : `{${trimmed}}`;
    return /^{[WUBRG]}$/i.test(symbol) ? symbol.toUpperCase() : null;
  };
  const countManaSymbols = (raw: string): number => {
    const matches = String(raw || '').match(/\{[^}]+\}/g);
    return Array.isArray(matches) ? matches.length : 0;
  };
  const normalizeManaChoiceSequence = (raw: string): string[] | null => {
    const compact = String(raw || '').replace(/\s+/g, '').trim();
    if (!compact) return null;

    const braceMatches = compact.match(/\{[^}]+\}/g);
    if (Array.isArray(braceMatches) && braceMatches.join('') === compact) {
      const symbols = braceMatches.map(normalizeManaChoice);
      return symbols.every(Boolean) ? (symbols as string[]) : null;
    }

    if (/^[WUBRG]+$/i.test(compact)) {
      return compact.toUpperCase().split('').map((symbol) => `{${symbol}}`);
    }

    const single = normalizeManaChoice(compact);
    return single ? [single] : null;
  };
  const rawStepText = String(step.raw || '').trim();
  const orForEachMatch = rawStepText.match(/add (\{[wubrg]\}) or (\{[wubrg]\}) for each/i);
  if (orForEachMatch) {
    const count =
      resolveAddManaAmount(state, step, ctx) ??
      Number(ctx.referenceAmount ?? (ctx.selectorContext as any)?.referenceAmount ?? 1);
    const chosen =
      normalizeManaChoice(String(ctx.selectorContext?.chosenMana || orForEachMatch[1] || '').trim()) ||
      normalizeManaChoice(String(orForEachMatch[1] || '').trim());
    if (chosen && Number.isFinite(Number(count)) && Number(count) > 0) {
      const manaToAdd = repeatManaString(chosen, Math.max(0, Math.floor(Number(count))));
      for (const playerId of players) {
        const result = addManaToPoolForPlayer(nextState, playerId, manaToAdd, step.spendRestriction, ctx.sourceId, ctx.sourceName);
        log.push(...result.log);
        if (!result.applied) {
          return {
            applied: false,
            message: log.join('\n') || `Skipped add mana (failed to apply): ${step.raw}`,
            reason: 'failed_to_apply',
          };
        }
        nextState = result.state;
      }
      return { applied: true, state: nextState, log };
    }
  }
  const repeatedAmount = resolveAddManaAmount(state, step, ctx);
  const manaResolution = (() => {
    let options = Array.isArray(step.manaOptions)
      ? step.manaOptions.map(option => String(option || '').trim()).filter(Boolean)
      : [];
    if (step.manaOptionsScope === 'commander_color_identity') {
      if (players.length !== 1) {
        return {
          kind: 'skip' as const,
          message: `Skipped add mana (commander color identity needs one player): ${step.raw}`,
          reason: 'player_choice_required' as const,
          options: { classification: 'player_choice' as const },
        };
      }

      const colorIdentity = getCommanderColorIdentityForPlayer(state, players[0]);
      const allowed = new Set(colorIdentity.map((color) => `{${color}}`.toUpperCase()));
      options = options.filter((option) => allowed.has(option.toUpperCase()));
      if (options.length === 0) {
        return {
          kind: 'skip' as const,
          message: `Skipped add mana (commander color identity unavailable): ${step.raw}`,
          reason: 'invalid_input' as const,
          options: { classification: 'invalid_input' as const },
        };
      }
    }
    if (options.length <= 1) {
      return {
        kind: 'resolved' as const,
        mana: String(step.mana || '').trim(),
      };
    }

    const symbolCount = Math.max(1, countManaSymbols(String(step.mana || '').trim()));
    const rawText = String(step.raw || '').trim();
    const requiresChosenColorSequence = /each of the chosen colors/i.test(rawText);
    const requestedSymbolCount = step.amount ? repeatedAmount : symbolCount;
    const requiresCombinationChoice = /any combination of/i.test(rawText) && (requestedSymbolCount ?? 0) > 1;
    const requiresRepeatedSingleChoice = /any one color/i.test(rawText) && (requestedSymbolCount ?? 0) > 1;

    if (requiresChosenColorSequence) {
      const chosenSymbols = normalizeManaChoiceSequence(String(ctx.selectorContext?.chosenMana || '').trim());
      if (!chosenSymbols || chosenSymbols.length === 0) {
        return {
          kind: 'skip' as const,
          message: `Skipped add mana (needs chosen colors): ${step.raw}`,
          reason: 'player_choice_required' as const,
          options: { classification: 'player_choice' as const },
        };
      }

      if (options.length > 0 && !chosenSymbols.every((symbol) => options.some((option) => option.toUpperCase() === symbol.toUpperCase()))) {
        return {
          kind: 'skip' as const,
          message: `Skipped add mana (invalid chosen colors): ${step.raw}`,
          reason: 'invalid_input' as const,
          options: {
            classification: 'invalid_input' as const,
            metadata: {
              chosenMana: chosenSymbols.join(''),
              options,
            },
          },
        };
      }

      return {
        kind: 'resolved' as const,
        mana: chosenSymbols.join(''),
      };
    }

    const requiresSplitColorPairs = /two mana of any one color and two mana of any other color/i.test(rawText);
    if (requiresSplitColorPairs) {
      const chosenSymbols = normalizeManaChoiceSequence(String(ctx.selectorContext?.chosenMana || '').trim());
      if (!chosenSymbols || chosenSymbols.length !== 4) {
        return {
          kind: 'skip' as const,
          message: `Skipped add mana (needs two chosen colors): ${step.raw}`,
          reason: 'player_choice_required' as const,
          options: { classification: 'player_choice' as const },
        };
      }

      if (!chosenSymbols.every((symbol) => options.some((option) => option.toUpperCase() === symbol.toUpperCase()))) {
        return {
          kind: 'skip' as const,
          message: `Skipped add mana (invalid chosen colors): ${step.raw}`,
          reason: 'invalid_input' as const,
          options: {
            classification: 'invalid_input' as const,
            metadata: {
              chosenMana: chosenSymbols.join(''),
              options,
            },
          },
        };
      }

      const [first, second, third, fourth] = chosenSymbols;
      if (
        !first ||
        !second ||
        !third ||
        !fourth ||
        first.toUpperCase() !== second.toUpperCase() ||
        third.toUpperCase() !== fourth.toUpperCase() ||
        first.toUpperCase() === third.toUpperCase()
      ) {
        return {
          kind: 'skip' as const,
          message: `Skipped add mana (invalid split color pairs): ${step.raw}`,
          reason: 'invalid_input' as const,
          options: {
            classification: 'invalid_input' as const,
            metadata: {
              chosenMana: chosenSymbols.join(''),
            },
          },
        };
      }

      return {
        kind: 'resolved' as const,
        mana: chosenSymbols.join(''),
      };
    }

    if ((requestedSymbolCount ?? symbolCount) > 1 && (requiresCombinationChoice || requiresRepeatedSingleChoice)) {
      const chosenSymbols = normalizeManaChoiceSequence(String(ctx.selectorContext?.chosenMana || '').trim());
      if (!chosenSymbols || chosenSymbols.length === 0) {
        return {
          kind: 'skip' as const,
          message: `Skipped add mana (needs chosen color): ${step.raw}`,
          reason: 'player_choice_required' as const,
          options: { classification: 'player_choice' as const },
        };
      }

      if (!chosenSymbols.every((symbol) => options.some((option) => option.toUpperCase() === symbol.toUpperCase()))) {
        const expectedCount = requestedSymbolCount ?? symbolCount;
        if (requiresCombinationChoice && options.length > 0 && expectedCount > 0) {
          const fallbackSymbol = options[0];
          return {
            kind: 'resolved' as const,
            mana: Array.from({ length: expectedCount }, () => fallbackSymbol).join(''),
          };
        }
        return {
          kind: 'skip' as const,
          message: `Skipped add mana (invalid chosen color): ${step.raw}`,
          reason: 'invalid_input' as const,
          options: {
            classification: 'invalid_input' as const,
            metadata: {
              chosenMana: chosenSymbols.join(''),
              options,
            },
          },
        };
      }

      if (requiresCombinationChoice) {
        if (chosenSymbols.length === 1 && (requestedSymbolCount ?? 0) > 1) {
          return {
            kind: 'resolved' as const,
            mana: Array.from({ length: requestedSymbolCount ?? symbolCount }, () => chosenSymbols[0]).join(''),
          };
        }
        if (
          chosenSymbols.length > 0 &&
          chosenSymbols.length < (requestedSymbolCount ?? symbolCount) &&
          chosenSymbols.every((symbol) => options.some((option) => option.toUpperCase() === symbol.toUpperCase()))
        ) {
          const padded = [...chosenSymbols];
          while (padded.length < (requestedSymbolCount ?? symbolCount)) {
            padded.push(padded[padded.length - 1] || padded[0] || options[0] || '');
          }
          return {
            kind: 'resolved' as const,
            mana: padded.slice(0, requestedSymbolCount ?? symbolCount).join(''),
          };
        }
        if (chosenSymbols.length !== requestedSymbolCount) {
          if (
            requiresCombinationChoice &&
            options.length > 0 &&
            chosenSymbols.length > (requestedSymbolCount ?? symbolCount) &&
            chosenSymbols.every((symbol) => options.some((option) => option.toUpperCase() === symbol.toUpperCase()))
          ) {
            return {
              kind: 'resolved' as const,
              mana: chosenSymbols.slice(0, requestedSymbolCount ?? symbolCount).join(''),
            };
          }
          if (requiresCombinationChoice && options.length > 0 && (requestedSymbolCount ?? symbolCount) > 0) {
            const fallbackSymbol =
              chosenSymbols.find((symbol) => options.some((option) => option.toUpperCase() === symbol.toUpperCase())) ||
              options[0];
            return {
              kind: 'resolved' as const,
              mana: Array.from({ length: requestedSymbolCount ?? symbolCount }, () => fallbackSymbol).join(''),
            };
          }
          return {
            kind: 'skip' as const,
            message: `Skipped add mana (invalid chosen color count): ${step.raw}`,
            reason: 'invalid_input' as const,
            options: {
              classification: 'invalid_input' as const,
              metadata: {
                chosenMana: chosenSymbols.join(''),
                expectedCount: requestedSymbolCount ?? symbolCount,
              },
            },
          };
        }

        return {
          kind: 'resolved' as const,
          mana: chosenSymbols.join(''),
        };
      }

      const chosenColor = chosenSymbols[0];
      const repeatedChoice = chosenSymbols.length === 1
        ? Array.from({ length: requestedSymbolCount ?? symbolCount }, () => chosenColor)
        : chosenSymbols;
      if (
        repeatedChoice.length !== (requestedSymbolCount ?? symbolCount) ||
        repeatedChoice.some((symbol) => symbol.toUpperCase() !== chosenColor.toUpperCase())
      ) {
        return {
          kind: 'skip' as const,
          message: `Skipped add mana (invalid chosen color repetition): ${step.raw}`,
          reason: 'invalid_input' as const,
          options: {
            classification: 'invalid_input' as const,
            metadata: {
              chosenMana: chosenSymbols.join(''),
              expectedCount: requestedSymbolCount ?? symbolCount,
            },
          },
        };
      }

      return {
        kind: 'resolved' as const,
        mana: repeatedChoice.join(''),
      };
    }

    const chosenMana = normalizeManaChoice(String(ctx.selectorContext?.chosenMana || '').trim());
    if (!chosenMana) {
      if (step.requiresChosenMana) {
        const expectedCount = repeatedAmount ?? requestedSymbolCount ?? symbolCount;
        if (requiresCombinationChoice && options.length > 0 && (expectedCount ?? 0) > 0) {
          return {
            kind: 'resolved' as const,
            mana: Array.from({ length: expectedCount ?? symbolCount }, () => options[0]).join(''),
          };
        }
        return {
          kind: 'skip' as const,
          message: `Skipped add mana (needs chosen color): ${step.raw}`,
          reason: 'player_choice_required' as const,
          options: { classification: 'player_choice' as const },
        };
      }

      return {
        kind: 'resolved' as const,
        mana: options[0] || '',
      };
    }

    const match = options.find(option => option.toUpperCase() === chosenMana.toUpperCase());
    if (match) {
      return {
        kind: 'resolved' as const,
        mana: match,
      };
    }

    if (step.requiresChosenMana) {
      return {
        kind: 'skip' as const,
        message: `Skipped add mana (invalid chosen color): ${step.raw}`,
        reason: 'invalid_input' as const,
        options: {
          classification: 'invalid_input' as const,
          metadata: {
            chosenMana,
            options,
          },
        },
      };
    }

    return {
      kind: 'resolved' as const,
      mana: options[0] || '',
    };
  })();

  const dynamicManaSequence = resolveDynamicAddManaSequence(state, step, ctx);
  if (dynamicManaSequence === null) {
    return {
      applied: false,
      message: `Skipped add mana (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
    };
  }

  if (manaResolution.kind === 'skip') {
    return {
      applied: false,
      message: manaResolution.message,
      reason: manaResolution.reason,
      options: manaResolution.options,
    };
  }

  if (dynamicManaSequence !== undefined) {
    const manaToAdd = dynamicManaSequence;

    if (!manaToAdd) {
      return {
        applied: true,
        state,
        log: [`Resolved add mana to zero mana: ${step.raw}`],
      };
    }

    for (const playerId of players) {
      const result = addManaToPoolForPlayer(nextState, playerId, manaToAdd, step.spendRestriction, ctx.sourceId, ctx.sourceName);
      log.push(...result.log);
      if (!result.applied) {
        return {
          applied: false,
          message: log.join('\n') || `Skipped add mana (failed to apply): ${step.raw}`,
          reason: 'failed_to_apply',
          options: {
            metadata: log.length > 0 ? { log } : undefined,
          },
        };
      }
      nextState = result.state;
    }

    return { applied: true, state: nextState, log };
  }

  if (repeatedAmount === null) {
    return {
      applied: false,
      message: `Skipped add mana (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
    };
  }

  const sequenceDrivenAmount = step.amount && /each of the chosen colors|any combination of/i.test(String(step.raw || ''));
  const manaToAdd = sequenceDrivenAmount
    ? manaResolution.mana
    : step.amount
    ? repeatManaString(manaResolution.mana, repeatedAmount)
    : manaResolution.mana;

  if (!manaToAdd) {
    return {
      applied: true,
      state,
      log: [`Resolved add mana to zero mana: ${step.raw}`],
    };
  }

  for (const playerId of players) {
    const result = addManaToPoolForPlayer(nextState, playerId, manaToAdd, step.spendRestriction, ctx.sourceId, ctx.sourceName);
    log.push(...result.log);
    if (!result.applied) {
      return {
        applied: false,
        message: log.join('\n') || `Skipped add mana (failed to apply): ${step.raw}`,
        reason: 'failed_to_apply',
        options: {
          metadata: log.length > 0 ? { log } : undefined,
        },
      };
    }
    nextState = result.state;
  }

  return { applied: true, state: nextState, log };
}

export function applyRetainManaStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'retain_mana' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped retain mana (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const sourceId = String(ctx.sourceId || ctx.sourceName || step.raw || 'oracle-ir-retain-mana');
  const manaPoolRecord: Record<PlayerID, any> = { ...((((state as any).manaPool || {}) as any) || {}) };
  const retainedPools = new Map<PlayerID, any>();

  for (const playerId of players) {
    const currentPool = manaPoolRecord[playerId] || createEmptyManaPool();
    const retainedPool = setManaDoesNotEmpty(currentPool, sourceId);
    manaPoolRecord[playerId] = retainedPool;
    retainedPools.set(playerId, retainedPool);
  }

  const existingEffects = Array.isArray((state as any).manaRetentionEffects)
    ? [...(state as any).manaRetentionEffects]
    : [];
  const createdAtTurn = (state as any).turnNumber ?? (state as any).turn;
  for (const playerId of players) {
    const alreadyRecorded = existingEffects.some((effect: any) => (
      String(effect?.playerId || '') === String(playerId) &&
      String(effect?.sourceId || '') === sourceId &&
      String(effect?.duration || '') === step.duration
    ));
    if (!alreadyRecorded) {
      existingEffects.push({
        playerId,
        sourceId,
        duration: step.duration,
        createdAtTurn,
        raw: step.raw,
      });
    }
  }

  const updatedPlayers = state.players.map(player => {
    const retainedPool = retainedPools.get(player.id as PlayerID);
    return retainedPool ? ({ ...player, manaPool: retainedPool } as any) : player;
  });

  return {
    applied: true,
    state: {
      ...(state as any),
      manaPool: manaPoolRecord,
      manaRetentionEffects: existingEffects,
      players: updatedPlayers as any,
    } as any,
    log: players.map(playerId => `${playerId} doesn't lose this mana as steps and phases end`),
  };
}

export function evaluateUnlessPaysLifeStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'unless_pays_life' }>,
  ctx: OracleIRExecutionContext
): UnlessPaysLifeResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length !== 1) {
    return {
      applied: false,
      message: `Skipped unless-pays-life step (needs player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: {
        classification: 'player_choice',
        metadata: {
          selectorKind: step.who.kind,
          candidateCount: players.length,
          lifeAmount: step.amount,
        },
      },
    };
  }

  const payerId = players[0];
  const payer = (state.players || []).find(player => String(player?.id || '').trim() === String(payerId || '').trim()) as any;
  if (!payer) {
    return {
      applied: false,
      message: `Skipped unless-pays-life step (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const lifeTotal = Number(payer.life);
  const canPayLife = Number.isFinite(lifeTotal) && lifeTotal >= step.amount;
  const explicitChoice =
    ctx.unlessPaysLifeChoice === 'pay' || ctx.unlessPaysLifeChoice === 'decline'
      ? ctx.unlessPaysLifeChoice
      : (ctx.selectorContext?.unlessPaysLifeChoice === 'pay' || ctx.selectorContext?.unlessPaysLifeChoice === 'decline'
          ? ctx.selectorContext.unlessPaysLifeChoice
          : undefined);
  if (canPayLife) {
    if (explicitChoice === 'pay') {
      const payment = adjustLife(state, payerId, -step.amount);
      return {
        applied: true,
        shouldApplyNestedSteps: false,
        state: payment.state,
        log: [
          ...payment.log,
          `Resolved unless-pays-life step (payer chose to pay ${step.amount} life): ${step.raw}`,
        ],
      };
    }

    if (explicitChoice === 'decline') {
      return {
        applied: true,
        shouldApplyNestedSteps: true,
        log: [`Resolved unless-pays-life step (payer declined to pay ${step.amount} life): ${step.raw}`],
      };
    }

    return {
      applied: false,
      message: `Skipped unless-pays-life step (opponent choice required): ${step.raw}`,
      reason: 'player_choice_required',
      options: {
        classification: 'player_choice',
        metadata: {
          payerId,
          payerLife: lifeTotal,
          lifeAmount: step.amount,
        },
      },
    };
  }

  return {
    applied: true,
    shouldApplyNestedSteps: true,
    log: [`Resolved unless-pays-life step (payer cannot pay ${step.amount} life): ${step.raw}`],
  };
}

export function evaluateUnlessDiscardsStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'unless_discards' }>,
  ctx: OracleIRExecutionContext
): UnlessDiscardsResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length !== 1) {
    return {
      applied: false,
      message: `Skipped unless-discards step (needs player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: {
        classification: 'player_choice',
        metadata: {
          selectorKind: step.who.kind,
          candidateCount: players.length,
          discardAmount: step.amount,
        },
      },
    };
  }

  const discarderId = players[0];
  const discarder = (state.players || []).find(player => String(player?.id || '').trim() === String(discarderId || '').trim()) as any;
  if (!discarder) {
    return {
      applied: false,
      message: `Skipped unless-discards step (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const handSize = Array.isArray(discarder.hand) ? discarder.hand.length : 0;
  const discardAmount = Math.max(0, step.amount | 0);
  const canDiscard = handSize >= discardAmount;
  const explicitChoice =
    ctx.unlessDiscardsChoice === 'discard' || ctx.unlessDiscardsChoice === 'decline'
      ? ctx.unlessDiscardsChoice
      : (ctx.selectorContext?.unlessDiscardsChoice === 'discard' || ctx.selectorContext?.unlessDiscardsChoice === 'decline'
          ? ctx.selectorContext.unlessDiscardsChoice
          : undefined);

  if (canDiscard) {
    if (explicitChoice === 'discard') {
      const discardStep = {
        kind: 'discard',
        who: step.who,
        amount: { kind: 'number', value: discardAmount },
        raw: step.raw,
      } as Extract<OracleEffectStep, { kind: 'discard' }>;
      const discardResult = applyDiscardStep(state, discardStep, ctx);
      if (discardResult.applied === false) {
        return {
          applied: false,
          message: discardResult.message,
          reason: discardResult.reason,
          state: discardResult.state,
          options: discardResult.options,
          innerStep: discardStep,
        };
      }
      return {
        applied: true,
        shouldApplyNestedSteps: false,
        state: discardResult.state,
        log: [
          ...discardResult.log,
          `Resolved unless-discards step (${discarderId} discarded ${discardAmount} card(s)): ${step.raw}`,
        ],
      };
    }

    if (explicitChoice === 'decline') {
      return {
        applied: true,
        shouldApplyNestedSteps: true,
        log: [`Resolved unless-discards step (${discarderId} declined to discard): ${step.raw}`],
      };
    }

    return {
      applied: false,
      message: `Skipped unless-discards step (opponent choice required): ${step.raw}`,
      reason: 'player_choice_required',
      options: {
        classification: 'player_choice',
        metadata: {
          discarderId,
          handSize,
          discardAmount,
        },
      },
    };
  }

  return {
    applied: true,
    shouldApplyNestedSteps: true,
    log: [`Resolved unless-discards step (${discarderId} cannot discard ${discardAmount} card(s)): ${step.raw}`],
  };
}

export function evaluateUnlessPaysManaStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'unless_pays_mana' }>,
  ctx: OracleIRExecutionContext
): UnlessPaysManaResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length !== 1) {
    return {
      applied: false,
      message: `Skipped unless-pays-mana step (needs player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: {
        classification: 'player_choice',
        metadata: {
          selectorKind: step.who.kind,
          candidateCount: players.length,
          manaCost: step.mana,
        },
      },
    };
  }

  const payerId = players[0];
  const payer = (state.players || []).find(player => String(player?.id || '').trim() === String(payerId || '').trim()) as any;
  if (!payer) {
    return {
      applied: false,
      message: `Skipped unless-pays-mana step (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const manaCost = parseSupportedManaCostString(step.mana, Number(ctx.xValue));
  if (!manaCost) {
    return {
      applied: false,
      message: `Skipped unless-pays-mana step (unsupported mana cost): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'ambiguous' },
    };
  }

  const explicitChoice =
    ctx.unlessPaysManaChoice === 'pay' || ctx.unlessPaysManaChoice === 'decline'
      ? ctx.unlessPaysManaChoice
      : (ctx.selectorContext?.unlessPaysManaChoice === 'pay' || ctx.selectorContext?.unlessPaysManaChoice === 'decline'
          ? ctx.selectorContext.unlessPaysManaChoice
          : (ctx.unlessPaysLifeChoice === 'pay' || ctx.unlessPaysLifeChoice === 'decline'
              ? ctx.unlessPaysLifeChoice
              : (ctx.selectorContext?.unlessPaysLifeChoice === 'pay' || ctx.selectorContext?.unlessPaysLifeChoice === 'decline'
                  ? ctx.selectorContext.unlessPaysLifeChoice
                  : undefined)));

  const manaPoolRecord: Record<PlayerID, any> = { ...((((state as any).manaPool || {}) as any) || {}) };
  const currentPool = manaPoolRecord[payerId] || createEmptyManaPool();
  const payment = payManaCost(currentPool, manaCost);
  const canPayMana = Boolean(payment.success && payment.remainingPool);

  if (canPayMana) {
    if (explicitChoice === 'pay') {
      manaPoolRecord[payerId] = payment.remainingPool;
      return {
        applied: true,
        shouldApplyNestedSteps: false,
        state: { ...(state as any), manaPool: manaPoolRecord } as any,
        log: [`Resolved unless-pays-mana step (payer chose to pay ${step.mana}): ${step.raw}`],
      };
    }

    if (explicitChoice === 'decline') {
      return {
        applied: true,
        shouldApplyNestedSteps: true,
        log: [`Resolved unless-pays-mana step (payer declined to pay ${step.mana}): ${step.raw}`],
      };
    }

    return {
      applied: false,
      message: `Skipped unless-pays-mana step (opponent choice required): ${step.raw}`,
      reason: 'player_choice_required',
      options: {
        classification: 'player_choice',
        metadata: {
          payerId,
          manaCost: step.mana,
        },
      },
    };
  }

  return {
    applied: true,
    shouldApplyNestedSteps: true,
    log: [`Resolved unless-pays-mana step (payer cannot pay ${step.mana}): ${step.raw}`],
  };
}

function readPlayerLifeTotal(state: GameState, playerId: string): number {
  const normalizedId = String(playerId || '').trim();
  if (!normalizedId) return 0;

  const lifeRecord = (state as any).life as Record<string, number> | undefined;
  if (lifeRecord && Number.isFinite(Number(lifeRecord[normalizedId]))) {
    return Math.max(0, Math.floor(Number(lifeRecord[normalizedId])));
  }

  const player = (state.players || []).find((entry) => String(entry?.id || '').trim() === normalizedId) as any;
  if (player && Number.isFinite(Number(player.life))) {
    return Math.max(0, Math.floor(Number(player.life)));
  }

  return Math.max(0, Math.floor(Number((state as any).startingLife ?? 40)));
}

function setPlayerLifeTotal(
  state: GameState,
  playerId: string,
  nextLife: number,
): { state: GameState; delta: number } {
  const normalizedId = String(playerId || '').trim() as PlayerID;
  const safeLife = Math.max(0, Math.floor(Number(nextLife) || 0));
  const currentLife = readPlayerLifeTotal(state, normalizedId);
  const delta = safeLife - currentLife;

  const updatedPlayers = (state.players || []).map((player) =>
    String(player?.id || '').trim() === normalizedId ? { ...player, life: safeLife } : player,
  );

  const nextState = {
    ...state,
    players: updatedPlayers as any,
    life: {
      ...(((state as any).life && typeof (state as any).life === 'object') ? (state as any).life : {}),
      [normalizedId]: safeLife,
    },
  } as GameState;

  return { state: nextState, delta };
}

export function applyRedistributeLifeTotalsStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'redistribute_life_totals' }>,
  ctx: OracleIRExecutionContext,
): PlayerStepHandlerResult {
  const redistributionRaw = (ctx.selectorContext as any)?.lifeRedistributionByPlayerId;
  const redistribution =
    redistributionRaw && typeof redistributionRaw === 'object' && !Array.isArray(redistributionRaw)
      ? redistributionRaw as Record<string, number>
      : null;

  const activePlayers = (state.players || [])
    .map((player) => String(player?.id || '').trim())
    .filter(Boolean);

  if (activePlayers.length <= 1) {
    return {
      applied: true,
      state,
      log: [`Redistribute life totals had no other players: ${step.raw}`],
    };
  }

  if (redistribution) {
    const participantIds = Object.keys(redistribution)
      .map((playerId) => String(playerId || '').trim())
      .filter((playerId) => activePlayers.includes(playerId));

    if (participantIds.length === 0) {
      return {
        applied: true,
        state,
        log: [`Redistribute life totals: no players selected (${step.raw})`],
      };
    }

    const poolTotal = participantIds.reduce(
      (sum, playerId) => sum + readPlayerLifeTotal(state, playerId),
      0,
    );
    const assignedTotal = participantIds.reduce(
      (sum, playerId) => sum + Math.max(0, Math.floor(Number(redistribution[playerId]) || 0)),
      0,
    );
    if (assignedTotal !== poolTotal) {
      return {
        applied: false,
        message: `Skipped redistribute life totals (assigned total ${assignedTotal} != pool ${poolTotal}): ${step.raw}`,
        reason: 'failed_to_apply',
        options: { classification: 'invalid_input' },
      };
    }

    let nextState = state;
    const log: string[] = [];
    const replayMutations: OracleIRReplayMutation[] = [];

    for (const playerId of participantIds) {
      const nextLife = Math.max(0, Math.floor(Number(redistribution[playerId]) || 0));
      const currentLife = readPlayerLifeTotal(nextState, playerId);
      if (nextLife === currentLife) continue;
      const result = setPlayerLifeTotal(nextState, playerId, nextLife);
      nextState = result.state;
      if (result.delta !== 0) {
        log.push(`${playerId} life total set to ${nextLife} (was ${currentLife})`);
        replayMutations.push({ kind: 'adjustLife', playerId: playerId as PlayerID, delta: result.delta });
      }
    }

    return {
      applied: true,
      state: nextState,
      log: log.length > 0 ? log : [`Redistribute life totals left life unchanged (${step.raw})`],
      ...(replayMutations.length > 0 ? { replayMutations } : {}),
    };
  }

  return {
    applied: false,
    message: `Skipped redistribute life totals (requires player choice): ${step.raw}`,
    reason: 'player_choice_required',
    options: {
      classification: 'player_choice',
      metadata: {
        playerIds: activePlayers,
        playerLifeTotals: Object.fromEntries(
          activePlayers.map((playerId) => [playerId, readPlayerLifeTotal(state, playerId)]),
        ),
      },
    },
  };
}
