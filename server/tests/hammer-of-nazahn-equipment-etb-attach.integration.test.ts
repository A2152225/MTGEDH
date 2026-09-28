import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src/index.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { queueSelfETBTriggersForPermanent } from '../src/state/modules/triggerEtbEntryEffects.js';
import { triggerETBEffectsForPermanent } from '../src/state/modules/triggerEtbPermanentEffects.js';
import { shouldQueueNamedOrAnotherTypedEtbTrigger } from '../src/state/modules/triggerEtbEntryEffects-handlers/triggerEtbTypedPermanentMatch.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

const HAMMER_TEXT =
  'Whenever Hammer of Nazahn or another Equipment you control enters, you may attach that Equipment to target creature you control.\n' +
  'Equipped creature gets +2/+0 and has indestructible.\nEquip {4}';
const SIGARDAS_AID_TEXT = 'Flash\nWhenever an Equipment you control enters, you may attach it to target creature you control.';

const gameId = 'test_hammer_of_nazahn_equipment_etb_attach';
const p1 = 'p1' as PlayerID;
const p2 = 'p2' as PlayerID;

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

function equipment(id: string, name: string, oracleText: string, legendary = false) {
  return {
    id, controller: p1, owner: p1, tapped: false, counters: {},
    card: { id: `${id}_card`, name, type_line: `${legendary ? 'Legendary ' : ''}Artifact - Equipment`, oracle_text: oracleText },
  };
}

function setupGame() {
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
  state.stack = [];
  state.battlefield = [bear('b1'), bear('b2')];
  return game;
}

/** Resolve the top trigger and answer every prompt: pick `b2` for targets, `answer` for the may choice. */
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
  expect(emitted.filter(e => e.event === 'error')).toEqual([]);
  return seen;
}

function perm(game: any, id: string) {
  return (game.state.battlefield as any[]).find(p => p.id === id);
}

describe('Hammer of Nazahn / Equipment-enters "you may attach ... to target creature you control"', () => {
  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(noopIo());
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
    try { await deleteGame(gameId); } catch { /* ignore */ }
  });

  afterEach(() => {
    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('matches noncreature Equipment subtypes for "or another Equipment you control enters"', () => {
    const hammer = equipment('hammer', 'Hammer of Nazahn', HAMMER_TEXT, true);
    const saw = equipment('saw', 'Bone Saw', 'Equipped creature gets +1/+0.\nEquip {1}');
    const trigger = {
      triggerType: 'named_or_another_typed_etb',
      cardName: 'Hammer of Nazahn',
      requiredTypePhrase: 'Equipment',
      description: HAMMER_TEXT.split('\n')[0],
    } as any;
    expect(shouldQueueNamedOrAnotherTypedEtbTrigger(trigger, hammer, saw, p1)).toBe(true);
    expect(shouldQueueNamedOrAnotherTypedEtbTrigger(trigger, hammer, bear('b9'), p1)).toBe(false);
  });

  it('Hammer entering itself: target is required, then yes attaches the Hammer to the chosen creature', async () => {
    const game = setupGame();
    const hammer = equipment('hammer', 'Hammer of Nazahn', HAMMER_TEXT, true);
    game.state.battlefield.push(hammer);
    queueSelfETBTriggersForPermanent(game, hammer as any, p1);

    const top = game.state.stack[game.state.stack.length - 1];
    expect(top?.source).toBe('hammer');
    expect(top?.requiresTarget).toBe(true);
    expect(top?.needsTargetSelection).toBe(true);

    const seen = await resolveAndAnswer(game, 'yes');
    expect(seen).toContain('target_selection');
    expect(perm(game, 'hammer').attachedTo).toBe('b2');
    expect(perm(game, 'b2').attachedEquipment || []).toContain('hammer');
    expect(perm(game, 'b1').attachedEquipment || []).not.toContain('hammer');
  }, 60000);

  it('another Equipment entering while Hammer is out: yes attaches THAT Equipment, not the Hammer', async () => {
    const game = setupGame();
    const hammer = equipment('hammer', 'Hammer of Nazahn', HAMMER_TEXT, true);
    const saw = equipment('saw', 'Bone Saw', 'Equipped creature gets +1/+0.\nEquip {1}');
    game.state.battlefield.push(hammer, saw);
    triggerETBEffectsForPermanent(game, saw as any, p1);

    const top = game.state.stack[game.state.stack.length - 1];
    expect(top?.source).toBe('hammer');
    expect(top?.requiresTarget).toBe(true);

    const seen = await resolveAndAnswer(game, 'yes');
    expect(seen).toContain('target_selection');
    expect(perm(game, 'saw').attachedTo).toBe('b2');
    expect(perm(game, 'b2').attachedEquipment || []).toContain('saw');
    expect(perm(game, 'hammer').attachedTo).toBeFalsy();
  }, 60000);

  it('choosing no attaches nothing', async () => {
    const game = setupGame();
    const hammer = equipment('hammer', 'Hammer of Nazahn', HAMMER_TEXT, true);
    game.state.battlefield.push(hammer);
    queueSelfETBTriggersForPermanent(game, hammer as any, p1);

    await resolveAndAnswer(game, 'no');
    expect(perm(game, 'hammer').attachedTo).toBeFalsy();
    expect(perm(game, 'b1').attachedEquipment || []).toEqual([]);
    expect(perm(game, 'b2').attachedEquipment || []).toEqual([]);
    expect(game.state.stack.length).toBe(0);
  }, 60000);

  it('Sigarda\'s Aid style "you may attach it to target creature you control" attaches the entering Equipment', async () => {
    const game = setupGame();
    const aid = {
      id: 'aid', controller: p1, owner: p1, tapped: false, counters: {},
      card: { id: 'aid_card', name: "Sigarda's Aid", type_line: 'Enchantment', oracle_text: SIGARDAS_AID_TEXT },
    };
    const saw = equipment('saw', 'Bone Saw', 'Equipped creature gets +1/+0.\nEquip {1}');
    game.state.battlefield.push(aid, saw);
    triggerETBEffectsForPermanent(game, saw as any, p1);

    const top = game.state.stack[game.state.stack.length - 1];
    expect(top?.source).toBe('aid');

    const seen = await resolveAndAnswer(game, 'yes');
    expect(seen).toContain('target_selection');
    expect(perm(game, 'saw').attachedTo).toBe('b2');
    expect(perm(game, 'b2').attachedEquipment || []).toContain('saw');
    expect(perm(game, 'aid').attachedTo).toBeFalsy();
  }, 60000);
});