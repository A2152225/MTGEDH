import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser.js';
import { collectSpellResolutionEffectStepsWithOverlay } from '../src/oracleIRCompilerEnvelope.js';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor.js';
import { DelayedTriggerTiming } from '../src/delayedTriggeredAbilities.js';
import type { GameState, PlayerID } from '../../shared/src/index.js';

const RECKLESS_BLAZE =
  'Reckless Blaze deals 5 damage to each creature. Whenever a creature you control dealt damage this way dies this turn, add {R}.';

const SKELETONIZE =
  'Skeletonize deals 3 damage to target creature. When a creature dealt damage this way dies this turn, create a 1/1 black Skeleton creature token.';

function collectSpellSteps(text: string, name: string) {
  return collectSpellResolutionEffectStepsWithOverlay(text, name, null);
}

describe('dealt-damage-this-way dies this turn (Reckless Blaze family)', () => {
  it('keeps the delayed dies clause as a spell-resolution grant_temporary_dies_trigger', () => {
    const ir = parseOracleTextToIR(RECKLESS_BLAZE, 'Reckless Blaze');
    const spellAbilities = (ir.abilities || []).filter((ability) => String(ability.type) === 'spell');
    const kinds = spellAbilities.flatMap((ability) => (ability.steps || []).map((step) => step.kind));
    expect(kinds).toEqual(expect.arrayContaining(['deal_damage', 'grant_temporary_dies_trigger']));
    expect((ir.abilities || []).some((ability) => String(ability.type) === 'triggered')).toBe(false);

    const delayed = spellAbilities
      .flatMap((ability) => ability.steps || [])
      .find((step) => step.kind === 'grant_temporary_dies_trigger') as any;
    expect(String(delayed?.target?.text || '')).toMatch(/creatures you control dealt damage this way/i);
    expect(String(delayed?.effect || '')).toMatch(/add \{r\}/i);
    expect(delayed?.duration).toBe('until_end_of_turn');
  });

  it('collects Reckless Blaze damage plus the delayed dies watcher as spell steps', () => {
    const steps = collectSpellSteps(RECKLESS_BLAZE, 'Reckless Blaze');
    expect(steps.map((step) => step.kind)).toEqual(
      expect.arrayContaining(['deal_damage', 'grant_temporary_dies_trigger']),
    );
    expect(steps.some((step) => step.kind === 'add_mana')).toBe(false);
  });

  it('schedules WHEN_DIES watchers only on creatures you control that were damaged this way', () => {
    const p1 = 'p1' as PlayerID;
    const steps = collectSpellSteps(RECKLESS_BLAZE, 'Reckless Blaze');
    const state = {
      startingLife: 40,
      life: { p1: 40, p2: 40 },
      players: [{ id: p1 }, { id: 'p2' }],
      turnNumber: 1,
      battlefield: [
        {
          id: 'judith_1',
          controller: p1,
          card: { name: 'Judith, Carnage Connoisseur', type_line: 'Legendary Creature — Human Shaman' },
        },
        {
          id: 'token_1',
          controller: p1,
          isToken: true,
          card: { name: 'Goblin', type_line: 'Creature — Goblin' },
        },
        {
          id: 'opp_1',
          controller: 'p2',
          card: { name: 'Wall', type_line: 'Creature — Wall' },
        },
      ],
    } as GameState;

    const result = applyOracleIRStepsToGameState(
      state,
      steps,
      buildOracleIRExecutionContext({
        controllerId: p1,
        sourceId: 'reckless_blaze_1',
        sourceName: 'Reckless Blaze',
        sourceObjectType: 'spell',
      }),
    );

    const watchers = (((result.state as any).delayedTriggerRegistry?.triggers || []) as any[]).filter(
      (trigger) => trigger.timing === DelayedTriggerTiming.WHEN_DIES,
    );
    const watchedIds = watchers.map((trigger) => String(trigger.watchingPermanentId || ''));
    expect(watchedIds.sort()).toEqual(['judith_1', 'token_1']);
    expect(watchers.every((trigger) => String(trigger.effect || '').toLowerCase().includes('add {r}'))).toBe(true);
    expect(watchers.every((trigger) => trigger.effectData?.expireAtEndOfTurn)).toBe(true);
  });

  it('parses Skeletonize as a this-way dies watcher without a you-control filter', () => {
    const steps = collectSpellSteps(SKELETONIZE, 'Skeletonize');
    const delayed = steps.find((step) => step.kind === 'grant_temporary_dies_trigger') as any;
    expect(delayed).toBeTruthy();
    expect(String(delayed?.target?.text || '')).toMatch(/^creatures dealt damage this way$/i);
    expect(String(delayed?.effect || '')).toMatch(/skeleton/i);
  });
});
