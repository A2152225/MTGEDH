import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

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
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: {
      sockets: new Map(sockets.map((s, idx) => [`s_${idx}`, s])),
    },
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false },
    rooms: new Set<string>(),
    on: (ev: string, fn: Function) => {
      handlers[ev] = fn;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

describe('Summon the School graveyard recursion (integration)', () => {
  const gameId = 'test_summon_the_school_graveyard_recursion';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('queues the tap-four-Merfolk cost and returns Summon the School to hand when paid', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;
    (game.state as any).stack = [];
    (game.state as any).battlefield = [
      {
        id: 'judge_of_currents',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          id: 'judge_of_currents_card',
          name: 'Judge of Currents',
          type_line: 'Creature - Merfolk Wizard',
          oracle_text: 'Whenever a Merfolk you control becomes tapped, you may gain 1 life.',
        },
      },
      {
        id: 'merfolk_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          id: 'merfolk_card_1',
          name: 'Silvergill Adept',
          type_line: 'Creature - Merfolk Wizard',
          oracle_text: '',
        },
      },
      {
        id: 'merfolk_2',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          id: 'merfolk_card_2',
          name: 'Merfolk Trickster',
          type_line: 'Creature - Merfolk Wizard',
          oracle_text: '',
        },
      },
      {
        id: 'merfolk_3',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          id: 'merfolk_card_3',
          name: 'Vodalian Hexcatcher',
          type_line: 'Creature - Merfolk Wizard',
          oracle_text: '',
        },
      },
      {
        id: 'merfolk_4',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          id: 'merfolk_card_4',
          name: 'Lord of Atlantis',
          type_line: 'Creature - Merfolk',
          oracle_text: '',
        },
      },
    ];
    (game.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        graveyard: [
          {
            id: 'summon_1',
            name: 'Summon the School',
            mana_cost: '{3}{U}',
            type_line: 'Tribal Sorcery - Merfolk',
            oracle_text:
              'Create two 1/1 blue Merfolk Wizard creature tokens. Tap four untapped Merfolk you control: Return this card from your graveyard to your hand.',
            zone: 'graveyard',
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId,
      cardId: 'summon_1',
      abilityId: 'return-from-graveyard',
    });

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);

    const step = queue.steps[0] as any;
    expect(step.type).toBe('target_selection');
    expect(step.tapCreaturesCost).toBe(true);
    expect(step.requiredCount).toBe(4);
    expect(step.creatureType).toBe('merfolk');
    expect(step.cardId).toBe('summon_1');
    expect(step.validTargets.map((target: any) => target.id).sort()).toEqual([
      'judge_of_currents',
      'merfolk_1',
      'merfolk_2',
      'merfolk_3',
      'merfolk_4',
    ]);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: step.id,
      selections: ['merfolk_1', 'merfolk_2', 'merfolk_3', 'merfolk_4'],
    });

    const queueAfter = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfter.steps).toHaveLength(4);
    expect(queueAfter.steps.every((queuedStep: any) => queuedStep.type === 'option_choice')).toBe(true);
    expect(queueAfter.steps.every((queuedStep: any) => queuedStep.sourceName === 'Judge of Currents')).toBe(true);
    expect(queueAfter.steps.every((queuedStep: any) => queuedStep.mayAbilityPrompt === true)).toBe(true);

    const zones = (game.state as any).zones[p1];
    expect(zones.graveyardCount).toBe(0);
    expect(zones.handCount).toBe(1);
    expect(zones.hand.map((card: any) => card.id)).toContain('summon_1');

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield.filter((perm: any) => perm.tapped).map((perm: any) => perm.id).sort()).toEqual([
      'merfolk_1',
      'merfolk_2',
      'merfolk_3',
      'merfolk_4',
    ]);
  });
});