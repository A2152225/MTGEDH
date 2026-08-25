import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import { tryParseMayRevealHandWinIfOwnNamed } from '../src/oracleIRParserMayRevealHandWinIfOwnNamed';
import {
  applyWinIfOwnNamedInFourZones,
  playerOwnsNamedCardInFourWinZones,
} from '../src/oracleIRExecutorMayRevealHandWinIfOwnNamed';
import type { GameState } from '../../shared/src/index.js';

// Quoted from mtg_data.db cards.text WHERE name = 'Hedron Alignment' AND is_token = 0.
const HEDRON_ALIGNMENT_ORACLE =
  'Hexproof\nAt the beginning of your upkeep, you may reveal your hand. If you do, you win the game if you own a card named Hedron Alignment in exile, in your hand, in your graveyard, and on the battlefield.\n{1}{U}: Scry 1.';

const EFFECT_CLAUSE =
  'you may reveal your hand. If you do, you win the game if you own a card named Hedron Alignment in exile, in your hand, in your graveyard, and on the battlefield';

const identity = <T,>(step: T): T => step;

function collectSteps(text: string, name: string) {
  const ir = parseOracleTextToIR(text, name);
  return (ir.abilities || []).flatMap((ability) => ability.steps || []);
}

function namedCard(id: string, name: string) {
  return { id, name };
}

function makeState(options: {
  readonly sourceName?: string;
  readonly hand?: readonly { id: string; name: string }[];
  readonly graveyard?: readonly { id: string; name: string }[];
  readonly exile?: readonly { id: string; name: string }[];
  readonly battlefieldName?: string;
} = {}): GameState {
  const sourceName = options.sourceName || 'Hedron Alignment';
  const battlefieldName = options.battlefieldName ?? sourceName;
  return {
    id: 'may-reveal-hand-win',
    format: 'commander',
    players: [
      {
        id: 'p1',
        name: 'P1',
        seat: 0,
        life: 40,
        library: [],
        hand: [...(options.hand || [])],
        graveyard: [...(options.graveyard || [])],
        exile: [...(options.exile || [])],
      },
      { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [] },
    ],
    battlefield: [{
      id: 'bf_1',
      controller: 'p1',
      owner: 'p1',
      card: { id: 'bf_1', name: battlefieldName, type_line: 'Enchantment' },
    }],
    stack: [],
    turnPlayer: 'p1',
    priority: 'p1',
    active: true,
  } as unknown as GameState;
}

describe('may-reveal-hand then win if own named in four zones', () => {
  it('parses the dedicated all-or-nothing step from the Hedron clause', () => {
    const step = tryParseMayRevealHandWinIfOwnNamed({
      clause: EFFECT_CLAUSE,
      rawClause: EFFECT_CLAUSE,
      withMeta: identity,
    });
    expect(step).toMatchObject({
      kind: 'may_reveal_hand_then_win_if_own_named_in_zones',
      zones: ['exile', 'hand', 'graveyard', 'battlefield'],
    });
  });

  it('emits the dedicated step from full Hedron Alignment oracle, not auto-win', () => {
    const steps = collectSteps(HEDRON_ALIGNMENT_ORACLE, 'Hedron Alignment');
    expect(steps.some((step) => step.kind === 'may_reveal_hand_then_win_if_own_named_in_zones')).toBe(true);
    expect(steps.some((step) => step.kind === 'win_game')).toBe(false);
  });

  it('executor apply returns player_choice_required and does not stamp a winner', () => {
    const steps = collectSteps(HEDRON_ALIGNMENT_ORACLE, 'Custom Alignment')
      .filter((step) => step.kind === 'may_reveal_hand_then_win_if_own_named_in_zones');
    const state = makeState({
      sourceName: 'Custom Alignment',
      hand: [namedCard('h1', 'Custom Alignment')],
      graveyard: [namedCard('g1', 'Custom Alignment')],
      exile: [namedCard('e1', 'Custom Alignment')],
    });
    const result = applyOracleIRStepsToGameState(
      state,
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1',
        sourceId: 'bf_1',
        sourceName: 'Custom Alignment',
        sourceObjectType: 'ability',
      }),
    );
    expect(result.skippedSteps.some((step) => step.kind === 'may_reveal_hand_then_win_if_own_named_in_zones')).toBe(true);
    expect(result.automationGaps.some((gap) => gap.reasonCode === 'player_choice_required')).toBe(true);
    expect((result.state as { winner?: string }).winner).toBeUndefined();
  });

  it('reveal with four owned same-name copies is eligible to win', () => {
    const state = makeState({
      sourceName: 'Custom Alignment',
      hand: [namedCard('h1', 'Custom Alignment')],
      graveyard: [namedCard('g1', 'Custom Alignment')],
      exile: [namedCard('e1', 'Custom Alignment')],
    });
    expect(playerOwnsNamedCardInFourWinZones(state, 'p1', 'Custom Alignment')).toBe(true);
    const next = applyWinIfOwnNamedInFourZones(state, 'p1', 'Custom Alignment', 'You win the game');
    expect(next.winner).toBe('p1');
    expect(next.status).toBe('finished');
    expect(String((next as { winReason?: string }).winReason || '')).toContain('win');
  });

  it('Custom Alignment source plus Hedron Alignment zone copies does not win', () => {
    const state = makeState({
      sourceName: 'Custom Alignment',
      hand: [namedCard('h1', 'Hedron Alignment')],
      graveyard: [namedCard('g1', 'Hedron Alignment')],
      exile: [namedCard('e1', 'Hedron Alignment')],
      battlefieldName: 'Hedron Alignment',
    });
    expect(playerOwnsNamedCardInFourWinZones(state, 'p1', 'Custom Alignment')).toBe(false);
    const next = applyWinIfOwnNamedInFourZones(state, 'p1', 'Custom Alignment', 'You win the game');
    expect(next.winner).toBeUndefined();
    expect(next.status).not.toBe('finished');
  });

  it('missing graveyard copy does not win after reveal eligibility check', () => {
    const state = makeState({
      sourceName: 'Hedron Alignment',
      hand: [namedCard('h1', 'Hedron Alignment')],
      graveyard: [],
      exile: [namedCard('e1', 'Hedron Alignment')],
    });
    expect(playerOwnsNamedCardInFourWinZones(state, 'p1', 'Hedron Alignment')).toBe(false);
    const next = applyWinIfOwnNamedInFourZones(state, 'p1', 'Hedron Alignment', 'You win the game');
    expect(next.winner).toBeUndefined();
  });
});
