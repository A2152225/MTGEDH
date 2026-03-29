import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('activation effect replay semantics', () => {
  it('replays activateSacrificeDrawAbility by consuming mana, sacrificing the permanent, and drawing a card', () => {
    const game = createInitialGameState('t_activate_sacrifice_draw_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 2 },
    };
    (game.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [{ id: 'drawn_1', name: 'Drawn Card', type_line: 'Artifact', zone: 'library' }],
        libraryCount: 1,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'clue_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'clue_card_1',
          name: 'Clue',
          type_line: 'Token Artifact — Clue',
          oracle_text: '{2}, Sacrifice this artifact: Draw a card.',
          zone: 'battlefield',
        },
      },
    ];

    game.applyEvent({
      type: 'activateSacrificeDrawAbility',
      playerId: p1,
      permanentId: 'clue_1',
      manaCost: '{2}',
      requiresTap: false,
    } as any);

    expect((game.state as any).battlefield).toHaveLength(0);
    expect((game.state as any).manaPool[p1]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });
    expect((game.state as any).zones[p1].graveyard).toHaveLength(1);
    expect((game.state as any).zones[p1].graveyard[0].name).toBe('Clue');
    expect((game.state as any).zones[p1].hand).toHaveLength(1);
    expect((game.state as any).zones[p1].hand[0].name).toBe('Drawn Card');
    expect((game.state as any).zones[p1].library).toHaveLength(0);
    expect((game.state as any).zones[p1].libraryCount).toBe(0);
  });

  it('replays activateDoublingCube by paying {3}, doubling the remaining mana, and tapping the cube', () => {
    const game = createInitialGameState('t_activate_doubling_cube_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).manaPool = {
      [p1]: { white: 1, blue: 1, black: 0, red: 0, green: 0, colorless: 2 },
    };
    (game.state as any).battlefield = [
      {
        id: 'cube_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'cube_card_1',
          name: 'Doubling Cube',
          type_line: 'Artifact',
          oracle_text: '{3}, {T}: Double the amount of each type of mana in your mana pool.',
          zone: 'battlefield',
        },
      },
    ];

    game.applyEvent({
      type: 'activateDoublingCube',
      playerId: p1,
      permanentId: 'cube_1',
    } as any);

    expect((game.state as any).manaPool[p1]).toEqual({ white: 0, blue: 2, black: 0, red: 0, green: 0, colorless: 0 });
    expect((game.state as any).battlefield[0].tapped).toBe(true);
  });

  it('replays activateUpgradeAbility by spending the upgrade cost and rebuilding the unresolved stack item', () => {
    const game = createInitialGameState('t_activate_upgrade_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'figure_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        basePower: 1,
        baseToughness: 1,
        card: {
          id: 'figure_card_1',
          name: 'Figure of Destiny',
          type_line: 'Creature — Kithkin',
          oracle_text: '{R/W}: Figure of Destiny becomes a Kithkin Spirit with base power and toughness 2/2.',
          zone: 'battlefield',
        },
      },
    ];

    game.applyEvent({
      type: 'activateUpgradeAbility',
      playerId: p1,
      permanentId: 'figure_1',
      abilityId: 'figure_1-ability-0',
      cardName: 'Figure of Destiny',
      upgradeIndex: 0,
    } as any);

    expect((game.state as any).manaPool[p1]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });
    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.abilityType || '')).toBe('creature-upgrade');

    game.resolveTopOfStack();

    const figure = (game.state as any).battlefield.find((entry: any) => entry.id === 'figure_1');
    expect(Number(figure?.basePower || 0)).toBe(2);
    expect(Number(figure?.baseToughness || 0)).toBe(2);
    expect((figure as any).upgradedCreatureTypes).toEqual(['Kithkin', 'Spirit']);
  });

  it('replays activateTutorAbility by scoping the selected ability, spending costs, and rebuilding the search queue', () => {
    const game = createInitialGameState('t_activate_tutor_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    game.importDeckResolved(p1, [
      {
        id: 'forest_1',
        name: 'Forest',
        type_line: 'Basic Land — Forest',
        oracle_text: '({T}: Add {G}.)',
      },
      {
        id: 'island_1',
        name: 'Island',
        type_line: 'Basic Land — Island',
        oracle_text: '({T}: Add {U}.)',
      },
    ] as any);

    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 2 },
    };
    (game.state as any).battlefield = [
      {
        id: 'atlas_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'atlas_card_1',
          name: 'Atlas Relay',
          type_line: 'Artifact',
          oracle_text: '{T}: Add {G}.\n{2}, {T}: Search your library for a Forest card, put that card onto the battlefield tapped, then shuffle.',
          zone: 'battlefield',
        },
      },
    ];

    game.applyEvent({
      type: 'activateTutorAbility',
      playerId: p1,
      permanentId: 'atlas_1',
      abilityId: 'atlas_1-ability-1',
      cardName: 'Atlas Relay',
      stackId: 'tutor_stack_1',
    } as any);

    expect((game.state as any).manaPool[p1]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });
    expect((game.state as any).battlefield[0].tapped).toBe(true);

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.id || '')).toBe('tutor_stack_1');
    expect(String(stack[0]?.abilityType || '')).toBe('tutor');
    expect(String(stack[0]?.description || '')).toContain('search your library for a forest card');
    expect(String(stack[0]?.activatedAbilityText || '')).toContain('{2}, {t}: search your library for a forest card');
    expect(String(stack[0]?.searchParams?.searchCriteria || '')).toBe('forest card');
    expect(String(stack[0]?.searchParams?.destination || '')).toBe('battlefield');
    expect(Boolean(stack[0]?.searchParams?.entersTapped)).toBe(true);

    const queue = ResolutionQueueManager.getQueue('t_activate_tutor_replay');
    expect(queue.steps).toHaveLength(1);
    expect(String(queue.steps[0]?.type || '')).toBe('library_search');
    expect(String((queue.steps[0] as any)?.searchCriteria || '')).toBe('forest card');
    expect(String((queue.steps[0] as any)?.destination || '')).toBe('battlefield');
    expect(Boolean((queue.steps[0] as any)?.entersTapped)).toBe(true);
    expect(Array.isArray((queue.steps[0] as any)?.availableCards)).toBe(true);
    expect((queue.steps[0] as any)?.availableCards).toHaveLength(2);
  });

  it('replays reconfigure unattach battlefield activations by rebuilding the unresolved stack item', () => {
    const game = createInitialGameState('t_activate_reconfigure_unattach_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 2 },
    };
    (game.state as any).battlefield = [
      {
        id: 'reconfigure_1',
        controller: p1,
        owner: p1,
        tapped: false,
        attachedTo: 'target_1',
        counters: {},
        card: {
          id: 'reconfigure_card_1',
          name: 'Lion Sash',
          type_line: 'Artifact Creature — Equipment Cat',
          oracle_text: 'Reconfigure {2}',
          zone: 'battlefield',
        },
      },
      {
        id: 'target_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        attachedEquipment: ['reconfigure_1'],
        isEquipped: true,
        card: {
          id: 'target_card_1',
          name: 'Silvercoat Lion',
          type_line: 'Creature — Cat',
          oracle_text: '',
          zone: 'battlefield',
        },
      },
    ];

    game.applyEvent({
      type: 'activateBattlefieldAbility',
      playerId: p1,
      permanentId: 'reconfigure_1',
      abilityId: 'reconfigure_1-reconfigure-unattach-0',
      cardName: 'Lion Sash',
      abilityText: 'Unattach this Equipment',
      activatedAbilityText: 'Reconfigure {2}',
      abilityType: 'reconfigure_unattach',
    } as any);

    expect((game.state as any).manaPool[p1]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });
    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.abilityType || '')).toBe('reconfigure_unattach');
    expect(String(stack[0]?.description || '')).toBe('Unattach this Equipment');
    expect(String(stack[0]?.activatedAbilityText || '')).toBe('Reconfigure {2}');

    game.resolveTopOfStack();

    const equipment = (game.state as any).battlefield.find((entry: any) => entry.id === 'reconfigure_1');
    const target = (game.state as any).battlefield.find((entry: any) => entry.id === 'target_1');
    expect(equipment?.attachedTo).toBeUndefined();
    expect(target?.attachedEquipment || []).toEqual([]);
    expect(Boolean(target?.isEquipped)).toBe(false);
  });

  it('replays equip battlefield target activations by rebuilding the stack item and spending equip cost', () => {
    const game = createInitialGameState('t_activate_equip_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 2 },
    };
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
          type_line: 'Artifact — Equipment',
          oracle_text: 'Equip {2}',
          zone: 'battlefield',
        },
      },
      {
        id: 'creature_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        attachedEquipment: [],
        isEquipped: false,
        card: {
          id: 'creature_card_1',
          name: 'Silvercoat Lion',
          type_line: 'Creature — Cat',
          oracle_text: '',
          zone: 'battlefield',
        },
      },
    ];

    game.applyEvent({
      type: 'activateBattlefieldAbility',
      playerId: p1,
      permanentId: 'equipment_1',
      abilityId: 'equipment_1-equip-0',
      cardName: 'Test Sword',
      abilityText: 'Equip {2}',
      activatedAbilityText: 'Equip {2}',
      abilityType: 'equip',
      targets: ['creature_1'],
      copyRetargetValidTargets: [
        { id: 'creature_1', name: 'Silvercoat Lion', type: 'permanent', controller: p1 },
      ],
      copyRetargetTargetTypes: ['creature'],
      copyRetargetMinTargets: 1,
      copyRetargetMaxTargets: 1,
      copyRetargetTargetDescription: 'creature you control',
    } as any);

    expect((game.state as any).manaPool[p1]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });
    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.abilityType || '')).toBe('equip');
    expect(stack[0]?.targets).toEqual(['creature_1']);
    expect(stack[0]?.equipParams).toEqual({
      equipmentId: 'equipment_1',
      targetCreatureId: 'creature_1',
      equipmentName: 'Test Sword',
      targetCreatureName: 'Silvercoat Lion',
    });

    game.resolveTopOfStack();

    const equipment = (game.state as any).battlefield.find((entry: any) => entry.id === 'equipment_1');
    const creature = (game.state as any).battlefield.find((entry: any) => entry.id === 'creature_1');
    expect(equipment?.attachedTo).toBe('creature_1');
    expect(creature?.attachedEquipment || []).toEqual(['equipment_1']);
    expect(Boolean(creature?.isEquipped)).toBe(true);
  });

  it('replays fortify battlefield target activations by rebuilding the stack item and spending fortify cost', () => {
    const game = createInitialGameState('t_activate_fortify_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 3 },
    };
    (game.state as any).battlefield = [
      {
        id: 'fort_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'fort_card_1',
          name: 'Darksteel Garrison',
          type_line: 'Artifact - Fortification',
          oracle_text: 'Fortified land has indestructible.\nFortify {3}',
          zone: 'battlefield',
        },
      },
      {
        id: 'land_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        attachedEquipment: [],
        card: {
          id: 'land_card_1',
          name: 'Plains',
          type_line: 'Basic Land - Plains',
          oracle_text: '{T}: Add {W}.',
          zone: 'battlefield',
        },
      },
    ];

    game.applyEvent({
      type: 'activateBattlefieldAbility',
      playerId: p1,
      permanentId: 'fort_1',
      abilityId: 'fort_card_1-fortify-0',
      cardName: 'Darksteel Garrison',
      abilityText: 'Fortify {3}',
      activatedAbilityText: 'Fortify {3}',
      abilityType: 'fortify',
      targets: ['land_1'],
      copyRetargetValidTargets: [
        { id: 'land_1', name: 'Plains', type: 'permanent', controller: p1 },
      ],
      copyRetargetTargetTypes: ['land'],
      copyRetargetMinTargets: 1,
      copyRetargetMaxTargets: 1,
      copyRetargetTargetDescription: 'land you control',
    } as any);

    expect((game.state as any).manaPool[p1]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });
    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.abilityType || '')).toBe('fortify');
    expect(stack[0]?.targets).toEqual(['land_1']);
    expect(stack[0]?.fortifyParams).toEqual({
      fortificationId: 'fort_1',
      targetLandId: 'land_1',
      fortificationName: 'Darksteel Garrison',
      targetLandName: 'Plains',
    });

    game.resolveTopOfStack();

    const fortification = (game.state as any).battlefield.find((entry: any) => entry.id === 'fort_1');
    const land = (game.state as any).battlefield.find((entry: any) => entry.id === 'land_1');
    expect(fortification?.attachedTo).toBe('land_1');
    expect(land?.attachedEquipment || []).toEqual(['fort_1']);
  });

  it('replays reconfigure attach battlefield target activations by rebuilding the stack item and spending reconfigure cost', () => {
    const game = createInitialGameState('t_activate_reconfigure_attach_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
    };
    (game.state as any).battlefield = [
      {
        id: 'reconfig_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'reconfig_card_1',
          name: 'Rabbit Battery',
          type_line: 'Artifact Creature - Equipment Rabbit',
          oracle_text: 'Equipped creature gets +1/+1 and has haste.\nReconfigure {1}',
          zone: 'battlefield',
        },
      },
      {
        id: 'creature_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        attachedEquipment: [],
        card: {
          id: 'creature_card_1',
          name: 'Bear Cub',
          type_line: 'Creature - Bear',
          oracle_text: '',
          zone: 'battlefield',
        },
      },
    ];

    game.applyEvent({
      type: 'activateBattlefieldAbility',
      playerId: p1,
      permanentId: 'reconfig_1',
      abilityId: 'reconfig_card_1-reconfigure-attach-0',
      cardName: 'Rabbit Battery',
      abilityText: 'Reconfigure {1}',
      activatedAbilityText: 'Reconfigure {1}',
      abilityType: 'reconfigure_attach',
      targets: ['creature_1'],
      copyRetargetValidTargets: [
        { id: 'creature_1', name: 'Bear Cub', type: 'permanent', controller: p1 },
      ],
      copyRetargetTargetTypes: ['creature'],
      copyRetargetMinTargets: 1,
      copyRetargetMaxTargets: 1,
      copyRetargetTargetDescription: 'creature you control',
    } as any);

    expect((game.state as any).manaPool[p1]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });
    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.abilityType || '')).toBe('reconfigure_attach');
    expect(stack[0]?.targets).toEqual(['creature_1']);
    expect(stack[0]?.reconfigureParams).toEqual({
      reconfigureId: 'reconfig_1',
      targetCreatureId: 'creature_1',
      reconfigureName: 'Rabbit Battery',
      targetCreatureName: 'Bear Cub',
    });

    game.resolveTopOfStack();

    const reconfigurePermanent = (game.state as any).battlefield.find((entry: any) => entry.id === 'reconfig_1');
    const creature = (game.state as any).battlefield.find((entry: any) => entry.id === 'creature_1');
    expect(reconfigurePermanent?.attachedTo).toBe('creature_1');
    expect(creature?.attachedEquipment || []).toEqual(['reconfig_1']);
  });

  it('replays non-target battlefield activations with interactive costs when activatedAbilityText is present', () => {
    const game = createInitialGameState('t_activate_return_to_hand_cost_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
    };
    (game.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'source_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'source_card_1',
          name: 'Wavebreak Device',
          type_line: 'Artifact',
          oracle_text: '{1}, Return a creature you control to its owner\'s hand: Draw a card.',
          zone: 'battlefield',
        },
      },
      {
        id: 'returned_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'returned_card_1',
          name: 'Silvercoat Lion',
          type_line: 'Creature — Cat',
          oracle_text: '',
          zone: 'battlefield',
        },
      },
    ];

    game.applyEvent({
      type: 'activateBattlefieldAbility',
      playerId: p1,
      permanentId: 'source_1',
      abilityId: 'source_1-ability-0',
      cardName: 'Wavebreak Device',
      abilityText: 'Draw a card.',
      activatedAbilityText: '{1}, Return a creature you control to its owner\'s hand: Draw a card.',
      returnedPermanentsToHandForCost: ['returned_1'],
    } as any);

    expect((game.state as any).manaPool[p1]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });
    expect((game.state as any).zones[p1].hand).toHaveLength(1);
    expect((game.state as any).zones[p1].hand[0].name).toBe('Silvercoat Lion');
    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.description || '')).toBe('Draw a card.');
    expect(String(stack[0]?.activatedAbilityText || '')).toBe('{1}, Return a creature you control to its owner\'s hand: Draw a card.');
  });

  it('replays Phyrexian-cost battlefield activations by rebuilding the stack item and charging life', () => {
    const game = createInitialGameState('t_activate_phyrexian_cost_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).life = { [p1]: 40 };
    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'source_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'source_card_1',
          name: 'Vital Relay',
          type_line: 'Artifact',
          oracle_text: '{G/P}: Draw a card.',
          zone: 'battlefield',
        },
      },
    ];

    game.applyEvent({
      type: 'activateBattlefieldAbility',
      playerId: p1,
      permanentId: 'source_1',
      abilityId: 'source_1-ability-0',
      cardName: 'Vital Relay',
      abilityText: 'Draw a card.',
      activatedAbilityText: '{G/P}: Draw a card.',
      lifePaidForCost: 2,
    } as any);

    expect((game.state as any).life[p1]).toBe(38);
    expect((game.state as any).players?.find((player: any) => player.id === p1)?.life).toBe(38);
    expect((game.state as any).lifeLostThisTurn?.[p1]).toBe(2);
    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.description || '')).toBe('Draw a card.');
    expect(String(stack[0]?.activatedAbilityText || '')).toBe('{G/P}: Draw a card.');
  });

  it('replays tap-other activation costs by tapping the chosen permanent and rebuilding the stack item', () => {
    const game = createInitialGameState('t_activate_tap_other_cost_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).battlefield = [
      {
        id: 'source_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'source_card_1',
          name: 'Draining Apparatus',
          type_line: 'Artifact',
          oracle_text: 'Tap an untapped creature you control: Draw a card.',
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
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          oracle_text: '',
          zone: 'battlefield',
        },
      },
    ];

    game.applyEvent({
      type: 'activateBattlefieldAbility',
      playerId: p1,
      permanentId: 'source_1',
      abilityId: 'source_1-ability-0',
      cardName: 'Draining Apparatus',
      abilityText: 'Draw a card.',
      activatedAbilityText: 'Tap an untapped creature you control: Draw a card.',
      tappedPermanents: ['creature_1'],
    } as any);

    const creature = ((game.state as any).battlefield || []).find((perm: any) => String(perm?.id) === 'creature_1');
    expect(Boolean(creature?.tapped)).toBe(true);
    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.description || '')).toBe('Draw a card.');
    expect(String(stack[0]?.activatedAbilityText || '')).toBe('Tap an untapped creature you control: Draw a card.');
  });

  it('replays targeted player battlefield activations with tap-other costs by rebuilding the stack item and milling the chosen player', () => {
    const game = createInitialGameState('t_activate_target_player_tap_other_replay');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');

    game.importDeckResolved(p2, [
      {
        id: 'milled_1',
        name: 'Top Card',
        type_line: 'Artifact',
        oracle_text: '',
      },
    ] as any);

    (game.state as any).battlefield = [
      {
        id: 'drowner_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'drowner_card_1',
          name: 'Drowner of Secrets',
          type_line: 'Creature - Merfolk Wizard',
          oracle_text: 'Tap an untapped Merfolk you control: Target player mills a card.',
          zone: 'battlefield',
        },
      },
      {
        id: 'merfolk_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'merfolk_card_1',
          name: 'Judge of Currents',
          type_line: 'Creature - Merfolk Wizard',
          oracle_text: '',
          zone: 'battlefield',
        },
      },
    ];

    game.applyEvent({
      type: 'activateBattlefieldAbility',
      playerId: p1,
      permanentId: 'drowner_1',
      abilityId: 'drowner_1-ability-0',
      cardName: 'Drowner of Secrets',
      abilityText: 'Target player mills a card.',
      activatedAbilityText: 'Tap an untapped Merfolk you control: Target player mills a card.',
      tappedPermanents: ['merfolk_1'],
      targets: [p2],
    } as any);

    const tappedMerfolk = ((game.state as any).battlefield || []).find((perm: any) => String(perm?.id) === 'merfolk_1');
    expect(Boolean(tappedMerfolk?.tapped)).toBe(true);

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.description || '')).toBe('Target player mills a card.');
    expect(String(stack[0]?.activatedAbilityText || '')).toBe('Tap an untapped Merfolk you control: Target player mills a card.');
    expect(stack[0]?.targets).toEqual([p2]);

    game.resolveTopOfStack();

    expect((game.state as any).zones[p2].libraryCount).toBe(0);
    expect((game.state as any).zones[p2].graveyard).toHaveLength(1);
    expect((game.state as any).zones[p2].graveyard[0]?.id).toBe('milled_1');
  });

  it('replays targeted permanent battlefield activations by rebuilding the stack item and tapping the chosen creature', () => {
    const game = createInitialGameState('t_activate_target_permanent_replay');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');

    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
    };
    (game.state as any).battlefield = [
      {
        id: 'source_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'source_card_1',
          name: 'Frost Relay',
          type_line: 'Artifact',
          oracle_text: '{1}: Tap target creature.',
          zone: 'battlefield',
        },
      },
      {
        id: 'creature_1',
        controller: p2,
        owner: p2,
        tapped: false,
        counters: {},
        card: {
          id: 'creature_card_1',
          name: 'Runeclaw Bear',
          type_line: 'Creature - Bear',
          oracle_text: '',
          zone: 'battlefield',
        },
      },
    ];

    game.applyEvent({
      type: 'activateBattlefieldAbility',
      playerId: p1,
      permanentId: 'source_1',
      abilityId: 'source_1-ability-0',
      cardName: 'Frost Relay',
      abilityText: 'Tap target creature.',
      activatedAbilityText: '{1}: Tap target creature.',
      targets: ['creature_1'],
      copyRetargetValidTargets: [
        { id: 'creature_1', name: 'Runeclaw Bear', type: 'permanent', controller: p2 },
      ],
      copyRetargetTargetTypes: ['creature'],
      copyRetargetMinTargets: 1,
      copyRetargetMaxTargets: 1,
      copyRetargetTargetDescription: 'target creature',
    } as any);

    expect((game.state as any).manaPool[p1]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.description || '')).toBe('Tap target creature.');
    expect(String(stack[0]?.activatedAbilityText || '')).toBe('{1}: Tap target creature.');
    expect(stack[0]?.targets).toEqual(['creature_1']);
    expect(stack[0]?.copyRetargetTargetTypes).toEqual(['creature']);
    expect(stack[0]?.copyRetargetTargetDescription).toBe('target creature');

    game.resolveTopOfStack();

    const creature = ((game.state as any).battlefield || []).find((perm: any) => String(perm?.id) === 'creature_1');
    expect(Boolean(creature?.tapped)).toBe(true);
  });

  it('replays targeted discard-cost battlefield activations by rebuilding the stack item and resolving the graveyard return effect', () => {
    const game = createInitialGameState('t_activate_discard_targeted_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 1, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [p1]: {
        hand: [
          {
            id: 'discard_1',
            name: 'Discarded Bear',
            type_line: 'Creature - Bear',
            zone: 'hand',
          },
        ],
        handCount: 1,
        graveyard: [
          {
            id: 'target_1',
            name: 'Returned Wolf',
            type_line: 'Creature - Wolf',
            zone: 'graveyard',
          },
        ],
        graveyardCount: 1,
        library: [],
        libraryCount: 0,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'source_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'source_card_1',
          name: 'Tortured Existence',
          type_line: 'Enchantment',
          oracle_text: '{B}, Discard a creature card: Return target creature card from your graveyard to your hand.',
          zone: 'battlefield',
        },
      },
    ];

    game.applyEvent({
      type: 'activateBattlefieldAbility',
      playerId: p1,
      permanentId: 'source_1',
      abilityId: 'source_1-ability-0',
      cardName: 'Tortured Existence',
      abilityText: 'Return target creature card from your graveyard to your hand.',
      activatedAbilityText: '{B}, Discard a creature card: Return target creature card from your graveyard to your hand.',
      discardedCardIds: ['discard_1'],
      targets: ['target_1'],
    } as any);

    expect((game.state as any).manaPool[p1]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });
    expect((game.state as any).zones[p1].hand).toHaveLength(0);
    expect((game.state as any).zones[p1].graveyard).toHaveLength(2);
    expect((game.state as any).zones[p1].graveyard.some((card: any) => card?.id === 'discard_1')).toBe(true);

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.description || '')).toBe('Return target creature card from your graveyard to your hand.');
    expect(String(stack[0]?.activatedAbilityText || '')).toBe('{B}, Discard a creature card: Return target creature card from your graveyard to your hand.');
    expect(stack[0]?.targets).toEqual(['target_1']);

    game.resolveTopOfStack();

    expect((game.state as any).zones[p1].hand).toHaveLength(1);
    expect((game.state as any).zones[p1].hand[0]?.id).toBe('target_1');
    expect((game.state as any).zones[p1].graveyard.some((card: any) => card?.id === 'target_1')).toBe(false);
    expect((game.state as any).zones[p1].graveyard.some((card: any) => card?.id === 'discard_1')).toBe(true);
  });

  it('replays graveyard-targeted exile battlefield activations by rebuilding the stack item and exiling the chosen card', () => {
    const game = createInitialGameState('t_activate_graveyard_exile_replay');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');

    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
    };
    (game.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
      [p2]: {
        hand: [],
        handCount: 0,
        graveyard: [
          {
            id: 'opp_gy_1',
            name: 'Opp Card',
            type_line: 'Sorcery',
            zone: 'graveyard',
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'source_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        exiledCards: [],
        card: {
          id: 'source_card_1',
          name: 'Keen-Eyed Curator',
          type_line: 'Artifact Creature',
          oracle_text: '{1}: Exile target card from a graveyard.',
          zone: 'battlefield',
        },
      },
    ];

    game.applyEvent({
      type: 'activateBattlefieldAbility',
      playerId: p1,
      permanentId: 'source_1',
      abilityId: 'source_1-ability-0',
      cardName: 'Keen-Eyed Curator',
      abilityText: 'Exile target card from a graveyard.',
      activatedAbilityText: '{1}: Exile target card from a graveyard.',
      targets: ['opp_gy_1'],
    } as any);

    expect((game.state as any).manaPool[p1]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });
    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.description || '')).toBe('Exile target card from a graveyard.');
    expect(String(stack[0]?.activatedAbilityText || '')).toBe('{1}: Exile target card from a graveyard.');
    expect(stack[0]?.targets).toEqual(['opp_gy_1']);

    game.resolveTopOfStack();

    expect((game.state as any).zones[p2].graveyard.some((card: any) => card?.id === 'opp_gy_1')).toBe(false);
    expect((game.state as any).zones[p2].exile).toHaveLength(1);
    expect((game.state as any).zones[p2].exile[0]?.id).toBe('opp_gy_1');
    const curator = (game.state as any).battlefield.find((entry: any) => entry.id === 'source_1');
    expect(Array.isArray(curator?.exiledCards)).toBe(true);
    expect(curator?.exiledCards?.[0]?.id).toBe('opp_gy_1');
  });
});