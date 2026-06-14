import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  parseMoveZoneAllCardsMilledThisWay,
  parseMoveZoneContextualThemSplit,
  parseMoveZoneSingleTargetCriteria,
} from '../src/oracleIRExecutorZoneOps';

const controllerId = 'p1' as PlayerID;

describe('Oracle IR gap batch 338 — Rowan / Ramosian / Vivien', () => {
  it('parses Rowan up-to-two library-top contextual split', () => {
    expect(
      parseMoveZoneContextualThemSplit({
        kind: 'raw',
        text: 'up to two of them back on top of your library in any order and the rest',
      })
    ).toEqual({ kind: 'count_library_top_graveyard_rest', count: 2 });
  });

  it('parses Ramosian rebel permanent MV lte criteria', () => {
    expect(parseMoveZoneSingleTargetCriteria('Rebel permanent card with mana value 5 or less')).toEqual({
      cardType: 'permanent',
      typeLineTermsAnyOf: ['rebel'],
      manaValueLte: 5,
    });
  });

  it('parses Vivien any-number milled creatures selector', () => {
    expect(
      parseMoveZoneAllCardsMilledThisWay({
        kind: 'raw',
        text: 'any number of creature cards milled this way',
      })
    ).toEqual({ cardType: 'creature', anyNumber: true });
  });

  it('executes Rowan splitting looked-at cards to library top and graveyard', () => {
    const ir = parseOracleTextToIR(
      'If this spell was bargained, look at the top four cards of your library, then put up to two of them back on top of your library in any order and the rest into your graveyard.',
      "Rowan's Grim Search"
    );
    const steps =
      ir.abilities
        .flatMap((ability) => ability.steps || [])
        .flatMap((step: any) => (step.kind === 'conditional' ? step.steps || [] : [step])) || [];
    const moveStep = steps.find((entry) => entry.kind === 'move_zone');
    expect(moveStep).toBeTruthy();
    const lookedCards = [
      { id: 'lib-rowan-1', name: 'Rowan Top One', type_line: 'Instant', cmc: 2 },
      { id: 'lib-rowan-2', name: 'Rowan Top Two', type_line: 'Sorcery', cmc: 3 },
      { id: 'lib-rowan-3', name: 'Rowan Rest One', type_line: 'Creature — Human', cmc: 1 },
      { id: 'lib-rowan-4', name: 'Rowan Rest Two', type_line: 'Enchantment', cmc: 2 },
    ];
    const state = {
      players: [{ id: controllerId, library: [...lookedCards], hand: [], graveyard: [], exile: [] }],
      battlefield: [],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, steps as any[], {
      controllerId,
      sourceId: 'test',
      lastMovedCards: lookedCards,
      selectorContext: { chosenObjectIds: ['lib-rowan-1', 'lib-rowan-2'] },
    });
    expect(result.automationGaps || []).toHaveLength(0);
    const player = result.state.players[0] as any;
    expect(player.graveyard.map((card: any) => card.id).sort()).toEqual(['lib-rowan-3', 'lib-rowan-4']);
    expect(player.library.slice(0, 2).map((card: any) => card.id).sort()).toEqual(['lib-rowan-1', 'lib-rowan-2']);
  });

  it('executes Ramosian returning rebel permanent from graveyard to battlefield', () => {
    const ir = parseOracleTextToIR(
      '{6}, {T}: Return target Rebel permanent card with mana value 5 or less from your graveyard to the battlefield.',
      'Ramosian Revivalist'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'move_zone');
    expect(step).toBeTruthy();
    const rebel = {
      id: 'gy-ramosian-rebel-1',
      name: 'Ramosian Captain',
      type_line: 'Creature — Human Rebel',
      cmc: 3,
    };
    const state = {
      players: [{ id: controllerId, library: [], hand: [], graveyard: [rebel], exile: [] }],
      battlefield: [],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'test',
      selectorContext: { chosenObjectIds: [rebel.id] },
    });
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.battlefield || []).length).toBe(1);
    expect((result.state.players[0]?.graveyard || []).length).toBe(0);
  });

  it('executes Vivien putting any number of milled creatures into hand', () => {
    const ir = parseOracleTextToIR(
      'Mill five cards, then put any number of creature cards milled this way into your hand.',
      'Vivien on the Hunt'
    );
    const steps = ir.abilities.flatMap((ability) => ability.steps || []);
    const moveStep = steps.find((entry) => entry.kind === 'move_zone');
    expect(moveStep).toBeTruthy();
    const milledCreatures = [
      { id: 'gy-vivien-creature-1', name: 'Vivien Milled Bear', type_line: 'Creature — Bear', cmc: 2 },
      { id: 'gy-vivien-creature-2', name: 'Vivien Milled Elf', type_line: 'Creature — Elf', cmc: 1 },
      { id: 'gy-vivien-instant-1', name: 'Vivien Milled Bolt', type_line: 'Instant', cmc: 1 },
    ];
    const state = {
      players: [{ id: controllerId, library: [], hand: [], graveyard: [...milledCreatures], exile: [] }],
      battlefield: [],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, steps as any[], {
      controllerId,
      sourceId: 'test',
      lastMilledCards: milledCreatures,
      selectorContext: { chosenObjectIds: ['gy-vivien-creature-1', 'gy-vivien-creature-2'] },
    });
    expect(result.automationGaps || []).toHaveLength(0);
    const player = result.state.players[0] as any;
    expect(player.hand.map((card: any) => card.id).sort()).toEqual([
      'gy-vivien-creature-1',
      'gy-vivien-creature-2',
    ]);
    expect(player.graveyard.map((card: any) => card.id)).toEqual(['gy-vivien-instant-1']);
  });
});
