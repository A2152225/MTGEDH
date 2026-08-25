// server/src/state/utils-handlers/ptEquipmentBonusCalculator.ts
// Origin parent: server/src/state/utils.ts
// Cluster moved: calculateEquipmentBonus (attached equipment/aura P/T sum).
// Public entry symbols: calculateEquipmentBonus.
// Re-exported from utils.ts so the "./utils.js" import path keeps working.

import {
  shouldUseAttachedBonusNameTable,
  parseStaticAttachedPTBonusFromOracle,
  resolveAttachedPTBonusFromOracle,
} from './ptAttachedBonusParseHelpers.js';
import { EQUIPMENT_BONUSES, AURA_BONUSES } from './ptAttachedBonusNameTables.js';

/**
 * Calculate total equipment/aura bonus for a creature
 * Looks at all attached equipment and auras and sums their P/T bonuses
 * Includes variable equipment like Cranial Plating, Blackblade Reforged, Trepanation Blade
 * 
 * @param creaturePerm - The creature permanent
 * @param battlefield - All permanents on the battlefield
 * @param gameState - Optional game state for variable equipment calculations
 * @returns { power, toughness } total bonus
 */
export function calculateEquipmentBonus(
  creaturePerm: any,
  battlefield: any[],
  gameState?: any
): { power: number; toughness: number } {
  let powerBonus = 0;
  let toughnessBonus = 0;
  
  if (!creaturePerm || !Array.isArray(battlefield)) {
    return { power: 0, toughness: 0 };
  }
  
  const controllerId = creaturePerm.controller;
  
  // Find all equipment/auras attached to this creature
  for (const perm of battlefield) {
    if (!perm || !perm.card) continue;
    
    const typeLine = (perm.card.type_line || '').toLowerCase();
    const isEquipment = typeLine.includes('equipment');
    const isAura = typeLine.includes('aura') && typeLine.includes('enchantment');
    
    if (!isEquipment && !isAura) continue;
    
    // Check if this equipment/aura is attached to the creature
    const isAttached = 
      perm.attachedTo === creaturePerm.id || 
      (creaturePerm.attachedEquipment && creaturePerm.attachedEquipment.includes(perm.id));
    
    if (!isAttached) continue;
    
    const cardName = (perm.card.name || '').toLowerCase();
    const oracleText = (perm.card.oracle_text || '').toLowerCase();

    const variableBonus = resolveAttachedPTBonusFromOracle(
      oracleText,
      controllerId,
      battlefield,
      gameState,
      perm,
      creaturePerm,
    );
    if (variableBonus) {
      powerBonus += variableBonus.power;
      toughnessBonus += variableBonus.toughness;
      continue;
    }

    const staticBonus = parseStaticAttachedPTBonusFromOracle(oracleText);
    if (staticBonus) {
      powerBonus += staticBonus.power;
      toughnessBonus += staticBonus.toughness;
      continue;
    }
    
    // Name-table fallback when oracle text is unavailable on the card object
    if (shouldUseAttachedBonusNameTable(oracleText) && EQUIPMENT_BONUSES[cardName]) {
      powerBonus += EQUIPMENT_BONUSES[cardName].power;
      toughnessBonus += EQUIPMENT_BONUSES[cardName].toughness;
      continue;
    }
    
    if (shouldUseAttachedBonusNameTable(oracleText) && AURA_BONUSES[cardName]) {
      powerBonus += AURA_BONUSES[cardName].power;
      toughnessBonus += AURA_BONUSES[cardName].toughness;
      continue;
    }
  }
  
  return { power: powerBonus, toughness: toughnessBonus };
}
