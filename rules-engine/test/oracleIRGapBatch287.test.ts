import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';

const controllerId = 'p1' as PlayerID;
const opponentId = 'p2' as PlayerID;

describe('Oracle IR gap batch 287 — selector cluster fixes', () => {
  it('executes Spurnmage Advocate return two cards from opponent graveyard to hand', () => {
    const ir = parseOracleTextToIR(
      "{T}: Return two target cards from an opponent's graveyard to their hand.",
      'Spurnmage Advocate'
    );
    const steps = ir.abilities[0]?.steps || [];
    const state = {
      players: [
        { id: controllerId, library: [], hand: [], graveyard: [] },
        {
          id: opponentId,
          library: [],
          hand: [],
          graveyard: [
            { id: 'gy-1', name: 'Shock', type_line: 'Instant' },
            { id: 'gy-2', name: 'Bolt', type_line: 'Instant' },
          ],
        },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, steps, {
      controllerId,
      sourceId: 'advocate',
      targetPlayerId: opponentId,
      selectorContext: { targetPlayerId: opponentId },
    });

    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect(result.appliedSteps?.length).toBe(1);
    const opponent = result.state?.players.find((entry) => entry.id === opponentId) as any;
    expect(opponent.graveyard.length).toBe(0);
    expect(opponent.hand.length).toBe(2);
  });

  it('executes shuffle the chosen cards into your library', () => {
    const steps = [
      {
        kind: 'move_zone' as const,
        what: { kind: 'raw' as const, text: 'the chosen cards' },
        to: 'library' as const,
        toRaw: 'your library',
        raw: 'Shuffle the chosen cards into your library',
      },
    ];
    const state = {
      players: [
        {
          id: controllerId,
          library: [{ id: 'lib-1', name: 'Forest', type_line: 'Basic Land — Forest' }],
          hand: [
            { id: 'chosen-1', name: 'Bear', type_line: 'Creature — Bear' },
            { id: 'chosen-2', name: 'Elf', type_line: 'Creature — Elf' },
            { id: 'rest-1', name: 'Goblin', type_line: 'Creature — Goblin' },
          ],
          graveyard: [],
        },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, steps, {
      controllerId,
      sourceId: 'spell',
      selectorContext: { chosenObjectIds: ['chosen-1', 'chosen-2'] },
    });

    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.hand.length).toBe(1);
    expect(player.library.length).toBe(3);
  });

  it('prunes Jadelight Spelunker explore reminder move_zone selector gap', () => {
    const ir = parseOracleTextToIR(
      'Whenever Jadelight Spelunker attacks, it explores X times. (To have it explore, reveal the top card of your library. Put that card into your hand if it\'s a land. Otherwise, put a +1/+1 counter on this creature. Then you may choose to put the card back or put it into your graveyard.)',
      'Jadelight Spelunker'
    );
    const steps = ir.abilities.find((ability) => ability.type === 'triggered')?.steps || [];
    expect(steps.some((step) => step.kind === 'move_zone')).toBe(false);
  });

  it('executes Lapse of Certainty countered spell to library top replacement', () => {
    const ir = parseOracleTextToIR(
      "Counter target spell. If that spell is countered this way, put it on top of its owner's library instead of into that player's graveyard.",
      'Lapse of Certainty'
    );
    const conditional = ir.abilities[0]?.steps.find((step) => step.kind === 'conditional');
    const steps = conditional?.kind === 'conditional' ? conditional.steps : [];
    const state = {
      players: [
        {
          id: opponentId,
          library: [{ id: 'lib-1', name: 'Island', type_line: 'Basic Land — Island' }],
          hand: [],
          graveyard: [],
        },
      ],
      battlefield: [],
      stack: [
        {
          id: 'stack-spell-1',
          owner: opponentId,
          controller: opponentId,
          card: { id: 'countered-1', name: 'Counterspell', type_line: 'Instant' },
        },
      ],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, steps, {
      controllerId,
      sourceId: 'lapse',
      targetSpellId: 'stack-spell-1',
    });

    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect((result.state as any)?.stack?.length).toBe(0);
    const opponent = result.state?.players.find((entry) => entry.id === opponentId) as any;
    expect(opponent.library[0]?.name).toBe('Counterspell');
    expect(opponent.library.length).toBe(2);
  });

  it('executes return up to two target nonland permanents to owners hands', () => {
    const ir = parseOracleTextToIR(
      "Return up to two target nonland permanents to their owners' hands.",
      "This Town Ain't Big Enough"
    );
    const steps = ir.abilities[0]?.steps || [];
    const state = {
      players: [
        { id: controllerId, library: [], hand: [], graveyard: [] },
        { id: opponentId, library: [], hand: [], graveyard: [] },
      ],
      battlefield: [
        { id: 'creature-1', name: 'Bear', type_line: 'Creature — Bear', controller: controllerId, owner: controllerId },
        { id: 'artifact-1', name: 'Sol Ring', type_line: 'Artifact', controller: opponentId, owner: opponentId },
        { id: 'land-1', name: 'Island', type_line: 'Basic Land — Island', controller: opponentId, owner: opponentId },
      ],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, steps, {
      controllerId,
      sourceId: 'spell',
    });

    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect(result.appliedSteps?.length).toBe(1);
    expect((result.state?.battlefield || []).length).toBe(1);
    const p1Hand = (result.state?.players.find((entry) => entry.id === controllerId) as any)?.hand?.length || 0;
    const p2Hand = (result.state?.players.find((entry) => entry.id === opponentId) as any)?.hand?.length || 0;
    expect(p1Hand + p2Hand).toBe(2);
  });
});
