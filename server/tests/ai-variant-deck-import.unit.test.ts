import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { importAIResolvedDeck } from '../src/socket/ai-handlers/aiVariantDeckImport.js';
import { splitResolvedDeckVariants } from '../src/state/modules/variantDeckImportCommit.js';

/** AI deck text uses the same split-and-seed path as a human import. Planes never enter the library. */

const creature = (name: string) => ({ name, type_line: 'Creature — Bear', oracle_text: '' });
const plane = (name: string) => ({ name, type_line: 'Plane — Test', oracle_text: '' });
const scheme = (name: string) => ({ name, type_line: 'Scheme', oracle_text: 'When you set this scheme in motion, you gain 1 life.' });

let counter = 0;

function freshGame(rules: Record<string, boolean>) {
  const gameId = `unit_ai_variant_import_${++counter}`;
  createGameIfNotExists(gameId, 'commander', 40);
  const libraries = new Map<string, any[]>();
  const game: any = {
    seq: 1,
    state: {
      turnNumber: 0,
      players: [{ id: 'p1', name: 'Ada' }],
      houseRules: rules,
      life: { p1: 20 },
      zones: {},
    },
    importDeckResolved(playerId: string, cards: any[]) {
      libraries.set(playerId, cards);
    },
    bumpSeq() {
      game.seq += 1;
    },
  };
  return { gameId, game, libraries };
}

describe('AI variant deck import', () => {
  const created: string[] = [];

  beforeAll(async () => {
    await initDb();
  });

  afterEach(async () => {
    for (const id of created.splice(0)) await deleteGame(id);
  });

  it('keeps precon extras with the cards found in the deck text', () => {
    const split = splitResolvedDeckVariants(
      [creature('Bear'), plane('On the Deck')],
      { planar: [plane('From the Precon')], schemes: [scheme('Stored Scheme')] },
    );
    expect(split.playable.map((card) => card.name)).toEqual(['Bear']);
    expect(split.planar.map((card) => card.name)).toEqual(['On the Deck', 'From the Precon']);
    expect(split.schemes.map((card) => card.name)).toEqual(['Stored Scheme']);
  });

  it('strips planes and schemes from the library and seeds both decks', async () => {
    const { gameId, game, libraries } = freshGame({ enablePlanechase: true, enableArchenemy: true });
    created.push(gameId);
    const chats: string[] = [];
    const io = { to: () => ({ emit: (_event: string, payload: any) => chats.push(payload.message) }) };

    const imported = await importAIResolvedDeck({
      game,
      gameId,
      playerId: 'p1',
      resolvedCards: [creature('Grizzly Bears'), plane('The Trenches'), scheme('Choose Your Champion')],
      logLabel: '[test]',
      io,
    });

    expect(libraries.get('p1')?.map((card) => card.name)).toEqual(['Grizzly Bears']);
    expect(imported.libraryCount).toBe(1);
    expect(imported.variantCount).toBe(2);
    expect(game.state.currentPlane?.name).toBe('The Trenches');
    expect(game.state.schemeDeck?.map((card: any) => card.name)).toEqual(['Choose Your Champion']);
    expect(game.state.schemeDeck[0].owner).toBe('p1');
    expect(game.state.life.p1).toBe(40);
    expect(chats.some((line) => line.startsWith('Planechase:'))).toBe(true);
    expect(chats.some((line) => line.startsWith('Archenemy:'))).toBe(true);

    const events = getEvents(gameId);
    const deckEvent = events.find((event) => event.type === 'deckImportResolved');
    expect((deckEvent?.payload as any)?.cards?.map((card: any) => card.name)).toEqual(['Grizzly Bears']);
    expect(events.some((event) => event.type === 'importVariantDecks')).toBe(true);
  });

  it('still strips variant cards when the house rules are off, and does not seed them', async () => {
    const { gameId, game, libraries } = freshGame({});
    created.push(gameId);

    const imported = await importAIResolvedDeck({
      game,
      gameId,
      playerId: 'p1',
      resolvedCards: [creature('Grizzly Bears'), plane('The Trenches'), scheme('Choose Your Champion')],
      logLabel: '[test]',
    });

    expect(libraries.get('p1')?.map((card) => card.name)).toEqual(['Grizzly Bears']);
    expect(game.state.currentPlane).toBeUndefined();
    expect(game.state.schemeDeck).toBeUndefined();
    expect(game.state.life.p1).toBe(20);
    expect(imported.messages.some((line) => /Planechase is not enabled/.test(line))).toBe(true);
    expect(imported.messages.some((line) => /Archenemy is not enabled/.test(line))).toBe(true);
    expect(getEvents(gameId).some((event) => event.type === 'importVariantDecks')).toBe(false);
  });
});
