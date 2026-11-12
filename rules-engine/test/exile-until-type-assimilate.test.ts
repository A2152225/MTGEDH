import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import { resolveUnknownExileUntilAmountForPlayer } from '../src/oracleIRExecutorPlayerExileUntilAmount';
import { parseQuantity } from '../src/oracleIRParserUtils';

const BORG_QUEEN_ORACLE =
  'Artifact creatures you control get +2/+2.\n' +
  "Whenever The Borg Queen enters or attacks, target opponent exiles cards from the top of their library until they exile a creature card. Assimilate that card. They put the rest on the bottom in a random order. (To assimilate a card, put it onto the battlefield under your control with a +1/+1 counter. It's a Borg artifact creature and loses all other creature types.)";

function card(id, name, typeLine) {
  return { id, name, type_line: typeLine };
}

describe('exile until a typeline card, then assimilate that card (#98)', () => {
  it('parses until a creature card and does not grant the rest-on-bottom sentence', () => {
    expect(parseQuantity('until they exile a creature card')).toEqual({
      kind: 'reference_amount',
      raw: 'until they exile a creature card',
    });

    const ir = parseOracleTextToIR(BORG_QUEEN_ORACLE, 'The Borg Queen');
    const steps = ir.abilities
      .filter((ability) => /enters or attacks/i.test(String(ability.triggerCondition || ability.text || '')))
      .flatMap((ability) => ability.steps || []);
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.some((step) => step.kind === 'unknown')).toBe(false);

    const exile = steps.find((step) => {
      const raw = String((step as any).amount?.raw || step.raw || '').toLowerCase();
      return raw.includes('until they exile a creature card') || raw.includes('until you exile a creature card');
    });
    expect(exile).toBeDefined();
    expect((exile as any).amount).toEqual({ kind: 'reference_amount', raw: 'until they exile a creature card' });

    const assimilate = steps.find((step) => (step as any).battlefieldAssimilate === true || /^assimilate\b/i.test(String(step.raw || '')));
    expect(assimilate).toBeDefined();
    expect((assimilate as any).kind).toBe('move_zone');

    const rest = steps.find((step) => step.kind === 'move_zone' && /put the rest on the bottom/i.test(String(step.raw || '')));
    expect(rest).toBeDefined();
    expect((rest as any).to).toBe('library');
    expect(steps.some((step) => step.kind === 'grant_static_ability' && /put the rest on the bottom/i.test(String((step as any).raw || (step as any).effectText || '')))).toBe(false);
  });

  it('counts library cards until the first creature', () => {
    const qty = parseQuantity('until they exile a creature card');
    const state = {
      players: [
        {
          id: 'p2' as PlayerID,
          name: 'P2',
          library: [
            card('plains_1', 'Plains', 'Basic Land — Plains'),
            card('island_1', 'Island', 'Basic Land — Island'),
            card('bear_1', 'Grizzly Bears', 'Creature — Bear'),
            card('swamp_1', 'Swamp', 'Basic Land — Swamp'),
          ],
          graveyard: [],
          exile: [],
          life: 40,
        },
      ],
      battlefield: [],
      stack: [],
    } as unknown as GameState;
    expect(resolveUnknownExileUntilAmountForPlayer(state, 'p2' as PlayerID, qty as any)).toBe(3);
  });

  it('assimilates the first creature exiled and puts the rest on the bottom', () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const state = {
      players: [
        { id: p1, name: 'P1', life: 40, hand: [], library: [], graveyard: [], exile: [] },
        {
          id: p2,
          name: 'P2',
          life: 40,
          hand: [],
          library: [
            card('plains_1', 'Plains', 'Basic Land — Plains'),
            card('island_1', 'Island', 'Basic Land — Island'),
            card('bear_1', 'Grizzly Bears', 'Creature — Bear'),
            card('swamp_1', 'Swamp', 'Basic Land — Swamp'),
          ],
          graveyard: [],
          exile: [],
        },
      ],
      stack: [],
      battlefield: [
        {
          id: 'queen_1',
          name: 'The Borg Queen',
          controller: p1,
          card: {
            name: 'The Borg Queen',
            type_line: 'Legendary Artifact Creature — Borg Noble',
            oracle_text: BORG_QUEEN_ORACLE,
            power: '4',
            toughness: '4',
          },
        },
      ],
    } as unknown as GameState;

    const steps = parseOracleTextToIR(BORG_QUEEN_ORACLE, 'The Borg Queen')
      .abilities
      .filter((ability) => /enters or attacks/i.test(String(ability.triggerCondition || ability.text || '')))
      .flatMap((ability) => ability.steps || []);
    const ctx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceName: 'The Borg Queen',
      sourceId: 'queen_1',
      targetPlayerId: p2,
      selectorContext: { targetPlayerId: p2, targetOpponentId: p2, chosenObjectIds: [p2] },
    } as any);

    const result = applyOracleIRStepsToGameState(state, steps as any, ctx);
    expect((result.appliedSteps || []).length).toBeGreaterThan(0);
    expect(result.state).toBeDefined();

    const opp = result.state.players.find((player: any) => player.id === p2) as any;
    const bear = (result.state.battlefield as any[]).find((permanent) => [permanent?.id, permanent?.cardId, permanent?.card?.id].map((value) => String(value || '')).includes('bear_1'));
    expect(bear).toBeDefined();
    expect(String(bear.controller || '')).toBe(p1);
    expect(Number(bear.counters?.['+1/+1'] || 0)).toBe(1);
    expect(String(bear.card?.type_line || bear.type_line || '')).toMatch(/borg/i);
    expect(String(bear.card?.type_line || bear.type_line || '')).toMatch(/artifact/i);
    const libraryIds = opp.library.map((entry: any) => entry.id);
    expect(libraryIds[0]).toBe('swamp_1');
    expect(libraryIds.slice(1).sort()).toEqual(['island_1', 'plains_1']);
    expect(libraryIds).toHaveLength(3);
    expect((opp.exile || []).some((entry: any) => entry.id === 'bear_1')).toBe(false);
    expect((opp.library || []).some((entry: any) => entry.id === 'bear_1')).toBe(false);
  });
});
