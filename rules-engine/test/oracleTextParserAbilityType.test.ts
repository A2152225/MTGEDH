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
      {
        name: 'Secret Rendezvous',
        text: 'You and target opponent each draw three cards.',
        expectedKinds: ['draw'],
      },
      {
        name: 'Silence',
        text: "Your opponents can't cast spells this turn.",
        expectedKinds: ['grant_static_ability'],
      },
      {
        name: 'Gather Specimens',
        text: "If a creature would enter the battlefield under an opponent's control this turn, it enters under your control instead.",
        expectedKinds: ['grant_static_ability'],
      },
      {
        name: 'Combust',
        text:
          "This spell can't be countered.\nCombust deals 5 damage to target white or blue creature. The damage can't be prevented.",
        expectedKinds: ['deal_damage', 'damage_cant_be_prevented'],
      },
      {
        name: "Barrin's Spite",
        text:
          'Choose two target creatures controlled by the same player. Their controller chooses and sacrifices one of them. Return the other to its owner\'s hand.',
        expectedKinds: ['choose_target_creature', 'move_zone'],
      },
      {
        name: 'Torment of Hailfire',
        text:
          'Repeat the following process X times. Each opponent loses 3 life unless that player sacrifices a nonland permanent of their choice or discards a card.',
        expectedKinds: ['lose_life'],
      },
      {
        name: 'Dance of the Tumbleweeds',
        text:
          'Spree (Choose one or more additional costs.)\n+ {1} — Search your library for a basic land card or a Desert card, put it onto the battlefield, then shuffle.\n+ {3} — Create an X/X green Elemental creature token, where X is the number of lands you control.',
        expectedKinds: ['search_library', 'create_token'],
      },
      {
        name: 'Circadian Struggle',
        text:
          'Vivid — Seek X cards that each share a color with one or more permanents you control, where X is the number of colors among permanents you control. For each color among permanents you control, those cards perpetually gain "This spell costs {1} less to cast."',
        expectedKinds: ['grant_static_ability'],
      },
      {
        name: 'Absorb Energy',
        text:
          'Counter target spell. Cards in your hand that share a card type with that spell perpetually gain "This spell costs {1} less to cast."',
        expectedKinds: ['counter_spell', 'grant_static_ability'],
      },
      {
        name: 'Leave No Trace',
        text: 'Radiance — Destroy target enchantment and each other enchantment that shares a color with it.',
        expectedKinds: ['destroy'],
      },
      {
        name: 'Blood on the Snow',
        text:
          'Choose one —\n• Destroy all creatures.\n• Destroy all planeswalkers.\nThen return a creature or planeswalker card with mana value X or less from your graveyard to the battlefield, where X is the amount of {S} spent to cast this spell.',
        expectedKinds: ['choose_mode', 'move_zone'],
      },
      {
        name: 'Final Showdown',
        text:
          'Spree (Choose one or more additional costs.)\n+ {1} — All creatures lose all abilities until end of turn.\n+ {1} — Choose a creature you control. It gains indestructible until end of turn.\n+ {3}{W}{W} — Destroy all creatures.',
        expectedKinds: ['destroy'],
      },
      {
        name: 'Chance for Glory',
        text:
          "Creatures you control gain indestructible. Take an extra turn after this one. At the beginning of that turn's end step, you lose the game.",
        expectedKinds: ['take_extra_turn'],
      },
      {
        name: 'Flaring Pain',
        text: "Damage can't be prevented this turn.",
        expectedKinds: ['damage_cant_be_prevented'],
      },
      {
        name: 'Full Throttle',
        text: 'After this main phase, there are two additional combat phases.',
        expectedKinds: ['add_extra_combat'],
      },
      {
        name: "Hunters' Feast",
        text: 'Any number of target players each gain 6 life.',
        expectedKinds: ['gain_life'],
      },
      {
        name: 'Reward the Faithful',
        text:
          'Any number of target players each gain life equal to the greatest mana value among permanents you control.',
        expectedKinds: ['gain_life'],
      },
      {
        name: 'Turtle Tracks',
        text:
          'Any number of target players may each search their library for a basic land card, put it onto the battlefield under their control, then shuffle.',
        expectedKinds: ['search_library'],
      },
      {
        name: 'Soul Partition',
        text:
          'Exile target nonland permanent. For as long as that card remains exiled, its owner may play it. A spell cast by an opponent this way costs {2} more to cast.',
        expectedKinds: ['exile'],
      },
      {
        name: "Savor the Moment",
        text: 'Take an extra turn after this one. Skip the untap step of that turn.',
        expectedKinds: ['take_extra_turn'],
      },
      {
        name: 'Tangle',
        text: "Prevent all combat damage that would be dealt this turn. Each attacking creature doesn't untap during its controller's next untap step.",
        expectedKinds: ['prevent_damage'],
      },
      {
        name: "Selvala's Charge",
        text:
          'Parley — Each player reveals the top card of their library. For each nonland card revealed this way, add {G} and that player puts the revealed card into their hand. Then each player who revealed a land card puts that card on the bottom of their library.',
        expectedKinds: ['reveal_top'],
      },
      {
        name: 'Surge of Brilliance',
        text:
          "Paradox — Draw a card for each spell you've cast this turn from anywhere other than your hand.",
        expectedKinds: ['draw'],
      },
    ];

    for (const sample of cases) {
      const parsed = parseOracleText(sample.text, sample.name);
      const nonSpell = parsed.abilities.filter(
        (ability) =>
          ability.type !== AbilityType.SPELL &&
          ability.type !== AbilityType.KEYWORD &&
          ability.type !== AbilityType.TRIGGERED &&
          !/^kicker\b/i.test(String(ability.text || '')) &&
          !/^as an additional cost to cast this spell\b/i.test(String(ability.text || '')) &&
          !/^this spell (?:has|costs?|can'?t)\b/i.test(String(ability.text || '')) &&
          !/^you may cast this spell\b/i.test(String(ability.text || '')) &&
          !/^spree\s*\(/i.test(String(ability.text || '')),
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
