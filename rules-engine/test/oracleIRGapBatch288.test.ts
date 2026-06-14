import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { cardMatchesMoveZoneSingleTargetCriteria } from '../src/oracleIRExecutorZoneOps';
import { parseMoveZoneSingleTargetFromYourGraveyard } from '../src/oracleIRExecutorZoneOps';

const controllerId = 'p1' as PlayerID;
const opponentId = 'p2' as PlayerID;

describe('Oracle IR gap batch 288 — selector cluster fixes', () => {
  it('executes unearth return the card to the battlefield', () => {
    const steps = [
      {
        kind: 'move_zone' as const,
        what: { kind: 'raw' as const, text: 'the card' },
        to: 'battlefield' as const,
        toRaw: 'the battlefield',
        raw: 'Return the card to the battlefield',
      },
    ];
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [{ id: 'gy-zombie', name: 'Zombie', type_line: 'Creature — Zombie' }],
        },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, steps, {
      controllerId,
      sourceId: 'unearth',
      selectorContext: { chosenObjectIds: ['gy-zombie'] },
    });

    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect((result.state?.battlefield || []).length).toBe(1);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.graveyard.length).toBe(0);
  });

  it('matches multicolored graveyard criteria by color count', () => {
    const criteria = parseMoveZoneSingleTargetFromYourGraveyard({
      kind: 'raw',
      text: 'target multicolored card from your graveyard',
    });
    expect(criteria?.multicoloredOnly).toBe(true);
    expect(
      cardMatchesMoveZoneSingleTargetCriteria(
        { id: '1', name: 'Boros Charm', type_line: 'Instant', colors: ['R', 'W'] },
        criteria!
      )
    ).toBe(true);
    expect(
      cardMatchesMoveZoneSingleTargetCriteria(
        { id: '2', name: 'Shock', type_line: 'Instant', colors: ['R'] },
        criteria!
      )
    ).toBe(false);
  });

  it('executes Reborn Hope return target multicolored card from graveyard', () => {
    const ir = parseOracleTextToIR(
      'Return target multicolored card from your graveyard to your hand.',
      'Reborn Hope'
    );
    const steps = ir.abilities[0]?.steps || [];
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [
            { id: 'gy-1', name: 'Boros Charm', type_line: 'Instant', colors: ['R', 'W'] },
            { id: 'gy-2', name: 'Shock', type_line: 'Instant', colors: ['R'] },
          ],
        },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, steps, {
      controllerId,
      sourceId: 'reborn-hope',
    });

    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.hand.length).toBe(1);
    expect(player.hand[0]?.name).toBe('Boros Charm');
  });

  it('executes Vessel of Malignity exile two cards from opponent hand', () => {
    const ir = parseOracleTextToIR(
      "{T}: Target opponent exiles two cards from their hand. Activate only as a sorcery.",
      'Vessel of Malignity'
    );
    const steps = ir.abilities[0]?.steps || [];
    const state = {
      players: [
        { id: controllerId, library: [], hand: [], graveyard: [], exile: [] },
        {
          id: opponentId,
          library: [],
          hand: [
            { id: 'h-1', name: 'Shock', type_line: 'Instant' },
            { id: 'h-2', name: 'Bolt', type_line: 'Instant' },
          ],
          graveyard: [],
          exile: [],
        },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, steps, {
      controllerId,
      sourceId: 'vessel',
      selectorContext: { targetPlayerId: opponentId },
    });

    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const opponent = result.state?.players.find((entry) => entry.id === opponentId) as any;
    expect(opponent.hand.length).toBe(0);
    expect(opponent.exile.length).toBe(2);
  });

  it('executes Cave-In alternate-cost red card exile from hand', () => {
    const ir = parseOracleTextToIR(
      "You may exile a red card from your hand rather than pay this spell's mana cost.\nCave-In deals 3 damage to each creature and each player.",
      'Cave-In'
    );
    const steps =
      ir.abilities.find((ability) => ability.steps?.some((step) => step.kind === 'move_zone'))?.steps || [];
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [
            { id: 'red-1', name: 'Shock', type_line: 'Instant', colors: ['R'] },
            { id: 'blue-1', name: 'Opt', type_line: 'Instant', colors: ['U'] },
          ],
          graveyard: [],
          exile: [],
        },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, steps, {
      controllerId,
      sourceId: 'cave-in',
      selectorContext: { chosenObjectIds: ['red-1'] },
    }, { allowOptional: true });

    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.exile.length).toBe(1);
    expect(player.hand.length).toBe(1);
  });

  it('executes Sweep return any number of Plains you control to hand', () => {
    const ir = parseOracleTextToIR(
      "Sweep - Return any number of Plains you control to their owner's hand.\nTarget creature gets +1/+1 until end of turn for each Plains returned this way.",
      'Charge Across the Araba'
    );
    const steps =
      ir.abilities.find((ability) => ability.steps?.some((step) => step.kind === 'move_zone'))?.steps || [];
    const state = {
      players: [{ id: controllerId, library: [], hand: [], graveyard: [] }],
      battlefield: [
        { id: 'plains-1', name: 'Plains', type_line: 'Basic Land — Plains', controller: controllerId, owner: controllerId },
        { id: 'plains-2', name: 'Plains', type_line: 'Basic Land — Plains', controller: controllerId, owner: controllerId },
        { id: 'forest-1', name: 'Forest', type_line: 'Basic Land — Forest', controller: controllerId, owner: controllerId },
      ],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, steps, {
      controllerId,
      sourceId: 'charge',
    });

    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect((result.state?.battlefield || []).length).toBe(1);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.hand.length).toBe(2);
  });
});
