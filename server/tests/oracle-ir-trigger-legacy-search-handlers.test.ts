import { describe, expect, it } from 'vitest';

import { isTriggerEffectFullyIrWired } from '../src/state/modules/oracleIrTriggerLegacyRouting.js';
import { collectOracleEffectSteps, parseTriggerEffectSteps } from '../src/state/modules/trigger-runtime-wiring.js';

describe('oracle IR trigger legacy search handlers', () => {
  it('parses Protean Hulk search as any_number search_library with total MV cap', () => {
    const steps = parseTriggerEffectSteps(
      'search your library for any number of creature cards with total mana value 6 or less and put them onto the battlefield. Then shuffle.',
      'Protean Hulk',
    );
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      kind: 'search_library',
      destination: 'battlefield',
      maxResults: 'any_number',
      criteria: { kind: 'raw', text: 'creature with total mana value 6 or less' },
      shuffle: true,
    });
  });

  it('parses optional basic-land tutor triggers as wired search_library IR', () => {
    const effect =
      'you may search your library for a basic land card, put that card onto the battlefield tapped, then shuffle';
    expect(isTriggerEffectFullyIrWired(effect, 'Solemn Simulacrum')).toBe(true);
    const steps = collectOracleEffectSteps(effect, 'Solemn Simulacrum');
    expect(steps[0]).toMatchObject({
      kind: 'search_library',
      destination: 'battlefield',
      optional: true,
      entersTapped: true,
      criteria: { kind: 'raw', text: 'basic land' },
      shuffle: true,
    });
  });

  it('parses reveal-until-equipment exert triggers as wired look_choose_from_top IR', () => {
    const effect =
      'reveal cards from the top of your library until you reveal an Equipment card. Put that card onto the battlefield attached to that creature, then put the rest on the bottom of your library in a random order.';
    expect(isTriggerEffectFullyIrWired(effect, 'Rohirrim Chargers')).toBe(true);
    const steps = collectOracleEffectSteps(effect, 'Rohirrim Chargers');
    expect(steps[0]).toMatchObject({
      kind: 'look_choose_from_top',
      selectorText: 'Equipment',
      destination: 'battlefield',
      reveal: true,
      amount: { kind: 'reference_amount', raw: 'until you reveal an Equipment card' },
    });
  });

  it('parses Herald\'s Horn upkeep and Bloodline Shaman reveal-top as wired look_choose_from_top IR', () => {
    const hornEffect =
      "At the beginning of your upkeep, look at the top card of your library. You may reveal that card if it's a creature card of the chosen type. If you do, put it into your hand.";
    expect(isTriggerEffectFullyIrWired(hornEffect, "Herald's Horn")).toBe(true);
    expect(collectOracleEffectSteps(hornEffect, "Herald's Horn")[0]).toMatchObject({
      kind: 'look_choose_from_top',
      selectorText: 'creature card of the chosen type',
      destination: 'hand',
      optional: true,
      nonMatchRest: 'library_top',
    });

    const shamanEffect =
      'Reveal the top card of your library. If that card is a creature card of the chosen type, put it into your hand. Otherwise, put it into your graveyard.';
    expect(isTriggerEffectFullyIrWired(shamanEffect, 'Bloodline Shaman')).toBe(true);
    expect(collectOracleEffectSteps(shamanEffect, 'Bloodline Shaman')[0]).toMatchObject({
      kind: 'look_choose_from_top',
      selectorText: 'creature card of the chosen type',
      destination: 'hand',
      optional: false,
      nonMatchRest: 'graveyard',
      reveal: true,
    });
  });

  it('parses discard-triggered and targeted graveyard cast as wired grant_graveyard_permission IR', () => {
    const oskarEffect = 'Whenever you discard a nonland card, you may cast it from your graveyard.';
    expect(isTriggerEffectFullyIrWired(oskarEffect, 'Oskar, Rubbish Reclaimer')).toBe(true);
    expect(collectOracleEffectSteps(oskarEffect, 'Oskar, Rubbish Reclaimer')[0]).toMatchObject({
      kind: 'grant_graveyard_permission',
      permission: 'cast',
      what: { kind: 'raw', text: 'it' },
      optional: true,
    });

    const gearhulkEffect =
      'you may cast target instant card from your graveyard without paying its mana cost. If that spell would be put into your graveyard, exile it instead.';
    expect(isTriggerEffectFullyIrWired(gearhulkEffect, 'Torrential Gearhulk')).toBe(true);
    expect(collectOracleEffectSteps(gearhulkEffect, 'Torrential Gearhulk')).toEqual([
      expect.objectContaining({
        kind: 'grant_graveyard_permission',
        permission: 'cast',
        what: { kind: 'raw', text: 'target instant card' },
        optional: true,
      }),
      expect.objectContaining({
        kind: 'modify_graveyard_permissions',
        withoutPayingManaCost: true,
        exileInsteadOfGraveyard: true,
      }),
    ]);
  });
});
