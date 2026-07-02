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

export function toReplayEvents(gameId: string, startIndex = 0): Array<Record<string, unknown>> {
  return getEvents(gameId)
    .slice(startIndex)
    .map((event: any) =>
      event?.payload && typeof event.payload === 'object'
        ? { type: event.type, ...(event.payload as Record<string, unknown>) }
        : { type: event.type },
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

function cardNames(cards: unknown): string[] {
  if (!Array.isArray(cards)) return [];
  return cards.map((card: any) => String(card?.name || card?.card?.name || card?.id || ''));
}

function sortedCardNames(cards: unknown): string[] {
  return cardNames(cards).sort();
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
      hand: sortedCardNames(zone.hand),
      handCount: Number(zone.handCount ?? (Array.isArray(zone.hand) ? zone.hand.length : 0)),
      graveyard: sortedCardNames(zone.graveyard),
      graveyardCount: Number(
        zone.graveyardCount ?? (Array.isArray(zone.graveyard) ? zone.graveyard.length : 0),
      ),
      exile: sortedCardNames(zone.exile),
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

  const stack = (Array.isArray(state.stack) ? state.stack : []).map((item: any) =>
    String(item?.card?.name || item?.sourceName || item?.type || ''),
  );

  return { players, zones, battlefield, stack };
}

export function assertNoReplayDivergence(liveGame: any, replayGame: any): void {
  const live = projectStateForReplayCompare(liveGame);
  const replayed = projectStateForReplayCompare(replayGame);
  expect(replayed).toEqual(live);
}
