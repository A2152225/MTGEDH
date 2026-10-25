// server/src/state/utils-handlers/variablePTCalculator.ts
// Origin parent: server/src/state/utils.ts
// Cluster moved: calculateVariablePT (characteristic-defining */* P/T).
// Public entry symbols: calculateVariablePT.
// Re-exported from utils.ts so the "./utils.js" import path keeps working.

import { calculatePowerOnlyCDA } from "./variablePowerOnlyCalculator.js";
import { calculateGreatestManaValuePowerCDA } from "./variablePowerGreatestManaValue.js";
import { calculateGreatestPowerAmongCDA } from "./variablePowerGreatestPower.js";
import { calculateColorPermanentCountPT } from "./variableColorPermanentCount.js";
import { landAwareTypeLine } from '../modules/effectiveLandTypeLine.js';
import { calculateControlledCountCDA, calculateDevotionCDA, calculateGraveyardCardTypesCDA } from "./variablePTControlledCountCDA.js";

/**
 * Calculate the effective P/T for creatures with variable (star slash star) power/toughness.
 * This implements the characteristic-defining abilities from card text.
 * 
 * Note: This is only for true variable P/T creatures like Tarmogoyf or Nighthowler.
 * Cards with fixed P/T (like Morophon 6/6) should have their values parsed normally.
 * 
 * Examples:
 * - Tarmogoyf: Count card types in all graveyards
 * - Nighthowler: Count creatures in graveyards
 * - Consuming Aberration: Count cards in opponents' graveyards
 * 
 * @param card - The card data with oracle_text and type information
 * @param gameState - Optional game state for dynamic calculations
 * @returns { power, toughness } or undefined if not calculable
 */
export function calculateVariablePT(
  card: any,
  gameState?: any
): { power: number; toughness: number } | undefined {
  if (!card) return undefined;
  
  const name = (card.name || '').toLowerCase();
  const oracleText = (card.oracle_text || '').toLowerCase();
  const typeLine = (card.type_line || '').toLowerCase();
  const battlefield = gameState?.battlefield || [];
  const controllerId =
    (card as any).controller ??
    battlefield.find((p: any) => p?.card?.id === card.id)?.controller ??
    battlefield.find((p: any) => p?.card === card)?.controller ??
    (card as any).owner;
  const zones = gameState?.zones || {};
  // Battlefield sizes are small here, so linear lookup remains acceptable.
  
  // Marit Lage token - Defined as 20/20
  if (name.includes('marit lage')) {
    return { power: 20, toughness: 20 };
  }
  
  // ===== SPECIFIC CARD HANDLERS =====
  
  // Psychosis Crawler - P/T equal to number of cards in controller's hand
  // Oracle text: "Psychosis Crawler's power and toughness are each equal to the number of cards in your hand."
  if (name.includes('psychosis crawler')) {
    const playerZones = zones[controllerId];
    const handCount = playerZones?.handCount ?? (playerZones?.hand || []).length ?? 0;
    return { power: handCount, toughness: handCount };
  }
  
  // Omnath, Locus of Mana - gets +1/+1 for each green mana in your mana pool
  if (name.includes('omnath, locus of mana') || name.includes('omnath locus of mana')) {
    const manaPool = gameState?.manaPool?.[controllerId] || {};
    const greenMana = manaPool.G || manaPool.green || 0;
    // Base is 1/1, plus green mana
    return { power: 1 + greenMana, toughness: 1 + greenMana };
  }
  
  // Tarmogoyf - */* where * is the number of card types among cards in all graveyards
  if (name.includes('tarmogoyf')) {
    const cardTypes = new Set<string>();
    const allPlayers = gameState?.players || [];
    for (const player of allPlayers) {
      const playerZones = zones[player.id];
      const graveyard = playerZones?.graveyard || [];
      for (const card of graveyard) {
        const cardTypeLine = (card.type_line || '').toLowerCase();
        if (cardTypeLine.includes('creature')) cardTypes.add('creature');
        if (cardTypeLine.includes('instant')) cardTypes.add('instant');
        if (cardTypeLine.includes('sorcery')) cardTypes.add('sorcery');
        if (cardTypeLine.includes('artifact')) cardTypes.add('artifact');
        if (cardTypeLine.includes('enchantment')) cardTypes.add('enchantment');
        if (cardTypeLine.includes('planeswalker')) cardTypes.add('planeswalker');
        if (cardTypeLine.includes('land')) cardTypes.add('land');
        if (cardTypeLine.includes('tribal')) cardTypes.add('tribal');
        if (cardTypeLine.includes('kindred')) cardTypes.add('kindred');
        if (cardTypeLine.includes('battle')) cardTypes.add('battle');
      }
    }
    // Tarmogoyf is */1+* 
    return { power: cardTypes.size, toughness: cardTypes.size + 1 };
  }
  
  // Lhurgoyf - */* where power is creatures in all graveyards, toughness is 1+that
  if (name.includes('lhurgoyf') && !name.includes('mortivore')) {
    let creatureCount = 0;
    const allPlayers = gameState?.players || [];
    for (const player of allPlayers) {
      const playerZones = zones[player.id];
      const graveyard = playerZones?.graveyard || [];
      for (const card of graveyard) {
        if ((card.type_line || '').toLowerCase().includes('creature')) {
          creatureCount++;
        }
      }
    }
    return { power: creatureCount, toughness: creatureCount + 1 };
  }
  
  // Mortivore - */* where * is creatures in all graveyards
  if (name.includes('mortivore')) {
    let creatureCount = 0;
    const allPlayers = gameState?.players || [];
    for (const player of allPlayers) {
      const playerZones = zones[player.id];
      const graveyard = playerZones?.graveyard || [];
      for (const card of graveyard) {
        if ((card.type_line || '').toLowerCase().includes('creature')) {
          creatureCount++;
        }
      }
    }
    return { power: creatureCount, toughness: creatureCount };
  }
  
  // Nighthowler - */* where * is creatures in all graveyards
  if (name.includes('nighthowler')) {
    let creatureCount = 0;
    const allPlayers = gameState?.players || [];
    for (const player of allPlayers) {
      const playerZones = zones[player.id];
      const graveyard = playerZones?.graveyard || [];
      for (const card of graveyard) {
        if ((card.type_line || '').toLowerCase().includes('creature')) {
          creatureCount++;
        }
      }
    }
    return { power: creatureCount, toughness: creatureCount };
  }
  
  // Consuming Aberration - */* where * is cards in opponents' graveyards
  if (name.includes('consuming aberration')) {
    let cardCount = 0;
    const allPlayers = gameState?.players || [];
    for (const player of allPlayers) {
      if (player.id === controllerId) continue; // Skip controller
      const playerZones = zones[player.id];
      const graveyard = playerZones?.graveyard || [];
      cardCount += graveyard.length;
    }
    return { power: cardCount, toughness: cardCount };
  }
  
  // Sewer Nemesis - */* where * is cards in chosen player's graveyard
  if (name.includes('sewer nemesis')) {
    // Assumes chosen player is stored on the card
    const chosenPlayer = card.chosenPlayer || controllerId;
    const playerZones = zones[chosenPlayer];
    const cardCount = playerZones?.graveyard?.length || 0;
    return { power: cardCount, toughness: cardCount };
  }
  
  // Bonehoard - equipped creature gets +X/+X where X is creatures in all graveyards
  // (handled in equipment bonus calculation)
  
  // Cranial Plating - equipped creature gets +X/+0 where X is artifacts you control
  // (handled in equipment calculation)
  
  // Nettlecyst - equipped creature gets +1/+1 for each artifact and enchantment you control
  // (handled in equipment calculation)
  
  // Blackblade Reforged - equipped creature gets +1/+1 for each land you control
  // (handled in equipment calculation)
  
  // Multani, Yavimaya's Avatar - */* where * is lands you control + lands in graveyard
  if (name.includes('multani, yavimaya')) {
    const lands = battlefield.filter((p: any) => 
      p.controller === controllerId && 
      (p.card?.type_line || '').toLowerCase().includes('land')
    );
    const playerZones = zones[controllerId];
    const graveyardLands = (playerZones?.graveyard || []).filter((c: any) =>
      (c.type_line || '').toLowerCase().includes('land')
    );
    const total = lands.length + graveyardLands.length;
    return { power: total, toughness: total };
  }
  
  // Splinterfright - */* where * is creatures in your graveyard
  if (name.includes('splinterfright')) {
    const playerZones = zones[controllerId];
    const graveyardCreatures = (playerZones?.graveyard || []).filter((c: any) =>
      (c.type_line || '').toLowerCase().includes('creature')
    );
    return { power: graveyardCreatures.length, toughness: graveyardCreatures.length };
  }
  
  // Boneyard Wurm - */* where * is creatures in your graveyard
  if (name.includes('boneyard wurm')) {
    const playerZones = zones[controllerId];
    const graveyardCreatures = (playerZones?.graveyard || []).filter((c: any) =>
      (c.type_line || '').toLowerCase().includes('creature')
    );
    return { power: graveyardCreatures.length, toughness: graveyardCreatures.length };
  }
  
  // Cognivore - */* where * is instants in all graveyards
  if (name.includes('cognivore')) {
    let instantCount = 0;
    const allPlayers = gameState?.players || [];
    for (const player of allPlayers) {
      const playerZones = zones[player.id];
      const graveyard = playerZones?.graveyard || [];
      for (const card of graveyard) {
        if ((card.type_line || '').toLowerCase().includes('instant')) {
          instantCount++;
        }
      }
    }
    return { power: instantCount, toughness: instantCount };
  }
  
  // Magnivore - */* where * is sorceries in all graveyards
  if (name.includes('magnivore')) {
    let sorceryCount = 0;
    const allPlayers = gameState?.players || [];
    for (const player of allPlayers) {
      const playerZones = zones[player.id];
      const graveyard = playerZones?.graveyard || [];
      for (const card of graveyard) {
        if ((card.type_line || '').toLowerCase().includes('sorcery')) {
          sorceryCount++;
        }
      }
    }
    return { power: sorceryCount, toughness: sorceryCount };
  }
  
  // Terravore - */* where * is lands in all graveyards
  if (name.includes('terravore')) {
    let landCount = 0;
    const allPlayers = gameState?.players || [];
    for (const player of allPlayers) {
      const playerZones = zones[player.id];
      const graveyard = playerZones?.graveyard || [];
      for (const card of graveyard) {
        if ((card.type_line || '').toLowerCase().includes('land')) {
          landCount++;
        }
      }
    }
    return { power: landCount, toughness: landCount };
  }
  
  // Masticore variants with hand-based P/T
  // Maro - */* where * is cards in your hand
  if (name === 'maro' || name.includes('maro,')) {
    const playerZones = zones[controllerId];
    const handSize = playerZones?.handCount ?? playerZones?.hand?.length ?? 0;
    return { power: handSize, toughness: handSize };
  }
  
  // Molimo, Maro-Sorcerer - */* where * is lands you control
  if (name.includes('molimo')) {
    const lands = battlefield.filter((p: any) => 
      p.controller === controllerId && 
      (p.card?.type_line || '').toLowerCase().includes('land')
    );
    return { power: lands.length, toughness: lands.length };
  }
  
  // Korlash, Heir to Blackblade - */* where * is Swamps you control
  if (name.includes('korlash')) {
    const swamps = battlefield.filter((p: any) => 
      p.controller === controllerId && 
      landAwareTypeLine(gameState, p, String(p.card?.type_line || '')).includes('swamp')
    );
    return { power: swamps.length, toughness: swamps.length };
  }
  
  // Dungrove Elder - */* where * is Forests you control
  if (name.includes('dungrove elder')) {
    const forests = battlefield.filter((p: any) => 
      p.controller === controllerId && 
      landAwareTypeLine(gameState, p, String(p.card?.type_line || '')).includes('forest')
    );
    return { power: forests.length, toughness: forests.length };
  }
  
  // Dakkon Blackblade - */* where * is lands you control
  if (name.includes('dakkon blackblade')) {
    const lands = battlefield.filter((p: any) => 
      p.controller === controllerId && 
      (p.card?.type_line || '').toLowerCase().includes('land')
    );
    return { power: lands.length, toughness: lands.length };
  }
  
  // Kavu Titan - 5/5 if kicked
  if (name.includes('kavu titan') && card.wasKicked) {
    return { power: 5, toughness: 5 };
  }
  
  // Serra Avatar - */* where * is your life total
  if (name.includes('serra avatar')) {
    const life = gameState?.life?.[controllerId] ?? 40;
    return { power: life, toughness: life };
  }
  
  // Soramaro, First to Dream - */* where * is cards in hand
  if (name.includes('soramaro')) {
    const playerZones = zones[controllerId];
    const handSize = playerZones?.handCount ?? playerZones?.hand?.length ?? 0;
    return { power: handSize, toughness: handSize };
  }
  
  // Masumaro, First to Live - */* where * is cards in hand
  if (name.includes('masumaro')) {
    const playerZones = zones[controllerId];
    const handSize = playerZones?.handCount ?? playerZones?.hand?.length ?? 0;
    return { power: handSize * 2, toughness: handSize * 2 };
  }
  
  // Adamaro, First to Desire - */* where * is cards in opponent's hand with most cards
  if (name.includes('adamaro')) {
    let maxHandSize = 0;
    const allPlayers = gameState?.players || [];
    for (const player of allPlayers) {
      if (player.id === controllerId) continue;
      const playerZones = zones[player.id];
      const handSize = playerZones?.handCount ?? playerZones?.hand?.length ?? 0;
      maxHandSize = Math.max(maxHandSize, handSize);
    }
    return { power: maxHandSize, toughness: maxHandSize };
  }
  
  // Kagemaro, First to Suffer - */* where * is cards in your hand
  if (name.includes('kagemaro')) {
    const playerZones = zones[controllerId];
    const handSize = playerZones?.handCount ?? playerZones?.hand?.length ?? 0;
    return { power: handSize, toughness: handSize };
  }
  
  // ===== GENERIC PATTERN MATCHING =====

  // "~'s power is equal to the number of X" with printed toughness (*/N).
  const powerOnly = calculatePowerOnlyCDA(card, oracleText, battlefield, zones, controllerId);
  if (powerOnly) return powerOnly;
  const greatestMv = calculateGreatestManaValuePowerCDA(card, oracleText, battlefield, controllerId);
  if (greatestMv) return greatestMv;
  const greatestPower = calculateGreatestPowerAmongCDA(card, oracleText, gameState, controllerId);
  if (greatestPower) return greatestPower;

  // "each equal to the number of [COLOR] permanents/creatures you control"
  const colorCount = calculateColorPermanentCountPT(oracleText, battlefield, controllerId);
  if (colorCount) return colorCount;
  
  // "power and toughness are each equal to" patterns
  if (oracleText.includes('power and toughness are each equal to')) {
    
    // "artifacts and/or creatures you control" (each permanent counted once)
    if (oracleText.includes('artifacts and/or creatures you control')) {
      const permanents = battlefield.filter((p: any) =>
        p.controller === controllerId &&
        /\b(artifact|creature)\b/.test((p.card?.type_line || '').toLowerCase())
      );
      const count = permanents.length;
      return { power: count, toughness: count };
    }

    // "number of creatures you control"
    if (oracleText.includes('number of creatures you control')) {
      const creatures = battlefield.filter((p: any) => 
        p.controller === controllerId && 
        (p.card?.type_line || '').toLowerCase().includes('creature')
      );
      return { power: creatures.length, toughness: creatures.length };
    }
    
    // "number of creatures on the battlefield" (all creatures)
    if (oracleText.includes('number of creatures on the battlefield') || 
        oracleText.includes('total number of creatures')) {
      const creatures = battlefield.filter((p: any) => 
        (p.card?.type_line || '').toLowerCase().includes('creature')
      );
      return { power: creatures.length, toughness: creatures.length };
    }
    
    // "cards in your hand"
    if (oracleText.includes('cards in your hand')) {
      const playerZones = zones[controllerId];
      const handSize = playerZones?.handCount ?? playerZones?.hand?.length ?? 0;
      return { power: handSize, toughness: handSize };
    }
    
    // "lands you control"
    if (oracleText.includes('lands you control') || oracleText.includes('number of lands you control')) {
      const lands = battlefield.filter((p: any) => 
        p.controller === controllerId && 
        (p.card?.type_line || '').toLowerCase().includes('land')
      );
      return { power: lands.length, toughness: lands.length };
    }
    
    // "your life total"
    if (oracleText.includes('your life total')) {
      const life = gameState?.life?.[controllerId] ?? 40;
      return { power: life, toughness: life };
    }
    
    // "creature cards in all graveyards"
    if (oracleText.includes('creature cards in all graveyards') || 
        oracleText.includes('creatures in all graveyards')) {
      let creatureCount = 0;
      const allPlayers = gameState?.players || [];
      for (const player of allPlayers) {
        const playerZones = zones[player.id];
        const graveyard = playerZones?.graveyard || [];
        for (const card of graveyard) {
          if ((card.type_line || '').toLowerCase().includes('creature')) {
            creatureCount++;
          }
        }
      }
      return { power: creatureCount, toughness: creatureCount };
    }
    
    // "cards in your graveyard"
    if (oracleText.includes('cards in your graveyard') && !/creature cards in your graveyard|creatures in your graveyard/.test(oracleText)) {
      const playerZones = zones[controllerId];
      const cardCount = playerZones?.graveyard?.length ?? 0;
      return { power: cardCount, toughness: cardCount };
    }
    
    // "creature cards in your graveyard"
    if (oracleText.includes('creature cards in your graveyard') ||
        oracleText.includes('creatures in your graveyard')) {
      const playerZones = zones[controllerId];
      const creatureCount = (playerZones?.graveyard || []).filter((c: any) =>
        (c.type_line || '').toLowerCase().includes('creature')
      ).length;
      return { power: creatureCount, toughness: creatureCount };
    }
    
    // "artifacts you control"
    if (oracleText.includes('artifacts you control')) {
      const artifacts = battlefield.filter((p: any) => 
        p.controller === controllerId && 
        (p.card?.type_line || '').toLowerCase().includes('artifact')
      );
      return { power: artifacts.length, toughness: artifacts.length };
    }
    
    // "enchantments you control"
    if (oracleText.includes('enchantments you control')) {
      const enchantments = battlefield.filter((p: any) => 
        p.controller === controllerId && 
        (p.card?.type_line || '').toLowerCase().includes('enchantment')
      );
      return { power: enchantments.length, toughness: enchantments.length };
    }
  }
  
  // "gets +1/+1 for each" patterns (for base stats of 0/0 creatures)
  const getsPlusPattern = oracleText.match(/gets? \+1\/\+1 for each ([^.]+)/i);
  if (getsPlusPattern && (card.power === '*' || card.power === '0')) {
    const condition = getsPlusPattern[1].toLowerCase();
    
    if (condition.includes('creature you control') || condition.includes('other creature you control')) {
      const creatures = battlefield.filter((p: any) => 
        p.controller === controllerId && 
        (p.card?.type_line || '').toLowerCase().includes('creature')
      );
      // Subtract 1 if "other" (don't count itself)
      const count = condition.includes('other') ? Math.max(0, creatures.length - 1) : creatures.length;
      return { power: count, toughness: count };
    }
    
    if (condition.includes('land you control')) {
      const lands = battlefield.filter((p: any) => 
        p.controller === controllerId && 
        (p.card?.type_line || '').toLowerCase().includes('land')
      );
      return { power: lands.length, toughness: lands.length };
    }
    
    if (condition.includes('artifact you control')) {
      const artifacts = battlefield.filter((p: any) => 
        p.controller === controllerId && 
        (p.card?.type_line || '').toLowerCase().includes('artifact')
      );
      return { power: artifacts.length, toughness: artifacts.length };
    }
  }
  
  // For cards we can't calculate, check if there's a defined base in reminder text
  const sizeMatch = oracleText.match(/base power and toughness (\d+)\/(\d+)/i);
  if (sizeMatch) {
    return { power: parseInt(sizeMatch[1], 10), toughness: parseInt(sizeMatch[2], 10) };
  }
  
  const controlledCount = calculateControlledCountCDA(oracleText, battlefield, controllerId, card.id, gameState);
  if (controlledCount) return controlledCount;
  const graveyardTypes = calculateGraveyardCardTypesCDA(oracleText, gameState, controllerId);
  if (graveyardTypes) return graveyardTypes;
  const devotion = calculateDevotionCDA(oracleText, battlefield, controllerId, card.toughness);
  if (devotion) return devotion;

  // Default fallback - return undefined so caller knows we couldn't calculate
  return undefined;
}
