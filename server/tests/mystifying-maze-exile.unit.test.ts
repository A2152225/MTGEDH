import { describe, expect, it } from 'vitest';
import { parseAbilityTargeting } from '../src/rules-engine/targeting.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { applyOracleIRStepsToGameState } from '../../rules-engine/src/oracleIRExecutor.js';
import { isPermanentCurrentlyAttacking } from '../src/state/modules/triggeredAbilityBattlefieldTargetMatch.js';

const MAZE_EFFECT =
  "Exile target attacking creature an opponent controls. At the beginning of the next end step, return it to the battlefield tapped under its owner's control.";
const MAZE_ORACLE =
  `{T}: Add {C}.\n{4}, {T}: ${MAZE_EFFECT}`;

describe('Mystifying Maze exile targeting', () => {
  it('parseAbilityTargeting recognizes attacking opponent creature', () => {
    const parsed = parseAbilityTargeting(MAZE_EFFECT);
    expect(parsed).toEqual({
      targetType: 'creature',
      controllerOnly: false,
      opponentOnly: true,
      excludeSource: false,
      attackingOnly: true,
      description: 'target attacking creature an opponent controls',
    });
  });

  it('filters legal activation targets to attacking opponent creatures only', () => {
    const parsed = parseAbilityTargeting(MAZE_EFFECT)!;
    const pid = 'p1';
    const candidates = [
      { id: 'atk', controller: 'p2', attacking: 'p1', card: { type_line: 'Creature — Bear' } },
      { id: 'idle', controller: 'p2', card: { type_line: 'Creature — Bear' } },
      { id: 'mine', controller: 'p1', attacking: 'p2', card: { type_line: 'Creature — Bear' } },
    ];
    const legal = candidates.filter((target) => {
      const typeLine = String(target.card?.type_line || '').toLowerCase();
      if (parsed.targetType === 'creature' && !typeLine.includes('creature')) return false;
      if (parsed.controllerOnly && String(target.controller || '') !== pid) return false;
      if (parsed.opponentOnly && String(target.controller || '') === pid) return false;
      if (parsed.attackingOnly && !isPermanentCurrentlyAttacking(target)) return false;
      return true;
    });
    expect(legal.map((t) => t.id)).toEqual(['atk']);
  });

  it('IR exiles the chosen attacker and schedules next-end-step return', () => {
    const ir: any = parseOracleTextToIR(MAZE_ORACLE, 'Mystifying Maze');
    const ability = (ir.abilities || []).find((a: any) => String(a.cost || '').includes('{4}'));
    expect(ability?.steps?.map((s: any) => s.kind)).toEqual(['exile', 'schedule_delayed_trigger']);

    const maze = {
      id: 'maze', controller: 'p1', owner: 'p1',
      card: { name: 'Mystifying Maze', oracle_text: MAZE_ORACLE, type_line: 'Land' },
    };
    const attacker = {
      id: 'atk', controller: 'p2', owner: 'p2',
      attacking: 'p1', isAttacking: true,
      card: { name: 'Bear', type_line: 'Creature — Bear', power: '2', toughness: '2', oracle_text: '' },
    };
    const state: any = {
      battlefield: [maze, attacker],
      players: [{ id: 'p1' }, { id: 'p2' }],
      zones: {
        p1: { hand: [], library: [], graveyard: [], exile: [] },
        p2: { hand: [], library: [], graveyard: [], exile: [] },
      },
      turnNumber: 3,
      turnPlayer: 'p2',
    };

    const result: any = applyOracleIRStepsToGameState(state, ability.steps, {
      controllerId: 'p1',
      sourceId: 'maze',
      sourceName: 'Mystifying Maze',
      targetCreatureId: 'atk',
      targetPermanentId: 'atk',
      selectorContext: { chosenObjectIds: ['atk'] },
    } as any);

    expect((result.state.battlefield || []).map((p: any) => p.id)).toEqual(['maze']);
    const delayed = result.state.delayedTriggerRegistry?.triggers || [];
    expect(delayed).toHaveLength(1);
    expect(delayed[0].timing).toBe('next_end_step');
    expect(String(delayed[0].effect || '')).toMatch(/return it to the battlefield tapped under its owner's control/i);
    expect(delayed[0].targets).toEqual(['atk']);
  });
});
