import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

function addActiveOptionStep(gameId: string, playerId: PlayerID, extra: Record<string, any>) {
  const step = ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId,
    description: 'Choose an option.',
    mandatory: true,
    sourceName: 'Source',
    options: [
      { id: 'yes', label: 'Yes' },
      { id: 'no', label: 'No' },
    ],
    minSelections: 1,
    maxSelections: 1,
    ...extra,
  } as any);
  ResolutionQueueManager.activateStep(gameId, step.id);
  return step;
}

describe('prompt response replay sweep', () => {
  it('replays mutateCastModeChoiceResolve by clearing the cast-mode prompt', () => {
    const gameId = 't_mutate_cast_mode_choice_resolve_replay';
    ResolutionQueueManager.removeQueue(gameId);
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    const step = addActiveOptionStep(gameId, p1, {
      mutateCastModeChoice: true,
      mutateCardId: 'mutate_1',
      sourceId: 'mutate_1',
    });

    game.applyEvent({
      type: 'mutateCastModeChoiceResolve',
      playerId: p1,
      sourceId: 'mutate_1',
      mutateCardId: 'mutate_1',
      resolvedStepId: step.id,
      choiceId: 'cast_mutate',
      castMode: 'mutate',
      accepted: true,
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId) as any;
    expect(queue.activeStep?.mutateCastModeChoice).not.toBe(true);
    expect((queue.steps || []).some((entry: any) => entry?.mutateCastModeChoice === true)).toBe(false);
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('replays mirrormindCrownTokenReplacementChoiceResolve with persisted token snapshots', () => {
    const gameId = 't_mirrormind_crown_choice_resolve_replay';
    ResolutionQueueManager.removeQueue(gameId);
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).battlefield = [
      {
        id: 'replay_normal_1',
        controller: p1,
        owner: p1,
        isToken: true,
        tapped: false,
        counters: {},
        basePower: 1,
        baseToughness: 1,
        card: { id: 'normal_card_1', name: 'Soldier', type_line: 'Token Creature - Soldier', zone: 'battlefield' },
      },
      {
        id: 'replay_normal_2',
        controller: p1,
        owner: p1,
        isToken: true,
        tapped: false,
        counters: {},
        basePower: 1,
        baseToughness: 1,
        card: { id: 'normal_card_2', name: 'Soldier', type_line: 'Token Creature - Soldier', zone: 'battlefield' },
      },
    ];

    const step = addActiveOptionStep(gameId, p1, {
      mirrormindCrownTokenReplacementChoice: true,
      mirrormindCrownEquipmentId: 'crown_1',
      sourceId: 'crown_1',
    });

    const copyTokens = [
      {
        id: 'copytok_1',
        controller: p1,
        owner: p1,
        isToken: true,
        tapped: false,
        counters: {},
        basePower: 2,
        baseToughness: 2,
        card: { id: 'copy_card_1', name: 'Mutation Host', type_line: 'Creature - Beast', zone: 'battlefield' },
      },
      {
        id: 'copytok_2',
        controller: p1,
        owner: p1,
        isToken: true,
        tapped: false,
        counters: {},
        basePower: 2,
        baseToughness: 2,
        card: { id: 'copy_card_2', name: 'Mutation Host', type_line: 'Creature - Beast', zone: 'battlefield' },
      },
    ];

    game.applyEvent({
      type: 'mirrormindCrownTokenReplacementChoiceResolve',
      playerId: p1,
      sourceId: 'crown_1',
      resolvedStepId: step.id,
      choiceId: 'replace',
      replaced: true,
      mirrormindCrownEquipmentId: 'crown_1',
      mirrormindCrownOriginalTokenCreate: {
        controller: p1,
        name: 'Soldier',
        count: 2,
        basePower: 1,
        baseToughness: 1,
        options: { typeLine: 'Token Creature - Soldier' },
      },
      createdTokenIds: ['copytok_1', 'copytok_2'],
      createdTokenPermanents: copyTokens,
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId) as any;
    expect(queue.activeStep?.mirrormindCrownTokenReplacementChoice).not.toBe(true);
    expect((queue.steps || []).some((entry: any) => entry?.mirrormindCrownTokenReplacementChoice === true)).toBe(false);
    const battlefield = (game.state as any).battlefield as any[];
    expect(battlefield.some((permanent: any) => permanent.id === 'replay_normal_1')).toBe(false);
    expect(battlefield.some((permanent: any) => permanent.id === 'replay_normal_2')).toBe(false);
    expect(battlefield.map((permanent: any) => permanent.id)).toEqual(['copytok_1', 'copytok_2']);
    expect((game.state as any).mirrormindCrownUsedThisTurn.crown_1).toBe(true);
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('replays commanderZoneChoice stay decisions by moving the commander to the destination zone', () => {
    const gameId = 't_commander_zone_choice_replay';
    ResolutionQueueManager.removeQueue(gameId);
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).commandZone = {
      [p1]: { commanderIds: ['cmd_1'], inCommandZone: ['cmd_1'] },
    };
    const zones = (game.state as any).zones[p1];
    zones.commandZone = [{ id: 'cmd_1', name: 'Test Commander', type_line: 'Legendary Creature', zone: 'command' }];
    zones.commandZoneCount = 1;

    const step = addActiveOptionStep(gameId, p1, {
      commanderZoneChoice: true,
      commanderId: 'cmd_1',
      card: { id: 'cmd_1', name: 'Test Commander', type_line: 'Legendary Creature' },
    });

    game.applyEvent({
      type: 'commanderZoneChoice',
      playerId: p1,
      commanderId: 'cmd_1',
      commanderName: 'Test Commander',
      moveToCommandZone: false,
      destinationZone: 'graveyard',
      resolvedStepId: step.id,
      card: { id: 'cmd_1', name: 'Test Commander', type_line: 'Legendary Creature' },
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId) as any;
    expect(queue.activeStep?.commanderZoneChoice).not.toBe(true);
    expect((queue.steps || []).some((entry: any) => entry?.commanderZoneChoice === true)).toBe(false);
    expect((zones.commandZone || []).some((card: any) => card.id === 'cmd_1')).toBe(false);
    expect((zones.graveyard || []).some((card: any) => card.id === 'cmd_1')).toBe(true);
    expect((game.state as any).commandZone[p1].inCommandZone).toEqual([]);
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('replays mayAbilityResolve by clearing the resolved may prompt', () => {
    const gameId = 't_may_ability_resolve_replay';
    ResolutionQueueManager.removeQueue(gameId);
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    const step = addActiveOptionStep(gameId, p1, {
      mandatory: false,
      mayAbilityPrompt: true,
      effectKey: 'source:draw a card',
      effectText: 'draw a card',
    });

    game.applyEvent({
      type: 'mayAbilityResolve',
      playerId: p1,
      resolvedStepId: step.id,
      choice: 'no',
      accepted: false,
      effectKey: 'source:draw a card',
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId) as any;
    expect(queue.activeStep?.mayAbilityPrompt).not.toBe(true);
    expect((queue.steps || []).some((entry: any) => entry?.mayAbilityPrompt === true)).toBe(false);
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('replays paid declareAttackers events by clearing attackCostPayment prompts', () => {
    const gameId = 't_attack_cost_payment_prompt_clear_replay';
    ResolutionQueueManager.removeQueue(gameId);
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');

    (game.state as any).battlefield = [
      {
        id: 'attacker_1',
        controller: p1,
        owner: p1,
        tapped: false,
        summoningSickness: false,
        card: { name: 'Silvercoat Lion', type_line: 'Creature - Cat', oracle_text: '', power: '2', toughness: '2' },
      },
    ];

    addActiveOptionStep(gameId, p1, {
      attackCostPayment: true,
      attackCostAmount: 2,
      attackers: [{ creatureId: 'attacker_1', targetPlayerId: p2 }],
      options: [
        { id: 'pay_attack_cost', label: 'Pay {2} and attack' },
        { id: 'cancel_attack', label: 'Cancel attack' },
      ],
    });

    game.applyEvent({
      type: 'declareAttackers',
      playerId: p1,
      attackers: [{ creatureId: 'attacker_1', targetPlayerId: p2 }],
      attackCostPaid: true,
      attackCostAmount: 2,
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId) as any;
    expect(queue.activeStep?.attackCostPayment).not.toBe(true);
    expect((queue.steps || []).some((entry: any) => entry?.attackCostPayment === true)).toBe(false);
    const attacker = (game.state as any).battlefield.find((permanent: any) => permanent.id === 'attacker_1');
    expect(attacker?.attacking).toBe(p2);
    expect(attacker?.tapped).toBe(true);
    ResolutionQueueManager.removeQueue(gameId);
  });
});