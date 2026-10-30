import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import type { GameState } from '../../shared/src/index.js';

// Quoted from oracle-cards / Possibility Storm (Dragon's Maze).
const POSSIBILITY_STORM_ORACLE =
  'Whenever a player casts a spell from their hand, that player exiles it, then exiles cards from the top of their library until they exile a card that shares a card type with it. That player may cast that card without paying its mana cost. Then they put all cards exiled with this enchantment on the bottom of their library in a random order.';

function makeState(overrides: Record<string, unknown> = {}): GameState {
  return {
    id: 'possibility-storm',
    format: 'commander',
    players: [
      {
        id: 'p1',
        name: 'P1',
        seat: 0,
        life: 40,
        library: [{ id: 'p1c1' }, { id: 'p1c2' }],
        hand: [],
        graveyard: [],
        exile: [],
      } as any,
      {
        id: 'p2',
        name: 'P2',
        seat: 1,
        life: 40,
        library: [
          { id: 'p2c1', type_line: 'Basic Land — Forest' },
          { id: 'p2c2', type_line: 'Creature — Elf' },
          { id: 'p2c3', type_line: 'Instant' },
          { id: 'p2c4', type_line: 'Sorcery' },
        ],
        hand: [],
        graveyard: [],
        exile: [],
      } as any,
    ],
    battlefield: [],
    stack: [
      {
        id: 'stack_bolt',
        type: 'spell',
        controller: 'p2',
        owner: 'p2',
        card: {
          id: 'bolt_1',
          name: 'Lightning Bolt',
          type_line: 'Instant',
        },
      },
    ],
    turnPlayer: 'p1',
    priority: 'p1',
    active: true,
    ...overrides,
  } as GameState;
}

describe('Possibility Storm IR (exile the cast spell, then until sharing a type)', () => {
  it('exiles the triggering spell from the stack and impulse-exiles until a shared card type without a type hint', () => {
    const ir = parseOracleTextToIR(POSSIBILITY_STORM_ORACLE, 'Possibility Storm');
    const steps = ir.abilities[0]?.steps ?? [];

    const result = applyOracleIRStepsToGameState(makeState(), steps, {
      controllerId: 'p1',
      sourceId: 'possibility-storm',
      sourceName: 'Possibility Storm',
      sourceObjectType: 'ability',
      selectorContext: { targetPlayerId: 'p2' as any },
      targetSpellId: 'stack_bolt',
    });

    const p2 = result.state.players.find((p) => p.id === 'p2') as any;
    const stack = ((result.state as any).stack || []) as any[];

    expect(result.appliedSteps.some((s) => s.kind === 'move_zone')).toBe(true);
    expect(result.appliedSteps.some((s) => s.kind === 'impulse_exile_top')).toBe(true);
    expect(result.skippedSteps.some((s) => s.kind === 'move_zone')).toBe(false);
    expect(result.skippedSteps.some((s) => s.kind === 'impulse_exile_top')).toBe(false);
    expect(stack.some((entry) => String(entry?.id || '') === 'stack_bolt')).toBe(false);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c4', 'p2c1', 'p2c2']);
    const bolt = (p2.exile || []).find((c: any) => String(c?.id || '') === 'bolt_1' || String(c?.copiedFromStackItemId || '') === 'stack_bolt');
    const untilHit = (p2.exile || []).find((c: any) => String(c?.id || '') === 'p2c3');
    expect(bolt?.canBePlayedBy).toBeFalsy();
    expect(bolt?.withoutPayingManaCost).toBeFalsy();
    expect(bolt?.castWithoutPayingManaCost).toBeFalsy();
    expect(result.replayMutations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'effectProgramZoneMove',
        fromZone: 'stack',
        toZone: 'exile',
        cardId: 'bolt_1',
        stackItemId: 'stack_bolt',
      }),
    ]));
    expect(untilHit?.canBePlayedBy).toBe('p2');
    expect(untilHit?.withoutPayingManaCost || untilHit?.castWithoutPayingManaCost).toBeTruthy();
  });

  it('exiles that spell from the stack when what-text is "it" and targetSpellId is bound', () => {
    const result = applyOracleIRStepsToGameState(
      makeState(),
      [{
        kind: 'move_zone',
        what: { kind: 'raw', text: 'it' },
        to: 'exile',
        raw: 'that player exiles it',
      } as any],
      {
        controllerId: 'p1',
        sourceId: 'possibility-storm',
        sourceName: 'Possibility Storm',
        sourceObjectType: 'ability',
        targetSpellId: 'stack_bolt',
        selectorContext: { targetPlayerId: 'p2' as any },
      },
    );

    const p2 = result.state.players.find((p) => p.id === 'p2') as any;
    expect(result.appliedSteps.map((s) => s.kind)).toEqual(['move_zone']);
    expect(((result.state as any).stack || []).some((entry: any) => String(entry?.id || '') === 'stack_bolt')).toBe(false);
    expect((p2.exile || []).some((c: any) => String(c?.id || '') === 'bolt_1' || String(c?.id || '') === 'stack_bolt')).toBe(true);
    expect(result.replayMutations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'effectProgramZoneMove',
        fromZone: 'stack',
        toZone: 'exile',
        cardId: 'bolt_1',
        stackItemId: 'stack_bolt',
      }),
    ]));
  });
});
