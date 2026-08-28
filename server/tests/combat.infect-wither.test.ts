import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';

function setupToMain1(game: ReturnType<typeof createInitialGameState>, p1: PlayerID, p2: PlayerID) {
  game.applyEvent({ type: 'nextTurn' });

  const p1Deck = Array.from({ length: 20 }, (_, index) => ({
    id: `p1_card_${index}`,
    name: `P1 Card ${index}`,
    type_line: 'Creature',
    oracle_text: '',
  }));
  const p2Deck = Array.from({ length: 20 }, (_, index) => ({
    id: `p2_card_${index}`,
    name: `P2 Card ${index}`,
    type_line: 'Creature',
    oracle_text: '',
  }));

  game.importDeckResolved(p1, p1Deck);
  game.importDeckResolved(p2, p2Deck);

  game.applyEvent({ type: 'nextStep' });
  game.applyEvent({ type: 'nextStep' });
  game.applyEvent({ type: 'nextStep' });
}

function advanceToCombatDamage(game: ReturnType<typeof createInitialGameState>) {
  game.applyEvent({ type: 'nextStep' });
  game.applyEvent({ type: 'nextStep' });
  game.applyEvent({ type: 'nextStep' });
}

describe('combat damage infect/wither/poisonous', () => {
  it('infect + poisonous gives poison counters to the defending player instead of life loss (Rot Wolf pattern)', () => {
    const game = createInitialGameState('combat_infect_poisonous');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    game.applyEvent({ type: 'join', playerId: p2, name: 'P2' });
    setupToMain1(game, p1, p2);

    const active = game.state.turnPlayer as PlayerID;
    const defending = active === p1 ? p2 : p1;
    const lifeBefore = (game.state as any).life?.[defending] ?? 40;

    (game.state as any).battlefield = [
      {
        id: 'rot_wolf_1',
        controller: active,
        owner: active,
        tapped: false,
        counters: {},
        summoningSickness: false,
        basePower: 1,
        baseToughness: 1,
        card: {
          id: 'rot_wolf_card',
          name: 'Rot Wolf',
          type_line: 'Creature — Wolf',
          oracle_text: 'Infect (This creature deals damage to creatures in the form of -1/-1 counters and to players in the form of poison counters.)\nPoisonous 1 (Whenever this creature deals combat damage to a player, that player gets a poison counter.)',
          keywords: ['Infect', 'Poisonous'],
          power: '1',
          toughness: '1',
        },
      },
    ];

    advanceToCombatDamage(game);
    game.applyEvent({
      type: 'declareAttackers',
      playerId: active,
      attackers: [{ attackerId: 'rot_wolf_1', defendingPlayer: defending }],
    });
    game.applyEvent({ type: 'nextStep' });
    game.applyEvent({ type: 'nextStep' });

    const lifeAfter = (game.state as any).life?.[defending] ?? 40;
    const poisonFromState = (game.state as any).poisonCounters?.[defending] ?? 0;
    const defenderView = game.viewFor(defending);

    expect(lifeAfter).toBe(lifeBefore);
    expect(poisonFromState).toBe(2);
    expect(defenderView.poisonCounters?.[defending]).toBe(2);
  });

  it('infect combat damage places -1/-1 counters on blocking creatures instead of marked damage', () => {
    const game = createInitialGameState('combat_infect_creature');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    game.applyEvent({ type: 'join', playerId: p2, name: 'P2' });
    setupToMain1(game, p1, p2);

    const active = game.state.turnPlayer as PlayerID;
    const defending = active === p1 ? p2 : p1;

    (game.state as any).battlefield = [
      {
        id: 'infect_attacker',
        controller: active,
        owner: active,
        tapped: false,
        counters: {},
        summoningSickness: false,
        basePower: 2,
        baseToughness: 2,
        card: {
          id: 'infect_attacker_card',
          name: 'Infect Attacker',
          type_line: 'Creature — Phyrexian',
          oracle_text: 'Infect',
          keywords: ['Infect'],
          power: '2',
          toughness: '2',
        },
      },
      {
        id: 'blocker_creature',
        controller: defending,
        owner: defending,
        tapped: false,
        counters: {},
        summoningSickness: false,
        basePower: 3,
        baseToughness: 3,
        card: {
          id: 'blocker_creature_card',
          name: 'Sturdy Blocker',
          type_line: 'Creature — Soldier',
          oracle_text: '',
          power: '3',
          toughness: '3',
        },
      },
    ];

    advanceToCombatDamage(game);
    game.applyEvent({
      type: 'declareAttackers',
      playerId: active,
      attackers: [{ attackerId: 'infect_attacker', defendingPlayer: defending }],
    });
    game.applyEvent({ type: 'nextStep' });
    game.applyEvent({
      type: 'declareBlockers',
      playerId: defending,
      blockers: [{ blockerId: 'blocker_creature', attackerId: 'infect_attacker' }],
    });
    (game.state as any).blockersDeclaredBy = [defending];
    game.applyEvent({ type: 'nextStep' });

    const blocker = (game.state as any).battlefield.find((perm: any) => perm.id === 'blocker_creature');
    expect(blocker?.counters?.['-1/-1']).toBe(2);
    expect(blocker?.markedDamage || 0).toBe(0);
  });

  it('wither combat damage places -1/-1 counters on blocking creatures', () => {
    const game = createInitialGameState('combat_wither_creature');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    game.applyEvent({ type: 'join', playerId: p2, name: 'P2' });
    setupToMain1(game, p1, p2);

    const active = game.state.turnPlayer as PlayerID;
    const defending = active === p1 ? p2 : p1;

    (game.state as any).battlefield = [
      {
        id: 'wither_attacker',
        controller: active,
        owner: active,
        tapped: false,
        counters: {},
        summoningSickness: false,
        basePower: 1,
        baseToughness: 1,
        card: {
          id: 'wither_attacker_card',
          name: 'Wither Attacker',
          type_line: 'Creature — Elemental',
          oracle_text: 'Wither',
          keywords: ['Wither'],
          power: '1',
          toughness: '1',
        },
      },
      {
        id: 'wither_blocker',
        controller: defending,
        owner: defending,
        tapped: false,
        counters: {},
        summoningSickness: false,
        basePower: 2,
        baseToughness: 2,
        card: {
          id: 'wither_blocker_card',
          name: 'Blocker',
          type_line: 'Creature — Bear',
          oracle_text: '',
          power: '2',
          toughness: '2',
        },
      },
    ];

    advanceToCombatDamage(game);
    game.applyEvent({
      type: 'declareAttackers',
      playerId: active,
      attackers: [{ attackerId: 'wither_attacker', defendingPlayer: defending }],
    });
    game.applyEvent({ type: 'nextStep' });
    game.applyEvent({
      type: 'declareBlockers',
      playerId: defending,
      blockers: [{ blockerId: 'wither_blocker', attackerId: 'wither_attacker' }],
    });
    (game.state as any).blockersDeclaredBy = [defending];
    game.applyEvent({ type: 'nextStep' });

    const blocker = (game.state as any).battlefield.find((perm: any) => perm.id === 'wither_blocker');
    expect(blocker?.counters?.['-1/-1']).toBe(1);
    expect(blocker?.markedDamage || 0).toBe(0);
  });

  it('infect fight places -1/-1 counters on both creatures', () => {
    const game = createInitialGameState('combat_infect_fight');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    game.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    (game.state as any).battlefield = [
      {
        id: 'infect_fighter',
        controller: p1,
        owner: p1,
        basePower: 2,
        baseToughness: 2,
        card: {
          id: 'infect_fighter_card',
          name: 'Infect Fighter',
          type_line: 'Creature',
          oracle_text: 'Infect',
          keywords: ['Infect'],
          power: '2',
          toughness: '2',
        },
      },
      {
        id: 'blocker_fighter',
        controller: p2,
        owner: p2,
        basePower: 3,
        baseToughness: 3,
        card: {
          id: 'blocker_fighter_card',
          name: 'Blocker',
          type_line: 'Creature',
          oracle_text: '',
          power: '3',
          toughness: '3',
        },
      },
    ];

    game.applyEvent({
      type: 'fight',
      sourceId: 'infect_fighter',
      targetId: 'blocker_fighter',
      sourcePower: 2,
      targetPower: 3,
    });

    const infectFighter = (game.state as any).battlefield.find((perm: any) => perm.id === 'infect_fighter');
    const blockerFighter = (game.state as any).battlefield.find((perm: any) => perm.id === 'blocker_fighter');

    expect(infectFighter).toBeUndefined();
    expect(blockerFighter?.counters?.['-1/-1']).toBe(2);
    expect(blockerFighter?.markedDamage || 0).toBe(0);
  });

  it('dealDamage auto-detects infect from the source permanent', () => {
    const game = createInitialGameState('deal_damage_infect_autodetect');
    const p1 = 'p1' as PlayerID;

    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });

    (game.state as any).battlefield = [
      {
        id: 'infect_source',
        controller: p1,
        owner: p1,
        basePower: 1,
        baseToughness: 1,
        card: {
          id: 'infect_source_card',
          name: 'Infect Source',
          type_line: 'Creature',
          oracle_text: 'Infect',
          keywords: ['Infect'],
          power: '1',
          toughness: '1',
        },
      },
      {
        id: 'target_creature',
        controller: p1,
        owner: p1,
        basePower: 2,
        baseToughness: 2,
        card: {
          id: 'target_creature_card',
          name: 'Target',
          type_line: 'Creature',
          oracle_text: '',
          power: '2',
          toughness: '2',
        },
      },
    ];

    game.applyEvent({
      type: 'dealDamage',
      sourcePermanentId: 'infect_source',
      targetPermanentId: 'target_creature',
      amount: 1,
    });

    const target = (game.state as any).battlefield.find((perm: any) => perm.id === 'target_creature');
    expect(target?.counters?.['-1/-1']).toBe(1);
    expect(target?.markedDamage || 0).toBe(0);
  });

  it('proliferate lethal -1/-1 counters after infect combat triggers creature dies abilities', () => {
    const game = createInitialGameState('proliferate_infect_death_trigger');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    game.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    (game.state as any).battlefield = [
      {
        id: 'blood_artist',
        controller: p1,
        owner: p1,
        card: {
          id: 'blood_artist_card',
          name: 'Blood Artist',
          type_line: 'Creature — Vampire',
          oracle_text: 'Whenever Blood Artist or another creature dies, target player loses 1 life and you gain 1 life.',
        },
      },
      {
        id: 'wounded_blocker',
        controller: p2,
        owner: p2,
        basePower: 3,
        baseToughness: 3,
        counters: { '-1/-1': 2 },
        card: {
          id: 'wounded_blocker_card',
          name: 'Wounded Blocker',
          type_line: 'Creature — Soldier',
          oracle_text: '',
          power: '3',
          toughness: '3',
        },
      },
    ];

    game.applyEvent({
      type: 'proliferateResolve',
      playerId: p1,
      targetIds: ['wounded_blocker'],
    });

    const stillOnBattlefield = (game.state as any).battlefield.some((perm: any) => perm.id === 'wounded_blocker');
    expect(stillOnBattlefield).toBe(false);
    expect((game.state as any).stack?.some((item: any) =>
      String(item?.sourceName || item?.card?.name || '').includes('Blood Artist')
    )).toBe(true);
  });

  it('first-strike infect deals poison in the first strike damage step without life loss', () => {
    const game = createInitialGameState('combat_first_strike_infect_player');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    game.applyEvent({ type: 'join', playerId: p2, name: 'P2' });
    setupToMain1(game, p1, p2);

    const active = game.state.turnPlayer as PlayerID;
    const defending = active === p1 ? p2 : p1;
    const lifeBefore = (game.state as any).life?.[defending] ?? 40;

    (game.state as any).battlefield = [
      {
        id: 'fs_infect_attacker',
        controller: active,
        owner: active,
        tapped: false,
        counters: {},
        summoningSickness: false,
        basePower: 2,
        baseToughness: 2,
        card: {
          id: 'fs_infect_attacker_card',
          name: 'First Strike Infect',
          type_line: 'Creature — Phyrexian',
          oracle_text: 'First strike\nInfect',
          keywords: ['First strike', 'Infect'],
          power: '2',
          toughness: '2',
        },
      },
    ];

    advanceToCombatDamage(game);
    game.applyEvent({
      type: 'declareAttackers',
      playerId: active,
      attackers: [{ attackerId: 'fs_infect_attacker', defendingPlayer: defending }],
    });
    game.applyEvent({ type: 'nextStep' });
    game.applyEvent({ type: 'nextStep' });

    const stepAfterBlockers = String((game.state as any).step || '').toLowerCase();
    if (stepAfterBlockers.includes('first_strike_damage')) {
      game.applyEvent({ type: 'nextStep' });
    }

    expect((game.state as any).life?.[defending]).toBe(lifeBefore);
    expect((game.state as any).poisonCounters?.[defending]).toBe(2);
  });

  it('double-strike infect deals poison in both combat damage steps', () => {
    const game = createInitialGameState('combat_double_strike_infect_player');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    game.applyEvent({ type: 'join', playerId: p2, name: 'P2' });
    setupToMain1(game, p1, p2);

    const active = game.state.turnPlayer as PlayerID;
    const defending = active === p1 ? p2 : p1;

    (game.state as any).battlefield = [
      {
        id: 'ds_infect_attacker',
        controller: active,
        owner: active,
        tapped: false,
        counters: {},
        summoningSickness: false,
        basePower: 1,
        baseToughness: 1,
        card: {
          id: 'ds_infect_attacker_card',
          name: 'Double Strike Infect',
          type_line: 'Creature — Phyrexian',
          oracle_text: 'Double strike\nInfect',
          keywords: ['Double strike', 'Infect'],
          power: '1',
          toughness: '1',
        },
      },
    ];

    advanceToCombatDamage(game);
    game.applyEvent({
      type: 'declareAttackers',
      playerId: active,
      attackers: [{ attackerId: 'ds_infect_attacker', defendingPlayer: defending }],
    });
    game.applyEvent({ type: 'nextStep' });
    game.applyEvent({ type: 'nextStep' });

    const stepAfterBlockers = String((game.state as any).step || '').toLowerCase();
    if (stepAfterBlockers.includes('first_strike_damage')) {
      game.applyEvent({ type: 'nextStep' });
    }
    game.applyEvent({ type: 'nextStep' });

    expect((game.state as any).life?.[defending]).toBe(40);
    expect((game.state as any).poisonCounters?.[defending]).toBe(2);
  });

  it('Phyresis grants infect to the enchanted host so combat damage is poison, not life loss', () => {
    const game = createInitialGameState('combat_phyresis_infect');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    game.applyEvent({ type: 'join', playerId: p2, name: 'P2' });
    setupToMain1(game, p1, p2);

    const active = game.state.turnPlayer as PlayerID;
    const defending = active === p1 ? p2 : p1;
    const lifeBefore = (game.state as any).life?.[defending] ?? 40;

    (game.state as any).battlefield = [
      {
        id: 'phyresis_1',
        controller: active,
        owner: active,
        attachedTo: 'bear_1',
        tapped: false,
        counters: {},
        card: {
          id: 'phyresis_card',
          name: 'Phyresis',
          type_line: 'Enchantment — Aura',
          // mtg_data.db is_token=0
          oracle_text:
            'Enchant creature\nEnchanted creature has infect. (It deals damage to creatures in the form of -1/-1 counters and to players in the form of poison counters.)',
        },
      },
      {
        id: 'bear_1',
        controller: active,
        owner: active,
        tapped: false,
        counters: {},
        summoningSickness: false,
        basePower: 2,
        baseToughness: 2,
        attachedAuras: ['phyresis_1'],
        card: {
          id: 'bear_card',
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          oracle_text: '',
          power: '2',
          toughness: '2',
        },
      },
    ];

    advanceToCombatDamage(game);
    game.applyEvent({
      type: 'declareAttackers',
      playerId: active,
      attackers: [{ attackerId: 'bear_1', defendingPlayer: defending }],
    });
    game.applyEvent({ type: 'nextStep' });
    game.applyEvent({ type: 'nextStep' });

    const lifeAfter = (game.state as any).life?.[defending] ?? 40;
    const poisonFromState = (game.state as any).poisonCounters?.[defending] ?? 0;
    expect(lifeAfter).toBe(lifeBefore);
    expect(poisonFromState).toBe(2);
  });
});
