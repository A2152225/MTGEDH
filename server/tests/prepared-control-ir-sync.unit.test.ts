import { describe, expect, it } from 'vitest';
import { createInitialGameState } from '../src/state/gameState.js';
import { collectOracleEffectSteps } from '../src/state/modules/trigger-runtime-wiring.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { applyOracleIRStepsOnServer } from '../src/state/modules/oracleIrServerZoneSync.js';
import { setPermanentPrepared } from '../src/state/modules/prepared.js';
import type { PlayerID } from '../../shared/src';

describe('prepared control sync via IR', () => {
  it('migrates prepared copy after gain_control IR step', () => {
    const p1 = 'p1';
    const p2 = 'p2';
    const preparedCard = {
      id: 'prepared_treason_card',
      name: 'Prepared Host // Sudden Recall',
      layout: 'prepare',
      card_faces: [
        { name: 'Prepared Host', type_line: 'Creature — Human Advisor', oracle_text: 'enters prepared' },
        { name: 'Sudden Recall', type_line: 'Instant', oracle_text: 'Return target creature.' },
      ],
    };
    const permanent = {
      id: 'prepared_treason_perm',
      controller: p2,
      owner: p2,
      tapped: true,
      card: { ...preparedCard, name: 'Prepared Host', type_line: 'Creature — Human Advisor' },
    } as any;

    const state = {
      players: [
        { id: p1, name: 'P1' },
        { id: p2, name: 'P2' },
      ],
      battlefield: [permanent],
      zones: {
        [p1]: { hand: [], graveyard: [], library: [], exile: [], exileCount: 0 },
        [p2]: { hand: [], graveyard: [], library: [], exile: [], exileCount: 0 },
      },
    };
    setPermanentPrepared(state, permanent);
    expect(state.zones[p2].exile).toHaveLength(1);

    const ctx = { libraries: new Map([[p1, []], [p2, []]]) } as any;
    const oracleText = 'Gain control of target creature until end of turn. Untap that creature. It gains haste until end of turn.';
    const steps = collectOracleEffectSteps(oracleText, 'Act of Treason');
    const irCtx = buildOracleIRExecutionContext(
      {
        controllerId: p1,
        sourceId: 'stack_1',
        sourceName: 'Act of Treason',
        sourceObjectType: 'spell',
        targetPermanentId: 'prepared_treason_perm',
        selectorContext: { chosenObjectIds: ['prepared_treason_perm'] },
      },
      {
        targetPermanentId: 'prepared_treason_perm',
        chosenObjectIds: ['prepared_treason_perm'],
        sourceObjectType: 'spell',
      },
    );

    const result = applyOracleIRStepsOnServer(ctx, state, steps, irCtx, { allowOptional: true }, { controller: p1 });
    expect(result.appliedSteps.length).toBeGreaterThan(0);
    expect(state.battlefield[0].controller).toBe(p1);
    expect(state.battlefield[0].prepared).toBe(true);
    expect(state.battlefield[0].preparedExileCopyCardId).toBeTruthy();
    expect(state.zones[p2].exile).toHaveLength(0);
    expect(state.zones[p1].exile).toHaveLength(1);
  });

  it('migrates prepared copy through createInitialGameState resolveTopOfStack', () => {
    const game = createInitialGameState('t_prepared_control_resolve_stack');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    game.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, library: [], libraryCount: 0, exile: [], exileCount: 0 },
      [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, library: [], libraryCount: 0, exile: [], exileCount: 0 },
    };

    const preparedCard = {
      id: 'prepared_treason_card',
      name: 'Prepared Host // Sudden Recall',
      layout: 'prepare',
      card_faces: [
        { name: 'Prepared Host', type_line: 'Creature — Human Advisor', oracle_text: 'enters prepared' },
        { name: 'Sudden Recall', type_line: 'Instant', oracle_text: 'Return target creature.' },
      ],
    };
    const preparedPermanent = {
      id: 'prepared_treason_perm',
      controller: p2,
      owner: p2,
      tapped: true,
      card: { ...preparedCard, name: 'Prepared Host', type_line: 'Creature — Human Advisor' },
    } as any;

    (game.state as any).battlefield = [preparedPermanent];
    setPermanentPrepared((game.state as any), preparedPermanent);
    expect((game.state as any).zones[p2].exile).toHaveLength(1);

    (game.state as any).stack = [{
      id: 'stack_act_of_treason_1',
      type: 'spell',
      controller: p1,
      card: {
        id: 'act_of_treason_1',
        name: 'Act of Treason',
        type_line: 'Sorcery',
        oracle_text: 'Gain control of target creature until end of turn. Untap that creature. It gains haste until end of turn.',
      },
      targets: ['prepared_treason_perm'],
    }];

    game.resolveTopOfStack();

    expect((game.state as any).zones[p2].exile).toHaveLength(0);
    expect((game.state as any).zones[p1].exile).toHaveLength(1);
  });
});
