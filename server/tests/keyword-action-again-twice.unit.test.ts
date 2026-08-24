import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import {
  getExploreActionCount,
  getProliferateActionCount,
} from '../../rules-engine/src/keywordActionRepetition.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { applyOracleIRStepsOnServer } from '../src/state/modules/oracleIrServerZoneSync.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

function collectStepKinds(steps: readonly { kind?: string; steps?: readonly any[] }[] | undefined): string[] {
  return (steps || []).flatMap((step) => [
    String(step.kind || ''),
    ...collectStepKinds(step.steps),
  ]);
}

function stepKinds(cardName: string, text: string): string[] {
  const ir = parseOracleTextToIR(text, cardName);
  return (ir.abilities || []).flatMap((ability) => collectStepKinds(ability.steps));
}

describe('keyword action again / twice families', () => {
  it('parses proliferate twice / again as repeated proliferate steps', () => {
    expect(stepKinds(
      'Contagion Engine',
      '{4}, {T}: Proliferate twice. (Choose any number of permanents and/or players, then give each another counter of each kind already there. Then do it again.)',
    ).filter((kind) => kind === 'proliferate')).toHaveLength(2);

    expect(stepKinds(
      'Contagion Engine',
      '{4}, {T}: Proliferate twice. (Choose any number of permanents and/or players, then give each another counter of each kind already there. Then do it again.)',
    )).not.toContain('grant_static_ability');

    expect(stepKinds(
      'Ezuri, Stalker of Spheres',
      'When Ezuri enters, you may pay {3}. If you do, proliferate twice.',
    ).filter((kind) => kind === 'proliferate')).toHaveLength(2);

    expect(stepKinds(
      'Roalesk, Apex Hybrid',
      'When Roalesk dies, proliferate, then proliferate again.',
    ).filter((kind) => kind === 'proliferate')).toHaveLength(2);
  });

  it('keeps Tekuthal / Topography Tracker as replacement abilities without executable steps', () => {
    const tekuthal = parseOracleTextToIR(
      'If you would proliferate, proliferate twice instead.',
      'Tekuthal, Inquiry Dominus',
    );
    expect(tekuthal.abilities?.[0]?.type).toBe('replacement');
    expect(tekuthal.abilities?.[0]?.steps || []).toHaveLength(0);

    const topography = parseOracleTextToIR(
      'If a creature you control would explore, instead it explores, then it explores again.',
      'Topography Tracker',
    );
    expect(topography.abilities?.[0]?.type).toBe('replacement');
    expect(topography.abilities?.[0]?.steps || []).toHaveLength(0);
  });

  it('queues two proliferate prompts when Tekuthal replacement applies', () => {
    const gameId = 'tekuthal_proliferate_twice';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    (game.state as any).battlefield = [
      {
        id: 'tekuthal-1',
        controller: p1,
        owner: p1,
        card: {
          id: 'tekuthal-card',
          name: 'Tekuthal, Inquiry Dominus',
          type_line: 'Legendary Creature — Phyrexian Horror',
          oracle_text: 'If you would proliferate, proliferate twice instead.',
        },
      },
      {
        id: 'bear-1',
        controller: p1,
        owner: p1,
        card: { id: 'bear-card', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
        counters: { '+1/+1': 1 },
      },
      {
        id: 'elf-1',
        controller: p1,
        owner: p1,
        card: { id: 'elf-card', name: 'Llanowar Elves', type_line: 'Creature — Elf Druid' },
        counters: { '+1/+1': 2 },
      },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    expect(getProliferateActionCount((game.state as any).battlefield, p1)).toBe(2);

    const irCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'proliferate-source-1',
      sourceName: 'Proliferate Source',
    });

    applyOracleIRStepsOnServer(
      ctx,
      game.state as any,
      [{ kind: 'proliferate', who: { kind: 'you' }, raw: 'Proliferate.' } as any],
      irCtx,
      { allowOptional: false },
      { controller: p1 },
    );

    const proliferateSteps = ResolutionQueueManager
      .getStepsForPlayer(gameId, p1)
      .filter((step) => step.type === ResolutionStepType.PROLIFERATE);
    expect(proliferateSteps).toHaveLength(2);
  });

  it('queues two explore decisions when Topography Tracker replacement applies', () => {
    const gameId = 'topography_explore_again';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    (game.state as any).battlefield = [
      {
        id: 'tracker-1',
        controller: p1,
        owner: p1,
        card: {
          id: 'tracker-card',
          name: 'Topography Tracker',
          type_line: 'Creature — Merfolk Scout',
          oracle_text: 'If a creature you control would explore, instead it explores, then it explores again.',
        },
      },
      {
        id: 'explorer-1',
        controller: p1,
        owner: p1,
        card: { id: 'explorer-card', name: 'Jadelight Ranger', type_line: 'Creature — Merfolk Scout' },
        counters: {},
      },
    ];

    const player = (game.state as any).players.find((entry: any) => entry.id === p1);
    player.library = [
      { id: 'bolt-1', name: 'Lightning Bolt', type_line: 'Instant', cmc: 1 },
      { id: 'bolt-2', name: 'Shock', type_line: 'Instant', cmc: 1 },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;
    ctx.libraries = new Map([[p1, player.library.map((card: any) => ({ ...card }))]]);
    ResolutionQueueManager.removeQueue(gameId);

    expect(getExploreActionCount((game.state as any).battlefield, p1)).toBe(2);

    const irCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'explorer-1',
      sourceName: 'Jadelight Ranger',
      targetPermanentId: 'explorer-1',
    });

    applyOracleIRStepsOnServer(
      ctx,
      game.state as any,
      [{
        kind: 'explore',
        target: { kind: 'raw', text: 'this creature' },
        raw: 'it explores',
      } as any],
      irCtx,
      { allowOptional: false },
      { controller: p1, sourceId: 'explorer-1', sourceName: 'Jadelight Ranger' },
    );

    const exploreSteps = ResolutionQueueManager
      .getStepsForPlayer(gameId, p1)
      .filter((step) => step.type === ResolutionStepType.EXPLORE_DECISION);
    expect(exploreSteps.length).toBeGreaterThanOrEqual(2);
  });
});
