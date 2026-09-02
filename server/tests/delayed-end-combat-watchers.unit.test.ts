import { describe, expect, it } from 'vitest';
import {
  DelayedTriggerTiming,
  createDelayedTrigger,
  createDelayedTriggerRegistry,
  registerDelayedTrigger,
} from '../../rules-engine/src/delayedTriggeredAbilities.js';
import { getEndOfCombatTriggers } from '../src/state/modules/triggers/end-combat.js';

function makeCtx(state: any) {
  return { state, gameId: 't_delayed_eoc', bumpSeq: () => {}, isReplaying: false } as any;
}

describe('delayed end-of-combat registry watchers (server)', () => {
  it('queues IR-scheduled destroy-that-creature at end of combat', () => {
    let registry = createDelayedTriggerRegistry();
    registry = registerDelayedTrigger(
      registry,
      createDelayedTrigger(
        'corrosive_ooze_1',
        'Corrosive Ooze',
        'p1',
        DelayedTriggerTiming.END_OF_COMBAT,
        'Destroy that creature.',
        1,
        {
          targets: ['equipped_1'],
          effectData: {
            delayedAction: 'destroy',
            lastAntecedentBattlefieldPermanentIds: ['equipped_1'],
          },
          eventDataSnapshot: {
            targetPermanentId: 'equipped_1',
            chosenObjectIds: ['equipped_1'],
          },
        },
      ),
    );

    const state = {
      battlefield: [
        {
          id: 'equipped_1',
          controller: 'p2',
          card: { name: 'Bear', type_line: 'Creature — Bear' },
        },
      ],
      stack: [],
      players: [{ id: 'p1' }, { id: 'p2' }],
      delayedTriggerRegistry: registry,
      turnNumber: 1,
      seq: 1,
    };
    const ctx = makeCtx(state);
    const triggers = getEndOfCombatTriggers(ctx, 'p1');

    expect(triggers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        cardName: 'Corrosive Ooze',
        controllerId: 'p1',
        effect: 'Destroy that creature.',
        stackItem: expect.objectContaining({
          delayedAction: 'destroy',
          delayedPermanentIds: ['equipped_1'],
          lastAntecedentBattlefieldPermanentIds: ['equipped_1'],
        }),
      }),
    ]));
    expect(state.delayedTriggerRegistry.firedTriggerIds.length).toBeGreaterThan(0);
    expect(state.delayedTriggerRegistry.triggers).toHaveLength(0);
  });

  it('does not queue delayed end-step destroy at end of combat', () => {
    let registry = createDelayedTriggerRegistry();
    registry = registerDelayedTrigger(
      registry,
      createDelayedTrigger(
        'spell_1',
        'Some Spell',
        'p1',
        DelayedTriggerTiming.NEXT_END_STEP,
        'Destroy that creature.',
        1,
        { targets: ['c1'] },
      ),
    );
    const state = {
      battlefield: [],
      delayedTriggerRegistry: registry,
      turnNumber: 1,
    };
    const triggers = getEndOfCombatTriggers(makeCtx(state), 'p1');
    expect(triggers).toHaveLength(0);
    expect(state.delayedTriggerRegistry.triggers).toHaveLength(1);
  });
});
