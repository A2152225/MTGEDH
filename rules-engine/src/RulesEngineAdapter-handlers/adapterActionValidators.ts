// Origin parent: rules-engine/src/RulesEngineAdapter.ts
// Cluster moved: validatePlayLand, validateSpellCast, validateAbilityActivation.
// Public entry symbols: validatePlayLand, validateSpellCast, validateAbilityActivation.
// Class methods become thin wrappers that call these via .call(this, ...).
// Leaf must not import RulesEngineAdapter.ts or RulesEngineAdapter-handlers/index.ts.

import type { GameState } from '../../../shared/src';
import { emptyManaPool } from '../manaAbilities';
import { applyActivatedAbilityCostReductions } from '../activatedAbilityCostReduction';
import {
  activateAbility,
  type ActivatedAbility,
  type ActivationContext,
} from '../activatedAbilities';
import { previewFutureSpellCastAdjustments } from '../futureSpellEffects';
import { validateSpellTiming } from '../spellCasting';
import { createEmptyStack, isStackEmpty as checkStackEmpty } from '../stackOperations';
import { buildTriggerEventDataFromPayloads } from '../triggeredAbilities';

/** Mirrors parent ActionValidation; wrappers stay assignable by structure. */
type ActionValidation = {
  readonly legal: boolean;
  readonly reason?: string;
  readonly requirements?: string[];
};

/** Adapter instance passed as `this` from RulesEngineAdapter thin wrappers. */
export type AdapterActionValidationHost = any;

  /**
   * Validate land play (special action)
   */
export function validatePlayLand(this: AdapterActionValidationHost, state: GameState, action: any): ActionValidation {
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
      // The server is authoritative for exile land-play permissions. Static permissions such as
      // Conduit of Worlds / Crucible of Worlds / Ramunap Excavator (and effect-based ones) are
      // not mirrored into this engine state, so accept the server's verification.
      if (action.serverVerifiedZonePermission === true) {
        return { legal: true };
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
      // The server is authoritative for graveyard land-play permissions. Static permissions such as
      // Conduit of Worlds / Crucible of Worlds / Ramunap Excavator (and effect-based ones) are
      // not mirrored into this engine state, so accept the server's verification.
      if (action.serverVerifiedZonePermission === true) {
        return { legal: true };
      }
      if (typeof until !== 'number') {
        return { legal: false, reason: 'No permission to play this land from graveyard' };
      }
      if (until < currentTurn) {
        return { legal: false, reason: 'Permission window to play from graveyard has expired' };
      }

      return { legal: true };
    }

    if (fromZone === 'library') {
      const libraryArr: any[] = Array.isArray(player.library) ? player.library : [];
      const topCard = libraryArr[0] || null;
      if (!topCard) {
        return { legal: false, reason: 'Library is empty' };
      }
      if (String(topCard?.id || topCard?.cardId || '') !== cardId) {
        return { legal: false, reason: 'Only the top card of the library can be played' };
      }

      const typeLineLower = String(topCard?.type_line || '').toLowerCase();
      if (!typeLineLower.includes('land')) return { legal: false, reason: 'Card is not a land' };
      if (!this.canPlayTopLibraryLand(state, action.playerId)) {
        return { legal: false, reason: 'No permission to play lands from the top of library' };
      }

      return { legal: true };
    }

    return { legal: false, reason: `Unsupported fromZone: ${fromZone}` };
  }
  
  /**
   * Validate spell casting
   */
export function validateSpellCast(this: AdapterActionValidationHost, state: GameState, action: any): ActionValidation {
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
    // manaAlreadyPaid: the server consumed the pool before asking the bridge to validate, so the
    // pool no longer holds the cost (and X spells never have a fixed pool total to compare with).
    if (derivedManaCostInput && !ignoresManaCost && action.manaAlreadyPaid !== true) {
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
    const futureSpellAdjustments = previewFutureSpellCastAdjustments(
      state,
      action.playerId,
      action.card || action.spell || sourceCard,
    );
    const cardTypes = this.appendFlashType(
      this.getCardTypes(action.card || action.spell || sourceCard),
      futureSpellAdjustments.grantsFlashTiming,
    );
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

    if (fromZone === 'library') {
      if (!cardId) {
        return { legal: false, reason: 'Missing cardId for library cast' };
      }

      const player = state.players.find(p => p.id === action.playerId) as any;
      if (!player) {
        return { legal: false, reason: 'Player not found' };
      }

      const libraryArr: any[] = Array.isArray(player.library) ? player.library : [];
      const topCard = libraryArr[0];
      if (!topCard) {
        return { legal: false, reason: 'Library is empty' };
      }
      if (String(topCard?.id || topCard?.cardId || '') !== cardId) {
        return { legal: false, reason: 'Only the top card of the library can be cast' };
      }

      const typeLineLower = String(topCard?.type_line || '').toLowerCase();
      if (typeLineLower.includes('land')) {
        return { legal: false, reason: 'Cannot cast a land from library' };
      }
      if (!this.canCastTopLibrarySpell(state, action.playerId, topCard)) {
        return { legal: false, reason: 'No permission to cast from the top of library' };
      }
    }

    const spellTargetHints = buildTriggerEventDataFromPayloads(
      action.playerId,
      action.targets,
      action
    );
    const selectedSpellTargets =
      Array.isArray(action.targets) && action.targets.length > 0
        ? action.targets
        : this.collectTargetIdsFromEventData(spellTargetHints);
    const spellSource = {
      ...((intrinsicGraveyardCast.entersBattlefieldTransformed
        ? this.buildTransformedCardFace(sourceCard)
        : sourceCard) || {}),
      ...(action.spell || {}),
      ...(action.card || {}),
    };
    const targetValidation = this.validateSelectedTargetsForSource(
      state,
      selectedSpellTargets,
      this.buildTargetingSourceInfo(action.playerId, spellSource, 'spell')
    );
    if (!targetValidation.legal) {
      return targetValidation;
    }
    
    return { legal: true };
  }

export function validateAbilityActivation(this: AdapterActionValidationHost, state: GameState, action: any): ActionValidation {
    const player = state.players.find(p => p.id === action.playerId);
    if (!player) {
      return { legal: false, reason: 'Player not found' };
    }

    const ability: ActivatedAbility | undefined = action.ability;
    if (!ability) {
      return { legal: false, reason: 'Ability not found' };
    }

    const activePlayerIndex = state.activePlayerIndex ?? 0;
    const priorityPlayerIndex = state.priorityPlayerIndex ?? activePlayerIndex;
    const activePlayer = state.players[activePlayerIndex] || state.players[0];
    const priorityPlayer = state.players[priorityPlayerIndex] || activePlayer;

    const activationContext: ActivationContext = {
      hasPriority: priorityPlayer?.id === action.playerId,
      isMainPhase: state.phase === 'precombatMain' || state.phase === 'postcombatMain',
      isOwnTurn: activePlayer?.id === action.playerId,
      stackEmpty: checkStackEmpty(this.stacks.get((state as any).id || '') || createEmptyStack()),
      isCombat: state.phase === 'combat',
      isUpkeep: String((state as any).step || '').trim().toLowerCase() === 'upkeep',
      activationsThisTurn: action.activationsThisTurn || 0,
      sourceTapped: action.sourceTapped || false,
    };

    if (!this.canPayActivatedAbilityAdditionalCosts(state, action.playerId, ability, action)) {
      return { legal: false, reason: 'Cannot pay required activated ability additional cost' };
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
    const activationResult = activateAbility(abilityWithReducedCost, manaPool, activationContext);
    if (!activationResult.success) {
      return {
        legal: false,
        reason: activationResult.error || 'Failed to activate ability',
      };
    }

    const abilityTargetHints = buildTriggerEventDataFromPayloads(
      action.playerId,
      ability.targets,
      action
    );
    const selectedAbilityTargets =
      Array.isArray(ability.targets) && ability.targets.length > 0
        ? ability.targets
        : this.collectTargetIdsFromEventData(abilityTargetHints);
    const targetValidation = this.validateSelectedTargetsForSource(
      state,
      selectedAbilityTargets,
      this.buildTargetingSourceInfo(
        action.playerId,
        this.getAbilitySourceObject(state, ability, action),
        'ability'
      )
    );
    if (!targetValidation.legal) {
      return targetValidation;
    }

    return { legal: true };
  }
