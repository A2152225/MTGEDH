/**
 * Origin parent: server/src/socket/ai.ts
 *
 * Cluster moved: calculateSpellPriority.
 *
 * Public entry symbols: calculateSpellPriority.
 */
import type { PlayerID } from "../../../../shared/src/types.js";
import { cardAnalyzer, SynergyArchetype } from "../../../../rules-engine/src/CardAnalyzer.js";
import { parseManaCost } from "../../state/modules/mana-check.js";
import { getAIHandlerDeps } from "../aiHandlerDeps.js";
import { calculateCardSynergyPressure, ensureAIDeckProfile } from "./aiDeckProfileHandlers.js";
import { cardGrantsNoMaximumHandSize } from "../../state/modules/handSizeUtils.js";

function getSpellCmc(cost: { generic: number; colors: Record<string, number> }): number {
  return getAIHandlerDeps().getSpellCmc(cost);
}

/**
 * Calculate priority for casting a spell (higher = cast first)
 * 
 * Priority system:
 * - Base: 50
 * - Mana rocks/dorks: +40 (early acceleration is crucial in Commander)
 * - Creatures: +30 (board presence)
 * - Artifacts/Enchantments: +20 (value permanents)
 * - Removal: +25 (interaction)
 * - Card draw: +20 (card advantage)
 * - Ramp spells: +15 (acceleration)
 * - CMC curve bonus: 0-10 (prefer cheaper spells)
 */
export function calculateSpellPriority(
  card: any,
  game: any,
  playerId: PlayerID,
  adjustedCost?: { generic: number; colors: Record<string, number> },
): number {
  let priority = 50; // Base priority
  const typeLine = (card?.type_line || '').toLowerCase();
  const oracleText = (card?.oracle_text || '').toLowerCase();
  const cardName = (card?.name || '').toLowerCase();
  const profile = ensureAIDeckProfile(game, playerId);
  const zones = game.state?.zones?.[playerId];
  const hand = Array.isArray(zones?.hand) ? zones.hand : [];
  const battlefield = (game.state?.battlefield || []).filter((perm: any) => perm?.controller === playerId);
  
  // Calculate CMC first - needed for early-game mana rock priority
  const parsedCost = adjustedCost || parseManaCost(card?.mana_cost || '');
  const cmc = getSpellCmc(parsedCost);
  
  // MANA ROCKS: Extremely high priority in early game
  // Cards that produce mana are crucial for acceleration
  // Detect mana ability patterns: "{T}: Add", "add one mana of any color", etc.
  const isManaRock = (
    typeLine.includes('artifact') &&
    (
      oracleText.includes('add {') || 
      oracleText.includes('add one mana') || 
      oracleText.includes('add mana') ||
      oracleText.includes('add x mana') ||
      // Known mana rocks by name
      cardName.includes('sol ring') ||
      cardName.includes('mana crypt') ||
      cardName.includes('mana vault') ||
      cardName.includes('arcane signet') ||
      cardName.includes('signet') ||
      cardName.includes('talisman') ||
      cardName.includes('mind stone') ||
      cardName.includes('fellwar stone') ||
      cardName.includes('thought vessel') ||
      cardName.includes('commander\'s sphere') ||
      cardName.includes('chromatic lantern') ||
      cardName.includes('gilded lotus') ||
      cardName.includes('thran dynamo') ||
      cardName.includes('worn powerstone') ||
      cardName.includes('hedron archive') ||
      cardName.includes('coalition relic') ||
      cardName.includes('darksteel ingot') ||
      cardName.includes('prismatic geoscope') ||
      cardName.includes('skyclave relic') ||
      cardName.includes('everflowing chalice') ||
      cardName.includes('astral cornucopia')
    )
  );
  
  // Domain mana rocks (Prismatic Geoscope) produce more mana the more basic land types you control
  const isDomainManaRock = oracleText.includes('domain') && isManaRock;
  
  if (isManaRock) {
    // Mana rocks get highest priority in early game
    // The cheaper they are, the more valuable
    priority += 40;
    // Extra priority for cheap mana rocks (0-2 CMC are best)
    if (cmc <= 2) {
      priority += 15; // Sol Ring, Arcane Signet, Signets, Talismans, etc.
    } else if (cmc <= 3) {
      priority += 10; // Chromatic Lantern, Coalition Relic, etc.
    } else if (cmc >= 5) {
      // High-CMC mana rocks like Prismatic Geoscope (5 CMC) are still valuable
      // but should be cast after cheaper rocks are out
      priority += 5;
    }
    
    // Domain-based mana rocks are very powerful in 5-color decks
    if (isDomainManaRock) {
      priority += 5;
    }
  }
  
  // MANA DORKS: Creatures that produce mana
  const isManaDork = (
    typeLine.includes('creature') &&
    (
      oracleText.includes('{t}: add') ||
      oracleText.includes('tap: add') ||
      // Known mana dorks by name
      cardName.includes('llanowar elves') ||
      cardName.includes('elvish mystic') ||
      cardName.includes('birds of paradise') ||
      cardName.includes('noble hierarch') ||
      cardName.includes('avacyn\'s pilgrim') ||
      cardName.includes('elves of deep shadow') ||
      cardName.includes('deathrite shaman') ||
      cardName.includes('bloom tender') ||
      cardName.includes('priest of titania') ||
      cardName.includes('elvish archdruid')
    )
  );
  
  if (isManaDork) {
    priority += 35; // High priority for mana acceleration
    if (cmc === 1) {
      priority += 15; // 1-CMC dorks are excellent
    }
  }
  
  // Creatures are good for board presence (non-dork creatures)
  if (typeLine.includes('creature') && !isManaDork) {
    priority += 30;
  }
  
  // Artifacts and enchantments that help are good (non-mana-rock artifacts)
  if ((typeLine.includes('artifact') || typeLine.includes('enchantment')) && !isManaRock) {
    priority += 20;
  }
  
  // Removal spells are valuable
  if (oracleText.includes('destroy') || oracleText.includes('exile')) {
    priority += 25;
  }
  
  // Card draw is valuable
  if (oracleText.includes('draw') && oracleText.includes('card')) {
    priority += 20;
  }

  // Thought Vessel / Spellbook: worth delaying other casts so the hand is not gutted later.
  if (cardGrantsNoMaximumHandSize(card)) {
    priority += 40;
    if (hand.length >= 7) {
      priority += 50;
    }
  }
  
  // Ramp spells are valuable early (land ramp)
  if (oracleText.includes('search your library') && oracleText.includes('land')) {
    priority += 15;
  }
  
  // Lower CMC spells get slight priority (play on curve)
  priority += Math.max(0, 10 - cmc);

  priority += calculateCardSynergyPressure(card, hand, battlefield, playerId, profile);

  if (profile?.primaryArchetypes.includes(SynergyArchetype.COMBO) && cardAnalyzer.analyzeCard(card).comboPotential >= 7) {
    priority += 10;
  }
  
  return priority;
}
