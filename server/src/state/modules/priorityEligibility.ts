// server/src/state/modules/priorityEligibility.ts
// Origin parent: server/src/state/modules/priority.ts
// Cluster moved: who may receive priority (skip lost / eliminated / conceded /
//   spectators / inactive / post-pregame deckless seats) plus reassignment when
//   the current holder is out.
// Public entry symbols: playerHasSeatedDeck, playerCannotReceivePriority,
//   getActivePriorityPlayers, playerIdCanReceivePriority, listLivingGamePlayers,
//   nextEligiblePriorityHolder, reassignPriorityIfHolderCannotReceive,
//   markPlayerOutOfPriority.
// Leaf must not import priority.ts or turn.ts.

import { debug } from "../../utils/debug.js";

export type PriorityEligibilityContext = {
  state?: any;
  inactive?: Set<string>;
  libraries?: Map<string, any[]> | Record<string, any[]>;
  commandZone?: Record<string, any>;
};

function isPreGamePhase(ctx?: PriorityEligibilityContext): boolean {
  const phase = String(ctx?.state?.phase || '').toLowerCase();
  return phase === '' || phase === 'pre_game' || phase === 'pre-game';
}

function zoneHasCards(zones: any, playerId: string, zoneName: string): boolean {
  const zone = zones?.[playerId];
  const cards = zone?.[zoneName];
  if (Array.isArray(cards) && cards.length > 0) return true;
  return Number(zone?.[`${zoneName}Count`]) > 0;
}

function libraryCardsForPlayer(player: any, ctx?: PriorityEligibilityContext): any[] | undefined {
  const pid = String(player?.id || '').trim();
  const libraries = ctx?.libraries as any;
  if (libraries && typeof libraries.get === 'function') {
    const fromMap = libraries.get(pid);
    if (Array.isArray(fromMap)) return fromMap;
  } else if (libraries && pid && Array.isArray(libraries[pid])) {
    return libraries[pid];
  }
  const fromZones = ctx?.state?.zones?.[pid]?.library;
  if (Array.isArray(fromZones)) return fromZones;
  if (Array.isArray(player?.library)) return player.library;
  return undefined;
}

/**
 * True when this seat imported a deck (commander identity and/or a library).
 * Hand, isAI, and battlefield are seated-circle exceptions — they must not
 * count here or empty human test seats get ghosted by an AI opponent or a
 * one-card hand. Battlefield is also excluded so the first token on an empty
 * table does not mark "someone imported a deck" (Tribute opponent choices).
 */
function playerHasImportedDeck(player: any, ctx?: PriorityEligibilityContext): boolean {
  const pid = String(player?.id || '').trim();
  if (!pid) return false;

  const commandZone =
    ctx?.state?.commandZone?.[pid]
    ?? ctx?.commandZone?.[pid]
    ?? player?.commandZone;
  const commanderIds = Array.isArray(commandZone?.commanderIds)
    ? commandZone.commanderIds
    : (Array.isArray(commandZone) ? commandZone : []);
  if (commanderIds.some((id: unknown) => String(id || '').trim())) return true;
  if (Array.isArray(commandZone?.commanderNames)
    && commandZone.commanderNames.some((name: unknown) => String(name || '').trim())) {
    return true;
  }
  if (Array.isArray(commandZone?.inCommandZone) && commandZone.inCommandZone.length > 0) {
    return true;
  }

  const library = libraryCardsForPlayer(player, ctx);
  if (Array.isArray(library) && library.length > 0) return true;
  if (zoneHasCards(ctx?.state?.zones, pid, 'library')) return true;
  return false;
}

function playerIsExplicitlyOutOfGame(player: any): boolean {
  return Boolean(
    player?.hasLost
    || player?.eliminated
    || player?.conceded
    || player?.leftGame
    || player?.spectator
    || player?.isSpectator
  );
}

function playerHasHandCards(player: any, ctx?: PriorityEligibilityContext): boolean {
  const pid = String(player?.id || '').trim();
  const hand = Array.isArray(player?.hand) ? player.hand : ctx?.state?.zones?.[pid]?.hand;
  if (Array.isArray(hand) && hand.length > 0) return true;
  return zoneHasCards(ctx?.state?.zones, pid, 'hand');
}

/**
 * True when this seat imported a deck (commander identity and/or a library).
 * Empty-hand mill-outs still count: commanderIds stay on the command zone,
 * and remaining battlefield permanents keep a milled-out player seated.
 */
export function playerHasSeatedDeck(player: any, ctx?: PriorityEligibilityContext): boolean {
  if (playerHasImportedDeck(player, ctx)) return true;
  const pid = String(player?.id || '').trim();
  if (!pid) return false;
  // Empty AI fixtures and a live hand keep the seat in the circle; they are not
  // "someone imported a deck" evidence (that would ghost empty human test seats).
  if (player?.isAI === true) return true;
  if (playerHasHandCards(player, ctx)) return true;
  if (zoneHasCards(ctx?.state?.zones, pid, 'graveyard')) return true;
  if (zoneHasCards(ctx?.state?.zones, pid, 'exile')) return true;
  if (Array.isArray(player?.graveyard) && player.graveyard.length > 0) return true;
  if (Array.isArray(player?.exile) && player.exile.length > 0) return true;
  const battlefield = Array.isArray(ctx?.state?.battlefield) ? ctx.state.battlefield : [];
  return battlefield.some((permanent: any) => String(permanent?.controller || '').trim() === pid);
}

function gameHasAnyImportedDeck(ctx?: PriorityEligibilityContext): boolean {
  const players = Array.isArray(ctx?.state?.players) ? ctx.state.players : [];
  return players.some((entry: any) => (
    !playerIsExplicitlyOutOfGame(entry) && playerHasImportedDeck(entry, ctx)
  ));
}

/**
 * Players who have left the game do not receive priority (CR 104.5 / 800.4).
 * Also treat 0 life / 10 poison as out even if hasLost was not persisted on the
 * player object (common after event-log replay).
 *
 * After pre-game, a seat that never imported a deck (spectator who joined as
 * Play to dismiss mulligan) is not part of the current player list. Empty test
 * fixtures with no commanders/libraries keep their prior behavior.
 */
export function playerCannotReceivePriority(player: any, ctx?: PriorityEligibilityContext): boolean {
  if (!player) return true;
  if (playerIsExplicitlyOutOfGame(player)) {
    return true;
  }
  const pid = String(player.id || '').trim();
  if (!pid) return true;
  const lifeRaw = ctx?.state?.life?.[pid] ?? player.life;
  const life = Number(lifeRaw);
  if (Number.isFinite(life) && life <= 0) return true;
  const poisonRaw =
    ctx?.state?.poisonCounters?.[pid]
    ?? ctx?.state?.poison?.[pid]
    ?? player.poisonCounters;
  const poison = Number(poisonRaw);
  if (Number.isFinite(poison) && poison >= 10) return true;
  if (!isPreGamePhase(ctx) && gameHasAnyImportedDeck(ctx) && !playerHasSeatedDeck(player, ctx)) {
    return true;
  }
  return false;
}

function inactiveIds(ctx: PriorityEligibilityContext): Set<string> {
  return ctx.inactive instanceof Set ? ctx.inactive : new Set<string>();
}

export function getActivePriorityPlayers(ctx: PriorityEligibilityContext): Array<{ id: string; seat?: number }> {
  const players = Array.isArray(ctx.state?.players) ? ctx.state.players : [];
  const inactive = inactiveIds(ctx);
  return players
    .filter((p: any) => p?.id && !inactive.has(p.id) && !playerCannotReceivePriority(p, ctx))
    .sort((a: any, b: any) => (Number(a.seat) || 0) - (Number(b.seat) || 0));
}

/** True when this id is in the current priority circle (living, not skipped). */
export function playerIdCanReceivePriority(ctx: PriorityEligibilityContext, playerId: string): boolean {
  const id = String(playerId || '').trim();
  if (!id) return false;
  return getActivePriorityPlayers(ctx).some((entry) => entry.id === id);
}

/** Roster rows that are still in the current game (priority circle). */
export function listLivingGamePlayers(ctx: PriorityEligibilityContext): any[] {
  const livingIds = new Set(getActivePriorityPlayers(ctx).map((entry) => entry.id));
  const players = Array.isArray(ctx.state?.players) ? ctx.state.players : [];
  return players.filter((player: any) => player?.id && livingIds.has(String(player.id)));
}

/**
 * Next living player in APNAP / seat order after `from`.
 * If `from` is already out of the game, walk the full seat order after them.
 */
export function nextEligiblePriorityHolder(ctx: PriorityEligibilityContext, from: string): string {
  const active = getActivePriorityPlayers(ctx);
  const n = active.length;
  if (n === 0) return from;
  const step = ctx.state?.turnDirection === -1 ? -1 : 1;
  const idx = active.findIndex((p) => p.id === from);
  if (idx >= 0) {
    return active[(idx + step + n) % n].id;
  }
  const seated = (Array.isArray(ctx.state?.players) ? ctx.state.players : [])
    .filter((p: any) => p?.id)
    .sort((a: any, b: any) => (Number(a.seat) || 0) - (Number(b.seat) || 0));
  if (seated.length === 0) return active[0].id;
  const fromIdx = seated.findIndex((p: any) => p.id === from);
  const start = fromIdx >= 0 ? fromIdx : 0;
  const len = seated.length;
  for (let i = 1; i <= len; i++) {
    const candidate = seated[(start + i * step + len * 8) % len];
    if (active.some((p) => p.id === candidate.id)) return candidate.id;
  }
  return active[0].id;
}

/**
 * If the current priority holder cannot receive priority, move it to the next
 * living player. Returns true when priority changed.
 */
export function reassignPriorityIfHolderCannotReceive(ctx: PriorityEligibilityContext): boolean {
  const state = ctx.state as any;
  const holder = state?.priority;
  if (!holder) return false;
  const active = getActivePriorityPlayers(ctx);
  if (active.some((p) => p.id === holder)) return false;
  const next = nextEligiblePriorityHolder(ctx, holder);
  if (!next || next === holder) return false;
  if (!(state.priorityPassedBy instanceof Set)) {
    state.priorityPassedBy = new Set<string>();
  }
  state.priorityPassedBy.add(holder);
  state.priority = next;
  debug(1, `[priority] Skipping eliminated/inactive holder ${holder}; priority to ${next}`);
  return true;
}

/**
 * Mark a player as out of the priority circle and move priority if they hold it.
 */
export function markPlayerOutOfPriority(ctx: PriorityEligibilityContext, playerId: string): void {
  const id = String(playerId || '').trim();
  if (!id) return;
  if (!(ctx.inactive instanceof Set)) {
    (ctx as any).inactive = new Set<string>();
  }
  ctx.inactive!.add(id);
  reassignPriorityIfHolderCannotReceive(ctx);
}
