/**
 * keyword-handlers.ts
 * 
 * Server-side handlers for keyword ability effects.
 * Works with keyword-detection.ts to process keyword triggers.
 * 
 * This module provides:
 * 1. Handlers for triggered keyword abilities
 * 2. Handlers for replacement effects
 * 3. Handlers for ETB modifications
 * 4. Counter manipulation for keywords
 */

import type { GameContext } from "../context.js";
import { debug, debugWarn, debugError } from "../../utils/debug.js";
import type { DetectedKeyword, KeywordTiming } from "./keyword-detection.js";
import { detectKeywords, getAttackTriggerKeywords, getETBKeywords, getDeathTriggerKeywords, getCombatDamageTriggerKeywords, getSpellCastTriggerKeywords, battlefieldGrantsRiotToPermanent } from "./keyword-detection.js";
import { listLegalHauntCreatureTargets } from "./hauntKeywordUtils.js";
import type { KeywordTriggerResult, KeywordTriggerContext } from "./keyword-trigger-handlers/keywordTriggerTypes.js";
import { permanentHasKeyword, getPermanentKeywords } from "./keyword-trigger-handlers/keywordTriggerPermanentLookup.js";
import { playerCannotReceivePriority } from "./priorityEligibility.js";
import { recordEndOfCombatKeywordPtBonus } from "./longDurationPtModifiers.js";
import {
  handleProwess,
  handleDethrone,
  handleEvolve,
  handleMelee,
  handleMyriad,
  handleExalted,
  handleBattleCry,
  handleMentor,
  handleTraining,
  handleAnnihilator,
  handleAfflict,
  handleFlanking,
  handleBushido,
  handleRampage,
  handleEnlist,
} from "./keyword-trigger-handlers/keywordTriggerAttackHandlers.js";

export type { KeywordTriggerResult, KeywordTriggerContext };
export { permanentHasKeyword, getPermanentKeywords };


// ============================================================================
// Main Processing Functions
// ============================================================================

/**
 * Process all keyword triggers for a permanent at a specific timing
 */
export function processKeywordTriggers(
  ctx: KeywordTriggerContext,
  timing: KeywordTiming
): KeywordTriggerResult[] {
  const results: KeywordTriggerResult[] = [];
  
  const card = ctx.permanent?.card;
  if (!card) return results;
  
  const oracleText = card.oracle_text || '';
  const cardName = card.name || 'Unknown';
  
  // Detect keywords
  const detected = detectKeywords(oracleText, cardName);

  // Filter out creature-only triggers (like prowess) if this is not actually a creature card/token
  const isCreature = ctx.permanent ? String(ctx.permanent?.card?.type_line || '').toLowerCase().includes('creature') : false;
  if (!isCreature) {
    detected.keywords = detected.keywords.filter(k =>
      k.keyword !== 'prowess' && k.keyword !== 'riot' && k.keyword !== 'unleash'
    );
  }
  
  // Get keywords for this timing
  let relevantKeywords: DetectedKeyword[] = [];
  
  switch (timing) {
    case 'attacks':
      relevantKeywords = getAttackTriggerKeywords(detected.keywords);
      break;
    case 'etb':
      relevantKeywords = getETBKeywords(detected.keywords);
      break;
    case 'dies':
      relevantKeywords = getDeathTriggerKeywords(detected.keywords);
      break;
    case 'combat_damage':
      relevantKeywords = getCombatDamageTriggerKeywords(detected.keywords);
      break;
    case 'cast':
    case 'noncreature_cast':
      relevantKeywords = getSpellCastTriggerKeywords(detected.keywords);
      break;
    default:
      relevantKeywords = detected.keywords.filter(k => k.timing === timing);
  }
  
  // Process each keyword
  for (const keyword of relevantKeywords) {
    const result = processKeywordTrigger(ctx, keyword);
    if (result) {
      results.push(result);
    }
  }
  
  return results;
}

/**
 * Riot choice for a creature that has riot from a continuous grant
 * (Rhythm of the Wild), not from its own keyword line.
 */
export function createGrantedRiotChoiceResult(ctx: KeywordTriggerContext): KeywordTriggerResult | null {
  if (!battlefieldGrantsRiotToPermanent(ctx.permanent, ctx.battlefield || [])) {
    return null;
  }
  return handleRiot(ctx, {
    keyword: 'riot',
    category: 'enters_effect',
    timing: 'etb',
    effect: 'Choose: enters with a +1/+1 counter OR enters with haste',
    mandatory: true,
    requiresChoice: true,
    choiceType: 'riot_choice',
    raw: 'riot',
  });
}

/**
 * Process a single keyword trigger
 */
function processKeywordTrigger(
  ctx: KeywordTriggerContext,
  keyword: DetectedKeyword
): KeywordTriggerResult | null {
  const permanentId = ctx.permanent?.id;
  const cardName = ctx.permanent?.card?.name || 'Unknown';
  
  debug(2, `[KeywordHandlers] Processing ${keyword.keyword} for ${cardName}`);
  
  switch (keyword.keyword) {
    // ========== ATTACK TRIGGERS ==========
    
    case 'prowess':
      return handleProwess(ctx, keyword);
      
    case 'dethrone':
      return handleDethrone(ctx, keyword);
      
    case 'evolve':
      return handleEvolve(ctx, keyword);
      
    case 'melee':
      return handleMelee(ctx, keyword);
      
    case 'myriad':
      return handleMyriad(ctx, keyword);
      
    case 'exalted':
      return handleExalted(ctx, keyword);
      
    case 'battle_cry':
      return handleBattleCry(ctx, keyword);
      
    case 'mentor':
      return handleMentor(ctx, keyword);
      
    case 'training':
      return handleTraining(ctx, keyword);
      
    case 'annihilator':
      return handleAnnihilator(ctx, keyword);

    case 'afflict':
      return handleAfflict(ctx, keyword);
      
    case 'flanking':
      return handleFlanking(ctx, keyword);
      
    case 'bushido':
      return handleBushido(ctx, keyword);

    case 'rampage':
      return handleRampage(ctx, keyword);
      
    case 'enlist':
      return handleEnlist(ctx, keyword);
      
    // ========== SPELL CAST TRIGGERS ==========
    
    case 'extort':
      return handleExtort(ctx, keyword);
      
    case 'cascade':
      return handleCascade(ctx, keyword);
      
    case 'storm':
      return handleStorm(ctx, keyword);
      
    // ========== ETB TRIGGERS ==========
    
    case 'bloodthirst':
      return handleBloodthirst(ctx, keyword);
      
    case 'sunburst':
      return handleSunburst(ctx, keyword);
      
    case 'riot':
      return handleRiot(ctx, keyword);
      
    case 'unleash':
      return handleUnleash(ctx, keyword);
      
    case 'fabricate':
      return handleFabricate(ctx, keyword);
      
    case 'exploit':
      return handleExploit(ctx, keyword);
      
    case 'backup':
      return handleBackup(ctx, keyword);
      
    case 'tribute':
      return handleTribute(ctx, keyword);
      
    case 'graft':
      return handleGraft(ctx, keyword);
      
    case 'modular':
      return handleModular(ctx, keyword);
      
    // ========== DEATH TRIGGERS ==========
    
    case 'undying':
      return handleUndying(ctx, keyword);
      
    case 'persist':
      return handlePersist(ctx, keyword);
      
    case 'afterlife':
      return handleAfterlife(ctx, keyword);
      
    case 'soulshift':
      return handleSoulshift(ctx, keyword);

    case 'haunt':
      return handleHaunt(ctx, keyword);
      
    // ========== COMBAT DAMAGE TRIGGERS ==========
    
    case 'poisonous':
    case 'toxic':
      return handlePoisonous(ctx, keyword);
      
    case 'renown':
      return handleRenown(ctx, keyword);
      
    // ========== KEYWORD ACTIONS ==========
    
    case 'connive':
      return handleConnive(ctx, keyword);
      
    case 'bolster':
      return handleBolster(ctx, keyword);
      
    case 'support':
      return handleSupport(ctx, keyword);
      
    case 'amass':
      return handleAmass(ctx, keyword);
      
    case 'incubate':
      return handleIncubate(ctx, keyword);
      
    case 'populate':
      return handlePopulate(ctx, keyword);
      
    case 'monstrosity':
      return handleMonstrosity(ctx, keyword);
      
    case 'adapt':
      return handleAdapt(ctx, keyword);
      
    case 'exert':
      return handleExert(ctx, keyword);
      
    case 'explore':
      return handleExplore(ctx, keyword);
      
    case 'discover':
      return handleDiscover(ctx, keyword);
      
    case 'manifest':
      return handleManifest(ctx, keyword);
      
    case 'cloak':
      return handleCloak(ctx, keyword);
      
    case 'goad':
      return handleGoad(ctx, keyword);
      
    default:
      debug(2, `[KeywordHandlers] No specific handler for ${keyword.keyword}, using generic`);
      return {
        keyword: keyword.keyword,
        processed: true,
        effect: keyword.effect,
        chatMessage: `${cardName}'s ${keyword.keyword} triggers: ${keyword.effect}`,
      };
  }
}

// ============================================================================
// Keyword-Specific Handlers
// ============================================================================

/**
 * Extort - Pay {W/B} to drain opponents for 1 life
 */
function handleExtort(ctx: KeywordTriggerContext, keyword: DetectedKeyword): KeywordTriggerResult {
  const cardName = ctx.permanent?.card?.name || 'Permanent';
  const opponents = ctx.players?.filter((p: any) => p.id !== ctx.controller) || [];
  
  return {
    keyword: 'extort',
    processed: true,
    requiresPlayerChoice: {
      type: 'mana_payment',
      options: [{ cost: '{W/B}', effect: `Each opponent loses 1 life, you gain ${opponents.length} life` }],
      playerId: ctx.controller,
      permanentId: ctx.permanent?.id,
    },
    chatMessage: `${cardName}'s Extort triggers - you may pay {W/B}`,
  };
}

/**
 * Cascade - Exile cards until you hit a cheaper nonland card
 */
function handleCascade(ctx: KeywordTriggerContext, keyword: DetectedKeyword): KeywordTriggerResult {
  const cardName = ctx.spellCast?.card?.name || 'Spell';
  
  return {
    keyword: 'cascade',
    processed: true,
    effect: 'Exile cards from library until nonland with lesser mana value',
    chatMessage: `${cardName}'s Cascade triggers`,
  };
}

/**
 * Storm - Copy spell for each spell cast before it this turn
 */
function handleStorm(ctx: KeywordTriggerContext, keyword: DetectedKeyword): KeywordTriggerResult {
  const cardName = ctx.spellCast?.card?.name || 'Spell';
  const stormCount = (ctx.state?.stormCount ?? 0);
  
  return {
    keyword: 'storm',
    processed: true,
    effect: `Copy this spell ${stormCount} time${stormCount !== 1 ? 's' : ''}`,
    chatMessage: `${cardName}'s Storm triggers - ${stormCount} copies`,
  };
}

/**
 * Bloodthirst N - Enter with counters if opponent was dealt damage
 * 
 * Note: This handler expects ctx.state.opponentsDealtDamageThisTurn to be a boolean
 * that is set to true when any opponent takes damage during the turn. This flag
 * should be managed by the damage handling code in the combat/spell resolution system
 * and reset at end of turn in the cleanup step.
 */
function handleBloodthirst(ctx: KeywordTriggerContext, keyword: DetectedKeyword): KeywordTriggerResult {
  const cardName = ctx.permanent?.card?.name || 'Creature';
  const n = keyword.value || 1;
  
  // Check if any opponent was dealt damage this turn
  // This flag should be set by damage handlers when opponents take damage
  const opponentsDealtDamage = ctx.state?.opponentsDealtDamageThisTurn ?? false;
  
  if (opponentsDealtDamage) {
    return {
      keyword: 'bloodthirst',
      processed: true,
      countersAdded: { type: '+1/+1', count: n },
      chatMessage: `${cardName} enters with ${n} +1/+1 counter${n > 1 ? 's' : ''} (Bloodthirst - opponent was dealt damage)`,
    };
  }
  
  return {
    keyword: 'bloodthirst',
    processed: true,
    chatMessage: `${cardName}'s Bloodthirst ${n} - no opponent was dealt damage this turn`,
  };
}

/**
 * Sunburst - Counter for each color of mana spent
 * 
 * Note: This handler expects ctx.state.manaColorsUsedToCast to be a number (0-5)
 * representing how many different colors of mana were spent to cast this spell.
 * This should be tracked by the mana payment system when spells are cast.
 */
function handleSunburst(ctx: KeywordTriggerContext, keyword: DetectedKeyword): KeywordTriggerResult {
  const cardName = ctx.permanent?.card?.name || 'Permanent';
  const colorsUsed = ctx.state?.manaColorsUsedToCast ?? 0;
  const typeLine = (ctx.permanent?.card?.type_line || '').toLowerCase();
  const counterType = typeLine.includes('creature') ? '+1/+1' : 'charge';
  
  return {
    keyword: 'sunburst',
    processed: true,
    countersAdded: { type: counterType, count: colorsUsed },
    chatMessage: `${cardName} enters with ${colorsUsed} ${counterType} counter${colorsUsed !== 1 ? 's' : ''} (Sunburst)`,
  };
}

/**
 * Riot - Choose +1/+1 counter or haste
 */
function handleRiot(ctx: KeywordTriggerContext, keyword: DetectedKeyword): KeywordTriggerResult {
  const cardName = ctx.permanent?.card?.name || 'Creature';
  
  return {
    keyword: 'riot',
    processed: true,
    requiresPlayerChoice: {
      type: 'riot_choice',
      options: [
        { id: 'counter', name: '+1/+1 counter' },
        { id: 'haste', name: 'Haste' },
      ],
      playerId: ctx.controller,
      permanentId: ctx.permanent?.id,
    },
    chatMessage: `${cardName}'s Riot - choose +1/+1 counter or haste`,
  };
}

/**
 * Unleash - May enter with +1/+1 counter (can't block if it has one)
 */
function handleUnleash(ctx: KeywordTriggerContext, keyword: DetectedKeyword): KeywordTriggerResult {
  const cardName = ctx.permanent?.card?.name || 'Creature';
  
  return {
    keyword: 'unleash',
    processed: true,
    requiresPlayerChoice: {
      type: 'unleash_choice',
      options: [
        { id: 'counter', name: '+1/+1 counter (can\'t block)' },
        { id: 'none', name: 'No counter (can block)' },
      ],
      playerId: ctx.controller,
      permanentId: ctx.permanent?.id,
    },
    chatMessage: `${cardName}'s Unleash - you may have it enter with a +1/+1 counter`,
  };
}

/**
 * Fabricate N - Choose counters or tokens
 */
function handleFabricate(ctx: KeywordTriggerContext, keyword: DetectedKeyword): KeywordTriggerResult {
  const cardName = ctx.permanent?.card?.name || 'Creature';
  const n = keyword.value || 1;
  
  return {
    keyword: 'fabricate',
    processed: true,
    requiresPlayerChoice: {
      type: 'fabricate_choice',
      options: [
        { id: 'counters', name: `${n} +1/+1 counter${n > 1 ? 's' : ''}` },
        { id: 'tokens', name: `${n} 1/1 Servo token${n > 1 ? 's' : ''}` },
      ],
      playerId: ctx.controller,
      permanentId: ctx.permanent?.id,
      value: n,
    },
    chatMessage: `${cardName}'s Fabricate ${n} - choose counters or tokens`,
  };
}

/**
 * Exploit - May sacrifice a creature
 */
function handleExploit(ctx: KeywordTriggerContext, keyword: DetectedKeyword): KeywordTriggerResult {
  const cardName = ctx.permanent?.card?.name || 'Creature';
  
  return {
    keyword: 'exploit',
    processed: true,
    requiresPlayerChoice: {
      type: 'sacrifice_creature',
      options: [], // Populated by socket handler
      playerId: ctx.controller,
      permanentId: ctx.permanent?.id,
    },
    chatMessage: `${cardName}'s Exploit triggers - you may sacrifice a creature`,
  };
}

/**
 * Backup N - Put counters on target creature
 */
function handleBackup(ctx: KeywordTriggerContext, keyword: DetectedKeyword): KeywordTriggerResult {
  const cardName = ctx.permanent?.card?.name || 'Creature';
  const n = keyword.value || 1;
  
  return {
    keyword: 'backup',
    processed: true,
    requiresPlayerChoice: {
      type: 'target_creature',
      options: [], // Populated by socket handler
      playerId: ctx.controller,
      permanentId: ctx.permanent?.id,
    },
    chatMessage: `${cardName}'s Backup ${n} triggers - put ${n} +1/+1 counter${n > 1 ? 's' : ''} on target creature`,
  };
}

/**
 * Tribute N - Opponent may put counters on it
 */
function handleTribute(ctx: KeywordTriggerContext, keyword: DetectedKeyword): KeywordTriggerResult {
  const cardName = ctx.permanent?.card?.name || 'Creature';
  const n = keyword.value || 1;
  const controllerId = String(ctx.controller || '').trim();
  const listedPlayers = Array.isArray(ctx.players) ? ctx.players : [];
  const statePlayers = Array.isArray(ctx.state?.players) ? ctx.state.players : [];
  const opponents = [...listedPlayers, ...statePlayers].filter((player: any) => {
    const id = String(player?.id || player?.playerId || '').trim();
    return Boolean(id) && id !== controllerId && !playerCannotReceivePriority(player, { state: ctx.state });
  });
  const opponent = opponents[0]
    || Object.keys(ctx.state?.life || {}).filter((id) => id && id !== controllerId).map((id) => ({ id, name: id }))[0]
    || Object.keys(ctx.state?.zones || {}).filter((id) => id && id !== controllerId).map((id) => ({ id, name: id }))[0];

  if (!opponent) {
    return { keyword: 'tribute', processed: true };
  }

  const opponentId = String(opponent.id || opponent.playerId || '').trim();
  if (!opponentId) {
    return { keyword: 'tribute', processed: true };
  }
  
  return {
    keyword: 'tribute',
    processed: true,
    requiresPlayerChoice: {
      type: 'tribute_choice',
      options: [
        { id: 'pay', name: `Put ${n} +1/+1 counter${n > 1 ? 's' : ''} on it` },
        { id: 'decline', name: 'Decline (trigger bonus effect)' },
      ],
      playerId: opponentId,
      permanentId: ctx.permanent?.id,
      value: n,
    },
    chatMessage: `${cardName}'s Tribute ${n} - ${opponent.name || opponentId} may put counters on it`,
  };
}

/**
 * Graft N - Enter with counters, may move to other creatures
 */
function handleGraft(ctx: KeywordTriggerContext, keyword: DetectedKeyword): KeywordTriggerResult {
  const cardName = ctx.permanent?.card?.name || 'Creature';
  const n = keyword.value || 1;
  
  return {
    keyword: 'graft',
    processed: true,
    countersAdded: { type: '+1/+1', count: n },
    chatMessage: `${cardName} enters with ${n} +1/+1 counter${n > 1 ? 's' : ''} (Graft)`,
  };
}

/**
 * Modular N - Enter with counters, move on death
 */
function handleModular(ctx: KeywordTriggerContext, keyword: DetectedKeyword): KeywordTriggerResult {
  const cardName = ctx.permanent?.card?.name || 'Creature';
  const n = keyword.value || 1;
  
  // If ETB timing, add counters
  // If death timing, allow moving counters
  const isDeath = ctx.dyingCreature?.id === ctx.permanent?.id;
  
  if (isDeath) {
    const counters = ctx.permanent?.counters?.['+1/+1'] || n;
    const validTargets = (ctx.battlefield || []).filter((permanent: any) => {
      if (!permanent) return false;
      if (String(permanent?.id || '') === String(ctx.permanent?.id || '')) return false;
      const typeLine = String(permanent?.card?.type_line || '').toLowerCase();
      return typeLine.includes('artifact') && typeLine.includes('creature');
    });

    if (validTargets.length === 0) {
      return {
        keyword: 'modular',
        processed: true,
        chatMessage: `${cardName}'s Modular triggers but there are no valid artifact creature targets`,
      };
    }

    return {
      keyword: 'modular',
      processed: true,
      requiresPlayerChoice: {
        type: 'target_artifact_creature',
        options: validTargets.map((target: any) => ({
          id: target.id,
          name: target.card?.name || 'Artifact Creature',
          power: target.power ?? target.card?.power,
          toughness: target.toughness ?? target.card?.toughness,
        })),
        playerId: ctx.controller,
        permanentId: ctx.permanent?.id,
        value: counters,
      },
      chatMessage: `${cardName}'s Modular triggers - you may put ${counters} +1/+1 counters on target artifact creature`,
    };
  }
  
  return {
    keyword: 'modular',
    processed: true,
    countersAdded: { type: '+1/+1', count: n },
    chatMessage: `${cardName} enters with ${n} +1/+1 counter${n > 1 ? 's' : ''} (Modular)`,
  };
}

/**
 * Undying - Return with +1/+1 counter if no +1/+1 counters
 */
function handleUndying(ctx: KeywordTriggerContext, keyword: DetectedKeyword): KeywordTriggerResult {
  const cardName = ctx.permanent?.card?.name || 'Creature';
  const hasP1P1Counter = (ctx.permanent?.counters?.['+1/+1'] || 0) > 0;
  
  if (!hasP1P1Counter) {
    return {
      keyword: 'undying',
      processed: true,
      effect: 'Return to battlefield with +1/+1 counter',
      chatMessage: `${cardName}'s Undying triggers - returns with a +1/+1 counter`,
    };
  }
  
  return {
    keyword: 'undying',
    processed: true,
    chatMessage: `${cardName}'s Undying doesn't trigger (had +1/+1 counter)`,
  };
}

/**
 * Persist - Return with -1/-1 counter if no -1/-1 counters
 */
function handlePersist(ctx: KeywordTriggerContext, keyword: DetectedKeyword): KeywordTriggerResult {
  const cardName = ctx.permanent?.card?.name || 'Creature';
  const hasM1M1Counter = (ctx.permanent?.counters?.['-1/-1'] || 0) > 0;
  
  if (!hasM1M1Counter) {
    return {
      keyword: 'persist',
      processed: true,
      effect: 'Return to battlefield with -1/-1 counter',
      chatMessage: `${cardName}'s Persist triggers - returns with a -1/-1 counter`,
    };
  }
  
  return {
    keyword: 'persist',
    processed: true,
    chatMessage: `${cardName}'s Persist doesn't trigger (had -1/-1 counter)`,
  };
}

/**
 * Afterlife N - Create spirit tokens
 */
function handleAfterlife(ctx: KeywordTriggerContext, keyword: DetectedKeyword): KeywordTriggerResult {
  const cardName = ctx.permanent?.card?.name || 'Creature';
  const n = keyword.value || 1;
  
  return {
    keyword: 'afterlife',
    processed: true,
    tokensCreated: { count: n, type: 'Spirit' },
    chatMessage: `${cardName}'s Afterlife ${n} triggers - create ${n} 1/1 Spirit token${n > 1 ? 's' : ''} with flying`,
  };
}

/**
 * Soulshift N - Return Spirit with CMC N or less
 */
function handleSoulshift(ctx: KeywordTriggerContext, keyword: DetectedKeyword): KeywordTriggerResult {
  const cardName = ctx.permanent?.card?.name || 'Creature';
  const n = keyword.value || 1;
  const zones = (ctx.state as any)?.zones || {};
  const controllerZones = zones?.[ctx.controller] || {};
  const graveyard = Array.isArray(controllerZones?.graveyard) ? controllerZones.graveyard : [];
  const validTargets = graveyard.filter((card: any) => {
    const typeLine = String(card?.type_line || '').toLowerCase();
    const manaValue = Number(card?.cmc ?? 0);
    return typeLine.includes('spirit') && manaValue <= n;
  });

  if (validTargets.length === 0) {
    return {
      keyword: 'soulshift',
      processed: true,
      chatMessage: `${cardName}'s Soulshift ${n} triggers but there are no Spirit cards with mana value ${n} or less in your graveyard`,
    };
  }
  
  return {
    keyword: 'soulshift',
    processed: true,
    requiresPlayerChoice: {
      type: 'target_spirit',
      options: validTargets.map((card: any) => ({
        id: String(card?.id || ''),
        name: String(card?.name || 'Spirit Card'),
        typeLine: card?.type_line,
        manaCost: card?.mana_cost,
        imageUrl: card?.image_uris?.small || card?.image_uris?.normal || card?.imageUrl,
        cmc: Number(card?.cmc ?? 0),
      })),
      playerId: ctx.controller,
      permanentId: ctx.permanent?.id,
      value: n,
    },
    chatMessage: `${cardName}'s Soulshift ${n} triggers - return target Spirit card with mana value ${n} or less from graveyard`,
  };
}

/**
 * Haunt - Exile this card haunting target creature.
 */
function handleHaunt(ctx: KeywordTriggerContext, _keyword: DetectedKeyword): KeywordTriggerResult {
  const cardName = ctx.permanent?.card?.name || 'Creature';
  const sourcePermanentId = String(ctx.permanent?.id || ctx.dyingCreature?.id || '').trim();
  const hauntCardId = String(
    ctx.permanent?.card?.id
    || ctx.dyingCreature?.card?.id
    || ctx.permanent?.id
    || ctx.dyingCreature?.id
    || '',
  ).trim();
  const legalTargets = listLegalHauntCreatureTargets(ctx.state, {
    excludePermanentId: sourcePermanentId,
  });

  if (legalTargets.length === 0) {
    return {
      keyword: 'haunt',
      processed: true,
      chatMessage: `${cardName}'s Haunt triggers but there are no legal creature targets`,
    };
  }

  return {
    keyword: 'haunt',
    processed: true,
    requiresPlayerChoice: {
      type: 'target_creature',
      options: legalTargets,
      playerId: ctx.controller,
      permanentId: sourcePermanentId,
      hauntCardId,
      ownerId: String(ctx.permanent?.owner || ctx.dyingCreature?.owner || ctx.controller || ''),
    },
    chatMessage: `${cardName}'s Haunt triggers - exile it haunting target creature`,
  };
}

/**
 * Poisonous/Toxic N - Give poison counters on combat damage
 */
function handlePoisonous(ctx: KeywordTriggerContext, keyword: DetectedKeyword): KeywordTriggerResult {
  const cardName = ctx.permanent?.card?.name || 'Creature';
  const n = keyword.value || 1;
  const damagedPlayer = ctx.defendingPlayer;
  
  if (!damagedPlayer) {
    return { keyword: keyword.keyword, processed: false };
  }
  
  return {
    keyword: keyword.keyword,
    processed: true,
    effect: `${damagedPlayer} gets ${n} poison counter${n > 1 ? 's' : ''}`,
    chatMessage: `${cardName}'s ${keyword.keyword} ${n} triggers - player gets ${n} poison counter${n > 1 ? 's' : ''}`,
  };
}

/**
 * Renown N - Put counters if not renowned
 */
function handleRenown(ctx: KeywordTriggerContext, keyword: DetectedKeyword): KeywordTriggerResult {
  const cardName = ctx.permanent?.card?.name || 'Creature';
  const n = keyword.value || 1;
  const isRenowned = ctx.permanent?.renowned === true;
  
  if (!isRenowned) {
    return {
      keyword: 'renown',
      processed: true,
      countersAdded: { type: '+1/+1', count: n },
      effect: 'Becomes renowned',
      chatMessage: `${cardName} becomes renowned! Put ${n} +1/+1 counter${n > 1 ? 's' : ''} on it`,
    };
  }
  
  return {
    keyword: 'renown',
    processed: true,
    chatMessage: `${cardName} is already renowned`,
  };
}

// ============================================================================
// Keyword Action Handlers
// ============================================================================

/**
 * Connive - Draw then discard, +1/+1 if nonland
 */
function handleConnive(ctx: KeywordTriggerContext, keyword: DetectedKeyword): KeywordTriggerResult {
  const cardName = ctx.permanent?.card?.name || 'Creature';
  const n = keyword.value || 1;
  
  return {
    keyword: 'connive',
    processed: true,
    requiresPlayerChoice: {
      type: 'connive',
      options: [], // Hand cards populated by socket handler
      playerId: ctx.controller,
      permanentId: ctx.permanent?.id,
    },
    chatMessage: `${cardName} connives ${n > 1 ? n : ''} - draw ${n} card${n > 1 ? 's' : ''}, then discard ${n}`,
  };
}

/**
 * Bolster N - Put counters on creature with least toughness
 * Note: Toughness calculation considers base + counters + temporary bonuses
 */
function handleBolster(ctx: KeywordTriggerContext, keyword: DetectedKeyword): KeywordTriggerResult {
  const cardName = ctx.permanent?.card?.name || 'Permanent';
  const n = keyword.value || 1;
  
  // Find creatures you control with least toughness
  const myCreatures = ctx.battlefield?.filter((p: any) => {
    if (p.controller !== ctx.controller) return false;
    const typeLine = (p.card?.type_line || '').toLowerCase();
    return typeLine.includes('creature');
  }) || [];
  
  if (myCreatures.length === 0) {
    return {
      keyword: 'bolster',
      processed: true,
      chatMessage: `${cardName}'s Bolster ${n} - no creatures to bolster`,
    };
  }
  
  // Helper to calculate current toughness including counters and temporary bonuses
  const getCurrentToughness = (creature: any): number => {
    // Start with base toughness
    let baseToughness = parseInt(creature.baseToughness ?? creature.card?.toughness ?? '0', 10);
    
    // Add counters
    const counters = creature.counters || {};
    baseToughness += (counters['+1/+1'] || 0);
    baseToughness -= (counters['-1/-1'] || 0);
    
    // Add temporary bonuses
    baseToughness += (creature.tempToughnessBonus || 0);
    
    return baseToughness;
  };
  
  // Find minimum toughness
  let minToughness = Infinity;
  for (const creature of myCreatures) {
    const toughness = getCurrentToughness(creature);
    if (toughness < minToughness) {
      minToughness = toughness;
    }
  }
  
  // Filter to only creatures with minimum toughness
  const validTargets = myCreatures.filter((c: any) => {
    const toughness = getCurrentToughness(c);
    return toughness === minToughness;
  });
  
  if (validTargets.length === 1) {
    // Auto-select the only valid target
    return {
      keyword: 'bolster',
      processed: true,
      countersAdded: { type: '+1/+1', count: n },
      chatMessage: `${cardName}'s Bolster ${n} - put ${n} +1/+1 counter${n > 1 ? 's' : ''} on ${validTargets[0].card?.name || 'creature'}`,
    };
  }
  
  return {
    keyword: 'bolster',
    processed: true,
    requiresPlayerChoice: {
      type: 'bolster_target',
      options: validTargets.map((t: any) => ({
        id: t.id,
        name: t.card?.name || 'Creature',
        toughness: getCurrentToughness(t),
      })),
      playerId: ctx.controller,
      permanentId: ctx.permanent?.id,
    },
    chatMessage: `${cardName}'s Bolster ${n} - choose creature with least toughness`,
  };
}

/**
 * Support N - Put +1/+1 counter on up to N creatures
 */
function handleSupport(ctx: KeywordTriggerContext, keyword: DetectedKeyword): KeywordTriggerResult {
  const cardName = ctx.permanent?.card?.name || 'Permanent';
  const n = keyword.value || 1;
  
  return {
    keyword: 'support',
    processed: true,
    requiresPlayerChoice: {
      type: 'support_targets',
      options: [], // Populated by socket handler
      playerId: ctx.controller,
      permanentId: ctx.permanent?.id,
    },
    chatMessage: `${cardName}'s Support ${n} - choose up to ${n} target creature${n > 1 ? 's' : ''} to put +1/+1 counters on`,
  };
}

/**
 * Amass - Create or grow an Army token
 */
function handleAmass(ctx: KeywordTriggerContext, keyword: DetectedKeyword): KeywordTriggerResult {
  const cardName = ctx.permanent?.card?.name || 'Permanent';
  const n = keyword.value || 1;
  
  // Check if controller has an Army
  const armies = ctx.battlefield?.filter((p: any) => {
    if (p.controller !== ctx.controller) return false;
    const typeLine = (p.card?.type_line || '').toLowerCase();
    return typeLine.includes('army');
  }) || [];
  
  if (armies.length > 0) {
    // Put counters on existing Army
    return {
      keyword: 'amass',
      processed: true,
      countersAdded: { type: '+1/+1', count: n },
      chatMessage: `${cardName}'s Amass ${n} - put ${n} +1/+1 counter${n > 1 ? 's' : ''} on your Army`,
    };
  }
  
  // Create Army token
  return {
    keyword: 'amass',
    processed: true,
    tokensCreated: { count: 1, type: 'Zombie Army' },
    countersAdded: { type: '+1/+1', count: n },
    chatMessage: `${cardName}'s Amass ${n} - create a 0/0 Zombie Army token with ${n} +1/+1 counter${n > 1 ? 's' : ''}`,
  };
}

/**
 * Incubate N - Create Incubator token
 */
function handleIncubate(ctx: KeywordTriggerContext, keyword: DetectedKeyword): KeywordTriggerResult {
  const cardName = ctx.permanent?.card?.name || 'Permanent';
  const n = keyword.value || 1;
  
  return {
    keyword: 'incubate',
    processed: true,
    tokensCreated: { count: 1, type: 'Incubator' },
    countersAdded: { type: '+1/+1', count: n },
    chatMessage: `${cardName}'s Incubate ${n} - create an Incubator token with ${n} +1/+1 counter${n > 1 ? 's' : ''}`,
  };
}

/**
 * Populate - Copy a creature token
 */
function handlePopulate(ctx: KeywordTriggerContext, keyword: DetectedKeyword): KeywordTriggerResult {
  const cardName = ctx.permanent?.card?.name || 'Permanent';
  
  // Find creature tokens you control
  const tokens = ctx.battlefield?.filter((p: any) => {
    if (p.controller !== ctx.controller) return false;
    if (!p.isToken) return false;
    const typeLine = (p.card?.type_line || '').toLowerCase();
    return typeLine.includes('creature');
  }) || [];
  
  if (tokens.length === 0) {
    return {
      keyword: 'populate',
      processed: true,
      chatMessage: `${cardName}'s Populate - no creature tokens to copy`,
    };
  }
  
  return {
    keyword: 'populate',
    processed: true,
    requiresPlayerChoice: {
      type: 'populate_target',
      options: tokens.map((t: any) => ({
        id: t.id,
        name: t.card?.name || 'Token',
        power: t.power ?? t.card?.power,
        toughness: t.toughness ?? t.card?.toughness,
      })),
      playerId: ctx.controller,
      permanentId: ctx.permanent?.id,
    },
    chatMessage: `${cardName}'s Populate - choose a creature token to copy`,
  };
}

/**
 * Monstrosity N - Put counters and become monstrous
 */
function handleMonstrosity(ctx: KeywordTriggerContext, keyword: DetectedKeyword): KeywordTriggerResult {
  const cardName = ctx.permanent?.card?.name || 'Creature';
  const n = keyword.value || 1;
  const isMonstrous = ctx.permanent?.monstrous === true;
  
  if (isMonstrous) {
    return {
      keyword: 'monstrosity',
      processed: true,
      chatMessage: `${cardName} is already monstrous`,
    };
  }
  
  return {
    keyword: 'monstrosity',
    processed: true,
    countersAdded: { type: '+1/+1', count: n },
    effect: 'becomes monstrous',
    chatMessage: `${cardName} becomes monstrous! Put ${n} +1/+1 counter${n > 1 ? 's' : ''} on it`,
  };
}

/**
 * Adapt N - Put counters if has none
 */
function handleAdapt(ctx: KeywordTriggerContext, keyword: DetectedKeyword): KeywordTriggerResult {
  const cardName = ctx.permanent?.card?.name || 'Creature';
  const n = keyword.value || 1;
  const hasCounters = (ctx.permanent?.counters?.['+1/+1'] || 0) > 0;
  
  if (hasCounters) {
    return {
      keyword: 'adapt',
      processed: true,
      chatMessage: `${cardName} already has +1/+1 counters`,
    };
  }
  
  return {
    keyword: 'adapt',
    processed: true,
    countersAdded: { type: '+1/+1', count: n },
    chatMessage: `${cardName} adapts! Put ${n} +1/+1 counter${n > 1 ? 's' : ''} on it`,
  };
}

/**
 * Exert - Choose to exert for bonus
 */
function handleExert(ctx: KeywordTriggerContext, keyword: DetectedKeyword): KeywordTriggerResult {
  const cardName = ctx.permanent?.card?.name || 'Creature';
  
  return {
    keyword: 'exert',
    processed: true,
    requiresPlayerChoice: {
      type: 'exert_choice',
      options: [
        { id: 'exert', name: 'Exert (won\'t untap next turn)' },
        { id: 'normal', name: 'Attack normally' },
      ],
      playerId: ctx.controller,
      permanentId: ctx.permanent?.id,
    },
    chatMessage: `${cardName} attacks - you may exert it`,
  };
}

/**
 * Explore - Reveal top card, land to hand or counter and graveyard choice
 */
function handleExplore(ctx: KeywordTriggerContext, keyword: DetectedKeyword): KeywordTriggerResult {
  const cardName = ctx.permanent?.card?.name || 'Creature';
  
  return {
    keyword: 'explore',
    processed: true,
    requiresPlayerChoice: {
      type: 'explore',
      options: [], // Top card info populated by socket handler
      playerId: ctx.controller,
      permanentId: ctx.permanent?.id,
    },
    chatMessage: `${cardName} explores!`,
  };
}

/**
 * Discover N - Cascade-like effect with choice
 */
function handleDiscover(ctx: KeywordTriggerContext, keyword: DetectedKeyword): KeywordTriggerResult {
  const cardName = ctx.permanent?.card?.name || ctx.spellCast?.card?.name || 'Spell';
  const n = keyword.value || 0;
  
  return {
    keyword: 'discover',
    processed: true,
    requiresPlayerChoice: {
      type: 'discover',
      options: [],
      playerId: ctx.controller,
      permanentId: ctx.permanent?.id,
    },
    chatMessage: `${cardName}'s Discover ${n} triggers - reveal until nonland with MV ≤ ${n}`,
  };
}

/**
 * Manifest - Put top card face down as 2/2
 */
function handleManifest(ctx: KeywordTriggerContext, keyword: DetectedKeyword): KeywordTriggerResult {
  const cardName = ctx.permanent?.card?.name || 'Effect';
  
  return {
    keyword: 'manifest',
    processed: true,
    effect: 'manifest top card',
    chatMessage: `${cardName} manifests the top card of your library as a 2/2 creature`,
  };
}

/**
 * Cloak - Put card face down as 2/2 with ward {2}
 */
function handleCloak(ctx: KeywordTriggerContext, keyword: DetectedKeyword): KeywordTriggerResult {
  const cardName = ctx.permanent?.card?.name || 'Effect';
  
  return {
    keyword: 'cloak',
    processed: true,
    effect: 'cloak card',
    chatMessage: `${cardName} cloaks a card as a 2/2 creature with ward {2}`,
  };
}

/**
 * Goad - Force creature to attack
 */
function handleGoad(ctx: KeywordTriggerContext, keyword: DetectedKeyword): KeywordTriggerResult {
  const cardName = ctx.permanent?.card?.name || 'Effect';
  
  return {
    keyword: 'goad',
    processed: true,
    requiresPlayerChoice: {
      type: 'goad_target',
      options: [], // Populated by socket handler
      playerId: ctx.controller,
      permanentId: ctx.permanent?.id,
    },
    chatMessage: `${cardName} goads a creature`,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Apply counter modifications from keyword trigger result
 */
export function applyKeywordCounters(
  permanent: any,
  result: KeywordTriggerResult
): void {
  if (!result.countersAdded || !permanent) return;
  
  permanent.counters = permanent.counters || {};
  const counterType = result.countersAdded.type;
  permanent.counters[counterType] = (permanent.counters[counterType] || 0) + result.countersAdded.count;
  
  debug(2, `[KeywordHandlers] Added ${result.countersAdded.count} ${counterType} counters to ${permanent.card?.name}`);
}

/**
 * Apply P/T modifications from keyword trigger result
 */
export function applyKeywordPTMod(
  permanent: any,
  result: KeywordTriggerResult
): void {
  if (!result.ptModification || !permanent) return;
  
  permanent.tempPowerBonus = (permanent.tempPowerBonus || 0) + result.ptModification.power;
  permanent.tempToughnessBonus = (permanent.tempToughnessBonus || 0) + result.ptModification.toughness;
  permanent.temporaryPowerBoost = (permanent.temporaryPowerBoost || 0) + result.ptModification.power;
  permanent.temporaryToughnessBoost = (permanent.temporaryToughnessBoost || 0) + result.ptModification.toughness;
  
  if (result.ptModification.duration === 'end_of_turn') {
    permanent.tempBonusExpires = 'end_of_turn';
  } else if (result.ptModification.duration === 'end_of_combat') {
    permanent.tempBonusExpires = 'end_of_combat';
    recordEndOfCombatKeywordPtBonus(permanent, result.ptModification.power, result.ptModification.toughness);
  }

  delete permanent.effectivePower;
  delete permanent.effectiveToughness;
  
  debug(2, `[KeywordHandlers] Applied +${result.ptModification.power}/+${result.ptModification.toughness} to ${permanent.card?.name}`);
}

// Export for use in other modules
export default {
  processKeywordTriggers,
  applyKeywordCounters,
  applyKeywordPTMod,
  permanentHasKeyword,
  getPermanentKeywords,
};
