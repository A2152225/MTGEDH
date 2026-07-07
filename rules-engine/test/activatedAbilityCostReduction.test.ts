import { describe, expect, it } from 'vitest';
import {
  applyActivatedAbilityCostReductions,
  applyTotalManaReductionWithFloor,
  getTotalMana,
} from '../src/activatedAbilityCostReduction';

function battlefieldPermanent(options: {
  id: string;
  controller: string;
  name: string;
  oracleText?: string;
  typeLine?: string;
  isToken?: boolean;
}) {
  const oracleText = options.oracleText ?? '';
  return {
    id: options.id,
    controller: options.controller,
    isToken: options.isToken === true,
    card: {
      id: options.id,
      name: options.name,
      type_line: options.typeLine || 'Artifact',
      oracle_text: oracleText,
    },
  };
}

function graveyardCard(options: {
  id: string;
  name: string;
  typeLine?: string;
}) {
  return {
    id: options.id,
    name: options.name,
    type_line: options.typeLine || 'Creature',
  };
}

describe('activated ability cost reduction', () => {
  it('applies Zirda with a one-mana floor', () => {
    const state: any = {
      battlefield: [
        battlefieldPermanent({
          id: 'zirda',
          controller: 'p1',
          name: 'Zirda, the Dawnwaker',
          oracleText: "Abilities you activate that aren't mana abilities cost {2} less to activate. This effect can't reduce the mana in that cost to less than one mana.",
        }),
      ],
      zones: {},
    };

    const result = applyActivatedAbilityCostReductions({
      state,
      playerId: 'p1',
      ability: {
        sourceId: 'target',
        sourceName: 'Goblin',
        isManaAbility: false,
        manaCost: { generic: 1, red: 1 },
      } as any,
      sourceZone: 'battlefield',
      sourcePermanent: battlefieldPermanent({
        id: 'target',
        controller: 'p1',
        name: 'Goblin Guide',
        typeLine: 'Creature — Goblin',
      }),
    });

    expect(getTotalMana(result.manaCost)).toBe(1);
    expect(result.manaCost?.red).toBe(1);
    expect(result.manaCost?.generic).toBe(0);
  });

  it('does not reduce mana abilities under Zirda', () => {
    const state: any = {
      battlefield: [
        battlefieldPermanent({
          id: 'zirda',
          controller: 'p1',
          name: 'Zirda, the Dawnwaker',
          oracleText: "Abilities you activate that aren't mana abilities cost {2} less to activate. This effect can't reduce the mana in that cost to less than one mana.",
        }),
      ],
    };

    const result = applyActivatedAbilityCostReductions({
      state,
      playerId: 'p1',
      ability: {
        sourceId: 'land',
        sourceName: 'Plains',
        isManaAbility: true,
        manaCost: { generic: 0 },
      } as any,
      sourceZone: 'battlefield',
      sourcePermanent: battlefieldPermanent({
        id: 'land',
        controller: 'p1',
        name: 'Plains',
        typeLine: 'Basic Land — Plains',
      }),
    });

    expect(result.log).toEqual([]);
    expect(getTotalMana(result.manaCost)).toBe(0);
  });

  it('applies Convergence of Dominion to graveyard activations when commander is controlled', () => {
    const state: any = {
      battlefield: [
        battlefieldPermanent({
          id: 'convergence',
          controller: 'p1',
          name: 'Convergence of Dominion',
          oracleText: "As long as you control your commander, activated abilities of cards in your graveyard cost {2} less to activate. This effect can't reduce the mana in that ability's activation cost to less than one mana.",
        }),
        battlefieldPermanent({
          id: 'commander',
          controller: 'p1',
          name: 'Atraxa, Praetors\' Voice',
          typeLine: 'Legendary Creature — Phyrexian Angel Horror',
        }),
      ],
      commandZone: {
        p1: { commanderIds: ['commander-card-id'] },
      },
      zones: {
        p1: {
          graveyard: [
            graveyardCard({
              id: 'gy-card',
              name: 'Stitcher\'s Supplier',
              typeLine: 'Creature — Zombie',
            }),
          ],
        },
      },
    };

    state.battlefield[1].card.id = 'commander-card-id';
    state.battlefield[1].isCommander = true;

    const result = applyActivatedAbilityCostReductions({
      state,
      playerId: 'p1',
      ability: {
        sourceId: 'gy-card',
        sourceName: 'Stitcher\'s Supplier',
        isManaAbility: false,
        manaCost: { generic: 2, black: 1 },
      } as any,
      sourceZone: 'graveyard',
      sourceCard: state.zones.p1.graveyard[0],
    });

    expect(getTotalMana(result.manaCost)).toBe(1);
    expect(result.log.some((entry) => entry.includes('Convergence of Dominion'))).toBe(true);
  });

  it('reduces Blossoming Tortoise land activations by one with no floor', () => {
    const state: any = {
      battlefield: [
        battlefieldPermanent({
          id: 'tortoise',
          controller: 'p1',
          name: 'Blossoming Tortoise',
          typeLine: 'Creature — Turtle',
          oracleText: 'Activated abilities of lands you control cost {1} less to activate.',
        }),
        battlefieldPermanent({
          id: 'land',
          controller: 'p1',
          name: 'Boseiju, Who Endures',
          typeLine: 'Legendary Land',
        }),
      ],
    };

    const result = applyActivatedAbilityCostReductions({
      state,
      playerId: 'p1',
      ability: {
        sourceId: 'land',
        sourceName: 'Boseiju, Who Endures',
        isManaAbility: false,
        manaCost: { generic: 1 },
      } as any,
      sourceZone: 'battlefield',
      sourcePermanent: state.battlefield[1],
    });

    expect(getTotalMana(result.manaCost)).toBe(0);
  });

  it('stacks Mutagen Man copies to make a one-mana token ability free', () => {
    const state: any = {
      battlefield: [
        battlefieldPermanent({
          id: 'mutagen',
          controller: 'p1',
          name: 'Mutagen Man, Living Ooze',
          typeLine: 'Legendary Creature — Ooze Mutant',
          oracleText: 'Activated abilities of artifact tokens you control cost {1} less to activate.',
        }),
        battlefieldPermanent({
          id: 'mutagen-copy',
          controller: 'p1',
          name: 'Mutagen Man, Living Ooze',
          typeLine: 'Legendary Creature — Ooze Mutant',
          isToken: true,
          oracleText: 'Activated abilities of artifact tokens you control cost {1} less to activate.',
        }),
        battlefieldPermanent({
          id: 'token',
          controller: 'p1',
          name: 'Mutagen',
          typeLine: 'Token Artifact',
          isToken: true,
        }),
      ],
    };

    const result = applyActivatedAbilityCostReductions({
      state,
      playerId: 'p1',
      ability: {
        sourceId: 'token',
        sourceName: 'Mutagen',
        isManaAbility: false,
        manaCost: { generic: 1 },
      } as any,
      sourceZone: 'battlefield',
      sourcePermanent: state.battlefield[2],
    });

    expect(getTotalMana(result.manaCost)).toBe(0);
    expect(result.log.length).toBeGreaterThanOrEqual(1);
  });

  it('stacks multiple Mutagen Man reducers on higher costs', () => {
    const state: any = {
      battlefield: [
        battlefieldPermanent({
          id: 'mutagen',
          controller: 'p1',
          name: 'Mutagen Man, Living Ooze',
          typeLine: 'Legendary Creature — Ooze Mutant',
          oracleText: 'Activated abilities of artifact tokens you control cost {1} less to activate.',
        }),
        battlefieldPermanent({
          id: 'mutagen-copy',
          controller: 'p1',
          name: 'Mutagen Man, Living Ooze',
          typeLine: 'Legendary Creature — Ooze Mutant',
          isToken: true,
          oracleText: 'Activated abilities of artifact tokens you control cost {1} less to activate.',
        }),
        battlefieldPermanent({
          id: 'token',
          controller: 'p1',
          name: 'Mutagen',
          typeLine: 'Token Artifact',
          isToken: true,
        }),
      ],
    };

    const result = applyActivatedAbilityCostReductions({
      state,
      playerId: 'p1',
      ability: {
        sourceId: 'token',
        sourceName: 'Mutagen',
        isManaAbility: false,
        manaCost: { generic: 2 },
      } as any,
      sourceZone: 'battlefield',
      sourcePermanent: state.battlefield[2],
    });

    expect(getTotalMana(result.manaCost)).toBe(0);
    expect(result.log.length).toBe(2);
  });

  it('reduces colored mana before generic when applying total reductions', () => {
    const applied = applyTotalManaReductionWithFloor(
      { generic: 1, black: 1 },
      2,
      0,
    );

    expect(applied.amountReduced).toBe(2);
    expect(getTotalMana(applied.manaCost)).toBe(0);
  });
});
