// Origin parent: oracleIRExecutorMoveZoneStepHandlers.ts (applyMoveZoneStep prologue, lines 481-586
// before extraction)
// Cluster moved: the prologue guards applyMoveZoneStep runs before it starts mutating state -
// "exile a card from your graveyard for each 1 damage prevented this way", per-player optional
// choices, optional land/permanent plays, dice-branch outcomes, and the delayed "return this
// creature under target player's control" schedule. Each guard either returns a final result or
// falls through.
// Public entry symbol: tryApplyMoveZoneEarlyGuardSteps (returns null to fall through to the main
// move_zone body).

import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { isPerPlayerOptionalOracleStep, normalizePerPlayerOptionalText } from './oracleIRPerPlayerOptional';
import {
  moveTargetedCardFromGraveyard,
  parseMoveZoneDelayedReturnThisCreatureUnderTargetPlayer,
} from './oracleIRExecutorZoneOps';
import type { MoveZoneStepHandlerResult } from './oracleIRExecutorMoveZoneStepTypes';

export function tryApplyMoveZoneEarlyGuardSteps(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'move_zone' }>,
  ctx: OracleIRExecutionContext
): MoveZoneStepHandlerResult | null {
  const graveyardCardPerPreventedDamage = String((step.what as any)?.text || step.raw || '')
    .trim()
    .toLowerCase();
  if (
    step.to === 'exile' &&
    /^a card from your graveyard for each 1 damage prevented this way$/.test(graveyardCardPerPreventedDamage)
  ) {
    const controllerId = String(ctx.controllerId || 'p1').trim();
    const prevented = Number(ctx.lastDamagePreventedThisWay ?? ctx.lastReferenceAmount);
    const count = Number.isFinite(prevented) ? Math.max(0, Math.floor(prevented)) : 0;
    const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === controllerId) as any;
    const graveyard = Array.isArray(player?.graveyard) ? [...player.graveyard] : [];
    const cardIds = graveyard.slice(0, count).map((card: any) => String(card?.id || '').trim()).filter(Boolean);
    if (cardIds.length === 0) {
      return { applied: true, state, log: [`No graveyard cards to exile for prevented damage: ${step.raw}`] };
    }
    let nextState = state;
    const log: string[] = [];
    for (const cardId of cardIds) {
      const result = moveTargetedCardFromGraveyard(
        nextState,
        controllerId as PlayerID,
        cardId,
        { cardType: 'any' },
        'exile',
        controllerId as PlayerID
      );
      if (result.kind === 'applied' && result.state) {
        nextState = result.state;
        log.push(`Exiled ${cardId} from graveyard for prevented damage`);
      }
    }
    return { applied: true, state: nextState, log: log.length > 0 ? log : [`Exiled card(s) from graveyard for prevented damage`] };
  }

  if (
    step.optional === true
    && ctx.interactivePlayerChoices === true
    && isPerPlayerOptionalOracleStep(step)
  ) {
    return {
      applied: false,
      message: `Optional per-player choice requires player choice: ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  const optionalLandPlayRaw = normalizePerPlayerOptionalText(String(step.raw || ''))
    .replace(/^then,?\s+/i, '')
    .trim();
  const isEachPlayerOptionalLandPlay =
    step.optional === true
    && step.to === 'battlefield'
    && /^each player may put a land card from their hand onto the battlefield$/i.test(optionalLandPlayRaw);
  const isControllerOptionalLandPlay =
    step.optional === true
    && step.to === 'battlefield'
    && /^you may put a land card from your hand onto the battlefield$/i.test(optionalLandPlayRaw);
  const isBothPlayersOptionalPermanentFromHand =
    step.optional === true
    && step.to === 'battlefield'
    && /^you and that player may each put a permanent card from your hand onto the battlefield$/i.test(optionalLandPlayRaw);
  if (isEachPlayerOptionalLandPlay || isControllerOptionalLandPlay || isBothPlayersOptionalPermanentFromHand) {
    if (ctx.interactivePlayerChoices === true) {
      return {
        applied: false,
        message: isBothPlayersOptionalPermanentFromHand
          ? `Optional permanent play requires player choice: ${step.raw}`
          : `Optional land play requires player choice: ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    return {
      applied: true,
      state,
      log: [
        isBothPlayersOptionalPermanentFromHand
          ? `Skipped non-interactive optional permanent play: ${step.raw}`
          : `Skipped non-interactive optional land play: ${step.raw}`,
      ],
    };
  }

  const diceBranchWhat = String((step.what as any)?.text || '').trim();
  const diceBranchRaw = String(step.raw || '').trim();
  if (
    /^\d+\s*\|\s*/.test(diceBranchWhat) ||
    /^\d+-\d+\s*\|/.test(diceBranchRaw) ||
    /^\d+\s*\|/.test(diceBranchRaw)
  ) {
    return {
      applied: true,
      state,
      log: [`Skipped dice-branch move zone outcome: ${step.raw}`],
    };
  }

  if (parseMoveZoneDelayedReturnThisCreatureUnderTargetPlayer(step)) {
    return {
      applied: true,
      state,
      log: [`Scheduled return of this creature at target opponent's next upkeep: ${step.raw}`],
    };
  }

  return null;
}
