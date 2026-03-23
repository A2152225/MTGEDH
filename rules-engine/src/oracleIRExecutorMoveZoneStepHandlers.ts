import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { parseSimpleBattlefieldSelector } from './oracleIRExecutorBattlefieldParser';
import { bounceMatchingBattlefieldPermanentsToOwnersHands } from './oracleIRExecutorBattlefieldOps';
import {
  exileAllMatchingFromGraveyard,
  moveAllMatchingFromExile,
  moveAllMatchingFromHand,
  parseMoveZoneAllFromEachOpponentsExile,
  parseMoveZoneAllFromEachOpponentsGraveyard,
  parseMoveZoneAllFromEachOpponentsHand,
  parseMoveZoneAllFromEachPlayersExile,
  parseMoveZoneAllFromEachPlayersGraveyard,
  parseMoveZoneAllFromEachPlayersHand,
  parseMoveZoneAllFromYourExile,
  parseMoveZoneAllFromYourGraveyard,
  parseMoveZoneAllFromYourHand,
  putAllMatchingFromExileOntoBattlefield,
  putAllMatchingFromExileOntoBattlefieldWithController,
  putAllMatchingFromGraveyardOntoBattlefield,
  putAllMatchingFromGraveyardOntoBattlefieldWithController,
  putAllMatchingFromHandOntoBattlefield,
  putAllMatchingFromHandOntoBattlefieldWithController,
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
    | 'battlefield_requires_explicit_control_override';
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
  const parsedFromHand = parseMoveZoneAllFromYourHand(step.what as any);
  const parsedFromExile = parseMoveZoneAllFromYourExile(step.what as any);
  const parsedEachPlayersGy = parseMoveZoneAllFromEachPlayersGraveyard(step.what as any);
  const parsedEachPlayersHand = parseMoveZoneAllFromEachPlayersHand(step.what as any);
  const parsedEachPlayersExile = parseMoveZoneAllFromEachPlayersExile(step.what as any);
  const parsedEachOpponentsGy = parseMoveZoneAllFromEachOpponentsGraveyard(step.what as any);
  const parsedEachOpponentsHand = parseMoveZoneAllFromEachOpponentsHand(step.what as any);
  const parsedEachOpponentsExile = parseMoveZoneAllFromEachOpponentsExile(step.what as any);

  if (
    !parsedFromGraveyard &&
    !parsedFromHand &&
    !parsedFromExile &&
    !parsedEachPlayersGy &&
    !parsedEachPlayersHand &&
    !parsedEachPlayersExile &&
    !parsedEachOpponentsGy &&
    !parsedEachOpponentsHand &&
    !parsedEachOpponentsExile
  ) {
    return {
      applied: false,
      message: `Skipped move zone (unsupported selector): ${step.raw}`,
      reason: 'unsupported_selector',
    };
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
