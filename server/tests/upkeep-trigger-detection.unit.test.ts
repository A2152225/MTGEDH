import { describe, expect, it } from 'vitest';
import { detectUpkeepTriggers } from '../src/state/modules/upkeep-triggers.js';

const permanent = { id: 'P1', controller: 'P1' };

describe('upkeep trigger detection', () => {
  it("detects exactly one Venser's Journal upkeep trigger from Oracle text", () => {
    const triggers = detectUpkeepTriggers({
      name: "Venser's Journal",
      oracle_text:
        'You have no maximum hand size.\nAt the beginning of your upkeep, you gain 1 life for each card in your hand.',
    }, permanent);

    expect(triggers).toHaveLength(1);
    expect(triggers[0]).toMatchObject({
      cardName: "Venser's Journal",
      triggerType: 'upkeep_effect',
      mandatory: true,
      effect: 'you gain 1 life for each card in your hand',
    });
  });

  it('detects epic each-of-your-upkeeps triggers', () => {
    const triggers = detectUpkeepTriggers({
      name: 'Neverending Torment',
      oracle_text: 'Epic\nAt the beginning of each of your upkeeps, copy this spell except for its epic ability.',
    }, permanent);
    expect(triggers.length).toBeGreaterThan(0);
  });

  it('treats each-player-may counter placement as a mandatory upkeep trigger', () => {
    const oracleText =
      'At the beginning of your upkeep, each player may put two +1/+1 counters on a creature they control. ' +
      "If a player does, creatures that player controls can't attack you or planeswalkers you control until your next turn.";

    const triggers = detectUpkeepTriggers({
      name: 'Orzhov Advokist',
      oracle_text: oracleText,
    }, permanent);

    const upkeepEffect = triggers.find((trigger) => trigger.triggerType === 'upkeep_effect');
    expect(upkeepEffect).toBeDefined();
    expect(upkeepEffect?.mandatory).toBe(true);
    expect(upkeepEffect?.requiresChoice).toBe(true);
    expect(String(upkeepEffect?.effect || '')).toContain('each player may put two +1/+1 counters');
  });

  it('does not treat Court of Garenbrig ETB monarch as an upkeep effect', () => {
    const oracleText =
      'When Court of Garenbrig enters the battlefield, you become the monarch.\n' +
      'At the beginning of your upkeep, distribute two +1/+1 counters among up to two target creatures.';

    const triggers = detectUpkeepTriggers({
      name: 'Court of Garenbrig',
      oracle_text: oracleText,
    }, permanent);

    const upkeepEffects = triggers
      .filter((trigger) => trigger.triggerType === 'upkeep_effect')
      .map((trigger) => String(trigger.effect || trigger.description || '').toLowerCase());

    expect(upkeepEffects).toContain('distribute two +1/+1 counters among up to two target creatures');
    expect(upkeepEffects.some((effect) => effect.includes('become the monarch'))).toBe(false);
    expect(upkeepEffects.some((effect) => effect.includes('become monarch'))).toBe(false);
  });

  it('detects a single Phyrexian Arena upkeep from oracle text', () => {
    const triggers = detectUpkeepTriggers({
      name: 'Phyrexian Arena',
      oracle_text: 'At the beginning of your upkeep, you draw a card and you lose 1 life.',
    }, permanent).filter((trigger) => trigger.triggerType === 'upkeep_effect');

    expect(triggers).toHaveLength(1);
    expect(String(triggers[0]?.effect || '').toLowerCase()).toContain('draw a card');
    expect(String(triggers[0]?.effect || '').toLowerCase()).toContain('lose 1 life');
  });

  it('keeps Power Surge where-X on the each-player upkeep effect', () => {
    const triggers = detectUpkeepTriggers({
      name: 'Power Surge',
      oracle_text:
        "At the beginning of each player's upkeep, this enchantment deals X damage to that player, where X is the number of untapped lands they controlled at the beginning of this turn.",
    }, permanent);

    const eachPlayer = triggers.find((trigger) => trigger.triggerType === 'each_player_upkeep');
    expect(eachPlayer).toBeDefined();
    expect(String(eachPlayer?.effect || '').toLowerCase()).toContain('deals x damage to that player');
    expect(String(eachPlayer?.effect || '').toLowerCase()).toContain(
      'untapped lands they controlled at the beginning of this turn',
    );
  });

  it('types Eldrazi Monument as a single sacrifice_creature_or_self upkeep', () => {
    const triggers = detectUpkeepTriggers({
      name: 'Eldrazi Monument',
      oracle_text:
        'Creatures you control get +1/+1, have flying, and have indestructible.\n' +
        "At the beginning of your upkeep, sacrifice a creature. If you can't, sacrifice Eldrazi Monument.",
    }, permanent);

    const typed = triggers.filter((trigger) =>
      ['upkeep_effect', 'sacrifice_creature_or_self'].includes(String(trigger.triggerType)),
    );
    expect(typed).toHaveLength(1);
    expect(typed[0]?.triggerType).toBe('sacrifice_creature_or_self');
  });

  it('detects Sheoldred, Whispering One your-upkeep and opponent-upkeep separately', () => {
    const triggers = detectUpkeepTriggers({
      name: 'Sheoldred, Whispering One',
      oracle_text:
        'Swampwalk\n' +
        'At the beginning of your upkeep, return target creature card from your graveyard to the battlefield.\n' +
        "At the beginning of each opponent's upkeep, that player sacrifices a creature.",
    }, permanent);

    expect(triggers.some((t) => t.triggerType === 'upkeep_effect')).toBe(true);
    expect(triggers.some((t) => t.triggerType === 'opponent_upkeep')).toBe(true);
  });

  it('detects Search for Azcanta surveil upkeep from the front face', () => {
    const searchForAzcanta = {
      name: 'Search for Azcanta // Azcanta, the Sunken Ruin',
      layout: 'transform',
      type_line: 'Legendary Enchantment // Legendary Land',
      card_faces: [
        {
          name: 'Search for Azcanta',
          type_line: 'Legendary Enchantment',
          oracle_text:
            'At the beginning of your upkeep, surveil 1. Then if you have seven or more cards in your graveyard, you may transform Search for Azcanta.',
        },
        {
          name: 'Azcanta, the Sunken Ruin',
          type_line: 'Legendary Land',
          oracle_text:
            '{T}: Add {U}.\n{2}{U}, {T}: Look at the top four cards of your library. You may reveal a noncreature, nonland card from among them and put it into your hand. Put the rest on the bottom of your library in any order.',
        },
      ],
    };

    const triggers = detectUpkeepTriggers(searchForAzcanta, permanent).filter(
      (trigger) => trigger.triggerType === 'upkeep_effect',
    );
    expect(triggers).toHaveLength(1);
    expect(triggers[0]?.cardName).toBe('Search for Azcanta');
    expect(String(triggers[0]?.effect || '')).toContain('surveil 1');
  });

  it('does not surface the front-face upkeep trigger once Search for Azcanta has transformed', () => {
    const searchForAzcanta = {
      name: 'Search for Azcanta // Azcanta, the Sunken Ruin',
      layout: 'transform',
      type_line: 'Legendary Enchantment // Legendary Land',
      card_faces: [
        {
          name: 'Search for Azcanta',
          type_line: 'Legendary Enchantment',
          oracle_text:
            'At the beginning of your upkeep, surveil 1. Then if you have seven or more cards in your graveyard, you may transform Search for Azcanta.',
        },
        {
          name: 'Azcanta, the Sunken Ruin',
          type_line: 'Legendary Land',
          oracle_text:
            '{T}: Add {U}.\n{2}{U}, {T}: Look at the top four cards of your library. You may reveal a noncreature, nonland card from among them and put it into your hand. Put the rest on the bottom of your library in any order.',
        },
      ],
    };

    const transformedPermanent = { ...permanent, transformed: true };
    const triggers = detectUpkeepTriggers(searchForAzcanta, transformedPermanent).filter(
      (trigger) => trigger.triggerType === 'upkeep_effect',
    );
    expect(triggers).toHaveLength(0);
  });

  it('does not duplicate fading keyword reminder as a separate upkeep_effect', () => {
    const triggers = detectUpkeepTriggers(
      {
        name: 'Tangle Wire',
        oracle_text:
          'Fading 4 (This artifact enters with four fade counters on it. At the beginning of your upkeep, remove a fade counter from it. If you can\'t, sacrifice it.)\n' +
          'At the beginning of each player\'s upkeep, that player taps an untapped artifact, creature, or land they control for each fade counter on this artifact.',
      },
      { ...permanent, counters: { fade: 2 } },
    );

    expect(triggers.some((t) => t.triggerType === 'fading')).toBe(true);
    expect(triggers.some((t) => t.triggerType === 'each_player_upkeep')).toBe(true);
    expect(
      triggers.filter((t) => t.triggerType === 'upkeep_effect').map((t) => String(t.effect || '')),
    ).toEqual([]);
  });

  it('does not false-fire upkeep for misclassified non-upkeep cards', () => {
    const samples: Array<{ name: string; oracle_text: string }> = [
      {
        name: 'Rhystic Study',
        oracle_text:
          'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.',
      },
      {
        name: 'Sylvan Library',
        oracle_text:
          'At the beginning of your draw step, you may draw two additional cards. If you do, choose two cards in your hand drawn this turn. For each of those cards, pay 4 life or put the card on top of your library.',
      },
      {
        name: 'Black Market Connections',
        oracle_text:
          'At the beginning of your first main phase, choose one or more — Sell Contraband — Create a Treasure token. You lose 1 life. Buy Information — Draw a card. You lose 2 life. Hire a Mercenary — Create a 3/2 colorless Shapeshifter creature token with changeling. You lose 3 life.',
      },
      {
        name: "Atraxa, Praetors' Voice",
        oracle_text:
          'Flying, vigilance, deathtouch, lifelink\nAt the beginning of your end step, proliferate.',
      },
      {
        name: 'Greed',
        oracle_text: '{B}, Pay 2 life: Draw a card.',
      },
      {
        name: 'Necropotence',
        oracle_text:
          'Skip your draw step.\nWhenever you discard a card, exile that card from your graveyard.\nPay 1 life: Exile the top card of your library face down. Put that card into your hand at the beginning of your next end step.',
      },
      {
        name: 'Bob the Builder',
        oracle_text: 'Whenever you cast a creature spell, create a 1/1 colorless Construct artifact creature token.',
      },
    ];

    for (const sample of samples) {
      const triggers = detectUpkeepTriggers(sample, permanent).filter((trigger) =>
        ['upkeep_effect', 'each_upkeep', 'each_player_upkeep', 'opponent_upkeep', 'sacrifice_creature_or_self'].includes(
          String(trigger.triggerType),
        ),
      );
      expect(triggers, sample.name).toEqual([]);
    }
  });
});
