/**
 * Origin parent: server/src/socket/ai.ts
 *
 * Cluster moved: getManaProduction, getAIManaProductionOptions,
 * chooseAIManaColorForActivation, applyAIManaLifeLoss, hasManaAbility,
 * hasCreatureSummoningSickness, scoreAISacrificePermanentForManaAbility,
 * calculateAvailableMana, canAIPayAdditionalCost.
 *
 * Public entry symbols: getManaProduction, getAIManaProductionOptions,
 * chooseAIManaColorForActivation, applyAIManaLifeLoss, hasManaAbility,
 * hasCreatureSummoningSickness, scoreAISacrificePermanentForManaAbility,
 * calculateAvailableMana, canAIPayAdditionalCost.
 */
import type { PlayerID } from "../../../../shared/src/types.js";
import { cardAnalyzer } from "../../../../rules-engine/src/CardAnalyzer.js";
import {
  getEffectiveBasicLandTypes as getBattlefieldGrantedBasicLandTypes,
  getOpponentLandProducibleColorSymbols,
} from "../../state/modules/mana-abilities.js";
import { manaColorForBasicLandType } from "../../../../shared/src/landTypes.js";
import { getAvailableMana, parseManaCost, getTotalManaFromPool } from "../../state/modules/mana-check.js";
import { buildCounterRemovalCostOptions } from "../../state/modules/counter-removal-costs.js";
import { debugWarn } from "../../utils/debug.js";
import type { AdditionalCostResult } from "../land-helpers.js";
import { collectAIManaColorNeedWeights, pickAIManaColorByNeedWeights } from "./aiManaColorNeedHelpers.js";
import { calculateCardThemeAlignment, ensureAIDeckProfile } from "./aiDeckProfileHandlers.js";
import { permanentCannotActivateTapAbilities } from "../../state/modules/staticEffectSpecActivationLocks.js";

/**
 * Determine what color of mana a permanent can produce based on its type and oracle text
 * Works for lands, mana rocks (artifacts), and creatures with mana abilities
 */
export function getManaProduction(card: any): string[] {
  const typeLine = (card?.type_line || '').toLowerCase();
  const oracleText = (card?.oracle_text || '').toLowerCase();
  const colors: string[] = [];
  
  // Basic land types produce their respective colors
  if (typeLine.includes('plains')) colors.push('W');
  if (typeLine.includes('island')) colors.push('U');
  if (typeLine.includes('swamp')) colors.push('B');
  if (typeLine.includes('mountain')) colors.push('R');
  if (typeLine.includes('forest')) colors.push('G');
  
  // Check oracle text for mana abilities (tap: add mana patterns)
  // Common patterns: "{T}: Add {W}", "Add {G}", "{T}: Add one mana of any color"
  if (oracleText.includes('{w}') || oracleText.includes('add {w}')) colors.push('W');
  if (oracleText.includes('{u}') || oracleText.includes('add {u}')) colors.push('U');
  if (oracleText.includes('{b}') || oracleText.includes('add {b}')) colors.push('B');
  if (oracleText.includes('{r}') || oracleText.includes('add {r}')) colors.push('R');
  if (oracleText.includes('{g}') || oracleText.includes('add {g}')) colors.push('G');
  if (oracleText.includes('{c}') || oracleText.includes('add {c}')) colors.push('C');
  
  // Opponent-land "could produce" sources need battlefield context (Exotic Orchard / Fellwar).
  // Return empty here so getAIManaProductionOptions can fill from the top-layer land scan.
  if (/that (?:a |an )?land an opponent controls could produce/i.test(oracleText)) {
    return [];
  }
  
  // Permanents that add any color (e.g., Command Tower, City of Brass, Mana Confluence, Chromatic Lantern affected permanents)
  // IMPORTANT: Check that it's NOT a conditional "any color" like Exotic Orchard
  if ((oracleText.includes('add one mana of any color') || 
       oracleText.includes('any color of mana') ||
       oracleText.includes('mana of any one color') ||
       oracleText.includes('add one mana of any type')) &&
      !oracleText.includes('land an opponent controls') && // Exclude Exotic Orchard, Fellwar Stone
      !oracleText.includes('opponents control')) { // Exclude other conditional cards
    // Keep {C} from a separate tap (Secluded Courtyard / Cavern of Souls / Unclaimed Territory).
    return [...new Set(['W', 'U', 'B', 'R', 'G', ...colors])];
  }
  
  // Sol Ring and similar - "Add {C}{C}" means it produces 2 colorless
  // For simplicity, we just track that it can produce colorless
  if (oracleText.includes('{c}{c}') || oracleText.includes('add {c}{c}')) {
    colors.push('C');
  }
  
  // If no specific colors found but it's a land, assume colorless
  if (colors.length === 0 && typeLine.includes('land')) {
    colors.push('C');
  }
  
  // Remove duplicates
  return [...new Set(colors)];
}

export function getAIManaProductionOptions(game: any, playerId: PlayerID, permanent: any): string[] {
  let producedColors = getManaProduction(permanent?.card);
  const cardName = String(permanent?.card?.name || '').toLowerCase();
  const oracleText = String(permanent?.card?.oracle_text || '').toLowerCase();

  if (producedColors.length === 0
      && /that (?:a |an )?land an opponent controls could produce/i.test(oracleText)) {
    producedColors = getOpponentLandProducibleColorSymbols(game?.state, playerId);
  }

  // Choose-a-color dynamic taps (Nyx Lotus / Nykthos devotion, Three Tree City invest line, etc.).
  // getManaProduction only sees fixed {WUBRGC} symbols, so expose WUBRG when the AI can pick a color.
  const isChooseColorAmountMana =
    (/choose a colou?r/i.test(oracleText) || /mana of that colou?r/i.test(oracleText))
    && (
      /add an amount of mana/i.test(oracleText)
      || /add one mana of that colou?r/i.test(oracleText)
      || /devotion to that colou?r/i.test(oracleText)
      || /for each charge counter/i.test(oracleText)
      || /equal to the number of creatures you control of the chosen type/i.test(oracleText)
    );
  const isThreeTreeInvestReady =
    cardName.includes('three tree city')
    && String(permanent?.chosenCreatureType || '').trim()
    && /add an amount of mana of that colou?r/i.test(oracleText);
  if (isChooseColorAmountMana || isThreeTreeInvestReady) {
    producedColors = [...producedColors, 'W', 'U', 'B', 'R', 'G'];
    const isLand = String(permanent?.card?.type_line || '').toLowerCase().includes('land');
    if (/\badd\s*\{c\}/i.test(oracleText) || isLand) {
      producedColors = [...producedColors, 'C'];
    }
  }

  // Yavimaya / Urborg / Ashaya: granted basic land types are not on the printed type line.
  for (const landType of getBattlefieldGrantedBasicLandTypes(game?.state, permanent)) {
    const mana = manaColorForBasicLandType(landType);
    if (mana) producedColors = [...producedColors, mana];
  }

  return [...new Set(producedColors.filter((color) => ['W', 'U', 'B', 'R', 'G', 'C'].includes(String(color).toUpperCase())))];
}

export function chooseAIManaColorForActivation(game: any, playerId: PlayerID, producedColors: string[]): string {
  if (producedColors.length === 0) return 'C';

  const manaPool = (game.state?.manaPool || {})[playerId] || {
    white: 0,
    blue: 0,
    black: 0,
    red: 0,
    green: 0,
    colorless: 0,
  };
  const needWeights = collectAIManaColorNeedWeights(game, playerId);
  return pickAIManaColorByNeedWeights(producedColors, needWeights, manaPool as any);
}

export function applyAIManaLifeLoss(game: any, playerId: PlayerID, amount: number, trackDamage: boolean): void {
  const finalAmount = Number(amount || 0);
  if (finalAmount <= 0) return;

  game.state.life = game.state.life || {};
  const startingLife = Number(game.state.startingLife || 40);
  const currentLife = Number(game.state.life?.[playerId] ?? startingLife);
  game.state.life[playerId] = Math.max(0, currentLife - finalAmount);

  try {
    if (trackDamage) {
      (game.state as any).damageTakenThisTurnByPlayer = (game.state as any).damageTakenThisTurnByPlayer || {};
      (game.state as any).damageTakenThisTurnByPlayer[String(playerId)] =
        (((game.state as any).damageTakenThisTurnByPlayer[String(playerId)] || 0) + finalAmount);
    }

    (game.state as any).lifeLostThisTurn = (game.state as any).lifeLostThisTurn || {};
    (game.state as any).lifeLostThisTurn[String(playerId)] =
      (((game.state as any).lifeLostThisTurn[String(playerId)] || 0) + finalAmount);
  } catch {
    // best-effort only
  }

  const player = (game.state.players || []).find((entry: any) => entry?.id === playerId);
  if (player) {
    player.life = game.state.life[playerId];
  }
}

/**
 * Check if a permanent has a mana ability (can tap for mana)
 * IMPORTANT: Cards that "create" treasure tokens should NOT be treated as having mana abilities
 * Only actual Treasure tokens (with the sacrifice ability) have mana abilities
 */
export function hasManaAbility(card: any): boolean {
  const nativeOracleText = String(card?.oracle_text || '');
  const oracleText = (card?.oracle_text || '').toLowerCase();
  const typeLine = (card?.type_line || '').toLowerCase();
  const cardName = (card?.name || '').toLowerCase();
  
  // Lands always have implicit mana abilities (basic lands)
  if (typeLine.includes('land')) return true;
  
  // IMPORTANT: Cards that "create" treasure/food/clue tokens do NOT have mana abilities
  // Only actual Treasure tokens have mana abilities
  // Detect cards that create treasures vs actual treasures
  if (oracleText.includes('create') && 
      (oracleText.includes('treasure') || oracleText.includes('food') || oracleText.includes('clue'))) {
    // This card creates tokens, it's not itself a token with mana ability
    // Check if it's actually a Treasure subtype by looking at type_line
    const hasEmDash = typeLine.includes("—") || typeLine.includes("-");
    if (hasEmDash) {
      const subtypePortion = typeLine.split(/[—-]/)[1] || "";
      // If not an actual Treasure/Food/Clue subtype, don't give it mana abilities
      if (!subtypePortion.includes("treasure") && 
          !subtypePortion.includes("food") && 
          !subtypePortion.includes("clue")) {
        return false;
      }
    } else {
      // No subtype section, so this is a card that creates tokens, not a token itself
      return false;
    }
  }
  
  // Check for tap-to-add-mana pattern: "{T}: Add" or "{T}, ... : Add"
  if (oracleText.includes('{t}') && oracleText.includes('add {')) return true;
  if (oracleText.includes('{t}') && oracleText.includes('add one mana')) return true;
  if (oracleText.includes('{t}') && oracleText.includes('add mana')) return true;
  // Nyx Lotus / similar: "{T}: Choose a color. Add an amount of mana of that color..."
  if (oracleText.includes('{t}') && oracleText.includes('add an amount of mana')) return true;

  const nativeActivatedManaAbilityPattern = /(?:^|\r?\n|\.\s+)(?:\{[^}]+\}(?:,?\s*\{[^}]+\})*(?:,?\s*(?:sacrifice|pay|discard|exile|remove|tap|untap)[^:]*?)?|(?:sacrifice|pay|discard|exile|remove|tap|untap)[^:]*?)\s*:\s*add\s+/i;
  if (nativeActivatedManaAbilityPattern.test(nativeOracleText) && !/target/i.test(oracleText)) {
    return true;
  }
  
  // Treasure tokens: "{T}, Sacrifice this artifact: Add one mana of any color."
  // Check for this specific pattern (sacrifice to add mana)
  if (oracleText.includes('sacrifice') && oracleText.includes('add one mana of any color')) {
    // Verify it's actually a Treasure artifact by checking type_line
    if (typeLine.includes('treasure') || typeLine.includes('artifact')) {
      return true;
    }
  }
  
  // Known mana rocks and dorks
  const knownManaSources = [
    'sol ring', 'mana crypt', 'mana vault', 'arcane signet', 'mind stone',
    'fellwar stone', 'thought vessel', 'commander\'s sphere', 'chromatic lantern',
    'llanowar elves', 'elvish mystic', 'birds of paradise', 'noble hierarch',
    'deathrite shaman', 'avacyn\'s pilgrim', 'elves of deep shadow',
    'bloom tender', 'priest of titania', 'elvish archdruid'
  ];
  if (knownManaSources.some(name => cardName.includes(name))) return true;
  
  return false;
}

/**
 * Check if a creature has summoning sickness (can't tap for mana)
 */
export function hasCreatureSummoningSickness(perm: any): boolean {
  const typeLine = (perm.card?.type_line || '').toLowerCase();
  if (!typeLine.includes('creature')) return false;
  
  // Check for summoning sickness flag or if it just entered
  return perm.summoningSickness === true;
}

export function scoreAISacrificePermanentForManaAbility(game: any, playerId: PlayerID, permanent: any): number {
  const profile = ensureAIDeckProfile(game, playerId);
  const analysis = cardAnalyzer.analyzeCard(permanent);
  const typeLine = String(permanent?.card?.type_line || '').toLowerCase();
  const power = Number(permanent?.card?.power || permanent?.basePower || 0) || 0;
  const toughness = Number(permanent?.card?.toughness || permanent?.baseToughness || 0) || 0;
  let score = 0;

  if ((permanent as any)?.isCommander) score += 1000;
  if (typeLine.includes('land')) score += 500;
  if (typeLine.includes('planeswalker')) score += 500;
  if ((permanent as any)?.isToken) score -= 150;
  if (typeLine.includes('treasure')) score -= 80;
  if (typeLine.includes('clue') || typeLine.includes('food')) score -= 40;
  if (hasManaAbility(permanent?.card)) score += 35;

  score += analysis.comboPotential * 12;
  score += calculateCardThemeAlignment(permanent?.card || permanent, profile) * 4;
  score += power + toughness;

  return score;
}

/**
 * Calculate available mana from untapped mana sources on the battlefield
 * Includes lands, mana rocks (artifacts), and creatures with mana abilities
 * Returns total mana available and a map of which sources can produce each color
 */
/**
 * Calculate available mana for AI using the same system as humans
 * This ensures consistency between AI and human mana calculations
 */
export function calculateAvailableMana(game: any, playerId: PlayerID): { total: number; colors: Record<string, number>; sourcesByColor: Map<string, string[]> } {
  // Use the shared getAvailableMana function from mana-check.ts
  const manaPool = getAvailableMana(game.state, playerId);
  
  // Convert the pool format to what AI expects
  const colors: Record<string, number> = {
    W: manaPool.white || 0,
    U: manaPool.blue || 0,
    B: manaPool.black || 0,
    R: manaPool.red || 0,
    G: manaPool.green || 0,
    C: manaPool.colorless || 0,
  };
  
  const total = getTotalManaFromPool(manaPool);
  
  // Build sourcesByColor map for payment source tracking
  // This requires iterating through battlefield to find which permanents produce which colors
  const sourcesByColor = new Map<string, string[]>();
  for (const color of ['W', 'U', 'B', 'R', 'G', 'C']) {
    sourcesByColor.set(color, []);
  }
  
  const battlefield = game.state?.battlefield || [];
  for (const perm of battlefield) {
    if (perm && perm.controller === playerId && !perm.tapped) {
      // Check if this permanent can produce mana
      if (!hasManaAbility(perm.card)) continue;
      
      // Creatures with summoning sickness can't tap for mana
      if (hasCreatureSummoningSickness(perm)) continue;
      if (permanentCannotActivateTapAbilities(perm, game.state)) continue;

      const producedColors = getAIManaProductionOptions(game, playerId, perm);
      if (producedColors.length === 0) continue;
      
      // Track which sources can produce each color
      for (const color of producedColors) {
        const sources = sourcesByColor.get(color) || [];
        sources.push(perm.id);
        sourcesByColor.set(color, sources);
      }
    }
  }
  
  return { total, colors, sourcesByColor };
}

/**
 * Check if the AI has the necessary resources to pay any non-mana additional costs of a prospective spell cast.
 * This prevents the AI from getting stuck in an infinite casting loop for spells with unpayable costs (e.g. sacrificing a creature when none exist).
 */
export function canAIPayAdditionalCost(
  game: any,
  playerId: PlayerID,
  candidate: any,
  additionalCost: AdditionalCostResult
): boolean {
  if (!additionalCost) return true;

  try {
    switch (additionalCost.type) {
      case 'pay_life': {
        const player = game.state?.players?.find((p: any) => p.id === playerId);
        const currentLife = player?.life ?? 40;
        return currentLife > additionalCost.amount;
      }

      case 'discard': {
        const player = game.state?.players?.find((p: any) => p.id === playerId);
        const hand = player?.hand || [];
        const isSourceInHand = candidate.sourceZone === 'hand';
        const otherHandCount = isSourceInHand
          ? hand.filter((c: any) => String(c.id) !== String(candidate.card?.id)).length
          : hand.length;
        return otherHandCount >= additionalCost.amount;
      }

      case 'reveal': {
        const player = game.state?.players?.find((p: any) => p.id === playerId);
        const hand = player?.hand || [];
        const isSourceInHand = candidate.sourceZone === 'hand';
        const otherHand = isSourceInHand
          ? hand.filter((c: any) => String(c.id) !== String(candidate.card?.id))
          : hand;
        
        if (!additionalCost.filter) {
          return otherHand.length >= additionalCost.amount;
        }

        const filterStr = String(additionalCost.filter).toLowerCase();
        const validRevealCards = otherHand.filter((c: any) => {
          const typeLine = String(c?.type_line || '').toLowerCase();
          const name = String(c?.name || '').toLowerCase();
          return typeLine.includes(filterStr) || name.includes(filterStr);
        });

        return validRevealCards.length >= additionalCost.amount;
      }

      case 'sacrifice': {
        const battlefield = game.state?.battlefield || [];
        const filterStr = (additionalCost.filter || '').trim().toLowerCase();
        const validSacrificeTargets = battlefield.filter((p: any) => {
          if (String(p.controller || '') !== String(playerId)) return false;
          if (!filterStr) return true;
          const typeLine = String(p.card?.type_line || '').toLowerCase();
          const name = String(p.card?.name || '').toLowerCase();
          const parts = filterStr.split(/\s+or\s+/);
          return parts.some(part => typeLine.includes(part) || name.includes(part));
        });
        return validSacrificeTargets.length >= additionalCost.amount;
      }

      case 'remove_counters': {
        const availableCountersCount = buildCounterRemovalCostOptions(game.state, String(playerId), {
          amount: additionalCost.amount,
          filter: additionalCost.filter || 'creature',
          counterType: additionalCost.counterType,
          distributed: true,
        }).length;
        return availableCountersCount >= additionalCost.amount;
      }

      case 'collect_evidence': {
        const gy = game.state?.zones?.[playerId]?.graveyard || game.state?.players?.find((p: any) => p.id === playerId)?.graveyard || [];
        if (additionalCost.collectEvidenceIsOptional) {
          return true;
        }
        let totalCmc = 0;
        for (const card of gy) {
          if (typeof card.cmc === 'number') {
            totalCmc += card.cmc;
          } else {
            const cost = parseManaCost(card.mana_cost || '');
            const cmc = cost.generic + Object.values(cost.colors).reduce((sum: number, count: number) => sum + count, 0);
            totalCmc += cmc;
          }
        }
        return totalCmc >= (additionalCost.collectEvidenceValue || 0);
      }

      case 'blight': {
        const battlefield = game.state?.battlefield || [];
        const validBlightTargets = battlefield.filter((p: any) => 
          p && String(p.controller || '') === String(playerId) &&
          String(p.card?.type_line || '').toLowerCase().includes('creature')
        );
        return validBlightTargets.length >= (additionalCost.blightN || 0);
      }

      default:
        return true;
    }
  } catch (err) {
    debugWarn(1, '[AI] Error validating additional cost payability:', err);
    return true;
  }
}
