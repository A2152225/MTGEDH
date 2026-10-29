import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';

// Temple Altisaur: "If a source would deal damage to another Dinosaur you control,
// prevent all but 1 of that damage." Mass damage must use that cap, not only
// registered damagePreventionEffects.
const TEMPLE_ALTISAUR_ORACLE = 'If a source would deal damage to another Dinosaur you control, prevent all but 1 of that damage.';

const p1 = 'p1' as PlayerID;
const p2 = 'p2' as PlayerID;

function creature(id: string, controller: PlayerID, name: string, typeLine: string, oracle = '', toughness = '4') {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    counters: {},
    damageMarked: 0,
    card: {
      id: `${id}_c`,
      name,
      type_line: typeLine,
      oracle_text: oracle,
      power: '4',
      toughness,
    },
  };
}

function markedDamage(state: any, id: string): number {
  const perm = (state.battlefield || []).find((entry: any) => entry.id === id);
  return Number(perm?.damageMarked ?? perm?.markedDamage ?? perm?.counters?.damage ?? 0);
}

describe('prevent all but N on Oracle IR mass damage', () => {
  it('caps damage to another Dinosaur you control and leaves the shield and other creatures at full damage', () => {
    const text = 'Reckless Blaze deals 5 damage to each creature.';
    const ir = parseOracleTextToIR(text, 'Reckless Blaze');
    const steps = ir.abilities.flatMap((ability: any) => ability.steps || []).filter((step: any) => step.kind === 'deal_damage');
    expect(steps.length).toBeGreaterThan(0);

    const state = {
      players: [
        { id: p1, life: 40, library: [], hand: [], graveyard: [], exile: [] },
        { id: p2, life: 40, library: [], hand: [], graveyard: [], exile: [] },
      ],
      battlefield: [
        creature('temple', p1, 'Temple Altisaur', 'Creature — Dinosaur', TEMPLE_ALTISAUR_ORACLE),
        creature('other-dino', p1, 'Ripjaw Raptor', 'Creature — Dinosaur'),
        creature('bear', p1, 'Grizzly Bears', 'Creature — Bear'),
        creature('their-dino', p2, 'Raging Regisaur', 'Creature — Dinosaur'),
      ],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, steps as any, {
      controllerId: p2,
      sourceId: 'blaze',
      sourceName: 'Reckless Blaze',
    } as any);

    expect(markedDamage(result.state, 'other-dino')).toBe(1);
    expect(markedDamage(result.state, 'temple')).toBe(5);
    expect(markedDamage(result.state, 'bear')).toBe(5);
    expect(markedDamage(result.state, 'their-dino')).toBe(5);
  });
});
