/**
 * RulesEngineAdapter.ts
 * 
 * Unified adapter for the MTG Rules Engine that exposes a consistent API
 * for all game actions, validation, and state changes. This adapter integrates
 * all rules modules and provides a single entry point for:
 * - Action validation and legality checks
 * - Atomic state transitions
 * - Event emission for UI and simulation layers
 * - Win/loss condition detection
 * 
 * Note: Action handlers are now modularized in the actions/ directory.
 * This file serves as the main orchestrator and maintains backward compatibility.
 */

import type { GameState, PlayerID } from '../../shared/src';
import { GameStep as SharedGameStep } from '../../shared/src';
import { buildZoneObjectWithRetainedCounters } from '../../shared/src/zoneRetainedCounters';
import type { EngineResult } from './index';
import {
  Phase,
  Step,
  TurnStructure,
  advanceTurn,
  createTurnStructure,
  getNextStep,
  getNextPhase,
  doesStepReceivePriority,
} from './types/turnStructure';
import {
  checkPlayerLoss,
  PlayerLossCheck,
  LoseCondition,
  GameResult,
  MulliganState,
  takeMulligan,
  keepHand,
} from './types/gameFlow';
import { ManaType, type ManaPool as RulesEngineManaPool, type ManaCost } from './types/mana';
import { CostType } from './types/costs';
import { emptyManaPool } from './manaAbilities';
import {
  playerHasCantLoseEffect,
  applyTemporaryCantLoseAndOpponentsCantWinEffect,
} from './winEffectCards';
import {
  checkAuraAttachmentForState,
  checkCreatureDeathsForState,
  checkLegendRuleForState,
  checkPlaneswalkerDeathsForState,
  checkWinConditionsForState,
  movePermanentToGraveyard,
  payLifeActionForState,
} from './rulesEngineAdapterStateSupport';
import { dispatchRulesEngineAction } from './rulesEngineAdapterActionDispatch';
import {
  processControlLossDelayedTriggersForState,
  processDiesDelayedTriggersForState,
} from './rulesEngineAdapterDelayedTriggerSupport';
import {
  createDelayedTrigger,
  createDelayedTriggerRegistry,
  DelayedTriggerTiming,
  registerDelayedTrigger,
} from './delayedTriggeredAbilities';

/** Simple mana pool interface for checking mana availability (doesn't need restricted mana info) */
interface SimpleManaPool {
  white: number;
  blue: number;
  black: number;
  red: number;
  green: number;
  colorless: number;
}

import {
  castSpell,
  validateSpellTiming,
  type SpellCastingContext,
  type StackObject,
} from './spellCasting';
import { consumePlayableFromExileForCard, stripPlayableFromExileTags } from './playableFromExile';
import { consumePlayableFromGraveyardForCard, stripPlayableFromGraveyardTags } from './playableFromGraveyard';
import {
  createEmptyStack,
  pushToStack,
  popFromStack,
  isStackEmpty as checkStackEmpty,
  resolveStackObject,
  type Stack,
} from './stackOperations';
import {
  activateManaAbility,
  canActivateManaAbility,
  tapPermanentForMana,
  createBasicLandManaAbility,
  type ManaAbility,
  type TapForManaContext,
} from './manaAbilities';
import {
  activateAbility,
  type ActivatedAbility,
  type ActivationContext,
} from './activatedAbilities';
import { applyActivatedAbilityCostReductions } from './activatedAbilityCostReduction';
import {
  createEmptyTriggerQueue,
  processEvent,
  buildTriggerEventDataFromPayloads,
  buildStackTriggerMetaFromEventData,
  buildTriggeredAbilityChoiceEvents,
  executeTriggeredAbilityEffectWithOracleIR,
  buildResolutionEventDataFromGameState,
  evaluateTriggerCondition,
  type TriggerEventData,
  type TriggerQueue,
  type TriggeredAbility,
  TriggerEvent,
} from './triggeredAbilities';
// Import modular action handlers
import {
  executeSacrifice,
  validateSacrifice,
  executeSearchLibrary,
  validateSearchLibrary,
  executeDeclareAttackers,
  validateDeclareAttackers,
  executeDeclareBlockers,
  validateDeclareBlockers,
  executeCombatDamage,
  executeFetchland,
  validateFetchland,
  // Game automation
  initializeGame,
  drawInitialHand,
  processMulligan,
  completeMulliganPhase,
  advanceGame,
  passPriority as advancePassPriority,
  performStateBasedActions,
  checkWinConditions,
  executeTurnBasedAction,
  checkCombatDamageToPlayerTriggers,
  checkBecomesBlockedTriggers,
  checkTribalCastTriggers,
  checkSpellCastTriggers,
  GamePhase,
  GameStep,
} from './actions';

// Re-export events from core module, import for local use
export { RulesEngineEvent, type RulesEvent } from './core/events';
import { RulesEngineEvent } from './core/events';
import type { RulesEvent } from './core/events';

/**
 * Action validation result
 */
export interface ActionValidation {
  readonly legal: boolean;
  readonly reason?: string;
  readonly requirements?: string[];
}

/**
 * Rules Engine Adapter - Main interface for all rules operations
 */
export class RulesEngineAdapter {
  private eventListeners: Map<RulesEngineEvent, Set<(event: RulesEvent) => void>> = new Map();
  private gameStates: Map<string, GameState> = new Map();
  
  // Enhanced state tracking
  private stacks: Map<string, Stack> = new Map();
  private triggerQueues: Map<string, TriggerQueue> = new Map();
  private manaAbilities: Map<string, ManaAbility[]> = new Map();
  private activatedAbilities: Map<string, ActivatedAbility[]> = new Map();
  private triggeredAbilities: Map<string, TriggeredAbility[]> = new Map();
  
  constructor() {
    // Initialize event listener map for all event types
    Object.values(RulesEngineEvent).forEach(eventType => {
      this.eventListeners.set(eventType as RulesEngineEvent, new Set());
    });
  }
  
  /**
   * Register an event listener
   */
  on(eventType: RulesEngineEvent, callback: (event: RulesEvent) => void): void {
    const listeners = this.eventListeners.get(eventType);
    if (listeners) {
      listeners.add(callback);
    }
  }
  
  /**
   * Unregister an event listener
   */
  off(eventType: RulesEngineEvent, callback: (event: RulesEvent) => void): void {
    const listeners = this.eventListeners.get(eventType);
    if (listeners) {
      listeners.delete(callback);
    }
  }
  
  /**
   * Emit an event to all registered listeners
   */
  private emit(event: RulesEvent): void {
    const listeners = this.eventListeners.get(event.type);
    if (listeners) {
      listeners.forEach(callback => callback(event));
    }
  }
  
  /**
   * Initialize a new game with rules engine
   */
  initializeGame(gameId: string, initialState: GameState): EngineResult<GameState> {
    this.gameStates.set(gameId, initialState);
    this.stacks.set(gameId, createEmptyStack());
    this.triggerQueues.set(gameId, createEmptyTriggerQueue());
    this.manaAbilities.set(gameId, []);
    this.activatedAbilities.set(gameId, []);
    this.triggeredAbilities.set(gameId, []);
    
    this.emit({
      type: RulesEngineEvent.GAME_STARTED,
      timestamp: Date.now(),
      gameId,
      data: { state: initialState },
    });
    
    return {
      next: initialState,
      log: [`Game ${gameId} initialized with rules engine`],
    };
  }
  
  /**
   * Validate if an action is legal
   */
  validateAction(gameId: string, action: any): ActionValidation {
    const state = this.gameStates.get(gameId);
    if (!state) {
      return { legal: false, reason: 'Game not found' };
    }
    
    // TODO: Implement comprehensive validation based on action type
    // For now, basic validation
    switch (action.type) {
      case 'castSpell':
        return this.validateSpellCast(state, action);
      case 'playLand':
        return this.validatePlayLand(state, action);
      case 'declareAttackers':
        return this.validateAttackerDeclaration(state, action);
      case 'declareBlockers':
        return this.validateBlockerDeclaration(state, action);
      default:
        return { legal: true };
    }
  }

  /**
   * Validate land play (special action)
   */
  private validatePlayLand(state: GameState, action: any): ActionValidation {
    // Check if player has priority
    if (state.priorityPlayerIndex === undefined || state.priorityPlayerIndex === null) {
      // Legacy fallback
      return { legal: true };
    }

    const priorityPlayer = state.players?.[state.priorityPlayerIndex];
    if (!priorityPlayer) {
      return { legal: true };
    }

    if (priorityPlayer.id !== action.playerId) {
      return { legal: false, reason: 'Player does not have priority' };
    }

    const timing = this.buildTimingContext(state, action.playerId);
    if (!timing.isMainPhase || !timing.isOwnTurn || !timing.stackEmpty || !timing.hasPriority) {
      return { legal: false, reason: 'Cannot play a land right now' };
    }

    const stateAny: any = state as any;
    const landsPlayed = Number(stateAny.landsPlayedThisTurn?.[action.playerId] ?? 0) || 0;
    const maxLandsPerTurn =
      Number(stateAny.maxLandsPerTurn?.[action.playerId] ?? 1) || 1;
    if (landsPlayed >= maxLandsPerTurn) {
      return { legal: false, reason: 'No remaining land plays this turn' };
    }

    const fromZone = String(action.fromZone || 'hand').toLowerCase();
    const cardId = String(action.cardId || '');
    if (!cardId) {
      return { legal: false, reason: 'Missing cardId for land play' };
    }

    const player: any = state.players.find(p => p.id === action.playerId);
    if (!player) {
      return { legal: false, reason: 'Player not found' };
    }

    const findById = (arr: any[]): any | null => {
      const a = Array.isArray(arr) ? arr : [];
      return a.find(c => String(c?.id || c?.cardId || '') === cardId) || null;
    };

    if (fromZone === 'hand') {
      const inHand = findById(player.hand);
      if (!inHand) return { legal: false, reason: 'Card not found in hand' };
      const typeLineLower = String(inHand?.type_line || '').toLowerCase();
      if (!typeLineLower.includes('land')) return { legal: false, reason: 'Card is not a land' };
      return { legal: true };
    }

    if (fromZone === 'exile') {
      const exiledCard = findById(player.exile);
      if (!exiledCard) return { legal: false, reason: 'Card not found in exile' };
      const typeLineLower = String(exiledCard?.type_line || '').toLowerCase();
      if (!typeLineLower.includes('land')) return { legal: false, reason: 'Card is not a land' };

      // Require an explicit permission window (impulse-style effects).
      const playableFromExile = stateAny.playableFromExile?.[action.playerId] || {};
      const currentTurn = Number(stateAny.turnNumber ?? (state as any).turn ?? 0) || 0;
      const until = playableFromExile[cardId] ?? exiledCard.playableUntilTurn;
      const canBePlayedBy = exiledCard.canBePlayedBy;

      if (canBePlayedBy && canBePlayedBy !== action.playerId) {
        return { legal: false, reason: 'Card is not playable by this player' };
      }
      if (typeof until !== 'number') {
        return { legal: false, reason: 'No permission to play this land from exile' };
      }
      if (until < currentTurn) {
        return { legal: false, reason: 'Permission window to play from exile has expired' };
      }

      return { legal: true };
    }

    if (fromZone === 'graveyard') {
      const graveyardCard = findById(player.graveyard);
      if (!graveyardCard) return { legal: false, reason: 'Card not found in graveyard' };
      const typeLineLower = String(graveyardCard?.type_line || '').toLowerCase();
      if (!typeLineLower.includes('land')) return { legal: false, reason: 'Card is not a land' };

      const playableFromGraveyard = stateAny.playableFromGraveyard?.[action.playerId] || {};
      const currentTurn = Number(stateAny.turnNumber ?? (state as any).turn ?? 0) || 0;
      const until = playableFromGraveyard[cardId] ?? graveyardCard.playableUntilTurn;
      const canBePlayedBy = graveyardCard.canBePlayedBy;

      if (canBePlayedBy && canBePlayedBy !== action.playerId) {
        return { legal: false, reason: 'Card is not playable by this player' };
      }
      if (typeof until !== 'number') {
        return { legal: false, reason: 'No permission to play this land from graveyard' };
      }
      if (until < currentTurn) {
        return { legal: false, reason: 'Permission window to play from graveyard has expired' };
      }

      return { legal: true };
    }

    return { legal: false, reason: `Unsupported fromZone: ${fromZone}` };
  }
  
  /**
   * Validate spell casting
   */
  private validateSpellCast(state: GameState, action: any): ActionValidation {
    // Check if player has priority
    // Handle undefined priorityPlayerIndex gracefully
    if (state.priorityPlayerIndex === undefined || state.priorityPlayerIndex === null) {
      // If no priority player set, allow the action (legacy fallback)
      return { legal: true };
    }
    
    const activePlayer = state.players?.[state.priorityPlayerIndex];
    if (!activePlayer) {
      // If player not found at index, allow the action (legacy fallback)
      return { legal: true };
    }
    
    if (activePlayer.id !== action.playerId) {
      return {
        legal: false,
        reason: 'Player does not have priority',
      };
    }
    
    const fromZone = String(action.fromZone || 'hand').toLowerCase();
    const cardId = String(action.cardId || action.spellId || '');
    const sourceCard = this.findSourceZoneCard(state, action.playerId, cardId, fromZone);
    const ignoresManaCost = Boolean((sourceCard as any)?.withoutPayingManaCost);
    const intrinsicGraveyardCast = this.getIntrinsicGraveyardCastMetadata(sourceCard, fromZone);
    const keywordAdjustedManaCostInput = this.getEffectiveKeywordAdjustedManaCostInput(action, sourceCard, fromZone);
    const derivedManaCostInput =
      action.manaCost ??
      keywordAdjustedManaCostInput ??
      (fromZone === 'exile' ? (sourceCard as any)?.exileCastCost : undefined) ??
      (fromZone === 'graveyard'
        ? ((sourceCard as any)?.graveyardCastCost === 'mana_cost'
            ? ((sourceCard as any)?.mana_cost ?? (sourceCard as any)?.manaCost)
            : ((sourceCard as any)?.graveyardCastCostRaw ?? intrinsicGraveyardCast.cost))
        : undefined);

    // Check mana availability if mana cost is provided
    if (derivedManaCostInput && !ignoresManaCost) {
      const player = state.players.find(p => p.id === action.playerId);
      if (!player) {
        return {
          legal: false,
          reason: 'Player not found',
        };
      }
      
      // Parse mana cost string (e.g., "{2}{U}{U}")
      const cost = this.parseManaCostString(derivedManaCostInput);
      const pool = player.manaPool || { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
      
      // Check if player can pay the cost
      const canPay = this.canPayManaCostFromPool(cost, pool);
      if (!canPay.canPay) {
        return {
          legal: false,
          reason: canPay.reason || 'Insufficient mana',
        };
      }
    }

    if (fromZone === 'graveyard' && (sourceCard as any)?.graveyardAdditionalCost) {
      if (!this.canPayGraveyardAdditionalCost(state, action.playerId, (sourceCard as any).graveyardAdditionalCost)) {
        return {
          legal: false,
          reason: 'Cannot pay required graveyard additional cost',
        };
      }
    }
    
    // If a cardId is provided, enforce the card is in the declared origin zone.
    // This prevents "cast from exile" from silently defaulting to hand casts.
    // Check timing restrictions (main phase, stack empty for sorceries, etc.)
    const cardTypes = this.getCardTypes(action.card || action.spell || sourceCard);
    const timingContext = this.buildTimingContext(state, action.playerId);
    const timingResult = validateSpellTiming(cardTypes, timingContext);
    
    if (!timingResult.valid) {
      return {
        legal: false,
        reason: timingResult.reason || 'Invalid timing',
      };
    }

    if (cardId && fromZone === 'hand') {
      const player: any = state.players.find(p => p.id === action.playerId);
      if (!player) {
        return { legal: false, reason: 'Player not found' };
      }

      const handArr: any[] = Array.isArray(player.hand) ? player.hand : [];
      const inHand = handArr.some(c => String(c?.id || c?.cardId || '') === cardId);
      if (!inHand) {
        return { legal: false, reason: 'Card not found in hand' };
      }
    }

    // If casting from exile, require an explicit permission window.
    if (fromZone === 'exile') {
      if (!cardId) {
        return { legal: false, reason: 'Missing cardId for exile cast' };
      }

      const player = state.players.find(p => p.id === action.playerId) as any;
      if (!player) {
        return { legal: false, reason: 'Player not found' };
      }

      const exileArr: any[] = Array.isArray(player.exile) ? player.exile : [];
      const exiledCard = exileArr.find(c => String(c?.id || c?.cardId || '') === cardId);
      if (!exiledCard) {
        return { legal: false, reason: 'Card not found in exile' };
      }

      const typeLineLower = String(exiledCard?.type_line || '').toLowerCase();
      if (typeLineLower.includes('land')) {
        return { legal: false, reason: 'Cannot cast a land from exile' };
      }

      const stateAny: any = state as any;
      const currentTurn = Number(stateAny.turnNumber ?? (state as any).turn ?? 0) || 0;
      const playableFromExile = stateAny.playableFromExile?.[action.playerId] || {};
      const until = playableFromExile[cardId] ?? exiledCard.playableUntilTurn;
      const canBePlayedBy = exiledCard.canBePlayedBy;

      if (canBePlayedBy && canBePlayedBy !== action.playerId) {
        return { legal: false, reason: 'Card is not playable by this player' };
      }
      if (typeof until !== 'number') {
        return { legal: false, reason: 'No permission to cast this card from exile' };
      }
      if (until < currentTurn) {
        return { legal: false, reason: 'Permission window to cast from exile has expired' };
      }
    }

    if (fromZone === 'graveyard') {
      if (!cardId) {
        return { legal: false, reason: 'Missing cardId for graveyard cast' };
      }

      const player = state.players.find(p => p.id === action.playerId) as any;
      if (!player) {
        return { legal: false, reason: 'Player not found' };
      }

      const graveyardArr: any[] = Array.isArray(player.graveyard) ? player.graveyard : [];
      const graveyardCard = graveyardArr.find(c => String(c?.id || c?.cardId || '') === cardId);
      if (!graveyardCard) {
        return { legal: false, reason: 'Card not found in graveyard' };
      }

      const typeLineLower = String(graveyardCard?.type_line || '').toLowerCase();
      if (typeLineLower.includes('land')) {
        return { legal: false, reason: 'Cannot cast a land from graveyard' };
      }

      const stateAny: any = state as any;
      const currentTurn = Number(stateAny.turnNumber ?? (state as any).turn ?? 0) || 0;
      const playableFromGraveyard = stateAny.playableFromGraveyard?.[action.playerId] || {};
      const until = playableFromGraveyard[cardId] ?? graveyardCard.playableUntilTurn;
      const canBePlayedBy = graveyardCard.canBePlayedBy;

      if (canBePlayedBy && canBePlayedBy !== action.playerId) {
        return { legal: false, reason: 'Card is not playable by this player' };
      }
      if (typeof until !== 'number' && !intrinsicGraveyardCast.cost) {
        return { legal: false, reason: 'No permission to cast this card from graveyard' };
      }
      if (typeof until === 'number' && until < currentTurn) {
        return { legal: false, reason: 'Permission window to cast from graveyard has expired' };
      }
    }
    
    return { legal: true };
  }
  
  /**
   * Extract card types from a card object
   */
  private getCardTypes(card: any): string[] {
    if (!card) return [];
    
    const typeLine = card.type_line || card.typeLine || '';
    const types: string[] = [];
    
    // Parse type line (e.g., "Creature — Human Wizard" or "Instant")
    const mainTypes = typeLine.split('—')[0].toLowerCase();
    
    if (mainTypes.includes('creature')) types.push('creature');
    if (mainTypes.includes('instant')) types.push('instant');
    if (mainTypes.includes('sorcery')) types.push('sorcery');
    if (mainTypes.includes('artifact')) types.push('artifact');
    if (mainTypes.includes('enchantment')) types.push('enchantment');
    if (mainTypes.includes('planeswalker')) types.push('planeswalker');
    if (mainTypes.includes('land')) types.push('land');
    if (mainTypes.includes('battle')) types.push('battle');
    
    // Check for flash keyword
    const oracleText = (card.oracle_text || '').toLowerCase();
    if (oracleText.includes('flash')) {
      types.push('flash');
    }
    
    return types;
  }

  private findSourceZoneCard(state: GameState, playerId: string, cardId: string, fromZone: string): any | null {
    if (!cardId) return null;

    const player: any = state.players.find(p => p.id === playerId);
    if (!player) return null;

    const sourceZoneCards = (() => {
      if (fromZone === 'exile') return Array.isArray(player.exile) ? player.exile : [];
      if (fromZone === 'graveyard') return Array.isArray(player.graveyard) ? player.graveyard : [];
      return Array.isArray(player.hand) ? player.hand : [];
    })();

    return sourceZoneCards.find((card: any) => String(card?.id || card?.cardId || '') === cardId) || null;
  }

  private extractKeywordCostFromOracleText(card: any, keyword: string): string | undefined {
    const normalizedKeyword = String(keyword || '').trim().toLowerCase();
    if (!normalizedKeyword) return undefined;

    const oracleText = String(card?.oracle_text || card?.card?.oracle_text || '');
    if (!oracleText) return undefined;

    const keywordPattern = new RegExp(`^${normalizedKeyword}\\s+(?:[\\u2014-]\\s*)?(.+)$`, 'i');
    for (const rawLine of oracleText.split(/\r?\n/)) {
      const line = String(rawLine || '').trim();
      if (!line) continue;
      const match = line.match(keywordPattern);
      if (!match) continue;
      const cost = String(match[1] || '')
        .replace(/\s+\([^()]*\)\s*$/, '')
        .trim();
      if (cost) return cost;
    }

    return undefined;
  }

  private getIntrinsicGraveyardCastMetadata(sourceCard: any, fromZone: string): {
    readonly cost?: string;
    readonly entersBattlefieldTransformed?: boolean;
  } {
    if (String(fromZone || '').trim().toLowerCase() !== 'graveyard') return {};

    const disturbCost = this.extractKeywordCostFromOracleText(sourceCard, 'disturb');
    if (disturbCost) {
      return {
        cost: disturbCost,
        entersBattlefieldTransformed: true,
      };
    }

    return {};
  }

  private buildTransformedCardFace(sourceCard: any): any {
    const base = sourceCard && typeof sourceCard === 'object' ? sourceCard : {};
    const faces = Array.isArray(base?.card_faces) ? base.card_faces : [];
    const backFace = faces.length >= 2 && faces[1] && typeof faces[1] === 'object' ? faces[1] : null;
    if (!backFace) return base;

    return {
      ...base,
      ...backFace,
      transformed: true,
      currentFace: 'back',
    };
  }

  private addManaCostValues(left: string | ManaCost | undefined, right: string | ManaCost | undefined): ManaCost {
    const leftCost = this.parseManaCostString(left);
    const rightCost = this.parseManaCostString(right);
    return {
      generic: (leftCost.generic || 0) + (rightCost.generic || 0),
      white: (leftCost.white || 0) + (rightCost.white || 0),
      blue: (leftCost.blue || 0) + (rightCost.blue || 0),
      black: (leftCost.black || 0) + (rightCost.black || 0),
      red: (leftCost.red || 0) + (rightCost.red || 0),
      green: (leftCost.green || 0) + (rightCost.green || 0),
      colorless: (leftCost.colorless || 0) + (rightCost.colorless || 0),
    };
  }

  private manaCostsEqual(left: ManaCost, right: ManaCost): boolean {
    return (
      (left.generic || 0) === (right.generic || 0) &&
      (left.white || 0) === (right.white || 0) &&
      (left.blue || 0) === (right.blue || 0) &&
      (left.black || 0) === (right.black || 0) &&
      (left.red || 0) === (right.red || 0) &&
      (left.green || 0) === (right.green || 0) &&
      (left.colorless || 0) === (right.colorless || 0)
    );
  }

  private multiplyManaCost(cost: string | ManaCost | undefined, count: number): ManaCost {
    const normalizedCount = Math.max(0, Math.floor(Number(count) || 0));
    const parsed = this.parseManaCostString(cost);
    return {
      generic: (parsed.generic || 0) * normalizedCount,
      white: (parsed.white || 0) * normalizedCount,
      blue: (parsed.blue || 0) * normalizedCount,
      black: (parsed.black || 0) * normalizedCount,
      red: (parsed.red || 0) * normalizedCount,
      green: (parsed.green || 0) * normalizedCount,
      colorless: (parsed.colorless || 0) * normalizedCount,
    };
  }

  private shouldPayBuyback(action: any): boolean {
    if (action?.payBuyback === true || action?.buyback === true) {
      return true;
    }

    const additionalCosts = Array.isArray(action?.additionalCosts) ? action.additionalCosts : [];
    return additionalCosts.some((cost: any) => {
      if (typeof cost === 'string') {
        return String(cost).trim().toLowerCase() === 'buyback';
      }

      const type = String(cost?.type || cost?.keyword || '').trim().toLowerCase();
      return type === 'buyback';
    });
  }

  private getReplicateCount(action: any): number {
    return Math.max(0, Math.floor(Number(action?.replicateCount) || 0));
  }

  private getEffectiveKeywordAdjustedManaCostInput(action: any, sourceCard: any, fromZone: string): ManaCost | undefined {
    if (String(fromZone || '').trim().toLowerCase() !== 'hand') {
      return undefined;
    }

    const ignoresManaCost = Boolean((sourceCard as any)?.withoutPayingManaCost);
    let totalCost = this.parseManaCostString(
      ignoresManaCost ? {} : ((sourceCard as any)?.mana_cost ?? (sourceCard as any)?.manaCost)
    );
    let changed = false;

    const replicateCount = this.getReplicateCount(action);
    if (replicateCount > 0) {
      const replicateCost = this.extractKeywordCostFromOracleText(sourceCard, 'replicate');
      if (replicateCost) {
        totalCost = this.addManaCostValues(totalCost, this.multiplyManaCost(replicateCost, replicateCount));
        changed = true;
      }
    }

    if (this.shouldPayBuyback(action)) {
      const buybackCost = this.extractKeywordCostFromOracleText(sourceCard, 'buyback');
      if (buybackCost) {
        totalCost = this.addManaCostValues(totalCost, buybackCost);
        changed = true;
      }
    }

    return changed ? totalCost : undefined;
  }

  private getEffectiveBuybackManaCostInput(action: any, sourceCard: any, fromZone: string): ManaCost | undefined {
    if (String(fromZone || '').trim().toLowerCase() !== 'hand' || !this.shouldPayBuyback(action)) {
      return undefined;
    }

    const buybackCost = this.extractKeywordCostFromOracleText(sourceCard, 'buyback');
    if (!buybackCost) return undefined;

    const baseCost = Boolean((sourceCard as any)?.withoutPayingManaCost)
      ? {}
      : ((sourceCard as any)?.mana_cost ?? (sourceCard as any)?.manaCost);

    return this.addManaCostValues(baseCost, buybackCost);
  }

  private didPayBuyback(action: any, sourceCard: any, fromZone: string): boolean {
    if (String(fromZone || '').trim().toLowerCase() !== 'hand') return false;

    const buybackCost = this.extractKeywordCostFromOracleText(sourceCard, 'buyback');
    if (!buybackCost) return false;

    if (this.shouldPayBuyback(action)) return true;
    if (!action?.manaCost) return false;

    const combinedCost = this.addManaCostValues(
      Boolean((sourceCard as any)?.withoutPayingManaCost)
        ? {}
        : ((sourceCard as any)?.mana_cost ?? (sourceCard as any)?.manaCost),
      buybackCost
    );
    return this.manaCostsEqual(this.parseManaCostString(action.manaCost), combinedCost);
  }

  private sanitizeSpellCardAfterStackExit(card: any): any {
    const strippedPlayableTags = stripPlayableFromGraveyardTags(stripPlayableFromExileTags(card));
    const {
      entersBattlefieldWithCounters,
      entersBattlefieldTransformed,
      exileInsteadOfGraveyard,
      returnToHandInsteadOfGraveyard,
      ...rest
    } = (strippedPlayableTags || {}) as any;
    return rest;
  }

  private moveResolvedNonPermanentSpellToZone(
    state: GameState,
    stackObject: any,
    zone: 'graveyard' | 'exile' | 'hand'
  ): GameState {
    const ownerId = String(stackObject?.ownerId || stackObject?.controllerId || '').trim();
    if (!ownerId) return state;

    const stackCard = stackObject?.card && typeof stackObject.card === 'object'
      ? stackObject.card
      : {};
    const cardToMove = this.sanitizeSpellCardAfterStackExit({
      ...stackCard,
      id: String(stackCard?.id || stackObject?.spellId || stackObject?.id || ''),
      name: String(stackCard?.name || stackObject?.cardName || 'Unknown Card'),
      type_line: String(stackCard?.type_line || ''),
      oracle_text: String(stackCard?.oracle_text || stackObject?.triggerMeta?.effectText || ''),
    });

    const updatedPlayers = (state.players || []).map((player: any) => {
      if (player.id !== ownerId) return player;

      const zoneCards = Array.isArray(player?.[zone]) ? [...player[zone]] : [];
      return {
        ...player,
        [zone]: [...zoneCards, cardToMove],
      };
    });

    return {
      ...state,
      players: updatedPlayers as any,
    };
  }

  private spellCardHasKeyword(stackObject: any, keyword: string): boolean {
    const normalizedKeyword = String(keyword || '').trim().toLowerCase();
    if (!normalizedKeyword) return false;

    const stackCard = stackObject?.card && typeof stackObject.card === 'object'
      ? stackObject.card
      : {};

    if (
      Array.isArray((stackCard as any)?.keywords) &&
      (stackCard as any).keywords.some((value: unknown) => String(value || '').trim().toLowerCase() === normalizedKeyword)
    ) {
      return true;
    }

    const oracleText = String(stackCard?.oracle_text || stackObject?.triggerMeta?.effectText || '').trim();
    if (!oracleText) return false;

    return oracleText
      .split(/\r?\n/)
      .map(line => String(line || '').trim())
      .filter(Boolean)
      .some(line => /^rebound(?:\s|\(|$)/i.test(line));
  }

  private registerReboundDelayedTrigger(state: GameState, stackObject: any): GameState {
    const cardId = String(stackObject?.spellId || stackObject?.card?.id || stackObject?.id || '').trim();
    const controllerId = String(stackObject?.controllerId || stackObject?.controller || '').trim() as PlayerID;
    const sourceName = String(stackObject?.cardName || stackObject?.card?.name || 'Rebound').trim() || 'Rebound';
    if (!cardId || !controllerId) return state;

    const currentTurn = Number((state as any).turnNumber ?? (state as any).turn ?? 0) || 0;
    const delayedTrigger = createDelayedTrigger(
      cardId,
      sourceName,
      controllerId,
      DelayedTriggerTiming.YOUR_NEXT_UPKEEP,
      'You may cast this card from exile without paying its mana cost.',
      currentTurn,
      {
        eventDataSnapshot: {
          sourceId: cardId,
          sourceControllerId: controllerId,
          chosenObjectIds: [cardId],
        },
      }
    );

    const registry = (state as any).delayedTriggerRegistry || createDelayedTriggerRegistry();
    const nextRegistry = registerDelayedTrigger(registry, delayedTrigger);
    return {
      ...(state as any),
      delayedTriggerRegistry: nextRegistry,
    } as GameState;
  }

  private moveResolvedPermanentSpellToBattlefield(state: GameState, stackObject: any): GameState {
    const stackCard = stackObject?.card && typeof stackObject.card === 'object'
      ? stackObject.card
      : {};
    const permanentId = String(stackCard?.id || stackObject?.spellId || stackObject?.id || '');
    const ownerId = String(stackObject?.ownerId || stackObject?.controllerId || '').trim();
    const controllerId = String(stackObject?.controllerId || ownerId).trim();
    if (!permanentId || !controllerId) return state;

    const permanent = {
      id: permanentId,
      controller: controllerId,
      owner: ownerId || controllerId,
      name: String(stackCard?.name || stackObject?.cardName || 'Unknown Permanent'),
      type_line: String(stackCard?.type_line || ''),
      manaCost: stackCard?.mana_cost ?? stackCard?.manaCost,
      power: stackCard?.power,
      toughness: stackCard?.toughness,
      tapped: false,
      summoningSickness: true,
      counters:
        stackCard?.entersBattlefieldWithCounters && typeof stackCard.entersBattlefieldWithCounters === 'object'
          ? { ...(stackCard.entersBattlefieldWithCounters as Record<string, number>) }
          : {},
      attachments: [],
      card: this.sanitizeSpellCardAfterStackExit(stackCard),
    } as any;

    return {
      ...(state as any),
      battlefield: [...((state.battlefield || []) as any[]), permanent],
    } as any;
  }
  
  /**
   * Build timing context for spell validation
   */
  private buildTimingContext(state: GameState, playerId: string): {
    isMainPhase: boolean;
    isOwnTurn: boolean;
    stackEmpty: boolean;
    hasPriority: boolean;
  } {
    // Get phase info
    const phase = state.phase;
    // Support both enum values and string variants for phase comparison
    const phaseStr = String(phase || '').toLowerCase();
    const isMainPhase = phaseStr === 'precombatmain' || phaseStr === 'postcombatmain' ||
                        phaseStr === 'precombat_main' || phaseStr === 'postcombat_main' ||
                        phaseStr === 'first_main' || phaseStr === 'main1' || phaseStr === 'main2';
    
    // Check if it's the player's turn
    const activePlayerIndex = state.activePlayerIndex || 0;
    const activePlayer = state.players[activePlayerIndex];
    const isOwnTurn = activePlayer?.id === playerId;
    
    // Check stack
    const stackItems = Array.isArray((state as any).stack)
      ? (state as any).stack
      : Array.isArray(((state as any).stack || {}).objects)
        ? ((state as any).stack || {}).objects
        : [];
    const stackEmpty = stackItems.length === 0;
    
    // Check priority
    const priorityIndex = state.priorityPlayerIndex ?? activePlayerIndex;
    const priorityPlayer = state.players[priorityIndex];
    const hasPriority = priorityPlayer?.id === playerId;
    
    return {
      isMainPhase,
      isOwnTurn,
      stackEmpty,
      hasPriority,
    };
  }

  private normalizeGraveyardAdditionalCostFilter(filterText?: string): string[] {
    const normalized = String(filterText || '')
      .toLowerCase()
      .replace(/\bcards?\b/g, '')
      .replace(/\bpermanents?\b/g, '')
      .replace(/\byou control\b/g, '')
      .replace(/\bcontrol\b/g, '')
      .replace(/\bfrom among\b/g, '')
      .replace(/\bother\b/g, '')
      .replace(/\band\/or\b/g, ' or ')
      .replace(/,/g, ' or ')
      .replace(/\bcreatures\b/g, 'creature')
      .replace(/\bartifacts\b/g, 'artifact')
      .replace(/\benchantments\b/g, 'enchantment')
      .replace(/\bplaneswalkers\b/g, 'planeswalker')
      .replace(/\blands\b/g, 'land')
      .replace(/\binstants\b/g, 'instant')
      .replace(/\bsorceries\b/g, 'sorcery')
      .replace(/\bbattles\b/g, 'battle')
      .replace(/\s+/g, ' ')
      .trim();
    if (!normalized) return [];
    return normalized
      .split(/\bor\b/g)
      .map(part => part.replace(/^(?:a|an)\s+/i, '').trim())
      .filter(Boolean);
  }

  private cardMatchesAdditionalCostFilter(cardLike: any, filterText?: string): boolean {
    const terms = this.normalizeGraveyardAdditionalCostFilter(filterText);
    if (terms.length === 0) return true;

    const typeLine = String(cardLike?.type_line || cardLike?.card?.type_line || '').toLowerCase();
    const isToken = Boolean(cardLike?.isToken || cardLike?.card?.isToken || typeLine.includes('token'));

    return terms.some(term => {
      if (term === 'card') return true;
      if (term === 'token') return isToken;
      return typeLine.includes(term);
    });
  }

  private getEligibleDiscardCards(state: GameState, playerId: string, filterText?: string): any[] {
    const player = state.players.find(p => p.id === playerId) as any;
    if (!player) return [];
    const hand = Array.isArray(player.hand) ? player.hand : [];
    return hand.filter((card: any) => this.cardMatchesAdditionalCostFilter(card, filterText));
  }

  private getEligibleSacrificePermanents(state: GameState, playerId: string, filterText?: string): any[] {
    const battlefield = Array.isArray((state as any).battlefield) ? ((state as any).battlefield as any[]) : [];
    return battlefield.filter(
      (perm: any) =>
        String(perm?.controller || '').trim() === playerId &&
        this.cardMatchesAdditionalCostFilter(perm, filterText)
    );
  }

  private getEligibleGraveyardExileCards(state: GameState, playerId: string): any[] {
    const player = state.players.find(p => p.id === playerId) as any;
    if (!player) return [];
    return Array.isArray(player.graveyard) ? [...player.graveyard] : [];
  }

  private getEligibleCounterRemovalPermanents(
    state: GameState,
    playerId: string,
    filterText?: string,
    counter?: string
  ): any[] {
    const battlefield = Array.isArray((state as any).battlefield) ? ((state as any).battlefield as any[]) : [];
    return battlefield.filter((perm: any) => {
      if (String(perm?.controller || '').trim() !== playerId) return false;
      if (!this.cardMatchesAdditionalCostFilter(perm, filterText)) return false;

      const counters = (perm?.counters || {}) as Record<string, number>;
      if (counter) {
        return Number(counters[counter] ?? 0) > 0;
      }

      return Object.values(counters).some((value) => Number(value) > 0);
    });
  }

  private totalRemovableCountersOnPermanent(perm: any, counter?: string): number {
    const counters = (perm?.counters || {}) as Record<string, number>;
    if (counter) {
      return Math.max(0, Number(counters[counter] ?? 0) || 0);
    }
    return Object.values(counters).reduce((total, value) => total + Math.max(0, Number(value) || 0), 0);
  }

  private removeCountersFromEligiblePermanents(
    state: GameState,
    playerId: string,
    amount: number,
    filterText?: string,
    counter?: string
  ): { success: boolean; state: GameState; log: string[] } {
    const totalAmount = Math.max(0, Number(amount) || 0);
    if (totalAmount <= 0) {
      return { success: true, state, log: [] };
    }

    const battlefield = Array.isArray((state as any).battlefield) ? ((state as any).battlefield as any[]) : [];
    const eligible = this.getEligibleCounterRemovalPermanents(state, playerId, filterText, counter);
    const totalAvailable = eligible.reduce((sum, perm) => sum + this.totalRemovableCountersOnPermanent(perm, counter), 0);
    if (totalAvailable < totalAmount) {
      return { success: false, state, log: [] };
    }

    let remaining = totalAmount;
    const eligibleIds = new Set(eligible.map((perm: any) => String(perm?.id || perm?.cardId || '').trim()).filter(Boolean));
    const nextBattlefield = battlefield.map((perm: any) => {
      if (remaining <= 0) return perm;
      if (String(perm?.controller || '').trim() !== playerId) return perm;
      const permanentId = String(perm?.id || perm?.cardId || '').trim();
      if (!eligibleIds.has(permanentId)) return perm;

      const currentCounters = { ...((perm?.counters || {}) as Record<string, number>) };
      const counterNames = counter ? [counter] : Object.keys(currentCounters).sort();
      let changed = false;

      for (const counterName of counterNames) {
        const currentValue = Math.max(0, Number(currentCounters[counterName] ?? 0) || 0);
        if (currentValue <= 0) continue;

        const removed = Math.min(currentValue, remaining);
        const nextValue = currentValue - removed;
        remaining -= removed;
        changed = true;

        if (nextValue > 0) {
          currentCounters[counterName] = nextValue;
        } else {
          delete currentCounters[counterName];
        }

        if (remaining <= 0) break;
      }

      return changed ? { ...perm, counters: currentCounters } : perm;
    });

    if (remaining > 0) {
      return { success: false, state, log: [] };
    }

    return {
      success: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: [counter ? `${playerId} removes ${totalAmount} ${counter} counter(s)` : `${playerId} removes ${totalAmount} counter(s)`],
    };
  }

  private parseLifeAmountFromCostDescription(description?: string): number {
    const match = String(description || '').match(/pay\s+(\d+)\s+life/i);
    return Math.max(0, Number(match?.[1] || 0) || 0);
  }

  private parseCountToken(token: unknown, defaultValue = 1): number {
    const text = String(token || '').trim().toLowerCase();
    if (!text) return defaultValue;
    if (text === 'a' || text === 'an') return 1;
    const wordCounts: Record<string, number> = {
      zero: 0,
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
      eleven: 11,
      twelve: 12,
    };
    if (Object.prototype.hasOwnProperty.call(wordCounts, text)) {
      return wordCounts[text];
    }
    const numeric = Number(text);
    return Math.max(0, Number.isFinite(numeric) ? numeric : defaultValue);
  }

  private parseTapCostFromDescription(description?: string): { count: number; filterText?: string; selfOnly: boolean } {
    const normalized = String(description || '').trim();
    if (!normalized) return { count: 1, filterText: undefined, selfOnly: true };

    const selfMatch = normalized.match(/^tap\s+(this .+)$/i);
    if (selfMatch) {
      return {
        count: 1,
        filterText: String(selfMatch[1] || '').trim(),
        selfOnly: true,
      };
    }

    const countPattern = '(a|an|\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)';
    const match = normalized.match(new RegExp(`^tap\\s+${countPattern}\\s+(.+)$`, 'i'));
    if (!match) {
      return { count: 1, filterText: undefined, selfOnly: false };
    }

    const rawFilter = String(match[2] || '').trim();
    return {
      count: this.parseCountToken(match[1], 1),
      filterText: rawFilter
        .replace(/\buntapped\b/gi, '')
        .replace(/\byou control\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim() || undefined,
      selfOnly: false,
    };
  }

  private parseDiscardCostFromDescription(description?: string): { count: number; filterText?: string } {
    const match = String(description || '').match(/discard\s+(a|an|\d+)\s+(.+)/i);
    const rawFilter = String(match?.[2] || '').trim();
    return {
      count: this.parseCountToken(match?.[1], 1),
      filterText: rawFilter
        .replace(/card\(s\)/gi, '')
        .replace(/\bcards?\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim() || undefined,
    };
  }

  private parseSacrificeCostFromDescription(description?: string): { count: number; filterText?: string } {
    const match = String(description || '').match(/sacrifice\s+(a|an|\d+)\s+(.+)/i);
    if (match) {
      const rawFilter = String(match[2] || '').trim();
      return {
        count: this.parseCountToken(match[1], 1),
        filterText: rawFilter
          .replace(/permanent\(s\)/gi, '')
          .replace(/\bpermanents?\b/gi, '')
          .replace(/\s+/g, ' ')
          .trim() || undefined,
      };
    }

    const selfMatch = String(description || '').match(/sacrifice\s+(this .+)/i);
    return {
      count: 1,
      filterText: selfMatch ? String(selfMatch[1] || '').trim() : undefined,
    };
  }

  private parseCounterRemovalFromCostDescription(description?: string): { count: number; counter?: string; filterText?: string } {
    const match = String(description || '').match(/remove\s+(a|an|\d+)\s+(.+?)\s+counter\(s\)(?:\s+from\s+(.+))?/i);
    return {
      count: this.parseCountToken(match?.[1], 1),
      counter: String(match?.[2] || '').trim() || undefined,
      filterText: String(match?.[3] || '').trim() || undefined,
    };
  }

  private parseExileCostFromDescription(description?: string): { count: number; filterText?: string } {
    const match = String(description || '').match(/exile\s+(a|an|\d+)\s+(.+)/i);
    if (match) {
      return {
        count: this.parseCountToken(match?.[1], 1),
        filterText: String(match?.[2] || '').trim() || undefined,
      };
    }

    return { count: 1, filterText: undefined };
  }

  private resolveActivatedAbilityDiscardCards(
    state: GameState,
    playerId: string,
    action: any,
    count: number,
    filterText?: string
  ): any[] {
    const player = state.players.find(p => p.id === playerId) as any;
    const hand = Array.isArray(player?.hand) ? player.hand : [];
    const eligible = hand.filter((card: any) => this.cardMatchesAdditionalCostFilter(card, filterText));
    const explicitIds = Array.isArray(action?.additionalCostCardIds)
      ? action.additionalCostCardIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
      : [];

    if (explicitIds.length > 0) {
      const selected = eligible.filter((card: any) => explicitIds.includes(String(card?.id || card?.cardId || '').trim()));
      return selected.length === count ? selected : [];
    }

    if (eligible.length === count) return eligible.slice(0, count);
    if (count === 1 && eligible.length === 1) return eligible.slice(0, 1);
    return [];
  }

  private getEligibleTapPermanents(state: GameState, playerId: string, filterText?: string): any[] {
    const battlefield = Array.isArray((state as any).battlefield) ? ((state as any).battlefield as any[]) : [];
    return battlefield.filter(
      (perm: any) =>
        String(perm?.controller || '').trim() === playerId &&
        !Boolean(perm?.tapped) &&
        this.cardMatchesAdditionalCostFilter(perm, filterText)
    );
  }

  private resolveActivatedAbilityTapPermanents(
    state: GameState,
    playerId: string,
    ability: ActivatedAbility,
    action: any,
    description?: string
  ): any[] {
    const battlefield = Array.isArray((state as any).battlefield) ? ((state as any).battlefield as any[]) : [];
    const sourceId = String(ability.sourceId || '').trim();
    const sourcePermanent = battlefield.find((perm: any) => String(perm?.id || '').trim() === sourceId);
    const parsed = this.parseTapCostFromDescription(description);
    const explicitIds = Array.isArray(action?.additionalCostPermanentIds)
      ? action.additionalCostPermanentIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
      : [];
    const eligible = this.getEligibleTapPermanents(state, playerId, parsed.filterText);

    if (parsed.selfOnly) {
      if (
        sourcePermanent &&
        !Boolean(sourcePermanent?.tapped) &&
        String(sourcePermanent?.controller || '').trim() === playerId
      ) {
        return [sourcePermanent];
      }
      return [];
    }

    if (explicitIds.length > 0) {
      const explicitSet = new Set(explicitIds);
      if (explicitSet.size !== parsed.count) return [];
      const selected = eligible.filter((perm: any) => explicitSet.has(String(perm?.id || perm?.cardId || '').trim()));
      return selected.length === parsed.count ? selected : [];
    }

    if (
      parsed.count === 1 &&
      sourcePermanent &&
      !Boolean(sourcePermanent?.tapped) &&
      String(sourcePermanent?.controller || '').trim() === playerId &&
      this.cardMatchesAdditionalCostFilter(sourcePermanent, parsed.filterText)
    ) {
      return [sourcePermanent];
    }

    return eligible.length === parsed.count ? eligible.slice(0, parsed.count) : [];
  }

  private resolveActivatedAbilitySacrificePermanents(
    state: GameState,
    playerId: string,
    ability: ActivatedAbility,
    action: any,
    count: number,
    description?: string
  ): any[] {
    const battlefield = Array.isArray((state as any).battlefield) ? ((state as any).battlefield as any[]) : [];
    const sourceId = String(ability.sourceId || '').trim();
    const explicitIds = Array.isArray(action?.additionalCostPermanentIds)
      ? action.additionalCostPermanentIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
      : [];

    const descriptionText = String(description || '').trim().toLowerCase();
    const sourcePermanent = battlefield.find((perm: any) => String(perm?.id || '').trim() === sourceId);
    const parsed = this.parseSacrificeCostFromDescription(description);
    const filterText = parsed.filterText;
    const eligible = this.getEligibleSacrificePermanents(state, playerId, filterText);

    if (explicitIds.length > 0) {
      const explicitSet = new Set(explicitIds);
      const selected = eligible.filter((perm: any) => explicitSet.has(String(perm?.id || perm?.cardId || '').trim()));
      return selected.length === count ? selected : [];
    }

    if (descriptionText.includes('this permanent') || descriptionText.includes('this creature') || descriptionText.includes('this artifact')) {
      return count === 1 && sourcePermanent ? [sourcePermanent] : [];
    }

    if (count === 1 && sourcePermanent && eligible.length === 1) {
      return [sourcePermanent];
    }

    return eligible.length === count ? eligible.slice(0, count) : [];
  }

  private resolveActivatedAbilityCounterRemovals(
    state: GameState,
    playerId: string,
    ability: ActivatedAbility,
    action: any,
    count: number,
    counter?: string,
    filterText?: string
  ): Array<{ permanentId: string; count: number }> {
    const sourceId = String(ability.sourceId || '').trim();
    const battlefield = Array.isArray((state as any).battlefield) ? ((state as any).battlefield as any[]) : [];
    const explicitIds = Array.isArray(action?.additionalCostPermanentIds)
      ? action.additionalCostPermanentIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
      : [];

    if (explicitIds.length > 0) {
      const requested = new Map<string, number>();
      for (const id of explicitIds) {
        requested.set(id, (requested.get(id) || 0) + 1);
      }

      const totalRequested = Array.from(requested.values()).reduce((sum, value) => sum + value, 0);
      if (totalRequested !== count) return [];

      const removals: Array<{ permanentId: string; count: number }> = [];
      for (const [permanentId, requestedCount] of requested.entries()) {
        const perm = battlefield.find((entry: any) => String(entry?.id || entry?.cardId || '').trim() === permanentId);
        if (!perm || String(perm?.controller || '').trim() !== playerId) return [];
        if (!this.cardMatchesAdditionalCostFilter(perm, filterText)) return [];
        if (this.totalRemovableCountersOnPermanent(perm, counter) < requestedCount) return [];
        removals.push({ permanentId, count: requestedCount });
      }
      return removals;
    }

    const sourcePermanent = battlefield.find((perm: any) => String(perm?.id || '').trim() === sourceId);
    if (sourcePermanent && String(sourcePermanent?.controller || '').trim() === playerId) {
      if (!this.cardMatchesAdditionalCostFilter(sourcePermanent, filterText)) {
        return [];
      }
      const sourceAvailable = this.totalRemovableCountersOnPermanent(sourcePermanent, counter);
      if (sourceAvailable >= count) {
        return [{ permanentId: sourceId, count }];
      }
    }

    const eligible = this.getEligibleCounterRemovalPermanents(state, playerId, filterText, counter);
    const totalAvailable = eligible.reduce((sum, perm) => sum + this.totalRemovableCountersOnPermanent(perm, counter), 0);
    if (totalAvailable < count) return [];
    if (eligible.length !== 1 && totalAvailable !== count) return [];

    let remaining = count;
    const removals: Array<{ permanentId: string; count: number }> = [];
    for (const perm of eligible) {
      if (remaining <= 0) break;
      const available = this.totalRemovableCountersOnPermanent(perm, counter);
      if (available <= 0) continue;
      const removed = Math.min(available, remaining);
      removals.push({ permanentId: String(perm?.id || perm?.cardId || '').trim(), count: removed });
      remaining -= removed;
    }

    return remaining === 0 ? removals : [];
  }

  private applyActivatedAbilityCounterRemovals(
    state: GameState,
    removals: Array<{ permanentId: string; count: number }>,
    counter?: string
  ): GameState {
    const removalCounts = new Map<string, number>();
    for (const removal of removals) {
      removalCounts.set(removal.permanentId, (removalCounts.get(removal.permanentId) || 0) + removal.count);
    }

    const nextBattlefield = (Array.isArray((state as any).battlefield) ? ((state as any).battlefield as any[]) : []).map((perm: any) => {
      const permanentId = String(perm?.id || perm?.cardId || '').trim();
      const requested = removalCounts.get(permanentId) || 0;
      if (requested <= 0) return perm;

      const currentCounters = { ...((perm?.counters || {}) as Record<string, number>) };
      const counterNames = counter ? [counter] : Object.keys(currentCounters).sort();
      let remaining = requested;

      for (const counterName of counterNames) {
        if (remaining <= 0) break;
        const currentValue = Math.max(0, Number(currentCounters[counterName] ?? 0) || 0);
        if (currentValue <= 0) continue;
        const removed = Math.min(currentValue, remaining);
        const nextValue = currentValue - removed;
        remaining -= removed;
        if (nextValue > 0) {
          currentCounters[counterName] = nextValue;
        } else {
          delete currentCounters[counterName];
        }
      }

      return { ...perm, counters: currentCounters };
    });

    return { ...(state as any), battlefield: nextBattlefield } as GameState;
  }

  private resolveActivatedAbilityExileSelection(
    state: GameState,
    playerId: string,
    ability: ActivatedAbility,
    action: any,
    count: number,
    description?: string
  ): { permanentIds: string[]; handIds: string[]; graveyardIds: string[] } {
    const player = state.players.find(p => p.id === playerId) as any;
    if (!player) {
      return { permanentIds: [], handIds: [], graveyardIds: [] };
    }

    const battlefield = Array.isArray((state as any).battlefield) ? ((state as any).battlefield as any[]) : [];
    const sourceId = String(ability.sourceId || '').trim();
    const sourcePermanent = battlefield.find((perm: any) => String(perm?.id || '').trim() === sourceId);
    const descriptionText = String(description || '').trim().toLowerCase();

    const explicitPermanentIds = Array.isArray(action?.additionalCostPermanentIds)
      ? action.additionalCostPermanentIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
      : [];
    const explicitCardIds = Array.isArray(action?.additionalCostCardIds)
      ? action.additionalCostCardIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
      : [];

    if (explicitPermanentIds.length > 0 || explicitCardIds.length > 0) {
      const controlledBattlefieldIds = new Set(
        battlefield
          .filter((perm: any) => String(perm?.controller || '').trim() === playerId)
          .map((perm: any) => String(perm?.id || perm?.cardId || '').trim())
          .filter(Boolean)
      );
      const handIds = new Set((Array.isArray(player.hand) ? player.hand : []).map((card: any) => String(card?.id || card?.cardId || '').trim()).filter(Boolean));
      const graveyardIds = new Set((Array.isArray(player.graveyard) ? player.graveyard : []).map((card: any) => String(card?.id || card?.cardId || '').trim()).filter(Boolean));

      const selectedPermanentIds = explicitPermanentIds.filter(id => controlledBattlefieldIds.has(id));
      const selectedHandIds = explicitCardIds.filter(id => handIds.has(id));
      const selectedGraveyardIds = explicitCardIds.filter(id => graveyardIds.has(id));
      const totalSelected = selectedPermanentIds.length + selectedHandIds.length + selectedGraveyardIds.length;
      if (totalSelected !== count) {
        return { permanentIds: [], handIds: [], graveyardIds: [] };
      }

      return {
        permanentIds: selectedPermanentIds,
        handIds: selectedHandIds,
        graveyardIds: selectedGraveyardIds,
      };
    }

    if ((descriptionText.includes('this permanent') || descriptionText.includes('this creature') || descriptionText.includes('this artifact')) && count === 1) {
      if (sourcePermanent && String(sourcePermanent?.controller || '').trim() === playerId) {
        return { permanentIds: [sourceId], handIds: [], graveyardIds: [] };
      }
    }

    if (descriptionText.includes('this card') && count === 1) {
      const sourceZone = String(ability.sourceZone || '').trim().toLowerCase();
      if (sourceZone === 'hand') {
        const sourceCard = (Array.isArray(player.hand) ? player.hand : []).find(
          (card: any) => String(card?.id || card?.cardId || '').trim() === sourceId
        );
        if (sourceCard) {
          return { permanentIds: [], handIds: [sourceId], graveyardIds: [] };
        }
      }

      if (sourceZone === 'graveyard') {
        const sourceCard = (Array.isArray(player.graveyard) ? player.graveyard : []).find(
          (card: any) => String(card?.id || card?.cardId || '').trim() === sourceId
        );
        if (sourceCard) {
          return { permanentIds: [], handIds: [], graveyardIds: [sourceId] };
        }
      }
    }

    const zoneCards =
      descriptionText.includes('graveyard')
        ? (Array.isArray(player.graveyard) ? player.graveyard : [])
        : descriptionText.includes('hand')
          ? (Array.isArray(player.hand) ? player.hand : [])
          : [];
    if (zoneCards.length === count) {
      const ids = zoneCards.map((card: any) => String(card?.id || card?.cardId || '').trim()).filter(Boolean);
      return descriptionText.includes('graveyard')
        ? { permanentIds: [], handIds: [], graveyardIds: ids }
        : { permanentIds: [], handIds: ids, graveyardIds: [] };
    }

    return { permanentIds: [], handIds: [], graveyardIds: [] };
  }

  private applyActivatedAbilityExileSelection(
    state: GameState,
    playerId: string,
    selection: { permanentIds: string[]; handIds: string[]; graveyardIds: string[] }
  ): GameState {
    const permanentIdSet = new Set(selection.permanentIds);
    const handIdSet = new Set(selection.handIds);
    const graveyardIdSet = new Set(selection.graveyardIds);
    const battlefield = Array.isArray((state as any).battlefield) ? ((state as any).battlefield as any[]) : [];

    const exiledPermanents = battlefield.filter((perm: any) => permanentIdSet.has(String(perm?.id || perm?.cardId || '').trim()));
    const nextBattlefield = battlefield.filter((perm: any) => !permanentIdSet.has(String(perm?.id || perm?.cardId || '').trim()));

    const nextPlayers = state.players.map((player: any) => {
      const ownedExiledPermanents = exiledPermanents
        .filter((perm: any) => String(perm?.controller || perm?.owner || '').trim() === String(player.id || '').trim())
        .map((perm: any) => buildZoneObjectWithRetainedCounters(perm.card || perm, perm, 'exile'));

      if (player.id !== playerId) {
        return ownedExiledPermanents.length > 0
          ? { ...player, exile: [...(Array.isArray(player.exile) ? player.exile : []), ...ownedExiledPermanents] }
          : player;
      }

      const hand = Array.isArray(player.hand) ? player.hand : [];
      const graveyard = Array.isArray(player.graveyard) ? player.graveyard : [];
      const exiledHandCards = hand
        .filter((card: any) => handIdSet.has(String(card?.id || card?.cardId || '').trim()))
        .map((card: any) => this.sanitizeSpellCardAfterStackExit(card));
      const exiledGraveyardCards = graveyard
        .filter((card: any) => graveyardIdSet.has(String(card?.id || card?.cardId || '').trim()))
        .map((card: any) => this.sanitizeSpellCardAfterStackExit(card));

      return {
        ...player,
        hand: hand.filter((card: any) => !handIdSet.has(String(card?.id || card?.cardId || '').trim())),
        graveyard: graveyard.filter((card: any) => !graveyardIdSet.has(String(card?.id || card?.cardId || '').trim())),
        exile: [
          ...(Array.isArray(player.exile) ? player.exile : []),
          ...exiledHandCards,
          ...exiledGraveyardCards,
          ...ownedExiledPermanents,
        ],
      };
    });

    return { ...(state as any), battlefield: nextBattlefield, players: nextPlayers } as GameState;
  }

  private canPayActivatedAbilityAdditionalCosts(state: GameState, playerId: string, ability: ActivatedAbility, action?: any): boolean {
    const additionalCosts = Array.isArray(ability.additionalCosts) ? ability.additionalCosts : [];
    if (additionalCosts.length === 0) return true;

    const battlefield = Array.isArray((state as any).battlefield) ? ((state as any).battlefield as any[]) : [];
    const sourcePermanent = battlefield.find((perm: any) => String(perm?.id || '').trim() === String(ability.sourceId || '').trim());
    const player = state.players.find(p => p.id === playerId) as any;

    for (const cost of additionalCosts) {
      if (!cost || typeof cost !== 'object') continue;

      if (cost.type === CostType.TAP) {
        if (this.resolveActivatedAbilityTapPermanents(state, playerId, ability, action, cost.description).length <= 0) return false;
        continue;
      }

      if (cost.type === CostType.UNTAP) {
        if (!sourcePermanent || !Boolean(sourcePermanent?.tapped)) return false;
        continue;
      }

      if (cost.type === CostType.LIFE) {
        const amount = this.parseLifeAmountFromCostDescription(cost.description);
        if (!player || Number(player.life || 0) <= amount) return false;
        continue;
      }

      if (cost.type === CostType.DISCARD) {
        const parsed = this.parseDiscardCostFromDescription(cost.description);
        const count = Math.max(1, Number((cost as any).count || 0) || parsed.count);
        const filterText = String((cost as any).filterText || parsed.filterText || '').trim() || undefined;
        if (this.resolveActivatedAbilityDiscardCards(state, playerId, action, count, filterText).length !== count) return false;
        continue;
      }

      if (cost.type === CostType.SACRIFICE) {
        const parsed = this.parseSacrificeCostFromDescription(cost.description);
        const count = Math.max(1, Number((cost as any).count || 0) || parsed.count);
        if (this.resolveActivatedAbilitySacrificePermanents(state, playerId, ability, action, count, cost.description).length !== count) return false;
        continue;
      }

      if (cost.type === CostType.REMOVE_COUNTER) {
        const parsed = this.parseCounterRemovalFromCostDescription(cost.description);
        const count = Math.max(1, Number((cost as any).count || 0) || parsed.count);
        const counter = String((cost as any).counterType || parsed.counter || '').trim() || undefined;
        const filterText = String((cost as any).filterText || parsed.filterText || '').trim() || undefined;
        const removals = this.resolveActivatedAbilityCounterRemovals(state, playerId, ability, action, count, counter, filterText);
        if (removals.reduce((sum, removal) => sum + removal.count, 0) !== count) return false;
        continue;
      }

      if (cost.type === CostType.EXILE) {
        const parsed = this.parseExileCostFromDescription(cost.description);
        const count = Math.max(1, Number((cost as any).count || 0) || parsed.count);
        const selection = this.resolveActivatedAbilityExileSelection(state, playerId, ability, action, count, cost.description);
        if (selection.permanentIds.length + selection.handIds.length + selection.graveyardIds.length !== count) return false;
        continue;
      }

      if (cost.type === CostType.REVEAL) {
        const revealCards = this.resolveActivatedAbilityRevealCards(state, playerId, ability, action, cost.description);
        if (revealCards.length <= 0) return false;
      }
    }

    return true;
  }

  private payActivatedAbilityAdditionalCosts(
    state: GameState,
    playerId: string,
    ability: ActivatedAbility,
    action?: any
  ): { success: boolean; state: GameState; log: string[]; tappedSource?: boolean } {
    const additionalCosts = Array.isArray(ability.additionalCosts) ? ability.additionalCosts : [];
    if (additionalCosts.length === 0) return { success: true, state, log: [] };

    let nextState = state;
    const log: string[] = [];
    let tappedSource = false;

    for (const cost of additionalCosts) {
      if (!cost || typeof cost !== 'object') continue;

      if (cost.type === CostType.TAP) {
        const tappedPermanents = this.resolveActivatedAbilityTapPermanents(nextState, playerId, ability, action, cost.description);
        if (tappedPermanents.length <= 0) {
          return { success: false, state, log: [] };
        }

        const sourceId = String(ability.sourceId || '').trim();
        const tappedIds = new Set(
          tappedPermanents.map((perm: any) => String(perm?.id || perm?.cardId || '').trim()).filter(Boolean)
        );
        const battlefield = Array.isArray((nextState as any).battlefield) ? ((nextState as any).battlefield as any[]) : [];
        const updatedBattlefield = battlefield.map((perm: any) =>
          tappedIds.has(String(perm?.id || '').trim()) ? { ...perm, tapped: true } : perm
        );
        nextState = { ...(nextState as any), battlefield: updatedBattlefield } as GameState;
        if (tappedIds.has(sourceId)) tappedSource = true;
        log.push(`${playerId} tapped ${tappedIds.size} permanent(s) to activate ${ability.sourceName}`);
        continue;
      }

      if (cost.type === CostType.UNTAP) {
        const sourceId = String(ability.sourceId || '').trim();
        const battlefield = Array.isArray((nextState as any).battlefield) ? ((nextState as any).battlefield as any[]) : [];
        const sourcePermanent = battlefield.find((perm: any) => String(perm?.id || '').trim() === sourceId);
        if (!sourcePermanent || !Boolean(sourcePermanent?.tapped)) {
          return { success: false, state, log: [] };
        }

        const updatedBattlefield = battlefield.map((perm: any) =>
          String(perm?.id || '').trim() === sourceId ? { ...perm, tapped: false } : perm
        );
        nextState = { ...(nextState as any), battlefield: updatedBattlefield } as GameState;
        log.push(`${ability.sourceName} was untapped to activate its ability`);
        continue;
      }

      if (cost.type === CostType.LIFE) {
        const amount = this.parseLifeAmountFromCostDescription(cost.description);
        if (amount <= 0) continue;
        const player = nextState.players.find(entry => entry.id === playerId) as any;
        if (!player || Number(player.life || 0) <= amount) {
          return { success: false, state, log: [] };
        }

        nextState = {
          ...(nextState as any),
          players: nextState.players.map((entry: any) =>
            entry.id === playerId
              ? { ...entry, life: Number(entry.life || 0) - amount }
              : entry
          ),
        } as GameState;
        log.push(`${playerId} paid ${amount} life`);
        continue;
      }

      if (cost.type === CostType.DISCARD) {
        const parsed = this.parseDiscardCostFromDescription(cost.description);
        const count = Math.max(1, Number((cost as any).count || 0) || parsed.count);
        const filterText = String((cost as any).filterText || parsed.filterText || '').trim() || undefined;
        const cards = this.resolveActivatedAbilityDiscardCards(nextState, playerId, action, count, filterText);
        if (cards.length !== count) {
          return { success: false, state, log: [] };
        }

        const discardIds = new Set(cards.map((card: any) => String(card?.id || card?.cardId || '').trim()).filter(Boolean));
        nextState = {
          ...(nextState as any),
          players: nextState.players.map((entry: any) => {
            if (entry.id !== playerId) return entry;
            const hand = Array.isArray(entry.hand) ? entry.hand : [];
            const keptHand = hand.filter((card: any) => !discardIds.has(String(card?.id || card?.cardId || '').trim()));
            const discarded = hand.filter((card: any) => discardIds.has(String(card?.id || card?.cardId || '').trim()));
            return {
              ...entry,
              hand: keptHand,
              graveyard: [...(Array.isArray(entry.graveyard) ? entry.graveyard : []), ...discarded],
            };
          }),
        } as GameState;
        log.push(`${playerId} discarded ${count} card(s)`);
        continue;
      }

      if (cost.type === CostType.SACRIFICE) {
        const parsed = this.parseSacrificeCostFromDescription(cost.description);
        const count = Math.max(1, Number((cost as any).count || 0) || parsed.count);
        const permanents = this.resolveActivatedAbilitySacrificePermanents(nextState, playerId, ability, action, count, cost.description);
        if (permanents.length !== count) {
          return { success: false, state, log: [] };
        }

        for (const permanent of permanents) {
          nextState = movePermanentToGraveyard(nextState, permanent);
        }
        log.push(`${playerId} sacrificed ${count} permanent(s)`);
        continue;
      }

      if (cost.type === CostType.REMOVE_COUNTER) {
        const parsed = this.parseCounterRemovalFromCostDescription(cost.description);
        const count = Math.max(1, Number((cost as any).count || 0) || parsed.count);
        const counter = String((cost as any).counterType || parsed.counter || '').trim() || undefined;
        const filterText = String((cost as any).filterText || parsed.filterText || '').trim() || undefined;
        const removals = this.resolveActivatedAbilityCounterRemovals(nextState, playerId, ability, action, count, counter, filterText);
        if (removals.reduce((sum, removal) => sum + removal.count, 0) !== count) {
          return { success: false, state, log: [] };
        }

        nextState = this.applyActivatedAbilityCounterRemovals(nextState, removals, counter);
        log.push(counter ? `${playerId} removed ${count} ${counter} counter(s)` : `${playerId} removed ${count} counter(s)`);
        continue;
      }

      if (cost.type === CostType.EXILE) {
        const parsed = this.parseExileCostFromDescription(cost.description);
        const count = Math.max(1, Number((cost as any).count || 0) || parsed.count);
        const selection = this.resolveActivatedAbilityExileSelection(nextState, playerId, ability, action, count, cost.description);
        if (selection.permanentIds.length + selection.handIds.length + selection.graveyardIds.length !== count) {
          return { success: false, state, log: [] };
        }

        nextState = this.applyActivatedAbilityExileSelection(nextState, playerId, selection);
        log.push(`${playerId} exiled ${count} object(s)`);
        continue;
      }

      if (cost.type === CostType.REVEAL) {
        const revealCards = this.resolveActivatedAbilityRevealCards(nextState, playerId, ability, action, cost.description);
        if (revealCards.length <= 0) {
          return { success: false, state, log: [] };
        }

        log.push(`${playerId} revealed ${revealCards.length} card(s)`);
      }
    }

    return { success: true, state: nextState, log, tappedSource };
  }

  private resolveActivatedAbilityRevealCards(
    state: GameState,
    playerId: string,
    ability: ActivatedAbility,
    action: any,
    description: string
  ): any[] {
    const player = state.players.find(p => p.id === playerId) as any;
    if (!player) return [];

    const hand = Array.isArray(player.hand) ? player.hand : [];
    const descriptionText = String(description || '').trim().toLowerCase();
    const explicitCardIds = Array.isArray(action?.additionalCostCardIds)
      ? action.additionalCostCardIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
      : [];
    if (explicitCardIds.length > 0) {
      const revealable = hand.filter((card: any) =>
        explicitCardIds.includes(String(card?.id || card?.cardId || '').trim())
      );
      return revealable.length === explicitCardIds.length ? revealable : [];
    }

    if (
      descriptionText.includes('this card') &&
      String(ability.sourceZone || '').trim().toLowerCase() === 'hand'
    ) {
      const sourceId = String(ability.sourceId || '').trim();
      const sourceCard = hand.find((card: any) => String(card?.id || card?.cardId || '').trim() === sourceId);
      return sourceCard ? [sourceCard] : [];
    }

    return [];
  }

  private canPayGraveyardAdditionalCost(state: GameState, playerId: string, cost: any): boolean {
    if (!cost || typeof cost !== 'object') return true;
    if (cost.kind === 'discard') {
      return this.getEligibleDiscardCards(state, playerId, cost.filterText).length >= Number(cost.count || 0);
    }
    if (cost.kind === 'sacrifice') {
      return this.getEligibleSacrificePermanents(state, playerId, cost.filterText).length >= Number(cost.count || 0);
    }
    if (cost.kind === 'exile_from_graveyard') {
      return this.getEligibleGraveyardExileCards(state, playerId).length >= Number(cost.count || 0);
    }
    if (cost.kind === 'remove_counter') {
      if (cost.count === 'any') return true;
      return (
        this.getEligibleCounterRemovalPermanents(state, playerId, cost.filterText, cost.counter).reduce(
          (sum, perm) => sum + this.totalRemovableCountersOnPermanent(perm, cost.counter),
          0
        ) >= Number(cost.count || 0)
      );
    }
    return false;
  }

  private payGraveyardAdditionalCost(
    state: GameState,
    playerId: string,
    cost: any
  ): { success: boolean; state: GameState; log: string[] } {
    if (!cost || typeof cost !== 'object') return { success: true, state, log: [] };

    if (cost.kind === 'discard') {
      const amount = Math.max(0, Number(cost.count) || 0);
      const cards = this.getEligibleDiscardCards(state, playerId, cost.filterText).slice(0, amount);
      if (cards.length < amount) return { success: false, state, log: [] };

      const discardIds = new Set(cards.map((card: any) => String(card?.id || card?.cardId || '').trim()).filter(Boolean));
      const updatedPlayers = state.players.map((player: any) => {
        if (player.id !== playerId) return player;
        const hand = Array.isArray(player.hand) ? player.hand : [];
        const keptHand = hand.filter((card: any) => !discardIds.has(String(card?.id || card?.cardId || '').trim()));
        const discarded = hand.filter((card: any) => discardIds.has(String(card?.id || card?.cardId || '').trim()));
        return {
          ...player,
          hand: keptHand,
          graveyard: [...(Array.isArray(player.graveyard) ? player.graveyard : []), ...discarded],
        };
      });

      return {
        success: true,
        state: { ...(state as any), players: updatedPlayers as any } as any,
        log: [`${playerId} discards ${amount} card(s)`],
      };
    }

    if (cost.kind === 'sacrifice') {
      const amount = Math.max(0, Number(cost.count) || 0);
      const permanents = this.getEligibleSacrificePermanents(state, playerId, cost.filterText).slice(0, amount);
      if (permanents.length < amount) return { success: false, state, log: [] };

      let nextState = state;
      for (const permanent of permanents) {
        nextState = movePermanentToGraveyard(nextState, permanent);
      }

      return {
        success: true,
        state: nextState,
        log: [`${playerId} sacrifices ${amount} permanent(s)`],
      };
    }

    if (cost.kind === 'exile_from_graveyard') {
      const amount = Math.max(0, Number(cost.count) || 0);
      const cards = this.getEligibleGraveyardExileCards(state, playerId).slice(0, amount);
      if (cards.length < amount) return { success: false, state, log: [] };

      const exileIds = new Set(cards.map((card: any) => String(card?.id || card?.cardId || '').trim()).filter(Boolean));
      const updatedPlayers = state.players.map((player: any) => {
        if (player.id !== playerId) return player;
        const graveyard = Array.isArray(player.graveyard) ? player.graveyard : [];
        const keptGraveyard = graveyard.filter((card: any) => !exileIds.has(String(card?.id || card?.cardId || '').trim()));
        const exiledCards = graveyard
          .filter((card: any) => exileIds.has(String(card?.id || card?.cardId || '').trim()))
          .map((card: any) => this.sanitizeSpellCardAfterStackExit(card));
        return {
          ...player,
          graveyard: keptGraveyard,
          exile: [...(Array.isArray(player.exile) ? player.exile : []), ...exiledCards],
        };
      });

      return {
        success: true,
        state: { ...(state as any), players: updatedPlayers as any } as any,
        log: [`${playerId} exiles ${amount} card(s) from their graveyard`],
      };
    }

    if (cost.kind === 'remove_counter') {
      if (cost.count === 'any') {
        return { success: true, state, log: [`${playerId} may remove any number of counters`].filter(Boolean) };
      }

      return this.removeCountersFromEligiblePermanents(
        state,
        playerId,
        Math.max(0, Number(cost.count) || 0),
        cost.filterText,
        cost.counter
      );
    }

    return { success: false, state, log: [] };
  }
  
  /** Build a de-duplicated target id list from normalized trigger event data. */
  private collectTargetIdsFromEventData(eventData?: TriggerEventData): string[] {
    if (!eventData) return [];
    const ordered = [
      ...(eventData.affectedPlayerIds || []),
      ...(eventData.targetPlayerId ? [eventData.targetPlayerId] : []),
      ...(eventData.targetOpponentId ? [eventData.targetOpponentId] : []),
    ];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const id of ordered) {
      const normalized = String(id || '').trim();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
    }
    return out;
  }

  /**
   * Parse mana cost string like "{2}{U}{U}" into a ManaCost object
   */
  private parseManaCostString(manaCost: string | any): ManaCost {
    // Handle non-string input (could be already parsed object or null/undefined)
    if (!manaCost) {
      return { generic: 0 };
    }
    
    // If already an object with mana properties, return it directly
    if (typeof manaCost === 'object') {
      return {
        generic: manaCost.generic || 0,
        white: manaCost.white || 0,
        blue: manaCost.blue || 0,
        black: manaCost.black || 0,
        red: manaCost.red || 0,
        green: manaCost.green || 0,
        colorless: manaCost.colorless || 0,
      };
    }
    
    // Parse string format like "{R}{R}{2}"
    if (typeof manaCost !== 'string') {
      return { generic: 0 };
    }
    
    const tokens = manaCost.match(/\{[^}]+\}/g) || [];
    
    // Build up the cost object without mutations
    let generic = 0;
    let white = 0;
    let blue = 0;
    let black = 0;
    let red = 0;
    let green = 0;
    let colorless = 0;
    
    for (const token of tokens) {
      const symbol = token.replace(/[{}]/g, '').toUpperCase();
      
      if (/^\d+$/.test(symbol)) {
        // Generic mana like {2}
        generic += parseInt(symbol, 10);
      } else if (symbol === 'W') {
        white += 1;
      } else if (symbol === 'U') {
        blue += 1;
      } else if (symbol === 'B') {
        black += 1;
      } else if (symbol === 'R') {
        red += 1;
      } else if (symbol === 'G') {
        green += 1;
      } else if (symbol === 'C') {
        colorless += 1;
      }
      // Note: hybrid mana, phyrexian mana, etc. not implemented yet
    }
    
    return { generic, white, blue, black, red, green, colorless };
  }
  
  /**
   * Check if a mana cost can be paid from the given mana pool
   */
  private canPayManaCostFromPool(cost: ManaCost, pool: SimpleManaPool): { canPay: boolean; reason?: string } {
    // Check specific color requirements
    if ((cost.white || 0) > pool.white) {
      return { canPay: false, reason: `Need ${cost.white} white mana, have ${pool.white}` };
    }
    if ((cost.blue || 0) > pool.blue) {
      return { canPay: false, reason: `Need ${cost.blue} blue mana, have ${pool.blue}` };
    }
    if ((cost.black || 0) > pool.black) {
      return { canPay: false, reason: `Need ${cost.black} black mana, have ${pool.black}` };
    }
    if ((cost.red || 0) > pool.red) {
      return { canPay: false, reason: `Need ${cost.red} red mana, have ${pool.red}` };
    }
    if ((cost.green || 0) > pool.green) {
      return { canPay: false, reason: `Need ${cost.green} green mana, have ${pool.green}` };
    }
    if ((cost.colorless || 0) > pool.colorless) {
      return { canPay: false, reason: `Need ${cost.colorless} colorless mana, have ${pool.colorless}` };
    }
    
    // Calculate remaining mana after paying colored costs
    const remaining = {
      white: pool.white - (cost.white || 0),
      blue: pool.blue - (cost.blue || 0),
      black: pool.black - (cost.black || 0),
      red: pool.red - (cost.red || 0),
      green: pool.green - (cost.green || 0),
      colorless: pool.colorless - (cost.colorless || 0),
    };
    
    const totalRemaining = remaining.white + remaining.blue + remaining.black + 
                          remaining.red + remaining.green + remaining.colorless;
    
    if ((cost.generic || 0) > totalRemaining) {
      return { canPay: false, reason: `Need ${cost.generic} more mana for generic cost, have ${totalRemaining} remaining` };
    }
    
    return { canPay: true };
  }
  
  /**
   * Validate attacker declaration
   */
  private validateAttackerDeclaration(state: GameState, action: any): ActionValidation {
    // Check if it's the declare attackers step
    if (state.step !== SharedGameStep.DECLARE_ATTACKERS) {
      return {
        legal: false,
        reason: 'Not in declare attackers step',
      };
    }
    
    // Check if player is active player
    const activePlayer = state.players[state.activePlayerIndex];
    if (activePlayer.id !== action.playerId) {
      return {
        legal: false,
        reason: 'Only active player can declare attackers',
      };
    }
    
    return { legal: true };
  }
  
  /**
   * Validate blocker declaration
   */
  private validateBlockerDeclaration(state: GameState, action: any): ActionValidation {
    // Check if it's the declare blockers step
    if (state.step !== SharedGameStep.DECLARE_BLOCKERS) {
      return {
        legal: false,
        reason: 'Not in declare blockers step',
      };
    }
    
    return { legal: true };
  }
  
  /**
   * Execute a validated action and apply state changes atomically
   */
  executeAction(gameId: string, action: any): EngineResult<GameState> {
    const validation = this.validateAction(gameId, action);
    if (!validation.legal) {
      return {
        next: this.gameStates.get(gameId)!,
        log: [`Action rejected: ${validation.reason}`],
      };
    }
    
    const currentState = this.gameStates.get(gameId);
    if (!currentState) {
      return {
        next: currentState!,
        log: ['Game not found'],
      };
    }
    
    // Create action context for modular handlers
    const actionContext = {
      getState: (gid: string) => this.gameStates.get(gid),
      setState: (gid: string, state: GameState) => this.gameStates.set(gid, state),
      getStack: (gid: string) => this.stacks.get(gid),
      setStack: (gid: string, stack: any) => this.stacks.set(gid, stack),
      emit: (event: RulesEvent) => this.emit(event),
      gameId,
    };
    
    const result = dispatchRulesEngineAction({
      currentState,
      action,
      handlers: {
        passPriority: () => this.passPriority(gameId, action.playerId),
        castSpell: () => this.castSpellAction(gameId, action),
        playLand: () => this.playLandAction(gameId, action),
        tapForMana: () => this.tapForManaAction(gameId, action),
        activateAbility: () => this.activateAbilityAction(gameId, action),
        declareAttackers: () => executeDeclareAttackers(gameId, action, actionContext),
        declareBlockers: () => {
          const blockersResult = executeDeclareBlockers(gameId, action, actionContext);
          const blockedAssignments = Array.from(
            new Map(
              (action.blockers || []).map((blocker: any) => {
                const attackerId = String(blocker?.attackerId || '').trim();
                const defendingPlayerId = String(
                  ((blockersResult.next.combat?.attackers || []) as any[]).find(
                    attacker => String((attacker as any)?.permanentId || '').trim() === attackerId
                  )?.defending || ''
                ).trim();
                return [attackerId, { attackerId, defendingPlayerId }];
              })
            ).values()
          ).filter((assignment: any) => Boolean(String(assignment?.attackerId || '').trim()));

          const triggerResult = checkBecomesBlockedTriggers(blockersResult.next, blockedAssignments as any);
          return {
            next: triggerResult.state,
            log: [
              ...(blockersResult.log || []),
              ...(triggerResult.logs || []),
            ],
          };
        },
        resolveStack: () => this.resolveStackTop(gameId),
        advanceGame: () => advanceGame(gameId, actionContext),
        sacrifice: () => executeSacrifice(gameId, action, actionContext),
        searchLibrary: () => executeSearchLibrary(gameId, action, actionContext),
        payLife: () => this.payLifeAction(gameId, action),
        activateFetchland: () => executeFetchland(gameId, action, actionContext),
        dealCombatDamage: () => {
          const combatResult = executeCombatDamage(gameId, action, actionContext);
          const triggerResult = checkCombatDamageToPlayerTriggers(
            combatResult.next,
            action.playerId,
            action.attackers || []
          );
          return {
            next: triggerResult.state,
            log: [
              ...(combatResult.log || []),
              ...(triggerResult.logs || []),
            ],
          };
        },
        initializeGame: () => initializeGame(gameId, action.players, actionContext),
        drawInitialHand: () => drawInitialHand(gameId, action.playerId, action.handSize || 7, actionContext),
        mulligan: () => processMulligan(gameId, action.playerId, action.keep, actionContext),
        completeMulligan: () => completeMulliganPhase(gameId, actionContext),
      },
    });
    
    let syncedResultState: GameState = {
      ...result.next,
      stack: [...(((this.stacks.get(gameId)?.objects as any[]) || ((result.next as any).stack as any[]) || []))] as any,
    };

    const diesAfterAction = this.processDiesDelayedTriggers(
      gameId,
      currentState,
      syncedResultState
    );
    syncedResultState = diesAfterAction.state;

    const controlLossAfterAction = this.processControlLossDelayedTriggers(
      gameId,
      currentState,
      syncedResultState
    );
    syncedResultState = controlLossAfterAction.state;

    // Update stored state
    this.gameStates.set(gameId, syncedResultState);
    
    // Check state-based actions after each action
    const sbaResult = this.checkStateBasedActions(gameId, syncedResultState);
    let syncedSbaState: GameState = {
      ...sbaResult.next,
      stack: [...(((this.stacks.get(gameId)?.objects as any[]) || ((sbaResult.next as any).stack as any[]) || []))] as any,
    };

    const diesAfterSba = this.processDiesDelayedTriggers(
      gameId,
      syncedResultState,
      syncedSbaState
    );
    syncedSbaState = diesAfterSba.state;

    const controlLossAfterSba = this.processControlLossDelayedTriggers(
      gameId,
      syncedResultState,
      syncedSbaState
    );
    syncedSbaState = controlLossAfterSba.state;
    this.gameStates.set(gameId, syncedSbaState);
    
    return {
      next: syncedSbaState,
      log: [
        ...(result.log || []),
        ...(diesAfterAction.log || []),
        ...(controlLossAfterAction.log || []),
        ...(sbaResult.log || []),
        ...(diesAfterSba.log || []),
        ...(controlLossAfterSba.log || []),
      ],
    };
  }

  private processDiesDelayedTriggers(
    gameId: string,
    previousState: GameState,
    nextState: GameState
  ): { state: GameState; log: string[] } {
    return processDiesDelayedTriggersForState({
      gameId,
      previousState,
      nextState,
      getStack: targetGameId => this.stacks.get(targetGameId),
      setStack: (targetGameId, stack) => this.stacks.set(targetGameId, stack),
    });
  }

  private processControlLossDelayedTriggers(
    gameId: string,
    previousState: GameState,
    nextState: GameState
  ): { state: GameState; log: string[] } {
    return processControlLossDelayedTriggersForState({
      gameId,
      previousState,
      nextState,
      getStack: targetGameId => this.stacks.get(targetGameId),
      setStack: (targetGameId, stack) => this.stacks.set(targetGameId, stack),
    });
  }
  
  /**
   * Pass priority to next player
   */
  private passPriority(gameId: string, playerId: PlayerID): EngineResult<GameState> {
    const state = this.gameStates.get(gameId)!;
    
    // Rotate priority to next player
    const nextPriorityIndex = (state.priorityPlayerIndex + 1) % state.players.length;
    const nextState: GameState = {
      ...state,
      priorityPlayerIndex: nextPriorityIndex,
    };
    
    this.emit({
      type: RulesEngineEvent.PRIORITY_PASSED,
      timestamp: Date.now(),
      gameId,
      data: { from: playerId, to: state.players[nextPriorityIndex].id },
    });
    
    return {
      next: nextState,
      log: [`Priority passed from ${playerId} to ${state.players[nextPriorityIndex].id}`],
    };
  }
  
  /**
   * Cast a spell (enhanced with full spell casting system)
   */
  private castSpellAction(gameId: string, action: any): EngineResult<GameState> {
    const state = this.gameStates.get(gameId)!;
    const player = state.players.find(p => p.id === action.playerId);
    
    if (!player) {
      return { next: state, log: ['Player not found'] };
    }

    const fromZone = String(action.fromZone || 'hand').toLowerCase();
    const cardId = String(action.cardId || '');
    const sourceCard = this.findSourceZoneCard(state, action.playerId, cardId, fromZone);
    const intrinsicGraveyardCast = this.getIntrinsicGraveyardCastMetadata(sourceCard, fromZone);
    const keywordAdjustedManaCostInput = this.getEffectiveKeywordAdjustedManaCostInput(action, sourceCard, fromZone);

    const spellTargetHints = buildTriggerEventDataFromPayloads(
      action.playerId,
      action.targets,
      action
    );
    const selectedSpellTargets =
      Array.isArray(action.targets) && action.targets.length > 0
        ? action.targets
        : this.collectTargetIdsFromEventData(spellTargetHints);
    
    // Prepare casting context
    const manaCost = (sourceCard as any)?.withoutPayingManaCost
      ? (keywordAdjustedManaCostInput ?? {})
      : action.manaCost
        ? this.parseManaCostString(action.manaCost)
        : keywordAdjustedManaCostInput
          ? this.parseManaCostString(keywordAdjustedManaCostInput)
        : fromZone === 'exile' && (sourceCard as any)?.exileCastCost
          ? this.parseManaCostString((sourceCard as any)?.exileCastCost)
        : fromZone === 'graveyard'
          ? this.parseManaCostString(
              (sourceCard as any)?.graveyardCastCost === 'mana_cost'
                ? ((sourceCard as any)?.mana_cost ?? (sourceCard as any)?.manaCost)
                : ((sourceCard as any)?.graveyardCastCostRaw ?? intrinsicGraveyardCast.cost)
            )
          : {};
    const context: SpellCastingContext = {
      spellId: action.cardId,
      cardName: String(action.cardName || action.card?.name || sourceCard?.name || 'Unknown Card'),
      controllerId: action.playerId,
      manaCost,
      targets: selectedSpellTargets,
      modes: action.modes,
      xValue: action.xValue,
    };
    
    // Prepare timing context
    const activePlayerIndex = state.activePlayerIndex ?? 0;
    const priorityPlayerIndex = state.priorityPlayerIndex ?? activePlayerIndex;
    const activePlayer = state.players[activePlayerIndex] || state.players[0];
    const priorityPlayer = state.players[priorityPlayerIndex] || activePlayer;
    const timingContext = {
      isMainPhase: state.phase === 'precombatMain' || state.phase === 'postcombatMain',
      isOwnTurn: activePlayer?.id === action.playerId,
      stackEmpty: checkStackEmpty(this.stacks.get(gameId)!),
      hasPriority: priorityPlayer?.id === action.playerId,
    };
    
    const derivedCardTypes =
      Array.isArray(action.cardTypes) && action.cardTypes.length > 0
        ? action.cardTypes
        : this.getCardTypes(action.card || action.spell || sourceCard);

    // Execute spell casting
    const castResult = castSpell(
      context,
      player.manaPool || emptyManaPool(),
      derivedCardTypes,
      timingContext
    );
    
    if (!castResult.success) {
      return { next: state, log: [castResult.error || 'Failed to cast spell'] };
    }
    
    // Update player's mana pool
    const updatedPlayers = state.players.map(p => {
      if (p.id !== action.playerId) return p;
      const next: any = { ...p, manaPool: castResult.manaPoolAfter! };

      if (cardId) {
        if (fromZone === 'hand') {
          const hand: any[] = Array.isArray((p as any).hand) ? [...(p as any).hand] : [];
          next.hand = hand.filter(c => String(c?.id || c?.cardId || '') !== cardId);
        } else if (fromZone === 'exile') {
          const exile: any[] = Array.isArray((p as any).exile) ? [...(p as any).exile] : [];
          const kept: any[] = [];
          for (const c of exile) {
            const id = String(c?.id || c?.cardId || '');
            if (id === cardId) continue;
            kept.push(c);
          }
          next.exile = kept;
        } else if (fromZone === 'graveyard') {
          const graveyard: any[] = Array.isArray((p as any).graveyard) ? [...(p as any).graveyard] : [];
          const kept: any[] = [];
          for (const c of graveyard) {
            const id = String(c?.id || c?.cardId || '');
            if (id === cardId) continue;
            kept.push(c);
          }
          next.graveyard = kept;
        }
      }

      return next;
    });
    
    let nextState: GameState = {
      ...state,
      players: updatedPlayers,
    };

    if (fromZone === 'graveyard' && (sourceCard as any)?.graveyardAdditionalCost) {
      const additionalCostPayment = this.payGraveyardAdditionalCost(
        nextState,
        action.playerId,
        (sourceCard as any).graveyardAdditionalCost
      );
      if (!additionalCostPayment.success) {
        return { next: state, log: ['Cannot pay required graveyard additional cost'] };
      }
      nextState = additionalCostPayment.state;
    }

    // Clear any playable-from-exile marker if we cast from exile.
    if (fromZone === 'exile' && cardId) {
      nextState = consumePlayableFromExileForCard(nextState, action.playerId, cardId) as any;
    } else if (fromZone === 'graveyard' && cardId) {
      nextState = consumePlayableFromGraveyardForCard(nextState, action.playerId, cardId) as any;
    }
    
    // Add to stack (stored separately for now)
    const spellEffectText =
      (typeof action.oracleText === 'string' && action.oracleText.trim()) ||
      (typeof action.effectText === 'string' && action.effectText.trim()) ||
      (typeof action.card?.oracle_text === 'string' && action.card.oracle_text.trim()) ||
      (typeof sourceCard?.oracle_text === 'string' && sourceCard.oracle_text.trim()) ||
      undefined;
    const selectedSpellTargetPlayerId = spellTargetHints.targetPlayerId;
    const selectedSpellTargetOpponentId = spellTargetHints.targetOpponentId;
    const normalizedSelectedSpellTargets = Array.isArray(selectedSpellTargets)
      ? selectedSpellTargets
          .map((id: any) => String(id || '').trim())
          .filter((id: string) => id.length > 0)
      : [];
    const dedupedSelectedSpellTargets = Array.from(new Set(normalizedSelectedSpellTargets));
    const selectedSpellOpponentTargets = dedupedSelectedSpellTargets.filter(id => id !== action.playerId);
    const fallbackSpellTargetPlayerId =
      dedupedSelectedSpellTargets.length === 1 ? dedupedSelectedSpellTargets[0] : undefined;
    const fallbackSpellTargetOpponentId =
      selectedSpellOpponentTargets.length === 1 ? selectedSpellOpponentTargets[0] : undefined;
    const spellTriggerMeta = buildStackTriggerMetaFromEventData(
      spellEffectText,
      action.cardId,
      action.playerId,
      context.cardName,
      {
        ...spellTargetHints,
        castFromZone: fromZone,
        spellType:
          (Array.isArray(action.cardTypes) && action.cardTypes.length > 0
            ? action.cardTypes.join(' ')
            : undefined) ??
          (typeof action.card?.type_line === 'string' ? action.card.type_line : undefined) ??
          (typeof sourceCard?.type_line === 'string' ? sourceCard.type_line : undefined) ??
          (typeof action.spellType === 'string' ? action.spellType : undefined),
        affectedPlayerIds: spellTargetHints.affectedPlayerIds ?? dedupedSelectedSpellTargets,
        affectedOpponentIds: spellTargetHints.affectedOpponentIds ?? selectedSpellOpponentTargets,
        targetPlayerId: selectedSpellTargetPlayerId ?? fallbackSpellTargetPlayerId,
        targetOpponentId: selectedSpellTargetOpponentId ?? fallbackSpellTargetOpponentId,
      }
    );

    const castSource =
      intrinsicGraveyardCast.entersBattlefieldTransformed || (sourceCard as any)?.entersBattlefieldTransformed
        ? this.buildTransformedCardFace(sourceCard)
        : (sourceCard || {});

    const castCard = {
      ...castSource,
      ...(action.card || {}),
      id: cardId || String(sourceCard?.id || action.card?.id || ''),
      name: String(action.cardName || action.card?.name || castSource?.name || sourceCard?.name || 'Unknown Card'),
      type_line: String(action.card?.type_line || castSource?.type_line || sourceCard?.type_line || ''),
      oracle_text: String(action.oracleText || action.card?.oracle_text || castSource?.oracle_text || sourceCard?.oracle_text || spellEffectText || ''),
    } as any;

    const spellStackObject: any = {
      id: castResult.stackObjectId!,
      spellId: action.cardId,
      cardName: context.cardName,
      controllerId: action.playerId,
      ownerId: String((sourceCard as any)?.ownerId || action.playerId),
      castFromZone: fromZone,
      targets: selectedSpellTargets,
      triggerMeta: spellTriggerMeta,
      card: castCard,
      ...(castCard?.exileInsteadOfGraveyard ? { exileInsteadOfGraveyard: true } : {}),
      ...(this.didPayBuyback(action, sourceCard, fromZone) ? { returnToHandInsteadOfGraveyard: true } : {}),
      ...(this.getReplicateCount(action) > 0 ? { replicateCount: this.getReplicateCount(action) } : {}),
      timestamp: Date.now(),
      type: 'spell' as const,
    };

    const stack = this.stacks.get(gameId)!;
    let stackAfterSpell = pushToStack(stack, spellStackObject).stack;
    const spellsCastThisTurn = {
      ...((((nextState as any)?.spellsCastThisTurn || {}) as Record<string, number>) || {}),
      [action.playerId]: Number((((nextState as any)?.spellsCastThisTurn || {})?.[action.playerId] || 0)) + 1,
    };
    const castTypeLine = String(castCard?.type_line || '').toLowerCase();
    const noncreatureSpellsCastThisTurn = !castTypeLine.includes('creature')
      ? {
          ...((((nextState as any)?.noncreatureSpellsCastThisTurn || {}) as Record<string, number>) || {}),
          [action.playerId]:
            Number((((nextState as any)?.noncreatureSpellsCastThisTurn || {})?.[action.playerId] || 0)) + 1,
        }
      : (((nextState as any)?.noncreatureSpellsCastThisTurn || {}) as Record<string, number>);
    const triggerState = {
      ...(nextState as any),
      stack: stackAfterSpell as any,
      spellsCastThisTurn,
      noncreatureSpellsCastThisTurn,
    } as any;

    const tribalTriggerResult = checkTribalCastTriggers(triggerState, castCard, action.playerId, {
      autoExecuteOracle: false,
    });
    const spellTriggerResult = checkSpellCastTriggers(triggerState, action.playerId, castResult.stackObjectId, castCard);
    const triggerStackObjects = [
      ...(Array.isArray((tribalTriggerResult.state as any)?.stack) ? ((tribalTriggerResult.state as any).stack as any[]) : []),
      ...(Array.isArray((spellTriggerResult.state as any)?.stack) ? ((spellTriggerResult.state as any).stack as any[]) : []),
    ].filter((item, index, all) => {
      const id = String((item as any)?.id || '').trim();
      return Boolean(id) && all.findIndex(candidate => String((candidate as any)?.id || '').trim() === id) === index;
    });

    for (const triggerObject of triggerStackObjects) {
      stackAfterSpell = pushToStack(stackAfterSpell, triggerObject).stack;
    }
    this.stacks.set(gameId, stackAfterSpell);
    
    // Emit event
    this.emit({
      type: RulesEngineEvent.SPELL_CAST,
      timestamp: Date.now(),
      gameId,
      data: { 
        spell: { card: { name: context.cardName }, id: castResult.stackObjectId },
        caster: action.playerId 
      },
    });
    
    // Emit mana spent event
    this.emit({
      type: RulesEngineEvent.MANA_SPENT,
      timestamp: Date.now(),
      gameId,
      data: { 
        playerId: action.playerId,
        cost: action.manaCost,
      },
    });
    
    return {
      next: {
        ...triggerState,
        stack: nextState.stack,
      },
      log: [
        ...(castResult.log || [`${action.playerId} cast ${context.cardName}`]),
        ...(tribalTriggerResult.logs || []),
        ...(spellTriggerResult.logs || []),
      ],
    };
  }

  /**
   * Play a land (special action). Supports playing from hand, exile, and graveyard.
   */
  private playLandAction(gameId: string, action: any): EngineResult<GameState> {
    const state = this.gameStates.get(gameId)!;
    const playerId = String(action.playerId || '');
    const cardId = String(action.cardId || '');
    const fromZone = String(action.fromZone || 'hand').toLowerCase();
    if (!playerId || !cardId) {
      return { next: state, log: ['Missing playerId or cardId'] };
    }

    const playerIndex = state.players.findIndex(p => p.id === playerId);
    if (playerIndex < 0) {
      return { next: state, log: ['Player not found'] };
    }

    const player: any = state.players[playerIndex] as any;
    const hand: any[] = Array.isArray(player.hand) ? [...player.hand] : [];
    const exile: any[] = Array.isArray(player.exile) ? [...player.exile] : [];
    const graveyard: any[] = Array.isArray(player.graveyard) ? [...player.graveyard] : [];

    let card: any | null = null;
    if (fromZone === 'hand') {
      const idx = hand.findIndex(c => String(c?.id || c?.cardId || '') === cardId);
      if (idx >= 0) {
        card = hand[idx];
        hand.splice(idx, 1);
      }
    } else if (fromZone === 'exile') {
      const idx = exile.findIndex(c => String(c?.id || c?.cardId || '') === cardId);
      if (idx >= 0) {
        card = exile[idx];
        exile.splice(idx, 1);
      }
    } else if (fromZone === 'graveyard') {
      const idx = graveyard.findIndex(c => String(c?.id || c?.cardId || '') === cardId);
      if (idx >= 0) {
        card = graveyard[idx];
        graveyard.splice(idx, 1);
      }
    }

    if (!card) {
      return { next: state, log: ['Card not found in origin zone'] };
    }

    const typeLineLower = String(card?.type_line || '').toLowerCase();
    if (!typeLineLower.includes('land')) {
      return { next: state, log: ['Card is not a land'] };
    }

    // Strip temporary play-permission markers when the card leaves a non-hand zone.
    const restCard =
      fromZone === 'graveyard'
        ? stripPlayableFromGraveyardTags(card)
        : stripPlayableFromExileTags(card);
    const battlefieldPermanent: any = {
      id: cardId,
      controller: playerId,
      owner: playerId,
      tapped: false,
      enteredFromZone: fromZone,
      card: { ...(restCard as any), id: cardId, zone: 'battlefield', enteredFromZone: fromZone },
    };

    const updatedPlayers = state.players.map(p => {
      if (p.id !== playerId) return p;
      return {
        ...(p as any),
        hand,
        exile,
        graveyard,
      } as any;
    });

    const stateAny: any = { ...state, players: updatedPlayers, battlefield: [...(state.battlefield || []), battlefieldPermanent] };

    // Increment land plays this turn.
    const existingLandsPlayed: any = stateAny.landsPlayedThisTurn || {};
    const prev = Number(existingLandsPlayed[playerId] ?? 0) || 0;
    stateAny.landsPlayedThisTurn = { ...(existingLandsPlayed as any), [playerId]: prev + 1 };

    // Consume any playable-from-exile marker if we played from exile.
    if (fromZone === 'exile') {
      const consumed = consumePlayableFromExileForCard(stateAny as any, playerId, cardId) as any;
      stateAny.playableFromExile = (consumed as any).playableFromExile;
    } else if (fromZone === 'graveyard') {
      const consumed = consumePlayableFromGraveyardForCard(stateAny as any, playerId, cardId) as any;
      stateAny.playableFromGraveyard = (consumed as any).playableFromGraveyard;
    }

    // Emit a generic ETB/zone-change style event.
    this.emit({
      type: RulesEngineEvent.CARD_PUT_ONTO_BATTLEFIELD,
      timestamp: Date.now(),
      gameId,
      data: { playerId, cardId, fromZone },
    });

    return {
      next: stateAny as any,
      log: [`${playerId} played a land`],
    };
  }
  
  /**
   * Tap permanent for mana
   */
  private tapForManaAction(gameId: string, action: any): EngineResult<GameState> {
    const state = this.gameStates.get(gameId)!;
    const player = state.players.find(p => p.id === action.playerId);
    
    if (!player) {
      return { next: state, log: ['Player not found'] };
    }
    
    const context: TapForManaContext = {
      permanentId: action.permanentId,
      permanentName: action.permanentName || 'Permanent',
      controllerId: action.playerId,
      manaToAdd: action.manaToAdd || [{ type: ManaType.COLORLESS, amount: 1 }],
      currentlyTapped: action.currentlyTapped || false,
    };
    
    const result = tapPermanentForMana(context, player.manaPool);
    
    if (!result.success) {
      return { next: state, log: [result.error || 'Failed to tap for mana'] };
    }
    
    // Update player's mana pool
    const updatedPlayers = state.players.map(p =>
      p.id === action.playerId
        ? { ...p, manaPool: result.manaPoolAfter! }
        : p
    );
    
    const nextState: GameState = {
      ...state,
      players: updatedPlayers,
    };
    
    this.emit({
      type: RulesEngineEvent.MANA_ADDED,
      timestamp: Date.now(),
      gameId,
      data: { 
        playerId: action.playerId,
        manaAdded: result.manaAdded,
        source: action.permanentName,
      },
    });
    
    this.emit({
      type: RulesEngineEvent.PERMANENT_TAPPED,
      timestamp: Date.now(),
      gameId,
      data: { 
        permanentId: action.permanentId,
        controllerId: action.playerId,
      },
    });
    
    return {
      next: nextState,
      log: result.log || [`Tapped ${action.permanentName} for mana`],
    };
  }
  
  /**
   * Activate an activated ability
   */
  private activateAbilityAction(gameId: string, action: any): EngineResult<GameState> {
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
  
  /**
   * Resolve top object on stack
   */
  private resolveHelmOfTheHostTrigger(
    state: GameState,
    stackObject: StackObject,
    effectText: string,
    triggerMeta: StackObject['triggerMeta']
  ): { handled: boolean; state: GameState; log: string[] } {
    const normalizedEffect = String(effectText || '').toLowerCase();
    const normalizedSourceName = String(triggerMeta?.sourceName || '').toLowerCase();
    if (!normalizedEffect.includes('copy of equipped creature') || !normalizedEffect.includes("isn't legendary")) {
      return { handled: false, state, log: [] };
    }

    if (normalizedSourceName && normalizedSourceName !== 'helm of the host') {
      return { handled: false, state, log: [] };
    }

    const battlefield = [...((state.battlefield || []) as any[])];
    const sourceId = String(triggerMeta?.triggerEventDataSnapshot?.sourceId || stackObject.spellId || '').trim();
    const sourcePerm = battlefield.find((perm: any) => String(perm?.id || '').trim() === sourceId) as any;
    if (!sourcePerm) {
      return { handled: true, state, log: ['[oracle-ir] Helm of the Host trigger fizzles (source not found)'] };
    }

    const attachedTo = String(sourcePerm?.attachedTo || '').trim();
    if (!attachedTo) {
      return { handled: true, state, log: ['[oracle-ir] Helm of the Host trigger fizzles (not attached)'] };
    }

    const equippedCreature = battlefield.find((perm: any) => String(perm?.id || '').trim() === attachedTo) as any;
    if (!equippedCreature) {
      return { handled: true, state, log: ['[oracle-ir] Helm of the Host trigger fizzles (equipped creature missing)'] };
    }

    const originalCard = { ...(equippedCreature.card || {}) } as any;
    const tokenId = `token-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
    const originalTypeLine = String(originalCard.type_line || equippedCreature.type_line || equippedCreature.cardType || 'Token');
    const tokenTypeLine = originalTypeLine.replace(/\bLegendary\s+/gi, '').trim();
    const originalOracleText = String(originalCard.oracle_text || equippedCreature.oracle_text || '');
    const originalKeywords = Array.isArray(originalCard.keywords) ? [...originalCard.keywords] : [];
    const hasPrintedHaste = /\bhaste\b/i.test(originalOracleText) || originalKeywords.some((keyword: string) => /\bhaste\b/i.test(String(keyword)));

    const tokenCard = {
      ...originalCard,
      id: tokenId,
      type_line: tokenTypeLine,
      oracle_text: hasPrintedHaste ? originalOracleText : `${originalOracleText}${originalOracleText ? '\n' : ''}Haste`,
      keywords: hasPrintedHaste ? originalKeywords : [...originalKeywords, 'Haste'],
    };

    const tokenPermanent = {
      id: tokenId,
      controller: stackObject.controllerId,
      owner: stackObject.controllerId,
      ownerId: stackObject.controllerId,
      tapped: false,
      summoningSickness: false,
      counters: {},
      attachedTo: undefined,
      attachments: [],
      attachedEquipment: [],
      isEquipped: false,
      modifiers: [],
      cardType: tokenTypeLine,
      type_line: tokenTypeLine,
      name: tokenCard.name,
      manaCost: originalCard.mana_cost ?? originalCard.manaCost,
      power: equippedCreature.power ?? originalCard.power,
      toughness: equippedCreature.toughness ?? originalCard.toughness,
      basePower: equippedCreature.basePower ?? equippedCreature.power ?? originalCard.power,
      baseToughness: equippedCreature.baseToughness ?? equippedCreature.toughness ?? originalCard.toughness,
      oracle_text: tokenCard.oracle_text,
      card: tokenCard,
      isToken: true,
    } as any;

    return {
      handled: true,
      state: {
        ...state,
        battlefield: [...battlefield, tokenPermanent],
      },
      log: [`[oracle-ir] Helm of the Host created token copy of ${tokenCard.name || equippedCreature.id}`],
    };
  }

  private resolveStackTop(gameId: string): EngineResult<GameState> {
    const state = this.gameStates.get(gameId)!;
    const stack = this.stacks.get(gameId)!;
    
    const popResult = popFromStack(stack);
    
    if (!popResult.object) {
      return { next: state, log: ['Stack is empty'] };
    }
    
    // Get legal targets from game state
    // For now, we'll assume all targets are still legal (proper implementation would check:
    // - Permanents still on battlefield
    // - Players still in game
    // - Spells still on stack
    // This is a simplified version for the initial implementation
    const legalTargets = popResult.object.targets; // TODO: Implement proper target validation
    
    // Validate and resolve
    const resolveResult = resolveStackObject(popResult.object, legalTargets);
    
    this.stacks.set(gameId, popResult.stack);
    
    if (resolveResult.countered) {
      this.emit({
        type: RulesEngineEvent.SPELL_COUNTERED,
        timestamp: Date.now(),
        gameId,
        data: { object: popResult.object },
      });
    } else {
      this.emit({
        type: popResult.object.type === 'spell' 
          ? RulesEngineEvent.SPELL_RESOLVED 
          : RulesEngineEvent.ABILITY_RESOLVED,
        timestamp: Date.now(),
        gameId,
        data: { object: popResult.object },
      });
    }

    let nextState = state;
    const oracleLogs: string[] = [];
    const stackObjectAny = popResult.object as any;
    const spellTypeLine = String(stackObjectAny.card?.type_line || '').toLowerCase();
    const isPermanentSpell =
      popResult.object.type === 'spell' &&
      ['creature', 'artifact', 'enchantment', 'planeswalker', 'battle', 'land'].some(type =>
        spellTypeLine.includes(type)
      );
    if (!resolveResult.countered) {
      if (popResult.object.type === 'spell') {
        const spellOracleText = String(stackObjectAny.card?.oracle_text || '');
        const temporaryWinLossResult = applyTemporaryCantLoseAndOpponentsCantWinEffect(
          nextState,
          String(popResult.object.id || popResult.object.spellId || stackObjectAny.card?.id || `spell-${Date.now()}`),
          String(popResult.object.cardName || stackObjectAny.card?.name || 'Spell'),
          popResult.object.controllerId,
          popResult.object.controllerId,
          spellOracleText,
        );
        if (temporaryWinLossResult.applied) {
          nextState = temporaryWinLossResult.state;
          oracleLogs.push(...temporaryWinLossResult.log);
        }
      }

      const triggerMeta = popResult.object.triggerMeta;
      const effectText = triggerMeta?.effectText;

      if (!isPermanentSpell && effectText && effectText.trim().length > 0) {
        const normalizedStackTargets = Array.isArray(popResult.object.targets)
          ? popResult.object.targets
              .map((id: any) => String(id || '').trim())
              .filter((id: string) => id.length > 0)
          : [];
        const dedupedStackTargets = Array.from(new Set(normalizedStackTargets));
        const playerIdSet = new Set((nextState.players || []).map((player: any) => String(player?.id || '').trim()).filter(Boolean));
        const dedupedStackPlayerTargets = dedupedStackTargets.filter(id => playerIdSet.has(id));
        const dedupedStackOpponentTargets = dedupedStackPlayerTargets.filter(id => id !== popResult.object.controllerId);
        const dedupedStackPermanentTargets = dedupedStackTargets.filter(id => !playerIdSet.has(id));
        const normalizedEventData = buildTriggerEventDataFromPayloads(
          popResult.object.controllerId,
          triggerMeta.triggerEventDataSnapshot,
          {
            sourceId: popResult.object.spellId,
            sourceControllerId: popResult.object.controllerId,
            targets: popResult.object.targets,
            affectedPlayerIds: dedupedStackPlayerTargets,
            affectedOpponentIds: dedupedStackOpponentTargets,
            ...(dedupedStackPermanentTargets.length === 1
              ? { targetPermanentId: dedupedStackPermanentTargets[0] }
              : {}),
          }
        );

        const executionEventData: TriggerEventData = {
          ...(triggerMeta.triggerEventDataSnapshot || {}),
          ...normalizedEventData,
          sourceId: normalizedEventData.sourceId ?? triggerMeta.triggerEventDataSnapshot?.sourceId ?? popResult.object.spellId,
          sourceControllerId:
            normalizedEventData.sourceControllerId ??
            triggerMeta.triggerEventDataSnapshot?.sourceControllerId ??
            popResult.object.controllerId,
          spellType:
            normalizedEventData.spellType ??
            triggerMeta.triggerEventDataSnapshot?.spellType,
        };

        const resolutionEventData = buildResolutionEventDataFromGameState(
          nextState,
          popResult.object.controllerId,
          executionEventData
        );

        const resolvedInterveningIfClause = String(triggerMeta.interveningIfClause || '').trim() || undefined;
        if (triggerMeta.hasInterveningIf && !resolvedInterveningIfClause) {
          oracleLogs.push('[oracle-ir] Trigger skipped at resolution (intervening-if missing clause)');
          return {
            next: nextState,
            log: [...(resolveResult.log || [`Resolved ${popResult.object.cardName}`]), ...oracleLogs],
          };
        }

        if (resolvedInterveningIfClause) {
          const stillTrue = evaluateTriggerCondition(
            resolvedInterveningIfClause,
            popResult.object.controllerId,
            resolutionEventData
          );
          if (!stillTrue) {
            oracleLogs.push('[oracle-ir] Trigger skipped at resolution (intervening-if false)');
            return {
              next: nextState,
              log: [...(resolveResult.log || [`Resolved ${popResult.object.cardName}`]), ...oracleLogs],
            };
          }
        }

        const knownTriggerResult = this.resolveHelmOfTheHostTrigger(
          nextState,
          popResult.object,
          effectText,
          triggerMeta,
        );

        const executeResult = knownTriggerResult.handled
          ? {
              state: knownTriggerResult.state,
              log: knownTriggerResult.log,
              appliedSteps: [],
              skippedSteps: [],
              automationGaps: [],
              pendingOptionalSteps: [],
            }
          : executeTriggeredAbilityEffectWithOracleIR(
              nextState,
              {
                controllerId: popResult.object.controllerId,
                sourceId:
                  triggerMeta?.triggerEventDataSnapshot?.sourceId ??
                  popResult.object.spellId,
                sourceName: triggerMeta?.sourceName || popResult.object.cardName,
                effect: effectText,
              },
              resolutionEventData,
              { allowOptional: false }
            );

        const triggerChoiceEvents = buildTriggeredAbilityChoiceEvents(
          nextState,
          {
            controllerId: popResult.object.controllerId,
            sourceId: popResult.object.spellId,
            sourceName: triggerMeta?.sourceName || popResult.object.cardName,
            effect: effectText,
            optional: Boolean((popResult.object as any)?.triggerMeta?.optional),
          },
          resolutionEventData
        );

        const needsChoicePrompt =
          triggerChoiceEvents.length > 0 &&
          (((executeResult.pendingOptionalSteps || []).length > 0) || ((executeResult.skippedSteps || []).length > 0));

        nextState = executeResult.state;
        oracleLogs.push(...(executeResult.log || []));

        if ((executeResult.automationGaps || []).length > 0) {
          this.emit({
            type: RulesEngineEvent.ORACLE_AUTOMATION_GAP_RECORDED,
            timestamp: Date.now(),
            gameId,
            data: {
              stackObjectId: popResult.object.id,
              sourceId: popResult.object.spellId,
              sourceName: triggerMeta?.sourceName || popResult.object.cardName,
              controllerId: popResult.object.controllerId,
              count: executeResult.automationGaps.length,
              records: executeResult.automationGaps,
            },
          });
        }

        if (needsChoicePrompt) {
          this.emit({
            type: RulesEngineEvent.CHOICE_REQUIRED,
            timestamp: Date.now(),
            gameId,
            data: {
              stackObjectId: popResult.object.id,
              sourceId: popResult.object.spellId,
              sourceName: triggerMeta?.sourceName || popResult.object.cardName,
              effectText,
              controllerId: popResult.object.controllerId,
              choiceEvents: triggerChoiceEvents,
              triggerEventData: resolutionEventData,
            },
          });
          oracleLogs.push(`[oracle-ir] Trigger requires player choice: ${popResult.object.cardName}`);
        }

        const replicateCount = this.getReplicateCount(stackObjectAny);
        if (replicateCount > 0) {
          for (let copyIndex = 0; copyIndex < replicateCount; copyIndex += 1) {
            const copyResult = executeTriggeredAbilityEffectWithOracleIR(
              nextState,
              {
                controllerId: popResult.object.controllerId,
                sourceId: popResult.object.spellId,
                sourceName: triggerMeta?.sourceName || popResult.object.cardName,
                effect: effectText,
              },
              resolutionEventData,
              { allowOptional: false }
            );

            nextState = copyResult.state;
            oracleLogs.push(
              `[oracle-ir] Replicate copy ${copyIndex + 1}/${replicateCount} resolved for ${popResult.object.cardName}`
            );
            oracleLogs.push(...(copyResult.log || []));

            if ((copyResult.automationGaps || []).length > 0) {
              this.emit({
                type: RulesEngineEvent.ORACLE_AUTOMATION_GAP_RECORDED,
                timestamp: Date.now(),
                gameId,
                data: {
                  stackObjectId: popResult.object.id,
                  sourceId: popResult.object.spellId,
                  sourceName: triggerMeta?.sourceName || popResult.object.cardName,
                  controllerId: popResult.object.controllerId,
                  count: copyResult.automationGaps.length,
                  records: copyResult.automationGaps,
                },
              });
            }
          }
        }
      }
    }

    if (popResult.object.type === 'spell' && !isPermanentSpell) {
      const exileInsteadOfGraveyard = Boolean(
        stackObjectAny.exileInsteadOfGraveyard || stackObjectAny.card?.exileInsteadOfGraveyard
      );
      const returnToHandInsteadOfGraveyard = Boolean(
        stackObjectAny.returnToHandInsteadOfGraveyard || stackObjectAny.card?.returnToHandInsteadOfGraveyard
      );
      const castFromZone = String(
        stackObjectAny.castFromZone || stackObjectAny.card?.castFromZone || ''
      ).trim().toLowerCase();
      const reboundApplies =
        resolveResult.destination === 'graveyard' &&
        !exileInsteadOfGraveyard &&
        !returnToHandInsteadOfGraveyard &&
        castFromZone === 'hand' &&
        this.spellCardHasKeyword(stackObjectAny, 'rebound');
      const destinationZone =
        reboundApplies
          ? 'exile'
          : resolveResult.destination === 'graveyard' && exileInsteadOfGraveyard
          ? 'exile'
          : resolveResult.destination === 'graveyard' && returnToHandInsteadOfGraveyard
            ? 'hand'
          : resolveResult.destination;

      if (destinationZone === 'graveyard' || destinationZone === 'exile' || destinationZone === 'hand') {
        nextState = this.moveResolvedNonPermanentSpellToZone(nextState, stackObjectAny, destinationZone);
        if (reboundApplies && destinationZone === 'exile') {
          nextState = this.registerReboundDelayedTrigger(nextState, stackObjectAny);
          oracleLogs.push(
            `[oracle-ir] ${popResult.object.cardName} was exiled with Rebound and a delayed upkeep trigger was scheduled`
          );
        } else {
          oracleLogs.push(
            destinationZone === 'exile'
              ? `[oracle-ir] ${popResult.object.cardName} was exiled after leaving the stack`
              : destinationZone === 'hand'
                ? `[oracle-ir] ${popResult.object.cardName} was returned to its owner's hand after leaving the stack`
                : `[oracle-ir] ${popResult.object.cardName} was put into its owner's graveyard after leaving the stack`
          );
        }
      }
    } else if (popResult.object.type === 'spell' && isPermanentSpell && !resolveResult.countered) {
      nextState = this.moveResolvedPermanentSpellToBattlefield(nextState, stackObjectAny);
      oracleLogs.push(`[oracle-ir] ${popResult.object.cardName} entered the battlefield`);
    }
    
    return {
      next: nextState,
      log: [...(resolveResult.log || [`Resolved ${popResult.object.cardName}`]), ...oracleLogs],
    };
  }
  
  /**
   * Empty mana pools at end of step/phase
   */
  private emptyManaPoolsAction(gameId: string): EngineResult<GameState> {
    const state = this.gameStates.get(gameId)!;
    
    const updatedPlayers = state.players.map(p => ({
      ...p,
      manaPool: emptyManaPool(),
    }));
    
    const nextState: GameState = {
      ...state,
      players: updatedPlayers,
    };
    
    this.emit({
      type: RulesEngineEvent.MANA_POOL_EMPTIED,
      timestamp: Date.now(),
      gameId,
      data: { players: state.players.map(p => p.id) },
    });
    
    return {
      next: nextState,
      log: ['Mana pools emptied'],
    };
  }
  
  /**
   * Advance turn/phase/step
   */
  private advanceTurnPhaseStep(gameId: string): EngineResult<GameState> {
    const state = this.gameStates.get(gameId)!;
    
    // TODO: Implement full turn advancement using turnBasedActions.ts
    // For now, simple step advancement
    
    this.emit({
      type: RulesEngineEvent.STEP_STARTED,
      timestamp: Date.now(),
      gameId,
      data: { step: state.step, phase: state.phase },
    });
    
    return {
      next: state,
      log: ['Turn advanced'],
    };
  }
  
  /**
   * Check and apply state-based actions
   */
  checkStateBasedActions(gameId: string, state: GameState): EngineResult<GameState> {
    const logs: string[] = [];
    let currentState = state;
    
    // Check for player losses
    for (const player of state.players) {
      const cantLose = playerHasCantLoseEffect(
        player.id,
        ((currentState as any).battlefield || []) as any,
        currentState.players as any,
        ((currentState as any).winLossEffects || []) as any,
      );

      // Convert Record to Map for commanderDamage if it exists
      const commanderDamageMap = player.commanderDamage 
        ? new Map(Object.entries(player.commanderDamage))
        : undefined;
        
      const lossCheck: PlayerLossCheck = {
        playerId: player.id,
        lifeTotal: player.life,
        poisonCounters: player.counters?.poison || 0,
        librarySize: player.library?.length || 0,
        commanderDamage: commanderDamageMap,
      };
      
      const lossCondition = checkPlayerLoss(lossCheck);
      if (lossCondition) {
        if (cantLose.hasCantLose) {
          logs.push(`${player.id} would lose the game (${lossCondition}) but is protected by ${cantLose.source}`);
          continue;
        }

        logs.push(`${player.id} lost the game: ${lossCondition}`);
        this.emit({
          type: RulesEngineEvent.PLAYER_LOST,
          timestamp: Date.now(),
          gameId,
          data: { playerId: player.id, reason: lossCondition },
        });
      }
    }
    
    // Apply creature death from lethal damage or zero toughness (Rule 704.5f, 704.5g)
    const creatureDeathResult = this.checkCreatureDeaths(currentState, gameId);
    if (creatureDeathResult.deaths.length > 0) {
      currentState = creatureDeathResult.state;
      logs.push(...creatureDeathResult.logs);
    }
    
    // Apply planeswalker death from zero loyalty (Rule 704.5i)
    const planeswalkerDeathResult = this.checkPlaneswalkerDeaths(currentState, gameId);
    if (planeswalkerDeathResult.deaths.length > 0) {
      currentState = planeswalkerDeathResult.state;
      logs.push(...planeswalkerDeathResult.logs);
    }
    
    // Check legend rule (Rule 704.5j)
    const legendResult = this.checkLegendRule(currentState, gameId);
    if (legendResult.sacrificed.length > 0) {
      currentState = legendResult.state;
      logs.push(...legendResult.logs);
    }
    
    // Check for auras attached to illegal permanents (Rule 704.5m)
    const auraResult = this.checkAuraAttachment(currentState, gameId);
    if (auraResult.detached.length > 0) {
      currentState = auraResult.state;
      logs.push(...auraResult.logs);
    }
    
    if (logs.length > 0) {
      this.emit({
        type: RulesEngineEvent.STATE_BASED_ACTIONS,
        timestamp: Date.now(),
        gameId,
        data: { actions: logs },
      });
    }
    
    // Check for win conditions
    const winResult = this.checkWinConditions(gameId, currentState);
    if (winResult.log && winResult.log.length > 0) {
      logs.push(...winResult.log);
      currentState = winResult.next; // Update state with win condition
    }
    
    return {
      next: currentState,
      log: logs.length > 0 ? logs : undefined,
    };
  }
  
  /**
   * Check win conditions
   */
  private checkWinConditions(gameId: string, state: GameState): EngineResult<GameState> {
    return checkWinConditionsForState({
      gameId,
      state,
      emit: event => this.emit(event),
      persistState: (targetGameId, nextState) => this.gameStates.set(targetGameId, nextState),
    });
  }
  
  /**
   * Process mulligan decision
   */
  processMulligan(gameId: string, playerId: PlayerID, keep: boolean): EngineResult<GameState> {
    const state = this.gameStates.get(gameId)!;
    const player = state.players.find(p => p.id === playerId);
    
    if (!player) {
      return { next: state, log: ['Player not found'] };
    }
    
    this.emit({
      type: RulesEngineEvent.MULLIGAN_DECISION,
      timestamp: Date.now(),
      gameId,
      data: { playerId, keep },
    });
    
    if (keep) {
      return {
        next: state,
        log: [`${playerId} kept their hand`],
      };
    } else {
      // Process mulligan - shuffle hand back and draw new hand
      return {
        next: state,
        log: [`${playerId} took a mulligan`],
      };
    }
  }
  
  /**
   * Pay life as a cost
   */
  private payLifeAction(gameId: string, action: any): EngineResult<GameState> {
    const state = this.gameStates.get(gameId)!;
    return payLifeActionForState({
      gameId,
      state,
      action,
      emit: event => this.emit(event),
    });
  }
  
  /**
   * Check for creatures with lethal damage or zero toughness (Rule 704.5f, 704.5g)
   */
  private checkCreatureDeaths(
    state: GameState,
    gameId: string
  ): { state: GameState; deaths: string[]; logs: string[] } {
    return checkCreatureDeathsForState({
      gameId,
      state,
      emit: event => this.emit(event),
    });
  }
  
  /**
   * Check for planeswalkers with zero loyalty (Rule 704.5i)
   */
  private checkPlaneswalkerDeaths(
    state: GameState,
    gameId: string
  ): { state: GameState; deaths: string[]; logs: string[] } {
    return checkPlaneswalkerDeathsForState({
      gameId,
      state,
      emit: event => this.emit(event),
    });
  }
  
  /**
   * Check legend rule (Rule 704.5j)
   */
  private checkLegendRule(
    state: GameState,
    gameId: string
  ): { state: GameState; sacrificed: string[]; logs: string[] } {
    return checkLegendRuleForState({
      gameId,
      state,
      emit: event => this.emit(event),
    });
    /*
    // Check for legendary permanents controlled by each player
    const battlefield = state.battlefield || [];
    for (const player of state.players) {
      // Filter battlefield by controller
      const playerPerms = battlefield.filter((p: any) => p.controller === player.id);
      for (const perm of playerPerms) {
        const typeLine = (perm.card?.type_line || '').toLowerCase();
        const superTypes = typeLine.split('—')[0];
        
        if (superTypes.includes('legendary')) {
          const name = perm.card?.name || 'Unknown';
          const key = `${player.id}:${name}`;
          
          const existing = legendsByControllerAndName.get(key) || [];
          existing.push(perm);
          legendsByControllerAndName.set(key, existing);
        }
      }
    }
    
    // Check for duplicates
    const entries = Array.from(legendsByControllerAndName.entries());
    for (const [key, legends] of entries) {
      if (legends.length > 1) {
        // Player must choose one to keep (for now, keep the newest/last one)
        const toSacrifice = legends.slice(0, -1);
        
        for (const perm of toSacrifice) {
          sacrificed.push(perm.id);
          logs.push(`${perm.card?.name || 'Legendary'} put into graveyard (legend rule)`);
          updatedState = this.moveToGraveyard(updatedState, perm);
          
          this.emit({
            type: RulesEngineEvent.PERMANENT_LEFT_BATTLEFIELD,
            timestamp: Date.now(),
            gameId,
            data: { 
              permanentId: perm.id, 
              name: perm.card?.name,
              reason: 'legend_rule',
            },
          });
        }
      }
    }
    
    return { state: updatedState, sacrificed, logs };
    */
  }
  
  /**
   * Check for auras attached to illegal permanents (Rule 704.5m)
   */
  private checkAuraAttachment(
    state: GameState,
    gameId: string
  ): { state: GameState; detached: string[]; logs: string[] } {
    return checkAuraAttachmentForState({
      gameId,
      state,
    });
  }
  
  /**
   * Move a permanent to its owner's graveyard
   */
  private moveToGraveyard(state: GameState, permanent: any): GameState {
    return movePermanentToGraveyard(state, permanent);
  }
}

/**
 * Singleton instance
 */
export const rulesEngine = new RulesEngineAdapter();
