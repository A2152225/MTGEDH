import { describe, expect, it } from 'vitest';

import { suspendTickEmitsExileTimeCounter } from '../scripts/oracle-ir-live-seam-audit.ts';
import { queueExiledTimeCounterRemovedTriggers } from '../src/state/modules/triggers/queueExiledTimeCounterRemoved.ts';
import { runTurnStepUpkeep } from '../src/state/modules/turn-handlers/turnStepUpkeep.ts';

const SPACESHIP_ORACLE =
  "Vigilance, trample\nOther Dinosaurs you control get +1/+1 and have vigilance and trample.\nSuspend 4—{3}{R}{W}\nWhenever a time counter is removed from this card while it's exiled, create a 2/2 red and white Dinosaur creature token with flying and haste.";

function makeSuspendCtx(card: Record<string, unknown>) {
  return {
    gameId: 'unknown',
    isReplaying: false,
    seq: { value: 0 },
    state: {
      battlefield: [],
      stack: [],
      turnNumber: 2,
      zones: {
        p1: {
          exile: [card],
          exileCount: 1,
          hand: [],
          graveyard: [],
        },
      },
    },
  } as any;
}

describe('exile time-counter removed (suspend payoffs)', () => {
  it('queues the exile-source trigger from a suspended card', () => {
    const card = {
      id: 'spaceship_1',
      name: 'Dinosaurs on a Spaceship',
      type_line: 'Creature — Dinosaur',
      oracle_text: SPACESHIP_ORACLE,
      isSuspended: true,
      timeCounters: 3,
      zone: 'exile',
    };
    const ctx = makeSuspendCtx(card);
    const queued = queueExiledTimeCounterRemovedTriggers(ctx, card, 'p1');
    expect(queued).toHaveLength(1);
    expect(queued[0]?.triggerType).toBe('time_counter_removed_from_exiled_self');
    expect(queued[0]?.sourceZone).toBe('exile');
    expect(String(queued[0]?.effect || '')).toMatch(/create a 2\/2/i);
    expect(ctx.state.stack).toHaveLength(1);
  });

  it('does not queue from a card without the exile time-counter clause', () => {
    const card = {
      id: 'bolt_1',
      name: 'Lightning Bolt',
      type_line: 'Instant',
      oracle_text: 'Lightning Bolt deals 3 damage to any target.',
      isSuspended: true,
      timeCounters: 2,
      zone: 'exile',
    };
    const ctx = makeSuspendCtx(card);
    expect(queueExiledTimeCounterRemovedTriggers(ctx, card, 'p1')).toEqual([]);
  });

  it('emits from suspend upkeep before the last-counter cast', () => {
    const card = {
      id: 'spaceship_last',
      name: 'Dinosaurs on a Spaceship',
      type_line: 'Creature — Dinosaur',
      oracle_text: SPACESHIP_ORACLE,
      isSuspended: true,
      timeCounters: 1,
      zone: 'exile',
    };
    const ctx = makeSuspendCtx(card);
    runTurnStepUpkeep(ctx, 'p1', false, () => {});
    const triggers = ctx.state.stack.filter((item: any) => item?.type === 'triggered_ability');
    const spells = ctx.state.stack.filter((item: any) => item?.type === 'spell');
    expect(triggers.some((item: any) => item.triggerType === 'time_counter_removed_from_exiled_self')).toBe(true);
    expect(spells.some((item: any) => item.wasCastFromSuspend === true)).toBe(true);
    expect(ctx.state.zones.p1.exile).toHaveLength(0);
  });

  it('marks suspend upkeep source as emitting the exile time-counter trigger', () => {
    expect(suspendTickEmitsExileTimeCounter()).toBe(true);
  });
});
