import { describe, it, expect, vi, beforeEach } from 'vitest';

const queued: any[] = [];
const affordable = new Set<string>();
const paid: string[] = [];
const sacrificed: string[] = [];

vi.mock('../src/socket/util.js', () => ({
  broadcastGame: vi.fn(),
  canPayManaCostStringWithAvailableSources: (_s: any, _p: string, cost: string) => affordable.has(cost),
  payManaCostWithAvailableSources: (_s: any, _p: string, cost: string) => { paid.push(cost); },
}));
vi.mock('../src/socket/optional-payment-prompts.js', () => ({
  queueOptionalPaymentStep: (_g: string, opts: any) => { queued.push(opts); },
}));
vi.mock('../src/state/modules/upkeep-triggers.js', () => ({
  addAgeCounter: () => 2,
  sacrificePermanent: (_c: any, id: string) => { sacrificed.push(id); },
}));

import {
  affordableCumulativeManaCosts,
  maybeQueueCumulativeUpkeepTriggeredAbility,
} from '../src/state/modules/cumulativeUpkeepPayment.js';

function ctx() {
  return { gameId: 'g1', state: { battlefield: [{ id: 'p1', controller: 'A' }] } } as any;
}
const desc = 'Pay {G} or {W} for each age counter on it.';

describe('cumulative upkeep "{A} or {B}" choice', () => {
  beforeEach(() => { queued.length = 0; affordable.clear(); paid.length = 0; sacrificed.length = 0; });

  it('lists only affordable scaled options', () => {
    affordable.add('{W}{W}');
    expect(affordableCumulativeManaCosts({}, 'A', ['{G}', '{W}'], 2)).toEqual(['{W}{W}']);
  });

  it('offers a choice between both options when both are affordable, then pay-or-sacrifice', async () => {
    affordable.add('{G}{G}'); affordable.add('{W}{W}');
    expect(maybeQueueCumulativeUpkeepTriggeredAbility(ctx(), { source: 'p1' }, 'A' as any, 'Thing', 'p1', desc)).toBe(true);
    expect(queued).toHaveLength(1);
    expect(queued[0].payLabel).toBe('Pay {G}{G}');
    expect(queued[0].declineLabel).toBe('Pay {W}{W} instead');
    expect(queued[0].stepData.cumulativeUpkeepChoice).toBeUndefined();
    await queued[0].onDecline();
    expect(sacrificed).toEqual([]);
    expect(queued).toHaveLength(2);
    expect(queued[1].payLabel).toBe('Pay {W}{W}');
    expect(queued[1].declineLabel).toBe('Sacrifice it');
    expect(queued[1].stepData.cumulativeUpkeepChoice).toBe(true);
    await queued[1].onPay();
    expect(paid).toEqual(['{W}{W}']);
  });

  it('paying the first option settles it without a second prompt', async () => {
    affordable.add('{G}{G}'); affordable.add('{W}{W}');
    maybeQueueCumulativeUpkeepTriggeredAbility(ctx(), { source: 'p1' }, 'A' as any, 'Thing', 'p1', desc);
    await queued[0].onPay();
    expect(paid).toEqual(['{G}{G}']);
    expect(queued).toHaveLength(1);
  });

  it('single affordable option keeps the plain pay-or-sacrifice prompt', () => {
    affordable.add('{W}{W}');
    maybeQueueCumulativeUpkeepTriggeredAbility(ctx(), { source: 'p1' }, 'A' as any, 'Thing', 'p1', desc);
    expect(queued).toHaveLength(1);
    expect(queued[0].payLabel).toBe('Pay {W}{W}');
    expect(queued[0].declineLabel).toBe('Sacrifice it');
  });
});
