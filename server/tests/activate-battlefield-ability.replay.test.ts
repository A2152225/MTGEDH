import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

vi.mock('../src/db/index.js', () => ({
  appendEvent: vi.fn(),
}));

import { appendEvent } from '../src/db/index.js';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('activateBattlefieldAbility replay (Critical gap #3)', () => {
  beforeEach(() => {
    vi.mocked(appendEvent).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('rebuilds the ability stack item with the persisted stackItemId (usesStack path)', () => {
    const gameId = 't_activate_bf_stack_id';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).battlefield = [
      {
        id: 'bear_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'bear_card',
          name: 'Grizzly Bears',
          type_line: 'Creature - Bear',
          oracle_text: '{2}{G}: Put a +1/+1 counter on Grizzly Bears.',
        },
      },
    ];
    (game.state as any).stack = [];

    game.applyEvent({
      type: 'activateBattlefieldAbility',
      playerId: p1,
      permanentId: 'bear_1',
      abilityId: 'bear_1-ability-0',
      cardName: 'Grizzly Bears',
      abilityText: 'Put a +1/+1 counter on Grizzly Bears.',
      activatedAbilityText: '{2}{G}: Put a +1/+1 counter on Grizzly Bears.',
      usesStack: true,
      stackItemId: 'ability_stack_bear_1',
      abilityType: 'add_counter',
      targets: ['bear_1'],
      counterParams: {
        targetId: 'bear_1',
        targetName: 'Grizzly Bears',
        counterType: '+1/+1',
        targetControllerRule: 'you',
        oracleText: '{2}{G}: Put a +1/+1 counter on Grizzly Bears.',
      },
      tappedPermanents: [],
    } as any);

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.id || '')).toBe('ability_stack_bear_1');
    expect(String(stack[0]?.abilityType || '')).toBe('add_counter');
    expect(String(stack[0]?.source || '')).toBe('bear_1');
    expect(String(stack[0]?.controller || '')).toBe(p1);
    expect(stack[0]?.targets).toEqual(['bear_1']);
  });

  it('applies counterUpdates from the payload without emitting a nested updateCounters event', () => {
    const gameId = 't_activate_bf_counter_updates';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).battlefield = [
      {
        id: 'caldra_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'caldra_card',
          name: 'Calciform Pools',
          type_line: 'Land',
          oracle_text: '{1}, {T}: Put a storage counter on Calciform Pools.',
        },
      },
    ];

    vi.mocked(appendEvent).mockClear();

    game.applyEvent({
      type: 'activateBattlefieldAbility',
      playerId: p1,
      permanentId: 'caldra_1',
      abilityId: 'caldra_1-ability-0',
      cardName: 'Calciform Pools',
      usesStack: false,
      tappedPermanents: ['caldra_1'],
      paymentManaDelta: { colorless: -1 },
      counterUpdates: [{ permanentId: 'caldra_1', deltas: { storage: 1 } }],
    } as any);

    const perm = ((game.state as any).battlefield || []).find((p: any) => p.id === 'caldra_1');
    expect(perm?.tapped).toBe(true);
    expect(perm?.counters).toEqual({ storage: 1 });

    // Nested updateCounters must not append while applying the parent event
    // (replay/apply path uses skipEventPersistence; unit apply also must not double-log).
    const nestedCounterAppends = vi.mocked(appendEvent).mock.calls.filter(
      (call) => String(call[2] || '') === 'updateCounters',
    );
    expect(nestedCounterAppends).toHaveLength(0);
  });

  it('restores specialAnimation non-stack land animation from the rich payload', () => {
    const gameId = 't_activate_bf_special_animation';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).battlefield = [
      {
        id: 'mutavault_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'mutavault_card',
          name: 'Mutavault',
          type_line: 'Land',
          oracle_text: '{1}: Until end of turn, Mutavault becomes a 2/2 creature with all creature types.',
        },
      },
    ];

    game.applyEvent({
      type: 'activateBattlefieldAbility',
      playerId: p1,
      permanentId: 'mutavault_1',
      abilityId: 'mutavault_1-ability-0',
      cardName: 'Mutavault',
      usesStack: false,
      paymentManaDelta: { colorless: -1 },
      specialAnimation: {
        animatedUntilEOT: true,
        basePower: 2,
        baseToughness: 2,
        effectivePower: 2,
        effectiveToughness: 2,
        typeAdditions: ['Creature'],
        hasAllCreatureTypes: true,
        untilEndOfTurn: { removeAnimation: true, turn: 3 },
      },
    } as any);

    const perm = ((game.state as any).battlefield || []).find((p: any) => p.id === 'mutavault_1');
    expect(perm?.animatedUntilEOT).toBe(true);
    expect(perm?.basePower).toBe(2);
    expect(perm?.baseToughness).toBe(2);
    expect(perm?.typeAdditions).toEqual(['Creature']);
    expect(perm?.hasAllCreatureTypes).toBe(true);
    expect(perm?.untilEndOfTurn).toMatchObject({ removeAnimation: true, turn: 3 });
  });

  it('applies costs only for non-stack activations without inventing unknown effect bodies', () => {
    const gameId = 't_activate_bf_fail_closed_costs_only';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).life = { [p1]: 40 };
    (game.state as any).battlefield = [
      {
        id: 'odd_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: { charge: 2 },
        card: {
          id: 'odd_card',
          name: 'Odd Artifact',
          type_line: 'Artifact',
          oracle_text: '{T}, Pay 1 life: Do something unsupported.',
        },
      },
    ];
    (game.state as any).stack = [];

    game.applyEvent({
      type: 'activateBattlefieldAbility',
      playerId: p1,
      permanentId: 'odd_1',
      abilityId: 'odd_1-ability-0',
      cardName: 'Odd Artifact',
      abilityText: 'Do something unsupported.',
      activatedAbilityText: '{T}, Pay 1 life: Do something unsupported.',
      usesStack: false,
      tappedPermanents: ['odd_1'],
      lifePaidForCost: 1,
    } as any);

    const perm = ((game.state as any).battlefield || []).find((p: any) => p.id === 'odd_1');
    expect(perm?.tapped).toBe(true);
    expect((game.state as any).life[p1]).toBe(39);
    // Must not invent stack items or mutate counters for unknown non-stack effects.
    expect((game.state as any).stack || []).toHaveLength(0);
    expect(perm?.counters).toEqual({ charge: 2 });
  });

  it('replays queuedResolutionStep without duplicating an already-present step', () => {
    const gameId = 't_activate_bf_queued_step';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');
    ResolutionQueueManager.removeQueue(gameId);

    (game.state as any).battlefield = [
      {
        id: 'pools_1',
        controller: p1,
        owner: p1,
        tapped: true,
        counters: { storage: 3 },
        card: { id: 'pools_card', name: 'Calciform Pools', type_line: 'Land' },
      },
    ];

    const queuedStep = {
      id: 'mana_step_1',
      type: ResolutionStepType.MANA_COLOR_SELECTION,
      playerId: p1,
      description: 'Remove storage counters for mana',
      mandatory: true,
      permanentId: 'pools_1',
      selectionKind: 'distribution',
      totalAmount: 3,
      isStorageCounter: true,
      counterType: 'storage',
      removeCounterCount: 3,
    };

    game.applyEvent({
      type: 'activateBattlefieldAbility',
      playerId: p1,
      permanentId: 'pools_1',
      abilityId: 'pools_1-ability-1',
      cardName: 'Calciform Pools',
      usesStack: false,
      tappedPermanents: ['pools_1'],
      queuedResolutionStep: queuedStep,
    } as any);

    let queue = ResolutionQueueManager.getQueue(gameId) as any;
    const steps = [
      ...(queue?.activeStep ? [queue.activeStep] : []),
      ...(Array.isArray(queue?.steps) ? queue.steps : []),
    ];
    expect(steps.some((s: any) => String(s?.id || '') === 'mana_step_1')).toBe(true);

    // Re-apply same event: must not duplicate the queued step.
    game.applyEvent({
      type: 'activateBattlefieldAbility',
      playerId: p1,
      permanentId: 'pools_1',
      abilityId: 'pools_1-ability-1',
      cardName: 'Calciform Pools',
      usesStack: false,
      tappedPermanents: ['pools_1'],
      queuedResolutionStep: queuedStep,
    } as any);

    queue = ResolutionQueueManager.getQueue(gameId) as any;
    const stepsAfter = [
      ...(queue?.activeStep ? [queue.activeStep] : []),
      ...(Array.isArray(queue?.steps) ? queue.steps : []),
    ].filter((s: any) => String(s?.id || '') === 'mana_step_1');
    expect(stepsAfter).toHaveLength(1);
  });
});
