import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';

function collectStepsFromText(text: string) {
  const ir = parseOracleTextToIR(text, 'Batch235');
  return ir.abilities.flatMap((ability) => ability.steps || []);
}

function baseState(overrides?: Partial<GameState>): GameState {
  const p1 = 'p1' as PlayerID;
  const p2 = 'p2' as PlayerID;
  return {
    turnNumber: 1,
    players: [
      {
        id: p1,
        name: 'P1',
        hand: [{ id: 'h1', card: { type_line: 'Basic Land — Forest' } }],
        library: [{ id: 'lib1', card: { type_line: 'Creature' } }],
        graveyard: [{ id: 'gy1', card: { type_line: 'Creature' } }],
        exile: [{ id: 'ex1', card: { type_line: 'Creature' }, exiledBy: 'src' }],
      },
      {
        id: p2,
        name: 'P2',
        hand: [{ id: 'oh1', card: { type_line: 'Instant' } }],
        graveyard: [{ id: 'ogy1', card: { type_line: 'Creature' } }],
      },
    ],
    battlefield: [
      { id: 'src', controller: p1, card: { type_line: 'Creature' } },
      { id: 'opp-c', controller: p2, card: { type_line: 'Creature' }, isToken: false },
    ],
    ...overrides,
  } as GameState;
}

describe('Oracle IR gap batch 235 support', () => {
  it('returns all cards exiled with source to battlefield under owners', () => {
    const steps = collectStepsFromText(
      'return all cards exiled with it to the battlefield under their owners\' control.'
    );
    const result = applyOracleIRStepsToGameState(
      baseState(),
      steps,
      buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID, sourceId: 'src' })
    );
    expect(result.automationGaps.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
  });

  it('puts all cards exiled with this enchantment into graveyard', () => {
    const steps = collectStepsFromText(
      'put all cards exiled with this enchantment into their owner\'s graveyard.'
    );
    const result = applyOracleIRStepsToGameState(
      baseState(),
      steps,
      buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID, sourceId: 'src' })
    );
    expect(result.automationGaps.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const p1 = result.state.players.find((player) => player.id === 'p1') as any;
    expect(p1.graveyard?.some((card: any) => card.id === 'ex1')).toBe(true);
  });

  it('puts creature from among those cards using sacrificed creature MV plus one', () => {
    const state = baseState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          library: [{ id: 'top1', card: { type_line: 'Creature', cmc: 2 } }],
        },
      ],
    } as Partial<GameState>);
    const steps = collectStepsFromText(
      'you may put a creature card with mana value X or less from among those cards onto the battlefield, where X is 1 plus the sacrificed creature\'s mana value.'
    );
    const result = applyOracleIRStepsToGameState(
      state,
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'src',
        lastSacrificedPermanents: [{ type_line: 'Creature', cmc: 3 }],
        selectorContext: { chosenObjectIds: ['top1'] },
      } as any),
      { allowOptional: true }
    );
    expect(result.automationGaps.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
  });

  it('puts up to X lands from hand where X is sacrificed creature power', () => {
    const steps = collectStepsFromText(
      'then put up to X land cards from your hand onto the battlefield tapped, where X is the sacrificed creature\'s power.'
    );
    const result = applyOracleIRStepsToGameState(
      baseState(),
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        lastSacrificedPermanents: [{ type_line: 'Creature', power: 1 }],
      } as any)
    );
    expect(result.automationGaps.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
  });

  it('returns the chosen card from your graveyard to the battlefield', () => {
    const steps = collectStepsFromText(
      'Return the chosen card from your graveyard to the battlefield.'
    );
    const result = applyOracleIRStepsToGameState(
      baseState(),
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        selectorContext: { chosenObjectIds: ['gy1'] },
      })
    );
    expect(result.automationGaps.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
  });

  it('exiles target opponent graveyard card with stash counter', () => {
    const steps = collectStepsFromText('exile it from their graveyard with a stash counter on it.');
    const result = applyOracleIRStepsToGameState(
      baseState(),
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        targetCreatureId: 'ogy1',
        selectorContext: { targetOpponentId: 'p2' as PlayerID, chosenObjectIds: ['ogy1'] },
      })
    );
    expect(result.automationGaps.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const p2 = result.state.players.find((player) => player.id === 'p2') as any;
    expect(p2.exile?.some((card: any) => card.id === 'ogy1' && card.counters?.stash === 1)).toBe(true);
  });

  it('returns mechtitan vehicle exiled cards except self tapped', () => {
    const state = baseState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          exile: [
            { id: 'src', card: { type_line: 'Artifact — Vehicle' }, exiledBy: 'veh' },
            { id: 'ex2', card: { type_line: 'Creature' }, exiledBy: 'veh' },
          ],
        },
        { id: 'p2', name: 'P2' },
      ],
      battlefield: [{ id: 'veh', controller: 'p1', card: { type_line: 'Artifact — Vehicle' } }],
    } as Partial<GameState>);
    const steps = collectStepsFromText(
      'return all cards exiled with this vehicle except this card to the battlefield tapped under their owners\' control.'
    );
    const result = applyOracleIRStepsToGameState(
      state,
      steps,
      buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID, sourceId: 'veh' })
    );
    expect(result.automationGaps.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
  });

  it('skips Katara discard when waterbend additional cost was paid', () => {
    const steps = collectStepsFromText(
      'draw a card, then discard a card unless her additional cost was paid.'
    );
    const result = applyOracleIRStepsToGameState(
      baseState(),
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        waterbendWasPaid: true,
      })
    );
    expect(result.automationGaps.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
    expect(result.log.some((line) => /skipped discard/i.test(line))).toBe(true);
  });

  it('discards for Katara when additional cost was not paid', () => {
    const steps = collectStepsFromText(
      'draw a card, then discard a card unless her additional cost was paid.'
    );
    const result = applyOracleIRStepsToGameState(
      baseState({ players: [{ id: 'p1', name: 'P1', hand: [{ id: 'h1', card: { type_line: 'Instant' } }, { id: 'h2', card: { type_line: 'Instant' } }] }, { id: 'p2', name: 'P2' }] } as Partial<GameState>),
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        waterbendWasPaid: false,
      })
    );
    expect(result.automationGaps.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
    expect(result.log.some((line) => /discard/i.test(line))).toBe(true);
  });

  it('skips Oblivious Bookworm discard when manifest activity occurred', () => {
    const steps = collectStepsFromText(
      'discard a card unless a permanent entered the battlefield face down under your control this turn or you turned a permanent face up this turn.'
    );
    const result = applyOracleIRStepsToGameState(
      baseState(),
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        turnedPermanentFaceUpThisTurn: true,
      })
    );
    expect(result.automationGaps.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
    expect(result.state.players[0]?.hand?.length).toBe(1);
  });

  it('runs Doom Foretold fallback when active player cannot sacrifice', () => {
    const state = baseState({
      battlefield: [{ id: 'land1', controller: 'p2', card: { type_line: 'Basic Land — Island' } }],
      players: [
        { id: 'p1', name: 'P1', hand: [{ id: 'h1', card: { type_line: 'Instant' } }] },
        { id: 'p2', name: 'P2', hand: [{ id: 'oh1', card: { type_line: 'Instant' } }] },
      ],
    } as Partial<GameState>);
    const steps = collectStepsFromText(
      'If that player can\'t, they discard a card, they lose 2 life, you draw a card, you gain 2 life, you create a 2/2 white Knight creature token with vigilance, then you sacrifice this enchantment.'
    );
    const result = applyOracleIRStepsToGameState(
      state,
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'src',
        selectorContext: { activePlayerId: 'p2' as PlayerID, targetPlayerId: 'p2' as PlayerID },
      })
    );
    expect(result.automationGaps.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });
});
