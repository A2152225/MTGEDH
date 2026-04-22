import { beforeEach, describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
}

describe('queued battlefield prompt replay semantics', () => {
  beforeEach(() => {
    for (const gameId of [
      't_activate_equip_prompt_replay',
      't_activate_fight_prompt_replay',
      't_activate_tap_untap_prompt_replay',
      't_activate_crew_prompt_replay',
      't_activate_mana_color_prompt_replay',
      't_activate_battlefield_target_selection_resolved_replay',
      't_activate_battlefield_payment_prompt_replay',
    ]) {
      resetGame(gameId);
    }
  });

  it('replays queued equip battlefield activations before target selection resolves', () => {
    const gameId = 't_activate_equip_prompt_replay';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).battlefield = [
      {
        id: 'equipment_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'equipment_card_1',
          name: 'Test Sword',
          type_line: 'Artifact - Equipment',
          oracle_text: 'Equip {2}',
          zone: 'battlefield',
        },
      },
    ];

    game.applyEvent({
      type: 'activateBattlefieldAbility',
      playerId: p1,
      permanentId: 'equipment_1',
      abilityId: 'equipment_card_1-equip-0',
      cardName: 'Test Sword',
      abilityText: 'Equip {2}',
      activatedAbilityText: 'Equip {2}',
      queuedResolutionStep: {
        id: 'queued_equip_1',
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: p1,
        sourceId: 'equipment_1',
        sourceName: 'Test Sword',
        description: 'Choose a creature to equip Test Sword to ({2}).',
        mandatory: false,
        validTargets: [
          {
            id: 'creature_1',
            label: 'Silvercoat Lion (2/2)',
            description: 'Creature - Cat',
            imageUrl: undefined,
          },
        ],
        targetTypes: ['creature'],
        minTargets: 1,
        maxTargets: 1,
        targetDescription: 'creature you control',
        battlefieldAbilityTargetSelection: true,
        equipmentId: 'equipment_1',
        permanentId: 'equipment_1',
        equipmentName: 'Test Sword',
        cardName: 'Test Sword',
        abilityId: 'equip',
        abilityText: 'Equip {2}',
        activatedAbilityText: 'Equip {2}',
        abilityType: 'equip',
        equipCost: '{2}',
        equipType: null,
        targetsOpponentCreatures: false,
      },
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect(String(queue.steps[0]?.id || '')).toBe('queued_equip_1');
    expect(queue.steps[0]?.type).toBe(ResolutionStepType.TARGET_SELECTION);
    expect((queue.steps[0] as any)?.abilityType).toBe('equip');
    expect((queue.steps[0] as any)?.equipmentId).toBe('equipment_1');
    expect((queue.steps[0] as any)?.validTargets).toHaveLength(1);
    expect((game.state as any).stack || []).toHaveLength(0);
  });

  it('replays queued fight-target battlefield activations before target selection resolves', () => {
    const gameId = 't_activate_fight_prompt_replay';
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

  it('replays queued crew battlefield activations before creature selection resolves', () => {
    const gameId = 't_activate_crew_prompt_replay';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).battlefield = [
      {
        id: 'vehicle_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'vehicle_card_1',
          name: 'Sky Skiff',
          type_line: 'Artifact - Vehicle',
          oracle_text: 'Crew 2',
          zone: 'battlefield',
        },
      },
    ];

    game.applyEvent({
      type: 'activateBattlefieldAbility',
      playerId: p1,
      permanentId: 'vehicle_1',
      abilityId: 'vehicle_card_1-crew-0',
      cardName: 'Sky Skiff',
      activatedAbilityText: 'Crew 2',
      queuedResolutionStep: {
        id: 'queued_crew_1',
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: p1,
        sourceId: 'vehicle_1',
        sourceName: 'Sky Skiff',
        description: 'Crew 2 — Tap any number of untapped creatures you control with total power 2 or more.',
        mandatory: false,
        validTargets: [
          {
            id: 'crewer_1',
            label: 'Skilled Pilot (2/2)',
            description: 'Creature - Human Pilot',
            imageUrl: undefined,
          },
        ],
        targetTypes: ['crew_creature'],
        minTargets: 1,
        maxTargets: 1,
        targetDescription: 'creatures you control to crew',
        crewAbility: true,
        vehicleId: 'vehicle_1',
        crewPower: 2,
      },
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect(String(queue.steps[0]?.id || '')).toBe('queued_crew_1');
    expect(queue.steps[0]?.type).toBe(ResolutionStepType.TARGET_SELECTION);
    expect(Boolean((queue.steps[0] as any)?.crewAbility)).toBe(true);
    expect((queue.steps[0] as any)?.vehicleId).toBe('vehicle_1');
    expect((queue.steps[0] as any)?.crewPower).toBe(2);
    expect((queue.steps[0] as any)?.validTargets).toHaveLength(1);
    expect((game.state as any).stack || []).toHaveLength(0);
  });

  it('replays queued mana-color battlefield activations before color choice resolves', () => {
    const gameId = 't_activate_mana_color_prompt_replay';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).battlefield = [
      {
        id: 'mana_creature_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'mana_creature_card_1',
          name: 'Mana Bear',
          type_line: 'Creature — Bear Druid',
          oracle_text: '{T}: Add one mana of any color.',
          zone: 'battlefield',
        },
      },
    ];

    game.applyEvent({
      type: 'activateBattlefieldAbility',
      playerId: p1,
      permanentId: 'mana_creature_1',
      abilityId: 'native_any',
      cardName: 'Mana Bear',
      tappedPermanents: ['mana_creature_1'],
      queuedResolutionStep: {
        id: 'queued_mana_choice_1',
        type: ResolutionStepType.MANA_COLOR_SELECTION,
        playerId: p1,
        sourceId: 'mana_creature_1',
        sourceName: 'Mana Bear',
        description: 'Choose a color for Mana Bear\'s mana.',
        mandatory: true,
        selectionKind: 'any_color',
        permanentId: 'mana_creature_1',
        cardName: 'Mana Bear',
        amount: 1,
        abilityId: 'native_any',
        tappedPermanentsForCost: ['mana_creature_1'],
      },
    } as any);

    const permanent = (game.state as any).battlefield.find((entry: any) => entry.id === 'mana_creature_1');
    expect(Boolean(permanent?.tapped)).toBe(true);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect(String(queue.steps[0]?.id || '')).toBe('queued_mana_choice_1');
    expect(queue.steps[0]?.type).toBe(ResolutionStepType.MANA_COLOR_SELECTION);
    expect((queue.steps[0] as any)?.selectionKind).toBe('any_color');
    expect((queue.steps[0] as any)?.amount).toBe(1);
    expect((queue.steps[0] as any)?.tappedPermanentsForCost).toEqual(['mana_creature_1']);
    expect((game.state as any).stack || []).toHaveLength(0);
  });

  it('clears replayed battlefield target-selection prompts once the activation is fully persisted', () => {
    const gameId = 't_activate_battlefield_target_selection_resolved_replay';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).battlefield = [
      {
        id: 'trade_relay_1',
        controller: p1,
        owner: p1,
        tapped: true,
        counters: {},
        card: {
          id: 'trade_relay_card_1',
          name: 'Trade Relay',
          type_line: 'Artifact',
          oracle_text: '{2}, {T}: Exchange control of two target permanents that share a card type.',
          zone: 'battlefield',
        },
      },
    ];

    game.applyEvent({
      type: 'activateBattlefieldAbility',
      playerId: p1,
      permanentId: 'trade_relay_1',
      abilityId: 'trade_relay_1-ability-0',
      cardName: 'Trade Relay',
      abilityText: 'Exchange control of two target permanents that share a card type.',
      activatedAbilityText: '{2}, {T}: Exchange control of two target permanents that share a card type.',
      queuedResolutionStep: {
        id: 'queued_trade_relay_targets',
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: p1,
        sourceId: 'trade_relay_1',
        sourceName: 'Trade Relay',
        description: 'Choose two target permanents that share a card type for Trade Relay',
        mandatory: true,
        validTargets: [
          {
            id: 'player_relic_1',
            label: 'Player Relic',
            description: 'Artifact',
            imageUrl: undefined,
          },
          {
            id: 'opponent_relic_1',
            label: 'Opponent Relic',
            description: 'Artifact',
            imageUrl: undefined,
          },
        ],
        targetTypes: ['permanent', 'permanent'],
        minTargets: 2,
        maxTargets: 2,
        targetDescription: 'two target permanents that share a card type',
        battlefieldAbilityTargetSelection: true,
        permanentId: 'trade_relay_1',
        cardName: 'Trade Relay',
        abilityId: 'trade_relay_1-ability-0',
        abilityText: 'Exchange control of two target permanents that share a card type.',
        activatedAbilityText: '{2}, {T}: Exchange control of two target permanents that share a card type.',
      },
    } as any);

    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(1);
    expect((game.state as any).stack || []).toHaveLength(0);

    game.applyEvent({
      type: 'activateBattlefieldAbility',
      playerId: p1,
      permanentId: 'trade_relay_1',
      abilityId: 'trade_relay_1-ability-0',
      cardName: 'Trade Relay',
      abilityText: 'Exchange control of two target permanents that share a card type.',
      activatedAbilityText: '{2}, {T}: Exchange control of two target permanents that share a card type.',
      stackItemId: 'stack_trade_relay_1',
      targets: ['player_relic_1', 'opponent_relic_1'],
    } as any);

    expect(ResolutionQueueManager.getQueue(gameId).steps).toEqual([]);
    expect((game.state as any).stack || []).toHaveLength(1);
    expect((game.state as any).stack[0]).toMatchObject({
      id: 'stack_trade_relay_1',
      source: 'trade_relay_1',
      controller: p1,
      targets: ['player_relic_1', 'opponent_relic_1'],
    });
  });

  it('replays queued activation payment prompts after battlefield target selection resolves', () => {
    const gameId = 't_activate_battlefield_payment_prompt_replay';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).battlefield = [
      {
        id: 'equipment_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'equipment_card_1',
          name: 'Test Sword',
          type_line: 'Artifact - Equipment',
          oracle_text: 'Equip {3}',
          zone: 'battlefield',
        },
      },
      {
        id: 'creature_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'creature_card_1',
          name: 'Silvercoat Lion',
          type_line: 'Creature - Cat',
          oracle_text: '',
          zone: 'battlefield',
        },
      },
    ];

    game.applyEvent({
      type: 'activateBattlefieldAbility',
      playerId: p1,
      permanentId: 'equipment_1',
      abilityId: 'equipment_card_1-equip-0',
      cardName: 'Test Sword',
      abilityText: 'Equip {3}',
      activatedAbilityText: 'Equip {3}',
      queuedResolutionStep: {
        id: 'queued_payment_1',
        type: ResolutionStepType.MANA_PAYMENT_CHOICE,
        playerId: p1,
        sourceId: 'equipment_1',
        sourceName: 'Test Sword',
        description: 'Choose how to pay {3} for Test Sword.',
        mandatory: true,
        activationPaymentChoice: true,
        activationPaymentContext: 'battlefield_targeted',
        confirmLabel: 'Pay and Activate',
        permanentId: 'equipment_1',
        abilityId: 'equipment_card_1-equip-0',
        cardName: 'Test Sword',
        manaCost: '{3}',
        abilityText: 'Equip {3}',
        activatedAbilityText: 'Equip {3}',
        targetIds: ['creature_1'],
        validTargets: [
          {
            id: 'creature_1',
            label: 'Silvercoat Lion (2/2)',
            description: 'Creature - Cat',
            imageUrl: undefined,
          },
        ],
        targetTypes: ['creature'],
        minTargets: 1,
        maxTargets: 1,
        targetDescription: 'creature you control',
        abilityType: 'equip',
        equipCost: '{3}',
      },
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect(String(queue.steps[0]?.id || '')).toBe('queued_payment_1');
    expect(queue.steps[0]?.type).toBe(ResolutionStepType.MANA_PAYMENT_CHOICE);
    expect((queue.steps[0] as any)?.activationPaymentChoice).toBe(true);
    expect((queue.steps[0] as any)?.manaCost).toBe('{3}');
    expect((queue.steps[0] as any)?.targetIds).toEqual(['creature_1']);
    expect((game.state as any).stack || []).toHaveLength(0);
  });
});