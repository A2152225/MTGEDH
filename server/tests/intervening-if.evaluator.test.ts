import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { isInterveningIfSatisfied } from '../src/state/modules/triggers/intervening-if';

function addPlayer(g: any, id: PlayerID, name: string) {
  g.applyEvent({ type: 'join', playerId: id, name });
}

describe('Intervening-if evaluator (expanded templates)', () => {
  it('supports comma-delimited upkeep template: "At the beginning of your upkeep, if no opponent has more life than you"', () => {
    const g = createInitialGameState('t_intervening_if_eval_life_no_opp_more');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    (g.state as any).life = { [p1]: 10, [p2]: 9 };

    const desc = 'At the beginning of your upkeep, if no opponent has more life than you, abandon this scheme.';
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(true);

    (g.state as any).life = { [p1]: 10, [p2]: 11 };
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(false);
  });

  it('supports comma-delimited upkeep template: "..., if an opponent has more life than you"', () => {
    const g = createInitialGameState('t_intervening_if_eval_life_opp_more');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    const desc = 'At the beginning of your upkeep, if an opponent has more life than you, you gain 1 life.';

    (g.state as any).life = { [p1]: 10, [p2]: 11 };
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(true);

    (g.state as any).life = { [p1]: 10, [p2]: 10 };
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(false);
  });

  it('supports "If it\'s your turn"', () => {
    const g = createInitialGameState('t_intervening_if_eval_your_turn');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    (g.state as any).turnPlayer = p1;

    expect(isInterveningIfSatisfied(g as any, String(p1), "If it's your turn, draw a card.")).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p2), "If it's your turn, draw a card.")).toBe(false);
  });

  it('supports "If it\'s not your turn" / "If it\'s an opponent\'s turn"', () => {
    const g = createInitialGameState('t_intervening_if_eval_not_your_turn');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    (g.state as any).turnPlayer = p1;

    expect(isInterveningIfSatisfied(g as any, String(p1), "If it's not your turn, draw a card.")).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p2), "If it's not your turn, draw a card.")).toBe(true);

    expect(isInterveningIfSatisfied(g as any, String(p1), "If it's an opponent's turn, draw a card.")).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p2), "If it's an opponent's turn, draw a card.")).toBe(true);
  });

  it('supports day/night transition templates: "If it became day/night this turn" (including "day became night")', () => {
    const g = createInitialGameState('t_intervening_if_eval_became_day_night');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).dayNightChangedThisTurn = true;
    (g.state as any).dayNightChangedTo = 'day';
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If it became day this turn, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If it became night this turn, draw a card.')).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If night became day this turn, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If day became night this turn, draw a card.')).toBe(false);

    (g.state as any).dayNightChangedTo = 'night';
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If it became night this turn, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If it became day this turn, draw a card.')).toBe(false);
  });

  it('supports "If you control exactly N lands"', () => {
    const g = createInitialGameState('t_intervening_if_eval_exactly');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    (g.state as any).battlefield = [
      { id: 'l1', controller: p1, owner: p1, card: { name: 'Plains', type_line: 'Basic Land — Plains' } },
      { id: 'l2', controller: p1, owner: p1, card: { name: 'Island', type_line: 'Basic Land — Island' } },
    ];

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control exactly two lands, draw a card.')).toBe(true);

    (g.state as any).battlefield.push({
      id: 'l3',
      controller: p1,
      owner: p1,
      card: { name: 'Swamp', type_line: 'Basic Land — Swamp' },
    });

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control exactly two lands, draw a card.')).toBe(false);
  });

  it('supports additional life thresholds: "or less", "less than", "more than", "exactly"', () => {
    const g = createInitialGameState('t_intervening_if_eval_life_thresholds');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).life = { [p1]: 10 };

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have ten or less life, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have less than ten life, draw a card.')).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have more than nine life, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have exactly ten life, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have exactly nine life, draw a card.')).toBe(false);
  });

  it('supports hand-size thresholds: "or fewer", "or more", "exactly"', () => {
    const g = createInitialGameState('t_intervening_if_eval_hand_thresholds');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).zones = {
      [p1]: { handCount: 2 },
    };

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have two or fewer cards in hand, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have one or fewer cards in hand, draw a card.')).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have two or more cards in hand, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have exactly two cards in hand, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have exactly three cards in hand, draw a card.')).toBe(false);
  });

  it('supports "If you control a/an <type>" existence checks', () => {
    const g = createInitialGameState('t_intervening_if_eval_exists');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    (g.state as any).battlefield = [];
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control an artifact, draw a card.')).toBe(false);

    (g.state as any).battlefield.push({
      id: 'a1',
      controller: p1,
      owner: p1,
      card: { name: 'Sol Ring', type_line: 'Artifact' },
    });

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control an artifact, draw a card.')).toBe(true);
  });

  it('supports "..., if N or more spells were cast this turn"', () => {
    const g = createInitialGameState('t_intervening_if_eval_spells_cast_this_turn');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    const desc = "At the beginning of each end step, if four or more spells were cast this turn, abandon this scheme.";

    (g.state as any).spellsCastThisTurn = ['s1', 's2', 's3', 's4'];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(true);

    (g.state as any).spellsCastThisTurn = ['s1', 's2', 's3'];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(false);
  });

  it('supports "If you attacked with N or more creatures this turn"', () => {
    const g = createInitialGameState('t_intervening_if_eval_attacked_with_n');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    const desc = 'If you attacked with three or more creatures this turn, draw a card.';

    (g.state as any).creaturesAttackedThisTurn = { [p1]: 3, [p2]: 0 };
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p2), desc)).toBe(false);

    (g.state as any).creaturesAttackedThisTurn = { [p1]: 2 };
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(false);
  });

  it('supports Renown template: "..., if it isn\'t renowned" (requires source permanent)', () => {
    const g = createInitialGameState('t_intervening_if_eval_renown');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const desc = "When this creature deals combat damage to a player, if it isn't renowned, put a +1/+1 counter on it and it becomes renowned.";

    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { renowned: false })).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { renowned: true })).toBe(false);

    // Without a source permanent, this clause is intentionally treated as unknown.
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(null);
  });

  it("supports designation templates: monarch / initiative / city's blessing", () => {
    const g = createInitialGameState('t_intervening_if_eval_designations');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    (g.state as any).monarch = p1;
    (g.state as any).initiative = p2;
    (g.state as any).cityBlessing = { [p1]: true, [p2]: false };

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you are the monarch, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p2), 'If you are the monarch, draw a card.')).toBe(false);

    expect(isInterveningIfSatisfied(g as any, String(p2), 'If you have the initiative, venture into the dungeon.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have the initiative, venture into the dungeon.')).toBe(false);

    expect(isInterveningIfSatisfied(g as any, String(p1), "If you have the city's blessing, draw a card.")).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p2), "If you have the city's blessing, draw a card.")).toBe(false);
  });

  it('supports graveyard-name check: "If <card> is in your graveyard"', () => {
    const g = createInitialGameState('t_intervening_if_eval_gy_name');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).zones = {
      [p1]: {
        graveyard: [{ id: 'c1', name: 'Lightning Bolt', type_line: 'Instant' }],
      },
    };

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If Lightning Bolt is in your graveyard, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If Black Lotus is in your graveyard, draw a card.')).toBe(false);
  });

  it('supports delirium: "If there are four or more card types among cards in your graveyard"', () => {
    const g = createInitialGameState('t_intervening_if_eval_delirium');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).zones = {
      [p1]: {
        graveyard: [
          { id: 'a', name: 'A', type_line: 'Artifact' },
          { id: 'c', name: 'C', type_line: 'Creature — Bear' },
          { id: 'i', name: 'I', type_line: 'Instant' },
          { id: 'l', name: 'L', type_line: 'Land' },
        ],
      },
    };

    expect(
      isInterveningIfSatisfied(
        g as any,
        String(p1),
        'If there are four or more card types among cards in your graveyard, draw a card.'
      )
    ).toBe(true);
  });

  it('supports ferocious-style power threshold: "If you control a creature with power 4 or greater"', () => {
    const g = createInitialGameState('t_intervening_if_eval_ferocious');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).battlefield = [
      { id: 'c1', controller: p1, owner: p1, card: { name: 'Hill Giant', type_line: 'Creature — Giant', power: '3', toughness: '3' } },
    ];

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control a creature with power 4 or greater, draw a card.')).toBe(false);

    (g.state as any).battlefield.push({
      id: 'c2',
      controller: p1,
      owner: p1,
      card: { name: 'Craw Wurm', type_line: 'Creature — Wurm', power: '6', toughness: '4' },
    });

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control a creature with power 4 or greater, draw a card.')).toBe(true);
  });

  it('supports pack tactics total power: "If you attacked with creatures with total power 6 or greater"', () => {
    const g = createInitialGameState('t_intervening_if_eval_pack_tactics');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).battlefield = [
      {
        id: 'a1',
        controller: p1,
        owner: p1,
        attacking: 'pX',
        card: { name: 'A', type_line: 'Creature', power: '3', toughness: '3' },
      },
      {
        id: 'a2',
        controller: p1,
        owner: p1,
        attacking: 'pX',
        card: { name: 'B', type_line: 'Creature', power: '2', toughness: '2' },
      },
    ];

    expect(
      isInterveningIfSatisfied(
        g as any,
        String(p1),
        'If you attacked with creatures with total power 6 or greater, create a Treasure token.'
      )
    ).toBe(false);

    (g.state as any).battlefield.push({
      id: 'a3',
      controller: p1,
      owner: p1,
      attacking: 'pX',
      card: { name: 'C', type_line: 'Creature', power: '1', toughness: '1' },
    });

    expect(
      isInterveningIfSatisfied(
        g as any,
        String(p1),
        'If you attacked with creatures with total power 6 or greater, create a Treasure token.'
      )
    ).toBe(true);
  });

  it('supports morbid/revolt per-turn flags', () => {
    const g = createInitialGameState('t_intervening_if_eval_morbid_revolt');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).creatureDiedThisTurn = true;
    (g.state as any).permanentLeftBattlefieldThisTurn = { [p1]: true };

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If a creature died this turn, draw a card.')).toBe(true);
    expect(
      isInterveningIfSatisfied(g as any, String(p1), 'If a permanent you controlled left the battlefield this turn, draw a card.')
    ).toBe(true);
  });

  it("supports spell-history templates: 'another spell this turn' and 'no spells cast last turn'", () => {
    const g = createInitialGameState('t_intervening_if_eval_spell_history');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).spellsCastThisTurn = [{ casterId: p1 }];
    expect(isInterveningIfSatisfied(g as any, String(p1), "If you've cast another spell this turn, draw a card.")).toBe(false);

    (g.state as any).spellsCastThisTurn.push({ casterId: p1 });
    expect(isInterveningIfSatisfied(g as any, String(p1), "If you've cast another spell this turn, draw a card.")).toBe(true);

    (g.state as any).spellsCastLastTurnCount = 0;
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If no spells were cast last turn, draw a card.')).toBe(true);

    (g.state as any).spellsCastLastTurnCount = 2;
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If no spells were cast last turn, draw a card.')).toBe(false);
  });

  it('supports day/night style: "If a player cast two or more spells last turn" / "If an opponent cast two or more spells last turn"', () => {
    const g = createInitialGameState('t_intervening_if_eval_last_turn_two_spells');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    (g.state as any).spellsCastLastTurnByPlayerCounts = { [p1]: 1, [p2]: 2 };

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If a player cast two or more spells last turn, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If an opponent cast two or more spells last turn, draw a card.')).toBe(true);

    (g.state as any).spellsCastLastTurnByPlayerCounts = { [p1]: 2, [p2]: 1 };
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If a player cast two or more spells last turn, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If an opponent cast two or more spells last turn, draw a card.')).toBe(false);
  });

  it('supports source permanent checks: untapped / enchanted / enchanted or equipped', () => {
    const g = createInitialGameState('t_intervening_if_eval_enchanted_untapped');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    // Put an Aura and an Equipment onto the battlefield so attachment lookups work
    (g.state as any).battlefield = [
      { id: 'aura1', controller: p1, owner: p1, card: { name: 'Pacifism', type_line: 'Enchantment — Aura' } },
      { id: 'eq1', controller: p1, owner: p1, card: { name: 'Short Sword', type_line: 'Artifact — Equipment' } },
    ];

    const source = { id: 'c1', controller: p1, owner: p1, tapped: false, attachments: ['aura1'] };
    expect(isInterveningIfSatisfied(g as any, String(p1), "If it's untapped, draw a card.", source)).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), "If it's enchanted, draw a card.", source)).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), "If it's enchanted or equipped, draw a card.", source)).toBe(true);

    const equippedOnly = { id: 'c2', controller: p1, owner: p1, tapped: true, attachments: ['eq1'] };
    expect(isInterveningIfSatisfied(g as any, String(p1), "If it's untapped, draw a card.", equippedOnly)).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), "If it's enchanted, draw a card.", equippedOnly)).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), "If it's enchanted or equipped, draw a card.", equippedOnly)).toBe(true);
  });

  it('supports control templates: "If you control an enchanted creature" / "If you control an equipped creature"', () => {
    const g = createInitialGameState('t_intervening_if_eval_control_enchanted_equipped');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).battlefield = [
      { id: 'aura1', controller: p1, owner: p1, card: { name: 'Pacifism', type_line: 'Enchantment — Aura' } },
      { id: 'eq1', controller: p1, owner: p1, card: { name: 'Short Sword', type_line: 'Artifact — Equipment' } },
      {
        id: 'c1',
        controller: p1,
        owner: p1,
        card: { name: 'Bear', type_line: 'Creature — Bear', power: '2', toughness: '2' },
        attachments: ['aura1'],
      },
    ];

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control an enchanted creature, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control an equipped creature, draw a card.')).toBe(false);

    // Attach equipment to the creature as well
    (g.state as any).battlefield.find((p: any) => p.id === 'c1').attachments.push('eq1');
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control an equipped creature, draw a card.')).toBe(true);
  });

  it('supports combat state templates: attacking / blocking / blocked / unblocked (requires source permanent)', () => {
    const g = createInitialGameState('t_intervening_if_eval_combat_state');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    const attacker = {
      id: 'a1',
      controller: p1,
      owner: p1,
      attacking: p2,
      blockedBy: ['b1'],
      card: { name: 'Attacker', type_line: 'Creature', power: '2', toughness: '2' },
    };
    const blocker = {
      id: 'b1',
      controller: p2,
      owner: p2,
      blocking: ['a1'],
      card: { name: 'Blocker', type_line: 'Creature', power: '2', toughness: '2' },
    };
    (g.state as any).battlefield = [attacker, blocker];

    expect(isInterveningIfSatisfied(g as any, String(p1), "If it's attacking, draw a card.", attacker)).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), "If it's blocked, draw a card.", attacker)).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), "If it's unblocked, draw a card.", attacker)).toBe(false);

    expect(isInterveningIfSatisfied(g as any, String(p2), "If it's blocking, draw a card.", blocker)).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p2), "If it's blocked, draw a card.", blocker)).toBe(false);
  });

  it("supports 'first spell you cast this turn'", () => {
    const g = createInitialGameState('t_intervening_if_eval_first_spell');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).spellsCastThisTurn = [{ casterId: p1 }];
    expect(isInterveningIfSatisfied(g as any, String(p1), "If it's the first spell you've cast this turn, draw a card.")).toBe(true);

    (g.state as any).spellsCastThisTurn.push({ casterId: p1 });
    expect(isInterveningIfSatisfied(g as any, String(p1), "If it's the first spell you cast this turn, draw a card.")).toBe(false);
  });

  it('supports graveyard count templates and threshold', () => {
    const g = createInitialGameState('t_intervening_if_eval_graveyard_counts');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).zones = {
      [p1]: {
        graveyard: Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, name: `C${i}`, type_line: 'Instant' })),
      },
    };

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have six or more cards in your graveyard, draw a card.')).toBe(true);

    // Threshold should be false at 6
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have threshold, draw a card.')).toBe(false);

    // Add one more card to hit 7
    (g.state as any).zones[p1].graveyard.push({ id: 'c6', name: 'C6', type_line: 'Sorcery' });
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If seven or more cards are in your graveyard, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have threshold, draw a card.')).toBe(true);

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have exactly seven cards in your graveyard, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have six or fewer cards in your graveyard, draw a card.')).toBe(false);
  });

  it('supports library count variants: fewer / exactly', () => {
    const g = createInitialGameState('t_intervening_if_eval_library_counts');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).zones = {
      [p1]: {
        libraryCount: 1,
      },
    };

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have one or fewer cards in your library, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have exactly one card in your library, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have two or fewer cards in your library, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have exactly two cards in your library, draw a card.')).toBe(false);
  });

  it('supports keyword shorthands: delirium / hellbent / metalcraft', () => {
    const g = createInitialGameState('t_intervening_if_eval_shorthands');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    // delirium (4+ types in graveyard)
    (g.state as any).zones = {
      [p1]: {
        graveyard: [
          { id: 'a', name: 'A', type_line: 'Artifact' },
          { id: 'c', name: 'C', type_line: 'Creature — Bear' },
          { id: 'i', name: 'I', type_line: 'Instant' },
          { id: 'l', name: 'L', type_line: 'Land' },
        ],
        handCount: 0,
      },
    };
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have delirium, draw a card.')).toBe(true);

    // hellbent (no cards in hand)
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have hellbent, draw a card.')).toBe(true);

    // metalcraft (3+ artifacts)
    (g.state as any).battlefield = [
      { id: 'a1', controller: p1, owner: p1, card: { name: 'Sol Ring', type_line: 'Artifact' } },
      { id: 'a2', controller: p1, owner: p1, card: { name: 'Arcane Signet', type_line: 'Artifact' } },
    ];
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have metalcraft, draw a card.')).toBe(false);
    (g.state as any).battlefield.push({
      id: 'a3',
      controller: p1,
      owner: p1,
      card: { name: 'Mind Stone', type_line: 'Artifact' },
    });
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have metalcraft, draw a card.')).toBe(true);
  });

  it('supports turn-history checks: life gained / opponent lost life / cards drawn / land entered', () => {
    const g = createInitialGameState('t_intervening_if_eval_turn_history_common');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    (g.state as any).lifeGainedThisTurn = { [p1]: 3 };
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you gained three or more life this turn, draw a card.')).toBe(true);
    (g.state as any).lifeGainedThisTurn = { [p1]: 2 };
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have gained three or more life this turn, draw a card.')).toBe(false);

    (g.state as any).lifeLostThisTurn = { [p2]: 1 };
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If an opponent lost life this turn, exile the top card of your library.')).toBe(true);
    (g.state as any).lifeLostThisTurn = { [p2]: 0 };
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If an opponent lost life this turn, exile the top card of your library.')).toBe(false);

    (g.state as any).cardsDrawnThisTurn = { [p1]: 2 };
    expect(isInterveningIfSatisfied(g as any, String(p1), "If you've drawn two or more cards this turn, create a token.")).toBe(true);
    (g.state as any).cardsDrawnThisTurn = { [p1]: 1 };
    expect(isInterveningIfSatisfied(g as any, String(p1), "If you've drawn two or more cards this turn, create a token.")).toBe(false);

    (g.state as any).landsEnteredBattlefieldThisTurn = { [p1]: 1 };
    expect(
      isInterveningIfSatisfied(g as any, String(p1), 'If a land entered the battlefield under your control this turn, draw a card.')
    ).toBe(true);
    (g.state as any).landsEnteredBattlefieldThisTurn = { [p1]: 0 };
    expect(
      isInterveningIfSatisfied(g as any, String(p1), 'If a land entered the battlefield under your control this turn, draw a card.')
    ).toBe(false);
  });

  it('supports graveyard creature density and empty-library checks', () => {
    const g = createInitialGameState('t_intervening_if_eval_gy_density_empty_lib');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).zones = {
      [p1]: {
        graveyard: [
          { id: 'c1', name: 'C1', type_line: 'Creature — Bear' },
          { id: 'c2', name: 'C2', type_line: 'Creature — Elf' },
          { id: 'i1', name: 'I1', type_line: 'Instant' },
        ],
        libraryCount: 0,
      },
    };

    expect(
      isInterveningIfSatisfied(g as any, String(p1), 'If there are two or more creature cards in your graveyard, draw a card.')
    ).toBe(true);
    expect(
      isInterveningIfSatisfied(g as any, String(p1), 'If there are three or more creature cards in your graveyard, draw a card.')
    ).toBe(false);

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have no cards in your library, you win the game.')).toBe(true);
  });

  it('supports source checks: kicked / modified / +1/+1 counter / tapped / token', () => {
    const g = createInitialGameState('t_intervening_if_eval_source_common');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const kickedSource = { id: 's1', controller: p1, owner: p1, card: { wasKicked: true } };
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If it was kicked, draw two cards.', kickedSource)).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If it was kicked, draw two cards.')).toBe(null);

    (g.state as any).battlefield = [
      { id: 'aura1', controller: p1, owner: p1, card: { name: 'Aura', type_line: 'Enchantment — Aura' } },
    ];
    const modified = { id: 'm1', controller: p1, owner: p1, attachments: ['aura1'] };
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If this creature is modified, draw a card.', modified)).toBe(true);

    const hasCounter = { id: 'c1', controller: p1, owner: p1, counters: { '+1/+1': 1 } };
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If it has a +1/+1 counter on it, draw a card.', hasCounter)).toBe(true);

    const tappedToken = { id: 't1', controller: p1, owner: p1, tapped: true, isToken: true };
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If it is tapped, draw a card.', tappedToken)).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If it is a token, draw a card.', tappedToken)).toBe(true);
  });

  it('supports common permanent-count checks: treasures / gates / snow / desert / basic types / domain', () => {
    const g = createInitialGameState('t_intervening_if_eval_counts_domain');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).battlefield = [
      // Treasures
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `tr${i}`,
        controller: p1,
        owner: p1,
        card: { name: `Treasure ${i}`, type_line: 'Artifact — Treasure' },
      })),
      // Gates
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `g${i}`,
        controller: p1,
        owner: p1,
        card: { name: `Gate ${i}`, type_line: 'Land — Gate' },
      })),
      // Snow permanents
      { id: 'sn1', controller: p1, owner: p1, card: { name: 'Snow Land', type_line: 'Snow Land — Forest' } },
      { id: 'sn2', controller: p1, owner: p1, card: { name: 'Snow Artifact', type_line: 'Snow Artifact' } },
      { id: 'sn3', controller: p1, owner: p1, card: { name: 'Snow Creature', type_line: 'Snow Creature — Bear' } },
      // Desert
      { id: 'd1', controller: p1, owner: p1, card: { name: 'Desert', type_line: 'Land — Desert' } },
      // Domain basics
      { id: 'pl', controller: p1, owner: p1, card: { name: 'Plains', type_line: 'Basic Land — Plains' } },
      { id: 'is', controller: p1, owner: p1, card: { name: 'Island', type_line: 'Basic Land — Island' } },
      { id: 'sw', controller: p1, owner: p1, card: { name: 'Swamp', type_line: 'Basic Land — Swamp' } },
      { id: 'mo', controller: p1, owner: p1, card: { name: 'Mountain', type_line: 'Basic Land — Mountain' } },
      { id: 'fo', controller: p1, owner: p1, card: { name: 'Forest', type_line: 'Basic Land — Forest' } },
    ];

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control ten or more Treasures, you win the game.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control ten or more Gates, you win the game.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control three or more snow permanents, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control a Desert, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control a Plains, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control lands of each basic land type, draw a card.')).toBe(true);
  });

  it('supports battalion, blocking checks, party, legendary/named, poison, mana value, and source-dealt-damage-to-opponent', () => {
    const g = createInitialGameState('t_intervening_if_eval_misc_common');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    const battalionSource = { id: 'a1', controller: p1, owner: p1, attacking: p2, card: { name: 'A', type_line: 'Creature', power: '2', toughness: '2' } };
    (g.state as any).battlefield = [
      battalionSource,
      { id: 'a2', controller: p1, owner: p1, attacking: p2, card: { name: 'B', type_line: 'Creature', power: '2', toughness: '2' } },
      { id: 'a3', controller: p1, owner: p1, attacking: p2, card: { name: 'C', type_line: 'Creature', power: '2', toughness: '2' } },
    ];
    expect(
      isInterveningIfSatisfied(g as any, String(p1), 'If this creature and at least two other creatures are attacking, draw a card.', battalionSource)
    ).toBe(true);

    // Blocking a red creature
    const blocker = { id: 'b1', controller: p1, owner: p1, blocking: ['red1'] };
    (g.state as any).battlefield.push({
      id: 'red1',
      controller: p2,
      owner: p2,
      card: { name: 'Red Guy', type_line: 'Creature — Goblin', colors: ['R'] },
    });
    expect(isInterveningIfSatisfied(g as any, String(p1), "If it's blocking a red creature, draw a card.", blocker)).toBe(true);

    // Full party
    (g.state as any).battlefield = [
      { id: 'cl', controller: p1, owner: p1, card: { name: 'Cleric', type_line: 'Creature — Cleric' } },
      { id: 'ro', controller: p1, owner: p1, card: { name: 'Rogue', type_line: 'Creature — Rogue' } },
      { id: 'wa', controller: p1, owner: p1, card: { name: 'Warrior', type_line: 'Creature — Warrior' } },
      { id: 'wi', controller: p1, owner: p1, card: { name: 'Wizard', type_line: 'Creature — Wizard' } },
    ];
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have a full party, draw a card.')).toBe(true);

    // Legendary + named
    (g.state as any).battlefield.push({
      id: 'leg',
      controller: p1,
      owner: p1,
      card: { name: 'Kellan', type_line: 'Legendary Creature — Human' },
    });
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control a legendary creature, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control a creature named Kellan, draw a card.')).toBe(true);

    // Poison counters
    (g.state as any).poisonCounters = { [p2]: 3 };
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If an opponent has three or more poison counters, draw a card.')).toBe(true);

    // Mana value threshold
    (g.state as any).battlefield.push({
      id: 'mv5',
      controller: p1,
      owner: p1,
      card: { name: 'Big', type_line: 'Artifact', cmc: 5 },
    });
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control a permanent with mana value five or greater, draw a card.')).toBe(true);

    // Source dealt damage to an opponent this turn
    (g.state as any).creaturesThatDealtDamageToPlayer = {
      [p2]: { src1: { creatureName: 'Hit', totalDamage: 2 } },
    };
    const src1 = { id: 'src1', controller: p1, owner: p1 };
    expect(
      isInterveningIfSatisfied(g as any, String(p1), 'If it dealt damage to an opponent this turn, draw a card.', src1)
    ).toBe(true);
  });

  it('supports cast-time metadata: "If you cast it during your main phase"', () => {
    const g = createInitialGameState('t_intervening_if_eval_cast_timing');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const srcTrue = { id: 's1', controller: p1, owner: p1, castDuringOwnMainPhase: true };
    const srcFalse = { id: 's2', controller: p1, owner: p1, castDuringOwnMainPhase: false };

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you cast it during your main phase, draw a card.', srcTrue)).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you cast it during your main phase, draw a card.', srcFalse)).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you cast it during your main phase, draw a card.')).toBe(null);
  });

  it('supports foretold metadata: "If it/that spell was foretold"', () => {
    const g = createInitialGameState('t_intervening_if_eval_foretold');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If it was foretold, draw a card.', { card: { castFromForetell: true } })).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If that spell was foretold, draw a card.', { castFromForetell: false })).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If it was foretold, draw a card.')).toBe(null);
  });

  it('supports mana colors spent to cast: "If {R} was spent..." and "If N colors..."', () => {
    const g = createInitialGameState('t_intervening_if_eval_mana_spent');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const src = { manaColorsSpent: ['red', 'green'] };
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If {R} was spent to cast it, draw a card.', src)).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If blue mana was spent to cast this spell, draw a card.', src)).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If two or more colors of mana were spent to cast it, draw a card.', src)).toBe(true);
  });

  it('supports chosen-color clauses: "If you chose red" / "If the chosen color is red"', () => {
    const g = createInitialGameState('t_intervening_if_eval_chosen_color');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you chose red, draw a card.', { chosenColor: 'red' })).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If the chosen color is blue, draw a card.', { chosenColor: 'red' })).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you chose red, draw a card.')).toBe(null);
  });

  it('supports day/night state: "If it\'s day" and "If it\'s day and ..."', () => {
    const g = createInitialGameState('t_intervening_if_eval_day_night');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).dayNight = 'day';
    (g.state as any).battlefield = [
      { id: 'a1', controller: p1, owner: p1, card: { name: 'Sol Ring', type_line: 'Artifact' } },
    ];

    expect(isInterveningIfSatisfied(g as any, String(p1), "If it's day, draw a card.")).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), "If it's night, draw a card.")).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), "If it's day and you control an artifact, draw a card.")).toBe(true);

    (g.state as any).dayNight = 'night';
    expect(isInterveningIfSatisfied(g as any, String(p1), "If it's day, draw a card.")).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), "If it's day and you control an artifact, draw a card.")).toBe(false);
  });

  it('supports die-roll history: "If you rolled a N" / "If you rolled N or higher this turn"', () => {
    const g = createInitialGameState('t_intervening_if_eval_die_rolls');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you rolled a ten this turn, draw a card.')).toBe(null);

    (g.state as any).dieRollsThisTurn = {
      [p1]: [
        { sides: 20, result: 10, timestamp: 1 },
        { sides: 6, result: 2, timestamp: 2 },
      ],
    };

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you rolled a ten this turn, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you rolled a two, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you rolled a twelve this turn, draw a card.')).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you rolled 12 or higher this turn, draw a card.')).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you rolled 10 or higher this turn, draw a card.')).toBe(true);
  });

  it('supports die-roll history: "If you rolled a die this turn" and "If you rolled N or less this turn"', () => {
    const g = createInitialGameState('t_intervening_if_eval_die_rolls_more');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you rolled a die this turn, draw a card.')).toBe(false);

    (g.state as any).dieRollsThisTurn = {
      [p1]: [{ sides: 20, result: 3 }],
    };

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you rolled a die this turn, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you rolled 2 or less this turn, draw a card.')).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you rolled 3 or less this turn, draw a card.')).toBe(true);
  });

  it('supports dungeon completion clauses: "If you completed a dungeon" and "... this turn"', () => {
    const g = createInitialGameState('t_intervening_if_eval_dungeon');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you completed a dungeon, draw a card.')).toBe(null);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you completed a dungeon this turn, draw a card.')).toBe(null);

    (g.state as any).completedDungeons = { [p1]: 1 };
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you completed a dungeon, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you completed a dungeon this turn, draw a card.')).toBe(null);

    (g.state as any).completedDungeonThisTurn = { [p1]: true };
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you completed a dungeon this turn, draw a card.')).toBe(true);
  });
});
