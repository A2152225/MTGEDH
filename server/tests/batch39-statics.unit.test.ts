import { describe, expect, it } from 'vitest';
import { parseEquipAbilitiesFromOracle } from '../../shared/src/equipAbilities';
import { parseAlternativeCostOptions } from '../src/state/modules/alternativeCostOptions';
import { playerProtectedFromOpponentSacrifice, withSacrificeCauseProtection } from '../../rules-engine/src/sacrificeCauseProtection';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor';
import { enqueueEdictCreatureSacrificeStep } from '../src/socket/sacrifice-resolution';

const TAJURU = "Spells and abilities your opponents control can't cause you to sacrifice permanents.";
const bear = (id: string, controller: string) => ({ id, controller, type_line: 'Creature - Bear', card: { name: id, type_line: 'Creature - Bear', oracle_text: '' } });
const preserver = (controller: string) => ({ id: 'taj', controller, type_line: 'Creature - Elf Shaman', card: { name: 'Tajuru Preserver', type_line: 'Creature - Elf Shaman', oracle_text: TAJURU } });

describe('B39 Bloodthorn Flail alternative equip cost', () => {
  it('parses "Equip\u2014Pay {3} or discard a card" as one alternative-cost ability', () => {
    const abilities = parseEquipAbilitiesFromOracle('Equipped creature gets +2/+1.\nEquip\u2014Pay {3} or discard a card.');
    expect(abilities).toHaveLength(1);
    expect(abilities[0].cost).toBe('{3} or Discard a card');
  });
  it('splits the cost into payable options', () => {
    expect(parseAlternativeCostOptions('{3} or Discard a card')).toEqual(['{3}', 'Discard a card']);
    expect(parseAlternativeCostOptions('Pay 3 life or sacrifice a creature')).toEqual(['Pay 3 life', 'Sacrifice a creature']);
    expect(parseAlternativeCostOptions('{2}')).toBeNull();
  });
});

describe('B39 Tajuru Preserver sacrifice protection', () => {
  it('only protects against opponents', () => {
    const bf = [preserver('p2')];
    expect(playerProtectedFromOpponentSacrifice(bf, 'p2', 'p1')).toBe(true);
    expect(playerProtectedFromOpponentSacrifice(bf, 'p2', 'p2')).toBe(false);
    expect(playerProtectedFromOpponentSacrifice(bf, 'p3', 'p1')).toBe(false);
  });
  it('restores hidden permanents after a step', () => {
    const state = { battlefield: [bear('a', 'p2'), preserver('p2'), bear('b', 'p3')] };
    const out = withSacrificeCauseProtection(state, 'p1', (s) => ({ state: { ...s, battlefield: [] as any[] } }));
    expect(out.state.battlefield.map((p: any) => p.id).sort()).toEqual(['a', 'taj']);
  });
  it('IR "each opponent sacrifices a creature" skips the protected opponent', () => {
    const steps = parseOracleTextToIR('Each opponent sacrifices a creature.', 'B39').abilities.flatMap((a: any) => a.steps || []);
    const state: any = {
      turnNumber: 1,
      players: ['p1', 'p2', 'p3'].map((id) => ({ id, name: id, hand: [], library: [], graveyard: [] })),
      battlefield: [bear('src', 'p1'), bear('p2-bear', 'p2'), preserver('p2'), bear('p3-bear', 'p3')],
    };
    const result = applyOracleIRStepsToGameState(state, steps as any, buildOracleIRExecutionContext({ controllerId: 'p1' as any, sourceId: 'src' }));
    const ids = (result.state.battlefield || []).map((p: any) => p.id);
    expect(ids).toContain('p2-bear');
    expect(ids).toContain('taj');
    expect(ids).not.toContain('p3-bear');
  });
  it('server edict prompt skips a protected player', () => {
    const game: any = { state: { battlefield: [bear('p2-bear', 'p2'), preserver('p2')] } };
    const n = enqueueEdictCreatureSacrificeStep({} as any, game, 'b39-edict', 'p2', { sourceName: 'Edict', sourceControllerId: 'p1' });
    expect(n).toBe(0);
  });
});
