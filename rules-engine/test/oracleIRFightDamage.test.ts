import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import type { GameState } from '../../shared/src/index.js';

// Quoted from mtg_data.db cards.text WHERE is_token = 0.
const APEX_FIGHT = "it fights up to one target creature you don't control.";

function collectDealDamageSteps(text: string, name: string) {
  const ir = parseOracleTextToIR(text, name);
  return (ir.abilities || []).flatMap((ability) => ability.steps || []).filter((step) => step.kind === 'deal_damage');
}

function makeCreature(id: string, controller: string, power: number, toughness: number, name: string) {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    damageMarked: 0,
    card: {
      id: `${id}_card`,
      name,
      type_line: 'Creature',
      power: String(power),
      toughness: String(toughness),
    },
    power,
    toughness,
  };
}

describe('Oracle IR fight damage', () => {
  it('marks bidirectional damage for Apex Altisaur fight', () => {
    const steps = collectDealDamageSteps(APEX_FIGHT, 'Apex Altisaur');
    expect(steps.length).toBeGreaterThan(0);

    const state = {
      players: [{ id: 'p1' }, { id: 'p2' }],
      battlefield: [
        makeCreature('apex', 'p1', 10, 10, 'Apex Altisaur'),
        makeCreature('bear', 'p2', 2, 2, 'Grizzly Bears'),
      ],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, steps, {
      controllerId: 'p1',
      sourceId: 'apex',
      sourceName: 'Apex Altisaur',
      targetCreatureId: 'bear',
      selectorContext: { chosenObjectIds: ['bear'], targetCreatureId: 'bear' },
    } as any, { allowOptional: true });

    expect(result.appliedSteps.some((step) => step.kind === 'deal_damage')).toBe(true);
    const battlefield = (result.state.battlefield || []) as any[];
    const apex = battlefield.find((entry) => entry.id === 'apex');
    const bear = battlefield.find((entry) => entry.id === 'bear');
    expect(Number(bear?.damageMarked || 0)).toBe(10);
    expect(Number(apex?.damageMarked || 0)).toBe(2);
  });

  it('marks bidirectional damage when those creatures fight each other', () => {
    const steps = collectDealDamageSteps('Then those creatures fight each other.', 'Malamet Battle Glyph');
    expect(steps.length).toBeGreaterThan(0);

    const state = {
      players: [{ id: 'p1' }, { id: 'p2' }],
      battlefield: [
        makeCreature('bf-a', 'p1', 2, 2, 'Cat'),
        makeCreature('bf-b', 'p2', 3, 2, 'Snake'),
      ],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, steps, {
      controllerId: 'p1',
      sourceId: 'bf-src',
      lastMovedBattlefieldPermanentIds: ['bf-a', 'bf-b'],
      selectorContext: { chosenObjectIds: ['bf-a', 'bf-b'] },
    } as any, { allowOptional: true });

    const battlefield = (result.state.battlefield || []) as any[];
    expect(Number(battlefield.find((entry) => entry.id === 'bf-a')?.damageMarked || 0)).toBe(3);
    expect(Number(battlefield.find((entry) => entry.id === 'bf-b')?.damageMarked || 0)).toBe(2);
  });
});
