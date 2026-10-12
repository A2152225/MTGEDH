import { describe, expect, it } from 'vitest';
import { createInitialGameState } from '../src/state/gameState.js';
import { createToken } from '../src/state/modules/counters_tokens.js';
import { syncDerivedContinuousEffects } from '../src/state/modules/staticEffectSpec.js';
import { getCurrentPowerToughnessForRules } from '../src/state/modules/currentPowerToughness.js';
import { gateClassOracleTextForLevel } from '../../shared/src/classLevelText.js';
import type { PlayerID } from '../../shared/src';

// Issue #52 (game_mv4dicck): Caretaker's Talent's level 3 static ("Creature tokens you control
// get +2/+2") applied while the Class was still level 1. CR 716: only sections <= level count.
const CARETAKER = "(Gain the next level as a sorcery to add its ability.)\nWhenever one or more tokens you control enter, draw a card. This ability triggers only once each turn.\n{W}: Level 2\nWhen this Class becomes level 2, create a token that's a copy of target token you control.\n{3}{W}: Level 3\nCreature tokens you control get +2/+2.";
const a = 'a' as PlayerID;

function setup(level?: number) {
  const game: any = createInitialGameState(`t_class_${Math.random().toString(36).slice(2, 7)}`);
  game.applyEvent({ type: 'join', playerId: a, name: 'A' });
  game.state.turnPlayer = a;
  game.state.phase = 'precombatMain';
  game.state.step = 'MAIN1';
  game.state.stack = [];
  game.state.battlefield.push({
    id: 'ct', controller: a, owner: a, tapped: false, counters: {},
    ...(level ? { level } : {}),
    card: { id: 'ct_c', name: "Caretaker's Talent", type_line: 'Enchantment - Class', oracle_text: CARETAKER },
  });
  createToken(game, a, 'Soldier', 1, 1, 1, { colors: ['W'], typeLine: 'Token Creature - Soldier' });
  game.state.stack = [];
  syncDerivedContinuousEffects(game.state);
  const token = game.state.battlefield.find((p: any) => p.isToken);
  return { game, token, cls: game.state.battlefield.find((p: any) => p.id === 'ct') };
}

describe("Class level gating (#52, Caretaker's Talent)", () => {
  it('splits sections by level headers', () => {
    const l1 = gateClassOracleTextForLevel(CARETAKER, 1);
    expect(l1).toContain('{W}: Level 2');
    expect(l1).not.toContain('Level 3');
    expect(l1).not.toContain('becomes level 2');
    expect(l1).not.toContain('+2/+2');
    const l2 = gateClassOracleTextForLevel(CARETAKER, 2);
    expect(l2).toContain('{3}{W}: Level 3');
    expect(l2).not.toContain('{W}: Level 2');
    expect(l2).toContain('becomes level 2');
    expect(l2).not.toContain('+2/+2');
    const l3 = gateClassOracleTextForLevel(CARETAKER, 3);
    expect(l3).toContain('+2/+2');
    expect(l3).not.toMatch(/: Level \d/);
  });

  it('at level 1 gives no +2/+2 and offers only the level 2 ability', () => {
    const { game, token, cls } = setup();
    expect(getCurrentPowerToughnessForRules(token, game.state).power).toBe(1);
    expect(cls.card.oracle_text).not.toContain('Level 3');
    expect(cls.card.classFullOracleText).toBe(CARETAKER);
  });

  it('at level 3 gives creature tokens +2/+2', () => {
    const { game, token } = setup(3);
    const pt = getCurrentPowerToughnessForRules(token, game.state);
    expect(pt.power).toBe(3);
    expect(pt.toughness).toBe(3);
  });

  it('leveling up applies immediately at the next sync', () => {
    const { game, token, cls } = setup(2);
    expect(getCurrentPowerToughnessForRules(token, game.state).power).toBe(1);
    cls.level = 3;
    syncDerivedContinuousEffects(game.state);
    expect(getCurrentPowerToughnessForRules(token, game.state).power).toBe(3);
  });
});
