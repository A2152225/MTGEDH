import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function createMockIo(emitted: any[], sockets: any[] = []) {
  return {
    to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])) },
  } as any;
}

function createMockSocket(playerId: string, emitted: any[], gameId?: string) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>(),
    on: (event: string, handler: Function) => { handlers[event] = handler; },
    emit: (event: string, payload: any) => { emitted.push({ event, payload }); },
  } as any;
  if (gameId) socket.rooms.add(gameId);
  return { socket, handlers };
}

import { tryQueueOnCastKeywordPrompts } from '../src/socket/game-actions-handlers/gameActionsOnCastKeywordPrompts.js';
import { applyOnCastKeywordsAfterSpellStacked } from '../src/state/modules/onCastKeywordsAfterStack.js';
import { hasCasualtyX } from '../src/state/modules/onCastKeywordPrompts.js';

const NIXILIS_ORACLE = "Casualty X. The copy isn't legendary and has starting loyalty X. (As you cast this spell, you may sacrifice a creature with power X. When you do, copy this spell. The copy becomes a token.)";

describe('Casualty X on-cast sacrifice (Ob Nixilis, the Adversary)', () => {
  const tracked = new Set<string>();
  const createGameId = () => `test_casualty_x_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => { await initDb(); });
  beforeEach(async () => { for (const id of tracked) await resetGame(id); tracked.clear(); });
  afterEach(async () => { for (const id of tracked) await resetGame(id); tracked.clear(); });

  it('parses Casualty X and reuses the casualty prompt for power >= X', () => {
    expect(hasCasualtyX({ name: 'Ob Nixilis, the Adversary', oracle_text: NIXILIS_ORACLE })).toBe(true);
    expect(hasCasualtyX({ name: 'Deadly Dispute', oracle_text: 'Casualty 2' })).toBe(false);
  });

  it('pays Casualty X through the live additional-cost resolution path and copies as nonlegendary with starting loyalty X', async () => {
    const gameId = createGameId(); tracked.add(gameId);
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    (game as any).gameId = gameId;
    const p1 = 'p1';
    const p2 = 'p2';
    const obCard: any = {
      id: 'ob_1',
      name: 'Ob Nixilis, the Adversary',
      type_line: 'Legendary Planeswalker — Nixilis',
      oracle_text: NIXILIS_ORACLE,
      mana_cost: '{1}{B}{R}',
      loyalty: 3,
    };
    const ogre = {
      id: 'ogre_1',
      controller: p1,
      owner: p1,
      power: 5,
      card: { id: 'ogre_1', name: 'Hill Giant', type_line: 'Creature — Giant', power: '5', toughness: '3' },
    };
    (game.state as any).players = [
      { id: p1, name: 'P1', life: 40 },
      { id: p2, name: 'P2', life: 40 },
    ];
    (game.state as any).life = { [p1]: 40, [p2]: 40 };
    (game.state as any).turnPlayer = p1;
    (game.state as any).battlefield = [ogre];
    (game.state as any).zones = {
      [p1]: { hand: [obCard], graveyard: [], exile: [], library: [] },
      [p2]: { hand: [], graveyard: [], exile: [], library: [] },
    };
    (game.state as any).stack = [];

    const queued = tryQueueOnCastKeywordPrompts({
      game,
      gameId,
      playerId: p1,
      cardId: 'ob_1',
      cardName: 'Ob Nixilis, the Adversary',
      card: obCard,
      sourceId: 'ob_1',
    });
    expect(queued).toBe(true);
    const step = ResolutionQueueManager.getQueue(gameId).steps.find((s: any) => s?.additionalCostKeyword === 'casualty') as any;
    expect(step).toBeDefined();
    expect(step.casualtyX).toBe(true);
    expect(String(step.description)).toMatch(/Casualty X/i);
    expect(String(step.description)).toMatch(/isn.t legendary/i);
    expect((step.availableTargets || []).some((t: any) => t.id === 'ogre_1')).toBe(true);

    const emitted: any[] = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    registerResolutionHandlers(createMockIo(emitted, [socket]), socket);
    await handlers['submitResolutionResponse']({ gameId, stepId: step.id, selections: ['ogre_1'] });

    expect(obCard.casualtyPaid).toBe(true);
    expect(obCard.casualtyX).toBe(true);
    expect(obCard.casualtyCopyIsntLegendary).toBe(true);
    expect(Number(obCard.casualtyStartingLoyalty || obCard.casualtyValue)).toBe(5);

    const stackItem: any = {
      id: 'stack_ob_1',
      controller: p1,
      sourceId: 'ob_1',
      card: { ...obCard },
      casualtyPaid: true,
      casualtyResolved: true,
      casualtyX: true,
      casualtyCopyIsntLegendary: true,
      casualtyValue: 5,
      casualtyStartingLoyalty: 5,
    };
    (game.state as any).stack = [stackItem];
    applyOnCastKeywordsAfterSpellStacked({ game, gameId, playerId: p1, stackItem });
    const copies = ((game.state as any).stack || []).filter((entry: any) => entry && entry.id !== 'stack_ob_1');
    expect(copies.length).toBeGreaterThanOrEqual(1);
    const copy = copies[0];
    const copyCard = copy.card || copy;
    expect(String(copyCard.type_line || '')).not.toMatch(/Legendary/i);
    expect(Number(copyCard.loyalty || copyCard.startingLoyalty)).toBe(5);
    expect(String((stackItem.card || stackItem).type_line || '')).toMatch(/Legendary/i);
    expect(Number((stackItem.card || stackItem).loyalty)).toBe(3);
  });
});
