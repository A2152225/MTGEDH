/**
 * socket/resolution.ts
 * 
 * Socket handlers for the unified Resolution System.
 * Handles client interaction with the ResolutionQueueManager.
 */

import type { Server, Socket } from "socket.io";
import { 
  ResolutionQueueManager, 
  ResolutionQueueEvent,
  ResolutionStepStatus,
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
  type TargetSelectionStep,
} from "../state/resolution/index.js";
import { ensureGame, broadcastGame, getPlayerName, emitToPlayer } from "./util.js";
import { executeDeclareAttackers } from "./combat.js";
import { parsePT, uid, calculateVariablePT } from "../state/utils.js";
import { debug, debugWarn, debugError } from "../utils/debug.js";
import { handleBounceLandETB } from "./ai.js";
import { appendEvent } from "../db/index.js";
import type { PlayerID } from "../../../shared/src/types.js";
import { isShockLand } from "./land-helpers.js";
import type { GameContext } from "../state/context.js";
import { sacrificePermanent } from "../state/modules/upkeep-triggers.js";
import { permanentHasCreatureTypeNow } from "../state/creatureTypeNow.js";
import { drawCards as drawCardsFromZones } from "../state/modules/zones.js";
import { creatureHasHaste } from "./game-actions.js";
import { buildOraclePromptContext, getOracleTextFromResolutionStep } from "../utils/oraclePromptContext.js";
import { categorizeSpell, evaluateTargeting, parseTargetRequirements, type SpellSpec } from "../rules-engine/targeting";

/**
 * Handle AI player resolution steps automatically
 * This is called when a step is added to check if it's for an AI player
 */
async function handleAIResolutionStep(
  io: Server,
  gameId: string,
  step: ResolutionStep
): Promise<void> {
  try {
    const game = ensureGame(gameId);
    if (!game) return;
    
    const player = (game.state?.players || []).find((p: any) => p.id === step.playerId);
    const isAI = player && (player as any).isAI;
    
    if (!isAI) return; // Not an AI player, skip
    
    debug(2, `[Resolution] AI player ${step.playerId} auto-resolving step: ${step.type}`);
    
    let response: ResolutionStepResponse | null = null;
    
    switch (step.type) {
      case ResolutionStepType.BOUNCE_LAND_CHOICE: {
        const stepData = step as any;
        const landsToChoose = stepData.landsToChoose || [];
        
        if (landsToChoose.length === 0) {
          debugWarn(1, `[Resolution] AI bounce land choice: no lands available`);
          break;
        }
        
        // Use existing AI logic to choose which land to return
        // We need to score the lands and pick the best one to return
        const battlefield = game.state.battlefield || [];
        const playerId = step.playerId;
        const bounceLandName = stepData.bounceLandName || 'Bounce Land';
        
        // Check for landfall synergy
        const hasLandfallSynergy = battlefield.some((perm: any) => {
          if (perm.controller !== playerId) return false;
          const oracleText = (perm.card?.oracle_text || '').toLowerCase();
          return oracleText.includes('landfall') || 
                 oracleText.includes('whenever a land enters') ||
                 oracleText.includes('whenever you play a land');
        });
        
        // Score each land option
        const scoredLands = landsToChoose.map((landOption: any) => {
          const perm = battlefield.find((p: any) => p.id === landOption.permanentId);
          if (!perm) return { landOption, score: 1000 }; // Not found, don't choose
          
          let score = 50; // Base score
          const card = perm.card;
          const typeLine = (card?.type_line || '').toLowerCase();
          const permName = (card?.name || '').toLowerCase();
          
          // The bounce land itself
          if (permName === bounceLandName.toLowerCase()) {
            if (landsToChoose.length === 1) {
              score = 0; // Only option
            } else {
              score += hasLandfallSynergy ? 10 : 30;
              if (perm.tapped) score -= 10;
            }
            return { landOption, score };
          }
          
          // Basic lands are least valuable
          if (typeLine.includes('basic')) {
            score -= 30;
            if (hasLandfallSynergy) score -= 10;
          }
          
          // Tapped lands are good to return
          if (perm.tapped) score -= 10;
          
          return { landOption, score };
        });
        
        // Sort by score (lowest first = return first)
        scoredLands.sort((a: any, b: any) => a.score - b.score);
        const chosenLand = scoredLands[0]?.landOption;
        
        if (chosenLand) {
          response = {
            stepId: step.id,
            playerId: step.playerId,
            selections: chosenLand.permanentId,
            cancelled: false,
            timestamp: Date.now(),
          };
          debug(2, `[Resolution] AI chose to return land: ${chosenLand.cardName}`);
        }
        break;
      }
      
      case ResolutionStepType.JOIN_FORCES: {
        // AI declines to contribute to Join Forces (simple strategy)
        response = {
          stepId: step.id,
          playerId: step.playerId,
          selections: 0,
          cancelled: false,
          timestamp: Date.now(),
        };
        debug(2, `[Resolution] AI declines to contribute to Join Forces`);
        break;
      }
      
      case ResolutionStepType.TEMPTING_OFFER: {
        // AI declines tempting offers (simple strategy)
        response = {
          stepId: step.id,
          playerId: step.playerId,
          selections: false,
          cancelled: false,
          timestamp: Date.now(),
        };
        debug(2, `[Resolution] AI declines tempting offer`);
        break;
      }
      
      case ResolutionStepType.ACTIVATED_ABILITY: {
        // Activated abilities don't require player choice - they resolve automatically
        // Just auto-complete the step immediately
        response = {
          stepId: step.id,
          playerId: step.playerId,
          selections: true,
          cancelled: false,
          timestamp: Date.now(),
        };
        debug(2, `[Resolution] AI activated ability auto-resolving`);
        break;
      }
      
      case ResolutionStepType.LIBRARY_SEARCH: {
        // AI selects the best card(s) from the library search
        const searchStep = step as any;
        const availableCards = searchStep.availableCards || [];
        const minSelections = searchStep.minSelections || 0;
        const maxSelections = searchStep.maxSelections || 1;
        const destination = searchStep.destination || 'hand';
        const filter = searchStep.filter || {};
        
        if (availableCards.length === 0) {
          // No valid cards found - complete with empty selection
          response = {
            stepId: step.id,
            playerId: step.playerId,
            selections: [],
            cancelled: false,
            timestamp: Date.now(),
          };
          debug(2, `[Resolution] AI library search: no available cards, selecting none`);
          break;
        }
        
        // Score cards based on usefulness for AI
        const scoredCards = availableCards.map((card: any) => {
          let score = 50; // Base score
          const cmc = card.cmc || 0;
          const typeLine = (card.type_line || '').toLowerCase();
          const oracleText = (card.oracle_text || '').toLowerCase();
          const name = (card.name || '').toLowerCase();
          
          // Prefer lower CMC cards for hand/battlefield (more castable)
          if (destination === 'hand' || destination === 'battlefield') {
            score += Math.max(0, 10 - cmc);
          }
          
          // Prefer creatures for battlefield tutors
          if (destination === 'battlefield' && typeLine.includes('creature')) {
            score += 10;
          }
          
          // Prefer cards with good abilities
          if (oracleText.includes('draw') || oracleText.includes('destroy')) {
            score += 5;
          }
          
          // Prefer cards with higher power for creature-specific searches
          if (filter.maxPower !== undefined) {
            const power = card.power ? parseInt(String(card.power), 10) : 0;
            // Higher power within limit is better
            score += power * 2;
          }
          
          return { card, score };
        });
        
        // Sort by score (highest first)
        scoredCards.sort((a: any, b: any) => b.score - a.score);
        
        // Select the best cards up to maxSelections
        // If cards are available, select at least 1 (up to maxSelections), respecting minSelections
        const defaultSelection = scoredCards.length > 0 ? 1 : 0;
        const desiredSelection = Math.max(minSelections, Math.min(maxSelections, defaultSelection));
        const numToSelect = Math.min(scoredCards.length, desiredSelection);
        const selectedCardIds = scoredCards
          .slice(0, numToSelect)
          .map((sc: any) => sc.card.id);
        
        response = {
          stepId: step.id,
          playerId: step.playerId,
          selections: selectedCardIds,
          cancelled: false,
          timestamp: Date.now(),
        };
        debug(2, `[Resolution] AI library search: selected ${selectedCardIds.length} card(s) from ${availableCards.length} available`);
        break;
      }
      
      case ResolutionStepType.SCRY: {
        // AI keeps all cards on top (simple strategy - could be improved)
        const scryStep = step as any;
        const cards = scryStep.cards || [];
        
        response = {
          stepId: step.id,
          playerId: step.playerId,
          selections: {
            keepTopOrder: cards, // Keep all on top
            bottomOrder: [],     // Put none on bottom
          },
          cancelled: false,
          timestamp: Date.now(),
        };
        debug(2, `[Resolution] AI scry: keeping ${cards.length} card(s) on top`);
        break;
      }
      
      case ResolutionStepType.SURVEIL: {
        // AI puts cards to graveyard if they're lands (simple strategy)
        const surveilStep = step as any;
        const cards = surveilStep.cards || [];
        
        const keepTop: any[] = [];
        const toGraveyard: any[] = [];
        
        for (const card of cards) {
          const typeLine = (card.type_line || '').toLowerCase();
          if (typeLine.includes('land')) {
            toGraveyard.push(card);
          } else {
            keepTop.push(card);
          }
        }
        
        response = {
          stepId: step.id,
          playerId: step.playerId,
          selections: {
            keepTopOrder: keepTop,
            toGraveyard: toGraveyard,
          },
          cancelled: false,
          timestamp: Date.now(),
        };
        debug(2, `[Resolution] AI surveil: keeping ${keepTop.length} on top, ${toGraveyard.length} to graveyard`);
        break;
      }

      case ResolutionStepType.BOTTOM_ORDER: {
        const bottomStep = step as any;
        const cards = bottomStep.cards || [];

        response = {
          stepId: step.id,
          playerId: step.playerId,
          selections: {
            bottomOrder: cards,
          },
          cancelled: false,
          timestamp: Date.now(),
        };
        debug(2, `[Resolution] AI bottom_order: ordering ${cards.length} card(s) as-is`);
        break;
      }
      
      case ResolutionStepType.DISCARD_SELECTION: {
        // AI discards highest CMC cards first (keeping lower CMC for playability)
        const discardStep = step as any;
        const hand = discardStep.hand || [];
        const discardCount = discardStep.discardCount || 1;
        
        // Score cards - higher score = discard first
        const scoredHand = hand.map((card: any) => {
          const cmc = card.cmc || 0;
          const typeLine = (card.type_line || '').toLowerCase();
          let score = cmc; // Discard higher CMC first
          
          // Keep lands lower priority to discard (they're free to play)
          if (typeLine.includes('land')) {
            score -= 5;
          }
          
          return { card, score };
        });
        
        // Sort by score (highest first = discard first)
        scoredHand.sort((a: any, b: any) => b.score - a.score);
        
        const toDiscard = scoredHand
          .slice(0, discardCount)
          .map((sc: any) => sc.card.id);
        
        response = {
          stepId: step.id,
          playerId: step.playerId,
          selections: toDiscard,
          cancelled: false,
          timestamp: Date.now(),
        };
        debug(2, `[Resolution] AI discard: discarding ${toDiscard.length} card(s)`);
        break;
      }
      
      case ResolutionStepType.COMMANDER_ZONE_CHOICE: {
        // AI always sends commander back to command zone
        response = {
          stepId: step.id,
          playerId: step.playerId,
          selections: true, // Go to command zone
          cancelled: false,
          timestamp: Date.now(),
        };
        debug(2, `[Resolution] AI commander zone choice: sending to command zone`);
        break;
      }
      
      case ResolutionStepType.COLOR_CHOICE: {
        // AI chooses a random color (could be improved based on deck/situation)
        const colors = ['white', 'blue', 'black', 'red', 'green'];
        const chosenColor = colors[Math.floor(Math.random() * colors.length)];
        
        response = {
          stepId: step.id,
          playerId: step.playerId,
          selections: [chosenColor], // Wrap in array for type compatibility
          cancelled: false,
          timestamp: Date.now(),
        };
        debug(2, `[Resolution] AI color choice: chose ${chosenColor}`);
        break;
      }
      
      case ResolutionStepType.CREATURE_TYPE_CHOICE: {
        // AI chooses a common/strong creature type
        const commonTypes = ['Human', 'Soldier', 'Warrior', 'Elf', 'Goblin', 'Dragon', 'Angel'];
        const chosenType = commonTypes[Math.floor(Math.random() * commonTypes.length)];
        
        response = {
          stepId: step.id,
          playerId: step.playerId,
          selections: [chosenType], // Wrap in array for type compatibility
          cancelled: false,
          timestamp: Date.now(),
        };
        debug(2, `[Resolution] AI creature type choice: chose ${chosenType}`);
        break;
      }
      
      case ResolutionStepType.OPTION_CHOICE:
      case ResolutionStepType.MODAL_CHOICE: {
        // AI selects the first available option (simple strategy)
        const optionStep = step as any;
        const options = optionStep.options || [];
        
        if (options.length > 0) {
          const firstOption = options[0];
          const selection = firstOption.id || firstOption.value || firstOption;
          
          response = {
            stepId: step.id,
            playerId: step.playerId,
            selections: [selection], // Wrap in array for type compatibility
            cancelled: false,
            timestamp: Date.now(),
          };
          debug(2, `[Resolution] AI option/modal choice: selected first option`);
        } else {
          // No options - decline
          response = {
            stepId: step.id,
            playerId: step.playerId,
            selections: ['decline'], // Wrap in array for type compatibility
            cancelled: false,
            timestamp: Date.now(),
          };
          debug(2, `[Resolution] AI option/modal choice: no options, declining`);
        }
        break;
      }
      
      case ResolutionStepType.PLAYER_CHOICE: {
        // AI chooses a random opponent
        const activePlayers = (game.state?.players || [])
          .filter((p: any) => p.id !== step.playerId && !p.eliminated);
        
        if (activePlayers.length > 0) {
          const chosenPlayer = activePlayers[Math.floor(Math.random() * activePlayers.length)];
          response = {
            stepId: step.id,
            playerId: step.playerId,
            selections: [chosenPlayer.id], // Wrap in array for type compatibility
            cancelled: false,
            timestamp: Date.now(),
          };
          debug(2, `[Resolution] AI player choice: chose ${chosenPlayer.id}`);
        } else {
          // No valid players - this shouldn't happen but handle gracefully
          response = {
            stepId: step.id,
            playerId: step.playerId,
            selections: [step.playerId], // Wrap in array for type compatibility
            cancelled: false,
            timestamp: Date.now(),
          };
          debug(2, `[Resolution] AI player choice: no opponents, chose self`);
        }
        break;
      }
      
      case ResolutionStepType.CASCADE: {
        // AI always casts the cascade hit card if possible
        const cascadeStep = step as any;
        const hitCard = cascadeStep.hitCard;
        
        response = {
          stepId: step.id,
          playerId: step.playerId,
          selections: !!hitCard, // Cast to boolean
          cancelled: false,
          timestamp: Date.now(),
        };
        debug(2, `[Resolution] AI cascade: ${hitCard ? 'casting' : 'declining'} hit card`);
        break;
      }
      
      case ResolutionStepType.PONDER_EFFECT: {
        // AI keeps cards in original order (simple strategy)
        const ponderStep = step as any;
        const cards = ponderStep.cards || [];
        
        response = {
          stepId: step.id,
          playerId: step.playerId,
          selections: {
            newOrder: cards.map((c: any) => c.id),
            shouldShuffle: false,
          },
          cancelled: false,
          timestamp: Date.now(),
        };
        debug(2, `[Resolution] AI ponder: keeping ${cards.length} cards in original order`);
        break;
      }

      case ResolutionStepType.TWO_PILE_SPLIT: {
        const splitStep = step as any;
        const items: any[] = Array.isArray(splitStep.items) ? splitStep.items : [];

        // Simple AI: alternate items between piles.
        const pileA: string[] = [];
        const pileB: string[] = [];
        items.forEach((it: any, idx: number) => {
          const id = String(it?.id || '');
          if (!id) return;
          (idx % 2 === 0 ? pileA : pileB).push(id);
        });

        response = {
          stepId: step.id,
          playerId: step.playerId,
          selections: { pileA, pileB },
          cancelled: false,
          timestamp: Date.now(),
        };
        debug(2, `[Resolution] AI two-pile split: pileA=${pileA.length}, pileB=${pileB.length}`);
        break;
      }
      
      case ResolutionStepType.DEVOUR_SELECTION: {
        // AI doesn't sacrifice creatures for devour (conservative strategy)
        response = {
          stepId: step.id,
          playerId: step.playerId,
          selections: [], // Don't sacrifice anything
          cancelled: false,
          timestamp: Date.now(),
        };
        debug(2, `[Resolution] AI devour: not sacrificing any creatures`);
        break;
      }
      
      case ResolutionStepType.PROLIFERATE: {
        // AI proliferates all beneficial targets (own creatures with +1/+1, opponents with -1/-1 or poison)
        const proliferateStep = step as any;
        const availableTargets = proliferateStep.availableTargets || [];
        const playerId = step.playerId;
        
        const selectedTargetIds: string[] = [];
        for (const target of availableTargets) {
          const counters = target.counters || {};
          const isOwnPermanent = !target.isPlayer && target.controller === playerId;
          const isOpponentPlayer = target.isPlayer && target.id !== playerId;
          
          // Proliferate own permanents with +1/+1 counters
          if (isOwnPermanent && counters['+1/+1'] > 0) {
            selectedTargetIds.push(target.id);
            continue;
          }
          
          // Proliferate opponent players with poison counters
          if (isOpponentPlayer && counters.poison > 0) {
            selectedTargetIds.push(target.id);
            continue;
          }
          
          // Proliferate opponent permanents with -1/-1 counters
          if (!target.isPlayer && target.controller !== playerId && counters['-1/-1'] > 0) {
            selectedTargetIds.push(target.id);
            continue;
          }
        }
        
        response = {
          stepId: step.id,
          playerId: step.playerId,
          selections: selectedTargetIds,
          cancelled: false,
          timestamp: Date.now(),
        };
        debug(2, `[Resolution] AI proliferate: selected ${selectedTargetIds.length} targets`);
        break;
      }
      
      case ResolutionStepType.KYNAIOS_CHOICE: {
        // AI chooses to draw a card (simple strategy)
        const kynaiosStep = step as any;
        const isController = kynaiosStep.isController;
        const options = kynaiosStep.options || [];
        
        // Controller: prefer draw if available, otherwise decline
        // Opponent: prefer draw over giving controller benefit
        let choice = 'decline';
        if (options.includes('draw_card')) {
          choice = 'draw_card';
        } else if (options.includes('play_land') && isController) {
          // Controller might want to play land
          choice = 'decline'; // But conservative AI declines
        }
        
        response = {
          stepId: step.id,
          playerId: step.playerId,
          selections: { choice },
          cancelled: false,
          timestamp: Date.now(),
        };
        debug(2, `[Resolution] AI Kynaios choice: ${choice}`);
        break;
      }
      
      case ResolutionStepType.UPKEEP_SACRIFICE: {
        // AI must sacrifice a creature or the source
        // Strategy: Sacrifice the weakest creature if available, otherwise sacrifice the source
        const sacrificeStep = step as any;
        const creatures = sacrificeStep.creatures || [];
        const sourceToSacrifice = sacrificeStep.sourceToSacrifice;
        const allowSourceSacrifice: boolean = sacrificeStep.allowSourceSacrifice !== false;
        
        let selection: { type: 'creature' | 'source'; creatureId?: string } | undefined = allowSourceSacrifice
          ? { type: 'source' }
          : undefined;
        
        if (creatures.length > 0) {
          // Find the weakest creature (lowest combined power + toughness)
          let weakestCreature = creatures[0];
          let weakestValue = Infinity;
          
          for (const creature of creatures) {
            const power = parseInt(creature.power) || 0;
            const toughness = parseInt(creature.toughness) || 0;
            const value = power + toughness;
            if (value < weakestValue) {
              weakestValue = value;
              weakestCreature = creature;
            }
          }
          
          selection = { type: 'creature', creatureId: weakestCreature.id };
          debug(2, `[Resolution] AI upkeep sacrifice: sacrificing ${weakestCreature.name} (weakest creature)`);
        } else {
          if (allowSourceSacrifice) {
            debug(2, `[Resolution] AI upkeep sacrifice: no creatures, sacrificing ${sourceToSacrifice?.name || 'source'}`);
          } else {
            debug(2, `[Resolution] AI upkeep sacrifice: no creatures and no fallback, doing nothing`);
          }
        }
        
        response = {
          stepId: step.id,
          playerId: step.playerId,
          selections: selection ?? [],
          cancelled: false,
          timestamp: Date.now(),
        };
        break;
      }
      
      // =========================================================================
      // KEYWORD ABILITY CHOICE HANDLERS
      // =========================================================================
      
      case ResolutionStepType.RIOT_CHOICE: {
        // AI prefers haste for aggressive decks, counters for long games
        // Simple strategy: prefer counters for permanence
        response = {
          stepId: step.id,
          playerId: step.playerId,
          selections: ['counter'], // Permanent +1/+1 counter
          cancelled: false,
          timestamp: Date.now(),
        };
        debug(2, `[Resolution] AI Riot: chose +1/+1 counter`);
        break;
      }
      
      case ResolutionStepType.UNLEASH_CHOICE: {
        // AI prefers the counter (bigger creature, even if can't block)
        response = {
          stepId: step.id,
          playerId: step.playerId,
          selections: ['counter'], // +1/+1 counter (can't block)
          cancelled: false,
          timestamp: Date.now(),
        };
        debug(2, `[Resolution] AI Unleash: chose +1/+1 counter`);
        break;
      }
      
      case ResolutionStepType.FABRICATE_CHOICE: {
        // AI prefers tokens for board presence (can be blocked)
        // But counters are better for single large threat
        const fabricateStep = step as any;
        const n = fabricateStep.value || 1;
        
        // Simple heuristic: tokens if N >= 2, counter if N == 1
        const choice = n >= 2 ? 'tokens' : 'counters';
        
        response = {
          stepId: step.id,
          playerId: step.playerId,
          selections: [choice],
          cancelled: false,
          timestamp: Date.now(),
        };
        debug(2, `[Resolution] AI Fabricate ${n}: chose ${choice}`);
        break;
      }
      
      case ResolutionStepType.TRIBUTE_CHOICE: {
        // AI (as opponent) should evaluate which is worse for them
        // Simple strategy: decline tribute to avoid buffing the creature
        response = {
          stepId: step.id,
          playerId: step.playerId,
          selections: ['decline'], // Trigger the bonus effect instead of buffing
          cancelled: false,
          timestamp: Date.now(),
        };
        debug(2, `[Resolution] AI Tribute: declined (triggers bonus effect)`);
        break;
      }
      
      case ResolutionStepType.EXPLOIT_CHOICE: {
        // AI exploits the weakest creature for value
        const exploitStep = step as any;
        const creatures = exploitStep.creatures || [];
        
        if (creatures.length > 0) {
          // Find weakest creature
          let weakest = creatures[0];
          let weakestValue = Infinity;
          
          for (const creature of creatures) {
            const power = parseInt(creature.power) || 0;
            const toughness = parseInt(creature.toughness) || 0;
            const value = power + toughness;
            if (value < weakestValue) {
              weakestValue = value;
              weakest = creature;
            }
          }
          
          response = {
            stepId: step.id,
            playerId: step.playerId,
            selections: [weakest.id],
            cancelled: false,
            timestamp: Date.now(),
          };
          debug(2, `[Resolution] AI Exploit: sacrificing ${weakest.name}`);
        } else {
          // No creatures to exploit
          response = {
            stepId: step.id,
            playerId: step.playerId,
            selections: [],
            cancelled: false,
            timestamp: Date.now(),
          };
          debug(2, `[Resolution] AI Exploit: no creatures, skipping`);
        }
        break;
      }
      
      case ResolutionStepType.BACKUP_CHOICE: {
        // AI chooses another creature to give backup to (for shared abilities)
        const backupStep = step as any;
        const targets = backupStep.targets || [];
        const sourceId = backupStep.sourceId;
        
        // Prefer strongest creature that isn't the source
        const validTargets = targets.filter((t: any) => t.id !== sourceId);
        
        if (validTargets.length > 0) {
          let strongest = validTargets[0];
          let strongestValue = 0;
          
          for (const target of validTargets) {
            const power = parseInt(target.power) || 0;
            const toughness = parseInt(target.toughness) || 0;
            const value = power + toughness;
            if (value > strongestValue) {
              strongestValue = value;
              strongest = target;
            }
          }
          
          response = {
            stepId: step.id,
            playerId: step.playerId,
            selections: [strongest.id],
            cancelled: false,
            timestamp: Date.now(),
          };
          debug(2, `[Resolution] AI Backup: targeting ${strongest.name}`);
        } else {
          // Target self if no other creatures
          response = {
            stepId: step.id,
            playerId: step.playerId,
            selections: sourceId ? [sourceId] : [],
            cancelled: false,
            timestamp: Date.now(),
          };
          debug(2, `[Resolution] AI Backup: targeting self`);
        }
        break;
      }
      
      case ResolutionStepType.MENTOR_TARGET: {
        // AI targets the creature with highest base power that's still valid
        const mentorStep = step as any;
        const targets = mentorStep.targets || [];
        
        if (targets.length > 0) {
          // Target creature with lowest power (most benefit from counter)
          let best = targets[0];
          let bestValue = Infinity;
          
          for (const target of targets) {
            const power = parseInt(target.power) || 0;
            if (power < bestValue) {
              bestValue = power;
              best = target;
            }
          }
          
          response = {
            stepId: step.id,
            playerId: step.playerId,
            selections: [best.id],
            cancelled: false,
            timestamp: Date.now(),
          };
          debug(2, `[Resolution] AI Mentor: targeting ${best.name}`);
        } else {
          response = {
            stepId: step.id,
            playerId: step.playerId,
            selections: [],
            cancelled: false,
            timestamp: Date.now(),
          };
          debug(2, `[Resolution] AI Mentor: no valid targets`);
        }
        break;
      }
      
      case ResolutionStepType.ENLIST_CHOICE: {
        // AI taps creature with highest power for enlist
        const enlistStep = step as any;
        const creatures = enlistStep.creatures || [];
        
        if (creatures.length > 0) {
          let strongest = creatures[0];
          let strongestPower = 0;
          
          for (const creature of creatures) {
            const power = parseInt(creature.power) || 0;
            if (power > strongestPower) {
              strongestPower = power;
              strongest = creature;
            }
          }
          
          response = {
            stepId: step.id,
            playerId: step.playerId,
            selections: [strongest.id],
            cancelled: false,
            timestamp: Date.now(),
          };
          debug(2, `[Resolution] AI Enlist: tapping ${strongest.name} (power ${strongestPower})`);
        } else {
          response = {
            stepId: step.id,
            playerId: step.playerId,
            selections: [],
            cancelled: false,
            timestamp: Date.now(),
          };
          debug(2, `[Resolution] AI Enlist: no creatures to tap`);
        }
        break;
      }
      
      case ResolutionStepType.EXTORT_PAYMENT: {
        // AI pays for extort if they have mana (simple check)
        // In practice, this should check available mana, but conservative AI skips
        response = {
          stepId: step.id,
          playerId: step.playerId,
          selections: ['skip'], // Conservative: don't pay
          cancelled: false,
          timestamp: Date.now(),
        };
        debug(2, `[Resolution] AI Extort: skipping payment (conservative)`);
        break;
      }
      
      case ResolutionStepType.MODULAR_CHOICE: {
        // AI puts counters on strongest artifact creature
        const modularStep = step as any;
        const targets = modularStep.targets || [];
        
        if (targets.length > 0) {
          let strongest = targets[0];
          let strongestValue = 0;
          
          for (const target of targets) {
            const power = parseInt(target.power) || 0;
            const toughness = parseInt(target.toughness) || 0;
            if (power + toughness > strongestValue) {
              strongestValue = power + toughness;
              strongest = target;
            }
          }
          
          response = {
            stepId: step.id,
            playerId: step.playerId,
            selections: [strongest.id],
            cancelled: false,
            timestamp: Date.now(),
          };
          debug(2, `[Resolution] AI Modular: putting counters on ${strongest.name}`);
        } else {
          response = {
            stepId: step.id,
            playerId: step.playerId,
            selections: [],
            cancelled: false,
            timestamp: Date.now(),
          };
          debug(2, `[Resolution] AI Modular: no artifact creatures`);
        }
        break;
      }
      
      case ResolutionStepType.SOULSHIFT_TARGET: {
        // AI returns highest CMC spirit
        const soulshiftStep = step as any;
        const spirits = soulshiftStep.spirits || [];
        
        if (spirits.length > 0) {
          let best = spirits[0];
          let bestCmc = 0;
          
          for (const spirit of spirits) {
            const cmc = spirit.cmc || 0;
            if (cmc > bestCmc) {
              bestCmc = cmc;
              best = spirit;
            }
          }
          
          response = {
            stepId: step.id,
            playerId: step.playerId,
            selections: [best.id],
            cancelled: false,
            timestamp: Date.now(),
          };
          debug(2, `[Resolution] AI Soulshift: returning ${best.name}`);
        } else {
          response = {
            stepId: step.id,
            playerId: step.playerId,
            selections: [],
            cancelled: false,
            timestamp: Date.now(),
          };
          debug(2, `[Resolution] AI Soulshift: no spirits in graveyard`);
        }
        break;
      }
      
      case ResolutionStepType.KEYWORD_CHOICE: {
        // Generic keyword choice - select first option
        const kwStep = step as any;
        const options = kwStep.options || [];
        
        if (options.length > 0) {
          response = {
            stepId: step.id,
            playerId: step.playerId,
            selections: [options[0].id || options[0]],
            cancelled: false,
            timestamp: Date.now(),
          };
          debug(2, `[Resolution] AI generic keyword choice: selected first option`);
        } else {
          response = {
            stepId: step.id,
            playerId: step.playerId,
            selections: [],
            cancelled: false,
            timestamp: Date.now(),
          };
        }
        break;
      }
      
      // Default handler for any unhandled step types
      default: {
        // For any unhandled step type, attempt a generic response
        // This prevents the game from hanging indefinitely
        debugWarn(1, `[Resolution] AI has no specific handler for step type: ${step.type}, using generic decline`);
        response = {
          stepId: step.id,
          playerId: step.playerId,
          selections: [],
          cancelled: false,
          timestamp: Date.now(),
        };
        break;
      }
    }
    
    if (response) {
      // Complete the step with the AI's response
      const success = ResolutionQueueManager.completeStep(gameId, step.id, response);
      if (success) {
        // Trigger the response handler
        await handleStepResponse(io, game, gameId, step, response);
        // NOTE: Don't broadcast here - let the STEP_COMPLETED event handler broadcast
        // after exitResolutionMode has restored priority. This prevents a race condition
        // where the AI gets triggered before priority is restored.
      }
    }
  } catch (error) {
    debugError(1, `[Resolution] Error handling AI resolution step:`, error);
  }
}

/**
 * Register Resolution System socket handlers
 */
export function registerResolutionHandlers(io: Server, socket: Socket) {
  
  // =========================================================================
  // Query handlers - Get information about pending steps
  // =========================================================================
  
  /**
   * Get all pending resolution steps for a game
   */
  socket.on("getResolutionQueue", ({ gameId }: { gameId: string }) => {
    const pid = socket.data.playerId as string | undefined;
    
    const summary = ResolutionQueueManager.getPendingSummary(gameId);
    const queue = ResolutionQueueManager.getQueue(gameId);
    
    // Filter steps to only show player's own steps (for privacy)
    const visibleSteps = pid 
      ? queue.steps.filter(s => s.playerId === pid)
      : [];
    
    socket.emit("resolutionQueueState", {
      gameId,
      hasPending: summary.hasPending,
      pendingCount: summary.pendingCount,
      pendingTypes: summary.pendingTypes,
      myPendingSteps: visibleSteps,
      seq: queue.seq,
    });
  });
  
  /**
   * Get the next resolution step for the current player
   */
  socket.on("getMyNextResolutionStep", ({ gameId }: { gameId: string }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) {
      socket.emit("noResolutionStep", { gameId });
      return;
    }
    
    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, pid);
    const nextStep = steps.length > 0 ? steps[0] : undefined;
    
    if (nextStep) {
      socket.emit("resolutionStepPrompt", {
        gameId,
        step: sanitizeStepForClient(gameId, nextStep),
      });
    } else {
      socket.emit("noResolutionStep", { gameId });
    }
  });
  
  // =========================================================================
  // Action handlers - Respond to resolution steps
  // =========================================================================
  
  /**
   * Submit a response to a resolution step
   */
  socket.on("submitResolutionResponse", async ({ 
    gameId, 
    stepId, 
    selections,
    cancelled = false,
  }: { 
    gameId: string; 
    stepId: string; 
    selections: string[] | number | boolean | Record<string, any>;
    cancelled?: boolean;
  }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) {
      socket.emit("error", { code: "NOT_AUTHORIZED", message: "Not authorized to respond" });
      return;
    }
    
    const game = ensureGame(gameId);
    if (!game) {
      socket.emit("error", { code: "GAME_NOT_FOUND", message: "Game not found" });
      return;
    }
    
    // Verify the step exists and belongs to this player
    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find(s => s.id === stepId);
    
    if (!step) {
      socket.emit("error", { code: "STEP_NOT_FOUND", message: "Resolution step not found" });
      return;
    }
    
    if (step.playerId !== pid) {
      socket.emit("error", { code: "NOT_YOUR_STEP", message: "This is not your resolution step" });
      return;
    }
    
    // Create the response
    const response: ResolutionStepResponse = {
      stepId,
      playerId: pid,
      selections: selections as readonly string[] | number | boolean | Record<string, any>,
      cancelled,
      timestamp: Date.now(),
    };

    // Validate before completing the step (prevents permanently completing on invalid input)
    if (step.type === ResolutionStepType.TARGET_SELECTION && !cancelled) {
      const targetStepData = step as TargetSelectionStep;
      const rawSelections = response.selections;

      if (!Array.isArray(rawSelections) || !rawSelections.every(s => typeof s === 'string')) {
        socket.emit("error", { code: "INVALID_SELECTION", message: "Invalid target selection format" });
        return;
      }

      const selectedIds = rawSelections as string[];
      const validTargets = targetStepData.validTargets || [];
      const minTargets = targetStepData.minTargets || 0;
      const maxTargets = targetStepData.maxTargets || Infinity;

      // Disallow selecting the same target multiple times.
      const uniqueSelections = Array.from(new Set(selectedIds));
      if (uniqueSelections.length !== selectedIds.length) {
        socket.emit("error", { code: "INVALID_SELECTION", message: "Duplicate target selected" });
        return;
      }

      // Validate selection count is within bounds
      if (selectedIds.length < minTargets || selectedIds.length > maxTargets) {
        socket.emit("error", {
          code: "INVALID_SELECTION",
          message: `Invalid target count: got ${selectedIds.length}, expected ${minTargets}-${maxTargets}`,
        });
        return;
      }

      // Validate all selected targets are in valid targets list
      const validTargetIds = new Set(validTargets.map((t: any) => t.id));
      if (!selectedIds.every(id => validTargetIds.has(id))) {
        socket.emit("error", { code: "INVALID_SELECTION", message: "One or more selected targets are not valid" });
        return;
      }

      // Enforce sequential distinct-target constraint for the same sourceId when indicated.
      if (targetStepData.sourceId && stepIndicatesDifferentTarget(targetStepData)) {
        const previouslyChosen = getPreviouslyChosenTargetsForSource(gameId, targetStepData.sourceId);
        if (previouslyChosen.size > 0) {
          const distinctValidTargets = validTargets.filter((t: any) => !previouslyChosen.has(t.id));
          const enforceDistinct = distinctValidTargets.length >= minTargets;

          if (enforceDistinct) {
            const overlaps = selectedIds.filter(id => previouslyChosen.has(id));
            if (overlaps.length > 0) {
              socket.emit("error", { code: "INVALID_SELECTION", message: "Must choose a different target" });
              return;
            }
          } else {
            debugWarn(1, `[Resolution] Different-target constraint not enforceable for step ${stepId} (insufficient remaining targets)`);
          }
        }
      }
    }
    
    // Complete the step
    const completedStep = ResolutionQueueManager.completeStep(gameId, stepId, response);
    
    if (completedStep) {
      // Emit confirmation to the player
      socket.emit("resolutionStepCompleted", {
        gameId,
        stepId,
        success: true,
      });
      
      // Log the action
      debug(2, `[Resolution] Step ${stepId} completed by ${pid}: ${completedStep.type}`);
      
      // Handle the response based on step type
      await handleStepResponse(io, game, gameId, completedStep, response);
      
      // Broadcast updated game state
      broadcastGame(io, game, gameId);
      
      // Check if there are more steps for this player
      const remainingSteps = ResolutionQueueManager.getStepsForPlayer(gameId, pid);
      if (remainingSteps.length > 0) {
        socket.emit("resolutionStepPrompt", {
          gameId,
          step: sanitizeStepForClient(gameId, remainingSteps[0]),
        });
      }
    } else {
      socket.emit("error", { code: "STEP_COMPLETION_FAILED", message: "Failed to complete resolution step" });
    }
  });
  
  /**
   * Cancel/decline a resolution step (for non-mandatory steps)
   */
  socket.on("cancelResolutionStep", ({ gameId, stepId }: { gameId: string; stepId: string }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) {
      socket.emit("error", { code: "NOT_AUTHORIZED", message: "Not authorized" });
      return;
    }
    
    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find(s => s.id === stepId);
    
    if (!step) {
      socket.emit("error", { code: "STEP_NOT_FOUND", message: "Resolution step not found" });
      return;
    }
    
    if (step.playerId !== pid) {
      socket.emit("error", { code: "NOT_YOUR_STEP", message: "This is not your resolution step" });
      return;
    }

    // Some mandatory steps represent an in-progress player-initiated action (e.g. spell cast target selection)
    // and must be cancellable to avoid leaving the game in resolution mode.
    const isCancellableMandatoryStep =
      step.type === ResolutionStepType.TARGET_SELECTION &&
      Boolean((step as any)?.spellCastContext?.effectId);

    if (step.mandatory && !isCancellableMandatoryStep) {
      socket.emit("error", { code: "STEP_MANDATORY", message: "This step is mandatory and cannot be cancelled" });
      return;
    }
    
    // Cancel the step
    const cancelledStep = ResolutionQueueManager.cancelStep(gameId, stepId);
    
    if (cancelledStep) {
      socket.emit("resolutionStepCancelled", {
        gameId,
        stepId,
        success: true,
      });
      
      debug(2, `[Resolution] Step ${stepId} cancelled by ${pid}: ${cancelledStep.type}`);
      
      const game = ensureGame(gameId);
      if (game) {
        // If this cancelled step was part of an in-progress spell cast, clean up pending state
        if (cancelledStep.type === ResolutionStepType.TARGET_SELECTION) {
          const effectId =
            (cancelledStep as any)?.spellCastContext?.effectId ||
            (cancelledStep as any)?.sourceId;
          const pending = (game.state as any)?.pendingSpellCasts;
          if (effectId && pending?.[effectId]) {
            delete pending[effectId];
          }
        }
        broadcastGame(io, game, gameId);
      }
    }
  });
  
  // =========================================================================
  // Set up event forwarding from ResolutionQueueManager to Socket.IO
  // =========================================================================
  
  // This is done once per connection, forwarding queue events to the client
  const queueEventHandler = (
    event: ResolutionQueueEvent,
    eventGameId: string,
    step?: ResolutionStep,
    response?: ResolutionStepResponse
  ) => {
    // Only forward events for games this socket is in
    if (!socket.rooms.has(eventGameId)) return;
    
    switch (event) {
      case ResolutionQueueEvent.STEP_ADDED:
        if (step && step.playerId === socket.data.playerId) {
          // Only prompt if this is the player's next pending step.
          // (Avoid prompting multiple steps when a flow enqueues MODE_SELECTION + TARGET_SELECTION, etc.)
          const pid = socket.data.playerId as any;
          const steps = ResolutionQueueManager.getStepsForPlayer(eventGameId, pid);
          const nextStep = steps.length > 0 ? steps[0] : undefined;

          if (nextStep && nextStep.id === step.id) {
            socket.emit("resolutionStepPrompt", {
              gameId: eventGameId,
              step: sanitizeStepForClient(eventGameId, step),
            });
          }
        }
        break;
        
      case ResolutionQueueEvent.QUEUE_CHANGED:
        // Notify client queue has changed (for UI updates)
        const summary = ResolutionQueueManager.getPendingSummary(eventGameId);
        socket.emit("resolutionQueueChanged", {
          gameId: eventGameId,
          hasPending: summary.hasPending,
          pendingCount: summary.pendingCount,
          pendingTypes: summary.pendingTypes,
        });
        break;
    }
  };
  
  // Register the event handler
  ResolutionQueueManager.on(queueEventHandler);
  
  // Clean up when socket disconnects
  socket.on("disconnect", () => {
    ResolutionQueueManager.off(queueEventHandler);
  });
}

/**
 * Sanitize a resolution step for sending to the client
 * Removes internal data and formats for client consumption
 */
function sanitizeStepForClient(gameId: string, step: ResolutionStep): any {
  const oracleText = getOracleTextFromResolutionStep(step);
  const oracleContext = oracleText ? buildOraclePromptContext(oracleText) : undefined;

  const typeSpecificFields = getTypeSpecificFields(step);
  if (step.type === ResolutionStepType.TARGET_SELECTION) {
    const targetStep = step as TargetSelectionStep;
    const filtered = getFilteredValidTargetsForStep(gameId, targetStep);
    if (filtered !== targetStep.validTargets) {
      (typeSpecificFields as any).validTargets = filtered;
    }
  }

  return {
    id: step.id,
    type: step.type,
    playerId: step.playerId,
    description: step.description,
    mandatory: step.mandatory,
    sourceId: step.sourceId,
    sourceName: step.sourceName,
    sourceImage: step.sourceImage,
    createdAt: step.createdAt,
    timeoutMs: step.timeoutMs,
    oracleContext,
    // Include type-specific fields
    ...typeSpecificFields,
  };
}

function stepIndicatesDifferentTarget(step: TargetSelectionStep): boolean {
  if ((step as any).disallowPreviouslyChosenTargets === true) return true;

  const combinedText = `${step.targetDescription || ''} ${step.description || ''}`.toLowerCase();
  return /\b(another|different)\b/.test(combinedText);
}

function getPreviouslyChosenTargetsForSource(gameId: string, sourceId: string): Set<string> {
  const queue = ResolutionQueueManager.getQueue(gameId);
  const chosen = new Set<string>();

  for (const completed of queue.completedSteps) {
    if (completed.status !== ResolutionStepStatus.COMPLETED) continue;
    if (completed.type !== ResolutionStepType.TARGET_SELECTION) continue;
    if (completed.sourceId !== sourceId) continue;

    const respSelections = (completed.response as any)?.selections;
    if (!Array.isArray(respSelections)) continue;

    for (const id of respSelections) {
      if (typeof id === 'string' && id.length > 0) chosen.add(id);
    }
  }

  return chosen;
}

/**
 * If a TARGET_SELECTION step indicates "another" / "different" target, we can optionally
 * filter out already-chosen target ids from earlier TARGET_SELECTION steps for the same
 * sourceId. Safety fallback: if filtering would drop below minTargets, do not filter.
 */
function getFilteredValidTargetsForStep(
  gameId: string,
  step: TargetSelectionStep
): readonly any[] {
  if (!step.sourceId) return step.validTargets;
  if (!stepIndicatesDifferentTarget(step)) return step.validTargets;

  const previouslyChosen = getPreviouslyChosenTargetsForSource(gameId, step.sourceId);
  if (previouslyChosen.size === 0) return step.validTargets;

  const filtered = (step.validTargets || []).filter((t: any) => !previouslyChosen.has(t.id));
  if (filtered.length < (step.minTargets ?? 0)) return step.validTargets;
  return filtered;
}

/**
 * Initialize global AI resolution handler
 * Should be called once when server starts
 */
export function initializeAIResolutionHandler(io: Server): void {
  // Set up global handler for AI steps
  const aiHandler = (
    event: ResolutionQueueEvent,
    gameId: string,
    step?: ResolutionStep
  ) => {
    if (event === ResolutionQueueEvent.STEP_ADDED && step) {
      // Process AI steps asynchronously
      handleAIResolutionStep(io, gameId, step).catch(err => {
        debugError(1, `[Resolution] AI handler error:`, err);
      });
    }
  };
  
  ResolutionQueueManager.on(aiHandler);
  debug(1, '[Resolution] AI handler initialized');
}

/**
 * Initialize global priority management handler
 * Manages priority state during resolution per MTG Rule 608.2
 * Should be called once when server starts
 */
export function initializePriorityResolutionHandler(io: Server): void {
  // Import priority management functions
  import("../state/modules/priority.js").then(({ enterResolutionMode, exitResolutionMode }) => {
    const priorityHandler = (
      event: ResolutionQueueEvent,
      gameId: string,
      step?: ResolutionStep
    ) => {
      const game = ensureGame(gameId);
      if (!game) return;
      
      const ctx = (game as any).ctx || game;
      if (!ctx) return;
      
      // When first step is added, enter resolution mode (set priority = null)
      if (event === ResolutionQueueEvent.STEP_ADDED) {
        const summary = ResolutionQueueManager.getPendingSummary(gameId);
        // If this is the first step (count = 1), enter resolution mode
        if (summary.pendingCount === 1 && ctx.state.priority !== null) {
          enterResolutionMode(ctx);
          broadcastGame(io, game, gameId);
        }
      }
      
      // When last step completes, exit resolution mode (restore priority)
      if (event === ResolutionQueueEvent.STEP_COMPLETED) {
        const summary = ResolutionQueueManager.getPendingSummary(gameId);
        // If no more pending steps, exit resolution mode
        if (!summary.hasPending && ctx.state.priority === null) {
          exitResolutionMode(ctx);
          broadcastGame(io, game, gameId);
        }
      }

      // When a step is cancelled, we may also need to exit resolution mode.
      // This matters for workflows like spell-casting target selection where the player cancels.
      if (event === ResolutionQueueEvent.STEP_CANCELLED) {
        const summary = ResolutionQueueManager.getPendingSummary(gameId);
        if (!summary.hasPending && ctx.state.priority === null) {
          exitResolutionMode(ctx);
          broadcastGame(io, game, gameId);
        }
      }
    };
    
    ResolutionQueueManager.on(priorityHandler);
    debug(1, '[Resolution] Priority management handler initialized');
  });
}

/**
 * Get type-specific fields for a resolution step
 */
function getTypeSpecificFields(step: ResolutionStep): Record<string, any> {
  const fields: Record<string, any> = {};
  
  switch (step.type) {
    case ResolutionStepType.TARGET_SELECTION:
      if ('validTargets' in step) fields.validTargets = step.validTargets;
      if ('targetTypes' in step) fields.targetTypes = step.targetTypes;
      if ('minTargets' in step) fields.minTargets = step.minTargets;
      if ('maxTargets' in step) fields.maxTargets = step.maxTargets;
      if ('targetDescription' in step) fields.targetDescription = step.targetDescription;
      break;
      
    case ResolutionStepType.MODE_SELECTION:
      if ('modes' in step) fields.modes = step.modes;
      if ('minModes' in step) fields.minModes = step.minModes;
      if ('maxModes' in step) fields.maxModes = step.maxModes;
      if ('allowDuplicates' in step) fields.allowDuplicates = step.allowDuplicates;
      break;
      
    case ResolutionStepType.DISCARD_SELECTION:
      if ('hand' in step) fields.hand = step.hand;
      if ('discardCount' in step) fields.discardCount = step.discardCount;
      if ('currentHandSize' in step) fields.currentHandSize = step.currentHandSize;
      if ('maxHandSize' in step) fields.maxHandSize = step.maxHandSize;
      if ('reason' in step) fields.reason = step.reason;
      break;
      
    case ResolutionStepType.COMMANDER_ZONE_CHOICE:
      if ('commanderId' in step) fields.commanderId = step.commanderId;
      if ('commanderName' in step) fields.commanderName = step.commanderName;
      if ('fromZone' in step) fields.fromZone = step.fromZone;
      if ('card' in step) fields.card = step.card;
      break;
      
    case ResolutionStepType.TRIGGER_ORDER:
      if ('triggers' in step) fields.triggers = step.triggers;
      if ('requireAll' in step) fields.requireAll = step.requireAll;
      break;
      
    case ResolutionStepType.LIBRARY_SEARCH:
      if ('searchCriteria' in step) fields.searchCriteria = step.searchCriteria;
      if ('minSelections' in step) fields.minSelections = step.minSelections;
      if ('maxSelections' in step) fields.maxSelections = step.maxSelections;
      if ('destination' in step) fields.destination = step.destination;
      if ('reveal' in step) fields.reveal = step.reveal;
      if ('shuffleAfter' in step) fields.shuffleAfter = step.shuffleAfter;
      if ('remainderDestination' in step) fields.remainderDestination = step.remainderDestination;
      if ('remainderRandomOrder' in step) fields.remainderRandomOrder = step.remainderRandomOrder;
      if ('availableCards' in step) fields.availableCards = step.availableCards;
      if ('nonSelectableCards' in step) fields.nonSelectableCards = step.nonSelectableCards;
      if ('contextValue' in step) fields.contextValue = step.contextValue;
      if ('entersTapped' in step) fields.entersTapped = step.entersTapped;
      if ('filter' in step) fields.filter = (step as any).filter;
      if ('splitDestination' in step) fields.splitDestination = (step as any).splitDestination;
      if ('toBattlefield' in step) fields.toBattlefield = (step as any).toBattlefield;
      if ('toHand' in step) fields.toHand = (step as any).toHand;
      if ('lifeLoss' in step) fields.lifeLoss = (step as any).lifeLoss;
      break;
    
    case ResolutionStepType.COLOR_CHOICE:
      if ('permanentId' in step) fields.permanentId = (step as any).permanentId;
      if ('spellId' in step) fields.spellId = (step as any).spellId;
      if ('colors' in step) fields.colors = (step as any).colors;
      break;
    
    case ResolutionStepType.CREATURE_TYPE_CHOICE:
      if ('permanentId' in step) fields.permanentId = (step as any).permanentId;
      if ('cardName' in step) fields.cardName = (step as any).cardName;
      if ('reason' in step) fields.reason = (step as any).reason;
      break;
    
    case ResolutionStepType.CARD_NAME_CHOICE:
      if ('permanentId' in step) fields.permanentId = (step as any).permanentId;
      break;
    
    case ResolutionStepType.PLAYER_CHOICE:
      if ('permanentId' in step) fields.permanentId = (step as any).permanentId;
      if ('players' in step) fields.players = (step as any).players;
      if ('opponentOnly' in step) fields.opponentOnly = (step as any).opponentOnly;
      break;
      
    case ResolutionStepType.OPTION_CHOICE:
    case ResolutionStepType.MODAL_CHOICE:
      if ('options' in step) fields.options = step.options;
      if ('minSelections' in step) fields.minSelections = step.minSelections;
      if ('maxSelections' in step) fields.maxSelections = step.maxSelections;
      if ('permanentId' in step) fields.permanentId = (step as any).permanentId;
      break;
      
    case ResolutionStepType.PONDER_EFFECT:
      if ('cards' in step) fields.cards = step.cards;
      if ('variant' in step) fields.variant = step.variant;
      if ('cardCount' in step) fields.cardCount = step.cardCount;
      if ('drawAfter' in step) fields.drawAfter = step.drawAfter;
      if ('mayShuffleAfter' in step) fields.mayShuffleAfter = step.mayShuffleAfter;
      break;
      
    case ResolutionStepType.SCRY:
      if ('cards' in step) fields.cards = step.cards;
      if ('scryCount' in step) fields.scryCount = step.scryCount;
      break;
      
    case ResolutionStepType.SURVEIL:
      if ('cards' in step) fields.cards = step.cards;
      if ('surveilCount' in step) fields.surveilCount = step.surveilCount;
      break;

    case ResolutionStepType.BOTTOM_ORDER:
      if ('cards' in step) fields.cards = (step as any).cards;
      if ('shuffleAfter' in step) fields.shuffleAfter = (step as any).shuffleAfter;
      break;
      
    case ResolutionStepType.PROLIFERATE:
      if ('proliferateId' in step) fields.proliferateId = step.proliferateId;
      if ('availableTargets' in step) fields.availableTargets = step.availableTargets;
      break;
      
    case ResolutionStepType.FATESEAL:
      if ('opponentId' in step) fields.opponentId = step.opponentId;
      if ('cards' in step) fields.cards = step.cards;
      if ('fatesealCount' in step) fields.fatesealCount = step.fatesealCount;
      break;
      
    case ResolutionStepType.CLASH:
      if ('revealedCard' in step) fields.revealedCard = step.revealedCard;
      if ('opponentId' in step) fields.opponentId = step.opponentId;
      break;
      
    case ResolutionStepType.VOTE:
      if ('voteId' in step) fields.voteId = step.voteId;
      if ('choices' in step) fields.choices = step.choices;
      if ('votesSubmitted' in step) fields.votesSubmitted = step.votesSubmitted;
      break;

    case ResolutionStepType.TWO_PILE_SPLIT:
      if ('items' in step) fields.items = (step as any).items;
      if ('minPerPile' in step) fields.minPerPile = (step as any).minPerPile;
      break;
      
    case ResolutionStepType.KYNAIOS_CHOICE:
      if ('isController' in step) fields.isController = step.isController;
      if ('sourceController' in step) fields.sourceController = step.sourceController;
      if ('canPlayLand' in step) fields.canPlayLand = step.canPlayLand;
      if ('landsInHand' in step) fields.landsInHand = step.landsInHand;
      if ('options' in step) fields.options = step.options;
      break;
      
    case ResolutionStepType.JOIN_FORCES:
      if ('cardName' in step) fields.cardName = step.cardName;
      if ('effectDescription' in step) fields.effectDescription = step.effectDescription;
      if ('cardImageUrl' in step) fields.cardImageUrl = step.cardImageUrl;
      if ('initiator' in step) fields.initiator = step.initiator;
      if ('availableMana' in step) fields.availableMana = step.availableMana;
      if ('isInitiator' in step) fields.isInitiator = step.isInitiator;
      break;
      
    case ResolutionStepType.TEMPTING_OFFER:
      if ('cardName' in step) fields.cardName = step.cardName;
      if ('effectDescription' in step) fields.effectDescription = step.effectDescription;
      if ('cardImageUrl' in step) fields.cardImageUrl = step.cardImageUrl;
      if ('initiator' in step) fields.initiator = step.initiator;
      if ('isOpponent' in step) fields.isOpponent = step.isOpponent;
      break;
      
    case ResolutionStepType.BOUNCE_LAND_CHOICE:
      if ('bounceLandId' in step) fields.bounceLandId = step.bounceLandId;
      if ('bounceLandName' in step) fields.bounceLandName = step.bounceLandName;
      if ('landsToChoose' in step) fields.landsToChoose = step.landsToChoose;
      if ('stackItemId' in step) fields.stackItemId = step.stackItemId;
      break;
      
    case ResolutionStepType.CASCADE:
      if ('cascadeNumber' in step) fields.cascadeNumber = step.cascadeNumber;
      if ('totalCascades' in step) fields.totalCascades = step.totalCascades;
      if ('manaValue' in step) fields.manaValue = step.manaValue;
      if ('hitCard' in step) fields.hitCard = step.hitCard;
      if ('exiledCards' in step) fields.exiledCards = step.exiledCards;
      if ('effectId' in step) fields.effectId = step.effectId;
      break;
      
    case ResolutionStepType.DEVOUR_SELECTION:
      if ('devourValue' in step) fields.devourValue = step.devourValue;
      if ('creatureId' in step) fields.creatureId = step.creatureId;
      if ('creatureName' in step) fields.creatureName = step.creatureName;
      if ('availableCreatures' in step) fields.availableCreatures = step.availableCreatures;
      break;
      
    case ResolutionStepType.SUSPEND_CAST:
      if ('card' in step) fields.card = step.card;
      if ('suspendCost' in step) fields.suspendCost = step.suspendCost;
      if ('timeCounters' in step) fields.timeCounters = step.timeCounters;
      break;
      
    case ResolutionStepType.MORPH_TURN_FACE_UP:
      if ('permanentId' in step) fields.permanentId = step.permanentId;
      if ('morphCost' in step) fields.morphCost = step.morphCost;
      if ('actualCard' in step) fields.actualCard = step.actualCard;
      if ('canAfford' in step) fields.canAfford = step.canAfford;
      break;
      
    case ResolutionStepType.ACTIVATED_ABILITY:
      if ('permanentId' in step) fields.permanentId = step.permanentId;
      if ('permanentName' in step) fields.permanentName = step.permanentName;
      if ('abilityType' in step) fields.abilityType = step.abilityType;
      if ('abilityDescription' in step) fields.abilityDescription = step.abilityDescription;
      if ('targets' in step) fields.targets = step.targets;
      if ('xValue' in step) fields.xValue = step.xValue;
      if ('abilityData' in step) fields.abilityData = step.abilityData;
      break;
      
    case ResolutionStepType.UPKEEP_SACRIFICE:
      if ('hasCreatures' in step) fields.hasCreatures = step.hasCreatures;
      if ('creatures' in step) fields.creatures = step.creatures;
      if ('sourceToSacrifice' in step) fields.sourceToSacrifice = step.sourceToSacrifice;
      if ('alternativeSacrificeType' in step) fields.alternativeSacrificeType = step.alternativeSacrificeType;
      if ('allowSourceSacrifice' in step) fields.allowSourceSacrifice = (step as any).allowSourceSacrifice;
      break;
  }
  
  return fields;
}

/**
 * Handle the response to a completed resolution step
 * This executes the game logic based on the player's choice
 */
async function handleStepResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): Promise<void> {
  if (response.cancelled) {
    // Step was cancelled - no action needed
    return;
  }
  
  const pid = response.playerId;
  
  switch (step.type) {
    case ResolutionStepType.MODE_SELECTION: {
      const selected = (response.selections as any);
      const selectedMode = Array.isArray(selected) ? selected[0] : selected;

      // Attach selected mode to the next target selection step (same source/effect), if present.
      // This allows the client to show the chosen mode and do mode-aware highlighting.
      try {
        const queue = ResolutionQueueManager.getQueue(gameId);
        const modeOption = Array.isArray((step as any).modes)
          ? ((step as any).modes as any[]).find(m => String(m.id) === String(selectedMode))
          : undefined;

        const modeText = `${modeOption?.description || ''}`.toLowerCase();
        const modeLabel = String(modeOption?.label || '').trim();

        const buildChoiceOptionsFromTargetRefs = (refs: any[]): any[] => {
          return refs
            .map((t: any) => {
              if (t?.kind === 'permanent') {
                const perm = (game.state.battlefield || []).find((p: any) => p.id === t.id);
                if (!perm) return null;
                return {
                  id: t.id,
                  label: perm?.card?.name || 'Unknown',
                  description: 'permanent',
                  imageUrl: perm?.card?.image_uris?.small || perm?.card?.image_uris?.normal,
                  type: 'permanent',
                  controller: perm?.controller,
                  tapped: perm?.tapped === true,
                  typeLine: perm?.card?.type_line,
                  keywords: Array.isArray((perm?.card as any)?.keywords) ? (perm?.card as any).keywords : undefined,
                  oracleText: (perm?.card as any)?.oracle_text,
                  colors: (perm?.card as any)?.colors,
                  colorIdentity: (perm?.card as any)?.color_identity,
                  cmc: Number((perm?.card as any)?.cmc ?? 0),
                  isToken: perm?.isToken === true,
                  isOpponent: perm?.controller !== pid,
                };
              }

              if (t?.kind === 'stack') {
                const stackItem = ((game.state as any).stack || []).find((s: any) => s.id === t.id);
                if (!stackItem) return null;
                return {
                  id: t.id,
                  label: stackItem?.card?.name || 'Unknown',
                  description: stackItem?.type || 'spell',
                  imageUrl: stackItem?.card?.image_uris?.small || stackItem?.card?.image_uris?.normal,
                  // Client treats stack targets best as 'card' for mode heuristics.
                  type: 'card',
                  controller: stackItem?.controller,
                  typeLine: stackItem?.card?.type_line,
                  keywords: Array.isArray((stackItem?.card as any)?.keywords) ? (stackItem?.card as any).keywords : undefined,
                  oracleText: (stackItem?.card as any)?.oracle_text,
                  colors: (stackItem?.card as any)?.colors,
                  colorIdentity: (stackItem?.card as any)?.color_identity,
                  cmc: Number((stackItem?.card as any)?.cmc ?? 0),
                  isOpponent: stackItem?.controller !== pid,
                };
              }

              if (t?.kind === 'player') {
                const player = (game.state.players || []).find((p: any) => p.id === t.id);
                return {
                  id: t.id,
                  label: player?.name || t.id,
                  description: 'player',
                  type: 'player',
                  life: player?.life,
                  isOpponent: t.id !== pid,
                };
              }

              return null;
            })
            .filter(Boolean);
        };

        const buildSpellSpecFromTargetRequirements = (oracle: string, reqs: any, minTargets: number, maxTargets: number): SpellSpec | null => {
          if (!reqs?.needsTargets) return null;

          const targetTypes = Array.isArray(reqs.targetTypes) ? reqs.targetTypes.map((x: any) => String(x).toLowerCase()) : [];
          const text = String(oracle || '').toLowerCase();

          // Stack-targeting.
          if (targetTypes.includes('spell')) {
            let spellTypeFilter: any = 'ANY_SPELL';
            if (/counter target noncreature spell/.test(text)) spellTypeFilter = 'NONCREATURE';
            else if (/counter target creature spell/.test(text)) spellTypeFilter = 'CREATURE_SPELL';
            else if (/counter target instant or sorcery/.test(text) || /counter target instant or sorcery spell/.test(text)) spellTypeFilter = 'INSTANT_SORCERY';
            return {
              op: 'COUNTER_TARGET_SPELL',
              filter: 'ANY',
              minTargets,
              maxTargets,
              targetDescription: reqs.targetDescription || 'target spell',
              spellTypeFilter,
            };
          }
          if (targetTypes.includes('ability')) {
            return {
              op: 'COUNTER_TARGET_ABILITY',
              filter: 'ANY',
              minTargets,
              maxTargets,
              targetDescription: reqs.targetDescription || 'target ability',
            };
          }

          // "Any target".
          if (targetTypes.includes('any') || /\bany\s+target\b/.test(text)) {
            return {
              op: 'ANY_TARGET_DAMAGE',
              filter: 'ANY',
              minTargets,
              maxTargets,
              targetDescription: reqs.targetDescription || 'any target',
            };
          }

          // Multi-type permanent targets.
          // Atraxa's Fall style: "artifact, battle, enchantment, or creature with flying"
          if (/artifact,?\s+battle,?\s+enchantment,?\s+or\s+creature\s+with\s+flying/.test(text)) {
            return {
              op: 'TARGET_PERMANENT',
              filter: 'ARTIFACT',
              minTargets,
              maxTargets,
              targetDescription: reqs.targetDescription || 'target artifact, battle, enchantment, or creature with flying',
              multiFilter: ['ARTIFACT', 'PERMANENT', 'ENCHANTMENT', 'CREATURE'],
              creatureRestriction: { type: 'has_keyword', description: 'with flying', keyword: 'flying' },
            };
          }

          if (/(\bartifact\b\s+or\s+\benchantment\b)/.test(text)) {
            return {
              op: 'TARGET_PERMANENT',
              filter: 'PERMANENT',
              minTargets,
              maxTargets,
              targetDescription: reqs.targetDescription || 'target artifact or enchantment',
              multiFilter: ['ARTIFACT', 'ENCHANTMENT'],
            };
          }

          // Generic comma-list OR patterns (best-effort).
          // Examples: "target artifact, enchantment, or planeswalker"; "target artifact, battle, or creature".
          if (/\btarget\b/.test(text) && /,\s*.*\bor\b/.test(text) && /\b(artifact|enchantment|battle|creature|planeswalker|land|permanent)\b/.test(text)) {
            const filters: any[] = [];
            if (text.includes('artifact')) filters.push('ARTIFACT');
            if (text.includes('enchantment')) filters.push('ENCHANTMENT');
            if (text.includes('planeswalker')) filters.push('PLANESWALKER');
            if (text.includes('land')) filters.push('LAND');
            if (text.includes('battle')) filters.push('PERMANENT');
            if (text.includes('creature')) filters.push('CREATURE');
            if (text.includes('permanent')) filters.push('PERMANENT');

            const unique = Array.from(new Set(filters));
            if (unique.length >= 2) {
              // If mode text includes "creature with <keyword>", apply restriction only to creatures.
              const creatureKeywordMatch = text.match(/creature\s+with\s+(flying|reach|trample)/);
              const creatureRestriction = creatureKeywordMatch
                ? ({ type: 'has_keyword', description: `with ${creatureKeywordMatch[1]}`, keyword: creatureKeywordMatch[1] } as any)
                : undefined;
              return {
                op: 'TARGET_PERMANENT',
                filter: unique[0] || 'PERMANENT',
                minTargets,
                maxTargets,
                targetDescription: reqs.targetDescription || 'target permanent',
                multiFilter: unique as any,
                ...(creatureRestriction ? { creatureRestriction } : {}),
              };
            }
          }

          // Single-type permanent targets.
          if (targetTypes.some((t: string) => t.includes('creature'))) {
            return { op: 'TARGET_CREATURE', filter: 'CREATURE', minTargets, maxTargets, targetDescription: reqs.targetDescription || 'target creature' };
          }
          if (targetTypes.some((t: string) => t.includes('planeswalker'))) {
            return { op: 'TARGET_PERMANENT', filter: 'PLANESWALKER', minTargets, maxTargets, targetDescription: reqs.targetDescription || 'target planeswalker' };
          }
          if (targetTypes.some((t: string) => t.includes('artifact'))) {
            return { op: 'TARGET_PERMANENT', filter: 'ARTIFACT', minTargets, maxTargets, targetDescription: reqs.targetDescription || 'target artifact' };
          }
          if (targetTypes.some((t: string) => t.includes('enchantment'))) {
            return { op: 'TARGET_PERMANENT', filter: 'ENCHANTMENT', minTargets, maxTargets, targetDescription: reqs.targetDescription || 'target enchantment' };
          }
          if (targetTypes.some((t: string) => t.includes('land'))) {
            return { op: 'TARGET_PERMANENT', filter: 'LAND', minTargets, maxTargets, targetDescription: reqs.targetDescription || 'target land' };
          }
          if (targetTypes.some((t: string) => t.includes('nonland'))) {
            // Engine doesn't have a dedicated nonland filter; we'll post-filter by typeLine.
            return { op: 'TARGET_PERMANENT', filter: 'PERMANENT', minTargets, maxTargets, targetDescription: reqs.targetDescription || 'target nonland permanent' };
          }
          if (targetTypes.some((t: string) => t.includes('noncreature'))) {
            // Engine doesn't have a dedicated noncreature permanent filter; we'll post-filter by typeLine.
            return { op: 'TARGET_PERMANENT', filter: 'PERMANENT', minTargets, maxTargets, targetDescription: reqs.targetDescription || 'target noncreature permanent' };
          }
          if (targetTypes.some((t: string) => t.includes('permanent'))) {
            return { op: 'TARGET_PERMANENT', filter: 'PERMANENT', minTargets, maxTargets, targetDescription: reqs.targetDescription || 'target permanent' };
          }

          return null;
        };

        const applyModeRestrictionsToSpec = (spec: SpellSpec, modeTextRaw: string): SpellSpec => {
          const text = String(modeTextRaw || '').toLowerCase();
          let next: SpellSpec = { ...spec };

          // "Another target" patterns: this mostly matters for permanent-sourced abilities.
          // In engine terms, excludeSource means the source permanent itself can't be chosen as a target.
          if (!next.excludeSource && /\banother\s+target\s+(?:creature|permanent|artifact|enchantment|land|planeswalker)\b/.test(text)) {
            next = { ...next, excludeSource: true };
          }
          // Also catch "other than" phrasing when it clearly refers to the source.
          if (!next.excludeSource && /\btarget\s+.*\bother\s+than\s+(?:this|that)\b/.test(text)) {
            next = { ...next, excludeSource: true };
          }

          // Attacking/blocking/tapped/untapped constraints (creatures only).
          if (/attacking or blocking creature/.test(text)) {
            next = {
              ...next,
              targetRestriction: { type: 'attacked_or_blocked_this_turn', description: 'that is attacking or blocking' },
              targetDescription: next.targetDescription || 'attacking or blocking creature',
            };
          } else if (/attacking creature/.test(text)) {
            next = {
              ...next,
              targetRestriction: { type: 'attacked_this_turn', description: 'that is attacking' },
              targetDescription: next.targetDescription || 'attacking creature',
            };
          } else if (/blocking creature/.test(text)) {
            next = {
              ...next,
              targetRestriction: { type: 'blocked_this_turn', description: 'that is blocking' },
              targetDescription: next.targetDescription || 'blocking creature',
            };
          } else if (/tapped creature/.test(text)) {
            next = {
              ...next,
              targetRestriction: { type: 'tapped', description: 'tapped' },
              targetDescription: next.targetDescription || 'tapped creature',
            };
          } else if (/untapped creature/.test(text)) {
            next = {
              ...next,
              targetRestriction: { type: 'untapped', description: 'untapped' },
              targetDescription: next.targetDescription || 'untapped creature',
            };
          }

          // Creature keyword constraints (engine supports these via has_keyword).
          // Keep this list aligned with what the engine can reasonably detect in keywords/oracle text.
          const keywordAbilities = [
            'flying',
            'reach',
            'trample',
            'deathtouch',
            'lifelink',
            'vigilance',
            'haste',
            'menace',
            'hexproof',
            'indestructible',
            'first strike',
            'double strike',
            'ward',
            'defender',
          ];
          const keywordGroup = keywordAbilities
            .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('|');
          const keywordMatch = text.match(new RegExp(`\\b(?:creature\\s+)?(?:with|that\\s+has)\\s+(${keywordGroup})\\b`));
          if (keywordMatch) {
            const keyword = keywordMatch[1];
            // If spec is creature-only, apply as a targetRestriction.
            if (next.filter === 'CREATURE' && !next.multiFilter) {
              next = {
                ...next,
                targetRestriction: { type: 'has_keyword', description: `with ${keyword}`, keyword },
                targetDescription: next.targetDescription || `creature with ${keyword}`,
              };
            }
            // If spec is multi-type including creatures, apply creatureRestriction.
            if (Array.isArray(next.multiFilter) && (next.multiFilter as any[]).includes('CREATURE')) {
              next = {
                ...next,
                creatureRestriction: { type: 'has_keyword', description: `with ${keyword}`, keyword },
              };
            }
          }

          // Power/toughness constraints (engine supports these via statRequirement).
          // Examples: "target creature with toughness 4 or greater", "target creature with power 2 or less".
          if (!next.statRequirement) {
            const statMatch = text.match(/target\s+(?:attacking or blocking\s+)?creature\s+with\s+(power|toughness)\s+(\d+)\s+or\s+(greater|less)/);
            if (statMatch) {
              const stat = statMatch[1] as 'power' | 'toughness';
              const value = parseInt(statMatch[2], 10);
              const comparison = statMatch[3] === 'greater' ? '>=' : '<=';
              if (Number.isFinite(value)) {
                next = {
                  ...next,
                  statRequirement: { stat, comparison: comparison as any, value },
                  targetDescription: next.targetDescription || `creature with ${stat} ${comparison} ${value}`,
                };
              }
            }
          }

          return next;
        };

        for (const pending of queue.steps) {
          if (pending.type === ResolutionStepType.TARGET_SELECTION && pending.sourceId && step.sourceId && pending.sourceId === step.sourceId) {
            (pending as any).selectedMode = modeOption
              ? { id: modeOption.id, label: modeOption.label, description: modeOption.description }
              : { id: selectedMode, label: `Mode ${selectedMode}`, description: '' };

            // Engine-backed recomputation of valid targets based on chosen mode text.
            // Fallback: keep the original validTargets if we can't recompute safely.
            const original = Array.isArray((pending as any).validTargets) ? ([...(pending as any).validTargets] as any[]) : [];
            const cardName = String((pending as any).sourceName || step.sourceName || 'spell');
            const modeSpellSpec = categorizeSpell(cardName, modeText);
            const modeTargetReqs = parseTargetRequirements(modeText);
            const nextMinTargets = Number(modeSpellSpec?.minTargets ?? modeTargetReqs?.minTargets ?? (pending as any).minTargets ?? 1);
            const nextMaxTargets = Number(modeSpellSpec?.maxTargets ?? modeTargetReqs?.maxTargets ?? (pending as any).maxTargets ?? 1);
            const nextTargetDescription = String(
              (modeSpellSpec?.targetDescription || modeTargetReqs?.targetDescription || (pending as any).targetDescription || (pending as any).description || '')
            ).trim();

            // If the mode implies a per-opponent targeting structure, the step is usually not a plain TARGET_SELECTION.
            // Don't override it here.
            if (modeTargetReqs?.perOpponent) {
              (pending as any).validTargets = original;
              break;
            }

            const modeConstraintText = `${modeLabel} ${modeText}`.toLowerCase();
            const requiresNonland = modeConstraintText.includes('nonland');
            const requiresNoncreature = modeConstraintText.includes('noncreature');
            const requiresNonartifact = modeConstraintText.includes('nonartifact');
            const requiresNonenchantment = modeConstraintText.includes('nonenchantment');
            const requiresYouControl = /\byou control\b/.test(modeConstraintText);
            const requiresOpponentControls = /\ban opponent controls\b|\bopponent controls\b/.test(modeConstraintText);
            const requiresYouDontControl = /\byou don't control\b|\byou do not control\b/.test(modeConstraintText);

            let recomputed: any[] | null = null;

            // First: best path, full heuristic spec.
            if (modeSpellSpec && modeSpellSpec.minTargets > 0) {
              const spec = applyModeRestrictionsToSpec(modeSpellSpec, modeConstraintText);
              const sourceIdForExclude = spec.excludeSource && (game.state.battlefield || []).some((p: any) => p?.id === pending.sourceId)
                ? String(pending.sourceId)
                : undefined;
              const refs = evaluateTargeting(game.state as any, pid as any, spec, sourceIdForExclude);
              const opts = buildChoiceOptionsFromTargetRefs(refs);
              recomputed = opts;
            }

            // Second: build a minimal spec from parsed target requirements.
            if ((!recomputed || recomputed.length === 0) && modeTargetReqs?.needsTargets) {
              const specFromReqs = buildSpellSpecFromTargetRequirements(modeText, modeTargetReqs, nextMinTargets, nextMaxTargets);
              if (specFromReqs) {
                const spec = applyModeRestrictionsToSpec(specFromReqs, modeConstraintText);
                const sourceIdForExclude = spec.excludeSource && (game.state.battlefield || []).some((p: any) => p?.id === pending.sourceId)
                  ? String(pending.sourceId)
                  : undefined;
                const refs = evaluateTargeting(game.state as any, pid as any, spec, sourceIdForExclude);
                const opts = buildChoiceOptionsFromTargetRefs(refs);
                recomputed = opts;
              } else {
                // Player-only targeting is not represented in evaluateTargeting (non-"any target"), so handle it directly.
                const targetTypes = Array.isArray(modeTargetReqs?.targetTypes)
                  ? (modeTargetReqs.targetTypes as any[]).map(t => String(t).toLowerCase())
                  : [];
                const isOpponentOnly = targetTypes.includes('opponent') || /\btarget\s+opponent\b/.test(modeText);
                const isSelfOnly = /\btarget\s+(yourself|you)\b/.test(modeText);
                const isPlayerOnly = targetTypes.includes('player') || isOpponentOnly || isSelfOnly;
                if (isPlayerOnly) {
                  recomputed = (game.state.players || [])
                    .filter((p: any) => {
                      if (isOpponentOnly) return p?.id && p.id !== pid;
                      if (isSelfOnly) return p?.id && p.id === pid;
                      return true;
                    })
                    .map((p: any) => ({
                      id: p.id,
                      label: p.name || p.id,
                      description: 'player',
                      type: 'player',
                      life: p.life,
                      isOpponent: p.id !== pid,
                    }));
                }
              }
            }

            // Apply additional constraints that the current engine spec does not model.
            if (recomputed && recomputed.length > 0) {
              const applyConstraints = (list: any[]): any[] => {
                const normalizeColorArray = (value: any): string[] => {
                  if (!Array.isArray(value)) return [];
                  return value
                    .map((c: any) => String(c || '').trim())
                    .filter(Boolean)
                    .map((c: string) => c.toUpperCase());
                };

                const normalizeTypeLine = (value: any): string => {
                  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
                };

                const splitTypeLine = (typeLineRaw: any): { types: string; subtypes: string } => {
                  const tl = normalizeTypeLine(typeLineRaw);
                  if (!tl) return { types: '', subtypes: '' };
                  // Scryfall uses an em dash; keep a fallback for other dash styles.
                  if (tl.includes('—')) {
                    const [types, subtypes] = tl.split('—', 2);
                    return { types: (types || '').trim(), subtypes: (subtypes || '').trim() };
                  }
                  if (tl.includes(' - ')) {
                    const [types, subtypes] = tl.split(' - ', 2);
                    return { types: (types || '').trim(), subtypes: (subtypes || '').trim() };
                  }
                  return { types: tl.trim(), subtypes: '' };
                };

                const hasKeyword = (opt: any, keyword: string): boolean => {
                  const k = String(keyword || '').toLowerCase().trim();
                  if (!k) return false;
                  const keywords = Array.isArray(opt?.keywords)
                    ? (opt.keywords as any[]).map((x: any) => String(x || '').toLowerCase())
                    : [];
                  if (keywords.includes(k)) return true;
                  const oracle = String(opt?.oracleText || '').toLowerCase();
                  return oracle.includes(k);
                };

                const getColorCodes = (opt: any): string[] => {
                  // Prefer explicit colors; fall back to color identity.
                  const colors = normalizeColorArray(opt?.colors);
                  if (colors.length > 0) return colors;
                  return normalizeColorArray(opt?.colorIdentity);
                };

                const COLOR_CODE: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
                const colorWords = ['white', 'blue', 'black', 'red', 'green'] as const;

                // Parse color constraints from mode text (simple/common oracle patterns).
                const requiredColors: string[] = [];
                const forbiddenColors: string[] = [];
                for (const w of colorWords) {
                  const code = COLOR_CODE[w];
                  if (new RegExp(`\\bnon${w}\\b`).test(modeConstraintText)) forbiddenColors.push(code);
                  // Require color only when the word appears in a typical target phrase.
                  if (new RegExp(`\\b${w}\\s+(?:creature|permanent|spell|card)\\b`).test(modeConstraintText)) requiredColors.push(code);
                }
                const requiresColorless = /\\bcolorless\\b/.test(modeConstraintText);
                const requiresMulticolored = /\\bmulticolou?red\\b/.test(modeConstraintText);
                const requiresMonocolored = /\\bmonocolou?red\\b/.test(modeConstraintText);
                const requiresNoncolorless = /\\bnoncolorless\\b|\\bnot colorless\\b/.test(modeConstraintText);

                // Supertypes and type-line constraints.
                const requiresBasicLand = /\\bbasic\\s+land\\b/.test(modeConstraintText);
                const requiresNonbasicLand = /\\bnonbasic\\s+land\\b/.test(modeConstraintText);
                const requiresLegendary = /\\blegendary\\b/.test(modeConstraintText) && !/\\bnonlegendary\\b/.test(modeConstraintText);
                const requiresNonlegendary = /\\bnonlegendary\\b/.test(modeConstraintText);
                const requiresSnow = /\\bsnow\\b/.test(modeConstraintText) && !/\\bnonsnow\\b/.test(modeConstraintText);
                const requiresNonsnow = /\\bnonsnow\\b/.test(modeConstraintText);

                // Keyword constraints (best-effort, creatures only).
                const keywordAbilities = [
                  'flying',
                  'reach',
                  'trample',
                  'deathtouch',
                  'lifelink',
                  'vigilance',
                  'haste',
                  'menace',
                  'hexproof',
                  'indestructible',
                  'first strike',
                  'double strike',
                  'ward',
                  'defender',
                ];
                const keywordGroup = keywordAbilities
                  .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
                  .join('|');
                const requiredKeywordMatch = modeConstraintText.match(
                  new RegExp(`\\b(?:creature\\s+)?(?:with|that\\s+has)\\s+(${keywordGroup})\\b`)
                );
                const requiredKeyword = requiredKeywordMatch?.[1] ? requiredKeywordMatch[1] : null;
                const forbiddenKeywordMatch = modeConstraintText.match(
                  new RegExp(`\\b(?:without|doesn't\\s+have|does\\s+not\\s+have|that\\s+doesn't\\s+have|that\\s+does\\s+not\\s+have)\\s+(${keywordGroup})\\b`)
                );
                const forbiddenKeyword = forbiddenKeywordMatch?.[1] ? forbiddenKeywordMatch[1] : null;

                // Creature subtype constraints (best-effort): support negative subtype like "non-Human creature".
                // Avoid false positives by only recognizing "non-<word> creature" patterns.
                const nonSubtypeMatch = modeConstraintText.match(/\\bnon[-\s]?([a-z][a-z']*)\\s+creature\\b/);
                const forbiddenCreatureSubtype = nonSubtypeMatch?.[1] ? nonSubtypeMatch[1].toLowerCase() : null;

                // Compound type-line constraints.
                const requiresArtifactCreature = /\\bartifact\\s+creature\\b/.test(modeConstraintText);
                const requiresEnchantmentCreature = /\\benchantment\\s+creature\\b/.test(modeConstraintText);
                const requiresArtifactLand = /\\bartifact\\s+land\\b/.test(modeConstraintText);

                // Token/nontoken constraints (best-effort, only when part of a target phrase).
                const requiresNontoken = /\\btarget\\s+(?:[a-z'\\-]+\\s+)*nontoken\\b/.test(modeConstraintText);
                const requiresToken = /\\btarget\\s+(?:[a-z'\\-]+\\s+)*token\\b/.test(modeConstraintText) && !requiresNontoken;

                // Tapped/untapped constraints (best-effort, works for both creatures and permanents).
                const requiresTapped = /\\btarget\\s+(?:[a-z'\\-]+\\s+)*tapped\\b/.test(modeConstraintText);
                const requiresUntapped = /\\btarget\\s+(?:[a-z'\\-]+\\s+)*untapped\\b/.test(modeConstraintText);

                // Mana value constraints (best-effort).
                // Example: "target creature with mana value 3 or less".
                const mvRangeMatch = /\\b(?:mana value|converted mana cost)\\s+(\\d+)\\s+or\\s+(less|fewer|greater|more)\\b/.exec(modeConstraintText);
                const mvConstraint = mvRangeMatch && /\\btarget\\b/.test(modeConstraintText)
                  ? {
                      value: parseInt(mvRangeMatch[1], 10),
                      cmp: mvRangeMatch[2] === 'less' || mvRangeMatch[2] === 'fewer' ? '<=' : '>=',
                    }
                  : null;
                const mvExactMatch = !mvConstraint && /\\btarget\\b/.test(modeConstraintText)
                  ? /\\b(?:mana value|converted mana cost)\\s+(?:exactly\\s+)?(\\d+)\\b(?!\\s+or\\b)/.exec(modeConstraintText)
                  : null;
                const mvExact = mvExactMatch ? parseInt(mvExactMatch[1], 10) : null;

                // Positive creature subtype targeting (best-effort).
                // Example: "target elf creature", "target human soldier creature".
                const subtypeStop = new Set([
                  'another',
                  'tapped',
                  'untapped',
                  'attacking',
                  'blocking',
                  'legendary',
                  'nonlegendary',
                  'snow',
                  'nonsnow',
                  'basic',
                  'nonbasic',
                  'nonland',
                  'noncreature',
                  'nonartifact',
                  'nonenchantment',
                  'artifact',
                  'enchantment',
                  'token',
                  'nontoken',
                  'colorless',
                  'noncolorless',
                  'monocolored',
                  'multicolored',
                  'white',
                  'blue',
                  'black',
                  'red',
                  'green',
                  'nonwhite',
                  'nonblue',
                  'nonblack',
                  'nonred',
                  'nongreen',
                ]);
                const subtypePhraseMatch = modeConstraintText.match(/\\btarget\\s+((?:[a-z][a-z'\\-]*\\s+){0,3})creature\\b/);
                const requiredCreatureSubtypes = subtypePhraseMatch?.[1]
                  ? subtypePhraseMatch[1]
                      .trim()
                      .split(/\\s+/)
                      .map(t => t.trim())
                      .filter(Boolean)
                      .filter(t => !subtypeStop.has(t) && !t.startsWith('non'))
                  : [];

                // Common permanent subtype targeting.
                // Examples: "target Aura"; "target Equipment".
                const requiresAura = /\\btarget\\s+aura\\b/.test(modeConstraintText);
                const requiresEquipment = /\\btarget\\s+equipment\\b/.test(modeConstraintText);

                return list.filter((opt: any) => {
                  const optType = String(opt?.type || '').toLowerCase();
                  const typeLine = normalizeTypeLine(opt?.typeLine);
                  const controller = String(opt?.controller || '');
                  const isOpponent = typeof opt?.isOpponent === 'boolean' ? (opt.isOpponent as boolean) : undefined;

                  if (optType !== 'player') {
                    // Color constraints apply to permanents/spells, not players.
                    const colors = getColorCodes(opt);
                    if (requiresColorless && colors.length > 0) return false;
                    if (requiresNoncolorless && colors.length === 0) return false;
                    if (requiresMonocolored && colors.length !== 1) return false;
                    if (requiresMulticolored && colors.length < 2) return false;
                    for (const fc of forbiddenColors) {
                      if (colors.includes(fc)) return false;
                    }
                    for (const rc of requiredColors) {
                      if (!colors.includes(rc)) return false;
                    }

                    // Compound type requirements (when oracle is explicit).
                    if (requiresArtifactCreature && !(typeLine.includes('artifact') && typeLine.includes('creature'))) return false;
                    if (requiresEnchantmentCreature && !(typeLine.includes('enchantment') && typeLine.includes('creature'))) return false;
                    if (requiresArtifactLand && !(typeLine.includes('artifact') && typeLine.includes('land'))) return false;

                    // Token / nontoken filtering.
                    if (requiresNontoken) {
                      const isToken = opt?.isToken === true;
                      if (isToken) return false;
                    }
                    if (requiresToken) {
                      const isToken = opt?.isToken === true;
                      if (!isToken) return false;
                    }

                    // Tapped / untapped filtering.
                    if (requiresTapped && opt?.tapped !== true) return false;
                    if (requiresUntapped && opt?.tapped === true) return false;

                    // Mana value filtering.
                    if (mvConstraint && Number.isFinite(mvConstraint.value)) {
                      const mv = Number(opt?.cmc ?? 0);
                      if (mvConstraint.cmp === '<=' && !(mv <= mvConstraint.value)) return false;
                      if (mvConstraint.cmp === '>=' && !(mv >= mvConstraint.value)) return false;
                    }

                    if (mvExact !== null && Number.isFinite(mvExact)) {
                      const mv = Number(opt?.cmc ?? 0);
                      if (!(mv === mvExact)) return false;
                    }

                    // Keyword constraints (creatures only).
                    if (typeLine.includes('creature')) {
                      if (requiredKeyword && !hasKeyword(opt, requiredKeyword)) return false;
                      if (forbiddenKeyword && hasKeyword(opt, forbiddenKeyword)) return false;
                    }

                    // Positive creature subtype filtering.
                    if (requiredCreatureSubtypes.length > 0 && typeLine.includes('creature')) {
                      const { subtypes } = splitTypeLine(typeLine);
                      const subtypeList = subtypes ? subtypes.split(/\s+/).filter(Boolean) : [];
                      for (const st of requiredCreatureSubtypes) {
                        if (!subtypeList.includes(st)) return false;
                      }
                    }

                    // Common permanent subtype filtering.
                    if ((requiresAura || requiresEquipment) && optType !== 'player') {
                      const { subtypes } = splitTypeLine(typeLine);
                      const subtypeList = subtypes ? subtypes.split(/\s+/).filter(Boolean) : [];
                      if (requiresAura && !subtypeList.includes('aura')) return false;
                      if (requiresEquipment && !subtypeList.includes('equipment')) return false;
                    }

                    // Basic/nonbasic land.
                    if (requiresBasicLand) {
                      if (!(typeLine.includes('land') && typeLine.includes('basic'))) return false;
                    }
                    if (requiresNonbasicLand) {
                      if (!typeLine.includes('land')) return false;
                      if (typeLine.includes('basic')) return false;
                    }

                    // Legendary/nonlegendary.
                    if (requiresLegendary && !typeLine.includes('legendary')) return false;
                    if (requiresNonlegendary && typeLine.includes('legendary')) return false;

                    // Snow/nonsnow.
                    if (requiresSnow && !typeLine.includes('snow')) return false;
                    if (requiresNonsnow && typeLine.includes('snow')) return false;

                    // Negative creature subtype (non-Human, non-Elf, etc.).
                    // Only apply when the target is actually a creature.
                    if (forbiddenCreatureSubtype && typeLine.includes('creature')) {
                      // Type line uses proper case, but we normalize to lowercase.
                      // Subtypes appear after the em dash.
                      const { subtypes } = splitTypeLine(typeLine);
                      if (subtypes && subtypes.split(/\s+/).includes(forbiddenCreatureSubtype)) return false;
                    }

                    if (requiresNonland && typeLine.includes('land')) return false;
                    if (requiresNoncreature && typeLine.includes('creature')) return false;
                    if (requiresNonartifact && typeLine.includes('artifact')) return false;
                    if (requiresNonenchantment && typeLine.includes('enchantment')) return false;
                    if (requiresYouControl) {
                      if (controller) {
                        if (controller !== pid) return false;
                      } else if (isOpponent !== undefined) {
                        if (isOpponent) return false;
                      }
                    }
                    if (requiresOpponentControls) {
                      if (controller) {
                        if (controller === pid) return false;
                      } else if (isOpponent !== undefined) {
                        if (!isOpponent) return false;
                      }
                    }
                    if (requiresYouDontControl) {
                      if (controller) {
                        if (controller === pid) return false;
                      } else if (isOpponent !== undefined) {
                        if (!isOpponent) return false;
                      }
                    }
                  }

                  return true;
                });
              };

              const constrained = applyConstraints(recomputed);
              if (constrained.length >= Math.max(0, nextMinTargets)) {
                recomputed = constrained;

                // Prefer the requirements' phrasing when we applied extra constraints.
                if ((requiresNonland || requiresNoncreature || requiresNonartifact || requiresNonenchantment || requiresYouControl || requiresOpponentControls || requiresYouDontControl) && modeTargetReqs?.targetDescription) {
                  (pending as any).targetDescription = String(modeTargetReqs.targetDescription);
                }
              }
            }

            if (recomputed && recomputed.length >= Math.max(0, nextMinTargets)) {
              (pending as any).validTargets = recomputed;
              (pending as any).minTargets = nextMinTargets;
              // Don't allow selecting more targets than exist.
              const clampedMaxTargets = Math.max(nextMinTargets, Math.min(nextMaxTargets, recomputed.length));
              (pending as any).maxTargets = clampedMaxTargets;
              (pending as any).targetDescription = nextTargetDescription;
              if (modeLabel) {
                const desc = String((pending as any).targetDescription || nextTargetDescription || 'target');
                (pending as any).description = `Choose ${desc} for ${cardName} (${modeLabel})`;
              }

              const effectIdForCast = pending.sourceId;
              if (effectIdForCast && (game.state as any)?.pendingSpellCasts?.[effectIdForCast]) {
                (game.state as any).pendingSpellCasts[effectIdForCast].validTargetIds = recomputed.map((t: any) => t.id);
              }
            } else {
              // If engine recomputation isn't possible, keep the precomputed original list.
              (pending as any).validTargets = original;
            }
          }
        }
      } catch {
        // Best-effort only.
      }

      // Best-effort: stash on pendingSpellCasts for later stages (targets/payment), if applicable.
      const effectId = step.sourceId;
      if (effectId && (game.state as any)?.pendingSpellCasts?.[effectId]) {
        (game.state as any).pendingSpellCasts[effectId].selectedMode = selectedMode;
      }

      // Inform players (helps debugging/clarity).
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} chose a mode for ${step.sourceName || 'a spell'}.`,
        ts: Date.now(),
      });
      break;
    }

    case ResolutionStepType.DISCARD_SELECTION:
      handleDiscardResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.COMMANDER_ZONE_CHOICE:
      handleCommanderZoneResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.TARGET_SELECTION:
      handleTargetSelectionResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.TRIGGER_ORDER:
      handleTriggerOrderResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.KYNAIOS_CHOICE:
      handleKynaiosChoiceResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.JOIN_FORCES:
      handleJoinForcesResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.TEMPTING_OFFER:
      handleTemptingOfferResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.BOUNCE_LAND_CHOICE:
      handleBounceLandChoiceResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.ACTIVATED_ABILITY:
      await handleActivatedAbilityResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.CASCADE:
      await handleCascadeResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.SCRY:
      handleScryResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.SURVEIL:
      handleSurveilResponse(io, game, gameId, step, response);
      break;

    case ResolutionStepType.BOTTOM_ORDER:
      handleBottomOrderResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.PROLIFERATE:
      handleProliferateResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.FATESEAL:
      handleFatesealResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.CLASH:
      handleClashResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.VOTE:
      handleVoteResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.PONDER_EFFECT:
      handlePonderEffectResponse(io, game, gameId, step, response);
      break;

    case ResolutionStepType.TWO_PILE_SPLIT:
      await handleTwoPileSplitResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.LIBRARY_SEARCH:
      await handleLibrarySearchResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.DEVOUR_SELECTION:
      handleDevourSelectionResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.SUSPEND_CAST:
      await handleSuspendCastResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.MORPH_TURN_FACE_UP:
      handleMorphTurnFaceUpResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.PLAYER_CHOICE:
      await handlePlayerChoiceResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.OPTION_CHOICE:
      await handleOptionChoiceResponse(io, game, gameId, step, response);
      break;
    
    case ResolutionStepType.MODAL_CHOICE:
      await handleModalChoiceResponse(io, game, gameId, step, response);
      break;
    
    case ResolutionStepType.COLOR_CHOICE:
      await handleColorChoiceResponse(io, game, gameId, step, response);
      break;
    
    case ResolutionStepType.CREATURE_TYPE_CHOICE:
      await handleCreatureTypeChoiceResponse(io, game, gameId, step, response);
      break;
    
    case ResolutionStepType.CARD_NAME_CHOICE:
      await handleCardNameChoiceResponse(io, game, gameId, step, response);
      break;
    
    case ResolutionStepType.UPKEEP_SACRIFICE:
      handleUpkeepSacrificeResponse(io, game, gameId, step, response);
      break;
    
    case ResolutionStepType.ENTRAPMENT_MANEUVER:
      handleEntrapmentManeuverResponse(io, game, gameId, step, response);
      break;
    
    // Add more handlers as needed
    default:
      debug(2, `[Resolution] No specific handler for step type: ${step.type}`);
  }
}

/**
 * Handle discard selection response
 */
function handleDiscardResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const pid = response.playerId;
  const selections = response.selections as string[];
  
  if (!Array.isArray(selections) || selections.length === 0) {
    debugWarn(2, `[Resolution] Invalid discard selections for step ${step.id}`);
    return;
  }
  
  // Get discard step data for validation
  const discardStep = step as any;
  const hand = discardStep.hand || [];
  const discardCount = discardStep.discardCount;
  const destination: 'graveyard' | 'exile' = discardStep.destination === 'exile' ? 'exile' : 'graveyard';
  
  // Validate selection count matches required discard count
  if (discardCount && selections.length !== discardCount) {
    debugWarn(1, `[Resolution] Invalid discard count: expected ${discardCount}, got ${selections.length}`);
    return;
  }
  
  // Validate all selected cards are in the hand options
  const validCardIds = new Set(hand.map((c: any) => c.id));
  for (const cardId of selections) {
    if (!validCardIds.has(cardId)) {
      debugWarn(1, `[Resolution] Invalid discard selection: card ${cardId} not in hand`);
      return;
    }
  }
  
  // Get player zones
  const zones = game.state?.zones?.[pid];
  if (!zones || !zones.hand) {
    debugWarn(2, `[Resolution] No hand found for player ${pid}`);
    return;
  }
  
  // Move selected cards to the destination zone
  zones.graveyard = zones.graveyard || [];
  zones.exile = zones.exile || [];

  const exileTag = (step as any)?.exileTag as
    | {
        exiledWithSourceId?: string;
        exiledWithOracleId?: string;
        exiledWithSourceName?: string;
      }
    | undefined;

  const movedCards: any[] = [];
  
  for (const cardId of selections) {
    const cardIndex = zones.hand.findIndex((c: any) => c.id === cardId);
    if (cardIndex !== -1) {
      const [card] = zones.hand.splice(cardIndex, 1);
      movedCards.push(card);
      if (destination === 'exile') {
        zones.exile.push({
          ...card,
          ...(exileTag ? { ...exileTag } : null),
          zone: 'exile',
        });
      } else {
        zones.graveyard.push({ ...card, zone: 'graveyard' });
      }
    }
  }
  
  // Update counts
  zones.handCount = zones.hand.length;
  zones.graveyardCount = zones.graveyard.length;
  if (zones.exileCount !== undefined) {
    zones.exileCount = zones.exile.length;
  }
  
  // Clear legacy pending state if present
  if (game.state.pendingDiscardSelection?.[pid]) {
    delete game.state.pendingDiscardSelection[pid];
  }
  
  // Emit chat message
  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message:
      destination === 'exile'
        ? `${getPlayerName(game, pid)} exiled ${selections.length} card(s) from hand.`
        : `${getPlayerName(game, pid)} discarded ${selections.length} card(s).`,
    ts: Date.now(),
  });

  // Planeswalker helper: "You may discard a card. If you do, draw a card."
  const afterDiscardDrawCount = (step as any)?.afterDiscardDrawCount;
  if (afterDiscardDrawCount && typeof afterDiscardDrawCount === 'number' && afterDiscardDrawCount > 0) {
    if (typeof (game as any).drawCards === 'function') {
      (game as any).drawCards(pid, afterDiscardDrawCount);
    } else {
      // Fallback draw: use game.libraries if present; else zones library.
      const lib = (game as any).libraries?.get?.(pid) || zones.library || [];
      for (let i = 0; i < afterDiscardDrawCount && lib.length > 0; i++) {
        const drawn = lib.shift();
        zones.hand.push({ ...drawn, zone: 'hand' });
      }
      zones.handCount = zones.hand.length;
      zones.libraryCount = lib.length;
      if ((game as any).libraries?.set) {
        (game as any).libraries.set(pid, lib);
      }
    }

    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} drew ${afterDiscardDrawCount} card(s).`,
      ts: Date.now(),
    });
  }

  // Planeswalker helper: discard, draw, and if a land was discarded, draw extra.
  const afterDiscardDrawCountIfDiscardedLand = (step as any)?.afterDiscardDrawCountIfDiscardedLand;
  if (
    afterDiscardDrawCountIfDiscardedLand &&
    typeof afterDiscardDrawCountIfDiscardedLand === 'number' &&
    afterDiscardDrawCountIfDiscardedLand > 0
  ) {
    const discardedALand = movedCards.some((c: any) => String(c?.type_line || '').toLowerCase().includes('land'));
    if (discardedALand) {
      if (typeof (game as any).drawCards === 'function') {
        (game as any).drawCards(pid, afterDiscardDrawCountIfDiscardedLand);
      } else {
        const lib = (game as any).libraries?.get?.(pid) || zones.library || [];
        for (let i = 0; i < afterDiscardDrawCountIfDiscardedLand && lib.length > 0; i++) {
          const drawn = lib.shift();
          zones.hand.push({ ...drawn, zone: 'hand' });
        }
        zones.handCount = zones.hand.length;
        zones.libraryCount = lib.length;
        if ((game as any).libraries?.set) {
          (game as any).libraries.set(pid, lib);
        }
      }

      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} drew ${afterDiscardDrawCountIfDiscardedLand} additional card(s).`,
        ts: Date.now(),
      });
    }
  }
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}

/**
 * Handle commander zone choice response
 */
function handleCommanderZoneResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const pid = response.playerId;
  const selection = response.selections;
  // Check if selection indicates going to command zone
  // Handle multiple selection types
  const goToCommandZone = selection === true || 
    (typeof selection === 'string' && selection === 'command') ||
    (Array.isArray(selection) && selection.includes('command'));
  
  // Get the commander info from step
  const stepData = step as any;
  const commanderId = stepData.commanderId;
  const commanderName = stepData.commanderName || 'Commander';
  const fromZone = stepData.fromZone || 'graveyard';
  const card = stepData.card;
  const exileTag = stepData.exileTag as
    | {
        exiledWithSourceId?: string;
        exiledWithOracleId?: string;
        exiledWithSourceName?: string;
      }
    | undefined;
  
  if (goToCommandZone) {
    // Actually move commander to command zone
    const zones = game.state?.zones?.[pid];
    if (zones && card) {
      // Remove from source zone
      const sourceZone = zones[fromZone];
      if (Array.isArray(sourceZone)) {
        const cardIndex = sourceZone.findIndex((c: any) => c.id === commanderId || c.id === card.id);
        if (cardIndex !== -1) {
          sourceZone.splice(cardIndex, 1);
          // Update zone count
          const countKey = `${fromZone}Count` as keyof typeof zones;
          if (typeof zones[countKey] === 'number') {
            (zones[countKey] as number)--;
          }
        }
      }
      
      // Add to command zone
      zones.commandZone = zones.commandZone || [];
      zones.commandZone.push({ ...card, zone: 'command' });
      zones.commandZoneCount = zones.commandZone.length;
    }
    
    // Also remove from battlefield if present
    const battlefield = game.state?.battlefield || [];
    const permIndex = battlefield.findIndex((p: any) => 
      p.id === commanderId || p.card?.id === commanderId || p.card?.id === card?.id
    );
    if (permIndex !== -1) {
      battlefield.splice(permIndex, 1);
    }
    
    debug(2, `[Resolution] Moved ${commanderName} from ${fromZone} to command zone`);
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} moved ${commanderName} to the command zone.`,
      ts: Date.now(),
    });
  } else {
    // IMPORTANT: If this was a deferred commander replacement (graveyard/exile),
    // the card was removed from the battlefield but NOT yet put into the destination zone.
    // Ensure it actually ends up in the chosen zone.
    const zones = game.state?.zones?.[pid];
    if (zones && card) {
      const destZoneName = fromZone;
      const destZone = (zones as any)[destZoneName];

      // If the card isn't already in the destination zone, add it.
      if (Array.isArray(destZone)) {
        const alreadyThere = destZone.some((c: any) => c?.id === commanderId || c?.id === card.id);
        if (!alreadyThere) {
          const zoneValue = destZoneName === 'exile' ? 'exile' : destZoneName;
          destZone.push({
            ...card,
            ...(destZoneName === 'exile' && exileTag ? { ...exileTag } : null),
            zone: zoneValue,
          });
          const countKey = `${destZoneName}Count` as keyof typeof zones;
          if (typeof zones[countKey] === 'number') {
            (zones[countKey] as number)++;
          }
        }
      } else {
        // If destination zone container doesn't exist, create as array.
        (zones as any)[destZoneName] = [
          {
            ...card,
            ...(destZoneName === 'exile' && exileTag ? { ...exileTag } : null),
            zone: destZoneName === 'exile' ? 'exile' : destZoneName,
          },
        ];
        const countKey = `${destZoneName}Count`;
        (zones as any)[countKey] = 1;
      }
    }

    debug(2, `[Resolution] ${commanderName} stays in ${fromZone}`);
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} let ${commanderName} go to ${fromZone}.`,
      ts: Date.now(),
    });
  }
  
  // Clear legacy pending state if present
  if (game.state.pendingCommanderZoneChoice?.[pid]) {
    const choices = game.state.pendingCommanderZoneChoice[pid];
    const index = choices.findIndex((c: any) => c.commanderId === commanderId);
    if (index !== -1) {
      choices.splice(index, 1);
      if (choices.length === 0) {
        delete game.state.pendingCommanderZoneChoice[pid];
      }
    }
  }
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}

/**
 * Handle target selection response
 */
function handleTargetSelectionResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const pid = response.playerId;
  const selections = response.selections as string[];
  
  if (!Array.isArray(selections)) {
    debugWarn(1, `[Resolution] Invalid target selections: not an array`);
    return;
  }
  
  // Get target step data for validation
  const targetStepData = step as TargetSelectionStep;
  const validTargets = targetStepData.validTargets || [];
  const minTargets = targetStepData.minTargets || 0;
  const maxTargets = targetStepData.maxTargets || Infinity;

  // Disallow selecting the same target multiple times.
  // The client already prevents duplicates via Set-based selection, but enforce server-side as well.
  const uniqueSelections = Array.from(new Set(selections));
  if (uniqueSelections.length !== selections.length) {
    debugWarn(1, `[Resolution] Invalid target selection: duplicate target id(s) selected`);
    return;
  }
  
  // Validate selection count is within bounds
  if (selections.length < minTargets || selections.length > maxTargets) {
    debugWarn(1, `[Resolution] Invalid target count: got ${selections.length}, expected ${minTargets}-${maxTargets}`);
    return;
  }
  
  // Validate all selected targets are in valid targets list
  const validTargetIds = new Set(validTargets.map((t: any) => t.id));
  if (!selections.every(id => validTargetIds.has(id))) {
    debugWarn(1, `[Resolution] Invalid target selection: one or more targets not in valid targets list`);
    return;
  }
  
  // Store the validated targets on the stack item that needs them
  // The spell/ability on the stack will use these targets when it resolves
  const sourceId = step.sourceId;
  if (sourceId && game.state?.stack) {
    const stackItem = game.state.stack.find((item: any) => item.id === sourceId);
    if (stackItem) {
      stackItem.targets = selections;
      debug(2, `[Resolution] Stored targets for ${sourceId}: ${selections.join(', ')}`);
    } else {
      debugWarn(2, `[Resolution] Stack item ${sourceId} not found to store targets`);
    }
  }

  // ===== LORWYN ECLIPSED: Blight N (generic hook) =====
  if ((step as any)?.keywordBlight === true && String((step as any)?.keywordBlightStage || '') === 'select_target') {
    const controllerId = String((step as any).keywordBlightController || pid);
    const n = Number((step as any).keywordBlightN || 0);
    const sourceName = String((step as any).keywordBlightSourceName || step.sourceName || 'Blight');
    const targetId = selections[0];

    const targetPerm = (game.state?.battlefield || []).find((p: any) => p && p.id === targetId);
    if (!targetPerm) {
      debugWarn(1, `[Resolution] Blight target not found: ${targetId}`);
      return;
    }

    targetPerm.counters = targetPerm.counters || {};
    targetPerm.counters['-1/-1'] = (targetPerm.counters['-1/-1'] || 0) + (Number.isFinite(n) ? n : 0);

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${sourceName}: ${getPlayerName(game, controllerId)} put ${n} -1/-1 counter${n === 1 ? '' : 's'} on ${targetPerm.card?.name || 'a creature'}.`,
      ts: Date.now(),
    });

    if (typeof game.bumpSeq === 'function') game.bumpSeq();
    broadcastGame(io, game, gameId);
    return;
  }

  // ===== GENERIC: Sacrifice "When you do" follow-up =====
  if ((step as any)?.sacrificeWhenYouDo === true && String((step as any).sacrificeWhenYouDoStage || '') === 'select_sacrifice') {
    const subtype = String((step as any).sacrificeWhenYouDoSubtype || '').trim();
    const damage = Number((step as any).sacrificeWhenYouDoDamage || 0);
    const lifeGain = Number((step as any).sacrificeWhenYouDoLifeGain || 0);
    const controllerId = String((step as any).sacrificeWhenYouDoController || pid);
    const sourceName = String((step as any).sacrificeWhenYouDoSourceName || step.sourceName || 'Ability');
    const sourcePermanentId = (step as any).sacrificeWhenYouDoSourcePermanentId as string | undefined;
    const permanentIdToSac = selections[0];

    const ctx = {
      state: game.state,
      bumpSeq: typeof (game as any).bumpSeq === 'function' ? (game as any).bumpSeq.bind(game) : (() => {}),
      zones: game.state?.zones,
      gameId,
    } as unknown as GameContext;

    const sacrificedName = sacrificePermanent(ctx, permanentIdToSac, controllerId);
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${sourceName}: ${getPlayerName(game, controllerId)} sacrificed ${sacrificedName || 'a ' + subtype}.`,
      ts: Date.now(),
    });

    // Put the reflexive trigger on the stack
    game.state.stack = game.state.stack || [];
    const triggerId = `trigger_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    game.state.stack.push({
      id: triggerId,
      type: 'triggered_ability',
      controller: controllerId,
      source: sourcePermanentId || null,
      sourceName,
      description: `${sourceName} deals ${damage} damage to any target and you gain ${lifeGain} life.`,
    } as any);

    // Ask for "any target" for the reflexive trigger
    const validAnyTarget = [
      ...(game.state.players || []).map((p: any) => ({
        id: p.id,
        label: p.name || p.id,
        description: 'player',
      })),
      ...(game.state.battlefield || []).map((p: any) => ({
        id: p.id,
        label: p.card?.name || 'Permanent',
        description: p.card?.type_line || 'permanent',
        imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
      })),
    ];

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.TARGET_SELECTION,
      playerId: controllerId as PlayerID,
      description: `Choose any target for ${sourceName}`,
      mandatory: true,
      sourceId: triggerId,
      sourceName,
      validTargets: validAnyTarget,
      targetTypes: ['any_target'],
      minTargets: 1,
      maxTargets: 1,
      targetDescription: 'any target',
    } as any);

    broadcastGame(io, game, gameId);
    return;
  }

  // ===== PLANESWALKER: Sacrifice another permanent → gain life + draw =====
  if ((step as any)?.pwSacAnotherPermanentGainLifeDraw === true && String((step as any).pwSacAnotherPermanentStage || '') === 'select_sacrifice') {
    const controllerId = String((step as any).pwSacAnotherPermanentController || pid);
    const lifeGain = Number((step as any).pwSacAnotherPermanentLifeGain || 0);
    const sourceName = String((step as any).pwSacAnotherPermanentSourceName || step.sourceName || 'Ability');
    const permanentIdToSac = selections[0];

    const ctx = {
      state: game.state,
      bumpSeq: typeof (game as any).bumpSeq === 'function' ? (game as any).bumpSeq.bind(game) : (() => {}),
      zones: game.state?.zones,
      gameId,
    } as unknown as GameContext;

    const sacrificedName = sacrificePermanent(ctx, permanentIdToSac, controllerId);
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${sourceName}: ${getPlayerName(game, controllerId)} sacrificed ${sacrificedName || 'a permanent'}.`,
      ts: Date.now(),
    });

    // Gain life
    const startingLife = game.state.startingLife || 40;
    game.state.life = game.state.life || {};
    const currentLife = game.state.life?.[controllerId] ?? startingLife;
    game.state.life[controllerId] = currentLife + lifeGain;

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${sourceName}: ${getPlayerName(game, controllerId)} gains ${lifeGain} life and draws a card.`,
      ts: Date.now(),
    });

    // Draw a card
    if (typeof (game as any).drawCards === 'function') {
      (game as any).drawCards(controllerId, 1);
    } else {
      const zones = game.state?.zones?.[controllerId];
      if (zones) {
        zones.hand = zones.hand || [];
        const lib = (game as any).libraries?.get?.(controllerId) || zones.library || [];
        if (Array.isArray(lib) && lib.length > 0) {
          const drawn = lib.shift();
          zones.hand.push({ ...drawn, zone: 'hand' });
        }
        zones.handCount = zones.hand.length;
        zones.libraryCount = Array.isArray(lib) ? lib.length : zones.libraryCount;
        if ((game as any).libraries?.set && Array.isArray(lib)) {
          (game as any).libraries.set(controllerId, lib);
        }
      }
    }

    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    broadcastGame(io, game, gameId);
    return;
  }

  // ===== GENERIC: Attach Equipment to created token (after selecting equipment) =====
  if ((step as any)?.attachEquipmentToCreatedTokenSelectEquipment === true) {
    const controllerId = String((step as any).attachEquipmentToCreatedTokenController || pid);
    const tokenPermanentId = String((step as any).attachEquipmentToCreatedTokenPermanentId || '');
    const sourceName = String((step as any).attachEquipmentToCreatedTokenSourceName || step.sourceName || 'Ability');
    const equipPermanentId = selections[0];

    const battlefield = game.state?.battlefield || [];
    const equipment = battlefield.find((p: any) => p?.id === equipPermanentId);
    const token = battlefield.find((p: any) => p?.id === tokenPermanentId);
    if (!equipment || !token) {
      debugWarn(2, `[Resolution] attachEquipmentToCreatedToken: missing equipment or token`);
      return;
    }

    // Detach from previous creature if needed
    const prevAttachedTo = equipment.attachedTo;
    if (prevAttachedTo) {
      const prevCreature = battlefield.find((p: any) => p?.id === prevAttachedTo);
      if (prevCreature) {
        prevCreature.attachedEquipment = Array.isArray(prevCreature.attachedEquipment)
          ? prevCreature.attachedEquipment.filter((id: string) => id !== equipment.id)
          : [];
        if (prevCreature.attachedEquipment.length === 0) {
          prevCreature.isEquipped = false;
        }
      }
    }

    // Attach
    equipment.attachedTo = token.id;
    token.attachedEquipment = Array.isArray(token.attachedEquipment) ? token.attachedEquipment : [];
    if (!token.attachedEquipment.includes(equipment.id)) {
      token.attachedEquipment.push(equipment.id);
    }
    token.isEquipped = true;

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${sourceName}: ${getPlayerName(game, controllerId)} attached ${equipment.card?.name || 'an Equipment'} to ${token.card?.name || 'the token'}.`,
      ts: Date.now(),
    });

    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    broadcastGame(io, game, gameId);
    return;
  }

  // Execute immediate actions for certain target-selection steps
  const action = (step as any).action;
  if (action === 'sacrifice_selected_permanents') {
    const sourceName = String(step.sourceName || 'Effect');
    const controllerId = String(pid);
    const ctx = {
      state: game.state,
      bumpSeq: typeof (game as any).bumpSeq === 'function' ? (game as any).bumpSeq.bind(game) : (() => {}),
      zones: game.state?.zones,
      gameId,
    } as unknown as GameContext;

    const sacrificedNames: string[] = [];
    for (const permanentIdToSac of selections) {
      const sacrificedName = sacrificePermanent(ctx, permanentIdToSac, controllerId);
      if (sacrificedName) sacrificedNames.push(sacrificedName);
    }

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message:
        sacrificedNames.length > 0
          ? `${sourceName}: ${getPlayerName(game, controllerId)} sacrificed ${sacrificedNames.length} permanent(s).`
          : `${sourceName}: ${getPlayerName(game, controllerId)} sacrificed permanent(s).`,
      ts: Date.now(),
    });

    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    broadcastGame(io, game, gameId);
    return;
  }

  if (action === 'pw_lukka_exile_upgrade') {
    const controllerId = String(pid);
    const sourceName = String(step.sourceName || 'Planeswalker');
    const targetId = selections[0];
    if (!targetId) {
      debugWarn(1, `[Resolution] pw_lukka_exile_upgrade: missing selection`);
      return;
    }

    const state = game.state || {};
    const battlefield = (state.battlefield = state.battlefield || []);
    const idx = battlefield.findIndex((p: any) => p?.id === targetId);
    if (idx === -1) {
      debugWarn(1, `[Resolution] pw_lukka_exile_upgrade: target not found on battlefield: ${targetId}`);
      return;
    }

    const perm = battlefield[idx];
    const tlPerm = String(perm?.card?.type_line || '').toLowerCase();
    if (String(perm?.controller || '') !== controllerId || !tlPerm.includes('creature')) {
      debugWarn(1, `[Resolution] pw_lukka_exile_upgrade: invalid target`);
      return;
    }

    const exiledMv = Number(perm?.card?.cmc ?? 0);

    // Exile the target creature you control.
    battlefield.splice(idx, 1);
    const zones = (state.zones = state.zones || {});
    const owner = String(perm?.owner || perm?.controller || controllerId);
    const ownerZones = (zones[owner] = zones[owner] || {
      hand: [],
      handCount: 0,
      libraryCount: 0,
      graveyard: [],
      graveyardCount: 0,
      exile: [],
      exileCount: 0,
    });
    ownerZones.exile = Array.isArray(ownerZones.exile) ? ownerZones.exile : (ownerZones.exile = []);
    if (!perm.isToken && perm.card) {
      ownerZones.exile.push({ ...(perm.card || {}), zone: 'exile' });
      ownerZones.exileCount = ownerZones.exile.length;
    }

    // Reveal until a creature card with greater MV.
    const lib: any[] = (game as any).libraries?.get?.(controllerId) || [];
    const revealed: any[] = [];
    let found: any = null;
    while (Array.isArray(lib) && lib.length > 0) {
      const c = lib.shift();
      if (!c) break;
      revealed.push(c);
      const tl = String(c?.type_line || '').toLowerCase();
      const isCreature = tl.includes('creature');
      const mv = Number(c?.cmc ?? 0);
      if (isCreature && mv > exiledMv) {
        found = c;
        break;
      }
    }

    if (found) {
      const tl = String(found?.type_line || '').toLowerCase();
      const isCreature = tl.includes('creature');
      const hasHaste =
        String(found?.oracle_text || '').toLowerCase().includes('haste') ||
        (Array.isArray(found?.keywords) && found.keywords.some((k: any) => String(k || '').toLowerCase() === 'haste'));

      const newPermanent: any = {
        id: uid('perm'),
        controller: controllerId,
        owner: controllerId,
        tapped: false,
        counters: {},
        basePower: isCreature ? parsePT(found?.power) : undefined,
        baseToughness: isCreature ? parsePT(found?.toughness) : undefined,
        summoningSickness: isCreature && !hasHaste,
        card: { ...found, zone: 'battlefield' },
      };
      battlefield.push(newPermanent);
    }

    const rest = revealed.filter((c: any) => c && c !== found);
    const restBottom = [...rest].sort(() => Math.random() - 0.5);
    for (const c of restBottom) {
      lib.push({ ...c, zone: 'library' });
    }

    // Update counts + persist library.
    const controllerZones = (zones[controllerId] = zones[controllerId] || {
      hand: [],
      handCount: 0,
      libraryCount: 0,
      graveyard: [],
      graveyardCount: 0,
      exile: [],
      exileCount: 0,
    });
    controllerZones.libraryCount = Array.isArray(lib) ? lib.length : controllerZones.libraryCount;
    if ((game as any).libraries?.set && Array.isArray(lib)) {
      (game as any).libraries.set(controllerId, lib);
    }

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${sourceName}: ${getPlayerName(game, controllerId)} exiled ${perm.card?.name || 'a creature'} and revealed cards until a creature with greater mana value was found.`,
      ts: Date.now(),
    });

    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    broadcastGame(io, game, gameId);
    return;
  }

  if (action === 'destroy_artifact_enchantment') {
    const state = game.state || {};
    const battlefield = state.battlefield || [];
    for (const tid of selections) {
      const perm = battlefield.find((p: any) => p.id === tid);
      if (!perm) continue;
      const idx = battlefield.indexOf(perm);
      if (idx >= 0) battlefield.splice(idx, 1);
      const controller = perm.controller;
      state.zones = state.zones || {};
      state.zones[controller] = state.zones[controller] || { graveyard: [], graveyardCount: 0 } as any;
      const graveyard = state.zones[controller].graveyard || [];
      graveyard.push({ ...(perm.card || {}), zone: 'graveyard' });
      state.zones[controller].graveyard = graveyard;
      state.zones[controller].graveyardCount = graveyard.length;
      debug(2, `[Resolution] Destroyed ${perm.card?.name || perm.id} (Aura Shards effect)`);
    }
    broadcastGame(io, game, gameId);
    return;
  }
  
  if (action === 'tap_or_untap_target') {
    const targetId = selections[0];
    const battlefield = game.state?.battlefield || [];
    const targetPerm = battlefield.find((p: any) => p.id === targetId);
    const targetName = targetPerm?.card?.name || 'Permanent';
    // Enqueue follow-up option choice for tap/untap decision
    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: pid as any,
      description: `${step.sourceName || 'Ability'}: Tap or untap ${targetName}`,
      mandatory: true,
      sourceId: step.sourceId,
      sourceName: step.sourceName,
      options: [
        { id: 'tap', label: 'Tap it' },
        { id: 'untap', label: 'Untap it' },
      ],
      minSelections: 1,
      maxSelections: 1,
      action: 'tap_or_untap_decision',
      targetId,
    } as any);
    return;
  }
  
  // Handle begin_combat_target_buff for triggers like Heidegger
  if (action === 'begin_combat_target_buff') {
    const targetId = selections[0];
    const battlefield = game.state?.battlefield || [];
    const targetPerm = battlefield.find((p: any) => p.id === targetId);
    
    if (targetPerm) {
      const effectDescription = (step as any).effectDescription || '';
      const targetName = targetPerm.card?.name || 'Creature';
      const sourceName = step.sourceName || 'Trigger';
      
      // Parse the effect - look for +X/+0 or +X/+X patterns
      // Common patterns: "gets +X/+0 until end of turn" where X is based on something
      const lowerEffect = effectDescription.toLowerCase();
      
      // Check for "where X is the number of Soldiers/creatures/etc." pattern
      const xCountMatch = lowerEffect.match(/gets \+x\/\+(\d+).*where x is (?:the number of )?(\w+)/i);
      
      if (xCountMatch) {
        const toughnessBonus = parseInt(xCountMatch[1], 10) || 0;
        const countType = xCountMatch[2].toLowerCase();
        
        // Count the relevant permanents using word boundary regex for accurate matching
        let xValue = 0;
        const typePattern = new RegExp(`\\b${countType}s?\\b`, 'i'); // Match singular and plural
        for (const perm of battlefield) {
          if (perm.controller !== pid) continue;
          const typeLine = (perm.card?.type_line || '').toLowerCase();
          
          if (countType === 'soldiers' || countType === 'soldier') {
            if (typePattern.test(typeLine)) xValue++;
          } else if (countType === 'creatures' || countType === 'creature') {
            if (typeLine.includes('creature')) xValue++;
          } else {
            // Generic type check with word boundary
            if (typePattern.test(typeLine)) xValue++;
          }
        }
        
        // Apply the buff as a temporary effect
        targetPerm.grantedAbilities = targetPerm.grantedAbilities || [];
        targetPerm.grantedAbilities.push(`+${xValue}/+${toughnessBonus} until end of turn`);
        
        // Store temporary P/T modification
        targetPerm.temporaryPTMods = targetPerm.temporaryPTMods || [];
        targetPerm.temporaryPTMods.push({ power: xValue, toughness: toughnessBonus, until: 'end_of_turn' });
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${sourceName}: ${targetName} gets +${xValue}/+${toughnessBonus} until end of turn.`,
          ts: Date.now(),
        });
        
        debug(2, `[Resolution] Begin combat target buff: ${targetName} gets +${xValue}/+${toughnessBonus} (X=${xValue} ${countType})`);
      } else {
        // Try to parse a simple +X/+Y pattern
        const simpleBuffMatch = lowerEffect.match(/gets \+(\d+)\/\+(\d+)/i);
        if (simpleBuffMatch) {
          const powerBonus = parseInt(simpleBuffMatch[1], 10);
          const toughnessBonus = parseInt(simpleBuffMatch[2], 10);
          
          targetPerm.grantedAbilities = targetPerm.grantedAbilities || [];
          targetPerm.grantedAbilities.push(`+${powerBonus}/+${toughnessBonus} until end of turn`);
          
          targetPerm.temporaryPTMods = targetPerm.temporaryPTMods || [];
          targetPerm.temporaryPTMods.push({ power: powerBonus, toughness: toughnessBonus, until: 'end_of_turn' });
          
          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message: `${sourceName}: ${targetName} gets +${powerBonus}/+${toughnessBonus} until end of turn.`,
            ts: Date.now(),
          });
          
          debug(2, `[Resolution] Begin combat target buff: ${targetName} gets +${powerBonus}/+${toughnessBonus}`);
        }
      }
    }

    // This begin-combat workflow uses a Resolution Queue prompt mid-resolution.
    // Remove the original triggered ability from the stack so it doesn't re-prompt.
    const stack = game.state?.stack || [];
    const stackItemId = step.sourceId;
    if (stackItemId) {
      const idx = stack.findIndex((it: any) => it?.id === stackItemId);
      if (idx !== -1) {
        const it = stack[idx];
        if (it?.type === 'triggered_ability' && it?.triggerType === 'begin_combat') {
          stack.splice(idx, 1);
          debug(2, `[Resolution] Removed begin_combat trigger from stack (id: ${stackItemId})`);
        }
      }
    }

    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    broadcastGame(io, game, gameId);
    return;
  }

  if (action === 'move_graveyard_card_to_hand') {
    const selectedCardId = selections[0];
    const fromPlayerId = String((step as any).fromPlayerId || pid);
    const zones = game.state?.zones || (game.state.zones = {});
    zones[fromPlayerId] = zones[fromPlayerId] || {};
    zones[fromPlayerId].graveyard = zones[fromPlayerId].graveyard || [];
    zones[fromPlayerId].hand = zones[fromPlayerId].hand || [];

    if (!selectedCardId) {
      // "up to one" selection
      debug(2, `[Resolution] move_graveyard_card_to_hand: no selection`);
      return;
    }

    const gy: any[] = zones[fromPlayerId].graveyard;
    const idx = gy.findIndex((c: any) => c?.id === selectedCardId);
    if (idx === -1) {
      debugWarn(1, `[Resolution] move_graveyard_card_to_hand: card not found in graveyard: ${selectedCardId}`);
      return;
    }

    const [card] = gy.splice(idx, 1);
    zones[fromPlayerId].hand.push({ ...card, zone: 'hand' });

    zones[fromPlayerId].graveyardCount = zones[fromPlayerId].graveyard.length;
    zones[fromPlayerId].handCount = zones[fromPlayerId].hand.length;

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, fromPlayerId)} returns ${card?.name || 'a card'} from their graveyard to their hand (${step.sourceName || 'Effect'}).`,
      ts: Date.now(),
    });

    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    broadcastGame(io, game, gameId);
    return;
  }

  if (action === 'move_graveyard_card_to_battlefield') {
    const selectedCardId = selections[0];
    const fromPlayerId = String((step as any).fromPlayerId || pid);
    const zones = game.state?.zones || (game.state.zones = {});
    zones[fromPlayerId] = zones[fromPlayerId] || {};
    zones[fromPlayerId].graveyard = zones[fromPlayerId].graveyard || [];

    if (!selectedCardId) {
      debugWarn(1, `[Resolution] move_graveyard_card_to_battlefield: missing selection`);
      return;
    }

    const gy: any[] = zones[fromPlayerId].graveyard;
    const idx = gy.findIndex((c: any) => c?.id === selectedCardId);
    if (idx === -1) {
      debugWarn(1, `[Resolution] move_graveyard_card_to_battlefield: card not found in graveyard: ${selectedCardId}`);
      return;
    }

    const [card] = gy.splice(idx, 1);
    zones[fromPlayerId].graveyardCount = zones[fromPlayerId].graveyard.length;

    const battlefield = (game.state.battlefield = game.state.battlefield || []);
    const tl = String(card?.type_line || '').toLowerCase();
    const isCreature = tl.includes('creature');
    const isPlaneswalker = tl.includes('planeswalker');

    const hasHaste =
      String(card?.oracle_text || '').toLowerCase().includes('haste') ||
      (Array.isArray(card?.keywords) && card.keywords.some((k: any) => String(k || '').toLowerCase() === 'haste'));

    const newPermanent: any = {
      id: uid('perm'),
      controller: pid,
      owner: fromPlayerId,
      tapped: false,
      counters: {},
      basePower: isCreature ? parsePT(card?.power) : undefined,
      baseToughness: isCreature ? parsePT(card?.toughness) : undefined,
      summoningSickness: isCreature && !hasHaste,
      card: { ...card, zone: 'battlefield' },
    };

    if (isPlaneswalker && card?.loyalty) {
      const loyaltyValue = parseInt(String(card.loyalty), 10);
      if (!Number.isNaN(loyaltyValue)) {
        newPermanent.counters = { ...newPermanent.counters, loyalty: loyaltyValue };
        newPermanent.loyalty = loyaltyValue;
        newPermanent.baseLoyalty = loyaltyValue;
      }
    }

    battlefield.push(newPermanent);

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, pid)} returns ${card?.name || 'a card'} from their graveyard to the battlefield (${step.sourceName || 'Effect'}).`,
      ts: Date.now(),
    });

    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    broadcastGame(io, game, gameId);
    return;
  }

  if (action === 'exile_graveyard_card') {
    const selectedCardId = selections[0];
    const zones = game.state?.zones || (game.state.zones = {});

    if (!selectedCardId) {
      debugWarn(1, `[Resolution] exile_graveyard_card: missing selection`);
      return;
    }

    let foundOwner: string | null = null;
    let foundCard: any = null;

    for (const playerId of Object.keys(zones)) {
      const gy: any[] = zones[playerId]?.graveyard || [];
      const idx = gy.findIndex((c: any) => c?.id === selectedCardId);
      if (idx !== -1) {
        foundOwner = playerId;
        foundCard = gy.splice(idx, 1)[0];
        zones[playerId].graveyardCount = zones[playerId].graveyard.length;
        break;
      }
    }

    if (!foundOwner || !foundCard) {
      debugWarn(1, `[Resolution] exile_graveyard_card: card not found in any graveyard: ${selectedCardId}`);
      return;
    }

    zones[foundOwner].exile = zones[foundOwner].exile || [];
    zones[foundOwner].exile.push({ ...foundCard, zone: 'exile' });
    zones[foundOwner].exileCount = zones[foundOwner].exile.length;

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, pid)} exiles ${foundCard?.name || 'a card'} from ${getPlayerName(game, foundOwner)}'s graveyard (${step.sourceName || 'Effect'}).`,
      ts: Date.now(),
    });

    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    broadcastGame(io, game, gameId);
    return;
  }

  if (action === 'destroy_target_creature_or_planeswalker') {
    const targetId = selections[0];
    if (!targetId) {
      debugWarn(1, `[Resolution] destroy_target_creature_or_planeswalker: missing selection`);
      return;
    }

    const state = game.state || {};
    const battlefield = state.battlefield || [];
    const idx = battlefield.findIndex((p: any) => p?.id === targetId);
    if (idx === -1) {
      debugWarn(1, `[Resolution] destroy_target_creature_or_planeswalker: target not on battlefield: ${targetId}`);
      return;
    }

    const [perm] = battlefield.splice(idx, 1);
    const tl = String(perm?.card?.type_line || '').toLowerCase();
    if (!(tl.includes('creature') || tl.includes('planeswalker'))) {
      debugWarn(1, `[Resolution] destroy_target_creature_or_planeswalker: invalid target type: ${perm?.card?.type_line}`);
      return;
    }

    const owner = perm.owner || perm.controller || pid;
    state.zones = state.zones || {};
    state.zones[owner] = state.zones[owner] || ({ hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 } as any);
    state.zones[owner].graveyard = state.zones[owner].graveyard || [];

    if (!perm.isToken) {
      state.zones[owner].graveyard.push({ ...(perm.card || {}), zone: 'graveyard' });
      state.zones[owner].graveyardCount = state.zones[owner].graveyard.length;
    }

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${step.sourceName || 'Effect'}: ${perm.card?.name || 'Permanent'} was destroyed.`,
      ts: Date.now(),
    });

    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    broadcastGame(io, game, gameId);
    return;
  }
  
  // Handle SOLDIER Military Program counter placement selection
  if ((step as any).soldierProgramCounters) {
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
    return;
  }
  
  // Handle planeswalker ability target selection
  // Planeswalker abilities store their data in step.planeswalkerAbility
  const pwAbility = (step as any).planeswalkerAbility;
  if (pwAbility) {
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
    
    // Put the loyalty ability on the stack WITH targets
    const stackItem = {
      id: `ability_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'ability' as const,
      controller: pid,
      source: permanentId,
      sourceName: cardName,
      description: abilityText,
      targets: selections,  // Include selected targets
      planeswalker: {
        oracleId: (permanent as any)?.card?.oracle_id,
        abilityIndex,
        loyaltyCost,
      },
    };
    
    game.state.stack = game.state.stack || [];
    game.state.stack.push(stackItem);
    
    // Emit stack update
    io.to(gameId).emit("stackUpdate", {
      gameId,
      stack: (game.state.stack || []).map((s: any) => ({
        id: s.id,
        type: s.type,
        name: s.sourceName || s.card?.name || 'Ability',
        controller: s.controller,
        targets: s.targets,
        source: s.source,
        sourceName: s.sourceName,
        description: s.description,
      })),
    });
    
    // Record the event for replay/undo
    appendEvent(gameId, (game as any).seq ?? 0, "activatePlaneswalkerAbility", { 
      playerId: pid, 
      permanentId, 
      abilityIndex, 
      loyaltyCost,
      newLoyalty,
      targets: selections,
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
    return;
  }
  
  // ========================================================================
  // AUTO-UNIGNORE: Remove targeted permanents from ignore list
  // When a permanent becomes the target of an opponent's spell/ability,
  // automatically remove it from the ignore list so the player can respond.
  // ========================================================================
  const stateAny = game.state as any;
  if (stateAny.ignoredCardsForAutoPass) {
    const battlefield = game.state.battlefield || [];
    
    for (const targetId of selections) {
      // Find the target permanent
      const targetPerm = battlefield.find((p: any) => p.id === targetId);
      if (!targetPerm) continue;
      
      // Check if this is a permanent controlled by another player
      const targetController = targetPerm.controller;
      if (targetController && targetController !== pid) {
        // Check if the target is in the controller's ignore list
        const controllerIgnored = stateAny.ignoredCardsForAutoPass[targetController];
        if (controllerIgnored && controllerIgnored[targetId]) {
          const cardName = controllerIgnored[targetId].cardName;
          delete controllerIgnored[targetId];
          
          debug(2, `[Resolution] Auto-unignored ${cardName} (${targetId}) - targeted by opponent's spell`);
          
          // Notify the controller that their card was auto-unignored
          emitToPlayer(io, targetController, "cardUnignoredAutomatically", {
            gameId,
            playerId: targetController,
            permanentId: targetId,
            cardName,
            reason: "targeted by opponent's spell or ability",
          });
          
          // Send updated ignored cards list to the controller
          const updatedList = Object.entries(controllerIgnored).map(([id, data]: [string, any]) => ({
            permanentId: id,
            cardName: data.cardName,
            imageUrl: data.imageUrl,
          }));
          
          emitToPlayer(io, targetController, "ignoredCardsUpdated", {
            gameId,
            playerId: targetController,
            ignoredCards: updatedList,
          });
        }
      }
    }
  }
  
  // ========================================================================
  // SPELL CASTING TARGET SELECTION
  // When a spell requires targets and is being cast via Resolution Queue,
  // we need to request payment after targets are selected (MTG Rule 601.2h)
  // ========================================================================
  const spellCastContext = targetStepData.spellCastContext;
  if (spellCastContext) {
    const { cardId, cardName, manaCost, effectId, oracleText, imageUrl } = spellCastContext;
    
    // Store targets with the pending cast for validation during payment
    const pendingCast = (game.state as any).pendingSpellCasts?.[effectId];
    if (pendingCast) {
      // Validate selected targets are valid
      const validTargetIds = pendingCast.validTargetIds || [];
      const validTargetSet = new Set(validTargetIds);
      const invalidTargets = selections.filter((t: string) => !validTargetSet.has(t));
      
      if (invalidTargets.length > 0) {
        debugWarn(1, `[Resolution] Invalid targets selected: ${invalidTargets.join(', ')} for ${cardName}`);
        
        // Clean up pending spell cast
        delete (game.state as any).pendingSpellCasts[effectId];
        
        // Emit error to player
        emitToPlayer(io, pid, "error", {
          code: "INVALID_TARGETS",
          message: `Invalid targets selected for ${cardName}. The targets don't meet the spell's requirements.`,
        });
        
        broadcastGame(io, game, gameId);
        return;
      }
      
      // Store targets with the pending cast
      pendingCast.targets = selections;
      
      // Calculate final mana cost, accounting for Strive and other target-based modifiers
      let finalManaCost = manaCost;
      let striveCostMessage = '';
      
      // Check for Strive additional cost
      const cardOracleText = pendingCast.card?.oracle_text || oracleText || '';
      const striveMatch = cardOracleText.match(/\bStrive\s*[—\-]\s*This spell costs\s+(\{[^}]+\}(?:\s*\{[^}]+\})*)\s+more to cast for each target beyond the first/i);
      if (striveMatch && selections.length > 1) {
        const striveCostPer = striveMatch[1].trim();
        const additionalTargets = selections.length - 1;
        
        // Build the additional cost string
        let additionalCost = '';
        for (let i = 0; i < additionalTargets; i++) {
          additionalCost += striveCostPer;
        }
        
        finalManaCost = finalManaCost + additionalCost;
        striveCostMessage = ` (Strive: +${striveCostPer} × ${additionalTargets} for ${selections.length} targets)`;
        debug(1, `[Resolution] Strive cost added: base ${manaCost} + ${additionalCost} = ${finalManaCost}`);
      }
      
      // Update the pending cast with the final cost
      pendingCast.finalManaCost = finalManaCost;
      
      // Emit payment required event
      emitToPlayer(io, pid, "paymentRequired", {
        gameId,
        cardId,
        cardName: cardName + striveCostMessage,
        manaCost: finalManaCost,
        effectId,
        targets: selections,
        imageUrl,
      });
      
      debug(2, `[Resolution] Spell target selection complete for ${cardName}, requesting payment`);
    } else {
      debugWarn(1, `[Resolution] No pending spell cast found for effectId: ${effectId}`);
    }
    
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }
    
    broadcastGame(io, game, gameId);
    return;
  }
  
  debug(1, `[Resolution] Target selection: ${selections?.join(', ')}`);
  
  // Clear legacy pending state if present
  if (game.state.pendingTargets?.[pid]) {
    delete game.state.pendingTargets[pid];
  }
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}

/**
 * Handle trigger ordering response
 */
function handleTriggerOrderResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const pid = response.playerId;
  const orderedTriggerIds = response.selections as string[];
  
  if (!Array.isArray(orderedTriggerIds)) {
    debugWarn(1, `[Resolution] Invalid trigger order: not an array`);
    return;
  }
  
  // Get trigger step data for validation
  const triggerStep = step as any;
  const triggers = triggerStep.triggers || [];
  const requireAll = triggerStep.requireAll !== false; // default true
  
  // Validate all trigger IDs are in the triggers list
  const validTriggerIds = new Set(triggers.map((t: any) => t.id));
  for (const triggerId of orderedTriggerIds) {
    if (!validTriggerIds.has(triggerId)) {
      debugWarn(1, `[Resolution] Invalid trigger ID in order: ${triggerId} not in valid triggers`);
      return;
    }
  }
  
  // If requireAll is true, ensure all triggers are included
  if (requireAll && orderedTriggerIds.length !== triggers.length) {
    debugWarn(1, `[Resolution] Invalid trigger order: expected all ${triggers.length} triggers, got ${orderedTriggerIds.length}`);
    return;
  }
  
  // Actually reorder the triggers on the stack
  // IMPORTANT: In this codebase, the top of stack is the END of the array (stack.pop()).
  // The client provides the desired RESOLUTION order (first in list resolves first).
  // Therefore, the first chosen trigger must be placed LAST in the stack array.
  const stack = game.state?.stack || [];
  
  // Find the trigger items on the stack by ID or triggerId
  // We check both because triggers might be stored with either field
  const foundTriggerItems = orderedTriggerIds.map(id => 
    stack.find((item: any) => item.id === id || item.triggerId === id)
  ).filter(Boolean);
  
  if (foundTriggerItems.length > 0) {
    // Remove all these triggers from stack
    for (const trigger of foundTriggerItems) {
      const idx = stack.indexOf(trigger);
      if (idx !== -1) {
        stack.splice(idx, 1);
      }
    }
    
    // Add them back so that orderedTriggerIds[0] becomes the top-of-stack (last element).
    // foundTriggerItems is in the same order as orderedTriggerIds.
    for (let i = foundTriggerItems.length - 1; i >= 0; i--) {
      stack.push(foundTriggerItems[i]);
    }
    
    debug(1, `[Resolution] Reordered ${foundTriggerItems.length} triggers on stack`);
  } else {
    debugWarn(2, `[Resolution] No trigger items found on stack to reorder`);
  }
  
  debug(1, `[Resolution] Trigger order: ${orderedTriggerIds?.join(', ')}`);
  
  // Clear legacy pending state if present
  if (game.state.pendingTriggerOrdering?.[pid]) {
    delete game.state.pendingTriggerOrdering[pid];
  }
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}

/**
 * Handle Kynaios and Tiro style choice response
 * Player can either play a land from hand, draw a card (opponents), or decline (controller)
 */
function handleKynaiosChoiceResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const pid = response.playerId;
  const selection = response.selections;
  
  // Extract choice and landCardId from selection
  let choice: string;
  let landCardId: string | undefined;
  
  if (typeof selection === 'object' && selection !== null && !Array.isArray(selection)) {
    choice = (selection as any).choice || 'decline';
    landCardId = (selection as any).landCardId;
  } else if (Array.isArray(selection) && selection.length > 0) {
    choice = selection[0];
    landCardId = selection[1];
  } else {
    choice = String(selection || 'decline');
  }
  
  const stepData = step as any;
  const isController = stepData.isController || false;
  const sourceController = stepData.sourceController || pid;
  const sourceName = step.sourceName || 'Kynaios and Tiro of Meletis';
  const canPlayLand = stepData.canPlayLand !== false; // default true if not specified
  const landsInHand = stepData.landsInHand || [];
  const options = stepData.options || ['play_land', 'draw_card', 'decline'];
  
  // Validate choice is in allowed options
  if (!options.includes(choice as any)) {
    debugWarn(1, `[Resolution] Invalid Kynaios choice: ${choice} not in allowed options`);
    return;
  }
  
  debug(2, `[Resolution] Kynaios choice: player=${pid}, choice=${choice}, landCardId=${landCardId}, isController=${isController}`);
  
  if (choice === 'play_land' && landCardId) {
    // Validate player can play land
    if (!canPlayLand) {
      debugWarn(1, `[Resolution] Kynaios: player ${pid} cannot play land`);
      return;
    }
    
    // Validate landCardId is in landsInHand list
    const isValidLand = landsInHand.some((land: any) => land.id === landCardId);
    if (!isValidLand) {
      debugWarn(1, `[Resolution] Invalid Kynaios land choice: ${landCardId} not in hand`);
      return;
    }
    
    // Move the land from hand to battlefield
    const zones = game.state?.zones?.[pid];
    if (zones?.hand) {
      const cardIndex = zones.hand.findIndex((c: any) => c.id === landCardId);
      if (cardIndex !== -1) {
        const [card] = zones.hand.splice(cardIndex, 1);
        const cardName = card.name || 'a land';
        
        // Create battlefield permanent
        const permanentId = `perm_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        const permanent = {
          id: permanentId,
          controller: pid,
          owner: pid,
          tapped: false,
          counters: {},
          card: { ...card, zone: 'battlefield' },
        };
        
        // Add to battlefield
        game.state.battlefield = game.state.battlefield || [];
        game.state.battlefield.push(permanent);
        
        // Update zone counts
        zones.handCount = zones.hand.length;
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, pid)} puts ${cardName} onto the battlefield (${sourceName}).`,
          ts: Date.now(),
        });
        
        debug(2, `[Resolution] ${pid} played land ${cardName} via Kynaios choice`);
      }
    }
  } else if (choice === 'draw_card' && !isController) {
    // Opponent chose to draw a card instead of playing a land
    game.state.pendingDraws = game.state.pendingDraws || {};
    game.state.pendingDraws[pid] = (game.state.pendingDraws[pid] || 0) + 1;
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} chooses to draw a card instead of playing a land (${sourceName}).`,
      ts: Date.now(),
    });
    
    debug(2, `[Resolution] ${pid} chose to draw via Kynaios choice`);
  } else {
    // Player declined
    if (!isController) {
      // Opponent who declined gets to draw
      game.state.pendingDraws = game.state.pendingDraws || {};
      game.state.pendingDraws[pid] = (game.state.pendingDraws[pid] || 0) + 1;
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} declines to play a land and draws a card (${sourceName}).`,
        ts: Date.now(),
      });
    } else {
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} declines to play a land (${sourceName}).`,
        ts: Date.now(),
      });
    }
    
    debug(2, `[Resolution] ${pid} declined Kynaios land play option`);
  }
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}

/**
 * Handle Upkeep Sacrifice choice response
 * Player must sacrifice a creature, or if they can't, sacrifice the source (e.g., Eldrazi Monument)
 */
function handleUpkeepSacrificeResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const pid = response.playerId;
  const selection = response.selections;
  
  // Extract the selection - { type: 'creature' | 'source', creatureId?: string }
  let sacrificeType: 'creature' | 'source' = 'source';
  let creatureId: string | undefined;
  
  if (typeof selection === 'object' && selection !== null && !Array.isArray(selection)) {
    sacrificeType = (selection as any).type || 'source';
    creatureId = (selection as any).creatureId;
  } else if (typeof selection === 'string') {
    // Direct creature ID passed
    creatureId = selection;
    sacrificeType = 'creature';
  }
  
  const stepData = step as any;
  const sourceName = step.sourceName || 'Upkeep Sacrifice';
  const sourceId = stepData.sourceId;
  const sourceToSacrifice = stepData.sourceToSacrifice;
  const creatures = stepData.creatures || [];
  const allowSourceSacrifice: boolean = stepData.allowSourceSacrifice !== false;
  
  const battlefield = game.state?.battlefield || [];
  const zones = game.state?.zones || {};
  
  if (sacrificeType === 'creature' && creatureId) {
    // Validate the creature is in the valid options
    const isValidCreature = creatures.some((c: any) => c.id === creatureId);
    if (!isValidCreature) {
      debugWarn(1, `[Resolution] Invalid creature selection for upkeep sacrifice: ${creatureId}`);
      return;
    }
    
    // Find and sacrifice the creature
    const creatureIdx = battlefield.findIndex((p: any) => p.id === creatureId);
    if (creatureIdx !== -1) {
      const [sacrificed] = battlefield.splice(creatureIdx, 1);
      const creatureName = sacrificed.card?.name || 'Creature';
      const owner = sacrificed.owner || pid;
      
      // Move to graveyard (tokens cease to exist instead)
      if (!sacrificed.isToken) {
        const ownerZones = zones[owner] || (zones[owner] = { hand: [], graveyard: [], handCount: 0, graveyardCount: 0 });
        ownerZones.graveyard = ownerZones.graveyard || [];
        ownerZones.graveyard.push({ ...sacrificed.card, zone: 'graveyard' });
        ownerZones.graveyardCount = ownerZones.graveyard.length;
      }
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} sacrifices ${creatureName} for ${sourceName}.`,
        ts: Date.now(),
      });
      
      debug(2, `[Resolution] ${pid} sacrificed ${creatureName} for ${sourceName}`);
    }
  } else if (allowSourceSacrifice) {
    // Sacrifice the source (e.g., Eldrazi Monument)
    if (sourceId) {
      const sourceIdx = battlefield.findIndex((p: any) => p.id === sourceId);
      if (sourceIdx !== -1) {
        const [sacrificed] = battlefield.splice(sourceIdx, 1);
        const artifactName = sacrificed.card?.name || sourceName;
        const owner = sacrificed.owner || pid;
        
        // Move to graveyard
        if (!sacrificed.isToken) {
          const ownerZones = zones[owner] || (zones[owner] = { hand: [], graveyard: [], handCount: 0, graveyardCount: 0 });
          ownerZones.graveyard = ownerZones.graveyard || [];
          ownerZones.graveyard.push({ ...sacrificed.card, zone: 'graveyard' });
          ownerZones.graveyardCount = ownerZones.graveyard.length;
        }
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, pid)} has no creatures and sacrifices ${artifactName}.`,
          ts: Date.now(),
        });
        
        debug(2, `[Resolution] ${pid} sacrificed ${artifactName} (source) - no creatures available`);
      }
    }
  } else {
    // Creature-only sacrifice (no fallback). If there are no creatures, do as much as possible.
    if (!Array.isArray(creatures) || creatures.length === 0) {
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} has no creatures to sacrifice (${sourceName}).`,
        ts: Date.now(),
      });
      debug(2, `[Resolution] ${pid} has no creatures to sacrifice (${sourceName})`);
    } else {
      debugWarn(1, `[Resolution] Missing/invalid creature selection for creature-only sacrifice (${sourceName})`);
    }
  }
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }

  // Planeswalker helper: "You may sacrifice a creature. When you do, destroy target creature or planeswalker."
  if ((stepData as any).afterSacrificeDestroyTargetCreatureOrPlaneswalker === true) {
    const battlefieldNow = game.state?.battlefield || [];

    const validTargets = battlefieldNow
      .filter((p: any) => {
        const tl = String(p?.card?.type_line || '').toLowerCase();
        return tl.includes('creature') || tl.includes('planeswalker');
      })
      .map((p: any) => ({
        id: p.id,
        type: 'permanent',
        label: p.card?.name || 'Permanent',
        controller: p.controller,
        owner: p.owner,
        typeLine: p.card?.type_line,
        imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
        card: p.card,
        zone: 'battlefield',
      }));

    if (validTargets.length > 0) {
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: pid as any,
        description: `${sourceName}: Destroy target creature or planeswalker`,
        mandatory: true,
        sourceId: step.sourceId,
        sourceName: step.sourceName,
        validTargets,
        targetTypes: ['creature', 'planeswalker'],
        minTargets: 1,
        maxTargets: 1,
        targetDescription: 'target creature or planeswalker',
        action: 'destroy_target_creature_or_planeswalker',
      } as any);
    }
  }
}

/**
 * Handle Entrapment Maneuver response
 * Target player must sacrifice an attacking creature they control
 * The caster creates X 1/1 white Soldier tokens where X is the sacrificed creature's toughness
 */
function handleEntrapmentManeuverResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const pid = response.playerId;
  const selection = response.selections;
  
  // Extract creature ID from selection
  let creatureId: string | undefined;
  if (typeof selection === 'string') {
    creatureId = selection;
  } else if (Array.isArray(selection) && selection.length > 0) {
    creatureId = selection[0];
  } else if (typeof selection === 'object' && selection !== null) {
    creatureId = (selection as any).creatureId || (selection as any).id;
  }
  
  const stepData = step as any;
  const sourceName = step.sourceName || 'Entrapment Maneuver';
  const caster = stepData.caster;
  const attackingCreatures = stepData.attackingCreatures || [];
  
  // Validate the creature is in the valid attacking creatures list
  const validCreature = attackingCreatures.find((c: any) => c.id === creatureId);
  if (!validCreature) {
    debugWarn(1, `[Resolution] Entrapment Maneuver: Invalid creature selection ${creatureId}`);
    return;
  }
  
  const battlefield = game.state?.battlefield || [];
  const zones = game.state?.zones || {};
  
  // Find the creature on battlefield
  const creatureIdx = battlefield.findIndex((p: any) => p.id === creatureId);
  if (creatureIdx === -1) {
    debugWarn(1, `[Resolution] Entrapment Maneuver: Creature ${creatureId} not found on battlefield`);
    return;
  }
  
  const creature = battlefield[creatureIdx];
  const creatureCard = creature.card || {};
  const creatureName = creatureCard.name || 'Unknown Creature';
  
  // Get toughness for token creation
  let toughness: number;
  const toughnessStr = String(creature.baseToughness ?? creatureCard.toughness ?? "0");
  if (toughnessStr === '*' || toughnessStr.toLowerCase() === 'x') {
    // Variable toughness - try calculateVariablePT first, then fallback to counters
    const calculated = calculateVariablePT(creatureCard, game.state);
    if (calculated && calculated.toughness !== undefined) {
      toughness = calculated.toughness;
    } else {
      // Fallback: use counters only
      const plusCounters = (creature.counters?.['+1/+1']) || 0;
      const minusCounters = (creature.counters?.['-1/-1']) || 0;
      toughness = plusCounters - minusCounters;
    }
  } else {
    toughness = parseInt(toughnessStr.replace(/\D.*$/, ''), 10) || 0;
  }
  
  // Apply any toughness modifiers
  if (creature.tempToughnessMod) {
    toughness += creature.tempToughnessMod;
  }
  
  // Apply counters
  const plusCounters = (creature.counters?.['+1/+1']) || 0;
  const minusCounters = (creature.counters?.['-1/-1']) || 0;
  toughness += plusCounters - minusCounters;
  
  // Ensure toughness is at least 0 for token creation
  toughness = Math.max(0, toughness);
  
  // Sacrifice the creature
  battlefield.splice(creatureIdx, 1);
  
  // Move to owner's graveyard (if not a token)
  // Tokens cease to exist instead of going to graveyard
  if (!creature.isToken) {
    const owner = creature.owner || pid;
    zones[owner] = zones[owner] || { hand: [], graveyard: [], handCount: 0, graveyardCount: 0 };
    zones[owner].graveyard = zones[owner].graveyard || [];
    zones[owner].graveyard.push({ ...creatureCard, zone: "graveyard" });
    zones[owner].graveyardCount = zones[owner].graveyard.length;
  } else {
    debug(2, `[Resolution] Entrapment Maneuver: Token ${creatureName} ceases to exist (not moved to graveyard)`);
  }
  
  // Create Soldier tokens for the caster equal to the sacrificed creature's toughness
  if (toughness > 0) {
    game.state.battlefield = game.state.battlefield || [];
    
    for (let i = 0; i < toughness; i++) {
      const tokenId = uid('soldier_token');
      game.state.battlefield.push({
        id: tokenId,
        controller: caster,
        owner: caster,
        tapped: false,
        counters: {},
        isToken: true,
        basePower: 1,
        baseToughness: 1,
        card: {
          id: tokenId,
          name: "Soldier",
          type_line: "Token Creature — Soldier",
          power: "1",
          toughness: "1",
          zone: "battlefield",
        },
      });
    }
    
    debug(2, `[Resolution] Entrapment Maneuver: Created ${toughness} Soldier token(s) for ${caster}`);
  }
  
  debug(1, `[Resolution] Entrapment Maneuver: ${pid} sacrificed ${creatureName} (toughness ${toughness})`);
  
  // Emit chat messages
  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message: `${getPlayerName(game, pid)} sacrificed ${creatureName} (toughness ${toughness}) to ${sourceName}.`,
    ts: Date.now(),
  });
  
  if (toughness > 0) {
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}_tokens`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, caster)} created ${toughness} 1/1 white Soldier creature token${toughness !== 1 ? 's' : ''}.`,
      ts: Date.now(),
    });
  }
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
  
  broadcastGame(io, game, gameId);
}

/**
 * Handle Join Forces mana contribution response
 * Each player may pay any amount of mana to contribute to the effect
 */
function handleJoinForcesResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const pid = response.playerId;
  const selection = response.selections;
  
  // Extract contribution amount from selection
  let contribution = 0;
  if (typeof selection === 'number') {
    contribution = Math.max(0, Math.floor(selection));
  } else if (typeof selection === 'object' && selection !== null && !Array.isArray(selection)) {
    contribution = Math.max(0, Math.floor((selection as any).amount || 0));
  }
  
  const stepData = step as any;
  const cardName = stepData.cardName || step.sourceName || 'Join Forces';
  const initiator = stepData.initiator;
  const availableMana = stepData.availableMana || 0;
  
  // Validate contribution doesn't exceed available mana
  if (contribution > availableMana) {
    debugWarn(1, `[Resolution] Join Forces: contribution ${contribution} exceeds available mana ${availableMana} for player ${pid}`);
    return; // Reject invalid contribution
  }

  // Spend mana by tapping sources (Join Forces is a mana payment, not floating mana).
  // This is intentionally a simple/optimistic model: we tap lands first, then mana rocks/dorks.
  // Mana Flare / Heartbeat / Dictate are approximated as +1 extra mana per land tap.
  if (contribution > 0) {
    try {
      const battlefield = (game.state?.battlefield || []) as any[];
      const globalLandExtra = battlefield.some((p: any) => {
        const name = String(p?.card?.name || '').toLowerCase();
        return name.includes('mana flare') || name.includes('heartbeat of spring') || name.includes('dictate of karametra');
      });

      let remaining = contribution;

      // Tap lands first
      for (const perm of battlefield) {
        if (remaining <= 0) break;
        if (!perm || perm.controller !== pid) continue;
        if (perm.tapped) continue;
        const typeLine = String(perm.card?.type_line || '').toLowerCase();
        if (!typeLine.includes('land')) continue;

        perm.tapped = true;
        remaining -= globalLandExtra ? 2 : 1;
      }

      // Then tap other mana sources (mana dorks/rocks), 1 mana each (conservative)
      if (remaining > 0) {
        for (const perm of battlefield) {
          if (remaining <= 0) break;
          if (!perm || perm.controller !== pid) continue;
          if (perm.tapped) continue;
          if (!perm.card) continue;

          const oracle = String(perm.card?.oracle_text || '').toLowerCase();
          if (!oracle.includes('{t}:') || !oracle.includes('add')) continue;

          // Respect summoning sickness for creatures with tap abilities
          const tl = String(perm.card?.type_line || '').toLowerCase();
          const isCreature = tl.includes('creature');
          const isLand = tl.includes('land');
          if (isCreature && !isLand && perm.summoningSickness) {
            const hasHaste = creatureHasHaste(perm, battlefield as any, pid as any);
            if (!hasHaste) continue;
          }

          perm.tapped = true;
          remaining -= 1;
        }
      }

      if (remaining > 0) {
        debugWarn(1, `[Resolution] Join Forces: tapped sources still short by ${remaining} for ${pid}`);
      }
    } catch (err) {
      debugWarn(1, `[Resolution] Join Forces: failed to tap mana sources for ${pid}:`, err);
    }
  }
  
  debug(1, `[Resolution] Join Forces: player=${pid} contributed ${contribution} mana to ${cardName}`);
  
  // Track contributions in game state for effect resolution
  game.state.joinForcesContributions = game.state.joinForcesContributions || {};
  game.state.joinForcesContributions[cardName] = game.state.joinForcesContributions[cardName] || { 
    total: 0, 
    byPlayer: {},
    initiator,
    cardName 
  };
  game.state.joinForcesContributions[cardName].total += contribution;
  game.state.joinForcesContributions[cardName].byPlayer[pid] = contribution;
  
  // Notify players of the contribution
  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message: contribution > 0 
      ? `${getPlayerName(game, pid)} contributes ${contribution} mana to ${cardName}.`
      : `${getPlayerName(game, pid)} declines to contribute mana to ${cardName}.`,
    ts: Date.now(),
  });
  
  // Check if all players have responded - if so, apply the effect
  const queue = ResolutionQueueManager.getQueue(gameId);
  const remainingJoinForcesSteps = queue.steps.filter(s => 
    s.type === ResolutionStepType.JOIN_FORCES && 
    (s as any).cardName === cardName
  );
  
  if (remainingJoinForcesSteps.length === 0) {
    // All players have responded - apply the Join Forces effect
    const contributions = game.state.joinForcesContributions[cardName];
    const total = contributions.total;
    
    applyJoinForcesEffect(io, game, gameId, cardName, total, contributions.byPlayer, initiator);
    
    // Clean up
    delete game.state.joinForcesContributions[cardName];
  }
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}

/**
 * Apply the actual Join Forces effect based on total mana contributed
 */
function applyJoinForcesEffect(
  io: Server,
  game: any,
  gameId: string,
  cardName: string,
  totalContributions: number,
  byPlayer: Record<string, number>,
  initiator: string
): void {
  const cardNameLower = cardName.toLowerCase();
  const players = game.state?.players || [];
  const battlefield = game.state.battlefield = game.state.battlefield || [];
  
  debug(1, `[Resolution] Applying Join Forces effect: ${cardName} with ${totalContributions} total mana`);
  
  // Minds Aglow: Each player draws X cards
  if (cardNameLower.includes('minds aglow')) {
    const ctx: GameContext = {
      state: game.state,
      libraries: (game as any).libraries,
      bumpSeq: () => {
        if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
      },
      rng: (game as any).rng,
    } as any;

    for (const p of players) {
      if (p.hasLost) continue;
      try {
        drawCardsFromZones(ctx, p.id, totalContributions);
      } catch (err) {
        debugWarn(1, `[Resolution] Minds Aglow: draw failed for ${p.id}:`, err);
      }
    }
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `📚 Minds Aglow: Each player draws ${totalContributions} cards!`,
      ts: Date.now(),
    });
  }
  // Collective Voyage: Each player may search for X basic lands
  else if (cardNameLower.includes('collective voyage')) {
    for (const p of players) {
      if (p.hasLost) continue;
      createLibrarySearchStep(game, gameId, p.id, {
        searchFor: `up to ${totalContributions} basic land card(s)`,
        destination: 'battlefield',
        tapped: true,
        optional: true,
        source: 'Collective Voyage',
        shuffleAfter: true,
        maxSelections: totalContributions,
        filter: { types: ['land'], supertypes: ['basic'] },
      });
    }
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `🌲 Collective Voyage: Each player may search for up to ${totalContributions} basic land cards!`,
      ts: Date.now(),
    });
  }
  // Alliance of Arms: Each player creates X Soldier tokens
  else if (cardNameLower.includes('alliance of arms')) {
    for (const p of players) {
      if (p.hasLost) continue;
      for (let i = 0; i < totalContributions; i++) {
        const tokenId = `tok_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${i}`;
        battlefield.push({
          id: tokenId,
          controller: p.id,
          owner: p.id,
          tapped: false,
          counters: {},
          isToken: true,
          card: {
            id: tokenId,
            name: 'Soldier Token',
            type_line: 'Token Creature — Soldier',
            power: '1',
            toughness: '1',
            colors: ['W'],
          },
        });
      }
    }
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `⚔️ Alliance of Arms: Each player creates ${totalContributions} 1/1 white Soldier tokens!`,
      ts: Date.now(),
    });
  }
  // Shared Trauma: Each player mills X cards
  else if (cardNameLower.includes('shared trauma')) {
    for (const p of players) {
      if (p.hasLost) continue;
      game.state.pendingMill = game.state.pendingMill || {};
      game.state.pendingMill[p.id] = (game.state.pendingMill[p.id] || 0) + totalContributions;
    }
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `💀 Shared Trauma: Each player mills ${totalContributions} cards!`,
      ts: Date.now(),
    });
  }
  
  // Emit Join Forces complete event
  io.to(gameId).emit("joinForcesComplete", {
    id: `jf_${Date.now()}`,
    gameId,
    cardName,
    contributions: byPlayer,
    totalContributions,
    initiator,
  });
}

/**
 * Handle Tempting Offer accept/decline response
 * Each opponent may accept the tempting offer
 */
function handleTemptingOfferResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const pid = response.playerId;
  const selection = response.selections;
  
  // Extract acceptance from selection
  let accepted = false;
  if (typeof selection === 'boolean') {
    accepted = selection;
  } else if (typeof selection === 'object' && selection !== null && !Array.isArray(selection)) {
    accepted = Boolean((selection as any).accept || (selection as any).accepted);
  } else if (typeof selection === 'string') {
    accepted = selection === 'accept' || selection === 'true';
  }
  
  const stepData = step as any;
  const cardName = stepData.cardName || step.sourceName || 'Tempting Offer';
  const initiator = stepData.initiator;
  
  debug(2, `[Resolution] Tempting Offer: player=${pid} ${accepted ? 'ACCEPTS' : 'DECLINES'} ${cardName}`);
  
  // Track responses in game state for effect resolution
  game.state.temptingOfferResponses = game.state.temptingOfferResponses || {};
  game.state.temptingOfferResponses[cardName] = game.state.temptingOfferResponses[cardName] || { 
    acceptedBy: [],
    initiator,
    cardName 
  };
  
  if (accepted) {
    game.state.temptingOfferResponses[cardName].acceptedBy.push(pid);
  }
  
  // Notify players of the response
  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message: accepted 
      ? `✅ ${getPlayerName(game, pid)} accepts the tempting offer from ${cardName}!`
      : `❌ ${getPlayerName(game, pid)} declines the tempting offer from ${cardName}.`,
    ts: Date.now(),
  });
  
  // Check if all opponents have responded - if so, apply the effect
  const queue = ResolutionQueueManager.getQueue(gameId);
  const remainingTemptingOfferSteps = queue.steps.filter(s => 
    s.type === ResolutionStepType.TEMPTING_OFFER && 
    (s as any).cardName === cardName
  );
  
  if (remainingTemptingOfferSteps.length === 0) {
    // All opponents have responded - apply the Tempting Offer effect
    const responses = game.state.temptingOfferResponses[cardName];
    const acceptedBy = responses.acceptedBy;
    const initiatorBonusCount = 1 + acceptedBy.length; // Initiator gets effect once plus for each acceptor
    
    applyTemptingOfferEffect(io, game, gameId, cardName, acceptedBy, initiator, initiatorBonusCount);
    
    // Clean up
    delete game.state.temptingOfferResponses[cardName];
  }
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}

/**
 * Apply the actual Tempting Offer effect
 */
function applyTemptingOfferEffect(
  io: Server,
  game: any,
  gameId: string,
  cardName: string,
  acceptedBy: string[],
  initiator: string,
  initiatorBonusCount: number
): void {
  const cardNameLower = cardName.toLowerCase();
  const battlefield = game.state.battlefield = game.state.battlefield || [];
  
  debug(2, `[Resolution] Applying Tempting Offer effect: ${cardName}, ${acceptedBy.length} accepted, initiator gets ${initiatorBonusCount}x`);
  
  // Tempt with Discovery: Search for lands
  if (cardNameLower.includes('discovery')) {
    // Set up library search for initiator
    createLibrarySearchStep(game, gameId, initiator, {
      searchFor: `up to ${initiatorBonusCount} land card(s)`,
      destination: 'battlefield',
      tapped: false,
      optional: true,
      source: 'Tempt with Discovery',
      shuffleAfter: true,
      maxSelections: initiatorBonusCount,
      filter: { types: ['land'] },
    });
    
    // Each accepting opponent also searches
    for (const opponentId of acceptedBy) {
      createLibrarySearchStep(game, gameId, opponentId, {
        searchFor: 'a land card',
        destination: 'battlefield',
        tapped: false,
        optional: true,
        source: 'Tempt with Discovery',
        shuffleAfter: true,
        maxSelections: 1,
        filter: { types: ['land'] },
      });
    }
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `🌲 Tempt with Discovery: ${getPlayerName(game, initiator)} searches for up to ${initiatorBonusCount} land(s).${acceptedBy.length > 0 ? ` ${acceptedBy.length} opponent(s) also search.` : ''}`,
      ts: Date.now(),
    });
  }
  // Tempt with Glory: +1/+1 counters
  else if (cardNameLower.includes('glory')) {
    // Initiator's creatures get counters
    const initiatorCreatures = battlefield.filter((p: any) => 
      p.controller === initiator && 
      (p.card?.type_line || '').toLowerCase().includes('creature')
    );
    for (const creature of initiatorCreatures) {
      creature.counters = creature.counters || {};
      creature.counters['+1/+1'] = (creature.counters['+1/+1'] || 0) + initiatorBonusCount;
    }
    
    // Each accepting opponent's creatures get 1 counter
    for (const opponentId of acceptedBy) {
      const opponentCreatures = battlefield.filter((p: any) => 
        p.controller === opponentId && 
        (p.card?.type_line || '').toLowerCase().includes('creature')
      );
      for (const creature of opponentCreatures) {
        creature.counters = creature.counters || {};
        creature.counters['+1/+1'] = (creature.counters['+1/+1'] || 0) + 1;
      }
    }
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `✨ Tempt with Glory: ${getPlayerName(game, initiator)}'s creatures each get ${initiatorBonusCount} +1/+1 counter(s)!${acceptedBy.length > 0 ? ` ${acceptedBy.length} opponent(s)' creatures each get 1 counter.` : ''}`,
      ts: Date.now(),
    });
  }
  // Add more Tempting Offer cards as needed (Reflections, Vengeance, Immortality, Bunnies, Mayhem)
  else {
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `🎁 ${cardName}: ${getPlayerName(game, initiator)} gets the effect ${initiatorBonusCount} time(s).${acceptedBy.length > 0 ? ` ${acceptedBy.length} opponent(s) also get the effect.` : ''}`,
      ts: Date.now(),
    });
  }
  
  // Emit Tempting Offer complete event
  io.to(gameId).emit("temptingOfferComplete", {
    id: `tempt_${Date.now()}`,
    gameId,
    cardName,
    acceptedBy,
    initiator,
    initiatorBonusCount,
  });
}

/**
 * Handle Bounce Land Choice response
 * Player selects which land to return to hand when a bounce land enters the battlefield
 */
function handleBounceLandChoiceResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const pid = response.playerId;
  const selection = response.selections;
  
  // Extract selected permanent ID from selection
  let returnPermanentId = '';
  if (typeof selection === 'string') {
    returnPermanentId = selection;
  } else if (Array.isArray(selection) && selection.length > 0) {
    returnPermanentId = selection[0];
  } else if (typeof selection === 'object' && selection !== null && !Array.isArray(selection)) {
    returnPermanentId = (selection as any).permanentId || (selection as any).returnPermanentId || '';
  }
  
  if (!returnPermanentId) {
    debugWarn(1, `[Resolution] Bounce land choice: no land selected by ${pid}`);
    return;
  }
  
  const stepData = step as any;
  const bounceLandId = stepData.bounceLandId;
  const bounceLandName = stepData.bounceLandName || 'Bounce Land';
  const stackItemId = stepData.stackItemId;
  const landsToChoose = stepData.landsToChoose || [];
  
  debug(2, `[Resolution] Bounce land choice: player=${pid} returns land ${returnPermanentId}`);
  
  // Validate that the selected land is in the list of valid choices
  const validLandIds = new Set(landsToChoose.map((land: any) => land.permanentId));
  if (!validLandIds.has(returnPermanentId)) {
    debugWarn(1, `[Resolution] Invalid bounce land choice: ${returnPermanentId} not in valid options`);
    return;
  }
  
  // Ensure game state and battlefield exist
  game.state = (game.state || {}) as any;
  game.state.battlefield = game.state.battlefield || [];
  
  const battlefield = game.state.battlefield;
  
  // Find the land to return
  const landToReturn = battlefield.find((p: any) => 
    p.id === returnPermanentId && p.controller === pid
  );
  
  if (!landToReturn) {
    debugWarn(1, `[Resolution] Land to return not found: ${returnPermanentId}`);
    return;
  }
  
  const returnedLandName = (landToReturn as any).card?.name || "Land";
  
  // Remove the land from battlefield
  const idx = battlefield.indexOf(landToReturn);
  if (idx !== -1) {
    battlefield.splice(idx, 1);
  }
  
  // Add the land to player's hand
  const zones = game.state?.zones?.[pid];
  if (zones) {
    zones.hand = zones.hand || [];
    const returnedCard = { ...(landToReturn as any).card, zone: 'hand' };
    (zones.hand as any[]).push(returnedCard);
    zones.handCount = (zones.hand as any[]).length;
  }
  
  // If this was triggered from the stack, remove the stack item
  if (stackItemId) {
    const stack = (game.state as any).stack || [];
    const stackIndex = stack.findIndex((item: any) => item.id === stackItemId);
    if (stackIndex !== -1) {
      stack.splice(stackIndex, 1);
      debug(2, `[Resolution] Removed bounce land trigger from stack (id: ${stackItemId})`);
    }
  }
  
  // Send chat message
  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message: `${getPlayerName(game, pid)}'s ${bounceLandName} returns ${returnedLandName} to hand.`,
    ts: Date.now(),
  });
  
  // NOTE: Priority restoration is handled automatically by the ResolutionQueue system
  // via the priority management handler (initializePriorityResolutionHandler).
  // When the last resolution step completes, exitResolutionMode() is called automatically.
  
  // Bump sequence
  if (typeof (game as any).bumpSeq === "function") {
    (game as any).bumpSeq();
  }
}

/**
 * Handle activated ability resolution
 * Executes non-mana activated abilities from the stack
 */
async function handleActivatedAbilityResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): Promise<void> {
  // Type guard to ensure we have the correct step type
  if (step.type !== ResolutionStepType.ACTIVATED_ABILITY) {
    debugWarn(1, `[Resolution] handleActivatedAbilityResponse called with wrong step type: ${step.type}`);
    return;
  }
  
  const stepData = step as any;  // Still needed for accessing type-specific fields
  const permanentId = stepData.permanentId;
  const abilityType = stepData.abilityType;
  const abilityData = stepData.abilityData || {};
  const playerId = step.playerId;
  
  debug(1, `[Resolution] Executing activated ability: type=${abilityType}, permanent=${permanentId}`);
  
  // Find the permanent on the battlefield
  const battlefield = game.state?.battlefield || [];
  const perm = battlefield.find((p: any) => p.id === permanentId);
  
  if (!perm) {
    debugWarn(1, `[Resolution] Activated ability permanent not found: ${permanentId}`);
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `Activated ability fizzled (permanent not found)`,
      ts: Date.now(),
    });
    return;
  }
  
  const card = (perm as any).card;
  const cardName = (card?.name || '').toLowerCase();
  
  try {
    switch (abilityType) {
      case 'crystal': {
        // Import Crystal abilities dynamically
        const { 
          executeWindCrystalAbility, 
          executeFireCrystalAbility, 
          executeWaterCrystalAbility, 
          executeEarthCrystalAbility, 
          executeDarknessCrystalAbility 
        } = await import("../state/modules/triggers/crystal-abilities.js");
        
        let result: { success: boolean; message?: string; error?: string } = { success: false };
        let message = '';
        
        switch (cardName) {
          case 'the wind crystal': {
            const windResult = executeWindCrystalAbility(game as any, playerId);
            result = { 
              success: windResult.success, 
              message: `The Wind Crystal: ${windResult.affectedCreatures.length} creatures gained flying and lifelink until end of turn` 
            };
            message = result.message || '';
            break;
          }
          
          case 'the fire crystal': {
            const targets = stepData.targets || [];
            if (targets.length === 0) {
              debugWarn(1, `[Resolution] Fire Crystal: no target provided`);
              result = { success: false, error: "No target" };
              break;
            }
            const fireResult = executeFireCrystalAbility(game as any, playerId, targets[0]);
            result = fireResult.success 
              ? { success: true, message: `The Fire Crystal: Created a token copy (will be sacrificed at end step)` }
              : { success: false, error: fireResult.error };
            message = result.message || result.error || '';
            break;
          }
          
          case 'the water crystal': {
            const waterResult = executeWaterCrystalAbility(game as any, playerId);
            if (waterResult.success) {
              const totalMilled = waterResult.results.reduce((sum, r) => sum + r.milledCount, 0);
              const opponentCount = waterResult.results.length;
              result = { 
                success: true, 
                message: `The Water Crystal: ${opponentCount} opponent(s) milled ${totalMilled} total cards` 
              };
              message = result.message || '';
            } else {
              result = { success: false, error: waterResult.error };
            }
            break;
          }
          
          case 'the earth crystal': {
            const targets = stepData.targets || [];
            if (targets.length === 0) {
              debugWarn(1, `[Resolution] Earth Crystal: no targets provided`);
              result = { success: false, error: "No targets" };
              break;
            }
            const earthResult = executeEarthCrystalAbility(
              game as any, 
              playerId, 
              targets,
              abilityData.distribution
            );
            if (earthResult.success && earthResult.results) {
              const details = earthResult.results.map(r => `+${r.countersAdded}`).join(', ');
              result = { success: true, message: `The Earth Crystal: Distributed +1/+1 counters (${details})` };
              message = result.message || '';
            } else {
              result = { success: false, error: earthResult.error };
            }
            break;
          }
          
          case 'the darkness crystal': {
            const targets = stepData.targets || [];
            if (targets.length === 0) {
              debugWarn(1, `[Resolution] Darkness Crystal: no target provided`);
              result = { success: false, error: "No target" };
              break;
            }
            const darknessResult = executeDarknessCrystalAbility(
              game as any, 
              playerId, 
              permanentId,
              targets[0]
            );
            result = darknessResult.success
              ? { success: true, message: `The Darkness Crystal: Returned ${darknessResult.creatureName} to battlefield tapped with +2/+2` }
              : { success: false, error: darknessResult.error };
            message = result.message || result.error || '';
            break;
          }
        }
        
        if (message) {
          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message,
            ts: Date.now(),
          });
        }
        break;
      }
      
      case 'group_draw': {
        // Execute group draw effect
        // Use the groupDrawEffect from abilityData (passed when ability was added to queue)
        const groupDrawEffect = abilityData?.groupDrawEffect;
        
        if (!groupDrawEffect) {
          debugWarn(1, `[Resolution] Group draw effect not found in abilityData for ${cardName}`);
          break;
        }
        
        const affectedPlayers = [];
        const players = game.state.players || [];
        
        switch (groupDrawEffect.affectedPlayers) {
          case 'all':
            // All players draw (Temple Bell, Howling Mine)
            for (const player of players) {
              if (typeof game.drawCards === 'function') {
                game.drawCards(player.id, groupDrawEffect.drawAmount);
                affectedPlayers.push(player.id);
              }
            }
            break;
            
          case 'each_opponent':
            // Each opponent draws (Master of the Feast)
            for (const player of players) {
              if (player.id !== playerId && typeof game.drawCards === 'function') {
                game.drawCards(player.id, groupDrawEffect.drawAmount);
                affectedPlayers.push(player.id);
              }
            }
            break;
            
          case 'you':
            // Only controller draws
            if (typeof game.drawCards === 'function') {
              game.drawCards(playerId, groupDrawEffect.drawAmount);
              affectedPlayers.push(playerId);
            }
            break;
        }
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${groupDrawEffect.cardName}: ${affectedPlayers.length} player(s) drew ${groupDrawEffect.drawAmount} card(s)`,
          ts: Date.now(),
        });
        break;
      }
      
      case 'x_activated': {
        // Execute X ability
        const { detectXAbility, executeXAbility } = await import("../state/modules/x-activated-abilities.js");
        const xValue = stepData.xValue;
        const xAbilityInfo = abilityData.xAbilityInfo;
        
        if (!xAbilityInfo) {
          debugWarn(1, `[Resolution] X ability info not found for ${cardName}`);
          break;
        }
        
        const result = executeXAbility(
          game as any,
          playerId,
          perm,
          xValue,
          xAbilityInfo
        );
        
        // Mark as activated this turn if once per turn
        if (xAbilityInfo.oncePerTurn) {
          (perm as any).activatedThisTurn = true;
        }
        
        // Generate message based on result
        let message = result.message;
        if (!message && result.destroyedCount !== undefined) {
          message = `${card?.name || 'Permanent'} (X=${xValue}): Destroyed ${result.destroyedCount} permanent(s) with mana value ${xValue}`;
        }
        
        if (message) {
          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message,
            ts: Date.now(),
          });
        }
        break;
      }
      
      default:
        debugWarn(1, `[Resolution] Unknown activated ability type: ${abilityType}`);
    }
  } catch (err) {
    debugError(1, `[Resolution] Error executing activated ability:`, err);
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `Error executing activated ability: ${err}`,
      ts: Date.now(),
    });
  }
  
  // Bump sequence
  if (typeof (game as any).bumpSeq === "function") {
    (game as any).bumpSeq();
  }
  
  // Broadcast updated state
  broadcastGame(io, game, gameId);
}

/**
 * Handle cascade resolution response
 * Player chooses whether to cast the hit card or decline
 */
async function handleCascadeResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): Promise<void> {
  const pid = response.playerId;
  // selections can be true (legacy), 'cast', or 'decline'
  const cast = response.selections === true || 
    (typeof response.selections === 'string' && response.selections === 'cast');
  
  const cascadeStep = step as any;
  const effectId = cascadeStep.effectId;
  const hitCard = cascadeStep.hitCard;
  const exiledCards = cascadeStep.exiledCards || [];
  
  debug(2, `[Resolution] Cascade response: player=${pid}, cast=${cast}, effectId=${effectId}`);
  
  // Get library and zones
  const lib = (game as any).libraries?.get(pid) || [];
  const zones = game.state.zones = game.state.zones || {};
  const z = zones[pid] = zones[pid] || { 
    hand: [], 
    handCount: 0, 
    libraryCount: lib.length, 
    graveyard: [], 
    graveyardCount: 0 
  };
  
  // Bottom the exiled cards (excluding hit card if casting)
  const randomized = [...exiledCards];
  for (let i = randomized.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [randomized[i], randomized[j]] = [randomized[j], randomized[i]];
  }
  
  for (const card of randomized) {
    if (cast && hitCard && card.id === hitCard.id) continue;
    lib.push({ ...card, zone: 'library' });
  }
  z.libraryCount = lib.length;
  
  // Cast the hit card if chosen
  if (cast && hitCard) {
    if (typeof game.applyEvent === 'function') {
      game.applyEvent({
        type: "castSpell",
        playerId: pid,
        card: { ...hitCard },
      });
    }
    
    try {
      await appendEvent(gameId, (game as any).seq ?? 0, "castSpell", { 
        playerId: pid, 
        cardId: hitCard.id, 
        card: hitCard, 
        cascade: true 
      });
    } catch {
      // ignore persistence failures
    }
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} casts ${hitCard.name} via Cascade.`,
      ts: Date.now(),
    });
  } else if (hitCard) {
    // Declined casting - put the hit card on bottom as well
    lib.push({ ...hitCard, zone: 'library' });
    z.libraryCount = lib.length;
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} declines to cast ${hitCard.name} via Cascade.`,
      ts: Date.now(),
    });
  }
  
  // Emit cascade complete
  io.to(gameId).emit("cascadeComplete", { gameId, effectId });
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}

/**
 * Handle Scry resolution response
 * 
 * Player looks at the top N cards of their library and decides which to keep
 * on top (in order) and which to put on the bottom (in order).
 * 
 * Reference: Rule 701.22 - Scry
 */
function handleScryResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const pid = response.playerId;
  const selections = response.selections as any;
  
  // Expected format: { keepTopOrder: KnownCardRef[], bottomOrder: KnownCardRef[] }
  const keepTopOrder = selections?.keepTopOrder || [];
  const bottomOrder = selections?.bottomOrder || [];
  
  const scryStep = step as any;
  const scryCount = scryStep.scryCount || 0;
  const cards = scryStep.cards || [];
  
  debug(2, `[Resolution] Scry response: player=${pid}, scryCount=${scryCount}, keepTop=${keepTopOrder.length}, bottom=${bottomOrder.length}`);
  
  // Validate that all cards are accounted for
  const totalCards = keepTopOrder.length + bottomOrder.length;
  if (totalCards !== scryCount && totalCards !== cards.length) {
    debugWarn(2, `[Resolution] Scry card count mismatch: expected ${scryCount}, got ${totalCards}`);
  }
  
  // Validate that the cards match what was shown
  const selectedIds = [...keepTopOrder, ...bottomOrder].map((c: any) => c.id);
  const cardIds = cards.map((c: any) => c.id);
  const allMatch = selectedIds.every((id: string) => cardIds.includes(id));
  
  if (!allMatch) {
    debugWarn(2, `[Resolution] Scry selection contains cards not in original set`);
  }
  
  // Apply the scry event to the game
  if (typeof game.applyEvent === 'function') {
    game.applyEvent({
      type: "scryResolve",
      playerId: pid,
      keepTopOrder,
      bottomOrder,
    });
  }
  
  // Log to event history
  try {
    appendEvent(gameId, game.seq ?? 0, "scryResolve", { 
      playerId: pid, 
      keepTopOrder, 
      bottomOrder 
    });
  } catch {
    // Ignore persistence failures
  }
  
  // Emit chat message
  const topCount = keepTopOrder.length;
  const bottomCount = bottomOrder.length;
  let message = `${getPlayerName(game, pid)} scries ${scryCount}`;
  if (topCount > 0 && bottomCount > 0) {
    message += ` (${topCount} on top, ${bottomCount} on bottom)`;
  } else if (topCount > 0) {
    message += ` (all on top)`;
  } else if (bottomCount > 0) {
    message += ` (all on bottom)`;
  }
  
  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message,
    ts: Date.now(),
  });

  // Optional planeswalker follow-up: after scry resolves, deal N damage to each opponent.
  // This is used by template-driven planeswalker abilities like:
  // "Scry X. [Name] deals N damage to each opponent."
  const stepData = step as any;
  if (stepData?.pwScryThenDamageToEachOpponent === true) {
    const controllerId = String(stepData.pwScryThenDamageController || pid);
    const damage = Number(stepData.pwScryThenDamageAmount || 0);
    const sourceName = String(stepData.pwScryThenDamageSourceName || step.sourceName || 'Ability');

    if (Number.isFinite(damage) && damage > 0) {
      const startingLife = game.state.startingLife || 40;
      game.state.life = game.state.life || {};

      for (const p of game.state.players || []) {
        if (!p?.id) continue;
        if (String(p.id) === controllerId) continue;
        const oppId = String(p.id);
        const currentLife = game.state.life?.[oppId] ?? startingLife;
        game.state.life[oppId] = currentLife - damage;
      }

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${sourceName} deals ${damage} damage to each opponent.`,
        ts: Date.now(),
      });
    }
  }

  // Optional planeswalker follow-up: after scry resolves, draw cards.
  // Used by template-driven planeswalker abilities like:
  // "Scry X, then draw a card." and "Scry X. If you control an artifact, draw a card."
  if (stepData?.pwScryThenDrawCards === true) {
    const controllerId = String(stepData.pwScryThenDrawCardsController || pid);
    const drawCount = Number(stepData.pwScryThenDrawCardsAmount || 0);
    const sourceName = String(stepData.pwScryThenDrawCardsSourceName || step.sourceName || 'Ability');

    let shouldDraw = Number.isFinite(drawCount) && drawCount > 0;
    if (shouldDraw && stepData?.pwScryThenDrawCardsIfControllerControlsArtifact === true) {
      const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
      const controlsArtifact = battlefield.some((perm: any) => {
        if (!perm) return false;
        if (String(perm.controller || '') !== controllerId) return false;
        const tl = String(perm?.card?.type_line || '').toLowerCase();
        return tl.includes('artifact');
      });
      shouldDraw = controlsArtifact;
    }

    if (shouldDraw) {
      if (typeof (game as any).drawCards === 'function') {
        (game as any).drawCards(controllerId, drawCount);
      } else {
        const zones = game.state?.zones?.[controllerId];
        if (zones) {
          zones.hand = zones.hand || [];
          const lib = (game as any).libraries?.get?.(controllerId) || zones.library || [];
          if (Array.isArray(lib)) {
            for (let i = 0; i < drawCount; i++) {
              if (lib.length <= 0) break;
              const drawn = lib.shift();
              zones.hand.push({ ...drawn, zone: 'hand' });
            }
          }
          zones.handCount = zones.hand.length;
          zones.libraryCount = Array.isArray(lib) ? lib.length : zones.libraryCount;
          if ((game as any).libraries?.set && Array.isArray(lib)) {
            (game as any).libraries.set(controllerId, lib);
          }
        }
      }

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${sourceName}: ${getPlayerName(game, controllerId)} draws ${drawCount} card${drawCount === 1 ? '' : 's'}.`,
        ts: Date.now(),
      });
    }
  }
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}

/**
 * Handle Surveil resolution response
 * 
 * Player looks at the top N cards of their library and decides which to keep
 * on top (in order) and which to put in the graveyard.
 * 
 * Reference: Rule 701.25 - Surveil
 */
function handleSurveilResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const pid = response.playerId;
  const selections = response.selections as any;
  
  // Expected format: { keepTopOrder: KnownCardRef[], toGraveyard: KnownCardRef[] }
  const keepTopOrder = selections?.keepTopOrder || [];
  const toGraveyard = selections?.toGraveyard || [];
  
  const surveilStep = step as any;
  const surveilCount = surveilStep.surveilCount || 0;
  const cards = surveilStep.cards || [];
  
  debug(2, `[Resolution] Surveil response: player=${pid}, surveilCount=${surveilCount}, keepTop=${keepTopOrder.length}, toGY=${toGraveyard.length}`);
  
  // Validate that all cards are accounted for
  const totalCards = keepTopOrder.length + toGraveyard.length;
  if (totalCards !== surveilCount && totalCards !== cards.length) {
    debugWarn(2, `[Resolution] Surveil card count mismatch: expected ${surveilCount}, got ${totalCards}`);
  }
  
  // Validate that the cards match what was shown
  const selectedIds = [...keepTopOrder, ...toGraveyard].map((c: any) => c.id);
  const cardIds = cards.map((c: any) => c.id);
  const allMatch = selectedIds.every((id: string) => cardIds.includes(id));
  
  if (!allMatch) {
    debugWarn(2, `[Resolution] Surveil selection contains cards not in original set`);
  }
  
  // Apply the surveil event to the game
  if (typeof game.applyEvent === 'function') {
    game.applyEvent({
      type: "surveilResolve",
      playerId: pid,
      keepTopOrder,
      toGraveyard,
    });
  }
  
  // Log to event history
  try {
    appendEvent(gameId, game.seq ?? 0, "surveilResolve", { 
      playerId: pid, 
      keepTopOrder, 
      toGraveyard 
    });
  } catch {
    // Ignore persistence failures
  }
  
  // Emit chat message
  const topCount = keepTopOrder.length;
  const gyCount = toGraveyard.length;
  let message = `${getPlayerName(game, pid)} surveils ${surveilCount}`;
  if (topCount > 0 && gyCount > 0) {
    message += ` (${topCount} on top, ${gyCount} to graveyard)`;
  } else if (topCount > 0) {
    message += ` (all on top)`;
  } else if (gyCount > 0) {
    message += ` (all to graveyard)`;
  }
  
  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message,
    ts: Date.now(),
  });

  // Optional follow-up: "then exile a card from a graveyard" (used by shared oracle templates)
  if ((surveilStep as any).followUpExileGraveyardCard === true) {
    const zones = game.state?.zones || {};
    const allGyCards: Array<{ id: string; owner: string; name?: string; type_line?: string; image_uris?: any }> = [];
    for (const playerId of Object.keys(zones)) {
      const gy: any[] = zones[playerId]?.graveyard || [];
      for (const c of gy) {
        if (!c?.id) continue;
        allGyCards.push({ id: c.id, owner: playerId, name: c.name, type_line: c.type_line, image_uris: c.image_uris });
      }
    }

    if (allGyCards.length > 0) {
      const followUpSourceName = String((surveilStep as any).followUpSourceName || step.sourceName || 'Effect');
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: pid as any,
        description: `${followUpSourceName}: Exile a card from a graveyard`,
        mandatory: true,
        sourceName: followUpSourceName,
        minTargets: 1,
        maxTargets: 1,
        action: 'exile_graveyard_card',
        validTargets: allGyCards.map((c) => ({
          id: c.id,
          label: c.name || 'Card',
          description: c.type_line || 'card',
          imageUrl: c.image_uris?.small || c.image_uris?.normal,
          zone: 'graveyard',
          owner: c.owner,
        })),
      } as any);
    }
  }
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}

/**
 * Handle Proliferate resolution response
 * 
 * Player chooses any number of permanents and/or players with counters
 * and adds one counter of each kind already there.
 * 
 * Reference: Rule 701.28 - Proliferate
 */
function handleProliferateResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const pid = response.playerId;
  const selections = response.selections as any;
  
  // Expected format: string[] (array of target IDs to proliferate)
  const selectedTargetIds = Array.isArray(selections) ? selections : (selections?.selectedTargetIds || []);
  
  const proliferateStep = step as any;
  const proliferateId = proliferateStep.proliferateId;
  
  debug(2, `[Resolution] Proliferate response: player=${pid}, targets=${selectedTargetIds.length}`);
  
  const battlefield = game.state?.battlefield || [];
  const proliferatedTargets: string[] = [];
  
  // Process each selected target
  for (const targetId of selectedTargetIds) {
    // Check if it's a permanent
    const permanent = battlefield.find((p: any) => p?.id === targetId);
    if (permanent && permanent.counters) {
      // Add one counter of each kind the permanent has
      const counters = permanent.counters as Record<string, number>;
      for (const counterType of Object.keys(counters)) {
        if (counters[counterType] > 0) {
          (permanent.counters as any)[counterType] = counters[counterType] + 1;
        }
      }
      proliferatedTargets.push(permanent.card?.name || 'permanent');
      continue;
    }
    
    // Check if it's a player
    const players = game.state?.players || [];
    const player = players.find((p: any) => p.id === targetId);
    if (player && player.counters) {
      // Add one counter of each kind the player has
      const counters = player.counters as Record<string, number>;
      for (const counterType of Object.keys(counters)) {
        if (counters[counterType] > 0) {
          player.counters[counterType] = counters[counterType] + 1;
        }
      }
      proliferatedTargets.push(getPlayerName(game, targetId));
    }
  }
  
  // Emit chat message
  let message = `${getPlayerName(game, pid)} proliferates`;
  if (proliferatedTargets.length > 0) {
    message += `: ${proliferatedTargets.join(', ')}`;
  } else {
    message += ` (no targets chosen)`;
  }
  
  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message,
    ts: Date.now(),
  });
  
  // Log to event history
  try {
    appendEvent(gameId, game.seq ?? 0, "proliferateResolve", { 
      playerId: pid, 
      targetIds: selectedTargetIds,
      proliferateId,
    });
  } catch {
    // Ignore persistence failures
  }
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}

/**
 * Handle Fateseal resolution response
 * 
 * Player looks at the top N cards of opponent's library and decides which to keep
 * on top (in order) and which to put on the bottom (in order).
 * 
 * Reference: Rule 701.29 - Fateseal
 */
function handleFatesealResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const pid = response.playerId;
  const selections = response.selections as any;
  
  // Expected format: { keepTopOrder: KnownCardRef[], bottomOrder: KnownCardRef[] }
  const keepTopOrder = selections?.keepTopOrder || [];
  const bottomOrder = selections?.bottomOrder || [];
  
  const fatesealStep = step as any;
  const fatesealCount = fatesealStep.fatesealCount || 0;
  const cards = fatesealStep.cards || [];
  const opponentId = fatesealStep.opponentId;
  
  debug(2, `[Resolution] Fateseal response: player=${pid}, opponent=${opponentId}, count=${fatesealCount}, keepTop=${keepTopOrder.length}, bottom=${bottomOrder.length}`);
  
  // Validate that all cards are accounted for
  const totalCards = keepTopOrder.length + bottomOrder.length;
  if (totalCards !== fatesealCount && totalCards !== cards.length) {
    debugWarn(2, `[Resolution] Fateseal card count mismatch: expected ${fatesealCount}, got ${totalCards}`);
  }
  
  // Get opponent's library
  const lib = (game as any).libraries?.get(opponentId) || [];
  
  // Remove the fatesealed cards from top of library
  lib.splice(0, totalCards);
  
  // Put cards back in chosen order (top cards go on top, bottom cards on bottom)
  for (let i = keepTopOrder.length - 1; i >= 0; i--) {
    lib.unshift({ ...keepTopOrder[i], zone: 'library' });
  }
  for (const card of bottomOrder) {
    lib.push({ ...card, zone: 'library' });
  }
  
  // Update library count
  const zones = game.state.zones = game.state.zones || {};
  const z = zones[opponentId] = zones[opponentId] || {};
  z.libraryCount = lib.length;
  
  // Emit chat message
  const topCount = keepTopOrder.length;
  const bottomCount = bottomOrder.length;
  let message = `${getPlayerName(game, pid)} fateseals ${fatesealCount} of ${getPlayerName(game, opponentId)}'s library`;
  if (topCount > 0 && bottomCount > 0) {
    message += ` (${topCount} on top, ${bottomCount} on bottom)`;
  } else if (topCount > 0) {
    message += ` (all on top)`;
  } else if (bottomCount > 0) {
    message += ` (all on bottom)`;
  }
  
  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message,
    ts: Date.now(),
  });
  
  // Log to event history
  try {
    appendEvent(gameId, game.seq ?? 0, "fatesealResolve", { 
      playerId: pid, 
      opponentId,
      keepTopOrder, 
      bottomOrder 
    });
  } catch {
    // Ignore persistence failures
  }
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}

/**
 * Handle Clash resolution response
 * 
 * Player reveals top card and chooses whether to put it on bottom of library.
 * 
 * Reference: Rule 701.30 - Clash
 */
function handleClashResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const pid = response.playerId;
  const selections = response.selections as any;
  
  // Expected format: boolean (true = put on bottom, false = keep on top)
  const putOnBottom = selections === true || selections?.putOnBottom === true;
  
  const clashStep = step as any;
  const revealedCard = clashStep.revealedCard;
  const opponentId = clashStep.opponentId;
  
  debug(2, `[Resolution] Clash response: player=${pid}, putOnBottom=${putOnBottom}`);
  
  if (!revealedCard) {
    debugWarn(2, `[Resolution] Clash step missing revealed card`);
    return;
  }
  
  // Get player's library
  const lib = (game as any).libraries?.get(pid) || [];
  
  if (putOnBottom) {
    // Remove from top and put on bottom
    if (lib.length > 0 && lib[0].id === revealedCard.id) {
      const card = lib.shift();
      if (card) {
        lib.push({ ...card, zone: 'library' });
      }
    }
  }
  // If not putting on bottom, card stays on top (no action needed)
  
  // Update library count
  const zones = game.state.zones = game.state.zones || {};
  const z = zones[pid] = zones[pid] || {};
  z.libraryCount = lib.length;
  
  // Emit chat message
  let message = `${getPlayerName(game, pid)} clashes, revealing ${revealedCard.name}`;
  if (opponentId) {
    message = `${getPlayerName(game, pid)} clashes with ${getPlayerName(game, opponentId)}, revealing ${revealedCard.name}`;
  }
  if (putOnBottom) {
    message += ` (put on bottom)`;
  } else {
    message += ` (kept on top)`;
  }
  
  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message,
    ts: Date.now(),
  });
  
  // Log to event history
  try {
    appendEvent(gameId, game.seq ?? 0, "clashResolve", { 
      playerId: pid, 
      revealedCard,
      putOnBottom,
      opponentId
    });
  } catch {
    // Ignore persistence failures
  }
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}

/**
 * Handle Vote resolution response
 * 
 * Player votes for one of the available choices. Votes are collected in APNAP order.
 * 
 * Reference: Rule 701.38 - Vote
 */
function handleVoteResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const pid = response.playerId;
  const selections = response.selections as any;
  
  // Expected format: string (the chosen option) or { choice: string, voteCount?: number }
  const choice = typeof selections === 'string' ? selections : selections?.choice;
  const voteCount = typeof selections === 'object' ? (selections?.voteCount || 1) : 1;
  
  const voteStep = step as any;
  const voteId = voteStep.voteId;
  const choices = voteStep.choices || [];
  const votesSubmitted = voteStep.votesSubmitted || [];
  
  debug(2, `[Resolution] Vote response: player=${pid}, choice=${choice}, voteCount=${voteCount}`);
  
  if (!choice || !choices.includes(choice)) {
    debugWarn(2, `[Resolution] Invalid vote choice: ${choice}`);
    return;
  }
  
  // Store the vote (this would be used when all votes are collected)
  const voteResult = {
    playerId: pid,
    choice,
    voteCount,
  };
  
  // Update game state with the vote
  const voteState = (game.state as any).activeVotes = (game.state as any).activeVotes || {};
  if (!voteState[voteId]) {
    voteState[voteId] = {
      choices,
      votes: [],
    };
  }
  voteState[voteId].votes.push(voteResult);
  
  // Emit chat message
  let message = `${getPlayerName(game, pid)} votes for "${choice}"`;
  if (voteCount > 1) {
    message += ` (${voteCount} votes)`;
  }
  
  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message,
    ts: Date.now(),
  });
  
  // Log to event history
  try {
    appendEvent(gameId, game.seq ?? 0, "voteSubmit", { 
      playerId: pid, 
      voteId,
      choice,
      voteCount
    });
  } catch {
    // Ignore persistence failures
  }
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}

/**
 * Handle Bottom Order resolution response
 * Player orders a provided list of cards, which are then placed on the bottom of their library
 * in that exact order (bottom -> up).
 */
function handleBottomOrderResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const pid = response.playerId;
  const selections = response.selections as any;

  // Accept either { bottomOrder: [...] } or a raw array.
  const rawBottomOrder =
    selections && typeof selections === 'object' && 'bottomOrder' in selections
      ? (selections as any).bottomOrder
      : selections;

  const bottomIds: string[] = Array.isArray(rawBottomOrder)
    ? rawBottomOrder
        .map((x: any) => (typeof x === 'string' ? x : x?.id))
        .filter(Boolean)
        .map(String)
    : [];

  const bottomStep = step as any;
  const cards: any[] = Array.isArray(bottomStep.cards) ? bottomStep.cards : [];
  const stepCardIds = cards.map((c: any) => String(c?.id)).filter(Boolean);

  debug(2, `[Resolution] Bottom order response: player=${pid}, count=${bottomIds.length}`);

  // Validate: must be a permutation of the provided cards.
  if (bottomIds.length !== stepCardIds.length) {
    debugWarn(2, `[Resolution] bottom_order: card count mismatch (expected ${stepCardIds.length}, got ${bottomIds.length})`);
    return;
  }
  const seen = new Set(bottomIds);
  if (seen.size !== bottomIds.length) {
    debugWarn(2, `[Resolution] bottom_order: duplicate IDs in bottomOrder`);
    return;
  }
  const stepSet = new Set(stepCardIds);
  if (!bottomIds.every(id => stepSet.has(id))) {
    debugWarn(2, `[Resolution] bottom_order: selection contains cards not in original set`);
    return;
  }

  const byId = new Map<string, any>(cards.map((c: any) => [String(c.id), c]));
  const orderedCards = bottomIds.map(id => byId.get(id)).filter(Boolean);

  const ctx = (game as any).ctx || game;
  if (typeof (ctx as any).putCardsOnBottomOfLibrary === 'function') {
    (ctx as any).putCardsOnBottomOfLibrary(pid, orderedCards);
  } else {
    const lib = (game as any).libraries?.get(pid) || [];
    for (const card of orderedCards) {
      lib.push({ ...card, zone: 'library' });
    }
    (game as any).libraries?.set(pid, lib);
    const zones = (game.state as any).zones = (game.state as any).zones || {};
    const z = zones[pid] = zones[pid] || { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 };
    z.libraryCount = lib.length;
  }

  const shuffleAfter = bottomStep.shuffleAfter === true;
  if (shuffleAfter) {
    if (typeof (ctx as any).shuffleLibrary === 'function') {
      (ctx as any).shuffleLibrary(pid);
    } else {
      const lib = (game as any).libraries?.get(pid) || [];
      for (let i = lib.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [lib[i], lib[j]] = [lib[j], lib[i]];
      }
      (game as any).libraries?.set(pid, lib);
      const zones = (game.state as any).zones = (game.state as any).zones || {};
      const z = zones[pid] = zones[pid] || { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 };
      z.libraryCount = lib.length;
    }
  }

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${getPlayerName(game, pid)} put ${orderedCards.length} card(s) on the bottom of their library in a chosen order${shuffleAfter ? ' and shuffled' : ''}.`,
    ts: Date.now(),
  });

  if (typeof game.bumpSeq === 'function') {
    game.bumpSeq();
  }
}

/**
 * Handle Library Search resolution response
 * Generic handler for effects that reveal/search library and select cards
 * Used for: Genesis Wave, tutors, Impulse, etc.
 * 
 * The handler uses the step parameters to determine:
 * - What cards are available (availableCards)
 * - Where selected cards go (destination)
 * - Where unselected cards go (remainderDestination)
 * - Whether to shuffle after (shuffleAfter)
 */
async function handleLibrarySearchResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): Promise<void> {
  const pid = response.playerId;
  const selections = response.selections as string[]; // Array of card IDs selected
  
  // Get split assignments from response (for Cultivate/Kodama's Reach effects)
  const splitAssignments = response.splitAssignments;
  
  const searchStep = step as any;
  const availableCards = searchStep.availableCards || [];
  const nonSelectableCards = searchStep.nonSelectableCards || [];
  let destination = searchStep.destination || 'hand';
  const remainderDestination = searchStep.remainderDestination || 'shuffle';
  const remainderRandomOrder = searchStep.remainderRandomOrder !== false; // default true
  const shuffleAfter = searchStep.shuffleAfter !== false; // default true
  const shuffleOnlyIfSelectedFromLibrary = (searchStep as any).shuffleOnlyIfSelectedFromLibrary === true;
  const remainderPlayerChoosesOrder =
    remainderDestination === 'bottom' && (searchStep as any).remainderPlayerChoosesOrder === true;
  const contextValue = searchStep.contextValue;
  const entersTapped = searchStep.entersTapped || false;
  const sourceName = step.sourceName || 'Library Search';
  const lifeLoss = (searchStep as any).lifeLoss;

  // Optional extras for specific effects
  const destinationFaceDown = (searchStep as any).destinationFaceDown === true;
  const grantPlayableFromExileToController = (searchStep as any).grantPlayableFromExileToController === true;
  const playableFromExileTypeKey = String((searchStep as any).playableFromExileTypeKey || '').toLowerCase();

  // Optional override: treat this step as selecting cards from a different zone.
  // Default remains the library.
  const searchZone = String((searchStep as any).searchZone || 'library');
  const searchZones: string[] = Array.isArray((searchStep as any).searchZones)
    ? ((searchStep as any).searchZones as any[]).map((z: any) => String(z))
    : [];
  
  // Check if this is a split destination effect (Cultivate, Kodama's Reach)
  const isSplitDestination = searchStep.splitDestination || destination === 'split';
  
  debug(2, `[Resolution] Library search response: player=${pid}, selected ${Array.isArray(selections) ? selections.length : 0} from ${availableCards.length} available, destination=${destination}, remainder=${remainderDestination}, isSplit=${isSplitDestination}`);
  
  // Validate selections if any
  const selectedIds = Array.isArray(selections) ? selections : [];
  const availableIds = new Set(availableCards.map((c: any) => c.id));
  for (const cardId of selectedIds) {
    if (!availableIds.has(cardId)) {
      debugWarn(1, `[Resolution] Invalid library search selection: ${cardId} not in available cards`);
      return;
    }
  }
  
  // Get game context and utilities
  const { uid, parsePT, cardManaValue } = await import("../state/utils.js");
  const { applyCounterModifications } = await import("../state/modules/counters_tokens.js");
  const { getETBTriggersForPermanent } = await import("../state/modules/triggered-abilities.js");
  const { triggerETBEffectsForPermanent, detectEntersWithCounters, creatureWillHaveHaste, checkCreatureEntersTapped } = await import("../state/modules/stack.js");
  
  const state = game.state || {};
  const battlefield = state.battlefield = state.battlefield || [];
  const zones = state.zones = state.zones || {};
  const z = zones[pid] = zones[pid] || { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 };
  const lib = (game as any).libraries?.get(pid) || [];
  
  // Create a map of card ID to full card data
  const allRevealedCards = [...availableCards, ...nonSelectableCards];
  const cardMap = new Map(allRevealedCards.map((c: any) => [c.id, c]));
  let didSelectFromLibrary = false;
  const takeCardFromLibrary = (cardId: string) => {
    const idx = lib.findIndex((c: any) => c.id === cardId);
    if (idx >= 0) {
      didSelectFromLibrary = true;
      return lib.splice(idx, 1)[0];
    }
    return cardMap.get(cardId);
  };

  const takeCardFromGraveyard = (cardId: string) => {
    const gy = Array.isArray(z.graveyard) ? z.graveyard : (z.graveyard = []);
    const idx = gy.findIndex((c: any) => c?.id === cardId);
    if (idx >= 0) {
      const [taken] = gy.splice(idx, 1);
      z.graveyardCount = gy.length;
      return taken;
    }
    return cardMap.get(cardId);
  };

  const takeCardFromExile = (cardId: string) => {
    const ex = Array.isArray(z.exile) ? z.exile : (z.exile = []);
    const idx = ex.findIndex((c: any) => c?.id === cardId);
    if (idx >= 0) {
      const [taken] = ex.splice(idx, 1);
      z.exileCount = ex.length;
      return taken;
    }
    return cardMap.get(cardId);
  };

  const takeCardFromHand = (cardId: string) => {
    const hand = Array.isArray(z.hand) ? z.hand : (z.hand = []);
    const idx = hand.findIndex((c: any) => c?.id === cardId);
    if (idx >= 0) {
      const [taken] = hand.splice(idx, 1);
      z.handCount = hand.length;
      return taken;
    }
    return cardMap.get(cardId);
  };

  const takeCard = (cardId: string) => {
    // Multi-zone support: when searching multiple zones, try to remove from each zone in order.
    // This is used by some effects that allow choosing from hand/graveyard/library/exile.
    if (searchZones.length > 0) {
      for (const zone of searchZones) {
        const zkey = String(zone || '').toLowerCase();
        if (zkey === 'exile') {
          const c = takeCardFromExile(cardId);
          if (c) return c;
          continue;
        }
        if (zkey === 'hand') {
          const c = takeCardFromHand(cardId);
          if (c) return c;
          continue;
        }
        if (zkey === 'graveyard') {
          const c = takeCardFromGraveyard(cardId);
          if (c) return c;
          continue;
        }
        // Default (and "library")
        const c = takeCardFromLibrary(cardId);
        if (c) return c;
      }
      return cardMap.get(cardId);
    }
    if (searchZone === 'exile') return takeCardFromExile(cardId);
    if (searchZone === 'hand') return takeCardFromHand(cardId);
    if (searchZone === 'graveyard') return takeCardFromGraveyard(cardId);
    return takeCardFromLibrary(cardId);
  };

  const selectedCards = selectedIds.map(id => takeCard(id)).filter(Boolean);

  // Optional additional constraints (used by some planeswalker templates)
  const maxTypes = (searchStep as any).maxTypes as Record<string, number> | undefined;
  if (maxTypes && selectedCards.length > 0) {
    const counts: Record<string, number> = {};
    for (const card of selectedCards as any[]) {
      const tl = String(card?.type_line || '').toLowerCase();
      for (const [typeKey, maxAllowed] of Object.entries(maxTypes)) {
        if (typeof maxAllowed !== 'number') continue;
        if (tl.includes(typeKey.toLowerCase())) {
          counts[typeKey] = (counts[typeKey] || 0) + 1;
          if (counts[typeKey] > maxAllowed) {
            debugWarn(1, `[Resolution] Library search: selection exceeds maxTypes constraint (${typeKey} > ${maxAllowed})`);
            return;
          }
        }
      }
    }
  }

  const requireDifferentNames = (searchStep as any).requireDifferentNames === true;
  if (requireDifferentNames && selectedCards.length > 0) {
    const seen = new Set<string>();
    for (const card of selectedCards as any[]) {
      const name = String(card?.name || '').toLowerCase();
      if (!name) continue;
      if (seen.has(name)) {
        debugWarn(1, `[Resolution] Library search: selection violates requireDifferentNames constraint`);
        return;
      }
      seen.add(name);
    }
  }
  
  // If the remainder is ordered by the player, do not shuffle in this handler.
  // Any shuffleAfter responsibility is deferred to the follow-up bottom_order step.
  const willShuffleInThisHandler =
    shuffleAfter &&
    lib.length > 0 &&
    (!shuffleOnlyIfSelectedFromLibrary || didSelectFromLibrary) &&
    !(remainderPlayerChoosesOrder && remainderDestination === 'bottom');

  // For destination=top with shuffling in this handler, place selected after shuffling remainder
  const deferTopPlacement = destination === 'top' && willShuffleInThisHandler && !shuffleOnlyIfSelectedFromLibrary;
  
  // ========================================================================
  // SPLIT DESTINATION HANDLING (Cultivate, Kodama's Reach)
  // One card goes to battlefield (tapped), the other goes to hand
  // ========================================================================
  if (isSplitDestination && splitAssignments) {
    const { toBattlefield: battlefieldIds, toHand: handIds } = splitAssignments;
    
    // Process cards going to battlefield
    for (const cardId of battlefieldIds || []) {
      const card = selectedCards.find(c => c && c.id === cardId);
      if (card) {
        await putCardOntoBattlefield(card, pid, entersTapped, state, battlefield, uid, parsePT, cardManaValue, applyCounterModifications, getETBTriggersForPermanent, triggerETBEffectsForPermanent, detectEntersWithCounters, creatureWillHaveHaste, checkCreatureEntersTapped, game, io, gameId);

        // Optional: add extra counters as part of the effect (planeswalker templates).
        const addCounters = (searchStep as any).addCounters as Record<string, number> | undefined;
        if (addCounters && typeof addCounters === 'object') {
          const newPerm = battlefield[battlefield.length - 1] as any;
          if (newPerm) {
            newPerm.counters = newPerm.counters || {};
            for (const [k, v] of Object.entries(addCounters)) {
              const n = Number(v);
              if (!Number.isFinite(n) || n <= 0) continue;
              newPerm.counters[k] = (newPerm.counters[k] || 0) + n;
            }
          }
        }
        debug(2, `[Resolution] ${sourceName}: Put ${card.name} onto battlefield (split destination)`);
      }
    }
    
    // Process cards going to hand
    for (const cardId of handIds || []) {
      const card = selectedCards.find(c => c && c.id === cardId);
      if (card) {
        z.hand = z.hand || [];
        z.hand.push({ ...card, zone: 'hand' });
        z.handCount = z.hand.length;
        debug(2, `[Resolution] ${sourceName}: Put ${card.name} into hand (split destination)`);
      }
    }
  } else if (!deferTopPlacement) {
    // Process selected cards based on single destination
    for (const card of selectedCards) {
      if (!card) continue;
      
      if (destination === 'battlefield') {
        await putCardOntoBattlefield(card, pid, entersTapped, state, battlefield, uid, parsePT, cardManaValue, applyCounterModifications, getETBTriggersForPermanent, triggerETBEffectsForPermanent, detectEntersWithCounters, creatureWillHaveHaste, checkCreatureEntersTapped, game, io, gameId);

        // Optional: add extra counters as part of the effect (planeswalker templates).
        const addCounters = (searchStep as any).addCounters as Record<string, number> | undefined;
        if (addCounters && typeof addCounters === 'object') {
          const newPerm = battlefield[battlefield.length - 1] as any;
          if (newPerm) {
            newPerm.counters = newPerm.counters || {};
            for (const [k, v] of Object.entries(addCounters)) {
              const n = Number(v);
              if (!Number.isFinite(n) || n <= 0) continue;
              newPerm.counters[k] = (newPerm.counters[k] || 0) + n;
            }
          }
        }
        debug(2, `[Resolution] ${sourceName}: Put ${card.name} onto battlefield`);
      } else if (destination === 'hand') {
        z.hand = z.hand || [];
        z.hand.push({ ...card, zone: 'hand' });
        z.handCount = z.hand.length;
        debug(2, `[Resolution] ${sourceName}: Put ${card.name} into hand`);
      } else if (destination === 'graveyard') {
        z.graveyard = z.graveyard || [];
        z.graveyard.push({ ...card, zone: 'graveyard' });
        z.graveyardCount = z.graveyard.length;
        debug(2, `[Resolution] ${sourceName}: Put ${card.name} into graveyard`);
      } else if (destination === 'exile') {
        z.exile = z.exile || [];
        const exiledCard = { ...card, zone: 'exile', ...(destinationFaceDown ? { faceDown: true } : {}) };
        z.exile.push(exiledCard);
        z.exileCount = z.exile.length;
        debug(2, `[Resolution] ${sourceName}: Exiled ${card.name}`);

        if (grantPlayableFromExileToController) {
          const typeLine = String((exiledCard as any)?.type_line || '').toLowerCase();
          const passesTypeGate = !playableFromExileTypeKey || typeLine.includes(playableFromExileTypeKey);
          if (passesTypeGate) {
            const stateAny = state as any;
            stateAny.playableFromExile = stateAny.playableFromExile || {};
            const entry = (stateAny.playableFromExile[pid] = stateAny.playableFromExile[pid] || {});
            entry[exiledCard.id] = true;
          }
        }
      } else if (destination === 'top') {
        lib.unshift({ ...card, zone: 'library' });
        debug(2, `[Resolution] ${sourceName}: Put ${card.name} on top of library`);
      } else if (destination === 'bottom') {
        lib.push({ ...card, zone: 'library' });
        debug(2, `[Resolution] ${sourceName}: Put ${card.name} on bottom of library`);
      }
    }
  }
  
  // Handle unselected cards (remainder)
  const unselectedCards = allRevealedCards.filter((c: any) => !selectedIds.includes(c.id));
  
  if (remainderDestination === 'none') {
    // Intentionally do nothing.
  } else if (remainderDestination === 'graveyard') {
    z.graveyard = z.graveyard || [];
    for (const card of unselectedCards) {
      const fromLib = takeCardFromLibrary(card.id) || card;
      z.graveyard.push({ ...fromLib, zone: 'graveyard' });
    }
    z.graveyardCount = z.graveyard.length;
    debug(2, `[Resolution] ${sourceName}: Put ${unselectedCards.length} unselected cards into graveyard`);
  } else if (remainderDestination === 'bottom') {
    if (remainderPlayerChoosesOrder) {
      // Remove the remainder from the library immediately, then prompt for ordering.
      const cardsToOrder = unselectedCards.map((c: any) => takeCardFromLibrary(c.id) || c).filter(Boolean);

      if (cardsToOrder.length > 0) {
        const shuffleAfterBottomOrder =
          shuffleAfter && (!shuffleOnlyIfSelectedFromLibrary || didSelectFromLibrary);

        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.BOTTOM_ORDER,
          playerId: pid as any,
          description: `${sourceName}: Put the rest on the bottom of your library in any order.`,
          mandatory: true,
          sourceId: (step as any).sourceId,
          sourceName,
          sourceImage: (step as any).sourceImage,
          cards: cardsToOrder,
          shuffleAfter: shuffleAfterBottomOrder,
        } as any);
      }

      debug(2, `[Resolution] ${sourceName}: Queued bottom_order for ${unselectedCards.length} remainder card(s)`);
    } else {
      const cardsToBottom = remainderRandomOrder 
        ? [...unselectedCards].sort(() => Math.random() - 0.5)
        : unselectedCards;
      for (const card of cardsToBottom) {
        const fromLib = takeCardFromLibrary(card.id) || card;
        lib.push({ ...fromLib, zone: 'library' });
      }
      debug(2, `[Resolution] ${sourceName}: Put ${unselectedCards.length} unselected cards on bottom${remainderRandomOrder ? ' in random order' : ''}`);
    }
  } else if (remainderDestination === 'top') {
    const cardsToTop = remainderRandomOrder 
      ? [...unselectedCards].sort(() => Math.random() - 0.5)
      : unselectedCards;
    for (const card of cardsToTop.reverse()) {
      const fromLib = takeCardFromLibrary(card.id) || card;
      lib.unshift({ ...fromLib, zone: 'library' });
    }
    debug(2, `[Resolution] ${sourceName}: Put ${unselectedCards.length} unselected cards on top${remainderRandomOrder ? ' in random order' : ''}`);
  } else if (remainderDestination === 'shuffle' || remainderDestination === 'hand') {
    // Put back in library and shuffle, or to hand
    if (remainderDestination === 'hand') {
      z.hand = z.hand || [];
      for (const card of unselectedCards) {
        const fromLib = takeCardFromLibrary(card.id) || card;
        z.hand.push({ ...fromLib, zone: 'hand' });
      }
      z.handCount = z.hand.length;
    } else {
      // remainderDestination shuffle: leave cards in library (already present)
    }
  }
  
  // Shuffle if required
  if (willShuffleInThisHandler) {
    for (let i = lib.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [lib[i], lib[j]] = [lib[j], lib[i]];
    }
    debug(2, `[Resolution] ${sourceName}: Shuffled library`);
  }

  if (deferTopPlacement && selectedCards.length > 0) {
    for (let i = selectedCards.length - 1; i >= 0; i--) {
      const card = selectedCards[i];
      if (!card) continue;
      lib.unshift({ ...card, zone: 'library' });
      debug(2, `[Resolution] ${sourceName}: Put ${card.name} on top of library after shuffling`);
    }
  }
  
  // Update library count
  z.libraryCount = lib.length;

  // Optional follow-up: after exiling a selected card, offer to cast it for free.
  // Used by some planeswalker templates (e.g., Kasmina, Enigma Sage).
  const followUpMayCast = (searchStep as any).followUpMayCastSelectedFromExileWithoutPayingManaCost === true;
  if (followUpMayCast && destination === 'exile' && selectedCards.length >= 1) {
    const cardsToOffer = (selectedCards as any[]).filter(Boolean);
    const chosen = cardsToOffer[0];
    const declineDestination = (searchStep as any).followUpMayCastDeclineDestination || 'exile';

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: pid as any,
      description: `${sourceName}: You may cast ${chosen?.name || 'that card'} from exile without paying its mana cost.`,
      mandatory: false,
      sourceName,
      sourceId: (step as any).sourceId,
      sourceImage: (step as any).sourceImage,
      options: [
        { id: 'cast', label: `Cast ${chosen?.name || 'that card'}` },
        { id: 'decline', label: 'Decline' },
      ],
      minSelections: 1,
      maxSelections: 1,
      castFromExileCardId: chosen?.id,
      castFromExileCard: chosen,
      castFromExileDeclineDestination: declineDestination,
      castFromExileQueueCardIds: cardsToOffer.map(c => c.id),
      castFromExileQueueCards: cardsToOffer,
      castFromExileQueueIndex: 0,
    } as any);
  }

  // Apply life loss if specified (e.g., Vampiric Tutor)
  if (lifeLoss && lifeLoss > 0) {
    const startingLife = game.state.startingLife || 40;
    const currentLife = game.state.life?.[pid] ?? startingLife;
    game.state.life = game.state.life || {};
    game.state.life[pid] = currentLife - lifeLoss;
    debug(2, `[Resolution] ${sourceName}: ${pid} loses ${lifeLoss} life (${currentLife} → ${game.state.life[pid]})`);
  }
  
  // Send appropriate chat message
  const selectedCount = selectedIds.length;
  const totalRevealed = allRevealedCards.length;
  
  let message = `${getPlayerName(game, pid)} `;
  if (sourceName.toLowerCase().includes('genesis wave')) {
    message += `revealed ${totalRevealed} cards with Genesis Wave (X=${contextValue || '?'}), put ${selectedCount} permanent(s) onto the battlefield`;
    if (remainderDestination === 'graveyard') {
      message += `, and ${unselectedCards.length} card(s) into the graveyard`;
    }
  } else {
    message += `${sourceName}: selected ${selectedCount} of ${availableCards.length} card(s)`;
    if (destination === 'hand') message += ' to hand';
    else if (destination === 'battlefield') message += ' onto the battlefield';
    else if (destination === 'graveyard') message += ' to graveyard';
  }
  message += '.';
  
  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message,
    ts: Date.now(),
  });
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}

/**
 * Helper function to put a card onto the battlefield
 * Handles creatures, planeswalkers, and triggers
 */
async function putCardOntoBattlefield(
  card: any,
  controller: string,
  entersTapped: boolean,
  state: any,
  battlefield: any[],
  uid: any,
  parsePT: any,
  cardManaValue: any,
  applyCounterModifications: any,
  getETBTriggersForPermanent: any,
  triggerETBEffectsForPermanent: any,
  detectEntersWithCounters: any,
  creatureWillHaveHaste: any,
  checkCreatureEntersTapped: any,
  game: any,
  io?: Server,
  gameId?: string
): Promise<void> {
  const tl = (card.type_line || '').toLowerCase();
  const isCreature = tl.includes('creature');
  const isPlaneswalker = tl.includes('planeswalker');
  const baseP = isCreature ? parsePT((card as any).power) : undefined;
  const baseT = isCreature ? parsePT((card as any).toughness) : undefined;
  const hasHaste = isCreature && creatureWillHaveHaste(card, controller, battlefield);
  const hasSummoningSickness = isCreature && !hasHaste;
  let shouldEnterTapped = entersTapped;
  if (isCreature && !entersTapped) {
    shouldEnterTapped = checkCreatureEntersTapped(battlefield, controller, card);
  }
  
  const initialCounters: Record<string, number> = {};
  if (isPlaneswalker && card.loyalty) {
    const startingLoyalty = typeof card.loyalty === 'number' ? card.loyalty : parseInt(card.loyalty, 10);
    if (!isNaN(startingLoyalty)) {
      initialCounters.loyalty = startingLoyalty;
    }
  }
  const etbCounters = detectEntersWithCounters(card);
  // Object.entries returns [string, unknown][] even for Record<string, number>, so we need the type assertion
  for (const [counterType, count] of Object.entries(etbCounters)) {
    initialCounters[counterType] = (initialCounters[counterType] || 0) + (count as number);
  }
  
  const tempId = uid("perm");
  const tempPerm = { id: tempId, controller, counters: {} };
  battlefield.push(tempPerm as any);
  const modifiedCounters = applyCounterModifications(state, tempId, initialCounters);
  battlefield.pop();
  
  const newPermanent = {
    id: tempId,
    controller,
    owner: controller,
    tapped: shouldEnterTapped,
    counters: Object.keys(modifiedCounters).length > 0 ? modifiedCounters : undefined,
    basePower: baseP,
    baseToughness: baseT,
    summoningSickness: hasSummoningSickness,
    card: { ...card, zone: "battlefield" },
  } as any;
  
  battlefield.push(newPermanent);
  
  // ====================================================================================
  // Shock Land Handling: Emit prompt for "pay 2 life or enter tapped" lands
  // This handles shock lands when they enter from library (fetchlands), graveyard, etc.
  // Pattern: "As ~ enters the battlefield, you may pay 2 life. If you don't, it enters tapped."
  // ====================================================================================
  const isLand = tl.includes('land');
  const cardName = card.name || "Unknown";
  if (isLand && isShockLand(cardName) && io && gameId) {
    // Shock land detected - emit prompt to player
    const currentLife = (game.state as any)?.life?.[controller] || 
                       (game as any)?.life?.[controller] || 40;
    
    // Get card image URL
    const imageUrl = card.image_uris?.small || card.image_uris?.normal;
    
    // Emit shock land prompt (land enters untapped by default, prompt lets player tap it or pay life)
    emitToPlayer(io, controller, "shockLandPrompt", {
      gameId,
      permanentId: newPermanent.id,
      cardName,
      imageUrl,
      currentLife,
    });
    
    debug(2, `[putCardOntoBattlefield] Shock land ${cardName} entering - prompt sent to ${controller}`);
  }
  
  // Self ETB triggers
  const selfETBTriggerTypes = new Set([
    'etb',
    'etb_modal_choice',
    'job_select',
    'living_weapon',
    'etb_sacrifice_unless_pay',
    'etb_bounce_land',
    'etb_gain_life',
    'etb_draw',
    'etb_search',
    'etb_create_token',
    'etb_counter',
  ]);
  const allTriggers = getETBTriggersForPermanent(card, newPermanent);
  for (const trigger of allTriggers) {
    if (selfETBTriggerTypes.has(trigger.triggerType)) {
      state.stack = state.stack || [];
      state.stack.push({
        id: uid("trigger"),
        type: 'triggered_ability',
        controller,
        source: newPermanent.id,
        sourceName: trigger.cardName,
        description: trigger.description,
        triggerType: trigger.triggerType,
        mandatory: trigger.mandatory,
        permanentId: newPermanent.id,
      } as any);
    }
  }
  
  // Triggers from other permanents (landfall, etc.)
  const ctx = { 
    state, 
    gameId: (game as any).gameId,
    inactive: new Set(), 
    libraries: (game as any).libraries, 
    players: state.players 
  };
  triggerETBEffectsForPermanent(ctx as any, newPermanent, controller);
}

/**
 * Handle Devour Selection response
 * Player chooses creatures to sacrifice when a creature with Devour X enters
 */
function handleDevourSelectionResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const pid = response.playerId;
  const selections = response.selections as string[]; // Array of creature IDs to sacrifice
  
  const devourStep = step as any;
  const devourValue = devourStep.devourValue || 0;
  const creatureId = devourStep.creatureId;
  const availableCreatures = devourStep.availableCreatures || [];
  
  debug(2, `[Resolution] Devour selection: player=${pid}, devour=${devourValue}, selected ${Array.isArray(selections) ? selections.length : 0} creatures`);
  
  // Validate selections if any
  const selectedIds = Array.isArray(selections) ? selections : [];
  const availableIds = new Set(availableCreatures.map((c: any) => c.permanentId));
  for (const creatureIdToSac of selectedIds) {
    if (!availableIds.has(creatureIdToSac)) {
      debugWarn(1, `[Resolution] Invalid devour selection: ${creatureIdToSac} not in available creatures`);
      return;
    }
  }
  
  const state = game.state || {};
  const battlefield = state.battlefield = state.battlefield || [];
  
  // Find the devouring creature
  const devouringCreature = battlefield.find((p: any) => p.id === creatureId);
  if (!devouringCreature) {
    debugWarn(1, `[Resolution] Devour: creature ${creatureId} not found on battlefield`);
    return;
  }
  
  // Sacrifice selected creatures
  for (const creatureIdToSac of selectedIds) {
    const idx = battlefield.findIndex((p: any) => p.id === creatureIdToSac);
    if (idx !== -1) {
      const sacrificed = battlefield.splice(idx, 1)[0];
      const sacCard = (sacrificed as any).card;
      const owner = (sacrificed as any).owner || pid;
      
      // Move to graveyard
      const zones = state.zones = state.zones || {};
      const z = zones[owner] = zones[owner] || { graveyard: [], graveyardCount: 0 };
      z.graveyard = z.graveyard || [];
      z.graveyard.push({ ...sacCard, zone: 'graveyard' });
      z.graveyardCount = z.graveyard.length;
      
      debug(2, `[Resolution] Devour: Sacrificed ${sacCard.name || 'creature'}`);
      
      // TODO: Trigger death effects for sacrificed creature
    }
  }
  
  // Add +1/+1 counters to the devouring creature
  const countersToAdd = devourValue * selectedIds.length;
  if (countersToAdd > 0) {
    devouringCreature.counters = devouringCreature.counters || {};
    devouringCreature.counters['+1/+1'] = (devouringCreature.counters['+1/+1'] || 0) + countersToAdd;
    debug(2, `[Resolution] Devour: Added ${countersToAdd} +1/+1 counters to ${devourStep.creatureName}`);
  }
  
  // Send chat message
  const counterText = countersToAdd > 0 ? `, gaining ${countersToAdd} +1/+1 counter${countersToAdd > 1 ? 's' : ''}` : '';
  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message: `${getPlayerName(game, pid)} sacrificed ${selectedIds.length} creature${selectedIds.length !== 1 ? 's' : ''} to ${devourStep.creatureName}${counterText}.`,
    ts: Date.now(),
  });
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}

/**
 * Handle creature type choice response via resolution queue
 */
/**
 * Handle Color Choice response
 * Player chooses a color for a permanent that entered the battlefield
 */
async function handleColorChoiceResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): Promise<void> {
  const pid = response.playerId;
  const rawSelection = response.selections as any;
  const selection = Array.isArray(rawSelection) ? rawSelection[0] : rawSelection;
  
  if (!selection || typeof selection !== 'string') {
    debugWarn(2, `[Resolution] Color choice missing selection`);
    return;
  }
  
  // Validate color choice
  const validColors = ['white', 'blue', 'black', 'red', 'green'];
  const colorLower = selection.toLowerCase();
  if (!validColors.includes(colorLower)) {
    debugWarn(2, `[Resolution] Invalid color choice: ${selection}`);
    return;
  }
  
  const permanentId = (step as any).permanentId || (step as any).sourceId;
  const spellId = (step as any).spellId;
  const cardName = (step as any).cardName || (step as any).sourceName || 'Permanent';
  
  // Check if this is a spell color choice (instant/sorcery on stack)
  // vs a permanent ETB color choice
  const state = game.state || {};
  
  if (spellId) {
    // This is a spell on the stack that needs color choice (e.g., Brave the Elements)
    const stack = state.stack || [];
    const spellOnStack = stack.find((s: any) => s.id === spellId || s.cardId === spellId);
    
    if (spellOnStack) {
      // Store chosen color on the spell
      spellOnStack.chosenColor = colorLower;
      
      debug(2, `[Resolution] Spell color choice: ${cardName} -> ${colorLower}, will re-resolve`);
      
      // Append event for replay
      try {
        await appendEvent(gameId, (game as any).seq || 0, "colorChoice", {
          playerId: pid,
          spellId: spellId,
          cardName: cardName,
          color: colorLower,
        });
      } catch (e) {
        debugWarn(1, "[Resolution] Failed to persist spell color choice event:", e);
      }
      
      // Send chat message
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} chose ${selection} for ${cardName}.`,
        ts: Date.now(),
      });
      
      // Bump sequence before re-resolving
      if (typeof (game as any).bumpSeq === "function") {
        (game as any).bumpSeq();
      }
      
      // Now the spell has its chosen color - the stack processing will continue
      // The spell resolution will be retried by the main game loop
      return;
    }
  }
  
  // Default case: permanent ETB color choice
  const battlefield = state.battlefield || [];
  const permanent = battlefield.find((p: any) => p.id === permanentId);
  
  if (!permanent) {
    debugWarn(2, `[Resolution] Color choice: permanent ${permanentId} not found`);
    return;
  }
  
  // Store the chosen color on the permanent
  permanent.chosenColor = colorLower;
  
  // Append event for replay
  try {
    await appendEvent(gameId, (game as any).seq || 0, "colorChoice", {
      playerId: pid,
      permanentId: permanentId,
      cardName: cardName,
      color: colorLower,
    });
  } catch (e) {
    debugWarn(1, "[Resolution] Failed to persist color choice event:", e);
  }
  
  // Bump sequence
  if (typeof (game as any).bumpSeq === "function") {
    (game as any).bumpSeq();
  }
  
  // Send chat message
  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message: `${getPlayerName(game, pid)} chose ${selection} for ${cardName}.`,
    ts: Date.now(),
  });
  
  debug(2, `[Resolution] Color choice completed: ${cardName} -> ${selection}`);
}

async function handleCreatureTypeChoiceResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): Promise<void> {
  const pid = response.playerId;
  const rawSelection = response.selections as any;
  const selection = Array.isArray(rawSelection) ? rawSelection[0] : rawSelection;
  if (!selection || typeof selection !== 'string') {
    debugWarn(2, `[Resolution] Creature type choice missing selection`);
    return;
  }
  
  const { applyCreatureTypeSelection } = await import("./creature-type.js");
  const permanentId = (step as any).permanentId || (step as any).sourceId;
  const cardName = (step as any).cardName || (step as any).sourceName || 'Permanent';
  
  applyCreatureTypeSelection(io, game, gameId, pid, permanentId, cardName, selection, false);
}

/**
 * Handle Card Name Choice response
 * Player chooses a card name for a permanent (e.g., Pithing Needle, Runed Halo)
 */
async function handleCardNameChoiceResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): Promise<void> {
  const pid = response.playerId;
  const rawSelection = response.selections as any;
  const selection = Array.isArray(rawSelection) ? rawSelection[0] : rawSelection;
  
  if (!selection || typeof selection !== 'string') {
    debugWarn(2, `[Resolution] Card name choice missing selection`);
    return;
  }
  
  const permanentId = (step as any).permanentId || (step as any).sourceId;
  const cardName = (step as any).cardName || (step as any).sourceName || 'Permanent';
  
  // Find the permanent on the battlefield
  const state = game.state || {};
  const battlefield = state.battlefield || [];
  const permanent = battlefield.find((p: any) => p.id === permanentId);
  
  if (!permanent) {
    debugWarn(2, `[Resolution] Card name choice: permanent ${permanentId} not found`);
    return;
  }
  
  // Store the chosen card name on the permanent
  (permanent as any).chosenCardName = selection;
  
  // Append event for replay
  try {
    await appendEvent(gameId, (game as any).seq || 0, "cardNameChoice", {
      playerId: pid,
      permanentId: permanentId,
      cardName: cardName,
      chosenName: selection,
    });
  } catch (e) {
    debugWarn(1, "[Resolution] Failed to persist card name choice event:", e);
  }
  
  // Bump sequence
  if (typeof (game as any).bumpSeq === "function") {
    (game as any).bumpSeq();
  }
  
  // Send chat message
  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message: `${getPlayerName(game, pid)} chose "${selection}" for ${cardName}.`,
    ts: Date.now(),
  });
  
  debug(2, `[Resolution] Card name choice completed: ${cardName} -> ${selection}`);
}

/**
 * Handle Suspend Cast response
 * Player casts a spell with suspend (exile with time counters)
 */
async function handleSuspendCastResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): Promise<void> {
  const pid = response.playerId;
  const suspendStep = step as any;
  const card = suspendStep.card;
  const timeCounters = suspendStep.timeCounters || 0;
  
  debug(2, `[Resolution] Suspend cast: player=${pid}, card=${card.name}, timeCounters=${timeCounters}`);
  
  // Remove card from hand
  const state = game.state || {};
  const zones = state.zones = state.zones || {};
  const z = zones[pid] = zones[pid] || { hand: [], handCount: 0, exile: [], exileCount: 0 };
  
  const handIdx = (z.hand || []).findIndex((c: any) => c.id === card.id);
  if (handIdx !== -1) {
    z.hand.splice(handIdx, 1);
    z.handCount = z.hand.length;
  }
  
  // Exile the card with time counters
  z.exile = z.exile || [];
  z.exile.push({
    ...card,
    zone: 'exile',
    isSuspended: true,
    timeCounters: timeCounters,
    suspendedBy: pid,
  });
  z.exileCount = z.exile.length;
  
  // Send chat message
  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message: `${getPlayerName(game, pid)} suspended ${card.name} with ${timeCounters} time counter${timeCounters !== 1 ? 's' : ''}.`,
    ts: Date.now(),
  });
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}

/**
 * Handle Morph Turn Face-Up response
 * Player turns a face-down creature face-up
 */
function handleMorphTurnFaceUpResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const pid = response.playerId;
  const morphStep = step as any;
  const permanentId = morphStep.permanentId;
  const actualCard = morphStep.actualCard;
  
  if (response.cancelled) {
    debug(2, `[Resolution] Morph turn face-up cancelled for ${permanentId}`);
    return;
  }
  
  debug(2, `[Resolution] Morph turn face-up: player=${pid}, permanent=${permanentId}`);
  
  const state = game.state || {};
  const battlefield = state.battlefield = state.battlefield || [];
  
  // Find the face-down creature
  const creature = battlefield.find((p: any) => p.id === permanentId);
  if (!creature) {
    debugWarn(1, `[Resolution] Morph: creature ${permanentId} not found on battlefield`);
    return;
  }
  
  if (!creature.isFaceDown) {
    debugWarn(1, `[Resolution] Morph: creature ${permanentId} is not face-down`);
    return;
  }
  
  // Turn face-up
  creature.isFaceDown = false;
  creature.card = actualCard;
  
  // Update power/toughness from 2/2 to actual values
  const tl = (actualCard.type_line || '').toLowerCase();
  const isCreature = tl.includes('creature');
  if (isCreature) {
    creature.basePower = parsePT((actualCard as any).power);
    creature.baseToughness = parsePT((actualCard as any).toughness);
  }
  
  // Remove face-down specific properties
  delete creature.faceDownType;
  delete creature.morphCost;
  delete creature.faceUpCard;
  
  // Send chat message
  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message: `${getPlayerName(game, pid)} turned ${actualCard.name} face-up.`,
    ts: Date.now(),
  });
  
  // TODO: Trigger any morph/megamorph abilities
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}

/**
 * Process pending cascade triggers and migrate them to the resolution queue
 * This is called after spell resolution to check for cascades
 */
export async function processPendingCascades(
  io: Server,
  game: any,
  gameId: string
): Promise<void> {
  try {
    const pending = (game.state as any).pendingCascade;
    if (!pending) return;
    
    const { cardManaValue, uid } = await import("../state/utils.js");
    
    for (const playerId of Object.keys(pending)) {
      const queue = pending[playerId];
      if (!Array.isArray(queue) || queue.length === 0) continue;
      
      const entry = queue[0];
      if (!entry || entry.awaiting) continue;
      
      const lib = (game as any).libraries?.get(playerId) || [];
      if (!Array.isArray(lib)) continue;
      
      const exiled: any[] = [];
      let hitCard: any | null = null;
      while (lib.length > 0) {
        const card = lib.shift() as any;
        if (!card) break;
        exiled.push(card);
        const tl = (card.type_line || "").toLowerCase();
        const isLand = tl.includes("land");
        const mv = cardManaValue(card);
        if (!isLand && mv < entry.manaValue) {
          hitCard = card;
          break;
        }
      }
      
      const zones = game.state.zones = game.state.zones || {};
      const z = zones[playerId] = zones[playerId] || { 
        hand: [], 
        handCount: 0, 
        libraryCount: lib.length, 
        graveyard: [], 
        graveyardCount: 0 
      };
      z.libraryCount = lib.length;
      
      // If nothing hit, bottom exiled and continue
      if (!hitCard) {
        for (const card of exiled) {
          lib.push({ ...card, zone: "library" });
        }
        z.libraryCount = lib.length;
        queue.shift();
        continue;
      }
      
      // Mark as awaiting and prepare step data
      entry.awaiting = true;
      entry.hitCard = hitCard;
      entry.exiledCards = exiled;
      if (!entry.effectId) {
        entry.effectId = uid("cascade");
      }
      
      // Convert to KnownCardRef format for resolution queue
      const exiledRefs = exiled.map((c: any) => ({
        id: c.id,
        name: c.name,
        type_line: c.type_line,
        oracle_text: c.oracle_text,
        imageUrl: c.image_uris?.normal,
        mana_cost: c.mana_cost,
        cmc: c.cmc,
      }));
      
      const hitRef = {
        id: hitCard.id,
        name: hitCard.name,
        type_line: hitCard.type_line,
        oracle_text: hitCard.oracle_text,
        imageUrl: hitCard.image_uris?.normal,
        mana_cost: hitCard.mana_cost,
        cmc: hitCard.cmc,
      };
      
      // Add to resolution queue
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.CASCADE,
        playerId,
        description: `Cascade - Cast ${hitCard.name}?`,
        mandatory: true,
        sourceId: entry.sourceCardId,
        sourceName: entry.sourceName || "Cascade",
        cascadeNumber: entry.instance || 1,
        totalCascades: queue.length,
        manaValue: entry.manaValue,
        hitCard: hitRef,
        exiledCards: exiledRefs,
        effectId: entry.effectId,
      });
    }
  } catch (err) {
    debugWarn(1, "[processPendingCascades] Error:", err);
  }
}


/**
 * Process pending scry from legacy state and migrate to resolution queue
 * 
 * This is called after stack resolution or when scry effects are created.
 * Migrates from pendingScry state to the resolution queue system.
 */
export function processPendingScry(
  io: Server,
  game: any,
  gameId: string
): void {
  try {
    const pending = (game.state as any).pendingScry;
    if (!pending || typeof pending !== 'object') return;
    
    for (const playerId of Object.keys(pending)) {
      const scryCount = pending[playerId];
      if (typeof scryCount !== 'number' || scryCount <= 0) continue;
      
      // Get library
      const lib = (game as any).libraries?.get(playerId) || [];
      if (!Array.isArray(lib)) continue;
      
      // Peek at the top N cards
      const actualCount = Math.min(scryCount, lib.length);
      if (actualCount === 0) {
        // No cards to scry, skip
        delete pending[playerId];
        continue;
      }
      
      const cards = lib.slice(0, actualCount).map((c: any) => ({
        id: c.id,
        name: c.name,
        type_line: c.type_line,
        oracle_text: c.oracle_text,
        imageUrl: c.image_uris?.normal,
        mana_cost: c.mana_cost,
        cmc: c.cmc,
      }));
      
      // Add to resolution queue
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.SCRY,
        playerId,
        description: `Scry ${actualCount}`,
        mandatory: true,
        cards,
        scryCount: actualCount,
      });
      
      // Clear from pending state
      delete pending[playerId];
    }
    
    // Clean up empty pending object
    if (Object.keys(pending).length === 0) {
      delete (game.state as any).pendingScry;
    }
  } catch (err) {
    debugWarn(1, "[processPendingScry] Error:", err);
  }
}


/**
 * Process pending proliferate from legacy state and migrate to resolution queue
 * 
 * This is called after stack resolution or when proliferate effects are created.
 * Migrates from pendingProliferate array to the resolution queue system.
 */
export function processPendingProliferate(
  io: Server,
  game: any,
  gameId: string
): void {
  try {
    const pending = (game.state as any).pendingProliferate;
    if (!Array.isArray(pending) || pending.length === 0) return;
    
    const battlefield = game.state?.battlefield || [];
    const players = game.state?.players || [];
    
    // Process each pending proliferate effect
    for (const effect of pending) {
      if (!effect || effect.prompted) continue;
      
      const playerId = effect.controller;
      if (!playerId) continue;
      
      // Mark as prompted to avoid re-prompting
      effect.prompted = true;
      
      // Collect all valid targets (permanents and players with counters)
      const availableTargets: any[] = [];
      
      // Add permanents with counters
      for (const permanent of battlefield) {
        if (permanent?.counters && Object.keys(permanent.counters).length > 0) {
          const hasCounters = Object.values(permanent.counters).some((count: any) => count > 0);
          if (hasCounters) {
            availableTargets.push({
              id: permanent.id,
              name: permanent.card?.name || 'Permanent',
              counters: permanent.counters,
              isPlayer: false,
            });
          }
        }
      }
      
      // Add players with counters
      for (const player of players) {
        if (player?.counters && Object.keys(player.counters).length > 0) {
          const hasCounters = Object.values(player.counters).some((count: any) => count > 0);
          if (hasCounters) {
            availableTargets.push({
              id: player.id,
              name: player.username || player.id,
              counters: player.counters,
              isPlayer: true,
            });
          }
        }
      }
      
      // Add to resolution queue
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.PROLIFERATE,
        playerId,
        description: 'Choose permanents and/or players to proliferate',
        mandatory: false, // Proliferate is optional
        sourceId: effect.sourceId,
        sourceName: effect.sourceName || 'Proliferate',
        proliferateId: effect.id,
        availableTargets,
      });
    }
  } catch (err) {
    debugWarn(1, "[processPendingProliferate] Error:", err);
  }
}

/**
 * Handle PONDER_EFFECT response from client
 */
function handlePonderEffectResponse(
  io: Server,
  game: any,
  gameId: string,
  step: any,
  response: ResolutionStepResponse
): void {
  try {
    const { playerId } = step;
    const { selections, cancelled } = response;
    
    if (cancelled) {
      debug(2, `[handlePonderEffectResponse] ${playerId} cancelled ponder`);
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, playerId)} cancelled their ponder effect.`,
        ts: Date.now(),
      });
      return;
    }
    
    // selections should be: { newOrder: string[], shouldShuffle: boolean, toHand?: string[] }
    const { newOrder, shouldShuffle, toHand } = selections as any;
    const targetPid = step.targetPlayerId || playerId;
    
    // Get library for the target player
    const lib = (game as any).libraries?.get(targetPid) || [];
    
    // Remove the top N cards that were being reordered
    const cardCount = step.cardCount || step.cards?.length || 0;
    const removedCards: any[] = [];
    for (let i = 0; i < cardCount && lib.length > 0; i++) {
      removedCards.push(lib.shift());
    }
    
    const cardById = new Map(removedCards.map((c: any) => [c.id, c]));
    
    // Move cards to hand if specified (Telling Time style)
    if (toHand && toHand.length > 0) {
      const zones = (game.state as any).zones || {};
      const z = zones[playerId] = zones[playerId] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
      z.hand = z.hand || [];
      
      for (const cardId of toHand) {
        const card = cardById.get(cardId);
        if (card) {
          (z.hand as any[]).push({ ...card, zone: 'hand' });
          cardById.delete(cardId);
        }
      }
      z.handCount = (z.hand as any[]).length;
      
      debug(2, `[handlePonderEffectResponse] ${playerId} put ${toHand.length} card(s) to hand`);
    }
    
    if (shouldShuffle) {
      // Shuffle the remaining cards back into library first
      for (const card of cardById.values()) {
        lib.push({ ...card, zone: 'library' });
      }
      
      // Use game's shuffleLibrary for deterministic RNG if available
      if (typeof (game as any).shuffleLibrary === "function") {
        if ((game as any).libraries) {
          (game as any).libraries.set(targetPid, lib);
        }
        (game as any).shuffleLibrary(targetPid);
      } else {
        debugWarn(2, "[handlePonderEffectResponse] game.shuffleLibrary not available, using Math.random");
        for (let i = lib.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [lib[i], lib[j]] = [lib[j], lib[i]];
        }
        if ((game as any).libraries) {
          (game as any).libraries.set(targetPid, lib);
        }
      }
      
      debug(2, `[handlePonderEffectResponse] ${targetPid} shuffled their library`);
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, playerId)} shuffled their library.`,
        ts: Date.now(),
      });
    } else {
      // Put cards back in the specified order (newOrder has IDs from top to bottom)
      for (let i = newOrder.length - 1; i >= 0; i--) {
        const card = cardById.get(newOrder[i]);
        if (card) {
          lib.unshift({ ...card, zone: 'library' });
        }
      }
      debug(2, `[handlePonderEffectResponse] ${targetPid} reordered top ${newOrder.length} cards`);
    }
    
    // Update library count
    const zones = (game.state as any).zones || {};
    const targetZones = zones[targetPid] = zones[targetPid] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
    targetZones.libraryCount = lib.length;
    
    // Draw a card if specified (Ponder draws after reordering/shuffling)
    let drawnCardName: string | undefined;
    if (step.drawAfter && playerId === targetPid) {
      if (lib.length > 0) {
        const drawnCard = lib.shift();
        const playerZones = zones[playerId] = zones[playerId] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
        playerZones.hand = playerZones.hand || [];
        (playerZones.hand as any[]).push({ ...drawnCard, zone: 'hand' });
        playerZones.handCount = (playerZones.hand as any[]).length;
        playerZones.libraryCount = lib.length;
        drawnCardName = drawnCard.name;
        
        debug(2, `[handlePonderEffectResponse] ${playerId} drew ${drawnCardName}`);
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, playerId)} draws a card.`,
          ts: Date.now(),
        });
      }
    }
    
    // Clear pendingPonder state
    if ((game.state as any).pendingPonder) {
      delete (game.state as any).pendingPonder[playerId];
    }
    
    // Log event
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, playerId)} completed ponder effect (${step.sourceName || 'unknown'})`,
      ts: Date.now(),
    });
    
    // Bump sequence
    if (typeof (game as any).bumpSeq === "function") {
      (game as any).bumpSeq();
    }
    
    broadcastGame(io, game, gameId);
  } catch (e) {
    debugError(1, '[handlePonderEffectResponse] Error:', e);
  }
}

/**
 * Handle TWO_PILE_SPLIT response from client
 * Used by planeswalker templates and other "separate into two piles" effects.
 */
async function handleTwoPileSplitResponse(
  io: Server,
  game: any,
  gameId: string,
  step: any,
  response: ResolutionStepResponse
): Promise<void> {
  const stepData = step as any;
  const selections: any = response.selections;

  const items: any[] = Array.isArray(stepData.items) ? stepData.items : [];
  const itemIds = items.map((it: any) => String(it?.id || '')).filter(Boolean);
  const validIds = new Set(itemIds);

  let pileA: string[] = [];
  let pileB: string[] = [];

  if (selections && typeof selections === 'object') {
    if (Array.isArray(selections.pileA) && Array.isArray(selections.pileB)) {
      pileA = selections.pileA.map(String);
      pileB = selections.pileB.map(String);
    } else if (Array.isArray(selections.piles) && selections.piles.length === 2) {
      pileA = (selections.piles[0] || []).map(String);
      pileB = (selections.piles[1] || []).map(String);
    }
  }

  // Normalize: valid IDs only, no dupes, ensure full assignment.
  pileA = pileA.filter((id) => validIds.has(id));
  const pileASet = new Set(pileA);
  pileB = pileB.filter((id) => validIds.has(id) && !pileASet.has(id));
  const assigned = new Set([...pileA, ...pileB]);
  if (assigned.size !== itemIds.length) {
    pileA = [];
    pileB = [];
    itemIds.forEach((id, idx) => (idx % 2 === 0 ? pileA : pileB).push(id));
  }

  const minPerPile = Number(stepData.minPerPile ?? 0);
  if (minPerPile > 0 && (pileA.length < minPerPile || pileB.length < minPerPile)) {
    const donor = pileA.length > pileB.length ? pileA : pileB;
    const receiver = donor === pileA ? pileB : pileA;
    while (receiver.length < minPerPile && donor.length > minPerPile) {
      const moved = donor.pop();
      if (moved) receiver.push(moved);
    }
  }

  // ===== PLANESWALKER: JACE (TOP 3 -> OPPONENT SPLITS -> CONTROLLER CHOOSES PILE) =====
  if (stepData.pwJaceTop3TwoPiles === true) {
    const controllerId = String(stepData.pwJaceControllerId || '');
    const sourceName = String(stepData.pwJaceSourceName || step.sourceName || 'Planeswalker');
    const topCards: any[] = Array.isArray(stepData.pwJaceTopCards) ? stepData.pwJaceTopCards : [];
    const originalOrder: string[] = Array.isArray(stepData.pwJaceTopCardIds)
      ? stepData.pwJaceTopCardIds.map(String)
      : topCards.map((c: any) => c?.id).filter(Boolean);

    const byId = new Map(topCards.map((c: any) => [String(c?.id || ''), c]));
    const names = (ids: string[]) => ids.map((id) => byId.get(id)?.name).filter(Boolean).join(', ') || '(empty)';

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: controllerId as PlayerID,
      description: `${sourceName}: Choose a pile to put into your hand`,
      mandatory: true,
      sourceName,
      options: [
        { id: 'pileA', label: `Pile A (${pileA.length})`, description: names(pileA) },
        { id: 'pileB', label: `Pile B (${pileB.length})`, description: names(pileB) },
      ],
      minSelections: 1,
      maxSelections: 1,
      pwJaceTop3PickPile: true,
      pwJaceControllerId: controllerId,
      pwJaceSourceName: sourceName,
      pwJaceTopCards: topCards,
      pwJaceTopCardIds: originalOrder,
      pwJacePileA: pileA,
      pwJacePileB: pileB,
    } as any);

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${sourceName}: ${getPlayerName(game, response.playerId)} separated the cards into two piles.`,
      ts: Date.now(),
    });
    return;
  }

  // ===== PLANESWALKER: LILIANA (TARGET PLAYER SPLITS PERMANENTS -> CHOOSES PILE TO SACRIFICE) =====
  if (stepData.pwLilianaSplitPermanents === true) {
    const targetPlayerId = String(stepData.pwLilianaTargetPlayerId || response.playerId);
    const sourceName = String(stepData.pwLilianaSourceName || step.sourceName || 'Planeswalker');

    const battlefield = (game.state?.battlefield || []) as any[];
    const byPermId = new Map(battlefield.map((p: any) => [String(p?.id || ''), p]));
    const pileDesc = (ids: string[]) => ids.map((id) => byPermId.get(id)?.card?.name || byPermId.get(id)?.name).filter(Boolean).join(', ') || '(empty)';

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: targetPlayerId as PlayerID,
      description: `${sourceName}: Choose a pile to sacrifice`,
      mandatory: true,
      sourceName,
      options: [
        { id: 'pileA', label: `Pile A (${pileA.length})`, description: pileDesc(pileA) },
        { id: 'pileB', label: `Pile B (${pileB.length})`, description: pileDesc(pileB) },
      ],
      minSelections: 1,
      maxSelections: 1,
      pwLilianaChoosePileToSacrifice: true,
      pwLilianaTargetPlayerId: targetPlayerId,
      pwLilianaSourceName: sourceName,
      pwLilianaPileA: pileA,
      pwLilianaPileB: pileB,
    } as any);

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${sourceName}: ${getPlayerName(game, targetPlayerId)} separated their permanents into two piles.`,
      ts: Date.now(),
    });
    return;
  }

  debug(2, `[handleTwoPileSplitResponse] No handler for TWO_PILE_SPLIT step ${step.id}`);
}

/**
 * Process pending ponder effects into resolution queue
 */
export function processPendingPonder(io: Server, game: any, gameId: string): void {
  try {
    const pendingPonder = (game.state as any)?.pendingPonder;
    if (!pendingPonder || typeof pendingPonder !== 'object') return;
    
    for (const [playerId, ponderData] of Object.entries(pendingPonder)) {
      if (!ponderData || typeof ponderData !== 'object') continue;
      
      const data = ponderData as any;
      const { effectId, cardCount, cardName, drawAfter, targetPlayerId, variant } = data;
      
      // Get the top cards for ponder
      const targetPid = targetPlayerId || playerId;
      const lib = (game as any).libraries?.get(targetPid) || [];
      const actualCount = Math.min(cardCount || 3, lib.length);
      const cards = lib.slice(0, actualCount);
      
      debug(2, `[processPendingPonder] Migrating ponder for player ${playerId}, ${actualCount} cards`);
      
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.PONDER_EFFECT,
        playerId: playerId as string,
        description: `Ponder: ${cardName || 'Look at top cards'}`,
        cards,
        variant: variant || 'ponder',
        cardCount: actualCount,
        drawAfter: drawAfter || false,
        mayShuffleAfter: true,
        targetPlayerId: targetPid,
        sourceName: cardName,
        effectId,
      });
    }
  } catch (e) {
    debugError(1, '[processPendingPonder] Error:', e);
  }
}

/**
 * Helper function to filter library cards based on search criteria
 * @param library - Array of library cards to filter
 * @param filter - Search criteria filter
 * @param gameState - Optional game state context for calculating variable P/T (CDA)
 * @param controllerId - Optional controller ID for CDA calculation context
 */
function filterLibraryCards(library: any[], filter: any, gameState?: any, controllerId?: string): any[] {
  const availableCards: any[] = [];
  const searchCriteria = filter || {};
  
  // Build game state context for CDA calculations
  const gameStateForCDA = gameState ? {
    battlefield: gameState.battlefield || [],
    zones: gameState.zones || {},
    players: gameState.players || [],
    life: gameState.life || {},
    manaPool: gameState.manaPool || {},
  } : undefined;
  
  for (const card of library) {
    let matches = true;
    
    // Check types
    if (searchCriteria.types && searchCriteria.types.length > 0) {
      const typeLine = (card.type_line || '').toLowerCase();
      matches = searchCriteria.types.some((type: string) => typeLine.includes(type.toLowerCase()));
    }
    
    // Check subtypes
    if (matches && searchCriteria.subtypes && searchCriteria.subtypes.length > 0) {
      const typeLine = (card.type_line || '').toLowerCase();
      matches = searchCriteria.subtypes.some((subtype: string) => typeLine.includes(subtype.toLowerCase()));
    }
    
    // Check supertypes (e.g., "Basic" for basic lands)
    if (matches && searchCriteria.supertypes && searchCriteria.supertypes.length > 0) {
      const typeLine = (card.type_line || '').toLowerCase();
      matches = searchCriteria.supertypes.some((supertype: string) => typeLine.includes(supertype.toLowerCase()));
    }
    
    // Check colors
    if (matches && searchCriteria.colors && searchCriteria.colors.length > 0) {
      const cardColors = card.colors || [];
      matches = searchCriteria.colors.some((color: string) => cardColors.includes(color));
    }
    
    // Check mana value
    if (matches && typeof searchCriteria.maxManaValue === 'number') {
      matches = (card.cmc || 0) <= searchCriteria.maxManaValue;
    }
    
    // Check power (e.g., "creature with power 2 or less" - Imperial Recruiter)
    // Handle both numeric and variable (*) power via CDA calculation
    if (matches && typeof searchCriteria.maxPower === 'number') {
      if (card.power !== undefined && card.power !== null) {
        const powerStr = String(card.power);
        const powerNum = parseInt(powerStr, 10);
        if (!isNaN(powerNum)) {
          // Standard numeric power
          matches = powerNum <= searchCriteria.maxPower;
        } else if (powerStr.includes('*') && gameStateForCDA) {
          // Variable power - calculate via CDA
          const cardWithOwner = { ...card, owner: controllerId, controller: controllerId };
          const calculatedPT = calculateVariablePT(cardWithOwner, gameStateForCDA);
          if (calculatedPT) {
            matches = calculatedPT.power <= searchCriteria.maxPower;
          }
          // If CDA returns undefined, allow the card (can't determine)
        }
        // Other non-numeric formats without game state: allow the card
      }
      // If power is undefined (non-creature), don't filter based on power
    }
    
    // Check toughness (e.g., "creature with toughness 2 or less" - Recruiter of the Guard)
    // Handle both numeric and variable (*) toughness via CDA calculation
    if (matches && typeof searchCriteria.maxToughness === 'number') {
      if (card.toughness !== undefined && card.toughness !== null) {
        const toughnessStr = String(card.toughness);
        const toughnessNum = parseInt(toughnessStr, 10);
        if (!isNaN(toughnessNum)) {
          // Standard numeric toughness
          matches = toughnessNum <= searchCriteria.maxToughness;
        } else if (toughnessStr.includes('*') && gameStateForCDA) {
          // Variable toughness - calculate via CDA
          const cardWithOwner = { ...card, owner: controllerId, controller: controllerId };
          const calculatedPT = calculateVariablePT(cardWithOwner, gameStateForCDA);
          if (calculatedPT) {
            matches = calculatedPT.toughness <= searchCriteria.maxToughness;
          }
          // If CDA returns undefined, allow the card (can't determine)
        }
        // Other non-numeric formats without game state: allow the card
      }
      // If toughness is undefined (non-creature), don't filter based on toughness
    }
    
    // Check minimum CMC (e.g., "mana value 6 or greater" - Fierce Empath)
    if (matches && typeof searchCriteria.minCmc === 'number') {
      matches = (card.cmc || 0) >= searchCriteria.minCmc;
    }
    
    if (matches) {
      availableCards.push({
        id: card.id,
        name: card.name,
        type_line: card.type_line,
        oracle_text: card.oracle_text,
        image_uris: card.image_uris,  // Include full image_uris for battlefield placement
        imageUrl: card.image_uris?.normal,
        mana_cost: card.mana_cost,
        cmc: card.cmc,
        colors: card.colors,
        power: card.power,
        toughness: card.toughness,
        loyalty: card.loyalty,
      });
    }
  }
  
  return availableCards;
}

/**
 * Helper function to create a library search resolution step directly
 */
function createLibrarySearchStep(
  game: any,
  gameId: string,
  playerId: string,
  options: {
    searchFor: string;
    destination?: string;
    tapped?: boolean;
    optional?: boolean;
    source?: string;
    shuffleAfter?: boolean;
    filter?: any;
    maxSelections?: number;
    minSelections?: number;
    reveal?: boolean;
    remainderDestination?: string;
  }
): void {
  const {
    searchFor,
    destination = 'hand',
    tapped = false,
    optional = true,
    source = 'Library Search',
    shuffleAfter = true,
    filter = {},
    maxSelections = 1,
    minSelections = 0,
    reveal = true,
    remainderDestination = 'shuffle',
  } = options;
  
  // Get player's library
  const lib = (game as any).libraries?.get(playerId) || [];
  if (lib.length === 0) {
    debug(2, `[createLibrarySearchStep] Player ${playerId} has empty library, skipping search`);
    return;
  }
  
  // Filter cards based on search criteria, passing game state for CDA calculations
  const gameState = game.state || game;
  const availableCards = filterLibraryCards(lib, filter, gameState, playerId);
  
  debug(2, `[createLibrarySearchStep] Creating library search for player ${playerId}, ${availableCards.length} matching cards`);
  
  // Create description
  let description = searchFor || 'Search your library';
  if (destination === 'battlefield') {
    description += tapped ? ' (enters tapped)' : ' (enters untapped)';
  }
  
  ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.LIBRARY_SEARCH,
    playerId: playerId as PlayerID,
    description,
    mandatory: !optional,
    sourceName: source,
    searchCriteria: searchFor || 'any card',
    minSelections,
    maxSelections,
    destination,
    reveal,
    shuffleAfter,
    availableCards,
    entersTapped: tapped,
    remainderDestination,
    remainderRandomOrder: true,
  });
}

/**
 * Handle player choice response (for triggers that target a player)
 * Used by cards like Bojuka Bog ("exile target player's graveyard")
 */
async function handlePlayerChoiceResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): Promise<void> {
  // Handle different types of selections
  let selectedPlayerId: string;
  if (typeof response.selections === 'string') {
    selectedPlayerId = response.selections;
  } else if (Array.isArray(response.selections) && response.selections.length > 0) {
    selectedPlayerId = response.selections[0];
  } else {
    debugError(1, `[Resolution] Invalid player choice response: ${JSON.stringify(response.selections)}`);
    return;
  }
  
  const stepData = step as any;
  
  debug(2, `[Resolution] Player choice response: selected player ${selectedPlayerId}`);
  
  // Check if this is an ETB permanent choice (Xantcha, Curses, etc.)
  if (stepData.permanentId) {
    const permanentId = stepData.permanentId;
    const cardName = stepData.sourceName || 'Permanent';
    
    // Find the permanent on the battlefield
    const state = game.state || {};
    const battlefield = state.battlefield || [];
    const permanent = battlefield.find((p: any) => p.id === permanentId);
    
    if (permanent) {
      // Store the chosen player on the permanent
      (permanent as any).chosenPlayer = selectedPlayerId;
      
      // Append event for replay
      try {
        await appendEvent(gameId, (game as any).seq || 0, "playerChoice", {
          playerId: response.playerId,
          permanentId: permanentId,
          cardName: cardName,
          chosenPlayer: selectedPlayerId,
        });
      } catch (e) {
        debugWarn(1, "[Resolution] Failed to persist player choice event:", e);
      }
      
      // Bump sequence
      if (typeof (game as any).bumpSeq === "function") {
        (game as any).bumpSeq();
      }
      
      // Send chat message
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, response.playerId)} chose ${getPlayerName(game, selectedPlayerId)} for ${cardName}.`,
        ts: Date.now(),
      });
      
      debug(2, `[Resolution] Player choice completed: ${cardName} -> ${selectedPlayerId}`);
    }
    return;
  }
  
  // Check if this is an ETB trigger with target
  if (stepData.etbTargetTrigger && stepData.triggerItem) {
    const triggerItem = stepData.triggerItem;
    const sourceName = triggerItem.sourceName || 'Unknown';
    const description = triggerItem.description || '';
    const controller = triggerItem.controller;
    const ctx = (game as any).ctx || game;
    
    // Store the selected target on the trigger item
    triggerItem.selectedTarget = selectedPlayerId;
    
    // Execute the trigger effect with the target
    await executeTargetedTriggerEffect(ctx, controller, sourceName, description, triggerItem, selectedPlayerId);
    
    // Bump sequence
    if (typeof (game as any).bumpSeq === 'function') {
      (game as any).bumpSeq();
    }
  }
}

/**
 * Execute a triggered ability that has a target
 * Handles effects like "exile target player's graveyard"
 */
async function executeTargetedTriggerEffect(
  ctx: any,
  controller: string,
  sourceName: string,
  description: string,
  triggerItem: any,
  targetPlayerId: string
): Promise<void> {
  const state = ctx.state;
  if (!state) return;
  
  const desc = description.toLowerCase();
  
  debug(2, `[executeTargetedTriggerEffect] ${sourceName}: ${description} (target: ${targetPlayerId})`);
  
  // Pattern: "exile target player's graveyard" (Bojuka Bog, etc.)
  if (desc.includes('exile') && desc.includes('graveyard')) {
    const zones = state.zones = state.zones || {};
    const targetZones = zones[targetPlayerId] = zones[targetPlayerId] || {
      hand: [],
      handCount: 0,
      graveyard: [],
      graveyardCount: 0,
      exile: [],
      exileCount: 0,
    };
    
    // Move all cards from target player's graveyard to exile
    const graveyardCards = targetZones.graveyard || [];
    const exileZone = targetZones.exile || [];
    
    if (graveyardCards.length > 0) {
      // Move all graveyard cards to exile
      for (const card of graveyardCards) {
        exileZone.push({ ...card, zone: 'exile' });
      }
      
      debug(2, `[executeTargetedTriggerEffect] ${sourceName}: Exiled ${graveyardCards.length} cards from ${targetPlayerId}'s graveyard`);
      
      // Clear the graveyard
      targetZones.graveyard = [];
      targetZones.graveyardCount = 0;
      targetZones.exile = exileZone;
      targetZones.exileCount = exileZone.length;
      
      // Emit chat message
      const io = (ctx as any).io;
      if (io) {
        io.to((ctx as any).gameId).emit('chat', {
          id: `m_${Date.now()}`,
          gameId: (ctx as any).gameId,
          from: 'system',
          message: `${sourceName}: Exiled ${graveyardCards.length} cards from ${targetPlayerId}'s graveyard`,
          ts: Date.now(),
        });
      }
    } else {
      debug(2, `[executeTargetedTriggerEffect] ${sourceName}: Target player's graveyard is empty`);
    }
  }
  
  // Add more targeted effect patterns here as needed
  // Pattern: "destroy target creature"
  // Pattern: "return target permanent to its owner's hand"
  // etc.
}

/**
 * Handle option choice response (for generic "choose one" effects)
 * Used by Agitator Ant, modal spells, Rebound, etc.
 */
async function handleOptionChoiceResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): Promise<void> {
  const selectedOption = response.selections;
  const stepData = step as any;
  const playerId = response.playerId;
  
  debug(2, `[Resolution] Option choice response from ${playerId}: ${selectedOption}`);

  const extractId = (sel: any): string | null => {
    if (typeof sel === 'string') return sel;
    if (Array.isArray(sel) && sel.length > 0) return typeof sel[0] === 'string' ? sel[0] : (sel[0] as any)?.id || null;
    if (sel && typeof sel === 'object') return (sel as any).id || (sel as any).value || null;
    return null;
  };

  // ===== COMBAT: ATTACK TAX (Ghostly Prison / Propaganda style) =====
  // This is queued from server/socket/combat.ts when an attack requires paying a generic tax.
  // The client presents a simple confirm/cancel choice.
  if (stepData?.attackCostPayment === true) {
    const choiceId = extractId(selectedOption);
    const controllerId = String(response.playerId);
    const amount = Number(stepData.attackCostAmount || 0) || 0;
    const attackers = Array.isArray(stepData.attackers) ? stepData.attackers : [];
    const breakdown = Array.isArray(stepData.attackCostBreakdown) ? stepData.attackCostBreakdown : [];

    if (!choiceId) {
      debugWarn(1, `[Resolution] attackCostPayment: missing choice id`);
      return;
    }

    if (choiceId === 'cancel_attack') {
      debug(2, `[Resolution] attackCostPayment: ${controllerId} cancelled attack`);
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${getPlayerName(game, controllerId)} declined to pay the attack cost.`,
        ts: Date.now(),
      });
      if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
      broadcastGame(io, game, gameId);
      return;
    }

    if (choiceId !== 'pay_attack_cost') {
      debugWarn(1, `[Resolution] attackCostPayment: unexpected choice '${choiceId}'`);
      return;
    }

    if (attackers.length === 0) {
      debugWarn(1, `[Resolution] attackCostPayment: missing attackers payload`);
      emitToPlayer(io, controllerId, 'error', {
        code: 'DECLARE_ATTACKERS_ERROR',
        message: 'Attack cost payment step is missing attacker data.',
      });
      return;
    }

    try {
      await executeDeclareAttackers(io, gameId, controllerId as any, attackers, {
        attackCostPaid: true,
        attackCostAmount: amount,
        attackCostBreakdown: breakdown,
      });
    } catch (err: any) {
      debugError(1, `[Resolution] attackCostPayment failed:`, err);
      emitToPlayer(io, controllerId, 'error', {
        code: err?.code || 'DECLARE_ATTACKERS_ERROR',
        message: err?.message ?? String(err),
      });
      broadcastGame(io, game, gameId);
    }
    return;
  }

  // ===== PLANESWALKER: "Draw two cards. Then discard two cards unless you discard an artifact card." =====
  if (stepData?.pwDrawTwoDiscardTwoUnlessArtifact === true) {
    const choiceId = extractId(selectedOption) || 'discard_two';
    const controllerId = String(response.playerId);
    const sourceName = String(stepData.pwDrawTwoDiscardTwoUnlessArtifactSourceName || step.sourceName || 'Planeswalker');

    const state = game.state || {};
    const zones = (state.zones = state.zones || {});
    const z = (zones[controllerId] = zones[controllerId] || {
      hand: [],
      handCount: 0,
      libraryCount: 0,
      graveyard: [],
      graveyardCount: 0,
      exile: [],
      exileCount: 0,
    });
    const hand: any[] = Array.isArray(z.hand) ? z.hand : (z.hand = []);

    const artifactHand = hand.filter((c: any) => String(c?.type_line || '').toLowerCase().includes('artifact'));
    const toHandCards = (cards: any[]) =>
      cards.map((c: any) => ({
        id: c.id,
        name: c.name,
        type_line: c.type_line,
        oracle_text: c.oracle_text,
        image_uris: c.image_uris,
        mana_cost: c.mana_cost,
        cmc: c.cmc,
        colors: c.colors,
      }));

    if (choiceId === 'discard_artifact' && artifactHand.length > 0) {
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.DISCARD_SELECTION,
        playerId: controllerId as any,
        description: `${sourceName}: Discard 1 artifact card`,
        mandatory: true,
        sourceName,
        discardCount: 1,
        hand: toHandCards(artifactHand),
      } as any);
    } else {
      const discardCount = Math.min(2, hand.length);
      if (discardCount <= 0) {
        io.to(gameId).emit('chat', {
          id: `m_${Date.now()}`,
          gameId,
          from: 'system',
          message: `${sourceName}: ${getPlayerName(game, controllerId)} had no cards to discard.`,
          ts: Date.now(),
        });
        if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
        return;
      }

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.DISCARD_SELECTION,
        playerId: controllerId as any,
        description: `${sourceName}: Discard ${discardCount} card${discardCount === 1 ? '' : 's'}`,
        mandatory: true,
        sourceName,
        discardCount,
        hand: toHandCards(hand),
      } as any);
    }

    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    return;
  }

  // ===== PLANESWALKER: JACE TOP 3 -> CONTROLLER CHOOSES OPPONENT TO SPLIT =====
  if (stepData?.pwJaceTop3ChooseOpponent === true) {
    const chosenOpponentId = extractId(selectedOption);
    const controllerId = String(stepData.pwJaceControllerId || playerId);
    const sourceName = String(stepData.pwJaceSourceName || step.sourceName || 'Planeswalker');
    const topCards: any[] = Array.isArray(stepData.pwJaceTopCards) ? stepData.pwJaceTopCards : [];
    const topCardIds: string[] = Array.isArray(stepData.pwJaceTopCardIds)
      ? stepData.pwJaceTopCardIds.map(String)
      : topCards.map((c: any) => c?.id).filter(Boolean);

    if (!chosenOpponentId) {
      debugWarn(2, `[Resolution] pwJaceTop3ChooseOpponent: missing opponent choice`);
      return;
    }

    const items = topCards.map((c: any) => ({
      id: c.id,
      label: c.name || 'Unknown',
      description: c.type_line,
      imageUrl: c.image_uris?.normal || c.image_uris?.art_crop || c.image_uris?.small,
    }));

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.TWO_PILE_SPLIT,
      playerId: chosenOpponentId as PlayerID,
      description: `${sourceName}: Separate the revealed cards into two piles`,
      mandatory: true,
      sourceName,
      items,
      minPerPile: 0,
      pwJaceTop3TwoPiles: true,
      pwJaceControllerId: controllerId,
      pwJaceSourceName: sourceName,
      pwJaceTopCards: topCards,
      pwJaceTopCardIds: topCardIds,
    } as any);

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${sourceName}: ${getPlayerName(game, controllerId)} chose ${getPlayerName(game, chosenOpponentId)} to separate the piles.`,
      ts: Date.now(),
    });

    return;
  }

  // ===== GENERIC: "You may cast <that card> from exile without paying its mana cost." =====
  // Used by planeswalker templates and other effects that exile a card then offer a free cast.
  if (stepData.castFromExileCardId && stepData.castFromExileCard) {
    const choiceId = extractId(selectedOption) || 'decline';
    const exiledCardId = String(stepData.castFromExileCardId);
    const declineDestination = String(stepData.castFromExileDeclineDestination || 'exile');
    const zones = game.state?.zones?.[playerId];
    if (!zones || !zones.exile) {
      debugWarn(2, `[Resolution] Cast-from-exile: No exile zone found for player ${playerId}`);
      return;
    }

    const cardIndex = zones.exile.findIndex((c: any) => c?.id === exiledCardId);
    if (cardIndex === -1) {
      debugWarn(2, `[Resolution] Cast-from-exile: Card ${exiledCardId} not found in exile`);
      return;
    }

    const exiledCard = zones.exile[cardIndex];
    const sourceName = String(stepData.sourceName || step.sourceName || 'Ability');

    if (choiceId === 'cast') {
      zones.exile.splice(cardIndex, 1);
      zones.exileCount = zones.exile.length;

      const stackItem = {
        id: uid('free_exile_spell'),
        type: 'spell',
        card: { ...exiledCard, zone: 'stack' },
        controller: playerId,
        targets: [],
        castFromHand: false,
        castFromExile: true,
        castWithoutPayingManaCost: true,
      };

      game.state.stack = game.state.stack || [];
      game.state.stack.push(stackItem);

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${getPlayerName(game, playerId)} cast ${exiledCard.name} from exile without paying its mana cost (${sourceName}).`,
        ts: Date.now(),
      });
    } else {
      if (declineDestination === 'graveyard') {
        zones.exile.splice(cardIndex, 1);
        zones.exileCount = zones.exile.length;
        zones.graveyard = zones.graveyard || [];
        zones.graveyard.push({ ...exiledCard, zone: 'graveyard' });
        zones.graveyardCount = zones.graveyard.length;
      }

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message:
          declineDestination === 'graveyard'
            ? `${getPlayerName(game, playerId)} declined to cast ${exiledCard.name} and it was put into their graveyard (${sourceName}).`
            : `${getPlayerName(game, playerId)} declined to cast ${exiledCard.name} (${sourceName}).`,
        ts: Date.now(),
      });
    }

    // Multi-card follow-up: if this prompt is part of a queue, enqueue the next prompt.
    try {
      const queueIds = Array.isArray(stepData.castFromExileQueueCardIds) ? stepData.castFromExileQueueCardIds : null;
      const queueCards = Array.isArray(stepData.castFromExileQueueCards) ? stepData.castFromExileQueueCards : null;
      const queueIndex = Number(stepData.castFromExileQueueIndex || 0);
      if (queueIds && queueCards && queueIds.length > 0 && queueCards.length > 0) {
        const nextIndex = queueIndex + 1;
        const next = queueCards[nextIndex];
        if (next && nextIndex < queueCards.length) {
          ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.OPTION_CHOICE,
            playerId: playerId as any,
            description: `${sourceName}: You may cast ${next?.name || 'that card'} from exile without paying its mana cost.`,
            mandatory: false,
            sourceName,
            sourceId: (step as any).sourceId,
            sourceImage: (step as any).sourceImage,
            options: [
              { id: 'cast', label: `Cast ${next?.name || 'that card'}` },
              { id: 'decline', label: 'Decline' },
            ],
            minSelections: 1,
            maxSelections: 1,
            castFromExileCardId: next?.id,
            castFromExileCard: next,
            castFromExileDeclineDestination: declineDestination,
            castFromExileQueueCardIds: queueIds,
            castFromExileQueueCards: queueCards,
            castFromExileQueueIndex: nextIndex,
          } as any);
        }
      }
    } catch (err) {
      debugWarn(2, `[Resolution] Cast-from-exile: Failed to enqueue next queued prompt:`, err);
    }

    if (typeof (game as any).bumpSeq === 'function') {
      (game as any).bumpSeq();
    }
    return;
  }

  // ===== PLANESWALKER: "Exile the top card... You may cast... If you don't, deal N to each opponent." =====
  if (stepData?.pwChandraImpulseCastOrBurn === true) {
    const choiceId = extractId(selectedOption) || 'dont';
    const controllerId = String(stepData.pwChandraImpulseController || playerId);
    const damage = Number(stepData.pwChandraImpulseDamage || 0);
    const sourceName = String(stepData.pwChandraImpulseSourceName || step.sourceName || 'Ability');
    const exiledCardId = String(stepData.pwChandraImpulseExiledCardId || '');

    if (choiceId === 'cast') {
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${sourceName}: ${getPlayerName(game, controllerId)} chose to cast the exiled card${exiledCardId ? ` (${exiledCardId})` : ''}.`,
        ts: Date.now(),
      });

      // Note: We currently don't have a resolution-step-driven "cast a spell now" flow.
      // The card remains in exile and may be cast via the normal casting pipeline.
    } else {
      const startingLife = game.state.startingLife || 40;
      game.state.life = game.state.life || {};

      for (const p of game.state.players || []) {
        if (!p?.id) continue;
        if (String(p.id) === controllerId) continue;
        const pid = String(p.id);
        const currentLife = game.state.life?.[pid] ?? startingLife;
        game.state.life[pid] = currentLife - damage;
      }

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${sourceName}: ${getPlayerName(game, controllerId)} chose not to cast the exiled card. ${sourceName} deals ${damage} damage to each opponent.`,
        ts: Date.now(),
      });
    }

    if (typeof (game as any).bumpSeq === 'function') {
      (game as any).bumpSeq();
    }
    return;
  }

  // ===== PLANESWALKER: "Exile the top two cards... Choose one... You may play it this turn." =====
  if (stepData?.pwExileTopTwoChooseOnePlay === true) {
    const chosenCardId = extractId(selectedOption);
    const controllerId = String(stepData.pwExileTopTwoChooseOnePlayController || playerId);
    const sourceName = String(stepData.pwExileTopTwoChooseOnePlaySourceName || step.sourceName || 'Planeswalker');
    const cardIds: string[] = Array.isArray(stepData.pwExileTopTwoChooseOnePlayCardIds)
      ? stepData.pwExileTopTwoChooseOnePlayCardIds
      : [];

    if (!chosenCardId || cardIds.length === 0 || !cardIds.includes(chosenCardId)) {
      debugWarn(2, `[Resolution] pwExileTopTwoChooseOnePlay: invalid selection`);
      return;
    }

    ;(game.state as any).playableFromExile = (game.state as any).playableFromExile || {};
    const pfe = (((game.state as any).playableFromExile[controllerId] =
      (game.state as any).playableFromExile[controllerId] || {}) as any);
    pfe[chosenCardId] = (game.state as any).turnNumber ?? 0;

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${sourceName}: ${getPlayerName(game, controllerId)} chose an exiled card to play this turn.`,
      ts: Date.now(),
    });

    if (typeof (game as any).bumpSeq === 'function') {
      (game as any).bumpSeq();
    }
    return;
  }

  // ===== PLANESWALKER: "Draw a card, then put a card from your hand on top of your library." =====
  if (stepData?.pwDrawThenHandToTop === true) {
    const chosenCardId = extractId(selectedOption);
    const controllerId = String(stepData.pwDrawThenHandToTopController || playerId);
    const sourceName = String(stepData.pwDrawThenHandToTopSourceName || step.sourceName || 'Planeswalker');
    if (!chosenCardId) {
      debugWarn(2, `[Resolution] pwDrawThenHandToTop: missing selection`);
      return;
    }

    const state = game.state || {};
    const zones = (state.zones = state.zones || {});
    const z = (zones[controllerId] = zones[controllerId] || {
      hand: [],
      handCount: 0,
      libraryCount: 0,
      graveyard: [],
      graveyardCount: 0,
    });
    z.hand = z.hand || [];

    const idx = (z.hand as any[]).findIndex((c: any) => String(c?.id) === String(chosenCardId));
    if (idx < 0) {
      debugWarn(2, `[Resolution] pwDrawThenHandToTop: selected card not in hand`);
      return;
    }

    const [card] = (z.hand as any[]).splice(idx, 1);

    const lib = (game as any).libraries?.get?.(controllerId) || (z.library as any[]) || [];
    lib.unshift({ ...card, zone: 'library' });
    if ((game as any).libraries?.set) {
      (game as any).libraries.set(controllerId, lib);
    } else {
      z.library = lib;
    }

    z.handCount = (z.hand as any[]).length;
    z.libraryCount = lib.length;

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${sourceName}: ${getPlayerName(game, controllerId)} put a card from their hand on top of their library.`,
      ts: Date.now(),
    });

    if (typeof (game as any).bumpSeq === 'function') {
      (game as any).bumpSeq();
    }
    return;
  }

  // ===== PLANESWALKER: "Draw N cards, then put a card from your hand on the bottom of your library." =====
  if (stepData?.pwDrawThenHandToBottom === true) {
    const chosenCardId = extractId(selectedOption);
    const controllerId = String(stepData.pwDrawThenHandToBottomController || playerId);
    const sourceName = String(stepData.pwDrawThenHandToBottomSourceName || step.sourceName || 'Planeswalker');
    if (!chosenCardId) {
      debugWarn(2, `[Resolution] pwDrawThenHandToBottom: missing selection`);
      return;
    }

    const state = game.state || {};
    const zones = (state.zones = state.zones || {});
    const z = (zones[controllerId] = zones[controllerId] || {
      hand: [],
      handCount: 0,
      libraryCount: 0,
      graveyard: [],
      graveyardCount: 0,
    });
    z.hand = z.hand || [];

    const idx = (z.hand as any[]).findIndex((c: any) => String(c?.id) === String(chosenCardId));
    if (idx < 0) {
      debugWarn(2, `[Resolution] pwDrawThenHandToBottom: selected card not in hand`);
      return;
    }

    const [card] = (z.hand as any[]).splice(idx, 1);

    const lib = (game as any).libraries?.get?.(controllerId) || (z.library as any[]) || [];
    lib.push({ ...card, zone: 'library' });
    if ((game as any).libraries?.set) {
      (game as any).libraries.set(controllerId, lib);
    } else {
      z.library = lib;
    }

    z.handCount = (z.hand as any[]).length;
    z.libraryCount = lib.length;

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${sourceName}: ${getPlayerName(game, controllerId)} put a card from their hand on the bottom of their library.`,
      ts: Date.now(),
    });

    if (typeof (game as any).bumpSeq === 'function') {
      (game as any).bumpSeq();
    }
    return;
  }

  // ===== PLANESWALKER: "You may sacrifice another permanent. If you do, gain N life and draw." =====
  if (stepData?.pwSacAnotherPermanentGainLifeDraw === true) {
    const choiceId = extractId(selectedOption) || 'dont';
    const stage = String(stepData.pwSacAnotherPermanentStage || '');
    const controllerId = String(stepData.pwSacAnotherPermanentController || playerId);
    const lifeGain = Number(stepData.pwSacAnotherPermanentLifeGain || 0);
    const sourceName = String(stepData.pwSacAnotherPermanentSourceName || step.sourceName || 'Ability');
    const sourcePermanentId = stepData.pwSacAnotherPermanentSourcePermanentId as string | undefined;

    if (stage === 'ask') {
      if (choiceId !== 'sac') {
        io.to(gameId).emit('chat', {
          id: `m_${Date.now()}`,
          gameId,
          from: 'system',
          message: `${sourceName}: ${getPlayerName(game, controllerId)} chose not to sacrifice a permanent.`,
          ts: Date.now(),
        });
        if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
        return;
      }

      const battlefield = game.state?.battlefield || [];
      const valid = battlefield
        .filter((p: any) => p && String(p.controller) === controllerId)
        .filter((p: any) => !sourcePermanentId || String(p.id) !== String(sourcePermanentId))
        .map((p: any) => ({
          id: p.id,
          label: p.card?.name || 'Permanent',
          description: p.card?.type_line || 'permanent',
          imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
        }));

      if (valid.length === 0) {
        io.to(gameId).emit('chat', {
          id: `m_${Date.now()}`,
          gameId,
          from: 'system',
          message: `${sourceName}: ${getPlayerName(game, controllerId)} has no other permanent to sacrifice.`,
          ts: Date.now(),
        });
        if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
        return;
      }

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: controllerId as PlayerID,
        description: `Choose a permanent to sacrifice`,
        mandatory: true,
        sourceId: sourcePermanentId,
        sourceName,
        validTargets: valid,
        targetTypes: ['sacrifice_target'],
        minTargets: 1,
        maxTargets: 1,
        targetDescription: 'a permanent you control',
        pwSacAnotherPermanentGainLifeDraw: true,
        pwSacAnotherPermanentStage: 'select_sacrifice',
        pwSacAnotherPermanentController: controllerId,
        pwSacAnotherPermanentSourceName: sourceName,
        pwSacAnotherPermanentSourcePermanentId: sourcePermanentId,
        pwSacAnotherPermanentLifeGain: lifeGain,
      } as any);

      return;
    }

    return;
  }

  // ===== GENERIC: "You may sacrifice a <Subtype>. When you do, ..." =====
  if (stepData?.sacrificeWhenYouDo === true) {
    const choiceId = extractId(selectedOption);
    const stage = String(stepData.sacrificeWhenYouDoStage || '');
    const controllerId = (stepData.sacrificeWhenYouDoController as string | undefined) || playerId;
    const subtype = String(stepData.sacrificeWhenYouDoSubtype || '').trim();
    const damage = Number(stepData.sacrificeWhenYouDoDamage || 0);
    const lifeGain = Number(stepData.sacrificeWhenYouDoLifeGain || 0);
    const sourceName = String(stepData.sacrificeWhenYouDoSourceName || step.sourceName || 'Ability');
    const sourcePermanentId = stepData.sacrificeWhenYouDoSourcePermanentId as string | undefined;

    if (stage === 'ask') {
      if (!choiceId || choiceId === 'decline' || choiceId === 'dont') {
        io.to(gameId).emit('chat', {
          id: `m_${Date.now()}`,
          gameId,
          from: 'system',
          message: `${sourceName}: ${getPlayerName(game, controllerId)} chose not to sacrifice a ${subtype}.`,
          ts: Date.now(),
        });
        if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
        return;
      }

      const battlefield = game.state?.battlefield || [];
      const subtypeLower = subtype.toLowerCase();
      const validVamps = battlefield
        .filter((p: any) => p && p.controller === controllerId)
        .filter((p: any) => String(p.card?.type_line || '').toLowerCase().includes(subtypeLower))
        .map((p: any) => ({
          id: p.id,
          label: p.card?.name || 'Permanent',
          description: p.card?.type_line || '',
          imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
        }));

      if (validVamps.length === 0) {
        io.to(gameId).emit('chat', {
          id: `m_${Date.now()}`,
          gameId,
          from: 'system',
          message: `${sourceName}: ${getPlayerName(game, controllerId)} has no ${subtype} to sacrifice.`,
          ts: Date.now(),
        });
        if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
        return;
      }

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: controllerId as PlayerID,
        description: `Choose a ${subtype} to sacrifice`,
        mandatory: true,
        sourceId: sourcePermanentId,
        sourceName,
        validTargets: validVamps,
        targetTypes: ['sacrifice_target'],
        minTargets: 1,
        maxTargets: 1,
        targetDescription: `${subtype} you control`,
        sacrificeWhenYouDo: true,
        sacrificeWhenYouDoStage: 'select_sacrifice',
        sacrificeWhenYouDoSubtype: subtype,
        sacrificeWhenYouDoDamage: damage,
        sacrificeWhenYouDoLifeGain: lifeGain,
        sacrificeWhenYouDoController: controllerId,
        sacrificeWhenYouDoSourceName: sourceName,
        sacrificeWhenYouDoSourcePermanentId: sourcePermanentId,
      } as any);

      return;
    }

    return;
  }

  // ===== GENERIC: Attach an Equipment you control to a created token =====
  if (stepData?.attachEquipmentToCreatedToken === true) {
    const choiceId = extractId(selectedOption);
    const controllerId = (stepData.attachEquipmentToCreatedTokenController as string | undefined) || playerId;
    const tokenPermanentId = stepData.attachEquipmentToCreatedTokenPermanentId as string | undefined;
    const sourceName = String(stepData.attachEquipmentToCreatedTokenSourceName || step.sourceName || 'Ability');

    if (!tokenPermanentId) return;

    if (!choiceId || choiceId === 'decline') {
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${sourceName}: ${getPlayerName(game, controllerId)} chose not to attach an Equipment.`,
        ts: Date.now(),
      });
      if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
      return;
    }

    const battlefield = game.state?.battlefield || [];
    const validEquipment = battlefield
      .filter((p: any) => p && p.controller === controllerId)
      .filter((p: any) => String(p.card?.type_line || '').toLowerCase().includes('equipment'))
      .map((p: any) => ({
        id: p.id,
        label: p.card?.name || 'Equipment',
        description: p.card?.type_line || '',
        imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
      }));

    if (validEquipment.length === 0) {
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${sourceName}: ${getPlayerName(game, controllerId)} controls no Equipment to attach.`,
        ts: Date.now(),
      });
      if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
      return;
    }

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.TARGET_SELECTION,
      playerId: controllerId as PlayerID,
      description: `Choose an Equipment you control to attach`,
      mandatory: true,
      sourceName,
      validTargets: validEquipment,
      targetTypes: ['equipment'],
      minTargets: 1,
      maxTargets: 1,
      targetDescription: 'Equipment you control',
      attachEquipmentToCreatedTokenSelectEquipment: true,
      attachEquipmentToCreatedTokenPermanentId: tokenPermanentId,
      attachEquipmentToCreatedTokenController: controllerId,
      attachEquipmentToCreatedTokenSourceName: sourceName,
    } as any);

    return;
  }

  // ===== GENERIC: Venture into the dungeon =====
  if (stepData?.ventureIntoDungeon === true) {
    const stateAny = game.state as any;
    stateAny.dungeonProgress = stateAny.dungeonProgress || {};
    const prog = stateAny.dungeonProgress[playerId];

    if (!prog) {
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: playerId as PlayerID,
        description: 'Choose a dungeon to enter',
        mandatory: true,
        sourceName: String(stepData.ventureIntoDungeonSourceName || step.sourceName || 'Venture'),
        options: [
          { id: 'lost_mine', label: 'Lost Mine of Phandelver' },
          { id: 'mad_mage', label: 'Dungeon of the Mad Mage' },
          { id: 'tomb', label: 'Tomb of Annihilation' },
        ],
        minSelections: 1,
        maxSelections: 1,
        ventureChooseDungeon: true,
      } as any);
      return;
    }

    prog.roomIndex = (prog.roomIndex || 0) + 1;
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, playerId)} ventured further into ${prog.dungeonName || 'a dungeon'} (room ${prog.roomIndex}).`,
      ts: Date.now(),
    });
    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    return;
  }

  if (stepData?.ventureChooseDungeon === true) {
    const choiceId = extractId(selectedOption);
    const stateAny = game.state as any;
    stateAny.dungeonProgress = stateAny.dungeonProgress || {};

    const dungeonName =
      choiceId === 'mad_mage' ? 'Dungeon of the Mad Mage' :
      choiceId === 'tomb' ? 'Tomb of Annihilation' :
      'Lost Mine of Phandelver';

    stateAny.dungeonProgress[playerId] = { dungeonId: choiceId || 'lost_mine', dungeonName, roomIndex: 0 };

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, playerId)} entered ${dungeonName}.`,
      ts: Date.now(),
    });
    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    return;
  }

  // ===== GENERIC: Retarget a copied spell =====
  if (stepData?.retargetSpellCopy === true) {
    const choiceId = extractId(selectedOption);
    const copyStackItemId = stepData.retargetSpellCopyStackItemId as string | undefined;
    if (!copyStackItemId) return;
    if (!choiceId || choiceId === 'keep') {
      if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
      return;
    }

    const validTargets = Array.isArray(stepData.retargetSpellCopyValidTargets) ? stepData.retargetSpellCopyValidTargets : [];
    const minTargets = Number(stepData.retargetSpellCopyMinTargets || 1);
    const maxTargets = Number(stepData.retargetSpellCopyMaxTargets || 1);
    const targetDescription = String(stepData.retargetSpellCopyTargetDescription || 'target');

    if (validTargets.length === 0) {
      if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
      return;
    }

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.TARGET_SELECTION,
      playerId: playerId as PlayerID,
      description: `Choose ${targetDescription} for the copied spell`,
      mandatory: true,
      sourceId: copyStackItemId,
      sourceName: step.sourceName,
      validTargets,
      targetTypes: ['spell_target'],
      minTargets,
      maxTargets,
      targetDescription,
    } as any);

    return;
  }

  // ===== PLANESWALKER: LOOK TOP TWO, PUT ONE INTO HAND, OTHER ON BOTTOM =====
  if (stepData?.pwLook2Pick1HandBottom === true) {
    const extractId = (sel: any): string | null => {
      if (typeof sel === 'string') return sel;
      if (Array.isArray(sel) && sel.length > 0) return typeof sel[0] === 'string' ? sel[0] : (sel[0] as any)?.id || null;
      if (sel && typeof sel === 'object') return (sel as any).id || (sel as any).value || null;
      return null;
    };

    const chosenCardId = extractId(selectedOption);
    const controllerId = (stepData.pwLook2Controller as string | undefined) || playerId;
    const sourceName = (stepData.pwLook2SourceName as string | undefined) || step.sourceName || 'Planeswalker';
    const topCardIds: string[] = Array.isArray(stepData.pwLook2TopCardIds) ? stepData.pwLook2TopCardIds : [];
    if (!chosenCardId || topCardIds.length < 2) {
      debugWarn(2, `[Resolution] pwLook2Pick1HandBottom: invalid selection or missing card ids`);
      return;
    }

    const state = game.state || {};
    const zones = (state.zones = state.zones || {});
    const z = (zones[controllerId] = zones[controllerId] || { library: [], libraryCount: 0, hand: [], handCount: 0, graveyard: [], graveyardCount: 0 });
    const lib: any[] = z.library || [];
    const hand: any[] = z.hand || [];

    const removed: any[] = [];
    for (const cid of topCardIds) {
      const idx = lib.findIndex((c: any) => c?.id === cid);
      if (idx >= 0) removed.push(lib.splice(idx, 1)[0]);
    }
    while (removed.length < 2 && lib.length > 0) removed.push(lib.shift());

    const chosen = removed.find((c: any) => c?.id === chosenCardId) || removed[0];
    const other = removed.find((c: any) => c?.id !== chosen?.id) || removed[1];

    if (chosen) hand.push({ ...chosen, zone: 'hand' });
    if (other) lib.push({ ...other, zone: 'library' });

    z.library = lib;
    z.hand = hand;
    z.libraryCount = lib.length;
    z.handCount = hand.length;

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${sourceName}: ${getPlayerName(game, controllerId)} put ${chosen?.name || 'a card'} into their hand and put the other on the bottom of their library.`,
      ts: Date.now(),
    });

    if (typeof (game as any).bumpSeq === 'function') {
      (game as any).bumpSeq();
    }

    return;
  }

  // ===== PLANESWALKER: LOOK TOP TWO, PUT ONE INTO HAND, OTHER INTO GRAVEYARD =====
  if (stepData?.pwLook2Pick1HandOtherGraveyard === true) {
    const chosenCardId = extractId(selectedOption);
    const controllerId = (stepData.pwLook2Controller as string | undefined) || playerId;
    const sourceName = (stepData.pwLook2SourceName as string | undefined) || step.sourceName || 'Planeswalker';
    const topCardIds: string[] = Array.isArray(stepData.pwLook2TopCardIds) ? stepData.pwLook2TopCardIds : [];
    if (!chosenCardId || topCardIds.length < 2) {
      debugWarn(2, `[Resolution] pwLook2Pick1HandOtherGraveyard: invalid selection or missing card ids`);
      return;
    }

    const state = game.state || {};
    const zones = (state.zones = state.zones || {});
    const z = (zones[controllerId] = zones[controllerId] || { library: [], libraryCount: 0, hand: [], handCount: 0, graveyard: [], graveyardCount: 0 });
    const lib: any[] = z.library || [];
    const hand: any[] = z.hand || [];
    const gy: any[] = z.graveyard || (z.graveyard = []);

    const removed: any[] = [];
    for (const cid of topCardIds) {
      const idx = lib.findIndex((c: any) => c?.id === cid);
      if (idx >= 0) removed.push(lib.splice(idx, 1)[0]);
    }
    while (removed.length < 2 && lib.length > 0) removed.push(lib.shift());

    const chosen = removed.find((c: any) => c?.id === chosenCardId) || removed[0];
    const other = removed.find((c: any) => c?.id !== chosen?.id) || removed[1];

    if (chosen) hand.push({ ...chosen, zone: 'hand' });
    if (other) gy.unshift({ ...other, zone: 'graveyard' });

    z.library = lib;
    z.hand = hand;
    z.graveyard = gy;
    z.libraryCount = lib.length;
    z.handCount = hand.length;
    z.graveyardCount = gy.length;

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${sourceName}: ${getPlayerName(game, controllerId)} put ${chosen?.name || 'a card'} into their hand and put the other into their graveyard.`,
      ts: Date.now(),
    });

    if (typeof (game as any).bumpSeq === 'function') {
      (game as any).bumpSeq();
    }

    return;
  }

  // ===== PLANESWALKER: LOOK TOP TWO, PUT ONE INTO GRAVEYARD =====
  if (stepData?.pwLook2Put1Graveyard === true) {
    const chosenCardId = extractId(selectedOption);
    const controllerId = (stepData.pwLook2Controller as string | undefined) || playerId;
    const sourceName = (stepData.pwLook2SourceName as string | undefined) || step.sourceName || 'Planeswalker';
    const topCardIds: string[] = Array.isArray(stepData.pwLook2TopCardIds) ? stepData.pwLook2TopCardIds : [];
    if (!chosenCardId || topCardIds.length < 2) {
      debugWarn(2, `[Resolution] pwLook2Put1Graveyard: invalid selection or missing card ids`);
      return;
    }

    const state = game.state || {};
    const zones = (state.zones = state.zones || {});
    const z = (zones[controllerId] = zones[controllerId] || {
      library: [],
      libraryCount: 0,
      hand: [],
      handCount: 0,
      graveyard: [],
      graveyardCount: 0,
    });
    const lib: any[] = z.library || [];
    const gy: any[] = z.graveyard || (z.graveyard = []);

    const removed: any[] = [];
    for (const cid of topCardIds) {
      const idx = lib.findIndex((c: any) => c?.id === cid);
      if (idx >= 0) removed.push(lib.splice(idx, 1)[0]);
    }
    while (removed.length < 2 && lib.length > 0) removed.push(lib.shift());

    const chosen = removed.find((c: any) => c?.id === chosenCardId) || removed[0];
    const other = removed.find((c: any) => c?.id !== chosen?.id) || removed[1];

    if (chosen) gy.unshift({ ...chosen, zone: 'graveyard' });
    if (other) lib.unshift({ ...other, zone: 'library' });

    z.library = lib;
    z.graveyard = gy;
    z.libraryCount = lib.length;
    z.graveyardCount = gy.length;

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${sourceName}: ${getPlayerName(game, controllerId)} put ${chosen?.name || 'a card'} into their graveyard.`,
      ts: Date.now(),
    });

    if (typeof (game as any).bumpSeq === 'function') {
      (game as any).bumpSeq();
    }

    return;
  }

  // ===== PLANESWALKER: JACE TOP 3 -> CONTROLLER CHOOSES PILE TO PUT INTO HAND =====
  if (stepData?.pwJaceTop3PickPile === true) {
    const choiceId = extractId(selectedOption);
    if (choiceId !== 'pileA' && choiceId !== 'pileB') {
      debugWarn(2, `[Resolution] pwJaceTop3PickPile: invalid choice ${choiceId}`);
      return;
    }

    const controllerId = String(stepData.pwJaceControllerId || playerId);
    const sourceName = String(stepData.pwJaceSourceName || step.sourceName || 'Planeswalker');
    const topCards: any[] = Array.isArray(stepData.pwJaceTopCards) ? stepData.pwJaceTopCards : [];
    const originalOrder: string[] = Array.isArray(stepData.pwJaceTopCardIds)
      ? stepData.pwJaceTopCardIds.map(String)
      : topCards.map((c: any) => c?.id).filter(Boolean);
    const pileA: string[] = Array.isArray(stepData.pwJacePileA) ? stepData.pwJacePileA.map(String) : [];
    const pileB: string[] = Array.isArray(stepData.pwJacePileB) ? stepData.pwJacePileB.map(String) : [];

    const chosenIds = choiceId === 'pileA' ? pileA : pileB;
    const otherIds = choiceId === 'pileA' ? pileB : pileA;

    const byId = new Map(topCards.map((c: any) => [String(c?.id || ''), c]));
    const orderedIds = (ids: string[]) => {
      const set = new Set(ids);
      return originalOrder.filter((id) => set.has(id));
    };

    const chosenCards = orderedIds(chosenIds).map((id) => byId.get(id)).filter(Boolean);
    const otherCards = orderedIds(otherIds).map((id) => byId.get(id)).filter(Boolean);

    const state = game.state || {};
    const zones = (state.zones = state.zones || {});
    const z = (zones[controllerId] = zones[controllerId] || {
      library: [],
      libraryCount: 0,
      hand: [],
      handCount: 0,
      graveyard: [],
      graveyardCount: 0,
      exile: [],
      exileCount: 0,
    });
    const hand: any[] = Array.isArray(z.hand) ? z.hand : [];
    const lib: any[] = Array.isArray(z.library) ? z.library : [];

    for (const c of chosenCards) hand.push({ ...c, zone: 'hand' });
    for (const c of otherCards) lib.push({ ...c, zone: 'library' });

    z.hand = hand;
    z.library = lib;
    z.handCount = hand.length;
    z.libraryCount = lib.length;

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${sourceName}: ${getPlayerName(game, controllerId)} chose a pile to put into their hand.`,
      ts: Date.now(),
    });

    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    return;
  }

  // ===== PLANESWALKER: LILIANA -> TARGET PLAYER CHOOSES PILE TO SACRIFICE =====
  if (stepData?.pwLilianaChoosePileToSacrifice === true) {
    const choiceId = extractId(selectedOption);
    if (choiceId !== 'pileA' && choiceId !== 'pileB') {
      debugWarn(2, `[Resolution] pwLilianaChoosePileToSacrifice: invalid choice ${choiceId}`);
      return;
    }

    const targetPlayerId = String(stepData.pwLilianaTargetPlayerId || playerId);
    const sourceName = String(stepData.pwLilianaSourceName || step.sourceName || 'Planeswalker');
    const pileA: string[] = Array.isArray(stepData.pwLilianaPileA) ? stepData.pwLilianaPileA.map(String) : [];
    const pileB: string[] = Array.isArray(stepData.pwLilianaPileB) ? stepData.pwLilianaPileB.map(String) : [];
    const toSacrifice = choiceId === 'pileA' ? pileA : pileB;

    if (!toSacrifice.length) {
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${sourceName}: ${getPlayerName(game, targetPlayerId)} chose an empty pile to sacrifice.`,
        ts: Date.now(),
      });
      if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
      return;
    }

    const ctx = {
      gameId,
      state: game.state,
      commandZone: (game.state as any).commandZone || {},
      bumpSeq: typeof (game as any).bumpSeq === 'function' ? (game as any).bumpSeq.bind(game) : (() => {}),
    } as unknown as GameContext;

    const { movePermanentToGraveyard } = await import('../state/modules/counters_tokens.js');

    for (const permId of toSacrifice) {
      try {
        movePermanentToGraveyard(ctx, permId, true);
      } catch {
        // ignore
      }
    }

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${sourceName}: ${getPlayerName(game, targetPlayerId)} sacrificed ${toSacrifice.length} permanent${toSacrifice.length !== 1 ? 's' : ''}.`,
      ts: Date.now(),
    });

    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    return;
  }

  // ===== PLANESWALKER: YOU MAY DISCARD; IF YOU DO, DRAW =====
  if (stepData?.pwMayDiscardThenDraw === true) {
    const extractId = (sel: any): string | null => {
      if (typeof sel === 'string') return sel;
      if (Array.isArray(sel) && sel.length > 0) return typeof sel[0] === 'string' ? sel[0] : (sel[0] as any)?.id || null;
      if (sel && typeof sel === 'object') return (sel as any).id || (sel as any).value || null;
      return null;
    };

    const choiceId = extractId(selectedOption);
    const stage = String(stepData.pwMayDiscardThenDrawStage || '');
    const controllerId = (stepData.pwMayDiscardThenDrawPlayerId as string | undefined) || playerId;
    const sourceName = (stepData.pwMayDiscardThenDrawSourceName as string | undefined) || step.sourceName || 'Planeswalker';

    if (stage === 'ask') {
      if (!choiceId || choiceId === 'dont' || choiceId === 'decline') {
        io.to(gameId).emit('chat', {
          id: `m_${Date.now()}`,
          gameId,
          from: 'system',
          message: `${sourceName}: ${getPlayerName(game, controllerId)} chose not to discard.`,
          ts: Date.now(),
        });
        if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
        return;
      }

      if (choiceId !== 'discard') {
        debugWarn(2, `[Resolution] pwMayDiscardThenDraw: unexpected choice ${choiceId}`);
        return;
      }

      const state = game.state || {};
      const zones = (state.zones = state.zones || {});
      const z = (zones[controllerId] = zones[controllerId] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 });
      const hand: any[] = z.hand || [];
      const actualDiscard = hand.length > 0 ? 1 : 0;
      if (actualDiscard <= 0) {
        io.to(gameId).emit('chat', {
          id: `m_${Date.now()}`,
          gameId,
          from: 'system',
          message: `${sourceName}: ${getPlayerName(game, controllerId)} had no cards to discard.`,
          ts: Date.now(),
        });
        if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
        return;
      }

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.DISCARD_SELECTION,
        playerId: controllerId,
        description: `${sourceName}: Discard 1 card`,
        mandatory: true,
        sourceName: sourceName,
        discardCount: 1,
        hand: hand.map((c: any) => ({
          id: c.id,
          name: c.name,
          type_line: c.type_line,
          oracle_text: c.oracle_text,
          image_uris: c.image_uris,
          mana_cost: c.mana_cost,
          cmc: c.cmc,
          colors: c.colors,
        })),
        afterDiscardDrawCount: 1,
      } as any);

      if (typeof (game as any).bumpSeq === 'function') {
        (game as any).bumpSeq();
      }

      return;
    }
  }

  // ===== PLANESWALKER: ADD TWO MANA IN ANY COMBINATION (DRAGONS ONLY) =====
  if (stepData?.pwAddTwoManaAnyCombination === true) {
    const extractId = (sel: any): string | null => {
      if (typeof sel === 'string') return sel;
      if (Array.isArray(sel) && sel.length > 0) return typeof sel[0] === 'string' ? sel[0] : (sel[0] as any)?.id || null;
      if (sel && typeof sel === 'object') return (sel as any).id || (sel as any).value || null;
      return null;
    };

    const stage = String(stepData.pwAddTwoManaStage || '');
    const controllerId = (stepData.pwAddTwoManaController as string | undefined) || playerId;
    const sourceName = (stepData.pwAddTwoManaSourceName as string | undefined) || step.sourceName || 'Planeswalker';
    const sourceId = (stepData.pwAddTwoManaSourceId as string | undefined) || step.sourceId;
    const restriction = (stepData.pwAddTwoManaRestriction as any) || 'dragon_spells';
    const isUnrestricted = restriction === 'unrestricted' || restriction === 'none' || restriction === null || restriction === undefined;

    const validColors = new Set(['white', 'blue', 'black', 'red', 'green']);
    const chosen = extractId(selectedOption);
    if (!chosen || !validColors.has(String(chosen).toLowerCase())) {
      debugWarn(2, `[Resolution] pwAddTwoManaAnyCombination: invalid color selection`);
      return;
    }
    const chosenColor = String(chosen).toLowerCase();

    const options = [
      { id: 'white', label: 'White' },
      { id: 'blue', label: 'Blue' },
      { id: 'black', label: 'Black' },
      { id: 'red', label: 'Red' },
      { id: 'green', label: 'Green' },
    ];

    if (stage === 'first') {
      // Queue second color choice.
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: controllerId,
        description: isUnrestricted
          ? `${sourceName}: Choose a color for the second mana`
          : `${sourceName}: Choose a color for the second mana (spend only to cast Dragon spells)`,
        mandatory: true,
        sourceName,
        options,
        minSelections: 1,
        maxSelections: 1,
        pwAddTwoManaAnyCombination: true,
        pwAddTwoManaStage: 'second',
        pwAddTwoManaController: controllerId,
        pwAddTwoManaSourceName: sourceName,
        pwAddTwoManaSourceId: sourceId,
        pwAddTwoManaRestriction: restriction,
        pwAddTwoManaFirstColor: chosenColor,
      } as any);

      if (typeof (game as any).bumpSeq === 'function') {
        (game as any).bumpSeq();
      }

      return;
    }

    if (stage === 'second') {
      const firstColor = String(stepData.pwAddTwoManaFirstColor || '').toLowerCase();
      if (!validColors.has(firstColor)) {
        debugWarn(2, `[Resolution] pwAddTwoManaAnyCombination: missing first color`);
        return;
      }

      if (isUnrestricted) {
        const { getOrInitManaPool } = await import('./util.js');
        const pool = getOrInitManaPool(game.state, controllerId) as any;
        if (firstColor === chosenColor) {
          pool[firstColor] = (pool[firstColor] || 0) + 2;
        } else {
          pool[firstColor] = (pool[firstColor] || 0) + 1;
          pool[chosenColor] = (pool[chosenColor] || 0) + 1;
        }
      } else {
        const { addRestrictedManaToPool } = await import('./util.js');
        // Add two restricted mana (merge if same color).
        if (firstColor === chosenColor) {
          addRestrictedManaToPool(game.state, controllerId, firstColor as any, 2, restriction, undefined, sourceId, sourceName);
        } else {
          addRestrictedManaToPool(game.state, controllerId, firstColor as any, 1, restriction, undefined, sourceId, sourceName);
          addRestrictedManaToPool(game.state, controllerId, chosenColor as any, 1, restriction, undefined, sourceId, sourceName);
        }
      }

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: isUnrestricted
          ? `${sourceName}: ${getPlayerName(game, controllerId)} added two mana (${firstColor}${firstColor === chosenColor ? '' : ` and ${chosenColor}`}).`
          : `${sourceName}: ${getPlayerName(game, controllerId)} added two mana (${firstColor}${firstColor === chosenColor ? '' : ` and ${chosenColor}`}) that can be spent only to cast Dragon spells.`,
        ts: Date.now(),
      });

      if (typeof (game as any).bumpSeq === 'function') {
        (game as any).bumpSeq();
      }

      return;
    }
  }

  // ===== PLANESWALKER: ADD TEN MANA OF ANY ONE COLOR =====
  if (stepData?.pwAddTenManaOneColor === true) {
    const extractId = (sel: any): string | null => {
      if (typeof sel === 'string') return sel;
      if (Array.isArray(sel) && sel.length > 0) return typeof sel[0] === 'string' ? sel[0] : (sel[0] as any)?.id || null;
      if (sel && typeof sel === 'object') return (sel as any).id || (sel as any).value || null;
      return null;
    };

    const controllerId = (stepData.pwAddTenManaController as string | undefined) || playerId;
    const sourceName = (stepData.pwAddTenManaSourceName as string | undefined) || step.sourceName || 'Planeswalker';

    const validColors = new Set(['white', 'blue', 'black', 'red', 'green']);
    const chosen = extractId(selectedOption);
    if (!chosen || !validColors.has(String(chosen).toLowerCase())) {
      debugWarn(2, `[Resolution] pwAddTenManaOneColor: invalid color selection`);
      return;
    }
    const chosenColor = String(chosen).toLowerCase();

    const { getOrInitManaPool } = await import('./util.js');
    const pool = getOrInitManaPool(game.state, controllerId) as any;
    pool[chosenColor] = (pool[chosenColor] || 0) + 10;

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${sourceName}: ${getPlayerName(game, controllerId)} added ten mana (${chosenColor}).`,
      ts: Date.now(),
    });

    if (typeof (game as any).bumpSeq === 'function') {
      (game as any).bumpSeq();
    }
    return;
  }

  // ===== PLANESWALKER: PAY ANY AMOUNT; LOOK X; PICK 1; BOTTOM RANDOM =====
  if (stepData?.pwPayAnyAmountLook === true) {
    const extractId = (sel: any): string | null => {
      if (typeof sel === 'string') return sel;
      if (Array.isArray(sel) && sel.length > 0) return typeof sel[0] === 'string' ? sel[0] : (sel[0] as any)?.id || null;
      if (sel && typeof sel === 'object') return (sel as any).id || (sel as any).value || null;
      return null;
    };

    const stage = String(stepData.pwPayAnyAmountLookStage || '');
    const controllerId = (stepData.pwPayAnyAmountLookController as string | undefined) || playerId;
    const sourceName = (stepData.pwPayAnyAmountLookSourceName as string | undefined) || step.sourceName || 'Planeswalker';

    const state = game.state || {};
    const zones = (state.zones = state.zones || {});
    const z = (zones[controllerId] = zones[controllerId] || { library: [], libraryCount: 0, hand: [], handCount: 0 });
    const lib: any[] = Array.isArray(z.library) ? z.library : [];
    const hand: any[] = Array.isArray(z.hand) ? z.hand : [];

    const pool: any = state.manaPool?.[controllerId] || {
      white: 0,
      blue: 0,
      black: 0,
      red: 0,
      green: 0,
      colorless: 0,
    };

    const maxPay =
      (pool.white || 0) +
      (pool.blue || 0) +
      (pool.black || 0) +
      (pool.red || 0) +
      (pool.green || 0) +
      (pool.colorless || 0);

    if (stage === 'chooseX') {
      const raw = extractId(selectedOption);
      const chosenX = Math.max(0, Math.min(maxPay, parseInt(String(raw || '0'), 10) || 0));

      // Deduct chosenX from unrestricted pool (restricted mana is not spendable for this effect).
      let remaining = chosenX;
      const spendOrder: Array<'colorless' | 'white' | 'blue' | 'black' | 'red' | 'green'> = [
        'colorless',
        'white',
        'blue',
        'black',
        'red',
        'green',
      ];
      for (const c of spendOrder) {
        if (remaining <= 0) break;
        const avail = pool[c] || 0;
        if (avail <= 0) continue;
        const take = Math.min(avail, remaining);
        pool[c] = avail - take;
        remaining -= take;
      }

      if (!state.manaPool) state.manaPool = {};
      state.manaPool[controllerId] = pool;

      if (chosenX <= 0 || lib.length === 0) {
        io.to(gameId).emit('chat', {
          id: `m_${Date.now()}`,
          gameId,
          from: 'system',
          message: `${sourceName}: ${getPlayerName(game, controllerId)} paid ${chosenX} and looked at 0 cards.`,
          ts: Date.now(),
        });
        if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
        return;
      }

      const top = lib.slice(0, chosenX);
      const options = top.map((c: any) => ({
        id: c?.id,
        label: c?.name || 'Unknown',
        description: c?.type_line,
        imageUrl: c?.image_uris?.normal || c?.image_uris?.art_crop || c?.image_uris?.small,
      }));

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: controllerId,
        description: `${sourceName}: Choose a card to put into your hand`,
        mandatory: true,
        sourceName,
        options,
        minSelections: 1,
        maxSelections: 1,
        pwPayAnyAmountLook: true,
        pwPayAnyAmountLookStage: 'chooseCard',
        pwPayAnyAmountLookController: controllerId,
        pwPayAnyAmountLookSourceName: sourceName,
        pwPayAnyAmountLookTopCardIds: top.map((c: any) => c?.id).filter(Boolean),
        pwPayAnyAmountLookX: chosenX,
      } as any);

      if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
      return;
    }

    if (stage === 'chooseCard') {
      const chosenCardId = extractId(selectedOption);
      const topCardIds: string[] = Array.isArray(stepData.pwPayAnyAmountLookTopCardIds)
        ? stepData.pwPayAnyAmountLookTopCardIds
        : [];

      if (!chosenCardId || topCardIds.length === 0) {
        debugWarn(2, `[Resolution] pwPayAnyAmountLook chooseCard: invalid selection or missing ids`);
        return;
      }

      // Remove looked cards from library by id (best-effort), fallback to shifting.
      const removed: any[] = [];
      for (const cid of topCardIds) {
        const idx = lib.findIndex((c: any) => c?.id === cid);
        if (idx >= 0) removed.push(lib.splice(idx, 1)[0]);
      }
      while (removed.length < topCardIds.length && lib.length > 0) {
        removed.push(lib.shift());
      }

      const chosen = removed.find((c: any) => c?.id === chosenCardId) || removed[0];
      const rest = removed.filter((c: any) => c && c?.id !== chosen?.id);

      // Randomize rest order before putting on bottom.
      for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rest[i], rest[j]] = [rest[j], rest[i]];
      }

      if (chosen) hand.push({ ...chosen, zone: 'hand' });
      for (const c of rest) {
        lib.push({ ...c, zone: 'library' });
      }

      z.library = lib;
      z.hand = hand;
      z.libraryCount = lib.length;
      z.handCount = hand.length;

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${sourceName}: ${getPlayerName(game, controllerId)} put ${chosen?.name || 'a card'} into their hand and put the rest on the bottom of their library in a random order.`,
        ts: Date.now(),
      });

      if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
      return;
    }
  }

  // ===== PLANESWALKER: REVEAL TOP TWO, OPPONENT CHOOSES (Karn-style) =====
  if (stepData?.pwkarn === true) {
    // Helper to extract first selected ID
    const extractId = (sel: any): string | null => {
      if (typeof sel === 'string') return sel;
      if (Array.isArray(sel) && sel.length > 0) return typeof sel[0] === 'string' ? sel[0] : (sel[0] as any)?.id || null;
      if (sel && typeof sel === 'object') return (sel as any).id || (sel as any).value || null;
      return null;
    };

    const stage = String(stepData.pwkarnStage || '');
    const controllerId = stepData.pwkarnController as string | undefined;
    const sourceName = stepData.pwkarnSourceName as string | undefined;

    if (!controllerId || !sourceName) {
      debugWarn(2, `[Resolution] pwkarn step missing controller/sourceName`);
      return;
    }

    // Stage 1: controller chooses which opponent makes the card choice
    if (stage === 'chooseOpponent') {
      const chosenOpponentId = extractId(selectedOption);
      if (!chosenOpponentId) {
        debugWarn(2, `[Resolution] pwkarn chooseOpponent: no opponent selected`);
        return;
      }

      const topCards: any[] = Array.isArray(stepData.pwkarnTopCards) ? stepData.pwkarnTopCards : [];
      if (topCards.length < 2) {
        debugWarn(2, `[Resolution] pwkarn chooseOpponent: missing top cards snapshot`);
        return;
      }

      const controllerName = getPlayerName(game, controllerId);
      const options = topCards.slice(0, 2).map((c: any) => ({
        id: c.id,
        label: c.name || 'Unknown',
        description: c.type_line,
        imageUrl: c.image_uris?.normal || c.image_uris?.art_crop || c.image_uris?.small,
      }));

      // Enqueue the opponent's card choice as the next step.
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: chosenOpponentId,
        description: `${sourceName}: Choose a card to put into ${controllerName}'s hand`,
        mandatory: true,
        sourceName,
        options,
        minSelections: 1,
        maxSelections: 1,
        pwkarn: true,
        pwkarnStage: 'chooseCard',
        pwkarnController: controllerId,
        pwkarnSourceName: sourceName,
        pwkarnTopCardIds: topCards.slice(0, 2).map((c: any) => c.id),
      } as any);

      if (typeof (game as any).bumpSeq === 'function') {
        (game as any).bumpSeq();
      }

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${sourceName}: ${controllerName} revealed ${options.map(o => o.label).join(' and ')}.`,
        ts: Date.now(),
      });

      return;
    }

    // Stage 2: chosen opponent chooses which revealed card goes to hand
    if (stage === 'chooseCard') {
      const chosenCardId = extractId(selectedOption);
      const topCardIds: string[] = Array.isArray(stepData.pwkarnTopCardIds) ? stepData.pwkarnTopCardIds : [];
      if (!chosenCardId || topCardIds.length < 2) {
        debugWarn(2, `[Resolution] pwkarn chooseCard: invalid selection or card ids`);
        return;
      }

      const state = game.state || {};
      const zones = (state.zones = state.zones || {});
      const z = (zones[controllerId] = zones[controllerId] || { library: [], libraryCount: 0, hand: [], handCount: 0, exile: [], exileCount: 0 });

      const lib: any[] = z.library || [];
      const hand: any[] = z.hand || [];
      const exile: any[] = z.exile || [];

      // Remove the two revealed cards from the library by id (best-effort).
      const removed: any[] = [];
      for (const cid of topCardIds) {
        const idx = lib.findIndex((c: any) => c?.id === cid);
        if (idx >= 0) {
          removed.push(lib.splice(idx, 1)[0]);
        }
      }

      // Fallback: if we couldn't find by id, just take top two.
      while (removed.length < 2 && lib.length > 0) {
        removed.push(lib.shift());
      }

      const chosen = removed.find((c: any) => c?.id === chosenCardId) || removed[0];
      const other = removed.find((c: any) => c?.id !== chosen?.id) || removed[1];

      if (chosen) {
        hand.push({ ...chosen, zone: 'hand' });
      }
      if (other) {
        exile.push({
          ...other,
          zone: 'exile',
          silverCounters: ((other as any).silverCounters || 0) + 1,
          exiledBy: sourceName,
        });
      }

      z.library = lib;
      z.hand = hand;
      z.exile = exile;
      z.libraryCount = lib.length;
      z.handCount = hand.length;
      z.exileCount = exile.length;

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${sourceName}: ${getPlayerName(game, playerId)} chose ${chosen?.name || 'a card'} for ${getPlayerName(game, controllerId)}. The other card was exiled with a silver counter.`,
        ts: Date.now(),
      });

      if (typeof (game as any).bumpSeq === 'function') {
        (game as any).bumpSeq();
      }

      return;
    }
  }
  
  // ===== REBOUND HANDLING =====
  // Handle rebound trigger resolution - player may cast the spell from exile
  if (stepData.reboundCardId && stepData.reboundCard) {
    const reboundCard = stepData.reboundCard;
    const reboundCardId = stepData.reboundCardId;
    
    // Extract the choice - 'cast' or 'decline'
    let choice = 'decline';
    if (Array.isArray(selectedOption) && selectedOption.length > 0) {
      choice = typeof selectedOption[0] === 'string' ? selectedOption[0] : (selectedOption[0] as any)?.id || 'decline';
    } else if (typeof selectedOption === 'string') {
      choice = selectedOption;
    } else if (typeof selectedOption === 'object' && selectedOption !== null) {
      choice = (selectedOption as any).id || (selectedOption as any).value || 'decline';
    }
    
    // Find the card in exile
    const zones = game.state?.zones?.[playerId];
    if (!zones || !zones.exile) {
      debugWarn(2, `[Resolution] Rebound: No exile zone found for player ${playerId}`);
      return;
    }
    
    const cardIndex = zones.exile.findIndex((c: any) => c.id === reboundCardId);
    if (cardIndex === -1) {
      debugWarn(2, `[Resolution] Rebound: Card ${reboundCardId} not found in exile`);
      return;
    }
    
    const exiledCard = zones.exile[cardIndex];
    
    if (choice === 'cast') {
      // Player chose to cast - remove from exile and put on stack
      zones.exile.splice(cardIndex, 1);
      zones.exileCount = zones.exile.length;
      
      // Add to stack as a spell (without paying mana cost)
      const stackItem = {
        id: uid("rebound_spell"),
        type: 'spell',
        card: { ...exiledCard, zone: 'stack', reboundPending: false, reboundTriggered: false },
        controller: playerId,
        targets: [],
        castFromRebound: true, // Mark that this was cast from rebound (goes to graveyard, not exile again)
        castFromHand: false, // Not cast from hand this time
      };
      game.state.stack = game.state.stack || [];
      game.state.stack.push(stackItem);
      
      // Emit chat message
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `🔄 ${getPlayerName(game, playerId)} cast ${exiledCard.name} from rebound!`,
        ts: Date.now(),
      });
      
      debug(2, `[Resolution] Rebound: ${playerId} cast ${exiledCard.name} from exile`);
    } else {
      // Player declined - move card from exile to graveyard
      zones.exile.splice(cardIndex, 1);
      zones.exileCount = zones.exile.length;
      
      zones.graveyard = zones.graveyard || [];
      zones.graveyard.push({ ...exiledCard, zone: 'graveyard', reboundPending: false, reboundTriggered: false });
      zones.graveyardCount = zones.graveyard.length;
      
      // Emit chat message
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, playerId)} declined to cast ${exiledCard.name} from rebound - moved to graveyard.`,
        ts: Date.now(),
      });
      
      debug(2, `[Resolution] Rebound: ${playerId} declined to cast ${exiledCard.name}, moved to graveyard`);
    }
    
    // Bump sequence
    if (typeof (game as any).bumpSeq === "function") {
      (game as any).bumpSeq();
    }
    
    return;
  }
  
  // Check if this is an ETB permanent option choice (e.g., "choose flying or first strike")
  if (stepData.permanentId) {
    const permanentId = stepData.permanentId;
    const cardName = stepData.sourceName || 'Permanent';
    
    // Extract the selected option value(s)
    let chosenOptions: string[];
    if (Array.isArray(selectedOption)) {
      // Multiple selections (e.g., Greymond choosing 2 abilities)
      chosenOptions = selectedOption.map((opt: any) => {
        if (typeof opt === 'string') return opt;
        if (typeof opt === 'object' && opt !== null) {
          return opt.value || opt.id || String(opt);
        }
        return String(opt);
      });
    } else if (typeof selectedOption === 'string') {
      chosenOptions = [selectedOption];
    } else if (typeof selectedOption === 'object' && selectedOption !== null) {
      // Handle if it's an option object with value field
      const value = (selectedOption as any).value || (selectedOption as any).id || String(selectedOption);
      chosenOptions = [value];
    } else {
      debugWarn(2, `[Resolution] Invalid option choice: ${JSON.stringify(selectedOption)}`);
      return;
    }
    
    // Find the permanent on the battlefield
    const state = game.state || {};
    const battlefield = state.battlefield || [];
    const permanent = battlefield.find((p: any) => p.id === permanentId);
    
    if (permanent) {
      // Store the chosen option(s) on the permanent
      if (chosenOptions.length === 1) {
        (permanent as any).chosenOption = chosenOptions[0];
      } else {
        (permanent as any).chosenOptions = chosenOptions;
      }
      
      // Append event for replay
      try {
        await appendEvent(gameId, (game as any).seq || 0, "optionChoice", {
          playerId: playerId,
          permanentId: permanentId,
          cardName: cardName,
          chosenOptions: chosenOptions,
        });
      } catch (e) {
        debugWarn(1, "[Resolution] Failed to persist option choice event:", e);
      }
      
      // Bump sequence
      if (typeof (game as any).bumpSeq === "function") {
        (game as any).bumpSeq();
      }
      
      // Send chat message
      const optionsText = chosenOptions.length === 1 
        ? `"${chosenOptions[0]}"` 
        : chosenOptions.map(o => `"${o}"`).join(' and ');
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, playerId)} chose ${optionsText} for ${cardName}.`,
        ts: Date.now(),
      });
      
      debug(2, `[Resolution] Option choice completed: ${cardName} -> ${chosenOptions.join(', ')}`);
    }
    return;
  }
  
  // Handle counter placement triggers (Agitator Ant, Orzhov Advokist, etc.)
  // SCALABLE: Supports "each player may X. If a player does, Y" pattern
  // Works for any card with conditional effects based on player choices
  if (stepData.counterPlacementTrigger || stepData.agitatorAntTrigger) {
    const state = game.state;
    const battlefield = state.battlefield || [];
    
    // Initialize tracking if this is the first response
    if (!state._counterPlacementSelections) {
      state._counterPlacementSelections = {};
    }
    
    // Store this player's selection AND track if they accepted
    // Handle different types of selections
    let creatureId: string | undefined;
    let playerAccepted = false;
    
    if (Array.isArray(selectedOption) && selectedOption.length > 0) {
      const firstSelection = selectedOption[0];
      if (typeof firstSelection === 'string' && firstSelection !== 'decline') {
        creatureId = firstSelection;
        playerAccepted = true;
      }
    } else if (typeof selectedOption === 'string' && selectedOption !== 'decline') {
      creatureId = selectedOption;
      playerAccepted = true;
    }
    
    // Track both the selection AND the acceptance status
    state._counterPlacementSelections[playerId] = {
      creatureId: creatureId || null,
      accepted: playerAccepted,
    };
    
    debug(2, `[Resolution] Counter placement: ${playerId} ${playerAccepted ? `chose creature ${creatureId}` : 'declined'}`);
    
    // Check if this was the last player to respond
    const queue = ResolutionQueueManager.getQueue(gameId);
    const remainingSteps = queue.steps.filter((s: any) => s.counterPlacementTrigger || s.agitatorAntTrigger);
    
    if (remainingSteps.length === 0) {
      // All players have made their choices - now apply counters and any additional effects
      debug(2, `[Resolution] Counter placement: All players responded, applying counters`);
      const selections = state._counterPlacementSelections || {};
      const playersWhoAccepted: string[] = []; // Track who accepted for "If a player does" effects
      const creaturesWithCounters: Array<{ id: string; playerId: string }> = [];
      
      // Get the effect metadata from stepData
      const effectType = stepData.effectType || 'none';
      const conditionalEffect = stepData.conditionalEffect || {};
      const sourceName = stepData.sourceName || 'Counter placement effect';
      const sourceController = stepData.sourceController || state.turnPlayer;
      
      // Apply +1/+1 counters ONLY to creatures whose controllers accepted
      for (const [playerId, selection] of Object.entries(selections)) {
        const selectionData = selection as any;
        
        // Check if this is the new format with accepted tracking or old format
        const accepted = selectionData.accepted !== undefined ? selectionData.accepted : !!selectionData;
        const creatureId = selectionData.creatureId || (typeof selectionData === 'string' ? selectionData : null);
        
        if (!accepted || !creatureId) continue;
        
        playersWhoAccepted.push(playerId);
        const creature = battlefield.find((p: any) => p.id === creatureId);
        
        if (creature) {
          creature.counters = creature.counters || {};
          creature.counters['+1/+1'] = (creature.counters['+1/+1'] || 0) + 2;
          creaturesWithCounters.push({ id: creatureId, playerId });
          
          debug(2, `[Resolution] Counter placement: Added 2 +1/+1 counters to ${creature.card?.name || creatureId}`);
          
          // Emit chat message
          io.to(gameId).emit('chat', {
            id: `m_${Date.now()}_${Math.random()}`,
            gameId,
            from: 'system',
            message: `${sourceName}: ${playerId} put 2 +1/+1 counters on ${creature.card?.name || 'a creature'}`,
            ts: Date.now(),
          });
        }
      }
      
      // Apply "If a player does" conditional effects ONLY to players who accepted
      if (playersWhoAccepted.length > 0) {
        if (effectType === 'goad' || conditionalEffect.onAccept === 'goad') {
          // Agitator Ant: Goad all creatures that received counters
          const turnPlayer = state.turnPlayer;
          for (const { id: creatureId } of creaturesWithCounters) {
            const creature = battlefield.find((p: any) => p.id === creatureId);
            if (creature) {
              creature.goaded = creature.goaded || {};
              creature.goaded[turnPlayer] = true; // Goaded until controller's next turn
              debug(2, `[Resolution] ${sourceName}: Goaded ${creature.card?.name || creatureId}`);
            }
          }
          
          io.to(gameId).emit('chat', {
            id: `m_${Date.now()}_${Math.random()}`,
            gameId,
            from: 'system',
            message: `${sourceName}: Goaded ${creaturesWithCounters.length} creature(s)`,
            ts: Date.now(),
          });
        } else if (effectType === 'cant_attack' || conditionalEffect.onAccept === 'cant_attack_controller') {
          // Orzhov Advokist: "If a player does, creatures that player controls can't attack you"
          // Apply restriction ONLY to players who accepted (put counters on a creature)
          for (const playerId of playersWhoAccepted) {
            // Mark all creatures controlled by this player as unable to attack the source controller
            const playerCreatures = battlefield.filter((p: any) => p.controller === playerId);
            for (const creature of playerCreatures) {
              creature.cantAttackPlayers = creature.cantAttackPlayers || {};
              // Can't attack until source controller's next turn
              creature.cantAttackPlayers[sourceController] = {
                until: 'next_turn',
                sourcePlayer: sourceController,
              };
              debug(2, `[Resolution] ${sourceName}: ${creature.card?.name || creature.id} (controlled by ${playerId}) can't attack ${sourceController}`);
            }
          }
          
          io.to(gameId).emit('chat', {
            id: `m_${Date.now()}_${Math.random()}`,
            gameId,
            from: 'system',
            message: `${sourceName}: ${playersWhoAccepted.length} player(s) placed counters and can't attack you until your next turn`,
            ts: Date.now(),
          });
        }
      }
      
      // Clean up tracking
      delete state._counterPlacementSelections;
      
      // Bump sequence
      if (typeof (game as any).bumpSeq === 'function') {
        (game as any).bumpSeq();
      }
    }
  }
  
  // Handle tap/untap decision
  if ((step as any).action === 'tap_or_untap_decision') {
    const targetId = stepData.targetId;
    if (!targetId) return;
    const battlefield = game.state?.battlefield || [];
    const perm = battlefield.find((p: any) => p.id === targetId);
    if (!perm) return;
    const choice = Array.isArray(selectedOption) ? selectedOption[0] : selectedOption;
    if (choice === 'tap') {
      (perm as any).tapped = true;
      debug(2, `[Resolution] Tap/Untap: tapped ${perm.card?.name || perm.id}`);
    } else if (choice === 'untap') {
      (perm as any).tapped = false;
      debug(2, `[Resolution] Tap/Untap: untapped ${perm.card?.name || perm.id}`);
    }
    broadcastGame(io, game, gameId);
    return;
  }
  
  if ((step as any).action === 'mox_diamond_choice') {
    const selection = Array.isArray(selectedOption) ? selectedOption[0] : selectedOption;
    const state = game.state || {};
    state.stack = state.stack || [];
    const stackIndex = state.stack.findIndex((s: any) => s.id === step.sourceId);
    if (stackIndex === -1) return;
    const stackItem = state.stack[stackIndex];
    const controller = stackItem.controller as PlayerID;
    const zones = state.zones = state.zones || {};
    zones[controller] = zones[controller] || { hand: [], graveyard: [], graveyardCount: 0 } as any;
    const playerZones = zones[controller] as any;
    playerZones.hand = playerZones.hand || [];
    playerZones.graveyard = playerZones.graveyard || [];
    
    // Remove Mox from stack
    state.stack.splice(stackIndex, 1);
    
    if (selection && selection !== 'DECLINE') {
      const hand = playerZones.hand;
      const landIdx = hand.findIndex((c: any) => c?.id === selection);
      if (landIdx !== -1) {
        const landCard = hand.splice(landIdx, 1)[0];
        playerZones.handCount = hand.length;
        playerZones.graveyard.push({ ...landCard, zone: 'graveyard' });
        playerZones.graveyardCount = playerZones.graveyard.length;
        
        // Put Mox Diamond onto battlefield
        state.battlefield = state.battlefield || [];
        state.battlefield.push({
          id: stackItem.id,
          card: stackItem.card,
          controller,
          tapped: false,
        });
        debug(2, `[Resolution] Mox Diamond: discarded ${landCard.name}, put onto battlefield`);
      } else {
        // If land missing, fall back to graveyard
        playerZones.graveyard.push({ ...(stackItem.card || {}), zone: 'graveyard' });
        playerZones.graveyardCount = playerZones.graveyard.length;
        debugWarn(2, `[Resolution] Mox Diamond: selected land not found, card to graveyard`);
      }
    } else {
      // Decline: put Mox Diamond into graveyard
      playerZones.graveyard.push({ ...(stackItem.card || {}), zone: 'graveyard' });
      playerZones.graveyardCount = playerZones.graveyard.length;
      debug(2, `[Resolution] Mox Diamond: declined discard, card to graveyard`);
    }
    
    broadcastGame(io, game, gameId);
    return;
  }
}

/**
 * Handle Modal Choice response
 * This handles generic modal choices including the "put creature from hand onto battlefield" pattern
 */
async function handleModalChoiceResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): Promise<void> {
  const pid = response.playerId;
  const selections = response.selections;
  
  // Import utilities dynamically to avoid circular dependencies
  // (resolution.ts <-> stack.ts circular import would cause issues)
  const { uid } = await import("../state/utils.js");
  const { triggerETBEffectsForPermanent } = await import("../state/modules/stack.js");
  
  // Get selection - could be string, array of strings, or 'decline'
  let selectedId: string | null = null;
  if (typeof selections === 'string') {
    selectedId = selections === 'decline' ? null : selections;
  } else if (Array.isArray(selections) && selections.length > 0) {
    selectedId = selections[0] === 'decline' ? null : selections[0];
  }
  
  // Check if this is a "put from hand" modal choice
  const modalStep = step as any;
  const putFromHandData = modalStep.putFromHandData;
  
  if (putFromHandData) {
    // Handle putting creature from hand onto battlefield
    if (!selectedId || selectedId === 'decline') {
      // Player declined
      debug(2, `[Resolution] ${step.sourceName || 'Effect'}: Player ${pid} declined to put creature from hand`);
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} chose not to put a creature onto the battlefield.`,
        ts: Date.now(),
      });
      return;
    }
    
    // Verify the selected card is valid
    const validCardIds = new Set(putFromHandData.validCardIds || []);
    if (!validCardIds.has(selectedId)) {
      debugWarn(1, `[Resolution] Invalid card selection: ${selectedId} not in valid cards`);
      return;
    }
    
    // Get player zones
    const zones = game.state?.zones?.[pid];
    if (!zones || !zones.hand) {
      debugWarn(2, `[Resolution] No hand found for player ${pid}`);
      return;
    }
    
    // Find and remove the card from hand
    const cardIndex = zones.hand.findIndex((c: any) => c.id === selectedId);
    if (cardIndex === -1) {
      debugWarn(2, `[Resolution] Selected card ${selectedId} not found in hand`);
      return;
    }
    
    const [card] = zones.hand.splice(cardIndex, 1);
    zones.handCount = zones.hand.length;
    
    // Put onto battlefield
    const battlefield = game.state.battlefield = game.state.battlefield || [];
    const tl = (card.type_line || '').toLowerCase();
    const isCreature = tl.includes('creature');
    const tappedAndAttacking = putFromHandData.tappedAndAttacking === true;
    
    const newPermanent = {
      id: uid("perm"),
      controller: pid,
      owner: pid,
      tapped: tappedAndAttacking,
      counters: {},
      basePower: isCreature ? parsePT(card.power) : undefined,
      baseToughness: isCreature ? parsePT(card.toughness) : undefined,
      // Creatures that enter "tapped and attacking" bypass summoning sickness for this attack
      summoningSickness: isCreature && !tappedAndAttacking,
      isAttacking: tappedAndAttacking,
      card: { ...card, zone: "battlefield" },
    } as any;
    
    battlefield.push(newPermanent);
    
    debug(2, `[Resolution] ${step.sourceName || 'Effect'}: Put ${card.name} onto battlefield${tappedAndAttacking ? ' tapped and attacking' : ''} for ${pid}`);
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} puts ${card.name} onto the battlefield${tappedAndAttacking ? ' tapped and attacking' : ''}.`,
      ts: Date.now(),
    });
    
    // Trigger ETB effects
    try {
      triggerETBEffectsForPermanent(
        {
          state: game.state,
          bumpSeq: () => game.bumpSeq?.(),
          libraries: (game as any).libraries,
          commandZone: (game as any).commandZone || {},
        } as any,
        newPermanent,
        pid
      );
    } catch (err) {
      debugWarn(1, `[Resolution] Error triggering ETB effects:`, err);
    }
    
    // ========================================================================
    // CHECK FOR "AS ENTERS" CHOICES (Greymond, Avacyn's Stalwart, etc.)
    // Cards with "As ~ enters, choose..." need to have those choices made
    // even when put onto the battlefield by effects like Preeminent Captain
    // ========================================================================
    const oracleText = (card.oracle_text || '').toLowerCase();
    
    // Pattern: "As ~ enters, choose X abilities from among A, B, and C"
    // Example: Greymond - "As Greymond enters, choose two abilities from among first strike, vigilance, and lifelink."
    const fromAmongPattern = /as .+? enters(?:,| the battlefield,?)?\s*choose\s+(\w+)\s+(?:abilities?|options?)\s+from\s+among\s+([^.]+)/i;
    const fromAmongMatch = oracleText.match(fromAmongPattern);
    
    if (fromAmongMatch) {
      const numWord = fromAmongMatch[1].toLowerCase();
      const numMap: Record<string, number> = {
        'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
        'a': 1, 'an': 1,
      };
      const choiceCount = numMap[numWord] || parseInt(numWord, 10) || 1;
      
      // Extract the list of options
      const itemList = fromAmongMatch[2];
      const parts = itemList.split(/,\s+(?:and\s+)?|(?:,\s+)?and\s+/);
      const options = parts.map(p => p.trim().replace(/^(a|an|the)\s+/i, '')).filter(p => p.length > 0);
      
      if (options.length >= choiceCount) {
        debug(2, `[Resolution] Detected "As enters" choice for ${card.name}: choose ${choiceCount} from ${options.join(', ')}`);
        
        // Add resolution step for the choice
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: pid,
          description: `Choose ${choiceCount} for ${card.name}: ${options.join(', ')}`,
          mandatory: true,
          sourceId: newPermanent.id,
          sourceName: card.name,
          options,
          minSelections: choiceCount,
          maxSelections: choiceCount,
          // Use permanentId for existing handler compatibility
          permanentId: newPermanent.id,
        } as any);
      }
    }
    
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }
    
    return;
  }
  
  // ========================================================================
  // ELSPETH RESPLENDENT +1 COUNTER CHOICE
  // Handle "Put a +1/+1 counter and a counter from among flying, first strike, lifelink, or vigilance on it."
  // ========================================================================
  const elspethCounterData = (modalStep as any).elspethCounterData;
  if (elspethCounterData) {
    const { targetCreatureId, targetCreatureName } = elspethCounterData;
    
    // Get the chosen counter type
    let chosenCounter: string | null = null;
    if (typeof selections === 'string') {
      chosenCounter = selections;
    } else if (Array.isArray(selections) && selections.length > 0) {
      chosenCounter = selections[0];
    }
    
    if (!chosenCounter || chosenCounter === 'decline') {
      debug(2, `[Resolution] Elspeth Resplendent +1: No counter chosen`);
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      return;
    }
    
    // Find the target creature
    const battlefield = game.state?.battlefield || [];
    const targetCreature = battlefield.find((p: any) => p.id === targetCreatureId);
    
    if (!targetCreature) {
      debug(2, `[Resolution] Elspeth Resplendent +1: Target creature ${targetCreatureId} no longer on battlefield`);
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      return;
    }
    
    // Add +1/+1 counter
    targetCreature.counters = targetCreature.counters || {};
    targetCreature.counters['+1/+1'] = (targetCreature.counters['+1/+1'] || 0) + 1;
    
    // Map the choice ID back to the original counter name using counterOptions
    // The ID was created by: opt.toLowerCase().replace(/\s+/g, '_')
    // So we need to find the matching option from the original list
    const counterOptions = elspethCounterData.counterOptions || [];
    let counterName = chosenCounter.replace(/_/g, ' '); // Default: simple underscore-to-space
    
    // Try to find exact match in original options (more robust)
    for (const opt of counterOptions) {
      const optId = opt.toLowerCase().replace(/\s+/g, '_');
      if (optId === chosenCounter) {
        counterName = opt.toLowerCase();
        break;
      }
    }
    
    targetCreature.counters[counterName] = (targetCreature.counters[counterName] || 0) + 1;
    
    // Also grant the ability via grantedAbilities for immediate effect
    targetCreature.grantedAbilities = targetCreature.grantedAbilities || [];
    if (!targetCreature.grantedAbilities.includes(counterName)) {
      targetCreature.grantedAbilities.push(counterName);
    }
    
    // Update keywords array on the card
    targetCreature.card = targetCreature.card || {};
    targetCreature.card.keywords = targetCreature.card.keywords || [];
    const keywordCapitalized = counterName.split(' ').map((word: string) => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
    if (!targetCreature.card.keywords.includes(keywordCapitalized)) {
      targetCreature.card.keywords.push(keywordCapitalized);
    }
    
    debug(2, `[Resolution] Elspeth Resplendent +1: Added +1/+1 and ${counterName} counters to ${targetCreature.card?.name || targetCreatureId}`);
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `Elspeth Resplendent puts a +1/+1 counter and a ${counterName} counter on ${targetCreature.card?.name || 'creature'}.`,
      ts: Date.now(),
    });
    
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }
    return;
  }

  // ========================================================================
  // PLANESWALKER TOKEN KEYWORD COUNTER CHOICE (Beast: vigilance/reach/trample)
  // ========================================================================
  const beastCounterData = (modalStep as any).pwBeastKeywordCounterData;
  if (beastCounterData) {
    const { tokenPermanentId, tokenName } = beastCounterData;

    let chosen: string | null = null;
    if (typeof selections === 'string') {
      chosen = selections;
    } else if (Array.isArray(selections) && selections.length > 0) {
      chosen = selections[0];
    }

    const allowed = new Set(['vigilance', 'reach', 'trample']);
    if (!chosen || chosen === 'decline' || !allowed.has(String(chosen).toLowerCase())) {
      debug(2, `[Resolution] Beast keyword counter: no valid choice`);
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      return;
    }

    const battlefield = game.state?.battlefield || [];
    const tokenPerm = battlefield.find((p: any) => p.id === tokenPermanentId);
    if (!tokenPerm) {
      debug(2, `[Resolution] Beast keyword counter: token ${tokenPermanentId} no longer on battlefield`);
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      return;
    }

    const counterName = String(chosen).toLowerCase();
    tokenPerm.counters = tokenPerm.counters || {};
    tokenPerm.counters[counterName] = (tokenPerm.counters[counterName] || 0) + 1;

    tokenPerm.grantedAbilities = tokenPerm.grantedAbilities || [];
    if (!tokenPerm.grantedAbilities.includes(counterName)) {
      tokenPerm.grantedAbilities.push(counterName);
    }

    tokenPerm.card = tokenPerm.card || {};
    tokenPerm.card.keywords = tokenPerm.card.keywords || [];
    const keywordCapitalized = counterName.charAt(0).toUpperCase() + counterName.slice(1);
    if (!tokenPerm.card.keywords.includes(keywordCapitalized)) {
      tokenPerm.card.keywords.push(keywordCapitalized);
    }

    debug(2, `[Resolution] Beast keyword counter: added ${counterName} to ${tokenName || 'token'} (${tokenPermanentId})`);

    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${tokenName || 'Token'} gets a ${counterName} counter.`,
      ts: Date.now(),
    });

    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }
    return;
  }
  
  // Generic modal choice handling (fallback for other modal choices)
  debug(2, `[Resolution] Generic modal choice: ${step.description}, selected: ${selectedId || 'none'}`);
  
  // Check if this is a trigger modal choice (e.g., SOLDIER Military Program)
  const triggerData = (modalStep as any).triggerData;
  if (triggerData && triggerData.isSoldierProgram) {
    // Normalize selections to array of strings
    let choiceIds: string[] = [];
    if (typeof selections === 'string') {
      choiceIds = [selections];
    } else if (Array.isArray(selections)) {
      choiceIds = selections as string[];
    }
    
    await handleSoldierProgramChoice(io, game, gameId, pid, choiceIds, triggerData);
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }
    return;
  }
  
  // For generic modal choices without specific data, just log and continue
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}

/**
 * Handle SOLDIER Military Program modal choice resolution
 */
async function handleSoldierProgramChoice(
  io: Server,
  game: any,
  gameId: string,
  playerId: string,
  choiceIds: string[],
  triggerData: any
): Promise<void> {
  if (choiceIds.length === 0) {
    debugWarn(1, '[Resolution] SOLDIER Military Program: No choice selected');
    return;
  }
  
  const { createToken } = await import("../state/modules/counters_tokens.js");
  
  const battlefield = game.state.battlefield || [];
  const actionMessages: string[] = [];
  
  // Card text specifies "up to two Soldiers"
  const MAX_SOLDIERS_FOR_COUNTERS = 2;
  
  // Track if we need to add counters (may need player selection)
  let needsCounterPlacement = false;
  
  // Check what the player chose
  for (const choiceId of choiceIds) {
    if (choiceId === 'create_token' || choiceId === 'both') {
      // Create a 1/1 white Soldier creature token
      // SOLDIER Military Program says: "Create a 1/1 white Soldier creature token"
      createToken(
        {
          state: game.state,
          bumpSeq: () => game.bumpSeq?.(),
          libraries: (game as any).libraries,
          commandZone: (game as any).commandZone || {},
        } as any,
        playerId,
        'Soldier', // token name
        1, // quantity
        1, // basePower
        1, // baseToughness
        {
          colors: ['W'], // White Soldier (not colorless like Myrel's)
          typeLine: 'Token Creature — Soldier',
        }
      );
      
      actionMessages.push('created a 1/1 white Soldier creature token');
      debug(2, `[Resolution] SOLDIER Military Program: Created white Soldier token for ${playerId}`);
    }
    
    if (choiceId === 'add_counters' || choiceId === 'both') {
      needsCounterPlacement = true;
    }
  }
  
  if (needsCounterPlacement) {
    // Get all Soldiers controlled by this player
    const soldiers = battlefield.filter((p: any) => {
      if (p.controller !== playerId) return false;
      return permanentHasCreatureTypeNow(p, 'soldier');
    });
    
    if (soldiers.length === 0) {
      // No soldiers to boost
      debug(2, `[Resolution] SOLDIER Military Program: No Soldiers to add counters to`);
    } else if (soldiers.length <= MAX_SOLDIERS_FOR_COUNTERS) {
      // Auto-apply counters to all soldiers if 2 or fewer (since it says "up to two")
      for (const soldier of soldiers) {
        soldier.counters = soldier.counters || {};
        soldier.counters['+1/+1'] = (soldier.counters['+1/+1'] || 0) + 1;
        debug(2, `[Resolution] SOLDIER Military Program: Added +1/+1 counter to ${soldier.card?.name || soldier.id}`);
      }
      actionMessages.push(`put a +1/+1 counter on ${soldiers.length} Soldier${soldiers.length > 1 ? 's' : ''}`);
    } else {
      // More than 2 soldiers - player needs to select which ones
      debug(2, `[Resolution] SOLDIER Military Program: ${soldiers.length} Soldiers available, prompting player to select up to ${MAX_SOLDIERS_FOR_COUNTERS}`);
      
      // Create a target selection step for selecting up to 2 Soldiers
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: playerId,
        description: `SOLDIER Military Program: Choose up to ${MAX_SOLDIERS_FOR_COUNTERS} Soldiers to get +1/+1 counters`,
        mandatory: false, // "up to" means optional
        sourceName: 'SOLDIER Military Program',
        sourceImage: triggerData?.sourceImage,
        validTargets: soldiers.map((s: any) => ({
          id: s.id,
          name: s.card?.name || 'Soldier',
          type: 'permanent',
          controller: s.controller,
          imageUrl: s.card?.image_uris?.small || s.card?.image_uris?.normal,
          power: s.basePower || s.card?.power,
          toughness: s.baseToughness || s.card?.toughness,
        })),
        targetTypes: ['creature'],
        minTargets: 0,
        maxTargets: MAX_SOLDIERS_FOR_COUNTERS,
        targetDescription: `Soldier creatures you control`,
        // Store data for the response handler
        soldierProgramCounters: true,
      } as any);
      
      // Don't add to actionMessages yet - that will happen after selection
    }
  }
  
  if (actionMessages.length > 0) {
    const message = `${getPlayerName(game, playerId)} ${actionMessages.join(' and ')}.`;
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: message,
      ts: Date.now(),
    });
  }
}


export default { registerResolutionHandlers };
