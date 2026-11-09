import { describe, expect, it } from 'vitest';
import { buildObservation } from '../src/ai/buildObservation';
import type { Observation } from '../src/ai/observation';

function fourPlayerFixtureState() {
  return {
    turnNumber: 5,
    phase: 'main',
    step: 'precombat_main',
    turnPlayer: 'p1',
    activePlayer: 'p1',
    priority: 'p1',
    life: { p1: 38, p2: 40, p3: 22, p4: 40 },
    players: [
      { id: 'p1', name: 'Bot', life: 38 },
      { id: 'p2', name: 'OppA', life: 40 },
      { id: 'p3', name: 'OppB', life: 22, hasLost: false },
      { id: 'p4', name: 'OppC', life: 40, eliminated: true, hasLost: true },
    ],
    manaPool: {
      p1: { white: 0, blue: 1, black: 0, red: 0, green: 2, colorless: 0 },
      p2: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      p3: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      p4: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    },
    commanderDamage: {
      p1: { cmdr_p2: 6 },
      p3: { cmdr_p1: 12 },
    },
    commandZone: {
      p1: {
        commanderIds: ['cmdr_p1'],
        commanderCards: [{ id: 'cmdr_p1', name: 'Atraxa, Praetors\' Voice', type_line: 'Legendary Creature — Phyrexian Angel Horror' }],
        tax: 2,
        inCommandZone: ['cmdr_p1'],
      },
      p2: {
        commanderIds: ['cmdr_p2'],
        commanderCards: [{ id: 'cmdr_p2', name: 'Krenko, Mob Boss', type_line: 'Legendary Creature — Goblin Warrior' }],
        tax: 0,
        inCommandZone: [],
      },
    },
    zones: {
      p1: {
        hand: [
          { id: 'h1', name: 'Cultivate', type_line: 'Sorcery', oracle_text: 'Search your library for up to two basic land cards…', mana_cost: '{2}{G}', cmc: 3 },
          { id: 'h2', name: 'Counterspell', type_line: 'Instant', oracle_text: 'Counter target spell.', mana_cost: '{U}{U}', cmc: 2 },
        ],
        graveyard: [{ id: 'g1', name: 'Sol Ring', type_line: 'Artifact', oracle_text: '{T}: Add {C}{C}.', mana_cost: '{1}', cmc: 1 }],
        exile: [{ id: 'e1', name: 'Secret Card', type_line: 'Creature', oracle_text: 'Hidden', faceDown: true }],
        library: [
          { id: 'l2', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '' },
          { id: 'l1', name: 'Island', type_line: 'Basic Land — Island', oracle_text: '{T}: Add {U}.' },
        ],
      },
      p2: {
        hand: [
          { id: 'oh1', name: 'Lightning Bolt', type_line: 'Instant', oracle_text: 'Lightning Bolt deals 3 damage to any target.', mana_cost: '{R}', cmc: 1 },
          { id: 'oh2', name: 'Shock', type_line: 'Instant', oracle_text: 'Shock deals 2 damage to any target.', mana_cost: '{R}', cmc: 1 },
        ],
        graveyard: [],
        exile: [],
        libraryCount: 90,
      },
      p3: {
        hand: [{ id: 'bh1', name: 'Wrath of God', type_line: 'Sorcery', oracle_text: 'Destroy all creatures.', mana_cost: '{2}{W}{W}', cmc: 4 }],
        graveyard: [],
        exile: [],
        library: [{ id: 'bl1', name: 'Plains', type_line: 'Basic Land — Plains' }],
      },
      p4: {
        hand: [],
        graveyard: [],
        exile: [],
        libraryCount: 0,
      },
    },
    battlefield: [
      {
        id: 'bf_forest',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: { id: 'c_forest', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '' },
      },
      {
        id: 'bf_beast',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        summoningSickness: false,
        counters: { '+1/+1': 1 },
        effectivePower: 5,
        effectiveToughness: 5,
        card: {
          id: 'c_beast',
          name: 'Craw Wurm',
          type_line: 'Creature — Wurm',
          oracle_text: '',
          power: '6',
          toughness: '4',
        },
      },
      {
        id: 'bf_pumped',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        summoningSickness: true,
        counters: {},
        effectivePower: 4,
        effectiveToughness: 4,
        card: {
          id: 'c_bear',
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          oracle_text: '',
          power: '2',
          toughness: '2',
        },
      },
      {
        id: 'bf_facedown',
        controller: 'p2',
        owner: 'p2',
        tapped: false,
        isFaceDown: true,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'c_morph',
          name: 'Willbender',
          type_line: 'Creature — Human Wizard',
          oracle_text: 'Morph {1}{U}',
          power: '1',
          toughness: '2',
        },
      },
      {
        id: 'bf_krenko',
        controller: 'p2',
        owner: 'p2',
        tapped: false,
        summoningSickness: false,
        isCommander: true,
        counters: {},
        effectivePower: 3,
        effectiveToughness: 3,
        card: {
          id: 'cmdr_p2',
          name: 'Krenko, Mob Boss',
          type_line: 'Legendary Creature — Goblin Warrior',
          oracle_text: '{T}: Create X 1/1 red Goblin creature tokens, where X is the number of Goblins you control.',
          power: '3',
          toughness: '3',
        },
      },
    ],
    stack: [
      {
        id: 'stack1',
        type: 'spell',
        controller: 'p3',
        source: { cardName: 'Swords to Plowshares', zone: 'stack' },
        card: { name: 'Swords to Plowshares', mana_cost: '{W}', cmc: 1, type_line: 'Instant' },
        canBeCountered: true,
        timestamp: 1,
      },
    ],
  };
}

describe('buildObservation (P0-1)', () => {
  it('builds a stable Observation for a four-player fixture', () => {
    const state = fourPlayerFixtureState();
    const obs = buildObservation(state, 'p1');

    expect(obs).toMatchSnapshot();
  });

  it('omits opponent hand and library contents from the type shape', () => {
    const obs = buildObservation(fourPlayerFixtureState(), 'p1');
    for (const opp of obs.opponents) {
      expect(Object.prototype.hasOwnProperty.call(opp, 'hand')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(opp, 'library')).toBe(false);
      expect(typeof opp.handSize).toBe('number');
      expect(typeof opp.librarySize).toBe('number');
    }
  });

  it('hides face-down permanent and exile identity', () => {
    const obs = buildObservation(fourPlayerFixtureState(), 'p1');
    const facedown = obs.opponents.find((o) => o.id === 'p2')!.battlefield.find((p) => p.id === 'bf_facedown')!;
    expect(facedown.faceDown).toBe(true);
    expect(facedown.name).toBeUndefined();
    expect(facedown.oracleText).toBe('');

    const exile = obs.self.exile.find((c) => c.id === 'e1')!;
    expect(exile.faceDown).toBe(true);
    expect(exile.name).toBeUndefined();
  });

  it('uses effective power/toughness and marks summoning sickness', () => {
    const obs = buildObservation(fourPlayerFixtureState(), 'p1');
    const beast = obs.self.battlefield.find((p) => p.id === 'bf_beast')!;
    expect(beast.power).toBe(5);
    expect(beast.toughness).toBe(5);
    expect(beast.counters['+1/+1']).toBe(1);

    const pumped = obs.self.battlefield.find((p) => p.id === 'bf_pumped')!;
    expect(pumped.power).toBe(4);
    expect(pumped.summoningSick).toBe(true);
  });

  it('treats basic lands with empty oracle text as mana sources', () => {
    const obs = buildObservation(fourPlayerFixtureState(), 'p1');
    const forest = obs.self.battlefield.find((p) => p.id === 'bf_forest')!;
    expect(forest.producesMana).toBe(true);
  });

  it('sorts deckList by name and does not expose opponent hand cards', () => {
    const obs = buildObservation(fourPlayerFixtureState(), 'p1');
    expect(obs.self.deckList.map((c) => c.name)).toEqual(['Forest', 'Island']);
    expect(obs.self.librarySize).toBe(2);

    const opp2 = obs.opponents.find((o) => o.id === 'p2')!;
    expect(opp2.handSize).toBe(2);
    expect(opp2.librarySize).toBe(90);

    const lost = obs.opponents.find((o) => o.id === 'p4')!;
    expect(lost.eliminated).toBe(true);
  });

  it('accepts ownLibrary / librarySizes when libraries live outside state', () => {
    const state = fourPlayerFixtureState();
    delete (state.zones as any).p1.library;
    const obs = buildObservation(state, 'p1', {
      ownLibrary: [
        { id: 'x2', name: 'Mountain', type_line: 'Basic Land — Mountain' },
        { id: 'x1', name: 'Swamp', type_line: 'Basic Land — Swamp' },
      ],
      librarySizes: { p1: 2, p2: 88, p3: 1, p4: 0 },
    });
    expect(obs.self.deckList.map((c) => c.name)).toEqual(['Mountain', 'Swamp']);
    expect(obs.self.librarySize).toBe(2);
    expect(obs.opponents.find((o) => o.id === 'p2')!.librarySize).toBe(88);
  });

  it('keeps stack top as the last element and carries controller/name/cmc', () => {
    const obs = buildObservation(fourPlayerFixtureState(), 'p1');
    expect(obs.stack).toHaveLength(1);
    expect(obs.stack[0].controller).toBe('p3');
    expect(obs.stack[0].name).toBe('Swords to Plowshares');
    expect(obs.stack[0].cmc).toBe(1);
  });

  it('does not put OpponentView hand or library keys on a JSON round-trip', () => {
    const obs: Observation = buildObservation(fourPlayerFixtureState(), 'p1');
    const json = JSON.parse(JSON.stringify(obs));
    for (const opp of json.opponents) {
      expect(opp.hand).toBeUndefined();
      expect(opp.library).toBeUndefined();
    }
  });
});
