import { describe, expect, it } from 'vitest';

import { getPlaneswalkerTemplateMatch } from '../src/state/planeswalker/templates/registry.js';
import {
  SEEK_A_TYPED_CARD_REGEX,
  SEEK_AN_ELF_CARD_REGEX,
  PUT_P1P1_COUNTERS_ON_TARGET_CREATURE_IT_BECOMES_A_TYPED_CREATURE_IN_ADDITION_TO_ITS_OTHER_TYPES_AND_GAINS_KEYWORDS_REGEX,
  PUT_P1P1_COUNTERS_ON_TARGET_CREATURE_IT_BECOMES_AN_ANGEL_IN_ADDITION_TO_ITS_OTHER_TYPES_AND_GAINS_FLYING_REGEX,
  UNTAP_UP_TO_ONE_TARGET_ELF_THAT_ELF_AND_RANDOM_ELF_IN_HAND_PERPETUALLY_GET_P1P1_REGEX,
  TYPED_CARDS_IN_HAND_PERPETUALLY_GAIN_COST_REDUCTION_AND_PAY_X_REGEX,
} from '../src/state/planeswalker/templates/registry-handlers/planeswalkerTemplatePumpHandCounterManaRegexes.js';
import {
  TARGET_CREATURE_YOU_CONTROL_GAINS_DEATHTOUCH_AND_LIFELINK_EOT_IF_TYPED_P1P1_REGEX,
  TARGET_CREATURE_YOU_CONTROL_GAINS_DEATHTOUCH_AND_LIFELINK_EOT_IF_VAMPIRE_P1P1_REGEX,
} from '../src/state/planeswalker/templates/registry-handlers/planeswalkerTemplateDrawExileLookRegexes.js';

describe('loyalty templates: generic creature-type N', () => {
  it('keeps legacy regex aliases pointing at the generic patterns', () => {
    expect(SEEK_AN_ELF_CARD_REGEX).toBe(SEEK_A_TYPED_CARD_REGEX);
    expect(PUT_P1P1_COUNTERS_ON_TARGET_CREATURE_IT_BECOMES_AN_ANGEL_IN_ADDITION_TO_ITS_OTHER_TYPES_AND_GAINS_FLYING_REGEX)
      .toBe(PUT_P1P1_COUNTERS_ON_TARGET_CREATURE_IT_BECOMES_A_TYPED_CREATURE_IN_ADDITION_TO_ITS_OTHER_TYPES_AND_GAINS_KEYWORDS_REGEX);
    expect(TARGET_CREATURE_YOU_CONTROL_GAINS_DEATHTOUCH_AND_LIFELINK_EOT_IF_VAMPIRE_P1P1_REGEX)
      .toBe(TARGET_CREATURE_YOU_CONTROL_GAINS_DEATHTOUCH_AND_LIFELINK_EOT_IF_TYPED_P1P1_REGEX);
  });

  it('matches Seek a [type] card for Elf (legacy id) and Goblin (generic id)', () => {
    expect(SEEK_A_TYPED_CARD_REGEX.test('Seek an Elf card.')).toBe(true);
    expect(SEEK_A_TYPED_CARD_REGEX.test('Seek a Goblin card.')).toBe(true);
    expect(getPlaneswalkerTemplateMatch('Seek an Elf card.')?.id).toBe('SEEK_AN_ELF_CARD');
    expect(getPlaneswalkerTemplateMatch('Seek a Goblin card.')?.id).toBe('SEEK_A_TYPED_CARD');
  });

  it('matches becomes a [type] and gains [keyword] for Angel/Flying and Goblin/Menace', () => {
    const angel = 'Put two +1/+1 counters on target creature. It becomes an Angel in addition to its other types and gains flying.';
    const goblin = 'Put two +1/+1 counters on target creature. It becomes a Goblin in addition to its other types and gains menace.';
    expect(PUT_P1P1_COUNTERS_ON_TARGET_CREATURE_IT_BECOMES_A_TYPED_CREATURE_IN_ADDITION_TO_ITS_OTHER_TYPES_AND_GAINS_KEYWORDS_REGEX.test(angel)).toBe(true);
    expect(PUT_P1P1_COUNTERS_ON_TARGET_CREATURE_IT_BECOMES_A_TYPED_CREATURE_IN_ADDITION_TO_ITS_OTHER_TYPES_AND_GAINS_KEYWORDS_REGEX.test(goblin)).toBe(true);
    expect(getPlaneswalkerTemplateMatch(angel)?.id).toBe(
      'PUT_P1P1_COUNTERS_ON_TARGET_CREATURE_IT_BECOMES_AN_ANGEL_IN_ADDITION_TO_ITS_OTHER_TYPES_AND_GAINS_FLYING',
    );
    expect(getPlaneswalkerTemplateMatch(goblin)?.id).toBe(
      'PUT_P1P1_COUNTERS_ON_TARGET_CREATURE_IT_BECOMES_A_TYPED_CREATURE_IN_ADDITION_TO_ITS_OTHER_TYPES_AND_GAINS_KEYWORDS',
    );
  });

  it('matches if it is a [type], put a +1/+1 for Vampire and Elf', () => {
    const vampire = "Target creature you control gains deathtouch and lifelink until end of turn. If it's a Vampire, put a +1/+1 counter on it.";
    const elf = "Target creature you control gains deathtouch and lifelink until end of turn. If it's an Elf, put a +1/+1 counter on it.";
    expect(TARGET_CREATURE_YOU_CONTROL_GAINS_DEATHTOUCH_AND_LIFELINK_EOT_IF_TYPED_P1P1_REGEX.test(vampire)).toBe(true);
    expect(TARGET_CREATURE_YOU_CONTROL_GAINS_DEATHTOUCH_AND_LIFELINK_EOT_IF_TYPED_P1P1_REGEX.test(elf)).toBe(true);
    expect(getPlaneswalkerTemplateMatch(vampire)?.id).toBe(
      'TARGET_CREATURE_YOU_CONTROL_GAINS_DEATHTOUCH_AND_LIFELINK_EOT_IF_VAMPIRE_P1P1',
    );
    expect(getPlaneswalkerTemplateMatch(elf)?.id).toBe(
      'TARGET_CREATURE_YOU_CONTROL_GAINS_DEATHTOUCH_AND_LIFELINK_EOT_IF_TYPED_P1P1',
    );
  });

  it('matches untap up to one target [type] for Elf and Goblin', () => {
    const elf = 'Untap up to one target Elf. That Elf and a random Elf creature card in your hand perpetually get +1/+1.';
    const goblin = 'Untap up to one target Goblin. That Goblin and a random Goblin creature card in your hand perpetually get +1/+1.';
    expect(UNTAP_UP_TO_ONE_TARGET_ELF_THAT_ELF_AND_RANDOM_ELF_IN_HAND_PERPETUALLY_GET_P1P1_REGEX.test(elf)).toBe(true);
    expect(UNTAP_UP_TO_ONE_TARGET_ELF_THAT_ELF_AND_RANDOM_ELF_IN_HAND_PERPETUALLY_GET_P1P1_REGEX.test(goblin)).toBe(true);
    expect(getPlaneswalkerTemplateMatch(elf)?.id).toBe(
      'UNTAP_UP_TO_ONE_TARGET_ELF_THAT_ELF_AND_RANDOM_ELF_IN_HAND_PERPETUALLY_GET_P1P1',
    );
    expect(getPlaneswalkerTemplateMatch(goblin)?.id).toBe(
      'UNTAP_UP_TO_ONE_TARGET_TYPED_THAT_TYPE_AND_RANDOM_TYPE_IN_HAND_PERPETUALLY_GET_P1P1',
    );
  });

  it('matches [type] cards in hand perpetual cost reduction for Dragon and Goblin', () => {
    const dragon = 'Dragon cards in your hand perpetually gain "this spell costs {1} less to cast," and "you may pay {X} rather than pay this spell\'s mana cost, where X is its mana value."';
    const goblin = 'Goblin cards in your hand perpetually gain "this spell costs {1} less to cast," and "you may pay {X} rather than pay this spell\'s mana cost, where X is its mana value."';
    expect(TYPED_CARDS_IN_HAND_PERPETUALLY_GAIN_COST_REDUCTION_AND_PAY_X_REGEX.test(dragon)).toBe(true);
    expect(TYPED_CARDS_IN_HAND_PERPETUALLY_GAIN_COST_REDUCTION_AND_PAY_X_REGEX.test(goblin)).toBe(true);
    expect(getPlaneswalkerTemplateMatch(dragon)?.id).toBe(
      'DRAGON_CARDS_IN_HAND_PERPETUALLY_GAIN_COST_REDUCTION_AND_PAY_X',
    );
    expect(getPlaneswalkerTemplateMatch(goblin)?.id).toBe(
      'TYPED_CARDS_IN_HAND_PERPETUALLY_GAIN_COST_REDUCTION_AND_PAY_X',
    );
  });

  it('matches destroy all non-[type] creatures for Zombie, Dragon, and Goblin', () => {
    expect(getPlaneswalkerTemplateMatch('Destroy all non-Zombie creatures.')?.id).toBe(
      'DESTROY_ALL_NON_ZOMBIE_CREATURES',
    );
    expect(getPlaneswalkerTemplateMatch('Destroy all non-Dragon creatures.')?.id).toBe(
      'DESTROY_ALL_NON_DRAGON_CREATURES',
    );
    expect(getPlaneswalkerTemplateMatch('Destroy all non-Goblin creatures.')?.id).toBe(
      'DESTROY_ALL_NON_TYPED_CREATURES',
    );
  });
});
