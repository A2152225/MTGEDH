import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  applyOracleIRStepsToGameState,
  buildOracleIRExecutionContext,
} from '../src/oracleIRExecutor';
import { tryResolveControlledCreatureKeywordScaler } from '../src/oracleIRExecutorModifyPtStepHandlers-handlers/oracleIRExecutorModifyPtKeywordScaler';

function creature(id: string, controller: string, over: Record<string, unknown> = {}) {
  return {
    id,
    controller,
    owner: controller,
    name: id,
    type_line: 'Creature — Bear',
    power: 2,
    toughness: 2,
    card: { name: id, type_line: 'Creature — Bear' },
    ...over,
  };
}

function state(battlefield: any[], extra: Record<string, unknown> = {}) {
  return {
    id: 'amount-scaler',
    format: 'commander',
    players: [
      { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] },
      { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] },
    ],
    startingLife: 40,
    life: { p1: 40, p2: 40 },
    turnPlayer: 'p1',
    priority: 'p1',
    stack: [],
    battlefield,
    commandZone: {},
    phase: 'combat',
    active: true,
    ...extra,
  } as any;
}

function stepsOf(text: string, name: string) {
  return (parseOracleTextToIR(text, name).abilities || []).flatMap((a) => a.steps || []);
}

describe('keyword-list creature scaler (Tsagan)', () => {
  it('counts controlled creatures with first strike or double strike', () => {
    const game = state([
      creature('tsagan', 'p1', { keywords: ['double strike'] }),
      creature('fs', 'p1', { keywords: ['first strike'] }),
      creature('plain', 'p1'),
      creature('enemy-fs', 'p2', { keywords: ['first strike'] }),
    ]);
    expect(
      tryResolveControlledCreatureKeywordScaler(game, 'p1' as any, 'for each creature you control with first strike or double strike'),
    ).toBe(2);
    expect(tryResolveControlledCreatureKeywordScaler(game, 'p1' as any, 'for each creature you control with flying')).toBe(0);
    expect(tryResolveControlledCreatureKeywordScaler(game, 'p1' as any, 'for each creature you control')).toBeNull();
  });

  it('applies +1/+0 per qualifying creature to creatures you control', () => {
    const game = state([
      creature('tsagan', 'p1', { keywords: ['double strike'] }),
      creature('fs', 'p1', { keywords: ['first strike'] }),
      creature('plain', 'p1'),
    ]);
    const steps = stepsOf(
      'Whenever Tsagan attacks, creatures you control get +1/+0 until end of turn for each creature you control with first strike or double strike.',
      'Tsagan, Raider Warlord',
    );
    const result = applyOracleIRStepsToGameState(
      game,
      steps,
      buildOracleIRExecutionContext({ controllerId: 'p1', sourceId: 'tsagan', sourceName: 'Tsagan, Raider Warlord' }),
    );
    expect(result.appliedSteps.some((s) => s.kind === 'modify_pt')).toBe(true);
    // Two qualifying creatures (double strike + first strike) => +2/+0 for each of the three creatures.
    expect(result.log.join('\n')).toMatch(/\+2\/\+?0/);
  });
});

describe('plural combat-damage amount (Quartzwood Crasher)', () => {
  it('creates an X/X token where X is the damage those creatures dealt to that player', () => {
    const game = state(
      [creature('tr1', 'p1', { keywords: ['trample'] }), creature('tr2', 'p1', { keywords: ['trample'] })],
      {
        creaturesThatDealtDamageToPlayer: {
          p2: {
            tr1: { creatureName: 'tr1', totalDamage: 3 },
            tr2: { creatureName: 'tr2', totalDamage: 4 },
          },
        },
      },
    );
    const steps = stepsOf(
      'Whenever one or more creatures you control with trample deal combat damage to a player, create an X/X green Dinosaur Beast creature token with trample, where X is the amount of damage those creatures dealt to that player.',
      'Quartzwood Crasher',
    );
    const result = applyOracleIRStepsToGameState(
      game,
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1',
        sourceId: 'tr1',
        sourceName: 'Quartzwood Crasher',
        selectorContext: { targetPlayerId: 'p2', targetOpponentId: 'p2' },
        targetPlayerId: 'p2',
      } as any),
    );
    expect(result.appliedSteps.map((s) => s.kind)).toEqual(['create_token']);
    const token: any = (result.state.battlefield as any[]).find((p) => /dinosaur/i.test(JSON.stringify(p)));
    expect(token).toBeTruthy();
    expect(Number(token.power ?? token.card?.power)).toBe(7);
    expect(Number(token.toughness ?? token.card?.toughness)).toBe(7);
  });

  it('limits X to triggering creatures when the trigger recorded them', () => {
    const game = state([creature('tr1', 'p1')], {
      creaturesThatDealtDamageToPlayer: {
        p2: { tr1: { totalDamage: 3 }, other: { totalDamage: 9 } },
      },
    });
    const steps = stepsOf(
      'Whenever one or more creatures you control with trample deal combat damage to a player, create an X/X green Dinosaur Beast creature token with trample, where X is the amount of damage those creatures dealt to that player.',
      'Quartzwood Crasher',
    );
    const result = applyOracleIRStepsToGameState(
      game,
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1',
        sourceId: 'tr1',
        sourceName: 'Quartzwood Crasher',
        selectorContext: { targetPlayerId: 'p2' },
        triggeringCombatCreatureIds: ['tr1'],
      } as any),
    );
    const token: any = (result.state.battlefield as any[]).find((p) => /dinosaur/i.test(JSON.stringify(p)));
    expect(Number(token.power ?? token.card?.power)).toBe(3);
  });
});
