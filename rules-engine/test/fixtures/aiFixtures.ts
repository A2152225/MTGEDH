/**
 * Shared fixtures for AI Phase 1 evaluator / observation tests.
 *
 * Origin: AI_Upgrade Phase 1 (P1-1).
 */

import { buildObservation } from '../../src/ai/buildObservation.js';
import type { Observation } from '../../src/ai/observation.js';
import type { BattlefieldPermanent } from '../../../shared/src/types-handlers/battlefieldPermanent.js';

export type PermFixture = {
  id: string;
  label: string;
  perm: BattlefieldPermanent;
};

function basePerm(partial: {
  id: string;
  controller?: string;
  tapped?: boolean;
  summoningSickness?: boolean;
  isToken?: boolean;
  isCommander?: boolean;
  isFaceDown?: boolean;
  counters?: Record<string, number>;
  loyalty?: number;
  effectivePower?: number;
  effectiveToughness?: number;
  card: Record<string, unknown>;
}): BattlefieldPermanent {
  return {
    id: partial.id,
    controller: partial.controller || 'p1',
    owner: partial.controller || 'p1',
    tapped: Boolean(partial.tapped),
    summoningSickness: Boolean(partial.summoningSickness),
    isToken: Boolean(partial.isToken),
    isCommander: Boolean(partial.isCommander),
    isFaceDown: Boolean(partial.isFaceDown),
    counters: partial.counters || {},
    loyalty: partial.loyalty,
    effectivePower: partial.effectivePower,
    effectiveToughness: partial.effectiveToughness,
    card: partial.card as any,
  } as BattlefieldPermanent;
}

/** Ten+ permanents covering permanentValue / evaluatePermanentValue parity cases. */
export function parityPermanentFixtures(): PermFixture[] {
  return [
    {
      id: 'vanilla',
      label: 'vanilla 2/2',
      perm: basePerm({
        id: 'bf_vanilla',
        effectivePower: 2,
        effectiveToughness: 2,
        card: {
          id: 'c_vanilla',
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          oracle_text: '',
          power: '2',
          toughness: '2',
        },
      }),
    },
    {
      id: 'flyer',
      label: 'flyer',
      perm: basePerm({
        id: 'bf_flyer',
        effectivePower: 2,
        effectiveToughness: 2,
        card: {
          id: 'c_flyer',
          name: 'Storm Crow',
          type_line: 'Creature — Bird',
          oracle_text: 'Flying',
          power: '1',
          toughness: '2',
        },
      }),
    },
    {
      id: 'dt_ll',
      label: 'deathtouch lifelink',
      perm: basePerm({
        id: 'bf_dtll',
        effectivePower: 1,
        effectiveToughness: 1,
        card: {
          id: 'c_dtll',
          name: 'Vampire Nighthawk',
          type_line: 'Creature — Vampire Shaman',
          oracle_text: 'Flying, deathtouch, lifelink',
          power: '2',
          toughness: '3',
        },
      }),
    },
    {
      id: 'indy',
      label: 'indestructible',
      perm: basePerm({
        id: 'bf_indy',
        effectivePower: 4,
        effectiveToughness: 4,
        card: {
          id: 'c_indy',
          name: 'Darksteel Myr',
          type_line: 'Artifact Creature — Myr',
          oracle_text: 'Indestructible',
          power: '0',
          toughness: '1',
        },
      }),
    },
    {
      id: 'ds',
      label: 'double strike',
      perm: basePerm({
        id: 'bf_ds',
        effectivePower: 2,
        effectiveToughness: 2,
        card: {
          id: 'c_ds',
          name: 'Skyknight Legionnaire',
          type_line: 'Creature — Human Knight',
          oracle_text: 'Flying, haste\nDouble strike',
          power: '1',
          toughness: '2',
        },
      }),
    },
    {
      id: 'etb_draw',
      label: 'ETB draw',
      perm: basePerm({
        id: 'bf_etb_draw',
        effectivePower: 1,
        effectiveToughness: 1,
        card: {
          id: 'c_etb_draw',
          name: 'Elvish Visionary',
          type_line: 'Creature — Elf Shaman',
          oracle_text: 'When Elvish Visionary enters the battlefield, draw a card.',
          power: '1',
          toughness: '1',
        },
      }),
    },
    {
      id: 'etb_search',
      label: 'ETB search',
      perm: basePerm({
        id: 'bf_etb_search',
        effectivePower: 1,
        effectiveToughness: 1,
        card: {
          id: 'c_etb_search',
          name: 'Sylvan Ranger',
          type_line: 'Creature — Elf Scout',
          oracle_text:
            'When Sylvan Ranger enters the battlefield, you may search your library for a basic land card, reveal it, put it into your hand, then shuffle.',
          power: '1',
          toughness: '1',
        },
      }),
    },
    {
      id: 'token',
      label: 'token',
      perm: basePerm({
        id: 'bf_token',
        isToken: true,
        effectivePower: 1,
        effectiveToughness: 1,
        card: {
          id: 'c_token',
          name: 'Soldier',
          type_line: 'Creature — Soldier',
          oracle_text: '',
          power: '1',
          toughness: '1',
        },
      }),
    },
    {
      id: 'rock',
      label: 'mana rock',
      perm: basePerm({
        id: 'bf_rock',
        card: {
          id: 'c_rock',
          name: 'Sol Ring',
          type_line: 'Artifact',
          oracle_text: '{T}: Add {C}{C}.',
          mana_cost: '{1}',
          cmc: 1,
        },
      }),
    },
    {
      id: 'enchant',
      label: 'enchantment',
      perm: basePerm({
        id: 'bf_enchant',
        card: {
          id: 'c_enchant',
          name: 'Rhystic Study',
          type_line: 'Enchantment',
          oracle_text: 'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.',
        },
      }),
    },
    {
      id: 'basic',
      label: 'basic land',
      perm: basePerm({
        id: 'bf_basic',
        card: {
          id: 'c_basic',
          name: 'Forest',
          type_line: 'Basic Land — Forest',
          oracle_text: '{T}: Add {G}.',
        },
      }),
    },
    {
      id: 'nonbasic',
      label: 'nonbasic land',
      perm: basePerm({
        id: 'bf_nonbasic',
        card: {
          id: 'c_nonbasic',
          name: 'Command Tower',
          type_line: 'Land',
          oracle_text: '{T}: Add one mana of any color in your commander\'s color identity.',
        },
      }),
    },
    {
      id: 'counters',
      label: '+1/+1 counters',
      perm: basePerm({
        id: 'bf_counters',
        counters: { '+1/+1': 3 },
        effectivePower: 5,
        effectiveToughness: 5,
        card: {
          id: 'c_counters',
          name: 'Hardened Scales Bear',
          type_line: 'Creature — Bear',
          oracle_text: '',
          power: '2',
          toughness: '2',
        },
      }),
    },
    {
      id: 'pumped',
      label: 'pumped creature',
      perm: basePerm({
        id: 'bf_pumped',
        effectivePower: 7,
        effectiveToughness: 7,
        card: {
          id: 'c_pumped',
          name: 'Giant Growth Target',
          type_line: 'Creature — Beast',
          oracle_text: '',
          power: '3',
          toughness: '3',
        },
      }),
    },
  ];
}

export function emptyFourPlayerState(overrides?: Record<string, unknown>): any {
  return {
    turnNumber: 12,
    phase: 'main',
    step: 'precombat_main',
    turnPlayer: 'p1',
    activePlayer: 'p1',
    priority: 'p1',
    life: { p1: 36, p2: 40, p3: 28, p4: 40 },
    players: [
      { id: 'p1', name: 'A', life: 36 },
      { id: 'p2', name: 'B', life: 40 },
      { id: 'p3', name: 'C', life: 28 },
      { id: 'p4', name: 'D', life: 40 },
    ],
    manaPool: {
      p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      p2: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      p3: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      p4: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    },
    commanderDamage: {
      p1: { cmdr_p2: 5 },
      p2: {},
      p3: { cmdr_p1: 8 },
      p4: {},
    },
    commandZone: {
      p1: {
        commanderIds: ['cmdr_p1'],
        commanderCards: [{ id: 'cmdr_p1', name: 'Atraxa', type_line: 'Legendary Creature — Angel' }],
        tax: 0,
        inCommandZone: [],
      },
    },
    zones: {
      p1: { hand: [{ id: 'h1', name: 'Cultivate', type_line: 'Sorcery' }], graveyard: [], exile: [], libraryCount: 80 },
      p2: { hand: [{ id: 'h2a', name: 'Bolt', type_line: 'Instant' }, { id: 'h2b', name: 'Shock', type_line: 'Instant' }], graveyard: [], exile: [], libraryCount: 85 },
      p3: { hand: [{ id: 'h3', name: 'Counterspell', type_line: 'Instant' }], graveyard: [], exile: [], libraryCount: 90 },
      p4: { hand: [], graveyard: [], exile: [], libraryCount: 95 },
    },
    battlefield: [],
    stack: [],
    ...overrides,
  };
}

/** Late-game four-player board (~25 permanents per seat) for timing. */
export function lateGameFourPlayerState(): any {
  const state = emptyFourPlayerState({ turnNumber: 24 });
  const battlefield: BattlefieldPermanent[] = [];
  const seats = ['p1', 'p2', 'p3', 'p4'];
  for (const seat of seats) {
    for (let i = 0; i < 10; i++) {
      battlefield.push(
        basePerm({
          id: `${seat}_land_${i}`,
          controller: seat,
          card: {
            id: `c_${seat}_land_${i}`,
            name: i % 2 === 0 ? 'Forest' : 'Command Tower',
            type_line: i % 2 === 0 ? 'Basic Land — Forest' : 'Land',
            oracle_text: '{T}: Add {G}.',
          },
        }),
      );
    }
    for (let i = 0; i < 12; i++) {
      battlefield.push(
        basePerm({
          id: `${seat}_cr_${i}`,
          controller: seat,
          isCommander: i === 0,
          summoningSickness: i % 5 === 0,
          effectivePower: 2 + (i % 4),
          effectiveToughness: 2 + (i % 3),
          counters: i % 4 === 0 ? { '+1/+1': 1 } : {},
          card: {
            id: `c_${seat}_cr_${i}`,
            name: `Creature ${seat} ${i}`,
            type_line: i === 0 ? 'Legendary Creature — Horror' : 'Creature — Beast',
            oracle_text: i % 3 === 0 ? 'Flying' : i % 3 === 1 ? 'Trample' : '',
            power: String(2 + (i % 4)),
            toughness: String(2 + (i % 3)),
          },
        }),
      );
    }
    for (let i = 0; i < 3; i++) {
      battlefield.push(
        basePerm({
          id: `${seat}_other_${i}`,
          controller: seat,
          card: {
            id: `c_${seat}_other_${i}`,
            name: i === 0 ? 'Sol Ring' : 'Rhystic Study',
            type_line: i === 0 ? 'Artifact' : 'Enchantment',
            oracle_text: i === 0 ? '{T}: Add {C}{C}.' : 'Whenever an opponent casts a spell, you may draw a card.',
          },
        }),
      );
    }
  }
  state.battlefield = battlefield;
  return state;
}

export function observationFromState(state: any, seat: string): Observation {
  return buildObservation(state, seat);
}
