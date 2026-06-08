import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser';
import { applyMillStep } from '../../rules-engine/src/oracleIRExecutorPlayerStepHandlers';
import type { GameState, PlayerID } from '../../shared/src';

function makeState(overrides?: Partial<Record<string, unknown>>): GameState {
  return {
    players: [
      { id: 'p1' as PlayerID, name: 'P1', library: ['a', 'b', 'c', 'd', 'e'], graveyard: [] },
      { id: 'p2' as PlayerID, name: 'P2', library: ['f', 'g', 'h', 'i', 'j'], graveyard: [] },
    ],
    battlefield: [
      {
        id: 'fraying',
        name: 'Fraying Sanity',
        controller: 'p1',
        attachedTo: 'p2',
        type_line: 'Enchantment — Aura Curse',
      },
    ],
    stack: [],
    cardsPutIntoYourGraveyardThisTurn: { p2: 3 },
    ...overrides,
  } as GameState;
}

describe('Fraying Sanity pattern mill', () => {
  it('parses upkeep trigger mill IR with enchanted player and whereX', () => {
    const ir = parseOracleTextToIR(
      'At the beginning of each end step, enchanted player mills X cards, where X is the number of cards put into their graveyard from anywhere this turn.',
      'Fraying Sanity'
    );
    const mill = ir.abilities.flatMap(a => a.steps).find(s => s.kind === 'mill');
    expect((mill as any)?.who).toEqual({ kind: 'enchanted_player' });
    expect((mill as any)?.whereX?.raw).toContain('graveyard from anywhere this turn');
  });

  it('applyMillStep mills enchanted player by graveyard count this turn', () => {
    const state = makeState();
    const result = applyMillStep(
      state,
      {
        kind: 'mill',
        who: { kind: 'enchanted_player' },
        amount: { kind: 'x' },
        whereX: {
          kind: 'where',
          raw: 'the number of cards put into their graveyard from anywhere this turn',
        },
        raw: 'enchanted player mills X cards, where X is the number of cards put into their graveyard from anywhere this turn.',
      },
      { controllerId: 'p1' as PlayerID, sourceId: 'fraying' }
    );
    expect(result.applied).toBe(true);
    const p2 = result.state.players.find(p => p.id === 'p2');
    expect(p2?.graveyard?.length).toBe(3);
  });
});
