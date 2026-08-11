import { describe, expect, it, vi } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { applyOracleIRStepsOnServer } from '../src/state/modules/oracleIrServerZoneSync.js';
import { processDiscoverTriggers } from '../src/state/modules/triggerDiscoverUtils.js';
import { processDetectedAbilityActivatedTriggers } from '../src/state/modules/triggerEmissionFamilyUtils.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { timingTriggerEffect } from '../src/state/modules/triggers/timing-effect-extraction.js';

describe('remaining again-family open items', () => {
  it('parses Curator discover-again effect and queues Discover N on emit', () => {
    const oracle =
      "Whenever you discover, discover again for the same value. This ability triggers only once each turn.";
    const match = oracle.match(/whenever you discover,?\s*([^.]+)/i)!;
    const effect = timingTriggerEffect(oracle, match)
      .replace(/\s*This ability triggers only once each turn\.?/gi, '')
      .trim();
    expect(effect.toLowerCase()).toContain('discover again for the same value');
    expect(effect.toLowerCase()).not.toContain('only once each turn');

    const gameId = 'curator_discover_again';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      {
        id: 'curator-1',
        controller: p1,
        owner: p1,
        card: {
          id: 'curator-card',
          name: "Curator of Sun's Creation",
          type_line: 'Creature — Human Artificer',
          oracle_text: oracle,
        },
      },
    ];
    const ctx = game as any;
    ctx.gameId = gameId;

    const queued = processDiscoverTriggers(ctx, p1, 4);
    expect(queued).toHaveLength(1);
    expect(String(queued[0].effect)).toMatch(/^Discover 4$/i);
    expect(queued[0].effectData?.discoverValue).toBe(4);

    // once each turn
    const queuedAgain = processDiscoverTriggers(ctx, p1, 3);
    expect(queuedAgain).toHaveLength(0);
  });

  it('parses Game of Chaos as flip_coin_life_stakes and queues flip-again choice', () => {
    const text =
      'Flip a coin. If you win the flip, you gain 1 life and target opponent loses 1 life, and you decide whether to flip again. If you lose the flip, you lose 1 life and that opponent gains 1 life, and that player decides whether to flip again. Double the life stakes with each flip.';
    const ir = parseOracleTextToIR(text, 'Game of Chaos');
    const steps = (ir.abilities || []).flatMap((ability) => ability.steps || []);
    expect(steps.some((step) => step.kind === 'flip_coin_life_stakes')).toBe(true);

    const gameId = 'game_of_chaos_loop';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    (game.state as any).life = { [p1]: 40, [p2]: 40 };

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    vi.spyOn(Math, 'random').mockReturnValue(0.1); // heads

    const irCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'goc-1',
      sourceName: 'Game of Chaos',
      targetOpponentId: p2,
    });

    applyOracleIRStepsOnServer(
      ctx,
      game.state as any,
      steps as any,
      irCtx,
      { allowOptional: false },
      { controller: p1 },
    );

    const choices = ResolutionQueueManager
      .getStepsForPlayer(gameId, p1)
      .filter((step) => step.type === ResolutionStepType.OPTION_CHOICE);
    expect(choices.length).toBeGreaterThanOrEqual(1);
    expect(String((choices[0] as any)?.description || '')).toMatch(/flip again/i);

    // One player gained 1, the other lost 1.
    const lifeP1 = Number((game.state as any).life[p1]);
    const lifeP2 = Number((game.state as any).life[p2]);
    expect(Math.abs(lifeP1 - lifeP2)).toBe(2);

    vi.restoreAllMocks();
  });

  it('emits Verrak-shaped pay-life-again copy trigger when life was paid', () => {
    const gameId = 'verrak_life_again';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      {
        id: 'verrak-1',
        controller: p1,
        owner: p1,
        card: {
          id: 'verrak-card',
          name: 'Verrak, Warped Sengir',
          type_line: 'Legendary Creature — Vampire',
          oracle_text:
            "Flying, deathtouch, lifelink\nWhenever you activate an ability that isn't a mana ability, if life was paid to activate it, you may pay that much life again. If you do, copy that ability. You may choose new targets for the copy.",
        },
      },
      {
        id: 'src-1',
        controller: p1,
        owner: p1,
        card: {
          id: 'src-card',
          name: 'Life Pay Source',
          type_line: 'Creature',
          oracle_text: 'Pay 2 life: Draw a card.',
        },
      },
    ];
    (game.state as any).stack = [
      {
        id: 'ability-1',
        type: 'ability',
        controller: p1,
        source: 'src-1',
        description: 'Pay 2 life: Draw a card.',
        lifePaidForCost: 2,
      },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;
    const before = (game.state as any).stack.length;

    const queued = processDetectedAbilityActivatedTriggers(ctx, {
      activatedBy: p1,
      sourcePermanentId: 'src-1',
      isManaAbility: false,
      abilityText: 'Pay 2 life: Draw a card.',
      stackItemId: 'ability-1',
      lifePaidForCost: 2,
    });

    expect(queued.length).toBeGreaterThanOrEqual(1);
    expect(String(queued[0].effect || '')).toMatch(/pay 2 life again/i);
    expect(String(queued[0].effect || '')).toMatch(/copy that ability/i);
    expect((game.state as any).stack.length).toBeGreaterThan(before);
  });
});
