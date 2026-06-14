import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  parseMoveZoneAllCardsMilledThisWay,
  parseMoveZoneAllExiledCardsWithCounter,
} from '../src/oracleIRExecutorZoneOps';

const controllerId = 'p1' as PlayerID;

describe('Oracle IR gap batch 303 — aegis exile / up-to-one milled / sorcery GY', () => {
  it('parses Livio all exiled cards with aegis counters on them', () => {
    expect(
      parseMoveZoneAllExiledCardsWithCounter({
        kind: 'raw',
        text: 'all exiled cards with aegis counters on them',
      })
    ).toEqual({ counterName: 'aegis' });
  });

  it('parses Terra up to one enchantment card milled this way', () => {
    expect(
      parseMoveZoneAllCardsMilledThisWay({
        kind: 'raw',
        text: 'up to one enchantment card milled this way',
      })
    ).toEqual({ cardType: 'enchantment', maxCount: 1 });
  });

  it('executes Livio return all aegis-counter exiled cards to battlefield', () => {
    const ir = parseOracleTextToIR(
      "{2}{W}{W}, {T}: Return all exiled cards with aegis counters on them to the battlefield under their owners' control.",
      'Livio, Oathsworn Sentinel'
    );
    const step = ir.abilities[0]?.steps?.[0];
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [],
          exile: [
            {
              id: 'exile-aegis-1',
              name: 'Soldier',
              type_line: 'Creature — Soldier',
              cmc: 2,
              counters: { aegis: 1 },
            },
            {
              id: 'exile-aegis-2',
              name: 'Knight',
              type_line: 'Creature — Knight',
              cmc: 3,
              counters: { aegis: 1 },
            },
            {
              id: 'exile-plain-1',
              name: 'Plain Exile',
              type_line: 'Instant',
              cmc: 1,
            },
          ],
        },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step], {
      controllerId,
      sourceId: 'livio',
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect(result.state?.battlefield?.length).toBe(2);
  });

  it('executes Terra put up to one enchantment milled this way into hand', () => {
    const ir = parseOracleTextToIR(
      'Mill five cards. Put up to one enchantment card milled this way into your hand. Put the rest on the bottom of your library in a random order.',
      'Terra, Magical Adept'
    );
    const step = ir.abilities[0]?.steps?.find(
      (entry) =>
        entry.kind === 'move_zone' &&
        String((entry as any).what?.text || '').includes('milled this way')
    );
    const state = {
      players: [
        {
          id: controllerId,
          library: [{ id: 'lib-1', name: 'Forest', type_line: 'Basic Land — Forest', cmc: 0 }],
          hand: [],
          graveyard: [
            {
              id: 'milled-enchant-1',
              name: 'Milled Enchant',
              type_line: 'Enchantment',
              cmc: 3,
            },
            {
              id: 'milled-creature-1',
              name: 'Milled Bear',
              type_line: 'Creature — Bear',
              cmc: 2,
            },
          ],
        },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step], {
      controllerId,
      sourceId: 'terra',
      lastMilledCards: [
        { id: 'milled-enchant-1', name: 'Milled Enchant', type_line: 'Enchantment', cmc: 3 },
        { id: 'milled-creature-1', name: 'Milled Bear', type_line: 'Creature — Bear', cmc: 2 },
      ],
      selectorContext: { chosenObjectIds: ['milled-enchant-1'] },
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.hand.some((card: any) => card.id === 'milled-enchant-1')).toBe(true);
  });

  it('executes Mirari Conjecture II return target sorcery from graveyard', () => {
    const ir = parseOracleTextToIR(
      'I - Return target artifact card from your graveyard to the battlefield.\nII - Return target sorcery card from your graveyard to your hand.\nIII - Return target enchantment card from your graveyard to the battlefield.',
      'The Mirari Conjecture'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find(
      (entry) =>
        entry.kind === 'move_zone' &&
        String((entry as any).what?.text || '').includes('sorcery')
    );
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [{ id: 'gy-sorcery-1', name: 'Wrath', type_line: 'Sorcery', cmc: 5 }],
        },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step], {
      controllerId,
      sourceId: 'mirari',
      selectorContext: { chosenObjectIds: ['gy-sorcery-1'] },
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.hand.some((card: any) => card.id === 'gy-sorcery-1')).toBe(true);
  });

  it('Terra up-to-one milled enchant succeeds with zero matches', () => {
    const step = {
      kind: 'move_zone' as const,
      what: { kind: 'raw' as const, text: 'up to one enchantment card milled this way' },
      to: 'hand' as const,
      raw: 'Put up to one enchantment card milled this way into your hand',
    };
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [{ id: 'milled-creature-1', name: 'Bear', type_line: 'Creature — Bear', cmc: 2 }],
        },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step], {
      controllerId,
      sourceId: 'terra',
      lastMilledCards: [{ id: 'milled-creature-1', name: 'Bear', type_line: 'Creature — Bear', cmc: 2 }],
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.hand.length).toBe(0);
  });
});
