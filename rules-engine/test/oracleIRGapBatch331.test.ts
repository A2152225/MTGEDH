import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  parseMoveZoneThisCreatureAndAnotherTargetCreature,
} from '../src/oracleIRExecutorZoneOps';

const controllerId = 'p1' as PlayerID;
const opponentId = 'p2' as PlayerID;

describe('Oracle IR gap batch 331 — Rejoin the Fight / Coastal Wizard / Spell Crumple', () => {
  it('parses each card chosen this way among-them selector', () => {
    const ir = parseOracleTextToIR(
      "Mill three cards. Then starting with the next opponent in turn order, each opponent chooses a creature card in your graveyard that hasn't been chosen. Return each card chosen this way to the battlefield under your control.",
      'Rejoin the Fight'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find(
      (entry) =>
        entry.kind === 'move_zone' &&
        /^each card chosen this way$/i.test(String((entry as any).what?.text || ''))
    );
    expect(step).toBeTruthy();
  });

  it('parses this creature and another target creature bounce selector', () => {
    expect(
      parseMoveZoneThisCreatureAndAnotherTargetCreature({
        kind: 'raw',
        text: 'this creature and another target creature',
      })
    ).toBe(true);
  });

  it('parses Spell Crumple countered-spell bottom-of-library replacement', () => {
    const ir = parseOracleTextToIR(
      "Counter target spell. If that spell is countered this way, put it on the bottom of its owner's library instead of into that player's graveyard. Put Spell Crumple on the bottom of its owner's library.",
      'Spell Crumple'
    );
    const conditional = ir.abilities.flatMap((ability) => ability.steps || []).find(
      (entry) => entry.kind === 'conditional'
    );
    const moveStep = (conditional as any)?.steps?.find((entry: any) => entry.kind === 'move_zone');
    expect(moveStep?.to).toBe('library');
    expect(String((moveStep as any)?.what?.text || '').trim()).toBe('that spell');
  });

  it('executes Rejoin the Fight returning chosen graveyard creatures to battlefield', () => {
    const ir = parseOracleTextToIR(
      "Mill three cards. Then starting with the next opponent in turn order, each opponent chooses a creature card in your graveyard that hasn't been chosen. Return each card chosen this way to the battlefield under your control.",
      'Rejoin the Fight'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find(
      (entry) =>
        entry.kind === 'move_zone' &&
        /^each card chosen this way$/i.test(String((entry as any).what?.text || ''))
    );
    expect(step).toBeTruthy();
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [
            { id: 'gy-rjf-1', name: 'RJF Chosen One', type_line: 'Creature — Human', cmc: 3 },
            { id: 'gy-rjf-2', name: 'RJF Chosen Two', type_line: 'Creature — Elf', cmc: 2 },
          ],
          exile: [],
        },
        { id: opponentId, library: [], hand: [], graveyard: [], exile: [] },
      ],
      battlefield: [],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'test',
      selectorContext: { chosenObjectIds: ['gy-rjf-1', 'gy-rjf-2'] },
    });
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.battlefield || []).length).toBe(2);
    expect((result.state.players[0]?.graveyard || []).length).toBe(0);
  });

  it('executes Coastal Wizard bouncing this creature and another target creature', () => {
    const ir = parseOracleTextToIR(
      "{T}: Return this creature and another target creature to their owners' hands. Activate only during your turn, before attackers are declared.",
      'Coastal Wizard'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find(
      (entry) => entry.kind === 'move_zone'
    );
    expect(step).toBeTruthy();
    const state = {
      players: [
        { id: controllerId, library: [], hand: [], graveyard: [], exile: [] },
        { id: opponentId, library: [], hand: [], graveyard: [], exile: [] },
      ],
      battlefield: [
        {
          id: 'bf-coastal',
          name: 'Coastal Wizard',
          controller: controllerId,
          owner: controllerId,
          type_line: 'Creature — Wizard',
          cmc: 2,
        },
        {
          id: 'bf-coastal-target',
          name: 'Coastal Target',
          controller: opponentId,
          owner: opponentId,
          type_line: 'Creature — Goblin',
          cmc: 1,
        },
      ],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'bf-coastal',
      targetCreatureId: 'bf-coastal-target',
      selectorContext: { targetCreatureId: 'bf-coastal-target', chosenObjectIds: ['bf-coastal', 'bf-coastal-target'] },
    });
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.battlefield || []).length).toBe(0);
    expect((result.state.players[0]?.hand || []).length).toBe(1);
    expect((result.state.players[1]?.hand || []).length).toBe(1);
  });

  it('executes Spell Crumple putting countered spell on bottom of owner library', () => {
    const ir = parseOracleTextToIR(
      "Counter target spell. If that spell is countered this way, put it on the bottom of its owner's library instead of into that player's graveyard.",
      'Spell Crumple'
    );
    const conditional = ir.abilities.flatMap((ability) => ability.steps || []).find(
      (entry) => entry.kind === 'conditional'
    );
    const step = (conditional as any)?.steps?.find((entry: any) => entry.kind === 'move_zone');
    expect(step).toBeTruthy();
    const state = {
      players: [
        { id: controllerId, library: [], hand: [], graveyard: [], exile: [] },
        { id: opponentId, library: [], hand: [], graveyard: [], exile: [] },
      ],
      battlefield: [],
      stack: [
        {
          id: 'stack-sc-1',
          name: 'Countered Spell',
          controller: opponentId,
          owner: opponentId,
          type_line: 'Instant',
          cmc: 2,
          card: { id: 'card-sc-1', name: 'Countered Spell', type_line: 'Instant', cmc: 2 },
        },
      ],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'test',
      targetSpellId: 'stack-sc-1',
      selectorContext: { targetSpellId: 'stack-sc-1', libraryPlacement: 'bottom' },
    });
    expect(result.automationGaps || []).toHaveLength(0);
    expect(((result.state as any).stack || []).length).toBe(0);
    expect((result.state.players[1]?.library || []).length).toBe(1);
  });
});
