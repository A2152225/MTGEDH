import { describe, expect, it } from 'vitest';

import { matchesGraveyardCardTargetType, parseTargetRequirements } from '../src/rules-engine/targeting.js';

describe('matchesGraveyardCardTargetType: non-<subtype> exclusion', () => {
  const dragonCreature = { id: 'a', name: 'Bogardan Hellkite', type_line: 'Creature \u2014 Dragon' };
  const humanKnight = { id: 'b', name: 'Grizzled Knight', type_line: 'Creature \u2014 Human Knight' };
  const dragonAvatar = { id: 'c', name: 'Karrthus, Tyrant of Jund', type_line: 'Legendary Creature \u2014 Dragon' };
  const zombieCreature = { id: 'd', name: 'Doomed Zombie', type_line: 'Creature \u2014 Zombie' };
  const humanWizard = { id: 'e', name: 'Sage of Mysteries', type_line: 'Creature \u2014 Human Wizard' };
  const sorceryCard = { id: 'f', name: 'Lightning Bolt Style', type_line: 'Sorcery' };

  it("excludes Dragon creatures when target type is graveyard_non-dragon_creature_card", () => {
    expect(matchesGraveyardCardTargetType(dragonCreature, 'graveyard_non-dragon_creature_card')).toBe(false);
    expect(matchesGraveyardCardTargetType(dragonAvatar, 'graveyard_non-dragon_creature_card')).toBe(false);
    expect(matchesGraveyardCardTargetType(humanKnight, 'graveyard_non-dragon_creature_card')).toBe(true);
    expect(matchesGraveyardCardTargetType(humanWizard, 'graveyard_non-dragon_creature_card')).toBe(true);
    // A non-creature card must still be rejected by the base type requirement.
    expect(matchesGraveyardCardTargetType(sorceryCard, 'graveyard_non-dragon_creature_card')).toBe(false);
  });

  it("excludes Zombie cards when target type is graveyard_non-zombie_card (no base type)", () => {
    expect(matchesGraveyardCardTargetType(zombieCreature, 'graveyard_non-zombie_card')).toBe(false);
    expect(matchesGraveyardCardTargetType(humanKnight, 'graveyard_non-zombie_card')).toBe(true);
    expect(matchesGraveyardCardTargetType(sorceryCard, 'graveyard_non-zombie_card')).toBe(true);
  });

  it("parseTargetRequirements builds graveyard_non-dragon_creature_card from Junji-style oracle text", () => {
    const reqs = parseTargetRequirements(
      'Return target non-Dragon creature card with mana value 4 or less from your graveyard to the battlefield.'
    );
    expect(reqs.targetTypes).toContain('graveyard_non-dragon_creature_card');
    expect(reqs.graveyardScope).toBe('your');
    expect((reqs as any).targetFilterMaxManaValue).toBe(4);
  });
});
