// server/src/socket/util-handlers/tryCalculateManaProductionBonusesAndTotal.ts
// Origin parent: server/src/socket/util.ts
// Cluster moved: calculateManaProduction STEP 3 aura bonuses, STEP 4 global
//   multipliers, and STEP 5 total.
// Public entry symbols: tryCalculateManaProductionBonusesAndTotal.
// Returns the finalized result (first defined wins for the remaining dispatcher).

import type { ManaProductionInfo } from "./manaProductionTypes.js";
import { getEffectiveBasicLandTypes } from "../../../../shared/src/landTypes.js";
import { resolvePermanentChosenColorSymbol } from "../../state/modules/mana-abilities.js";

export type CalculateManaProductionBonusesAndTotalArgs = {
  result: ManaProductionInfo;
  battlefield: any[];
  playerId: string;
  permanent: any;
  chosenColor?: string;
  typeLine: string;
  card: any;
};

export function tryCalculateManaProductionBonusesAndTotal(
  args: CalculateManaProductionBonusesAndTotalArgs,
): ManaProductionInfo | undefined {
  const {
    result,
    battlefield,
    playerId,
    permanent,
    chosenColor,
    typeLine,
    card,
  } = args;

  // ===== STEP 3: Check for aura enchantments on this permanent (Wild Growth, etc.) =====
  
  // Find auras attached to this permanent
  for (const perm of battlefield) {
    if (!perm || perm.controller !== playerId) continue;
    
    const permTypeLine = (perm.card?.type_line || '').toLowerCase();
    const permOracleText = (perm.card?.oracle_text || '').toLowerCase();
    const permName = (perm.card?.name || '').toLowerCase();
    
    // Check if this is an aura enchanting our permanent
    const isAura = permTypeLine.includes('enchantment') && permTypeLine.includes('aura');
    const isAttachedToUs = (perm as any).attachedTo === permanent.id || 
                           (perm as any).enchanting === permanent.id;
    
    if (isAura && isAttachedToUs) {
      // Wild Growth - "Whenever enchanted land is tapped for mana, add an additional {G}"
      if (permName.includes('wild growth') || 
          (permOracleText.includes('additional {g}') && permOracleText.includes('tapped for mana'))) {
        result.bonusMana.push({ color: 'G', amount: 1 });
      }
      
      // Fertile Ground - "Whenever enchanted land is tapped for mana, add an additional mana of any color"
      if (permName.includes('fertile ground') ||
          (permOracleText.includes('additional') && permOracleText.includes('any color') && permOracleText.includes('tapped for mana'))) {
        result.bonusMana.push({ color: 'ANY', amount: 1 });
        result.requiresBonusColorChoice = true;
      }
      
      // Overgrowth - "Whenever enchanted land is tapped for mana, add {G}{G}"
      if (permName.includes('overgrowth') ||
          (permOracleText.includes('add {g}{g}') && permOracleText.includes('tapped for mana'))) {
        result.bonusMana.push({ color: 'G', amount: 2 });
      }
      
      // Aura: tapped for mana -> add one mana of the chosen color (Utopia Sprawl template)
      if (
        /tapped for mana/i.test(permOracleText)
        && /add (?:one mana|an additional mana|a mana) of the chosen colou?r/i.test(permOracleText)
      ) {
        const chosenAuraColor = resolvePermanentChosenColorSymbol(perm) || chosenColor || 'G';
        result.bonusMana.push({ color: chosenAuraColor, amount: 1 });
      }
      
      // Dawn's Reflection - "Whenever enchanted land is tapped for mana, add two mana of any one color"
      if (permName.includes("dawn's reflection")) {
        result.bonusMana.push({ color: 'ANY', amount: 2 });
        result.requiresBonusColorChoice = true;
      }
      
      // Market Festival - "Whenever enchanted land is tapped for mana, add two mana of any one color"
      if (permName.includes('market festival')) {
        result.bonusMana.push({ color: 'ANY', amount: 2 });
        result.requiresBonusColorChoice = true;
      }
      
      // Weirding Wood - "Whenever enchanted land is tapped for mana, add an additional mana of any color"
      if (permName.includes('weirding wood')) {
        result.bonusMana.push({ color: 'ANY', amount: 1 });
        result.requiresBonusColorChoice = true;
      }
      
      // Trace of Abundance - "Whenever enchanted land is tapped for mana, add one mana of any color"
      if (permName.includes('trace of abundance')) {
        result.bonusMana.push({ color: 'ANY', amount: 1 });
        result.requiresBonusColorChoice = true;
      }
      
      // Sheltered Aerie - "Whenever enchanted land is tapped for mana, add one mana of any color"
      if (permName.includes('sheltered aerie')) {
        result.bonusMana.push({ color: 'ANY', amount: 1 });
        result.requiresBonusColorChoice = true;
      }
    }
  }
  
  // ===== STEP 4: Check for global mana-boosting effects =====
  
  const isLand = typeLine.includes('land');
  const cardColors = (card.colors || []).map((c: string) => c.toUpperCase());
  
  for (const perm of battlefield) {
    if (!perm) continue;
    
    const permOracleText = (perm.card?.oracle_text || '').toLowerCase();
    const permName = (perm.card?.name || '').toLowerCase();
    const permController = perm.controller;
    
    // Only apply effects from our own permanents or global effects
    const isOurs = permController === playerId;
    
    // Chosen-color land mana doublers (Caged Sun / Gauntlet of Power templates)
    if (
      isLand
      && /tapped for mana of the chosen colou?r/i.test(permOracleText)
      && /add (?:one )?additional mana of that colou?r/i.test(permOracleText)
    ) {
      const requiresBasic = /\bbasic land\b/i.test(permOracleText);
      const requiresYouControl = /land you control/i.test(permOracleText);
      const hasBasicType =
        typeLine.includes('basic') || getEffectiveBasicLandTypes(permanent as any).length > 0;
      if (requiresBasic && !hasBasicType) {
        // skip
      } else if (requiresYouControl && !isOurs) {
        // skip opponents' lands for controller-limited effects
      } else {
        const chosenDoublerColor = resolvePermanentChosenColorSymbol(perm) || 'C';
        const producedMatches =
          result.colors.map((c) => String(c).toUpperCase()).includes(String(chosenDoublerColor).toUpperCase())
          || (chosenColor && String(chosenDoublerColor).toUpperCase() === String(chosenColor).toUpperCase());
        if (producedMatches && chosenDoublerColor !== 'C') {
          result.bonusMana.push({ color: chosenDoublerColor, amount: 1 });
        }
      }
    }
    
    // Mirari's Wake - "Whenever you tap a land for mana, add one mana of any type that land produced"
    if (permName.includes("mirari's wake") && isOurs && isLand) {
      // Adds one of the same type
      const producedColor = chosenColor || result.colors[0] || 'C';
      result.bonusMana.push({ color: producedColor, amount: 1 });
    }
    
    // Zendikar Resurgent - "Whenever you tap a land for mana, add one mana of any type that land produced"
    if (permName.includes('zendikar resurgent') && isOurs && isLand) {
      const producedColor = chosenColor || result.colors[0] || 'C';
      result.bonusMana.push({ color: producedColor, amount: 1 });
    }
    
    // Mana Reflection - "If you tap a permanent for mana, it produces double"
    if (permName.includes('mana reflection') && isOurs) {
      result.multiplier *= 2;
    }
    
    // Nyxbloom Ancient - "If you tap a permanent for mana, it produces three times as much"
    if (permName.includes('nyxbloom ancient') && isOurs) {
      result.multiplier *= 3;
    }
    
    // Mana Flare - "Whenever a player taps a land for mana, that land produces an additional mana"
    if (permName.includes('mana flare') && isLand) {
      const producedColor = chosenColor || result.colors[0] || 'C';
      result.bonusMana.push({ color: producedColor, amount: 1 });
    }
    
    // Dictate of Karametra - "Whenever a player taps a land for mana, that land produces an additional mana"
    if (permName.includes('dictate of karametra') && isLand) {
      const producedColor = chosenColor || result.colors[0] || 'C';
      result.bonusMana.push({ color: producedColor, amount: 1 });
    }
    
    // Heartbeat of Spring - Same as Mana Flare
    if (permName.includes('heartbeat of spring') && isLand) {
      const producedColor = chosenColor || result.colors[0] || 'C';
      result.bonusMana.push({ color: producedColor, amount: 1 });
    }
    
    // Vorinclex, Voice of Hunger - "Whenever you tap a land for mana, add one mana of any type that land could produce"
    if (permName.includes('vorinclex') && permName.includes('voice of hunger') && isOurs && isLand) {
      const producedColor = chosenColor || result.colors[0] || 'C';
      result.bonusMana.push({ color: producedColor, amount: 1 });
    }
  }
  
  // ===== STEP 5: Calculate total mana =====
  
  // Base amount * multiplier
  let total = result.baseAmount * result.multiplier;
  
  // Add bonus mana (bonuses are NOT multiplied in most cases, but for simplicity we add them after).
  // ANY-color bonuses are chosen via a follow-up prompt and are excluded until resolved.
  for (const bonus of result.bonusMana) {
    if (String(bonus.color || '').toUpperCase() === 'ANY') continue;
    total += bonus.amount;
  }
  
  result.totalAmount = Math.max(0, total);
  
  // If no colors determined, default to colorless
  if (result.colors.length === 0 && result.totalAmount > 0) {
    result.colors = ['C'];
  }
  
  return result;
}
