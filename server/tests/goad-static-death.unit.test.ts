import { describe, it, expect } from 'vitest';
import type { GameContext } from '../src/state/context';
import { getCurrentGoaders, isCreatureGoaded } from '../src/state/modules/goad-effects.js';
import { getDeathTriggers } from '../src/state/modules/triggered-abilities.js';

function createTestContext(state: any): GameContext {
  return {
    state,
    inactive: new Set(),
    passesInRow: { value: 0 },
    bumpSeq: () => {},
  } as any;
}

describe('static goad detection on server', () => {
  const baelothOracle =
    "Creatures your opponents control with power less than Baeloth Barrityl, Entertainer's power are goaded.\nWhenever a goaded attacking or blocking creature dies, you create a Treasure token.";

  it('detects Baeloth static goad on lower-power opponent creatures', () => {
    const battlefield = [
      {
        id: 'baeloth_1',
        controller: 'p1',
        basePower: 4,
        card: {
          name: 'Baeloth Barrityl, Entertainer',
          type_line: 'Legendary Creature — Elf Shaman',
          oracle_text: baelothOracle,
          power: '4',
          toughness: '5',
        },
      },
      {
        id: 'small_1',
        controller: 'p2',
        basePower: 2,
        card: {
          name: 'Goblin Guide',
          type_line: 'Creature — Goblin Scout',
          oracle_text: '',
          power: '2',
          toughness: '2',
        },
      },
      {
        id: 'big_1',
        controller: 'p2',
        basePower: 5,
        card: {
          name: 'Craterhoof Behemoth',
          type_line: 'Legendary Creature — Beast',
          oracle_text: '',
          power: '5',
          toughness: '5',
        },
      },
    ];

    expect(getCurrentGoaders(battlefield[1], battlefield, 3)).toEqual(['p1']);
    expect(isCreatureGoaded(battlefield[1], battlefield, 3)).toBe(true);
    expect(getCurrentGoaders(battlefield[2], battlefield, 3)).toEqual([]);
  });

  it('still detects keyword-action goad stored on the creature', () => {
    const creature = {
      id: 'target_1',
      controller: 'p2',
      goadedBy: ['p1'],
      goadedUntil: { p1: 9 },
      card: {
        name: 'Grizzly Bears',
        type_line: 'Creature — Bear',
        oracle_text: '',
      },
    };

    expect(getCurrentGoaders(creature, [creature], 5)).toEqual(['p1']);
    expect(getCurrentGoaders(creature, [creature], 9)).toEqual([]);
  });
});

describe('goaded attacking or blocking creature dies death trigger', () => {
  const baelothOracle =
    "Creatures your opponents control with power less than Baeloth Barrityl, Entertainer's power are goaded.\nWhenever a goaded attacking or blocking creature dies, you create a Treasure token.";

  const baeloth = {
    id: 'baeloth_1',
    controller: 'p1',
    basePower: 4,
    card: {
      name: 'Baeloth Barrityl, Entertainer',
      type_line: 'Legendary Creature — Elf Shaman',
      oracle_text: baelothOracle,
      power: '4',
      toughness: '5',
    },
  };

  const goadedAttacker = {
    id: 'goblin_1',
    controller: 'p2',
    basePower: 2,
    attacking: 'p1',
    card: {
      name: 'Goblin Guide',
      type_line: 'Creature — Goblin Scout',
      oracle_text: '',
      power: '2',
      toughness: '2',
    },
  };

  const goadedNonCombat = {
    ...goadedAttacker,
    id: 'goblin_2',
    attacking: undefined,
    attackedThisTurn: false,
  };

  const nonGoadedAttacker = {
    ...goadedAttacker,
    id: 'behemoth_1',
    basePower: 5,
    card: {
      name: 'Craterhoof Behemoth',
      type_line: 'Legendary Creature — Beast',
      oracle_text: '',
      power: '5',
      toughness: '5',
    },
  };

  it('fires Baeloth treasure trigger when a goaded attacking creature dies', () => {
    const ctx = createTestContext({
      turn: 3,
      battlefield: [baeloth, goadedAttacker],
    });

    const triggers = getDeathTriggers(ctx, goadedAttacker, 'p2');
    expect(
      triggers.some(
        (entry) =>
          entry.source.cardName === 'Baeloth Barrityl, Entertainer' &&
          /create a treasure token/i.test(entry.effect),
      ),
    ).toBe(true);
  });

  it('does not fire when the dying creature was goaded but not attacking or blocking', () => {
    const ctx = createTestContext({
      turn: 3,
      battlefield: [baeloth, goadedNonCombat],
    });

    const triggers = getDeathTriggers(ctx, goadedNonCombat, 'p2');
    expect(triggers.some((entry) => entry.source.cardName === 'Baeloth Barrityl, Entertainer')).toBe(false);
  });

  it('does not fire when an attacking creature was not goaded', () => {
    const ctx = createTestContext({
      turn: 3,
      battlefield: [baeloth, nonGoadedAttacker],
    });

    const triggers = getDeathTriggers(ctx, nonGoadedAttacker, 'p2');
    expect(triggers.some((entry) => entry.source.cardName === 'Baeloth Barrityl, Entertainer')).toBe(false);
  });

  it('fires for a goaded blocking creature', () => {
    const goadedBlocker = {
      ...goadedAttacker,
      id: 'blocker_1',
      attacking: undefined,
      blocking: ['attacker_1'],
      card: {
        name: 'Goblin Piledriver',
        type_line: 'Creature — Goblin Warrior',
        oracle_text: '',
        power: '1',
        toughness: '2',
      },
    };
    const ctx = createTestContext({
      turn: 3,
      battlefield: [baeloth, goadedBlocker],
    });

    const triggers = getDeathTriggers(ctx, goadedBlocker, 'p2');
    expect(
      triggers.some(
        (entry) =>
          entry.source.cardName === 'Baeloth Barrityl, Entertainer' &&
          /create a treasure token/i.test(entry.effect),
      ),
    ).toBe(true);
  });
});
