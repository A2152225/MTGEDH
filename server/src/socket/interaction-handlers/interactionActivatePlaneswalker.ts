/**
 * Origin parent: server/src/socket/interaction.ts
 *
 * Cluster moved: activateBattlefieldAbility planeswalker loyalty abilities
 * (pw-ability-N).
 *
 * Public entry symbols: tryHandleActivatePlaneswalker.
 */

import type { PlayerID } from "../../../../shared/src/index.js";
import { appendEvent } from "../../db";
import { canPlayerBeTargetedByPlayer, matchesGraveyardCardTargetType as matchesSharedGraveyardCardTargetType, parseTargetRequirements } from "../../rules-engine/targeting.js";
import { getLoyaltyActivationLimit } from "../../state/modules/triggered-abilities";
import { triggerAbilityActivatedTriggers } from "../../state/modules/triggers/ability-activated.js";
import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";
import { debug } from "../../utils/debug.js";
import { broadcastGame, getPlayerName } from "../util";
import type { ActivateBattlefieldAbilityContext } from "./interactionActivateBattlefieldAbilityContext.js";

export async function tryHandleActivatePlaneswalker(
  ctx: ActivateBattlefieldAbilityContext,
  persistAbilityActivatedTriggerPushes: (gameId: string, game: any, triggeredAbilities: any[]) => void,
): Promise<boolean> {
  const {
    io,
    socket,
    game,
    gameId,
    pid,
    permanentId,
    abilityId,
    permanent,
    card,
    cardName,
    oracleText,
  } = ctx;

  // Handle planeswalker abilities (pw-ability-N)
  if (/^pw-ability-\d+$/i.test(abilityId)) {
    // Parse ability index
    const abilityIndex = parseInt(abilityId.replace("pw-ability-", ""), 10);
    
    // Parse the planeswalker ability from oracle text
    // Scryfall oracle text uses plain format without brackets (e.g., "+1: Effect text")
    // The pattern matches various dash characters: regular minus (-), en dash (–), em dash (—), and Unicode minus (−)
    const pwAbilityPattern = /^([+−–—-]?\d+):\s*(.+)/gm;
    const abilities: { loyaltyCost: number; text: string }[] = [];
    let pwMatch;
    while ((pwMatch = pwAbilityPattern.exec(oracleText)) !== null) {
      const costStr = pwMatch[1].replace(/[−–—]/g, '-');
      const cost = parseInt(costStr, 10);
      abilities.push({ loyaltyCost: cost, text: pwMatch[2].trim() });
    }
    
    if (abilityIndex < 0 || abilityIndex >= abilities.length) {
      socket.emit("error", {
        code: "INVALID_ABILITY",
        message: `Ability index ${abilityIndex} not found on ${cardName}`,
      });
      return true;
    }
    
    const ability = abilities[abilityIndex];
    
    // Check if this ability requires targets
    const targetReqs = parseTargetRequirements(ability.text, {
      gameState: game.state,
      controllerId: String(pid),
      sourceName: cardName,
      sourcePermanent: permanent,
    });
    
    // Get current loyalty (needed for validation)
    const currentLoyalty = (permanent as any).counters?.loyalty || 0;
    const loyaltyCost = ability.loyaltyCost;
    const loyaltyActivatedAbilityText = `${loyaltyCost >= 0 ? '+' : ''}${loyaltyCost}: ${ability.text}`;
    
    // Check if we can pay the cost BEFORE prompting for targets
    // For minus abilities, check we have enough loyalty
    if (loyaltyCost < 0 && currentLoyalty + loyaltyCost < 0) {
      socket.emit("error", {
        code: "INSUFFICIENT_LOYALTY",
        message: `${cardName} has ${currentLoyalty} loyalty, need at least ${Math.abs(loyaltyCost)} to activate this ability`,
      });
      return true;
    }
    
    // Check if planeswalker has already activated maximum abilities this turn
    // (Rule 606.3: Only one loyalty ability per turn per planeswalker, unless modified)
    // Chain Veil and Oath of Teferi allow 2 activations per turn
    // IMPORTANT: Increment the counter BEFORE checking to prevent race conditions
    // where clicking twice fast could activate the ability twice
    const activationsThisTurn = (permanent as any).loyaltyActivationsThisTurn || 0;
    const maxActivations = getLoyaltyActivationLimit(game.state, pid);
    
    if (activationsThisTurn >= maxActivations) {
      const extraText = maxActivations > 1 ? ` (max ${maxActivations} with effects)` : '';
      socket.emit("error", {
        code: "LOYALTY_ALREADY_USED",
        message: `${cardName} has already activated ${maxActivations} loyalty ability${maxActivations > 1 ? 'ies' : ''} this turn${extraText}`,
      });
      return true;
    }
    
    // Increment the activation counter immediately to prevent double-activation
    (permanent as any).loyaltyActivationsThisTurn = activationsThisTurn + 1;
    
    // If this ability requires targets, prompt for target selection
    if (targetReqs.needsTargets) {
      // Build valid target list based on target type
      let validTargets: { id: string; kind: string; name: string; isOpponent?: boolean; controller?: string; imageUrl?: string }[] = [];
      
      for (const targetType of targetReqs.targetTypes) {
        const battlefield = game.state.battlefield || [];
        const players = game.state.players || [];
        
        switch (targetType.toLowerCase()) {
          case 'creature':
            validTargets.push(...battlefield
              .filter((p: any) => {
                const typeLine = (p.card?.type_line || '').toLowerCase();
                return typeLine.includes('creature');
              })
              .map((p: any) => ({
                id: p.id,
                kind: 'permanent',
                name: p.card?.name || 'Creature',
                controller: p.controller,
                imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
              })));
            break;
          case 'permanent':
          case 'nonland':
            validTargets.push(...battlefield
              .filter((p: any) => {
                const typeLine = (p.card?.type_line || '').toLowerCase();
                if (targetType === 'nonland') return !typeLine.includes('land');
                return true;
              })
              .map((p: any) => ({
                id: p.id,
                kind: 'permanent',
                name: p.card?.name || 'Permanent',
                controller: p.controller,
                imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
              })));
            break;
          case 'player':
          case 'opponent':
            const lifeDict = game.state.life || {};
            const startingLife = game.state.startingLife || 40;
            validTargets.push(...players
              .filter((p: any) => {
                if (!p || !p.id) return false;
                if (targetType === 'opponent' && p.id === pid) return false;
                return canPlayerBeTargetedByPlayer(p.id, game.state, pid as PlayerID);
              })
              .map((p: any) => ({
                id: p.id,
                kind: 'player',
                name: p.name || p.id,
                isOpponent: p.id !== pid,
                life: lifeDict[p.id] ?? p.life ?? startingLife,
              })));
            break;
          case 'any':
            // Can target creatures, planeswalkers, or players
            validTargets.push(...battlefield
              .filter((p: any) => {
                const typeLine = (p.card?.type_line || '').toLowerCase();
                return typeLine.includes('creature') || typeLine.includes('planeswalker');
              })
              .map((p: any) => ({
                id: p.id,
                kind: 'permanent',
                name: p.card?.name || 'Permanent',
                controller: p.controller,
                imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
              })));
            // Also add players to 'any' targets
            const anyLifeDict = game.state.life || {};
            const anyStartingLife = game.state.startingLife || 40;
            validTargets.push(...players
              .filter((p: any) => p && p.id && canPlayerBeTargetedByPlayer(p.id, game.state, pid as PlayerID))
              .map((p: any) => ({
                id: p.id,
                kind: 'player',
                name: p.name || p.id,
                isOpponent: p.id !== pid,
                life: anyLifeDict[p.id] ?? p.life ?? anyStartingLife,
              })));
            break;
          case 'artifact':
          case 'enchantment':
          case 'planeswalker':
          case 'land':
            validTargets.push(...battlefield
              .filter((p: any) => {
                const typeLine = (p.card?.type_line || '').toLowerCase();
                return typeLine.includes(targetType);
              })
              .map((p: any) => ({
                id: p.id,
                kind: 'permanent',
                name: p.card?.name || targetType,
                controller: p.controller,
                imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
              })));
            break;
          default: {
            if (!targetType.startsWith('graveyard_')) {
              break;
            }
            const graveyardOwnerIds = (targetReqs.graveyardScope === 'any'
              ? players.filter((player: any) => player?.id).map((player: any) => String(player.id))
              : [String(pid)]) as string[];
            for (const ownerId of graveyardOwnerIds) {
              const graveyard = Array.isArray((game.state as any)?.zones?.[ownerId]?.graveyard)
                ? (game.state as any).zones[ownerId].graveyard
                : [];
              validTargets.push(...graveyard
                .filter((card: any) => matchesSharedGraveyardCardTargetType(card, targetType))
                .map((card: any) => ({
                  id: card.id,
                  kind: 'graveyard_card',
                  name: card.name || 'Card',
                  controller: ownerId,
                  imageUrl: card.image_uris?.small || card.image_uris?.normal,
                })));
            }
            break;
          }
        }
      }
      
      // Remove duplicates
      const uniqueTargets = validTargets.filter((t, i, arr) => 
        arr.findIndex(x => x.id === t.id) === i
      );
      
      // ========================================================================
      // Handle "up to X" abilities with no valid targets
      // If minTargets is 0 (e.g., "up to one target creature") and there are no
      // valid targets, proceed with the ability without target selection.
      // This prevents the game from hanging when abilities like Ajani Steadfast's
      // +1 are activated with no creatures on the battlefield.
      // ========================================================================
      if (uniqueTargets.length === 0 && targetReqs.minTargets === 0) {
        debug(2, `[planeswalker] ${cardName} ability has no valid targets but minTargets=0, proceeding without targets`);
        // Fall through to execute the ability without targets
      } else if (uniqueTargets.length < targetReqs.minTargets) {
        // Not enough valid targets and targeting is mandatory
        socket.emit("error", {
          code: "NO_VALID_TARGETS",
          message: `${cardName}'s ability requires at least ${targetReqs.minTargets} target(s) but only ${uniqueTargets.length} are available.`,
        });
        return true;
      } else {
        // Use Resolution Queue for target selection (unified system)
        // This replaces the legacy pendingPlaneswalkerAbility pattern
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.TARGET_SELECTION,
          playerId: pid as PlayerID,
          description: `Choose ${targetReqs.targetDescription} for ${cardName}`,
          mandatory: targetReqs.minTargets > 0,
          sourceId: permanentId,
          sourceName: cardName,
          sourceImage: (permanent as any).card?.image_uris?.small || (permanent as any).card?.image_uris?.normal,
          validTargets: uniqueTargets.map(t => ({
            id: t.id,
            name: t.name,
            type: t.kind === 'player' ? 'player' : (t.kind === 'graveyard_card' ? 'graveyard_card' : 'permanent'),
            controller: t.controller,
            imageUrl: t.imageUrl,
            life: (t as any).life,
            isOpponent: t.isOpponent,
          })),
          targetTypes: targetReqs.targetTypes,
          minTargets: targetReqs.minTargets,
          maxTargets: targetReqs.maxTargets,
          targetDescription: targetReqs.targetDescription,
          // Store planeswalker-specific data for response handler
          planeswalkerAbility: {
            abilityIndex,
            abilityText: ability.text,
            loyaltyCost,
            currentLoyalty,
          },
        });
        
        debug(2, `[planeswalker] Added TARGET_SELECTION step for ${cardName} ability: ${targetReqs.targetDescription}`);
        return true; // Wait for target selection via resolution queue
      }
    }
    
    // Apply loyalty cost and update counters
    const newLoyalty = currentLoyalty + loyaltyCost;
    (permanent as any).counters = (permanent as any).counters || {};
    (permanent as any).counters.loyalty = newLoyalty;
    (permanent as any).loyalty = newLoyalty; // Also update top-level loyalty for client display
    // Note: loyaltyActivationsThisTurn already incremented earlier to prevent race conditions
    
    // Put the loyalty ability on the stack
    const stackItem = {
      id: `ability_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'ability' as const,
      controller: pid,
      source: permanentId,
      sourceName: cardName,
      description: ability.text,
      activatedAbilityText: loyaltyActivatedAbilityText,
      planeswalker: {
        oracleId: (permanent as any)?.card?.oracle_id,
        abilityIndex,
        loyaltyCost,
      },
    } as any;
    
    game.state.stack = game.state.stack || [];
    game.state.stack.push(stackItem);
    try {
      const triggeredAbilities = triggerAbilityActivatedTriggers(game as any, {
        activatedBy: pid as any,
        sourcePermanentId: permanentId as any,
        isManaAbility: false,
        abilityText: ability.text,
        stackItemId: stackItem.id,
      });
      persistAbilityActivatedTriggerPushes(gameId, game, triggeredAbilities);
    } catch {}
    
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }
    
    appendEvent(gameId, (game as any).seq ?? 0, "activatePlaneswalkerAbility", { 
      playerId: pid, 
      permanentId, 
      abilityIndex, 
      loyaltyCost,
      newLoyalty,
      abilityText: ability.text,
      activatedAbilityText: loyaltyActivatedAbilityText,
    });
    
    const costSign = loyaltyCost >= 0 ? "+" : "";
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `⚡ ${getPlayerName(game, pid)} activated ${cardName}'s [${costSign}${loyaltyCost}] ability. (Loyalty: ${currentLoyalty} → ${newLoyalty})`,
      ts: Date.now(),
    });
    
    broadcastGame(io, game, gameId);
    return true;
  }
  

  return false;
}
