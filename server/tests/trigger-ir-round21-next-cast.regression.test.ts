import { describe, expect, it } from 'vitest';

import { applyInstantSorceryCopyStackSpellRiders } from '../src/state/modules/stackResolveSpellPostCategorizeRidersUtils.js';

function run(name: string, oracle: string) {
  const ctx: any = { state: { stack: [], battlefield: [] } };
  applyInstantSorceryCopyStackSpellRiders(ctx, {
    oracleText: oracle,
    oracleTextLower: oracle.toLowerCase(),
    controller: 'p1',
    effectiveCard: { name, oracle_text: oracle },
    item: { id: 'it1', controller: 'p1', card: { name, oracle_text: oracle } },
    targets: [],
  } as any);
  return ctx.state.delayedSpellCopiesThisTurn || [];
}

describe('when you next cast an instant or sorcery spell this turn: delayed copy rider', () => {
  it('Galvanic Iteration keeps one retargetable copy', () => {
    const e = run('Galvanic Iteration', 'When you next cast an instant or sorcery spell this turn, copy that spell. You may choose new targets for the copy.');
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ controllerId: 'p1', spellType: 'instant_or_sorcery', allowRetargeting: true });
  });

  it('Complete the Circuit copies twice', () => {
    const e = run('Complete the Circuit', 'Convoke\nYou may cast spells this turn as though they had flash. When you next cast an instant or sorcery spell this turn, copy that spell twice. You may choose new targets for the copies.');
    expect(e).toHaveLength(2);
    expect(e.every((x: any) => x.allowRetargeting === true)).toBe(true);
  });

  it('copy it (no retarget sentence) queues one non-retargeting copy', () => {
    const e = run('Probe Spell', 'Draw a card. When you next cast an instant or sorcery spell this turn, copy it.');
    expect(e).toHaveLength(1);
    expect(e[0].allowRetargeting).toBe(false);
  });

  it('does not queue for unrelated text', () => {
    expect(run('Shock', 'Shock deals 2 damage to any target.')).toHaveLength(0);
  });
});
