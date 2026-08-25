// server/src/state/utils-handlers/ptAllBonusesWithSources.ts
// Origin parent: server/src/state/utils.ts
// Cluster moved: PTBonusSource / PTBonusResult,
//   calculateAllPTBonusesWithSources, calculateEquipmentBonusWithSources.
// Public entry symbols: PTBonusSource, PTBonusResult,
//   calculateAllPTBonusesWithSources, calculateEquipmentBonusWithSources.
// Re-exported from utils.ts so the "./utils.js" import path keeps working.

import { getContinuousPTBonusSourcesForPermanent } from '../modules/staticEffectSpec.js';
import { getLibraryTopCardFromState } from '../modules/game-state-effects.js';
import {
  shouldUseAttachedBonusNameTable,
  parseStaticAttachedPTBonusFromOracle,
  resolveAttachedPTBonusFromOracle,
} from './ptAttachedBonusParseHelpers.js';
import { EQUIPMENT_BONUSES, AURA_BONUSES } from './ptAttachedBonusNameTables.js';

/**
 * Source of a P/T bonus for display in tooltips
 */
export interface PTBonusSource {
  name: string;           // Name of the source (card name, "Counters", etc.)
  power: number;          // Power bonus from this source
  toughness: number;      // Toughness bonus from this source
  type: 'equipment' | 'aura' | 'enchantment' | 'creature' | 'artifact' | 'counter' | 'modifier' | 'emblem' | 'ability' | 'other';
}

/**
 * Extended result from P/T calculation that includes source tracking
 */
export interface PTBonusResult {
  power: number;
  toughness: number;
  sources: PTBonusSource[];
}

/**
 * Calculate all P/T bonuses for a creature with source tracking for tooltips.
 * This extended version returns information about what is contributing to the P/T calculation.
 * 
 * @param creaturePerm - The creature permanent
 * @param gameState - Full game state including battlefield, zones, etc.
 * @returns { power, toughness, sources } total bonus from all sources with details
 */
export function calculateAllPTBonusesWithSources(
  creaturePerm: any,
  gameState: any
): PTBonusResult {
  const sources: PTBonusSource[] = [];
  
  if (!creaturePerm || !gameState) {
    return { power: 0, toughness: 0, sources: [] };
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
      const p = parseInt(topCreatureBonusMatch[1], 10);
      const t = parseInt(topCreatureBonusMatch[2], 10);
      if (p !== 0 || t !== 0) {
        sources.push({
          name: creaturePerm.card?.name || 'Creature',
          power: p,
          toughness: t,
          type: 'ability',
        });
      }
    }
  }

  // Omnath, Locus of Mana - gets +1/+1 for each green mana in your mana pool
  // Match various name formats: "Omnath, Locus of Mana" or "Omnath Locus of Mana"
  if (creatureName.includes('omnath') && creatureName.includes('locus of mana')) {
    const manaPool = gameState?.manaPool?.[controllerId] || {};
    const greenMana = manaPool.green || 0;
    if (greenMana > 0) {
      sources.push({
        name: 'Green mana in pool',
        power: greenMana,
        toughness: greenMana,
        type: 'ability',
      });
    }
  }
  
  // 1. Equipment and Aura bonuses (attached to this creature)
  const equipSources = calculateEquipmentBonusWithSources(creaturePerm, battlefield, gameState);
  sources.push(...equipSources.sources);
  
  // 2. Continuous static effects (regex anthems/lords + overlay specs)
  const continuousSources = getContinuousPTBonusSourcesForPermanent(creaturePerm, gameState);
  for (const continuousSource of continuousSources.sources) {
    if (continuousSource.power === 0 && continuousSource.toughness === 0) continue;
    sources.push({
      name: continuousSource.name,
      power: continuousSource.power,
      toughness: continuousSource.toughness,
      type: 'other',
    });
  }

  // 5. Temporary pump effects (modifiers) including battle cry
  if (creaturePerm.modifiers && Array.isArray(creaturePerm.modifiers)) {
    for (const mod of creaturePerm.modifiers) {
      if (mod.type === 'pump' || mod.type === 'PUMP' || 
          mod.type === 'ptBoost' || mod.type === 'PT_BOOST' ||
          mod.type === 'temporary_pump' || mod.type === 'TEMPORARY_PUMP' ||
          mod.type === 'giantGrowth' || mod.type === 'GIANT_GROWTH' ||
          mod.type === 'battle_cry' || mod.type === 'BATTLE_CRY') {
        const p = mod.power || mod.powerBonus || 0;
        const t = mod.toughness || mod.toughnessBonus || 0;
        if (p !== 0 || t !== 0) {
          sources.push({
            name: mod.sourceName || (mod.type === 'battle_cry' ? 'Battle Cry' : 'Pump effect'),
            power: p,
            toughness: t,
            type: 'modifier',
          });
        }
      }
    }
  }
  
  // 6. Pump effects array
  if (creaturePerm.pumpEffects && Array.isArray(creaturePerm.pumpEffects)) {
    for (const pump of creaturePerm.pumpEffects) {
      const p = pump.power || pump.powerBonus || 0;
      const t = pump.toughness || pump.toughnessBonus || 0;
      if (p !== 0 || t !== 0) {
        sources.push({
          name: pump.sourceName || 'Pump effect',
          power: p,
          toughness: t,
          type: 'modifier',
        });
      }
    }
  }
  
  // 7/8. Temporary and direct boost fields
  const tempPower = (creaturePerm.temporaryPowerBoost || 0) + (creaturePerm.powerBoost || 0);
  const tempToughness = (creaturePerm.temporaryToughnessBoost || 0) + (creaturePerm.toughnessBoost || 0);
  if (tempPower !== 0 || tempToughness !== 0) {
    sources.push({
      name: 'Temporary boost',
      power: tempPower,
      toughness: tempToughness,
      type: 'modifier',
    });
  }
  
  // 9. Emblem effects
  const emblems = gameState.emblems || [];
  for (const emblem of emblems) {
    if (!emblem || emblem.controller !== controllerId) continue;
    
    const text = (emblem.text || emblem.effect || '').toLowerCase();
    const emblemMatch = text.match(/creatures you control get \+(\d+)\/\+(\d+)/i);
    if (emblemMatch) {
      const p = parseInt(emblemMatch[1], 10);
      const t = parseInt(emblemMatch[2], 10);
      sources.push({
        name: emblem.name || 'Emblem',
        power: p,
        toughness: t,
        type: 'emblem',
      });
    }
  }
  
  // Calculate totals
  let totalPower = 0;
  let totalToughness = 0;
  for (const source of sources) {
    totalPower += source.power;
    totalToughness += source.toughness;
  }
  
  return { power: totalPower, toughness: totalToughness, sources };
}

/**
 * Calculate equipment/aura bonus with source tracking.
 */
export function calculateEquipmentBonusWithSources(
  creaturePerm: any,
  battlefield: any[],
  gameState?: any
): PTBonusResult {
  const sources: PTBonusSource[] = [];
  
  if (!creaturePerm || !Array.isArray(battlefield)) {
    return { power: 0, toughness: 0, sources: [] };
  }
  
  const controllerId = creaturePerm.controller;
  
  for (const perm of battlefield) {
    if (!perm || !perm.card) continue;
    
    const typeLine = (perm.card.type_line || '').toLowerCase();
    const isEquipment = typeLine.includes('equipment');
    const isAura = typeLine.includes('aura') && typeLine.includes('enchantment');
    
    if (!isEquipment && !isAura) continue;
    
    const isAttached = 
      perm.attachedTo === creaturePerm.id || 
      (creaturePerm.attachedEquipment && creaturePerm.attachedEquipment.includes(perm.id));
    
    if (!isAttached) continue;
    
    const cardName = (perm.card.name || '').toLowerCase();
    const oracleText = (perm.card.oracle_text || '').toLowerCase();
    const sourceType: 'equipment' | 'aura' = isEquipment ? 'equipment' : 'aura';

    const variableBonus = resolveAttachedPTBonusFromOracle(
      oracleText,
      controllerId,
      battlefield,
      gameState,
      perm,
      creaturePerm,
    );
    if (variableBonus) {
      if (variableBonus.power !== 0 || variableBonus.toughness !== 0) {
        sources.push({
          name: perm.card.name,
          power: variableBonus.power,
          toughness: variableBonus.toughness,
          type: sourceType,
        });
      }
      continue;
    }

    const staticBonus = parseStaticAttachedPTBonusFromOracle(oracleText);
    if (staticBonus) {
      if (staticBonus.power !== 0 || staticBonus.toughness !== 0) {
        sources.push({
          name: perm.card.name,
          power: staticBonus.power,
          toughness: staticBonus.toughness,
          type: sourceType,
        });
      }
      continue;
    }
    
    // Name-table fallback when oracle text is unavailable on the card object
    if (shouldUseAttachedBonusNameTable(oracleText) && EQUIPMENT_BONUSES[cardName]) {
      const bonus = EQUIPMENT_BONUSES[cardName];
      if (bonus.power !== 0 || bonus.toughness !== 0) {
        sources.push({ name: perm.card.name, power: bonus.power, toughness: bonus.toughness, type: sourceType });
      }
      continue;
    }
    
    if (shouldUseAttachedBonusNameTable(oracleText) && AURA_BONUSES[cardName]) {
      const bonus = AURA_BONUSES[cardName];
      if (bonus.power !== 0 || bonus.toughness !== 0) {
        sources.push({ name: perm.card.name, power: bonus.power, toughness: bonus.toughness, type: sourceType });
      }
      continue;
    }
  }
  
  let totalPower = 0;
  let totalToughness = 0;
  for (const source of sources) {
    totalPower += source.power;
    totalToughness += source.toughness;
  }
  
  return { power: totalPower, toughness: totalToughness, sources };
}
