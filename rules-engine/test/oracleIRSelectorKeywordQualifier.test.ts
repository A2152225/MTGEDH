import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { parseSimpleBattlefieldSelector } from '../src/oracleIRExecutorBattlefieldParser';

const p1 = 'p1' as PlayerID;
const p2 = 'p2' as PlayerID;

function creature(id: string, controller: string, oracle = '', extra: Record<string, unknown> = {}) {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    counters: {},
    card: { id: `${id}-card`, name: id, type_line: 'Creature', oracle_text: oracle, power: '5', toughness: '5' },
    ...extra,
  } as any;
}

describe('battlefield selectors with keyword qualifiers', () => {
  it('parses "with/without <keyword>" only for creature selectors', () => {
    expect(parseSimpleBattlefieldSelector({ kind: 'raw', text: 'each creature without flying' })).toMatchObject({
      types: ['creature'],
      keywordsNone: ['flying'],
    });
    expect(parseSimpleBattlefieldSelector({ kind: 'raw', text: 'each other creature with flying' })).toMatchObject({
      types: ['creature'],
      keywordsAll: ['flying'],
      excludeSourceId: true,
    });
    expect(parseSimpleBattlefieldSelector({ kind: 'raw', text: 'each artifact without flying' })).toBeNull();
  });

  it('Themberchaud ETB damages each other non-flyer and each player for X = Mountains you control', () => {
    const ir = parseOracleTextToIR(
      'When Themberchaud enters, he deals X damage to each other creature without flying and each player, where X is the number of Mountains you control.',
      'Themberchaud',
    );
    const steps = ir.abilities[0]?.steps || [];
    const mountain = (id: string) => ({
      id, controller: p1, owner: p1, tapped: false, counters: {},
      card: { id: `${id}-card`, name: 'Mountain', type_line: 'Basic Land — Mountain', oracle_text: '' },
    });
    const state = {
      players: [
        { id: p1, life: 20, library: [], hand: [], graveyard: [], exile: [] },
        { id: p2, life: 20, library: [], hand: [], graveyard: [], exile: [] },
      ],
      battlefield: [
        creature('themberchaud', p1, 'Trample'),
        creature('ground', p2),
        creature('bird', p2, 'Flying'),
        mountain('m1'),
        mountain('m2'),
      ],
    } as unknown as GameState;

    const result = applyOracleIRStepsToGameState(state, steps, { controllerId: p1, sourceId: 'themberchaud' });
    const byId = (id: string) => ((result.state?.battlefield || []) as any[]).find((p) => p.id === id);
    const damage = (p: any) => Number(p?.damageMarked ?? p?.markedDamage ?? p?.damage ?? 0);

    expect(result.automationGaps?.length ?? 0).toBe(0);
    expect(damage(byId('ground'))).toBe(2);
    expect(damage(byId('bird'))).toBe(0);
    expect(damage(byId('themberchaud'))).toBe(0);
    expect((result.state?.players || []).map((p: any) => p.life)).toEqual([18, 18]);
  });
});