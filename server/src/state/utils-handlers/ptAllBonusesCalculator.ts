// server/src/state/utils-handlers/ptAllBonusesCalculator.ts
// Origin parent: server/src/state/utils.ts
// Cluster moved: calculateAllPTBonuses (lords, anthems, equipment, counters).
// Public entry symbols: calculateAllPTBonuses.
// Re-exported from utils.ts so the "./utils.js" import path keeps working.

import { getContinuousPTBonusForPermanent } from '../modules/staticEffectSpec.js';
import { getLibraryTopCardFromState } from '../modules/game-state-effects.js';
import { calculateEquipmentBonus } from './ptEquipmentBonusCalculator.js';

/**
 * Calculate all P/T bonuses for a creature from ALL sources
 * 
 * @param creaturePerm - The creature permanent
 * @param gameState - Full game state including battlefield, zones, etc.
 * @returns { power, toughness } total bonus from all sources
 */
export function calculateAllPTBonuses(
  creaturePerm: any,
  gameState: any
): { power: number; toughness: number } {
  let powerBonus = 0;
  let toughnessBonus = 0;
  
  if (!creaturePerm || !gameState) {
    return { power: 0, toughness: 0 };
  }
  
  const battlefield = gameState.battlefield || [];
  const controllerId = creaturePerm.controller;
  const creatureName = (creaturePerm.card?.name || '').toLowerCase();
  
  // 0. Special creature-specific P/T bonuses (Omnath, Ulvenwald Channelers, etc.)
  const selfOracleText = String(creaturePerm.card?.oracle_text || '');
  const topCreatureBonusMatch = selfOracleText.match(
    /as long as the top card of your library is a creature card, this creature gets ([+-]?\d+)\/([+-]?\d+)/i,
  );
  if (topCreatureBonusMatch) {
    const topCard = getLibraryTopCardFromState(gameState, controllerId);
    const topTypeLine = String(topCard?.type_line || topCard?.typeLine || '').toLowerCase();
    if (topTypeLine.includes('creature')) {
      powerBonus += parseInt(topCreatureBonusMatch[1], 10);
      toughnessBonus += parseInt(topCreatureBonusMatch[2], 10);
    }
  }

  // Omnath, Locus of Mana - gets +1/+1 for each green mana in your mana pool
  // Match various name formats: "Omnath, Locus of Mana" or "Omnath Locus of Mana"
  if (creatureName.includes('omnath') && creatureName.includes('locus of mana')) {
    const manaPool = gameState?.manaPool?.[controllerId] || {};
    const greenMana = manaPool.green || 0;
    if (greenMana > 0) {
      powerBonus += greenMana;
      toughnessBonus += greenMana;
    }
  }
  
  // 1. Equipment and Aura bonuses (attached to this creature)
  // Pass gameState for variable equipment calculations
  const equipBonus = calculateEquipmentBonus(creaturePerm, battlefield, gameState);
  powerBonus += equipBonus.power;
  toughnessBonus += equipBonus.toughness;
  
  // 2. Continuous static effects (regex anthems/lords + overlay specs)
  const continuousBonus = getContinuousPTBonusForPermanent(creaturePerm, gameState);
  powerBonus += continuousBonus.power;
  toughnessBonus += continuousBonus.toughness;

  // 5. Temporary pump effects (from modifiers) - includes Giant Growth, battle cry, etc.
  // These are spells/abilities that give +X/+Y until end of turn
  if (creaturePerm.modifiers && Array.isArray(creaturePerm.modifiers)) {
    for (const mod of creaturePerm.modifiers) {
      if (mod.type === 'pump' || mod.type === 'PUMP' || 
          mod.type === 'ptBoost' || mod.type === 'PT_BOOST' ||
          mod.type === 'temporary_pump' || mod.type === 'TEMPORARY_PUMP' ||
          mod.type === 'giantGrowth' || mod.type === 'GIANT_GROWTH' ||
          mod.type === 'battle_cry' || mod.type === 'BATTLE_CRY') {
        powerBonus += mod.power || mod.powerBonus || 0;
        toughnessBonus += mod.toughness || mod.toughnessBonus || 0;
      }
    }
  }
  
  // 6. Pump effects array (alternative storage for temporary buffs)
  if (creaturePerm.pumpEffects && Array.isArray(creaturePerm.pumpEffects)) {
    for (const pump of creaturePerm.pumpEffects) {
      powerBonus += pump.power || pump.powerBonus || 0;
      toughnessBonus += pump.toughness || pump.toughnessBonus || 0;
    }
  }
  
  // 7. Temporary boost fields (used by some effects like Giant Growth)
  if (typeof creaturePerm.temporaryPowerBoost === 'number') {
    powerBonus += creaturePerm.temporaryPowerBoost;
  }
  if (typeof creaturePerm.temporaryToughnessBoost === 'number') {
    toughnessBonus += creaturePerm.temporaryToughnessBoost;
  }
  
  // 8. Power/toughness boosts stored directly
  if (typeof creaturePerm.powerBoost === 'number') {
    powerBonus += creaturePerm.powerBoost;
  }
  if (typeof creaturePerm.toughnessBoost === 'number') {
    toughnessBonus += creaturePerm.toughnessBoost;
  }
  
  // 9. Emblem effects
  const emblems = gameState.emblems || [];
  for (const emblem of emblems) {
    if (!emblem || emblem.controller !== controllerId) continue;
    
    const text = (emblem.text || emblem.effect || '').toLowerCase();
    
    // Parse "creatures you control get +X/+Y"
    const emblemMatch = text.match(/creatures you control get \+(\d+)\/\+(\d+)/i);
    if (emblemMatch) {
      powerBonus += parseInt(emblemMatch[1], 10);
      toughnessBonus += parseInt(emblemMatch[2], 10);
    }
  }
  
  // 10. Plane card effects (Planechase format)
  // Active plane affects all players or specific conditions
  const activePlane = gameState.activePlane || gameState.currentPlane;
  if (activePlane) {
    const planeText = (activePlane.text || activePlane.oracle_text || activePlane.effect || '').toLowerCase();
    const planeName = (activePlane.name || '').toLowerCase();
    
    // Check for global creature pump effects on planes
    // "All creatures get +X/+Y"
    const allCreaturesMatch = planeText.match(/all creatures get \+(\d+)\/\+(\d+)/i);
    if (allCreaturesMatch) {
      powerBonus += parseInt(allCreaturesMatch[1], 10);
      toughnessBonus += parseInt(allCreaturesMatch[2], 10);
    }
    
    // "Creatures you control get +X/+Y"
    const yourCreaturesMatch = planeText.match(/creatures you control get \+(\d+)\/\+(\d+)/i);
    if (yourCreaturesMatch && activePlane.controller === controllerId) {
      powerBonus += parseInt(yourCreaturesMatch[1], 10);
      toughnessBonus += parseInt(yourCreaturesMatch[2], 10);
    }
    
    // Specific plane effects
    // Llanowar - "All creatures have +X/+X for each basic land type among lands you control"
    if (planeName.includes('llanowar')) {
      // Count basic land types controlled by the creature's controller
      const controllerLands = battlefield.filter((p: any) => 
        p.controller === controllerId && 
        (p.card?.type_line || '').toLowerCase().includes('land')
      );
      const landTypes = new Set<string>();
      for (const land of controllerLands) {
        const landTypeLine = (land.card?.type_line || '').toLowerCase();
        if (landTypeLine.includes('plains')) landTypes.add('plains');
        if (landTypeLine.includes('island')) landTypes.add('island');
        if (landTypeLine.includes('swamp')) landTypes.add('swamp');
        if (landTypeLine.includes('mountain')) landTypes.add('mountain');
        if (landTypeLine.includes('forest')) landTypes.add('forest');
      }
      const boost = landTypes.size;
      powerBonus += boost;
      toughnessBonus += boost;
    }
    
    // The Great Forest - Creatures with trample get +2/+2
    if (planeName.includes('great forest')) {
      const oracleText = (creaturePerm.card?.oracle_text || '').toLowerCase();
      const keywords = creaturePerm.card?.keywords || [];
      if (oracleText.includes('trample') || keywords.some((k: string) => k.toLowerCase() === 'trample')) {
        powerBonus += 2;
        toughnessBonus += 2;
      }
    }
  }
  
  // 11. Scheme card effects (Archenemy format)
  // Ongoing schemes that affect creatures
  const activeSchemes = gameState.activeSchemes || gameState.ongoingSchemes || [];
  for (const scheme of activeSchemes) {
    if (!scheme) continue;
    
    const schemeText = (scheme.text || scheme.oracle_text || scheme.effect || '').toLowerCase();
    
    // "Creatures you control get +X/+Y"
    const schemeCreaturesMatch = schemeText.match(/creatures you control get \+(\d+)\/\+(\d+)/i);
    if (schemeCreaturesMatch && scheme.controller === controllerId) {
      powerBonus += parseInt(schemeCreaturesMatch[1], 10);
      toughnessBonus += parseInt(schemeCreaturesMatch[2], 10);
    }
    
    // "All creatures get +X/+Y" (affects everyone)
    const schemeAllMatch = schemeText.match(/all creatures get \+(\d+)\/\+(\d+)/i);
    if (schemeAllMatch) {
      powerBonus += parseInt(schemeAllMatch[1], 10);
      toughnessBonus += parseInt(schemeAllMatch[2], 10);
    }
  }
  
  // 12. Conspiracy cards (Conspiracy draft format) - affects creatures you control
  const conspiracies = gameState.conspiracies || [];
  for (const conspiracy of conspiracies) {
    if (!conspiracy || conspiracy.controller !== controllerId) continue;
    
    const conspText = (conspiracy.text || conspiracy.oracle_text || conspiracy.effect || '').toLowerCase();
    
    // Check for creature buff effects
    const conspBuffMatch = conspText.match(/creatures you control get \+(\d+)\/\+(\d+)/i);
    if (conspBuffMatch) {
      powerBonus += parseInt(conspBuffMatch[1], 10);
      toughnessBonus += parseInt(conspBuffMatch[2], 10);
    }
  }
  
  // 13. Dungeon room effects (AFR/CLB dungeons)
  const activeDungeon = gameState.activeDungeon || gameState.currentDungeon;
  if (activeDungeon && activeDungeon.controller === controllerId) {
    const roomText = (activeDungeon.currentRoomEffect || activeDungeon.roomEffect || '').toLowerCase();
    
    // Some rooms give creature buffs
    const roomBuffMatch = roomText.match(/creatures you control get \+(\d+)\/\+(\d+)/i);
    if (roomBuffMatch) {
      powerBonus += parseInt(roomBuffMatch[1], 10);
      toughnessBonus += parseInt(roomBuffMatch[2], 10);
    }
  }
  
  return { power: powerBonus, toughness: toughnessBonus };
}
