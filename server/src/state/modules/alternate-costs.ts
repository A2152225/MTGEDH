/**
 * alternate-costs.ts
 * 
 * Modular helper for checking alternate casting costs.
 * This module identifies if a spell has an alternate cost that can be paid
 * instead of its regular mana cost.
 * 
 * Examples:
 * - Force of Will: Exile a blue card + pay 1 life
 * - Fierce Guardianship: Free if you control a commander
 * - Deflecting Swat: Free if you control a commander
 * - Pact cycle: Free now, pay on next upkeep
 * - Convoke: Tap creatures to pay for spell
 * - Mutate: Cast for mutate cost targeting a non-Human creature
 * - Jodah/Fist of Suns: Pay {W}{U}{B}{R}{G} for any spell
 * - Omniscience: Cast from hand without paying mana cost
 * - Bringers: Self-WUBRG alternate cost
 */

import type { GameContext } from "../context";
import type { PlayerID } from "../../../../shared/src";
import { parseManaCost, normalizeParsedManaCost, canPayManaCostWithAvailableSources } from "./mana-check";
import { collectStaticEffectSources } from "./static-effect-sources";
import { spellHasConvokeForCast } from "./casting-modifiers.js";
import { permanentIsCommanderCard } from "./triggerPermanentUtils.js";
import { applyCostAdjustmentToParsedCost, buildCostAdjustmentPlan } from "./cost-adjustments.js";

function canPayAdjustedAlternateManaCost(
  ctx: GameContext,
  playerId: PlayerID,
  card: any,
  manaCost: string,
  excludedHandCardIds?: string[],
): boolean {
  const parsedCost = parseManaCost(manaCost);
  const adjustmentPlan = buildCostAdjustmentPlan(ctx.state, playerId, card);
  const adjustedCost = normalizeParsedManaCost(
    applyCostAdjustmentToParsedCost(parsedCost, adjustmentPlan),
  );
  const typeLine = String(card?.type_line || '').toLowerCase();

  return canPayManaCostWithAvailableSources(
    ctx.state,
    playerId,
    adjustedCost,
    Infinity,
    {
      ...(excludedHandCardIds?.length ? { excludedHandCardIds } : {}),
      restrictedSpendPurpose: {
        isCreature: typeLine.includes('creature'),
        isArtifact: typeLine.includes('artifact'),
        isInstantOrSorcery: typeLine.includes('instant') || typeLine.includes('sorcery'),
        isLegendary: typeLine.includes('legendary'),
        spellCard: card,
      },
    },
  );
}

/**
 * Alternate cost types
 */
export type AlternateCostType = 
  | 'force_of_will'
  | 'commander_free'
  | 'pact'
  | 'convoke'
  | 'delve'
  | 'improvise'
  | 'mutate'
  | 'evoke'
  | 'overload'
  | 'dash'
  | 'flashback'
  | 'surge'
  | 'spectacle'
  | 'kicker'
  | 'multikicker'
  | 'buyback'
  | 'madness'
  | 'emerge'
  | 'prowl'
  | 'ninjutsu'
  | 'wubrg_external'
  | 'omniscience'
  | 'wubrg_self'
  | 'alternate';

/**
 * Represents an available alternate cost option
 */
export interface AlternateCostOption {
  type: AlternateCostType;
  name: string;
  description: string;
  manaCost?: string;
  sourceName?: string;
  sourceId?: string;
  requiresTarget?: boolean;
  targetType?: 'non_human_creature' | 'creature' | 'player' | 'permanent';
  additionalEffects?: string[];
}

const COLOR_NAME_TO_SYMBOL: Record<string, string> = {
  w: 'W',
  white: 'W',
  u: 'U',
  blue: 'U',
  b: 'B',
  black: 'B',
  r: 'R',
  red: 'R',
  g: 'G',
  green: 'G',
};

/**
 * Normalize color tokens from Scryfall/MTGJSON (`U`, `blue`, `Blue`) to WUBRG symbols.
 */
export function normalizeCardColorSymbols(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const out = new Set<string>();
  for (const raw of values) {
    const key = String(raw || '').trim().toLowerCase();
    const symbol = COLOR_NAME_TO_SYMBOL[key] || (/^[wubrg]$/i.test(key) ? key.toUpperCase() : '');
    if (symbol) out.add(symbol);
  }
  return ['W', 'U', 'B', 'R', 'G'].filter((color) => out.has(color));
}

function deriveColorSymbolsFromManaCost(manaCost: unknown): string[] {
  const out = new Set<string>();
  const normalized = String(manaCost || '');
  for (const match of normalized.matchAll(/\{([^}]+)\}/g)) {
    for (const part of String(match[1] || '').split('/')) {
      const symbol = COLOR_NAME_TO_SYMBOL[part.trim().toLowerCase()];
      if (symbol) out.add(symbol);
    }
  }
  return ['W', 'U', 'B', 'R', 'G'].filter((color) => out.has(color));
}

/**
 * Card colors for pitch costs ("exile a blue card").
 * Prefer explicit `colors` (including empty = colorless). When missing, derive from
 * mana cost / color indicator — never color identity (Islands are not blue cards).
 */
export function getCardColorSymbolsForPitchCost(card: any): string[] {
  if (!card || typeof card !== 'object') return [];

  if (Array.isArray(card.colors)) {
    return normalizeCardColorSymbols(card.colors);
  }

  const oracleText = String(card.oracle_text || card.oracleText || '');
  if (/\bdevoid\b/i.test(oracleText)) {
    return [];
  }

  const indicator = card.color_indicator ?? card.colorIndicator;
  const fromIndicator = normalizeCardColorSymbols(indicator);
  if (fromIndicator.length > 0) return fromIndicator;

  const faces = Array.isArray(card.card_faces) ? card.card_faces : [];
  const frontFace = faces[0];
  if (frontFace && Array.isArray(frontFace.colors)) {
    return normalizeCardColorSymbols(frontFace.colors);
  }

  return deriveColorSymbolsFromManaCost(
    card.mana_cost ?? card.manaCost ?? frontFace?.mana_cost ?? frontFace?.manaCost,
  );
}

/** True when the card is blue for effects like Force of Will / Force of Negation. */
export function cardIsBlueForPitchCost(card: any): boolean {
  return getCardColorSymbolsForPitchCost(card).includes('U');
}

/**
 * Pattern matcher for Force of Will style alternate costs
 * - Force of Will: "You may pay 1 life and exile a blue card from your hand rather than pay this spell's mana cost"
 * - Force of Negation: "If it's not your turn, you may exile a blue card from your hand rather than pay this spell's mana cost."
 * 
 * Returns details about the alternate cost if available, or null if not.
 */
export function getForceOfWillAlternateCost(
  ctx: GameContext,
  playerId: PlayerID,
  card: any
): { available: boolean; requiresLifePayment: boolean; requiresNotYourTurn: boolean } | null {
  if (!card) return null;
  
  const { state } = ctx;
  const oracleText = (card.oracle_text || "").toLowerCase();
  const cardName = (card.name || "").toLowerCase();
  
  // Check for Force of Will pattern: exile blue card + pay 1 life
  const hasForceOfWillPattern = 
    oracleText.includes("exile") && 
    oracleText.includes("blue card") && 
    oracleText.includes("from your hand") &&
    oracleText.includes("pay") && 
    oracleText.includes("life");
  
  // Check for Force of Negation pattern: exile blue card, only on opponent's turn
  // Use more specific regex pattern to avoid false positives
  const hasForceOfNegationPattern = 
    oracleText.includes("exile") && 
    oracleText.includes("blue card") && 
    oracleText.includes("from your hand") &&
    /if it's not your turn/i.test(oracleText);
  
  // If neither pattern matches, return null
  if (!hasForceOfWillPattern && !hasForceOfNegationPattern && 
      !cardName.includes("force of will") && !cardName.includes("force of negation")) {
    return null;
  }
  
  const zones = state.zones?.[playerId];
  if (!zones || !Array.isArray(zones.hand)) return null;
  
  // Check if player has a blue card in hand (other than this card)
  const hasBlueCard = (zones.hand as any[]).some((c: any) =>
    c && c.id !== card.id && cardIsBlueForPitchCost(c)
  );
  
  if (!hasBlueCard) return null;
  
  // Check timing restriction for Force of Negation
  const requiresNotYourTurn = hasForceOfNegationPattern || cardName.includes("force of negation");
  if (requiresNotYourTurn) {
    const turnPlayerId = (state as any).turnPlayer;
    if (turnPlayerId === playerId) {
      // It's their turn - can't use alternate cost
      return { available: false, requiresLifePayment: false, requiresNotYourTurn: true };
    }
  }
  
  // Check life requirement for Force of Will (not Force of Negation)
  const requiresLifePayment = hasForceOfWillPattern || cardName.includes("force of will");
  if (requiresLifePayment) {
    const currentLife = state.life?.[playerId] ?? 40;
    if (currentLife < 1) {
      return { available: false, requiresLifePayment: true, requiresNotYourTurn: false };
    }
  }
  
  return { available: true, requiresLifePayment, requiresNotYourTurn };
}

/**
 * Pattern matcher for Force of Will style alternate costs
 * "You may pay 1 life and exile a blue card from your hand rather than pay this spell's mana cost"
 */
export function hasForceOfWillAlternateCost(
  ctx: GameContext,
  playerId: PlayerID,
  card: any
): boolean {
  const result = getForceOfWillAlternateCost(ctx, playerId, card);
  return result?.available ?? false;
}

/**
 * True when the player controls at least one commander permanent
 * (including legendary planeswalker commanders and stolen commanders).
 */
export function playerControlsACommander(
  ctx: GameContext,
  playerId: PlayerID,
): boolean {
  const battlefield = Array.isArray(ctx?.state?.battlefield) ? ctx.state.battlefield : [];
  return battlefield.some((p: any) =>
    p
    && String(p.controller || '') === String(playerId || '')
    && permanentIsCommanderCard(ctx, p)
  );
}

/**
 * Pattern matcher for commander-dependent free spells
 * "If you control a commander, you may cast this spell without paying its mana cost"
 */
export function hasCommanderFreeAlternateCost(
  ctx: GameContext,
  playerId: PlayerID,
  card: any
): boolean {
  if (!card) return false;
  
  const oracleText = (card.oracle_text || "").toLowerCase();
  
  // Check for commander-dependent free cast pattern in oracle text
  const hasCommanderFreePattern = 
    oracleText.includes("if you control") && 
    oracleText.includes("commander") && 
    oracleText.includes("without paying its mana cost");
  
  // Check if pattern matches
  if (!hasCommanderFreePattern) {
    return false;
  }
  
  return playerControlsACommander(ctx, playerId);
}

/**
 * Payment-modal extras when commander-free alternate cost is currently available.
 * Uses id `free` so it matches the client Free Cast path.
 */
export function buildCommanderFreeCastPaymentExtras(
  ctx: GameContext,
  playerId: PlayerID,
  card: any,
): {
  preferredAlternateCostId: 'free';
  extraAlternateCosts: Array<{ id: string; label: string; description: string; manaCost: string }>;
} | null {
  if (!hasCommanderFreeAlternateCost(ctx, playerId, card)) return null;
  return {
    preferredAlternateCostId: 'free',
    extraAlternateCosts: [{
      id: 'free',
      label: 'Free Cast',
      description: 'Cast for free (you control a commander)',
      manaCost: '{0}',
    }],
  };
}

/**
 * Pattern matcher for Pact cycle (free now, pay later)
 * "You may cast this spell without paying its mana cost. At the beginning of your next upkeep, pay..."
 */
export function hasPactAlternateCost(card: any): boolean {
  if (!card) return false;
  
  const oracleText = (card.oracle_text || "").toLowerCase();
  const cardName = (card.name || "").toLowerCase();
  
  // Pact cards can always be cast for free (pay on next upkeep)
  if (cardName.includes("pact") && oracleText.includes("without paying its mana cost")) {
    return true;
  }
  
  return false;
}

/**
 * Pattern matcher for Convoke
 * "Convoke (Your creatures can help cast this spell. Each creature you tap while casting 
 * this spell pays for {1} or one mana of that creature's color.)"
 * 
 * This now checks if convoke can ACTUALLY help pay for the spell, not just if creatures exist.
 * 
 * IMPORTANT: Cards that GRANT convoke to other spells (like Wand of the Worldsoul) should NOT
 * trigger convoke for themselves. We detect this by looking for patterns like:
 * - "the next spell you cast this turn has convoke"
 * - "spells you cast have convoke"
 * These cards don't have convoke themselves - they grant it to OTHER spells.
 */
export function hasConvokeAlternateCost(
  ctx: GameContext,
  playerId: PlayerID,
  card: any,
  excludedHandCardIds?: string[],
  castSourceZone?: string,
): boolean {
  if (!card) return false;
  
  const { state } = ctx;
  if (!spellHasConvokeForCast(state, playerId, card, castSourceZone)) {
    return false;
  }
  
  // Get all untapped creatures controlled by the player
  const battlefield = state.battlefield || [];
  const untappedCreatures = battlefield.filter((p: any) => 
    p && p.controller === playerId && 
    !p.tapped &&
    (p.card?.type_line || "").toLowerCase().includes("creature")
  );
  
  // If no untapped creatures, convoke can't help
  if (untappedCreatures.length === 0) {
    return false;
  }
  
  // Get the card's mana cost
  const manaCost = card.mana_cost || "";
  if (!manaCost) {
    // Free spells don't benefit from convoke
    return false;
  }
  
  const parsedCost = parseManaCost(manaCost);

  // Convoke can pay colored mana too, but for castability checks we conservatively
  // treat each untapped creature as reducing only the generic portion by {1}.
  // The exact source-aware mana solver then validates the remaining mana cost.
  const adjustedCost = {
    ...parsedCost,
    generic: Math.max(0, parsedCost.generic - untappedCreatures.length),
  };

  return canPayManaCostWithAvailableSources(
    state,
    playerId,
    adjustedCost,
    Infinity,
    excludedHandCardIds?.length ? { excludedHandCardIds } : undefined,
  );
}

/**
 * Pattern matcher for Delve
 * "Delve (Each card you exile from your graveyard while casting this spell pays for {1}.)"
 */
export function hasDelveAlternateCost(
  ctx: GameContext,
  playerId: PlayerID,
  card: any
): boolean {
  if (!card) return false;
  
  const { state } = ctx;
  const oracleText = (card.oracle_text || "").toLowerCase();
  
  // Check for delve keyword
  if (!oracleText.includes("delve")) {
    return false;
  }
  
  // Check if player has any cards in graveyard
  const zones = state.zones?.[playerId];
  if (!zones || !Array.isArray(zones.graveyard)) return false;
  
  return (zones.graveyard as any[]).length > 0;
}

/**
 * Pattern matcher for Improvise
 * "Improvise (Your artifacts can help cast this spell. Each artifact you tap while casting 
 * this spell pays for {1}.)"
 * 
 * This now checks if improvise can ACTUALLY help pay for the spell, not just if artifacts exist.
 */
export function hasImproviseAlternateCost(
  ctx: GameContext,
  playerId: PlayerID,
  card: any,
  excludedHandCardIds?: string[],
): boolean {
  if (!card) return false;
  
  const { state } = ctx;
  const oracleText = (card.oracle_text || "").toLowerCase();
  
  // Check for improvise keyword
  if (!oracleText.includes("improvise")) {
    return false;
  }
  
  // Get all untapped artifacts controlled by the player
  const battlefield = state.battlefield || [];
  const untappedArtifacts = battlefield.filter((p: any) => 
    p && p.controller === playerId && 
    !p.tapped &&
    (p.card?.type_line || "").toLowerCase().includes("artifact")
  );
  
  // If no untapped artifacts, improvise can't help
  if (untappedArtifacts.length === 0) {
    return false;
  }
  
  // Get the card's mana cost
  const manaCost = card.mana_cost || "";
  if (!manaCost) {
    // Free spells don't benefit from improvise
    return false;
  }
  
  const parsedCost = parseManaCost(manaCost);

  // Improvise only pays generic mana, so reduce only the generic component and let
  // the exact source-aware mana solver validate the remaining colored requirements.
  const adjustedCost = {
    ...parsedCost,
    generic: Math.max(0, parsedCost.generic - untappedArtifacts.length),
  };

  return canPayManaCostWithAvailableSources(
    state,
    playerId,
    adjustedCost,
    Infinity,
    excludedHandCardIds?.length ? { excludedHandCardIds } : undefined,
  );
}

/**
 * Pattern matcher for Mutate
 * "Mutate [cost]" - Cast for mutate cost targeting non-Human creature you own
 */
export function hasMutateAlternateCost(
  ctx: GameContext,
  playerId: PlayerID,
  card: any
): boolean {
  if (!card) return false;
  
  const { state } = ctx;
  const oracleText = (card.oracle_text || "").toLowerCase();
  
  // Check for mutate keyword
  if (!/\bmutate\b/.test(oracleText)) {
    return false;
  }
  
  // Check if player has a non-Human creature they own on the battlefield
  const battlefield = state.battlefield || [];
  const hasValidTarget = battlefield.some((p: any) => {
    if (!p || p.owner !== playerId) return false;
    const typeLine = (p.card?.type_line || "").toLowerCase();
    return typeLine.includes("creature") && !typeLine.includes("human");
  });
  
  return hasValidTarget;
}

/**
 * Parse mutate cost from oracle text
 */
export function parseMutateCost(oracleText: string): string | undefined {
  if (!oracleText) return undefined;
  const match = oracleText.match(/mutate\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  return match ? match[1].trim() : undefined;
}

export function parseWarpCost(oracleText: string): string | undefined {
  if (!oracleText) return undefined;
  const match = oracleText.match(/warp\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  return match ? match[1].replace(/\s+/g, '').trim() : undefined;
}

/** Parse mana cost for keyword alternate costs (dash, warp, blitz, etc.). */
export function parseKeywordAlternateManaCost(
  oracleText: string,
  keyword: string,
): string | undefined {
  const normalizedKeyword = String(keyword || '').trim().toLowerCase().replace(/_/g, '[-\\s]');
  if (!normalizedKeyword || !oracleText) return undefined;
  const match = oracleText.match(
    new RegExp(`\\b${normalizedKeyword}\\s*(\\{[^}]+\\}(?:\\s*\\{[^}]+\\})*)`, 'i'),
  );
  return match ? match[1].replace(/\s+/g, '').trim() : undefined;
}

export function buildWarpPaymentAlternateCost(
  adjustedWarpManaCost: string,
  oracleText?: string,
): { id: 'warp'; label: string; description: string; manaCost: string } | undefined {
  const warpCost = parseWarpCost(String(oracleText || ''));
  if (!warpCost || !adjustedWarpManaCost) return undefined;
  return {
    id: 'warp',
    label: 'Warp',
    description: 'Cast for warp cost; exile at the beginning of the next end step',
    manaCost: adjustedWarpManaCost,
  };
}

export function parseMadnessCost(oracleText: string): string | undefined {
  if (!oracleText) return undefined;
  const match = oracleText.match(/madness(?:\s*[—–-]\s*|\s+)(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  return match ? match[1].replace(/\s+/g, '').trim() : undefined;
}

/**
 * Check for self-WUBRG alternate cost (Bringers)
 * "You may pay {W}{U}{B}{R}{G} rather than pay this spell's mana cost."
 */
export function hasSelfWUBRGAlternateCost(card: any): boolean {
  if (!card) return false;
  
  const oracleText = (card.oracle_text || "").toLowerCase();
  return oracleText.includes("{w}{u}{b}{r}{g}") && 
         oracleText.includes("rather than pay") &&
         oracleText.includes("this spell");
}

/**
 * Check for external WUBRG sources (Jodah, Fist of Suns)
 * Returns the source permanent if found
 */
function grantsExternalWUBRGAlternateCost(text: string): boolean {
  const oracleText = String(text || '').toLowerCase();
  return oracleText.includes('{w}{u}{b}{r}{g}')
    && oracleText.includes('rather than pay')
    && !oracleText.includes('this spell');
}

export function getExternalWUBRGSource(
  ctx: GameContext,
  playerId: PlayerID
): { sourceId: string; sourceName: string } | null {
  const { state } = ctx;
  for (const source of collectStaticEffectSources(state)) {
    if (!source.affectsAllPlayers && source.controller !== String(playerId || '')) continue;
    if (!grantsExternalWUBRGAlternateCost(source.oracleText)) continue;

    return {
      sourceId: source.sourceId,
      sourceName: source.sourceName,
    };
  }
  
  return null;
}

/**
 * Check for Omniscience effect
 * "You may cast spells from your hand without paying their mana costs."
 */
export function getOmniscienceSource(
  ctx: GameContext,
  playerId: PlayerID
): { sourceId: string; sourceName: string } | null {
  const { state } = ctx;

  const grantsFreeHandCasts = (text: string): boolean => {
    const oracleText = String(text || '').toLowerCase();
    if (!oracleText.includes('without paying')) return false;
    if (!oracleText.includes('from your hand')) return false;
    if (!oracleText.includes('you may cast')) return false;
    return oracleText.includes('cast spells from your hand')
      || oracleText.includes('cast nonland cards from your hand')
      || oracleText.includes('cast cards from your hand');
  };

  for (const source of collectStaticEffectSources(state)) {
    if (!source.affectsAllPlayers && source.controller !== String(playerId || '')) continue;

    const cardName = source.sourceName.toLowerCase();
    const oracleText = source.oracleText.toLowerCase();

    if (cardName.includes("omniscience") || grantsFreeHandCasts(oracleText)) {
      return {
        sourceId: source.sourceId,
        sourceName: source.sourceName || "Omniscience",
      };
    }
  }
  
  return null;
}

/**
 * Check for Devastating Mastery style alternate cost
 * "You may pay {2}{W}{W} rather than pay this spell's mana cost.
 * If the {2}{W}{W} cost was paid, [conditional effect]"
 */
export function hasConditionalAlternateCost(card: any): {
  hasCost: boolean;
  manaCost?: string;
  conditionalEffect?: string;
} {
  if (!card) return { hasCost: false };
  
  const oracleText = card.oracle_text || "";
  
  // Pattern: "You may pay X rather than pay this spell's mana cost. If the X cost was paid, [effect]"
  const match = oracleText.match(
    /you may pay (\{[^}]+\}(?:\s*\{[^}]+\})*) rather than pay this spell's mana cost\.?\s*if.*?was paid,\s*([^.]+)/i
  );
  
  if (match) {
    return {
      hasCost: true,
      manaCost: match[1],
      conditionalEffect: match[2].trim(),
    };
  }
  
  return { hasCost: false };
}

/**
 * Main function: Check if a spell has any payable alternate cost
 * 
 * @param ctx Game context
 * @param playerId Player attempting to cast
 * @param card Card to check
 * @returns true if an alternate cost can be paid
 */
export function hasPayableAlternateCost(
  ctx: GameContext,
  playerId: PlayerID,
  card: any,
  excludedHandCardIds?: string[],
  castSourceZone?: string,
): boolean {
  if (!card) return false;
  
  // Check each alternate cost type
  if (hasForceOfWillAlternateCost(ctx, playerId, card)) return true;
  if (hasCommanderFreeAlternateCost(ctx, playerId, card)) return true;
  if (hasPactAlternateCost(card)) return true;
  if (hasConvokeAlternateCost(ctx, playerId, card, excludedHandCardIds, castSourceZone)) return true;
  if (hasDelveAlternateCost(ctx, playerId, card)) return true;
  if (hasImproviseAlternateCost(ctx, playerId, card, excludedHandCardIds)) return true;

  if (hasMutateAlternateCost(ctx, playerId, card)) {
    const costStr = parseMutateCost(card.oracle_text || "");
    if (costStr && canPayAdjustedAlternateManaCost(ctx, playerId, card, costStr, excludedHandCardIds)) {
      return true;
    }
  }

  if (hasSelfWUBRGAlternateCost(card)) {
    if (canPayAdjustedAlternateManaCost(ctx, playerId, card, '{W}{U}{B}{R}{G}', excludedHandCardIds)) {
      return true;
    }
  }

  if (getExternalWUBRGSource(ctx, playerId)) {
    if (canPayAdjustedAlternateManaCost(ctx, playerId, card, '{W}{U}{B}{R}{G}', excludedHandCardIds)) {
      return true;
    }
  }

  const conditionalAlternateCost = hasConditionalAlternateCost(card);
  if (
    conditionalAlternateCost.hasCost
    && conditionalAlternateCost.manaCost
    && canPayAdjustedAlternateManaCost(
      ctx,
      playerId,
      card,
      conditionalAlternateCost.manaCost,
      excludedHandCardIds,
    )
  ) {
    return true;
  }

  if (getOmniscienceSource(ctx, playerId)) return true;
  
  return false;
}

/**
 * Get all available alternate cost options for a card
 * Returns structured options for UI display
 */
export function getAllAlternateCostOptions(
  ctx: GameContext,
  playerId: PlayerID,
  card: any,
  castFromZone: string = 'hand'
): AlternateCostOption[] {
  const options: AlternateCostOption[] = [];
  
  if (!card) return options;
  
  const oracleText = (card.oracle_text || "").toLowerCase();
  
  // Force of Will style
  if (hasForceOfWillAlternateCost(ctx, playerId, card)) {
    options.push({
      type: 'force_of_will',
      name: 'Pitch Cost',
      description: 'Exile a blue card from your hand and pay 1 life',
      additionalEffects: ['Pay 1 life', 'Exile a blue card from hand'],
    });
  }
  
  // Commander free cast
  if (hasCommanderFreeAlternateCost(ctx, playerId, card)) {
    options.push({
      type: 'commander_free',
      name: 'Commander Free Cast',
      description: 'Cast for free (you control a commander)',
      manaCost: undefined,
    });
  }
  
  // Pact
  if (hasPactAlternateCost(card)) {
    options.push({
      type: 'pact',
      name: 'Pact',
      description: 'Cast for free now, pay on your next upkeep',
      manaCost: undefined,
      additionalEffects: ['Must pay cost at next upkeep or lose the game'],
    });
  }
  
  // Mutate
  if (hasMutateAlternateCost(ctx, playerId, card)) {
    const mutateCost = parseMutateCost(card.oracle_text || "");
    options.push({
      type: 'mutate',
      name: 'Mutate',
      description: 'Merge with a non-Human creature you own',
      manaCost: mutateCost,
      requiresTarget: true,
      targetType: 'non_human_creature',
      additionalEffects: [
        'Choose to put on top or bottom of target creature',
        'Combined creature has all abilities',
        'Top card determines name, power/toughness',
      ],
    });
  }
  
  // Self WUBRG (Bringers)
  if (hasSelfWUBRGAlternateCost(card)) {
    options.push({
      type: 'wubrg_self',
      name: 'WUBRG Cost',
      description: 'Pay {W}{U}{B}{R}{G} instead of mana cost',
      manaCost: '{W}{U}{B}{R}{G}',
    });
  }
  
  // Conditional alternate cost (Devastating Mastery style)
  const conditionalAlt = hasConditionalAlternateCost(card);
  if (conditionalAlt.hasCost) {
    options.push({
      type: 'alternate',
      name: 'Conditional Alternate Cost',
      description: `Pay ${conditionalAlt.manaCost} for different effect`,
      manaCost: conditionalAlt.manaCost,
      additionalEffects: conditionalAlt.conditionalEffect ? [conditionalAlt.conditionalEffect] : undefined,
    });
  }
  
  // External WUBRG (Jodah, Fist of Suns)
  const wubrgSource = getExternalWUBRGSource(ctx, playerId);
  if (wubrgSource) {
    options.push({
      type: 'wubrg_external',
      name: 'WUBRG Alternative',
      description: `Pay {W}{U}{B}{R}{G} via ${wubrgSource.sourceName}`,
      manaCost: '{W}{U}{B}{R}{G}',
      sourceName: wubrgSource.sourceName,
      sourceId: wubrgSource.sourceId,
    });
  }
  
  // Omniscience (only from hand)
  if (castFromZone === 'hand') {
    const omniscienceSource = getOmniscienceSource(ctx, playerId);
    if (omniscienceSource) {
      options.push({
        type: 'omniscience',
        name: 'Free Cast',
        description: `Cast without paying mana cost via ${omniscienceSource.sourceName}`,
        manaCost: undefined,
        sourceName: omniscienceSource.sourceName,
        sourceId: omniscienceSource.sourceId,
      });
    }
  }
  
  // Convoke
  if (hasConvokeAlternateCost(ctx, playerId, card, undefined, castFromZone)) {
    options.push({
      type: 'convoke',
      name: 'Convoke',
      description: 'Tap creatures to help pay for this spell',
      additionalEffects: ['Each creature tapped pays {1} or one mana of its color'],
    });
  }
  
  // Delve
  if (hasDelveAlternateCost(ctx, playerId, card)) {
    options.push({
      type: 'delve',
      name: 'Delve',
      description: 'Exile cards from graveyard to reduce cost',
      additionalEffects: ['Each card exiled pays {1}'],
    });
  }
  
  // Improvise
  if (hasImproviseAlternateCost(ctx, playerId, card)) {
    options.push({
      type: 'improvise',
      name: 'Improvise',
      description: 'Tap artifacts to help pay for this spell',
      additionalEffects: ['Each artifact tapped pays {1}'],
    });
  }
  
  return options;
}

/**
 * Get a description of available alternate costs for a card
 * Useful for UI display and logging
 */
export function getAlternateCostDescription(
  ctx: GameContext,
  playerId: PlayerID,
  card: any
): string[] {
  const descriptions: string[] = [];
  
  if (!card) return descriptions;
  
  if (hasForceOfWillAlternateCost(ctx, playerId, card)) {
    descriptions.push("Exile a blue card and pay 1 life");
  }
  
  if (hasCommanderFreeAlternateCost(ctx, playerId, card)) {
    descriptions.push("Cast for free (control a commander)");
  }
  
  if (hasPactAlternateCost(card)) {
    descriptions.push("Cast for free (pay on next upkeep)");
  }
  
  if (hasConvokeAlternateCost(ctx, playerId, card)) {
    descriptions.push("Convoke (tap creatures to help pay)");
  }
  
  if (hasDelveAlternateCost(ctx, playerId, card)) {
    descriptions.push("Delve (exile cards from graveyard to help pay)");
  }
  
  if (hasImproviseAlternateCost(ctx, playerId, card)) {
    descriptions.push("Improvise (tap artifacts to help pay)");
  }
  
  if (hasMutateAlternateCost(ctx, playerId, card)) {
    const mutateCost = parseMutateCost(card.oracle_text || "");
    descriptions.push(`Mutate ${mutateCost || ''} (merge with a creature)`);
  }
  
  if (hasSelfWUBRGAlternateCost(card)) {
    descriptions.push("Pay {W}{U}{B}{R}{G} instead of mana cost");
  }
  
  const wubrgSource = getExternalWUBRGSource(ctx, playerId);
  if (wubrgSource) {
    descriptions.push(`Pay {W}{U}{B}{R}{G} via ${wubrgSource.sourceName}`);
  }
  
  const omniscienceSource = getOmniscienceSource(ctx, playerId);
  if (omniscienceSource) {
    descriptions.push(`Cast free via ${omniscienceSource.sourceName}`);
  }
  
  return descriptions;
}

/**
 * Get valid mutate targets for a player
 */
export function getValidMutateTargets(
  ctx: GameContext,
  playerId: PlayerID
): Array<{
  permanentId: string;
  cardName: string;
  controller: string;
  owner: string;
  typeLine: string;
  power?: string;
  toughness?: string;
  imageUrl?: string;
}> {
  const { state } = ctx;
  const battlefield = state.battlefield || [];
  const targets: Array<{
    permanentId: string;
    cardName: string;
    controller: string;
    owner: string;
    typeLine: string;
    power?: string;
    toughness?: string;
    imageUrl?: string;
  }> = [];
  
  for (const perm of battlefield) {
    if (!perm || !perm.card) continue;
    if (perm.owner !== playerId) continue;
    
    const typeLine = (perm.card.type_line || "").toLowerCase();
    if (!typeLine.includes("creature")) continue;
    if (typeLine.includes("human")) continue;
    
    targets.push({
      permanentId: perm.id,
      cardName: perm.card.name || "Unknown",
      controller: perm.controller,
      owner: perm.owner,
      typeLine: perm.card.type_line || "",
      power: perm.card.power != null ? String(perm.card.power) : undefined,
      toughness: perm.card.toughness != null ? String(perm.card.toughness) : undefined,
      imageUrl: perm.card.image_uris?.small || perm.card.image_uris?.normal,
    });
  }
  
  return targets;
}
