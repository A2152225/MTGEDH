import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';

const controllerId = 'p1' as PlayerID;

function expectNoUnsupportedSelectorGaps(steps: any[], state: GameState, ctx: Record<string, unknown>) {
  const result = applyOracleIRStepsToGameState(state, steps, ctx as any, { allowOptional: true });
  expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
  return result;
}

describe('Oracle IR gap batch 381 — move_zone selector clusters (Track E1)', () => {
  it('executes Lotus Vale replacement put-this-land branch after sacrifice antecedent', () => {
    const ir = parseOracleTextToIR(
      "If this land would enter, sacrifice two untapped lands instead. If you do, put this land onto the battlefield. If you don't, put it into its owner's graveyard.",
      'Lotus Vale'
    );
    const step = ir.abilities[0].steps?.[1];
    expect(step?.kind).toBe('conditional');
    expectNoUnsupportedSelectorGaps(
      [step!],
      {
        players: [{ id: controllerId, graveyard: [] }],
        battlefield: [
          { id: 'bf-source', controller: controllerId, type_line: 'Land', tapped: false },
          { id: 'bf-land-1', controller: controllerId, type_line: 'Land', tapped: false },
          { id: 'bf-land-2', controller: controllerId, type_line: 'Land', tapped: false },
        ],
      } as GameState,
      {
        controllerId,
        sourceId: 'bf-source',
        sourceName: 'Lotus Vale',
        lastActionOutcome: { kind: 'applied', stepKind: 'sacrifice' },
      }
    );
  });

  it('executes Leonardo exile-it-from-graveyard and See the Truth each-of-those-cards branches', () => {
    const leonardo = parseOracleTextToIR(
      "{2}{U}, {T}: Draw a card, then discard a card. If the discarded card was an artifact card, exile it from your graveyard. If you do, create a token that's a copy of it, except it's a 0/2 Thopter artifact creature with flying in addition to its other types.",
      'Leonardo da Vinci'
    );
    const exileStep = leonardo.abilities
      .flatMap((ability) => ability.steps || [])
      .find((step) => step.kind === 'conditional' && /exile it from your graveyard/i.test(String(step.raw || '')));
    expect(exileStep).toBeTruthy();
    expectNoUnsupportedSelectorGaps(
      [exileStep!],
      {
        players: [
          {
            id: controllerId,
            graveyard: [{ id: 'disc-artifact-1', type_line: 'Artifact', name: 'Discarded Artifact' }],
          },
        ],
        battlefield: [{ id: 'bf-source', controller: controllerId, type_line: 'Artifact Creature — Construct' }],
      } as GameState,
      {
        controllerId,
        sourceId: 'bf-source',
        lastDiscardedCards: [{ id: 'disc-artifact-1', type_line: 'Artifact' }],
      }
    );

    const seeTheTruth = parseOracleTextToIR(
      'Look at the top three cards of your library. Put one of those cards into your hand and the rest on the bottom of your library in any order. If this spell was cast from anywhere other than your hand, put each of those cards into your hand instead.',
      'See the Truth'
    );
    const libraryCards = [
      { id: 'lib-1', type_line: 'Instant' },
      { id: 'lib-2', type_line: 'Sorcery' },
      { id: 'lib-3', type_line: 'Creature — Elf' },
    ];
    const insteadStep = seeTheTruth.abilities
      .flatMap((ability) => ability.steps || [])
      .find((step) => step.kind === 'conditional' && /put each of those cards into your hand instead/i.test(String(step.raw || '')));
    expect(insteadStep).toBeTruthy();
    expect(insteadStep?.kind).toBe('conditional');
    expectNoUnsupportedSelectorGaps(
      [insteadStep!],
      {
        players: [{ id: controllerId, library: libraryCards, hand: [] }],
        battlefield: [],
      } as GameState,
      {
        controllerId,
        sourceId: 'bf-source',
        castFromZone: 'graveyard',
        lastMovedCards: libraryCards,
      }
    );
  });

  it('executes Glitch Interpreter return-and-manifest, Nefarious Lich damage replacement, and Desertion counter replacement', () => {
    const glitch = parseOracleTextToIR(
      "When this creature enters, if you control no face-down permanents, return this creature to its owner's hand and manifest dread.",
      'Glitch Interpreter'
    );
    const glitchSteps = glitch.abilities[0].steps || [];
    const glitchResult = expectNoUnsupportedSelectorGaps(
      glitchSteps,
      {
        players: [{ id: controllerId, hand: [], library: [{ id: 'lib-dread-1' }, { id: 'lib-dread-2' }] }],
        battlefield: [{ id: 'bf-source', controller: controllerId, type_line: 'Artifact Creature — Construct' }],
      } as GameState,
      { controllerId, sourceId: 'bf-source' }
    );
    expect(glitchResult.automationGaps?.some((gap) => gap.stepKind === 'manifest_dread')).toBe(false);

    const lich = parseOracleTextToIR(
      "If damage would be dealt to you, exile that many cards from your graveyard instead. If you can't, you lose the game.",
      'Nefarious Lich'
    );
    expectNoUnsupportedSelectorGaps(
      lich.abilities[0].steps?.slice(0, 1) || [],
      {
        players: [
          {
            id: controllerId,
            graveyard: [
              { id: 'gy-1', type_line: 'Instant' },
              { id: 'gy-2', type_line: 'Creature — Zombie' },
              { id: 'gy-3', type_line: 'Sorcery' },
            ],
          },
        ],
        battlefield: [{ id: 'bf-source', controller: controllerId, type_line: 'Enchantment' }],
      } as GameState,
      { controllerId, sourceId: 'bf-source', referenceAmount: 2, damageWouldBeDealtToYou: true }
    );

    const desertion = parseOracleTextToIR(
      "Counter target spell. If an artifact or creature spell is countered this way, put that card onto the battlefield under your control instead of into its owner's graveyard.",
      'Desertion'
    );
    const desertionSteps = desertion.abilities[0].steps || [];
    const inner = desertionSteps[1];
    expect(inner?.kind).toBe('conditional');
    expect((inner as any).steps?.[0]?.to).toBe('battlefield');
    expectNoUnsupportedSelectorGaps(
      desertionSteps,
      { players: [{ id: controllerId }], battlefield: [] } as GameState,
      {
        controllerId,
        sourceId: 'bf-source',
        artifactOrCreatureSpellCounteredThisWay: true,
        lastMovedCards: [{ id: 'countered-creature-1', type_line: 'Creature — Human' }],
      }
    );
  });
});
