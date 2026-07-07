import { describe, expect, it } from 'vitest';
import { adjustActivationManaCostForPayment } from '../src/state/modules/ability-cost-adjustments.js';

function permanent(options: {
  id: string;
  controller: string;
  name: string;
  typeLine?: string;
  isToken?: boolean;
  cardId?: string;
  oracleText?: string;
}) {
  return {
    id: options.id,
    controller: options.controller,
    isToken: options.isToken === true,
    card: {
      id: options.cardId || options.id,
      name: options.name,
      type_line: options.typeLine || 'Artifact',
      oracle_text: options.oracleText || '',
    },
  };
}

describe('ability cost adjustments (server bridge)', () => {
  it('adjusts battlefield creature activations through Zirda', () => {
    const state = {
      battlefield: [
        permanent({
          id: 'zirda',
          controller: 'p1',
          name: 'Zirda, the Dawnwaker',
          oracleText: "Abilities you activate that aren't mana abilities cost {2} less to activate. This effect can't reduce the mana in that cost to less than one mana.",
        }),
        permanent({
          id: 'creature',
          controller: 'p1',
          name: 'Gilded Goose',
          typeLine: 'Creature — Bird',
        }),
      ],
    };

    const result = adjustActivationManaCostForPayment({
      state,
      activatorId: 'p1',
      sourceCard: state.battlefield[1].card,
      sourceZone: 'battlefield',
      sourceController: 'p1',
      sourcePermanent: state.battlefield[1],
      sourceId: 'creature',
      isManaAbility: false,
      manaCostString: '{1}{G}',
      sourceName: 'Gilded Goose',
    });

    expect(result.adjustedManaCost).toBe('{G}');
    expect(result.messages.some((message) => message.includes('Zirda'))).toBe(true);
  });

  it('adjusts graveyard unearth costs through Convergence of Dominion', () => {
    const state = {
      battlefield: [
        permanent({
          id: 'convergence',
          controller: 'p1',
          name: 'Convergence of Dominion',
          oracleText: "As long as you control your commander, activated abilities of cards in your graveyard cost {2} less to activate. This effect can't reduce the mana in that ability's activation cost to less than one mana.",
        }),
        permanent({
          id: 'commander',
          controller: 'p1',
          name: 'Atraxa, Praetors\' Voice',
          typeLine: 'Legendary Creature',
          cardId: 'commander-card-id',
        }),
      ],
      commandZone: {
        p1: { commanderIds: ['commander-card-id'] },
      },
      zones: {},
    };
    (state.battlefield[1] as any).isCommander = true;

    const result = adjustActivationManaCostForPayment({
      state,
      activatorId: 'p1',
      sourceCard: {
        id: 'gy-card',
        name: 'Bloodghast',
        type_line: 'Creature — Vampire Spirit',
      },
      sourceZone: 'graveyard',
      sourceController: 'p1',
      sourceId: 'gy-card',
      isManaAbility: false,
      manaCostString: '{1}{B}',
      sourceName: 'Bloodghast',
    });

    expect(result.adjustedManaCost).toBe('{B}');
  });
});
