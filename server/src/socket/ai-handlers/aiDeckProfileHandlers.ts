/**
 * Origin parent: server/src/socket/ai.ts
 *
 * Cluster moved: archetype weight tables, ensureAIDeckProfile, visible-deck
 * card reads, theme/synergy scoring, and hand-plan summary used by mulligan
 * and acquisition choices.
 *
 * Public entry symbols: ensureAIDeckProfile, getAIHand, getAIBattlefield,
 * getAIPlayerLife, calculateCardThemeAlignment, calculateCardSynergyPressure,
 * summarizeAIHandPlan, scoreCardForAIAcquisition,
 * permanentHasLeaveBattlefieldExileReplacement,
 * scoreHostileGraveyardCardDisruption, rehydrateCardsById.
 */
import {
  cardAnalyzer,
  CardCategory,
  SynergyArchetype,
  type DeckArchetypeProfile,
} from "../../../../rules-engine/src/CardAnalyzer.js";
import type { PlayerID } from "../../../../shared/src/types.js";
import { MAX_LIBRARY_SEARCH_LIMIT } from "./aiConstants.js";

const ARCHETYPE_CATEGORY_WEIGHTS: Record<string, Partial<Record<CardCategory, number>>> = {
  [SynergyArchetype.ARISTOCRATS]: {
    [CardCategory.SACRIFICE_OUTLET]: 10,
    [CardCategory.ARISTOCRAT]: 10,
    [CardCategory.DEATH_TRIGGER]: 8,
    [CardCategory.TOKEN_GENERATOR]: 6,
  },
  [SynergyArchetype.TOKENS]: {
    [CardCategory.TOKEN_GENERATOR]: 10,
    [CardCategory.ARISTOCRAT]: 6,
    [CardCategory.SACRIFICE_OUTLET]: 5,
  },
  [SynergyArchetype.GRAVEYARD]: {
    [CardCategory.REANIMATOR]: 10,
    [CardCategory.DEATH_TRIGGER]: 5,
  },
  [SynergyArchetype.LANDFALL]: {
    [CardCategory.LANDFALL]: 12,
    [CardCategory.RAMP]: 7,
    [CardCategory.LAND]: 3,
  },
  [SynergyArchetype.SPELLSLINGER]: {
    [CardCategory.DRAW]: 5,
    [CardCategory.REMOVAL]: 5,
    [CardCategory.COUNTERSPELL]: 6,
  },
  [SynergyArchetype.ARTIFACTS]: {
    [CardCategory.RAMP]: 5,
  },
  [SynergyArchetype.ENCHANTMENTS]: {
    [CardCategory.DRAW]: 4,
    [CardCategory.PROTECTION]: 4,
  },
  [SynergyArchetype.VOLTRON]: {
    [CardCategory.PROTECTION]: 6,
    [CardCategory.CREATURE]: 4,
    [CardCategory.COMMANDER]: 6,
  },
  [SynergyArchetype.COMBO]: {
    [CardCategory.TUTOR]: 8,
    [CardCategory.DRAW]: 5,
  },
  [SynergyArchetype.STAX]: {
    [CardCategory.REMOVAL]: 4,
    [CardCategory.COUNTERSPELL]: 6,
  },
};

const ARCHETYPE_TAG_WEIGHTS: Record<string, Record<string, number>> = {
  [SynergyArchetype.ARISTOCRATS]: { aristocrats: 8, tokens: 3, graveyard: 2 },
  [SynergyArchetype.TOKENS]: { tokens: 8, aristocrats: 3 },
  [SynergyArchetype.GRAVEYARD]: { graveyard: 8, aristocrats: 2 },
  [SynergyArchetype.LANDFALL]: { landfall: 10 },
  [SynergyArchetype.SPELLSLINGER]: { spellslinger: 8 },
  [SynergyArchetype.COUNTERS]: { counters: 8 },
  [SynergyArchetype.ARTIFACTS]: { artifacts: 8 },
  [SynergyArchetype.ENCHANTMENTS]: { enchantments: 8 },
  [SynergyArchetype.VOLTRON]: { voltron: 8 },
  [SynergyArchetype.STAX]: { stax: 8 },
  [SynergyArchetype.GROUP_HUG]: { draw: 4, utility: 3 },
  [SynergyArchetype.POLITICS]: { protection: 6, removal: 4, draw: 3 },
  [SynergyArchetype.TRIBAL]: { tribal: 8, tokens: 4 },
};

function getVisibleDeckCardsForAI(game: any, playerId: PlayerID): any[] {
  const zones = game?.state?.zones?.[playerId] || {};
  const commandZoneState = game?.state?.commandZone?.[playerId] || null;
  const commandZoneCards = Array.isArray(commandZoneState)
    ? commandZoneState
    : Array.isArray(commandZoneState?.commanderCards)
      ? commandZoneState.commanderCards
      : [];
  const fullLibrary = typeof game?.searchLibrary === 'function'
    ? game.searchLibrary(playerId, '', MAX_LIBRARY_SEARCH_LIMIT) || []
    : Array.isArray(game?.libraries?.get?.(playerId))
      ? game.libraries.get(playerId)
      : zones.library;
  const controlledBattlefield = Array.isArray(game?.state?.battlefield)
    ? game.state.battlefield
        .filter((perm: any) => perm && perm.controller === playerId)
        .map((perm: any) => perm.card || perm)
    : [];
  const buckets = [fullLibrary, zones.hand, zones.graveyard, zones.exile, commandZoneCards, controlledBattlefield];
  const seen = new Set<string>();
  const cards: any[] = [];

  for (const bucket of buckets) {
    if (!Array.isArray(bucket)) continue;
    for (const card of bucket) {
      if (!card || typeof card !== 'object') continue;
      const cardId = String(card.id || '');
      if (!cardId || seen.has(cardId)) continue;
      seen.add(cardId);
      cards.push(card);
    }
  }

  return cards;
}

export function ensureAIDeckProfile(game: any, playerId: PlayerID): DeckArchetypeProfile | null {
  const stateAny = game?.state as any;
  if (!stateAny) return null;

  stateAny.aiDeckProfiles = stateAny.aiDeckProfiles || {};
  const cached = stateAny.aiDeckProfiles[playerId];
  if (cached && typeof cached === 'object' && Number(cached.totalCards || 0) > 0) {
    return cached as DeckArchetypeProfile;
  }

  const visibleCards = getVisibleDeckCardsForAI(game, playerId);
  if (visibleCards.length === 0) {
    return null;
  }

  const profile = cardAnalyzer.analyzeDeck(visibleCards);
  stateAny.aiDeckProfiles[playerId] = profile;
  return profile;
}

export function calculateCardThemeAlignment(card: any, profile: DeckArchetypeProfile | null): number {
  if (!profile) return 0;

  const analysis = cardAnalyzer.analyzeCard(card);
  const typeLine = String(card?.type_line || '').toLowerCase();
  const oracleText = String(card?.oracle_text || '').toLowerCase();
  let score = 0;

  for (const archetype of profile.primaryArchetypes) {
    const categoryWeights = ARCHETYPE_CATEGORY_WEIGHTS[archetype] || {};
    for (const category of analysis.categories) {
      score += categoryWeights[category] || 0;
    }

    const tagWeights = ARCHETYPE_TAG_WEIGHTS[archetype] || {};
    for (const tag of analysis.synergyTags) {
      score += tagWeights[tag] || 0;
    }

    if (archetype === SynergyArchetype.COMBO && analysis.comboPotential >= 7) {
      score += 16;
    }
    if (archetype === SynergyArchetype.SPELLSLINGER && (typeLine.includes('instant') || typeLine.includes('sorcery'))) {
      score += 8;
    }
    if (archetype === SynergyArchetype.ARTIFACTS && typeLine.includes('artifact')) {
      score += 8;
    }
    if (archetype === SynergyArchetype.ENCHANTMENTS && typeLine.includes('enchantment')) {
      score += 8;
    }
    if (archetype === SynergyArchetype.VOLTRON && (typeLine.includes('equipment') || typeLine.includes('aura'))) {
      score += 8;
    }
    if (archetype === SynergyArchetype.GROUP_HUG && /each player (?:draws|may|gains)/i.test(oracleText)) {
      score += 8;
    }
    if (archetype === SynergyArchetype.POLITICS) {
      if (/\bgoad\b|impetus|gain control of all creatures|exchange life totals/i.test(oracleText)) {
        score += 8;
      }
      if (analysis.categories.includes(CardCategory.PROTECTION)) score += 4;
    }
  }

  if (profile.keyCards.includes(String(card?.name || ''))) {
    score += 4;
  }

  return score;
}

export function calculateCardSynergyPressure(
  card: any,
  otherCards: readonly any[],
  battlefield: readonly any[],
  playerId: PlayerID,
  profile: DeckArchetypeProfile | null
): number {
  let score = calculateCardThemeAlignment(card, profile);

  const battlefieldSynergy = cardAnalyzer.findSynergyCards([card], battlefield as any, playerId);
  if (battlefieldSynergy.length > 0) {
    score += Math.min(18, battlefieldSynergy[0].synergyScore * 2);
  }

  let bestHandSynergy = 0;
  let handSynergyTotal = 0;
  for (const otherCard of otherCards) {
    if (!otherCard || otherCard.id === card.id) continue;
    const synergy = cardAnalyzer.checkSynergy(card, otherCard);
    if (!synergy.hasSynergy) continue;
    bestHandSynergy = Math.max(bestHandSynergy, synergy.strength);
    handSynergyTotal += synergy.strength;
  }

  score += Math.min(12, handSynergyTotal);
  if (bestHandSynergy >= 8) {
    score += 6;
  }

  return score;
}

export function summarizeAIHandPlan(hand: readonly any[], profile: DeckArchetypeProfile | null): {
  themedCards: number;
  synergyPairs: number;
  strongestPair: number;
  comboPieces: number;
} {
  let themedCards = 0;
  let synergyPairs = 0;
  let strongestPair = 0;
  let comboPieces = 0;

  for (const card of hand) {
    if (calculateCardThemeAlignment(card, profile) >= 8) {
      themedCards += 1;
    }
    if (cardAnalyzer.analyzeCard(card).comboPotential >= 7) {
      comboPieces += 1;
    }
  }

  for (let index = 0; index < hand.length; index += 1) {
    for (let inner = index + 1; inner < hand.length; inner += 1) {
      const synergy = cardAnalyzer.checkSynergy(hand[index], hand[inner]);
      if (!synergy.hasSynergy) continue;
      synergyPairs += 1;
      strongestPair = Math.max(strongestPair, synergy.strength);
    }
  }

  return { themedCards, synergyPairs, strongestPair, comboPieces };
}

export function getAIHand(game: any, playerId: PlayerID): any[] {
  const zones = game?.state?.zones?.[playerId];
  return Array.isArray(zones?.hand) ? zones.hand : [];
}

export function getAIBattlefield(game: any, playerId: PlayerID): any[] {
  return (game?.state?.battlefield || []).filter((perm: any) => perm?.controller === playerId);
}

export function getAIPlayerLife(game: any, playerId: PlayerID): number {
  const stateLife = Number(game?.state?.life?.[playerId]);
  if (Number.isFinite(stateLife)) return stateLife;
  const player = (game?.state?.players || []).find((entry: any) => entry?.id === playerId);
  const playerLife = Number(player?.life);
  if (Number.isFinite(playerLife)) return playerLife;
  return Number(game?.state?.startingLife || 40) || 40;
}

export function permanentHasLeaveBattlefieldExileReplacement(permanent: any): boolean {
  return String(
    (permanent as any)?.leaveBattlefieldReplacementDestination ||
    (permanent as any)?.card?.leaveBattlefieldReplacementDestination ||
    ''
  ) === 'exile';
}

export function scoreCardForAIAcquisition(
  game: any,
  playerId: PlayerID,
  card: any,
  destination: string,
  profile: DeckArchetypeProfile | null
): number {
  let score = 50;
  const cmc = Number(card?.cmc || 0) || 0;
  const typeLine = String(card?.type_line || '').toLowerCase();
  const oracleText = String(card?.oracle_text || '').toLowerCase();
  const analysis = cardAnalyzer.analyzeCard(card);
  const hand = getAIHand(game, playerId);
  const battlefield = getAIBattlefield(game, playerId);

  if (destination === 'hand' || destination === 'battlefield') {
    score += Math.max(0, 10 - cmc);
  }

  if (destination === 'battlefield') {
    if (typeLine.includes('creature')) score += 10;
    if (analysis.details.hasETBTrigger) score += 12;
    if (analysis.details.producesMana) score += 6;
  }

  if (oracleText.includes('draw') || oracleText.includes('destroy') || oracleText.includes('search your library')) {
    score += 5;
  }

  score += calculateCardSynergyPressure(card, hand, battlefield, playerId, profile);

  if (profile?.primaryArchetypes.includes(SynergyArchetype.COMBO) && analysis.comboPotential >= 7) {
    score += 16;
  }

  return score;
}

export function scoreHostileGraveyardCardDisruption(card: any): number {
  const analysis = cardAnalyzer.analyzeCard(card);
  const manaValue = Number(card?.cmc || 0) || 0;
  let score = analysis.comboPotential * 8 + manaValue * 2;

  if (analysis.categories.includes(CardCategory.TUTOR)) score += 12;
  if (analysis.categories.includes(CardCategory.REMOVAL)) score += 8;
  if (analysis.categories.includes(CardCategory.DRAW)) score += 6;
  if (analysis.categories.includes(CardCategory.FINISHER)) score += 8;

  return score;
}

export function rehydrateCardsById(sourceCards: readonly any[], ids: readonly string[]): any[] {
  const byId = new Map(sourceCards.map((card: any) => [String(card?.id || ''), card]));
  return ids
    .map((id) => byId.get(String(id || '')) || { id })
    .filter(Boolean);
}
