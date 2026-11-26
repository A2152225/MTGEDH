import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { calibrateSweepNoise, sweepActivatingPlayer, sweepOneCard } from '../scripts/outcome-sweep/sweepDriver.js';
import { initOutcomeSweepHarness, markSweepErrors, sweepErrorsSince } from '../scripts/outcome-sweep/sweepHarness.js';
import { reportHookFailure, resetHookFailures } from '../../shared/src/hookFailureReporter.js';
import { diffSweepSnapshots, takeSweepSnapshot } from '../scripts/outcome-sweep/sweepSnapshot.js';
import {
  diesTriggerLine, errorFamily, etbTriggerLine, zoneOnlyAbility, needsStackTarget, oracleFamily, untestedTriggerKinds,
} from '../scripts/outcome-sweep/sweepFamilies.js';
import { buildSweepSummary } from '../scripts/outcome-sweep/sweepReport.js';
import { compareSweepRuns } from '../scripts/outcome-sweep/sweepCompare.js';
import { parseSweepArgs } from '../scripts/outcome-sweep/sweepSelect.js';
import { activationXValue, findZoneAbilities } from '../scripts/outcome-sweep/sweepZoneAbilities.js';
import { seedCardResourceNeeds, seedCardTargetNeeds } from '../scripts/outcome-sweep/sweepBoard.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The sweep collects hook failures itself (and classifies them as throw), so opt out of the
// global vitest afterEach hook-failure check for this file.
process.env.MTGEDH_SKIP_HOOK_FAILURE_CHECK = '1';

describe('outcome sweep hook failure capture', () => {
  it('collects tripwire hook failures since a mark and groups them by tag', () => {
    const previousStrict = process.env.MTGEDH_STRICT_HOOKS;
    delete process.env.MTGEDH_STRICT_HOOKS;
    try {
      reportHookFailure('sweep.before_mark', new Error('earlier'));
      const mark = markSweepErrors();
      reportHookFailure('sweep.test_hook', new Error('boom'), { cardName: 'Sweep Card' });
      const errors = sweepErrorsSince(mark);
      expect(errors.filter((line) => line.startsWith('[hook-failure]'))).toHaveLength(1);
      expect(errors[0]).toMatch(/tag=sweep\.test_hook card=Sweep Card Error: boom/);
      expect(errorFamily(errors[0])).toBe('hook_failure:sweep.test_hook');
    } finally {
      if (previousStrict === undefined) delete process.env.MTGEDH_STRICT_HOOKS;
      else process.env.MTGEDH_STRICT_HOOKS = previousStrict;
      resetHookFailures();
    }
  });
});

describe('outcome sweep harness gaps', () => {
  it('sweeps cycling only for a cycling keyword with a cost, not text that mentions cycling', () => {
    const ids = (oracle_text: string) => findZoneAbilities({ name: 'Sweep Cycler', type_line: 'Artifact', oracle_text } as any).map((entry) => entry.abilityId);
    expect(ids('You may cast spells that have a cycling ability from your graveyard.')).toEqual([]);
    expect(ids('Cycling abilities you activate cost up to {2} less to activate.')).toEqual([]);
    expect(ids('Cycling {2} ({2}, Discard this card: Draw a card.)')).toEqual(['sweep_source-cycling-0']);
    expect(ids('Basic landcycling {1}{G}')).toEqual(['sweep_source-cycling-0']);
  });

  it('seeds energy, max speed and power-N sacrifice fodder only for cards that need them', () => {
    const state: any = { battlefield: [] };
    seedCardResourceNeeds(state, { name: 'Sweep Plain', oracle_text: 'Draw a card.' } as any);
    expect(state).toEqual({ battlefield: [] });
    seedCardResourceNeeds(state, { name: 'Sweep Engine', oracle_text: 'Max speed \u2014 {T}, Pay {E}{E}: Draw a card.\nAs an additional cost to cast this spell, sacrifice a creature with power 4 or greater.' } as any);
    expect(state.energy.p1).toBeGreaterThanOrEqual(50);
    expect(state.speed.p1).toBe(4);
    expect(state.battlefield[0].card.power).toBe('4');
  });

  it('seeds per-card legal targets only for cards whose text needs them', () => {
    const fresh = () => ({ battlefield: [] as any[], zones: { p1: { hand: [], handCount: 0 }, p2: { hand: [], handCount: 0 } } });
    const plain = fresh();
    seedCardTargetNeeds(plain, 'destroy target creature. draw a card.');
    expect(plain.battlefield).toEqual([]);
    const s = fresh();
    seedCardTargetNeeds(s, 'destroy target white creature. exile target nonbasic land. destroy target tapped creature. exile target nonwhite attacking creature.');
    const byId = (id: string) => s.battlefield.find((p: any) => p.id === 'perm_' + id);
    expect(byId('p2_bf_white')?.card.colors).toEqual(['W']);
    expect(byId('p2_bf_nonbasic_1')?.card.type_line).toBe('Land');
    expect(byId('p2_bf_tapped')?.tapped).toBe(true);
    expect(byId('p2_bf_attacker')?.attacking).toBe('p1');
    const h = fresh();
    seedCardTargetNeeds(h, 'target player reveals their hand. you choose a spirit or arcane card from it. that player discards that card. create x tokens that are copies of target token you control.');
    expect(h.zones.p2.hand.map((c: any) => c.type_line)).toEqual(['Creature \u2014 Spirit', 'Instant \u2014 Arcane']);
    expect(h.zones.p2.handCount).toBe(2);
    expect(h.battlefield[0].isToken).toBe(true);
    expect(h.battlefield[0].controller).toBe('p1');
  });

  it('activates abilities as the source permanent\'s current controller', () => {
    const table = { handlers: { p1: {}, p2: {} } } as any;
    expect(sweepActivatingPlayer(table, { controller: 'p2' })).toBe('p2');
    expect(sweepActivatingPlayer(table, { controller: 'p1' })).toBe('p1');
    expect(sweepActivatingPlayer(table, { controller: 'p9' })).toBe('p1');
    expect(sweepActivatingPlayer(table, {})).toBe('p1');
  });

  it('treats turned-face-up triggers as untested, not ETB, and finds zone-only abilities', () => {
    expect(etbTriggerLine('Morph {2}{U}\nWhen Sweep Thing is turned face up, draw a card.', 'Sweep Thing')).toBeUndefined();
    expect(untestedTriggerKinds('When Sweep Thing is turned face up, draw a card.', 'Sweep Thing')).toContain('turned_face_up');
    expect(zoneOnlyAbility('mountaincycling {2} (discard this card: search your library for a mountain card.)')).toBe('hand');
    expect(zoneOnlyAbility('renew \u2014 {4}{g}, exile this card from your graveyard: put two +1/+1 counters on target creature.')).toBe('graveyard');
    expect(zoneOnlyAbility('{t}: add {g}.')).toBeUndefined();
    expect(zoneOnlyAbility('{2}, {t}: return target creature card from your graveyard to your hand.')).toBeUndefined();
    expect(activationXValue({ cost: '{x}, {t}', fullText: '{x}, {t}: target player mills x cards.' })).toEqual({ xValue: 1 });
    expect(activationXValue({ cost: '{t}', fullText: '{t}: draw a card.' })).toEqual({});
    const zones = findZoneAbilities({ name: 'Sweep Cycler', type_line: 'Creature', oracle_text: 'Unearth {B}\nCycling {2} ({2}, Discard this card: Draw a card.)' });
    expect(zones.map((entry) => `${entry.zone}:${entry.abilityId}`)).toEqual(['graveyard:unearth', 'hand:sweep_source-cycling-0']);
  });

  it('parses | separated names and compares two runs per card', () => {
    expect(parseSweepArgs(['--name', 'Kai Winn, Faithless Leader|Opt']).names).toEqual(['kai winn, faithless leader', 'opt']);
    expect(parseSweepArgs(['--name', 'opt,shock']).names).toEqual(['opt', 'shock']);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osweep-compare-'));
    const prev = path.join(root, 'prev');
    const cur = path.join(root, 'cur');
    fs.mkdirSync(prev);
    fs.mkdirSync(cur);
    const line = (name: string, cls: string, detail?: string) => JSON.stringify({ name, typeLine: 'Instant', class: cls, detail, phases: [], telemetry: [], untestedTriggers: [], ms: 1 });
    fs.writeFileSync(path.join(prev, 'results.0.jsonl'), [line('A', 'noop', 'cast:x'), line('B', 'ok'), line('C', 'throw', 'cast:y'), line('D', 'stuck', 'cast:z')].join('\n'));
    fs.writeFileSync(path.join(cur, 'results.0.jsonl'), [line('A', 'ok'), line('B', 'noop', 'cast:x'), line('C', 'throw', 'cast:y'), line('E', 'ok')].join('\n'));
    try {
      const comparison = compareSweepRuns(prev, cur);
      expect(comparison.groups.newly_ok.map((entry) => entry.name)).toEqual(['A']);
      expect(comparison.groups.newly_broken.map((entry) => entry.name)).toEqual(['B']);
      expect(comparison.groups.unchanged_failure.map((entry) => entry.name)).toEqual(['C']);
      expect(comparison.groups.only_prev.map((entry) => entry.name)).toEqual(['D']);
      expect(comparison.groups.only_cur.map((entry) => entry.name)).toEqual(['E']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('outcome sweep text helpers', () => {
  it('assigns oracle families and finds self ETB / dies triggers', () => {
    expect(oracleFamily('Draw two cards.')).toBe('draw');
    expect(oracleFamily('Destroy target creature.')).toBe('destroy');
    expect(oracleFamily('Create a 1/1 white Soldier creature token.')).toBe('token');
    expect(etbTriggerLine('Flying\nWhen Sweep Healer enters, you gain 3 life.', 'Sweep Healer')).toMatch(/gain 3 life/);
    expect(diesTriggerLine('When this creature dies, draw a card.', 'Sweep Thing')).toMatch(/draw a card/);
    expect(untestedTriggerKinds('Whenever Sweep Thing attacks, it gets +1/+0.', 'Sweep Thing')).toEqual(['attack']);
    expect(needsStackTarget('Counter target spell.')).toBe(true);
    expect(needsStackTarget('Counter target spell. Destroy target creature.')).toBe(false);
  });

  it('diffs snapshots and ignores the swept card moving zones', () => {
    const game: any = {
      state: {
        players: [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }],
        life: { p1: 40, p2: 40 },
        battlefield: [],
        zones: { p1: { hand: [{ id: 'sweep_source' }], graveyard: [] }, p2: { hand: [], graveyard: [] } },
        manaPool: { p1: { white: 0 } },
      },
    };
    const before = takeSweepSnapshot(game);
    game.state.zones.p1.hand = [];
    game.state.zones.p1.graveyard = [{ id: 'sweep_source' }];
    expect(diffSweepSnapshots(before, takeSweepSnapshot(game), { ignoreCardIds: ['sweep_source'] }).strong).toEqual([]);
    game.state.life.p2 = 37;
    expect(diffSweepSnapshots(before, takeSweepSnapshot(game), { ignoreCardIds: ['sweep_source'] }).strong).toEqual(['life:p2 40->37']);
  });

  it('summarizes classes and groups failures by phase:family', () => {
    const summary = buildSweepSummary([
      { name: 'A', typeLine: 'Sorcery', class: 'ok', phases: [{ phase: 'cast', label: 'spell', text: '', family: 'draw', conditional: false, class: 'ok', changes: [], weak: [], castPrompts: [], prompts: [], notes: [], errors: [] }], telemetry: [], untestedTriggers: [], ms: 10 },
      { name: 'B', typeLine: 'Sorcery', class: 'noop', phases: [{ phase: 'cast', label: 'spell', text: '', family: 'draw', conditional: false, class: 'noop', detail: 'no_state_change', changes: [], weak: [], castPrompts: [], prompts: [], notes: [], errors: [] }], telemetry: [], untestedTriggers: [], ms: 30 },
    ] as any);
    expect(summary.classes).toMatchObject({ ok: 1, noop: 1 });
    expect(summary.noopFamilies[0]).toMatchObject({ key: 'cast:draw', count: 1 });
  });
});

describe('outcome sweep live socket paths', () => {
  beforeAll(async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    await initOutcomeSweepHarness();
    await calibrateSweepNoise();
  });

  beforeEach(() => {
    // The sweep runs with production defaults (Oracle IR primary on); vitest.setup defaults them off.
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
  });

  it('casts a draw sorcery through requestCastSpell and sees the hand change', async () => {
    const outcome = await sweepOneCard({ name: 'Sweep Insight', type_line: 'Sorcery', mana_cost: '{2}{U}', cmc: 3, colors: ['U'], oracle_text: 'Draw two cards.' }, { index: 9001 });
    const cast = outcome.phases.find((entry) => entry.phase === 'cast');
    expect(cast?.class).toBe('ok');
    expect((cast?.changes || []).some((change) => change.startsWith('zone:p1.hand'))).toBe(true);
  }, 60000);

  it('casts a creature, resolves its ETB life gain, and taps it for mana', async () => {
    const outcome = await sweepOneCard({
      name: 'Sweep Healer', type_line: 'Creature \u2014 Elf Cleric', mana_cost: '{1}{G}', cmc: 2, colors: ['G'], power: '1', toughness: '1',
      oracle_text: 'When this creature enters, you gain 3 life.\n{T}: Add {G}.',
    }, { index: 9002 });
    expect(outcome.phases.find((entry) => entry.phase === 'cast')?.class).toBe('ok');
    const etb = outcome.phases.find((entry) => entry.phase === 'etb');
    expect(etb?.class).toBe('ok');
    expect(etb?.changes).toContain('life:p1 40->43');
    expect(outcome.phases.find((entry) => entry.phase === 'activate')?.class).toBe('ok');
  }, 60000);

  it('flags a spell whose text the engine cannot act on as noop', async () => {
    const outcome = await sweepOneCard({ name: 'Sweep Blank', type_line: 'Sorcery', mana_cost: '{1}', cmc: 1, colors: [], oracle_text: 'Nothing of note occurs.' }, { index: 9003 });
    expect(outcome.phases.find((entry) => entry.phase === 'cast')?.class).toBe('noop');
    expect(outcome.telemetry.some((line) => line.startsWith('all_or_nothing_failure'))).toBe(true);
  }, 60000);

  it('activates a permanent that entered under an opponent\'s control as that opponent', async () => {
    const outcome = await sweepOneCard({
      name: 'Pendant of Prosperity', type_line: 'Legendary Artifact', mana_cost: '{3}', cmc: 3, colors: [],
      oracle_text: 'Pendant of Prosperity enters under the control of an opponent of your choice.\n{2}, {T}: Draw a card, then you may put a land card from your hand onto the battlefield. If you put a land card onto the battlefield this way, Pendant of Prosperity\'s owner draws a card.',
    }, { index: 9004 });
    const activate = outcome.phases.find((entry) => entry.phase === 'activate');
    expect(activate?.notes).toContain('activated_as:p2');
    expect(activate?.class).not.toBe('throw');
  }, 60000);
});
