import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src/index.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { triggerETBEffectsForPermanent } from '../src/state/modules/triggerEtbPermanentEffects.js';

/**
 * Generic safety net: a "you may ... target creature you control" trigger that was queued WITHOUT
 * requiresTarget / targetType metadata (Hammer of Nazahn class bug) must still prompt for a target
 * instead of silently skipping after the player answers Yes.
 */
const gameId = 'test_optional_target_safety_net';
const p1 = 'p1' as PlayerID;
const p2 = 'p2' as PlayerID;
const EFFECT = 'you may attach it to target creature you control.';

function noopIo() {
  return { to: () => ({ emit: () => {} }), emit: () => {}, sockets: { sockets: new Map() } } as any;
}

function createMockSocket(emitted: Array<{ event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId: p1, spectator: false, gameId },
    rooms: new Set([gameId]),
    on: (event: string, handler: Function) => { handlers[event] = handler; },
    emit: (event: string, payload: any) => { emitted.push({ event, payload }); },
  } as any;
  return { socket, handlers };
}

function bear(id: string) {
  return {
    id, controller: p1, owner: p1, tapped: false, counters: {},
    card: { id: `${id}_card`, name: `Bear ${id}`, type_line: 'Creature - Bear', oracle_text: '', power: '2', toughness: '2' },
  };
}

function setupGame(triggerOverrides: Record<string, unknown>) {
  createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
  const game: any = ensureGame(gameId);
  game.gameId = gameId;
  const state = game.state;
  state.players = [
    { id: p1, name: 'P1', spectator: false, life: 40 },
    { id: p2, name: 'P2', spectator: false, life: 40 },
  ];
  state.zones = {
    [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, libraryCount: 0 },
    [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, libraryCount: 0 },
  };
  state.phase = 'precombatMain';
  state.step = 'MAIN1';
  state.turnPlayer = p1;
  state.priority = p1;
  const aid = {
    id: 'aid', controller: p1, owner: p1, tapped: false, counters: {},
    card: { id: 'aid_card', name: 'Sigarda Stand-in', type_line: 'Enchantment', oracle_text: `Whenever an Equipment you control enters, ${EFFECT}` },
  };
  const saw = {
    id: 'saw', controller: p1, owner: p1, tapped: false, counters: {},
    card: { id: 'saw_card', name: 'Bone Saw', type_line: 'Artifact - Equipment', oracle_text: 'Equipped creature gets +1/+0.\nEquip {1}' },
  };
  state.battlefield = [bear('b1'), bear('b2'), aid, saw];
  state.stack = [];
  // Queue the real trigger, then strip every piece of target metadata to reproduce a queue path that
  // forgot to stamp it (the Hammer of Nazahn bug).
  triggerETBEffectsForPermanent(game, saw as any, p1);
  const queued = state.stack[state.stack.length - 1] as any;
  expect(queued?.source).toBe('aid');
  for (const key of Object.keys(queued)) {
    if (/^target|^needsTargetSelection$|^requiresTarget$|^minTargets$|^maxTargets$/.test(key)) delete queued[key];
  }
  Object.assign(queued, triggerOverrides);
  return game;
}

async function resolveAndAnswer(game: any, answer: 'yes' | 'no') {
  const emitted: Array<{ event: string; payload: any }> = [];
  const { socket, handlers } = createMockSocket(emitted);
  registerResolutionHandlers(noopIo(), socket);
  game.resolveTopOfStack();
  const seen: string[] = [];
  for (let guard = 0; guard < 8; guard++) {
    const step = (ResolutionQueueManager.getQueue(gameId).steps as any[])[0];
    if (!step) break;
    seen.push(String(step.type));
    const selections = step.type === 'target_selection' ? ['b2'] : [answer];
    await handlers.submitResolutionResponse({ gameId, stepId: String(step.id), selections, cancelled: false });
  }
  expect(emitted.filter((e) => e.event === 'error')).toEqual([]);
  return seen;
}

describe('optional "you may ... target" trigger safety net', () => {
  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(noopIo());
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
    try { await deleteGame(gameId); } catch { /* ignore */ }
  });

  afterEach(() => {
    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  for (const flag of ['0', '1']) {
    it(`prompts for a target after Yes even though the trigger was queued without target metadata (IR primary=${flag})`, async () => {
      process.env.ORACLE_IR_TRIGGER_PRIMARY = flag;
      const game = setupGame({});
      expect(game.state.stack[0].requiresTarget).toBeFalsy();
      const seen = await resolveAndAnswer(game, 'yes');
      expect(seen).toContain('target_selection');
      // The legacy (non-IR) executor has no "attach it to target" handler; the IR-primary path (the
      // production default) must complete the attach.
      if (flag === '1') {
        const saw = (game.state.battlefield as any[]).find((p) => p.id === 'saw');
        expect(saw.attachedTo).toBe('b2');
      }
    }, 90000);

    it(`declining attaches nothing (IR primary=${flag})`, async () => {
      process.env.ORACLE_IR_TRIGGER_PRIMARY = flag;
      const game = setupGame({});
      await resolveAndAnswer(game, 'no');
      const saw = (game.state.battlefield as any[]).find((p) => p.id === 'saw');
      expect(saw.attachedTo).toBeFalsy();
    }, 90000);
  }

  it('already-accepted trigger (decision applied) without metadata still prompts for a target', async () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    const game = setupGame({ optionalTriggeredAbilityDecisionApplied: true });
    const seen = await resolveAndAnswer(game, 'yes');
    expect(seen).toContain('target_selection');
  }, 90000);
});