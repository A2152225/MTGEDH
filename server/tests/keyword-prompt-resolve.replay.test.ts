import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

const KEYWORD_PROMPT_STEP_TYPES = [
  ResolutionStepType.RIOT_CHOICE,
  ResolutionStepType.UNLEASH_CHOICE,
  ResolutionStepType.FABRICATE_CHOICE,
  ResolutionStepType.TRIBUTE_CHOICE,
  ResolutionStepType.MENTOR_TARGET,
  ResolutionStepType.EXPLOIT_CHOICE,
  ResolutionStepType.EXTORT_PAYMENT,
  ResolutionStepType.MODULAR_CHOICE,
  ResolutionStepType.SOULSHIFT_TARGET,
  ResolutionStepType.DEVOUR_SELECTION,
];

function addActiveStep(gameId: string, type: ResolutionStepType, extra: Record<string, any> = {}) {
  const step = ResolutionQueueManager.addStep(gameId, {
    type,
    playerId: 'p1' as any,
    description: 'Resolve keyword prompt.',
    mandatory: true,
    sourceId: 'perm_source',
    permanentId: 'perm_source',
    ...extra,
  } as any);
  ResolutionQueueManager.activateStep(gameId, step.id);
  return step;
}

function expectStepCleared(gameId: string, type: ResolutionStepType) {
  const queue = ResolutionQueueManager.getQueue(gameId) as any;
  expect(queue.activeStep?.type).not.toBe(type);
  expect((queue.steps || []).some((entry: any) => entry?.type === type)).toBe(false);
}

describe('keywordPromptResolve replay semantics', () => {
  it.each(KEYWORD_PROMPT_STEP_TYPES)('clears a replay-restored %s step by resolved step id', (stepType) => {
    const gameId = `t_keyword_prompt_resolve_${String(stepType)}`;
    ResolutionQueueManager.removeQueue(gameId);
    const game = createInitialGameState(gameId);
    const step = addActiveStep(gameId, stepType, stepType === ResolutionStepType.DEVOUR_SELECTION ? { creatureId: 'perm_source' } : {});

    game.applyEvent({
      type: 'keywordPromptResolve',
      playerId: 'p1',
      resolvedStepId: step.id,
      stepType,
      sourceId: 'perm_source',
      permanentId: 'perm_source',
    } as any);

    expectStepCleared(gameId, stepType);
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('clears a replay-restored keyword step by semantic fallback when resolvedStepId is absent', () => {
    const gameId = 't_keyword_prompt_resolve_fallback';
    ResolutionQueueManager.removeQueue(gameId);
    const game = createInitialGameState(gameId);
    addActiveStep(gameId, ResolutionStepType.RIOT_CHOICE);

    game.applyEvent({
      type: 'keywordPromptResolve',
      playerId: 'p1',
      stepType: ResolutionStepType.RIOT_CHOICE,
      sourceId: 'perm_source',
      permanentId: 'perm_source',
    } as any);

    expectStepCleared(gameId, ResolutionStepType.RIOT_CHOICE);
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('replays riot haste by restoring grantedAbilities and clearing summoning sickness', () => {
    const gameId = 't_keyword_prompt_resolve_riot_haste';
    ResolutionQueueManager.removeQueue(gameId);
    const game = createInitialGameState(gameId);
    (game.state as any).battlefield = [{
      id: 'riot_perm',
      controller: 'p1',
      summoningSickness: true,
      counters: {},
      card: { name: 'Riot Creature', type_line: 'Creature' },
    }];
    addActiveStep(gameId, ResolutionStepType.RIOT_CHOICE, { permanentId: 'riot_perm', sourceId: 'riot_perm' });

    game.applyEvent({
      type: 'keywordPromptResolve',
      playerId: 'p1',
      stepType: ResolutionStepType.RIOT_CHOICE,
      sourceId: 'riot_perm',
      permanentId: 'riot_perm',
      keyword: 'riot',
      choiceId: 'haste',
    } as any);

    const permanent = (game.state as any).battlefield.find((entry: any) => entry?.id === 'riot_perm');
    expect(permanent?.grantedAbilities).toContain('Haste');
    expect(permanent?.summoningSickness).toBe(false);
    expectStepCleared(gameId, ResolutionStepType.RIOT_CHOICE);
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('replays extort payment by restoring life totals', () => {
    const gameId = 't_keyword_prompt_resolve_extort_life';
    ResolutionQueueManager.removeQueue(gameId);
    const game = createInitialGameState(gameId);
    (game.state as any).players = [
      { id: 'p1', name: 'P1', spectator: false, life: 40 },
      { id: 'p2', name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).life = { p1: 40, p2: 40 };
    (game.state as any).manaPool = {
      p1: { white: 1, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    addActiveStep(gameId, ResolutionStepType.EXTORT_PAYMENT);

    game.applyEvent({
      type: 'keywordPromptResolve',
      playerId: 'p1',
      stepType: ResolutionStepType.EXTORT_PAYMENT,
      sourceId: 'perm_source',
      permanentId: 'perm_source',
      keyword: 'extort',
      choiceId: 'pay',
      manaCost: '{W}',
      paymentManaDelta: { white: -1 },
    } as any);

    expect((game.state as any).life).toEqual({ p1: 41, p2: 39 });
    expect((game.state as any).manaPool.p1.white).toBe(0);
    expectStepCleared(gameId, ResolutionStepType.EXTORT_PAYMENT);
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('replays exploit sacrifice and re-queues reward triggers onto the stack', () => {
    const gameId = 't_keyword_prompt_resolve_exploit_trigger';
    ResolutionQueueManager.removeQueue(gameId);
    const game = createInitialGameState(gameId);
    (game.state as any).players = [{ id: 'p1', name: 'P1', spectator: false, life: 40 }];
    (game.state as any).battlefield = [{
      id: 'exploit_source',
      controller: 'p1',
      owner: 'p1',
      counters: {},
      card: {
        name: 'Exploit Test Creature',
        type_line: 'Creature — Zombie',
        oracle_text: 'Exploit\nWhen this creature exploits a creature, you draw two cards and you lose 2 life.',
      },
    }];
    (game.state as any).zones = {
      p1: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, library: [], libraryCount: 0 },
    };
    addActiveStep(gameId, ResolutionStepType.EXPLOIT_CHOICE, {
      permanentId: 'exploit_source',
      sourceId: 'exploit_source',
      sourceName: 'Exploit Test Creature',
    });

    game.applyEvent({
      type: 'keywordPromptResolve',
      playerId: 'p1',
      stepType: ResolutionStepType.EXPLOIT_CHOICE,
      sourceId: 'exploit_source',
      permanentId: 'exploit_source',
      sourceName: 'Exploit Test Creature',
      keyword: 'exploit',
      selectedPermanentId: 'exploit_source',
      sourcePermanentSnapshot: {
        id: 'exploit_source',
        card: {
          name: 'Exploit Test Creature',
          oracle_text: 'Exploit\nWhen this creature exploits a creature, you draw two cards and you lose 2 life.',
        },
      },
      exploitedPermanentSnapshot: {
        id: 'exploit_source',
        card: { name: 'Exploit Test Creature' },
      },
    } as any);

    expect(((game.state as any).battlefield || []).map((entry: any) => entry.id)).not.toContain('exploit_source');
    expect(((game.state as any).stack || []).some((entry: any) => entry?.triggerType === 'exploit')).toBe(true);
    expectStepCleared(gameId, ResolutionStepType.EXPLOIT_CHOICE);
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('replays fabricate tokens by creating servo tokens on the battlefield', () => {
    const gameId = 't_keyword_prompt_resolve_fabricate_tokens';
    ResolutionQueueManager.removeQueue(gameId);
    const game = createInitialGameState(gameId);
    (game.state as any).players = [{ id: 'p1', name: 'P1', spectator: false, life: 40 }];
    (game.state as any).battlefield = [{
      id: 'fabricate_perm',
      controller: 'p1',
      owner: 'p1',
      counters: {},
      card: { name: 'Fabricate Creature', type_line: 'Artifact Creature' },
    }];
    addActiveStep(gameId, ResolutionStepType.FABRICATE_CHOICE, {
      permanentId: 'fabricate_perm',
      sourceId: 'fabricate_perm',
    });

    game.applyEvent({
      type: 'keywordPromptResolve',
      playerId: 'p1',
      stepType: ResolutionStepType.FABRICATE_CHOICE,
      sourceId: 'fabricate_perm',
      permanentId: 'fabricate_perm',
      keyword: 'fabricate',
      choiceId: 'tokens',
      amount: 2,
    } as any);

    const servos = (game.state as any).battlefield.filter(
      (entry: any) => String(entry?.card?.name || '') === 'Servo' && entry?.controller === 'p1',
    );
    expect(servos).toHaveLength(2);
    expectStepCleared(gameId, ResolutionStepType.FABRICATE_CHOICE);
    ResolutionQueueManager.removeQueue(gameId);
  });
});