import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { parseSimpleBattlefieldSelector } from '../src/oracleIRExecutorBattlefieldParser';
import { permanentMatchesSelector } from '../src/oracleIRExecutorBattlefieldOps';
import {
  parseMoveZoneAllCreatureTokens,
  parseMoveZoneSingleTargetCriteria,
  parseMoveZoneTargetCreatureOwnerLibraryChoice,
} from '../src/oracleIRExecutorZoneOps';

const controllerId = 'p1' as PlayerID;
const opponentId = 'p2' as PlayerID;

describe('Oracle IR gap batch 316 — Perplexing Test / Obscura Charm / Ice Magic', () => {
  it('parses all creature tokens bounce selector', () => {
    expect(
      parseMoveZoneAllCreatureTokens({
        kind: 'raw',
        text: 'all creature tokens',
      })
    ).toBe(true);
    const selector = parseSimpleBattlefieldSelector({ kind: 'raw', text: 'all creature tokens' });
    expect(selector?.tokenOnly).toBe(true);
    expect(selector?.types).toEqual(['creature']);
  });

  it('matches only creature tokens on battlefield', () => {
    const selector = parseSimpleBattlefieldSelector({ kind: 'raw', text: 'all creature tokens' })!;
    const token = {
      id: 'bf-token',
      controller: opponentId,
      owner: opponentId,
      type_line: 'Token Creature — Elf',
      isToken: true,
    };
    const nontoken = {
      id: 'bf-creature',
      controller: opponentId,
      owner: opponentId,
      type_line: 'Creature — Elf',
    };
    const ctx = { controllerId } as any;
    expect(permanentMatchesSelector(token as any, selector, ctx)).toBe(true);
    expect(permanentMatchesSelector(nontoken as any, selector, ctx)).toBe(false);
  });

  it('parses multicolored permanent GY return criteria with mana value', () => {
    expect(parseMoveZoneSingleTargetCriteria('multicolored permanent')).toEqual({
      cardType: 'permanent',
      multicoloredOnly: true,
    });
    expect(parseMoveZoneSingleTargetCriteria('multicolored permanent card with mana value 3 or less')).toEqual({
      cardType: 'permanent',
      multicoloredOnly: true,
      manaValueLte: 3,
    });
  });

  it('parses Ice Magic owner library choice from step raw', () => {
    expect(
      parseMoveZoneTargetCreatureOwnerLibraryChoice(
        { kind: 'raw', text: 'Blizzara - {2} - Target creature' },
        "Target creature's owner puts it on their choice of the top or bottom of their library."
      )
    ).toBe(true);
  });

  it('executes Perplexing Test returning all creature tokens to owners hands', () => {
    const ir = parseOracleTextToIR("Return all creature tokens to their owners' hands.", 'Perplexing Test');
    const step = ir.abilities[0]?.steps?.find((entry) => entry.kind === 'move_zone');
    expect(step).toBeTruthy();
    const state = {
      players: [
        { id: controllerId, library: [], hand: [], graveyard: [], exile: [] },
        { id: opponentId, library: [], hand: [], graveyard: [], exile: [] },
      ],
      battlefield: [
        {
          id: 'bf-token-elf',
          name: 'Elf Token',
          controller: controllerId,
          owner: controllerId,
          type_line: 'Token Creature — Elf',
          isToken: true,
        },
        {
          id: 'bf-token-goblin',
          name: 'Goblin Token',
          controller: opponentId,
          owner: opponentId,
          type_line: 'Token Creature — Goblin',
          isToken: true,
        },
        {
          id: 'bf-nontoken',
          name: 'Human',
          controller: opponentId,
          owner: opponentId,
          type_line: 'Creature — Human',
        },
      ],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], { controllerId, sourceId: 'test' });
    expect(result.automationGaps || []).toHaveLength(0);
    expect(result.state.battlefield || []).toHaveLength(1);
    expect((result.state.players.find((p) => p.id === controllerId)?.hand || []).length).toBe(0);
    expect((result.state.players.find((p) => p.id === opponentId)?.hand || []).length).toBe(0);
  });

  it('executes Obscura Charm multicolored GY return tapped', () => {
    const ir = parseOracleTextToIR(
      'Choose one — • Creatures you control gain lifelink until end of turn. • Return target multicolored permanent card with mana value 3 or less from your graveyard to the battlefield tapped.',
      'Obscura Charm'
    );
    const chooseStep = ir.abilities[0]?.steps?.find((entry) => entry.kind === 'choose_mode');
    const moveStep = (chooseStep as any)?.modes
      ?.flatMap((mode: any) => mode.steps || [])
      ?.find((entry: any) => entry.kind === 'move_zone' && /multicolored permanent/i.test(String(entry.raw || '')));
    expect(moveStep).toBeTruthy();
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [
            {
              id: 'gy-obscura-charm',
              name: 'Empyrean Eagle',
              type_line: 'Creature — Bird Spirit',
              colors: ['W', 'U'],
              cmc: 3,
            },
          ],
          exile: [],
        },
        { id: opponentId, library: [], hand: [], graveyard: [], exile: [] },
      ],
      battlefield: [],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [moveStep!], {
      controllerId,
      sourceId: 'test',
      selectorContext: { chosenObjectIds: ['gy-obscura-charm'] },
    });
    expect(result.automationGaps || []).toHaveLength(0);
    expect(result.state.battlefield || []).toHaveLength(1);
    const returned = (result.state.battlefield || [])[0] as any;
    expect(returned?.tapped).toBe(true);
    expect((result.state.players.find((p) => p.id === controllerId)?.graveyard || []).length).toBe(0);
  });

  it('executes Ice Magic owner library choice using chosen target', () => {
    const ir = parseOracleTextToIR(
      "• Blizzara - {2} - Target creature's owner puts it on their choice of the top or bottom of their library.",
      'Ice Magic'
    );
    const step = ir.abilities[0]?.steps?.find((entry) => entry.kind === 'move_zone');
    expect(step).toBeTruthy();
    const state = {
      players: [
        { id: controllerId, library: [{ id: 'lib-p1-1', name: 'Top', type_line: 'Instant' }], hand: [], graveyard: [], exile: [] },
        {
          id: opponentId,
          library: [{ id: 'lib-p2-1', name: 'Opp Top', type_line: 'Instant' }],
          hand: [],
          graveyard: [],
          exile: [],
        },
      ],
      battlefield: [
        {
          id: 'bf-ice-creature',
          name: 'Ice Target',
          controller: opponentId,
          owner: opponentId,
          type_line: 'Creature — Human',
          cmc: 3,
        },
      ],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'test',
      selectorContext: {
        chosenObjectIds: ['bf-ice-creature'],
        libraryPlacement: 'bottom',
      },
    });
    expect(result.automationGaps || []).toHaveLength(0);
    expect(result.state.battlefield || []).toHaveLength(0);
    const oppLibrary = result.state.players.find((p) => p.id === opponentId)?.library || [];
    expect(oppLibrary.length).toBe(2);
  });
});
