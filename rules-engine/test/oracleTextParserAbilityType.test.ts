import { describe, expect, it } from 'vitest';

import { AbilityType, parseOracleText } from '../src/oracleTextParser';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { collectSpellResolutionEffectStepsWithOverlay } from '../src/oracleIRCompilerEnvelope';

describe('oracleTextParser ability classification (fast debug)', () => {
  it('classifies standalone look-top-X as spell ability, not static', () => {
    const parsed = parseOracleText(
      'Look at the top X cards of your library, where X is the number of lands you control.',
      'Test Card'
    );
    expect(parsed.abilities).toHaveLength(1);
    expect(parsed.abilities[0]?.type).toBe(AbilityType.SPELL);
  });

  it('classifies Mindskinner as replacement, Desmond as triggered, Mindcrank as triggered', () => {
    const cases: Array<{ name: string; text: string; type: AbilityType }> = [
      {
        name: 'Mindskinner',
        text: 'If a source you control would deal damage to an opponent, prevent that damage and each opponent mills that many cards.',
        type: AbilityType.REPLACEMENT,
      },
      {
        name: 'Desmond',
        text: 'Whenever Desmond Miles deals combat damage to a player, surveil X, where X is the amount of damage it dealt to that player.',
        type: AbilityType.TRIGGERED,
      },
      {
        name: 'Mindcrank',
        text: 'Whenever an opponent loses life, that player mills that many cards.',
        type: AbilityType.TRIGGERED,
      },
    ];

    for (const sample of cases) {
      const parsed = parseOracleText(sample.text, sample.name);
      expect(parsed.abilities[0]?.type, sample.name).toBe(sample.type);
    }
  });

  it('parses Mindskinner, Desmond, and Mindcrank IR steps', () => {
    const samples = [
      {
        name: 'Mindskinner',
        text: 'If a source you control would deal damage to an opponent, prevent that damage and each opponent mills that many cards.',
        expectedKinds: ['prevent_damage', 'mill'],
      },
      {
        name: 'Desmond',
        text: 'Whenever Desmond Miles deals combat damage to a player, surveil X, where X is the amount of damage it dealt to that player.',
        expectedKinds: ['surveil'],
      },
      {
        name: 'Mindcrank',
        text: 'Whenever an opponent loses life, that player mills that many cards.',
        expectedKinds: ['mill'],
      },
    ] as const;

    for (const sample of samples) {
      const ir = parseOracleTextToIR(sample.text, sample.name);
      const kinds = ir.abilities.flatMap(ability => ability.steps.map(step => step.kind));
      for (const kind of sample.expectedKinds) {
        expect(kinds, sample.name).toContain(kind);
      }
    }
  });

  it('keeps spell-resolution follow-ups typed SPELL so collectSpellResolutionEffectSteps retains them', () => {
    const cases: Array<{ name: string; text: string; expectedKinds: string[] }> = [
      {
        name: "Night's Whisper",
        text: 'You draw two cards and lose 2 life.',
        expectedKinds: ['draw', 'lose_life'],
      },
      {
        name: "Angel's Mercy",
        text: 'You gain 7 life.',
        expectedKinds: ['gain_life'],
      },
      {
        name: 'Abeyance',
        text:
          "Until end of turn, target player can't cast instant or sorcery spells, and that player can't activate abilities that aren't mana abilities.\nDraw a card.",
        expectedKinds: ['grant_temporary_ability', 'draw'],
      },
      {
        name: 'Falter',
        text: "Creatures without flying can't block this turn.",
        expectedKinds: ['cant_block'],
      },
      {
        name: 'About Face',
        text: "Switch target creature's power and toughness until end of turn.",
        expectedKinds: ['switch_power_toughness'],
      },
      {
        name: 'Aetherspouts',
        text: 'For each attacking creature, its owner puts it on their choice of the top or bottom of their library.',
        expectedKinds: ['move_zone'],
      },
      {
        name: "Aang's Journey",
        text:
          'Search your library for a basic land card. Reveal those cards, put them into your hand, then shuffle.\nYou gain 2 life.',
        expectedKinds: ['search_library', 'gain_life'],
      },
      {
        name: 'Academic Dispute',
        text:
          'Target creature blocks this turn if able. You may have it gain reach until end of turn.\nLearn. (You may reveal a Lesson card you own from outside the game and put it into your hand, or discard a card to draw a card.)',
        expectedKinds: ['force_block', 'grant_temporary_ability', 'learn'],
      },
      {
        name: "Alrund's Epiphany",
        text: 'Create two 1/1 blue Bird creature tokens with flying. Take an extra turn after this one. Exile Alrund\'s Epiphany.',
        expectedKinds: ['create_token', 'take_extra_turn', 'exile'],
      },
      {
        name: 'Brave the Elements',
        text:
          'Choose a color. White creatures you control gain protection from the chosen color until end of turn.',
        expectedKinds: ['choose_color', 'grant_temporary_ability'],
      },
      {
        name: 'A-Galvanic Discharge',
        text:
          'Choose target creature or planeswalker. You get {E}{E}, then you may pay any amount of {E}. Galvanic Discharge deals that much damage to that permanent.',
        expectedKinds: ['deal_damage'],
      },
      {
        name: 'Death Ward',
        text: 'Regenerate target creature.',
        expectedKinds: ['regenerate'],
      },
      {
        name: 'Bulk Up',
        text: "Double target creature's power until end of turn.",
        expectedKinds: ['modify_pt'],
      },
      {
        name: 'Brilliant Spectrum',
        text: 'Converge — Draw X cards, where X is the number of colors of mana spent to cast this spell. Then discard two cards.',
        expectedKinds: ['draw', 'discard'],
      },
      {
        name: 'Awe for the Guilds',
        text: "Monocolored creatures can't block this turn.",
        expectedKinds: ['cant_block'],
      },
      {
        name: 'Blinding Flare',
        text: "Any number of target creatures can't block this turn.",
        expectedKinds: ['cant_block'],
      },
      {
        name: 'Bond of Agony',
        text: 'As an additional cost to cast this spell, pay X life.\nEach other player loses X life.',
        expectedKinds: ['lose_life'],
      },
      {
        name: 'Dread Charge',
        text: "Black creatures you control can't be blocked this turn except by black creatures.",
        expectedKinds: ['grant_temporary_ability'],
      },
    ];

    for (const sample of cases) {
      const parsed = parseOracleText(sample.text, sample.name);
      const nonSpell = parsed.abilities.filter(
        (ability) =>
          ability.type !== AbilityType.SPELL &&
          ability.type !== AbilityType.KEYWORD &&
          !/^kicker\b/i.test(String(ability.text || '')) &&
          !/^as an additional cost to cast this spell\b/i.test(String(ability.text || '')),
      );
      expect(nonSpell, `${sample.name} parsed non-spell`).toEqual([]);

      const collected = collectSpellResolutionEffectStepsWithOverlay(sample.text, sample.name);
      const kinds = collected.map((step) => step.kind);
      for (const kind of sample.expectedKinds) {
        expect(kinds, `${sample.name} collected ${kind}`).toContain(kind);
      }
    }
  });

  it('keeps continuous permanent text typed STATIC', () => {
    const parsed = parseOracleText(
      'Creatures you control get +1/+1.\nYou have hexproof.',
      'Test Aura',
    );
    expect(parsed.abilities.every((ability) => ability.type === AbilityType.STATIC)).toBe(true);
  });
});
