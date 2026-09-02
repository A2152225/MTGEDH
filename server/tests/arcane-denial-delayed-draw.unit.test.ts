import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyOracleIRStepsOnServer } from '../src/state/modules/oracleIrServerZoneSync.js';
import { collectSpellResolutionEffectSteps } from '../src/state/modules/trigger-runtime-wiring.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutorExecutionContext.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

// Quoted from mtg_data.db (is_token = 0), 2026-08-28.
const ARCANE_DENIAL_TEXT =
  "Counter target spell. Its controller may draw up to two cards at the beginning of the next turn's upkeep.\nYou draw a card at the beginning of the next turn's upkeep.";

describe('Arcane Denial delayed upkeep draws target the correct players', () => {
  const gameId = 'test_arcane_denial_delayed_draw';

  afterEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    vi.unstubAllEnvs();
  });

  it('schedules up-to-two for the countered spell controller and one for the Denial caster', () => {
    const casterId = 'p_caster';
    const victimId = 'p_victim';
    const targetStackId = 'stack_cultivate_1';
    const denialStackId = 'stack_arcane_denial_1';

    const state: any = {
      players: [
        { id: casterId, name: 'Caster', hand: [], library: [], graveyard: [], life: 40 },
        { id: victimId, name: 'Victim', hand: [], library: [], graveyard: [], life: 40 },
      ],
      battlefield: [],
      stack: [
        {
          id: targetStackId,
          type: 'spell',
          controller: victimId,
          owner: victimId,
          card: {
            id: 'cultivate_1',
            name: 'Cultivate',
            type_line: 'Sorcery',
            oracle_text: 'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.',
          },
        },
        {
          id: denialStackId,
          type: 'spell',
          controller: casterId,
          owner: casterId,
          card: {
            id: 'arcane_denial_1',
            name: 'Arcane Denial',
            type_line: 'Instant',
            oracle_text: ARCANE_DENIAL_TEXT,
          },
          targets: [targetStackId],
        },
      ],
      zones: {
        [casterId]: { hand: [], library: [], graveyard: [], exile: [] },
        [victimId]: { hand: [], library: [], graveyard: [], exile: [] },
      },
      turnNumber: 1,
      turn: 1,
    };

    const ctx: any = {
      gameId,
      state,
      libraries: new Map([
        [casterId, []],
        [victimId, []],
      ]),
      bumpSeq: vi.fn(),
      io: { to: () => ({ emit: vi.fn() }) },
    };

    const steps = collectSpellResolutionEffectSteps(ARCANE_DENIAL_TEXT, 'Arcane Denial');
    expect(steps.some((step) => step.kind === 'counter_spell')).toBe(true);
    expect(steps.filter((step) => step.kind === 'schedule_delayed_trigger')).toHaveLength(2);

    const irCtx = buildOracleIRExecutionContext({
      controllerId: casterId,
      sourceId: denialStackId,
      sourceName: 'Arcane Denial',
      sourceObjectType: 'spell',
      selectorContext: { targetSpellId: targetStackId, chosenObjectIds: [targetStackId] },
      targetSpellId: targetStackId,
    });

    const result = applyOracleIRStepsOnServer(ctx, state, steps, irCtx, { allowOptional: true }, {
      controller: casterId,
      sourceItem: state.stack.find((item: any) => item.id === denialStackId),
      oracleText: ARCANE_DENIAL_TEXT,
    });

    expect(result.appliedSteps.some((step) => step.kind === 'counter_spell')).toBe(true);
    expect(result.appliedSteps.filter((step) => step.kind === 'schedule_delayed_trigger')).toHaveLength(2);

    const pending = (state.pendingDelayedDrawsAtNextUpkeep || []) as Array<{
      playerId?: string;
      createdBy?: string;
      count?: number;
      upTo?: boolean;
    }>;
    expect(pending).toHaveLength(2);
    expect(pending).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ playerId: victimId, createdBy: casterId, count: 2, upTo: true }),
        expect.objectContaining({ playerId: casterId, createdBy: casterId, count: 1 }),
      ]),
    );
    expect(pending.find((entry) => entry.playerId === casterId)?.upTo).not.toBe(true);
    expect(pending.filter((entry) => entry.playerId === casterId)).toHaveLength(1);
    expect(pending.filter((entry) => entry.playerId === victimId)).toHaveLength(1);
  });
});
