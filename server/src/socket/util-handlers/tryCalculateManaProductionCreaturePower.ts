// server/src/socket/util-handlers/tryCalculateManaProductionCreaturePower.ts
// Origin parent: server/src/socket/util.ts
// Cluster moved: calculateManaProduction power/toughness-based creature mana family.
// Public entry symbols: tryCalculateManaProductionCreaturePower.
// Undefined falls through to later families.

import type { ManaProductionInfo } from "./manaProductionTypes.js";
import { getCurrentPowerToughnessForRules } from "../../state/modules/currentPowerToughness.js";
import { debug } from "../../utils/debug.js";

export type CalculateManaProductionCreaturePowerArgs = {
  result: ManaProductionInfo;
  cardName: string;
  oracleText: string;
  manaOracleText: string;
  battlefield: any[];
  playerId: string;
  permanent: any;
  card: any;
  gameState: any;
  chosenColor?: string;
  typeLine: string;
};

export function tryCalculateManaProductionCreaturePower(
  args: CalculateManaProductionCreaturePowerArgs,
): ManaProductionInfo | undefined {
  const {
    result,
    cardName,
    oracleText,
    manaOracleText,
    battlefield,
    playerId,
    permanent,
    card,
    gameState,
    chosenColor,
    typeLine,
  } = args;

  
  // ===== POWER-BASED MANA ABILITIES =====
  
  // Selvala, Heart of the Wilds - "Add mana equal to the greatest power among creatures you control"
  if (cardName.includes('selvala, heart of the wilds') ||
      (oracleText.includes('greatest power') && oracleText.includes('among creatures'))) {
    let greatestPower = 0;
    for (const perm of battlefield) {
      if (!perm || perm.controller !== playerId) continue;
      const permTypeLine = (perm.card?.type_line || '').toLowerCase();
      if (!permTypeLine.includes('creature')) continue;
      
      // Current power (anthems, equipment, pumps, counters) - same as the battlefield badge
      const { power } = getCurrentPowerToughnessForRules(perm, gameState ?? { battlefield });
      if (power > greatestPower) greatestPower = power;
    }
    result.isDynamic = true;
    result.baseAmount = greatestPower;
    result.dynamicDescription = `Mana equal to greatest power (${greatestPower})`;
    result.colors = ['W', 'U', 'B', 'R', 'G'];
    if (chosenColor) result.colors = [chosenColor];
  }
  
  // Generic pattern: "Add {G} equal to [this creature's / ~'s] power"
  // Catches: Marwyn, Viridian Joiner, Cradle Clearcutter, Gyre Sage, etc.
    if (manaOracleText.includes("equal to") && manaOracleText.includes("power") && 
      (manaOracleText.includes("{g}") || manaOracleText.includes("green")) &&
      !manaOracleText.includes("greatest") && !manaOracleText.includes("among")) {
    const { power } = getCurrentPowerToughnessForRules(permanent, gameState ?? { battlefield });
    result.isDynamic = true;
    result.baseAmount = Math.max(0, power);
    result.dynamicDescription = `{G} equal to this creature's power (${power})`;
    result.colors = ['G'];
  }
  
  // Bighorn Rancher and similar - "Add {G} equal to the greatest power among creatures you control"
  if ((oracleText.includes("greatest power") && oracleText.includes("among creatures")) ||
      cardName.includes('bighorn rancher') || cardName.includes('bighorner rancher')) {
    let greatestPower = 0;
    for (const perm of battlefield) {
      if (!perm || perm.controller !== playerId) continue;
      const permTypeLine = (perm.card?.type_line || '').toLowerCase();
      if (!permTypeLine.includes('creature')) continue;
      
      const { power } = getCurrentPowerToughnessForRules(perm, gameState ?? { battlefield });
      if (power > greatestPower) greatestPower = power;
    }
    debug(2, `[calculateManaProduction] ${cardName}: Greatest power among creatures is ${greatestPower}`);
    result.isDynamic = true;
    result.baseAmount = greatestPower;
    result.dynamicDescription = `{G} equal to greatest power (${greatestPower})`;
    result.colors = ['G'];
  }
  
  // White Lotus Tile - "Add X mana of any one color, where X is the greatest number of creatures you control that have a creature type in common."
  // This counts the maximum number of creatures sharing ANY creature type
  if (cardName.includes('white lotus tile') || 
      (oracleText.includes('creature type in common') && oracleText.includes('greatest number'))) {
    // Build a map of creature types to count
    const creatureTypeCounts: Record<string, number> = {};
    
    for (const perm of battlefield) {
      if (!perm || perm.controller !== playerId) continue;
      const permTypeLine = (perm.card?.type_line || '').toLowerCase();
      if (!permTypeLine.includes('creature')) continue;
      
      // Extract creature types from type line (after the em-dash)
      // Format: "Creature — Human Soldier" or "Legendary Creature — Elf Druid"
      const typeLineParts = permTypeLine.split(/[—-]/);
      if (typeLineParts.length > 1) {
        const subtypes = typeLineParts[1].trim().split(/\s+/);
        for (const subtype of subtypes) {
          if (subtype && subtype.length > 0) {
            creatureTypeCounts[subtype] = (creatureTypeCounts[subtype] || 0) + 1;
          }
        }
      }
    }
    
    // Find the greatest count
    let greatestCount = 0;
    let bestType = '';
    for (const [creatureType, count] of Object.entries(creatureTypeCounts)) {
      if (count > greatestCount) {
        greatestCount = count;
        bestType = creatureType;
      }
    }
    
    debug(2, `[calculateManaProduction] ${cardName}: Greatest creature type in common: ${bestType} (${greatestCount})`);
    result.isDynamic = true;
    result.baseAmount = greatestCount;
    result.dynamicDescription = `Add ${greatestCount} mana of any color (${bestType}s: ${greatestCount})`;
    result.colors = ['W', 'U', 'B', 'R', 'G'];
    if (chosenColor) result.colors = [chosenColor];
  }
  
  // Tanuki Transplanter - "Add an amount of {G} equal to equipped creature's power"
  if (cardName.includes('tanuki transplanter')) {
    const attachedTo = (permanent as any).attachedTo;
    let power = 0;
    if (attachedTo) {
      const equippedCreature = battlefield.find((p: any) => p.id === attachedTo);
      if (equippedCreature) {
        // Tanuki grants no P/T itself, so the equipped creature's current power has no double count.
        const actualPT = getCurrentPowerToughnessForRules(equippedCreature, gameState ?? { battlefield });
        power = actualPT.power;
      }
    }
    result.isDynamic = true;
    result.baseAmount = Math.max(0, power);
    result.dynamicDescription = `{G} equal to equipped creature's power (${power})`;
    result.colors = ['G'];
  }
  
  // Vhal, Candlekeep Researcher - "Add an amount of {U} equal to Vhal's toughness"
  if (cardName.includes('vhal')) {
    // Current toughness (anthems, equipment, pumps, counters).
    const toughness = Number(getCurrentPowerToughnessForRules(permanent, gameState ?? { battlefield }).toughness) || 0;
    result.isDynamic = true;
    result.baseAmount = Math.max(0, toughness);
    result.dynamicDescription = `{U} equal to toughness (${toughness})`;
    result.colors = ['U'];
  }
  return undefined;
}
