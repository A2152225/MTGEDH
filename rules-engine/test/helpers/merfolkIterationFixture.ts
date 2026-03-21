import type { BattlefieldPermanent, GameState } from '../../shared/src';

type PermanentOptions = {
  id: string;
  name: string;
  manaCost?: string;
  typeLine: string;
  oracleText?: string;
  power?: number;
  toughness?: number;
  controller?: string;
  tapped?: boolean;
};

function makePermanent(options: PermanentOptions): BattlefieldPermanent {
  const controller = options.controller ?? 'p1';

  return {
    id: options.id,
    controller: controller as any,
    owner: controller as any,
    ownerId: controller as any,
    tapped: options.tapped ?? false,
    counters: {},
    summoningSickness: false,
    cardType: options.typeLine,
    type_line: options.typeLine,
    name: options.name,
    manaCost: options.manaCost,
    power: options.power,
    toughness: options.toughness,
    basePower: options.power,
    baseToughness: options.toughness,
    oracle_text: options.oracleText,
    card: {
      id: `${options.id}-card`,
      name: options.name,
      mana_cost: options.manaCost,
      manaCost: options.manaCost,
      type_line: options.typeLine,
      oracle_text: options.oracleText,
      power: options.power !== undefined ? String(options.power) : undefined,
      toughness: options.toughness !== undefined ? String(options.toughness) : undefined,
    } as any,
  } as any;
}

export function makeMerfolkIterationState(overrides: Partial<GameState> = {}): GameState {
  return {
    id: 'merfolk-iteration-game',
    format: 'commander',
    players: [
      {
        id: 'p1',
        name: 'P1',
        seat: 0,
        life: 40,
        library: [{ id: 'p1c1' }, { id: 'p1c2' }, { id: 'p1c3' }],
        hand: [],
        graveyard: [
          {
            id: 'summon-the-school-card',
            name: 'Summon the School',
            mana_cost: '{3}{W}',
            manaCost: '{3}{W}',
            type_line: 'Kindred Sorcery — Merfolk',
            oracle_text:
              'Create two 1/1 blue Merfolk Wizard creature tokens. Tap four untapped Merfolk you control: Return this card from your graveyard to your hand.',
          } as any,
        ],
        exile: [],
      } as any,
      {
        id: 'p2',
        name: 'P2',
        seat: 1,
        life: 40,
        library: [{ id: 'p2c1' }, { id: 'p2c2' }, { id: 'p2c3' }, { id: 'p2c4' }],
        hand: [],
        graveyard: [],
        exile: [],
      } as any,
    ],
    startingLife: 40,
    life: {},
    turnPlayer: 'p1',
    priority: 'p1',
    stack: [],
    battlefield: [
      makePermanent({
        id: 'merrow-reejerey',
        name: 'Merrow Reejerey',
        manaCost: '{2}{U}',
        typeLine: 'Creature — Merfolk Soldier',
        oracleText: 'Other Merfolk creatures you control get +1/+1. Whenever you cast a Merfolk spell, you may tap or untap target permanent.',
        power: 2,
        toughness: 2,
      }),
      makePermanent({
        id: 'anointed-procession',
        name: 'Anointed Procession',
        manaCost: '{3}{W}',
        typeLine: 'Enchantment',
        oracleText: 'If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.',
      }),
      makePermanent({
        id: 'deeproot-waters',
        name: 'Deeproot Waters',
        manaCost: '{2}{U}',
        typeLine: 'Enchantment',
        oracleText: 'Whenever you cast a Merfolk spell, create a 1/1 blue Merfolk creature token with hexproof.',
      }),
      makePermanent({
        id: 'exalted-sunborn',
        name: 'Exalted Sunborn',
        manaCost: '{3}{W}{W}',
        typeLine: 'Creature — Angel Wizard',
        oracleText: 'Flying, lifelink If one or more tokens would be created under your control, twice that many of those tokens are created instead.',
        power: 4,
        toughness: 5,
      }),
      makePermanent({
        id: 'nykthos-shrine-to-nyx',
        name: 'Nykthos, Shrine to Nyx',
        typeLine: 'Legendary Land',
        oracleText: '{T}: Add {C}. {2}, {T}: Choose a color. Add an amount of mana of that color equal to your devotion to that color.',
      }),
      makePermanent({
        id: 'stonybrook-banneret',
        name: 'Stonybrook Banneret',
        manaCost: '{1}{U}',
        typeLine: 'Creature — Merfolk Wizard',
        oracleText: 'Islandwalk Merfolk spells and Wizard spells you cast cost {1} less to cast.',
        power: 1,
        toughness: 1,
      }),
      makePermanent({
        id: 'judge-of-currents',
        name: 'Judge of Currents',
        manaCost: '{1}{W}',
        typeLine: 'Creature — Merfolk Wizard',
        oracleText: 'Whenever a Merfolk you control becomes tapped, you may gain 1 life.',
        power: 1,
        toughness: 1,
      }),
      makePermanent({
        id: 'drowner-of-secrets',
        name: 'Drowner of Secrets',
        manaCost: '{2}{U}',
        typeLine: 'Creature — Merfolk Wizard',
        oracleText: 'Tap an untapped Merfolk you control: Target player mills a card.',
        power: 1,
        toughness: 3,
      }),
      makePermanent({
        id: 'helm-of-the-host',
        name: 'Helm of the Host',
        manaCost: '{4}',
        typeLine: 'Legendary Artifact — Equipment',
        oracleText: "At the beginning of combat on your turn, create a token that's a copy of equipped creature, except the token isn't legendary. That token gains haste. Equip {5}.",
      }),
      makePermanent({
        id: 'island-1',
        name: 'Island',
        typeLine: 'Basic Land — Island',
        oracleText: '{T}: Add {U}.',
      }),
      makePermanent({
        id: 'island-2',
        name: 'Island',
        typeLine: 'Basic Land — Island',
        oracleText: '{T}: Add {U}.',
      }),
      makePermanent({
        id: 'island-3',
        name: 'Island',
        typeLine: 'Basic Land — Island',
        oracleText: '{T}: Add {U}.',
      }),
      makePermanent({
        id: 'plains-1',
        name: 'Plains',
        typeLine: 'Basic Land — Plains',
        oracleText: '{T}: Add {W}.',
      }),
      makePermanent({
        id: 'plains-2',
        name: 'Plains',
        typeLine: 'Basic Land — Plains',
        oracleText: '{T}: Add {W}.',
      }),
    ],
    commandZone: {} as any,
    phase: 'precombatMain' as any,
    active: true,
    activePlayerIndex: 0 as any,
    priorityPlayerIndex: 0 as any,
    turn: 4 as any,
    turnNumber: 4 as any,
    ...overrides,
  } as any;
}

export const MERFOLK_ITERATION_FIXTURE_CARD_NAMES = [
  'Merrow Reejerey',
  'Anointed Procession',
  'Deeproot Waters',
  'Exalted Sunborn',
  'Summon the School',
  'Nykthos, Shrine to Nyx',
  'Stonybrook Banneret',
  'Judge of Currents',
  'Drowner of Secrets',
  'Helm of the Host',
  'Island',
  'Plains',
] as const;