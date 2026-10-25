import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import type { PlayerID } from '../../shared/src';
import { computeCurrentPowerToughnessWithSources, getCurrentPowerToughness } from '../src/state/modules/currentPowerToughness.js';
import { getEffectivePower as goadEffectivePower } from '../src/state/modules/goad-effects.js';
import { getEffectivePower as socketEffectivePower, getEffectiveToughness as socketEffectiveToughness } from '../src/socket/util-handlers/getEffectivePowerToughness.js';
import { allocateTimestamp, stampPermanentEntryTimestamp } from '../../rules-engine/src/permanentTimestamps.js';
import { syncDerivedContinuousEffects } from '../src/state/modules/staticEffectSpec.js';

const p1 = 'p1' as PlayerID;
const emptyZone = () => ({ hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 });

function setup(id: string) {
  const g = createInitialGameState(id);
  const s: any = g.state;
  s.players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
  s.turnOrder = [p1]; s.turnPlayer = p1; s.activePlayer = p1; s.stack = [];
  s.zones = { [p1]: emptyZone() };
  s.battlefield = [];
  return s;
}
function enter(s: any, perm: any) {
  s.battlefield.push(perm);
  stampPermanentEntryTimestamp(s, perm);
  delete s._derivedContinuousEffects;
  syncDerivedContinuousEffects(s);
  return perm;
}
const bear = () => ({ id: 'bear', owner: p1, controller: p1, tapped: false, counters: {}, modifiers: [] as any[],
  card: { id: 'bear_c', name: 'Grizzly Bears', type_line: 'Creature \u2014 Bear', power: '2', toughness: '2', oracle_text: '', zone: 'battlefield' } } as any);
const humility = () => ({ id: 'humility', owner: p1, controller: p1, tapped: false, counters: {},
  card: { id: 'hum_c', name: 'Humility', type_line: 'Enchantment', oracle_text: 'All creatures lose all abilities and have base power and toughness 1/1.', zone: 'battlefield' } } as any);
const setter = (s: any, power: number, toughness: number) => ({ type: 'setPowerToughness', setPower: power, setToughness: toughness, duration: 'end_of_turn',
  sourceId: 'becomes_' + power, timestamp: allocateTimestamp(s), globalTimestamp: true });
const pt = (s: any, id = 'bear') => { const p = s.battlefield.find((x: any) => x.id === id); return getCurrentPowerToughness(p, s); };

describe('layer 7 P/T evaluator (7a -> 7b timestamp -> 7c -> 7d)', () => {
  it('Humility, then a later "becomes 4/4": the later setter wins', () => {
    const s = setup('t_l7_hum_then_set');
    const b = enter(s, bear());
    enter(s, humility());
    expect(pt(s)).toEqual({ power: 1, toughness: 1 });
    b.modifiers.push(setter(s, 4, 4));
    expect(pt(s)).toEqual({ power: 4, toughness: 4 });
  });

  it('"becomes 4/4", then Humility: Humility wins', () => {
    const s = setup('t_l7_set_then_hum');
    const b = enter(s, bear());
    b.modifiers.push(setter(s, 4, 4));
    expect(pt(s)).toEqual({ power: 4, toughness: 4 });
    enter(s, humility());
    expect(pt(s)).toEqual({ power: 1, toughness: 1 });
  });

  it('two setters: the later timestamp wins and counters still apply on top (7c)', () => {
    const s = setup('t_l7_two_setters');
    const b = enter(s, bear());
    b.modifiers.push(setter(s, 5, 5));
    b.modifiers.push(setter(s, 0, 3));
    b.counters = { '+1/+1': 1 };
    expect(pt(s)).toEqual({ power: 1, toughness: 4 });
  });

  it('a switch after a pump swaps the pumped values (7d after 7c)', () => {
    const s = setup('t_l7_switch_after_pump');
    const b = enter(s, bear());
    b.temporaryPTMods = [{ power: 3, toughness: 0, source: 'Giant Growth-ish', until: 'end_of_turn' }];
    expect(pt(s)).toEqual({ power: 5, toughness: 2 });
    b.modifiers.push({ type: 'switchPowerToughness', sourceId: 'twisted', duration: 'end_of_turn' });
    expect(pt(s)).toEqual({ power: 2, toughness: 5 });
    b.modifiers.push({ type: 'switchPowerToughness', sourceId: 'twisted2', duration: 'end_of_turn' });
    expect(pt(s)).toEqual({ power: 5, toughness: 2 });
  });

  it('the view tooltip value equals the combat/goad value', () => {
    const s = setup('t_l7_view_combat');
    const b = enter(s, bear());
    enter(s, humility());
    b.modifiers.push(setter(s, 4, 4));
    b.counters = { '+1/+1': 2 };
    b.modifiers.push({ type: 'switchPowerToughness', sourceId: 'twisted', duration: 'end_of_turn' });
    b.temporaryPTMods = [{ power: 1, toughness: 0, source: 'pump', until: 'end_of_turn' }];
    const view = computeCurrentPowerToughnessWithSources(b, s)!;
    expect({ power: view.power, toughness: view.toughness }).toEqual({ power: 6, toughness: 7 });
    expect(socketEffectivePower(b, s)).toBe(view.power);
    expect(socketEffectiveToughness(b, s)).toBe(view.toughness);
    expect(goadEffectivePower(b, s)).toBe(view.power);
  });
});
