import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { extractTriggeredEffectFromTimingMatch } from '../src/triggerEffectTextExtraction';

const ORACLE =
  'When this enchantment enters, suspect target creature an opponent controls. As long as this enchantment remains on the battlefield, that creature is also goaded.\nAt the beginning of combat on your turn, if two or more players have lost the game, gain control of all goaded and/or suspected creatures until end of turn. Untap them. They gain haste until end of turn.';

function combatSteps() {
  const match = ORACLE.match(/at the beginning of combat on your turn,?\s*([^.]+)/i);
  if (!match) throw new Error('missing beginning-of-combat clause');
  const effect = extractTriggeredEffectFromTimingMatch(ORACLE, match);
  const ir = parseOracleTextToIR(effect, 'Hot Pursuit');
  return ir.abilities.flatMap((ability) => ability.steps || []);
}

function creature(id: string, controller: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    controller,
    owner: controller,
    tapped: true,
    card: { name: id, type_line: 'Creature — Bear' },
    ...extra,
  };
}

function lostState(battlefield: any[]): GameState {
  return {
    players: [
      { id: 'p1', hasLost: false },
      { id: 'p2', hasLost: false },
      { id: 'p3', hasLost: true },
      { id: 'p4', hasLost: true },
    ],
    playersLostCount: 2,
    battlefield,
    turnNumber: 45,
  } as GameState;
}

function applyCombat(battlefield: any[], playersLostCount = 2) {
  const state = lostState(battlefield);
  (state as any).playersLostCount = playersLostCount;
  return applyOracleIRStepsToGameState(
    state,
    combatSteps(),
    {
      controllerId: 'p1' as PlayerID,
      sourceId: 'hot',
      sourceName: 'Hot Pursuit',
      sourceObjectType: 'ability',
      interactivePlayerChoices: true,
    },
    { haltOnPlayerChoiceRequired: true, allowOptional: true },
  );
}

function byId(state: GameState, id: string): any {
  return (state.battlefield || []).find((permanent: any) => permanent.id === id);
}

describe('Hot Pursuit beginning-of-combat control', () => {
  it('does not ask for a selection when nothing is goaded or suspected', () => {
    const result = applyCombat([
      { id: 'hot', controller: 'p1', card: { name: 'Hot Pursuit', type_line: 'Enchantment' } },
      creature('bear', 'p2'),
    ]);
    expect(result.automationGaps || []).toEqual([]);
    expect(result.pendingContinuationSteps || []).toEqual([]);
    expect(result.skippedSteps.map((step) => step.kind)).not.toContain('gain_control');
    expect(result.skippedSteps.map((step) => step.kind)).not.toContain('tap_or_untap');
    const bear = byId(result.state, 'bear');
    expect(bear.controller).toBe('p2');
    expect(bear.tapped).toBe(true);
    expect(bear.grantedAbilities || []).not.toContain('haste');
  });

  it('steals every goaded or suspected creature, untaps them, and grants haste', () => {
    const result = applyCombat([
      { id: 'hot', controller: 'p1', card: { name: 'Hot Pursuit', type_line: 'Enchantment' } },
      creature('goaded', 'p2', { goadedBy: ['p3'] }),
      creature('suspected', 'p2', { isSuspected: true }),
      creature('both', 'p1', { goadedBy: ['p2'], suspected: true }),
      creature('plain', 'p2'),
      { id: 'land', controller: 'p2', tapped: true, card: { name: 'Island', type_line: 'Basic Land — Island' } },
    ]);
    expect(result.automationGaps || []).toEqual([]);
    expect(result.appliedSteps.map((step) => step.kind)).toEqual([
      'gain_control',
      'tap_or_untap',
      'grant_temporary_ability',
    ]);
    for (const id of ['goaded', 'suspected', 'both']) {
      const permanent = byId(result.state, id);
      expect(permanent.controller).toBe('p1');
      expect(permanent.tapped).toBe(false);
      expect((permanent.grantedAbilities || []).map((ability: string) => String(ability).toLowerCase())).toContain('haste');
    }
    expect(byId(result.state, 'plain').controller).toBe('p2');
    expect(byId(result.state, 'plain').tapped).toBe(true);
    expect(byId(result.state, 'land').controller).toBe('p2');
    expect(byId(result.state, 'land').tapped).toBe(true);
  });

  it('does nothing when fewer than two players have lost', () => {
    const result = applyCombat([
      creature('goaded', 'p2', { goadedBy: ['p1'] }),
    ], 0);
    const goaded = byId(result.state, 'goaded');
    expect(goaded.controller).toBe('p2');
    expect(goaded.tapped).toBe(true);
    expect(result.automationGaps || []).toEqual([]);
  });
});
