import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';

function collectStepsFromText(text: string) {
  const ir = parseOracleTextToIR(text, 'Batch241');
  return ir.abilities.flatMap((ability) => ability.steps || []);
}

function baseState(overrides?: Partial<GameState>): GameState {
  const p1 = 'p1' as PlayerID;
  const p2 = 'p2' as PlayerID;
  return {
    turnNumber: 1,
    players: [
      { id: p1, name: 'P1', hand: [], library: [{ id: 'lib-1' }], graveyard: [] },
      { id: p2, name: 'P2', hand: [], library: [{ id: 'lib-p2-1' }], graveyard: [] },
    ],
    battlefield: [
      {
        id: 'src',
        controller: p1,
        type_line: 'Enchantment — Aura',
        card: { type_line: 'Enchantment — Aura' },
      },
      {
        id: 'enchanted',
        controller: p2,
        type_line: 'Creature — Human',
        counters: { sleep: 2 },
        card: { type_line: 'Creature — Human' },
      },
      {
        id: 'ally',
        controller: p1,
        type_line: 'Creature — Beast',
        counters: { '-1/-1': 1 },
        card: { type_line: 'Creature — Beast' },
      },
      {
        id: 'ally2',
        controller: p1,
        type_line: 'Creature — Elf',
        counters: { '-1/-1': 1 },
        card: { type_line: 'Creature — Elf' },
      },
    ],
    stack: [
      {
        id: 'stack-source',
        type: 'spell',
        controller: p1,
        owner: p1,
        card: { id: 'dash-card', name: 'Dash Hopes', type_line: 'Instant', cmc: 2 },
      },
      {
        id: 'stack-target',
        type: 'spell',
        controller: p2,
        owner: p2,
        card: { id: 'bolt-card', name: 'Shock', type_line: 'Instant', cmc: 1 },
      },
    ],
    ...overrides,
  } as GameState;
}

describe('Oracle IR gap batch 241 support', () => {
  it('removes sleep from that creature when counters are present', () => {
    const steps = collectStepsFromText('Remove a sleep counter from that creature.');
    const result = applyOracleIRStepsToGameState(
      baseState(),
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'src',
        targetCreatureId: 'enchanted',
        targetPermanentId: 'enchanted',
      })
    );
    expect(result.automationGaps || []).toHaveLength(0);
    const enchanted = result.state.battlefield?.find((perm: any) => perm.id === 'enchanted');
    expect(enchanted?.counters?.sleep).toBe(1);
  });

  it('removes -1/-1 from another target creature you control', () => {
    const steps = collectStepsFromText('Remove a -1/-1 counter from another target creature you control.');
    const result = applyOracleIRStepsToGameState(
      baseState(),
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'src',
        targetCreatureId: 'ally2',
        targetPermanentId: 'ally2',
      })
    );
    expect(result.automationGaps || []).toHaveLength(0);
    const ally2 = result.state.battlefield?.find((perm: any) => perm.id === 'ally2');
    expect(ally2?.counters?.['-1/-1']).toBeUndefined();
  });

  it('counters this permanent without consuming the target spell', () => {
    const steps = collectStepsFromText(
      'Any player may pay 5 life. If a player does, counter this permanent. Counter target spell.'
    );
    const result = applyOracleIRStepsToGameState(
      baseState(),
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'stack-source',
        sourceName: 'Dash Hopes',
        targetSpellId: 'stack-target',
        selectorContext: { targetSpellId: 'stack-target' },
      }),
      { allowOptional: true }
    );
    expect(result.automationGaps || []).toHaveLength(0);
    expect(result.state.stack?.some((item: any) => item.id === 'stack-source')).toBe(false);
    expect(result.state.stack?.some((item: any) => item.id === 'stack-target')).toBe(false);
  });
});
