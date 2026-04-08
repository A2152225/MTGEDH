import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('queued battlefield prompt replay semantics', () => {
  it('replays queued fight-target battlefield activations before target selection resolves', () => {
    const gameId = 't_activate_fight_prompt_replay';
    ResolutionQueueManager.removeQueue(gameId);
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
    };
    (game.state as any).battlefield = [
      {
        id: 'fighter_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'fighter_card_1',
          name: 'Arena Prototype',
          type_line: 'Creature — Construct',
          oracle_text: '{1}, {T}: This creature fights target creature you don\'t control.',
          zone: 'battlefield',
        },
      },
    ];

    game.applyEvent({
      type: 'activateBattlefieldAbility',
      playerId: p1,
      permanentId: 'fighter_1',
      abilityId: 'fighter_1-ability-0',
      cardName: 'Arena Prototype',
      activatedAbilityText: '{1}, {T}: This creature fights target creature you don\'t control.',
      tappedPermanents: ['fighter_1'],
      paymentManaDelta: { colorless: -1 },
      queuedResolutionStep: {
        id: 'queued_fight_1',
        type: ResolutionStepType.FIGHT_TARGET,
        playerId: p1,
        sourceId: 'fighter_1',
        sourceName: 'Arena Prototype',
        description: '{1}, {T}: This creature fights target creature you don\'t control.',
        mandatory: true,
        targetFilter: {
          types: ['creature'],
          controller: 'opponent',
          excludeSource: true,
        },
        title: 'Arena Prototype - Fight',
      },
    } as any);

    expect((game.state as any).manaPool[p1]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });
    const permanent = (game.state as any).battlefield.find((entry: any) => entry.id === 'fighter_1');
    expect(Boolean(permanent?.tapped)).toBe(true);
    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect(String(queue.steps[0]?.id || '')).toBe('queued_fight_1');
    expect(queue.steps[0]?.type).toBe(ResolutionStepType.FIGHT_TARGET);
    expect((queue.steps[0] as any)?.targetFilter).toEqual({
      types: ['creature'],
      controller: 'opponent',
      excludeSource: true,
    });
    expect((game.state as any).stack || []).toHaveLength(0);
  });

  it('replays queued tap-untap battlefield activations before target selection resolves', () => {
    const gameId = 't_activate_tap_untap_prompt_replay';
    ResolutionQueueManager.removeQueue(gameId);
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
    };
    (game.state as any).battlefield = [
      {
        id: 'tapper_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'tapper_card_1',
          name: 'Tinker Relay',
          type_line: 'Artifact Creature',
          oracle_text: '{1}, {T}: Tap target artifact.',
          zone: 'battlefield',
        },
      },
    ];

    game.applyEvent({
      type: 'activateBattlefieldAbility',
      playerId: p1,
      permanentId: 'tapper_1',
      abilityId: 'tapper_1-ability-0',
      cardName: 'Tinker Relay',
      activatedAbilityText: '{1}, {T}: Tap target artifact.',
      tappedPermanents: ['tapper_1'],
      paymentManaDelta: { colorless: -1 },
      queuedResolutionStep: {
        id: 'queued_tap_1',
        type: ResolutionStepType.TAP_UNTAP_TARGET,
        playerId: p1,
        sourceId: 'tapper_1',
        sourceName: 'Tinker Relay',
        description: '{1}, {T}: Tap target artifact.',
        mandatory: true,
        action: 'tap',
        targetFilter: {
          types: ['artifact'],
          controller: 'any',
          tapStatus: 'any',
          excludeSource: false,
        },
        targetCount: 1,
        title: 'Tinker Relay',
      },
    } as any);

    expect((game.state as any).manaPool[p1]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });
    const permanent = (game.state as any).battlefield.find((entry: any) => entry.id === 'tapper_1');
    expect(Boolean(permanent?.tapped)).toBe(true);
    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect(String(queue.steps[0]?.id || '')).toBe('queued_tap_1');
    expect(queue.steps[0]?.type).toBe(ResolutionStepType.TAP_UNTAP_TARGET);
    expect((queue.steps[0] as any)?.action).toBe('tap');
    expect((queue.steps[0] as any)?.targetFilter).toEqual({
      types: ['artifact'],
      controller: 'any',
      tapStatus: 'any',
      excludeSource: false,
    });
    expect((queue.steps[0] as any)?.targetCount).toBe(1);
    expect((game.state as any).stack || []).toHaveLength(0);
  });
});