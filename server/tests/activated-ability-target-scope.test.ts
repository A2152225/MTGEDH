import { describe, expect, it } from 'vitest';
import { parseTargetRequirements } from '../src/rules-engine/targeting.js';
import { buildActivatedAbilityValidTargets } from '../src/socket/resolutionActivatedAbilityTargetingUtils.js';

const JACE_MINUS_THREE = 'Exile another target planeswalker or creature you control. Reveal cards from the top of your library until you reveal a creature or planeswalker card.';

function game(): any {
  const perm = (id: string, controller: string, typeLine: string) => ({ id, controller, owner: controller, card: { id, name: id, type_line: typeLine } });
  return {
    state: {
      players: [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }],
      battlefield: [
        perm('jace', 'p1', 'Legendary Planeswalker \u2014 Jace'),
        perm('shark', 'p1', 'Token Creature \u2014 Shark'),
        perm('my_walker', 'p1', 'Legendary Planeswalker \u2014 Ajani'),
        perm('my_artifact', 'p1', 'Artifact'),
        perm('opp_bear', 'p2', 'Creature \u2014 Bear'),
        perm('opp_walker', 'p2', 'Legendary Planeswalker \u2014 Liliana'),
        perm('opp_artifact', 'p2', 'Artifact'),
      ],
      zones: {},
    },
  };
}

describe('activated ability target scope (multi-type lists, "another target")', () => {
  it('keeps "you control" on comma/or type lists', () => {
    const reqs = parseTargetRequirements(JACE_MINUS_THREE);
    expect(reqs.targetTypes).toEqual(['planeswalker', 'creature']);
    expect(reqs.targetControllerConstraint).toBe('you');
    expect(reqs.targetDescription).toBe('target planeswalker or creature you control');
  });

  it('keeps "an opponent controls" / "you don\'t control" on type lists and leaves unscoped lists alone', () => {
    expect(parseTargetRequirements('Destroy target artifact or enchantment an opponent controls.').targetControllerConstraint).toBe('opponent');
    expect(parseTargetRequirements("Exile target artifact or creature you don't control.").targetControllerConstraint).toBe('opponent');
    const unscoped = parseTargetRequirements('Destroy target artifact or enchantment.');
    expect(unscoped.targetTypes).toEqual(['artifact', 'enchantment']);
    expect(unscoped.targetControllerConstraint).toBeUndefined();
  });

  it('builds only other permanents you control for Jace -3', () => {
    const reqs = parseTargetRequirements(JACE_MINUS_THREE);
    const ids = buildActivatedAbilityValidTargets(game(), 'p1', reqs, { sourcePermanentId: 'jace', abilityText: JACE_MINUS_THREE })
      .map((target) => target.id)
      .sort();
    expect(ids).toEqual(['my_walker', 'shark']);
  });

  it('keeps the source when the text does not say "another"', () => {
    const text = 'Exile target planeswalker or creature you control.';
    const ids = buildActivatedAbilityValidTargets(game(), 'p1', parseTargetRequirements(text), { sourcePermanentId: 'jace', abilityText: text })
      .map((target) => target.id)
      .sort();
    expect(ids).toEqual(['jace', 'my_walker', 'shark']);
  });
});