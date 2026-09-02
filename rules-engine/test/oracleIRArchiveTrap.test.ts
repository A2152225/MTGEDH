import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser.js';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor.js';
import type { GameState, PlayerID } from '../../shared/src/index.js';

// Oracle from mtg_data.db (is_token = 0):
const ARCHIVE_TRAP_ORACLE =
  "If an opponent searched their library this turn, you may pay {0} rather than pay this spell's mana cost.\nTarget opponent mills thirteen cards.";

function collectSpellSteps(oracleText: string, sourceName: string) {
  return parseOracleTextToIR(oracleText, sourceName)
    .abilities
    .filter((ability) => String(ability.type || '').toLowerCase() === 'spell')
    .flatMap((ability) => ability.steps || []);
}

describe('Archive Trap mill thirteen', () => {
  it('parses mill thirteen as a spell step and keeps the trap cost static', () => {
    const ir = parseOracleTextToIR(ARCHIVE_TRAP_ORACLE, 'Archive Trap');
    const spellSteps = collectSpellSteps(ARCHIVE_TRAP_ORACLE, 'Archive Trap');
    expect(ir.abilities.flatMap((ability) => ability.steps || []).every((step) => step.kind !== 'unknown')).toBe(true);
    expect(spellSteps).toEqual([
      expect.objectContaining({
        kind: 'mill',
        who: { kind: 'target_opponent' },
        amount: { kind: 'number', value: 13 },
      }),
    ]);
    expect(spellSteps.every((step) => !/rather than pay this spell/i.test(String((step as any).raw || '')))).toBe(true);
  });

  it('mills thirteen from the targeted opponent, including when another opponent exists', () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;
    const makeLibrary = (prefix: string, count: number) =>
      Array.from({ length: count }, (_, i) => ({
        id: `${prefix}_${i}`,
        name: `${prefix} ${i}`,
        type_line: 'Instant',
        zone: 'library',
      }));

    const state = {
      players: [
        { id: p1, life: 40, hand: [], library: [], graveyard: [], exile: [] },
        { id: p2, life: 40, hand: [], library: makeLibrary('p2', 15), graveyard: [], exile: [] },
        { id: p3, life: 40, hand: [], library: makeLibrary('p3', 15), graveyard: [], exile: [] },
      ],
      stack: [],
      battlefield: [],
    } as unknown as GameState;

    const steps = collectSpellSteps(ARCHIVE_TRAP_ORACLE, 'Archive Trap');
    const ctx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceName: 'Archive Trap',
      sourceId: 'archive_1',
      targetPlayerId: p3,
      selectorContext: { targetPlayerId: p3, targetOpponentId: p3, chosenObjectIds: [p3] },
    } as any);

    const result = applyOracleIRStepsToGameState(state, steps as any, ctx);
    expect(result.appliedSteps.some((step) => step.kind === 'mill')).toBe(true);
    const p2Player = result.state.players.find((player: any) => player.id === p2) as any;
    const p3Player = result.state.players.find((player: any) => player.id === p3) as any;
    expect(p3Player.graveyard.map((card: any) => card.id)).toHaveLength(13);
    expect(p3Player.library).toHaveLength(2);
    expect(p2Player.graveyard).toHaveLength(0);
    expect(p2Player.library).toHaveLength(15);
  });
});
