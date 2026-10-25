import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { applyEvent } from '../src/state/modules/applyEvent.js';
import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import GameManager from '../src/GameManager.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { untapPermanentsForPlayer } from '../src/state/modules/turn-handlers/turnUntapPermanents.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

const noopIo = () => ({ to: () => ({ emit: () => {} }), emit: () => {} }) as any;
function mockIo(sockets: any[]) { return { to: () => ({ emit: () => {} }), emit: () => {}, sockets: { sockets: new Map(sockets.map((s, i) => ['s_' + i, s])) } } as any; }
function mockSocket(playerId: string, gameId: string) {
  const handlers: Record<string, Function> = {};
  const socket = { data: { playerId, gameId, spectator: false }, rooms: new Set([gameId]), on: (ev: string, h: Function) => { handlers[ev] = h; }, emit: () => {} } as any;
  return { socket, handlers };
}
async function resetGame(gameId: string) { ResolutionQueueManager.removeQueue(gameId); GameManager.deleteGame(gameId); games.delete(gameId as any); await deleteGame(gameId); }

const WINTER_ORB = { id: 'wo', controller: 'p2', owner: 'p2', tapped: false, counters: {}, card: { name: 'Winter Orb', type_line: 'Artifact', oracle_text: "As long as Winter Orb is untapped, players can't untap more than one land during their untap steps." } };
const IMI = { id: 'imi', controller: 'p2', owner: 'p2', tapped: false, counters: {}, card: { name: 'Imi Statue', type_line: 'Artifact', oracle_text: "Players can't untap more than one artifact during their untap steps." } };
const land = (id: string, name: string) => ({ id, controller: 'p1', owner: 'p1', tapped: true, counters: {}, card: { name, type_line: 'Basic Land - ' + name, oracle_text: '({T}: Add {G}.)' } });

function setup(gameId: string, isAI: boolean, bf: any[]) {
  createGameIfNotExists(gameId, 'commander', 40);
  const game: any = ensureGame(gameId);
  const s: any = game.state;
  s.players = [{ id: 'p1', name: 'P1', life: 40, isAI }, { id: 'p2', name: 'P2', life: 40 }];
  s.turnPlayer = 'p1'; s.activePlayer = 'p1'; s.phase = 'beginning'; s.step = 'UNTAP'; s.stack = [];
  s.zones = { p1: { hand: [{ id: 'h1', name: 'Grizzly Bears', type_line: 'Creature - Bear' }], graveyard: [], exile: [] }, p2: { hand: [], graveyard: [], exile: [] } };
  s.battlefield = bf.map((x) => JSON.parse(JSON.stringify(x)));
  return game;
}

describe('untap-step cap choice (Winter Orb / Imi Statue)', () => {
  const gameId = 'test_untap_cap_choice';
  beforeAll(async () => { await initDb(); initializePriorityResolutionHandler(noopIo()); });
  afterEach(async () => { await resetGame(gameId); });

  it('human picks which land untaps under Winter Orb; untapCapChoiceResolve replays', async () => {
    await resetGame(gameId);
    const game = setup(gameId, false, [WINTER_ORB, land('f1', 'Forest'), land('f2', 'Island'), land('f3', 'Swamp'),
      { id: 'c1', controller: 'p1', owner: 'p1', tapped: true, counters: {}, card: { name: 'Bear', type_line: 'Creature - Bear', power: '2', toughness: '2' } }]);
    const s = game.state;
    untapPermanentsForPlayer({ state: s, gameId, bumpSeq: () => {} } as any, 'p1');
    const find = (id: string) => s.battlefield.find((p: any) => p.id === id);
    expect(find('c1').tapped).toBe(false); // uncapped kinds untap normally
    expect(['f1', 'f2', 'f3'].every((id) => find(id).tapped)).toBe(true);
    const step: any = ResolutionQueueManager.getQueue(gameId).steps.find((x: any) => x.untapCapChoice === true);
    expect(step).toBeDefined();
    expect(step.type).toBe('target_selection');
    expect(step.minTargets).toBe(1);
    expect(step.maxTargets).toBe(1);
    expect(step.validTargets.map((v: any) => v.id).sort()).toEqual(['f1', 'f2', 'f3']);
    const { socket, handlers } = mockSocket('p1', gameId);
    registerResolutionHandlers(mockIo([socket]), socket);
    await handlers['submitResolutionResponse']({ gameId, stepId: String(step.id), selections: ['f3'] });
    expect(find('f3').tapped).toBe(false);
    expect(find('f1').tapped).toBe(true);
    expect(find('f2').tapped).toBe(true);
    const ev = getEvents(gameId).filter((e: any) => e.type === 'untapCapChoiceResolve');
    expect(ev.length).toBe(1);
    const payload = (ev[0] as any).payload;
    expect(payload.untapped).toEqual(['f3']);
    find('f3').tapped = true;
    applyEvent({ state: s, bumpSeq: () => undefined } as any, { type: 'untapCapChoiceResolve', ...payload } as any);
    expect(find('f3').tapped).toBe(false);
  });

  it('AI under Imi Statue untaps the mana rock first when it has spells to cast', async () => {
    await resetGame(gameId);
    const game = setup(gameId, true, [IMI,
      { id: 'a1', controller: 'p1', owner: 'p1', tapped: true, counters: {}, card: { name: 'Icy Manipulator', type_line: 'Artifact', oracle_text: '{1}, {T}: You may tap or untap target artifact, creature, or land.' } },
      { id: 'a2', controller: 'p1', owner: 'p1', tapped: true, counters: {}, card: { name: 'Sol Ring', type_line: 'Artifact', oracle_text: '{T}: Add {C}{C}.' } }]);
    const s = game.state;
    untapPermanentsForPlayer({ state: s, gameId, bumpSeq: () => {} } as any, 'p1');
    const find = (id: string) => s.battlefield.find((p: any) => p.id === id);
    expect(find('a2').tapped).toBe(false);
    expect(find('a1').tapped).toBe(true);
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((x: any) => x.untapCapChoice === true)).toBe(false);
  });

  it('no prompt when the cap is not exceeded', async () => {
    await resetGame(gameId);
    const game = setup(gameId, false, [WINTER_ORB, land('f1', 'Forest')]);
    untapPermanentsForPlayer({ state: game.state, gameId, bumpSeq: () => {} } as any, 'p1');
    expect(game.state.battlefield.find((p: any) => p.id === 'f1').tapped).toBe(false);
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((x: any) => x.untapCapChoice === true)).toBe(false);
  });
});
