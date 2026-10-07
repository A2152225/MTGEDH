import { describe, expect, it } from 'vitest';

import { parseImpendingCost, parseImpendingInfo } from '../src/state/modules/alternate-costs.js';
import {
  applyImpendingOnPermanentEntry,
  processImpendingEndStepCounterRemoval,
  spellWasCastWithImpendingPaid,
} from '../src/state/modules/impendingEffects.js';

const OVERLORD_ORACLE =
  'Impending 4—{2}{W}{W} (If you cast this spell for its impending cost, it enters with four time counters and is not a creature until the last is removed. At the beginning of your end step, remove a time counter from it.)\n' +
  'Whenever this permanent enters or attacks, create two 2/1 white Insect creature tokens with flying.';

describe('impending alternate cost helpers', () => {
  it('parses Overlord of the Mistmoors impending N and cost (em dash)', () => {
    expect(parseImpendingInfo(OVERLORD_ORACLE)).toEqual({ timeCounters: 4, cost: '{2}{W}{W}' });
    expect(parseImpendingCost(OVERLORD_ORACLE)).toBe('{2}{W}{W}');
  });

  it('parses hyphen and en-dash impending separators', () => {
    expect(parseImpendingInfo('Impending 3-{1}{B}{B}')).toEqual({ timeCounters: 3, cost: '{1}{B}{B}' });
    expect(parseImpendingInfo('Impending 2–{U}{U}')).toEqual({ timeCounters: 2, cost: '{U}{U}' });
  });

  it('detects impending paid via alternateCostId or stamp', () => {
    expect(spellWasCastWithImpendingPaid({ alternateCostId: 'impending' })).toBe(true);
    expect(spellWasCastWithImpendingPaid({ impendingCostWasPaid: true })).toBe(true);
    expect(spellWasCastWithImpendingPaid({ alternateCostId: 'warp' })).toBe(false);
  });

  it('applies time counters and notCreature on entry when impending was paid', () => {
    const permanent: any = {
      id: 'overlord_1',
      controller: 'p1',
      counters: {},
      card: { name: 'Overlord of the Mistmoors', oracle_text: OVERLORD_ORACLE },
    };
    const bumps: number[] = [];
    const ctx: any = { bumpSeq: () => bumps.push(1), state: { battlefield: [permanent] } };
    applyImpendingOnPermanentEntry(ctx, permanent, 'p1', 'Overlord of the Mistmoors', {
      alternateCostId: 'impending',
      impendingTimeCounters: 4,
    });
    expect(permanent.counters.time).toBe(4);
    expect(permanent.notCreature).toBe(true);
    expect(permanent.wasImpendingCast).toBe(true);
  });

  it('does not apply impending stamps when cast for mana cost', () => {
    const permanent: any = {
      id: 'overlord_2',
      controller: 'p1',
      counters: {},
      card: { name: 'Overlord of the Mistmoors', oracle_text: OVERLORD_ORACLE },
    };
    const ctx: any = { bumpSeq: () => {}, state: { battlefield: [permanent] } };
    applyImpendingOnPermanentEntry(ctx, permanent, 'p1', 'Overlord', { alternateCostId: undefined });
    expect(permanent.counters.time || 0).toBe(0);
    expect(permanent.notCreature).toBeFalsy();
  });

  it('removes one time counter at end step and clears notCreature when none remain', () => {
    const permanent: any = {
      id: 'overlord_3',
      controller: 'p1',
      wasImpendingCast: true,
      impendingCostWasPaid: true,
      notCreature: true,
      counters: { time: 1 },
      card: { name: 'Overlord of the Mistmoors', oracle_text: OVERLORD_ORACLE },
    };
    const bumps: number[] = [];
    const ctx: any = {
      bumpSeq: () => bumps.push(1),
      state: { turnPlayer: 'p1', battlefield: [permanent] },
    };
    processImpendingEndStepCounterRemoval(ctx);
    expect(permanent.counters.time).toBe(0);
    expect(permanent.notCreature).toBe(false);
    expect(bumps.length).toBe(1);
  });
});

