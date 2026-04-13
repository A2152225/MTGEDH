/**
 * DecisionManager.ts
 * 
 * Manages pending decisions that require player input.
 * 
 * In MTG Online-style gameplay, the game pauses when player input is needed:
 * - Target selection
 * - Mode selection
 * - X value selection
 * - Trigger ordering
 * - Combat damage assignment
 * - Mulligan decisions
 * 
 * This manager tracks these decisions, validates responses, and
 * resumes automation when decisions are resolved.
 */

import type { GameState, PlayerID, BattlefieldPermanent } from '../../shared/src';
import {
  DecisionType,
  PendingDecision,
  DecisionOption,
  DecisionResult,
  SelectionFilter,
} from './AutomationService';
import { canPermanentAttack, canPermanentBlock } from './actions/combat';
import { getColorsFromObject } from './oracleIRExecutorManaUtils';
import { canTargetPermanent } from './permanentTargeting';
import { canTargetPlayer } from './playerProtection';
import { hasPermanentType } from './permanentTypeUtils';
import { applyStaticAbilitiesToBattlefield } from './staticAbilities';

/**
 * Player's response to a pending decision
 */
export interface DecisionResponse {
  decisionId: string;
  playerId: string;
  selection: any;  // Could be string, string[], number, etc.
  timestamp: number;
}

/**
 * Result of validating a decision response
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
  processedSelection?: any;
}

/**
 * State stored for pending decisions per game
 */
export interface DecisionState {
  gameId: string;
  pendingDecisions: PendingDecision[];
  decisionHistory: DecisionResponse[];
  timeoutHandles: Map<string, NodeJS.Timeout>;
}

/**
 * Decision Manager - handles all pending decision tracking and processing
 */
export class DecisionManager {
  private gameDecisions: Map<string, DecisionState> = new Map();
  
  /**
   * Initialize decision tracking for a game
   */
  initGame(gameId: string): void {
    this.gameDecisions.set(gameId, {
      gameId,
      pendingDecisions: [],
      decisionHistory: [],
      timeoutHandles: new Map(),
    });
  }
  
  /**
   * Add a pending decision
   */
  addDecision(gameId: string, decision: PendingDecision): void {
    const state = this.getOrCreateState(gameId);
    state.pendingDecisions.push(decision);
    
    // Set timeout if specified
    if (decision.timeoutMs) {
      const handle = setTimeout(() => {
        this.handleDecisionTimeout(gameId, decision.id);
      }, decision.timeoutMs);
      state.timeoutHandles.set(decision.id, handle);
    }
  }
  
  /**
   * Add multiple pending decisions
   */
  addDecisions(gameId: string, decisions: PendingDecision[]): void {
    for (const decision of decisions) {
      this.addDecision(gameId, decision);
    }
  }
  
  /**
   * Get pending decisions for a player
   */
  getPlayerDecisions(gameId: string, playerId: string): PendingDecision[] {
    const state = this.gameDecisions.get(gameId);
    if (!state) return [];
    return state.pendingDecisions.filter(d => d.playerId === playerId);
  }
  
  /**
   * Get all pending decisions for a game
   */
  getAllDecisions(gameId: string): PendingDecision[] {
    const state = this.gameDecisions.get(gameId);
    return state?.pendingDecisions || [];
  }
  
  /**
   * Check if game has any pending decisions
   */
  hasPendingDecisions(gameId: string): boolean {
    const state = this.gameDecisions.get(gameId);
    return (state?.pendingDecisions.length || 0) > 0;
  }
  
  /**
   * Get a specific pending decision
   */
  getDecision(gameId: string, decisionId: string): PendingDecision | undefined {
    const state = this.gameDecisions.get(gameId);
    return state?.pendingDecisions.find(d => d.id === decisionId);
  }
  
  /**
   * Process a player's decision response
   */
  processResponse(
    gameId: string,
    response: DecisionResponse,
    gameState: GameState
  ): { result: ValidationResult; decision: PendingDecision | undefined } {
    const state = this.gameDecisions.get(gameId);
    if (!state) {
      return {
        result: { valid: false, error: 'Game not found' },
        decision: undefined,
      };
    }
    
    const decision = state.pendingDecisions.find(d => d.id === response.decisionId);
    if (!decision) {
      return {
        result: { valid: false, error: 'Decision not found or already resolved' },
        decision: undefined,
      };
    }
    
    // Validate the player is the one who should respond
    if (decision.playerId !== response.playerId) {
      return {
        result: { valid: false, error: 'Not your decision to make' },
        decision,
      };
    }
    
    // Validate the response based on decision type
    const validation = this.validateResponse(decision, response, gameState);
    
    if (validation.valid) {
      // Clear timeout
      const handle = state.timeoutHandles.get(decision.id);
      if (handle) {
        clearTimeout(handle);
        state.timeoutHandles.delete(decision.id);
      }
      
      // Remove from pending
      state.pendingDecisions = state.pendingDecisions.filter(d => d.id !== decision.id);
      
      // Add to history
      state.decisionHistory.push(response);
    }
    
    return { result: validation, decision };
  }
  
  /**
   * Validate a decision response
   */
  private validateResponse(
    decision: PendingDecision,
    response: DecisionResponse,
    gameState: GameState
  ): ValidationResult {
    const selection = response.selection;
    
    switch (decision.type) {
      case DecisionType.SELECT_TARGETS:
        return this.validateTargetSelection(decision, selection, gameState);
        
      case DecisionType.SELECT_MODE:
      case DecisionType.SELECT_MODES:
        return this.validateModeSelection(decision, selection);
        
      case DecisionType.SELECT_X_VALUE:
        return this.validateXValue(decision, selection, gameState);
        
      case DecisionType.ORDER_TRIGGERS:
        return this.validateTriggerOrdering(decision, selection);
        
      case DecisionType.ORDER_BLOCKERS:
        return this.validateBlockerOrdering(decision, selection);
        
      case DecisionType.SELECT_ATTACKERS:
        return this.validateAttackerSelection(decision, selection, gameState);
        
      case DecisionType.SELECT_BLOCKERS:
        return this.validateBlockerSelection(decision, selection, gameState);
        
      case DecisionType.SELECT_CARDS:
        return this.validateCardSelection(decision, selection, gameState);
        
      case DecisionType.MAY_ABILITY:
        return this.validateMayAbility(decision, selection);
        
      case DecisionType.SELECT_OPTION:
        return this.validateOptionSelection(decision, selection);
        
      case DecisionType.MULLIGAN_DECISION:
        return this.validateMulliganDecision(selection);
        
      case DecisionType.MULLIGAN_BOTTOM:
        return this.validateMulliganBottom(decision, selection, gameState);
        
      default:
        return { valid: true, processedSelection: selection };
    }
  }
  
  /**
   * Validate target selection
   */
  private validateTargetSelection(
    decision: PendingDecision,
    selection: string | string[],
    gameState: GameState
  ): ValidationResult {
    const targets = Array.isArray(selection) ? selection : [selection];
    const sourceInfo = this.getDecisionTargetingSourceInfo(decision, gameState);
    const allowedTargetIds = new Set(
      (decision.options || [])
        .filter((option: DecisionOption) => !option.disabled)
        .map((option: DecisionOption) => String(option.id || '').trim())
        .filter(Boolean)
    );
    
    // Check count requirements
    if (decision.minSelections && targets.length < decision.minSelections) {
      return {
        valid: false,
        error: `Must select at least ${decision.minSelections} target(s)`,
      };
    }
    
    if (decision.maxSelections && targets.length > decision.maxSelections) {
      return {
        valid: false,
        error: `Cannot select more than ${decision.maxSelections} target(s)`,
      };
    }
    
    // Validate each target exists and is valid type
    const targetTypes = decision.targetTypes || [];
    for (const targetId of targets) {
      if (allowedTargetIds.size > 0 && !allowedTargetIds.has(String(targetId || '').trim())) {
        return {
          valid: false,
          error: 'Invalid target: target was not offered as a valid option',
        };
      }

      const filterResult = this.matchesTargetSelectionFilters(
        String(targetId || '').trim(),
        decision.filters || [],
        gameState,
        sourceInfo,
      );
      if (!filterResult.valid) {
        return {
          valid: false,
          error: `Invalid target: ${filterResult.reason}`,
        };
      }

      const isValidTarget = this.isValidTarget(targetId, targetTypes, gameState, sourceInfo);
      if (!isValidTarget.valid) {
        return {
          valid: false,
          error: `Invalid target: ${isValidTarget.reason}`,
        };
      }
    }
    
    return { valid: true, processedSelection: targets };
  }
  
  /**
   * Check if a target ID is valid
   */
  private isValidTarget(
    targetId: string,
    targetTypes: string[],
    gameState: GameState,
    sourceInfo: {
      controllerId: string;
      colors?: readonly string[];
      objectType: 'spell' | 'ability';
      typeName?: string;
    }
  ): { valid: boolean; reason?: string } {
    // Check if it's a player
    const player = gameState.players.find(p => p.id === targetId);
    if (player) {
      if (targetTypes.includes('player') || targetTypes.includes('opponent')) {
        if (targetTypes.includes('opponent') && !targetTypes.includes('player') && targetId === sourceInfo.controllerId) {
          return { valid: false, reason: 'Target must be: opponent' };
        }

        const unrestrictedResult = canTargetPlayer(
          gameState,
          targetId,
          sourceInfo.controllerId,
          undefined,
          sourceInfo.typeName,
        );
        if (!unrestrictedResult.canTarget) {
          return {
            valid: false,
            reason: unrestrictedResult.reason || 'Player cannot be targeted by this effect',
          };
        }

        for (const colorName of this.getTargetingColorNames(sourceInfo.colors)) {
          const result = canTargetPlayer(
            gameState,
            targetId,
            sourceInfo.controllerId,
            colorName,
            sourceInfo.typeName,
          );
          if (!result.canTarget) {
            return {
              valid: false,
              reason: result.reason || 'Player cannot be targeted by this effect',
            };
          }
        }

        return { valid: true };
      }
      return { valid: false, reason: 'Players cannot be targeted by this effect' };
    }
    
    // Check if it's a permanent on the battlefield
    const permanent = this.getProcessedBattlefield(gameState).find(
      (p: BattlefieldPermanent) => p.id === targetId
    );
    
    if (permanent) {
      // Check type matching
      if (targetTypes.length === 0 || targetTypes.includes('permanent')) {
        const targetingResult = canTargetPermanent(permanent, {
          controllerId: sourceInfo.controllerId,
          colors: sourceInfo.colors,
          objectType: sourceInfo.objectType,
        });
        return targetingResult.canTarget
          ? { valid: true }
          : { valid: false, reason: targetingResult.reason || 'Permanent cannot be targeted by this effect' };
      }
      
      for (const type of targetTypes) {
        if (this.matchesPermanentTargetType(permanent, type)) {
          const targetingResult = canTargetPermanent(permanent, {
            controllerId: sourceInfo.controllerId,
            colors: sourceInfo.colors,
            objectType: sourceInfo.objectType,
          });
          return targetingResult.canTarget
            ? { valid: true }
            : { valid: false, reason: targetingResult.reason || 'Permanent cannot be targeted by this effect' };
        }
      }
      
      return {
        valid: false,
        reason: `Target must be: ${targetTypes.join(' or ')}`,
      };
    }
    
    // Check if it's a spell on the stack
    const stackItem = (gameState.stack || []).find(s => s.id === targetId);
    if (stackItem) {
      if (targetTypes.includes('spell')) {
        return { valid: true };
      }
      return { valid: false, reason: 'Spells cannot be targeted by this effect' };
    }

    const zoneCardTarget = this.findTargetCardInZones(gameState, targetId);
    if (zoneCardTarget) {
      if (targetTypes.length === 0 || targetTypes.includes('card')) {
        return { valid: true };
      }

      for (const type of targetTypes) {
        if (this.matchesCardLikeTargetType(zoneCardTarget.card, type)) {
          return { valid: true };
        }
      }

      return {
        valid: false,
        reason: `Target must be: ${targetTypes.join(' or ')}`,
      };
    }
    
    return { valid: false, reason: 'Target not found' };
  }

  private matchesTargetSelectionFilters(
    targetId: string,
    filters: SelectionFilter[],
    gameState: GameState,
    sourceInfo: {
      controllerId: string;
      colors?: readonly string[];
      objectType: 'spell' | 'ability';
      typeName?: string;
    }
  ): { valid: boolean; reason?: string } {
    if (!Array.isArray(filters) || filters.length === 0) {
      return { valid: true };
    }

    const normalizedTargetId = String(targetId || '').trim();
    const player = gameState.players.find(p => p.id === normalizedTargetId);
    const permanent = this.getProcessedBattlefield(gameState).find(
      (entry: BattlefieldPermanent) => String(entry?.id || '').trim() === normalizedTargetId
    );
    const stackItem = (gameState.stack || []).find((item: any) => String(item?.id || '').trim() === normalizedTargetId);
    const zoneCardTarget = this.findTargetCardInZones(gameState, normalizedTargetId);

    for (const filter of filters) {
      const values = Array.isArray(filter.value) ? filter.value : [filter.value];

      if (filter.type === 'controller') {
        const expected = String(values[0] || '').trim().toLowerCase();
        const targetControllerId = player
          ? normalizedTargetId
          : String(
              (permanent as any)?.controller ||
                (permanent as any)?.controllerId ||
                (stackItem as any)?.controller ||
                (stackItem as any)?.controllerId ||
                zoneCardTarget?.ownerId ||
                ''
            ).trim();

        if ((expected === 'self' || expected === 'you') && targetControllerId !== sourceInfo.controllerId) {
          return { valid: false, reason: 'target must be controlled by you' };
        }

        if (expected === 'opponent' && (!targetControllerId || targetControllerId === sourceInfo.controllerId)) {
          return { valid: false, reason: 'target must be controlled by an opponent' };
        }

        continue;
      }

      if (filter.type === 'zone') {
        const normalizedExpectedZones = values
          .map(value => this.normalizeZoneFilterValue(value))
          .filter((value: string | undefined): value is string => Boolean(value));
        const actualZone = this.normalizeZoneFilterValue(zoneCardTarget?.zone);

        if (normalizedExpectedZones.length > 0 && !actualZone) {
          return { valid: false, reason: `target must be in ${normalizedExpectedZones.join(' or ')}` };
        }

        if (normalizedExpectedZones.length > 0 && actualZone && !normalizedExpectedZones.includes(actualZone)) {
          return { valid: false, reason: `target must be in ${normalizedExpectedZones.join(' or ')}` };
        }

        continue;
      }

      const cardLike = permanent || zoneCardTarget?.card;
      if (filter.type !== 'custom' || !cardLike) {
        continue;
      }

      for (const rawValue of values) {
        const value = String(rawValue || '').trim().toLowerCase();
        if (!value) continue;

        if (value === 'nonland' && this.matchesCardLikeTargetType(cardLike, 'land')) {
          return { valid: false, reason: 'target cannot be a land' };
        }
        if (value === 'noncreature' && this.matchesCardLikeTargetType(cardLike, 'creature')) {
          return { valid: false, reason: 'target cannot be a creature' };
        }
        if (value === 'nonartifact' && this.matchesCardLikeTargetType(cardLike, 'artifact')) {
          return { valid: false, reason: 'target cannot be an artifact' };
        }
        if (value === 'nonenchantment' && this.matchesCardLikeTargetType(cardLike, 'enchantment')) {
          return { valid: false, reason: 'target cannot be an enchantment' };
        }
        if (value === 'nonplaneswalker' && this.matchesCardLikeTargetType(cardLike, 'planeswalker')) {
          return { valid: false, reason: 'target cannot be a planeswalker' };
        }
        if (value === 'attacking' && !Boolean((permanent as any)?.attacking)) {
          return { valid: false, reason: 'target must be attacking' };
        }
        if (value === 'blocking' && (!Array.isArray((permanent as any)?.blocking) || (permanent as any).blocking.length === 0)) {
          return { valid: false, reason: 'target must be blocking' };
        }
        if (value === 'blocked' && (!Array.isArray((permanent as any)?.blockedBy) || (permanent as any).blockedBy.length === 0)) {
          return { valid: false, reason: 'target must be blocked' };
        }
        if (
          value === 'unblocked' &&
          (!Boolean((permanent as any)?.attacking) || (Array.isArray((permanent as any)?.blockedBy) && (permanent as any).blockedBy.length > 0))
        ) {
          return { valid: false, reason: 'target must be unblocked' };
        }
        if (value === 'tapped' && !permanent) {
          return { valid: false, reason: 'target must be tapped' };
        }
        if (value === 'tapped' && !Boolean((permanent as any).tapped)) {
          return { valid: false, reason: 'target must be tapped' };
        }
        if (value === 'untapped' && !permanent) {
          return { valid: false, reason: 'target must be untapped' };
        }
        if (value === 'untapped' && Boolean((permanent as any).tapped)) {
          return { valid: false, reason: 'target must be untapped' };
        }
      }
    }

    return { valid: true };
  }

  private normalizeSourceColors(value: unknown): readonly string[] | undefined {
    const rawValues = Array.isArray(value)
      ? value
      : value === undefined || value === null
        ? []
        : [value];
    const out: string[] = [];
    const seen = new Set<string>();

    for (const raw of rawValues) {
      const parts = String(raw || '')
        .split(/(?:,|\/|\bor\b|\band\b)+/i)
        .map(part => part.trim())
        .filter(Boolean);

      for (const part of parts) {
        const lower = part.toLowerCase();
        const normalized =
          lower === 'w' || lower === 'white'
            ? 'W'
            : lower === 'u' || lower === 'blue'
              ? 'U'
              : lower === 'b' || lower === 'black'
                ? 'B'
                : lower === 'r' || lower === 'red'
                  ? 'R'
                  : lower === 'g' || lower === 'green'
                    ? 'G'
                    : ['W', 'U', 'B', 'R', 'G'].includes(part.toUpperCase())
                      ? part.toUpperCase()
                      : undefined;
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        out.push(normalized);
      }
    }

    return out.length > 0 ? out : undefined;
  }

  private getTargetingColorNames(colors: readonly string[] | undefined): readonly string[] {
    const out: string[] = [];

    for (const color of colors || []) {
      const colorName = color === 'W'
        ? 'white'
        : color === 'U'
          ? 'blue'
          : color === 'B'
            ? 'black'
            : color === 'R'
              ? 'red'
              : color === 'G'
                ? 'green'
                : undefined;
      if (colorName) {
        out.push(colorName);
      }
    }

    return out;
  }

  private getSourceTypeName(sourceObject: any): string | undefined {
    const typeLine = String(
      sourceObject?.card?.type_line ||
      sourceObject?.card?.cardType ||
      sourceObject?.type_line ||
      sourceObject?.cardType ||
      ''
    ).toLowerCase();
    if (typeLine.includes('instant')) return 'instant';
    if (typeLine.includes('sorcery')) return 'sorcery';
    if (typeLine.includes('creature')) return 'creature';
    if (typeLine.includes('artifact')) return 'artifact';
    if (typeLine.includes('enchantment')) return 'enchantment';
    if (typeLine.includes('planeswalker')) return 'planeswalker';
    if (typeLine.includes('battle')) return 'battle';
    if (typeLine.includes('land')) return 'land';
    return undefined;
  }

  private findDecisionSourceObject(decision: PendingDecision, gameState: GameState): any {
    const sourceId = String(decision.sourceId || '').trim();
    if (!sourceId) return undefined;

    const stackMatch = (gameState.stack || []).find((item: any) => String(item?.id || '').trim() === sourceId);
    if (stackMatch) return stackMatch;

    const battlefieldMatch = this.getProcessedBattlefield(gameState).find(
      (permanent: BattlefieldPermanent) => String(permanent?.id || '').trim() === sourceId
    ) as any;
    if (battlefieldMatch) return battlefieldMatch;

    for (const player of gameState.players || []) {
      for (const zoneName of ['hand', 'graveyard', 'exile', 'library', 'commandZone'] as const) {
        const zone = (player as any)?.[zoneName];
        if (!Array.isArray(zone)) continue;
        const match = zone.find((card: any) => String(card?.id || card?.cardId || '').trim() === sourceId);
        if (match) return match;
      }
    }

    for (const zone of Object.values((gameState as any)?.commandZone || {})) {
      if (!Array.isArray(zone)) continue;
      const match = zone.find((card: any) => String(card?.id || card?.cardId || '').trim() === sourceId);
      if (match) return match;
    }

    return undefined;
  }

  private getDecisionTargetingSourceInfo(
    decision: PendingDecision,
    gameState: GameState
  ): { controllerId: string; colors?: readonly string[]; objectType: 'spell' | 'ability'; typeName?: string } {
    const sourceObject = this.findDecisionSourceObject(decision, gameState);
    const sourceControllerId = String(
      (sourceObject as any)?.controllerId ||
      (sourceObject as any)?.controller ||
      decision.playerId ||
      ''
    ).trim() || decision.playerId;
    const colors = this.normalizeSourceColors(getColorsFromObject(sourceObject));
    const objectType = String((sourceObject as any)?.type || '').trim() === 'spell' ? 'spell' : 'ability';
    const typeName = this.getSourceTypeName(sourceObject);

    return {
      controllerId: sourceControllerId,
      ...(colors ? { colors } : {}),
      objectType,
      ...(typeName ? { typeName } : {}),
    };
  }
  
  /**
   * Validate mode selection
   */
  private validateModeSelection(
    decision: PendingDecision,
    selection: string | string[]
  ): ValidationResult {
    const modes = Array.isArray(selection) ? selection : [selection];
    const options = decision.options || [];
    const optionIds = options.map(o => o.id);
    
    // Check all selected modes are valid
    for (const mode of modes) {
      if (!optionIds.includes(mode)) {
        return { valid: false, error: `Invalid mode: ${mode}` };
      }
    }
    
    // Check count requirements
    if (decision.minSelections && modes.length < decision.minSelections) {
      return {
        valid: false,
        error: `Must select at least ${decision.minSelections} mode(s)`,
      };
    }
    
    if (decision.maxSelections && modes.length > decision.maxSelections) {
      return {
        valid: false,
        error: `Cannot select more than ${decision.maxSelections} mode(s)`,
      };
    }
    
    // Check for duplicates
    const uniqueModes = new Set(modes);
    if (uniqueModes.size !== modes.length) {
      return { valid: false, error: 'Cannot select the same mode twice' };
    }
    
    return { valid: true, processedSelection: modes };
  }
  
  /**
   * Validate X value selection
   */
  private validateXValue(
    decision: PendingDecision,
    selection: number,
    gameState: GameState
  ): ValidationResult {
    const x = Number(selection);
    
    if (isNaN(x) || !Number.isInteger(x)) {
      return { valid: false, error: 'X must be a whole number' };
    }
    
    if (decision.minX !== undefined && x < decision.minX) {
      return { valid: false, error: `X must be at least ${decision.minX}` };
    }
    
    if (decision.maxX !== undefined && x > decision.maxX) {
      return { valid: false, error: `X cannot exceed ${decision.maxX}` };
    }
    
    // Check if player can afford X mana
    // (This would need mana pool information)
    
    return { valid: true, processedSelection: x };
  }
  
  /**
   * Validate trigger ordering
   */
  private validateTriggerOrdering(
    decision: PendingDecision,
    selection: string[]
  ): ValidationResult {
    if (!Array.isArray(selection)) {
      return { valid: false, error: 'Must provide ordered list of triggers' };
    }
    
    const options = decision.options || [];
    const optionIds = options.map(o => o.id);
    
    // Check all triggers are included
    if (selection.length !== optionIds.length) {
      return { valid: false, error: 'Must order all triggers' };
    }
    
    // Check all selected are valid
    for (const id of selection) {
      if (!optionIds.includes(id)) {
        return { valid: false, error: `Invalid trigger: ${id}` };
      }
    }
    
    // Check for duplicates
    const unique = new Set(selection);
    if (unique.size !== selection.length) {
      return { valid: false, error: 'Each trigger can only appear once' };
    }
    
    return { valid: true, processedSelection: selection };
  }
  
  /**
   * Validate blocker ordering for damage assignment
   */
  private validateBlockerOrdering(
    decision: PendingDecision,
    selection: string[]
  ): ValidationResult {
    return this.validateTriggerOrdering(decision, selection);
  }
  
  /**
   * Validate attacker selection
   */
  private validateAttackerSelection(
    decision: PendingDecision,
    selection: Array<{ attackerId: string; defendingPlayer: string }>,
    gameState: GameState
  ): ValidationResult {
    if (!Array.isArray(selection)) {
      return { valid: false, error: 'Invalid attacker selection format' };
    }
    
    const battlefield = this.getProcessedBattlefield(gameState);
    const activePlayerId = gameState.players[gameState.activePlayerIndex || 0]?.id;
    
    for (const { attackerId, defendingPlayer } of selection) {
      // Check attacker exists and is controlled by active player
      const attacker = battlefield.find((p: BattlefieldPermanent) => p.id === attackerId);
      if (!attacker) {
        return { valid: false, error: `Creature ${attackerId} not found` };
      }
      
      if (attacker.controller !== activePlayerId) {
        return { valid: false, error: 'Can only attack with your own creatures' };
      }
      
      const card = attacker.card as any;
      const attackValidation = canPermanentAttack(attacker, activePlayerId, battlefield);
      if (!attackValidation.canParticipate) {
        return { valid: false, error: `${card?.name || attackerId} ${attackValidation.reason || 'cannot attack'}`.trim() };
      }
      
      // Check defending player is valid
      const defender = gameState.players.find(p => p.id === defendingPlayer);
      if (!defender) {
        return { valid: false, error: `Invalid defending player: ${defendingPlayer}` };
      }
      
      if (defendingPlayer === activePlayerId) {
        return { valid: false, error: 'Cannot attack yourself' };
      }
    }
    
    return { valid: true, processedSelection: selection };
  }
  
  /**
   * Validate blocker selection
   */
  private validateBlockerSelection(
    decision: PendingDecision,
    selection: Array<{ blockerId: string; attackerId: string }>,
    gameState: GameState
  ): ValidationResult {
    if (!Array.isArray(selection)) {
      return { valid: false, error: 'Invalid blocker selection format' };
    }
    
    const battlefield = this.getProcessedBattlefield(gameState);
    const playerId = decision.playerId;
    
    for (const { blockerId, attackerId } of selection) {
      // Check blocker exists and is controlled by this player
      const blocker = battlefield.find((p: BattlefieldPermanent) => p.id === blockerId);
      if (!blocker) {
        return { valid: false, error: `Creature ${blockerId} not found` };
      }
      
      if (blocker.controller !== playerId) {
        return { valid: false, error: 'Can only block with your own creatures' };
      }
      
      const card = blocker.card as any;
      
      // Check attacker exists and is attacking
      const attacker = battlefield.find((p: BattlefieldPermanent) => p.id === attackerId);
      if (!attacker || !attacker.attacking) {
        return { valid: false, error: `${attackerId} is not attacking` };
      }

      const blockValidation = canPermanentBlock(blocker, attacker, battlefield);
      if (!blockValidation.canParticipate) {
        return { valid: false, error: `${card?.name || blockerId} ${blockValidation.reason || 'cannot block'}`.trim() };
      }
    }
    
    return { valid: true, processedSelection: selection };
  }

  private getProcessedBattlefield(gameState: GameState): BattlefieldPermanent[] {
    return applyStaticAbilitiesToBattlefield(
      (gameState.battlefield || []) as BattlefieldPermanent[]
    ) as BattlefieldPermanent[];
  }

  private matchesPermanentTargetType(permanent: BattlefieldPermanent, type: string): boolean {
    return hasPermanentType(permanent, type);
  }

  private matchesCardLikeTargetType(cardLike: any, type: string): boolean {
    const normalizedType = String(type || '').trim().toLowerCase();
    if (!normalizedType) return false;
    if (normalizedType === 'card') return true;

    const typeLine = String(
      cardLike?.card?.type_line ||
      cardLike?.type_line ||
      cardLike?.cardType ||
      ''
    ).toLowerCase();

    if (normalizedType === 'permanent') {
      return ['artifact', 'battle', 'creature', 'enchantment', 'land', 'planeswalker'].some(candidate =>
        typeLine.includes(candidate)
      );
    }

    if ((cardLike as any)?.card) {
      return hasPermanentType(cardLike as BattlefieldPermanent, normalizedType);
    }

    return typeLine.includes(normalizedType);
  }

  private normalizeZoneFilterValue(value: unknown): string | undefined {
    const normalized = String(value || '').trim().toLowerCase().replace(/\s+/g, '');
    if (!normalized) return undefined;
    if (normalized === 'commandzone' || normalized === 'command_zone') return 'commandzone';
    return normalized;
  }

  private findTargetCardInZones(
    gameState: GameState,
    targetId: string,
  ): { card: any; zone: 'graveyard' | 'hand' | 'exile' | 'library' | 'commandZone'; ownerId: string } | undefined {
    const normalizedTargetId = String(targetId || '').trim();
    if (!normalizedTargetId) return undefined;

    for (const player of gameState.players || []) {
      const playerId = String((player as any)?.id || '').trim();
      if (!playerId) continue;

      for (const zoneName of ['hand', 'graveyard', 'exile', 'library', 'commandZone'] as const) {
        const zone = (player as any)?.[zoneName];
        if (!Array.isArray(zone)) continue;
        const match = zone.find((card: any) => String(card?.id || card?.cardId || '').trim() === normalizedTargetId);
        if (match) {
          return {
            card: match,
            zone: zoneName,
            ownerId: playerId,
          };
        }
      }
    }

    for (const [playerId, zone] of Object.entries((gameState as any)?.commandZone || {})) {
      if (!Array.isArray(zone)) continue;
      const match = zone.find((card: any) => String(card?.id || card?.cardId || '').trim() === normalizedTargetId);
      if (match) {
        return {
          card: match,
          zone: 'commandZone',
          ownerId: String(playerId || '').trim(),
        };
      }
    }

    return undefined;
  }
  
  /**
   * Validate card selection (for discard, etc.)
   */
  private validateCardSelection(
    decision: PendingDecision,
    selection: string[],
    gameState: GameState
  ): ValidationResult {
    if (!Array.isArray(selection)) {
      return { valid: false, error: 'Must select card(s)' };
    }
    
    // Check count requirements
    if (decision.minSelections && selection.length < decision.minSelections) {
      return {
        valid: false,
        error: `Must select at least ${decision.minSelections} card(s)`,
      };
    }
    
    if (decision.maxSelections && selection.length > decision.maxSelections) {
      return {
        valid: false,
        error: `Cannot select more than ${decision.maxSelections} card(s)`,
      };
    }
    
    // Validate cards exist in expected zone (usually hand)
    const player = gameState.players.find(p => p.id === decision.playerId);
    if (!player) {
      return { valid: false, error: 'Player not found' };
    }
    
    const hand = (player as any).hand || [];
    const handIds = hand.map((c: any) => c?.id || c);
    
    for (const cardId of selection) {
      if (!handIds.includes(cardId)) {
        return { valid: false, error: `Card ${cardId} not in hand` };
      }
    }
    
    return { valid: true, processedSelection: selection };
  }
  
  /**
   * Validate may ability response
   */
  private validateMayAbility(
    decision: PendingDecision,
    selection: string | boolean
  ): ValidationResult {
    const value = typeof selection === 'boolean' ? selection : selection === 'yes';
    return { valid: true, processedSelection: value };
  }
  
  /**
   * Validate option selection
   */
  private validateOptionSelection(
    decision: PendingDecision,
    selection: string
  ): ValidationResult {
    const options = decision.options || [];
    const optionIds = options.map(o => o.id);
    
    if (!optionIds.includes(selection)) {
      return { valid: false, error: 'Invalid option selected' };
    }
    
    return { valid: true, processedSelection: selection };
  }
  
  /**
   * Validate mulligan decision
   */
  private validateMulliganDecision(selection: string | boolean): ValidationResult {
    const keep = typeof selection === 'boolean' ? selection : selection === 'keep';
    return { valid: true, processedSelection: keep };
  }
  
  /**
   * Validate mulligan bottom selection
   */
  private validateMulliganBottom(
    decision: PendingDecision,
    selection: string[],
    gameState: GameState
  ): ValidationResult {
    return this.validateCardSelection(decision, selection, gameState);
  }
  
  /**
   * Handle decision timeout
   */
  private handleDecisionTimeout(gameId: string, decisionId: string): void {
    const state = this.gameDecisions.get(gameId);
    if (!state) return;
    
    const decision = state.pendingDecisions.find(d => d.id === decisionId);
    if (!decision) return;
    
    // Use default choice if available
    if (decision.defaultChoice !== undefined) {
      // Remove from pending
      state.pendingDecisions = state.pendingDecisions.filter(d => d.id !== decisionId);
      
      // Add timeout response to history
      state.decisionHistory.push({
        decisionId,
        playerId: decision.playerId,
        selection: decision.defaultChoice,
        timestamp: Date.now(),
      });
    }
    
    // Clear timeout handle
    state.timeoutHandles.delete(decisionId);
  }
  
  /**
   * Clear all decisions for a game (e.g., game ended)
   */
  clearGame(gameId: string): void {
    const state = this.gameDecisions.get(gameId);
    if (state) {
      // Clear all timeouts
      const handles = Array.from(state.timeoutHandles.values());
      for (const handle of handles) {
        clearTimeout(handle);
      }
    }
    this.gameDecisions.delete(gameId);
  }
  
  /**
   * Get or create decision state for a game
   */
  private getOrCreateState(gameId: string): DecisionState {
    let state = this.gameDecisions.get(gameId);
    if (!state) {
      state = {
        gameId,
        pendingDecisions: [],
        decisionHistory: [],
        timeoutHandles: new Map(),
      };
      this.gameDecisions.set(gameId, state);
    }
    return state;
  }
  
  /**
   * Get decision history for a game
   */
  getDecisionHistory(gameId: string): DecisionResponse[] {
    const state = this.gameDecisions.get(gameId);
    return state?.decisionHistory || [];
  }
}

/**
 * Singleton instance
 */
export const decisionManager = new DecisionManager();

export default DecisionManager;
