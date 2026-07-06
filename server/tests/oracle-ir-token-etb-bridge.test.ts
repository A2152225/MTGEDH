import { describe, expect, it } from 'vitest';
import { applyOracleIRStepsOnServer } from '../src/state/modules/oracleIrServerZoneSync.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';

describe('IR create_token ETB bridge', () => {
  it('queues other-permanent ETB triggers after IR batch token creation', () => {
    const soulWarden = {
      id: 'soul-warden-1',
      controller: 'p1',
      owner: 'p1',
      tapped: false,
      counters: {},
      card: {
        id: 'card-soul-warden',
        name: 'Soul Warden',
        type_line: 'Creature — Human Cleric',
        oracle_text: 'Whenever another creature enters the battlefield, you gain 1 life.',
        colors: ['W'],
        zone: 'battlefield',
      },
    };

    const state: any = {
      players: [{ id: 'p1', name: 'P1', life: 40 }],
      life: { p1: 40 },
      battlefield: [soulWarden],
      stack: [],
      zones: {
        p1: { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
      },
    };

    const ctx: any = {
      state,
      gameId: 'game-ir-token-etb',
      bumpSeq: () => {},
    };

    const irCtx = buildOracleIRExecutionContext({
      controllerId: 'p1',
      sourceId: 'myrel-1',
      sourceName: 'Myrel, Shield of Argive',
    });

    const result = applyOracleIRStepsOnServer(
      ctx,
      state,
      [
        {
          kind: 'create_token',
          who: { kind: 'you' },
          token: '1/1 colorless Soldier artifact creature',
          amount: { kind: 'number', value: 2 },
          raw: 'Create two 1/1 colorless Soldier artifact creature tokens.',
        } as any,
      ],
      irCtx,
      { allowOptional: true },
      { controller: 'p1' },
    );

    expect(result.appliedSteps.some((step) => step.kind === 'create_token')).toBe(true);
    expect(state.battlefield.filter((perm: any) => perm.isToken === true).length).toBe(2);

    const soulWardenTriggers = (state.stack || []).filter(
      (item: any) =>
        item?.type === 'triggered_ability'
        && String(item?.sourceName || '').toLowerCase() === 'soul warden',
    );
    expect(soulWardenTriggers.length).toBe(2);
  });
});
