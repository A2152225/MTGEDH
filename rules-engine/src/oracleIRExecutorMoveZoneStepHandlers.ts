import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { parseSimpleBattlefieldSelector } from './oracleIRExecutorBattlefieldParser';
import { evaluateConditionalWrapperCondition } from './oracleIRExecutorConditionalStepSupport';
import { hasExecutorClass } from './oracleIRExecutorPermanentUtils';
import {
  bounceMatchingBattlefieldPermanentsToOwnersHands,
  moveBattlefieldPermanentsByIdToOwnersHands,
} from './oracleIRExecutorBattlefieldOps';
import {
  exileExactMatchingFromGraveyard,
  exileAllMatchingFromGraveyard,
  moveAllMatchingFromExile,
  moveAllMatchingFromHand,
  moveTargetedCardFromAnyGraveyard,
  moveTargetedCardFromGraveyard,
  moveTargetedCardFromHand,
  moveTargetedCardFromExile,
  parseMoveZoneRandomSingleFromYourGraveyard,
  parseMoveZoneAllFromEachOpponentsExile,
  parseMoveZoneAllFromEachOpponentsGraveyard,
  parseMoveZoneAllFromEachOpponentsHand,
  parseMoveZoneAllFromEachPlayersExile,
  parseMoveZoneAllFromEachPlayersGraveyard,
  parseMoveZoneAllFromEachPlayersHand,
  parseMoveZoneAllFromTargetPlayersExile,
  parseMoveZoneAllFromTargetPlayersGraveyard,
  parseMoveZoneAllFromTargetPlayersHand,
  parseMoveZoneCountFromTargetPlayersGraveyard,
  parseMoveZoneSingleTargetFromAGraveyard,
  parseMoveZoneSingleTargetFromTargetPlayersGraveyard,
  parseMoveZoneSingleTargetFromTargetPlayersHand,
  parseMoveZoneSingleTargetFromTargetPlayersExile,
  parseMoveZoneSingleTargetFromYourGraveyard,
  parseMoveZoneTargetAndSameNamedFromYourGraveyard,
  parseMoveZoneSingleTargetFromYourHand,
  parseMoveZoneSingleTargetFromYourExile,
  parseMoveZoneAllFromYourExile,
  parseMoveZoneAllFromYourGraveyard,
  parseMoveZoneAllFromYourHand,
  parseMoveZoneCountFromYourGraveyard,
  cardMatchesMoveZoneSingleTargetCriteria,
  selectRandomMatchingCardIdFromGraveyard,
  putExactMatchingFromGraveyardOntoBattlefieldWithController,
  putAllMatchingFromExileOntoBattlefield,
  putAllMatchingFromExileOntoBattlefieldWithController,
  putAllMatchingFromGraveyardOntoBattlefield,
  putAllMatchingFromGraveyardOntoBattlefieldWithController,
  putAllMatchingFromHandOntoBattlefield,
  putAllMatchingFromHandOntoBattlefieldWithController,
  returnExactMatchingFromGraveyardToHand,
  returnTargetAndSameNamedCardsFromYourGraveyardToHand,
  returnAllMatchingFromGraveyardToHand,
} from './oracleIRExecutorZoneOps';

type StepApplyResult = {
  readonly applied: true;
  readonly state: GameState;
  readonly log: readonly string[];
  readonly lastMovedCards?: readonly any[];
  readonly lastMovedBattlefieldPermanentIds?: readonly string[];
};

type StepSkipResult = {
  readonly applied: false;
  readonly message: string;
  readonly reason:
    | 'unsupported_destination'
    | 'unsupported_selector'
    | 'battlefield_requires_explicit_control_override'
    | 'player_choice_required'
    | 'impossible_action';
  readonly options?: {
    readonly classification?: 'unsupported' | 'ambiguous' | 'player_choice' | 'invalid_input';
    readonly metadata?: Record<string, string | number | boolean | null | readonly string[]>;
    readonly persist?: boolean;
  };
};

export type MoveZoneStepHandlerResult = StepApplyResult | StepSkipResult;

type MoveZoneRuntime = {
  readonly lastMovedCards?: readonly any[];
};

type BoundCardZoneLocation = {
  readonly playerId: PlayerID;
  readonly zone: 'graveyard' | 'hand' | 'exile';
};

function buildAppliedResult(result: {
  readonly state: GameState;
  readonly log: readonly string[];
  readonly movedCards?: readonly any[];
  readonly movedPermanentIds?: readonly string[];
}): StepApplyResult {
  return {
    applied: true,
    state: result.state,
    log: result.log,
    ...(Array.isArray(result.movedCards) ? { lastMovedCards: [...result.movedCards] } : {}),
    ...(Array.isArray(result.movedPermanentIds)
      ? { lastMovedBattlefieldPermanentIds: [...result.movedPermanentIds] }
      : {}),
  };
}

function getControllerId(ctx: OracleIRExecutionContext): PlayerID {
  return (String(ctx.controllerId || '').trim() || ctx.controllerId) as PlayerID;
}

function getOpponents(state: GameState, controllerId: PlayerID): any[] {
  const players = (state.players || []) as any[];
  const hasValidController = players.some(p => p?.id === controllerId);
  return hasValidController ? players.filter(p => p?.id && p.id !== controllerId) : [];
}

function getTargetPlayerId(ctx: OracleIRExecutionContext): PlayerID | '' {
  return (String(ctx.selectorContext?.targetPlayerId || ctx.selectorContext?.targetOpponentId || '').trim() || '') as PlayerID | '';
}

function getChosenObjectIds(ctx: OracleIRExecutionContext): readonly string[] {
  const chosen = Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const candidate of chosen) {
    const normalized = String(candidate || '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    ids.push(normalized);
  }
  return ids;
}

function normalizeReferenceText(value: unknown): string {
  return String(value || '')
    .replace(/\u2019/g, "'")
    .toLowerCase()
    .replace(/[.\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildNameReferenceAliases(value: unknown): readonly string[] {
  const normalized = normalizeReferenceText(value);
  if (!normalized) return [];

  const aliases = new Set<string>();
  aliases.add(normalized);
  for (const face of normalized.split(/\s*\/\/\s*/).map(part => part.trim()).filter(Boolean)) {
    aliases.add(face);
    const commaHead = String(face.split(',')[0] || '').trim();
    if (commaHead.length >= 4) aliases.add(commaHead);
  }

  return [...aliases];
}

function getTargetObjectId(ctx: OracleIRExecutionContext): string {
  return String(ctx.targetPermanentId || ctx.targetCreatureId || '').trim();
}

function isAnotherTargetReference(what: unknown): boolean {
  const text = String((what as any)?.text || (what as any)?.raw || '')
    .replace(/\u2019/g, "'")
    .trim()
    .toLowerCase();
  return /^(?:up to one\s+)?another\s+target\b/.test(text);
}

function getBoundTargetObjectId(
  ctx: OracleIRExecutionContext,
  step: Extract<OracleEffectStep, { kind: 'move_zone' }>,
  runtime?: MoveZoneRuntime
): string {
  const directId = getTargetObjectId(ctx);
  if (!isAnotherTargetReference(step.what)) {
    if (directId) return directId;
    const chosen = getChosenObjectIds(ctx);
    return chosen.length === 1 ? chosen[0] : '';
  }

  const excluded = new Set<string>();
  if (directId) excluded.add(directId);
  for (const moved of Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : []) {
    const movedId = String((moved as any)?.id || '').trim();
    if (movedId) excluded.add(movedId);
  }

  const remaining = getChosenObjectIds(ctx).filter(id => !excluded.has(id));
  return remaining.length === 1 ? remaining[0] : '';
}

function isUpToOneTargetReference(what: unknown): boolean {
  const text = String((what as any)?.text || (what as any)?.raw || '')
    .replace(/\u2019/g, "'")
    .trim()
    .toLowerCase();
  return /^up to one\s+(?:another\s+)?target\b/.test(text);
}

function buildNoOpOptionalSingleTargetResult(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'move_zone' }>
): StepApplyResult {
  return {
    applied: true,
    state,
    log: [`Skipped optional targetless move zone slot: ${step.raw}`],
    lastMovedCards: [],
  };
}

function resolveUniqueChosenGraveyardTargetId(
  state: GameState,
  playerId: PlayerID,
  criteria: import('./oracleIRExecutorZoneOps').MoveZoneSingleTargetCriteria,
  ctx: OracleIRExecutionContext,
  runtime: MoveZoneRuntime | undefined,
  referenceCardName?: string
): string {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return '';

  const chosen = new Set(getChosenObjectIds(ctx));
  if (chosen.size === 0) return '';

  const excluded = new Set<string>();
  for (const moved of Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : []) {
    const movedId = String((moved as any)?.id || '').trim();
    if (movedId) excluded.add(movedId);
  }

  const graveyard = Array.isArray(player.graveyard) ? player.graveyard : [];
  const matches = graveyard.filter((card: any) => {
    const cardId = String(card?.id || '').trim();
    if (!cardId || !chosen.has(cardId) || excluded.has(cardId)) return false;
    return cardMatchesMoveZoneSingleTargetCriteria(card, criteria, referenceCardName);
  });

  return matches.length === 1 ? String((matches[0] as any)?.id || '').trim() : '';
}

function isContextualBoundCardReference(what: unknown): boolean {
  const text = String((what as any)?.text || (what as any)?.raw || '')
    .replace(/\u2019/g, "'")
    .trim()
    .toLowerCase();
  return (
    text === 'it' ||
    /^that (?:(?:[a-z0-9+'/-]+\s+)*(?:card|creature|permanent))(?: from (?:(?:the |your |their |target player's |target opponent's |an opponent's |its owner's |its controller's |that player's |one of your opponents' )?(?:graveyard|hand|exile)))?$/.test(
      text
    )
  );
}

function isContextualBoundCardsReference(what: unknown): boolean {
  const text = String((what as any)?.text || (what as any)?.raw || '')
    .replace(/\u2019/g, "'")
    .trim()
    .toLowerCase();
  return /^(?:those cards|those creatures|those permanents)(?: from (?:(?:the |your |their |target player's |target opponent's |an opponent's |its owner's |its controller's |that player's |one of your opponents' )?(?:graveyard|hand|exile)))?$/.test(
    text
  );
}

function findBoundCardZoneLocation(state: GameState, targetCardId: string): BoundCardZoneLocation | null {
  const wantedId = String(targetCardId || '').trim();
  if (!wantedId) return null;

  const matches: BoundCardZoneLocation[] = [];
  for (const player of state.players || []) {
    const playerId = String((player as any)?.id || '').trim() as PlayerID;
    if (!playerId) continue;

    for (const zone of ['graveyard', 'hand', 'exile'] as const) {
      const cards = Array.isArray((player as any)?.[zone]) ? (player as any)[zone] : [];
      if (cards.some((card: any) => String(card?.id || '').trim() === wantedId)) {
        matches.push({ playerId, zone });
      }
    }
  }

  return matches.length === 1 ? matches[0] : null;
}

function resolveSourceCardZoneLocation(
  state: GameState,
  what: unknown,
  ctx: OracleIRExecutionContext
): BoundCardZoneLocation & { readonly cardId: string } | null {
  const rawText = normalizeReferenceText((what as any)?.text || (what as any)?.raw || '');
  if (!rawText) return null;

  const selfReference = /^(?:this card|this permanent|this aura|this equipment|this enchantment|this artifact|this creature|this land)$/i.test(
    rawText
  );
  const sourceNameAliases = new Set(buildNameReferenceAliases(ctx.sourceName));
  const matchesSourceName = sourceNameAliases.has(rawText);
  if (!selfReference && !matchesSourceName) return null;

  const sourceId = String(ctx.sourceId || '').trim();
  if (sourceId) {
    const exactLocation = findBoundCardZoneLocation(state, sourceId);
    if (exactLocation) {
      return { ...exactLocation, cardId: sourceId };
    }
  }

  const matches: Array<BoundCardZoneLocation & { readonly cardId: string }> = [];
  for (const player of state.players || []) {
    const playerId = String((player as any)?.id || '').trim() as PlayerID;
    if (!playerId) continue;

    for (const zone of ['graveyard', 'hand', 'exile'] as const) {
      const cards = Array.isArray((player as any)?.[zone]) ? (player as any)[zone] : [];
      for (const card of cards) {
        const cardId = String((card as any)?.id || '').trim();
        const cardNameAliases = new Set(buildNameReferenceAliases((card as any)?.name));
        if (!cardId || cardNameAliases.size === 0) continue;
        if ([...sourceNameAliases].some(alias => cardNameAliases.has(alias))) {
          matches.push({ playerId, zone, cardId });
        }
      }
    }
  }

  return matches.length === 1 ? matches[0] : null;
}

type BattlefieldAttachmentResolution =
  | { readonly kind: 'none' }
  | { readonly kind: 'resolved'; readonly permanentId: string }
  | { readonly kind: 'player_choice_required'; readonly selector: string }
  | { readonly kind: 'impossible'; readonly selector: string }
  | { readonly kind: 'unsupported'; readonly selector: string };

function resolveBattlefieldAttachment(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'move_zone' }>,
  ctx: OracleIRExecutionContext
): BattlefieldAttachmentResolution {
  if (step.to !== 'battlefield' || !step.battlefieldAttachedTo) return { kind: 'none' };
  if ((step.battlefieldAttachedTo as any)?.kind !== 'raw') {
    return { kind: 'unsupported', selector: String((step.battlefieldAttachedTo as any)?.raw || '') };
  }

  const selectorText = String((step.battlefieldAttachedTo as any)?.text || '').trim();
  const normalized = selectorText.replace(/\u2019/g, "'").toLowerCase().replace(/\s+/g, ' ').trim();
  const battlefield = (state.battlefield || []) as any[];
  const chosenObjectIds = getChosenObjectIds(ctx);
  const contextualPermanentIds = Array.from(
    new Set(
      [String(ctx.targetPermanentId || ctx.targetCreatureId || '').trim(), ...chosenObjectIds].filter(Boolean)
    )
  );

  if (normalized === 'this creature') {
    const sourceId = String(ctx.sourceId || '').trim();
    const sourcePermanent = sourceId
      ? battlefield.find(perm => String((perm as any)?.id || '').trim() === sourceId)
      : undefined;
    if (!sourcePermanent || !hasExecutorClass(sourcePermanent as any, 'creature')) {
      return { kind: 'impossible', selector: selectorText || normalized };
    }
    return { kind: 'resolved', permanentId: sourceId };
  }

  if (normalized === 'a creature you control') {
    const controllerId = getControllerId(ctx);
    const controlledCreatures = battlefield.filter(
      perm => perm?.controller === controllerId && hasExecutorClass(perm as any, 'creature')
    );
    if (controlledCreatures.length === 0) return { kind: 'impossible', selector: selectorText || normalized };
    if (controlledCreatures.length > 1) {
      return { kind: 'player_choice_required', selector: selectorText || normalized };
    }
    return { kind: 'resolved', permanentId: String((controlledCreatures[0] as any)?.id || '').trim() };
  }

  if (normalized === 'that creature' || normalized === 'that land' || normalized === 'that permanent') {
    const expectedType = normalized === 'that land' ? 'land' : normalized === 'that creature' ? 'creature' : undefined;
    const matches = battlefield.filter(perm => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (!contextualPermanentIds.includes(permanentId)) return false;
      if (expectedType && !hasExecutorClass(perm as any, expectedType)) return false;
      return true;
    });
    if (matches.length === 0) return { kind: 'impossible', selector: selectorText || normalized };
    if (matches.length > 1) return { kind: 'player_choice_required', selector: selectorText || normalized };
    return { kind: 'resolved', permanentId: String((matches[0] as any)?.id || '').trim() };
  }

  return { kind: 'unsupported', selector: selectorText || normalized };
}

function getLibraryPlacement(step: Extract<OracleEffectStep, { kind: 'move_zone' }>): 'top' | 'bottom' | '' {
  if (step.to !== 'library') return '';
  const toRaw = String(step.toRaw || '').trim().toLowerCase();
  const hasTop = /^(?:on\s+)?top of\b/i.test(toRaw);
  const hasBottom = /^(?:on\s+)?(?:the\s+)?bottom of\b/i.test(toRaw);
  if (hasTop && hasBottom) return '';
  if (hasTop) return 'top';
  if (hasBottom) return 'bottom';
  return '';
}

function requiresExplicitControllerOverride(step: Extract<OracleEffectStep, { kind: 'move_zone' }>): boolean {
  return (
    step.to === 'battlefield' &&
    step.battlefieldController?.kind !== 'you' &&
    step.battlefieldController?.kind !== 'owner_of_moved_cards'
  );
}

function applyBattlefieldEntryCharacteristicsToState(
  state: GameState,
  permanentIds: readonly string[] | undefined,
  addTypes: readonly string[] | undefined,
  addColors: readonly string[] | undefined
): GameState {
  const ids = new Set((permanentIds || []).map(id => String(id || '').trim()).filter(Boolean));
  if (ids.size === 0) return state;

  const normalizedTypes = (addTypes || []).map(type => String(type || '').trim()).filter(Boolean);
  const normalizedColors = (addColors || []).map(color => String(color || '').trim().toUpperCase()).filter(Boolean);
  if (normalizedTypes.length === 0 && normalizedColors.length === 0) return state;

  const battlefield = (state.battlefield || []) as any[];
  let changed = false;
  const nextBattlefield = battlefield.map((permanent: any) => {
    const permanentId = String(permanent?.id || '').trim();
    if (!ids.has(permanentId)) return permanent;

    const nextPermanent: any = { ...permanent };

    if (normalizedTypes.length > 0) {
      const grantedTypes = Array.isArray(nextPermanent.grantedTypes) ? [...nextPermanent.grantedTypes] : [];
      for (const typeName of normalizedTypes) {
        if (!grantedTypes.includes(typeName)) grantedTypes.push(typeName);
      }
      nextPermanent.grantedTypes = grantedTypes;
      changed = true;
    }

    if (normalizedColors.length > 0) {
      const colors = Array.isArray(nextPermanent.colors)
        ? [...nextPermanent.colors]
        : (Array.isArray(nextPermanent.card?.colors) ? [...nextPermanent.card.colors] : []);
      for (const color of normalizedColors) {
        if (!colors.includes(color)) colors.push(color);
      }
      nextPermanent.colors = colors;
      changed = true;
    }

    return nextPermanent;
  });

  return changed ? ({ ...state, battlefield: nextBattlefield as any } as any) : state;
}

export function applyMoveZoneStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'move_zone' }>,
  ctx: OracleIRExecutionContext,
  runtime?: MoveZoneRuntime
): MoveZoneStepHandlerResult {
  if (step.to !== 'hand' && step.to !== 'exile' && step.to !== 'graveyard' && step.to !== 'battlefield' && step.to !== 'library') {
    return {
      applied: false,
      message: `Skipped move zone (unsupported destination): ${step.raw}`,
      reason: 'unsupported_destination',
    };
  }

  let nextState = state;
  const log: string[] = [];
  const controllerId = getControllerId(ctx);
  let effectiveWithCounters = step.withCounters;
  let effectiveBattlefieldAddTypes = step.battlefieldAddTypes;
  let effectiveBattlefieldAddColors = step.battlefieldAddColors;

  if (step.withCounters && step.withCountersCondition) {
    const conditionEvaluation = evaluateConditionalWrapperCondition({
      condition: step.withCountersCondition,
      nextState,
      controllerId,
      ctx,
      lastActionOutcome: null,
    });

    if (conditionEvaluation === null) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported condition): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (conditionEvaluation === false) {
      effectiveWithCounters = undefined;
    }
  }

  if ((step.battlefieldAddTypes || step.battlefieldAddColors) && step.battlefieldCharacteristicsCondition) {
    const conditionEvaluation = evaluateConditionalWrapperCondition({
      condition: step.battlefieldCharacteristicsCondition,
      nextState,
      controllerId,
      ctx,
      lastActionOutcome: null,
    });

    if (conditionEvaluation === null) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported battlefield-entry characteristic condition): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (conditionEvaluation === false) {
      effectiveBattlefieldAddTypes = undefined;
      effectiveBattlefieldAddColors = undefined;
    }
  }

  const finalizeAppliedResult = (result: {
    readonly state: GameState;
    readonly log: readonly string[];
    readonly movedCards?: readonly any[];
    readonly movedPermanentIds?: readonly string[];
  }): StepApplyResult => {
    const stateWithCharacteristics =
      step.to === 'battlefield'
        ? applyBattlefieldEntryCharacteristicsToState(
            result.state,
            result.movedPermanentIds,
            effectiveBattlefieldAddTypes,
            effectiveBattlefieldAddColors
          )
        : result.state;
    return buildAppliedResult({ ...result, state: stateWithCharacteristics });
  };

  const attachmentResolution = resolveBattlefieldAttachment(nextState, step, ctx);

  if (attachmentResolution.kind === 'unsupported') {
    return {
      applied: false,
      message: `Skipped move zone (unsupported attachment target): ${step.raw}`,
      reason: 'unsupported_selector',
    };
  }

  if (attachmentResolution.kind === 'player_choice_required') {
    return {
      applied: false,
      message: `Skipped move zone (needs player attachment choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: {
        classification: 'player_choice',
        metadata: {
          destination: step.to,
          attachmentSelector: attachmentResolution.selector,
        },
      },
    };
  }

  if (attachmentResolution.kind === 'impossible') {
    return {
      applied: false,
      message: `Skipped move zone (attachment target unavailable): ${step.raw}`,
      reason: 'impossible_action',
      options: {
        persist: false,
        metadata: {
          destination: step.to,
          attachmentSelector: attachmentResolution.selector,
        },
      },
    };
  }

  if (step.to === 'hand' && (step.what as any)?.kind === 'raw') {
    const whatText = String((step.what as any).text || '').trim();
    const directBattlefieldTargetId = getTargetObjectId(ctx);
    const battlefieldTargetLikeReference =
      /^(?:up to one\s+)?(?:another\s+)?target\b/i.test(whatText) ||
      /^(?:it|that card|that creature|that permanent)$/i.test(whatText);
    if (directBattlefieldTargetId && battlefieldTargetLikeReference) {
      const hasDirectBattlefieldTarget = ((nextState.battlefield || []) as any[]).some(
        perm => String((perm as any)?.id || '').trim() === directBattlefieldTargetId
      );
      if (hasDirectBattlefieldTarget) {
        const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, [directBattlefieldTargetId]);
        return finalizeAppliedResult(result);
      }
    }

    if (whatText && !/\b(from|card|cards)\b/i.test(whatText)) {
      const selector = parseSimpleBattlefieldSelector(step.what as any);
      if (selector) {
        const result = bounceMatchingBattlefieldPermanentsToOwnersHands(nextState, selector, ctx);
        return finalizeAppliedResult(result);
      }
    }
  }

  const parsedFromGraveyard = parseMoveZoneAllFromYourGraveyard(step.what as any);
  const parsedCountFromGraveyard = parseMoveZoneCountFromYourGraveyard(step.what as any);
  const parsedTargetCountFromGraveyard = parseMoveZoneCountFromTargetPlayersGraveyard(step.what as any);
  const parsedSingleTargetFromAnyGraveyard = parseMoveZoneSingleTargetFromAGraveyard(step.what as any);
  const parsedSingleTargetFromTargetPlayerGraveyard = parseMoveZoneSingleTargetFromTargetPlayersGraveyard(step.what as any);
  const parsedSingleTargetFromTargetPlayerHand = parseMoveZoneSingleTargetFromTargetPlayersHand(step.what as any);
  const parsedSingleTargetFromTargetPlayerExile = parseMoveZoneSingleTargetFromTargetPlayersExile(step.what as any);
  const parsedSingleTargetFromYourGraveyard = parseMoveZoneSingleTargetFromYourGraveyard(step.what as any);
  const parsedRandomSingleFromYourGraveyard = parseMoveZoneRandomSingleFromYourGraveyard(step.what as any);
  const parsedSameNamedFromYourGraveyard = parseMoveZoneTargetAndSameNamedFromYourGraveyard(step.what as any);
  const parsedSingleTargetFromYourHand = parseMoveZoneSingleTargetFromYourHand(step.what as any);
  const parsedSingleTargetFromYourExile = parseMoveZoneSingleTargetFromYourExile(step.what as any);
  const parsedFromHand = parseMoveZoneAllFromYourHand(step.what as any);
  const parsedFromExile = parseMoveZoneAllFromYourExile(step.what as any);
  const parsedEachPlayersGy = parseMoveZoneAllFromEachPlayersGraveyard(step.what as any);
  const parsedEachPlayersHand = parseMoveZoneAllFromEachPlayersHand(step.what as any);
  const parsedEachPlayersExile = parseMoveZoneAllFromEachPlayersExile(step.what as any);
  const parsedEachOpponentsGy = parseMoveZoneAllFromEachOpponentsGraveyard(step.what as any);
  const parsedEachOpponentsHand = parseMoveZoneAllFromEachOpponentsHand(step.what as any);
  const parsedEachOpponentsExile = parseMoveZoneAllFromEachOpponentsExile(step.what as any);
  const parsedTargetPlayerHand = parseMoveZoneAllFromTargetPlayersHand(step.what as any);
  const parsedTargetPlayerExile = parseMoveZoneAllFromTargetPlayersExile(step.what as any);
  const parsedTargetPlayerGy = parseMoveZoneAllFromTargetPlayersGraveyard(step.what as any);
  const boundTargetObjectId = getBoundTargetObjectId(ctx, step, runtime);
  const contextualBoundCardIds =
    isContextualBoundCardsReference(step.what as any)
      ? Array.from(
          new Set([String(ctx.targetPermanentId || ctx.targetCreatureId || '').trim(), ...getChosenObjectIds(ctx)].filter(Boolean))
        )
      : [];
  const contextualBoundCardZone =
    isContextualBoundCardReference(step.what as any) && boundTargetObjectId
      ? findBoundCardZoneLocation(nextState, boundTargetObjectId)
      : null;
  const sourceCardZone = resolveSourceCardZoneLocation(nextState, step.what as any, ctx);

  if (
    !parsedFromGraveyard &&
    !parsedCountFromGraveyard &&
    !parsedTargetCountFromGraveyard &&
    !parsedSingleTargetFromAnyGraveyard &&
    !parsedSingleTargetFromTargetPlayerGraveyard &&
    !parsedSingleTargetFromTargetPlayerHand &&
    !parsedSingleTargetFromTargetPlayerExile &&
    !parsedSingleTargetFromYourGraveyard &&
    !parsedRandomSingleFromYourGraveyard &&
    !parsedSameNamedFromYourGraveyard &&
    !parsedSingleTargetFromYourHand &&
    !parsedSingleTargetFromYourExile &&
    !parsedFromHand &&
    !parsedFromExile &&
    !parsedEachPlayersGy &&
    !parsedEachPlayersHand &&
    !parsedEachPlayersExile &&
    !parsedEachOpponentsGy &&
    !parsedEachOpponentsHand &&
    !parsedEachOpponentsExile &&
    !parsedTargetPlayerHand &&
    !parsedTargetPlayerExile &&
    !parsedTargetPlayerGy &&
    contextualBoundCardIds.length === 0 &&
    !contextualBoundCardZone &&
    !sourceCardZone
  ) {
    return {
      applied: false,
      message: `Skipped move zone (unsupported selector): ${step.raw}`,
      reason: 'unsupported_selector',
    };
  }

  if (contextualBoundCardIds.length > 0) {
    const libraryPlacement = getLibraryPlacement(step);
    if (!['hand', 'exile'].includes(step.to) && !(step.to === 'library' && libraryPlacement)) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const targetObjectId of contextualBoundCardIds) {
      const exactZone = findBoundCardZoneLocation(workingState, targetObjectId);
      if (!exactZone) {
        return {
          applied: false,
          message: `Skipped move zone (target object unavailable): ${step.raw}`,
          reason: 'impossible_action',
          options: { persist: false },
        };
      }

      const destination =
        step.to === 'library'
          ? (libraryPlacement === 'top' ? 'library_top' : 'library_bottom')
          : step.to;
      const result =
        exactZone.zone === 'graveyard'
          ? moveTargetedCardFromGraveyard(workingState, exactZone.playerId, targetObjectId, { cardType: 'any' }, destination as any)
          : exactZone.zone === 'hand'
            ? moveTargetedCardFromHand(workingState, exactZone.playerId, targetObjectId, 'any', destination as any)
            : moveTargetedCardFromExile(workingState, exactZone.playerId, targetObjectId, 'any', destination as any);

      if (result.kind === 'impossible') {
        return {
          applied: false,
          message: `Skipped move zone (target object unavailable): ${step.raw}`,
          reason: 'impossible_action',
          options: { persist: false },
        };
      }

      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }

    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved ${contextualBoundCardIds.length} contextual card(s)`],
    });
  }

  if (contextualBoundCardZone) {
    const targetObjectId = boundTargetObjectId;
    const libraryPlacement = getLibraryPlacement(step);
    if (!targetObjectId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (step.to !== 'hand' && step.to !== 'exile' && step.to !== 'battlefield' && !(step.to === 'library' && libraryPlacement)) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    const contextualBattlefieldControllerId =
      step.to === 'battlefield'
        ? step.battlefieldController?.kind === 'you'
          ? controllerId
          : contextualBoundCardZone.playerId
        : undefined;

    const destination =
      step.to === 'library'
        ? (libraryPlacement === 'top' ? 'library_top' : 'library_bottom')
        : step.to;

    const result =
      contextualBoundCardZone.zone === 'graveyard'
        ? moveTargetedCardFromGraveyard(
            nextState,
            contextualBoundCardZone.playerId,
            targetObjectId,
            { cardType: 'any' },
            destination as any,
            contextualBattlefieldControllerId,
            step.entersTapped,
            effectiveWithCounters,
            attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined
          )
        : contextualBoundCardZone.zone === 'hand'
          ? moveTargetedCardFromHand(
              nextState,
              contextualBoundCardZone.playerId,
              targetObjectId,
              'any',
              destination as any,
              contextualBattlefieldControllerId,
              step.entersTapped,
              effectiveWithCounters,
              attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined
            )
          : moveTargetedCardFromExile(
              nextState,
              contextualBoundCardZone.playerId,
              targetObjectId,
              'any',
              destination as any,
              contextualBattlefieldControllerId,
              step.entersTapped,
              effectiveWithCounters,
              attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined
            );

    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (target object unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (sourceCardZone) {
    const libraryPlacement = getLibraryPlacement(step);
    if (step.to !== 'hand' && step.to !== 'exile' && step.to !== 'battlefield' && !(step.to === 'library' && libraryPlacement)) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    const destination =
      step.to === 'library'
        ? (libraryPlacement === 'top' ? 'library_top' : 'library_bottom')
        : step.to;
    const battlefieldControllerId =
      step.to === 'battlefield'
        ? step.battlefieldController?.kind === 'you'
          ? controllerId
          : sourceCardZone.playerId
        : undefined;
    const result =
      sourceCardZone.zone === 'graveyard'
        ? moveTargetedCardFromGraveyard(
            nextState,
            sourceCardZone.playerId,
            sourceCardZone.cardId,
            { cardType: 'any' },
            destination as any,
            battlefieldControllerId,
            step.entersTapped,
            effectiveWithCounters,
            attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined
          )
        : sourceCardZone.zone === 'hand'
          ? moveTargetedCardFromHand(
              nextState,
              sourceCardZone.playerId,
              sourceCardZone.cardId,
              'any',
              destination as any,
              battlefieldControllerId,
              step.entersTapped,
              effectiveWithCounters,
              attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined
            )
          : moveTargetedCardFromExile(
              nextState,
              sourceCardZone.playerId,
              sourceCardZone.cardId,
              'any',
              destination as any,
              battlefieldControllerId,
              step.entersTapped,
              effectiveWithCounters,
              attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined
            );

    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (source card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (parsedTargetPlayerGy) {
    const targetPlayerId = getTargetPlayerId(ctx);
    if (!targetPlayerId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (step.to !== 'exile' && step.to !== 'hand' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    if (requiresExplicitControllerOverride(step)) {
      return {
        applied: false,
        message: `Skipped move zone (battlefield requires explicit control override): ${step.raw}`,
        reason: 'battlefield_requires_explicit_control_override',
      };
    }

    const result =
      step.to === 'hand'
        ? returnAllMatchingFromGraveyardToHand(nextState, targetPlayerId, parsedTargetPlayerGy.cardType)
        : step.to === 'battlefield'
          ? step.battlefieldController?.kind === 'owner_of_moved_cards'
            ? putAllMatchingFromGraveyardOntoBattlefield(
                nextState,
                targetPlayerId,
                parsedTargetPlayerGy.cardType,
                step.entersTapped,
                effectiveWithCounters
              )
            : putAllMatchingFromGraveyardOntoBattlefieldWithController(
                nextState,
                targetPlayerId,
                controllerId,
                parsedTargetPlayerGy.cardType,
                step.entersTapped,
                effectiveWithCounters
              )
          : exileAllMatchingFromGraveyard(nextState, targetPlayerId, parsedTargetPlayerGy.cardType);
    return finalizeAppliedResult(result);
  }

  if (parsedSameNamedFromYourGraveyard) {
    const targetObjectId = boundTargetObjectId;
    if (!targetObjectId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (step.to !== 'hand') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    const result = returnTargetAndSameNamedCardsFromYourGraveyardToHand(
      nextState,
      controllerId,
      targetObjectId,
      parsedSameNamedFromYourGraveyard
    );
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (target object unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (parsedRandomSingleFromYourGraveyard) {
    const selection = selectRandomMatchingCardIdFromGraveyard(
      nextState,
      controllerId,
      parsedRandomSingleFromYourGraveyard,
      ctx.sourceName
    );
    if (selection.kind === 'missing_player') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    if (selection.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (target object unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }

    const libraryPlacement = getLibraryPlacement(step);
    if (step.to !== 'hand' && step.to !== 'exile' && step.to !== 'battlefield' && !(step.to === 'library' && libraryPlacement)) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    const result = moveTargetedCardFromGraveyard(
      nextState,
      controllerId,
      selection.cardId,
      parsedRandomSingleFromYourGraveyard,
      step.to === 'library' ? (libraryPlacement === 'top' ? 'library_top' : 'library_bottom') : step.to,
      step.to === 'battlefield' ? controllerId : undefined,
      step.entersTapped,
      effectiveWithCounters,
      attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
      ctx.sourceName
    );

    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (target object unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (parsedSingleTargetFromAnyGraveyard) {
    const targetObjectId = boundTargetObjectId;
    const libraryPlacement = getLibraryPlacement(step);
    if (!targetObjectId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (step.to !== 'hand' && step.to !== 'exile' && step.to !== 'battlefield' && !(step.to === 'library' && libraryPlacement)) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    if (step.to === 'battlefield' && requiresExplicitControllerOverride(step)) {
      return {
        applied: false,
        message: `Skipped move zone (battlefield requires explicit control override): ${step.raw}`,
        reason: 'battlefield_requires_explicit_control_override',
      };
    }

    const result = moveTargetedCardFromAnyGraveyard(
      nextState,
      targetObjectId,
      parsedSingleTargetFromAnyGraveyard,
      step.to === 'library' ? (libraryPlacement === 'top' ? 'library_top' : 'library_bottom') : step.to,
      step.to === 'battlefield'
        ? step.battlefieldController?.kind === 'owner_of_moved_cards'
          ? undefined
          : controllerId
        : undefined,
      step.entersTapped,
      effectiveWithCounters,
      attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
      ctx.sourceName
    );

    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (target card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: {
          persist: false,
          metadata: {
            targetObjectId,
            zone: 'graveyard',
            scope: 'any_graveyard',
            destination: step.to,
          },
        },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (parsedSingleTargetFromTargetPlayerGraveyard) {
    const targetPlayerId = getTargetPlayerId(ctx);
    const targetObjectId =
      boundTargetObjectId ||
      (targetPlayerId
        ? resolveUniqueChosenGraveyardTargetId(
            nextState,
            targetPlayerId,
            parsedSingleTargetFromTargetPlayerGraveyard,
            ctx,
            runtime,
            ctx.sourceName
          )
        : '');
    const libraryPlacement = getLibraryPlacement(step);
    if (!targetPlayerId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    if (!targetObjectId) {
      if (isUpToOneTargetReference(step.what)) return buildNoOpOptionalSingleTargetResult(nextState, step);
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (step.to !== 'hand' && step.to !== 'exile' && step.to !== 'battlefield' && !(step.to === 'library' && libraryPlacement)) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    if (step.to === 'battlefield' && requiresExplicitControllerOverride(step)) {
      return {
        applied: false,
        message: `Skipped move zone (battlefield requires explicit control override): ${step.raw}`,
        reason: 'battlefield_requires_explicit_control_override',
      };
    }

    const result = moveTargetedCardFromGraveyard(
      nextState,
      targetPlayerId,
      targetObjectId,
      parsedSingleTargetFromTargetPlayerGraveyard,
      step.to === 'library' ? (libraryPlacement === 'top' ? 'library_top' : 'library_bottom') : step.to,
      step.to === 'battlefield'
        ? step.battlefieldController?.kind === 'owner_of_moved_cards'
          ? targetPlayerId
          : controllerId
        : undefined,
      step.entersTapped,
      effectiveWithCounters,
      attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined
    );

    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (target card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: {
          persist: false,
          metadata: {
            targetObjectId,
            targetPlayerId,
            zone: 'graveyard',
            destination: step.to,
          },
        },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (parsedSingleTargetFromTargetPlayerHand) {
    const targetPlayerId = getTargetPlayerId(ctx);
    const targetObjectId = boundTargetObjectId;
    if (!targetPlayerId || !targetObjectId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (step.to !== 'graveyard' && step.to !== 'exile' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    if (step.to === 'battlefield' && requiresExplicitControllerOverride(step)) {
      return {
        applied: false,
        message: `Skipped move zone (battlefield requires explicit control override): ${step.raw}`,
        reason: 'battlefield_requires_explicit_control_override',
      };
    }

    const result = moveTargetedCardFromHand(
      nextState,
      targetPlayerId,
      targetObjectId,
      parsedSingleTargetFromTargetPlayerHand.cardType,
      step.to,
      step.to === 'battlefield'
        ? step.battlefieldController?.kind === 'owner_of_moved_cards'
          ? targetPlayerId
          : controllerId
        : undefined,
      step.entersTapped,
      effectiveWithCounters,
      attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined
    );

    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (target card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: {
          persist: false,
          metadata: {
            targetObjectId,
            targetPlayerId,
            zone: 'hand',
            destination: step.to,
          },
        },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (parsedSingleTargetFromTargetPlayerExile) {
    const targetPlayerId = getTargetPlayerId(ctx);
    const targetObjectId = boundTargetObjectId;
    if (!targetPlayerId || !targetObjectId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (step.to !== 'hand' && step.to !== 'graveyard' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    if (step.to === 'battlefield' && requiresExplicitControllerOverride(step)) {
      return {
        applied: false,
        message: `Skipped move zone (battlefield requires explicit control override): ${step.raw}`,
        reason: 'battlefield_requires_explicit_control_override',
      };
    }

    const result = moveTargetedCardFromExile(
      nextState,
      targetPlayerId,
      targetObjectId,
      parsedSingleTargetFromTargetPlayerExile.cardType,
      step.to,
      step.to === 'battlefield'
        ? step.battlefieldController?.kind === 'owner_of_moved_cards'
          ? targetPlayerId
          : controllerId
        : undefined,
      step.entersTapped,
      effectiveWithCounters,
      attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined
    );

    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (target card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: {
          persist: false,
          metadata: {
            targetObjectId,
            targetPlayerId,
            zone: 'exile',
            destination: step.to,
          },
        },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (parsedSingleTargetFromYourGraveyard) {
    const targetObjectId =
      boundTargetObjectId ||
      resolveUniqueChosenGraveyardTargetId(
        nextState,
        controllerId,
        parsedSingleTargetFromYourGraveyard,
        ctx,
        runtime,
        ctx.sourceName
      );
    const libraryPlacement = getLibraryPlacement(step);
    if (!targetObjectId) {
      if (isUpToOneTargetReference(step.what)) return buildNoOpOptionalSingleTargetResult(nextState, step);
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (step.to !== 'hand' && step.to !== 'exile' && step.to !== 'battlefield' && !(step.to === 'library' && libraryPlacement)) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    const result = moveTargetedCardFromGraveyard(
      nextState,
      controllerId,
      targetObjectId,
      parsedSingleTargetFromYourGraveyard,
      step.to === 'library' ? (libraryPlacement === 'top' ? 'library_top' : 'library_bottom') : step.to,
      step.to === 'battlefield' ? controllerId : undefined,
      step.entersTapped,
      effectiveWithCounters,
      attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
      ctx.sourceName
    );

    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (target card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: {
          persist: false,
          metadata: {
            targetObjectId,
            zone: 'graveyard',
            destination: step.to,
          },
        },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (parsedSingleTargetFromYourHand) {
    const targetObjectId = boundTargetObjectId;
    if (!targetObjectId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (step.to !== 'graveyard' && step.to !== 'exile' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    const result = moveTargetedCardFromHand(
      nextState,
      controllerId,
      targetObjectId,
      parsedSingleTargetFromYourHand.cardType,
      step.to,
      step.to === 'battlefield' ? controllerId : undefined,
      step.entersTapped,
      effectiveWithCounters
    );

    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (target card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: {
          persist: false,
          metadata: {
            targetObjectId,
            zone: 'hand',
            destination: step.to,
          },
        },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (parsedSingleTargetFromYourExile) {
    const targetObjectId = boundTargetObjectId;
    if (!targetObjectId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (step.to !== 'hand' && step.to !== 'graveyard' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    const result = moveTargetedCardFromExile(
      nextState,
      controllerId,
      targetObjectId,
      parsedSingleTargetFromYourExile.cardType,
      step.to,
      step.to === 'battlefield' ? controllerId : undefined,
      step.entersTapped,
      effectiveWithCounters
    );

    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (target card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: {
          persist: false,
          metadata: {
            targetObjectId,
            zone: 'exile',
            destination: step.to,
          },
        },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (parsedTargetCountFromGraveyard) {
    const targetPlayerId = getTargetPlayerId(ctx);
    if (!targetPlayerId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (step.to !== 'hand' && step.to !== 'exile' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    if (step.to === 'battlefield' && requiresExplicitControllerOverride(step)) {
      return {
        applied: false,
        message: `Skipped move zone (battlefield requires explicit control override): ${step.raw}`,
        reason: 'battlefield_requires_explicit_control_override',
      };
    }

    const result =
      step.to === 'hand'
        ? returnExactMatchingFromGraveyardToHand(
            nextState,
            targetPlayerId,
            parsedTargetCountFromGraveyard.count,
            parsedTargetCountFromGraveyard.cardType
          )
        : step.to === 'battlefield'
          ? putExactMatchingFromGraveyardOntoBattlefieldWithController(
              nextState,
              targetPlayerId,
              step.battlefieldController?.kind === 'owner_of_moved_cards' ? targetPlayerId : controllerId,
              parsedTargetCountFromGraveyard.count,
              parsedTargetCountFromGraveyard.cardType,
              step.entersTapped,
              effectiveWithCounters,
              attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined
            )
          : exileExactMatchingFromGraveyard(
              nextState,
              targetPlayerId,
              parsedTargetCountFromGraveyard.count,
              parsedTargetCountFromGraveyard.cardType
            );

    if (result.kind === 'player_choice_required') {
      return {
        applied: false,
        message: `Skipped move zone (needs player card selection): ${step.raw}`,
        reason: 'player_choice_required',
        options: {
          classification: 'player_choice',
          metadata: {
            requiredCount: parsedTargetCountFromGraveyard.count,
            availableCount: result.available,
            zone: 'graveyard',
            destination: step.to,
            targetPlayerId,
          },
        },
      };
    }

    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (not enough matching cards): ${step.raw}`,
        reason: 'impossible_action',
        options: {
          persist: false,
          metadata: {
            requiredCount: parsedTargetCountFromGraveyard.count,
            availableCount: result.available,
            zone: 'graveyard',
            destination: step.to,
            targetPlayerId,
          },
        },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (parsedTargetPlayerExile) {
    const targetPlayerId = getTargetPlayerId(ctx);
    if (!targetPlayerId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (step.to !== 'hand' && step.to !== 'graveyard' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    if (requiresExplicitControllerOverride(step)) {
      return {
        applied: false,
        message: `Skipped move zone (battlefield requires explicit control override): ${step.raw}`,
        reason: 'battlefield_requires_explicit_control_override',
      };
    }

    const result =
      step.to === 'hand'
        ? moveAllMatchingFromExile(nextState, targetPlayerId, parsedTargetPlayerExile.cardType, 'hand')
        : step.to === 'graveyard'
          ? moveAllMatchingFromExile(nextState, targetPlayerId, parsedTargetPlayerExile.cardType, 'graveyard')
          : step.battlefieldController?.kind === 'owner_of_moved_cards'
            ? putAllMatchingFromExileOntoBattlefield(
                nextState,
                targetPlayerId,
                parsedTargetPlayerExile.cardType,
                step.entersTapped,
                effectiveWithCounters
              )
            : putAllMatchingFromExileOntoBattlefieldWithController(
                nextState,
                targetPlayerId,
                controllerId,
                parsedTargetPlayerExile.cardType,
                step.entersTapped,
                effectiveWithCounters
              );
    return finalizeAppliedResult(result);
  }

  if (parsedTargetPlayerHand) {
    const targetPlayerId = getTargetPlayerId(ctx);
    if (!targetPlayerId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (step.to !== 'exile' && step.to !== 'graveyard' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    if (requiresExplicitControllerOverride(step)) {
      return {
        applied: false,
        message: `Skipped move zone (battlefield requires explicit control override): ${step.raw}`,
        reason: 'battlefield_requires_explicit_control_override',
      };
    }

    const result =
      step.to === 'battlefield'
        ? step.battlefieldController?.kind === 'you'
          ? putAllMatchingFromHandOntoBattlefieldWithController(
              nextState,
              targetPlayerId,
              controllerId,
              parsedTargetPlayerHand.cardType,
              step.entersTapped,
              effectiveWithCounters
            )
          : putAllMatchingFromHandOntoBattlefield(
              nextState,
              targetPlayerId,
              parsedTargetPlayerHand.cardType,
              step.entersTapped,
              effectiveWithCounters
            )
        : moveAllMatchingFromHand(nextState, targetPlayerId, parsedTargetPlayerHand.cardType, step.to);
    return finalizeAppliedResult(result);
  }

  if (parsedCountFromGraveyard) {
    if (step.to !== 'hand' && step.to !== 'exile' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    const result =
      step.to === 'hand'
        ? returnExactMatchingFromGraveyardToHand(
            nextState,
            controllerId,
            parsedCountFromGraveyard.count,
            parsedCountFromGraveyard.cardType
          )
        : step.to === 'battlefield'
          ? putExactMatchingFromGraveyardOntoBattlefieldWithController(
              nextState,
              controllerId,
              controllerId,
              parsedCountFromGraveyard.count,
              parsedCountFromGraveyard.cardType,
              step.entersTapped,
              effectiveWithCounters,
              attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined
            )
          : exileExactMatchingFromGraveyard(
              nextState,
              controllerId,
              parsedCountFromGraveyard.count,
              parsedCountFromGraveyard.cardType
            );

    if (result.kind === 'player_choice_required') {
      return {
        applied: false,
        message: `Skipped move zone (needs player card selection): ${step.raw}`,
        reason: 'player_choice_required',
        options: {
          classification: 'player_choice',
          metadata: {
            requiredCount: parsedCountFromGraveyard.count,
            availableCount: result.available,
            zone: 'graveyard',
            destination: step.to,
          },
        },
      };
    }

    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (not enough matching cards): ${step.raw}`,
        reason: 'impossible_action',
        options: {
          persist: false,
          metadata: {
            requiredCount: parsedCountFromGraveyard.count,
            availableCount: result.available,
            zone: 'graveyard',
            destination: step.to,
          },
        },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (parsedEachOpponentsExile) {
    if (step.to !== 'hand' && step.to !== 'graveyard' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    if (requiresExplicitControllerOverride(step)) {
      return {
        applied: false,
        message: `Skipped move zone (battlefield requires explicit control override): ${step.raw}`,
        reason: 'battlefield_requires_explicit_control_override',
      };
    }

    for (const player of getOpponents(nextState, controllerId)) {
      const result =
        step.to === 'hand'
          ? moveAllMatchingFromExile(nextState, player.id, parsedEachOpponentsExile.cardType, 'hand')
          : step.to === 'graveyard'
            ? moveAllMatchingFromExile(nextState, player.id, parsedEachOpponentsExile.cardType, 'graveyard')
            : step.battlefieldController?.kind === 'owner_of_moved_cards'
              ? putAllMatchingFromExileOntoBattlefield(
                  nextState,
                  player.id,
                  parsedEachOpponentsExile.cardType,
                  step.entersTapped,
                  effectiveWithCounters
                )
              : putAllMatchingFromExileOntoBattlefieldWithController(
                  nextState,
                  player.id,
                  controllerId,
                  parsedEachOpponentsExile.cardType,
                  step.entersTapped,
                  effectiveWithCounters
                );
      nextState = result.state;
      log.push(...result.log);
    }

    return { applied: true, state: nextState, log };
  }

  if (parsedEachOpponentsGy) {
    if (step.to !== 'exile' && step.to !== 'hand' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    if (requiresExplicitControllerOverride(step)) {
      return {
        applied: false,
        message: `Skipped move zone (battlefield requires explicit control override): ${step.raw}`,
        reason: 'battlefield_requires_explicit_control_override',
      };
    }

    for (const player of getOpponents(nextState, controllerId)) {
      const result =
        step.to === 'hand'
          ? returnAllMatchingFromGraveyardToHand(nextState, player.id, parsedEachOpponentsGy.cardType)
          : step.to === 'battlefield'
            ? step.battlefieldController?.kind === 'owner_of_moved_cards'
              ? putAllMatchingFromGraveyardOntoBattlefield(
                  nextState,
                  player.id,
                  parsedEachOpponentsGy.cardType,
                  step.entersTapped,
                  effectiveWithCounters
                )
              : putAllMatchingFromGraveyardOntoBattlefieldWithController(
                  nextState,
                  player.id,
                  controllerId,
                  parsedEachOpponentsGy.cardType,
                  step.entersTapped,
                  effectiveWithCounters
                )
            : exileAllMatchingFromGraveyard(nextState, player.id, parsedEachOpponentsGy.cardType);
      nextState = result.state;
      log.push(...result.log);
    }

    return { applied: true, state: nextState, log };
  }

  if (parsedEachOpponentsHand) {
    if (step.to !== 'exile' && step.to !== 'graveyard' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    if (requiresExplicitControllerOverride(step)) {
      return {
        applied: false,
        message: `Skipped move zone (battlefield requires explicit control override): ${step.raw}`,
        reason: 'battlefield_requires_explicit_control_override',
      };
    }

    for (const player of getOpponents(nextState, controllerId)) {
      const result =
        step.to === 'battlefield'
          ? step.battlefieldController?.kind === 'you'
          ? putAllMatchingFromHandOntoBattlefieldWithController(
                nextState,
                player.id,
                controllerId,
                parsedEachOpponentsHand.cardType,
                step.entersTapped,
                effectiveWithCounters
              )
            : putAllMatchingFromHandOntoBattlefield(
                nextState,
                player.id,
                parsedEachOpponentsHand.cardType,
                step.entersTapped,
                effectiveWithCounters
              )
          : moveAllMatchingFromHand(nextState, player.id, parsedEachOpponentsHand.cardType, step.to);
      nextState = result.state;
      log.push(...result.log);
    }

    return { applied: true, state: nextState, log };
  }

  if (parsedEachPlayersGy) {
    if (step.to !== 'exile' && step.to !== 'hand' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    for (const player of (nextState.players || []) as any[]) {
      const result =
        step.to === 'hand'
          ? returnAllMatchingFromGraveyardToHand(nextState, player.id, parsedEachPlayersGy.cardType)
          : step.to === 'battlefield'
            ? step.battlefieldController?.kind === 'you'
              ? putAllMatchingFromGraveyardOntoBattlefieldWithController(
                  nextState,
                  player.id,
                  controllerId,
                  parsedEachPlayersGy.cardType,
                  step.entersTapped,
                  effectiveWithCounters
                )
              : putAllMatchingFromGraveyardOntoBattlefield(
                  nextState,
                  player.id,
                  parsedEachPlayersGy.cardType,
                  step.entersTapped,
                  effectiveWithCounters
                )
            : exileAllMatchingFromGraveyard(nextState, player.id, parsedEachPlayersGy.cardType);
      nextState = result.state;
      log.push(...result.log);
    }

    return { applied: true, state: nextState, log };
  }

  if (parsedEachPlayersExile) {
    if (step.to !== 'hand' && step.to !== 'graveyard' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    for (const player of (nextState.players || []) as any[]) {
      const result =
        step.to === 'hand'
          ? moveAllMatchingFromExile(nextState, player.id, parsedEachPlayersExile.cardType, 'hand')
          : step.to === 'graveyard'
            ? moveAllMatchingFromExile(nextState, player.id, parsedEachPlayersExile.cardType, 'graveyard')
            : step.battlefieldController?.kind === 'you'
              ? putAllMatchingFromExileOntoBattlefieldWithController(
                  nextState,
                  player.id,
                  controllerId,
                  parsedEachPlayersExile.cardType,
                  step.entersTapped,
                  effectiveWithCounters
                )
              : putAllMatchingFromExileOntoBattlefield(
                  nextState,
                  player.id,
                  parsedEachPlayersExile.cardType,
                  step.entersTapped,
                  effectiveWithCounters
                );
      nextState = result.state;
      log.push(...result.log);
    }

    return { applied: true, state: nextState, log };
  }

  if (parsedEachPlayersHand) {
    if (step.to !== 'exile' && step.to !== 'graveyard' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    for (const player of (nextState.players || []) as any[]) {
      const result =
        step.to === 'battlefield'
          ? step.battlefieldController?.kind === 'you'
          ? putAllMatchingFromHandOntoBattlefieldWithController(
                nextState,
                player.id,
                controllerId,
                parsedEachPlayersHand.cardType,
                step.entersTapped,
                effectiveWithCounters
              )
            : putAllMatchingFromHandOntoBattlefield(
                nextState,
                player.id,
                parsedEachPlayersHand.cardType,
                step.entersTapped,
                effectiveWithCounters
              )
          : moveAllMatchingFromHand(nextState, player.id, parsedEachPlayersHand.cardType, step.to);
      nextState = result.state;
      log.push(...result.log);
    }

    return { applied: true, state: nextState, log };
  }

  if (parsedFromGraveyard) {
    if (step.to === 'hand') {
      const result = returnAllMatchingFromGraveyardToHand(nextState, controllerId, parsedFromGraveyard.cardType);
      return finalizeAppliedResult(result);
    }

    if (step.to === 'exile') {
      const result = exileAllMatchingFromGraveyard(nextState, controllerId, parsedFromGraveyard.cardType);
      return finalizeAppliedResult(result);
    }

    if (step.to === 'battlefield') {
      const result = putAllMatchingFromGraveyardOntoBattlefield(
        nextState,
        controllerId,
        parsedFromGraveyard.cardType,
        step.entersTapped,
        effectiveWithCounters
      );
      return finalizeAppliedResult(result);
    }

    return {
      applied: false,
      message: `Skipped move zone (unsupported destination): ${step.raw}`,
      reason: 'unsupported_destination',
    };
  }

  if (parsedFromExile) {
    if (step.to === 'hand') {
      const result = moveAllMatchingFromExile(nextState, controllerId, parsedFromExile.cardType, 'hand');
      return finalizeAppliedResult(result);
    }

    if (step.to === 'graveyard') {
      const result = moveAllMatchingFromExile(nextState, controllerId, parsedFromExile.cardType, 'graveyard');
      return finalizeAppliedResult(result);
    }

    if (step.to === 'battlefield') {
      const result =
        step.battlefieldController?.kind === 'you'
          ? putAllMatchingFromExileOntoBattlefieldWithController(
              nextState,
              controllerId,
              controllerId,
              parsedFromExile.cardType,
              step.entersTapped,
              effectiveWithCounters
            )
          : putAllMatchingFromExileOntoBattlefield(
              nextState,
              controllerId,
              parsedFromExile.cardType,
              step.entersTapped,
              effectiveWithCounters
            );
      return finalizeAppliedResult(result);
    }

    return {
      applied: false,
      message: `Skipped move zone (unsupported destination): ${step.raw}`,
      reason: 'unsupported_destination',
    };
  }

  if (step.to !== 'graveyard' && step.to !== 'exile' && step.to !== 'battlefield') {
    return {
      applied: false,
      message: `Skipped move zone (unsupported destination): ${step.raw}`,
      reason: 'unsupported_destination',
    };
  }

  const result =
    step.to === 'battlefield'
      ? putAllMatchingFromHandOntoBattlefield(
          nextState,
          controllerId,
          parsedFromHand!.cardType,
          step.entersTapped,
          effectiveWithCounters
        )
      : moveAllMatchingFromHand(nextState, controllerId, parsedFromHand!.cardType, step.to);

  return finalizeAppliedResult(result);
}
