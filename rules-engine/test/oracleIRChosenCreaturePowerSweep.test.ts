import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import type { GameState } from '../../shared/src/index.js';

// Quoted from mtg_data.db cards.text WHERE is_token = 0 (2026-08-25).
const NIBELHEIM_AFLAME =
  'Choose target creature you control. It deals damage equal to its power to each other creature. If this spell was cast from a graveyard, discard your hand and draw four cards.\nFlashback {5}{R}{R} (You may cast this card from your graveyard for its flashback cost. Then exile it.)';

function collectSpellSteps(text: string, name: string) {
  const ir = parseOracleTextToIR(text, name);
  return (ir.abilities || [])
    .filter((ability) => String(ability.type || '') === 'spell' || String(ability.type || '') === '')
    .flatMap((ability) => ability.steps || [])
    .filter((step) => {
      const raw = String((step as { raw?: string }).raw || '').toLowerCase();
      return !/flashback/.test(raw) && !/^then exile it$/.test(raw.trim());
    });
}

function makeCreature(id: string, controller: string, power: string, toughness: string, name: string) {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    damageMarked: 0,
    card: {
      id: `${id}_card`,
      name,
      type_line: 'Creature',
      power,
      toughness,
    },
  };
}

function makeState(): GameState {
  return {
    players: [
      {
        id: 'p1',
        hand: [
          { id: 'hand_1', name: 'Spare Mountain' },
          { id: 'hand_2', name: 'Spare Bolt' },
        ],
        library: [
          { id: 'draw_1', name: 'Mountain' },
          { id: 'draw_2', name: 'Shock' },
          { id: 'draw_3', name: 'Faithless Looting' },
          { id: 'draw_4', name: 'Tormenting Voice' },
        ],
        graveyard: [],
      },
      { id: 'p2', hand: [], library: [], graveyard: [] },
    ],
    battlefield: [
      makeCreature('src_1', 'p1', '3', '3', 'Ifrit'),
      makeCreature('ally_1', 'p1', '5', '5', 'Allied Giant'),
      makeCreature('opp_1', 'p2', '4', '4', 'Enemy Beast'),
    ],
  } as unknown as GameState;
}

describe('chosen-creature power sweep (Nibelheim Aflame family)', () => {
  it('parses choose + deal_damage + graveyard-only discard/draw', () => {
    const steps = collectSpellSteps(NIBELHEIM_AFLAME, 'Nibelheim Aflame');
    expect(steps.map((step) => step.kind)).toEqual(['choose_target_creature', 'deal_damage', 'conditional']);
    expect(steps[1]).toMatchObject({
      kind: 'deal_damage',
      amount: { kind: 'object_stat', stat: 'power' },
      source: { kind: 'raw', text: 'It' },
      target: { kind: 'raw', text: 'each other creature' },
    });
    const rider = steps[2] as { condition?: { raw?: string }; steps?: Array<{ kind: string }> };
    expect(String(rider.condition?.raw || '').toLowerCase()).toContain('this spell was cast from a graveyard');
    expect((rider.steps || []).map((step) => step.kind)).toEqual(['discard', 'draw']);
  });

  it('deals the chosen creature\'s power to each other creature and skips the hand rider from hand', () => {
    const steps = collectSpellSteps(NIBELHEIM_AFLAME, 'Nibelheim Aflame');
    const result = applyOracleIRStepsToGameState(
      makeState(),
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1',
        sourceId: 'spell_1',
        sourceName: 'Nibelheim Aflame',
        sourceObjectType: 'spell',
        targetCreatureId: 'src_1',
        targetPermanentId: 'src_1',
        selectorContext: { chosenObjectIds: ['src_1'], targetCreatureId: 'src_1', targetPermanentId: 'src_1' },
      }),
    );

    expect(result.appliedSteps.some((step) => step.kind === 'deal_damage')).toBe(true);
    expect(result.appliedSteps.some((step) => step.kind === 'discard')).toBe(false);
    expect(result.appliedSteps.some((step) => step.kind === 'draw')).toBe(false);

    const battlefield = ((result.state as any).battlefield || []) as any[];
    expect(Number(battlefield.find((entry) => entry.id === 'src_1')?.damageMarked || 0)).toBe(0);
    expect(Number(battlefield.find((entry) => entry.id === 'ally_1')?.damageMarked || 0)).toBe(3);
    expect(Number(battlefield.find((entry) => entry.id === 'opp_1')?.damageMarked || 0)).toBe(3);
    expect(((result.state as any).players[0].hand || []).map((card: any) => card.id)).toEqual(['hand_1', 'hand_2']);
  });

  it('applies discard-hand and draw-four only when the spell was cast from a graveyard', () => {
    const steps = collectSpellSteps(NIBELHEIM_AFLAME, 'Nibelheim Aflame');
    const result = applyOracleIRStepsToGameState(
      makeState(),
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1',
        sourceId: 'spell_1',
        sourceName: 'Nibelheim Aflame',
        sourceObjectType: 'spell',
        castFromZone: 'graveyard',
        targetCreatureId: 'src_1',
        targetPermanentId: 'src_1',
        selectorContext: { chosenObjectIds: ['src_1'], targetCreatureId: 'src_1', targetPermanentId: 'src_1' },
      }),
    );

    const battlefield = ((result.state as any).battlefield || []) as any[];
    expect(Number(battlefield.find((entry) => entry.id === 'src_1')?.damageMarked || 0)).toBe(0);
    expect(Number(battlefield.find((entry) => entry.id === 'ally_1')?.damageMarked || 0)).toBe(3);
    expect(Number(battlefield.find((entry) => entry.id === 'opp_1')?.damageMarked || 0)).toBe(3);
    expect(((result.state as any).players[0].hand || []).map((card: any) => card.id)).toEqual([
      'draw_1',
      'draw_2',
      'draw_3',
      'draw_4',
    ]);
    expect(((result.state as any).players[0].graveyard || []).map((card: any) => card.id).sort()).toEqual([
      'hand_1',
      'hand_2',
    ]);
  });
});
