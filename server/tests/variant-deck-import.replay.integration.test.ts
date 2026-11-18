import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { initDb, createGameIfNotExists, deleteGame, getEvents } from '../src/db/index.js';
import { createInitialGameState } from '../src/state/index.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { applyConfirmedImport } from '../src/socket/deck-handlers/deckApplyConfirmedImport.js';
import {
  pendingImportConfirmations,
  type PendingConfirm,
} from '../src/socket/deck-handlers/deckImportConfirmState.js';
/**
 * Reload replays the saved event log; it never re-runs the import. Seeding the planar / scheme
 * decks must therefore be saved as `importVariantDecks`, and the library must come back WITHOUT
 * planes (the saved deckImportResolved event carries only playable cards).
 */

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'mtgjson-decks');
const usedGameIds = new Set<string>();

function fixtureCards(file: string, key: 'planes' | 'schemes'): any[] {
  const deck = JSON.parse(fs.readFileSync(path.join(fixtureDir, file), 'utf8')).data;
  return (deck[key] || []).map((card: any) => ({
    name: card.name,
    type_line: card.type,
    oracle_text: '',
  }));
}

const creature = (id: string, name: string) => ({
  id,
  name,
  type_line: 'Creature — Alien',
  oracle_text: '',
  mana_cost: '{1}{B}',
  power: '2',
  toughness: '2',
});

const io: any = {
  to: () => ({ emit: () => {} }),
  emit: () => {},
  sockets: { sockets: new Map() },
};

function seatPlayers(state: any, houseRules: Record<string, boolean>) {
  state.players = [
    { id: 'p1', name: 'P1', spectator: false, life: 40 },
    { id: 'p2', name: 'P2', spectator: false, life: 40 },
  ];
  state.houseRules = houseRules;
  state.startingLife = 40;
}

async function liveImport(gameId: string, houseRules: Record<string, boolean>, pending: Partial<PendingConfirm>) {
  usedGameIds.add(gameId);
  await deleteGame(gameId);
  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId)!;
  seatPlayers(game.state, houseRules);
  const start = getEvents(gameId).length;

  const confirmId = `imp_${gameId}`;
  pendingImportConfirmations.set(confirmId, {
    gameId,
    initiator: 'p1',
    resolvedCards: [],
    parsedCount: 0,
    deckName: 'Masters of Evil',
    save: false,
    responses: { p1: 'yes' },
    applyImporterOnly: true,
    ...pending,
  } as PendingConfirm);
  await applyConfirmedImport(io, confirmId);
  return { game, start };
}

function replayInto(gameId: string, fromIndex: number, houseRules: Record<string, boolean>) {
  const saved = getEvents(gameId).slice(fromIndex);
  const replayGame = createInitialGameState(`${gameId}_replay`);
  seatPlayers(replayGame.state, houseRules);
  replayGame.replay!(saved.map((event: any) => ({ type: event.type, ...(event.payload || {}) })) as any);
  return { replayGame, saved };
}

const ids = (cards: any[] | undefined) => (cards || []).map((card) => card.id);
const libraryNames = (game: any, playerId: string) =>
  ((game.libraries as Map<string, any[]>).get(playerId) || []).map((card) => card.name);

describe('planar / scheme deck import survives reload', () => {
  beforeAll(async () => {
    await initDb();
  });

  afterEach(async () => {
    for (const id of usedGameIds) {
      ResolutionQueueManager.removeQueue(id);
      games.delete(id as any);
      await deleteGame(id);
    }
    usedGameIds.clear();
    pendingImportConfirmations.clear();
  });

  it('precon planes + a plane pasted in the list: library excludes planes, decks are saved and replayed', async () => {
    const rules = { enablePlanechase: true };
    const pastedPlane = { id: 'pasted-plane', name: 'Naya', type_line: 'Plane — Alara', oracle_text: '' };
    const { game, start } = await liveImport('replay_variant_planechase', rules, {
      resolvedCards: [creature('c1', 'Davros, Dalek Creator'), creature('c2', 'Missy'), pastedPlane] as any,
      parsedCount: 3,
      variantCards: { planar: fixtureCards('MastersOfEvil_WHO.trimmed.json', 'planes'), schemes: [] },
    });
    const live = game.state as any;

    // 10 precon planar cards + 1 pasted plane, one face up and the rest face down.
    expect(live.currentPlane?.type_line).toMatch(/^Plane/);
    expect(live.planarDeckFaceDown).toHaveLength(10);
    // The library is the playable cards only.
    expect(libraryNames(game, 'p1').sort()).toEqual(['Davros, Dalek Creator', 'Missy']);

    const { replayGame, saved } = replayInto('replay_variant_planechase', start, rules);
    const replayed = replayGame.state as any;

    // The saved deckImportResolved event carries no planes, and the variant seed is saved exactly once.
    const importEvent = saved.find((event: any) => event.type === 'deckImportResolved') as any;
    expect(importEvent.payload.cards.map((card: any) => card.name)).toEqual(['Davros, Dalek Creator', 'Missy']);
    expect(saved.filter((event: any) => event.type === 'importVariantDecks')).toHaveLength(1);

    // Same decks, same face-up plane, same library after replay (no reshuffle, no planes).
    expect(replayed.currentPlane?.id).toBe(live.currentPlane.id);
    expect(replayed.activePlane?.id).toBe(live.currentPlane.id);
    expect(ids(replayed.planarDeckFaceDown)).toEqual(ids(live.planarDeckFaceDown));
    expect(Object.keys(replayed.planarContributions)).toEqual(['p1']);
    expect(libraryNames(replayGame, 'p1').sort()).toEqual(['Davros, Dalek Creator', 'Missy']);

    // Clients never see the face-down deck, only its size.
    const view: any = (game as any).viewFor('p2', false);
    const clientView = JSON.stringify(view);
    for (const card of live.planarDeckFaceDown) expect(clientView).not.toContain(card.id);
    expect(view.planarDeckCount).toBe(10);
    expect(view.planarDeckFaceDown).toBeUndefined();
    expect(view.planarContributions).toBeUndefined();
    expect(clientView).toContain(live.currentPlane.id);
  });

  it('precon schemes make the importer the archenemy and replay to the same scheme deck', async () => {
    const rules = { enableArchenemy: true };
    const schemes = [
      { name: 'Choose Your Champion', type_line: 'Scheme', oracle_text: '' },
      { name: 'My Tendrils Run Deep', type_line: 'Ongoing Scheme', oracle_text: '' },
      { name: 'I Am Never Alone', type_line: 'Scheme', oracle_text: '' },
    ];
    const { game, start } = await liveImport('replay_variant_archenemy', rules, {
      resolvedCards: [creature('c1', 'Davros, Dalek Creator')] as any,
      parsedCount: 1,
      deckName: 'Death Toll',
      variantCards: { planar: [], schemes },
    });
    const live = game.state as any;
    expect(live.archenemyPlayerId).toBe('p1');
    expect(live.schemeDeck).toHaveLength(3);

    const { replayGame } = replayInto('replay_variant_archenemy', start, rules);
    const replayed = replayGame.state as any;
    expect(replayed.archenemyPlayerId).toBe('p1');
    expect(ids(replayed.schemeDeck)).toEqual(ids(live.schemeDeck));
    expect(replayed.ongoingSchemes).toEqual([]);

    const view: any = (game as any).viewFor('p2', false);
    expect(view.schemeDeck).toBeUndefined();
    expect(view.schemeDeckCount).toBe(3);
    expect(view.archenemyPlayerId).toBe('p1');
  });

  it('with both modes off the planes are still kept out of the library and nothing is seeded', async () => {
    const pastedPlane = { id: 'pasted-plane', name: 'Naya', type_line: 'Plane — Alara', oracle_text: '' };
    const { game, start } = await liveImport('replay_variant_off', {}, {
      resolvedCards: [creature('c1', 'Missy'), pastedPlane] as any,
      parsedCount: 2,
      variantCards: { planar: fixtureCards('MastersOfEvil_WHO.trimmed.json', 'planes'), schemes: [] },
    });
    const live = game.state as any;
    expect(libraryNames(game, 'p1')).toEqual(['Missy']);
    expect(live.planarDeckFaceDown).toBeUndefined();
    expect(live.currentPlane).toBeUndefined();

    const saved = getEvents('replay_variant_off').slice(start);
    expect(saved.filter((event: any) => event.type === 'importVariantDecks')).toHaveLength(0);
  });
});
