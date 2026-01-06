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
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../state/resolution/index.js";
import { ensureGame, broadcastGame, getPlayerName, emitToPlayer } from "./util.js";
import { parsePT, uid } from "../state/utils.js";
import { debug, debugWarn, debugError } from "../utils/debug.js";
import { handleBounceLandETB } from "./ai.js";
import { appendEvent } from "../db/index.js";
import type { PlayerID } from "../../../shared/src/types.js";
import { isShockLand } from "./land-helpers.js";

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
        
        let selection: { type: 'creature' | 'source'; creatureId?: string } = { type: 'source' };
        
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
          debug(2, `[Resolution] AI upkeep sacrifice: no creatures, sacrificing ${sourceToSacrifice?.name || 'source'}`);
        }
        
        response = {
          stepId: step.id,
          playerId: step.playerId,
          selections: selection,
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
        step: sanitizeStepForClient(nextStep),
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
          step: sanitizeStepForClient(remainingSteps[0]),
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
    
    if (step.mandatory) {
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
          // Notify player they have a new step to resolve
          socket.emit("resolutionStepPrompt", {
            gameId: eventGameId,
            step: sanitizeStepForClient(step),
          });
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
function sanitizeStepForClient(step: ResolutionStep): any {
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
    // Include type-specific fields
    ...getTypeSpecificFields(step),
  };
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
    
    // Add more handlers as needed
    default:
      debug(2, `[Resolution] No specific handler for step type: ${step.type}`);
      // For steps with legacy data, try to process using old system
      if (step.legacyData) {
        debug(2, `[Resolution] Step has legacy data, may need migration`);
      }
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
  
  // Move selected cards to graveyard
  zones.graveyard = zones.graveyard || [];
  
  for (const cardId of selections) {
    const cardIndex = zones.hand.findIndex((c: any) => c.id === cardId);
    if (cardIndex !== -1) {
      const [card] = zones.hand.splice(cardIndex, 1);
      zones.graveyard.push({ ...card, zone: 'graveyard' });
    }
  }
  
  // Update counts
  zones.handCount = zones.hand.length;
  zones.graveyardCount = zones.graveyard.length;
  
  // Clear legacy pending state if present
  if (game.state.pendingDiscardSelection?.[pid]) {
    delete game.state.pendingDiscardSelection[pid];
  }
  
  // Emit chat message
  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message: `${getPlayerName(game, pid)} discarded ${selections.length} card(s).`,
    ts: Date.now(),
  });
  
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
  const targetStep = step as any;
  const validTargets = targetStep.validTargets || [];
  const minTargets = targetStep.minTargets || 0;
  const maxTargets = targetStep.maxTargets || Infinity;
  
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

  // Execute immediate actions for certain target-selection steps
  const action = (step as any).action;
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
      legacyData: { targetId },
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
  // Triggers are put on the stack in the order specified (first in list = first to resolve = last on stack)
  // So we need to reverse the order when putting on stack
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
    
    // Add them back in reverse order (last chosen = top of stack = resolves first)
    for (let i = foundTriggerItems.length - 1; i >= 0; i--) {
      stack.unshift(foundTriggerItems[i]);
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
  } else {
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
  }
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
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
    for (const p of players) {
      if (p.hasLost) continue;
      game.state.pendingDraws = game.state.pendingDraws || {};
      game.state.pendingDraws[p.id] = (game.state.pendingDraws[p.id] || 0) + totalContributions;
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
  const contextValue = searchStep.contextValue;
  const entersTapped = searchStep.entersTapped || false;
  const sourceName = step.sourceName || 'Library Search';
  const lifeLoss = (searchStep as any).lifeLoss;
  
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
  const takeCardFromLibrary = (cardId: string) => {
    const idx = lib.findIndex((c: any) => c.id === cardId);
    if (idx >= 0) {
      return lib.splice(idx, 1)[0];
    }
    return cardMap.get(cardId);
  };
  
  const selectedCards = selectedIds.map(id => takeCardFromLibrary(id)).filter(Boolean);
  
  // For destination=top with shuffleAfter, place selected after shuffling remainder
  const deferTopPlacement = destination === 'top' && shuffleAfter;
  
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
        z.exile.push({ ...card, zone: 'exile' });
        z.exileCount = z.exile.length;
        debug(2, `[Resolution] ${sourceName}: Exiled ${card.name}`);
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
  
  if (remainderDestination === 'graveyard') {
    z.graveyard = z.graveyard || [];
    for (const card of unselectedCards) {
      const fromLib = takeCardFromLibrary(card.id) || card;
      z.graveyard.push({ ...fromLib, zone: 'graveyard' });
    }
    z.graveyardCount = z.graveyard.length;
    debug(2, `[Resolution] ${sourceName}: Put ${unselectedCards.length} unselected cards into graveyard`);
  } else if (remainderDestination === 'bottom') {
    const cardsToBottom = remainderRandomOrder 
      ? [...unselectedCards].sort(() => Math.random() - 0.5)
      : unselectedCards;
    for (const card of cardsToBottom) {
      const fromLib = takeCardFromLibrary(card.id) || card;
      lib.push({ ...fromLib, zone: 'library' });
    }
    debug(2, `[Resolution] ${sourceName}: Put ${unselectedCards.length} unselected cards on bottom${remainderRandomOrder ? ' in random order' : ''}`);
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
  if (shuffleAfter && lib.length > 0) {
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
 * Process pending surveil from legacy state and migrate to resolution queue
 * 
 * This is called after stack resolution or when surveil effects are created.
 * Migrates from pendingSurveil state to the resolution queue system.
 */
export function processPendingSurveil(
  io: Server,
  game: any,
  gameId: string
): void {
  try {
    const pending = (game.state as any).pendingSurveil;
    if (!pending || typeof pending !== 'object') return;
    
    for (const surveilId of Object.keys(pending)) {
      const data = pending[surveilId];
      if (!data || typeof data !== 'object') continue;
      
      const playerId = data.playerId;
      const surveilCount = data.count || 0;
      
      if (!playerId || surveilCount <= 0) {
        delete pending[surveilId];
        continue;
      }
      
      // Get library
      const lib = (game as any).libraries?.get(playerId) || [];
      if (!Array.isArray(lib)) continue;
      
      // Peek at the top N cards
      const actualCount = Math.min(surveilCount, lib.length);
      if (actualCount === 0) {
        // No cards to surveil, skip
        delete pending[surveilId];
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
        type: ResolutionStepType.SURVEIL,
        playerId,
        description: `Surveil ${actualCount}`,
        mandatory: true,
        sourceId: data.sourceId,
        sourceName: data.sourceName || 'Surveil',
        cards,
        surveilCount: actualCount,
      });
      
      // Clear from pending state
      delete pending[surveilId];
    }
    
    // Clean up empty pending object
    if (Object.keys(pending).length === 0) {
      delete (game.state as any).pendingSurveil;
    }
  } catch (err) {
    debugWarn(1, "[processPendingSurveil] Error:", err);
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
 * Process pending fateseal from legacy state and migrate to resolution queue
 * 
 * Currently fateseal doesn't have legacy implementation, but this function
 * is provided for future use if needed.
 */
export function processPendingFateseal(
  io: Server,
  game: any,
  gameId: string
): void {
  try {
    const pending = (game.state as any).pendingFateseal;
    if (!pending || typeof pending !== 'object') return;
    
    for (const playerId of Object.keys(pending)) {
      const data = pending[playerId];
      if (!data || typeof data !== 'object') continue;
      
      const opponentId = data.opponentId;
      const fatesealCount = data.count || 0;
      
      if (!opponentId || fatesealCount <= 0) {
        delete pending[playerId];
        continue;
      }
      
      // Get opponent's library
      const lib = (game as any).libraries?.get(opponentId) || [];
      if (!Array.isArray(lib)) continue;
      
      // Peek at the top N cards of opponent's library
      const actualCount = Math.min(fatesealCount, lib.length);
      if (actualCount === 0) {
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
        type: ResolutionStepType.FATESEAL,
        playerId,
        description: `Fateseal ${actualCount} (${getPlayerName(game, opponentId)}'s library)`,
        mandatory: true,
        sourceId: data.sourceId,
        sourceName: data.sourceName || 'Fateseal',
        opponentId,
        cards,
        fatesealCount: actualCount,
      });
      
      // Clear from pending state
      delete pending[playerId];
    }
    
    // Clean up empty pending object
    if (Object.keys(pending).length === 0) {
      delete (game.state as any).pendingFateseal;
    }
  } catch (err) {
    debugWarn(1, "[processPendingFateseal] Error:", err);
  }
}


/**
 * Process pending clash from legacy state and migrate to resolution queue
 * 
 * Currently clash doesn't have legacy implementation, but this function
 * is provided for future use if needed.
 */
export function processPendingClash(
  io: Server,
  game: any,
  gameId: string
): void {
  try {
    const pending = (game.state as any).pendingClash;
    if (!Array.isArray(pending) || pending.length === 0) return;
    
    for (const clashData of pending) {
      if (!clashData || clashData.prompted) continue;
      
      const playerId = clashData.playerId;
      if (!playerId) continue;
      
      // Mark as prompted
      clashData.prompted = true;
      
      // Get player's library
      const lib = (game as any).libraries?.get(playerId) || [];
      if (lib.length === 0) continue;
      
      // Reveal top card
      const revealedCard = {
        id: lib[0].id,
        name: lib[0].name,
        type_line: lib[0].type_line,
        oracle_text: lib[0].oracle_text,
        imageUrl: lib[0].image_uris?.normal,
        mana_cost: lib[0].mana_cost,
        cmc: lib[0].cmc,
      };
      
      // Add to resolution queue
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.CLASH,
        playerId,
        description: `Clash - Put ${revealedCard.name} on bottom?`,
        mandatory: true,
        sourceId: clashData.sourceId,
        sourceName: clashData.sourceName || 'Clash',
        revealedCard,
        opponentId: clashData.opponentId,
      });
    }
  } catch (err) {
    debugWarn(1, "[processPendingClash] Error:", err);
  }
}


/**
 * Process pending vote from legacy state and migrate to resolution queue
 * 
 * Votes are processed in APNAP order. This creates resolution steps for each
 * player who needs to vote.
 */
export function processPendingVote(
  io: Server,
  game: any,
  gameId: string
): void {
  try {
    const pending = (game.state as any).pendingVote;
    if (!Array.isArray(pending) || pending.length === 0) return;
    
    const players = game.state?.players || [];
    
    for (const voteData of pending) {
      if (!voteData || voteData.prompted) continue;
      
      const voteId = voteData.id;
      const choices = voteData.choices || [];
      const voters = voteData.voters || players.map((p: any) => p.id);
      const votesSubmitted = voteData.votes || [];
      
      if (choices.length === 0 || voters.length === 0) continue;
      
      // Mark as prompted
      voteData.prompted = true;
      
      // Find next voter who hasn't voted yet
      const alreadyVoted = new Set(votesSubmitted.map((v: any) => v.playerId));
      const nextVoter = voters.find((pid: string) => !alreadyVoted.has(pid));
      
      if (!nextVoter) {
        // All players have voted, process results
        continue;
      }
      
      // Add resolution step for next voter
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.VOTE,
        playerId: nextVoter,
        description: `Vote: ${choices.join(' or ')}`,
        mandatory: true,
        sourceId: voteData.sourceId,
        sourceName: voteData.sourceName || 'Vote',
        voteId,
        choices,
        votesSubmitted,
      });
    }
  } catch (err) {
    debugWarn(1, "[processPendingVote] Error:", err);
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
 */
function filterLibraryCards(library: any[], filter: any): any[] {
  const availableCards: any[] = [];
  const searchCriteria = filter || {};
  
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
 * Replaces the legacy pendingLibrarySearch state
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
  
  // Filter cards based on search criteria
  const availableCards = filterLibraryCards(lib, filter);
  
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
 * Process pending library search effects into resolution queue
 * @deprecated This function migrates legacy pendingLibrarySearch state. Will be removed.
 */
export function processPendingLibrarySearch(io: Server, game: any, gameId: string): void {
  try {
    const pendingLibrarySearch = (game.state as any)?.pendingLibrarySearch;
    if (!pendingLibrarySearch || typeof pendingLibrarySearch !== 'object') return;
    
    for (const [playerId, searchData] of Object.entries(pendingLibrarySearch)) {
      if (!searchData || typeof searchData !== 'object') continue;
      
      const data = searchData as any;
      const {
        type,
        searchFor,
        destination,
        tapped,
        optional,
        source,
        shuffleAfter,
        filter,
        maxSelections,
        minSelections,
        reveal,
        remainderDestination,
        discardRandomAfter,
      } = data;
      
      // Get player's library
      const lib = (game as any).libraries?.get(playerId) || [];
      if (lib.length === 0) {
        debug(2, `[processPendingLibrarySearch] Player ${playerId} has empty library, skipping search`);
        delete pendingLibrarySearch[playerId];
        continue;
      }
      
      // Filter cards based on search criteria
      let availableCards: any[] = [];
      const searchCriteria = filter || {};
      
      for (const card of lib) {
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
      
      debug(2, `[processPendingLibrarySearch] Migrating library search for player ${playerId}, ${availableCards.length} matching cards`);
      
      // Create description
      let description = searchFor || 'Search your library';
      if (destination === 'battlefield') {
        description += tapped ? ' (enters tapped)' : ' (enters untapped)';
      }
      
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: playerId as string,
        description,
        mandatory: !optional,
        sourceName: source || 'Library Search',
        searchCriteria: searchFor || 'any card',
        minSelections: minSelections || 0,
        maxSelections: maxSelections || 1,
        destination: destination || 'hand',
        reveal: reveal !== false,
        shuffleAfter: shuffleAfter !== false,
        availableCards,
        entersTapped: tapped || false,
        remainderDestination: remainderDestination || 'shuffle',
        remainderRandomOrder: true,
      });
      
      // Clear from pending state after creating step
      delete pendingLibrarySearch[playerId];
    }
    
    // Clean up empty pending object
    if (Object.keys(pendingLibrarySearch).length === 0) {
      delete (game.state as any).pendingLibrarySearch;
    }
  } catch (e) {
    debugError(1, '[processPendingLibrarySearch] Error:', e);
  }
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
    const targetId = stepData.legacyData?.targetId;
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
      const typeLine = (p.card?.type_line || '').toLowerCase();
      return typeLine.includes('soldier');
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
