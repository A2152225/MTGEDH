import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import type { GameState } from '../../shared/src/index.js';
import { WIN_IF_CAST_SAME_NAME_CONDITION_RAW } from '../src/oracleIRParserWinIfCastSameNameThisGame';

// Quoted from mtg_data.db cards.text WHERE name = 'Approach of the Second Sun' AND is_token = 0.
const APPROACH_ORACLE =
  "If this spell was cast from your hand and you've cast another spell named Approach of the Second Sun this game, you win the game. Otherwise, put Approach of the Second Sun into its owner's library seventh from the top and you gain 7 life.";

function collectSpellSteps(text: string, name: string) {
  const ir = parseOracleTextToIR(text, name);
  return (ir.abilities || []).flatMap((ability) => ability.steps || []);
}

function findSameNameWin(steps: readonly { kind?: string }[]) {
  return steps.find((step) => step.kind === 'conditional') as {
    condition?: { raw?: string };
    steps?: Array<{ kind: string }>;
    elseSteps?: Array<{ kind: string; to?: string; amount?: { value?: number } }>;
  } | undefined;
}

function makeLibrary(count = 10) {
  return Array.from({ length: count }, (_, i) => ({
    id: `lib_${i}`,
    name: `Filler ${i}`,
  }));
}

function makeState(overrides: Record<string, unknown> = {}): GameState {
  const library = makeLibrary();
  return {
    id: 'win-if-cast-same-name',
    format: 'commander',
    players: [
      { id: 'p1', name: 'P1', seat: 0, life: 40, library, hand: [], graveyard: [] },
      { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [] },
    ],
    battlefield: [],
    stack: [{
      id: 'spell_1',
      name: 'Custom Second Dawn',
      controller: 'p1',
      owner: 'p1',
      card: { id: 'spell_1', name: 'Custom Second Dawn', type_line: 'Sorcery' },
    }],
    turnPlayer: 'p1',
    priority: 'p1',
    active: true,
    ...overrides,
  } as unknown as GameState;
}

function applySameNameWin(
  text: string,
  sourceName: string,
  options: {
    readonly castFromZone?: string;
    readonly namedSpellsCastThisGame?: unknown;
  } = {},
) {
  const steps = collectSpellSteps(text, sourceName).filter(
    (step) => step.kind === 'conditional' || step.kind === 'win_game',
  );
  return applyOracleIRStepsToGameState(
    makeState({
      ...(options.namedSpellsCastThisGame !== undefined
        ? { namedSpellsCastThisGame: options.namedSpellsCastThisGame }
        : {}),
    }),
    steps,
    buildOracleIRExecutionContext({
      controllerId: 'p1',
      sourceId: 'spell_1',
      sourceName,
      sourceObjectType: 'spell',
      ...(options.castFromZone ? { castFromZone: options.castFromZone } : {}),
    }),
  );
}

describe('win if you cast another spell with the same name this game', () => {
  it('parses Approach of the Second Sun as conditional win_game with otherwise library + life', () => {
    const steps = collectSpellSteps(APPROACH_ORACLE, 'Approach of the Second Sun');
    const winIf = findSameNameWin(steps);
    expect(winIf).toBeTruthy();
    expect(String(winIf?.condition?.raw || '').toLowerCase()).toBe(WIN_IF_CAST_SAME_NAME_CONDITION_RAW);
    expect((winIf?.steps || []).map((step) => step.kind)).toEqual(['win_game']);
    expect((winIf?.elseSteps || []).map((step) => step.kind)).toEqual(['move_zone', 'gain_life']);
    expect(winIf?.elseSteps?.[0]?.to).toBe('library');
    expect(winIf?.elseSteps?.[1]?.amount?.value).toBe(7);
    expect(steps.some((step) => step.kind === 'unknown')).toBe(false);
  });

  it('uses this card\'s name, not the printed Approach string, on a renamed spell', () => {
    const steps = collectSpellSteps(APPROACH_ORACLE, 'Custom Second Dawn');
    const winIf = findSameNameWin(steps);
    expect(String(winIf?.condition?.raw || '').toLowerCase()).toBe(WIN_IF_CAST_SAME_NAME_CONDITION_RAW);
    expect(String(winIf?.condition?.raw || '')).not.toMatch(/approach of the second sun/i);
    expect((winIf?.elseSteps || []).map((step) => step.kind)).toEqual(['move_zone', 'gain_life']);
  });

  it('wins when cast from hand after another same-name spell this game', () => {
    const result = applySameNameWin(APPROACH_ORACLE, 'Custom Second Dawn', {
      castFromZone: 'hand',
      namedSpellsCastThisGame: { p1: ['Custom Second Dawn'] },
    });
    expect(result.appliedSteps.map((step) => step.kind)).toEqual(['win_game']);
    expect((result.state as any).winner).toBe('p1');
    expect((result.state as any).status).toBe('finished');
  });

  it('takes the otherwise path on the first hand-cast with no prior same-name spell', () => {
    const result = applySameNameWin(APPROACH_ORACLE, 'Custom Second Dawn', {
      castFromZone: 'hand',
      namedSpellsCastThisGame: { p1: [] },
    });
    expect(result.appliedSteps.map((step) => step.kind)).toContain('gain_life');
    expect(result.appliedSteps.map((step) => step.kind)).toContain('move_zone');
    expect(result.appliedSteps.map((step) => step.kind)).not.toContain('win_game');
    expect((result.state as any).winner).toBeUndefined();
    expect((result.state as any).status).not.toBe('finished');
    expect((result.state as any).life?.p1 ?? 40).toBe(47);
    const library = (result.state as any).players?.[0]?.library || [];
    expect(library[6]?.id).toBe('spell_1');
    expect(String(library[6]?.name || '')).toBe('Custom Second Dawn');
    expect(((result.state as any).stack || []).some((entry: any) => String(entry?.id || '') === 'spell_1')).toBe(false);
  });

  it('takes the otherwise path when the spell was not cast from hand', () => {
    const result = applySameNameWin(APPROACH_ORACLE, 'Custom Second Dawn', {
      castFromZone: 'graveyard',
      namedSpellsCastThisGame: { p1: ['Custom Second Dawn'] },
    });
    expect(result.appliedSteps.map((step) => step.kind)).toContain('gain_life');
    expect(result.appliedSteps.map((step) => step.kind)).not.toContain('win_game');
    expect((result.state as any).winner).toBeUndefined();
    const library = (result.state as any).players?.[0]?.library || [];
    expect(library[6]?.id).toBe('spell_1');
    expect(((result.state as any).stack || []).some((entry: any) => String(entry?.id || '') === 'spell_1')).toBe(false);
  });

  it.each(['this card', 'this spell', 'it'] as const)(
    'puts %s from the stack seventh from the top without a card-name check',
    (whatText) => {
      const library = makeLibrary();
      const result = applyOracleIRStepsToGameState(
        makeState({
          players: [
            { id: 'p1', name: 'P1', seat: 0, life: 40, library, hand: [], graveyard: [] },
            { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [] },
          ],
        }),
        [{
          kind: 'move_zone',
          what: { kind: 'raw', text: whatText },
          to: 'library',
          toRaw: "its owner's library seventh from the top",
          raw: `put ${whatText} into its owner's library seventh from the top`,
        } as any],
        buildOracleIRExecutionContext({
          controllerId: 'p1',
          sourceId: 'spell_1',
          sourceName: 'Custom Second Dawn',
          sourceObjectType: 'spell',
        }),
      );
      const nextLibrary = (result.state as any).players?.[0]?.library || [];
      expect(result.appliedSteps.map((step) => step.kind)).toEqual(['move_zone']);
      expect(nextLibrary[6]?.id).toBe('spell_1');
      expect(((result.state as any).stack || []).some((entry: any) => String(entry?.id || '') === 'spell_1')).toBe(false);
    },
  );

  it('inserts at min(6, length) when the owner library is shorter than seven', () => {
    const library = makeLibrary(3);
    const result = applyOracleIRStepsToGameState(
      makeState({
        players: [
          { id: 'p1', name: 'P1', seat: 0, life: 40, library, hand: [], graveyard: [] },
          { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [] },
        ],
      }),
      [{
        kind: 'move_zone',
        what: { kind: 'raw', text: 'this card' },
        to: 'library',
        toRaw: "its owner's library seventh from the top",
        raw: "put this card into its owner's library seventh from the top",
      } as any],
      buildOracleIRExecutionContext({
        controllerId: 'p1',
        sourceId: 'spell_1',
        sourceName: 'Custom Second Dawn',
        sourceObjectType: 'spell',
      }),
    );
    const nextLibrary = (result.state as any).players?.[0]?.library || [];
    expect(nextLibrary.length).toBe(4);
    expect(nextLibrary[Math.min(6, 3)]?.id).toBe('spell_1');
    expect(((result.state as any).stack || []).some((entry: any) => String(entry?.id || '') === 'spell_1')).toBe(false);
  });

  it('does not win when the prior spell has a different name', () => {
    const result = applySameNameWin(APPROACH_ORACLE, 'Custom Second Dawn', {
      castFromZone: 'hand',
      namedSpellsCastThisGame: { p1: ['Approach of the Second Sun'] },
    });
    expect((result.state as any).winner).toBeUndefined();
    expect(result.appliedSteps.map((step) => step.kind)).toContain('gain_life');
    expect(result.appliedSteps.map((step) => step.kind)).not.toContain('win_game');
  });
});
