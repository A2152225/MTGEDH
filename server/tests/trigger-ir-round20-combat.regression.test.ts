import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import { getDeathTriggers } from '../src/state/modules/triggers/death-emission.js';
import { finalizeIrEventWatchers, prepareIrEventWatchers } from '../src/state/modules/triggers/irEventWatchers.js';
import { resolveCreaturesBlockedByPermanent } from '../../rules-engine/src/oracleIRExecutorCreatureStepUtils-handlers/oracleIRExecutorCreatureBattlefieldHelpers';
import { parseTriggerClause } from '../../rules-engine/src/triggerCondition/index';

const perm = (id: string, controller: string, card: any, extra: any = {}) => ({ id, controller, owner: controller, tapped: false, counters: {}, card: { id: id + '_c', ...card }, ...extra });
function game() {
  const g: any = createInitialGameState('t20c_' + Math.random());
  g.applyEvent({ type: 'join', playerId: 'p1', name: 'P1' });
  g.applyEvent({ type: 'join', playerId: 'p2', name: 'P2' });
  g.state.turnPlayer = 'p2'; g.state.phase = 'main1'; g.state.step = 'main';
  return g;
}
const MEMBRANE = { name: 'Cathedral Membrane', type_line: 'Artifact Creature - Phyrexian Wall', oracle_text: 'Defender\nWhen Cathedral Membrane dies during combat, it deals 6 damage to each creature it blocked this combat.' };

describe('round 20: dies during combat', () => {
  it('parses as a dies trigger flagged duringCombat', () => {
    const parsed: any = parseTriggerClause('When Cathedral Membrane dies during combat, it deals 6 damage to each creature it blocked this combat.', 'Cathedral Membrane');
    expect(parsed?.condition?.event).toBe('dies');
    expect(parsed?.condition?.duringCombat).toBe(true);
  });

  it('triggers only during combat and remembers what it blocked', () => {
    const g = game();
    const wall = perm('wall', 'p1', MEMBRANE, { blocking: ['atk'] });
    g.state.battlefield.push(wall, perm('atk', 'p2', { name: 'Bear', type_line: 'Creature - Bear', oracle_text: '' }));
    expect(getDeathTriggers(g, wall, 'p1').length).toBe(0);
    g.state.phase = 'combat'; g.state.step = 'combatDamage';
    const res = getDeathTriggers(g, wall, 'p1');
    expect(res.length).toBe(1);
    expect(g.state.lastKnownBlockingById?.wall).toEqual(['atk']);
    g.state.battlefield = g.state.battlefield.filter((p: any) => p.id !== 'wall');
    expect(resolveCreaturesBlockedByPermanent(g.state, 'wall')).toEqual(['atk']);
  });
});

describe('round 20: cast a spell of listed colors', () => {
  it('keeps every listed color and the real effect', () => {
    for (const text of ['Whenever you cast a white, blue, black, or red spell, put a +1/+1 counter on Quirion Dryad.', "Whenever you cast a spell that's white, blue, black, or red, put a +1/+1 counter on Questing Druid."]) {
      const parsed: any = parseTriggerClause(text, 'X');
      expect(parsed?.condition?.alternatives?.[0]?.subject?.colors).toEqual(['w', 'u', 'b', 'r']);
      expect(parsed?.effect).toMatch(/^put a \+1\/\+1 counter/);
    }
  });
});

describe('round 20: connive triggers wait for a deferred connive', () => {
  const setup = () => {
    const g = game();
    g.state.battlefield.push(perm('c1', 'p1', { name: 'Conniver', type_line: 'Creature - Rogue', oracle_text: 'Whenever Conniver connives, you gain 2 life.' }));
    const step: any = { kind: 'connive', raw: 'Conniver connives', amount: { kind: 'number', value: 1 }, target: { kind: 'raw', text: 'this creature' } };
    const prep = prepareIrEventWatchers([step]);
    return { g, step, prep, irCtx: { controllerId: 'p1', sourceId: 'c1', sourceName: 'Conniver', targetPermanentId: 'c1' } };
  };
  const count = (g: any) => (g.state.stack || []).filter((s: any) => /gain 2 life/i.test(String(s?.description || s?.effect || ''))).length;
  it('does not trigger while the connive waits for the discard choice', () => {
    const { g, prep, irCtx } = setup();
    finalizeIrEventWatchers(g, prep.steps, prep.pending, irCtx, { automationGaps: [{ stepKind: 'connive', raw: 'Conniver connives', reasonCode: 'player_choice_required' }] });
    expect(count(g)).toBe(0);
  });
  it('triggers once the connive step is actually applied', () => {
    const { g, prep, irCtx } = setup();
    finalizeIrEventWatchers(g, prep.steps, prep.pending, irCtx, { automationGaps: [] });
    expect(count(g)).toBe(1);
  });
});
