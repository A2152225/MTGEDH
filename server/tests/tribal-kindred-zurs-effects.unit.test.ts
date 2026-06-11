import { describe, expect, it } from 'vitest';

import {
  detectAttackTriggers,
  detectETBTriggers,
  detectSpellCastTriggers,
  getAttackTriggersForCreatures,
} from '../src/state/modules/triggered-abilities.js';
import { evaluateDrawReplacementEvent } from '../src/state/modules/replacement-effects.js';

describe('Emperor Mihail II optional spell-cast trigger', () => {
  it('parses optional {1} payment and token creation effect', () => {
    const card = {
      name: 'Emperor Mihail II',
      oracle_text:
        'Whenever you cast a Merfolk spell, you may pay {1}. If you do, create a 1/1 blue Merfolk creature token.',
    };
    const permanent = { id: 'mihail_1', controller: 'p1', card };

    const triggers = detectSpellCastTriggers(card, permanent);
    const trigger = triggers.find((entry) => entry.tribalType === 'merfolk');

    expect(trigger).toBeTruthy();
    expect(trigger?.optionalPaymentCost).toBe('{1}');
    expect(trigger?.mandatory).toBe(false);
    expect(trigger?.createsToken).toBe(true);
    expect(trigger?.tokenDetails?.power).toBe(1);
    expect(trigger?.tokenDetails?.toughness).toBe(1);
    expect(String(trigger?.effect || '').toLowerCase()).toContain('create a 1/1 blue merfolk creature token');
  });
});

describe('Kindred Discovery chosen-type ETB and attack triggers', () => {
  const card = {
    name: 'Kindred Discovery',
    oracle_text:
      'As this enchantment enters, choose a creature type.\nWhenever a creature you control of the chosen type enters or attacks, draw a card.',
  };

  it('detects chosen-type enters-or-attacks trigger on ETB analysis', () => {
    const permanent = { id: 'kindred_1', controller: 'p1', chosenCreatureType: 'Merfolk', card };
    const triggers = detectETBTriggers(card, permanent);
    const trigger = triggers.find((entry) => entry.triggerType === 'chosen_type_creature_etb_or_attack');

    expect(trigger).toBeTruthy();
    expect(trigger?.effect).toBe('draw a card');
  });

  it('detects chosen-type enters-or-attacks trigger on attack analysis', () => {
    const permanent = { id: 'kindred_1', controller: 'p1', chosenCreatureType: 'Merfolk', card };
    const triggers = detectAttackTriggers(card, permanent);
    const trigger = triggers.find((entry) => entry.triggerType === 'chosen_type_creature_etb_or_attack');

    expect(trigger).toBeTruthy();
    expect(trigger?.effect).toBe('draw a card');
  });

  it('fires attack trigger only for attackers matching chosen type', () => {
    const permanent = {
      id: 'kindred_1',
      controller: 'p1',
      chosenCreatureType: 'Merfolk',
      card,
    };
    const merfolkAttacker = {
      id: 'merfolk_attacker',
      controller: 'p1',
      card: {
        name: 'Merfolk Looter',
        type_line: 'Creature — Merfolk',
        oracle_text: '',
      },
    };
    const humanAttacker = {
      id: 'human_attacker',
      controller: 'p1',
      card: {
        name: 'Soldier',
        type_line: 'Creature — Human Soldier',
        oracle_text: '',
      },
    };

    const ctx = {
      state: {
        players: [{ id: 'p1' }, { id: 'p2' }],
        battlefield: [permanent, merfolkAttacker, humanAttacker],
      },
    } as any;

    const triggers = getAttackTriggersForCreatures(
      ctx,
      [merfolkAttacker, humanAttacker],
      'p1',
      'p2',
    );

    const kindredTriggers = triggers.filter(
      (entry) => entry.triggerType === 'chosen_type_creature_etb_or_attack' && entry.cardName === 'Kindred Discovery',
    );

    expect(kindredTriggers).toHaveLength(1);
    expect((kindredTriggers[0] as any).value?.attackingCreatureId).toBe('merfolk_attacker');
  });
});

describe("Zur's Weirding draw replacement", () => {
  it('requires opponent payment choice when Zur\'s Weirding is on the battlefield', () => {
    const state = {
      players: [{ id: 'p1' }, { id: 'p2' }],
      battlefield: [
        {
          id: 'zurs_weirding',
          controller: 'p2',
          card: {
            name: "Zur's Weirding",
            oracle_text:
              "Players play with their hands revealed.\nIf a player would draw a card, they reveal it instead. Then any other player may pay 2 life. If a player does, put that card into its owner's graveyard. Otherwise, that player draws a card.",
          },
        },
      ],
      zones: {
        p1: { graveyard: [], hand: [], libraryCount: 5 },
      },
    };

    const replacement = evaluateDrawReplacementEvent({
      state,
      playerId: 'p1',
      count: 1,
      metadata: { remainingDrawCountAfterChoice: 0 },
    });

    expect(replacement.choiceRequired).toBe(true);
    expect(replacement.effectId).toBe('zurs-weirding-draw-replacement');
  });
});
