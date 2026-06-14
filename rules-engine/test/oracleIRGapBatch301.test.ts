import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  parseMoveZoneEachAttackingCreature,
  parseMoveZoneExileUpToTargetPermanentsFromGySplitTwoPiles,
  parseMoveZoneThisCardAndNamedCardsFromYourGraveyard,
} from '../src/oracleIRExecutorZoneOps';

const controllerId = 'p1' as PlayerID;

describe('Oracle IR gap batch 301 — Dragon/Aetherspouts/Split selectors', () => {
  it('parses Dragon this permanent and four named from graveyard', () => {
    expect(
      parseMoveZoneThisCardAndNamedCardsFromYourGraveyard({
        kind: 'raw',
        text: 'this permanent and four cards named this permanent from your graveyard',
      })
    ).toEqual({ namedCount: 4 });
  });

  it('parses Dragon this card and four named from graveyard', () => {
    expect(
      parseMoveZoneThisCardAndNamedCardsFromYourGraveyard({
        kind: 'raw',
        text: 'this card and four cards named this permanent from your graveyard',
      })
    ).toEqual({ namedCount: 4 });
  });

  it('parses Aetherspouts each attacking creature selector', () => {
    expect(parseMoveZoneEachAttackingCreature({ kind: 'raw', text: 'each attacking creature' })).toBe(true);
  });

  it('parses Split the Spoils exile GY split-two-piles selector', () => {
    expect(
      parseMoveZoneExileUpToTargetPermanentsFromGySplitTwoPiles({
        kind: 'raw',
        text: 'up to five target permanent cards from your graveyard and separate them into two piles',
      })
    ).toEqual({ maxCount: 5 });
  });

  it('executes Dragon Approach optional exile this card and four named from graveyard', () => {
    const ir = parseOracleTextToIR(
      "Dragon's Approach deals 3 damage to each opponent. You may exile this card and four cards named Dragon's Approach from your graveyard. If you do, search your library for a Dragon creature card, reveal it, put it into your hand, then shuffle.",
      "Dragon's Approach"
    );
    const step = ir.abilities[0]?.steps?.find(
      (entry) => entry.kind === 'move_zone' && (entry as any).to === 'exile'
    );
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [
            { id: 'gy-da-this', name: "Dragon's Approach", type_line: 'Sorcery', cmc: 2 },
            { id: 'gy-da-1', name: "Dragon's Approach", type_line: 'Sorcery', cmc: 2 },
            { id: 'gy-da-2', name: "Dragon's Approach", type_line: 'Sorcery', cmc: 2 },
            { id: 'gy-da-3', name: "Dragon's Approach", type_line: 'Sorcery', cmc: 2 },
            { id: 'gy-da-4', name: "Dragon's Approach", type_line: 'Sorcery', cmc: 2 },
          ],
        },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(
      state,
      [step],
      {
        controllerId,
        sourceId: 'gy-da-this',
        sourceName: "Dragon's Approach",
        selectorContext: {
          chosenObjectIds: ['gy-da-this', 'gy-da-1', 'gy-da-2', 'gy-da-3', 'gy-da-4'],
        },
      },
      { allowOptional: true }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.exile.length).toBe(5);
    expect(player.graveyard.length).toBe(0);
  });

  it('executes Aetherspouts each attacking creature to owner library', () => {
    const ir = parseOracleTextToIR(
      'For each attacking creature, its owner puts it on their choice of the top or bottom of their library.',
      'Aetherspouts'
    );
    const step = ir.abilities[0]?.steps?.[0];
    expect((step as any)?.what?.text).toBe('each attacking creature');
    const state = {
      players: [
        { id: controllerId, library: [], hand: [], graveyard: [] },
        { id: 'p2', library: [], hand: [], graveyard: [] },
      ],
      battlefield: [
        {
          id: 'atk-1',
          controller: 'p2',
          owner: 'p2',
          card: { name: 'Soldier', type_line: 'Creature — Soldier', cmc: 2 },
          attacking: true,
          tapped: true,
          attachments: [],
          counters: {},
        },
      ],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step], { controllerId, sourceId: 'aetherspouts' });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect((result.state?.battlefield || []).length).toBe(0);
    const owner = result.state?.players.find((entry) => entry.id === 'p2') as any;
    expect(owner.library.length).toBe(1);
  });

  it('executes Split the Spoils exile up to five permanents from graveyard into piles', () => {
    const ir = parseOracleTextToIR(
      'Exile up to five target permanent cards from your graveyard and separate them into two piles. An opponent chooses one of those piles. You may play lands from the chosen pile and cast spells from the chosen pile this turn.',
      'Split the Spoils'
    );
    const step = ir.abilities[0]?.steps?.find(
      (entry) => entry.kind === 'move_zone' && (entry as any).to === 'exile'
    );
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [
            { id: 'gy-split-1', name: 'Sol Ring', type_line: 'Artifact', cmc: 1 },
            { id: 'gy-split-2', name: 'Craterhoof', type_line: 'Creature — Beast', cmc: 8 },
          ],
        },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step], {
      controllerId,
      sourceId: 'split',
      selectorContext: { chosenObjectIds: ['gy-split-1', 'gy-split-2'] },
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.exile.length).toBe(2);
    expect(player.graveyard.length).toBe(0);
  });
});
