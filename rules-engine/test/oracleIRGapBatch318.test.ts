import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyAttachStep } from '../src/oracleIRExecutorAttachStepHandlers';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  parseMoveZoneAllNoncreatureNonlandPermanentsToHand,
  parseMoveZoneCountFromYourGraveyard,
} from '../src/oracleIRExecutorZoneOps';

const controllerId = 'p1' as PlayerID;
const opponentId = 'p2' as PlayerID;

describe('Oracle IR gap batch 318 — Restock / Simic Guildmage / Filter Out', () => {
  it('parses Restock two target cards from your graveyard', () => {
    expect(
      parseMoveZoneCountFromYourGraveyard({
        kind: 'raw',
        text: 'two target cards from your graveyard',
      })
    ).toEqual({ count: 2, cardType: 'any' });
  });

  it('parses Filter Out all noncreature nonland permanents bounce', () => {
    expect(
      parseMoveZoneAllNoncreatureNonlandPermanentsToHand({
        kind: 'raw',
        text: 'all noncreature, nonland permanents',
      })
    ).toEqual({ cardType: 'noncreature_nonland_permanent' });
  });

  it('executes Restock returning two chosen graveyard cards to hand', () => {
    const ir = parseOracleTextToIR('Return two target cards from your graveyard to your hand.', 'Restock');
    const step = ir.abilities[0]?.steps?.find((entry) => entry.kind === 'move_zone');
    expect(step).toBeTruthy();
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [
            { id: 'gy-restock-1', name: 'Restock One', type_line: 'Instant', cmc: 1 },
            { id: 'gy-restock-2', name: 'Restock Two', type_line: 'Sorcery', cmc: 2 },
            { id: 'gy-restock-3', name: 'Restock Three', type_line: 'Creature — Elf', cmc: 3 },
          ],
          exile: [],
        },
      ],
      battlefield: [],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'test',
      selectorContext: { chosenObjectIds: ['gy-restock-1', 'gy-restock-2'] },
    });
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.players[0]?.hand || []).length).toBe(2);
    expect((result.state.players[0]?.graveyard || []).length).toBe(1);
  });

  it('executes Simic Guildmage reattaching aura to another permanent with same controller', () => {
    const ir = parseOracleTextToIR(
      '{G/U}, {G/U}: Attach target Aura attached to a permanent to another permanent with the same controller.',
      'Simic Guildmage'
    );
    const step = ir.abilities[0]?.steps?.find((entry) => entry.kind === 'attach');
    expect(step).toBeTruthy();
    const state = {
      players: [{ id: controllerId, library: [], hand: [], graveyard: [], exile: [] }],
      battlefield: [
        {
          id: 'bf-aura-host',
          name: 'Host Creature',
          controller: controllerId,
          owner: controllerId,
          type_line: 'Creature — Human',
          cmc: 2,
        },
        {
          id: 'bf-aura-target',
          name: 'Target Creature',
          controller: controllerId,
          owner: controllerId,
          type_line: 'Creature — Elf',
          cmc: 2,
        },
        {
          id: 'bf-aura-enchantment',
          name: 'Test Aura',
          controller: controllerId,
          owner: controllerId,
          type_line: 'Enchantment — Aura',
          cmc: 1,
          attachedTo: 'bf-aura-host',
        },
      ],
    } as GameState;
    const result = applyAttachStep(state, step as any, {
      controllerId,
      sourceId: 'test',
      selectorContext: { chosenObjectIds: ['bf-aura-enchantment', 'bf-aura-target'] },
    });
    expect(result.applied).toBe(true);
    const aura = (result as any).state.battlefield?.find(
      (perm: any) => String(perm?.id || '') === 'bf-aura-enchantment'
    );
    expect(aura?.attachedTo).toBe('bf-aura-target');
  });

  it('executes Filter Out bouncing noncreature nonland permanents to owners hands', () => {
    const ir = parseOracleTextToIR(
      "Return all noncreature, nonland permanents to their owners' hands.",
      'Filter Out'
    );
    const step = ir.abilities[0]?.steps?.find((entry) => entry.kind === 'move_zone');
    expect(step).toBeTruthy();
    const state = {
      players: [
        { id: controllerId, library: [], hand: [], graveyard: [], exile: [] },
        { id: opponentId, library: [], hand: [], graveyard: [], exile: [] },
      ],
      battlefield: [
        {
          id: 'bf-filter-artifact',
          name: 'Filter Artifact',
          controller: opponentId,
          owner: opponentId,
          type_line: 'Artifact',
          cmc: 2,
        },
        {
          id: 'bf-filter-enchantment',
          name: 'Filter Enchantment',
          controller: controllerId,
          owner: controllerId,
          type_line: 'Enchantment',
          cmc: 3,
        },
        {
          id: 'bf-filter-creature',
          name: 'Filter Creature',
          controller: opponentId,
          owner: opponentId,
          type_line: 'Creature — Goblin',
          cmc: 1,
        },
      ],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], { controllerId, sourceId: 'test' });
    expect(result.automationGaps || []).toHaveLength(0);
    expect(result.state.battlefield || []).toHaveLength(1);
    expect((result.state.players.find((p) => p.id === controllerId)?.hand || []).length).toBe(1);
    expect((result.state.players.find((p) => p.id === opponentId)?.hand || []).length).toBe(1);
  });
});
