import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import {
  applyAsEntersAutomaticReplacementsForPermanent,
  tryApplyAsEntersAutomaticReplacementsForPermanent,
} from '../src/state/modules/oracleIrBattlefieldEntryAutomaticReplacements.js';
import { queueBattlefieldEntryReplacementPromptsAfterOracleIR } from '../src/state/modules/oracleIrBattlefieldEntryPrompts.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

const promptsSourcePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../src/state/modules/oracleIrBattlefieldEntryPrompts.ts',
);

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

  it('stamps battlefield-entry replacement metadata on a Cultivate land without throwing', () => {
    const forest = {
      id: 'forest-1',
      controller: 'p1',
      tapped: true,
      card: {
        name: 'Forest',
        type_line: 'Basic Land — Forest',
        oracle_text: '',
      },
    };
    const ctx = makeCtx([forest]);
    expect(() => {
      queueBattlefieldEntryReplacementPromptsAfterOracleIR(ctx, ctx.state, new Set());
    }).not.toThrow();
    expect(forest.tapped).toBe(true);
    expect((forest as any).battlefieldEntryReplacement).toMatchObject({
      applied: true,
      eventType: 'battlefield-entry',
      reason: 'battlefield_entry_replacement',
      metadata: {
        controllerId: 'p1',
        entersTapped: true,
      },
    });
  });

  it('taps a permanent that automatically enters tapped (Authority of the Consuls)', () => {
    const creature = {
      id: 'bear-1',
      controller: 'p1',
      tapped: false,
      card: {
        name: 'Grizzly Bears',
        type_line: 'Creature — Bear',
        oracle_text: '',
        power: '2',
        toughness: '2',
      },
    };
    const authority = {
      id: 'auth-1',
      controller: 'p2',
      card: {
        name: 'Authority of the Consuls',
        type_line: 'Enchantment',
        oracle_text: 'Creatures your opponents control enter tapped.',
      },
    };
    applyAsEntersAutomaticReplacementsForPermanent(
      { battlefield: [authority, creature], players: [{ id: 'p1' }, { id: 'p2' }] },
      creature,
      'p1',
    );
    expect(creature.tapped).toBe(true);
    expect((creature as any).battlefieldEntryReplacement?.applied).toBe(true);
  });

  it('does not throw when the automatic-replacement helper is missing or throws', () => {
    const forest = {
      id: 'forest-guard-1',
      controller: 'p1',
      tapped: true,
      card: { name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '' },
    };
    expect(() => {
      tryApplyAsEntersAutomaticReplacementsForPermanent({ battlefield: [forest] }, forest, 'p1', undefined);
    }).not.toThrow();
    expect(() => {
      tryApplyAsEntersAutomaticReplacementsForPermanent({ battlefield: [forest] }, forest, 'p1', null);
    }).not.toThrow();
    expect(() => {
      tryApplyAsEntersAutomaticReplacementsForPermanent(
        { battlefield: [forest] },
        forest,
        'p1',
        () => {
          throw new ReferenceError('applyAsEntersAutomaticReplacementsForPermanent is not defined');
        },
      );
    }).not.toThrow();
  });

  it('imports the automatic-replacement helper instead of calling an unbound identifier', () => {
    const source = readFileSync(promptsSourcePath, 'utf8');
    expect(source).toMatch(/applyAsEntersAutomaticReplacementsForPermanent/);
    expect(source).toMatch(/from '\.\/oracleIrBattlefieldEntryAutomaticReplacements\.js'/);
    expect(source).toMatch(/tryApplyAsEntersAutomaticReplacementsForPermanent/);
    expect(source).toMatch(/try \{/);
  });
});
