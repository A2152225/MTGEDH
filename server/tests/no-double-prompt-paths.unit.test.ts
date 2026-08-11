import { afterEach, describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import {
  oracleIrEffectProgramWouldPresentOptionalMay,
  requiresEffectProgramOrchestration,
} from '../src/state/modules/oracleIrEffectProgramServer.js';
import { tryResolveInstantSorceryPreResolutionChoices } from '../src/state/modules/stackResolveSpellChoiceUtils.js';
import { collectSpellResolutionEffectSteps } from '../src/state/modules/trigger-runtime-wiring.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function spellSteps(oracle: string, name = 'Test Spell') {
  return collectSpellResolutionEffectSteps(oracle, name);
}

describe('no-double-prompt ownership paths', () => {
  const gameId = 'no_double_prompt_paths';

  afterEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    delete process.env.ORACLE_IR_SPELL_PRIMARY;
    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
  });

  it('EP may probe is true for optional create_token + follow-up, false for lone create_token', () => {
    const withFollowUp = spellSteps(
      'You may create a 1/1 white Soldier creature token. If you do, draw a card.',
    );
    expect(oracleIrEffectProgramWouldPresentOptionalMay(withFollowUp as any)).toBe(true);

    const lone = spellSteps('You may create a 1/1 white Soldier creature token.');
    if (lone.length === 1 && lone[0]?.kind === 'create_token') {
      expect(oracleIrEffectProgramWouldPresentOptionalMay(lone as any)).toBe(false);
    }
  });

  it('skips stack COLOR_CHOICE when Effect Program owns choose_color compound', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game as any).gameId = gameId;

    // Brave the Elements: choose_color + grant_temporary_ability — EP owns the color prompt.
    const oracleText =
      'Choose a color. White creatures you control gain protection from the chosen color until end of turn.';
    const steps = spellSteps(oracleText, 'Brave the Elements');
    expect(steps.map((step: any) => step.kind)).toEqual(['choose_color', 'grant_temporary_ability']);
    expect(requiresEffectProgramOrchestration(steps as any)).toBe(true);

    const item = {
      id: 'stack_brave',
      type: 'spell',
      controller: p1,
      card: {
        id: 'brave_card',
        name: 'Brave the Elements',
        type_line: 'Instant',
        oracle_text: oracleText,
        colors: ['W'],
      },
    };
    (game.state as any).stack = [];

    const deferred = tryResolveInstantSorceryPreResolutionChoices(game as any, {
      controller: p1,
      card: item.card,
      effectiveCard: item.card,
      item,
      oracleText,
      oracleTextLower: oracleText.toLowerCase(),
      isReplaying: false,
    });

    expect(deferred).toBe(false);
    const pending = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    expect(pending.some((step: any) => step.type === ResolutionStepType.COLOR_CHOICE)).toBe(false);
  });

  it('socket tap-trigger queue pushes optional triggers without a pre-stack may import', () => {
    const source = readFileSync(
      resolve(__dirname, '../src/state/modules/tap-trigger-queue.ts'),
      'utf8',
    );
    expect(source.includes("from '../../socket/may-ability-prompts.js'")).toBe(false);
    expect(source.includes('pushTapTriggerOntoStack(io, game, gameId, entry.trigger')).toBe(true);
  });

  it('post-resolve optional may scan is gated when IR primary owns the spell', () => {
    const source = readFileSync(
      resolve(__dirname, '../src/socket/game-actions.ts'),
      'utf8',
    );
    expect(source.includes('Skipping post-resolve optional may scan')).toBe(true);
    expect(source.includes('isSpellEffectOwnedByOracleIrPrimary(oracleText, cardName)')).toBe(true);
  });
});
