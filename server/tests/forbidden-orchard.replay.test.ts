import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('Forbidden Orchard replay semantics', () => {
  it('replays the unresolved Orchard opponent-choice prompt from activateManaAbility', () => {
    const gameId = 't_forbidden_orchard_prompt_replay';
    ResolutionQueueManager.removeQueue(gameId);
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');

    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      [p2]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'orchard_perm',
        controller: p1,
        owner: p1,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'forbidden_orchard_card',
          name: 'Forbidden Orchard',
          type_line: 'Land',
          oracle_text: '{T}: Add one mana of any color. Whenever you tap Forbidden Orchard for mana, target opponent creates a 1/1 colorless Spirit creature token.',
        },
      },
    ];

    game.applyEvent({
      type: 'activateManaAbility',
      playerId: p1,
      permanentId: 'orchard_perm',
      abilityId: 'forbidden-orchard-mana',
      manaColor: 'green',
      addedMana: { green: 1 },
      queuedResolutionStep: {
        id: 'queued_orchard_target_1',
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: p1,
        sourceId: 'orchard_perm',
        sourceName: 'Forbidden Orchard',
        description: 'Choose target opponent to create a 1/1 colorless Spirit creature token.',
        mandatory: true,
        options: [
          { id: p2, label: 'P2' },
        ],
        minSelections: 1,
        maxSelections: 1,
        forbiddenOrchardTargetChoice: true,
        permanentId: 'orchard_perm',
        cardName: 'Forbidden Orchard',
      },
    } as any);

    expect((game.state as any).manaPool[p1].green).toBe(1);
    expect((game.state as any).battlefield[0]?.tapped).toBe(true);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect(String(queue.steps[0]?.id || '')).toBe('queued_orchard_target_1');
    expect(queue.steps[0]?.type).toBe(ResolutionStepType.OPTION_CHOICE);
    expect((queue.steps[0] as any)?.forbiddenOrchardTargetChoice).toBe(true);
    expect((queue.steps[0] as any)?.options).toEqual([{ id: p2, label: 'P2' }]);
    expect((game.state as any).battlefield).toHaveLength(1);
  });

  it('replays the chosen opponent Spirit token creation', () => {
    const game = createInitialGameState('t_forbidden_orchard_replay');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');

    game.applyEvent({
      type: 'confirmForbiddenOrchardTarget',
      playerId: p1,
      permanentId: 'orchard_perm',
      targetOpponentId: p2,
    } as any);

    const battlefield = (game.state as any).battlefield;
    expect(battlefield).toHaveLength(1);

    const token = battlefield[0];
    expect(token.controller).toBe(p2);
    expect(token.owner).toBe(p2);
    expect(token.tapped).toBe(false);
    expect(token.summoningSickness).toBe(true);
    expect(token.isToken).toBe(true);
    expect(token.basePower).toBe(1);
    expect(token.baseToughness).toBe(1);
    expect(token.card.name).toBe('Spirit');
    expect(token.card.type_line).toBe('Token Creature — Spirit');
    expect(token.card.id).toBe(token.id);
  });

  it('replays the Spirit ETB bookkeeping and downstream ETB trigger generation', () => {
    const game = createInitialGameState('t_forbidden_orchard_replay_etb');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');

    (game.state as any).battlefield = [
      {
        id: 'soul_warden_1',
        controller: p1,
        owner: p1,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'soul_warden_card',
          name: 'Soul Warden',
          type_line: 'Creature — Human Cleric',
          oracle_text: 'Whenever another creature enters the battlefield, you gain 1 life.',
        },
      },
    ];

    game.applyEvent({
      type: 'confirmForbiddenOrchardTarget',
      playerId: p1,
      permanentId: 'orchard_perm',
      targetOpponentId: p2,
    } as any);

    expect((game.state as any).creaturesEnteredBattlefieldThisTurnByController).toEqual({ [p2]: 1 });
    expect((game.state as any).creaturesEnteredBattlefieldThisTurnIdsByController?.[p2]).toBeTruthy();

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(stack[0]?.type).toBe('triggered_ability');
    expect(stack[0]?.source).toBe('soul_warden_1');
    expect(stack[0]?.sourceName).toBe('Soul Warden');
  });
});