import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import GameManager from '../src/GameManager.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerCombatHandlers } from '../src/socket/combat.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

// Regression (live game, Oct 12): Myrel + Roaming Throne (Soldier) put 4 Myrel attack
// triggers on the stack. Root cause: the server accepted a second declareAttackers in the
// same declare-attackers step, re-running attack triggers. Roaming Throne itself added
// exactly one extra per declaration.

const MYREL_TEXT = "Flash\nDuring your turn, your opponents can't cast spells or activate abilities of artifacts, creatures, enchantments, or planeswalkers.\nWhenever Myrel attacks, create X 1/1 colorless Soldier artifact creature tokens, where X is the number of Soldiers you control.";
const THRONE_TEXT = 'Ward {2}\nAs this creature enters, choose a creature type.\nThis creature is the chosen type in addition to its other types.\nIf a triggered ability of another creature you control of the chosen type triggers, it triggers an additional time.';

const gameIds: string[] = [];

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  GameManager.deleteGame(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function creature(id: string, name: string, typeLine: string, oracle: string, p: number, t: number, extra: any = {}) {
  return {
    id, controller: 'p1', owner: 'p1', tapped: false, summoningSickness: false, counters: {}, basePower: p, baseToughness: t, ...extra,
    card: { id: `${id}_card`, name, type_line: typeLine, oracle_text: oracle, power: String(p), toughness: String(t) },
  };
}

function setup() {
  const gameId = `myrel_redeclare_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  gameIds.push(gameId);
  createGameIfNotExists(gameId, 'commander', 40);
  const game: any = ensureGame(gameId);
  game.gameId = gameId;
  Object.assign(game.state, {
    players: [{ id: 'p1', name: 'A', spectator: false, life: 40 }, { id: 'p2', name: 'B', spectator: false, life: 40 }],
    life: { p1: 40, p2: 40 }, turnPlayer: 'p1', activePlayer: 'p1', priority: 'p1', phase: 'combat', step: 'declareAttackers',
    turn: 3, turnNumber: 3, stack: [], attackersDeclaredBy: [],
    zones: {
      p1: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
      p2: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
    },
    battlefield: [
      creature('myrel', 'Myrel, Shield of Argive', 'Legendary Creature — Human Soldier', MYREL_TEXT, 3, 4),
      creature('throne', 'Roaming Throne', 'Artifact Creature — Golem', THRONE_TEXT, 4, 4, { chosenCreatureType: 'Soldier' }),
      creature('bear', 'Raging Bear', 'Creature — Bear', 'Whenever this creature attacks, you gain 1 life.', 2, 2),
    ],
  });
  const emitted: any[] = [];
  const handlers: Record<string, Function> = {};
  const socket: any = {
    data: { playerId: 'p1', spectator: false, gameId }, rooms: new Set([gameId]),
    on: (ev: string, h: Function) => { handlers[ev] = h; }, emit: (event: string, payload: any) => emitted.push({ event, payload }),
  };
  const io: any = {
    to: () => ({ emit: (event: string, payload: any) => emitted.push({ event, payload }) }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map([['s0', socket]]) },
  };
  registerCombatHandlers(io, socket);
  return { game, gameId, handlers, emitted };
}

const bySource = (game: any, name: string) => (game.state.stack || []).filter((s: any) => String(s.sourceName || s.source || '').startsWith(name)).length;

describe('attack triggers fire once per declaration (Myrel + Roaming Throne)', () => {
  beforeAll(async () => { await initDb(); });
  afterEach(async () => { while (gameIds.length) await resetGame(gameIds.pop()!); });

  it('Roaming Throne adds exactly one extra Myrel trigger; non-Soldier attack triggers once', async () => {
    const { game, gameId, handlers } = setup();
    await handlers.declareAttackers({ gameId, attackers: [{ creatureId: 'myrel', targetPlayerId: 'p2' }, { creatureId: 'bear', targetPlayerId: 'p2' }] });
    expect(bySource(game, 'Myrel')).toBe(2);
    expect(bySource(game, 'Raging Bear')).toBe(1);
  });

  it('rejects a second declareAttackers in the same step without re-running triggers', async () => {
    const { game, gameId, handlers, emitted } = setup();
    await handlers.declareAttackers({ gameId, attackers: [{ creatureId: 'myrel', targetPlayerId: 'p2' }, { creatureId: 'bear', targetPlayerId: 'p2' }] });
    const stackBefore = (game.state.stack || []).length;
    await handlers.declareAttackers({ gameId, attackers: [{ creatureId: 'myrel', targetPlayerId: 'p2' }] });
    expect((game.state.stack || []).length).toBe(stackBefore);
    expect(bySource(game, 'Myrel')).toBe(2);
    expect(emitted.some((e) => e.event === 'error' && e.payload?.code === 'ATTACKERS_ALREADY_DECLARED')).toBe(true);
  });
});
