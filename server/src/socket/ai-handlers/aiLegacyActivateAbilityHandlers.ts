/**
 * Origin parent: server/src/socket/ai.ts
 *
 * Cluster moved: executeAILegacyActivateAbility.
 *
 * Public entry symbols: executeAILegacyActivateAbility.
 */
import type { Server } from "socket.io";
import type { PlayerID } from "../../../../shared/src/types.js";
import { appendEvent } from "../../db/index.js";
import { movePermanentToGraveyard } from "../../state/modules/counters_tokens.js";
import { movePermanentToHand } from "../../state/modules/zones.js";
import { parseReturnToHandCostFromManaAbilityCost } from "../../state/modules/mana-check.js";
import { syncPreparedPermanentAfterControlChange } from "../../state/modules/prepared.js";
import { debug, debugWarn, debugError } from "../../utils/debug.js";
import {
  broadcastGame,
  calculateManaProduction,
  ensureGame,
  getOrInitManaPool,
  getPlayerName,
} from "../util.js";
import { AI_MANA_ABILITY_PATTERN, AI_REACTION_DELAY_MS, COLOR_IDENTITY_MAP } from "./aiConstants.js";
import { scheduleAIPriority } from "./aiScheduler.js";
import { executePassPriority } from "./aiPriorityPassCombatExecutors.js";
import {
  applyAIManaLifeLoss,
  chooseAIManaColorForActivation,
  getAIManaProductionOptions,
} from "./aiManaCostHelpers.js";
import { getAIHandlerDeps } from "../aiHandlerDeps.js";
import { stampPermanentEntryTimestamp } from '../../../../rules-engine/src/permanentTimestamps.js';

export async function executeAILegacyActivateAbility(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  action: any,
  continueAfterResolution: boolean = true,
): Promise<void> {
  const game = ensureGame(gameId);
  if (!game) return;
  
  debug(1, '[AI] Activating ability:', { 
    gameId, 
    playerId, 
    cardName: action.cardName,
    permanentId: action.permanentId 
  });
  
  try {
    // Find the permanent on the battlefield
    const battlefield = game.state?.battlefield || [];
    const permanent = battlefield.find((p: any) => p.id === action.permanentId);
    const persistedAbilityId = getAIHandlerDeps().resolveAIActivatedAbilityId(action, permanent)
      || (typeof action?.abilityId === 'string' && action.abilityId.trim() ? action.abilityId.trim() : undefined);
    
    if (!permanent) {
      debugWarn(2, '[AI] Permanent not found for ability activation:', action.permanentId);
      return;
    }
    
    const card = permanent.card;
    // Prefer the specific ability being activated — full-card oracle falsely treats
    // Gemstone Array's charge line as a mana ability because the card also has a remove-counter mana line.
    const activatedAbilityText = String(action?.abilityText || card?.oracle_text || '').trim();
    const abilityText = activatedAbilityText.toLowerCase() || String(card?.oracle_text || '').toLowerCase();
    const tappedPermanents: string[] = [];
    let persistedAbilityType = 'generic';
    let persistedUsesStack = false;
    let persistedLifePaidForCost = 0;
    let persistedSacrificedPermanents: string[] = [];
    let persistedReturnedPermanentsToHandForCost: string[] = [];
    let persistedSearchParams: any = undefined;
    let persistedChosenOpponentId = '';
    
    // Check if this is a tap or mana ability (scoped to the activated line when available)
    const isTapAbility = /\{t\}(?:[:,]|$)/i.test(abilityText.split(':')[0] || '') || /\{t\}:/i.test(abilityText);
    const hasTargets = /target/i.test(abilityText);
    const isManaAbility = AI_MANA_ABILITY_PATTERN.test(abilityText) && !hasTargets;
    
    // Tap the permanent if it's a tap ability
    if (isTapAbility && !permanent.tapped) {
      permanent.tapped = true;
      tappedPermanents.push(String(permanent.id));
      debug(1, '[AI] Tapped permanent for ability:', card.name);
    }
    
    // Handle specific abilities based on oracle text
    
    // HUMBLE DEFECTOR: Draw two cards, give control to opponent
    if (abilityText.includes('draw two cards') && abilityText.includes('opponent') && abilityText.includes('control')) {
      persistedAbilityType = 'humble-defector';
      debug(1, '[AI] Activating Humble Defector ability');
      
      // Draw two cards
      if (typeof (game as any).drawCards === 'function') {
        const drawn = (game as any).drawCards(playerId, 2);
        debug(1, '[AI] Drew', drawn?.length || 0, 'cards from Humble Defector');
      }
      
      // Give control to a random opponent
      const opponents = (game.state?.players || [])
        .filter((p: any) => p.id !== playerId && !p.hasLost)
        .map((p: any) => p.id);
      
      if (opponents.length > 0) {
        const randomOpponent = opponents[Math.floor(Math.random() * opponents.length)];
        persistedChosenOpponentId = String(randomOpponent);
        const previousController = String(permanent.controller || '');
        permanent.controller = randomOpponent;
        syncPreparedPermanentAfterControlChange(game.state, permanent, previousController);
        
        // Reset summoning sickness for the new controller
        permanent.summoningSickness = true;
        
        debug(1, '[AI] Gave control of', card.name, 'to', randomOpponent);
        
        // Send chat message
        io.to(gameId).emit('chat', {
          id: `m_${Date.now()}`,
          gameId,
          from: 'system',
          message: `AI activated ${card.name}: drew 2 cards and gave control to opponent`,
          ts: Date.now(),
        });
      }
    }
    // GENERIC MANA/TAP ABILITY
    else if (isManaAbility || isTapAbility) {
      if (isManaAbility) {
        persistedAbilityType = 'mana';
        const costSection = abilityText.split(':')[0] || '';
        const lifeCostMatch = costSection.match(/pay\s+(\d+)\s+life/i);
        const manaCostLifePaid = lifeCostMatch ? Math.max(0, Number(lifeCostMatch[1] || 0)) : 0;
        const lowerCardName = (card.name || '').toLowerCase();
        const sacrificeSelfPattern = new RegExp(
          `sacrifice\\s+(?:~|this|it|this\\s+(?:artifact|creature|land|permanent)|${lowerCardName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`,
          'i'
        );
        const requiresSelfSacrifice = sacrificeSelfPattern.test(costSection);
        const requiresPermanentSacrifice = /sacrifice\s+(?:an?\s+|another\s+)?(?:creature|artifact|enchantment|land|permanent)/i.test(costSection);

        // Mana abilities resolve immediately - don't put on stack
        debug(1, '[AI] Tapped for mana ability (resolves immediately, not on stack):', card.name);

        if (manaCostLifePaid > 0) {
          persistedLifePaidForCost = manaCostLifePaid;
          applyAIManaLifeLoss(game, playerId, manaCostLifePaid, false);
        }

        if (requiresSelfSacrifice) {
          try {
            movePermanentToGraveyard(game as any, String(permanent.id), true);
            persistedSacrificedPermanents = [String(permanent.id)];
          } catch (err) {
            debugWarn(1, '[AI] Failed to sacrifice mana source as activation cost:', err);
          }
        } else if (requiresPermanentSacrifice) {
          const sacrificedPermanent = getAIHandlerDeps().chooseAISacrificePermanentForManaAbility(game, playerId, permanent, costSection);
          if (!sacrificedPermanent) {
            debugWarn(1, '[AI] No valid permanent available to sacrifice for mana ability:', card.name);
            if (isTapAbility && tappedPermanents.includes(String(permanent.id))) {
              permanent.tapped = false;
              tappedPermanents.length = 0;
            }
            return;
          }

          try {
            movePermanentToGraveyard(game as any, String(sacrificedPermanent.id), true);
            persistedSacrificedPermanents = [String(sacrificedPermanent.id)];
          } catch (err) {
            debugWarn(1, '[AI] Failed to sacrifice permanent for mana ability:', err);
            if (isTapAbility && tappedPermanents.includes(String(permanent.id))) {
              permanent.tapped = false;
              tappedPermanents.length = 0;
            }
            return;
          }
        }

        const producedColors = getAIManaProductionOptions(game, playerId, permanent);
        const chosenManaColor = chooseAIManaColorForActivation(game, playerId, producedColors);
        const manaProduction = calculateManaProduction(game.state, permanent, String(playerId), chosenManaColor, persistedAbilityId);
        const resolvedManaColor = String(manaProduction.colors?.[0] || chosenManaColor || 'C').toUpperCase();
        const manaPoolKey = COLOR_IDENTITY_MAP[resolvedManaColor] || 'colorless';
        const manaAmount = Math.max(0, Number(manaProduction.totalAmount || 0));
        const manaPool = getOrInitManaPool(game.state, String(playerId));
        if (manaAmount > 0) {
          (manaPool as any)[manaPoolKey] = Number((manaPool as any)[manaPoolKey] || 0) + manaAmount;
        }
        const addedMana = manaAmount > 0 ? { [manaPoolKey]: manaAmount } : undefined;

        const manaLifeEffect = getAIHandlerDeps().getAIManaLifeEffect(card, resolvedManaColor !== 'C');
        if (manaLifeEffect.amount > 0) {
          applyAIManaLifeLoss(game, playerId, manaLifeEffect.amount, manaLifeEffect.isDamage);
        }
        
        // Handle special lands that create tokens for opponents (Forbidden Orchard)
        if (lowerCardName === 'forbidden orchard') {
          // Get opponents
          const players = game.state?.players || [];
          const opponents = players.filter((p: any) => p?.id != null && p.id !== playerId && !p.hasLost);
          
          if (opponents.length > 0) {
            // AI auto-selects a random opponent for the token
            const randomOpponent = opponents[Math.floor(Math.random() * opponents.length)];
            const targetOpponentId = randomOpponent.id;
            persistedChosenOpponentId = String(targetOpponentId);
            
            // Create 1/1 colorless Spirit token for the target opponent
            const tokenId = `token_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            game.state.battlefield = game.state.battlefield || [];
            const spiritToken = {
              id: tokenId,
              controller: targetOpponentId,
              owner: targetOpponentId,
              tapped: false,
              summoningSickness: true,
              counters: {},
              card: {
                id: tokenId,
                name: 'Spirit',
                type_line: 'Token Creature — Spirit',
                oracle_text: '',
                mana_cost: '',
                cmc: 0,
                colors: [],
              },
              basePower: 1,
              baseToughness: 1,
              isToken: true,
            };
            game.state.battlefield.push(spiritToken);
            stampPermanentEntryTimestamp(game.state, game.state.battlefield[game.state.battlefield.length - 1]);
            
            debug(2, `[AI] Forbidden Orchard: created Spirit token for ${targetOpponentId}`);
            
            io.to(gameId).emit("chat", {
              id: `m_${Date.now()}`,
              gameId,
              from: "system",
              message: `Forbidden Orchard: ${getPlayerName(game, targetOpponentId)} creates a 1/1 colorless Spirit token.`,
              ts: Date.now(),
            });
          }
        }

        const returnToHandCost = parseReturnToHandCostFromManaAbilityCost(costSection);
        if (returnToHandCost) {
          const returnedPermanent = getAIHandlerDeps().chooseAIReturnToHandPermanentForManaAbility(game, playerId, permanent, costSection);
          if (!returnedPermanent) {
            debugWarn(1, '[AI] No valid permanent available to return for mana ability:', card.name);
            if (isTapAbility && tappedPermanents.includes(String(permanent.id))) {
              permanent.tapped = false;
              tappedPermanents.length = 0;
            }
            return;
          }

          try {
            const { movePermanentToHand } = await import('../../state/modules/zones.js');
            const ctx = {
              state: game.state,
              libraries: (game as any).libraries,
              bumpSeq: typeof (game as any).bumpSeq === 'function' ? (game as any).bumpSeq.bind(game) : (() => {}),
              rng: (game as any).rng,
              gameId,
              commandZone: (game.state as any).commandZone,
            } as any;

            const moved = movePermanentToHand(ctx, String(returnedPermanent.id));
            if (!moved) {
              throw new Error('movePermanentToHand returned false');
            }
            persistedReturnedPermanentsToHandForCost = [String(returnedPermanent.id)];
          } catch (err) {
            debugWarn(1, '[AI] Failed to return permanent to hand for mana ability:', err);
            if (isTapAbility && tappedPermanents.includes(String(permanent.id))) {
              permanent.tapped = false;
              tappedPermanents.length = 0;
            }
            return;
          }
        }

        try {
          if (
            persistedLifePaidForCost > 0 ||
            persistedSacrificedPermanents.length > 0 ||
            persistedReturnedPermanentsToHandForCost.length > 0
          ) {
            await appendEvent(gameId, (game as any).seq || 0, 'activateBattlefieldAbility', {
              playerId,
              permanentId: action.permanentId,
              abilityId: persistedAbilityId,
              cardName: action.cardName,
              abilityText: activatedAbilityText,
              activatedAbilityText,
              tappedPermanents,
              sacrificedPermanents: persistedSacrificedPermanents,
              returnedPermanentsToHandForCost: persistedReturnedPermanentsToHandForCost,
              removedCountersForCost: [],
              lifePaidForCost: persistedLifePaidForCost,
            });
          }

          await appendEvent(gameId, (game as any).seq || 0, 'activateManaAbility', {
            playerId,
            permanentId: action.permanentId,
            abilityId: persistedAbilityId,
            manaColor: resolvedManaColor,
            addedMana,
            lifeLost: manaLifeEffect.amount || undefined,
            lifeLossIsDamage: manaLifeEffect.amount ? manaLifeEffect.isDamage === true : undefined,
            isAI: true,
          });

          if (persistedChosenOpponentId) {
            await appendEvent(gameId, (game as any).seq || 0, 'confirmForbiddenOrchardTarget', {
              playerId,
              permanentId: action.permanentId,
              targetOpponentId: persistedChosenOpponentId,
            });
          }
        } catch (e) {
          debugWarn(1, '[AI] Failed to persist mana ability activation event:', e);
        }

        if (typeof (game as any).bumpSeq === 'function') {
          (game as any).bumpSeq();
        }

        broadcastGame(io, game, gameId);
        
        // Mana abilities don't pass priority - they resolve instantly
        // Continue AI turn after instant resolution
        if (continueAfterResolution) {
          scheduleAIPriority(io, gameId, playerId, AI_REACTION_DELAY_MS);
        }
        return;
      } else {
        // For non-mana tap abilities, put them on the stack
        persistedUsesStack = true;
        game.state.stack = game.state.stack || [];
        
        // Check if this is a fetch land ability
        // Patterns: "Search your library for a ... land card, put it onto the battlefield"
        // or "sacrifice this artifact/~, pay 1 life: search your library for a ... card"
        const isFetchLand = /search your library for a/i.test(abilityText) && 
                            /land/i.test(abilityText) && 
                            /(put it onto the battlefield|put it.*onto the battlefield)/i.test(abilityText);
        
        if (isFetchLand) {
          persistedAbilityType = 'fetch-land';
          // Check if the ability requires sacrifice using generic pattern detection
          // This handles all fetchlands including future ones by checking oracle text
          // Pattern: "sacrifice ~" or "sacrifice this" or "sacrifice it" in cost section (before colon)
          const costSection = abilityText.split(':')[0] || '';
          const requiresSacrifice = /sacrifice\s+(?:~|this|it|this land|this permanent)/i.test(costSection);
          
          // Check if ability costs life
          const lifeCostMatch = abilityText.match(/pay\s+(\d+)\s+life/i);
          const lifeCost = lifeCostMatch ? parseInt(lifeCostMatch[1], 10) : 0;
          
          // Pay the costs BEFORE adding to stack (costs are paid on activation)
          if (requiresSacrifice) {
            const moved = movePermanentToGraveyard(game as any, String(permanent.id), true);
            if (moved) {
              persistedSacrificedPermanents = [String(permanent.id)];
              debug(1, '[AI] Sacrificed fetchland as cost:', card.name);
            }
          }
          
          // Pay life cost if required
          if (lifeCost > 0) {
            const startingLife = game.state.startingLife || 40;
            const currentLife = (game.state as any).life?.[playerId] ?? startingLife;
            (game.state as any).life = (game.state as any).life || {};
            (game.state as any).life[playerId] = currentLife - lifeCost;
            persistedLifePaidForCost = lifeCost;

            // Track life lost this turn.
            try {
              (game.state as any).lifeLostThisTurn = (game.state as any).lifeLostThisTurn || {};
              (game.state as any).lifeLostThisTurn[String(playerId)] =
                ((game.state as any).lifeLostThisTurn[String(playerId)] || 0) + Number(lifeCost || 0);
            } catch {}
            debug(1, `[AI] Paid ${lifeCost} life for fetchland activation`);
          }
          
          // Detect what types of lands can be fetched
          let searchDescription = 'a basic land card';
          let landFilter: any = { types: ['land'], subtypes: ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'] };
          
          // Specific fetch land detection
          if (/plains or island/i.test(abilityText)) {
            searchDescription = 'a Plains or Island card';
            landFilter = { types: ['land'], subtypes: ['Plains', 'Island'] };
          } else if (/island or swamp/i.test(abilityText)) {
            searchDescription = 'an Island or Swamp card';
            landFilter = { types: ['land'], subtypes: ['Island', 'Swamp'] };
          } else if (/swamp or mountain/i.test(abilityText)) {
            searchDescription = 'a Swamp or Mountain card';
            landFilter = { types: ['land'], subtypes: ['Swamp', 'Mountain'] };
          } else if (/mountain or forest/i.test(abilityText)) {
            searchDescription = 'a Mountain or Forest card';
            landFilter = { types: ['land'], subtypes: ['Mountain', 'Forest'] };
          } else if (/forest or plains/i.test(abilityText)) {
            searchDescription = 'a Forest or Plains card';
            landFilter = { types: ['land'], subtypes: ['Forest', 'Plains'] };
          } else if (/basic land/i.test(abilityText)) {
            searchDescription = 'a basic land card';
            landFilter = { types: ['land', 'basic'] };
          } else if (/forest or island/i.test(abilityText)) {
            searchDescription = 'a Forest or Island card';
            landFilter = { types: ['land'], subtypes: ['Forest', 'Island'] };
          } else if (/plains or swamp/i.test(abilityText)) {
            searchDescription = 'a Plains or Swamp card';
            landFilter = { types: ['land'], subtypes: ['Plains', 'Swamp'] };
          } else if (/island or mountain/i.test(abilityText)) {
            searchDescription = 'an Island or Mountain card';
            landFilter = { types: ['land'], subtypes: ['Island', 'Mountain'] };
          } else if (/swamp or forest/i.test(abilityText)) {
            searchDescription = 'a Swamp or Forest card';
            landFilter = { types: ['land'], subtypes: ['Swamp', 'Forest'] };
          } else if (/mountain or plains/i.test(abilityText)) {
            searchDescription = 'a Mountain or Plains card';
            landFilter = { types: ['land'], subtypes: ['Mountain', 'Plains'] };
          }

          const stackItem = {
            id: `stack_ability_${Date.now()}_${permanent.id}`,
            type: 'ability',
            abilityType: 'fetch-land',
            controller: playerId,
            source: permanent.id,
            sourceName: card.name,
            description: activatedAbilityText,
            activatedAbilityText,
            card: {
              id: permanent.id,
              name: `${card.name} (ability)`,
              type_line: 'Activated Ability',
              oracle_text: card.oracle_text,
              image_uris: card.image_uris,
            },
            targets: [],
            searchParams: {
              searchDescription,
              filter: landFilter,
              maxSelections: 1,
              cardImageUrl: card.image_uris?.small || card.image_uris?.normal,
            },
          };
          persistedSearchParams = { ...(stackItem as any).searchParams };

          game.state.stack.push(stackItem as any);
          debug(1, '[AI] Added FETCH LAND ability to stack:', card.name);
        } else {
          // Regular non-mana ability
          persistedAbilityType = 'generic';
          const stackItem = {
            id: `stack_ability_${Date.now()}_${permanent.id}`,
            type: 'ability',
            controller: playerId,
            source: permanent.id,
            sourceName: card.name,
            description: activatedAbilityText,
            activatedAbilityText,
            card: {
              id: permanent.id,
              name: `${card.name} (ability)`,
              type_line: 'Activated Ability',
              oracle_text: card.oracle_text,
              image_uris: card.image_uris,
            },
            targets: [],
          };
          
          game.state.stack.push(stackItem as any);
          debug(1, '[AI] Added activated ability to stack:', card.name);
        }
      }
    }
    
    // Persist fallback activations through the shared battlefield activation surface.
    try {
      await appendEvent(gameId, (game as any).seq || 0, 'activateBattlefieldAbility', {
        playerId,
        permanentId: action.permanentId,
        abilityId: persistedAbilityId,
        cardName: action.cardName,
        abilityType: persistedAbilityType,
        abilityText: activatedAbilityText,
        activatedAbilityText,
        usesStack: persistedUsesStack,
        ...(tappedPermanents.length > 0 ? { tappedPermanents } : {}),
        ...(persistedSacrificedPermanents.length > 0 ? { sacrificedPermanents: persistedSacrificedPermanents } : {}),
        ...(persistedReturnedPermanentsToHandForCost.length > 0 ? { returnedPermanentsToHandForCost: persistedReturnedPermanentsToHandForCost } : {}),
        ...(persistedLifePaidForCost > 0 ? { lifePaidForCost: persistedLifePaidForCost } : {}),
        ...(persistedSearchParams ? { searchParams: persistedSearchParams } : {}),
        ...(persistedChosenOpponentId ? { targetOpponentId: persistedChosenOpponentId } : {}),
        isAI: true,
      });
    } catch (e) {
      debugWarn(1, '[AI] Failed to persist activateBattlefieldAbility event:', e);
    }
    
    // Bump sequence
    if (typeof (game as any).bumpSeq === 'function') {
      (game as any).bumpSeq();
    }
    
    // Broadcast updated state
    broadcastGame(io, game, gameId);
    
    // After activating ability, pass priority to allow responses
    setTimeout(async () => {
      await executePassPriority(io, gameId, playerId);
    }, AI_REACTION_DELAY_MS);
    
  } catch (error) {
    debugError(1, '[AI] Error activating ability:', error);
  }
}
