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

function addActiveStep(gameId: string, playerId: PlayerID, extra: Record<string, any>) {
  const step = ResolutionQueueManager.addStep(gameId, {
    playerId,
    description: 'Resolve a prompt.',
    mandatory: true,
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

  it('replays commanderZoneChoice moveToCommandZone by clearing BF ghosts and restoring CZ', () => {
    const gameId = 't_commander_zone_choice_to_cz_replay';
    ResolutionQueueManager.removeQueue(gameId);
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    const commanderCard = {
      id: 'cmd_bf_1',
      name: "T'Challa, the Pride's Hope",
      type_line: 'Legendary Creature — Human Warrior',
      mana_cost: '{1}{G}{W}',
    };

    (game.state as any).commandZone = {
      [p1]: {
        commanderIds: ['cmd_bf_1'],
        commanderNames: [commanderCard.name],
        commanderCards: [{ ...commanderCard }],
        inCommandZone: [],
        tax: 0,
        taxById: { cmd_bf_1: 0 },
      },
    };

    (game.state as any).battlefield = [
      {
        id: 'perm_cmd_bf_1',
        controller: p1,
        owner: p1,
        isCommander: true,
        card: { ...commanderCard },
      },
      {
        id: 'perm_other',
        controller: p1,
        owner: p1,
        card: { id: 'other_1', name: 'Bast, Panther Goddess', type_line: 'Legendary Creature' },
      },
    ];
    (game.state as any).stack = [
      {
        type: 'ability',
        id: 'trig_1',
        sourceCard: { ...commanderCard },
        sourceName: commanderCard.name,
      },
    ];

    const zones = (game.state as any).zones[p1];
    zones.graveyard = [];
    zones.commandZone = [];
    zones.commandZoneCount = 0;

    game.applyEvent({
      type: 'commanderZoneChoice',
      playerId: p1,
      commanderId: 'cmd_bf_1',
      commanderName: commanderCard.name,
      moveToCommandZone: true,
      destinationZone: 'graveyard',
      card: { ...commanderCard },
    } as any);

    expect((game.state as any).commandZone[p1].inCommandZone).toContain('cmd_bf_1');
    expect((game.state as any).battlefield.some((p: any) => p.card?.id === 'cmd_bf_1' || p.id === 'cmd_bf_1')).toBe(false);
    expect((game.state as any).battlefield.some((p: any) => p.id === 'perm_other')).toBe(true);
    expect((zones.commandZone || []).some((c: any) => c.id === 'cmd_bf_1')).toBe(true);
    // Trigger abilities sourced from the commander should remain (not treated as the commander spell).
    expect(((game.state as any).stack || []).some((s: any) => s.id === 'trig_1')).toBe(true);
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

  it('replays mulliganPutToBottom by clearing the hand-to-bottom prompt', () => {
    const gameId = 't_mulligan_bottom_prompt_clear_replay';
    ResolutionQueueManager.removeQueue(gameId);
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    const zones = (game.state as any).zones[p1];
    zones.hand = [
      { id: 'hand_1', name: 'Card One', zone: 'hand' },
      { id: 'hand_2', name: 'Card Two', zone: 'hand' },
    ];
    zones.handCount = 2;
    game.libraries.set(p1, [] as any);

    const step = addActiveStep(gameId, p1, {
      type: ResolutionStepType.HAND_TO_BOTTOM,
      cardsToBottom: 1,
    });

    game.applyEvent({
      type: 'mulliganPutToBottom',
      playerId: p1,
      resolvedStepId: step.id,
      cardIds: ['hand_1'],
      mulligansTaken: 1,
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId) as any;
    expect(queue.activeStep?.type).not.toBe(ResolutionStepType.HAND_TO_BOTTOM);
    expect((queue.steps || []).some((entry: any) => entry?.type === ResolutionStepType.HAND_TO_BOTTOM)).toBe(false);
    expect(zones.hand.map((card: any) => card.id)).toEqual(['hand_2']);
    expect(game.libraries.get(p1)?.map((card: any) => card.id)).toEqual(['hand_1']);
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('replays activateBattlefieldAbility by clearing resolved fight prompts', () => {
    const gameId = 't_fight_target_prompt_clear_replay';
    ResolutionQueueManager.removeQueue(gameId);
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    const step = addActiveStep(gameId, p1, {
      type: ResolutionStepType.FIGHT_TARGET,
      sourceId: 'fighter_1',
      sourceName: 'Fighter',
    });

    game.applyEvent({
      type: 'activateBattlefieldAbility',
      playerId: p1,
      resolvedStepId: step.id,
      permanentId: 'fighter_1',
      abilityType: 'fight',
      targets: ['target_1'],
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId) as any;
    expect(queue.activeStep?.type).not.toBe(ResolutionStepType.FIGHT_TARGET);
    expect((queue.steps || []).some((entry: any) => entry?.type === ResolutionStepType.FIGHT_TARGET)).toBe(false);
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('replays permanent_tapped by clearing resolved tap/untap prompts', () => {
    const gameId = 't_tap_untap_target_prompt_clear_replay';
    ResolutionQueueManager.removeQueue(gameId);
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).battlefield = [
      { id: 'tap_target_1', controller: p1, tapped: false, card: { name: 'Tap Target', type_line: 'Creature' } },
    ];

    const step = addActiveStep(gameId, p1, {
      type: ResolutionStepType.TAP_UNTAP_TARGET,
      action: 'tap',
      targetCount: 1,
    });

    game.applyEvent({
      type: 'permanent_tapped',
      playerId: p1,
      resolvedStepId: step.id,
      permanentIds: ['tap_target_1'],
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId) as any;
    expect(queue.activeStep?.type).not.toBe(ResolutionStepType.TAP_UNTAP_TARGET);
    expect((queue.steps || []).some((entry: any) => entry?.type === ResolutionStepType.TAP_UNTAP_TARGET)).toBe(false);
    expect((game.state as any).battlefield[0].tapped).toBe(true);
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('replays counter_moved by clearing resolved counter movement prompts', () => {
    const gameId = 't_counter_movement_prompt_clear_replay';
    ResolutionQueueManager.removeQueue(gameId);
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).battlefield = [
      { id: 'counter_source_1', controller: p1, counters: { charge: 1 }, card: { name: 'Source', type_line: 'Artifact' } },
      { id: 'counter_target_1', controller: p1, counters: {}, card: { name: 'Target', type_line: 'Artifact' } },
    ];

    const step = addActiveStep(gameId, p1, {
      type: ResolutionStepType.COUNTER_MOVEMENT,
      sourceName: 'Move Counter',
    });

    game.applyEvent({
      type: 'counter_moved',
      playerId: p1,
      resolvedStepId: step.id,
      sourcePermanentId: 'counter_source_1',
      targetPermanentId: 'counter_target_1',
      counterType: 'charge',
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId) as any;
    expect(queue.activeStep?.type).not.toBe(ResolutionStepType.COUNTER_MOVEMENT);
    expect((queue.steps || []).some((entry: any) => entry?.type === ResolutionStepType.COUNTER_MOVEMENT)).toBe(false);
    expect((game.state as any).battlefield[0].counters.charge).toBeUndefined();
    expect((game.state as any).battlefield[1].counters.charge).toBe(1);
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('replays castSpellContinuation by clearing resolved cast-cost prompts', () => {
    const gameId = 't_cast_cost_prompt_clear_replay';
    ResolutionQueueManager.removeQueue(gameId);
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    for (const promptType of [
      ResolutionStepType.LIFE_PAYMENT,
      ResolutionStepType.ADDITIONAL_COST_PAYMENT,
      ResolutionStepType.SQUAD_COST_PAYMENT,
    ]) {
      const step = addActiveStep(gameId, p1, {
        type: promptType,
        cardId: `spell_${promptType}`,
        sourceName: 'Prompt Spell',
      });

      game.applyEvent({
        type: 'castSpellContinuation',
        playerId: p1,
        resolvedStepId: step.id,
        resolvedStepType: promptType,
        cardId: `spell_${promptType}`,
      } as any);

      const queue = ResolutionQueueManager.getQueue(gameId) as any;
      expect(queue.activeStep?.id).not.toBe(step.id);
      expect((queue.steps || []).some((entry: any) => entry?.id === step.id)).toBe(false);
    }

    ResolutionQueueManager.removeQueue(gameId);
  });

  it('replays activateManaAbility by clearing resolved mana color prompts', () => {
    const gameId = 't_mana_color_prompt_clear_replay';
    ResolutionQueueManager.removeQueue(gameId);
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).battlefield = [
      { id: 'mana_source_1', controller: p1, tapped: false, card: { name: 'Mana Source', type_line: 'Land' } },
    ];

    const step = addActiveStep(gameId, p1, {
      type: ResolutionStepType.MANA_COLOR_SELECTION,
      permanentId: 'mana_source_1',
      cardName: 'Mana Source',
    });

    game.applyEvent({
      type: 'activateManaAbility',
      playerId: p1,
      resolvedStepId: step.id,
      permanentId: 'mana_source_1',
      manaColor: 'green',
      addedMana: { green: 1 },
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId) as any;
    expect(queue.activeStep?.type).not.toBe(ResolutionStepType.MANA_COLOR_SELECTION);
    expect((queue.steps || []).some((entry: any) => entry?.type === ResolutionStepType.MANA_COLOR_SELECTION)).toBe(false);
    expect((game.state as any).battlefield[0].tapped).toBe(true);
    expect((game.state as any).manaPool[p1].green).toBe(1);
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('replays upkeepSacrificeResolve by clearing no-op upkeep sacrifice prompts', () => {
    const gameId = 't_upkeep_sacrifice_prompt_clear_replay';
    ResolutionQueueManager.removeQueue(gameId);
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    const step = addActiveStep(gameId, p1, {
      type: ResolutionStepType.UPKEEP_SACRIFICE,
      sourceId: 'source_1',
      sourceName: 'Upkeep Source',
    });

    game.applyEvent({
      type: 'upkeepSacrificeResolve',
      playerId: p1,
      resolvedStepId: step.id,
      sourceId: 'source_1',
      sourceName: 'Upkeep Source',
      sacrificeType: 'source',
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId) as any;
    expect(queue.activeStep?.type).not.toBe(ResolutionStepType.UPKEEP_SACRIFICE);
    expect((queue.steps || []).some((entry: any) => entry?.type === ResolutionStepType.UPKEEP_SACRIFICE)).toBe(false);
    ResolutionQueueManager.removeQueue(gameId);
  });
});