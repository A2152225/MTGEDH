import { describe, expect, it } from 'vitest';

import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: remaining sourcePermanent gates work via refs-id', () => {
  it('"if you control no other X" excludes self via refs.thisPermanentId', () => {
    const g: any = {
      state: {
        players: [{ id: 'p1' }],
        battlefield: [
          { id: 'self', controller: 'p1', card: { name: 'Self', type_line: 'Basic Land — Plains' } },
          { id: 'other', controller: 'p1', card: { name: 'Other', type_line: 'Basic Land — Island' } },
        ],
      },
    };

    expect(
      evaluateInterveningIfClause(g, 'p1', 'if you control no other basic lands', null as any, { thisPermanentId: 'self' } as any)
    ).toBe(false);

    const g2: any = {
      state: {
        players: [{ id: 'p1' }],
        battlefield: [{ id: 'self', controller: 'p1', card: { name: 'Self', type_line: 'Basic Land — Plains' } }],
      },
    };

    expect(
      evaluateInterveningIfClause(g2, 'p1', 'if you control no other basic lands', null as any, { thisPermanentId: 'self' } as any)
    ).toBe(true);
  });

  it('"this creature didn\'t enter the battlefield this turn" uses the per-turn ETB tracker via refs-id', () => {
    const g: any = {
      state: {
        players: [{ id: 'p1' }],
        battlefield: [{ id: 'c1', controller: 'p1', card: { name: 'C1', type_line: 'Creature', power: '2', toughness: '2' } }],
        creaturesEnteredBattlefieldThisTurnIdsByController: {
          p1: { c1: true },
        },
      },
    };

    expect(
      evaluateInterveningIfClause(g, 'p1', "if this creature didn't enter the battlefield this turn", null as any, { thisCreatureId: 'c1' } as any)
    ).toBe(false);

    const g2: any = {
      state: {
        players: [{ id: 'p1' }],
        battlefield: [{ id: 'c1', controller: 'p1', card: { name: 'C1', type_line: 'Creature', power: '2', toughness: '2' } }],
        creaturesEnteredBattlefieldThisTurnIdsByController: {
          p1: {},
        },
      },
    };

    expect(
      evaluateInterveningIfClause(g2, 'p1', "if this creature didn't enter the battlefield this turn", null as any, { thisCreatureId: 'c1' } as any)
    ).toBe(true);
  });

  it('equipment clause resolves attached creature via refs.thisPermanentId', () => {
    const g: any = {
      state: {
        players: [{ id: 'p1' }],
        battlefield: [
          { id: 'eq1', controller: 'p1', attachedTo: 'c1', card: { name: 'Eq', type_line: 'Artifact — Equipment' } },
          { id: 'c1', controller: 'p1', card: { name: 'C1', type_line: 'Creature', power: '2', toughness: '2' } },
          { id: 'v1', controller: 'p2', card: { name: 'V', type_line: 'Creature', power: '1', toughness: '1' } },
        ],
        creaturesDamagedByThisCreatureThisTurn: {
          c1: { v1: true },
        },
      },
    };

    expect(
      evaluateInterveningIfClause(
        g,
        'p1',
        "if equipped creature didn't deal combat damage to a creature this turn",
        null as any,
        { thisPermanentId: 'eq1' } as any
      )
    ).toBe(false);
  });

  it("Liberator power comparison resolves Liberator via refs-id", () => {
    const g: any = {
      state: {
        players: [{ id: 'p1' }],
        battlefield: [
          { id: 'lib', controller: 'p1', card: { name: 'Liberator', type_line: 'Creature', power: '4', toughness: '4' } },
        ],
        stack: [{ id: 'si1', manaSpentTotal: 5, card: { name: 'Spell', type_line: 'Artifact' } }],
      },
    };

    expect(
      evaluateInterveningIfClause(
        g,
        'p1',
        "if the amount of mana spent to cast that spell is greater than Liberator's power",
        null as any,
        { thisCreatureId: 'lib', triggeringStackItemId: 'si1' } as any
      )
    ).toBe(true);
  });

  it('"this card is exiled" can be answered by scanning zones using refs.thisCardId', () => {
    const g: any = {
      state: {
        players: [{ id: 'p1' }],
        zones: {
          p1: {
            exile: [{ card: { id: 'card1', name: 'Card1', type_line: 'Sorcery' } }],
          },
        },
        battlefield: [],
      },
    };

    expect(evaluateInterveningIfClause(g, 'p1', 'if this card is exiled', null as any, { thisCardId: 'card1' } as any)).toBe(true);
  });

  it('"Elf in graveyard and this creature has a -1/-1 counter" works via refs-id creature lookup', () => {
    const g: any = {
      state: {
        players: [{ id: 'p1' }],
        zones: {
          p1: {
            graveyard: [{ type_line: 'Creature — Elf Druid', name: 'Elf' }],
          },
        },
        battlefield: [
          {
            id: 'c1',
            controller: 'p1',
            counters: { '-1/-1': 1 },
            card: { name: 'C1', type_line: 'Creature', power: '2', toughness: '2' },
          },
        ],
      },
    };

    expect(
      evaluateInterveningIfClause(
        g,
        'p1',
        'if there is an Elf card in your graveyard and this creature has a -1/-1 counter on it',
        null as any,
        { thisCreatureId: 'c1' } as any
      )
    ).toBe(true);
  });
});
