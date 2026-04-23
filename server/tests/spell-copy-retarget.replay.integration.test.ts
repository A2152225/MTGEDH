import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import { createInitialGameState } from '../src/state/index.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({
      emit: (_event: string, _payload: any) => {
        // no-op
      },
    }),
    emit: (_event: string, _payload: any) => {
      // no-op
    },
    sockets: {
      sockets: new Map(),
    },
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: {
      sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])),
    },
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false },
    rooms: new Set<string>(),
    on: (event: string, handler: Function) => {
      handlers[event] = handler;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;

  return { socket, handlers };
}

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function toReplayEvents(gameId: string, startIndex = 0) {
  return getEvents(gameId)
    .slice(startIndex)
    .map((event: any) =>
      event?.payload && typeof event.payload === 'object'
        ? { type: event.type, ...(event.payload as Record<string, unknown>) }
        : { type: event.type },
    );
}

function seedSpellCopyRetargetBoard(game: any, playerId: string, opponentId: string, alternateTargetId: string) {
  (game.state as any).players = [
    { id: playerId, name: 'P1', spectator: false, life: 40 },
    { id: opponentId, name: 'P2', spectator: false, life: 40 },
    { id: alternateTargetId, name: 'P3', spectator: false, life: 40 },
  ];
  (game.state as any).startingLife = 40;
  (game.state as any).life = { [playerId]: 40, [opponentId]: 40, [alternateTargetId]: 40 };
  (game.state as any).turnPlayer = playerId;
  (game.state as any).priority = playerId;
  (game.state as any).stack = [
    {
      id: 'spell_original_1',
      type: 'spell',
      controller: playerId,
      owner: playerId,
      sourceName: 'Lightning Bolt',
      card: {
        id: 'lightning_bolt_card',
        name: 'Lightning Bolt',
        oracle_text: 'Lightning Bolt deals 3 damage to any target.',
        type_line: 'Instant',
      },
      targets: [opponentId],
    },
    {
      id: 'spell_copy_1',
      type: 'spell',
      controller: playerId,
      owner: playerId,
      sourceName: 'Lightning Bolt',
      card: {
        id: 'lightning_bolt_card',
        name: 'Lightning Bolt',
        oracle_text: 'Lightning Bolt deals 3 damage to any target.',
        type_line: 'Instant',
      },
      copiedFromStackItemId: 'spell_original_1',
      targets: [opponentId],
    },
  ];
}

describe('spell-copy retarget replay integration', () => {
  const gameId = 'test_spell_copy_retarget_replay_integration';
  const playerId = 'p1';
  const opponentId = 'p2';
  const alternateTargetId = 'p3';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
    await resetGame(`${gameId}_replay`);
  });

  it('persists and replays copied-spell retarget target selection cleanup', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    seedSpellCopyRetargetBoard(game, playerId, opponentId, alternateTargetId);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const eventStart = getEvents(gameId).length;

    const optionStep = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId,
      description: 'You may choose new targets for the copy.',
      mandatory: true,
      sourceId: 'spell_copy_1',
      sourceName: 'Fork',
      options: [
        { id: 'keep', label: 'Keep current targets' },
        { id: 'retarget', label: 'Choose new targets' },
      ],
      minSelections: 1,
      maxSelections: 1,
      retargetSpellCopy: true,
      retargetSpellCopyStackItemId: 'spell_copy_1',
      retargetSpellCopyValidTargets: [
        { id: opponentId, label: 'P2' },
        { id: alternateTargetId, label: 'P3' },
      ],
      retargetSpellCopyMinTargets: 1,
      retargetSpellCopyMaxTargets: 1,
      retargetSpellCopyTargetDescription: 'target player',
    } as any);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((optionStep as any).id),
      selections: ['retarget'],
      cancelled: false,
    });

    const retargetTargetStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps.find((step: any) => (step as any).retargetSpellCopyTargetSelection === true);
    expect(retargetTargetStep).toBeDefined();
    expect((retargetTargetStep as any)?.sourceId).toBe('spell_copy_1');

    const promptEvent = [...getEvents(gameId)].reverse().find((event: any) => {
      if (String(event?.type || '') !== 'resolveTopOfStackPrompt') return false;
      return (event as any)?.payload?.queuedResolutionStep?.retargetSpellCopyTargetSelection === true;
    }) as any;
    expect(promptEvent).toBeDefined();
    expect(promptEvent?.payload?.queuedResolutionStep?.retargetSpellCopyStackItemId).toBe('spell_copy_1');

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((retargetTargetStep as any).id),
      selections: [alternateTargetId],
      cancelled: false,
    });

    const copiedSpell = ((game.state as any).stack || []).find((item: any) => item?.id === 'spell_copy_1');
    expect(copiedSpell?.targets).toEqual([alternateTargetId]);
    expect(ResolutionQueueManager.getQueue(gameId).steps).toEqual([]);

    const replayEvents = toReplayEvents(gameId, eventStart);
    expect(replayEvents.map((event: any) => event.type)).toEqual(
      expect.arrayContaining(['copyRetargetChoiceResolve', 'resolveTopOfStackPrompt', 'retargetSpellCopyResolve']),
    );

    const resolveEvent = replayEvents.find((event: any) => event.type === 'retargetSpellCopyResolve');
    expect(resolveEvent?.stackItemId).toBe('spell_copy_1');
    expect(resolveEvent?.targets).toEqual([alternateTargetId]);

    const replayGameId = `${gameId}_replay`;
    const replayGame = createInitialGameState(replayGameId);
    seedSpellCopyRetargetBoard(replayGame, playerId, opponentId, alternateTargetId);

    if (typeof replayGame.replay !== 'function') {
      throw new Error('replayGame.replay is not available');
    }

    replayGame.replay(replayEvents as any);

    const replayCopiedSpell = ((replayGame.state as any).stack || []).find((item: any) => item?.id === 'spell_copy_1');
    const replayOriginalSpell = ((replayGame.state as any).stack || []).find((item: any) => item?.id === 'spell_original_1');
    expect(replayOriginalSpell?.targets).toEqual([opponentId]);
    expect(replayCopiedSpell?.targets).toEqual([alternateTargetId]);
    expect(ResolutionQueueManager.getQueue(replayGameId).steps).toEqual([]);
  });
});