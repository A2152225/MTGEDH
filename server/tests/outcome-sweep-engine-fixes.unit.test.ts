import { describe, expect, it } from 'vitest';
import { stripCastTargetReminderText } from '../src/socket/game-actions-handlers/castTargetReminderText.js';
import { permanentMatchesTargetTypes } from '../src/socket/permanentTargetTypeFilter.js';
import { parseTapUntapAbilityText } from '../src/socket/interaction-handlers/interactionActivateBattlefieldAbilityHelpers.js';
import { parseGraveyardExileSelfAbility } from '../src/socket/interaction-handlers/interactionGraveyardExileStackAbility.js';
import { detectEntersWithCounters } from '../src/state/modules/detectEntersWithCounters.js';
import { calculateChosenPlayerHandPT } from '../src/state/modules/batch101LongTailApply.js';
import { reviewActivatedAbilityTargets } from '../../rules-engine/src/aiActivatedAbilityTargets.js';

describe('outcome sweep: cast target reminder text (family #13)', () => {
  it('drops non-target reminder text and awaken / delayed-earthbend targets', () => {
    expect(stripCastTargetReminderText('Target creature gets +0/+5 and gains reach until end of turn. (It can block creatures with flying.)'))
      .toBe('Target creature gets +0/+5 and gains reach until end of turn.');
    expect(stripCastTargetReminderText('Target creature gains lifelink.\nAwaken 4—{4}{W} (If you cast this spell for {4}{W}, also put four +1/+1 counters on target land you control.)'))
      .toBe('Target creature gains lifelink.\nAwaken 4—{4}{W}');
    expect(stripCastTargetReminderText('Choose target creature. When that creature dies this turn, you earthbend 4. (Target land you control becomes a 0/0 creature.)'))
      .toBe('Choose target creature. When that creature dies this turn, you earthbend 4.');
  });
  it('keeps the target of a top-level keyword action', () => {
    const text = 'Earthbend 3. (Target land you control becomes a 0/0 creature.)';
    expect(stripCastTargetReminderText(text)).toBe(text);
  });
});

describe('outcome sweep: shared target type filter (tap/untap)', () => {
  const elf = { id: 'a', card: { type_line: 'Creature — Elf Druid', colors: ['G'] } };
  const cat = { id: 'b', card: { type_line: 'Enchantment Creature — Cat', mana_cost: '{1}{W}' } };
  const island = { id: 'c', card: { type_line: 'Basic Land — Island', colors: [] } };
  it('treats permanent, colors and non- types as rules words', () => {
    expect(permanentMatchesTargetTypes(island, ['permanent'], false)).toBe(true);
    expect(permanentMatchesTargetTypes(elf, ['green creature'], false)).toBe(true);
    expect(permanentMatchesTargetTypes(cat, ['green creature'], false)).toBe(false);
    expect(permanentMatchesTargetTypes(cat, ['white creature'], false)).toBe(true);
    expect(permanentMatchesTargetTypes(cat, ['nonenchantment creature'], false)).toBe(false);
    expect(permanentMatchesTargetTypes(elf, ['nonenchantment creature'], false)).toBe(true);
  });
  it('keeps color / non- adjectives in parsed tap-untap filters', () => {
    expect(parseTapUntapAbilityText('{U}: Tap target green creature.')?.types).toEqual(['green creature']);
    expect(parseTapUntapAbilityText('{1}{W}, {T}: Tap target nonenchantment creature.')?.types).toEqual(['nonenchantment creature']);
    expect(parseTapUntapAbilityText('{T}: Untap another target permanent you control.')?.types).toEqual(['permanent']);
  });
});

describe('outcome sweep: graveyard exile-self abilities', () => {
  it('parses non-return effects and skips self-returns', () => {
    const accomplice = parseGraveyardExileSelfAbility({
      name: "Ghoulcaller's Accomplice",
      oracle_text: "{3}{B}, Exile Ghoulcaller's Accomplice from your graveyard: Create a 2/2 black Zombie creature token. Activate only as a sorcery.",
    });
    expect(accomplice).toEqual(expect.objectContaining({ manaCost: '{3}{B}', effectText: 'Create a 2/2 black Zombie creature token.', sorcerySpeed: true }));
    const renew = parseGraveyardExileSelfAbility({
      name: 'Sagu Pummeler',
      oracle_text: 'Reach\nRenew — {4}{G}, Exile this card from your graveyard: Put two +1/+1 counters and a reach counter on target creature. Activate only as a sorcery.',
    });
    expect(renew?.effectText).toBe('Put two +1/+1 counters and a reach counter on target creature.');
    expect(parseGraveyardExileSelfAbility({ name: 'Magma Phoenix', oracle_text: '{3}{R}{R}: Return Magma Phoenix from your graveyard to your hand.' })).toBeNull();
  });
});

describe('outcome sweep: singles', () => {
  it('detects "this land enters with" counters (Dark Depths modern wording)', () => {
    expect(detectEntersWithCounters({ name: 'Dark Depths', type_line: 'Legendary Snow Land', oracle_text: 'Dark Depths enters with ten ice counters on it.' })).toEqual({ ice: 10 });
    expect(detectEntersWithCounters({ name: 'Mine', type_line: 'Land', oracle_text: 'This land enters with three mining counters on it.' })).toEqual({ mining: 3 });
  });
  it('sizes a chosen-player hand CDA from the best legal choice while the choice is pending', () => {
    const card = { id: 'spec', name: 'Entropic Specter', oracle_text: "Entropic Specter's power and toughness are each equal to the number of cards in the chosen player's hand." };
    const state = {
      players: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }],
      battlefield: [{ id: 'spec', controller: 'p1', card }],
      zones: { p1: { hand: [1, 2, 3, 4, 5] }, p2: { hand: [1, 2] }, p3: { handCount: 3 } },
    };
    expect(calculateChosenPlayerHandPT(card, state)).toEqual({ power: 3, toughness: 3 });
    expect(calculateChosenPlayerHandPT({ ...card, chosenPlayer: 'p2' }, state)).toEqual({ power: 2, toughness: 2 });
  });
  it('does not treat a graveyard card target as a battlefield permanent target', () => {
    const review = reviewActivatedAbilityTargets({ battlefield: [] } as any, 'p1' as any, '{3}: Return target creature card from a graveyard to the battlefield under your control.', []);
    expect(review.requiresTarget).toBe(false);
  });
});
