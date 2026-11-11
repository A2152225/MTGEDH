import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser.js';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor.js';

const ANIKTHEA =
  "Menace\nOther enchantment creatures you control have menace.\nWhenever Anikthea enters or attacks, exile up to one target non-Aura enchantment card from your graveyard. Create a token that's a copy of that card, except it's a 3/3 black Zombie creature in addition to its other types.";

function makeState(overrides: Record<string, unknown> = {}) {
  return {
    players: [
      {
        id: 'p1',
        name: 'P1',
        seat: 0,
        life: 40,
        library: [],
        hand: [],
        graveyard: [],
        exile: [],
      },
      {
        id: 'p2',
        name: 'P2',
        seat: 1,
        life: 40,
        library: [],
        hand: [],
        graveyard: [],
        exile: [],
      },
    ],
    battlefield: [
      {
        id: 'anik-source',
        ownerId: 'p1',
        controller: 'p1',
        name: 'Anikthea, Hand of Erebos',
        cardType: 'Legendary Enchantment Creature — Demigod',
        type_line: 'Legendary Enchantment Creature — Demigod',
        power: 4,
        toughness: 4,
        tapped: false,
        summoningSick: false,
        counters: {},
        attachments: [],
        modifiers: [],
      },
    ],
    stack: [],
    ...overrides,
  } as any;
}

describe('Anikthea-family copy-of-that-card antecedent', () => {
  it('creates the modified token when a GY enchantment was exiled', () => {
    const ir = parseOracleTextToIR(ANIKTHEA, 'Anikthea, Hand of Erebos');
    const steps = (ir.abilities.find((a: any) => a.type === 'triggered')?.steps ?? []) as any[];
    const state = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [
            {
              id: 'gy-arena',
              name: 'Phyrexian Arena',
              type_line: 'Enchantment',
              oracle_text: 'At the beginning of your upkeep, you draw a card and you lose 1 life.',
              colors: ['B'],
            },
          ],
          exile: [],
        },
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
          exile: [],
        },
      ],
    });

    const result = applyOracleIRStepsToGameState(
      state,
      steps,
      {
        controllerId: 'p1',
        sourceId: 'anik-source',
        sourceName: 'Anikthea, Hand of Erebos',
        selectorContext: { chosenObjectIds: ['gy-arena'] },
      },
      { allowOptional: true },
    );

    const token = (result.state.battlefield || []).find((p: any) => p.id !== 'anik-source') as any;
    expect(result.skippedSteps).toHaveLength(0);
    expect(token?.isToken).toBe(true);
    expect(token?.card?.name || token?.name).toBe('Phyrexian Arena');
    expect(token?.power).toBe(3);
    expect(token?.toughness).toBe(3);
    expect(String(token?.type_line || token?.card?.type_line || '')).toMatch(/Zombie/);
  });

  it('does not fall back to copying the ability source when no card was exiled', () => {
    const ir = parseOracleTextToIR(ANIKTHEA, 'Anikthea, Hand of Erebos');
    const steps = (ir.abilities.find((a: any) => a.type === 'triggered')?.steps ?? []) as any[];

    const result = applyOracleIRStepsToGameState(
      makeState(),
      steps,
      {
        controllerId: 'p1',
        sourceId: 'anik-source',
        sourceName: 'Anikthea, Hand of Erebos',
      },
      { allowOptional: true },
    );

    expect(result.skippedSteps).toHaveLength(0);
    expect((result.state.battlefield || []).filter((p: any) => p.isToken)).toHaveLength(0);
    expect((result.state.battlefield || []).map((p: any) => p.id)).toEqual(['anik-source']);
  });
});
