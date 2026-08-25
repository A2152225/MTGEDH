import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import type { GameState } from '../../shared/src/index.js';

// Quoted from mtg_data.db cards.text WHERE is_token = 0.
const SKULLCRACK_ORACLE =
  "Players can't gain life this turn. Damage can't be prevented this turn. Skullcrack deals 3 damage to target player or planeswalker.";
const ATARKAS_COMMAND_MODE = "Your opponents can't gain life this turn.";
const TARGET_PLAYER_THIS_TURN = "Target player can't gain life this turn.";
const PLAYERS_UNTIL_EOT = "Players can't gain life until end of turn.";
const ROILING_VORTEX_ACTIVATION = "{R}: Your opponents can't gain life this turn.";
const DETECTION_TOWER_STYLE =
  "{1}, {T}: Until end of turn, your opponents can't gain life.";
const CONTINUOUS_PLAYERS = "Players can't gain life.";
const CONTINUOUS_OPPONENTS = "Your opponents can't gain life.";

function collectGrantSteps(text: string, name: string) {
  const ir = parseOracleTextToIR(text, name);
  return (ir.abilities || []).flatMap((ability) => ability.steps || [])
    .filter((step) => step.kind === 'grant_static_ability');
}

function makeState(): GameState {
  return {
    id: 'prevent-life-gain-this-turn',
    format: 'commander',
    players: [
      { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [] },
      { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [] },
      { id: 'p3', name: 'P3', seat: 2, life: 40, library: [], hand: [], graveyard: [] },
    ],
    battlefield: [],
    stack: [],
    turnPlayer: 'p1',
    priority: 'p1',
    active: true,
  } as unknown as GameState;
}

function applyGrants(
  text: string,
  sourceName: string,
  extraCtx: Record<string, unknown> = {},
) {
  const steps = collectGrantSteps(text, sourceName)
    .filter((step) => {
      const duration = String((step as { duration?: string }).duration || '');
      return duration === 'this_turn' || duration === 'end_of_turn';
    });
  return applyOracleIRStepsToGameState(
    makeState(),
    steps,
    buildOracleIRExecutionContext({
      controllerId: 'p1',
      sourceId: 'spell_1',
      sourceName,
      sourceObjectType: 'spell',
      ...extraCtx,
    } as any),
  );
}

describe('this-turn prevent life gain oracle IR', () => {
  it('parses Skullcrack players-this-turn as grant_static_ability duration this_turn', () => {
    const grants = collectGrantSteps(SKULLCRACK_ORACLE, 'Custom Bloodcrack');
    const lock = grants.find((step) => {
      const text = Array.isArray((step as { effectText?: string[] }).effectText)
        ? String((step as { effectText?: string[] }).effectText?.[0] || '')
        : '';
      return text.toLowerCase().includes("can't gain life");
    }) as { duration?: string; target?: { text?: string } } | undefined;
    expect(lock).toBeTruthy();
    expect(lock?.duration).toBe('this_turn');
    expect(String(lock?.target?.text || '').toLowerCase()).toBe('each player');
  });

  it('parses Atarka opponents-this-turn mode with duration this_turn', () => {
    const grants = collectGrantSteps(ATARKAS_COMMAND_MODE, "Atarka's Command");
    expect(grants).toEqual([
      expect.objectContaining({
        kind: 'grant_static_ability',
        effectText: ["can't gain life"],
        duration: 'this_turn',
        target: expect.objectContaining({ text: 'your opponents' }),
      }),
    ]);
  });

  it('parses target-player this-turn and trailing until-EOT as this_turn / end_of_turn', () => {
    expect(collectGrantSteps(TARGET_PLAYER_THIS_TURN, 'Custom Target Lock')[0]).toMatchObject({
      duration: 'this_turn',
      target: expect.objectContaining({ text: 'target player' }),
    });
    expect(collectGrantSteps(PLAYERS_UNTIL_EOT, 'Custom Until EOT Lock')[0]).toMatchObject({
      duration: 'end_of_turn',
      target: expect.objectContaining({ text: 'each player' }),
    });
  });

  it('parses this-turn activations and leading until-EOT activations', () => {
    const vortex = collectGrantSteps(ROILING_VORTEX_ACTIVATION, 'Roiling Vortex');
    expect(vortex).toEqual([
      expect.objectContaining({
        duration: 'this_turn',
        effectText: ["can't gain life"],
      }),
    ]);
    const untilEotActivation = collectGrantSteps(DETECTION_TOWER_STYLE, 'Custom Detection Lock');
    expect(untilEotActivation).toEqual([
      expect.objectContaining({
        duration: 'end_of_turn',
        effectText: ["can't gain life"],
        target: expect.objectContaining({ text: 'your opponents' }),
      }),
    ]);
  });

  it('leaves continuous players/opponents can\'t-gain as static (or pruned), not this_turn', () => {
    const players = collectGrantSteps(CONTINUOUS_PLAYERS, 'Leyline of Punishment');
    expect(players.every((step) => String((step as { duration?: string }).duration || '') !== 'this_turn')).toBe(true);
    const opponents = collectGrantSteps(CONTINUOUS_OPPONENTS, 'Erebos, God of the Dead');
    expect(opponents).toEqual([
      expect.objectContaining({
        duration: 'static',
        effectText: ["can't gain life"],
      }),
    ]);
  });

  it('stamps lastingEffects.preventLifeGain for each player on Skullcrack', () => {
    const result = applyGrants(SKULLCRACK_ORACLE, 'Custom Bloodcrack');
    expect(result.appliedSteps.map((step) => step.kind)).toContain('grant_static_ability');
    expect((result.state as any).lastingEffects).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'preventLifeGain', duration: 'this_turn', targetPlayer: 'p1', source: 'Custom Bloodcrack' }),
      expect.objectContaining({ type: 'preventLifeGain', duration: 'this_turn', targetPlayer: 'p2', source: 'Custom Bloodcrack' }),
      expect.objectContaining({ type: 'preventLifeGain', duration: 'this_turn', targetPlayer: 'p3', source: 'Custom Bloodcrack' }),
    ]));
  });

  it('stamps opponents only for Atarka this-turn mode', () => {
    const result = applyGrants(ATARKAS_COMMAND_MODE, "Atarka's Command");
    const stamped = ((result.state as any).lastingEffects || []) as Array<{ targetPlayer?: string }>;
    expect(stamped.map((entry) => entry.targetPlayer).sort()).toEqual(['p2', 'p3']);
  });

  it('stamps the bound target player', () => {
    const result = applyGrants(TARGET_PLAYER_THIS_TURN, 'Custom Target Lock', {
      targetPlayerId: 'p2',
      selectorContext: { targetPlayerId: 'p2' },
    });
    expect((result.state as any).lastingEffects).toEqual([
      expect.objectContaining({ type: 'preventLifeGain', targetPlayer: 'p2' }),
    ]);
  });

  it('does not stamp Alchemy A- this-turn sources', () => {
    const result = applyGrants(ATARKAS_COMMAND_MODE, 'A-Custom Blood Command');
    expect((result.state as any).lastingEffects || []).toEqual([]);
  });

  it('stamps leading until-EOT activations as end_of_turn preventLifeGain', () => {
    const result = applyGrants(DETECTION_TOWER_STYLE, 'Custom Detection Lock');
    const stamped = ((result.state as any).lastingEffects || []) as Array<{
      duration?: string;
      targetPlayer?: string;
    }>;
    expect(stamped.map((entry) => entry.targetPlayer).sort()).toEqual(['p2', 'p3']);
    expect(stamped.every((entry) => entry.duration === 'end_of_turn')).toBe(true);
  });
});
