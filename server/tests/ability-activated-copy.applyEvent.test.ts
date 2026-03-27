import { describe, expect, it } from 'vitest';

import { applyEvent } from '../src/state/modules/applyEvent';

describe('ability-activated copy retarget metadata via applyEvent', () => {
  it('replay pushTriggeredAbility preserves ability-activated trigger metadata', () => {
    const ctx: any = {
      state: {
        battlefield: [],
        stack: [],
      },
      bumpSeq() {},
    };

    applyEvent(ctx, {
      type: 'pushTriggeredAbility',
      triggerId: 'trigger_1',
      sourceId: 'rings_1',
      sourceName: 'Rings of Brighthearth',
      controllerId: 'p1',
      description: 'You may pay {2}. If you do, copy that ability. You may choose new targets for the copy.',
      triggerType: 'ability_activated',
      effect: 'Whenever you activate an ability, if it is not a mana ability, you may pay {2}. If you do, copy that ability. You may choose new targets for the copy.',
      mandatory: false,
      triggeringPlayer: 'p1',
      activatedAbilityIsManaAbility: false,
      triggeringStackItemId: 'ability_1',
    } as any);

    expect(ctx.state.stack).toHaveLength(1);
    expect(ctx.state.stack[0]).toMatchObject({
      id: 'trigger_1',
      type: 'triggered_ability',
      controller: 'p1',
      source: 'rings_1',
      sourceName: 'Rings of Brighthearth',
      description: 'You may pay {2}. If you do, copy that ability. You may choose new targets for the copy.',
      triggerType: 'ability_activated',
      effect: 'Whenever you activate an ability, if it is not a mana ability, you may pay {2}. If you do, copy that ability. You may choose new targets for the copy.',
      mandatory: false,
      triggeringPlayer: 'p1',
      activatedAbilityIsManaAbility: false,
      triggeringStackItemId: 'ability_1',
    });
  });

  it('replay pushTriggeredAbility preserves tap-trigger metadata', () => {
    const ctx: any = {
      state: {
        battlefield: [],
        stack: [],
      },
      bumpSeq() {},
    };

    applyEvent(ctx, {
      type: 'pushTriggeredAbility',
      triggerId: 'trigger_tap_1',
      sourceId: 'judge_1',
      sourceName: 'Judge of Currents',
      controllerId: 'p1',
      description: 'Whenever a Merfolk you control becomes tapped, you may gain 1 life',
      triggerType: 'tap',
      effect: 'you may gain 1 life',
      mandatory: false,
      triggeringPermanentId: 'judge_1',
      effectData: { createsToken: true, tokenDetails: { name: 'Token', power: 1, toughness: 1, types: 'Creature' } },
    } as any);

    expect(ctx.state.stack).toHaveLength(1);
    expect(ctx.state.stack[0]).toMatchObject({
      id: 'trigger_tap_1',
      type: 'triggered_ability',
      controller: 'p1',
      source: 'judge_1',
      sourceName: 'Judge of Currents',
      description: 'Whenever a Merfolk you control becomes tapped, you may gain 1 life',
      triggerType: 'tap',
      effect: 'you may gain 1 life',
      mandatory: false,
      triggeringPermanentId: 'judge_1',
      effectData: { createsToken: true, tokenDetails: { name: 'Token', power: 1, toughness: 1, types: 'Creature' } },
    });
  });

  it('replay pushTriggeredAbility preserves targeted trigger metadata', () => {
    const ctx: any = {
      state: {
        battlefield: [],
        stack: [],
      },
      bumpSeq() {},
    };

    applyEvent(ctx, {
      type: 'pushTriggeredAbility',
      triggerId: 'trigger_target_1',
      sourceId: 'reejerey_1',
      sourceName: 'Merrow Reejerey',
      controllerId: 'p1',
      description: 'You may tap or untap target permanent.',
      triggerType: 'cast_creature_type',
      effect: 'You may tap or untap target permanent.',
      mandatory: false,
      requiresTarget: true,
      targetType: 'permanent',
    } as any);

    expect(ctx.state.stack).toHaveLength(1);
    expect(ctx.state.stack[0]).toMatchObject({
      id: 'trigger_target_1',
      type: 'triggered_ability',
      controller: 'p1',
      source: 'reejerey_1',
      sourceName: 'Merrow Reejerey',
      description: 'You may tap or untap target permanent.',
      triggerType: 'cast_creature_type',
      effect: 'You may tap or untap target permanent.',
      mandatory: false,
      requiresTarget: true,
      targetType: 'permanent',
    });
  });

  it('replay pushTriggeredAbility preserves ETB trigger replay metadata', () => {
    const ctx: any = {
      state: {
        battlefield: [],
        stack: [],
      },
      bumpSeq() {},
    };

    applyEvent(ctx, {
      type: 'pushTriggeredAbility',
      triggerId: 'trigger_etb_1',
      sourceId: 'desert_perm_1',
      permanentId: 'desert_perm_1',
      sourceName: 'Sunscorched Desert',
      controllerId: 'p1',
      description: 'When Sunscorched Desert enters, it deals 1 damage to target player.',
      triggerType: 'etb',
      effect: 'it deals 1 damage to target player.',
      mandatory: true,
      requiresChoice: false,
      requiresTarget: true,
      targetType: 'player',
      targetConstraint: 'opponent',
      needsTargetSelection: true,
      isModal: true,
      modalOptions: ['gain_life', 'deal_damage'],
    } as any);

    expect(ctx.state.stack).toHaveLength(1);
    expect(ctx.state.stack[0]).toMatchObject({
      id: 'trigger_etb_1',
      type: 'triggered_ability',
      controller: 'p1',
      source: 'desert_perm_1',
      permanentId: 'desert_perm_1',
      sourceName: 'Sunscorched Desert',
      description: 'When Sunscorched Desert enters, it deals 1 damage to target player.',
      triggerType: 'etb',
      effect: 'it deals 1 damage to target player.',
      mandatory: true,
      requiresChoice: false,
      requiresTarget: true,
      targetType: 'player',
      targetConstraint: 'opponent',
      needsTargetSelection: true,
      isModal: true,
      modalOptions: ['gain_life', 'deal_damage'],
    });
  });

  it('replay activateBattlefieldAbility reattaches persisted retarget metadata to the matching stack item', () => {
    const ctx: any = {
      state: {
        battlefield: [],
        stack: [
          {
            id: 'ability_1',
            type: 'ability',
            controller: 'p1',
            source: 'artifact_1',
            sourceName: 'Chromatic Sphere',
            description: 'Deal 1 damage to any target.',
            targets: ['player_2'],
          },
        ],
      },
      bumpSeq() {},
    };

    applyEvent(ctx, {
      type: 'activateBattlefieldAbility',
      playerId: 'p1',
      permanentId: 'artifact_1',
      abilityId: '0',
      cardName: 'Chromatic Sphere',
      abilityText: 'Deal 1 damage to any target.',
      activatedAbilityText: 'Deal 1 damage to any target.',
      targets: ['player_3'],
      copyRetargetValidTargets: [
        { id: 'player_2', name: 'P2', type: 'player', life: 40, isOpponent: true },
        { id: 'player_3', name: 'P3', type: 'player', life: 40, isOpponent: true },
      ],
      copyRetargetTargetTypes: ['player'],
      copyRetargetMinTargets: 1,
      copyRetargetMaxTargets: 1,
      copyRetargetTargetDescription: 'target player',
    } as any);

    const item = ctx.state.stack[0];
    expect(item.targets).toEqual(['player_3']);
    expect(item.activatedAbilityText).toBe('Deal 1 damage to any target.');
    expect(item.copyRetargetValidTargets).toEqual([
      { id: 'player_2', name: 'P2', type: 'player', life: 40, isOpponent: true },
      { id: 'player_3', name: 'P3', type: 'player', life: 40, isOpponent: true },
    ]);
    expect(item.copyRetargetTargetTypes).toEqual(['player']);
    expect(item.copyRetargetMinTargets).toBe(1);
    expect(item.copyRetargetMaxTargets).toBe(1);
    expect(item.copyRetargetTargetDescription).toBe('target player');
  });

  it('replay activatePlaneswalkerAbility reattaches persisted retarget metadata to the matching stack item', () => {
    const ctx: any = {
      state: {
        battlefield: [
          {
            id: 'pw_1',
            controller: 'p1',
            loyalty: 4,
            counters: { loyalty: 4 },
            card: { name: 'Test Walker' },
          },
        ],
        stack: [
          {
            id: 'ability_1',
            type: 'ability',
            controller: 'p1',
            source: 'pw_1',
            sourceName: 'Test Walker',
            description: 'Test Walker deals 1 damage to any target.',
            targets: ['player_2'],
            planeswalker: {
              abilityIndex: 0,
              loyaltyCost: -1,
            },
          },
        ],
      },
      bumpSeq() {},
    };

    applyEvent(ctx, {
      type: 'activatePlaneswalkerAbility',
      playerId: 'p1',
      permanentId: 'pw_1',
      abilityIndex: 0,
      loyaltyCost: -1,
      newLoyalty: 3,
      targets: ['player_3'],
      copyRetargetValidTargets: [
        { id: 'player_2', name: 'P2', type: 'player', life: 40, isOpponent: true },
        { id: 'player_3', name: 'P3', type: 'player', life: 40, isOpponent: true },
      ],
      copyRetargetTargetTypes: ['player'],
      copyRetargetMinTargets: 1,
      copyRetargetMaxTargets: 1,
      copyRetargetTargetDescription: 'target player',
    } as any);

    const permanent = ctx.state.battlefield[0];
    expect(permanent.counters.loyalty).toBe(3);

    const item = ctx.state.stack[0];
    expect(item.targets).toEqual(['player_3']);
    expect(item.copyRetargetValidTargets).toEqual([
      { id: 'player_2', name: 'P2', type: 'player', life: 40, isOpponent: true },
      { id: 'player_3', name: 'P3', type: 'player', life: 40, isOpponent: true },
    ]);
    expect(item.copyRetargetTargetTypes).toEqual(['player']);
    expect(item.copyRetargetMinTargets).toBe(1);
    expect(item.copyRetargetMaxTargets).toBe(1);
    expect(item.copyRetargetTargetDescription).toBe('target player');
  });

  it('replay activatePlaneswalkerAbility rebuilds the unresolved stack item when none exists', () => {
    const ctx: any = {
      state: {
        battlefield: [
          {
            id: 'pw_1',
            controller: 'p1',
            loyalty: 4,
            counters: { loyalty: 4 },
            card: {
              name: 'Test Walker',
              type_line: 'Legendary Planeswalker — Test',
              oracle_text: '+1: Test Walker deals 1 damage to any target.\n-2: Draw two cards.',
              oracle_id: 'oracle_pw_1',
            },
          },
        ],
        stack: [],
      },
      bumpSeq() {},
    };

    applyEvent(ctx, {
      type: 'activatePlaneswalkerAbility',
      playerId: 'p1',
      permanentId: 'pw_1',
      abilityIndex: 0,
      loyaltyCost: 1,
      newLoyalty: 5,
      targets: ['player_3'],
      copyRetargetValidTargets: [
        { id: 'player_2', name: 'P2', type: 'player', life: 40, isOpponent: true },
        { id: 'player_3', name: 'P3', type: 'player', life: 40, isOpponent: true },
      ],
      copyRetargetTargetTypes: ['player'],
      copyRetargetMinTargets: 1,
      copyRetargetMaxTargets: 1,
      copyRetargetTargetDescription: 'target player',
    } as any);

    const permanent = ctx.state.battlefield[0];
    expect(permanent.counters.loyalty).toBe(5);
    expect(permanent.loyalty).toBe(5);

    expect(ctx.state.stack).toHaveLength(1);
    const item = ctx.state.stack[0];
    expect(item.description).toBe('Test Walker deals 1 damage to any target.');
    expect(item.activatedAbilityText).toBe('+1: Test Walker deals 1 damage to any target.');
    expect(item.targets).toEqual(['player_3']);
    expect(item.planeswalker).toEqual({
      oracleId: 'oracle_pw_1',
      abilityIndex: 0,
      loyaltyCost: 1,
    });
    expect(item.copyRetargetTargetDescription).toBe('target player');
  });

  it('replay activateBattlefieldAbility preserves equipParams for stack-based equip activations', () => {
    const ctx: any = {
      state: {
        battlefield: [
          {
            id: 'equipment_1',
            controller: 'p1',
            card: { name: 'Test Sword', type_line: 'Artifact — Equipment' },
          },
          {
            id: 'creature_1',
            controller: 'p1',
            card: { name: 'Silvercoat Lion', type_line: 'Creature — Cat' },
          },
          {
            id: 'creature_2',
            controller: 'p1',
            card: { name: 'Runeclaw Bear', type_line: 'Creature — Bear' },
          },
        ],
        stack: [
          {
            id: 'ability_1',
            type: 'ability',
            controller: 'p1',
            source: 'equipment_1',
            sourceName: 'Test Sword',
            description: 'Equip {0}',
          },
        ],
      },
      bumpSeq() {},
    };

    applyEvent(ctx, {
      type: 'activateBattlefieldAbility',
      playerId: 'p1',
      permanentId: 'equipment_1',
      abilityId: 'equip',
      cardName: 'Test Sword',
      abilityText: 'Equip {0}',
      activatedAbilityText: 'Equip {0}',
      targets: ['creature_2'],
      copyRetargetValidTargets: [
        { id: 'creature_1', name: 'Silvercoat Lion', type: 'permanent', controller: 'p1' },
        { id: 'creature_2', name: 'Runeclaw Bear', type: 'permanent', controller: 'p1' },
      ],
      copyRetargetTargetTypes: ['creature'],
      copyRetargetMinTargets: 1,
      copyRetargetMaxTargets: 1,
      copyRetargetTargetDescription: 'creature you control',
    } as any);

    const item = ctx.state.stack[0];
    expect(item.abilityType).toBe('equip');
    expect(item.targets).toEqual(['creature_2']);
    expect(item.equipParams).toEqual({
      equipmentId: 'equipment_1',
      targetCreatureId: 'creature_2',
      equipmentName: 'Test Sword',
      targetCreatureName: 'Runeclaw Bear',
    });
    expect(item.copyRetargetTargetDescription).toBe('creature you control');
  });
});