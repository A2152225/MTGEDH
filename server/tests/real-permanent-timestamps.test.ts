import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { getCurrentPowerToughness } from '../src/state/modules/currentPowerToughness.js';
import { getStaticEffectSourceTimestamp } from '../src/state/modules/staticEffectSpec.js';
import { applyLayer7bSetBasePowerToughness } from '../src/state/modules/setBasePtTimestampResolution.js';
import {
  TIMESTAMP_BASE,
  allocateTimestamp,
  readAttachmentTimestamp,
  stampAttachmentTimestamp,
  stampMissingPermanentTimestamps,
  stampPermanentEntryTimestamp,
} from '../../rules-engine/src/permanentTimestamps.js';
import { applyTemporarySetBasePowerToughness } from '../../rules-engine/src/oracleIRExecutorCreatureStepUtils.js';

const p1 = 'p1' as PlayerID;

function setup(bf: any[]) {
  const game = createInitialGameState('real_timestamps');
  game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
  game.applyEvent!({ type: 'join', playerId: 'p2' as PlayerID, name: 'P2' } as any);
  const state: any = game.state;
  state.turnNumber = 3;
  state.turnPlayer = p1;
  state.battlefield = bf;
  return state;
}
const bear = (id: string, extra: any = {}) => ({
  id, controller: p1, owner: p1, tapped: false, counters: {},
  card: { id: `c-${id}`, name: `Bear ${id}`, type_line: 'Creature - Bear', oracle_text: '', power: '2', toughness: '2' },
  ...extra,
});
const aura = (id: string, attachedTo: string, extra: any = {}) => ({
  id, controller: p1, owner: p1, tapped: false, attachedTo,
  card: { id: `c-${id}`, name: 'Frog Shape', type_line: 'Enchantment - Aura', oracle_text: 'Enchant creature\nEnchanted creature has base power and toughness 1/1.' },
  ...extra,
});
const lord = (id: string, extra: any = {}) => ({
  id, controller: p1, owner: p1, tapped: false,
  card: { id: `c-${id}`, name: 'Setter Lord', type_line: 'Creature - Wizard', power: '1', toughness: '1', oracle_text: 'Other creatures you control have base power and toughness 5/5.' },
  ...extra,
});
const setter = (power: number, toughness: number, timestamp: number) => ({
  type: 'setPowerToughness', setPower: power, setToughness: toughness, duration: 'static', timestamp, globalTimestamp: true,
});

describe('real permanent timestamps (CR 613.7)', () => {
  it('stamps entry and attachment timestamps monotonically, idempotently, above the legacy scale', () => {
    const state = setup([bear('a'), bear('b'), aura('x', 'a')]);
    expect(stampMissingPermanentTimestamps(state)).toBe(4);
    const stamps = state.battlefield.map((p: any) => p.timestamp);
    expect(stamps[0]).toBeGreaterThan(TIMESTAMP_BASE);
    expect(stamps[1]).toBeGreaterThan(stamps[0]);
    expect(stamps[2]).toBeGreaterThan(stamps[1]);
    expect(state.battlefield[2].attachedTimestamp).toBeGreaterThan(stamps[2]);
    expect(stampMissingPermanentTimestamps(state)).toBe(0);
    const before = state.battlefield[2].attachedTimestamp;
    stampAttachmentTimestamp(state, state.battlefield[2]);
    expect(state.battlefield[2].attachedTimestamp).toBe(before);
    // re-attaching to another host is a new timestamp
    state.battlefield[2].attachedTo = 'b';
    stampAttachmentTimestamp(state, state.battlefield[2]);
    expect(state.battlefield[2].attachedTimestamp).toBeGreaterThan(before);
    expect(readAttachmentTimestamp(state.battlefield[2])).toBeDefined();
    // unattached: cleared
    state.battlefield[2].attachedTo = undefined;
    stampAttachmentTimestamp(state, state.battlefield[2]);
    expect(state.battlefield[2].attachedTimestamp).toBeUndefined();
    const fresh = bear('c');
    state.battlefield.push(fresh);
    stampPermanentEntryTimestamp(state, fresh);
    expect((fresh as any).timestamp).toBe(allocateTimestamp(state) - 1);
  });

  it('a static source uses its entry timestamp instead of its battlefield index', () => {
    const state = setup([lord('old'), lord('new')]);
    state.battlefield[0].timestamp = TIMESTAMP_BASE + 50;
    state.battlefield[1].timestamp = TIMESTAMP_BASE + 10;
    expect(getStaticEffectSourceTimestamp(state, 'old')).toBe(TIMESTAMP_BASE + 50);
    expect(getStaticEffectSourceTimestamp(state, 'new')).toBe(TIMESTAMP_BASE + 10);
    const legacy = setup([lord('a'), lord('b')]);
    expect(getStaticEffectSourceTimestamp(legacy, 'a')).toBe(0);
    expect(getStaticEffectSourceTimestamp(legacy, 'b')).toBe(1);
  });

  it('an Aura re-attached after a "becomes X/Y" setter beats it even though the Aura sits earlier in the battlefield', () => {
    const state = setup([
      aura('x', 'b', { timestamp: TIMESTAMP_BASE + 1, attachedTimestamp: TIMESTAMP_BASE + 30, attachedTimestampFor: 'b' }),
      bear('b', { timestamp: TIMESTAMP_BASE + 2, modifiers: [setter(7, 7, TIMESTAMP_BASE + 20)] }),
    ]);
    expect(applyLayer7bSetBasePowerToughness(state.battlefield[1], state, { power: 2, toughness: 2 })).toEqual({ power: 1, toughness: 1 });
    // same permanents, but the Aura was attached BEFORE the setter -> setter wins
    state.battlefield[0].attachedTimestamp = TIMESTAMP_BASE + 10;
    expect(applyLayer7bSetBasePowerToughness(state.battlefield[1], state, { power: 2, toughness: 2 })).toEqual({ power: 7, toughness: 7 });
    expect(getCurrentPowerToughness(state.battlefield[1], state)).toEqual({ power: 7, toughness: 7 });
  });

  it('a static set-base source that entered after the setter beats it (and loses when it entered before)', () => {
    const state = setup([
      bear('b', { timestamp: TIMESTAMP_BASE + 2, modifiers: [setter(7, 7, TIMESTAMP_BASE + 20)] }),
      lord('lord', { timestamp: TIMESTAMP_BASE + 30 }),
    ]);
    expect(applyLayer7bSetBasePowerToughness(state.battlefield[0], state, { power: 2, toughness: 2 })).toEqual({ power: 5, toughness: 5 });
    state.battlefield[1].timestamp = TIMESTAMP_BASE + 10;
    expect(applyLayer7bSetBasePowerToughness(state.battlefield[0], state, { power: 2, toughness: 2 })).toEqual({ power: 7, toughness: 7 });
  });

  it('rules-engine setters draw from the same counter: a later Aura attach beats an earlier setter', () => {
    const state = setup([bear('b'), lord('lord')]);
    const next = applyTemporarySetBasePowerToughness(state, 'b', { sourceId: 's', controllerId: p1 } as any, 3, 3, 'static') as any;
    const setterMod = next.battlefield[0].modifiers.find((m: any) => m.type === 'setPowerToughness');
    expect(setterMod.globalTimestamp).toBe(true);
    expect(setterMod.timestamp).toBeGreaterThan(next.battlefield[1].timestamp);
    expect(next.timestampCounter).toBe(setterMod.timestamp);
    // the lord entered earlier than the setter -> the setter wins
    expect(getCurrentPowerToughness(next.battlefield[0], next)).toEqual({ power: 3, toughness: 3 });
    // an Aura that enters/attaches afterwards gets a higher timestamp and wins
    const withAura = { ...next, battlefield: [...next.battlefield, aura('x', 'b')] };
    stampMissingPermanentTimestamps(withAura);
    expect(withAura.battlefield[2].attachedTimestamp).toBeGreaterThan(setterMod.timestamp);
    expect(getCurrentPowerToughness(withAura.battlefield[0], withAura)).toEqual({ power: 1, toughness: 1 });
  });

  it('two rules-engine setters resolve by timestamp even when created out of array order', () => {
    const state = setup([bear('b', { modifiers: [setter(9, 9, TIMESTAMP_BASE + 40), setter(4, 4, TIMESTAMP_BASE + 15)] })]);
    expect(getCurrentPowerToughness(state.battlefield[0], state)).toEqual({ power: 9, toughness: 9 });
  });

  it('legacy permanents without timestamps keep the battlefield-index behaviour (compat)', () => {
    const state = setup([
      bear('b', { modifiers: [{ type: 'setPowerToughness', setPower: 7, setToughness: 7, duration: 'static', timestamp: 1, battlefieldPosition: 2, battlefieldAnchorId: 'x' }] }),
      aura('x', 'b'),
    ]);
    // legacy setter recorded position 2 (after both permanents) and the Aura has no stamp -> legacy proxy: setter wins
    const base = applyLayer7bSetBasePowerToughness(state.battlefield[0], state, { power: 2, toughness: 2 });
    expect(base).toEqual({ power: 7, toughness: 7 });
    const plainAura = setup([bear('b'), aura('x', 'b')]);
    expect(applyLayer7bSetBasePowerToughness(plainAura.battlefield[0], plainAura, { power: 2, toughness: 2 })).toEqual({ power: 1, toughness: 1 });
  });
});