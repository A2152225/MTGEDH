import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { setPermanentPrepared } from '../src/state/modules/prepared.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('spell control change resolution', () => {
  it('resolves Act of Treason-style temporary control change with untap, haste, and prepared migration', () => {
    const game = createInitialGameState('t_spell_control_change_act_of_treason');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');

    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, library: [], libraryCount: 0, exile: [], exileCount: 0 },
      [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, library: [], libraryCount: 0, exile: [], exileCount: 0 },
    };

    const preparedCard = {
      id: 'prepared_treason_card',
      name: 'Prepared Host // Sudden Recall',
      layout: 'prepare',
      mana_cost: '{2}{U} // {1}{U}',
      type_line: 'Creature — Human Advisor // Instant',
      colors: ['U'],
      color_identity: ['U'],
      card_faces: [
        {
          name: 'Prepared Host',
          mana_cost: '{2}{U}',
          type_line: 'Creature — Human Advisor',
          oracle_text: "This creature enters prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)",
          power: '2',
          toughness: '3',
        },
        {
          name: 'Sudden Recall',
          mana_cost: '{1}{U}',
          type_line: 'Instant',
          oracle_text: 'Return target creature to its owner\'s hand.',
        },
      ],
    };

    const preparedPermanent = {
      id: 'prepared_treason_perm',
      controller: p2,
      owner: p2,
      tapped: true,
      summoningSickness: false,
      counters: {},
      card: {
        ...preparedCard,
        name: 'Prepared Host',
        mana_cost: '{2}{U}',
        type_line: 'Creature — Human Advisor',
        oracle_text: preparedCard.card_faces[0].oracle_text,
        zone: 'battlefield',
      },
    } as any;

    (game.state as any).battlefield = [preparedPermanent];
    setPermanentPrepared((game.state as any), preparedPermanent);

    (game.state as any).stack = [
      {
        id: 'stack_act_of_treason_1',
        type: 'spell',
        controller: p1,
        card: {
          id: 'act_of_treason_1',
          name: 'Act of Treason',
          type_line: 'Sorcery',
          oracle_text: 'Gain control of target creature until end of turn. Untap that creature. It gains haste until end of turn.',
          mana_cost: '{2}{R}',
        },
        targets: ['prepared_treason_perm'],
      },
    ] as any;

    game.resolveTopOfStack();

    const target = ((game.state as any).battlefield || []).find((perm: any) => perm && perm.id === 'prepared_treason_perm');
    expect(target?.controller).toBe(p1);
    expect(target?.tapped).toBe(false);
    expect(target?.summoningSickness).toBe(true);
    expect((target as any)?.grantedAbilities || []).toContain('Haste');
    expect((target as any)?.untilEndOfTurn?.grantedAbilitiesToRemove || []).toContain('Haste');
    expect((game.state as any).controlChangeEffects).toEqual([
      expect.objectContaining({
        permanentId: 'prepared_treason_perm',
        originalController: p2,
        newController: p1,
        duration: 'eot',
      }),
    ]);
    expect((game.state as any).zones[p2].exile).toHaveLength(0);
    expect((game.state as any).zones[p1].exile).toHaveLength(1);
    expect((game.state as any).zones[p1].exile[0]).toMatchObject({
      canBePlayedBy: p1,
      preparedSourcePermanentId: 'prepared_treason_perm',
    });
  });

  it('does not apply temporary control change when an unselected modal mode is the only chosen effect', () => {
    const game = createInitialGameState('t_spell_control_change_modal_gate');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');

    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, library: [], libraryCount: 0, exile: [], exileCount: 0 },
      [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, library: [], libraryCount: 0, exile: [], exileCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'target_creature_1',
        controller: p2,
        owner: p2,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'target_creature_card_1',
          name: 'Target Creature',
          type_line: 'Creature — Bear',
          oracle_text: '',
          zone: 'battlefield',
        },
      },
    ];

    (game.state as any).stack = [
      {
        id: 'stack_modal_gate_1',
        type: 'spell',
        controller: p1,
        selectedModes: ['mode_2'],
        selectedModeDescriptions: ['Draw a card.'],
        card: {
          id: 'modal_gate_spell_1',
          name: 'Forked Treason',
          type_line: 'Instant',
          oracle_text: 'Choose one —\n• Until end of turn, you gain control of target creature and it gains haste.\n• Draw a card.',
          mana_cost: '{2}{R}',
        },
        targets: ['target_creature_1'],
      },
    ] as any;

    game.resolveTopOfStack();

    const target = ((game.state as any).battlefield || []).find((perm: any) => perm && perm.id === 'target_creature_1');
    expect(target?.controller).toBe(p2);
    expect((game.state as any).controlChangeEffects || []).toHaveLength(0);
  });

  it('resolves Dominate-style permanent control change with prepared migration and no cleanup tracker', () => {
    const game = createInitialGameState('t_spell_control_change_dominate');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');

    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, library: [], libraryCount: 0, exile: [], exileCount: 0 },
      [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, library: [], libraryCount: 0, exile: [], exileCount: 0 },
    };

    const preparedCard = {
      id: 'prepared_dominate_card',
      name: 'Prepared Host // Sudden Recall',
      layout: 'prepare',
      mana_cost: '{2}{U} // {1}{U}',
      type_line: 'Creature — Human Advisor // Instant',
      colors: ['U'],
      color_identity: ['U'],
      card_faces: [
        {
          name: 'Prepared Host',
          mana_cost: '{2}{U}',
          type_line: 'Creature — Human Advisor',
          oracle_text: "This creature enters prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)",
          power: '2',
          toughness: '3',
        },
        {
          name: 'Sudden Recall',
          mana_cost: '{1}{U}',
          type_line: 'Instant',
          oracle_text: 'Return target creature to its owner\'s hand.',
        },
      ],
    };

    const preparedPermanent = {
      id: 'prepared_dominate_perm',
      controller: p2,
      owner: p2,
      tapped: false,
      summoningSickness: false,
      counters: {},
      card: {
        ...preparedCard,
        name: 'Prepared Host',
        mana_cost: '{2}{U}',
        type_line: 'Creature — Human Advisor',
        oracle_text: preparedCard.card_faces[0].oracle_text,
        zone: 'battlefield',
      },
    } as any;

    (game.state as any).battlefield = [preparedPermanent];
    setPermanentPrepared((game.state as any), preparedPermanent);

    (game.state as any).stack = [
      {
        id: 'stack_dominate_1',
        type: 'spell',
        controller: p1,
        card: {
          id: 'dominate_1',
          name: 'Dominate',
          type_line: 'Instant',
          oracle_text: 'Gain control of target creature with mana value X or less.',
          mana_cost: '{X}{U}{U}',
        },
        targets: ['prepared_dominate_perm'],
      },
    ] as any;

    game.resolveTopOfStack();

    const target = ((game.state as any).battlefield || []).find((perm: any) => perm && perm.id === 'prepared_dominate_perm');
    expect(target?.controller).toBe(p1);
    expect(target?.summoningSickness).toBe(true);
    expect((game.state as any).controlChangeEffects || []).toHaveLength(0);
    expect((game.state as any).zones[p2].exile).toHaveLength(0);
    expect((game.state as any).zones[p1].exile).toHaveLength(1);
    expect((game.state as any).zones[p1].exile[0]).toMatchObject({
      canBePlayedBy: p1,
      preparedSourcePermanentId: 'prepared_dominate_perm',
    });
  });

  it('resolves Reins of Power by untapping, exchanging all creatures, granting haste, and migrating prepared copies', () => {
    const game = createInitialGameState('t_spell_control_change_reins_of_power');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');

    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, library: [], libraryCount: 0, exile: [], exileCount: 0 },
      [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, library: [], libraryCount: 0, exile: [], exileCount: 0 },
    };

    const preparedCard = {
      id: 'prepared_reins_card',
      name: 'Prepared Host // Sudden Recall',
      layout: 'prepare',
      mana_cost: '{2}{U} // {1}{U}',
      type_line: 'Creature — Human Advisor // Instant',
      colors: ['U'],
      color_identity: ['U'],
      card_faces: [
        {
          name: 'Prepared Host',
          mana_cost: '{2}{U}',
          type_line: 'Creature — Human Advisor',
          oracle_text: "This creature enters prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)",
          power: '2',
          toughness: '3',
        },
        {
          name: 'Sudden Recall',
          mana_cost: '{1}{U}',
          type_line: 'Instant',
          oracle_text: 'Return target creature to its owner\'s hand.',
        },
      ],
    };

    const preparedPermanent = {
      id: 'prepared_reins_perm',
      controller: p1,
      owner: p2,
      tapped: true,
      summoningSickness: false,
      counters: {},
      card: {
        ...preparedCard,
        name: 'Prepared Host',
        mana_cost: '{2}{U}',
        type_line: 'Creature — Human Advisor',
        oracle_text: preparedCard.card_faces[0].oracle_text,
        zone: 'battlefield',
      },
    } as any;

    (game.state as any).battlefield = [
      preparedPermanent,
      {
        id: 'p1_creature_1',
        controller: p1,
        owner: p1,
        tapped: true,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'p1_creature_card_1',
          name: 'P1 Creature',
          type_line: 'Creature — Human',
          oracle_text: '',
          zone: 'battlefield',
        },
      },
      {
        id: 'p2_creature_1',
        controller: p2,
        owner: p2,
        tapped: true,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'p2_creature_card_1',
          name: 'P2 Creature',
          type_line: 'Creature — Soldier',
          oracle_text: '',
          zone: 'battlefield',
        },
      },
    ];
    setPermanentPrepared((game.state as any), preparedPermanent);

    (game.state as any).stack = [
      {
        id: 'stack_reins_of_power_1',
        type: 'spell',
        controller: p1,
        card: {
          id: 'reins_of_power_1',
          name: 'Reins of Power',
          type_line: 'Instant',
          oracle_text: 'Untap all creatures you control and all creatures target opponent controls. You and target opponent each gain control of all creatures the other controls until end of turn. Those creatures gain haste until end of turn.',
          mana_cost: '{2}{U}{U}',
        },
        targets: [p2],
      },
    ] as any;

    game.resolveTopOfStack();

    const preparedTarget = ((game.state as any).battlefield || []).find((perm: any) => perm && perm.id === 'prepared_reins_perm');
    const p1Creature = ((game.state as any).battlefield || []).find((perm: any) => perm && perm.id === 'p1_creature_1');
    const p2Creature = ((game.state as any).battlefield || []).find((perm: any) => perm && perm.id === 'p2_creature_1');

    expect(preparedTarget?.controller).toBe(p2);
    expect(p1Creature?.controller).toBe(p2);
    expect(p2Creature?.controller).toBe(p1);
    expect(preparedTarget?.tapped).toBe(false);
    expect(p1Creature?.tapped).toBe(false);
    expect(p2Creature?.tapped).toBe(false);
    expect(preparedTarget?.summoningSickness).toBe(true);
    expect(p1Creature?.summoningSickness).toBe(true);
    expect(p2Creature?.summoningSickness).toBe(true);
    expect((preparedTarget as any)?.grantedAbilities || []).toContain('Haste');
    expect((p1Creature as any)?.grantedAbilities || []).toContain('Haste');
    expect((p2Creature as any)?.grantedAbilities || []).toContain('Haste');
    expect((game.state as any).controlChangeEffects || []).toEqual([
      expect.objectContaining({ permanentId: 'prepared_reins_perm', originalController: p1, newController: p2, duration: 'eot' }),
      expect.objectContaining({ permanentId: 'p1_creature_1', originalController: p1, newController: p2, duration: 'eot' }),
      expect.objectContaining({ permanentId: 'p2_creature_1', originalController: p2, newController: p1, duration: 'eot' }),
    ]);
    expect((game.state as any).zones[p1].exile).toHaveLength(0);
    expect((game.state as any).zones[p2].exile).toHaveLength(1);
    expect((game.state as any).zones[p2].exile[0]).toMatchObject({
      canBePlayedBy: p2,
      preparedSourcePermanentId: 'prepared_reins_perm',
    });
  });

  it('resolves Harmless Offering-style donation with prepared migration', () => {
    const game = createInitialGameState('t_spell_control_change_donate');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');

    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, library: [], libraryCount: 0, exile: [], exileCount: 0 },
      [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, library: [], libraryCount: 0, exile: [], exileCount: 0 },
    };

    const preparedCard = {
      id: 'prepared_donate_card',
      name: 'Prepared Host // Sudden Recall',
      layout: 'prepare',
      mana_cost: '{2}{U} // {1}{U}',
      type_line: 'Creature — Human Advisor // Instant',
      colors: ['U'],
      color_identity: ['U'],
      card_faces: [
        {
          name: 'Prepared Host',
          mana_cost: '{2}{U}',
          type_line: 'Creature — Human Advisor',
          oracle_text: "This creature enters prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)",
          power: '2',
          toughness: '3',
        },
        {
          name: 'Sudden Recall',
          mana_cost: '{1}{U}',
          type_line: 'Instant',
          oracle_text: 'Return target creature to its owner\'s hand.',
        },
      ],
    };

    const preparedPermanent = {
      id: 'prepared_donate_perm',
      controller: p1,
      owner: p1,
      tapped: false,
      summoningSickness: false,
      counters: {},
      card: {
        ...preparedCard,
        name: 'Prepared Host',
        mana_cost: '{2}{U}',
        type_line: 'Creature — Human Advisor',
        oracle_text: preparedCard.card_faces[0].oracle_text,
        zone: 'battlefield',
      },
    } as any;

    (game.state as any).battlefield = [preparedPermanent];
    setPermanentPrepared((game.state as any), preparedPermanent);

    (game.state as any).stack = [
      {
        id: 'stack_harmless_offering_1',
        type: 'spell',
        controller: p1,
        card: {
          id: 'harmless_offering_1',
          name: 'Harmless Offering',
          type_line: 'Sorcery',
          oracle_text: 'Target opponent gains control of target permanent you control.',
          mana_cost: '{2}{R}',
        },
        targets: [p2, 'prepared_donate_perm'],
      },
    ] as any;

    game.resolveTopOfStack();

    const target = ((game.state as any).battlefield || []).find((perm: any) => perm && perm.id === 'prepared_donate_perm');
    expect(target?.controller).toBe(p2);
    expect(target?.summoningSickness).toBe(true);
    expect((game.state as any).controlChangeEffects || []).toHaveLength(0);
    expect((game.state as any).zones[p1].exile).toHaveLength(0);
    expect((game.state as any).zones[p2].exile).toHaveLength(1);
    expect((game.state as any).zones[p2].exile[0]).toMatchObject({
      canBePlayedBy: p2,
      preparedSourcePermanentId: 'prepared_donate_perm',
    });
  });

  it('resolves exchange of two target permanents with prepared migration', () => {
    const game = createInitialGameState('t_spell_control_change_exchange_targets');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');

    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, library: [], libraryCount: 0, exile: [], exileCount: 0 },
      [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, library: [], libraryCount: 0, exile: [], exileCount: 0 },
    };

    const preparedCard = {
      id: 'prepared_exchange_card',
      name: 'Prepared Host // Sudden Recall',
      layout: 'prepare',
      mana_cost: '{2}{U} // {1}{U}',
      type_line: 'Creature — Human Advisor // Instant',
      colors: ['U'],
      color_identity: ['U'],
      card_faces: [
        {
          name: 'Prepared Host',
          mana_cost: '{2}{U}',
          type_line: 'Creature — Human Advisor',
          oracle_text: "This creature enters prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)",
          power: '2',
          toughness: '3',
        },
        {
          name: 'Sudden Recall',
          mana_cost: '{1}{U}',
          type_line: 'Instant',
          oracle_text: 'Return target creature to its owner\'s hand.',
        },
      ],
    };

    const preparedPermanent = {
      id: 'prepared_exchange_perm',
      controller: p1,
      owner: p1,
      tapped: false,
      summoningSickness: false,
      counters: {},
      card: {
        ...preparedCard,
        name: 'Prepared Host',
        mana_cost: '{2}{U}',
        type_line: 'Creature — Human Advisor',
        oracle_text: preparedCard.card_faces[0].oracle_text,
        zone: 'battlefield',
      },
    } as any;

    (game.state as any).battlefield = [
      preparedPermanent,
      {
        id: 'exchange_target_2',
        controller: p2,
        owner: p2,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'exchange_target_card_2',
          name: 'Exchange Target',
          type_line: 'Creature — Soldier',
          oracle_text: '',
          zone: 'battlefield',
        },
      },
    ];
    setPermanentPrepared((game.state as any), preparedPermanent);

    (game.state as any).stack = [
      {
        id: 'stack_exchange_targets_1',
        type: 'spell',
        controller: p1,
        card: {
          id: 'exchange_targets_1',
          name: 'Market Chaos',
          type_line: 'Phenomenon',
          oracle_text: 'Exchange control of two target permanents that share a card type.',
        },
        targets: ['prepared_exchange_perm', 'exchange_target_2'],
      },
    ] as any;

    game.resolveTopOfStack();

    const firstTarget = ((game.state as any).battlefield || []).find((perm: any) => perm && perm.id === 'prepared_exchange_perm');
    const secondTarget = ((game.state as any).battlefield || []).find((perm: any) => perm && perm.id === 'exchange_target_2');
    expect(firstTarget?.controller).toBe(p2);
    expect(secondTarget?.controller).toBe(p1);
    expect(firstTarget?.summoningSickness).toBe(true);
    expect(secondTarget?.summoningSickness).toBe(true);
    expect((game.state as any).controlChangeEffects || []).toHaveLength(0);
    expect((game.state as any).zones[p1].exile).toHaveLength(0);
    expect((game.state as any).zones[p2].exile).toHaveLength(1);
    expect((game.state as any).zones[p2].exile[0]).toMatchObject({
      canBePlayedBy: p2,
      preparedSourcePermanentId: 'prepared_exchange_perm',
    });
  });

  it('resolves explicit target-and-target exchange control text with prepared migration', () => {
    const game = createInitialGameState('t_spell_control_change_exchange_explicit_targets');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');

    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, library: [], libraryCount: 0, exile: [], exileCount: 0 },
      [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, library: [], libraryCount: 0, exile: [], exileCount: 0 },
    };

    const preparedCard = {
      id: 'prepared_exchange_explicit_card',
      name: 'Prepared Host // Sudden Recall',
      layout: 'prepare',
      mana_cost: '{2}{U} // {1}{U}',
      type_line: 'Creature — Human Advisor // Instant',
      colors: ['U'],
      color_identity: ['U'],
      card_faces: [
        {
          name: 'Prepared Host',
          mana_cost: '{2}{U}',
          type_line: 'Creature — Human Advisor',
          oracle_text: "This creature enters prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)",
          power: '2',
          toughness: '3',
        },
        {
          name: 'Sudden Recall',
          mana_cost: '{1}{U}',
          type_line: 'Instant',
          oracle_text: 'Return target creature to its owner\'s hand.',
        },
      ],
    };

    const preparedPermanent = {
      id: 'prepared_exchange_explicit_perm',
      controller: p1,
      owner: p1,
      tapped: false,
      summoningSickness: false,
      counters: {},
      card: {
        ...preparedCard,
        name: 'Prepared Host',
        mana_cost: '{2}{U}',
        type_line: 'Creature — Human Advisor',
        oracle_text: preparedCard.card_faces[0].oracle_text,
        zone: 'battlefield',
      },
    } as any;

    (game.state as any).battlefield = [
      preparedPermanent,
      {
        id: 'exchange_explicit_target_2',
        controller: p2,
        owner: p2,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'exchange_explicit_card_2',
          name: 'Exchange Target',
          type_line: 'Creature — Soldier',
          oracle_text: '',
          zone: 'battlefield',
        },
      },
    ];
    setPermanentPrepared((game.state as any), preparedPermanent);

    (game.state as any).stack = [
      {
        id: 'stack_exchange_explicit_targets_1',
        type: 'spell',
        controller: p1,
        card: {
          id: 'exchange_explicit_targets_1',
          name: 'Swap Contrivance',
          type_line: 'Sorcery',
          oracle_text: 'Exchange control of target creature you control and target creature an opponent controls.',
        },
        targets: ['prepared_exchange_explicit_perm', 'exchange_explicit_target_2'],
      },
    ] as any;

    game.resolveTopOfStack();

    const firstTarget = ((game.state as any).battlefield || []).find((perm: any) => perm && perm.id === 'prepared_exchange_explicit_perm');
    const secondTarget = ((game.state as any).battlefield || []).find((perm: any) => perm && perm.id === 'exchange_explicit_target_2');
    expect(firstTarget?.controller).toBe(p2);
    expect(secondTarget?.controller).toBe(p1);
    expect(firstTarget?.summoningSickness).toBe(true);
    expect(secondTarget?.summoningSickness).toBe(true);
    expect((game.state as any).controlChangeEffects || []).toHaveLength(0);
    expect((game.state as any).zones[p1].exile).toHaveLength(0);
    expect((game.state as any).zones[p2].exile).toHaveLength(1);
    expect((game.state as any).zones[p2].exile[0]).toMatchObject({
      canBePlayedBy: p2,
      preparedSourcePermanentId: 'prepared_exchange_explicit_perm',
    });
  });

  it('does not exchange control when selected permanents do not share a card type', () => {
    const game = createInitialGameState('t_spell_control_change_exchange_invalid_types');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');

    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, library: [], libraryCount: 0, exile: [], exileCount: 0 },
      [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, library: [], libraryCount: 0, exile: [], exileCount: 0 },
    };

    (game.state as any).battlefield = [
      {
        id: 'exchange_invalid_artifact',
        controller: p1,
        owner: p1,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'exchange_invalid_artifact_card',
          name: 'Loaned Relic',
          type_line: 'Artifact',
          oracle_text: '',
          zone: 'battlefield',
        },
      },
      {
        id: 'exchange_invalid_creature',
        controller: p2,
        owner: p2,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'exchange_invalid_creature_card',
          name: 'Opponent Bear',
          type_line: 'Creature — Bear',
          oracle_text: '',
          zone: 'battlefield',
        },
      },
    ];

    (game.state as any).stack = [
      {
        id: 'stack_exchange_invalid_types_1',
        type: 'spell',
        controller: p1,
        card: {
          id: 'exchange_invalid_types_1',
          name: 'Market Chaos',
          type_line: 'Sorcery',
          oracle_text: 'Exchange control of two target permanents that share a card type.',
        },
        targets: ['exchange_invalid_artifact', 'exchange_invalid_creature'],
      },
    ] as any;

    game.resolveTopOfStack();

    const firstTarget = ((game.state as any).battlefield || []).find((perm: any) => perm && perm.id === 'exchange_invalid_artifact');
    const secondTarget = ((game.state as any).battlefield || []).find((perm: any) => perm && perm.id === 'exchange_invalid_creature');
    expect(firstTarget?.controller).toBe(p1);
    expect(secondTarget?.controller).toBe(p2);
    expect((game.state as any).controlChangeEffects || []).toHaveLength(0);
  });
});