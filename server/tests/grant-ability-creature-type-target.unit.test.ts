import { describe, expect, it } from 'vitest';

import { parseGrantAbilityCreatureTarget } from '../src/socket/interaction-handlers/interactionActivateGrantAbilityTargetParse.js';
import { parseAbilityTargeting, parseTargetRequirements } from '../src/rules-engine/targeting.js';

describe('parseGrantAbilityCreatureTarget', () => {
  it('parses Target Dinosaur gains haste until end of turn (Otepec Huntmaster)', () => {
    expect(parseGrantAbilityCreatureTarget('Target Dinosaur gains haste until end of turn.')).toEqual({
      creatureType: 'dinosaur',
      controllerRestriction: 'any',
      abilityGranted: 'haste',
    });
  });

  it('parses target creature you control with a power filter (Herd Heirloom)', () => {
    expect(parseGrantAbilityCreatureTarget(
      'Until end of turn, target creature you control with power 4 or greater gains trample and "Whenever this creature deals combat damage to a player, draw a card."',
    )).toEqual({
      controllerRestriction: 'you',
      abilityGranted: 'trample and "Whenever this creature deals combat damage to a player, draw a card."',
    });
  });

  it('does not steal player or opponent gain-control clauses', () => {
    expect(parseGrantAbilityCreatureTarget('Target player gains 2 life.')).toBeNull();
    expect(parseGrantAbilityCreatureTarget('Target opponent gains control of Humble Defector.')).toBeNull();
  });

  it('treats Humble Defector as an opponent-player target, not a creature target', () => {
    const oracle =
      '{T}: Draw two cards. Target opponent gains control of Humble Defector. Activate only during your turn.';
    const reqs = parseTargetRequirements(oracle);
    expect(reqs.needsTargets).toBe(true);
    expect(reqs.targetTypes).toEqual(['opponent']);
    expect(reqs.minTargets).toBe(1);
    expect(reqs.maxTargets).toBe(1);
    expect(parseAbilityTargeting(oracle)).toBeNull();
  });
});
