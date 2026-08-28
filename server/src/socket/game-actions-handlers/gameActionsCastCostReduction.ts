/**
 * Origin parent: server/src/socket/game-actions.ts
 *
 * Cluster moved: spell/ability cost-reduction calculation and the shared cost
 * metadata shapes it produces - static (emblem/plane/scheme/battlefield) cost
 * adjustments, battlefield cost reducers, convoke availability, and the
 * creature-type extraction helper those reducers depend on.
 *
 * Public entry symbols:
 *   - calculateCostReduction
 *   - calculateStaticSourceGenericTax
 *   - calculateConvokeOptions
 *   - extractCreatureTypes
 *   - getSharedStaticCostAdjustments
 *   - createEmptyCostReduction
 *   - detectBanneretTypeReduction
 *   - types: StaticCostTaxMetadata, CostReductionMetadata, SpellCastSourceZone,
 *            PaymentStepCostAdjustment, PendingCastCostMetadata
 */
import type { PaymentCostAdjustment, PlayerID } from "../../../../shared/src/index.js";
import type { NormalizedManaPaymentModel } from "../../state/modules/mana-check.js";
import { buildCostAdjustmentPlan, buildLiveSpellCostAdjustment } from "../../state/modules/cost-adjustments.js";
import {
  getActiveConvokeGrantSources,
  getDynamicBattlefieldCostReduction,
  spellHasConvokeForCast,
} from "../../state/modules/casting-modifiers.js";
import { hasDelirium } from "../../state/modules/game-state-effects";
import { cardManaValue } from "../../state/utils";
import { applySpellSelfCreaturePowerCostReduction } from "../../state/modules/spellSelfCreaturePowerCostReduction.js";
import { applySpellSelfTotalManaValueCostReduction } from "../../state/modules/spellSelfTotalManaValueCostReduction.js";
import { debug, debugWarn, debugError } from "../../utils/debug.js";

export interface StaticCostTaxMetadata {
  generic: number;
  messages: string[];
}

export interface CostReductionMetadata {
  generic: number;
  colors: Record<string, number>;
  messages: string[];
}

export type SpellCastSourceZone = 'hand' | 'exile' | 'graveyard' | 'library' | 'command';

export type PaymentStepCostAdjustment = PaymentCostAdjustment;

export interface PendingCastCostMetadata {
  costReduction: CostReductionMetadata;
  staticCostTax: StaticCostTaxMetadata;
  genericCostTax: number;
  paymentCostAdjustment?: PaymentStepCostAdjustment;
  paymentModel?: NormalizedManaPaymentModel;
}

export function createEmptyCostReduction(): CostReductionMetadata {
  return {
    generic: 0,
    colors: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    messages: [],
  };
}

export function getSharedStaticCostAdjustments(
  game: any,
  playerId: string,
  card: any,
): {
  reduction: CostReductionMetadata;
  genericTax: number;
  taxMessages: string[];
} {
  const nonBattlefieldAdjustment = buildLiveSpellCostAdjustment(
    buildCostAdjustmentPlan(game?.state, playerId, card, { sourceTypes: ['emblem', 'plane', 'scheme'] }),
  );
  const battlefieldTaxAdjustment = buildLiveSpellCostAdjustment(
    buildCostAdjustmentPlan(game?.state, playerId, card, { sourceTypes: ['battlefield'] }),
  );

  return {
    reduction: {
      generic: nonBattlefieldAdjustment.genericReduction,
      colors: { ...nonBattlefieldAdjustment.coloredReductions },
      messages: [...nonBattlefieldAdjustment.reductionMessages],
    },
    genericTax: battlefieldTaxAdjustment.genericTax + nonBattlefieldAdjustment.genericTax,
    taxMessages: [...battlefieldTaxAdjustment.taxMessages, ...nonBattlefieldAdjustment.taxMessages],
  };
}

export function detectBanneretTypeReduction(oracleText: string): { types: string[]; reduction: number } | null {
  const match = oracleText.match(/(\w+)\s+spells\s+and\s+(\w+)\s+spells\s+you\s+cast\s+cost\s*\{(\d+)\}\s+less\s+to\s+cast/i);
  if (!match) return null;

  return {
    types: [match[1].toLowerCase(), match[2].toLowerCase()],
    reduction: Number.parseInt(match[3], 10) || 1,
  };
}

/**
 * Extract creature types from a type line
 */
export function extractCreatureTypes(typeLine: string): string[] {
  const types: string[] = [];
  const lower = typeLine.toLowerCase();
  
  // Support em/en dash, leftover mojibake, and plain hyphen separators.
  const dashIndex = lower.search(/[\u2014\u2013\u2012\uFFFD-]/);
  if (dashIndex !== -1) {
    const subtypes = lower.slice(dashIndex + 1).trim().split(/\s+/);
    types.push(...subtypes.filter(t => t.length > 0));
  }
  
  return types;
}

/**
 * Calculate cost reduction for a spell based on battlefield effects.
 * Returns an object with the reduction for each color and generic cost.
 * 
 * Supports various cost reduction types:
 * - Creature type based: Morophon, Urza's Incubator, Herald's Horn, Goblin Warchief
 * - Card type based: Goblin Electromancer (instants/sorceries), Semblance Anvil (imprinted type)
 * - Ability based: Training Grounds (activated abilities - not spell costs)
 * - Board state based: Animar (experience/+1+1 counters), Affinity effects
 * - Color based: Ruby Medallion, Sapphire Medallion, etc.
 */
export function calculateCostReduction(
  game: any,
  playerId: string,
  card: any,
  isAbility: boolean = false
): { generic: number; colors: Record<string, number>; messages: string[] } {
  const reduction = {
    generic: 0,
    colors: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 } as Record<string, number>,
    messages: [] as string[],
  };
  
  try {
    const battlefield = game.state?.battlefield || [];
    const cardTypeLine = (card.type_line || "").toLowerCase();
    const cardOracleText = (card.oracle_text || card.oracleText || "").toLowerCase();
    const cardColors = card.colors || [];
    const cardCreatureTypes = extractCreatureTypes(cardTypeLine);
    const cardName = card.name || "Unknown";
    const cardManaCost = (card.mana_cost || "").toUpperCase();
    const hasChangeling = cardOracleText.includes('changeling')
      || (Array.isArray(card.keywords) && card.keywords.some((keyword: unknown) => String(keyword || '').toLowerCase() === 'changeling'));
    
    // Determine card characteristics
    const isCreature = cardTypeLine.includes("creature");
    const isInstant = cardTypeLine.includes("instant");
    const isSorcery = cardTypeLine.includes("sorcery");
    const isArtifact = cardTypeLine.includes("artifact");
    const isEnchantment = cardTypeLine.includes("enchantment");
    const isPlaneswalker = cardTypeLine.includes("planeswalker");
    
    // Determine colors from both colors array and mana cost
    const hasWhite = cardColors.includes("W") || cardColors.includes("White") || cardManaCost.includes("{W}");
    const hasBlue = cardColors.includes("U") || cardColors.includes("Blue") || cardManaCost.includes("{U}");
    const hasBlack = cardColors.includes("B") || cardColors.includes("Black") || cardManaCost.includes("{B}");
    const hasRed = cardColors.includes("R") || cardColors.includes("Red") || cardManaCost.includes("{R}");
    const hasGreen = cardColors.includes("G") || cardColors.includes("Green") || cardManaCost.includes("{G}");
    
    for (const perm of battlefield) {
      if (!perm || perm.controller !== playerId) continue;
      
      const permName = (perm.card?.name || "").toLowerCase();
      const permOracle = (perm.card?.oracle_text || "").toLowerCase();
      const chosenType = (perm.chosenCreatureType || "").toLowerCase();
      const imprintedCard = perm.imprintedCard; // For Semblance Anvil
      const counters = perm.counters || {};
      
      // ============================================
      // CREATURE TYPE BASED REDUCTIONS
      // ============================================
      
      // Morophon, the Boundless: Spells of the chosen creature type cost {W}{U}{B}{R}{G} less
      if (permName.includes("morophon") && chosenType) {
        if (cardCreatureTypes.includes(chosenType) || cardTypeLine.includes(chosenType) || hasChangeling) {
          reduction.colors.white += 1;
          reduction.colors.blue += 1;
          reduction.colors.black += 1;
          reduction.colors.red += 1;
          reduction.colors.green += 1;
          reduction.messages.push(`Morophon: -{W}{U}{B}{R}{G} (${chosenType})`);
        }
      }
      
      if (chosenType) {
        const chosenTypeCostReduction = permOracle.match(/creature spells of the chosen type cost \{(\d+)\} less/)
          || permOracle.match(/spells of the chosen type cost \{(\d+)\} less/);
        if (chosenTypeCostReduction) {
          const amount = parseInt(chosenTypeCostReduction[1], 10);
          const creatureOnly = chosenTypeCostReduction[0].includes('creature spells');
          const matchesType = cardCreatureTypes.includes(chosenType) || cardTypeLine.includes(chosenType) || hasChangeling;
          if (Number.isFinite(amount) && amount > 0 && matchesType && (!creatureOnly || isCreature)) {
            reduction.generic += amount;
            reduction.messages.push(`${perm.card?.name || 'Permanent'}: -{${amount}} (${chosenType})`);
          }
        }
      }
      
      // Goblin Warchief: Goblin spells cost {1} less
      if (permName.includes("goblin warchief") && cardTypeLine.includes("goblin")) {
        reduction.generic += 1;
        reduction.messages.push(`Goblin Warchief: -{1}`);
      }
      
      // Dragonspeaker Shaman: Dragon spells cost {2} less
      if (permName.includes("dragonspeaker shaman") && cardTypeLine.includes("dragon")) {
        reduction.generic += 2;
        reduction.messages.push(`Dragonspeaker Shaman: -{2}`);
      }
      
      // Stinkdrinker Daredevil: Giant spells cost {2} less
      if (permName.includes("stinkdrinker daredevil") && cardTypeLine.includes("giant")) {
        reduction.generic += 2;
        reduction.messages.push(`Stinkdrinker Daredevil: -{2}`);
      }
      
      const typePairReduction = detectBanneretTypeReduction(permOracle);
      if (typePairReduction && typePairReduction.types.some((type) => cardTypeLine.includes(type))) {
        reduction.generic += typePairReduction.reduction;
        reduction.messages.push(`${perm.card?.name || 'Permanent'}: -{${typePairReduction.reduction}}`);
      }
      
      // ============================================
      // CARD TYPE BASED REDUCTIONS
      // ============================================
      
      // Goblin Electromancer: Instant and sorcery spells cost {1} less
      if (permName.includes("goblin electromancer") || permName.includes("baral, chief of compliance")) {
        if (isInstant || isSorcery) {
          reduction.generic += 1;
          reduction.messages.push(`${perm.card?.name}: -{1} (instant/sorcery)`);
        }
      }
      
      // Etherium Sculptor: Artifact spells cost {1} less
      if (permName.includes("etherium sculptor") || permName.includes("foundry inspector")) {
        if (isArtifact) {
          reduction.generic += 1;
          reduction.messages.push(`${perm.card?.name}: -{1} (artifact)`);
        }
      }
      
      // Cloud Key: Chosen type costs {1} less
      if (permName.includes("cloud key") && chosenType) {
        const chosenCardType = chosenType.toLowerCase();
        if (cardTypeLine.includes(chosenCardType)) {
          reduction.generic += 1;
          reduction.messages.push(`Cloud Key: -{1} (${chosenType})`);
        }
      }
      
      // Semblance Anvil: Spells sharing a type with imprinted card cost {2} less
      if (permName.includes("semblance anvil") && imprintedCard) {
        const imprintedTypes = (imprintedCard.type_line || "").toLowerCase();
        const sharesType = 
          (isCreature && imprintedTypes.includes("creature")) ||
          (isArtifact && imprintedTypes.includes("artifact")) ||
          (isEnchantment && imprintedTypes.includes("enchantment")) ||
          (isInstant && imprintedTypes.includes("instant")) ||
          (isSorcery && imprintedTypes.includes("sorcery")) ||
          (isPlaneswalker && imprintedTypes.includes("planeswalker"));
        
        if (sharesType) {
          reduction.generic += 2;
          reduction.messages.push(`Semblance Anvil: -{2} (shares type)`);
        }
      }
      
      // Jhoira's Familiar: Historic spells cost {1} less (artifacts, legendaries, sagas)
      if (permName.includes("jhoira's familiar")) {
        const isLegendary = cardTypeLine.includes("legendary");
        const isSaga = cardTypeLine.includes("saga");
        if (isArtifact || isLegendary || isSaga) {
          reduction.generic += 1;
          reduction.messages.push(`Jhoira's Familiar: -{1} (historic)`);
        }
      }
      
      // ============================================
      // COLOR BASED REDUCTIONS (Medallions)
      // ============================================
      
      // Ruby Medallion: Red spells cost {1} less
      if (permName.includes("ruby medallion") && hasRed) {
        reduction.generic += 1;
        reduction.messages.push(`Ruby Medallion: -{1} (red)`);
      }
      
      // Sapphire Medallion: Blue spells cost {1} less
      if (permName.includes("sapphire medallion") && hasBlue) {
        reduction.generic += 1;
        reduction.messages.push(`Sapphire Medallion: -{1} (blue)`);
      }
      
      // Jet Medallion: Black spells cost {1} less
      if (permName.includes("jet medallion") && hasBlack) {
        reduction.generic += 1;
        reduction.messages.push(`Jet Medallion: -{1} (black)`);
      }
      
      // Pearl Medallion: White spells cost {1} less
      if (permName.includes("pearl medallion") && hasWhite) {
        reduction.generic += 1;
        reduction.messages.push(`Pearl Medallion: -{1} (white)`);
      }
      
      // Emerald Medallion: Green spells cost {1} less
      if (permName.includes("emerald medallion") && hasGreen) {
        reduction.generic += 1;
        reduction.messages.push(`Emerald Medallion: -{1} (green)`);
      }
      
      // The Wind Crystal: White spells cost {1} less
      if (permName.includes("wind crystal") && hasWhite) {
        reduction.generic += 1;
        reduction.messages.push(`The Wind Crystal: -{1} (white)`);
      }
      
      // Daru Warchief: Soldier spells cost {1} less
      if (permName.includes("daru warchief") && cardTypeLine.includes("soldier")) {
        reduction.generic += 1;
        reduction.messages.push(`Daru Warchief: -{1} (soldier)`);
      }
      
      // ============================================
      // MONUMENT COST REDUCTIONS (color creature spells)
      // ============================================
      
      // Oketra's Monument: White creature spells cost {1} less
      if (permName.includes("oketra's monument") && isCreature && hasWhite) {
        reduction.generic += 1;
        reduction.messages.push(`Oketra's Monument: -{1} (white creature)`);
      }
      
      // Bontu's Monument: Black creature spells cost {1} less
      if (permName.includes("bontu's monument") && isCreature && hasBlack) {
        reduction.generic += 1;
        reduction.messages.push(`Bontu's Monument: -{1} (black creature)`);
      }
      
      // Hazoret's Monument: Red creature spells cost {1} less
      if (permName.includes("hazoret's monument") && isCreature && hasRed) {
        reduction.generic += 1;
        reduction.messages.push(`Hazoret's Monument: -{1} (red creature)`);
      }
      
      // Kefnet's Monument: Blue creature spells cost {1} less
      if (permName.includes("kefnet's monument") && isCreature && hasBlue) {
        reduction.generic += 1;
        reduction.messages.push(`Kefnet's Monument: -{1} (blue creature)`);
      }
      
      // Rhonas's Monument: Green creature spells cost {1} less
      if (permName.includes("rhonas's monument") && isCreature && hasGreen) {
        reduction.generic += 1;
        reduction.messages.push(`Rhonas's Monument: -{1} (green creature)`);
      }
      
      // ============================================
      // BOARD STATE / COUNTER BASED REDUCTIONS
      // ============================================
      
      // Animar, Soul of Elements: Creature spells cost {1} less for each +1/+1 counter on Animar
      if (permName.includes("animar, soul of elements") || permName.includes("animar")) {
        if (isCreature) {
          const plusCounters = counters["+1/+1"] || counters["plus1plus1"] || 0;
          if (plusCounters > 0) {
            reduction.generic += plusCounters;
            reduction.messages.push(`Animar: -{${plusCounters}} (${plusCounters} +1/+1 counters)`);
          }
        }
      }
      
      // Experience counter commanders (e.g., Mizzix of the Izmagnus)
      if (permName.includes("mizzix")) {
        if (isInstant || isSorcery) {
          const expCounters = (game.state?.experienceCounters?.[playerId]) || 0;
          if (expCounters > 0) {
            reduction.generic += expCounters;
            reduction.messages.push(`Mizzix: -{${expCounters}} (experience)`);
          }
        }
      }
      
      // Edgewalker: Cleric spells cost {W}{B} less
      if (permName.includes("edgewalker") && cardTypeLine.includes("cleric")) {
        reduction.colors.white += 1;
        reduction.colors.black += 1;
        reduction.messages.push(`Edgewalker: -{W}{B} (cleric)`);
      }
      
      // ============================================
      // ABILITY COST REDUCTIONS (for activated abilities)
      // ============================================
      
      if (isAbility) {
        // Training Grounds: Activated abilities of creatures cost up to {2} less
        if (permName.includes("training grounds")) {
          reduction.generic += 2;
          reduction.messages.push(`Training Grounds: -{2} (activated ability)`);
        }
        
        // Biomancer's Familiar: Activated abilities of creatures cost {2} less
        if (permName.includes("biomancer's familiar")) {
          reduction.generic += 2;
          reduction.messages.push(`Biomancer's Familiar: -{2} (activated ability)`);
        }
        
        // Heartstone: Activated abilities of creatures cost {1} less
        if (permName.includes("heartstone")) {
          reduction.generic += 1;
          reduction.messages.push(`Heartstone: -{1} (activated ability)`);
        }
        
        // Zirda, the Dawnwaker: Activated abilities cost {2} less
        if (permName.includes("zirda")) {
          reduction.generic += 2;
          reduction.messages.push(`Zirda: -{2} (activated ability)`);
        }
      }
      
      // ============================================
      // AFFINITY EFFECTS
      // ============================================
      
      // Check for affinity in the card being cast
      // Affinity for artifacts
      if (cardOracleText.includes("affinity for artifacts")) {
        const artifactCount = battlefield.filter((p: any) => 
          p && p.controller === playerId && 
          (p.card?.type_line || "").toLowerCase().includes("artifact")
        ).length;
        if (artifactCount > 0) {
          reduction.generic += artifactCount;
          reduction.messages.push(`Affinity for artifacts: -{${artifactCount}} (${artifactCount} artifacts)`);
        }
      }
      
      // Affinity for creatures
      if (cardOracleText.includes("affinity for creatures")) {
        const creatureCount = battlefield.filter((p: any) => 
          p && p.controller === playerId && 
          (p.card?.type_line || "").toLowerCase().includes("creature")
        ).length;
        if (creatureCount > 0) {
          reduction.generic += creatureCount;
          reduction.messages.push(`Affinity for creatures: -{${creatureCount}} (${creatureCount} creatures)`);
        }
      }
      
      // Affinity for equipment
      if (cardOracleText.includes("affinity for equipment")) {
        const equipmentCount = battlefield.filter((p: any) => 
          p && p.controller === playerId && 
          (p.card?.type_line || "").toLowerCase().includes("equipment")
        ).length;
        if (equipmentCount > 0) {
          reduction.generic += equipmentCount;
          reduction.messages.push(`Affinity for equipment: -{${equipmentCount}} (${equipmentCount} equipment)`);
        }
      }
      
      // Affinity for basic land types (Plains, Island, Swamp, Mountain, Forest)
      const basicLands = ['plains', 'island', 'swamp', 'mountain', 'forest'];
      for (const landType of basicLands) {
        if (cardOracleText.includes(`affinity for ${landType}`)) {
          const landCount = battlefield.filter((p: any) => {
            if (!p || p.controller !== playerId) return false;
            const typeLine = (p.card?.type_line || "").toLowerCase();
            // Check for land type (works for both basic lands and lands with basic land types)
            return typeLine.includes('land') && typeLine.includes(landType);
          }).length;
          if (landCount > 0) {
            reduction.generic += landCount;
            const capitalizedLand = landType.charAt(0).toUpperCase() + landType.slice(1);
            reduction.messages.push(`Affinity for ${capitalizedLand}: -{${landCount}} (${landCount} ${capitalizedLand})`);
          }
        }
      }
      
      // Convoke - can tap creatures to pay for spell
      // (This is handled differently - through tapping creatures as payment)
    }
    
    // ============================================
    // CARD'S OWN COST REDUCTION (Blasphemous Act, Myr Enforcer, etc.)
    // ============================================
    
    // "This spell costs {X} less to cast for each creature on the battlefield"
    // Handles: Blasphemous Act, Myr Enforcer, Goblin Offensive, etc.
    const creatureReductionMatch = cardOracleText.match(/this spell costs \{?(\d+)\}? less to cast for each creature/i);
    if (creatureReductionMatch) {
      const reductionPerCreature = parseInt(creatureReductionMatch[1], 10);
      const creatureCount = battlefield.filter((p: any) => 
        p && (p.card?.type_line || "").toLowerCase().includes("creature")
      ).length;
      const totalReduction = reductionPerCreature * creatureCount;
      if (totalReduction > 0) {
        reduction.generic += totalReduction;
        reduction.messages.push(`${cardName}: -{${totalReduction}} (${creatureCount} creatures +� {${reductionPerCreature}})`);
      }
    }
    
    // "This spell costs {X} less to cast for each artifact you control"
    // Handles: Frogmite / affinity-style fixed-per-artifact text (not total-MV patterns).
    const artifactReductionMatch = cardOracleText.match(/this spell costs \{?(\d+)\}? less to cast for each artifact/i);
    if (artifactReductionMatch) {
      const reductionPerArtifact = parseInt(artifactReductionMatch[1], 10);
      const artifactCount = battlefield.filter((p: any) => 
        p && p.controller === playerId && 
        (p.card?.type_line || "").toLowerCase().includes("artifact")
      ).length;
      const totalReduction = reductionPerArtifact * artifactCount;
      if (totalReduction > 0) {
        reduction.generic += totalReduction;
        reduction.messages.push(`${cardName}: -{${totalReduction}} (${artifactCount} artifacts +� {${reductionPerArtifact}})`);
      }
    }
    
    // "This spell costs {X} less to cast, where X is the total mana value of [filter] you control"
    // Handles: Metalwork Colossus (noncreature artifacts), Excalibur / Sword of Eden (historic), etc.
    {
      const totalMvSelfReduction = applySpellSelfTotalManaValueCostReduction({
        oracleText: cardOracleText,
        cardName,
        battlefield,
        playerId,
      });
      if (totalMvSelfReduction.generic > 0) {
        reduction.generic += totalMvSelfReduction.generic;
        reduction.messages.push(...totalMvSelfReduction.messages);
      }
    }

    // "This spell costs {X} less to cast, where X is the total/greatest power ... creatures you control"
    // Handles: Ghalta, Primal Hunger (total power), The Great Henge (greatest power).
    {
      const creaturePowerSelfReduction = applySpellSelfCreaturePowerCostReduction({
        oracleText: cardOracleText,
        cardName,
        battlefield,
        playerId,
        gameState: game?.state,
      });
      if (creaturePowerSelfReduction.generic > 0) {
        reduction.generic += creaturePowerSelfReduction.generic;
        reduction.messages.push(...creaturePowerSelfReduction.messages);
      }
    }

    const distinctGraveyardManaValueReduction = cardOracleText.match(/this spell costs \{1\} less to cast for each different mana value among cards in your graveyard/i);
    if (distinctGraveyardManaValueReduction) {
      const graveyard = Array.isArray(game.state?.zones?.[playerId]?.graveyard)
        ? game.state.zones[playerId].graveyard
        : [];
      const distinctManaValues = new Set<number>();
      for (const graveyardCard of graveyard) {
        const manaValue = Number(cardManaValue(graveyardCard));
        if (Number.isFinite(manaValue) && manaValue >= 0) {
          distinctManaValues.add(manaValue);
        }
      }

      if (distinctManaValues.size > 0) {
        reduction.generic += distinctManaValues.size;
        reduction.messages.push(`${cardName}: -{${distinctManaValues.size}} (${distinctManaValues.size} different mana value${distinctManaValues.size === 1 ? '' : 's'} in graveyard)`);
      }
    }

    // Ability-word / as-long-as / if / for-each cast-time cost riders on the spell itself
    // (Drag to the Roots Delirium, Temporal Intervention Void, Rime Chill Vivid).
    {
      const asLongAsCostLess = cardOracleText.match(
        /this spell costs \{(\d+)\} less to cast as long as ([^.]+)/i
      );
      if (asLongAsCostLess) {
        const amount = parseInt(asLongAsCostLess[1], 10);
        const condition = String(asLongAsCostLess[2] || '').toLowerCase();
        let active = false;
        if (
          /four or more card types among cards in your graveyard/i.test(condition) ||
          /\bdelirium\b/i.test(condition)
        ) {
          active = hasDelirium(game as any, playerId);
        }
        if (active && Number.isFinite(amount) && amount > 0) {
          reduction.generic += amount;
          reduction.messages.push(`${cardName}: -{${amount}} (as-long-as cost rider)`);
        }
      }

      const ifCostLess = cardOracleText.match(
        /this spell costs \{(\d+)\} less to cast if ([^.]+)/i
      );
      if (ifCostLess) {
        const amount = parseInt(ifCostLess[1], 10);
        const condition = String(ifCostLess[2] || '').toLowerCase();
        let active = false;
        if (
          /nonland permanent left the battlefield this turn/i.test(condition) ||
          /spell was warped this turn/i.test(condition)
        ) {
          const leftMap = game.state?.permanentLeftBattlefieldThisTurn;
          const warpedMap = game.state?.spellWasWarpedThisTurn;
          const anyLeft =
            leftMap &&
            typeof leftMap === 'object' &&
            Object.values(leftMap).some((v) => v === true);
          const anyWarped =
            warpedMap &&
            typeof warpedMap === 'object' &&
            Object.values(warpedMap).some((v) => v === true);
          active = Boolean(anyLeft || anyWarped);
        }
        if (active && Number.isFinite(amount) && amount > 0) {
          reduction.generic += amount;
          reduction.messages.push(`${cardName}: -{${amount}} (conditional cast-cost rider)`);
        }
      }

      const vividColorCostLess = cardOracleText.match(
        /this spell costs \{(\d+)\} less to cast for each color among permanents you control/i
      );
      if (vividColorCostLess) {
        const perColor = parseInt(vividColorCostLess[1], 10);
        const colorSet = new Set<string>();
        for (const perm of battlefield) {
          if (!perm || perm.controller !== playerId) continue;
          const colors = Array.isArray(perm.card?.colors)
            ? perm.card.colors
            : Array.isArray(perm.colors)
              ? perm.colors
              : [];
          for (const c of colors) {
            const key = String(c || '').toUpperCase();
            if (key === 'W' || key === 'U' || key === 'B' || key === 'R' || key === 'G') {
              colorSet.add(key);
            } else if (/^white$/i.test(key)) colorSet.add('W');
            else if (/^blue$/i.test(key)) colorSet.add('U');
            else if (/^black$/i.test(key)) colorSet.add('B');
            else if (/^red$/i.test(key)) colorSet.add('R');
            else if (/^green$/i.test(key)) colorSet.add('G');
          }
          if (colors.length === 0) {
            const manaCost = String(perm.card?.mana_cost || '').toUpperCase();
            for (const sym of ['W', 'U', 'B', 'R', 'G'] as const) {
              if (manaCost.includes(`{${sym}}`)) colorSet.add(sym);
            }
          }
        }
        const total = (Number.isFinite(perColor) ? perColor : 0) * colorSet.size;
        if (total > 0) {
          reduction.generic += total;
          reduction.messages.push(
            `${cardName}: -{${total}} (${colorSet.size} color${colorSet.size === 1 ? '' : 's'} among permanents)`
          );
        }
      }
    }
    
    // Log total reduction
    if (reduction.messages.length > 0) {
      debug(1, `[costReduction] ${cardName}: ${reduction.messages.join(", ")}`);
    }
    
  } catch (err) {
    debugWarn(1, "[costReduction] Error calculating cost reduction:", err);
  }

  const dynamicBattlefieldReduction = getDynamicBattlefieldCostReduction(game.state, playerId as PlayerID, card);
  reduction.generic += dynamicBattlefieldReduction.generic;
  for (const [color, amount] of Object.entries(dynamicBattlefieldReduction.colors)) {
    reduction.colors[color] = (reduction.colors[color] || 0) + (Number(amount) || 0);
  }
  reduction.messages.push(...dynamicBattlefieldReduction.messages);

  const sharedStaticAdjustment = getSharedStaticCostAdjustments(game, playerId, card);
  reduction.generic += sharedStaticAdjustment.reduction.generic;
  for (const [color, amount] of Object.entries(sharedStaticAdjustment.reduction.colors)) {
    reduction.colors[color] = (reduction.colors[color] || 0) + (Number(amount) || 0);
  }
  reduction.messages.push(...sharedStaticAdjustment.reduction.messages);
  
  return reduction;
}

export function calculateStaticSourceGenericTax(
  game: any,
  playerId: string,
  card: any,
): { generic: number; messages: string[] } {
  const sharedStaticAdjustment = getSharedStaticCostAdjustments(game, playerId, card);
  return {
    generic: sharedStaticAdjustment.genericTax,
    messages: sharedStaticAdjustment.taxMessages,
  };
}

/**
 * Calculate available convoke reduction for a spell
 * Returns list of creatures that can be tapped for convoke and their contribution
 * 
 * Convoke rule: Each creature you tap while casting this spell pays for {1} or one mana of that creature's color.
 * 
 * IMPORTANT: Cards that GRANT convoke to other spells (like Wand of the Worldsoul) should NOT
 * trigger convoke for themselves. We detect this by looking for patterns like:
 * - "the next spell you cast this turn has convoke"
 * - "spells you cast have convoke"
 */
export function calculateConvokeOptions(
  game: any,
  playerId: string,
  card: any,
  castSourceZone?: string,
): {
  availableCreatures: Array<{
    id: string;
    name: string;
    colors: string[];
    canTapFor: string[]; // List of mana types this creature can contribute
  }>;
  messages: string[];
  grantSources?: string[];
} {
  const options = {
    availableCreatures: [] as Array<{
      id: string;
      name: string;
      colors: string[];
      canTapFor: string[];
    }>,
    messages: [] as string[],
    grantSources: [] as string[],
  };

  try {
    const battlefield = game.state?.battlefield || [];
    if (!spellHasConvokeForCast(game.state, playerId as PlayerID, card, castSourceZone)) {
      return options;
    }

    options.grantSources = getActiveConvokeGrantSources(game.state, playerId as PlayerID, card, castSourceZone);
    if (options.grantSources.length > 0) {
      options.messages.push(`Convoke granted by: ${options.grantSources.join(', ')}`);
    }

    // Find all untapped creatures controlled by the player
    for (const perm of battlefield) {
      if (!perm || perm.controller !== playerId) continue;
      if (perm.tapped) continue;

      const permTypeLine = (perm.card?.type_line || "").toLowerCase();
      if (!permTypeLine.includes("creature")) continue;

      const permColors = perm.card?.colors || [];
      const canTapFor: string[] = ['generic']; // Can always pay for {1}

      // Add specific colors this creature can contribute
      if (permColors.includes('W')) canTapFor.push('white');
      if (permColors.includes('U')) canTapFor.push('blue');
      if (permColors.includes('B')) canTapFor.push('black');
      if (permColors.includes('R')) canTapFor.push('red');
      if (permColors.includes('G')) canTapFor.push('green');

      // Colorless creatures can only pay generic
      if (permColors.length === 0) {
        canTapFor.push('colorless');
      }

      options.availableCreatures.push({
        id: perm.id,
        name: perm.card?.name || "Unknown Creature",
        colors: permColors,
        canTapFor,
      });
    }

    if (options.availableCreatures.length > 0) {
      options.messages.push(
        `Convoke available: ${options.availableCreatures.length} untapped creature(s)`
      );
    }
  } catch (error) {
    debugError(1, "[calculateConvokeOptions] Error:", error);
  }

  return options;
}
