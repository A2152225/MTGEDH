import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  parseMoveZoneAllExiledWithThisPermanent,
  parseMoveZoneCountCardsFromEachPlayersHand,
  parseMoveZoneSingleTargetCriteria,
  parseMoveZoneSingleTargetFromYourGraveyard,
} from '../src/oracleIRExecutorZoneOps';

const controllerId = 'p1' as PlayerID;

describe('Oracle IR gap batch 302 — each-player hand / adventure GY / exiled-with creature', () => {
  it('parses Mind Swords two cards from each player hand', () => {
    expect(
      parseMoveZoneCountCardsFromEachPlayersHand({
        kind: 'raw',
        text: "two cards from each player's hand",
      })
    ).toEqual({ count: 2, cardType: 'any' });
  });

  it('parses Edgewall target adventure card from graveyard', () => {
    expect(parseMoveZoneSingleTargetCriteria('card that has an Adventure')).toEqual({
      cardType: 'any',
      requiresAdventure: true,
    });
    expect(
      parseMoveZoneSingleTargetFromYourGraveyard({
        kind: 'raw',
        text: 'target card that has an Adventure from your graveyard',
      })
    ).toEqual({ cardType: 'any', requiresAdventure: true });
  });

  it('parses Ghost Vacuum each creature exiled with this artifact', () => {
    expect(
      parseMoveZoneAllExiledWithThisPermanent({
        kind: 'raw',
        text: 'each creature card exiled with this artifact',
      })
    ).toEqual({ cardType: 'creature' });
  });

  it('executes Mind Swords each player exiles two cards from hand', () => {
    const ir = parseOracleTextToIR(
      'Each player discards a card. Each player exiles two cards from their hand.',
      'Mind Swords'
    );
    const step = ir.abilities[0]?.steps?.find(
      (entry) => entry.kind === 'move_zone' && (entry as any).to === 'exile'
    );
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [
            { id: 'hand-p1-1', name: 'Bolt', type_line: 'Instant', cmc: 1 },
            { id: 'hand-p1-2', name: 'Bear', type_line: 'Creature — Bear', cmc: 2 },
            { id: 'hand-p1-3', name: 'Shock', type_line: 'Instant', cmc: 1 },
          ],
          graveyard: [],
        },
        {
          id: 'p2',
          library: [],
          hand: [
            { id: 'hand-p2-1', name: 'Elf', type_line: 'Creature — Elf', cmc: 1 },
            { id: 'hand-p2-2', name: 'Island', type_line: 'Instant', cmc: 1 },
          ],
          graveyard: [],
        },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step], {
      controllerId,
      sourceId: 'mind-swords',
      selectorContext: {
        chosenObjectIds: ['hand-p1-1', 'hand-p1-2', 'hand-p2-1', 'hand-p2-2'],
      },
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const p1 = result.state?.players.find((entry) => entry.id === controllerId) as any;
    const p2 = result.state?.players.find((entry) => entry.id === 'p2') as any;
    expect(p1.exile.length).toBe(2);
    expect(p2.exile.length).toBe(2);
  });

  it('executes Edgewall Inn return target adventure card from graveyard', () => {
    const ir = parseOracleTextToIR(
      '{T}: Return target card that has an Adventure from your graveyard to your hand.',
      'Edgewall Inn'
    );
    const step = ir.abilities[0]?.steps?.[0];
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [
            { id: 'gy-adventure-1', name: 'Adventure Half', type_line: 'Sorcery — Adventure', layout: 'adventure', cmc: 2 },
            { id: 'gy-plain-1', name: 'Plains', type_line: 'Basic Land — Plains', cmc: 0 },
          ],
        },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step], {
      controllerId,
      sourceId: 'edgewall',
      selectorContext: { chosenObjectIds: ['gy-adventure-1'] },
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.hand.length).toBe(1);
    expect(player.graveyard.length).toBe(1);
  });

  it('executes Ghost Vacuum each creature exiled with source to battlefield', () => {
    const ir = parseOracleTextToIR(
      '{T}: Exile up to two target cards from a single graveyard.\n{5}, {T}, Sacrifice Ghost Vacuum: Put each creature card exiled with this artifact onto the battlefield under your control with a flying counter on it. They gain haste until end of turn.',
      'Ghost Vacuum'
    );
    const step = ir.abilities[1]?.steps?.find(
      (entry) => entry.kind === 'move_zone' && (entry as any).to === 'battlefield'
    );
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [],
          exile: [
            { id: 'exile-ghost-1', name: 'Zombie', type_line: 'Creature — Zombie', cmc: 3, exiledWith: 'ghost-src' },
            { id: 'exile-ghost-2', name: 'Bolt', type_line: 'Instant', cmc: 1, exiledWith: 'ghost-src' },
          ],
        },
      ],
      battlefield: [
        {
          id: 'ghost-src',
          controller: controllerId,
          owner: controllerId,
          card: { name: 'Ghost Vacuum', type_line: 'Artifact', cmc: 2 },
          attachments: [],
          counters: {},
          tapped: false,
        },
      ],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step], {
      controllerId,
      sourceId: 'ghost-src',
      selectorContext: { chosenObjectIds: ['exile-ghost-1'] },
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect((result.state?.battlefield || []).length).toBe(2);
    const zombie = (result.state?.battlefield || []).find((entry) => (entry as any).id !== 'ghost-src') as any;
    expect(zombie?.counters?.flying).toBe(1);
  });
});
