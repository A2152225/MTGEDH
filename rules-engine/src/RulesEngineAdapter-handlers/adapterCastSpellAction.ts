// Origin parent: rules-engine/src/RulesEngineAdapter.ts
// Cluster moved: castSpellAction.
// Public entry symbols: castSpellAction.
// Class methods become thin wrappers that call these via .call(this, ...).
// Leaf must not import RulesEngineAdapter.ts or RulesEngineAdapter-handlers/index.ts.

import type { GameState } from '../../../shared/src';
import type { EngineResult } from '../core/types';
import { RulesEngineEvent } from '../core/events';
import { checkSpellCastTriggers, checkTribalCastTriggers } from '../actions';
import { emptyManaPool } from '../manaAbilities';
import {
  consumeFutureSpellCastAdjustments,
  previewFutureSpellCastAdjustments,
} from '../futureSpellEffects';
import { consumePlayableFromExileForCard } from '../playableFromExile';
import { consumePlayableFromGraveyardForCard } from '../playableFromGraveyard';
import { castSpell, type SpellCastingContext } from '../spellCasting';
import { isStackEmpty as checkStackEmpty, pushToStack } from '../stackOperations';
import {
  buildStackTriggerMetaFromEventData,
  buildTriggerEventDataFromPayloads,
} from '../triggeredAbilities';

/** Adapter instance passed as `this` from RulesEngineAdapter thin wrappers. */
export type AdapterCastSpellActionHost = any;

  /**
   * Cast a spell (enhanced with full spell casting system)
   */
export function castSpellAction(this: AdapterCastSpellActionHost, gameId: string, action: any): EngineResult<GameState> {
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
    const manaCost = action.manaAlreadyPaid === true
      ? {}
      : (sourceCard as any)?.withoutPayingManaCost
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

    const castSource =
      intrinsicGraveyardCast.entersBattlefieldTransformed || (sourceCard as any)?.entersBattlefieldTransformed
        ? this.buildTransformedCardFace(sourceCard)
        : (sourceCard || {});
    const previewCastCard = {
      ...castSource,
      ...(action.card || {}),
      id: cardId || String(sourceCard?.id || action.card?.id || ''),
      name: String(action.cardName || action.card?.name || castSource?.name || sourceCard?.name || 'Unknown Card'),
      type_line: String(action.card?.type_line || castSource?.type_line || sourceCard?.type_line || ''),
      oracle_text: String(action.oracleText || action.card?.oracle_text || castSource?.oracle_text || sourceCard?.oracle_text || ''),
    } as any;
    const futureSpellAdjustments = previewFutureSpellCastAdjustments(state, action.playerId, previewCastCard);
    
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
    
    const derivedCardTypes = this.appendFlashType(
      Array.isArray(action.cardTypes) && action.cardTypes.length > 0
        ? action.cardTypes
        : this.getCardTypes(previewCastCard),
      futureSpellAdjustments.grantsFlashTiming,
    );

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
        } else if (fromZone === 'library') {
          const library: any[] = Array.isArray((p as any).library) ? [...(p as any).library] : [];
          if (library.length > 0 && String(library[0]?.id || library[0]?.cardId || '') === cardId) {
            library.shift();
          } else {
            next.library = library.filter(c => String(c?.id || c?.cardId || '') !== cardId);
            return next;
          }
          next.library = library;
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

    const futureSpellConsumption = consumeFutureSpellCastAdjustments(nextState, action.playerId, previewCastCard);
    nextState = futureSpellConsumption.state;
    const explicitCastSpellMetadata = this.buildCastSpellMetadata(action, sourceCard);
    const baseCastCard = {
      ...castSource,
      ...(action.card || {}),
      id: cardId || String(sourceCard?.id || action.card?.id || ''),
      name: String(action.cardName || action.card?.name || castSource?.name || sourceCard?.name || 'Unknown Card'),
      type_line: String(action.card?.type_line || castSource?.type_line || sourceCard?.type_line || ''),
      oracle_text: String(action.oracleText || action.card?.oracle_text || castSource?.oracle_text || sourceCard?.oracle_text || spellEffectText || ''),
    } as any;
    let castSpellMetadata = this.mergeCastSpellMetadata(
      explicitCastSpellMetadata,
      futureSpellConsumption.adjustments.counterImmunity,
    );
    castSpellMetadata = this.mergeCastSpellMetadata(
      castSpellMetadata,
      this.deriveTappedSourceCounterImmunity(state, action, baseCastCard)
    );
    const mergedEntryCounters = this.mergeEntryCounterMaps(
      castSpellMetadata.entersBattlefieldWithCounters,
      futureSpellConsumption.adjustments.castedPermanentEntersWithCounters,
    );
    if (mergedEntryCounters) {
      castSpellMetadata = {
        ...castSpellMetadata,
        entersBattlefieldWithCounters: mergedEntryCounters,
      };
    }
    const castCard = {
      ...baseCastCard,
      ...castSpellMetadata,
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
      ...castSpellMetadata,
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
    const existingStackObjectIds = new Set(
      (stackAfterSpell.objects || []).map(item => String((item as any)?.id || '').trim()).filter(Boolean)
    );
    const seenTriggerIdentityKeys = new Set<string>();
    const triggerStackObjects = [
      ...(Array.isArray((tribalTriggerResult.state as any)?.stack) ? ((tribalTriggerResult.state as any).stack as any[]) : []),
      ...(Array.isArray((spellTriggerResult.state as any)?.stack) ? ((spellTriggerResult.state as any).stack as any[]) : []),
    ].filter((item, index, all) => {
      const id = String((item as any)?.id || '').trim();
      if (!id || existingStackObjectIds.has(id)) {
        return false;
      }
      if (all.findIndex(candidate => String((candidate as any)?.id || '').trim() === id) !== index) {
        return false;
      }

      const type = String((item as any)?.type || '').trim().toLowerCase();
      if (type !== 'ability') {
        return true;
      }

      const triggerIdentityKey = [
        type,
        String((item as any)?.controllerId || '').trim(),
        String((item as any)?.spellId || '').trim(),
        String((item as any)?.triggerMeta?.effectText || '').trim().toLowerCase(),
        String((item as any)?.triggerMeta?.triggerFilter || '').trim().toLowerCase(),
      ].join('|');

      if (seenTriggerIdentityKeys.has(triggerIdentityKey)) {
        return false;
      }
      seenTriggerIdentityKeys.add(triggerIdentityKey);
      return true;
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
