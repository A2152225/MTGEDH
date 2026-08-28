import { describe, expect, it } from 'vitest';
import {
  DelayedTriggerTiming,
  createDelayedTrigger,
  createDelayedTriggerRegistry,
  registerDelayedTrigger,
} from '../../rules-engine/src/delayedTriggeredAbilities.js';
import { getDeathTriggers } from '../src/state/modules/triggered-abilities.js';

function makeCtx(state: any) {
  return { state, gameId: 't_reckless_blaze', bumpSeq: () => {}, isReplaying: false } as any;
}

describe('delayed dealt-damage-this-way dies watchers (server)', () => {
  it('queues Reckless Blaze add {R} when a watched creature you control dies', () => {
    let registry = createDelayedTriggerRegistry();
    registry = registerDelayedTrigger(
      registry,
      createDelayedTrigger(
        'reckless_blaze_1',
        'Reckless Blaze',
        'p1',
        DelayedTriggerTiming.WHEN_DIES,
        'add {R}',
        1,
        {
          watchingPermanentId: 'judith_1',
          targets: ['judith_1'],
          effectData: { expireAtEndOfTurn: true },
        },
      ),
    );

    const dying = {
      id: 'judith_1',
      controller: 'p1',
      card: {
        name: 'Judith, Carnage Connoisseur',
        type_line: 'Legendary Creature — Human Shaman',
        oracle_text: 'Whenever you cast an instant or sorcery spell, choose one —',
      },
    };
    const state = {
      battlefield: [],
      stack: [],
      players: [{ id: 'p1' }, { id: 'p2' }],
      delayedTriggerRegistry: registry,
      seq: 1,
    };
    const ctx = makeCtx(state);
    const triggers = getDeathTriggers(ctx, dying, 'p1');

    expect(triggers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: expect.objectContaining({
          cardName: 'Reckless Blaze',
          controllerId: 'p1',
        }),
        effect: expect.stringMatching(/add \{r\}/i),
      }),
    ]));
    expect(state.delayedTriggerRegistry.firedTriggerIds.length).toBeGreaterThan(0);
  });

  it('does not fire the watcher for a different dying creature', () => {
    let registry = createDelayedTriggerRegistry();
    registry = registerDelayedTrigger(
      registry,
      createDelayedTrigger(
        'reckless_blaze_1',
        'Reckless Blaze',
        'p1',
        DelayedTriggerTiming.WHEN_DIES,
        'add {R}',
        1,
        { watchingPermanentId: 'judith_1', targets: ['judith_1'] },
      ),
    );

    const dying = {
      id: 'token_other',
      controller: 'p2',
      isToken: true,
      card: { name: 'Goblin', type_line: 'Creature — Goblin' },
    };
    const ctx = makeCtx({
      battlefield: [],
      stack: [],
      players: [{ id: 'p1' }, { id: 'p2' }],
      delayedTriggerRegistry: registry,
    });
    const triggers = getDeathTriggers(ctx, dying, 'p2');
    expect(triggers.some((trigger) => /add \{r\}/i.test(String(trigger.effect || '')))).toBe(false);
  });
});
