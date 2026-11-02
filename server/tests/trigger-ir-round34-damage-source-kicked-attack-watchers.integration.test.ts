import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { handleStepResponse } from '../src/socket/resolution-handlers/stepResponseHandlers.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { resolveTopOfStack } from '../src/state/modules/stackResolveTopOfStackUtils.js';
import { getParsedAttacksUnblockedTriggers, queueParsedAttacksUnblockedTriggersOnce } from '../src/state/modules/triggers/combatBlockedIrTriggers.js';
import { getDeathTriggers } from '../src/state/modules/triggers/death-emission.js';
import { getAttackTriggersForCreatures } from '../src/state/modules/triggers/attack-triggers-for-creatures.js';
import { applyCreatureDamageFromSource } from '../src/state/modules/combat-damage-processing.js';
import { processDamageReceivedTriggers } from '../src/state/modules/triggers/damage-received.js';
import { applyDealCombatDamageTriggerQueue } from '../src/state/modules/turn-handlers/turnCombatDamageTriggerQueue.js';

const io: any = { to: () => ({ emit: () => {} }), emit: () => {}, sockets: { sockets: new Map() } };
const SPELLS: Record<string, [string, string, any[]?]> = {
  rot: ['Shriveling Rot', 'Choose one \u2014\n\u2022 Until end of turn, whenever a creature is dealt damage, destroy it.\n\u2022 Until end of turn, whenever a creature dies, that creature\'s controller loses life equal to its toughness.\nEntwine {2}{B}'],
  glyph: ['Glyph of Life', 'Choose target Wall creature. Whenever that creature is dealt damage by an attacking creature this turn, you gain that much life.', ['w1']],
  gaze: ['Gaze of Pain', 'Until end of turn, whenever a creature you control attacks and isn\'t blocked, you may choose to have it deal damage equal to its power to a target creature. If you do, it assigns no combat damage this turn.'],
  warhost: ['Warhost\'s Frenzy', 'Kicker {B} (You may pay an additional {B} as you cast this spell.)\nCreatures you control get +2/+0 until end of turn. If this spell was kicked, whenever a creature you control dies this turn, draw a card.'],
  song: ['Song of Blood', 'Mill four cards. Whenever a creature attacks this turn, it gets +1/+0 until end of turn for each creature card put into your graveyard this way.'],
  indulge: ['Indulge', 'Whenever a creature you control attacks this turn, create a 1/1 green and white Citizen creature token that\'s tapped and attacking.'],
  harsh: ['Harsh Justice', 'Cast this spell only during the declare attackers step and only if you\'ve been attacked this step.\nThis turn, whenever an attacking creature deals combat damage to you, it deals that much damage to its controller.'],
};
const bear = (id: string, controller: string) => ({ id, controller, owner: controller, tapped: false, card: { id: id + '_c', name: 'Grizzly Bears', type_line: 'Creature - Bear', oracle_text: '', power: '2', toughness: '2' } });
const wall = (id: string, controller: string) => { const w: any = bear(id, controller); w.card.type_line = 'Creature - Wall'; w.card.toughness = '5'; return w; };
const texts = (g: any) => (g.state.turnScopedSpellTriggers || []).map((e: any) => e.card.oracle_text);
const perm = (g: any, id: string) => g.state.battlefield.find((p: any) => p.id === id);
const dmg = (p: any) => Number(p?.markedDamage || p?.damage || p?.damageMarked || 0);

function setup(gameId: string, key: string, battlefield: any[] = [], extra: any = {}) {
  createGameIfNotExists(gameId, 'commander', 40);
  const g: any = ensureGame(gameId);
  ResolutionQueueManager.removeQueue(gameId);
  g.state.players = [{ id: 'p1', name: 'P1', life: 40 }, { id: 'p2', name: 'P2', life: 40 }, { id: 'p3', name: 'P3', life: 40 }];
  g.state.life = { p1: 40, p2: 40, p3: 40 };
  g.state.battlefield = battlefield;
  g.state.turnNumber = 7;
  g.state.activePlayer = 'p1';
  const zone = () => ({ hand: [], handCount: 0, graveyard: [], graveyardCount: 0, library: [], libraryCount: 0 });
  g.state.zones = { p1: zone(), p2: zone(), p3: zone() };
  const [name, text, targets] = SPELLS[key];
  g.state.stack = [{ id: 'st_' + key, type: 'spell', controller: 'p1', card: { id: key, name, type_line: 'Instant', mana_cost: '{B}', cmc: 1, oracle_text: text }, targets: targets || [], ...extra }];
  resolveTopOfStack(g);
  g.state.stack = [];
  return g;
}

describe('round 34: damage sources, Gaze rider, kicked and attack/combat-damage turn-scoped watchers', () => {
  const prev = process.env.ORACLE_IR_TRIGGER_PRIMARY;
  beforeAll(async () => { await initDb(); initializePriorityResolutionHandler(io); });
  beforeEach(() => { process.env.ORACLE_IR_TRIGGER_PRIMARY = '1'; });
  afterAll(() => { if (prev === undefined) delete process.env.ORACLE_IR_TRIGGER_PRIMARY; else process.env.ORACLE_IR_TRIGGER_PRIMARY = prev; });

  it('Glyph of Life: the recorded damage source decides (attacker yes, fighting non-attacker no)', () => {
    const g = setup('r34_glyph', 'glyph', [wall('w1', 'p1'), bear('a1', 'p2'), bear('n1', 'p2')]);
    const w = perm(g, 'w1');
    applyCreatureDamageFromSource(g, perm(g, 'n1'), w, 2);
    expect(g.state.damageSourcesByRecipient.w1[0]).toEqual(expect.objectContaining({ sourceId: 'n1', sourceWasAttacking: false }));
    expect(perm(g, 'n1').hasDealtDamage).toBe(true);
    processDamageReceivedTriggers(g, w, 2, () => {});
    expect(g.state.stack.length).toBe(0);
    w.blocking = ['a1']; perm(g, 'a1').attacking = 'p1';
    applyCreatureDamageFromSource(g, perm(g, 'a1'), w, 2, 'markedDamage', { isCombatDamage: true });
    processDamageReceivedTriggers(g, w, 2, () => {});
    expect(g.state.stack.length).toBe(1);
    resolveTopOfStack(g);
    expect(g.state.life.p1).toBe(42);
  });

  it('Gaze of Pain: the attacker deals its power to the chosen creature, then (if you do) assigns no combat damage', async () => {
    const g = setup('r34_gaze', 'gaze', [bear('m1', 'p1'), bear('o1', 'p2')]);
    expect(texts(g)[0]).toMatch(/If you do, it assigns no combat damage this turn\.$/);
    perm(g, 'm1').attacking = 'p2';
    expect(queueParsedAttacksUnblockedTriggersOnce(g, 'p2')).toBe(1);
    expect(g.state.stack[0].reflexiveWhenYouDo).toEqual({ actor: 'you', effect: 'it assigns no combat damage this turn' });
    const seen: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const step: any = (ResolutionQueueManager.getQueue('r34_gaze')?.steps || [])[0];
      if (step) {
        seen.push(step.type);
        const response: any = { stepId: step.id, playerId: 'p1', selections: step.type === 'target_selection' ? ['o1'] : ['yes'], timestamp: Date.now() };
        const done = ResolutionQueueManager.completeStep('r34_gaze', step.id, response) || step;
        await handleStepResponse(io, g, 'r34_gaze', done, response);
        continue;
      }
      if (!(g.state.stack || []).length) break;
      resolveTopOfStack(g);
    }
    expect(seen).toContain('target_selection');
    expect(dmg(perm(g, 'o1'))).toBe(2);
    expect(perm(g, 'm1').assignsNoCombatDamageUntilTurn).toBe(7);
  });

  it('Warhost\'s Frenzy: the dies watcher registers only when kicked', () => {
    expect(texts(setup('r34_war_nk', 'warhost')).length).toBe(0);
    const g = setup('r34_war_k', 'warhost', [bear('m1', 'p1')], { wasKicked: true });
    expect(texts(g)).toEqual(['Whenever a creature you control dies, draw a card.']);
    expect(getDeathTriggers(g, perm(g, 'm1'), 'p1').length).toBe(1);
  });

  it('Song of Blood / Indulge: creature attacks this turn watchers fire', () => {
    const g = setup('r34_song', 'song', [bear('m1', 'p1')]);
    perm(g, 'm1').attacking = 'p2';
    const h = setup('r34_indulge', 'indulge', [bear('m2', 'p1'), bear('o2', 'p2')]);
    perm(h, 'm2').attacking = 'p2';
    const ht = getAttackTriggersForCreatures(h, [perm(h, 'm2')] as any, 'p2' as any);
    expect(ht.filter((t: any) => String(t.permanentId).startsWith('turn-scoped:')).length).toBe(1);
  });

  it('Harsh Justice: an attacker dealing combat damage to the caster is dealt back to its controller', () => {
    const g = setup('r34_harsh', 'harsh', [bear('o1', 'p2')]);
    g.state.activePlayer = 'p2';
    perm(g, 'o1').attacking = 'p1';
    applyDealCombatDamageTriggerQueue(g, g.state.battlefield, { attackersThatDealtDamage: { p1: ['o1'] }, attackerDamageToPlayers: { p1: { o1: 2 } } } as any);
    const item = g.state.stack.find((s: any) => String(s.source).startsWith('turn-scoped:'));
    expect(item).toEqual(expect.objectContaining({ interveningIfSubjectPermanentId: 'o1', damageAmount: 2 }));
    g.state.stack = [item];
    resolveTopOfStack(g);
    expect(g.state.life.p2).toBe(38);
  });

  it('Shriveling Rot mode 2: a dying creature\'s controller loses life equal to its toughness', () => {
    const g = setup('r34_rot2', 'rot', [bear('o1', 'p2')], { selectedModes: ['mode_2'] });
    const res = getDeathTriggers(g, perm(g, 'o1'), 'p2');
    expect(res.length).toBe(1);
  });
});
