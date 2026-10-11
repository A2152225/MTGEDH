import { describe, expect, it } from 'vitest';
import { queueExpendTriggers } from '../src/state/modules/triggerEmissionFamilyUtils.js';
import { rollPlanarDie } from '../src/state/modules/planarDie.js';
import { applyPermanentKeywordEvents } from '../src/state/modules/apply-event-handlers/applyEventPermanentKeywordEvents.js';

function ctxWith(permanent: any) {
  return {
    state: { battlefield: [permanent], stack: [], turnNumber: 1 },
    bumpSeq() {},
  } as any;
}

describe('expend, chaos, and saddle trigger queues', () => {
  it('queues expend only when the mana total reaches the printed number', () => {
    const ctx = ctxWith({
      id: 'e',
      controller: 'p1',
      card: { name: 'Watcher', type_line: 'Creature', oracle_text: 'Whenever you expend 4, draw a card.' },
    });
    expect(queueExpendTriggers(ctx, 'p1', 2, 3)).toEqual([]);
    expect(queueExpendTriggers(ctx, 'p1', 3, 5).map((item) => item.effect)).toEqual(['draw a card']);
    expect(queueExpendTriggers(ctx, 'p1', 5, 7)).toEqual([]);
  });

  it('queues chaos ensues only when the planar die rolls chaos', () => {
    const ctx = ctxWith({
      id: 'plane',
      controller: 'p1',
      card: { name: 'Watcher', type_line: 'Creature', oracle_text: 'Whenever chaos ensues, draw a card.' },
    });
    expect(rollPlanarDie(ctx, 'p1', 'blank')).toBe('blank');
    expect(ctx.state.stack).toEqual([]);
    expect(rollPlanarDie(ctx, 'p1', 'chaos')).toBe('chaos');
    expect(ctx.state.stack.map((item: any) => item.effect)).toEqual(['draw a card']);
  });

  it('queues when a mount becomes saddled', () => {
    const ctx = ctxWith({
      id: 'mount',
      controller: 'p1',
      card: {
        name: 'Mount',
        type_line: 'Creature — Mount',
        oracle_text: 'Whenever this creature becomes saddled, draw a card.',
      },
    });
    applyPermanentKeywordEvents(ctx, { type: 'saddleMount', playerId: 'p1', vehicleId: 'mount', crewerIds: [] } as any);
    expect(ctx.state.stack.map((item: any) => item.effect)).toEqual(['draw a card']);
    applyPermanentKeywordEvents(ctx, { type: 'saddleMount', playerId: 'p1', vehicleId: 'mount', crewerIds: [] } as any);
    expect(ctx.state.stack).toHaveLength(1);
  });
});
