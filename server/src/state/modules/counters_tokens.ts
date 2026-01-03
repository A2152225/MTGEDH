import type { PlayerID } from "../../../../shared/src";
import type { GameContext } from "../context";
import { applyStateBasedActions, evaluateAction } from "../../rules-engine";
import { uid, parsePT } from "../utils";
import { recalculatePlayerEffects } from "./game-state-effects.js";
import { getDeathTriggers } from "./triggered-abilities.js";
import { getTokenImageUrls } from "../../services/tokens.js";
import { debug, debugWarn, debugError } from "../../utils/debug.js";

/**
 * Counter modification effects that double or halve counters
 * Examples: Vorinclex, Monstrous Raider; Doubling Season; Hardened Scales
 */
interface CounterModifier {
  permanentId: string;
  cardName: string;
  controller: PlayerID;
  doublesYourCounters: boolean;
  halvesOpponentCounters: boolean;
  addsBonusCounter: number; // For Hardened Scales (+1)
}

/**
 * Detect counter modification effects on the battlefield
 * Patterns:
 * - Vorinclex, Monstrous Raider: "If you would put one or more counters on a permanent or player, put twice that many of each of those kinds of counters on that permanent or player instead. If an opponent would put one or more counters on a permanent or player, they put half that many of each of those kinds of counters on that permanent or player instead, rounded down."
 * - Doubling Season: "If an effect would put one or more counters on a permanent you control, it puts twice that many of those counters on that permanent instead."
 * - Hardened Scales: "If one or more +1/+1 counters would be put on a creature you control, that many plus one +1/+1 counters are put on it instead."
 */
function detectCounterModifiers(gameState: any, targetPermanentController: PlayerID): CounterModifier[] {
  const modifiers: CounterModifier[] = [];
  const battlefield = gameState?.battlefield || [];
  
  for (const perm of battlefield) {
    if (!perm?.card) continue;
    const cardName = (perm.card.name || '').toLowerCase();
    const oracleText = (perm.card.oracle_text || '').toLowerCase();
    const controller = perm.controller;
    
    // Vorinclex, Monstrous Raider
    if (cardName.includes('vorinclex') && (cardName.includes('monstrous raider') || oracleText.includes('put twice that many'))) {
      modifiers.push({
        permanentId: perm.id,
        cardName: perm.card.name,
        controller,
        doublesYourCounters: controller === targetPermanentController,
        halvesOpponentCounters: controller !== targetPermanentController,
        addsBonusCounter: 0,
      });
    }
    
    // Doubling Season
    if (cardName.includes('doubling season') || (oracleText.includes('twice that many') && oracleText.includes('counter') && oracleText.includes('permanent you control'))) {
      if (controller === targetPermanentController) {
        modifiers.push({
          permanentId: perm.id,
          cardName: perm.card.name,
          controller,
          doublesYourCounters: true,
          halvesOpponentCounters: false,
          addsBonusCounter: 0,
        });
      }
    }
    
    // Hardened Scales (only affects +1/+1 counters on your creatures)
    if (cardName.includes('hardened scales') || (oracleText.includes('that many plus one') && oracleText.includes('+1/+1 counter'))) {
      if (controller === targetPermanentController) {
        modifiers.push({
          permanentId: perm.id,
          cardName: perm.card.name,
          controller,
          doublesYourCounters: false,
          halvesOpponentCounters: false,
          addsBonusCounter: 1,
        });
      }
    }
    
    // Branching Evolution
    if (cardName.includes('branching evolution') || (oracleText.includes('double that amount') && oracleText.includes('+1/+1 counter'))) {
      if (controller === targetPermanentController) {
        modifiers.push({
          permanentId: perm.id,
          cardName: perm.card.name,
          controller,
          doublesYourCounters: true,
          halvesOpponentCounters: false,
          addsBonusCounter: 0,
        });
      }
    }
    
    // Primal Vigor
    if (cardName.includes('primal vigor') && oracleText.includes('twice that many')) {
      // Primal Vigor affects all players' counters equally
      modifiers.push({
        permanentId: perm.id,
        cardName: perm.card.name,
        controller,
        doublesYourCounters: true,
        halvesOpponentCounters: false,
        addsBonusCounter: 0,
      });
    }
  }
  
  return modifiers;
}

/**
 * Apply counter modification effects (doubling, halving, bonus counters)
 * Order of application (per MTG rules):
 * 1. Halving effects (Vorinclex opponent penalty) - rounded down
 * 2. Doubling effects (Vorinclex, Doubling Season, etc.)
 * 3. Bonus counter effects (Hardened Scales +1)
 * 
 * Returns modified counter deltas
 * 
 * EXPORTED for use in stack.ts and other modules where counters are applied during ETB
 */
export function applyCounterModifications(
  gameState: any,
  targetPermanentId: string,
  deltas: Record<string, number>
): Record<string, number> {
  const targetPermanent = (gameState?.battlefield || []).find((p: any) => p.id === targetPermanentId);
  if (!targetPermanent) return deltas;
  
  const targetController = targetPermanent.controller;
  const modifiers = detectCounterModifiers(gameState, targetController);
  
  if (modifiers.length === 0) return deltas;
  
  const modified: Record<string, number> = {};
  
  for (const [counterType, rawAmount] of Object.entries(deltas)) {
    let amount = rawAmount;
    if (amount === 0) continue;
    
    // Only apply modifications when adding counters (positive amounts)
    if (amount > 0) {
      // STEP 1: Apply all halving effects first (Vorinclex opponent penalty)
      for (const mod of modifiers) {
        if (mod.halvesOpponentCounters) {
          const before = amount;
          amount = Math.floor(amount / 2);
          debug(2, `[applyCounterModifications] ${mod.cardName} halved counters: ${before} -> ${amount}`);
        }
      }
      
      // STEP 2: Apply all doubling effects (these compound: 2 doublers = 4x)
      for (const mod of modifiers) {
        if (mod.doublesYourCounters) {
          const before = amount;
          amount = amount * 2;
          debug(2, `[applyCounterModifications] ${mod.cardName} doubled counters: ${before} -> ${amount}`);
        }
      }
      
      // STEP 3: Apply bonus counter effects (Hardened Scales +1)
      // Only applies to +1/+1 counters being placed on creatures
      if (counterType.includes('+1/+1')) {
        for (const mod of modifiers) {
          if (mod.addsBonusCounter > 0) {
            const before = amount;
            amount += mod.addsBonusCounter;
            debug(2, `[applyCounterModifications] ${mod.cardName} added bonus: ${before} -> ${amount}`);
          }
        }
      }
    }
    
    modified[counterType] = amount;
  }
  
  return modified;
}

export function updateCounters(ctx: GameContext, permanentId: string, deltas: Record<string, number>) {
  const { state, bumpSeq } = ctx;
  const p = state.battlefield.find(b => b.id === permanentId);
  if (!p) return;
  
  // Apply counter modification effects (Vorinclex, Doubling Season, Hardened Scales, etc.)
  const modifiedDeltas = applyCounterModifications(state, permanentId, deltas);
  
  const current: Record<string, number> = { ...(p.counters ?? {}) };
  for (const [k, vRaw] of Object.entries(modifiedDeltas)) {
    const v = Math.floor(Number(vRaw) || 0);
    if (!v) continue;
    current[k] = (current[k] ?? 0) + v;
    if (current[k] <= 0) delete current[k];
  }
  p.counters = Object.keys(current).length ? current : undefined;
  bumpSeq();
  runSBA(ctx);
}

export function applyUpdateCountersBulk(ctx: GameContext, updates:{ permanentId:string; deltas:Record<string,number> }[]) {
  for (const u of updates) updateCounters(ctx, u.permanentId, u.deltas);
}

export function createToken(
  ctx: GameContext,
  controller: PlayerID,
  name: string,
  count = 1,
  basePower?: number,
  baseToughness?: number,
  options?: {
    colors?: string[];
    typeLine?: string;
    abilities?: string[];
    isArtifact?: boolean;
  }
) {
  const { state, bumpSeq } = ctx;
  
  // Apply token doubling effects (Anointed Procession, Doubling Season, Elspeth, etc.)
  // Import the function from stack.ts dynamically to avoid circular dependency
  let tokensToCreate = count;
  try {
    const battlefield = state.battlefield || [];
    let multiplier = 1;
    
    for (const perm of battlefield) {
      if (perm.controller !== controller) continue;
      const permName = (perm.card?.name || '').toLowerCase();
      const permOracle = (perm.card?.oracle_text || '').toLowerCase();
      
      // Ojer Taq: triples tokens (3x multiplier)
      if (permName.includes('ojer taq') ||
          (permOracle.includes('three times that many') && permOracle.includes('token'))) {
        multiplier = Math.max(multiplier, 3);
        continue;
      }
      
      // Token doublers (Anointed Procession, Doubling Season, Elspeth, etc.)
      if (permName.includes('anointed procession') ||
          permName.includes('parallel lives') ||
          permName.includes('doubling season') ||
          permName.includes('mondrak, glory dominus') ||
          permName.includes('primal vigor') ||
          (permName.includes('elspeth') && permOracle.includes('twice that many')) ||
          (permOracle.includes('twice that many') && permOracle.includes('token'))) {
        multiplier *= 2;
      }
    }
    
    tokensToCreate = count * multiplier;
    if (multiplier > 1) {
      debug(2, `[createToken] Token doubling: creating ${tokensToCreate} tokens (base: ${count}, multiplier: ${multiplier})`);
    }
  } catch (err) {
    debugWarn(1, "[createToken] Error calculating token doubling, using base count:", err);
  }
  
  // Build type line based on options
  let typeLine = options?.typeLine || 'Token Creature';
  if (!options?.typeLine) {
    // Auto-generate type line if not provided
    const parts = ['Token'];
    if (options?.isArtifact) parts.push('Artifact');
    parts.push('Creature');
    if (name) parts.push(`— ${name}`);
    typeLine = parts.join(' ');
  }
  
  // Get token image URLs from the token service (pass abilities for exact matching)
  const imageUrls = getTokenImageUrls(name, basePower, baseToughness, options?.colors, options?.abilities);
  
  for (let i = 0; i < Math.max(1, tokensToCreate | 0); i++) {
    state.battlefield.push({
      id: uid("tok"),
      controller,
      owner: controller,
      tapped: false,
      counters: {},
      basePower,
      baseToughness,
      summoningSickness: true, // Creatures have summoning sickness when they enter
      isToken: true,
      card: { 
        id: uid("card"), 
        name, 
        type_line: typeLine, 
        zone: "battlefield",
        colors: options?.colors || [],
        image_uris: imageUrls,
        oracle_text: options?.abilities?.join('. ') || '',
        keywords: options?.abilities || [],
      } as any  // Cast to any to allow keywords field
    } as any);
  }
  bumpSeq();
  runSBA(ctx);
}

/**
 * Move a permanent from battlefield to graveyard.
 * Rule 111.7: Tokens cease to exist when they leave the battlefield - they don't go to graveyard.
 * Rule 700.4: Both tokens and non-tokens "die" and trigger death effects.
 * 
 * @param ctx - Game context
 * @param permanentId - ID of the permanent to move
 * @param triggerDeathEffects - Whether to trigger death effects (for creatures)
 * @returns true if the permanent was moved/removed, false if not found
 */
export function movePermanentToGraveyard(ctx: GameContext, permanentId: string, triggerDeathEffects = true): boolean {
  const { state, bumpSeq, commandZone } = ctx;
  const zones = state.zones = state.zones || {};
  const idx = state.battlefield.findIndex(p => p.id === permanentId);
  if (idx < 0) return false;
  
  const perm = state.battlefield.splice(idx, 1)[0];
  const owner = (perm as any).owner || (perm as any).controller;
  const controller = (perm as any).controller || owner;
  const card = (perm as any).card;
  const isToken = (perm as any).isToken === true;
  const isCreature = (card?.type_line || '').toLowerCase().includes('creature');
  
  // Fire death triggers BEFORE the creature leaves (for both tokens and non-tokens)
  // Rule 700.4: "Dies" means "is put into a graveyard from the battlefield"
  // Tokens still "die" even though they don't end up in the graveyard
  if (triggerDeathEffects && isCreature) {
    try {
      // Check for self death triggers (Aerith Gainsborough, etc.)
      const cardName = (card?.name || '').toLowerCase();
      const oracleText = (card?.oracle_text || '').toLowerCase();
      
      // Aerith Gainsborough: "When Aerith Gainsborough dies, put X +1/+1 counters on each legendary creature you control"
      if (cardName.includes('aerith gainsborough') || 
          (oracleText.includes('when') && oracleText.includes('dies') && 
           oracleText.includes('put') && oracleText.includes('+1/+1 counter') && 
           oracleText.includes('legendary creature you control'))) {
        const countersOnAerith = (perm as any).counters?.['+1/+1'] || 0;
        if (countersOnAerith > 0) {
          // Apply counters to each legendary creature you control
          const battlefield = state.battlefield || [];
          for (const p of battlefield) {
            if (!p || p.controller !== controller) continue;
            const typeLine = ((p.card as any)?.type_line || '').toLowerCase();
            if (typeLine.includes('legendary') && typeLine.includes('creature')) {
              // Apply counter modifiers (Doubling Season, Vorinclex, etc.)
              const deltas = { '+1/+1': countersOnAerith };
              const modifiedDeltas = applyCounterModifications(state, p.id, deltas);
              
              const current: Record<string, number> = { ...(p.counters ?? {}) };
              for (const [k, v] of Object.entries(modifiedDeltas)) {
                current[k] = (current[k] ?? 0) + v;
                if (current[k] <= 0) delete current[k];
              }
              p.counters = Object.keys(current).length ? current : undefined;
            }
          }
          
          // Run SBA after distributing counters
          runSBA(ctx);
        }
      }
      
      const deathTriggers = getDeathTriggers(ctx, perm, controller);
      if (deathTriggers.length > 0) {
        debug(2, `[movePermanentToGraveyard] Found ${deathTriggers.length} death trigger(s) for ${isToken ? 'token ' : ''}${card?.name || perm.id}`);
        
        // Push death triggers onto the stack
        state.stack = state.stack || [];
        for (const trigger of deathTriggers) {
          const triggerId = uid("trigger");
          state.stack.push({
            id: triggerId,
            type: 'triggered_ability',
            controller: trigger.source.controllerId,
            source: trigger.source.permanentId,
            sourceName: trigger.source.cardName,
            description: trigger.effect,
            triggerType: 'creature_dies',
            mandatory: true,
          } as any);
        }
      }
      
      // Yuna, Grand Summoner: "Whenever another permanent you control is put into a graveyard from the battlefield, 
      // if it had one or more counters on it, you may put that number of +1/+1 counters on target creature."
      // Death's Presence: "Whenever a creature you control dies, put X +1/+1 counters on target creature you control, 
      // where X is the power of the creature that died."
      const battlefield = state.battlefield || [];
      const dyingPermanentCounters: Record<string, number> = (perm as any).counters || {};
      let totalCountersOnDying = 0;
      for (const count of Object.values(dyingPermanentCounters)) {
        if (typeof count === 'number') {
          totalCountersOnDying += count;
        }
      }
      const dyingCreaturePower = isCreature ? (parsePT((perm as any).card?.power) || 0) : 0;
      
      for (const p of battlefield) {
        if (!p || p.controller !== controller) continue;
        const permCardName = ((p.card as any)?.name || '').toLowerCase();
        const permOracleText = ((p.card as any)?.oracle_text || '').toLowerCase();
        
        // Yuna, Grand Summoner trigger
        if ((permCardName.includes('yuna') && permCardName.includes('grand summoner')) ||
            (permOracleText.includes('whenever another permanent you control') && 
             permOracleText.includes('graveyard from the battlefield') &&
             permOracleText.includes('if it had one or more counters'))) {
          if (totalCountersOnDying > 0) {
            // Create a triggered ability that requires target selection
            state.stack = state.stack || [];
            state.stack.push({
              id: uid("trigger"),
              type: 'triggered_ability',
              controller: controller,
              source: p.id,
              sourceName: (p.card as any)?.name || 'Yuna, Grand Summoner',
              description: `Put ${totalCountersOnDying} +1/+1 counter(s) on target creature`,
              triggerType: 'yuna_counter_transfer',
              countersToAdd: totalCountersOnDying,
              requiresTarget: true,
              targetType: 'creature',
              mandatory: false,
            } as any);
          }
        }
        
        // Death's Presence trigger
        if (isCreature && (permCardName.includes("death's presence") ||
            (permOracleText.includes('whenever a creature you control dies') &&
             permOracleText.includes('put x +1/+1 counters') &&
             permOracleText.includes('power of the creature that died')))) {
          if (dyingCreaturePower > 0) {
            // Create a triggered ability that requires target selection
            state.stack = state.stack || [];
            state.stack.push({
              id: uid("trigger"),
              type: 'triggered_ability',
              controller: controller,
              source: p.id,
              sourceName: (p.card as any)?.name || "Death's Presence",
              description: `Put ${dyingCreaturePower} +1/+1 counter(s) on target creature you control`,
              triggerType: 'deaths_presence',
              countersToAdd: dyingCreaturePower,
              requiresTarget: true,
              targetType: 'creature_you_control',
              mandatory: true,
            } as any);
          }
        }
      }
    } catch (err) {
      debugWarn(1, `[movePermanentToGraveyard] Error processing death triggers:`, err);
    }
  }
  
  // Rule 111.7: Tokens cease to exist when in any zone other than battlefield
  if (isToken) {
    debug(2, `[movePermanentToGraveyard] Token ${card?.name || perm.id} ceased to exist (left battlefield)`);
    bumpSeq();
    return true; // Token ceased to exist (death triggers already fired above)
  }
  
  // Commander Replacement Effect (Rule 903.9a):
  // If a commander would be put into graveyard from anywhere, its owner may put it into
  // the command zone instead.
  // IMPORTANT: We must defer the zone change until the player chooses!
  const commanderInfo = commandZone?.[owner];
  const commanderIds = commanderInfo?.commanderIds || [];
  // Check if this is a commander - check both the card ID and the permanent's isCommander flag
  const isCommander = (card?.id && commanderIds.includes(card.id)) || (perm as any).isCommander === true;
  
  if (isCommander && card) {
    // Set up pending choice - DO NOT move to graveyard yet
    (state as any).pendingCommanderZoneChoice = (state as any).pendingCommanderZoneChoice || {};
    (state as any).pendingCommanderZoneChoice[owner] = (state as any).pendingCommanderZoneChoice[owner] || [];
    (state as any).pendingCommanderZoneChoice[owner].push({
      commanderId: card.id,
      commanderName: card.name,
      destinationZone: 'graveyard',
      card: {
        id: card.id,
        name: card.name,
        type_line: card.type_line,
        oracle_text: card.oracle_text,
        image_uris: card.image_uris,
        mana_cost: card.mana_cost,
        power: card.power,
        toughness: card.toughness,
      },
    });
    debug(2, `[movePermanentToGraveyard] Commander ${card.name} would go to graveyard - DEFERRING zone change for player choice`);
    
    // Add to resolution queue for modal display
    try {
      // Dynamically import ResolutionQueueManager to avoid circular dependencies
      import('../../state/resolution/index.js').then(({ ResolutionQueueManager }) => {
        import('../../state/resolution/types.js').then(({ ResolutionStepType }) => {
          const gameId = (ctx as any).gameId || (state as any).gameId;
          if (gameId) {
            ResolutionQueueManager.addStep(gameId, {
              type: ResolutionStepType.COMMANDER_ZONE_CHOICE,
              playerId: owner,
              description: `Choose where to put ${card.name}`,
              mandatory: true,
              commanderId: card.id,
              commanderName: card.name,
              fromZone: 'graveyard',
              card: {
                id: card.id,
                name: card.name,
                type_line: card.type_line,
                oracle_text: card.oracle_text,
                image_uris: card.image_uris,
                mana_cost: card.mana_cost,
                power: card.power,
                toughness: card.toughness,
              },
            });
            debug(2, `[movePermanentToGraveyard] Added commander zone choice to resolution queue for ${card.name}`);
          }
        });
      }).catch(err => {
        debugWarn(1, '[movePermanentToGraveyard] Failed to add commander choice to resolution queue:', err);
      });
    } catch (err) {
      debugWarn(1, '[movePermanentToGraveyard] Failed to import ResolutionQueueManager:', err);
    }
    
    // Remove from battlefield but DON'T add to graveyard yet - wait for player choice
    bumpSeq();
    
    // Recalculate player effects when permanents leave
    try {
      recalculatePlayerEffects(ctx);
    } catch (err) {
      debugWarn(1, '[movePermanentToGraveyard] Failed to recalculate player effects:', err);
    }
    
    return true; // Zone change deferred for commander
  }
  
  // Move to owner's graveyard (non-commander cards)
  if (owner) {
    const ownerZone = zones[owner] = zones[owner] || { hand: [], graveyard: [], handCount: 0, graveyardCount: 0, libraryCount: 0 };
    (ownerZone as any).graveyard = (ownerZone as any).graveyard || [];
    if (card) {
      (ownerZone as any).graveyard.push({ ...card, zone: "graveyard" });
      (ownerZone as any).graveyardCount = (ownerZone as any).graveyard.length;
    }
  }
  
  bumpSeq();
  
  // Recalculate player effects when permanents leave
  try {
    recalculatePlayerEffects(ctx);
  } catch (err) {
    debugWarn(1, '[movePermanentToGraveyard] Failed to recalculate player effects:', err);
  }
  
  return true;
}

export function removePermanent(ctx: GameContext, permanentId: string) {
  const { state, bumpSeq } = ctx;
  const idx = state.battlefield.findIndex(p => p.id === permanentId);
  if (idx >= 0) {
    state.battlefield.splice(idx,1);
    bumpSeq();
    runSBA(ctx);
    
    // Recalculate player effects when permanents leave (for Exploration, Font of Mythos, etc.)
    try {
      recalculatePlayerEffects(ctx);
    } catch (err) {
      debugWarn(1, '[removePermanent] Failed to recalculate player effects:', err);
    }
  }
}

export function movePermanentToExile(ctx: GameContext, permanentId: string) {
  const { state, bumpSeq, commandZone } = ctx;
  const zones = state.zones = state.zones || {};
  const idx = state.battlefield.findIndex(p => p.id === permanentId);
  if (idx < 0) return;
  const perm = state.battlefield.splice(idx,1)[0];
  const owner = perm.owner as PlayerID;
  const card = perm.card as any;
  
  // Rule 111.7: A token that's in a zone other than the battlefield ceases to exist.
  // Tokens don't go to exile - they cease to exist as a state-based action.
  const isToken = (perm as any).isToken === true;
  if (isToken) {
    debug(2, `[movePermanentToExile] Token ${card?.name || perm.id} ceased to exist (left battlefield for exile)`);
    bumpSeq();
    return; // Token ceases to exist, don't add to exile
  }
  
  // Commander Replacement Effect (Rule 903.9a):
  // If a commander would be put into exile from anywhere, its owner may put it into
  // the command zone instead.
  // IMPORTANT: We must defer the zone change until the player chooses!
  const commanderInfo = commandZone?.[owner];
  const commanderIds = commanderInfo?.commanderIds || [];
  // Check if this is a commander - check both the card ID and the permanent's isCommander flag
  const isCommander = (card?.id && commanderIds.includes(card.id)) || (perm as any).isCommander === true;
  
  if (isCommander && card) {
    // Add to pending commander zone choices for the owner to decide
    // The player will be prompted to choose whether to move to command zone or exile
    // DO NOT move to exile yet - wait for player choice
    (state as any).pendingCommanderZoneChoice = (state as any).pendingCommanderZoneChoice || {};
    (state as any).pendingCommanderZoneChoice[owner] = (state as any).pendingCommanderZoneChoice[owner] || [];
    (state as any).pendingCommanderZoneChoice[owner].push({
      commanderId: card.id,
      commanderName: card.name,
      destinationZone: 'exile',
      card: {
        id: card.id,
        name: card.name,
        type_line: card.type_line,
        oracle_text: card.oracle_text,
        image_uris: card.image_uris,
        mana_cost: card.mana_cost,
        power: card.power,
        toughness: card.toughness,
      },
    });
    debug(2, `[movePermanentToExile] Commander ${card.name} would go to exile - DEFERRING zone change for player choice`);
    
    // Add to resolution queue for modal display
    try {
      // Dynamically import ResolutionQueueManager to avoid circular dependencies
      import('../../state/resolution/index.js').then(({ ResolutionQueueManager }) => {
        import('../../state/resolution/types.js').then(({ ResolutionStepType }) => {
          const gameId = (ctx as any).gameId || (state as any).gameId;
          if (gameId) {
            ResolutionQueueManager.addStep(gameId, {
              type: ResolutionStepType.COMMANDER_ZONE_CHOICE,
              playerId: owner,
              description: `Choose where to put ${card.name}`,
              mandatory: true,
              commanderId: card.id,
              commanderName: card.name,
              fromZone: 'exile',
              card: {
                id: card.id,
                name: card.name,
                type_line: card.type_line,
                oracle_text: card.oracle_text,
                image_uris: card.image_uris,
                mana_cost: card.mana_cost,
                power: card.power,
                toughness: card.toughness,
              },
            });
            debug(2, `[movePermanentToExile] Added commander zone choice to resolution queue for ${card.name}`);
          }
        });
      }).catch(err => {
        debugWarn(1, '[movePermanentToExile] Failed to add commander choice to resolution queue:', err);
      });
    } catch (err) {
      debugWarn(1, '[movePermanentToExile] Failed to import ResolutionQueueManager:', err);
    }
    
    bumpSeq();
    return; // Zone change deferred for commander - don't add to exile yet
  }
  
  // Move to exile zone (non-commander cards)
  const z = zones[owner] || (zones[owner] = { hand:[], handCount:0, libraryCount:0, graveyard:[], graveyardCount:0, exile:[] } as any);
  const kc = {
    id: card.id,
    name: card.name,
    type_line: card.type_line,
    oracle_text: card.oracle_text,
    image_uris: card.image_uris,
    mana_cost: card.mana_cost,
    power: card.power,
    toughness: card.toughness,
    zone: "exile"
  };
  (z as any).exile = (z as any).exile || [];
  (z as any).exile.push(kc);
  bumpSeq();
}

/**
 * Run state-based actions (SBA) per MTG rules.
 * 
 * This handles creatures dying due to:
 * - 0 or less toughness (from -1/-1 counters, effects, etc.)
 * - Lethal damage marked
 * - Deathtouch damage
 * 
 * Note: This does NOT double-trigger with movePermanentToGraveyard() because:
 * - applyStateBasedActions() only checks creatures CURRENTLY on the battlefield
 * - If a creature was already removed by sacrifice/destroy spell, it won't be found here
 * - Each creature dies exactly once through exactly one code path
 */
export function runSBA(ctx: GameContext) {
  const { state, bumpSeq } = ctx;
  
  // FIRST: Handle bestow/reconfigure creatures that need to unattach and restore stats
  // This must happen BEFORE applyStateBasedActions so the restored stats prevent 0-toughness destruction
  let unattachChanged = false;
  for (const perm of state.battlefield) {
    const typeLine = ((perm as any).card?.type_line || '').toLowerCase();
    const oracleText = ((perm as any).card?.oracle_text || '').toLowerCase();
    const isEnchantmentCreature = typeLine.includes('enchantment') && typeLine.includes('creature');
    const hasBestowOrReconfigure = oracleText.includes('bestow') || oracleText.includes('reconfigure');
    
    if (isEnchantmentCreature && hasBestowOrReconfigure && (perm as any).attachedTo) {
      // Check if the attached target still exists
      const targetExists = state.battlefield.some(p => p.id === (perm as any).attachedTo);
      if (!targetExists) {
        // Target is gone - unattach and restore creature stats
        debug(2, `[runSBA] ${(perm as any).card?.name} unattaching (bestow/reconfigure target gone), restoring creature stats`);
        (perm as any).attachedTo = undefined;
        
        // Restore creature stats from the card if they're missing
        if ((perm as any).basePower === undefined || (perm as any).baseToughness === undefined) {
          const cardPower = (perm as any).card?.power;
          const cardToughness = (perm as any).card?.toughness;
          
          if (cardPower !== undefined) {
            const parsed = parsePT(cardPower);
            if (parsed !== undefined) {
              (perm as any).basePower = parsed;
              debug(2, `[runSBA] Restored basePower to ${parsed}`);
            }
          }
          if (cardToughness !== undefined) {
            const parsed = parsePT(cardToughness);
            if (parsed !== undefined) {
              (perm as any).baseToughness = parsed;
              debug(2, `[runSBA] Restored baseToughness to ${parsed}`);
            }
          }
        }
        unattachChanged = true;
      }
    }
  }
  
  // NOW run the standard SBA checks
  const res = applyStateBasedActions(state);
  let changed = unattachChanged;
  
  // Handle players who have lost due to life <= 0 (Rule 704.5a)
  if (res.playersLost && res.playersLost.length > 0) {
    for (const playerId of res.playersLost) {
      const player = state.players?.find((p: any) => p && p.id === playerId);
      if (player && !player.hasLost) {
        player.hasLost = true;
        player.lostReason = 'Life total reached 0 or less';
        debug(1, `[runSBA] Player ${playerId} has lost the game (life <= 0)`);
        changed = true;
      }
    }
  }
  
  for (const upd of res.counterUpdates) {
    const perm = state.battlefield.find(b => b.id === upd.permanentId);
    if (!perm) continue;
    const before = perm.counters ?? {};
    const after = upd.counters;
    const same = Object.keys(before).length === Object.keys(after).length &&
      Object.keys(after).every(k => (before as any)[k] === (after as any)[k]);
    if (!same) { perm.counters = Object.keys(after).length ? { ...after } : undefined; changed = true; }
  }
  if (res.destroys.length) {
    const zones = state.zones = state.zones || {};
    for (const id of res.destroys) {
      const idx = state.battlefield.findIndex(b => b.id === id);
      if (idx >= 0) { 
        const destroyed = state.battlefield.splice(idx, 1)[0];
        const isToken = (destroyed as any).isToken === true;
        const isCreature = ((destroyed as any).card?.type_line || '').toLowerCase().includes('creature');
        const controller = (destroyed as any).controller || (destroyed as any).owner;
        
        // Fire death triggers for ALL creatures (including tokens) BEFORE they leave/cease to exist
        // Rule 700.4: The term "dies" means "is put into a graveyard from the battlefield"
        // Even though tokens don't actually go to the graveyard, they still "die" and trigger death effects
        if (isCreature) {
          try {
            const deathTriggers = getDeathTriggers(ctx, destroyed, controller);
            if (deathTriggers.length > 0) {
              debug(2, `[runSBA] Found ${deathTriggers.length} death trigger(s) for ${isToken ? 'token ' : ''}${(destroyed as any).card?.name || destroyed.id}`);
              
              // Push death triggers onto the stack
              state.stack = state.stack || [];
              for (const trigger of deathTriggers) {
                const triggerId = uid("trigger");
                state.stack.push({
                  id: triggerId,
                  type: 'triggered_ability',
                  controller: trigger.source.controllerId,
                  source: trigger.source.permanentId,
                  sourceName: trigger.source.cardName,
                  description: trigger.effect,
                  triggerType: 'creature_dies',
                  mandatory: true,
                } as any);
              }
            }
          } catch (err) {
            debugWarn(1, `[runSBA] Error processing death triggers:`, err);
          }
        }
        
        // Rule 111.7: A token that's in a zone other than the battlefield ceases to exist.
        // Tokens don't go to the graveyard - they cease to exist as a state-based action.
        if (isToken) {
          debug(2, `[runSBA] Token ${(destroyed as any).card?.name || destroyed.id} ceased to exist (left battlefield)`);
          changed = true;
          continue; // Token ceases to exist, don't add to graveyard
        }
        
        // Move non-token to owner's graveyard (SBA - creatures die)
        const owner = (destroyed as any).owner || (destroyed as any).controller;
        if (owner) {
          const ownerZone = zones[owner] = zones[owner] || { hand: [], graveyard: [], handCount: 0, graveyardCount: 0, libraryCount: 0 };
          (ownerZone as any).graveyard = (ownerZone as any).graveyard || [];
          const card = (destroyed as any).card;
          if (card) {
            (ownerZone as any).graveyard.push({ ...card, zone: "graveyard" });
            (ownerZone as any).graveyardCount = (ownerZone as any).graveyard.length;
          }
        }
        changed = true; 
      }
    }
  }
  
  // CR 704.5j: Legend Rule - If a player controls two or more legendary permanents
  // with the same name, that player chooses one of them, and the rest are put into
  // their owners' graveyards.
  // 
  // Handle legend rule violations by prompting the player to choose which to keep
  if (res.legendRuleViolations && res.legendRuleViolations.length > 0) {
    // Group violations by controller + name
    const violationsByKey = new Map<string, typeof state.battlefield>();
    
    for (const permId of res.legendRuleViolations) {
      const perm = state.battlefield.find(p => p.id === permId);
      if (!perm) continue;
      
      const controller = (perm as any).controller || (perm as any).owner || '';
      const cardName = (perm.card as any)?.name || perm.id; // Use permanent ID as fallback if no name
      
      // Skip permanents without a name (shouldn't happen for legendaries, but be safe)
      if (!(perm.card as any)?.name) continue;
      
      const key = `${controller}:${cardName}`;
      
      const existing = violationsByKey.get(key) || [];
      existing.push(perm);
      violationsByKey.set(key, existing);
    }
    
    // For each group of duplicate legendaries, need to keep only one
    // Since we can't synchronously prompt the user, we'll handle this by:
    // 1. If a player has multiple copies of the same legendary, keep the first one (by timestamp/order)
    // 2. Move the rest to graveyard
    // This is a simplification; a full implementation would use ResolutionQueueManager
    // to prompt the player to choose which to keep
    const zones = state.zones = state.zones || {};
    
    for (const [key, perms] of violationsByKey) {
      if (perms.length <= 1) continue;
      
      // Keep the first one (oldest by array position), sacrifice the rest
      // In a full implementation, we'd let the player choose
      const [keep, ...toSacrifice] = perms;
      
      const controller = (keep as any).controller || '';
      const cardName = (keep.card as any)?.name || '';
      
      debug(1, `[runSBA] Legend Rule: ${controller} controls ${perms.length} copies of ${cardName}, keeping first and sacrificing ${toSacrifice.length}`);
      
      for (const toRemove of toSacrifice) {
        const idx = state.battlefield.findIndex(b => b.id === toRemove.id);
        if (idx >= 0) {
          const removed = state.battlefield.splice(idx, 1)[0];
          const owner = (removed as any).owner || (removed as any).controller;
          const isToken = (removed as any).isToken === true;
          
          // Tokens cease to exist
          if (isToken) {
            debug(2, `[runSBA] Legend Rule: Token ${cardName} ceased to exist`);
            changed = true;
            continue;
          }
          
          // Move to owner's graveyard
          if (owner) {
            const ownerZone = zones[owner] = zones[owner] || { hand: [], graveyard: [], handCount: 0, graveyardCount: 0, libraryCount: 0 };
            (ownerZone as any).graveyard = (ownerZone as any).graveyard || [];
            const card = (removed as any).card;
            if (card) {
              (ownerZone as any).graveyard.push({ ...card, zone: "graveyard" });
              (ownerZone as any).graveyardCount = (ownerZone as any).graveyard.length;
            }
          }
          changed = true;
        }
      }
    }
  }
  
  // Rule 111.7: Clean up tokens in non-battlefield zones
  // A token that's in a zone other than the battlefield ceases to exist as a state-based action
  const zones = state.zones || {};
  for (const playerId of Object.keys(zones)) {
    const playerZones = zones[playerId];
    if (!playerZones) continue;
    
    // Clean tokens from graveyard
    // Note: Tokens may be identified by:
    // - card.isToken flag (if copied from permanent)
    // - card name starting with "Token" in type_line
    // - isToken flag directly on the card object
    if (Array.isArray(playerZones.graveyard)) {
      const beforeCount = playerZones.graveyard.length;
      playerZones.graveyard = playerZones.graveyard.filter((card: any) => {
        // Check all possible token indicators
        if (card.isToken) return false;
        if (card.card?.isToken) return false; // If the graveyard entry has a nested card object
        const typeLine = (card.type_line || card.card?.type_line || '').toLowerCase();
        if (typeLine.includes('token')) return false;
        return true;
      }) as any;
      if (playerZones.graveyard.length !== beforeCount) {
        playerZones.graveyardCount = playerZones.graveyard.length;
        debug(2, `[runSBA] Removed ${beforeCount - playerZones.graveyard.length} token(s) from ${playerId}'s graveyard`);
        changed = true;
      }
    }
    
    // Clean tokens from exile
    // Note: Same token detection logic as graveyard
    if (Array.isArray(playerZones.exile)) {
      const beforeCount = playerZones.exile.length;
      playerZones.exile = playerZones.exile.filter((card: any) => {
        if (card.isToken) return false;
        if (card.card?.isToken) return false;
        const typeLine = (card.type_line || card.card?.type_line || '').toLowerCase();
        if (typeLine.includes('token')) return false;
        return true;
      }) as any;
      if (playerZones.exile.length !== beforeCount) {
        playerZones.exileCount = playerZones.exile.length;
        debug(2, `[runSBA] Removed ${beforeCount - playerZones.exile.length} token(s) from ${playerId}'s exile`);
        changed = true;
      }
    }
    
    // Clean tokens from hand (unlikely but possible)
    // Note: Same token detection logic as graveyard
    if (Array.isArray(playerZones.hand)) {
      const beforeCount = playerZones.hand.length;
      playerZones.hand = playerZones.hand.filter((card: any) => {
        if (card.isToken) return false;
        if (card.card?.isToken) return false;
        const typeLine = (card.type_line || card.card?.type_line || '').toLowerCase();
        if (typeLine.includes('token')) return false;
        return true;
      }) as any;
      if (playerZones.hand.length !== beforeCount) {
        playerZones.handCount = playerZones.hand.length;
        debug(2, `[runSBA] Removed ${beforeCount - playerZones.hand.length} token(s) from ${playerId}'s hand`);
        changed = true;
      }
    }
    
    // Clean tokens from library (shouldn't happen but be thorough)
    // Note: Same token detection logic as graveyard
    const library = (ctx as any).libraries?.get(playerId);
    if (Array.isArray(library)) {
      const beforeCount = library.length;
      const cleanedLibrary = library.filter((card: any) => {
        if (card.isToken) return false;
        if (card.card?.isToken) return false;
        const typeLine = (card.type_line || card.card?.type_line || '').toLowerCase();
        if (typeLine.includes('token')) return false;
        return true;
      });
      if (cleanedLibrary.length !== beforeCount) {
        (ctx as any).libraries.set(playerId, cleanedLibrary);
        if (playerZones.libraryCount !== undefined) {
          playerZones.libraryCount = cleanedLibrary.length;
        }
        debug(2, `[runSBA] Removed ${beforeCount - cleanedLibrary.length} token(s) from ${playerId}'s library`);
        changed = true;
      }
    }
  }
  
  // Update god creature status based on devotion (Rule 704.5n - gods with insufficient devotion aren't creatures)
  updateGodCreatureStatus(ctx);
  
  if (changed) bumpSeq();
}

export function applyEngineEffects(ctx: GameContext, effects: readonly any[]) {
  if (!effects.length) return;
  for (const eff of effects) {
    switch (eff.kind) {
      case "AddCounters": updateCounters(ctx, eff.permanentId, { [eff.counter]: eff.amount }); break;
      case "DestroyPermanent": removePermanent(ctx, eff.permanentId); break;
    }
  }
}

/**
 * Calculate devotion to a color for a player based on their permanents
 * Devotion = sum of all instances of the color's mana symbol in mana costs of permanents they control
 * 
 * @param ctx Game context
 * @param playerId Player to calculate devotion for
 * @param color Color symbol (W, U, B, R, G)
 * @returns Total devotion to that color
 */
export function calculateDevotion(ctx: GameContext, playerId: PlayerID, color: string): number {
  const { state } = ctx;
  const battlefield = state.battlefield || [];
  
  let devotion = 0;
  const colorUpper = color.toUpperCase();
  
  for (const perm of battlefield) {
    if (perm.controller !== playerId) continue;
    
    const manaCost = (perm.card as any)?.mana_cost || '';
    
    // Count occurrences of the color symbol
    const regex = new RegExp(`\\{${colorUpper}\\}`, 'gi');
    const matches = manaCost.match(regex);
    if (matches) devotion += matches.length;
    
    // Also check hybrid mana symbols (e.g., {W/U}, {R/G})
    const hybridRegex = /\{([WUBRG])\/([WUBRG])\}/gi;
    let hybridMatch;
    while ((hybridMatch = hybridRegex.exec(manaCost)) !== null) {
      if (hybridMatch[1].toUpperCase() === colorUpper || hybridMatch[2].toUpperCase() === colorUpper) {
        devotion++;
      }
    }
    
    // Phyrexian hybrid mana (e.g., {W/P})
    const phyrexianRegex = /\{([WUBRG])\/P\}/gi;
    let phyrexMatch;
    while ((phyrexMatch = phyrexianRegex.exec(manaCost)) !== null) {
      if (phyrexMatch[1].toUpperCase() === colorUpper) {
        devotion++;
      }
    }
  }
  
  return devotion;
}

/**
 * Update all Theros-style gods on the battlefield based on devotion
 * Gods are creatures only when devotion to their color(s) meets the threshold
 * 
 * @param ctx Game context
 */
export function updateGodCreatureStatus(ctx: GameContext): void {
  const { state, bumpSeq } = ctx;
  const battlefield = state.battlefield || [];
  
  let changed = false;
  
  for (const perm of battlefield) {
    const typeLine = ((perm.card as any)?.type_line || '').toLowerCase();
    const oracleText = ((perm.card as any)?.oracle_text || '').toLowerCase();
    
    // Check if this is a Theros-style god
    if (!typeLine.includes('god') || !typeLine.includes('creature')) continue;
    
    // Check for devotion requirement pattern
    const devotionMatch = oracleText.match(/devotion to (\w+)(?:\s+and\s+(\w+))? is less than (\d+)/i);
    if (!devotionMatch) continue;
    
    const color1 = devotionMatch[1].toLowerCase();
    const color2 = devotionMatch[2]?.toLowerCase();
    const threshold = parseInt(devotionMatch[3], 10);
    
    // Map color words to mana symbols
    const colorToSymbol: Record<string, string> = {
      'white': 'W', 'blue': 'U', 'black': 'B', 'red': 'R', 'green': 'G'
    };
    const symbol1 = colorToSymbol[color1] || color1.charAt(0).toUpperCase();
    const symbol2 = color2 ? (colorToSymbol[color2] || color2.charAt(0).toUpperCase()) : null;
    
    // Calculate devotion
    let devotion = calculateDevotion(ctx, perm.controller as PlayerID, symbol1);
    if (symbol2) {
      devotion += calculateDevotion(ctx, perm.controller as PlayerID, symbol2);
    }
    
    // Store calculated devotion for reference
    (perm as any).calculatedDevotion = devotion;
    
    // Determine if god is a creature
    const wasCreature = !(perm as any).notCreature;
    const isCreature = devotion >= threshold;
    
    if (isCreature !== wasCreature) {
      (perm as any).notCreature = !isCreature;
      changed = true;
      debug(2, `[updateGodCreatureStatus] ${(perm.card as any)?.name}: devotion ${devotion}/${threshold} - ${isCreature ? 'IS' : 'NOT'} a creature`);
    }
  }
  
  if (changed) bumpSeq();
}
