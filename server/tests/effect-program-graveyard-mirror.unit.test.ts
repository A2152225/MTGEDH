import { describe, expect, it } from 'vitest';

import { buildEffectProgramFromOracleIR } from '../../rules-engine/src/effectProgram.js';
import { createOracleIREffectProgramHandlers } from '../../rules-engine/src/effectProgramOracleRunner.js';
import type { OracleEffectStep } from '../../rules-engine/src/oracleIR.js';
import { startEffectProgramResolution } from '../src/state/effects/effectProgramResolutionService.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { getActiveDurablePermissions } from '../src/state/modules/durable-permissions.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

describe('Effect Program graveyard permission durable mirror', () => {
  const gameId = 'test_effect_program_graveyard_mirror';

  it('mirrors grant+modify graveyard permissions after Effect Program completion', () => {
    ResolutionQueueManager.removeQueue(gameId);

    const game = createInitialGameState(gameId);
    game.applyEvent({ type: 'join', playerId: 'p1', name: 'P1' } as any);
    (game.state as any).turnNumber = 4;
    (game.state as any).players = [
      {
        id: 'p1',
        name: 'P1',
        graveyard: [
          { id: 'mind_stone_1', name: 'Mind Stone', type_line: 'Artifact', mana_cost: '{2}' },
        ],
      },
    ];
    (game.state as any).zones = {
      p1: {
        hand: [],
        handCount: 0,
        graveyard: [
          { id: 'mind_stone_1', name: 'Mind Stone', type_line: 'Artifact', mana_cost: '{2}' },
        ],
        graveyardCount: 1,
        library: [],
        libraryCount: 0,
        exile: [],
        exileCount: 0,
      },
    };

    const steps: OracleEffectStep[] = [
      {
        kind: 'grant_graveyard_permission',
        who: { kind: 'you' },
        what: { kind: 'raw', text: 'permanent cards' },
        permission: 'cast',
        duration: 'this_turn',
        raw: 'During your turn, permanent cards in your graveyard have retrace.',
      } as OracleEffectStep,
      {
        kind: 'modify_graveyard_permissions',
        scope: 'last_granted_graveyard_cards',
        additionalCost: {
          kind: 'discard',
          count: 1,
          filterText: 'land',
          raw: 'by discarding a land card in addition to paying their other costs',
        },
        raw: 'You may cast permanent cards from your graveyard by discarding a land card in addition to paying their other costs.',
      } as OracleEffectStep,
    ];

    const program = buildEffectProgramFromOracleIR({
      id: 'ep-graveyard-mirror',
      controllerId: 'p1',
      sourceId: 'six_1',
      sourceName: 'Six',
      steps,
    });
    const handlers = createOracleIREffectProgramHandlers(
      {
        controllerId: 'p1',
        sourceId: 'six_1',
        sourceName: 'Six',
      },
      { allowOptional: true },
    );

    const result = startEffectProgramResolution({
      game,
      gameId,
      program,
      handlers: handlers as any,
      persistPrompt: false,
    });

    expect(result.status).toBe('completed');

    const durablePermission = getActiveDurablePermissions(game.state as any, {
      playerId: 'p1' as any,
      kind: 'graveyard_permission',
    })[0] as any;

    expect(durablePermission?.metadata?.additionalCost).toEqual({
      type: 'discard',
      amount: 1,
      filter: 'land',
    });
    expect(String(durablePermission?.debug?.sourceText || '')).toMatch(/discarding a land card in addition/i);
  });
});
