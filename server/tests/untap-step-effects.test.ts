import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';

function startOtherPlayerUntap(gameId: string, battlefield: any[]) {
  const game = createInitialGameState(gameId);
  const p1 = 'p1' as PlayerID;
  const p2 = 'p2' as PlayerID;
  game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
  game.applyEvent({ type: 'join', playerId: p2, name: 'P2' });
  (game.state as any).turnPlayer = p1;
  (game.state as any).activePlayer = p1;
  (game.state as any).priority = p1;
  (game.state as any).phase = 'beginning';
  (game.state as any).step = 'UNTAP';
  (game.state as any).stack = [];
  (game.state as any).battlefield = battlefield;
  return { game, p1, p2 };
}

describe('untap step effects', () => {
  it('applies Unwinding Clock during another player\'s untap step without reopening player actions', () => {
    const game = createInitialGameState('t_unwinding_clock_other_player_untap');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    game.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    (game.state as any).turnPlayer = p1;
    (game.state as any).activePlayer = p1;
    (game.state as any).priority = p1;
    (game.state as any).phase = 'beginning';
    (game.state as any).step = 'UNTAP';
    (game.state as any).stack = [];
    (game.state as any).battlefield = [
      {
        id: 'p1_land',
        controller: p1,
        owner: p1,
        tapped: true,
        card: {
          id: 'p1_land_card',
          name: 'Island',
          type_line: 'Basic Land — Island',
          oracle_text: '',
        },
      },
      {
        id: 'unwinding_clock',
        controller: p2,
        owner: p2,
        tapped: true,
        card: {
          id: 'unwinding_clock_card',
          name: 'Unwinding Clock',
          type_line: 'Artifact',
          oracle_text: "Untap all artifacts you control during each other player's untap step.",
        },
      },
      {
        id: 'mana_rock',
        controller: p2,
        owner: p2,
        tapped: true,
        card: {
          id: 'mana_rock_card',
          name: 'Sol Ring',
          type_line: 'Artifact',
          oracle_text: '{T}: Add {C}{C}.',
        },
      },
      {
        id: 'bear',
        controller: p2,
        owner: p2,
        tapped: true,
        card: {
          id: 'bear_card',
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          oracle_text: '',
        },
      },
    ];

    game.applyEvent({ type: 'nextStep' });

    const battlefield = (game.state as any).battlefield || [];
    const p1Land = battlefield.find((permanent: any) => permanent?.id === 'p1_land');
    const clock = battlefield.find((permanent: any) => permanent?.id === 'unwinding_clock');
    const manaRock = battlefield.find((permanent: any) => permanent?.id === 'mana_rock');
    const bear = battlefield.find((permanent: any) => permanent?.id === 'bear');

    expect(String((game.state as any).step || '').toUpperCase()).toBe('UPKEEP');
    expect(p1Land?.tapped).toBe(false);
    expect(clock?.tapped).toBe(false);
    expect(manaRock?.tapped).toBe(false);
    expect(bear?.tapped).toBe(true);
  });

  it("untaps Bender's Waterskin during another player's untap step without untapping other permanents", () => {
    const game = createInitialGameState('t_benders_waterskin_other_player_untap');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    game.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    (game.state as any).turnPlayer = p1;
    (game.state as any).activePlayer = p1;
    (game.state as any).priority = p1;
    (game.state as any).phase = 'beginning';
    (game.state as any).step = 'UNTAP';
    (game.state as any).stack = [];
    (game.state as any).battlefield = [
      {
        id: 'p1_land',
        controller: p1,
        owner: p1,
        tapped: true,
        card: {
          id: 'p1_land_card',
          name: 'Island',
          type_line: 'Basic Land — Island',
          oracle_text: '',
        },
      },
      {
        id: 'waterskin',
        controller: p2,
        owner: p2,
        tapped: true,
        card: {
          id: 'waterskin_card',
          name: "Bender's Waterskin",
          type_line: 'Artifact',
          oracle_text: "Untap this artifact during each other player's untap step.\n{T}: Add one mana of any color.",
        },
      },
      {
        id: 'sol_ring',
        controller: p2,
        owner: p2,
        tapped: true,
        card: {
          id: 'sol_ring_card',
          name: 'Sol Ring',
          type_line: 'Artifact',
          oracle_text: '{T}: Add {C}{C}.',
        },
      },
    ];

    game.applyEvent({ type: 'nextStep' });

    const battlefield = (game.state as any).battlefield || [];
    const waterskin = battlefield.find((permanent: any) => permanent?.id === 'waterskin');
    const solRing = battlefield.find((permanent: any) => permanent?.id === 'sol_ring');
    const p1Land = battlefield.find((permanent: any) => permanent?.id === 'p1_land');

    expect(String((game.state as any).step || '').toUpperCase()).toBe('UPKEEP');
    expect(p1Land?.tapped).toBe(false);
    expect(waterskin?.tapped).toBe(false);
    expect(solRing?.tapped).toBe(true);
  });

  it("untaps Endbringer during another player's untap step", () => {
    const game = createInitialGameState('t_endbringer_other_player_untap');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    game.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    (game.state as any).turnPlayer = p1;
    (game.state as any).activePlayer = p1;
    (game.state as any).priority = p1;
    (game.state as any).phase = 'beginning';
    (game.state as any).step = 'UNTAP';
    (game.state as any).stack = [];
    (game.state as any).battlefield = [
      {
        id: 'endbringer',
        controller: p2,
        owner: p2,
        tapped: true,
        card: {
          id: 'endbringer_card',
          name: 'Endbringer',
          type_line: 'Creature — Eldrazi',
          oracle_text: "Untap this creature during each other player's untap step.",
        },
      },
      {
        id: 'bear',
        controller: p2,
        owner: p2,
        tapped: true,
        card: {
          id: 'bear_card',
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          oracle_text: '',
        },
      },
    ];

    game.applyEvent({ type: 'nextStep' });

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield.find((permanent: any) => permanent?.id === 'endbringer')?.tapped).toBe(false);
    expect(battlefield.find((permanent: any) => permanent?.id === 'bear')?.tapped).toBe(true);
  });

  it("untaps Urban Burgeoning's enchanted land during another player's untap step", () => {
    const game = createInitialGameState('t_urban_burgeoning_other_player_untap');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    game.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    (game.state as any).turnPlayer = p1;
    (game.state as any).activePlayer = p1;
    (game.state as any).priority = p1;
    (game.state as any).phase = 'beginning';
    (game.state as any).step = 'UNTAP';
    (game.state as any).stack = [];
    (game.state as any).battlefield = [
      {
        id: 'forest_1',
        controller: p2,
        owner: p2,
        tapped: true,
        card: {
          id: 'forest_card',
          name: 'Forest',
          type_line: 'Basic Land — Forest',
          oracle_text: '{T}: Add {G}.',
        },
      },
      {
        id: 'burgeoning',
        controller: p2,
        owner: p2,
        tapped: false,
        attachedTo: 'forest_1',
        card: {
          id: 'burgeoning_card',
          name: 'Urban Burgeoning',
          type_line: 'Enchantment — Aura',
          oracle_text: 'Enchant land\nEnchanted land has "Untap this land during each other player\'s untap step."',
        },
      },
      {
        id: 'island_2',
        controller: p2,
        owner: p2,
        tapped: true,
        card: {
          id: 'island_card',
          name: 'Island',
          type_line: 'Basic Land — Island',
          oracle_text: '{T}: Add {U}.',
        },
      },
    ];

    game.applyEvent({ type: 'nextStep' });

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield.find((permanent: any) => permanent?.id === 'forest_1')?.tapped).toBe(false);
    expect(battlefield.find((permanent: any) => permanent?.id === 'island_2')?.tapped).toBe(true);
  });

  it("untaps Prophet of Kruphix's creatures and lands, not artifacts", () => {
    const { game } = startOtherPlayerUntap('t_prophet_kruphix_other_player_untap', [
      {
        id: 'prophet',
        controller: 'p2',
        owner: 'p2',
        tapped: true,
        card: {
          id: 'prophet_card',
          name: 'Prophet of Kruphix',
          type_line: 'Creature — Human Wizard',
          oracle_text: "Untap all creatures and lands you control during each other player's untap step.\nYou may cast creature spells as though they had flash.",
        },
      },
      {
        id: 'forest_1',
        controller: 'p2',
        owner: 'p2',
        tapped: true,
        card: { id: 'forest_card', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '{T}: Add {G}.' },
      },
      {
        id: 'sol_ring',
        controller: 'p2',
        owner: 'p2',
        tapped: true,
        card: { id: 'sol_card', name: 'Sol Ring', type_line: 'Artifact', oracle_text: '{T}: Add {C}{C}.' },
      },
    ]);

    game.applyEvent({ type: 'nextStep' });
    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield.find((permanent: any) => permanent?.id === 'prophet')?.tapped).toBe(false);
    expect(battlefield.find((permanent: any) => permanent?.id === 'forest_1')?.tapped).toBe(false);
    expect(battlefield.find((permanent: any) => permanent?.id === 'sol_ring')?.tapped).toBe(true);
  });

  it('untaps Murkfiend Liege green and/or blue creatures only', () => {
    const { game } = startOtherPlayerUntap('t_murkfiend_other_player_untap', [
      {
        id: 'liege',
        controller: 'p2',
        owner: 'p2',
        tapped: true,
        card: {
          id: 'liege_card',
          name: 'Murkfiend Liege',
          type_line: 'Creature — Horror',
          colors: ['G', 'U'],
          oracle_text: "Other green creatures you control get +1/+1.\nOther blue creatures you control get +1/+1.\nUntap all green and/or blue creatures you control during each other player's untap step.",
        },
      },
      {
        id: 'bear',
        controller: 'p2',
        owner: 'p2',
        tapped: true,
        card: { id: 'bear_card', name: 'Grizzly Bears', type_line: 'Creature — Bear', colors: ['G'] },
      },
      {
        id: 'goblin',
        controller: 'p2',
        owner: 'p2',
        tapped: true,
        card: { id: 'goblin_card', name: 'Goblin Piker', type_line: 'Creature — Goblin Warrior', colors: ['R'] },
      },
    ]);

    game.applyEvent({ type: 'nextStep' });
    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield.find((permanent: any) => permanent?.id === 'liege')?.tapped).toBe(false);
    expect(battlefield.find((permanent: any) => permanent?.id === 'bear')?.tapped).toBe(false);
    expect(battlefield.find((permanent: any) => permanent?.id === 'goblin')?.tapped).toBe(true);
  });

  it('untaps Ohabi Caleria Archers only', () => {
    const { game } = startOtherPlayerUntap('t_ohabi_archers_other_player_untap', [
      {
        id: 'ohabi',
        controller: 'p2',
        owner: 'p2',
        tapped: true,
        card: {
          id: 'ohabi_card',
          name: 'Ohabi Caleria',
          type_line: 'Legendary Creature — Elf Archer',
          oracle_text: "Reach\nUntap all Archers you control during each other player's untap step.",
        },
      },
      {
        id: 'bear',
        controller: 'p2',
        owner: 'p2',
        tapped: true,
        card: { id: 'bear_card', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
      },
    ]);

    game.applyEvent({ type: 'nextStep' });
    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield.find((permanent: any) => permanent?.id === 'ohabi')?.tapped).toBe(false);
    expect(battlefield.find((permanent: any) => permanent?.id === 'bear')?.tapped).toBe(true);
  });

  it('untaps Ivorytusk Fortress creatures that have +1/+1 counters', () => {
    const { game } = startOtherPlayerUntap('t_ivorytusk_other_player_untap', [
      {
        id: 'ivorytusk',
        controller: 'p2',
        owner: 'p2',
        tapped: true,
        card: {
          id: 'ivorytusk_card',
          name: 'Ivorytusk Fortress',
          type_line: 'Creature — Elephant',
          oracle_text: "Untap each creature you control with a +1/+1 counter on it during each other player's untap step.",
        },
      },
      {
        id: 'buffed',
        controller: 'p2',
        owner: 'p2',
        tapped: true,
        counters: { '+1/+1': 1 },
        card: { id: 'buffed_card', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
      },
      {
        id: 'plain_bear',
        controller: 'p2',
        owner: 'p2',
        tapped: true,
        card: { id: 'plain_bear_card', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
      },
    ]);

    game.applyEvent({ type: 'nextStep' });
    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield.find((permanent: any) => permanent?.id === 'buffed')?.tapped).toBe(false);
    expect(battlefield.find((permanent: any) => permanent?.id === 'plain_bear')?.tapped).toBe(true);
    expect(battlefield.find((permanent: any) => permanent?.id === 'ivorytusk')?.tapped).toBe(true);
  });

  it('untaps Quest for Renewal creatures only once it has four quest counters', () => {
    const { game } = startOtherPlayerUntap('t_quest_renewal_other_player_untap', [
      {
        id: 'quest',
        controller: 'p2',
        owner: 'p2',
        tapped: false,
        counters: { quest: 4 },
        card: {
          id: 'quest_card',
          name: 'Quest for Renewal',
          type_line: 'Enchantment',
          oracle_text: "Whenever a creature you control becomes tapped, you may put a quest counter on this enchantment.\nAs long as there are four or more quest counters on this enchantment, untap all creatures you control during each other player's untap step.",
        },
      },
      {
        id: 'bear',
        controller: 'p2',
        owner: 'p2',
        tapped: true,
        card: { id: 'bear_card', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
      },
    ]);

    game.applyEvent({ type: 'nextStep' });
    expect(((game.state as any).battlefield || []).find((permanent: any) => permanent?.id === 'bear')?.tapped).toBe(false);
  });

  it('does not apply Quest for Renewal with fewer than four quest counters', () => {
    const { game } = startOtherPlayerUntap('t_quest_renewal_too_few_counters', [
      {
        id: 'quest',
        controller: 'p2',
        owner: 'p2',
        tapped: false,
        counters: { quest: 3 },
        card: {
          id: 'quest_card',
          name: 'Quest for Renewal',
          type_line: 'Enchantment',
          oracle_text: "Whenever a creature you control becomes tapped, you may put a quest counter on this enchantment.\nAs long as there are four or more quest counters on this enchantment, untap all creatures you control during each other player's untap step.",
        },
      },
      {
        id: 'bear',
        controller: 'p2',
        owner: 'p2',
        tapped: true,
        card: { id: 'bear_card', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
      },
    ]);

    game.applyEvent({ type: 'nextStep' });
    expect(((game.state as any).battlefield || []).find((permanent: any) => permanent?.id === 'bear')?.tapped).toBe(true);
  });
});