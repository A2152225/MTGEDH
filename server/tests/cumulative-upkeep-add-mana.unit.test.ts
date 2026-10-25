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
  addAgeCounter: () => 3,
  sacrificePermanent: (_c: any, id: string) => { sacrificed.push(id); },
}));

import {
  chooseAICumulativeUpkeepPayment,
  maybeQueueCumulativeUpkeepTriggeredAbility,
  parseCumulativeUpkeepCost,
  replayCumulativeUpkeepChoice,
} from '../src/state/modules/cumulativeUpkeepPayment.js';

const emptyPool = () => ({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });

describe('cumulative upkeep "Add <mana>" (Braid of Fire)', () => {
  beforeEach(() => { queued.length = 0; affordable.clear(); paid.length = 0; sacrificed.length = 0; });

  it('parses Add costs generically', () => {
    expect(parseCumulativeUpkeepCost('Add {R}')).toEqual({ kind: 'addMana', unit: '{R}' });
    expect(parseCumulativeUpkeepCost('\u2014Add {G}{C}.')).toEqual({ kind: 'addMana', unit: '{G}{C}' });
  });

  it('offers Add {R}{R}{R} or Sacrifice it; paying adds mana to the pool', async () => {
    const c: any = { gameId: 'g1', state: { battlefield: [{ id: 'braid', controller: 'A' }], manaPool: { A: emptyPool() } } };
    expect(maybeQueueCumulativeUpkeepTriggeredAbility(c, { source: 'braid' }, 'A' as any, 'Braid of Fire', 'braid', 'Add {R} for each age counter (will be 3)')).toBe(true);
    expect(queued).toHaveLength(1);
    expect(queued[0].payLabel).toBe('Add {R}{R}{R}');
    expect(queued[0].declineLabel).toBe('Sacrifice it');
    expect(queued[0].validationKind).toBe('none');
    expect(chooseAICumulativeUpkeepPayment({ state: c.state }, 'A', queued[0].stepData)).toBe('pay');
    await queued[0].onPay();
    expect(c.state.manaPool.A.red).toBe(3);
    expect(paid).toEqual([]);
    expect(sacrificed).toEqual([]);
  });

  it('declining sacrifices it', async () => {
    const c: any = { gameId: 'g1', state: { battlefield: [{ id: 'braid', controller: 'A' }] } };
    maybeQueueCumulativeUpkeepTriggeredAbility(c, { source: 'braid' }, 'A' as any, 'Braid of Fire', 'braid', 'Add {R} for each age counter');
    await queued[0].onDecline();
    expect(sacrificed).toEqual(['braid']);
  });

  it('replay of a paid choice re-adds the mana', () => {
    const c: any = { state: { manaPool: {} } };
    replayCumulativeUpkeepChoice(c, { playerId: 'A', sourceId: 'braid', cumulativeUpkeepAddMana: '{R}{R}' }, true);
    expect(c.state.manaPool.A.red).toBe(2);
  });
});
