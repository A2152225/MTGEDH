import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { parseSimpleBattlefieldSelector } from '../src/oracleIRExecutorBattlefieldParser';
import {
  parseMoveZoneTheChosenCards,
  parseMoveZoneTypedCardFromYourHand,
} from '../src/oracleIRExecutorZoneOps';

const controllerId = 'p1' as PlayerID;

describe('Oracle IR gap batch 293 — selector cluster fixes', () => {
  it('parses Living Twister tapped land selector', () => {
    expect(
      parseSimpleBattlefieldSelector({ kind: 'raw', text: 'a tapped land you control' })
    ).toMatchObject({
      kind: 'battlefield_selector',
      types: ['land'],
      controllerFilter: 'you',
      tappedOnly: true,
    });
  });

  it('parses Victimize the chosen cards', () => {
    expect(parseMoveZoneTheChosenCards({ kind: 'raw', text: 'the chosen cards' })).toBe(true);
  });

  it('parses Wedding nonland hand card with time counters equal to MV', () => {
    expect(
      parseMoveZoneTypedCardFromYourHand({
        kind: 'raw',
        text: 'a nonland card from your hand with a number of time counters on it equal to its mana value',
      })
    ).toEqual({ cardType: 'nonland', timeCountersEqualManaValue: true });
  });

  it('executes Living Twister tapped land bounce', () => {
    const ir = parseOracleTextToIR(
      '{1}{R}, Discard a land card: This creature deals 2 damage to any target.\n{G}: Return a tapped land you control to its owner\'s hand.',
      'Living Twister'
    );
    const steps = ir.abilities[1]?.steps || [];
    const state = {
      players: [{ id: controllerId, library: [], hand: [], graveyard: [] }],
      battlefield: [
        {
          id: 'land-tapped',
          name: 'Forest',
          controller: controllerId,
          owner: controllerId,
          type_line: 'Basic Land — Forest',
          tapped: true,
        },
      ],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, steps, {
      controllerId,
      sourceId: 'twister',
      selectorContext: { chosenObjectIds: ['land-tapped'] },
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect((result.state?.battlefield || []).length).toBe(0);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.hand.length).toBe(1);
  });

  it('executes Victimize chosen cards to battlefield tapped', () => {
    const ir = parseOracleTextToIR(
      'Choose two target creature cards in your graveyard. Sacrifice a creature. If you do, return the chosen cards to the battlefield tapped.',
      'Victimize'
    );
    const sacrificeAbility = ir.abilities.find(
      (ability) => ability.steps?.some((step) => step.kind === 'sacrifice')
    );
    const conditional = sacrificeAbility?.steps?.find((step) => step.kind === 'conditional') as any;
    const moveSteps = (conditional?.steps || []).filter((step: any) => step.kind === 'move_zone');
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [
            { id: 'gy-1', name: 'Zombie', type_line: 'Creature — Zombie', cmc: 3 },
            { id: 'gy-2', name: 'Bear', type_line: 'Creature — Bear', cmc: 2 },
          ],
        },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, moveSteps, {
      controllerId,
      sourceId: 'victimize',
      selectorContext: { chosenObjectIds: ['gy-1', 'gy-2'] },
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect((result.state?.battlefield || []).length).toBe(2);
  });

  it('executes Wedding time-counter exile from hand', () => {
    const ir = parseOracleTextToIR(
      "Draw two cards, then you may exile a nonland card from your hand with a number of time counters on it equal to its mana value. Then target opponent does the same.",
      'The Wedding of River Song'
    );
    const steps = ir.abilities[0]?.steps?.filter((step) => step.kind === 'move_zone') || [];
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [{ id: 'hand-1', name: 'Bolt', type_line: 'Instant', cmc: 1 }],
          graveyard: [],
          exile: [],
        },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(
      state,
      steps,
      {
        controllerId,
        sourceId: 'wedding',
        selectorContext: { chosenObjectIds: ['hand-1'] },
      },
      { allowOptional: true }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.exile.length).toBe(1);
    expect(player.exile[0]?.counters?.time).toBe(1);
  });

  it('executes Jace one pile to hand and rest to library bottom', () => {
    const ir = parseOracleTextToIR(
      '+1: Until your next turn, whenever a creature an opponent controls attacks, it gets -1/-0 until end of turn.\n−2: Reveal the top three cards of your library. An opponent separates those cards into two piles. Put one pile into your hand and the other on the bottom of your library in any order.',
      'Jace, Architect of Thought'
    );
    const pileAbility = ir.abilities.find((ability) =>
      ability.steps?.some(
        (step) => step.kind === 'move_zone' && String((step as any).what?.text || '') === 'one pile'
      )
    );
    const steps =
      pileAbility?.steps?.filter(
        (step) => step.kind === 'move_zone' && String((step as any).what?.text || '') === 'one pile'
      ) || [];
    const state = {
      players: [
        {
          id: controllerId,
          library: [
            { id: 'lib-1', name: 'Card 1', type_line: 'Instant' },
            { id: 'lib-2', name: 'Card 2', type_line: 'Sorcery' },
            { id: 'lib-3', name: 'Card 3', type_line: 'Creature — Elf' },
          ],
          hand: [],
          graveyard: [],
        },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, steps, {
      controllerId,
      sourceId: 'jace',
      lastMovedCards: [
        { id: 'lib-1', name: 'Card 1', type_line: 'Instant' },
        { id: 'lib-2', name: 'Card 2', type_line: 'Sorcery' },
        { id: 'lib-3', name: 'Card 3', type_line: 'Creature — Elf' },
      ],
      selectorContext: { chosenObjectIds: ['lib-1', 'lib-2', 'lib-3'] },
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.hand.length).toBeGreaterThan(0);
    expect(player.library.length).toBeGreaterThan(0);
  });
});
