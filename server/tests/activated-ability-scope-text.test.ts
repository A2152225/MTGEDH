import { describe, expect, it } from 'vitest';

import { getActivatedAbilityScopeText, buildActivatedAbilityOracleTextForStack } from '../src/socket/interaction.js';

const WHIP_INLINE_ORACLE =
  '{2}{B}{B}, {T}: Return target creature card from your graveyard to the battlefield. It gains haste. Exile it at the beginning of the next end step. If it would leave the battlefield, exile it instead of putting it anywhere else. Activate only as a sorcery.';

const KAVARON_ORACLE =
  '{T}: Add {R}.\n' +
  "Station (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery. It's an artifact creature at 12+.)\n" +
  '12+ | {1}{R}, {T}, Sacrifice a land: Create a 2/2 colorless Robot artifact creature token, then creatures you control get +1/+0 and gain haste until end of turn.';

const CARTOGRAPHER_ORACLE =
  '{T}: Draw a card.\nStation 3\n3+ | This becomes an artifact creature.';

const BROODSHIP_ORACLE =
  "Station (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery. It's an artifact creature at 8+.)\n" +
  '3+ | You may play an additional land on each of your turns.\n' +
  '8+ | Flying\n' +
  'Once during each of your turns, you may cast a permanent spell from your graveyard by sacrificing a land in addition to paying its other costs.';

describe('getActivatedAbilityScopeText', () => {
  it('keeps multi-sentence activated effects on single-line oracle text', () => {
    const { abilityText, fullAbilityText } = getActivatedAbilityScopeText(
      WHIP_INLINE_ORACLE,
      'whip-0',
    );

    expect(abilityText).toContain('It gains haste');
    expect(abilityText).toContain('Exile it at the beginning of the next end step');
    expect(abilityText).toContain('If it would leave the battlefield, exile it instead');
    expect(abilityText).not.toMatch(/^Return target creature card from your graveyard to the battlefield\.$/);
    expect(fullAbilityText).toContain('It gains haste');
  });

  it('skips Station keyword lines when indexing activated abilities', () => {
    const mana = getActivatedAbilityScopeText(KAVARON_ORACLE, 'kavaron_card_1-ability-0');
    expect(mana.abilityText).toMatch(/add \{r\}/i);
    expect(mana.fullAbilityText).toMatch(/^\{T\}:/i);

    const threshold = getActivatedAbilityScopeText(KAVARON_ORACLE, 'kavaron_card_1-ability-1');
    expect(threshold.fullAbilityText).toMatch(/^12\+\s*\|/);
    expect(threshold.abilityText).toMatch(/create a 2\/2 colorless robot/i);
  });

  it('prefers full threshold oracle line for deferred stack activation text', () => {
    const { fullAbilityText } = getActivatedAbilityScopeText(KAVARON_ORACLE, 'kavaron_card_1-ability-1');
    const stackText = buildActivatedAbilityOracleTextForStack({
      selectedAbilityFullText: fullAbilityText,
      manaCost: '{1}{R}, {T}, Sacrifice a land',
      abilityText: 'Create a 2/2 colorless Robot artifact creature token.',
    });
    expect(stackText).toMatch(/^12\+\s*\|/);
  });

  it('indexes canonical Broodship continuation-line graveyard cast at 8+ threshold', () => {
    const graveyard = getActivatedAbilityScopeText(BROODSHIP_ORACLE, 'broodship-ability-0');
    expect(graveyard.fullAbilityText).toMatch(/^8\+\s*\|/);
    expect(graveyard.fullAbilityText).toMatch(/once during each of your turns/i);
    expect(graveyard.abilityText).toMatch(/cast a permanent spell from your graveyard/i);
    expect(graveyard.fullAbilityText).not.toMatch(/^8\+\s*\|\s*flying/i);
  });

  it('indexes Exploration Broodship graveyard cast at 8+ and skips static keyword tiers', () => {
    const graveyard = getActivatedAbilityScopeText(BROODSHIP_ORACLE, 'broodship-ability-0');
    expect(graveyard.fullAbilityText).toMatch(/^8\+\s*\|/);
    expect(graveyard.abilityText).toMatch(/cast a permanent spell from your graveyard/i);

    const staticFlying = getActivatedAbilityScopeText(BROODSHIP_ORACLE, 'broodship-ability-1');
    expect(staticFlying.abilityText).toBe('');
    expect(staticFlying.fullAbilityText).toBe('');
  });

  it('does not index Cartographer Shuttle continuous creature typing as an activated ability', () => {
    const draw = getActivatedAbilityScopeText(CARTOGRAPHER_ORACLE, 'shuttle-ability-0');
    expect(draw.fullAbilityText).toMatch(/^\{T\}:/i);

    const creature = getActivatedAbilityScopeText(CARTOGRAPHER_ORACLE, 'shuttle-ability-1');
    expect(creature.abilityText).toBe('');
    expect(creature.fullAbilityText).toBe('');
  });
});
