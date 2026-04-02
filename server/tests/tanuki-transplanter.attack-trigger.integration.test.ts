import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src';
import { createInitialGameState } from '../src/state/gameState';
import { nextStep, nextTurn } from '../src/state/modules/turn';
import { detectAttackTriggers, getAttackTriggersForCreatures } from '../src/state/modules/triggers/combat';

const tanukiOracleText = "Whenever this creature or equipped creature attacks, add an amount of {G} equal to its power. Until end of turn, you don't lose this mana as steps and phases end.\nReconfigure {3} ({3}: Attach to target creature you control; or unattach from a creature. Reconfigure only as a sorcery. While attached, this isn't a creature.)";

describe('Tanuki Transplanter attack trigger', () => {
  it('adds green mana equal to equipped creature power when the attached creature attacks', () => {
    const game = createInitialGameState('tanuki_transplanter_attached_attack');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'Player 1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'Player 2' } as any);

    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 11, colorless: 0 },
    };

    (game.state as any).battlefield = [
      {
        id: 'omnath_1',
        controller: p1,
        owner: p1,
        tapped: false,
        attachedEquipment: ['tanuki_1'],
        card: {
          id: 'omnath_card_1',
          name: 'Omnath, Locus of Mana',
          type_line: 'Legendary Creature - Elemental',
          oracle_text: "Green mana doesn't empty from your mana pool as steps and phases end.",
          power: '12',
          toughness: '12',
        },
      },
      {
        id: 'tanuki_1',
        controller: p1,
        owner: p1,
        tapped: false,
        attachedTo: 'omnath_1',
        card: {
          id: 'tanuki_card_1',
          name: 'Tanuki Transplanter',
          type_line: 'Artifact Creature - Equipment Dog',
          oracle_text: tanukiOracleText,
          power: '2',
          toughness: '4',
        },
      },
    ];

    const attacker = ((game.state as any).battlefield || []).find((perm: any) => perm.id === 'omnath_1');
    const triggers = getAttackTriggersForCreatures(
      { state: game.state, bumpSeq: () => undefined } as any,
      [attacker],
      p1,
      p2,
    );

    const tanukiTrigger = triggers.find((trigger: any) => trigger.cardName === 'Tanuki Transplanter');
    expect(tanukiTrigger).toBeTruthy();
    expect(tanukiTrigger?.triggerType).toBe('equipment_attack');
    expect(String(tanukiTrigger?.description || '').toLowerCase()).toContain('add an amount of {g} equal to its power');

    (game.state as any).stack = [
      {
        id: 'tanuki_trigger_1',
        type: 'triggered_ability',
        controller: p1,
        source: 'tanuki_1',
        permanentId: 'tanuki_1',
        sourceName: 'Tanuki Transplanter',
        description: tanukiTrigger?.description,
        triggerType: tanukiTrigger?.triggerType,
        effectData: tanukiTrigger?.value,
        mandatory: true,
      },
    ];

    game.resolveTopOfStack();

    expect((game.state as any).manaPool?.[p1]?.green).toBe(23);
  });

  it('detects its self-attack trigger while unattached', () => {
    const tanukiPermanent = {
      id: 'tanuki_self_1',
      controller: 'p1',
      owner: 'p1',
      tapped: false,
      card: {
        id: 'tanuki_card_self_1',
        name: 'Tanuki Transplanter',
        type_line: 'Artifact Creature - Equipment Dog',
        oracle_text: tanukiOracleText,
        power: '2',
        toughness: '4',
      },
    };

    const triggers = detectAttackTriggers((tanukiPermanent as any).card, tanukiPermanent as any);
    const tanukiTrigger = triggers.find((trigger: any) => trigger.triggerType === 'attacks');

    expect(tanukiTrigger).toBeTruthy();
    expect(String(tanukiTrigger?.description || '').toLowerCase()).toContain('add an amount of {g} equal to its power');
  });

  it('keeps Tanuki mana through later phase changes but clears it on the next turn', () => {
    const game = createInitialGameState('tanuki_transplanter_retained_until_next_turn');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'Player 1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'Player 2' } as any);

    (game.state as any).turnPlayer = p1;
    (game.state as any).phase = 'combat';
    (game.state as any).step = 'END_COMBAT';
    (game.state as any).priority = p1;
    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      [p2]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'bear_1',
        controller: p1,
        owner: p1,
        tapped: false,
        attachedEquipment: ['tanuki_1'],
        card: {
          id: 'bear_card_1',
          name: 'Charging Baloth',
          type_line: 'Creature - Beast',
          oracle_text: '',
          power: '4',
          toughness: '4',
        },
      },
      {
        id: 'tanuki_1',
        controller: p1,
        owner: p1,
        tapped: false,
        attachedTo: 'bear_1',
        card: {
          id: 'tanuki_card_1',
          name: 'Tanuki Transplanter',
          type_line: 'Artifact Creature - Equipment Dog',
          oracle_text: tanukiOracleText,
          power: '2',
          toughness: '4',
        },
      },
    ];
    (game.state as any).stack = [
      {
        id: 'tanuki_trigger_retention_1',
        type: 'triggered_ability',
        controller: p1,
        source: 'tanuki_1',
        permanentId: 'tanuki_1',
        sourceName: 'Tanuki Transplanter',
        description: 'Add an amount of {G} equal to its power. Until end of turn, you don\'t lose this mana as steps and phases end.',
        mandatory: true,
        effectData: { attachedToId: 'bear_1' },
      },
    ];

    game.resolveTopOfStack();

    expect((game.state as any).manaPool?.[p1]?.green).toBe(4);
    expect((game.state as any).temporaryRetainedMana?.[p1]?.untilEndTurn?.green).toBe(4);

    nextStep({ state: game.state, inactive: new Set<string>(), bumpSeq: () => undefined } as any);

    expect((game.state as any).phase).toBe('postcombatMain');
    expect((game.state as any).manaPool?.[p1]?.green).toBe(4);

    (game.state as any).phase = 'ending';
    (game.state as any).step = 'CLEANUP';
    nextTurn({ state: game.state, inactive: new Set<string>(), bumpSeq: () => undefined } as any);

    expect((game.state as any).manaPool?.[p1]?.green).toBe(0);
    expect((game.state as any).temporaryRetainedMana?.[p1]?.untilEndTurn).toBeUndefined();
  });

  it('clears temporary mana that only lasts until end of combat', () => {
    const game = createInitialGameState('temporary_retained_mana_until_end_combat');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'Player 1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'Player 2' } as any);

    (game.state as any).turnPlayer = p1;
    (game.state as any).phase = 'combat';
    (game.state as any).step = 'END_COMBAT';
    (game.state as any).priority = p1;
    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      [p2]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [];
    (game.state as any).stack = [
      {
        id: 'combat_mana_trigger_1',
        type: 'triggered_ability',
        controller: p1,
        sourceName: 'Test Combat Mana',
        description: 'Add {R}{R}. Until end of combat, you don\'t lose this mana as steps and phases end.',
        mandatory: true,
      },
    ];

    game.resolveTopOfStack();

    expect((game.state as any).manaPool?.[p1]?.red).toBe(2);
    expect((game.state as any).temporaryRetainedMana?.[p1]?.untilEndCombat?.red).toBe(2);

    nextStep({ state: game.state, inactive: new Set<string>(), bumpSeq: () => undefined } as any);

    expect((game.state as any).phase).toBe('postcombatMain');
    expect((game.state as any).manaPool?.[p1]?.red).toBe(0);
    expect((game.state as any).temporaryRetainedMana?.[p1]?.untilEndCombat).toBeUndefined();
  });
});