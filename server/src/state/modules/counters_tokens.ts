import type { PlayerID } from "../../../../shared/src";
import type { GameContext } from "../context";
import { applyStateBasedActions, evaluateAction } from "../../rules-engine";
import { uid } from "../utils";
import { recalculatePlayerEffects } from "./game-state-effects.js";

export function updateCounters(ctx: GameContext, permanentId: string, deltas: Record<string, number>) {
  const { state, bumpSeq } = ctx;
  const p = state.battlefield.find(b => b.id === permanentId);
  if (!p) return;
  const current: Record<string, number> = { ...(p.counters ?? {}) };
  for (const [k, vRaw] of Object.entries(deltas)) {
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
  baseToughness?: number
) {
  const { state, bumpSeq } = ctx;
  for (let i = 0; i < Math.max(1, count | 0); i++) {
    state.battlefield.push({
      id: uid("tok"),
      controller,
      owner: controller,
      tapped: false,
      counters: {},
      basePower,
      baseToughness,
      card: { id: uid("card"), name, type_line: "Token Creature", zone: "battlefield" }
    });
  }
  bumpSeq();
  runSBA(ctx);
}

/**
 * Move a permanent from battlefield to graveyard.
 * Rule 111.7: Tokens cease to exist when they leave the battlefield - they don't go to graveyard.
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
  const card = (perm as any).card;
  const isToken = (perm as any).isToken === true;
  const isCreature = (card?.type_line || '').toLowerCase().includes('creature');
  
  // Rule 111.7: Tokens cease to exist when in any zone other than battlefield
  if (isToken) {
    console.log(`[movePermanentToGraveyard] Token ${card?.name || perm.id} ceased to exist (left battlefield)`);
    bumpSeq();
    // Still trigger death effects for token creatures (Grave Pact, Blood Artist, etc.)
    // The token "dies" even though it doesn't go to the graveyard
    return true;
  }
  
  // Commander Replacement Effect (Rule 903.9a):
  // If a commander would be put into graveyard from anywhere, its owner may put it into
  // the command zone instead.
  const commanderInfo = commandZone?.[owner];
  const commanderIds = commanderInfo?.commanderIds || [];
  const isCommander = card?.id && commanderIds.includes(card.id);
  
  if (isCommander) {
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
    console.log(`[movePermanentToGraveyard] Commander ${card.name} would go to graveyard - owner can choose command zone instead`);
  }
  
  // Move to owner's graveyard
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
    console.warn('[movePermanentToGraveyard] Failed to recalculate player effects:', err);
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
      console.warn('[removePermanent] Failed to recalculate player effects:', err);
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
    console.log(`[movePermanentToExile] Token ${card?.name || perm.id} ceased to exist (left battlefield for exile)`);
    bumpSeq();
    return; // Token ceases to exist, don't add to exile
  }
  
  // Commander Replacement Effect (Rule 903.9a):
  // If a commander would be put into exile from anywhere, its owner may put it into
  // the command zone instead.
  const commanderInfo = commandZone?.[owner];
  const commanderIds = commanderInfo?.commanderIds || [];
  const isCommander = commanderIds.includes(card.id);
  
  if (isCommander) {
    // Add to pending commander zone choices for the owner to decide
    // The player will be prompted to choose whether to move to command zone or exile
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
    console.log(`[movePermanentToExile] Commander ${card.name} would go to exile - owner can choose command zone instead`);
  }
  
  // Move to exile zone (can be undone if player chooses command zone)
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

export function runSBA(ctx: GameContext) {
  const { state, bumpSeq } = ctx;
  const res = applyStateBasedActions(state);
  let changed = false;
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
        
        // Rule 111.7: A token that's in a zone other than the battlefield ceases to exist.
        // Tokens don't go to the graveyard - they cease to exist as a state-based action.
        const isToken = (destroyed as any).isToken === true;
        if (isToken) {
          console.log(`[runSBA] Token ${(destroyed as any).card?.name || destroyed.id} ceased to exist (left battlefield)`);
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
      console.log(`[updateGodCreatureStatus] ${(perm.card as any)?.name}: devotion ${devotion}/${threshold} - ${isCreature ? 'IS' : 'NOT'} a creature`);
    }
  }
  
  if (changed) bumpSeq();
}