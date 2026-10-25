import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import { parseTriggerClause } from '../../rules-engine/src/triggerCondition/index.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParserParseOracleTextToIR.js';
import { parseReflexiveRepeatCostPayment, materializeThatManyCount, isRepeatCostPaymentUnit } from '../src/state/modules/reflexiveRepeatCostPayment.js';
import { prepareIrEventWatchers, finalizeIrEventWatchers, pollIrEventWatchers } from '../src/state/modules/triggers/irEventWatchers.js';
import { applyPermanentKeywordEvents } from '../src/state/modules/apply-event-handlers/applyEventPermanentKeywordEvents.js';

const perm = (id: string, controller: string, card: any, extra: any = {}) => ({ id, controller, owner: controller, tapped: false, counters: {}, card: { id: id + '_c', ...card }, ...extra });
function game() {
  const g: any = createInitialGameState('t19r_' + Math.random());
  g.applyEvent({ type: 'join', playerId: 'p1', name: 'P1' });
  g.applyEvent({ type: 'join', playerId: 'p2', name: 'P2' });
  g.state.turnPlayer = 'p1'; g.state.phase = 'main1'; g.state.step = 'main';
  return g;
}
const steps = (text: string) => parseOracleTextToIR(text, 'X').abilities.flatMap((a: any) => a.steps);

describe('trigger IR round 19', () => {
  it('crew trigger is bound to the crewed vehicle', () => {
    const g = game();
    g.state.battlefield.push(
      perm('vm', 'p1', { name: 'Veteran Motorist', type_line: 'Creature - Dwarf Pilot', power: '3', toughness: '2', oracle_text: 'Whenever this creature crews a Vehicle, that Vehicle gets +1/+1 until end of turn.' }),
      perm('v2', 'p1', { name: 'Copter B', type_line: 'Artifact - Vehicle', power: '3', toughness: '3', oracle_text: 'Crew 1' }),
    );
    applyPermanentKeywordEvents(g, { type: 'crewVehicle', playerId: 'p1', vehicleId: 'v2', crewerIds: ['vm'] } as any);
    const item = (g.state.stack || []).find((s: any) => /that vehicle/i.test(String(s?.description || '')));
    expect(item).toBeTruthy();
    expect(JSON.stringify(item)).toContain('v2');
  });

  it('Metropolis Angel attack-with-counters parses', () => {
    const p: any = parseTriggerClause('whenever you attack with one or more creatures with counters on them, draw a card.', 'X');
    expect(p?.condition?.event).toBe('attacks');
    expect(p.condition.alternatives[0].subject.counters).toEqual([{ minimum: 1 }]);
  });

  it('Adversary repeat payment and that many', () => {
    const r: any = parseReflexiveRepeatCostPayment('you may pay {1}{w} any number of times. when you pay this cost one or more times, put that many +1/+1 counters on target creature.');
    expect(r?.cost?.toLowerCase()).toBe('{1}{w}');
    expect(isRepeatCostPaymentUnit('{1}{G}')).toBe(true);
    expect(materializeThatManyCount('create twice that many tokens', 3)).toContain('6');
  });

  it('next end of combat and leaves-this-turn IR', () => {
    const a = steps('Destroy target creature at end of combat.').concat(steps('At this turn\'s next end of combat, destroy that creature.'));
    expect(JSON.stringify(a)).toContain('next_end_of_combat');
    const b = steps('Target creature gets +1/+1 until end of turn. When that creature leaves the battlefield this turn, sacrifice this creature.');
    expect(JSON.stringify(b)).toContain('on_event');
    const g = game();
    g.state.battlefield.push(perm('zz', 'p2', { name: 'Z', type_line: 'Creature - Bear', power: '2', toughness: '2', oracle_text: '' }));
    const prep = prepareIrEventWatchers(b);
    finalizeIrEventWatchers(g, prep.steps, prep.pending, { sourceId: 'src', controllerId: 'p1', targetPermanentId: 'zz' });
    expect(g.state.leavesThisTurnWatchers?.[0]?.watchedId).toBe('zz');
  });

  it('connive triggers queue for the connived creature', () => {
    const g = game();
    g.state.battlefield.push(
      perm('c1', 'p1', { name: 'Sneak', type_line: 'Creature - Rogue', power: '1', toughness: '1', oracle_text: '' }),
      perm('w1', 'p1', { name: 'Watcher', type_line: 'Creature - Human', power: '1', toughness: '1', oracle_text: 'Whenever a creature you control connives, put a +1/+1 counter on it.' }),
    );
    const s = steps('Target creature you control connives.');
    const prep = prepareIrEventWatchers(s);
    finalizeIrEventWatchers(g, prep.steps, prep.pending, { sourceId: 'x', controllerId: 'p1', targetPermanentId: 'c1' });
    expect(JSON.stringify(g.state.stack || [])).toContain('c1');
  });

  it('regeneration rider fires once the shield is used, leave watcher fires on leave', () => {
    const g = game();
    g.state.battlefield.push(perm('r1', 'p1', { name: 'Regen', type_line: 'Creature - Troll', power: '2', toughness: '2', oracle_text: '' }));
    const prep = prepareIrEventWatchers(steps('Regenerate target creature. When it regenerates this way, tap it.'));
    expect(prep.pending.regenRiders.length).toBe(1);
    g.state.regenerationShields = [{ id: 's1', permanentId: 'r1', controllerId: 'p1', isUsed: false }];
    finalizeIrEventWatchers(g, prep.steps, prep.pending, { sourceId: 'src', controllerId: 'p1', targetPermanentId: 'r1' });
    const before = (g.state.stack || []).length;
    g.state.regenerationShields[0].isUsed = true;
    expect(pollIrEventWatchers(g)).toBe(1);
    expect(pollIrEventWatchers(g)).toBe(0);
    expect((g.state.stack || []).length).toBe(before + 1);

    g.state.leavesThisTurnWatchers = [{ watchedId: 'r1', effect: 'draw a card', sourceId: 'src', sourceName: 'S', controller: 'p1', turn: g.state.turnNumber ?? g.state.turn }];
    expect(pollIrEventWatchers(g)).toBe(0);
    g.state.battlefield = g.state.battlefield.filter((p: any) => p.id !== 'r1');
    expect(pollIrEventWatchers(g)).toBe(1);
  });
});
