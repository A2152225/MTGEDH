import { describe, expect, it } from 'vitest';

import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor.js';
import { parseOracleTextToIR } from '../src/oracleIRParser.js';

describe('graveyard permission executor', () => {
  it('marks both lands and spells for a Gaea\'s Will-style graveyard permission clause', () => {
    const ir = parseOracleTextToIR(
      'Until end of turn, you may play lands and cast spells from your graveyard.',
      "Gaea's Will",
    );
    const steps = ir.abilities.flatMap((ability: any) => ability.steps || []);

    const result = applyOracleIRStepsToGameState(
      {
        turnNumber: 4,
        players: [
          {
            id: 'p1',
            name: 'P1',
            seat: 0,
            life: 40,
            library: [],
            hand: [],
            graveyard: [
              { id: 'forest_1', name: 'Forest', type_line: 'Basic Land — Forest' },
              { id: 'consider_1', name: 'Consider', type_line: 'Instant', mana_cost: '{U}' },
            ],
            exile: [],
          } as any,
        ],
      } as any,
      steps,
      {
        controllerId: 'p1',
        sourceId: 'gaea_will_1',
        sourceName: "Gaea's Will",
      },
      { allowOptional: true },
    );

    expect((result.state as any).playableFromGraveyard?.p1?.forest_1).toBe(4);
    expect((result.state as any).playableFromGraveyard?.p1?.consider_1).toBe(4);
  });

  it('propagates modifier metadata onto first-class granted graveyard permissions', () => {
    const result = applyOracleIRStepsToGameState(
      {
        turnNumber: 4,
        players: [
          {
            id: 'p1',
            name: 'P1',
            seat: 0,
            life: 40,
            library: [],
            hand: [],
            graveyard: [
              { id: 'consider_1', name: 'Consider', type_line: 'Instant', mana_cost: '{U}' },
            ],
            exile: [],
          } as any,
        ],
      } as any,
      [
        {
          kind: 'grant_graveyard_permission',
          who: { kind: 'you' },
          what: { kind: 'raw', text: 'spells' },
          permission: 'cast',
          duration: 'this_turn',
          raw: 'Until end of turn, you may cast spells from your graveyard.',
        },
        {
          kind: 'modify_graveyard_permissions',
          scope: 'last_granted_graveyard_cards',
          withoutPayingManaCost: true,
          exileInsteadOfGraveyard: true,
          raw: 'You may cast them without paying their mana costs. If a spell cast this way would be put into your graveyard, exile it instead.',
        },
      ] as any,
      {
        controllerId: 'p1',
        sourceId: 'test_free_graveyard_source_1',
        sourceName: 'Test Free Graveyard Source',
      },
      { allowOptional: true },
    );

    expect((result.state as any).playableFromGraveyard?.p1?.consider_1).toBe(4);
    expect((result.state as any).graveyardCastingPermissions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        playerId: 'p1',
        permission: 'cast',
        sourceZone: 'graveyard',
        sourceId: 'test_free_graveyard_source_1',
        sourceName: 'Test Free Graveyard Source',
        costMode: 'without_paying_mana_cost',
        replacement: expect.objectContaining({
          exileAfterResolution: true,
          sourceName: 'Test Free Graveyard Source',
        }),
      }),
    ]));

    const grantedCard = ((result.state as any).players?.[0]?.graveyard || []).find((card: any) => String(card?.id || '') === 'consider_1');
    expect(grantedCard?.withoutPayingManaCost).toBe(true);
    expect(grantedCard?.exileInsteadOfGraveyard).toBe(true);
  });
});