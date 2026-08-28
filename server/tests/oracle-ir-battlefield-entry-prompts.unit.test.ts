import { afterEach, describe, expect, it } from 'vitest';

import { queueBattlefieldEntryReplacementPromptsAfterOracleIR } from '../src/state/modules/oracleIrBattlefieldEntryPrompts.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

const STEAM_VENTS_ORACLE =
  "As Steam Vents enters, you may pay 2 life. If you don't, it enters tapped.\n{T}: Add {U} or {R}.";

const UNCHARTED_HAVEN_ORACLE =
  'Uncharted Haven enters tapped.\nAs it enters, choose a color.\n{T}: Add one mana of the chosen color.';

describe('oracle IR battlefield-entry replacement prompts', () => {
  const gameId = 'oracle_ir_battlefield_entry_prompts';

  afterEach(() => {
    ResolutionQueueManager.clearAllSteps(gameId);
  });

  function makeCtx(battlefield: any[], extras?: Record<string, unknown>) {
    const state = {
      battlefield,
      players: [{ id: 'p1', hand: [] }],
      zones: { p1: { hand: [] } },
      life: { p1: 40 },
      ...(extras || {}),
    };
    return {
      gameId,
      state,
      life: { p1: 40 },
    } as any;
  }

  it('taps a shock land and queues pay 2 life when IR just put it onto the battlefield', () => {
    const steam = {
      id: 'steam-1',
      controller: 'p1',
      tapped: false,
      card: {
        name: 'Steam Vents',
        type_line: 'Land — Island Mountain',
        oracle_text: STEAM_VENTS_ORACLE,
      },
    };
    const ctx = makeCtx([steam]);
    queueBattlefieldEntryReplacementPromptsAfterOracleIR(ctx, ctx.state, new Set());
    expect(steam.tapped).toBe(true);
    expect(
      ResolutionQueueManager.getQueue(gameId).steps.some((step: any) => step.shockLandChoice === true),
    ).toBe(true);
  });

  it('queues a color choice for Uncharted Haven put onto the battlefield by IR', () => {
    const haven = {
      id: 'haven-1',
      controller: 'p1',
      tapped: true,
      card: {
        name: 'Uncharted Haven',
        type_line: 'Land',
        oracle_text: UNCHARTED_HAVEN_ORACLE,
      },
    };
    const ctx = makeCtx([haven]);
    queueBattlefieldEntryReplacementPromptsAfterOracleIR(ctx, ctx.state, new Set());
    expect(
      ResolutionQueueManager.getQueue(gameId).steps.some(
        (step: any) => step.type === ResolutionStepType.COLOR_CHOICE,
      ),
    ).toBe(true);
  });
});
