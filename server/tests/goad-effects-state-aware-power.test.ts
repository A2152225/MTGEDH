import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { baelothGoadCondition, getEffectivePower } from '../src/state/modules/goad-effects.js';
import '../src/state/modules/currentPowerToughness.js';

describe('goad-effects power reader reads the shared current P/T when given a state', () => {
  it('counts an anthem for a battlefield creature, and keeps the old behaviour without state', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('goad_power');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: 'p2' as PlayerID, name: 'P2' } as any);
    const state: any = game.state;
    state.turnNumber = 2;
    state.turnPlayer = p1;
    const opp = { id: 'opp', controller: 'p2', owner: 'p2', tapped: false, counters: {}, basePower: 1, baseToughness: 1,
      card: { id: 'o', name: 'Opp Bear', type_line: 'Creature - Bear', oracle_text: '', power: '1', toughness: '1' } };
    const anthem = { id: 'an', controller: 'p2', owner: 'p2', tapped: false, counters: {},
      card: { id: 'a', name: 'Glorious Anthem', type_line: 'Enchantment', oracle_text: 'Creatures you control get +1/+1.' } };
    state.battlefield = [opp, anthem];
    expect(getEffectivePower(opp as any, state)).toBe(2);
    expect(getEffectivePower(opp as any)).toBe(1);
    const goaded = baelothGoadCondition(2, p1, state);
    expect(goaded(opp as any)).toBe(false); // power 2 is not less than 2 once the anthem counts
    expect(baelothGoadCondition(2, p1)(opp as any)).toBe(true); // stateless: legacy behaviour
  });
});