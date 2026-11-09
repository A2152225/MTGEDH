import { describe, expect, it } from 'vitest';
import { parseTriggerClause, triggerConditionMatches } from '../../rules-engine/src/triggerCondition/index.js';

const cond = (s: string, name?: string) => parseTriggerClause(s, name)?.condition as any;
const src = (extra: Record<string, unknown> = {}) => ({ id: 'w', controllerId: 'p1', ...extra } as any);

describe('round 53 reconsidered delayed / color-OR / exact life', () => {
  it('cast that spell + next cast of that type are delayed next-cast riders', () => {
    const that = cond('When you cast that spell, draw a card.');
    expect(that?.event).toBe('spell_cast');
    expect(that?.thatSpell).toBe(true);
    expect(that?.nextSpellThisTurn).toBe(true);

    const nextType = cond('When you next cast a creature spell of that type this turn, draw a card.');
    expect(nextType?.event).toBe('spell_cast');
    expect(nextType?.nextSpellThisTurn).toBe(true);
    expect(nextType?.ofChosenType).toBe(true);

    const next = cond('When you next cast an instant or sorcery spell this turn, draw a card.');
    expect(next?.event).toBe('spell_cast');
    expect(next?.nextSpellThisTurn).toBe(true);
  });

  it('end step on your next turn / that player next end step', () => {
    const yours = cond('At the beginning of the end step on your next turn, sacrifice that token.');
    expect(yours?.event).toBe('beginning_of_end_step');
    expect(yours?.whoseTurn).toBe('you');
    expect(yours?.delayedNextTurn).toBe(true);

    const theirs = cond("At the beginning of that player's next end step, draw a card.");
    expect(theirs?.event).toBe('beginning_of_end_step');
    expect(theirs?.whoseTurn).toBe('that_player');
    expect(theirs?.delayedNextTurn).toBe(true);
  });

  it('red creature or spell deals damage fires once with color OR spell subject', () => {
    const c = cond('Whenever a red creature or spell deals damage, draw a card.');
    expect(c?.event).toBe('deals_damage');
    expect(c?.orSpellSubject).toBe(true);
    expect(c?.alternatives?.[0]?.subject?.colors).toEqual(['r']);
    const red = { id: 'c1', controllerId: 'p2', typeLine: 'Creature — Dragon', colors: ['r'] } as any;
    const blue = { id: 'c2', controllerId: 'p2', typeLine: 'Creature — Drake', colors: ['u'] } as any;
    expect(triggerConditionMatches(c, red, src())).toBe(true);
    expect(triggerConditionMatches(c, blue, src())).toBe(false);
  });

  it('opponents each lose exactly N + Merry attack + untap during untap', () => {
    const life = cond('Whenever one or more opponents each lose exactly 1 life, draw a card.');
    expect(life?.event).toBe('loses_life');
    expect(life?.lifeAmount).toBe(1);
    expect(life?.exactLife).toBe(true);
    expect(life?.eachOpponent).toBe(true);
    const opp = { id: 'p2', controllerId: 'p2', typeLine: 'Creature' } as any;
    expect(triggerConditionMatches(life, opp, src(), { lifeAmount: 1 } as any)).toBe(true);
    expect(triggerConditionMatches(life, opp, src(), { lifeAmount: 2 } as any)).toBe(false);

    const merry = cond('Whenever you attack with Merry and another legendary creature, draw a card.', 'Merry, Esquire of Rohan');
    expect(merry?.event).toBe('attacks');
    expect(merry?.minOtherAttackers).toBe(1);
    expect(merry?.sourceAmongAttackers).toBe(true);

    const untap = cond('Whenever you untap one or more permanents during your untap step, draw a card.');
    expect(untap?.event).toBe('becomes_untapped');
    expect(untap?.duringUntapStep).toBe(true);
  });
});
