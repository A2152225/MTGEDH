import { describe, expect, it } from 'vitest';
import {
  buildNextCastEffectStackItem,
  buildNextCastEntries,
  delayedNextCastEntryMatches,
  registerNextCastEntries,
} from '../src/state/modules/nextCastDelayedRiders.js';
import { applyInstantSorceryCopyStackSpellRiders } from '../src/state/modules/stackResolveSpellPostCategorizeRidersUtils.js';
import { registerAbilityNextCastRiders } from '../src/state/modules/stackResolveTopOfStackDispatchUtils.js';

const HOWL = 'When you next cast an instant or sorcery spell this turn, copy that spell. You may choose new targets for the copy.\nRaid \u2014 If you attacked this turn, when you next cast an instant or sorcery spell this turn, copy that spell an additional time. You may choose new targets for the copy.';
const base = { controllerId: 'p1', sourceName: 'Src' };

function runSpell(state: any, name: string, oracle: string, x?: number) {
  const ctx: any = { state };
  applyInstantSorceryCopyStackSpellRiders(ctx, {
    controller: 'p1', card: { name, oracle_text: oracle }, effectiveCard: { name, oracle_text: oracle },
    item: { id: 'stk_' + name, xValue: x }, oracleText: oracle, oracleTextLower: oracle.toLowerCase(),
    targets: [], spellXValue: x, uncategorizedSpellFallbackApplied: 0,
  } as any);
  return state.delayedSpellCopiesThisTurn || [];
}

describe('round 22 next-cast riders', () => {
  it('Storm King\'s Thunder copies X times', () => {
    const list = runSpell({ stack: [], battlefield: [] }, "Storm King's Thunder", 'When you next cast an instant or sorcery spell this turn, copy that spell X times. You may choose new targets for the copies.', 3);
    expect(list).toHaveLength(3);
    expect(list.every((e: any) => e.allowRetargeting)).toBe(true);
  });

  it('Howl of the Horde raid adds one copy only if you attacked', () => {
    expect(runSpell({ stack: [], battlefield: [] }, 'Howl of the Horde', HOWL)).toHaveLength(1);
    expect(runSpell({ stack: [], battlefield: [], creaturesAttackedThisTurn: { p1: 2 } }, 'Howl of the Horde', HOWL)).toHaveLength(2);
  });

  it('does not register twice for the same resolution', () => {
    const state: any = { stack: [], battlefield: [] };
    runSpell(state, 'Dual Strike', 'When you next cast an instant or sorcery spell with mana value 4 or less this turn, copy that spell.');
    runSpell(state, 'Dual Strike', 'When you next cast an instant or sorcery spell with mana value 4 or less this turn, copy that spell.');
    expect(state.delayedSpellCopiesThisTurn).toHaveLength(1);
  });

  it('mana value caps (Dual Strike, Loki power)', () => {
    const [dual] = buildNextCastEntries('When you next cast an instant or sorcery spell with mana value 4 or less this turn, copy that spell.', base);
    expect(dual.maxManaValue).toBe(4);
    expect(delayedNextCastEntryMatches(dual, { type_line: 'Instant', cmc: 4 }, 'p1')).toBe(true);
    expect(delayedNextCastEntryMatches(dual, { type_line: 'Sorcery', cmc: 5 }, 'p1')).toBe(false);
    expect(delayedNextCastEntryMatches(dual, { type_line: 'Creature', cmc: 1 }, 'p1')).toBe(false);
    const [loki] = buildNextCastEntries("{1}, {T}: When you next cast an instant or sorcery spell with mana value less than or equal to Loki's power this turn, copy that spell. You may choose new targets for the copy.", { ...base, sourcePower: 2 });
    expect(loki.maxManaValue).toBe(2);
    expect(loki.allowRetargeting).toBe(true);
  });

  it('loyalty and activated abilities register riders on resolution', () => {
    const ctx: any = { state: { stack: [], battlefield: [{ id: 'loki', card: { name: 'Loki' }, power: 3 }] } };
    registerAbilityNextCastRiders(ctx, { id: 'ab1', type: 'ability', sourceName: 'Chandra, the Firebrand', description: '\u22122: When you next cast an instant or sorcery spell this turn, copy that spell. You may choose new targets for the copy.' }, 'p1', undefined);
    registerAbilityNextCastRiders(ctx, { id: 'ab1', type: 'ability', description: 'When you next cast an instant or sorcery spell this turn, copy that spell.' }, 'p1', undefined);
    registerAbilityNextCastRiders(ctx, { id: 'ab2', type: 'ability', source: 'loki', description: "When you next cast an instant or sorcery spell with mana value less than or equal to Loki's power this turn, copy that spell." }, 'p1', undefined);
    const list = ctx.state.delayedSpellCopiesThisTurn;
    expect(list).toHaveLength(2);
    expect(list[0].sourceName).toBe('Chandra, the Firebrand');
    expect(list[1].maxManaValue).toBe(3);
  });

  it('copy twice, if-you-do skipped, and "a spell" effect entries', () => {
    expect(buildNextCastEntries('When you next cast an instant or sorcery spell this turn, copy that spell twice.', base)).toHaveLength(2);
    expect(buildNextCastEntries('You may pay {1}. If you do, when you next cast an instant or sorcery spell this turn, copy that spell.', base)).toHaveLength(0);
    const entries = buildNextCastEntries('The next spell you cast this turn can be cast as though it had flash. When you next cast a spell this turn, put X +1/+1 counters on up to one target creature, where X is the mana value of that spell.', base);
    expect(entries).toHaveLength(1);
    expect(entries[0].spellType).toBe('any');
    expect(delayedNextCastEntryMatches(entries[0], { type_line: 'Creature', cmc: 5 }, 'p1')).toBe(true);
    const item = buildNextCastEffectStackItem(entries[0], { cmc: 5 }, 'p1', 'stk', 'trig1');
    expect(item.type).toBe('triggered_ability');
    expect(item.description).toBe('put 5 +1/+1 counters on up to one target creature');
    expect(registerNextCastEntries({}, [])).toBe(0);
  });
});
