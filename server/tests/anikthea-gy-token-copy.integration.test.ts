/**
 * Anikthea-family: exile up to one GY enchantment → token copy as N/N creature.
 * Regression for sync storm when "up to one" exiles nothing — copy source must not
 * fall back to the ability source (which re-ETBs forever).
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { initDb, createGameIfNotExists, deleteGame } from '../src/db/index.js';
import { ensureGame, persistAndResolveTopOfStack } from '../src/socket/util.js';
import { initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

const FULL =
  "Menace\nOther enchantment creatures you control have menace.\nWhenever Anikthea enters or attacks, exile up to one target non-Aura enchantment card from your graveyard. Create a token that's a copy of that card, except it's a 3/3 black Zombie creature in addition to its other types.";

const EFFECT =
  "exile up to one target non-Aura enchantment card from your graveyard. Create a token that's a copy of that card, except it's a 3/3 black Zombie creature in addition to its other types.";

const usedGameIds = new Set<string>();

function emptyZones() {
  const zone = () => ({
    hand: [],
    handCount: 0,
    graveyard: [],
    graveyardCount: 0,
    libraryCount: 0,
    exile: [],
    exileCount: 0,
  });
  return { p1: zone(), p2: zone() };
}

function setupLiveGame(gameId: string) {
  usedGameIds.add(gameId);
  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId)!;
  const state = game.state as any;
  state.players = [
    { id: 'p1', name: 'P1', spectator: false, life: 40 },
    { id: 'p2', name: 'P2', spectator: false, life: 40 },
  ];
  state.life = { p1: 40, p2: 40 };
  state.startingLife = 40;
  state.turnPlayer = 'p1';
  state.priority = 'p1';
  state.activePlayer = 'p1';
  state.stack = [];
  state.zones = emptyZones();
  state.battlefield = [
    {
      id: 'anik-source',
      controller: 'p1',
      owner: 'p1',
      ownerId: 'p1',
      name: 'Anikthea, Hand of Erebos',
      type_line: 'Legendary Enchantment Creature — Demigod',
      cardType: 'Legendary Enchantment Creature — Demigod',
      power: 4,
      toughness: 4,
      card: {
        id: 'anik-card',
        name: 'Anikthea, Hand of Erebos',
        type_line: 'Legendary Enchantment Creature — Demigod',
        oracle_text: FULL,
        power: '4',
        toughness: '4',
      },
    },
  ];
  return game;
}

function pushAniktheaTrigger(game: any, targetId?: string) {
  const targets = targetId ? [{ id: targetId, zone: 'graveyard', controller: 'p1' }] : [];
  game.state.stack.push({
    id: `trig-anik-${Date.now()}`,
    type: 'triggered_ability',
    controller: 'p1',
    source: 'anik-source',
    permanentId: 'anik-source',
    sourceId: 'anik-source',
    sourceName: 'Anikthea, Hand of Erebos',
    effect: EFFECT,
    description: EFFECT,
    abilityText: EFFECT,
    targets,
    targetIds: targetId ? [targetId] : [],
    card: {
      name: 'Anikthea, Hand of Erebos',
      oracle_text: FULL,
      type_line: 'Legendary Enchantment Creature — Demigod',
    },
  });
}

describe('Anikthea GY→token-copy resolve', () => {
  const savedTriggerPrimary = process.env.ORACLE_IR_TRIGGER_PRIMARY;

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler({ to: () => ({ emit: () => {} }), emit: () => {} } as any);
  });

  afterEach(async () => {
    if (savedTriggerPrimary === undefined) delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    else process.env.ORACLE_IR_TRIGGER_PRIMARY = savedTriggerPrimary;
    for (const id of usedGameIds) {
      ResolutionQueueManager.removeQueue(id);
      games.delete(id as any);
      await deleteGame(id);
    }
    usedGameIds.clear();
  });

  it('exiles a GY enchantment and creates the 3/3 Zombie copy without wedging', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    const gameId = 'anik_gy_copy_ok';
    const game = setupLiveGame(gameId);
    (game.state as any).zones.p1.graveyard = [
      {
        id: 'gy-arena',
        name: 'Phyrexian Arena',
        type_line: 'Enchantment',
        oracle_text: 'At the beginning of your upkeep, you draw a card and you lose 1 life.',
        zone: 'graveyard',
      },
    ];
    (game.state as any).zones.p1.graveyardCount = 1;
    pushAniktheaTrigger(game, 'gy-arena');

    const t0 = process.hrtime.bigint();
    const ok = persistAndResolveTopOfStack(game, gameId, { playerId: 'p1' });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;

    expect(ok).toBe(true);
    expect(ms).toBeLessThan(5000);
    const state = game.state as any;
    expect((state.zones.p1.exile || []).map((c: any) => c.name)).toContain('Phyrexian Arena');
    const token = (state.battlefield || []).find((p: any) => p.isToken);
    expect(token?.name || token?.card?.name).toBe('Phyrexian Arena');
    expect(String(token?.type_line || token?.card?.type_line || '')).toMatch(/Enchantment/i);
    expect(String(token?.type_line || token?.card?.type_line || '')).toMatch(/Creature/i);
    expect(String(token?.type_line || token?.card?.type_line || '')).toMatch(/Zombie/i);
    expect(Number(token?.power)).toBe(3);
    expect(Number(token?.toughness)).toBe(3);
    expect((state.battlefield || []).filter((p: any) => /Anikthea/i.test(String(p.name || p.card?.name || ''))).length).toBe(1);
  });

  it('does not mint a source copy when up-to-one exiles nothing (no sync storm)', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    const gameId = 'anik_gy_copy_no_target';
    const game = setupLiveGame(gameId);
    pushAniktheaTrigger(game);

    const t0 = process.hrtime.bigint();
    persistAndResolveTopOfStack(game, gameId, { playerId: 'p1' });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;

    expect(ms).toBeLessThan(5000);
    const state = game.state as any;
    const aniktheaCopies = (state.battlefield || []).filter((p: any) =>
      /Anikthea/i.test(String(p.name || p.card?.name || '')),
    );
    expect(aniktheaCopies).toHaveLength(1);
    expect(aniktheaCopies[0].isToken).not.toBe(true);
    expect((state.battlefield || []).filter((p: any) => p.isToken)).toHaveLength(0);
  });
});
