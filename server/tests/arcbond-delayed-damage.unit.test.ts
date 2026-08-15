import { describe, expect, it } from 'vitest';
import {
  createDelayedTriggerRegistry,
  createWhenDealtDamageThisTurnTrigger,
  registerDelayedTrigger,
} from '../../rules-engine/src/delayedTriggeredAbilities.js';
import {
  expireDelayedDealtDamageWatchers,
  processDelayedDealtDamageWatchers,
} from '../src/state/modules/triggers/dealt-damage-watchers.js';

function makeCtx(state: any) {
  return { state, gameId: 't_arcbond', bumpSeq: () => {} } as any;
}

describe('delayed dealt-damage watchers (server)', () => {
  it('queues the delayed effect when the watched permanent is damaged', () => {
    let registry = createDelayedTriggerRegistry();
    registry = registerDelayedTrigger(
      registry,
      createWhenDealtDamageThisTurnTrigger(
        'spell',
        'Arcbond',
        'p1',
        'c1',
        'it deals that much damage to each other creature and each player',
        1,
      ),
    );

    const state = {
      battlefield: [
        { id: 'c1', controller: 'p1', card: { name: 'Bear', type_line: 'Creature — Bear' } },
      ],
      stack: [],
      players: [{ id: 'p1' }, { id: 'p2' }],
      delayedTriggerRegistry: registry,
      seq: 1,
    };
    const ctx = makeCtx(state);
    const queued = processDelayedDealtDamageWatchers(ctx, state.battlefield[0], 3);
    expect(queued.length).toBe(1);
    expect(queued[0].damageAmount).toBe(3);
    expect(queued[0].referenceAmount).toBe(3);
    expect(String(queued[0].effect || '').toLowerCase()).toContain('each other creature');
    expect(state.stack.length).toBe(1);
    expect(
      (state.delayedTriggerRegistry.triggers || []).some(
        (t: any) => t.watchingPermanentId === 'c1',
      ),
    ).toBe(true);
  });

  it('expires this-turn watchers during cleanup', () => {
    let registry = createDelayedTriggerRegistry();
    registry = registerDelayedTrigger(
      registry,
      createWhenDealtDamageThisTurnTrigger(
        'spell',
        'Arcbond',
        'p1',
        'c1',
        'it deals that much damage to each other creature and each player',
        1,
      ),
    );
    const state = { delayedTriggerRegistry: registry };
    expect(expireDelayedDealtDamageWatchers(state)).toBe(1);
    expect(state.delayedTriggerRegistry.triggers).toHaveLength(0);
  });
});
