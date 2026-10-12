// server/src/socket/ai-handlers/aiMillTargetChoice.ts
// AI player-target choice for "target player mills N" style effects (Drowner of Secrets,
// Thought Scour, Ruin Crab, "puts the top N cards of their library into their graveyard").
// Default: mill an opponent (most threatening / closest to decking). Mill itself only with
// real graveyard synergy and a library that can afford it.
// Public entry symbols: isTargetPlayerMillText, aiHasGraveyardSynergy, scoreAIMillTargetPlayer,
// AI_SELF_MILL_MIN_LIBRARY.

import type { PlayerID } from "../../../../shared/src/types.js";

/** Never self-mill at or below this many cards in library. */
export const AI_SELF_MILL_MIN_LIBRARY = 10;

const MILL_TARGET_PLAYER_RE =
  /\btarget (?:player|opponent) (?:mills\b|puts the top (?:\w+ )?cards? of (?:their|his or her) library into (?:their|his or her) graveyard)/i;

export function isTargetPlayerMillText(text: unknown): boolean {
  return MILL_TARGET_PLAYER_RE.test(String(text || ''));
}

// Self-graveyard payoffs. Deliberately excludes plain "mill" (mill-the-opponent decks are not
// graveyard decks) and "exile ... graveyard" hate.
const GRAVEYARD_SYNERGY_RES: readonly RegExp[] = [
  /\b(?:flashback|unearth|escape|delve|dredge|embalm|eternalize|disturb|threshold|delirium|retrace|jump-start|aftermath|scavenge|encore|undergrowth|descend)\b/i,
  /\breturn (?:target |up to \w+ target |a |an )?(?:[\w-]+ )*(?:creature|permanent|artifact|enchantment|land|card)s? cards? from (?:your|a) graveyard to the battlefield\b/i,
  /\bput (?:target |a )?(?:[\w-]+ )*cards? from (?:your|a) graveyard onto the battlefield\b/i,
  /\bfor each (?:\w+ )*cards? in your graveyard\b/i,
  /\bcards? (?:are|is) put into your graveyard from your library\b/i,
  /\bcast (?:[\w-]+ )*(?:spells?|cards?) from your graveyard\b/i,
  /\bplay (?:[\w-]+ )*(?:lands?|cards?) from your graveyard\b/i,
  /\b(?:seven|\d+) or more cards in your graveyard\b/i,
];

function cardOracle(entry: any): string {
  const card = entry?.card || entry;
  return String(card?.oracle_text || card?.oracleText || '');
}

function listCards(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    for (const key of ['cards', 'commanderCards', 'commanders']) {
      if (Array.isArray(value[key])) return value[key];
    }
  }
  return [];
}

/** Cheap scan of the AI's battlefield, command zone and hand for self-graveyard payoffs. */
export function aiHasGraveyardSynergy(game: any, playerId: PlayerID): boolean {
  const state = game?.state || {};
  const pid = String(playerId);
  const sources: any[] = [
    ...(Array.isArray(state.battlefield) ? state.battlefield : [])
      .filter((perm: any) => String(perm?.controller || '') === pid),
    ...listCards(state.commandZone?.[pid]),
    ...listCards(state.zones?.[pid]?.hand),
  ];
  return sources.some((entry) => {
    const text = cardOracle(entry);
    return Boolean(text) && GRAVEYARD_SYNERGY_RES.some((re) => re.test(text));
  });
}

export function aiLibrarySize(game: any, playerId: PlayerID): number {
  const pid = String(playerId);
  const libraries = game?.libraries;
  if (libraries && typeof libraries.get === 'function') {
    const lib = libraries.get(pid);
    if (Array.isArray(lib)) return lib.length;
  }
  const zone = game?.state?.zones?.[pid];
  if (typeof zone?.libraryCount === 'number') return zone.libraryCount;
  if (Array.isArray(zone?.library)) return zone.library.length;
  return 60;
}

export interface MillThreatContext {
  highestThreatPlayer?: string | null;
  comboPlayers?: readonly string[];
}

/**
 * Score one player as the target of a mill effect for the AI. Higher is better; a large
 * negative value means "never".
 */
export function scoreAIMillTargetPlayer(
  game: any,
  playerId: PlayerID,
  targetPlayerId: string,
  threat: MillThreatContext = {},
): number {
  const isSelf = String(targetPlayerId) === String(playerId);
  const library = aiLibrarySize(game, targetPlayerId as PlayerID);
  if (isSelf) {
    if (library <= AI_SELF_MILL_MIN_LIBRARY) return -10000;
    // Fuel for flashback/reanimation/delve: beats a typical opponent but not one about to deck.
    return aiHasGraveyardSynergy(game, playerId) ? 160 : -200;
  }

  let score = 100;
  if (threat.highestThreatPlayer && String(threat.highestThreatPlayer) === String(targetPlayerId)) score += 25;
  if ((threat.comboPlayers || []).some((id) => String(id) === String(targetPlayerId))) score += 20;
  // Closer to decking is better: up to +60 as the library shrinks below 60 cards.
  score += Math.max(0, 60 - Math.min(60, library));
  if (library <= 5) score += 80;
  // Don't feed an opponent's graveyard deck when another opponent is available (cheap scan).
  if (aiHasGraveyardSynergy(game, targetPlayerId as PlayerID)) score -= 30;
  return score;
}
