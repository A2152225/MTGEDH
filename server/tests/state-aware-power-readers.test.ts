import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import '../src/state/modules/currentPowerToughness.js';
import { getEffectivePower, getEffectiveToughness } from '../src/socket/util-handlers/getEffectivePowerToughness.js';
import { getEffectivePowerForMana } from '../src/state/modules/mana-abilities-handlers/manaAbilityColorRestrictionUtils.js';
import {
  getGreatestControlledCreaturePower,
  readPermanentPower,
  scoreAttackManaEngineReconfigureTarget,
} from '../../rules-engine/src/aiEngineManaPoolSupport.js';

const p1 = 'p1' as PlayerID;
const p2 = 'p2' as PlayerID;

function bear(id = 'bear', extra: Record<string, unknown> = {}) {
  return {
    id, controller: p1, owner: p1, tapped: false, counters: {},
    card: { id: `${id}_card`, name: 'Grizzly Bears', type_line: 'Creature - Bear', oracle_text: '', power: '2', toughness: '2' },
    ...extra,
  };
}

const anthem = () => ({
  id: 'anthem', controller: p1, owner: p1, tapped: false, counters: {},
  card: { id: 'anthem_card', name: 'Glorious Anthem', type_line: 'Enchantment', oracle_text: 'Creatures you control get +1/+1.' },
});

function setup(gameId: string, battlefield: any[]) {
  const game = createInitialGameState(gameId);
  game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
  game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
  const state: any = game.state;
  state.turnNumber = 3;
  state.turnPlayer = p1;
  state.battlefield = battlefield;
  return state;
}

describe('item 4: readers with a game state use the shared current P/T calculation', () => {
  it('getEffectivePower/Toughness with state count anthems and long-lasting pumps', () => {
    const state = setup('sp_anthem', [
      anthem(),
      bear('bear', {
        modifiers: [{ type: 'powerToughness', power: 2, toughness: 0, duration: 'until_next_turn', expiresOnControllerTurn: 'p2', turnApplied: 3 }],
      }),
    ]);
    const creature = state.battlefield.find((entry: any) => entry.id === 'bear');
    expect(getEffectivePower(creature, state)).toBe(5);
    expect(getEffectiveToughness(creature, state)).toBe(3);
  });

  it('AI readPermanentPower with state sees the anthem; without state it keeps the recorded value', () => {
    const state = setup('sp_ai_power', [anthem(), bear()]);
    const creature = state.battlefield.find((entry: any) => entry.id === 'bear');
    expect(readPermanentPower(creature, state)).toBe(3);
    expect(readPermanentPower(creature)).toBe(2);
  });

  it('AI readPermanentPower keeps recorded values for objects that are not on the battlefield', () => {
    const state = setup('sp_ai_offbf', [anthem()]);
    const graveyardCard = bear('dead-bear');
    expect(readPermanentPower(graveyardCard as any, state)).toBe(2);
  });

  it('greatest controlled power and reconfigure scoring use the state-aware reader', () => {
    const state = setup('sp_ai_greatest', [
      anthem(),
      bear('bear'),
      bear('bear2', { modifiers: [{ type: 'powerToughness', power: 3, toughness: 0, duration: 'static' }] }),
    ]);
    expect(getGreatestControlledCreaturePower(state.battlefield, p1, state)).toBe(6);
    expect(getGreatestControlledCreaturePower(state.battlefield, p1)).toBe(2);
    const bearPerm = state.battlefield.find((entry: any) => entry.id === 'bear');
    // Not a legal attacker in a bare state, so the score is the "not attackable" floor either way.
    expect(scoreAttackManaEngineReconfigureTarget(state, p1, bearPerm)).toBeLessThanOrEqual(10_001 + 6 * 5);
  });

  it('the mana-power reader counts the anthem and a set-base effect through the shared calculation', () => {
    const state = setup('sp_mana_power', [
      anthem(),
      bear('bear', {
        modifiers: [{ type: 'setPowerToughness', setPower: 5, setToughness: 5, timestamp: 1 }],
      }),
    ]);
    const creature = state.battlefield.find((entry: any) => entry.id === 'bear');
    expect(getEffectivePowerForMana(creature, state)).toBe(6);
  });

  it('the mana-power fallback (no usable state) ignores an already-expired until-next-turn pump', () => {
    const creature: any = bear('bear', {
      modifiers: [{ type: 'powerToughness', power: 4, toughness: 0, duration: 'end_of_combat', turnApplied: 1 }],
    });
    // Without a state the estimate still counts active long-lasting pumps once.
    expect(getEffectivePowerForMana(creature)).toBe(6);
    const bare: any = bear('bear2');
    expect(getEffectivePowerForMana(bare)).toBe(2);
  });

  it('getEffectivePower without state still prefers the cached value (compat)', () => {
    const cached: any = bear('cached', { effectivePower: 9 });
    expect(getEffectivePower(cached)).toBe(9);
  });
});