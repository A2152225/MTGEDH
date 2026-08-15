import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser.js';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor.js';
import {
  DelayedTriggerTiming,
  checkDelayedTriggers,
  createDelayedTriggerRegistry,
} from '../src/delayedTriggeredAbilities.js';
import type { GameState } from '../src/types.js';

const ARCBOND_ORACLE =
  'Choose target creature. Whenever that creature is dealt damage this turn, it deals that much damage to each other creature and each player.';

describe('Arcbond-style delayed dealt-damage watchers', () => {
  it('parses the delayed dealt-damage clause as schedule_delayed_trigger', () => {
    const ir = parseOracleTextToIR(ARCBOND_ORACLE, 'Arcbond');
    const steps = ir.abilities.flatMap((a) => a.steps || []);
    expect(steps.some((s) => s.kind === 'choose_target_creature')).toBe(true);
    const delayed = steps.find((s) => s.kind === 'schedule_delayed_trigger') as any;
    expect(delayed).toBeTruthy();
    expect(delayed.timing).toBe('when_dealt_damage');
    expect(String(delayed.effect || '').toLowerCase()).toContain('each other creature and each player');
    expect(steps.some((s) => s.kind === 'deal_damage')).toBe(false);
  });

  it('schedules a repeating WHEN_DEALT_DAMAGE watcher on the chosen creature', () => {
    const ir = parseOracleTextToIR(ARCBOND_ORACLE, 'Arcbond');
    const steps = ir.abilities.flatMap((a) => a.steps || []);
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: 'p1' }, { id: 'p2' }],
        battlefield: [
          { id: 'c1', controller: 'p1', type_line: 'Creature — Beast', power: 2, toughness: 2 },
          { id: 'c2', controller: 'p2', type_line: 'Creature — Goblin', power: 1, toughness: 1 },
        ],
        delayedTriggerRegistry: createDelayedTriggerRegistry(),
        turnNumber: 1,
      } as GameState,
      steps,
      {
        controllerId: 'p1',
        sourceId: 'arcbond-spell',
        sourceName: 'Arcbond',
        targetCreatureId: 'c1',
        targetPermanentId: 'c1',
        selectorContext: { chosenObjectIds: ['c1'] },
      },
    );

    const registry = (result.state as any)?.delayedTriggerRegistry;
    const watchers = (registry?.triggers || []).filter(
      (t: any) => t.timing === DelayedTriggerTiming.WHEN_DEALT_DAMAGE,
    );
    expect(watchers).toHaveLength(1);
    expect(watchers[0].watchingPermanentId).toBe('c1');
    expect(watchers[0].oneShot).toBe(false);
    expect(watchers[0].effectData?.expireAtEndOfTurn).toBe(true);
  });

  it('fires on each dealt_damage event and expires at cleanup', () => {
    const registry = createDelayedTriggerRegistry();
    const withWatcher = {
      ...registry,
      triggers: [
        {
          id: 'd1',
          sourceId: 'spell',
          sourceName: 'Arcbond',
          controllerId: 'p1',
          timing: DelayedTriggerTiming.WHEN_DEALT_DAMAGE,
          watchingPermanentId: 'c1',
          effect: 'it deals that much damage to each other creature and each player',
          createdOnTurn: 1,
          fired: false,
          oneShot: false,
          timestamp: 1,
          effectData: { expireAtEndOfTurn: true },
        },
      ],
    };

    const first = checkDelayedTriggers(withWatcher as any, { type: 'dealt_damage', permanentId: 'c1' });
    expect(first.triggersToFire).toHaveLength(1);
    expect(first.remainingTriggers).toHaveLength(1);

    const second = checkDelayedTriggers(
      { ...withWatcher, triggers: first.remainingTriggers } as any,
      { type: 'dealt_damage', permanentId: 'c1' },
    );
    expect(second.triggersToFire).toHaveLength(1);

    const cleanup = checkDelayedTriggers(
      { ...withWatcher, triggers: second.remainingTriggers } as any,
      { type: 'cleanup' },
    );
    expect(cleanup.triggersToFire).toHaveLength(0);
    expect(cleanup.remainingTriggers).toHaveLength(0);
  });
});
