/**
 * socket/resolution-handlers/targetSelectionPlaneswalkerAndSoldierHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleTargetSelectionResponse).
 * Cluster moved: the two "chosen permanents feed an activation" branches near the end of the
 * function - `soldierProgramCounters` (put a +1/+1 counter on each chosen Soldier, one persisted
 * counterTargetChosen event each) and `planeswalkerAbility` (pay the loyalty cost, then push the
 * loyalty ability on the stack with its targets and copy-retarget metadata).
 * Public entry symbols: handleSoldierProgramCounterTargetSelection,
 * handlePlaneswalkerAbilityTargetSelection.
 *
 * Both branches always returned, so each call site is `await handler(...); return;`.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../../db/index.js";
import type { ResolutionStep, ResolutionStepResponse } from "../../state/resolution/index.js";
import { debug, debugWarn } from "../../utils/debug.js";
import { fireBattlefieldAbilityActivatedTriggers } from "../resolutionActivatedAbilityTargetingUtils.js";
import { broadcastGame, getPlayerName } from "../util.js";

/** TARGET_SELECTION with `soldierProgramCounters`: +1/+1 counter on each chosen Soldier. */
export async function handleSoldierProgramCounterTargetSelection(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const pid = response.playerId;
  const selections = response.selections as string[];
  const battlefield = game.state?.battlefield || [];

  if (selections.length > 0) {
    // Apply +1/+1 counters to the selected soldiers
    const boostedSoldiers: string[] = [];
    for (const soldierId of selections) {
      const soldier = battlefield.find((p: any) => p.id === soldierId);
      if (soldier) {
        soldier.counters = soldier.counters || {};
        soldier.counters['+1/+1'] = (soldier.counters['+1/+1'] || 0) + 1;
        boostedSoldiers.push(soldier.card?.name || 'Soldier');
        debug(2, `[Resolution] SOLDIER Military Program: Added +1/+1 counter to ${soldier.card?.name || soldier.id}`);

        try {
          await appendEvent(gameId, (game as any).seq ?? 0, 'counterTargetChosen', {
            playerId: pid,
            sourceName: 'SOLDIER Military Program',
            targetId: String(soldier.id || soldierId),
            targetName: String(soldier.card?.name || 'Soldier'),
            counterType: '+1/+1',
          });
        } catch (e) {
          debugWarn(1, '[Resolution] appendEvent(counterTargetChosen) failed for SOLDIER Military Program follow-up:', e);
        }
      }
    }

    if (boostedSoldiers.length > 0) {
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} put a +1/+1 counter on ${boostedSoldiers.length} Soldier${boostedSoldiers.length > 1 ? 's' : ''}.`,
        ts: Date.now(),
      });
    }
  } else {
    debug(2, `[Resolution] SOLDIER Military Program: Player chose not to add counters to any soldiers`);
  }

  broadcastGame(io, game, gameId);
}

/**
 * TARGET_SELECTION for a planeswalker loyalty ability.
 *
 * Planeswalker abilities store their data in step.planeswalkerAbility.
 */
export function handlePlaneswalkerAbilityTargetSelection(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): void {
  const pid = response.playerId;
  const selections = response.selections as string[];
  const pwAbility = (step as any).planeswalkerAbility;

  const { abilityIndex, abilityText, loyaltyCost, currentLoyalty } = pwAbility;
  const permanentId = step.sourceId;
  const cardName = step.sourceName;

  // Find the planeswalker permanent
  const battlefield = game.state?.battlefield || [];
  const permanent = battlefield.find((p: any) => p.id === permanentId);

  if (!permanent) {
    debugWarn(1, `[Resolution] Planeswalker ${cardName} not found on battlefield`);
    return;
  }

  // Apply loyalty cost and update counters
  const newLoyalty = currentLoyalty + loyaltyCost;
  permanent.counters = permanent.counters || {};
  permanent.counters.loyalty = newLoyalty;
  permanent.loyalty = newLoyalty; // Also update top-level loyalty for client display
  // Note: loyaltyActivationsThisTurn already incremented when ability was activated
  const loyaltyActivatedAbilityText = `${loyaltyCost >= 0 ? '+' : ''}${loyaltyCost}: ${abilityText}`;

  // Put the loyalty ability on the stack WITH targets
  const stackItem = {
    id: `ability_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'ability' as const,
    controller: pid,
    source: permanentId,
    sourceName: cardName,
    description: abilityText,
    activatedAbilityText: loyaltyActivatedAbilityText,
    targets: selections,  // Include selected targets
    copyRetargetValidTargets: Array.isArray((step as any).validTargets)
      ? (step as any).validTargets.map((target: any) => ({ ...target }))
      : [],
    copyRetargetTargetTypes: Array.isArray((step as any).targetTypes) ? [...(step as any).targetTypes] : [],
    copyRetargetMinTargets: Number((step as any).minTargets || 0),
    copyRetargetMaxTargets: Number((step as any).maxTargets || 0),
    copyRetargetTargetDescription: String((step as any).targetDescription || 'target'),
    planeswalker: {
      oracleId: (permanent as any)?.card?.oracle_id,
      abilityIndex,
      loyaltyCost,
    },
  };

  game.state.stack = game.state.stack || [];
  game.state.stack.push(stackItem);
  fireBattlefieldAbilityActivatedTriggers(game, String(pid), String(permanentId), abilityText, gameId, stackItem.id, () => {
    // Record the event for replay/undo
    appendEvent(gameId, (game as any).seq ?? 0, "activatePlaneswalkerAbility", {
      stackItemId: String(stackItem.id || '').trim() || undefined,
      playerId: pid,
      permanentId,
      abilityIndex,
      loyaltyCost,
      newLoyalty,
      abilityText,
      activatedAbilityText: loyaltyActivatedAbilityText,
      targets: selections,
      copyRetargetValidTargets: Array.isArray((step as any).validTargets)
        ? (step as any).validTargets.map((target: any) => ({ ...target }))
        : [],
      copyRetargetTargetTypes: Array.isArray((step as any).targetTypes) ? [...(step as any).targetTypes] : [],
      copyRetargetMinTargets: Number((step as any).minTargets || 0),
      copyRetargetMaxTargets: Number((step as any).maxTargets || 0),
      copyRetargetTargetDescription: String((step as any).targetDescription || 'target'),
    });
  });

  const costSign = loyaltyCost >= 0 ? "+" : "";
  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message: `⚡ ${getPlayerName(game, pid)} activated ${cardName}'s [${costSign}${loyaltyCost}] ability${selections.length > 0 ? ` targeting ${selections.length} target(s)` : ''}. (Loyalty: ${currentLoyalty} → ${newLoyalty})`,
    ts: Date.now(),
  });

  debug(2, `[Resolution] Planeswalker ability ${cardName} activated with ${selections.length} targets`);

  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }

  broadcastGame(io, game, gameId);
}
