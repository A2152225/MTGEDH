import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { createInitialGameState } from '../src/state/gameState.js';
import {
  applyOracleIRStepsOnServer,
  maybeApplyOracleIrChoiceStepFromResolution,
  maybeResumeOracleIRStepsAfterResolution,
  resumeOracleIRStepWithChoiceFromResolution,
} from '../src/state/modules/oracleIrServerZoneSync.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

describe('oracle IR sacrifice queue adapter', () => {
  it('queues sacrifice target selection when multiple creatures exist', () => {
    const gameId = 'oracle_ir_sacrifice_queue';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    (game.state as any).battlefield = [
      {
        id: 'bear-1',
        controller: p1,
        owner: p1,
        card: { id: 'bear-card', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
      },
      {
        id: 'elf-1',
        controller: p1,
        owner: p1,
        card: { id: 'elf-card', name: 'Llanowar Elves', type_line: 'Creature — Elf Druid' },
      },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const irCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'village-rites-1',
      sourceName: 'Village Rites',
    });

    applyOracleIRStepsOnServer(
      ctx,
      game.state as any,
      [
        {
          kind: 'sacrifice',
          who: { kind: 'you' },
          what: { kind: 'raw', text: 'a creature' },
          raw: 'Sacrifice a creature.',
        } as any,
      ],
      irCtx,
      { allowOptional: false },
      { controller: p1 },
    );

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    const sacrificeStep = steps.find((step) => step.type === ResolutionStepType.TARGET_SELECTION);

    expect(sacrificeStep).toBeTruthy();
    expect((sacrificeStep as any)?.validTargets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'bear-1' }),
        expect.objectContaining({ id: 'elf-1' }),
      ])
    );
    expect(String((sacrificeStep as any)?.oracleIrChoiceStepJson || '')).toContain('sacrifice');

    const resumed = resumeOracleIRStepWithChoiceFromResolution(ctx, {
      controller: p1,
      sourceId: 'village-rites-1',
      sourceName: 'Village Rites',
      steps: [
        {
          kind: 'sacrifice',
          who: { kind: 'you' },
          what: { kind: 'raw', text: 'a creature' },
          raw: 'Sacrifice a creature.',
        } as any,
      ],
      chosenObjectIds: ['bear-1'],
    });

    expect(resumed?.appliedSteps.map((step) => step.kind)).toEqual(['sacrifice']);
    expect((game.state as any).battlefield.map((perm: any) => perm.id)).toEqual(['elf-1']);
  });

  it('queues sacrifice for target player and resumes into soldier tokens equal to sacrificed toughness', () => {
    const gameId = 'oracle_ir_entrapment_sacrifice_tokens';
    const game = createInitialGameState(gameId);
    const casterId = 'p_caster' as PlayerID;
    const targetId = 'p_target' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: casterId, name: 'Caster' } as any);
    game.applyEvent!({ type: 'join', playerId: targetId, name: 'Target' } as any);

    const attackerId = 'attacker_1';
    (game.state as any).battlefield = [
      {
        id: attackerId,
        controller: targetId,
        owner: targetId,
        attacking: casterId,
        card: { id: 'bear-card', name: 'Grizzly Bears', type_line: 'Creature — Bear', power: '2', toughness: '3' },
      },
      {
        id: 'non_attacker',
        controller: targetId,
        owner: targetId,
        card: { id: 'elf-card', name: 'Llanowar Elves', type_line: 'Creature — Elf Druid', power: '1', toughness: '1' },
      },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const oracleText =
      "Target player sacrifices an attacking creature of their choice. You create X 1/1 white Soldier creature tokens, where X is that creature's toughness.";
    const steps = parseOracleTextToIR(oracleText, 'Entrapment Maneuver').abilities[0].steps;

    const irCtx = buildOracleIRExecutionContext({
      controllerId: casterId,
      sourceId: 'entrapment-1',
      sourceName: 'Entrapment Maneuver',
      targetPlayerId: targetId,
      selectorContext: { targetPlayerId: targetId, chosenObjectIds: [targetId] },
    });

    applyOracleIRStepsOnServer(
      ctx,
      game.state as any,
      steps,
      irCtx,
      { allowOptional: true, haltOnPlayerChoiceRequired: true },
      { controller: casterId, sourceName: 'Entrapment Maneuver', sourceId: 'entrapment-1' },
    );

    const sacrificeStep = ResolutionQueueManager.getStepsForPlayer(gameId, targetId).find(
      (step) => step.type === ResolutionStepType.TARGET_SELECTION,
    );
    expect(sacrificeStep).toBeTruthy();
    expect(String((sacrificeStep as any)?.oracleIrChoiceStepJson || '')).toContain('sacrifice');
    expect((sacrificeStep as any)?.validTargets).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: attackerId })]),
    );
    expect((sacrificeStep as any)?.validTargets).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'non_attacker' })]),
    );
    expect(String((sacrificeStep as any)?.oracleIrResumeStepsJson || '')).toContain('create_token');

    const choiceResult = maybeApplyOracleIrChoiceStepFromResolution(ctx, sacrificeStep, {
      selections: [attackerId],
    });
    expect(choiceResult?.appliedSteps.map((step) => step.kind)).toEqual(['sacrifice']);

    const resumeResult = maybeResumeOracleIRStepsAfterResolution(ctx, {
      ...(sacrificeStep as any),
      response: { selections: [attackerId] },
    });
    expect(resumeResult?.appliedSteps.map((step) => step.kind)).toEqual(['create_token']);
    const soldiers = ((game.state as any).battlefield || []).filter((perm: any) =>
      /soldier/i.test(String(perm.card?.name || perm.name || '')),
    );
    expect(soldiers).toHaveLength(3);
    expect(soldiers.every((perm: any) => perm.controller === casterId)).toBe(true);
    expect((game.state as any).battlefield.map((perm: any) => perm.id)).toEqual(
      expect.arrayContaining(['non_attacker']),
    );
    expect((game.state as any).battlefield.map((perm: any) => perm.id)).not.toContain(attackerId);
  });
});
