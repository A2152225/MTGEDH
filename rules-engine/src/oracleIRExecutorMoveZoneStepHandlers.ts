import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { parseSimpleBattlefieldSelector } from './oracleIRExecutorBattlefieldParser';
import { bounceMatchingBattlefieldPermanentsToOwnersHands } from './oracleIRExecutorBattlefieldOps';
import {
  exileExactMatchingFromGraveyard,
  exileAllMatchingFromGraveyard,
  moveAllMatchingFromExile,
  moveAllMatchingFromHand,
  moveTargetedCardFromGraveyard,
  moveTargetedCardFromHand,
  moveTargetedCardFromExile,
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
  parseMoveZoneSingleTargetFromTargetPlayersGraveyard,
  parseMoveZoneSingleTargetFromTargetPlayersHand,
  parseMoveZoneSingleTargetFromTargetPlayersExile,
  parseMoveZoneSingleTargetFromYourGraveyard,
  parseMoveZoneSingleTargetFromYourHand,
  parseMoveZoneSingleTargetFromYourExile,
  parseMoveZoneAllFromYourExile,
  parseMoveZoneAllFromYourGraveyard,
  parseMoveZoneAllFromYourHand,
  parseMoveZoneCountFromYourGraveyard,
  putExactMatchingFromGraveyardOntoBattlefieldWithController,
  putAllMatchingFromExileOntoBattlefield,
  putAllMatchingFromExileOntoBattlefieldWithController,
  putAllMatchingFromGraveyardOntoBattlefield,
  putAllMatchingFromGraveyardOntoBattlefieldWithController,
  putAllMatchingFromHandOntoBattlefield,
  putAllMatchingFromHandOntoBattlefieldWithController,
  returnExactMatchingFromGraveyardToHand,
  returnAllMatchingFromGraveyardToHand,
} from './oracleIRExecutorZoneOps';

type StepApplyResult = {
  readonly applied: true;
  readonly state: GameState;
  readonly log: readonly string[];
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

function getTargetObjectId(ctx: OracleIRExecutionContext): string {
  return String(ctx.targetPermanentId || ctx.targetCreatureId || '').trim();
}

function requiresExplicitControllerOverride(step: Extract<OracleEffectStep, { kind: 'move_zone' }>): boolean {
  return (
    step.to === 'battlefield' &&
    step.battlefieldController?.kind !== 'you' &&
    step.battlefieldController?.kind !== 'owner_of_moved_cards'
  );
}

export function applyMoveZoneStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'move_zone' }>,
  ctx: OracleIRExecutionContext
): MoveZoneStepHandlerResult {
  if (step.to !== 'hand' && step.to !== 'exile' && step.to !== 'graveyard' && step.to !== 'battlefield') {
    return {
      applied: false,
      message: `Skipped move zone (unsupported destination): ${step.raw}`,
      reason: 'unsupported_destination',
    };
  }

  let nextState = state;
  const log: string[] = [];
  const controllerId = getControllerId(ctx);

  if (step.to === 'hand' && (step.what as any)?.kind === 'raw') {
    const whatText = String((step.what as any).text || '').trim();
    if (whatText && !/\b(from|card|cards)\b/i.test(whatText)) {
      const selector = parseSimpleBattlefieldSelector(step.what as any);
      if (selector) {
        const result = bounceMatchingBattlefieldPermanentsToOwnersHands(nextState, selector, ctx);
        return { applied: true, state: result.state, log: result.log };
      }
    }
  }

  const parsedFromGraveyard = parseMoveZoneAllFromYourGraveyard(step.what as any);
  const parsedCountFromGraveyard = parseMoveZoneCountFromYourGraveyard(step.what as any);
  const parsedTargetCountFromGraveyard = parseMoveZoneCountFromTargetPlayersGraveyard(step.what as any);
  const parsedSingleTargetFromTargetPlayerGraveyard = parseMoveZoneSingleTargetFromTargetPlayersGraveyard(step.what as any);
  const parsedSingleTargetFromTargetPlayerHand = parseMoveZoneSingleTargetFromTargetPlayersHand(step.what as any);
  const parsedSingleTargetFromTargetPlayerExile = parseMoveZoneSingleTargetFromTargetPlayersExile(step.what as any);
  const parsedSingleTargetFromYourGraveyard = parseMoveZoneSingleTargetFromYourGraveyard(step.what as any);
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

  if (
    !parsedFromGraveyard &&
    !parsedCountFromGraveyard &&
    !parsedTargetCountFromGraveyard &&
    !parsedSingleTargetFromTargetPlayerGraveyard &&
    !parsedSingleTargetFromTargetPlayerHand &&
    !parsedSingleTargetFromTargetPlayerExile &&
    !parsedSingleTargetFromYourGraveyard &&
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
    !parsedTargetPlayerGy
  ) {
    return {
      applied: false,
      message: `Skipped move zone (unsupported selector): ${step.raw}`,
      reason: 'unsupported_selector',
    };
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
            ? putAllMatchingFromGraveyardOntoBattlefield(nextState, targetPlayerId, parsedTargetPlayerGy.cardType, step.entersTapped)
            : putAllMatchingFromGraveyardOntoBattlefieldWithController(
                nextState,
                targetPlayerId,
                controllerId,
                parsedTargetPlayerGy.cardType,
                step.entersTapped
              )
          : exileAllMatchingFromGraveyard(nextState, targetPlayerId, parsedTargetPlayerGy.cardType);
    return { applied: true, state: result.state, log: result.log };
  }

  if (parsedSingleTargetFromTargetPlayerGraveyard) {
    const targetPlayerId = getTargetPlayerId(ctx);
    const targetObjectId = getTargetObjectId(ctx);
    if (!targetPlayerId || !targetObjectId) {
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

    const result = moveTargetedCardFromGraveyard(
      nextState,
      targetPlayerId,
      targetObjectId,
      parsedSingleTargetFromTargetPlayerGraveyard.cardType,
      step.to,
      step.to === 'battlefield'
        ? step.battlefieldController?.kind === 'owner_of_moved_cards'
          ? targetPlayerId
          : controllerId
        : undefined,
      step.entersTapped
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

    return { applied: true, state: result.state, log: result.log };
  }

  if (parsedSingleTargetFromTargetPlayerHand) {
    const targetPlayerId = getTargetPlayerId(ctx);
    const targetObjectId = getTargetObjectId(ctx);
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
      step.entersTapped
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

    return { applied: true, state: result.state, log: result.log };
  }

  if (parsedSingleTargetFromTargetPlayerExile) {
    const targetPlayerId = getTargetPlayerId(ctx);
    const targetObjectId = getTargetObjectId(ctx);
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
      step.entersTapped
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

    return { applied: true, state: result.state, log: result.log };
  }

  if (parsedSingleTargetFromYourGraveyard) {
    const targetObjectId = getTargetObjectId(ctx);
    if (!targetObjectId) {
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

    const result = moveTargetedCardFromGraveyard(
      nextState,
      controllerId,
      targetObjectId,
      parsedSingleTargetFromYourGraveyard.cardType,
      step.to,
      step.to === 'battlefield' ? controllerId : undefined,
      step.entersTapped
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

    return { applied: true, state: result.state, log: result.log };
  }

  if (parsedSingleTargetFromYourHand) {
    const targetObjectId = getTargetObjectId(ctx);
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
      step.entersTapped
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

    return { applied: true, state: result.state, log: result.log };
  }

  if (parsedSingleTargetFromYourExile) {
    const targetObjectId = getTargetObjectId(ctx);
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
      step.entersTapped
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

    return { applied: true, state: result.state, log: result.log };
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
              step.entersTapped
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

    return { applied: true, state: result.state, log: result.log };
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
            ? putAllMatchingFromExileOntoBattlefield(nextState, targetPlayerId, parsedTargetPlayerExile.cardType, step.entersTapped)
            : putAllMatchingFromExileOntoBattlefieldWithController(
                nextState,
                targetPlayerId,
                controllerId,
                parsedTargetPlayerExile.cardType,
                step.entersTapped
              );
    return { applied: true, state: result.state, log: result.log };
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
              step.entersTapped
            )
          : putAllMatchingFromHandOntoBattlefield(nextState, targetPlayerId, parsedTargetPlayerHand.cardType, step.entersTapped)
        : moveAllMatchingFromHand(nextState, targetPlayerId, parsedTargetPlayerHand.cardType, step.to);
    return { applied: true, state: result.state, log: result.log };
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
              step.entersTapped
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

    return { applied: true, state: result.state, log: result.log };
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
              ? putAllMatchingFromExileOntoBattlefield(nextState, player.id, parsedEachOpponentsExile.cardType, step.entersTapped)
              : putAllMatchingFromExileOntoBattlefieldWithController(
                  nextState,
                  player.id,
                  controllerId,
                  parsedEachOpponentsExile.cardType,
                  step.entersTapped
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
              ? putAllMatchingFromGraveyardOntoBattlefield(nextState, player.id, parsedEachOpponentsGy.cardType, step.entersTapped)
              : putAllMatchingFromGraveyardOntoBattlefieldWithController(
                  nextState,
                  player.id,
                  controllerId,
                  parsedEachOpponentsGy.cardType,
                  step.entersTapped
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
                step.entersTapped
              )
            : putAllMatchingFromHandOntoBattlefield(nextState, player.id, parsedEachOpponentsHand.cardType, step.entersTapped)
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
                  step.entersTapped
                )
              : putAllMatchingFromGraveyardOntoBattlefield(nextState, player.id, parsedEachPlayersGy.cardType, step.entersTapped)
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
                  step.entersTapped
                )
              : putAllMatchingFromExileOntoBattlefield(nextState, player.id, parsedEachPlayersExile.cardType, step.entersTapped);
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
                step.entersTapped
              )
            : putAllMatchingFromHandOntoBattlefield(nextState, player.id, parsedEachPlayersHand.cardType, step.entersTapped)
          : moveAllMatchingFromHand(nextState, player.id, parsedEachPlayersHand.cardType, step.to);
      nextState = result.state;
      log.push(...result.log);
    }

    return { applied: true, state: nextState, log };
  }

  if (parsedFromGraveyard) {
    if (step.to === 'hand') {
      const result = returnAllMatchingFromGraveyardToHand(nextState, controllerId, parsedFromGraveyard.cardType);
      return { applied: true, state: result.state, log: result.log };
    }

    if (step.to === 'exile') {
      const result = exileAllMatchingFromGraveyard(nextState, controllerId, parsedFromGraveyard.cardType);
      return { applied: true, state: result.state, log: result.log };
    }

    if (step.to === 'battlefield') {
      const result = putAllMatchingFromGraveyardOntoBattlefield(
        nextState,
        controllerId,
        parsedFromGraveyard.cardType,
        step.entersTapped
      );
      return { applied: true, state: result.state, log: result.log };
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
      return { applied: true, state: result.state, log: result.log };
    }

    if (step.to === 'graveyard') {
      const result = moveAllMatchingFromExile(nextState, controllerId, parsedFromExile.cardType, 'graveyard');
      return { applied: true, state: result.state, log: result.log };
    }

    if (step.to === 'battlefield') {
      const result =
        step.battlefieldController?.kind === 'you'
          ? putAllMatchingFromExileOntoBattlefieldWithController(
              nextState,
              controllerId,
              controllerId,
              parsedFromExile.cardType,
              step.entersTapped
            )
          : putAllMatchingFromExileOntoBattlefield(nextState, controllerId, parsedFromExile.cardType, step.entersTapped);
      return { applied: true, state: result.state, log: result.log };
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
      ? putAllMatchingFromHandOntoBattlefield(nextState, controllerId, parsedFromHand!.cardType, step.entersTapped)
      : moveAllMatchingFromHand(nextState, controllerId, parsedFromHand!.cardType, step.to);

  return { applied: true, state: result.state, log: result.log };
}
