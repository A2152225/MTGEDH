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
import { mergeOracleFieldsFromLookup } from '../../shared/src/hydrateCardOracleText.js';
import {
  applyCopyTokenOverrides,
  parseCopyTokenOverridesFromEffect,
} from '../../shared/src/copyTokenOverrides.js';
import { copyAsEntersCopiableChoicesFromSource } from '../../shared/src/copyTokenUtils.js';
import { lookupLocalCardByNameSync } from '../../server/src/services/localCardLookup.js';
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
import { CostType, type ManaPaymentRecord } from './types/costs';
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
  processDiesOrExileDelayedTriggersForState,
} from './rulesEngineAdapterDelayedTriggerSupport';
import {
  createDelayedTrigger,
  createDelayedTriggerRegistry,
  DelayedTriggerTiming,
  registerDelayedTrigger,
} from './delayedTriggeredAbilities';
import {
  consumeFutureSpellCastAdjustments,
  previewFutureSpellCastAdjustments,
} from './futureSpellEffects';
import { deriveSelfEntryCountersFromOracleIR } from './oracleIRSelfEntryCounters';

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
  getStackItems,
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
import { getColorsFromObject } from './oracleIRExecutorManaUtils';
import { canTargetPermanent } from './permanentTargeting';
import { canTargetPlayer } from './playerProtection';
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
  findTriggeredAbilities,
  processTriggersAutoOracle,
  GamePhase,
  GameStep,
} from './actions';

// Re-export events from core module, import for local use
export { RulesEngineEvent, type RulesEvent } from './core/events';
import { RulesEngineEvent } from './core/events';
import type { RulesEvent } from './core/events';
import {
  applyActivatedAbilityCounterRemovals,
  applyActivatedAbilityExileSelection,
  canPayActivatedAbilityAdditionalCosts,
  canPayGraveyardAdditionalCost,
  getEligibleTapPermanents,
  payActivatedAbilityAdditionalCosts,
  payGraveyardAdditionalCost,
  resolveActivatedAbilityCounterRemovals,
  resolveActivatedAbilityDiscardCards,
  resolveActivatedAbilityExileSelection,
  resolveActivatedAbilityRevealCards,
  resolveActivatedAbilitySacrificePermanents,
  resolveActivatedAbilityTapPermanents,
} from './RulesEngineAdapter-handlers/adapterActivatedAbilityAdditionalCosts';
import {
  validateAbilityActivation,
  validatePlayLand,
  validateSpellCast,
} from './RulesEngineAdapter-handlers/adapterActionValidators';
import { castSpellAction } from './RulesEngineAdapter-handlers/adapterCastSpellAction';
import { resolveStackTop } from './RulesEngineAdapter-handlers/adapterResolveStackTop';
import { checkStateBasedActions } from './RulesEngineAdapter-handlers/adapterStateBasedActions';
import { activateAbilityAction } from './RulesEngineAdapter-handlers/adapterActivateAbilityAction';
import { playLandAction } from './RulesEngineAdapter-handlers/adapterPlayLandAction';
import {
  buildTargetingSourceInfo,
  evaluateSelectedTargetLegality,
  getAbilitySourceObject,
  getLegalStackTargetIds,
  getSourceTypeName,
  getStackSourceTypeName,
  getTargetingColorNames,
  isStackTargetCurrentlyLegal,
  isTargetCardPresentInState,
  validateSelectedTargetsForSource,
} from './RulesEngineAdapter-handlers/adapterTargetingHelpers';
import {
  appendFlashType,
  buildCastSpellMetadata,
  deriveSelfEntryCounterMetadata,
  deriveTappedSourceCounterImmunity,
  getCastMetadataValue,
  mergeCastSpellMetadata,
  mergeEntryCounterMaps,
  normalizeColorSymbols,
  normalizeCounterImmunityMetadata,
  normalizeManaPaymentRecord,
  normalizeTypePhrase,
  typeLineContainsChosenType,
} from './RulesEngineAdapter-handlers/adapterCastSpellMetadata';
import {
  cardMatchesAdditionalCostFilter,
  getEligibleCounterRemovalPermanents,
  getEligibleDiscardCards,
  getEligibleGraveyardExileCards,
  getEligibleSacrificePermanents,
  normalizeGraveyardAdditionalCostFilter,
  parseCountToken,
  parseCounterRemovalFromCostDescription,
  parseDiscardCostFromDescription,
  parseExileCostFromDescription,
  parseLifeAmountFromCostDescription,
  parseSacrificeCostFromDescription,
  parseTapCostFromDescription,
  removeCountersFromEligiblePermanents,
  totalRemovableCountersOnPermanent,
} from './RulesEngineAdapter-handlers/adapterAdditionalCostParsers';
import {
  addManaCostValues,
  buildTransformedCardFace,
  didPayBuyback,
  extractKeywordCostFromOracleText,
  getEffectiveBuybackManaCostInput,
  getEffectiveKeywordAdjustedManaCostInput,
  getIntrinsicGraveyardCastMetadata,
  getReplicateCount,
  manaCostsEqual,
  moveResolvedNonPermanentSpellToZone,
  moveResolvedPermanentSpellToBattlefield,
  multiplyManaCost,
  registerReboundDelayedTrigger,
  sanitizeSpellCardAfterStackExit,
  shouldPayBuyback,
  spellCardHasKeyword,
} from './RulesEngineAdapter-handlers/adapterKeywordCostAndResolvedSpell';
import { processBecameMonstrousTriggers } from './RulesEngineAdapter-handlers/adapterBecameMonstrousTriggers';
import { resolveHelmOfTheHostTrigger } from './RulesEngineAdapter-handlers/adapterHelmOfTheHostTrigger';
import { tapForManaAction } from './RulesEngineAdapter-handlers/adapterTapForManaAction';
import { executeAction } from './RulesEngineAdapter-handlers/adapterExecuteAction';
import {
  canPayManaCostFromPool,
  parseManaCostString,
} from './RulesEngineAdapter-handlers/adapterManaCostParse';
import {
  canCastTopLibrarySpell,
  canPlayTopLibraryLand,
  findSourceZoneCard,
  getCardTypes,
} from './RulesEngineAdapter-handlers/adapterLibrarySourceHelpers';
import { buildTimingContext } from './RulesEngineAdapter-handlers/adapterTimingContext';

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
      case 'activateAbility':
        return this.validateAbilityActivation(state, action);
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
    return validatePlayLand.call(this, state, action);
  }

  /**
   * Validate spell casting
   */
  private validateSpellCast(state: GameState, action: any): ActionValidation {
    return validateSpellCast.call(this, state, action);
  }

  private validateAbilityActivation(state: GameState, action: any): ActionValidation {
    return validateAbilityActivation.call(this, state, action);
  }

  
  /**
   * Extract card types from a card object
   */
  private getCardTypes(card: any): string[] {
    return getCardTypes.call(this, card);
  }

  private canPlayTopLibraryLand(state: GameState, playerId: string): boolean {
    return canPlayTopLibraryLand.call(this, state, playerId);
  }

  private canCastTopLibrarySpell(state: GameState, playerId: string, card?: any): boolean {
    return canCastTopLibrarySpell.call(this, state, playerId, card);
  }

  private findSourceZoneCard(state: GameState, playerId: string, cardId: string, fromZone: string): any | null {
    return findSourceZoneCard.call(this, state, playerId, cardId, fromZone);
  }


  private extractKeywordCostFromOracleText(card: any, keyword: string): string | undefined {
    return extractKeywordCostFromOracleText.call(this, card, keyword);
  }

  private getIntrinsicGraveyardCastMetadata(sourceCard: any, fromZone: string): {
    readonly cost?: string;
    readonly entersBattlefieldTransformed?: boolean;
  } {
    return getIntrinsicGraveyardCastMetadata.call(this, sourceCard, fromZone);
  }

  private buildTransformedCardFace(sourceCard: any): any {
    return buildTransformedCardFace.call(this, sourceCard);
  }

  private addManaCostValues(left: string | ManaCost | undefined, right: string | ManaCost | undefined): ManaCost {
    return addManaCostValues.call(this, left, right);
  }

  private manaCostsEqual(left: ManaCost, right: ManaCost): boolean {
    return manaCostsEqual.call(this, left, right);
  }

  private multiplyManaCost(cost: string | ManaCost | undefined, count: number): ManaCost {
    return multiplyManaCost.call(this, cost, count);
  }

  private shouldPayBuyback(action: any): boolean {
    return shouldPayBuyback.call(this, action);
  }

  private getReplicateCount(action: any): number {
    return getReplicateCount.call(this, action);
  }

  private getEffectiveKeywordAdjustedManaCostInput(action: any, sourceCard: any, fromZone: string): ManaCost | undefined {
    return getEffectiveKeywordAdjustedManaCostInput.call(this, action, sourceCard, fromZone);
  }

  private getEffectiveBuybackManaCostInput(action: any, sourceCard: any, fromZone: string): ManaCost | undefined {
    return getEffectiveBuybackManaCostInput.call(this, action, sourceCard, fromZone);
  }

  private didPayBuyback(action: any, sourceCard: any, fromZone: string): boolean {
    return didPayBuyback.call(this, action, sourceCard, fromZone);
  }

  private sanitizeSpellCardAfterStackExit(card: any): any {
    return sanitizeSpellCardAfterStackExit.call(this, card);
  }

  private moveResolvedNonPermanentSpellToZone(
    state: GameState,
    stackObject: any,
    zone: 'graveyard' | 'exile' | 'hand'
  ): GameState {
    return moveResolvedNonPermanentSpellToZone.call(this, state, stackObject, zone);
  }

  private spellCardHasKeyword(stackObject: any, keyword: string): boolean {
    return spellCardHasKeyword.call(this, stackObject, keyword);
  }

  private registerReboundDelayedTrigger(state: GameState, stackObject: any): GameState {
    return registerReboundDelayedTrigger.call(this, state, stackObject);
  }

  private moveResolvedPermanentSpellToBattlefield(state: GameState, stackObject: any): GameState {
    return moveResolvedPermanentSpellToBattlefield.call(this, state, stackObject);
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
    return buildTimingContext.call(this, state, playerId);
  }


  private normalizeGraveyardAdditionalCostFilter(filterText?: string): string[] {
    return normalizeGraveyardAdditionalCostFilter.call(this, filterText);
  }

  private cardMatchesAdditionalCostFilter(cardLike: any, filterText?: string): boolean {
    return cardMatchesAdditionalCostFilter.call(this, cardLike, filterText);
  }

  private getEligibleDiscardCards(state: GameState, playerId: string, filterText?: string): any[] {
    return getEligibleDiscardCards.call(this, state, playerId, filterText);
  }

  private getEligibleSacrificePermanents(state: GameState, playerId: string, filterText?: string): any[] {
    return getEligibleSacrificePermanents.call(this, state, playerId, filterText);
  }

  private getEligibleGraveyardExileCards(state: GameState, playerId: string): any[] {
    return getEligibleGraveyardExileCards.call(this, state, playerId);
  }

  private getEligibleCounterRemovalPermanents(
    state: GameState,
    playerId: string,
    filterText?: string,
    counter?: string
  ): any[] {
    return getEligibleCounterRemovalPermanents.call(this, state, playerId, filterText, counter);
  }

  private totalRemovableCountersOnPermanent(perm: any, counter?: string): number {
    return totalRemovableCountersOnPermanent.call(this, perm, counter);
  }

  private removeCountersFromEligiblePermanents(
    state: GameState,
    playerId: string,
    amount: number,
    filterText?: string,
    counter?: string
  ): { success: boolean; state: GameState; log: string[] } {
    return removeCountersFromEligiblePermanents.call(this, state, playerId, amount, filterText, counter);
  }

  private parseLifeAmountFromCostDescription(description?: string): number {
    return parseLifeAmountFromCostDescription.call(this, description);
  }

  private parseCountToken(token: unknown, defaultValue = 1): number {
    return parseCountToken.call(this, token, defaultValue);
  }

  private parseTapCostFromDescription(description?: string): { count: number; filterText?: string; selfOnly: boolean } {
    return parseTapCostFromDescription.call(this, description);
  }

  private parseDiscardCostFromDescription(description?: string): { count: number; filterText?: string } {
    return parseDiscardCostFromDescription.call(this, description);
  }

  private parseSacrificeCostFromDescription(description?: string): { count: number; filterText?: string } {
    return parseSacrificeCostFromDescription.call(this, description);
  }

  private parseCounterRemovalFromCostDescription(description?: string): { count: number; counter?: string; filterText?: string } {
    return parseCounterRemovalFromCostDescription.call(this, description);
  }

  private parseExileCostFromDescription(description?: string): { count: number; filterText?: string } {
    return parseExileCostFromDescription.call(this, description);
  }


  private resolveActivatedAbilityDiscardCards(
    state: GameState,
    playerId: string,
    action: any,
    count: number,
    filterText?: string
  ): any[] {
    return resolveActivatedAbilityDiscardCards.call(this, state, playerId, action, count, filterText);
  }

  private getEligibleTapPermanents(state: GameState, playerId: string, filterText?: string): any[] {
    return getEligibleTapPermanents.call(this, state, playerId, filterText);
  }

  private resolveActivatedAbilityTapPermanents(
    state: GameState,
    playerId: string,
    ability: ActivatedAbility,
    action: any,
    description?: string
  ): any[] {
    return resolveActivatedAbilityTapPermanents.call(this, state, playerId, ability, action, description);
  }

  private resolveActivatedAbilitySacrificePermanents(
    state: GameState,
    playerId: string,
    ability: ActivatedAbility,
    action: any,
    count: number,
    description?: string
  ): any[] {
    return resolveActivatedAbilitySacrificePermanents.call(this, state, playerId, ability, action, count, description);
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
    return resolveActivatedAbilityCounterRemovals.call(this, state, playerId, ability, action, count, counter, filterText);
  }

  private applyActivatedAbilityCounterRemovals(
    state: GameState,
    removals: Array<{ permanentId: string; count: number }>,
    counter?: string
  ): GameState {
    return applyActivatedAbilityCounterRemovals.call(this, state, removals, counter);
  }

  private resolveActivatedAbilityExileSelection(
    state: GameState,
    playerId: string,
    ability: ActivatedAbility,
    action: any,
    count: number,
    description?: string
  ): { permanentIds: string[]; handIds: string[]; graveyardIds: string[] } {
    return resolveActivatedAbilityExileSelection.call(this, state, playerId, ability, action, count, description);
  }

  private applyActivatedAbilityExileSelection(
    state: GameState,
    playerId: string,
    selection: { permanentIds: string[]; handIds: string[]; graveyardIds: string[] }
  ): GameState {
    return applyActivatedAbilityExileSelection.call(this, state, playerId, selection);
  }

  private canPayActivatedAbilityAdditionalCosts(state: GameState, playerId: string, ability: ActivatedAbility, action?: any): boolean {
    return canPayActivatedAbilityAdditionalCosts.call(this, state, playerId, ability, action);
  }

  private payActivatedAbilityAdditionalCosts(
    state: GameState,
    playerId: string,
    ability: ActivatedAbility,
    action?: any
  ): { success: boolean; state: GameState; log: string[]; tappedSource?: boolean } {
    return payActivatedAbilityAdditionalCosts.call(this, state, playerId, ability, action);
  }

  private resolveActivatedAbilityRevealCards(
    state: GameState,
    playerId: string,
    ability: ActivatedAbility,
    action: any,
    description: string
  ): any[] {
    return resolveActivatedAbilityRevealCards.call(this, state, playerId, ability, action, description);
  }

  private canPayGraveyardAdditionalCost(state: GameState, playerId: string, cost: any): boolean {
    return canPayGraveyardAdditionalCost.call(this, state, playerId, cost);
  }

  private payGraveyardAdditionalCost(
    state: GameState,
    playerId: string,
    cost: any
  ): { success: boolean; state: GameState; log: string[] } {
    return payGraveyardAdditionalCost.call(this, state, playerId, cost);
  }

  /** Build a de-duplicated target id list from normalized trigger event data. */
  private collectTargetIdsFromEventData(eventData?: TriggerEventData): string[] {
    if (!eventData) return [];
    const ordered = [
      ...(eventData.affectedPlayerIds || []),
      ...(eventData.targetPlayerId ? [eventData.targetPlayerId] : []),
      ...(eventData.targetOpponentId ? [eventData.targetOpponentId] : []),
      ...(eventData.targetPermanentId ? [eventData.targetPermanentId] : []),
      ...(eventData.targetSpellId ? [eventData.targetSpellId] : []),
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
    return parseManaCostString.call(this, manaCost);
  }

  private canPayManaCostFromPool(cost: ManaCost, pool: SimpleManaPool): { canPay: boolean; reason?: string } {
    return canPayManaCostFromPool.call(this, cost, pool);
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
    return executeAction.call(this, gameId, action);
  }


  private processDiesDelayedTriggers(
    gameId: string,
    previousState: GameState,
    nextState: GameState
  ): { state: GameState; log: string[] } {
    const diesResult = processDiesDelayedTriggersForState({
      gameId,
      previousState,
      nextState,
      getStack: targetGameId => this.stacks.get(targetGameId),
      setStack: (targetGameId, stack) => this.stacks.set(targetGameId, stack),
    });

    const exileResult = processDiesOrExileDelayedTriggersForState({
      gameId,
      previousState,
      nextState: diesResult.state,
      getStack: targetGameId => this.stacks.get(targetGameId),
      setStack: (targetGameId, stack) => this.stacks.set(targetGameId, stack),
    });

    return {
      state: exileResult.state,
      log: [...diesResult.log, ...exileResult.log],
    };
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

  private getCastMetadataValue(action: any, sourceCard: any, field: string): any {
    return getCastMetadataValue.call(this, action, sourceCard, field);
  }

  private normalizeManaPaymentRecord(value: unknown): ManaPaymentRecord | undefined {
    return normalizeManaPaymentRecord.call(this, value);
  }

  private normalizeColorSymbols(value: unknown): readonly string[] | undefined {
    return normalizeColorSymbols.call(this, value);
  }

  private normalizeCounterImmunityMetadata(
    rawValue: unknown,
    directCantBeCountered: unknown,
    directCounterSourceColors: readonly string[] | undefined,
  ):
    | { readonly unconditional?: boolean; readonly counterSourceColors?: readonly string[] }
    | undefined {
    return normalizeCounterImmunityMetadata.call(this, rawValue, directCantBeCountered, directCounterSourceColors);
  }

  private buildCastSpellMetadata(action: any, sourceCard: any): Record<string, unknown> {
    return buildCastSpellMetadata.call(this, action, sourceCard);
  }

  private deriveSelfEntryCounterMetadata(action: any, sourceCard: any): Record<string, number> | undefined {
    return deriveSelfEntryCounterMetadata.call(this, action, sourceCard);
  }

  private normalizeTypePhrase(value: unknown): string {
    return normalizeTypePhrase.call(this, value);
  }

  private typeLineContainsChosenType(typeLine: unknown, chosenType: unknown): boolean {
    return typeLineContainsChosenType.call(this, typeLine, chosenType);
  }

  private deriveTappedSourceCounterImmunity(
    state: GameState,
    action: any,
    castCard: any,
  ):
    | { readonly unconditional?: boolean; readonly counterSourceColors?: readonly string[] }
    | undefined {
    return deriveTappedSourceCounterImmunity.call(this, state, action, castCard);
  }

  private mergeCastSpellMetadata(
    baseMetadata: Record<string, unknown>,
    extraCounterImmunity?: { readonly unconditional?: boolean; readonly counterSourceColors?: readonly string[] },
  ): Record<string, unknown> {
    return mergeCastSpellMetadata.call(this, baseMetadata, extraCounterImmunity);
  }

  private appendFlashType(cardTypes: readonly string[], grantsFlashTiming: boolean): string[] {
    return appendFlashType.call(this, cardTypes, grantsFlashTiming);
  }

  private mergeEntryCounterMaps(
    left: unknown,
    right: Record<string, number> | undefined,
  ): Record<string, number> | undefined {
    return mergeEntryCounterMaps.call(this, left, right);
  }


  private getTargetingColorNames(colors: readonly string[] | undefined): readonly string[] {
    return getTargetingColorNames.call(this, colors);
  }

  private getSourceTypeName(sourceObject: any): string | undefined {
    return getSourceTypeName.call(this, sourceObject);
  }

  private buildTargetingSourceInfo(
    controllerId: string,
    sourceObject: any,
    objectType: 'spell' | 'ability',
  ): {
    readonly controllerId: string;
    readonly colors?: readonly string[];
    readonly objectType: 'spell' | 'ability';
    readonly typeName?: string;
  } {
    return buildTargetingSourceInfo.call(this, controllerId, sourceObject, objectType);
  }

  private isTargetCardPresentInState(state: GameState, targetId: string): boolean {
    return isTargetCardPresentInState.call(this, state, targetId);
  }

  private evaluateSelectedTargetLegality(
    state: GameState,
    targetId: string,
    sourceInfo: {
      readonly controllerId: string;
      readonly colors?: readonly string[];
      readonly objectType: 'spell' | 'ability';
      readonly typeName?: string;
    }
  ): { readonly legal: boolean; readonly reason?: string } {
    return evaluateSelectedTargetLegality.call(this, state, targetId, sourceInfo);
  }

  private validateSelectedTargetsForSource(
    state: GameState,
    targetIds: readonly unknown[] | undefined,
    sourceInfo: {
      readonly controllerId: string;
      readonly colors?: readonly string[];
      readonly objectType: 'spell' | 'ability';
      readonly typeName?: string;
    }
  ): ActionValidation {
    return validateSelectedTargetsForSource.call(this, state, targetIds, sourceInfo);
  }

  private getAbilitySourceObject(state: GameState, ability: ActivatedAbility, action: any): any {
    return getAbilitySourceObject.call(this, state, ability, action);
  }

  private getStackSourceTypeName(stackObject: StackObject | any): string | undefined {
    return getStackSourceTypeName.call(this, stackObject);
  }

  private isStackTargetCurrentlyLegal(state: GameState, stackObject: StackObject | any, targetId: string): boolean {
    return isStackTargetCurrentlyLegal.call(this, state, stackObject, targetId);
  }

  private getLegalStackTargetIds(state: GameState, stackObject: StackObject | any): readonly string[] {
    return getLegalStackTargetIds.call(this, state, stackObject);
  }

  
  /**
   * Cast a spell (enhanced with full spell casting system)
   */
  private castSpellAction(gameId: string, action: any): EngineResult<GameState> {
    return castSpellAction.call(this, gameId, action);
  }


  /**
   * Play a land (special action). Supports playing from hand, exile, graveyard, and library.
   */
  private playLandAction(gameId: string, action: any): EngineResult<GameState> {
    return playLandAction.call(this, gameId, action);
  }

  
  /**
   * Tap permanent for mana
   */
  private tapForManaAction(gameId: string, action: any): EngineResult<GameState> {
    return tapForManaAction.call(this, gameId, action);
  }

  
  /**
   * Activate an activated ability
   */
  private activateAbilityAction(gameId: string, action: any): EngineResult<GameState> {
    return activateAbilityAction.call(this, gameId, action);
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
    return resolveHelmOfTheHostTrigger.call(this, state, stackObject, effectText, triggerMeta);
  }


  private resolveStackTop(gameId: string): EngineResult<GameState> {
    return resolveStackTop.call(this, gameId);
  }

  private processBecameMonstrousTriggers(
    gameId: string,
    battlefieldBeforeResolution: readonly any[],
    state: GameState
  ): EngineResult<GameState> {
    return processBecameMonstrousTriggers.call(this, gameId, battlefieldBeforeResolution, state);
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
    return checkStateBasedActions.call(this, gameId, state);
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
