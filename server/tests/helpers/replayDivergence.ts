/**
 * Replay-divergence guardrail helper (undo/replay fidelity).
 *
 * The undo feature rebuilds game state by replaying the persisted event log
 * into a fresh context. That only stays correct if every state change flows
 * through events. This helper compares a live game against a replayed twin
 * using a normalized projection (life, zone contents, battlefield, stack) so
 * any mutation that bypassed the event log fails loudly.
 *
 * Usage pattern (see replay-divergence.guardrail.integration.test.ts):
 *
 *   const eventStart = getEvents(gameId).length;
 *   // ... drive the live game via socket handlers / resolveTopOfStack ...
 *   const replayGame = createInitialGameState(replayGameId);
 *   seed(replayGame);                       // identical seed as the live game
 *   replayGame.replay(toReplayEvents(gameId, eventStart));
 *   // ... re-apply any non-evented direct calls (e.g. resolveTopOfStack) ...
 *   assertNoReplayDivergence(liveGame, replayGame);
 *
 * Adopt opportunistically in socket integration tests that fully resolve an
 * effect — each adoption converts "undo works for patterns we remembered to
 * test" into "undo divergence fails CI".
 */

import { expect } from 'vitest';

import { getEvents } from '../../src/db/index.js';

/** Persist order can differ from causal order (e.g. drawCards before scryResolve). */
const REPLAY_CAUSAL_ORDER: Record<string, number> = {
  resolveTopOfStackPrompt: 10,
  scryResolve: 20,
  surveilResolve: 20,
  librarySearchResolve: 20,
  ponderResolve: 20,
  bottomOrderResolve: 20,
  discardEffect: 25,
  cleanupDiscard: 25,
  shuffleLibrary: 35,
  drawCards: 40,
  moveResolvedInstantOrSorcery: 45,
};

function replayCausalRank(eventType: string): number {
  return REPLAY_CAUSAL_ORDER[eventType] ?? 30;
}

export function toReplayEvents(gameId: string, startIndex = 0): Array<Record<string, unknown>> {
  const events = getEvents(gameId)
    .slice(startIndex)
    .map((event: any) =>
      event?.payload && typeof event.payload === 'object'
        ? { type: event.type, ...(event.payload as Record<string, unknown>) }
        : { type: event.type },
    );
  const hasLibraryAfterSearchResolve = events.some(
    (event) => event.type === 'librarySearchResolve'
      && Array.isArray((event as any).libraryAfter)
      && (event as any).libraryAfter.length > 0,
  );
  const filteredEvents = hasLibraryAfterSearchResolve
    ? events.filter((event) => event.type !== 'shuffleLibrary')
    : events;
  return [...filteredEvents].sort(
    (a, b) => replayCausalRank(String(a.type || '')) - replayCausalRank(String(b.type || '')),
  );
}

type ReplayCompareProjection = {
  players: Array<{ id: string; life: number | null }>;
  zones: Record<
    string,
    {
      hand: string[];
      handCount: number;
      graveyard: string[];
      graveyardCount: number;
      exile: string[];
      library: string[];
      libraryCount: number;
    }
  >;
  battlefield: Array<{ name: string; controller: string; tapped: boolean }>;
  stack: string[];
};

function cardIdentity(card: any): string {
  const id = String(card?.id || card?.card?.id || '').trim();
  if (id) return id;
  return String(card?.name || card?.card?.name || '');
}

function cardNames(cards: unknown): string[] {
  if (!Array.isArray(cards)) return [];
  return cards.map((card: any) => cardIdentity(card));
}

function zoneCardKeys(cards: unknown): string[] {
  if (!Array.isArray(cards)) return [];
  return cards.map((card: any) => cardIdentity(card)).sort();
}

/**
 * Normalized projection for live-vs-replay comparison. Deliberately excludes
 * volatile fields (seq counters, timestamps, generated token ids) and sorts
 * unordered zones; library order is preserved because top-of-library order is
 * gameplay-relevant and must replay deterministically.
 */
export function projectStateForReplayCompare(game: any): ReplayCompareProjection {
  const state = game?.state || {};
  const players = (Array.isArray(state.players) ? state.players : [])
    .map((player: any) => ({
      id: String(player?.id || ''),
      life: Number.isFinite(Number(state.life?.[player?.id] ?? player?.life))
        ? Number(state.life?.[player?.id] ?? player?.life)
        : null,
    }))
    .sort((a: any, b: any) => a.id.localeCompare(b.id));

  const zones: ReplayCompareProjection['zones'] = {};
  for (const player of players) {
    const zone = state.zones?.[player.id] || {};
    const library = game?.libraries?.get?.(player.id) ?? zone.library ?? [];
    zones[player.id] = {
      hand: zoneCardKeys(zone.hand),
      handCount: Number(zone.handCount ?? (Array.isArray(zone.hand) ? zone.hand.length : 0)),
      graveyard: zoneCardKeys(zone.graveyard),
      graveyardCount: Number(
        zone.graveyardCount ?? (Array.isArray(zone.graveyard) ? zone.graveyard.length : 0),
      ),
      exile: zoneCardKeys(zone.exile),
      library: cardNames(library),
      libraryCount: Number(
        zone.libraryCount ?? (Array.isArray(library) ? library.length : 0),
      ),
    };
  }

  const battlefield = (Array.isArray(state.battlefield) ? state.battlefield : [])
    .map((permanent: any) => ({
      name: String(permanent?.card?.name || permanent?.name || ''),
      controller: String(permanent?.controller || ''),
      tapped: Boolean(permanent?.tapped),
    }))
    .sort(
      (a: any, b: any) =>
        a.name.localeCompare(b.name) || a.controller.localeCompare(b.controller),
    );

  const stack = (Array.isArray(state.stack) ? state.stack : []).map((item: any) => {
    const cardId = String(item?.card?.id || item?.id || '').trim();
    if (cardId) return cardId;
    return String(item?.card?.name || item?.sourceName || item?.type || '');
  });

  return { players, zones, battlefield, stack };
}

export function assertNoReplayDivergence(liveGame: any, replayGame: any): void {
  const live = projectStateForReplayCompare(liveGame);
  const replayed = projectStateForReplayCompare(replayGame);
  expect(replayed).toEqual(live);
}
