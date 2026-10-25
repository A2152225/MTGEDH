import { describe, it, expect } from 'vitest';
import { calculateMaxLandsPerTurn } from '../src/state/modules/game-state-effects-handlers/gameStateEffectsLandPlayDraw.js';
import { isSpellCastingProhibitedByStaticRestriction } from '../src/state/modules/staticCastingRestrictions.js';
import { getOwnerAttackRestrictionReason } from '../src/socket/combat-handlers/combatDeclareAttackersSupport.js';
import { canDamageBePrevented } from '../src/state/modules/game-state-effects-handlers/gameStateEffectsMillDamage.js';

const perm = (id: string, controller: string, name: string, oracle: string, type = 'Enchantment') => ({
  id, controller, owner: controller, card: { id: id + 'c', name, oracle_text: oracle, type_line: type },
});
const players = [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }];

describe('batch 34 player prohibitions', () => {
  it('players can\'t play lands sets land plays to 0 for everyone', () => {
    const state: any = { players, battlefield: [perm('w', 'p1', 'Worms of the Earth', "Players can't play lands.\nLands can't enter the battlefield.")] };
    expect(calculateMaxLandsPerTurn({ state } as any, 'p1')).toBe(0);
    expect(calculateMaxLandsPerTurn({ state } as any, 'p2')).toBe(0);
  });
  it('each player may play an additional land (Ghirapur Orrery) is already counted', () => {
    const state: any = { players, battlefield: [perm('o', 'p1', 'Ghirapur Orrery', 'Each player may play an additional land on each of their turns.', 'Artifact')] };
    expect(calculateMaxLandsPerTurn({ state } as any, 'p2')).toBe(2);
  });
  it('you can\'t cast noncreature spells blocks only the controller and only noncreature spells', () => {
    const state: any = { players, battlefield: [perm('n', 'p1', 'Nullhide Ferox', "Hexproof\nYou can't cast noncreature spells.", 'Creature \u2014 Beast')] };
    const bolt = { name: 'Bolt', type_line: 'Instant' };
    const bear = { name: 'Bear', type_line: 'Creature \u2014 Bear' };
    expect(isSpellCastingProhibitedByStaticRestriction(state, 'p1', bolt).prohibited).toBe(true);
    expect(isSpellCastingProhibitedByStaticRestriction(state, 'p1', bear).prohibited).toBe(false);
    expect(isSpellCastingProhibitedByStaticRestriction(state, 'p2', bolt).prohibited).toBe(false);
  });
  it('can\'t attack unless you\'ve cast a creature spell this turn', () => {
    const cohort = perm('g', 'p1', 'Goblin Cohort', "Goblin Cohort can't attack unless you've cast a creature spell this turn.", 'Creature \u2014 Goblin Warrior');
    const battlefield = [cohort];
    const none: any = { players, battlefield, spellsCastThisTurn: [{ casterId: 'p1', card: { type_line: 'Instant' } }] };
    expect(getOwnerAttackRestrictionReason(cohort, 'p2', { battlefield, gameState: none })).toBeTruthy();
    const cast: any = { players, battlefield, spellsCastThisTurn: [{ casterId: 'p1', card: { type_line: 'Creature \u2014 Elf' } }] };
    expect(getOwnerAttackRestrictionReason(cohort, 'p2', { battlefield, gameState: cast })).toBeFalsy();
  });
  it('damage that would be dealt by ~ can\'t be prevented is already honored', () => {
    const state: any = { players, battlefield: [] };
    const src = { name: 'Excruciator', oracle_text: "Damage that would be dealt by Excruciator can't be prevented." };
    expect(canDamageBePrevented({ state } as any, src, 'p2')).toBe(false);
  });
});
