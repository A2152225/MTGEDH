import { describe, expect, it } from 'vitest';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';

const CHARBELCHER_TEXT =
  'Reveal cards from the top of your library until you reveal a land card. This artifact deals damage equal to the number of nonland cards revealed this way to any target. If the revealed land card was a Mountain, this artifact deals double that damage instead. Put the revealed cards on the bottom of your library in any order.';

const card = (name: string, typeLine: string) => ({ id: `${name}-id`, name, type_line: typeLine });
const makeState = (): any => ({
  players: [
    { id: 'p1', life: 40, hand: [], graveyard: [], library: [card('A', 'Instant'), card('B', 'Sorcery'), card('C', 'Creature - Elf'), card('Mtn', 'Basic Land - Mountain'), card('Z', 'Land')] },
    { id: 'p2', life: 40 },
  ],
  life: { p1: 40, p2: 40 },
  battlefield: [{ id: 'belcher', controller: 'p1', owner: 'p1', counters: {}, card: { name: 'Goblin Charbelcher', type_line: 'Artifact' } }],
  turnNumber: 2,
});
const steps = () => parseOracleTextToIR(CHARBELCHER_TEXT, 'Goblin Charbelcher').abilities.flatMap((a: any) => a.steps);
const ctxFor = (extra: Record<string, unknown> = {}) =>
  buildOracleIRExecutionContext({ controllerId: 'p1', sourceId: 'belcher', sourceName: 'Goblin Charbelcher', selectorContext: { targetPlayerId: 'p2' }, ...extra } as any);
const libraryNames = (state: any) => state.players.find((p: any) => p.id === 'p1').library.map((c: any) => c.name);

describe('Goblin Charbelcher: put the revealed cards on the bottom in any order', () => {
  it('parses the final sentence as a real library-bottom move (not a static-ability note)', () => {
    const kinds = steps().map((s: any) => s.kind);
    expect(kinds).toEqual(['reveal_top', 'conditional', 'move_zone']);
    const move: any = steps()[2];
    expect(move.to).toBe('library');
    expect(move.order).toBe('any');
  });

  it('non-interactive resolution moves all revealed cards to the bottom, keeping the unrevealed card on top', () => {
    const result: any = applyOracleIRStepsToGameState(makeState(), steps() as any, ctxFor(), { allowOptional: true });
    expect(result.state.life.p2).toBe(34);
    expect(libraryNames(result.state)).toEqual(['Z', 'A', 'B', 'C', 'Mtn']);
  });

  it('interactive resolution asks the player for the order instead of choosing one', () => {
    const result: any = applyOracleIRStepsToGameState(
      makeState(), steps() as any, ctxFor({ interactivePlayerChoices: true }), { allowOptional: true, haltOnPlayerChoiceRequired: true },
    );
    const gap = (result.automationGaps || []).find((entry: any) => entry.metadata?.warpWorldChoice === 'remainder_any_order');
    expect(gap?.metadata?.pendingRemainderPlayerId).toBe('p1');
    expect(gap?.metadata?.remainderCardIds).toEqual(['A-id', 'B-id', 'C-id', 'Mtn-id']);
  });

  it('applies the order the player supplied', () => {
    const first: any = applyOracleIRStepsToGameState(
      makeState(), steps() as any, ctxFor({ interactivePlayerChoices: true }), { allowOptional: true, haltOnPlayerChoiceRequired: true },
    );
    const moveStep = (first.skippedSteps || []).find((s: any) => s.kind === 'move_zone');
    expect(moveStep).toBeTruthy();
    const resumed: any = applyOracleIRStepsToGameState(
      first.state, [moveStep, ...(first.pendingContinuationSteps || [])],
      ctxFor({
        interactivePlayerChoices: true,
        currentStepIndex: (first.appliedSteps || []).length,
        lastMovedCards: first.lastMovedCards,
        lastRevealedCards: first.lastRevealedCards,
        selectorContext: { targetPlayerId: 'p2', libraryBottomOrderByPlayer: { p1: ['Mtn-id', 'C-id', 'B-id', 'A-id'] } },
        stepLedger: (first.state as any).oracleIrStepLedger,
        appliedStepKinds: (first.state as any).oracleIrAppliedStepKinds,
      }),
      { allowOptional: true, haltOnPlayerChoiceRequired: true },
    );
    expect(libraryNames(resumed.state)).toEqual(['Z', 'Mtn', 'C', 'B', 'A']);
  });
});