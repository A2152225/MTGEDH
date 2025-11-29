import type { PlayerID } from "../../../../shared/src/index.js";
import type { GameContext } from "../context.js";
import { uid, parsePT } from "../utils.js";
import { recalculatePlayerEffects } from "./game-state-effects.js";
import { categorizeSpell, resolveSpell, type EngineEffect, type TargetRef } from "../../rules-engine/targeting.js";
import { getETBTriggersForPermanent, type TriggeredAbility } from "./triggered-abilities.js";
import { addExtraTurn } from "./turn.js";

/**
 * Stack / resolution helpers (extracted).
 *
 * Exports:
 * - pushStack
 * - resolveTopOfStack
 * - playLand
 * - castSpell
 * - exileEntireStack
 *
 * exileEntireStack moves all items from the stack into controller exile zones
 * (ctx.state.zones[controller].exile). It returns the number of items exiled and bumps seq.
 * It is conservative and defensive about shapes so it won't throw on unexpected input.
 */

/**
 * Check if a spell is a tutor (search library effect) and return search details.
 * This handles cards like Demonic Tutor, Vampiric Tutor, Diabolic Tutor, etc.
 */
function detectTutorSpell(oracleText: string): { 
  isTutor: boolean; 
  searchCriteria?: string; 
  destination?: 'hand' | 'top' | 'battlefield' | 'graveyard' | 'split';
  optional?: boolean;
  maxSelections?: number;
  /** For split-destination effects like Kodama's Reach/Cultivate */
  splitDestination?: boolean;
  /** Number of cards to put on battlefield for split effects */
  toBattlefield?: number;
  /** Number of cards to put in hand for split effects */
  toHand?: number;
  /** Whether cards enter battlefield tapped */
  entersTapped?: boolean;
} {
  if (!oracleText) return { isTutor: false };
  
  const text = oracleText.toLowerCase();
  
  // Must have "search your library" pattern
  if (!text.includes('search your library')) {
    return { isTutor: false };
  }
  
  let searchCriteria = '';
  let destination: 'hand' | 'top' | 'battlefield' | 'graveyard' | 'split' = 'hand';
  let optional = false;
  let maxSelections = 1;
  
  // Detect what type of card to search for and how many
  const forMatch = text.match(/search your library for (?:a|an|up to (\w+)) ([^,.]+)/i);
  if (forMatch) {
    // Check for "up to N" pattern
    if (forMatch[1]) {
      const num = forMatch[1].toLowerCase();
      if (num === 'two') maxSelections = 2;
      else if (num === 'three') maxSelections = 3;
      else if (num === 'four') maxSelections = 4;
      else {
        const parsed = parseInt(num, 10);
        if (!isNaN(parsed)) maxSelections = parsed;
      }
    }
    searchCriteria = forMatch[2].trim();
  }
  
  // Check for optional search (contains "may")
  if (text.includes('you may search')) {
    optional = true;
  }
  
  // SPECIAL CASE: Kodama's Reach / Cultivate pattern
  // "put one onto the battlefield tapped and the other into your hand"
  if (text.includes('put one onto the battlefield') && text.includes('the other into your hand')) {
    const entersTapped = text.includes('battlefield tapped');
    return {
      isTutor: true,
      searchCriteria,
      destination: 'split',
      optional,
      maxSelections: 2,
      splitDestination: true,
      toBattlefield: 1,
      toHand: 1,
      entersTapped,
    };
  }
  
  // Detect destination - order matters! More specific patterns first
  
  // Top of library patterns (Vampiric Tutor, Mystical Tutor, Worldly Tutor, Enlightened Tutor)
  if (text.includes('put it on top of your library') || 
      text.includes('put that card on top of your library') ||
      text.includes('put it on top') ||
      text.includes('put that card on top')) {
    destination = 'top';
  }
  // Battlefield patterns (Green Sun's Zenith, Chord of Calling, Natural Order)
  else if (text.includes('put it onto the battlefield') || 
           text.includes('put that card onto the battlefield') ||
           text.includes('put onto the battlefield') ||
           text.includes('enters the battlefield')) {
    destination = 'battlefield';
  }
  // Graveyard patterns (Entomb, Buried Alive)
  else if (text.includes('put it into your graveyard') || 
           text.includes('put that card into your graveyard') ||
           text.includes('put into your graveyard')) {
    destination = 'graveyard';
  }
  // Hand patterns (Demonic Tutor, Diabolic Tutor, Grim Tutor)
  // Default is hand
  
  return { isTutor: true, searchCriteria, destination, optional, maxSelections };
}

/**
 * Extract creature types from a type line
 */
function extractCreatureTypes(typeLine: string): string[] {
  const types: string[] = [];
  const lower = typeLine.toLowerCase();
  
  // Check for creature types after "—" or "-"
  const dashIndex = lower.indexOf("—") !== -1 ? lower.indexOf("—") : lower.indexOf("-");
  if (dashIndex !== -1) {
    const subtypes = lower.slice(dashIndex + 1).trim().split(/\s+/);
    types.push(...subtypes.filter(t => t.length > 0));
  }
  
  return types;
}

/**
 * Check if a creature entering the battlefield would have haste
 * from effects already on the battlefield.
 * 
 * This is used when determining if a creature should have summoning sickness.
 * Rule 702.10: Haste allows a creature to attack and use tap abilities immediately.
 */
function creatureWillHaveHaste(
  card: any,
  controller: string,
  battlefield: any[]
): boolean {
  try {
    const cardTypeLine = (card?.type_line || "").toLowerCase();
    const cardOracleText = (card?.oracle_text || "").toLowerCase();
    
    // 1. Check if the creature itself has haste
    if (cardOracleText.includes('haste')) {
      return true;
    }
    
    // 2. Check battlefield for permanents that grant haste
    for (const perm of battlefield) {
      if (!perm || !perm.card) continue;
      
      const grantorOracle = (perm.card.oracle_text || "").toLowerCase();
      const grantorController = perm.controller;
      
      // Check for "creatures you control have haste" effects
      if (grantorController === controller) {
        if (grantorOracle.includes('creatures you control have haste') ||
            grantorOracle.includes('other creatures you control have haste')) {
          return true;
        }
        
        // Check for "activate abilities... as though... had haste" effects
        // This covers Thousand-Year Elixir: "You may activate abilities of creatures 
        // you control as though those creatures had haste."
        if (grantorOracle.includes('as though') && 
            grantorOracle.includes('had haste') &&
            (grantorOracle.includes('creatures you control') || 
             grantorOracle.includes('activate abilities'))) {
          return true;
        }
        
        // Check for tribal haste grants (e.g., "Goblin creatures you control have haste")
        const creatureTypes = extractCreatureTypes(cardTypeLine);
        for (const creatureType of creatureTypes) {
          const pattern = new RegExp(`${creatureType}[^.]*have haste`, 'i');
          if (pattern.test(grantorOracle)) {
            return true;
          }
        }
      }
      
      // Check for effects that grant haste to all creatures
      if (grantorOracle.includes('all creatures have haste') ||
          grantorOracle.includes('each creature has haste')) {
        return true;
      }
    }
    
    return false;
  } catch (err) {
    console.warn('[creatureWillHaveHaste] Error checking haste:', err);
    return false;
  }
}

/* Push an item onto the stack */
export function pushStack(
  ctx: GameContext,
  item: {
    id: string;
    controller: PlayerID;
    card: any;
    targets?: string[];
  }
) {
  const { state } = ctx;
  state.stack = state.stack || [];
  state.stack.push(item as any);
  ctx.bumpSeq();
}

/* Pop and return the top stack item (internal helper) */
function popStackItem(ctx: GameContext) {
  const s = ctx.state;
  if (!s.stack || s.stack.length === 0) return null;
  return s.stack.pop()!;
}

/**
 * Check if a card type line represents a permanent (not instant/sorcery)
 */
function isPermanentTypeLine(typeLine?: string): boolean {
  if (!typeLine) return false;
  const tl = typeLine.toLowerCase();
  // Instants and sorceries are not permanents
  if (/\binstant\b/.test(tl) || /\bsorcery\b/.test(tl)) return false;
  // Everything else that can be cast is a permanent (creature, artifact, enchantment, planeswalker, battle)
  return /\b(creature|artifact|enchantment|planeswalker|battle)\b/.test(tl);
}

/**
 * Execute a triggered ability effect based on its description.
 * Handles common trigger effects like life gain/loss, counters, draw, etc.
 */
function executeTriggerEffect(
  ctx: GameContext,
  controller: PlayerID,
  sourceName: string,
  description: string,
  triggerItem: any
): void {
  const state = (ctx as any).state;
  if (!state) return;
  
  const desc = description.toLowerCase();
  const startingLife = state.startingLife || 40;
  
  // Ensure life dictionary exists
  if (!state.life) {
    state.life = {};
  }
  
  // Get all players for "each opponent" effects
  const players = state.players || [];
  const opponents = players.filter((p: any) => p.id !== controller && !p.hasLost);
  
  // Helper to modify life and sync to player object
  const modifyLife = (playerId: string, delta: number) => {
    const currentLife = state.life[playerId] ?? startingLife;
    state.life[playerId] = currentLife + delta;
    
    // Sync to player object
    const player = players.find((p: any) => p.id === playerId);
    if (player) {
      player.life = state.life[playerId];
    }
    
    const action = delta > 0 ? 'gained' : 'lost';
    const amount = Math.abs(delta);
    console.log(`[executeTriggerEffect] ${playerId} ${action} ${amount} life (${currentLife} -> ${state.life[playerId]})`);
  };
  
  // Pattern: "You gain X life"
  const gainLifeMatch = desc.match(/you gain (\d+) life/i);
  if (gainLifeMatch) {
    const amount = parseInt(gainLifeMatch[1], 10);
    modifyLife(controller, amount);
    return;
  }
  
  // Pattern: "You may gain X life" (for optional triggers that were accepted)
  const mayGainLifeMatch = desc.match(/you may gain (\d+) life/i);
  if (mayGainLifeMatch) {
    const amount = parseInt(mayGainLifeMatch[1], 10);
    modifyLife(controller, amount);
    return;
  }
  
  // Pattern: "Each opponent loses X life"
  const opponentsLoseMatch = desc.match(/each opponent loses (\d+) life/i);
  if (opponentsLoseMatch) {
    const amount = parseInt(opponentsLoseMatch[1], 10);
    for (const opp of opponents) {
      modifyLife(opp.id, -amount);
    }
    // Check for "you gain X life" in same trigger (like Zulaport Cutthroat)
    const alsoGainMatch = desc.match(/you gain (\d+) life/i);
    if (alsoGainMatch) {
      const gainAmount = parseInt(alsoGainMatch[1], 10);
      modifyLife(controller, gainAmount);
    }
    return;
  }
  
  // Pattern: "Target player loses X life, you gain X life" (Blood Artist)
  const targetLosesYouGainMatch = desc.match(/target player loses (\d+) life.*you gain (\d+) life/i);
  if (targetLosesYouGainMatch) {
    const loseAmount = parseInt(targetLosesYouGainMatch[1], 10);
    const gainAmount = parseInt(targetLosesYouGainMatch[2], 10);
    
    // If we have a target, use it; otherwise target a random opponent
    const targets = triggerItem.targets || [];
    const targetPlayer = targets[0] || (opponents[0]?.id);
    
    if (targetPlayer) {
      modifyLife(targetPlayer, -loseAmount);
    }
    modifyLife(controller, gainAmount);
    return;
  }
  
  // Pattern: "Creature's controller loses X life" (Blood Seeker)
  const creatureControllerLosesMatch = desc.match(/creature's controller loses (\d+) life/i);
  if (creatureControllerLosesMatch) {
    const amount = parseInt(creatureControllerLosesMatch[1], 10);
    // The triggering creature's controller - stored in triggerItem for ETB triggers
    const triggeringController = (triggerItem as any).triggeringController;
    if (triggeringController && triggeringController !== controller) {
      modifyLife(triggeringController, -amount);
    }
    return;
  }
  
  // Pattern: "+1/+1 counter on each creature you control" (Cathar's Crusade)
  if (desc.includes('+1/+1 counter') && desc.includes('each creature you control')) {
    const battlefield = state.battlefield || [];
    for (const perm of battlefield) {
      if (!perm) continue;
      if (perm.controller !== controller) continue;
      const typeLine = (perm.card?.type_line || '').toLowerCase();
      if (!typeLine.includes('creature')) continue;
      
      // Add +1/+1 counter
      perm.counters = perm.counters || {};
      perm.counters['+1/+1'] = (perm.counters['+1/+1'] || 0) + 1;
      console.log(`[executeTriggerEffect] Added +1/+1 counter to ${perm.card?.name || perm.id}`);
    }
    return;
  }
  
  // Pattern: "Draw a card" or "Draw X cards"
  const drawMatch = desc.match(/draw (?:a card|(\d+) cards?)/i);
  if (drawMatch) {
    const count = drawMatch[1] ? parseInt(drawMatch[1], 10) : 1;
    // Set up pending draw - actual draw happens through zone management
    state.pendingDraws = state.pendingDraws || {};
    state.pendingDraws[controller] = (state.pendingDraws[controller] || 0) + count;
    console.log(`[executeTriggerEffect] ${controller} will draw ${count} card(s)`);
    return;
  }
  
  // Pattern: "Search your library for a [card type]" (Knight of the White Orchid, Rampant Growth triggers, etc.)
  const searchLibraryMatch = desc.match(/(?:you may )?search your library for (?:a|an) ([^,\.]+)/i);
  if (searchLibraryMatch) {
    const searchFor = searchLibraryMatch[1].trim();
    const isOptional = desc.includes('you may search');
    
    // Determine destination
    let destination = 'hand';
    let entersTapped = false;
    if (desc.includes('put it onto the battlefield') || desc.includes('put that card onto the battlefield')) {
      destination = 'battlefield';
      // Check if it enters tapped
      if (desc.includes('tapped')) {
        entersTapped = true;
      }
    } else if (desc.includes('put it on top of your library') || desc.includes('put that card on top')) {
      destination = 'top';
    }
    
    // Build filter based on what we're searching for
    const filter: { types?: string[]; subtypes?: string[]; name?: string } = {};
    const subtypes: string[] = [];
    
    // Check for basic land types
    if (searchFor.includes('plains')) subtypes.push('Plains');
    if (searchFor.includes('island')) subtypes.push('Island');
    if (searchFor.includes('swamp')) subtypes.push('Swamp');
    if (searchFor.includes('mountain')) subtypes.push('Mountain');
    if (searchFor.includes('forest')) subtypes.push('Forest');
    
    // Check for card types
    const types: string[] = [];
    if (searchFor.includes('land')) types.push('land');
    if (searchFor.includes('creature')) types.push('creature');
    if (searchFor.includes('artifact')) types.push('artifact');
    if (searchFor.includes('enchantment')) types.push('enchantment');
    if (searchFor.includes('planeswalker')) types.push('planeswalker');
    
    if (types.length > 0) filter.types = types;
    if (subtypes.length > 0) filter.subtypes = subtypes;
    
    // Set up pending library search
    state.pendingLibrarySearch = state.pendingLibrarySearch || {};
    state.pendingLibrarySearch[controller] = {
      type: 'etb-trigger',
      searchFor: searchFor,
      destination,
      tapped: entersTapped,
      optional: isOptional,
      source: sourceName,
      shuffleAfter: desc.includes('shuffle'),
      filter,
    };
    
    console.log(`[executeTriggerEffect] ${sourceName} trigger: ${controller} may search for ${searchFor} (destination: ${destination})`);
    return;
  }
  
  // Pattern: "Create a X/Y [creature type] creature token" (Precinct Captain, Brimaz, etc.)
  const createTokenMatch = desc.match(/create (?:a|an|(\d+)) (\d+)\/(\d+) ([^\.]+?)(?:\s+creature)?\s+tokens?/i);
  if (createTokenMatch) {
    const tokenCount = createTokenMatch[1] ? parseInt(createTokenMatch[1], 10) : 1;
    const power = parseInt(createTokenMatch[2], 10);
    const toughness = parseInt(createTokenMatch[3], 10);
    const tokenDescription = createTokenMatch[4].trim();
    
    // Extract color and creature type from description
    // e.g., "white Soldier" -> color: white, type: Soldier
    const parts = tokenDescription.split(/\s+/);
    const colors: string[] = [];
    const creatureTypes: string[] = [];
    
    const colorMap: Record<string, string> = {
      'white': 'W', 'blue': 'U', 'black': 'B', 'red': 'R', 'green': 'G'
    };
    
    for (const part of parts) {
      const lowerPart = part.toLowerCase();
      if (colorMap[lowerPart]) {
        colors.push(colorMap[lowerPart]);
      } else if (lowerPart !== 'creature' && lowerPart !== 'token' && lowerPart !== 'and') {
        creatureTypes.push(part.charAt(0).toUpperCase() + part.slice(1).toLowerCase());
      }
    }
    
    // Check for abilities in the description
    const abilities: string[] = [];
    if (desc.includes('vigilance')) abilities.push('Vigilance');
    if (desc.includes('haste')) abilities.push('Haste');
    if (desc.includes('lifelink')) abilities.push('Lifelink');
    if (desc.includes('deathtouch')) abilities.push('Deathtouch');
    if (desc.includes('flying')) abilities.push('Flying');
    if (desc.includes('first strike')) abilities.push('First strike');
    if (desc.includes('trample')) abilities.push('Trample');
    
    // Create the tokens
    state.battlefield = state.battlefield || [];
    for (let i = 0; i < tokenCount; i++) {
      const tokenId = uid("token");
      const tokenName = creatureTypes.length > 0 ? creatureTypes.join(' ') : 'Token';
      const typeLine = `Token Creature — ${creatureTypes.join(' ')}`;
      
      const token = {
        id: tokenId,
        controller,
        owner: controller,
        tapped: false,
        counters: {},
        basePower: power,
        baseToughness: toughness,
        summoningSickness: !abilities.includes('Haste'),
        isToken: true,
        card: {
          id: tokenId,
          name: tokenName,
          type_line: typeLine,
          power: String(power),
          toughness: String(toughness),
          colors,
          oracle_text: abilities.join(', '),
          keywords: abilities,
          zone: 'battlefield',
        },
      } as any;
      
      state.battlefield.push(token);
      console.log(`[executeTriggerEffect] Created ${power}/${toughness} ${tokenName} token for ${controller}`);
    }
    return;
  }
  
  // Log unhandled triggers for future implementation
  console.log(`[executeTriggerEffect] Unhandled trigger effect: "${description}" from ${sourceName}`);
}

/* Resolve the top item - moves permanent spells to battlefield */
export function resolveTopOfStack(ctx: GameContext) {
  const item = popStackItem(ctx);
  if (!item) return;
  
  const { state, bumpSeq } = ctx;
  const card = item.card;
  const controller = item.controller as PlayerID;
  const targets = (item as any).targets || [];
  
  // Handle activated abilities (like fetch lands)
  if ((item as any).type === 'ability') {
    const abilityType = (item as any).abilityType;
    const sourceName = (item as any).sourceName || 'Unknown';
    
    // Handle fetch land ability resolution
    if (abilityType === 'fetch-land') {
      console.log(`[resolveTopOfStack] Resolving fetch land ability from ${sourceName} for ${controller}`);
      
      // Set up pending library search - the socket layer will send the search prompt
      const searchParams = (item as any).searchParams || {};
      (state as any).pendingLibrarySearch = (state as any).pendingLibrarySearch || {};
      (state as any).pendingLibrarySearch[controller] = {
        type: 'fetch-land',
        searchFor: searchParams.searchDescription || 'a land card',
        destination: 'battlefield',
        // Standard fetch lands (Polluted Delta, Flooded Strand, etc.) put lands onto battlefield untapped.
        // Only lands like Terramorphic Expanse or Evolving Wilds specify "enters the battlefield tapped".
        // The search prompt handler can override this based on the specific card's oracle text.
        tapped: false,
        optional: false,
        source: sourceName,
        shuffleAfter: true,
        filter: searchParams.filter || { types: ['land'] },
        cardImageUrl: searchParams.cardImageUrl,
      };
      
      console.log(`[resolveTopOfStack] Fetch land ${sourceName}: ${controller} may search for ${searchParams.searchDescription || 'a land card'}`);
      bumpSeq();
      return;
    }
    
    // Handle other ability types (could be added here in the future)
    console.log(`[resolveTopOfStack] Resolved ability from ${sourceName} for ${controller}`);
    bumpSeq();
    return;
  }
  
  // Handle triggered abilities
  if ((item as any).type === 'triggered_ability') {
    const sourceName = (item as any).sourceName || 'Unknown';
    const description = (item as any).description || '';
    const triggerController = (item as any).controller || controller;
    
    console.log(`[resolveTopOfStack] Triggered ability from ${sourceName} resolved: ${description}`);
    
    // Execute the triggered ability effect based on description
    executeTriggerEffect(ctx, triggerController, sourceName, description, item);
    
    bumpSeq();
    return;
  }
  
  if (card && isPermanentTypeLine(card.type_line)) {
    // Permanent spell resolves - move to battlefield
    const tl = (card.type_line || "").toLowerCase();
    const isCreature = /\bcreature\b/.test(tl);
    const baseP = isCreature ? parsePT((card as any).power) : undefined;
    const baseT = isCreature ? parsePT((card as any).toughness) : undefined;
    
    // Check if the creature has haste from any source (own text or battlefield effects)
    // Rule 702.10: Haste allows ignoring summoning sickness
    const battlefield = state.battlefield || [];
    const hasHaste = isCreature && creatureWillHaveHaste(card, controller, battlefield);
    
    // Creatures have summoning sickness when they enter (unless they have haste)
    // Rule 302.6: A creature's activated ability with tap/untap symbol can't be
    // activated unless the creature has been under controller's control since 
    // their most recent turn began.
    const hasSummoningSickness = isCreature && !hasHaste;
    
    state.battlefield = state.battlefield || [];
    const newPermId = uid("perm");
    const newPermanent = {
      id: newPermId,
      controller,
      owner: controller,
      tapped: false,
      counters: {},
      basePower: baseP,
      baseToughness: baseT,
      summoningSickness: hasSummoningSickness,
      card: { ...card, zone: "battlefield" },
    } as any;
    state.battlefield.push(newPermanent);
    
    // Build a readable status message for logging
    let statusNote = '';
    if (hasSummoningSickness) {
      statusNote = ' (summoning sickness)';
    } else if (hasHaste) {
      statusNote = ' (haste)';
    }
    console.log(`[resolveTopOfStack] Permanent ${card.name || 'unnamed'} entered battlefield under ${controller}${statusNote}`);
    
    // Check for ETB triggers on this permanent and other permanents
    try {
      const etbTriggers = getETBTriggersForPermanent(card, newPermanent);
      
      // Also check other permanents for "whenever a creature/permanent enters" triggers
      for (const perm of state.battlefield) {
        if (perm.id === newPermId) continue; // Skip the entering permanent
        const otherTriggers = getETBTriggersForPermanent(perm.card, perm);
        for (const trigger of otherTriggers) {
          // Only add triggers that fire on other permanents entering
          if (trigger.triggerType === 'creature_etb' && isCreature) {
            etbTriggers.push({ ...trigger, permanentId: perm.id });
          } else if (trigger.triggerType === 'another_permanent_etb') {
            etbTriggers.push({ ...trigger, permanentId: perm.id });
          } else if (trigger.triggerType === 'permanent_etb') {
            // Altar of the Brood style - triggers on ANY permanent entering (not just yours)
            etbTriggers.push({ ...trigger, permanentId: perm.id });
          }
        }
      }
      
      if (etbTriggers.length > 0) {
        console.log(`[resolveTopOfStack] Found ${etbTriggers.length} ETB trigger(s) for ${card.name || 'permanent'}`);
        
        for (const trigger of etbTriggers) {
          // Push trigger onto the stack
          state.stack = state.stack || [];
          const triggerId = uid("trigger");
          
          // Determine the controller of the triggered ability
          // For ETB triggers from other permanents (like Soul Warden), the controller
          // is the controller of the permanent with the trigger, NOT the entering creature
          let triggerController = controller;
          if (trigger.permanentId && trigger.permanentId !== newPermId) {
            const triggerSource = state.battlefield?.find((p: any) => p.id === trigger.permanentId);
            if (triggerSource?.controller) {
              triggerController = triggerSource.controller;
            }
          }
          
          state.stack.push({
            id: triggerId,
            type: 'triggered_ability',
            controller: triggerController,
            source: trigger.permanentId,
            sourceName: trigger.cardName,
            description: trigger.description,
            triggerType: trigger.triggerType,
            mandatory: trigger.mandatory,
          } as any);
          
          console.log(`[resolveTopOfStack] ⚡ ${trigger.cardName}'s triggered ability (controlled by ${triggerController}): ${trigger.description}`);
        }
      }
    } catch (err) {
      console.warn('[resolveTopOfStack] Failed to detect ETB triggers:', err);
    }
    
    // Recalculate player effects when permanents ETB (for Exploration, Font of Mythos, etc.)
    try {
      recalculatePlayerEffects(ctx);
    } catch (err) {
      console.warn('[resolveTopOfStack] Failed to recalculate player effects:', err);
    }
  } else if (card) {
    // Non-permanent spell (instant/sorcery) - execute effects before moving to graveyard
    const oracleText = card.oracle_text || '';
    const spellSpec = categorizeSpell(card.name || '', oracleText);
    
    if (spellSpec) {
      // Convert targets array to TargetRef format if needed
      const targetRefs: TargetRef[] = targets.map((t: any) => {
        if (typeof t === 'string') {
          return { kind: 'permanent' as const, id: t };
        }
        return t;
      });
      
      // Generate effects based on spell type and targets
      const effects = resolveSpell(spellSpec, targetRefs, state as any);
      
      // Execute each effect
      for (const effect of effects) {
        executeSpellEffect(ctx, effect, controller, card.name || 'spell');
      }
      
      // Handle special spell effects not covered by the base system
      // Beast Within: "Destroy target permanent. Its controller creates a 3/3 green Beast creature token."
      if (oracleText.toLowerCase().includes('its controller creates') && targetRefs.length > 0) {
        const targetPerm = state.battlefield?.find((p: any) => p.id === targetRefs[0]?.id);
        if (targetPerm) {
          const tokenController = targetPerm.controller as PlayerID;
          // Check for token creation patterns
          const tokenMatch = oracleText.match(/creates?\s+(?:a\s+)?(\d+)\/(\d+)\s+(\w+)\s+(\w+)/i);
          if (tokenMatch) {
            const power = parseInt(tokenMatch[1], 10);
            const toughness = parseInt(tokenMatch[2], 10);
            const tokenName = `${tokenMatch[4]} Token`;
            createBeastToken(ctx, tokenController, tokenName, power, toughness);
          }
        }
      }
    }
    
    // Handle token creation spells (where the caster creates tokens)
    // Patterns: "create X 1/1 tokens", "create two 1/1 tokens", etc.
    const oracleTextLower = oracleText.toLowerCase();
    const tokenCreationResult = parseTokenCreation(card.name, oracleTextLower, controller, state);
    if (tokenCreationResult) {
      for (let i = 0; i < tokenCreationResult.count; i++) {
        createTokenFromSpec(ctx, controller, tokenCreationResult);
      }
      console.log(`[resolveTopOfStack] ${card.name} created ${tokenCreationResult.count} ${tokenCreationResult.name} token(s) for ${controller}`);
    }
    
    // Handle extra turn spells (Time Warp, Time Walk, Temporal Mastery, etc.)
    if (isExtraTurnSpell(card.name, oracleTextLower)) {
      // Determine who gets the extra turn
      // Most extra turn spells give the caster an extra turn
      // "Target player takes an extra turn" would need target handling
      let extraTurnPlayer = controller;
      
      // Check for "target player takes an extra turn" pattern
      if (oracleTextLower.includes('target player') && oracleTextLower.includes('extra turn')) {
        // Use target if provided
        if (targets.length > 0 && targets[0]?.kind === 'player') {
          extraTurnPlayer = targets[0].id as PlayerID;
        }
      }
      
      addExtraTurn(ctx, extraTurnPlayer, card.name || 'Extra turn spell');
      console.log(`[resolveTopOfStack] Extra turn granted to ${extraTurnPlayer} by ${card.name}`);
    }
    
    // Handle "each player draws" spells (Vision Skeins, Prosperity, Howling Mine effects, etc.)
    const eachPlayerDrawsMatch = oracleTextLower.match(/each player draws?\s+(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+cards?/i);
    if (eachPlayerDrawsMatch) {
      const drawCountStr = eachPlayerDrawsMatch[1].toLowerCase();
      const wordToNumber: Record<string, number> = { 
        'a': 1, 'an': 1, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
        'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10
      };
      const drawCount = wordToNumber[drawCountStr] || parseInt(drawCountStr, 10) || 1;
      
      // Draw cards for each player
      const players = (state as any).players || [];
      for (const player of players) {
        if (player && player.id && typeof (ctx as any).drawCards === 'function') {
          try {
            (ctx as any).drawCards(player.id, drawCount);
            console.log(`[resolveTopOfStack] ${card.name}: ${player.name || player.id} drew ${drawCount} card(s)`);
          } catch (err) {
            console.warn(`[resolveTopOfStack] Failed to draw cards for ${player.id}:`, err);
          }
        }
      }
    }
    
    // Handle tutor spells (Demonic Tutor, Vampiric Tutor, Diabolic Tutor, Kodama's Reach, Cultivate, etc.)
    // These need to trigger a library search prompt for the player
    const tutorInfo = detectTutorSpell(oracleText);
    if (tutorInfo.isTutor) {
      // Set up pending library search - the socket layer will send the search prompt
      (state as any).pendingLibrarySearch = (state as any).pendingLibrarySearch || {};
      (state as any).pendingLibrarySearch[controller] = {
        type: 'tutor',
        searchFor: tutorInfo.searchCriteria || 'card',
        destination: tutorInfo.destination || 'hand',
        tapped: tutorInfo.entersTapped ?? (tutorInfo.destination === 'battlefield'), // Cards put onto battlefield from tutors are usually tapped
        optional: tutorInfo.optional || false,
        source: card.name || 'Tutor',
        shuffleAfter: true,
        maxSelections: tutorInfo.maxSelections || 1,
        // For split-destination effects (Kodama's Reach, Cultivate)
        splitDestination: tutorInfo.splitDestination || false,
        toBattlefield: tutorInfo.toBattlefield,
        toHand: tutorInfo.toHand,
        entersTapped: tutorInfo.entersTapped,
      };
      console.log(`[resolveTopOfStack] Tutor spell ${card.name}: ${controller} may search for ${tutorInfo.searchCriteria || 'a card'} (destination: ${tutorInfo.destination}, split: ${tutorInfo.splitDestination || false})`);
    }
    
    // Handle Path to Exile - exile target creature, controller may search for basic land
    if (card.name?.toLowerCase().includes('path to exile') || 
        (oracleTextLower.includes('exile target creature') && 
         oracleTextLower.includes('search') && 
         oracleTextLower.includes('basic land'))) {
      // The exile is already handled by the targeting system
      // The search effect should be triggered for the exiled creature's controller
      // This requires player interaction, so we'll set up a pending search prompt
      if (targets.length > 0) {
        const targetPerm = state.battlefield?.find((p: any) => p.id === targets[0]?.id || p.id === targets[0]);
        if (targetPerm) {
          const creatureController = targetPerm.controller as PlayerID;
          // Set up pending search - the creature's controller may search for a basic land
          (state as any).pendingLibrarySearch = (state as any).pendingLibrarySearch || {};
          (state as any).pendingLibrarySearch[creatureController] = {
            type: 'path_to_exile',
            searchFor: 'basic land',
            tapped: true,
            optional: true,
            source: card.name || 'Path to Exile',
          };
          console.log(`[resolveTopOfStack] Path to Exile: ${creatureController} may search for a basic land`);
        }
      }
    }
    
    // Handle Entrapment Maneuver - "Target player sacrifices an attacking creature. 
    // You create X 1/1 white Soldier creature tokens, where X is that creature's toughness."
    const isEntrapmentManeuver = card.name?.toLowerCase().includes('entrapment maneuver') ||
      (oracleTextLower.includes('sacrifices an attacking creature') && 
       oracleTextLower.includes('create') && 
       oracleTextLower.includes('soldier') &&
       oracleTextLower.includes('toughness'));
    
    if (isEntrapmentManeuver && targets.length > 0) {
      // Find the target player (they must sacrifice an attacking creature)
      const targetPlayerId = targets[0]?.id || targets[0];
      
      // Get all attacking creatures controlled by the target player
      const battlefield = state.battlefield || [];
      const attackingCreatures = battlefield.filter((p: any) => 
        p?.controller === targetPlayerId && 
        (p?.card?.type_line || "").toLowerCase().includes("creature") &&
        p?.attacking // Only creatures that are currently attacking
      );
      
      if (attackingCreatures.length > 0) {
        // Set up pending sacrifice selection for Entrapment Maneuver
        // The target player chooses which attacking creature to sacrifice
        (state as any).pendingEntrapmentManeuver = (state as any).pendingEntrapmentManeuver || {};
        (state as any).pendingEntrapmentManeuver[targetPlayerId] = {
          source: card.name || 'Entrapment Maneuver',
          caster: controller,
          attackingCreatures: attackingCreatures.map((c: any) => ({
            id: c.id,
            name: c.card?.name || "Unknown",
            power: c.card?.power || c.basePower || "0",
            toughness: c.card?.toughness || c.baseToughness || "0",
            imageUrl: c.card?.image_uris?.small || c.card?.image_uris?.normal,
            typeLine: c.card?.type_line,
          })),
        };
        console.log(`[resolveTopOfStack] Entrapment Maneuver: ${targetPlayerId} must sacrifice one of ${attackingCreatures.length} attacking creature(s)`);
      } else {
        console.log(`[resolveTopOfStack] Entrapment Maneuver: ${targetPlayerId} has no attacking creatures to sacrifice`);
      }
    }
    
    // Handle Join Forces spells (Mind's Aglow, Collective Voyage, etc.)
    // These require all players to have the option to contribute mana
    if (isJoinForcesSpell(card.name, oracleTextLower)) {
      // Set up pending join forces - this signals to the socket layer to initiate the contribution phase
      (state as any).pendingJoinForces = (state as any).pendingJoinForces || [];
      (state as any).pendingJoinForces.push({
        id: uid("jf"),
        controller,
        cardName: card.name || 'Join Forces Spell',
        effectDescription: oracleText,
        imageUrl: card.image_uris?.normal || card.image_uris?.small,
      });
      console.log(`[resolveTopOfStack] Join Forces spell ${card.name} waiting for player contributions`);
    }
    
    // Move spell to graveyard after resolution
    const zones = ctx.state.zones || {};
    const z = zones[controller];
    if (z) {
      z.graveyard = z.graveyard || [];
      (z.graveyard as any[]).push({ ...card, zone: "graveyard" });
      z.graveyardCount = (z.graveyard as any[]).length;
      console.log(`[resolveTopOfStack] Spell ${card.name || 'unnamed'} resolved and moved to graveyard for ${controller}`);
    }
  }
  
  bumpSeq();
}

/**
 * Execute a single spell effect
 */
function executeSpellEffect(ctx: GameContext, effect: EngineEffect, caster: PlayerID, spellName: string): void {
  const { state } = ctx;
  
  switch (effect.kind) {
    case 'DestroyPermanent': {
      const battlefield = state.battlefield || [];
      const idx = battlefield.findIndex((p: any) => p.id === effect.id);
      if (idx !== -1) {
        const destroyed = battlefield.splice(idx, 1)[0];
        const owner = (destroyed as any).owner || (destroyed as any).controller;
        const zones = ctx.state.zones || {};
        const z = zones[owner];
        if (z) {
          z.graveyard = z.graveyard || [];
          const card = (destroyed as any).card;
          if (card) {
            (z.graveyard as any[]).push({ ...card, zone: "graveyard" });
            z.graveyardCount = (z.graveyard as any[]).length;
          }
        }
        console.log(`[resolveSpell] ${spellName} destroyed ${(destroyed as any).card?.name || effect.id}`);
      }
      break;
    }
    case 'MoveToExile': {
      const battlefield = state.battlefield || [];
      const idx = battlefield.findIndex((p: any) => p.id === effect.id);
      if (idx !== -1) {
        const exiled = battlefield.splice(idx, 1)[0];
        const owner = (exiled as any).owner || (exiled as any).controller;
        const zones = ctx.state.zones || {};
        const z = zones[owner];
        if (z) {
          z.exile = z.exile || [];
          const card = (exiled as any).card;
          if (card) {
            (z.exile as any[]).push({ ...card, zone: "exile" });
          }
        }
        console.log(`[resolveSpell] ${spellName} exiled ${(exiled as any).card?.name || effect.id}`);
      }
      break;
    }
    case 'DamagePermanent': {
      const battlefield = state.battlefield || [];
      const perm = battlefield.find((p: any) => p.id === effect.id);
      if (perm) {
        (perm as any).damage = ((perm as any).damage || 0) + effect.amount;
        console.log(`[resolveSpell] ${spellName} dealt ${effect.amount} damage to ${(perm as any).card?.name || effect.id}`);
      }
      break;
    }
    case 'DamagePlayer': {
      const players = state.players || [];
      const player = players.find((p: any) => p.id === effect.playerId);
      if (player) {
        (player as any).life = ((player as any).life || 40) - effect.amount;
        console.log(`[resolveSpell] ${spellName} dealt ${effect.amount} damage to player ${effect.playerId}`);
      }
      break;
    }
    case 'CounterSpell': {
      // Counter a spell on the stack and move it to its controller's graveyard
      const stack = state.stack || [];
      const stackIdx = stack.findIndex((s: any) => s.id === effect.stackItemId);
      if (stackIdx >= 0) {
        const countered = stack.splice(stackIdx, 1)[0];
        const controller = (countered as any).controller;
        const counteredCardName = (countered as any).card?.name || 'spell';
        
        // Move the countered spell's card to the controller's graveyard
        if ((countered as any).card && controller) {
          const zones = ctx.state.zones = ctx.state.zones || {};
          zones[controller] = zones[controller] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
          const gy = (zones[controller] as any).graveyard = (zones[controller] as any).graveyard || [];
          gy.push({ ...(countered as any).card, zone: 'graveyard' });
          (zones[controller] as any).graveyardCount = gy.length;
        }
        
        console.log(`[resolveSpell] ${spellName} countered ${counteredCardName}`);
      }
      break;
    }
    case 'CounterAbility': {
      // Counter an ability on the stack (activated or triggered)
      const stack = state.stack || [];
      const stackIdx = stack.findIndex((s: any) => s.id === effect.stackItemId);
      if (stackIdx >= 0) {
        const countered = stack.splice(stackIdx, 1)[0];
        const abilityDesc = (countered as any).description || (countered as any).ability?.text || 'ability';
        console.log(`[resolveSpell] ${spellName} countered ${abilityDesc}`);
        // Abilities don't go anywhere when countered - they just cease to exist
      }
      break;
    }
    case 'Broadcast': {
      console.log(`[resolveSpell] ${effect.message}`);
      break;
    }
  }
}

/**
 * Check if a spell grants an extra turn
 * Handles cards like: Time Warp, Time Walk, Temporal Mastery, Nexus of Fate,
 * Alrund's Epiphany, Karn's Temporal Sundering, etc.
 */
function isExtraTurnSpell(cardName: string, oracleTextLower: string): boolean {
  const nameLower = (cardName || '').toLowerCase();
  
  // Known extra turn spell names
  const extraTurnSpells = new Set([
    'time warp',
    'time walk',
    'temporal mastery',
    'nexus of fate',
    'expropriate',
    "alrund's epiphany",
    "karn's temporal sundering",
    'temporal manipulation',
    'time stretch',
    'beacon of tomorrows',
    'capture of jingzhou',
    'temporal trespass',
    'walk the aeons',
    'savor the moment',
    'final fortune',
    "warrior's oath",
    'last chance',
    'chance for glory',
    'medomai the ageless',
    'magistrate\'s scepter',
    'part the waterveil',
    'lighthouse chronologist',
    'wanderwine prophets',
    'emrakul, the promised end',
    'ugin\'s nexus',
    'sage of hours',
    'notorious throng',
  ]);
  
  if (extraTurnSpells.has(nameLower)) {
    return true;
  }
  
  // Generic detection via oracle text
  // "Take an extra turn" or "takes an extra turn" are the common patterns
  if (oracleTextLower.includes('take an extra turn') ||
      oracleTextLower.includes('takes an extra turn') ||
      oracleTextLower.includes('extra turn after this one')) {
    return true;
  }
  
  return false;
}

/**
 * Check if a spell is a Join Forces spell
 * Handles cards like: Mind's Aglow, Collective Voyage, Collective Blessing, etc.
 * Join Forces spells have "Join forces — Starting with you, each player may pay any amount of mana"
 */
function isJoinForcesSpell(cardName: string, oracleTextLower: string): boolean {
  const nameLower = (cardName || '').toLowerCase();
  
  // Known Join Forces spell names
  const joinForcesSpells = new Set([
    "minds aglow",
    "mind's aglow",
    "collective voyage",
    "collective blessing",
    "alliance of arms",
    "mana-charged dragon",
  ]);
  
  if (joinForcesSpells.has(nameLower)) {
    return true;
  }
  
  // Generic detection via oracle text
  // "Join forces" is the keyword ability
  if (oracleTextLower.includes('join forces') ||
      (oracleTextLower.includes('starting with you') && 
       oracleTextLower.includes('each player may pay'))) {
    return true;
  }
  
  return false;
}

/**
 * Create a token creature (helper for Beast Within and similar)
 */
function createBeastToken(ctx: GameContext, controller: PlayerID, name: string, power: number, toughness: number): void {
  const { state, bumpSeq } = ctx;
  
  state.battlefield = state.battlefield || [];
  const tokenId = uid("token");
  state.battlefield.push({
    id: tokenId,
    controller,
    owner: controller,
    tapped: false,
    counters: {},
    basePower: power,
    baseToughness: toughness,
    summoningSickness: true,
    isToken: true,
    card: {
      id: tokenId,
      name,
      type_line: "Token Creature — Beast",
      power: String(power),
      toughness: String(toughness),
      zone: "battlefield",
    },
  } as any);
  
  console.log(`[resolveSpell] Created ${power}/${toughness} ${name} token for ${controller}`);
}

/**
 * Token creation specification parsed from oracle text
 */
interface TokenSpec {
  count: number;
  power: number;
  toughness: number;
  name: string;
  typeLine: string;
  colors?: string[];
}

/**
 * Calculate token doubling multiplier from battlefield effects
 * Checks for effects like Anointed Procession, Doubling Season, Parallel Lives, etc.
 */
function getTokenDoublerMultiplier(controller: PlayerID, state: any): number {
  let multiplier = 1;
  const battlefield = state.battlefield || [];
  
  for (const perm of battlefield) {
    if (perm.controller !== controller) continue;
    const permName = (perm.card?.name || '').toLowerCase();
    const permOracle = (perm.card?.oracle_text || '').toLowerCase();
    
    // Anointed Procession: "If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead."
    // Parallel Lives: "If an effect would create one or more creature tokens under your control, it creates twice that many of those tokens instead."
    // Doubling Season: "If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead."
    // Mondrak, Glory Dominus: Same effect
    // Primal Vigor: Affects all players but still doubles tokens
    if (permName.includes('anointed procession') ||
        permName.includes('parallel lives') ||
        permName.includes('doubling season') ||
        permName.includes('mondrak, glory dominus') ||
        permName.includes('primal vigor') ||
        (permOracle.includes('twice that many') && permOracle.includes('token'))) {
      multiplier *= 2;
    }
  }
  
  return multiplier;
}

/**
 * Parse token creation from spell oracle text
 * Handles patterns like:
 * - "Create two 1/1 blue Merfolk Wizard creature tokens"
 * - "Create X 2/2 green Wolf creature tokens"
 * - "Create a 3/3 green Beast creature token"
 * 
 * For cards like Summon the School that have conditions (e.g., "equal to the number of Merfolk you control"),
 * we count the relevant permanents on the battlefield.
 */
function parseTokenCreation(cardName: string, oracleTextLower: string, controller: PlayerID, state: any): TokenSpec | null {
  // Skip if this doesn't create tokens for the caster
  if (!oracleTextLower.includes('create') || !oracleTextLower.includes('token')) {
    return null;
  }
  
  // Skip "its controller creates" patterns (handled separately for spells like Beast Within)
  if (oracleTextLower.includes('its controller creates')) {
    return null;
  }
  
  const nameLower = (cardName || '').toLowerCase();
  
  // Special handling for known cards
  // Summon the School: "Create two 1/1 blue Merfolk Wizard creature tokens."
  // (The tap four Merfolk ability is a separate activated ability to return it from graveyard)
  if (nameLower.includes('summon the school')) {
    // Base count is 2 tokens, multiplied by token doublers
    const count = 2 * getTokenDoublerMultiplier(controller, state);
    
    return {
      count,
      power: 1,
      toughness: 1,
      name: 'Merfolk Wizard',
      typeLine: 'Token Creature — Merfolk Wizard',
      colors: ['blue'],
    };
  }
  
  // Generic token creation parsing
  // Pattern: "create (a|one|two|three|four|five|X|number) P/T [color] [type] creature token(s)"
  const tokenPatterns = [
    // "create two 1/1 blue Merfolk Wizard creature tokens"
    /create\s+(a|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x)\s+(\d+)\/(\d+)\s+(\w+(?:\s+\w+)*)\s+creature\s+tokens?/i,
    // "create a 3/3 green Beast creature token"
    /create\s+(a|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x)\s+(\d+)\/(\d+)\s+(\w+)\s+(\w+)\s+creature\s+tokens?/i,
  ];
  
  for (const pattern of tokenPatterns) {
    const match = oracleTextLower.match(pattern);
    if (match) {
      const countWord = match[1].toLowerCase();
      let count = 1;
      
      // Parse count word
      const wordToNumber: Record<string, number> = {
        'a': 1, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
        'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
      };
      
      if (wordToNumber[countWord]) {
        count = wordToNumber[countWord];
      } else if (/^\d+$/.test(countWord)) {
        count = parseInt(countWord, 10);
      } else if (countWord === 'x') {
        // X is typically determined by something else; default to 1 for now
        count = 1;
      }
      
      // Apply token doublers
      count *= getTokenDoublerMultiplier(controller, state);
      
      const power = parseInt(match[2], 10);
      const toughness = parseInt(match[3], 10);
      const typeInfo = match[4]; // Could be "blue Merfolk Wizard" or just "Beast"
      
      // Extract color and creature type from typeInfo
      const colors = ['white', 'blue', 'black', 'red', 'green'];
      const foundColors: string[] = [];
      let creatureType = typeInfo;
      
      for (const color of colors) {
        if (typeInfo.toLowerCase().includes(color)) {
          foundColors.push(color);
          creatureType = creatureType.replace(new RegExp(color, 'gi'), '').trim();
        }
      }
      
      // Also check for colorless
      if (typeInfo.toLowerCase().includes('colorless')) {
        creatureType = creatureType.replace(/colorless/gi, '').trim();
      }
      
      return {
        count,
        power,
        toughness,
        name: creatureType || 'Token',
        typeLine: `Token Creature — ${creatureType || 'Token'}`,
        colors: foundColors.length > 0 ? foundColors : undefined,
      };
    }
  }
  
  return null;
}

/**
 * Create a token from a TokenSpec
 */
function createTokenFromSpec(ctx: GameContext, controller: PlayerID, spec: TokenSpec): void {
  const { state, bumpSeq } = ctx;
  
  state.battlefield = state.battlefield || [];
  const tokenId = uid("token");
  state.battlefield.push({
    id: tokenId,
    controller,
    owner: controller,
    tapped: false,
    counters: {},
    basePower: spec.power,
    baseToughness: spec.toughness,
    summoningSickness: true,
    isToken: true,
    card: {
      id: tokenId,
      name: spec.name,
      type_line: spec.typeLine,
      power: String(spec.power),
      toughness: String(spec.toughness),
      zone: "battlefield",
      colors: spec.colors,
    },
  } as any);
}

/* Place a land onto the battlefield for a player (simplified) */
export function playLand(ctx: GameContext, playerId: PlayerID, cardOrId: any) {
  const { state, bumpSeq } = ctx;
  const zones = state.zones = state.zones || {};
  
  // Handle both card object and cardId string
  let card: any;
  const cardId = typeof cardOrId === 'string' ? cardOrId : cardOrId?.id;
  
  // Check if this card is already on the battlefield (idempotency for replay)
  if (cardId && Array.isArray(state.battlefield)) {
    const alreadyOnBattlefield = state.battlefield.some(
      (p: any) => p?.card?.id === cardId && p?.controller === playerId
    );
    if (alreadyOnBattlefield) {
      console.info(`playLand: card ${cardId} already on battlefield for ${playerId}, skipping (replay idempotency)`);
      return;
    }
  }
  
  if (typeof cardOrId === 'string') {
    // Find card in player's hand
    const z = zones[playerId];
    if (!z) {
      console.warn(`playLand: no zone found for player ${playerId}`);
      return;
    }
    if (!Array.isArray(z.hand)) {
      console.warn(`playLand: hand is not an array for player ${playerId} (type: ${typeof z.hand})`);
      return;
    }
    const handCards = z.hand as any[];
    const idx = handCards.findIndex((c: any) => c.id === cardOrId);
    if (idx === -1) {
      // During replay, card might not be in hand anymore - this is okay
      console.info(`playLand: card ${cardOrId} not found in hand for player ${playerId} (may be replay)`);
      return;
    }
    // Remove card from hand
    card = handCards.splice(idx, 1)[0];
    z.handCount = handCards.length;
  } else {
    // Card object passed directly (legacy or event replay)
    card = cardOrId;
    if (!card) {
      console.warn(`playLand: card is null or undefined for player ${playerId}`);
      return;
    }
    // Try to remove from hand if it exists there
    const z = zones[playerId];
    if (z && Array.isArray(z.hand)) {
      const handCards = z.hand as any[];
      const idx = handCards.findIndex((c: any) => c.id === card.id);
      if (idx !== -1) {
        handCards.splice(idx, 1);
        z.handCount = handCards.length;
      }
    }
  }
  
  const tl = (card.type_line || "").toLowerCase();
  const isCreature = /\bcreature\b/.test(tl);
  const isLand = /\bland\b/.test(tl);
  const baseP = isCreature ? parsePT((card as any).power) : undefined;
  const baseT = isCreature ? parsePT((card as any).toughness) : undefined;
  
  // Check if the permanent has haste from any source (own text or battlefield effects)
  // Rule 702.10: Haste allows ignoring summoning sickness
  const battlefield = state.battlefield || [];
  const hasHaste = isCreature && creatureWillHaveHaste(card, playerId, battlefield);
  
  // Rule 302.6: Summoning sickness applies to CREATURES (including creature lands like Dryad Arbor)
  // - A pure land (not a creature) does NOT have summoning sickness
  // - A "Land Creature" like Dryad Arbor DOES have summoning sickness because it's a creature
  // - If a land becomes a creature later (via animation), it would need to be checked at that time
  const hasSummoningSickness = isCreature && !hasHaste;
  
  state.battlefield = state.battlefield || [];
  state.battlefield.push({
    id: uid("perm"),
    controller: playerId,
    owner: playerId,
    tapped: false,
    counters: {},
    basePower: baseP,
    baseToughness: baseT,
    summoningSickness: hasSummoningSickness,
    card: { ...card, zone: "battlefield" },
  } as any);
  state.landsPlayedThisTurn = state.landsPlayedThisTurn || {};
  state.landsPlayedThisTurn[playerId] = (state.landsPlayedThisTurn[playerId] ?? 0) + 1;
  
  // Recalculate player effects when lands ETB (some lands might have effects)
  try {
    recalculatePlayerEffects(ctx);
  } catch (err) {
    console.warn('[playLand] Failed to recalculate player effects:', err);
  }
  
  bumpSeq();
}

/**
 * Cast a spell from hand onto the stack.
 * 
 * @param ctx - Game context
 * @param playerId - Player casting the spell
 * @param cardOrId - Either a card ID string or a card object
 * @param targets - Optional array of target IDs
 */
export function castSpell(
  ctx: GameContext, 
  playerId: PlayerID, 
  cardOrId: any,
  targets?: any[]
) {
  const { state, bumpSeq } = ctx;
  const zones = state.zones = state.zones || {};
  
  // Handle both card object and cardId string
  let card: any;
  const cardId = typeof cardOrId === 'string' ? cardOrId : cardOrId?.id;
  
  // Check if this card is already on the stack or battlefield (idempotency for replay)
  if (cardId) {
    if (Array.isArray(state.stack)) {
      const alreadyOnStack = state.stack.some(
        (s: any) => s?.card?.id === cardId && s?.controller === playerId
      );
      if (alreadyOnStack) {
        console.info(`castSpell: card ${cardId} already on stack for ${playerId}, skipping (replay idempotency)`);
        return;
      }
    }
    if (Array.isArray(state.battlefield)) {
      const alreadyOnBattlefield = state.battlefield.some(
        (p: any) => p?.card?.id === cardId && p?.controller === playerId
      );
      if (alreadyOnBattlefield) {
        console.info(`castSpell: card ${cardId} already on battlefield for ${playerId}, skipping (replay idempotency)`);
        return;
      }
    }
  }
  
  if (typeof cardOrId === 'string') {
    // Find card in player's hand
    const z = zones[playerId];
    if (!z) {
      console.warn(`castSpell: no zone found for player ${playerId}`);
      return;
    }
    if (!Array.isArray(z.hand)) {
      console.warn(`castSpell: hand is not an array for player ${playerId} (type: ${typeof z.hand})`);
      return;
    }
    const handCards = z.hand as any[];
    const idx = handCards.findIndex((c: any) => c.id === cardOrId);
    if (idx === -1) {
      // During replay, card might not be in hand anymore - this is okay
      console.info(`castSpell: card ${cardOrId} not found in hand for player ${playerId} (may be replay)`);
      return;
    }
    // Remove card from hand
    card = handCards.splice(idx, 1)[0];
    z.handCount = handCards.length;
  } else {
    // Card object passed directly (legacy or event replay)
    card = cardOrId;
    if (!card) {
      console.warn(`castSpell: card is null or undefined for player ${playerId}`);
      return;
    }
    // Try to remove from hand if it exists there
    const z = zones[playerId];
    if (z && Array.isArray(z.hand)) {
      const handCards = z.hand as any[];
      const idx = handCards.findIndex((c: any) => c && c.id === card.id);
      if (idx !== -1) {
        handCards.splice(idx, 1);
        z.handCount = handCards.length;
      }
    }
  }
  
  // Build target details for display
  const targetDetails: Array<{ id: string; type: 'permanent' | 'player'; name?: string }> = [];
  if (targets && targets.length > 0) {
    for (const target of targets) {
      const targetId = typeof target === 'string' ? target : target.id;
      const targetKind = typeof target === 'object' ? target.kind : undefined;
      
      if (targetKind === 'player') {
        // Find player name
        const player = (state.players || []).find((p: any) => p.id === targetId);
        targetDetails.push({
          id: targetId,
          type: 'player',
          name: player?.name || targetId,
        });
      } else {
        // Find permanent name
        const perm = (state.battlefield || []).find((p: any) => p.id === targetId);
        targetDetails.push({
          id: targetId,
          type: 'permanent',
          name: perm?.card?.name || targetId,
        });
      }
    }
  }
  
  // Add to stack
  const stackItem = {
    id: uid("stack"),
    controller: playerId,
    card: { ...card, zone: "stack" },
    targets: targets || [],
    targetDetails: targetDetails.length > 0 ? targetDetails : undefined,
  };
  
  state.stack = state.stack || [];
  state.stack.push(stackItem as any);
  bumpSeq();
}

/**
 * Exile the entire stack to players' exile zones.
 *
 * Behavior:
 * - Moves all items from state.stack into each item's controller exile array under ctx.state.zones[controller].exile.
 * - Ensures ctx.state.zones[controller] exists and has exile array.
 * - Returns the number of items exiled.
 * - Bumps seq on success.
 *
 * Notes:
 * - This is intended for effects like Sundial of the Infinite. Caller should ensure correct timing/permissions.
 * - If no stack present it returns 0.
 */
export function exileEntireStack(ctx: GameContext, invokedBy?: PlayerID): number {
  const s = ctx.state;
  if (!s || !Array.isArray(s.stack) || s.stack.length === 0) return 0;

  try {
    const zones = s.zones = s.zones || {};
    const moved = s.stack.splice(0, s.stack.length);
    let count = 0;
    for (const item of moved) {
      const controller = (item && (item.controller as PlayerID)) || invokedBy || "unknown";
      // Ensure zones shape exists
      (zones[controller] as any) = (zones[controller] as any) || {
        hand: [],
        handCount: 0,
        libraryCount: ctx.libraries.get(controller)?.length ?? 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
      };
      const z = (zones[controller] as any);
      z.exile = z.exile || [];
      // Normalize card record pushed to exile
      if (item.card && typeof item.card === "object") {
        const cardObj = { ...(item.card as any), zone: "exile" };
        z.exile.push(cardObj);
      } else {
        z.exile.push({ id: item.id || uid("ex"), name: item.card?.name || "exiled_effect", zone: "exile" });
      }
      count++;
    }

    // Update counts for all affected players
    for (const pid of Object.keys(zones)) {
      const z = (zones as any)[pid];
      if (z) {
        z.graveyardCount = (z.graveyard || []).length;
        z.libraryCount = (ctx.libraries.get(pid) || []).length;
      }
    }

    ctx.bumpSeq();
    return count;
  } catch (err) {
    console.warn("exileEntireStack failed:", err);
    return 0;
  }
}