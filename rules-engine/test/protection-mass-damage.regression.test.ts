import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { parseProtectionQualities } from '../src/oracleIRDamageProtection';

// G2.txt (game_mv4dicck, 22:32Z): Pyrohemia's "{R}: deals 1 damage to each creature and each
// player" killed Auriok Champion (protection from black and from red). Protection must prevent
// damage from sources of that quality on every Oracle IR damage path (rule 702.16e).
const p1 = 'p1' as PlayerID;
const p2 = 'p2' as PlayerID;

function creature(id: string, controller: PlayerID, name: string, oracle = '', extra: any = {}) {
  return {
    id, controller, owner: controller, tapped: false, counters: {}, damageMarked: 0, ...extra,
    card: { id: `${id}_c`, name, type_line: 'Creature - Human Cleric', oracle_text: oracle, power: '1', toughness: '1', colors: ['W'] },
  };
}

function baseState(extraBattlefield: any[] = []): GameState {
  return {
    players: [
      { id: p1, life: 20, library: [], hand: [], graveyard: [], exile: [] },
      { id: p2, life: 20, library: [], hand: [], graveyard: [], exile: [] },
    ],
    battlefield: [
      { id: 'pyro', controller: p2, owner: p2, tapped: false, counters: {}, card: { id: 'pyro_c', name: 'Pyrohemia', type_line: 'Enchantment', mana_cost: '{2}{R}{R}', colors: ['R'], oracle_text: 'At the beginning of the end step, if no creatures are on the battlefield, sacrifice Pyrohemia.\n{R}: Pyrohemia deals 1 damage to each creature and each player.' } },
      creature('auriok', p1, 'Auriok Champion', 'Protection from black and from red\nWhenever another creature enters, you may gain 1 life.'),
      creature('bear', p1, 'Grizzly Bears'),
      ...extraBattlefield,
    ],
  } as any;
}

function damageSteps(text: string, name: string) {
  const ir = parseOracleTextToIR(text, name);
  return ir.abilities.flatMap((a: any) => a.steps || []).filter((s: any) => s.kind === 'deal_damage');
}

function markedDamage(state: any, id: string): number {
  const perm = (state.battlefield || []).find((p: any) => p.id === id);
  return Number(perm?.damageMarked ?? perm?.markedDamage ?? 0);
}

describe('protection prevents Oracle IR mass damage', () => {
  it('parses compound protection lists', () => {
    expect(parseProtectionQualities('Protection from black and from red')).toEqual(['B', 'R']);
    expect(parseProtectionQualities('protection from white, from blue, and from black')).toEqual(['W', 'U', 'B']);
    expect(parseProtectionQualities('Protection from creatures')).toEqual(['type:creature']);
    expect(parseProtectionQualities('Protection from everything')).toEqual(['everything']);
  });

  it('Pyrohemia activation spares a creature with protection from red, still hits others and players', () => {
    const steps = damageSteps('{R}: Pyrohemia deals 1 damage to each creature and each player.', 'Pyrohemia');
    expect(steps.length).toBeGreaterThan(0);
    const result = applyOracleIRStepsToGameState(baseState(), steps as any, { controllerId: p2, sourceId: 'pyro', sourceName: 'Pyrohemia' } as any);
    const next: any = result.state;
    expect(markedDamage(next, 'auriok')).toBe(0);
    expect(markedDamage(next, 'bear')).toBe(1);
    expect(next.players.find((p: any) => p.id === p1).life).toBe(19);
  });

  it('equipment-granted protection (Sword-style) prevents damage from that colour', () => {
    const sword = { id: 'sword', controller: p1, owner: p1, attachedTo: 'bear', counters: {}, card: { id: 'sword_c', name: 'Sword of Fire and Ice', type_line: 'Artifact - Equipment', oracle_text: 'Equipped creature gets +2/+2 and has protection from red and from blue.' } };
    const steps = damageSteps('{R}: Pyrohemia deals 1 damage to each creature and each player.', 'Pyrohemia');
    const result = applyOracleIRStepsToGameState(baseState([sword]), steps as any, { controllerId: p2, sourceId: 'pyro' } as any);
    expect(markedDamage(result.state, 'bear')).toBe(0);
  });

  it('protection from a different colour does not prevent the damage', () => {
    const knight = creature('knight', p1, 'White Knight', 'First strike, protection from black');
    const steps = damageSteps('{R}: Pyrohemia deals 1 damage to each creature and each player.', 'Pyrohemia');
    const result = applyOracleIRStepsToGameState(baseState([knight]), steps as any, { controllerId: p2, sourceId: 'pyro' } as any);
    expect(markedDamage(result.state, 'knight')).toBe(1);
  });
});
