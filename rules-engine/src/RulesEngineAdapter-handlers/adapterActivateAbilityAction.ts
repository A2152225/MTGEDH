// Origin parent: rules-engine/src/RulesEngineAdapter.ts
// Cluster moved: activateAbilityAction.
// Public entry symbols: activateAbilityAction.
// Class methods become thin wrappers that call these via .call(this, ...).
// Leaf must not import RulesEngineAdapter.ts or RulesEngineAdapter-handlers/index.ts.

import type { GameState } from '../../../shared/src';
import type { EngineResult } from '../core/types';
import { RulesEngineEvent } from '../core/events';
import {
  activateAbility,
  type ActivatedAbility,
  type ActivationContext,
} from '../activatedAbilities';
import { applyActivatedAbilityCostReductions } from '../activatedAbilityCostReduction';
import { emptyManaPool } from '../manaAbilities';
import { isStackEmpty as checkStackEmpty, pushToStack } from '../stackOperations';
import {
  buildStackTriggerMetaFromEventData,
  buildTriggerEventDataFromPayloads,
} from '../triggeredAbilities';

/** Adapter instance passed as `this` from RulesEngineAdapter thin wrappers. */
export type AdapterActivateAbilityActionHost = any;

  /**
   * Activate an activated ability
   */
export function activateAbilityAction(this: AdapterActivateAbilityActionHost, gameId: string, action: any): EngineResult<GameState> {
    const state = this.gameStates.get(gameId)!;
    const player = state.players.find(p => p.id === action.playerId);
    
    if (!player) {
      return { next: state, log: ['Player not found'] };
    }
    
    const ability: ActivatedAbility = action.ability;
    const activePlayerIndex = state.activePlayerIndex ?? 0;
    const priorityPlayerIndex = state.priorityPlayerIndex ?? activePlayerIndex;
    const activePlayer = state.players[activePlayerIndex] || state.players[0];
    const priorityPlayer = state.players[priorityPlayerIndex] || activePlayer;
    
    const activationContext: ActivationContext = {
      hasPriority: priorityPlayer?.id === action.playerId,
      isMainPhase: state.phase === 'precombatMain' || state.phase === 'postcombatMain',
      isOwnTurn: activePlayer?.id === action.playerId,
      stackEmpty: checkStackEmpty(this.stacks.get(gameId)!),
      isCombat: state.phase === 'combat',
      isUpkeep: String((state as any).step || '').trim().toLowerCase() === 'upkeep',
      activationsThisTurn: action.activationsThisTurn || 0,
      sourceTapped: action.sourceTapped || false,
    };

    if (!this.canPayActivatedAbilityAdditionalCosts(state, action.playerId, ability, action)) {
      return { next: state, log: ['Cannot pay required activated ability additional cost'] };
    }
    
    const manaPool = player.manaPool || emptyManaPool();
    const reducedCost = applyActivatedAbilityCostReductions({
      state,
      playerId: action.playerId,
      ability,
    });
    const abilityWithReducedCost = reducedCost.manaCost && reducedCost.manaCost !== ability.manaCost
      ? { ...ability, manaCost: reducedCost.manaCost }
      : ability;
    const result = activateAbility(abilityWithReducedCost, manaPool, activationContext);

    if (!result.success) {
      return { next: state, log: [result.error || 'Failed to activate ability'] };
    }
    
    // Update player's mana pool if cost was paid
    const updatedPlayers = state.players.map(p =>
      p.id === action.playerId
        ? { ...p, manaPool: result.manaPoolAfter! }
        : p
    );

    let nextState: GameState = {
      ...state,
      players: updatedPlayers,
    };

    const additionalCostPayment = this.payActivatedAbilityAdditionalCosts(nextState, action.playerId, ability, action);
    if (!additionalCostPayment.success) {
      return { next: state, log: ['Cannot pay required activated ability additional cost'] };
    }
    nextState = additionalCostPayment.state;
    
    // Add to stack
    const abilityTargetHints = buildTriggerEventDataFromPayloads(
      action.playerId,
      ability.targets,
      action
    );
    const selectedAbilityTargets =
      Array.isArray(ability.targets) && ability.targets.length > 0
        ? ability.targets
        : this.collectTargetIdsFromEventData(abilityTargetHints);
    const selectedPlayerTargetId = abilityTargetHints.targetPlayerId;
    const selectedOpponentTargetId = abilityTargetHints.targetOpponentId;
    const normalizedSelectedAbilityTargets = Array.isArray(selectedAbilityTargets)
      ? selectedAbilityTargets
          .map((id: any) => String(id || '').trim())
          .filter((id: string) => id.length > 0)
      : [];
    const dedupedSelectedAbilityTargets = Array.from(new Set(normalizedSelectedAbilityTargets));
    const selectedAbilityOpponentTargets = dedupedSelectedAbilityTargets.filter(id => id !== action.playerId);
    const fallbackAbilityTargetPlayerId =
      dedupedSelectedAbilityTargets.length === 1 ? dedupedSelectedAbilityTargets[0] : undefined;
    const fallbackAbilityTargetOpponentId =
      selectedAbilityOpponentTargets.length === 1 ? selectedAbilityOpponentTargets[0] : undefined;
    const abilityTriggerMeta = buildStackTriggerMetaFromEventData(
      ability.effect,
      ability.sourceId,
      action.playerId,
      ability.sourceName,
      {
        ...abilityTargetHints,
        affectedPlayerIds: abilityTargetHints.affectedPlayerIds ?? dedupedSelectedAbilityTargets,
        affectedOpponentIds: abilityTargetHints.affectedOpponentIds ?? selectedAbilityOpponentTargets,
        targetPlayerId: selectedPlayerTargetId ?? fallbackAbilityTargetPlayerId,
        targetOpponentId: selectedOpponentTargetId ?? fallbackAbilityTargetOpponentId,
      }
    );

    const stack = this.stacks.get(gameId)!;
    const stackResult = pushToStack(stack, {
      id: result.stackObjectId!,
      spellId: ability.id,
      cardName: `${ability.sourceName} ability`,
      controllerId: action.playerId,
      targets: selectedAbilityTargets,
      triggerMeta: abilityTriggerMeta,
      timestamp: Date.now(),
      type: 'ability',
    });
    this.stacks.set(gameId, stackResult.stack);
    
    this.emit({
      type: RulesEngineEvent.ABILITY_ACTIVATED,
      timestamp: Date.now(),
      gameId,
      data: { 
        ability,
        controller: action.playerId,
      },
    });

    if (additionalCostPayment.tappedSource) {
      this.emit({
        type: RulesEngineEvent.PERMANENT_TAPPED,
        timestamp: Date.now(),
        gameId,
        data: {
          permanentId: ability.sourceId,
          controllerId: action.playerId,
        },
      });
    }
    
    return {
      next: nextState,
      log: [
        ...(result.log || [`Activated ${ability.sourceName} ability`]),
        ...reducedCost.log,
        ...additionalCostPayment.log,
      ],
    };
  }
