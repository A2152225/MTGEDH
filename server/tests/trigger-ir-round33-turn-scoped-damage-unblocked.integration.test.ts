import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { resolveTopOfStack } from '../src/state/modules/stackResolveTopOfStackUtils.js';
import { getBlockTriggersForCreatures } from '../src/state/modules/triggers/combat.js';
import { queueLifegainTriggers } from '../src/state/modules/triggers/lifegain.js';
import { processDamageReceivedTriggers } from '../src/state/modules/triggers/damage-received.js';
import { getParsedAttacksUnblockedTriggers, queueParsedAttacksUnblockedTriggersOnce } from '../src/state/modules/triggers/combatBlockedIrTriggers.js';
import { getOpponentSpellCastTriggers } from '../src/state/modules/triggers/spell-cast.js';
import { getTurnScopedSpellTriggerSources } from '../src/state/modules/triggers/turnScopedSpellTriggers.js';
import { getDeathTriggers } from '../src/state/modules/triggers/death-emission.js';
import { detectManaModifiers } from '../src/state/modules/mana-abilities-handlers/manaAbilityLandTypeModifiers.js';

const io: any = { to: () => ({ emit: () => {} }), emit: () => {}, sockets: { sockets: new Map() } };
const SPELLS: Record<string, [string, string, any[]?]> = {
  rot: ['Shriveling Rot', 'Choose one \u2014\n\u2022 Until end of turn, whenever a creature is dealt damage, destroy it.\n\u2022 Until end of turn, whenever a creature dies, that creature\'s controller loses life equal to its toughness.\nEntwine {2}{B}'],
  arc: ['Arcbond', 'Choose target creature. Whenever that creature is dealt damage this turn, it deals that much damage to each other creature and each player.', ['a1']],
  glyph: ['Glyph of Life', 'Choose target Wall creature. Whenever that creature is dealt damage by an attacking creature this turn, you gain that much life.', ['w1']],
  gaze: ['Gaze of Pain', 'Until end of turn, whenever a creature you control attacks and isn\'t blocked, you may choose to have it deal damage equal to its power to a target creature. If you do, it assigns no combat damage this turn.'],
  bonus: ['Bonus Round', 'Until end of turn, whenever a player casts an instant or sorcery spell, that player copies it and may choose new targets for the copy.'],
  waltz: ['Waltz of Rage', 'Target creature you control deals damage equal to its power to each other creature. Until end of turn, whenever a creature you control dies, exile the top card of your library. You may play it until the end of your next turn.', ['m1']],
  gnaw: ['Gnawing Crescendo', 'Creatures you control get +2/+0 until end of turn. Whenever a nontoken creature you control dies this turn, create a 1/1 black Rat creature token with "This token can\'t block."'],
};
const bear = (id: string, controller: string) => ({ id, controller, owner: controller, tapped: false, card: { id: id + '_c', name: 'Grizzly Bears', type_line: 'Creature - Bear', oracle_text: '', power: '2', toughness: '2' } });

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

// Mirrors combatDeclareBlockersRequest: the stack item binds the blocking creature as the pronoun subject.
function pushBlockTrigger(g: any, t: any) {
  const blockingCreatureId = String(t.value?.blockingCreatureId || '');
  g.state.stack.push({
    id: 'tr_' + t.permanentId, type: 'triggered_ability', controller: t.controllerId, source: t.permanentId,
    permanentId: t.permanentId, sourceName: t.cardName, description: t.description, triggerType: 'blocks',
    mandatory: true, value: t.value,
    ...(blockingCreatureId && blockingCreatureId !== t.permanentId ? { interveningIfSubjectPermanentId: blockingCreatureId } : {}),
  });
}

const wall = (id: string, controller: string) => { const w: any = bear(id, controller); w.card.type_line = 'Creature - Wall'; return w; };
const turnScopedTexts = (g: any) => (g.state.turnScopedSpellTriggers || []).map((e: any) => e.card.oracle_text);

describe('round 33: dealt-damage and attacks-unblocked turn-scoped watchers', () => {
  const prev = process.env.ORACLE_IR_TRIGGER_PRIMARY;
  beforeAll(async () => { await initDb(); initializePriorityResolutionHandler(io); });
  beforeEach(() => { process.env.ORACLE_IR_TRIGGER_PRIMARY = '1'; });
  afterAll(() => { if (prev === undefined) delete process.env.ORACLE_IR_TRIGGER_PRIMARY; else process.env.ORACLE_IR_TRIGGER_PRIMARY = prev; });

  it('Shriveling Rot registers only the chosen mode (bulleted modal clauses)', () => {
    expect(turnScopedTexts(setup('r33_rot_m2', 'rot', [], { selectedModes: ['mode_2'] }))).toEqual(["Whenever a creature dies, that creature's controller loses life equal to its toughness."]);
    expect(turnScopedTexts(setup('r33_rot_both', 'rot')).length).toBe(2);
  });

  it('Shriveling Rot mode 1: a creature dealt damage this turn is destroyed ("it" = damaged creature)', () => {
    const g = setup('r33_rot_m1', 'rot', [bear('a1', 'p2'), bear('x1', 'p3')], { selectedModes: ['mode_1'] });
    const target = g.state.battlefield.find((p: any) => p.id === 'a1');
    target.damage = 1;
    processDamageReceivedTriggers(g, target, 1, () => {});
    expect(g.state.stack.map((s: any) => s.sourceName)).toEqual(['Shriveling Rot']);
    g.resolveTopOfStack();
    expect(g.state.battlefield.map((p: any) => p.id)).toEqual(['x1']);
    g.state.turnNumber = 8;
    processDamageReceivedTriggers(g, g.state.battlefield[0], 1, () => {});
    expect(g.state.stack.length).toBe(0);
  });

  it('Arcbond: damage to the chosen creature is dealt to each other creature and each player', () => {
    const g = setup('r33_arc', 'arc', [bear('a1', 'p2'), bear('x1', 'p3')]);
    const target = g.state.battlefield.find((p: any) => p.id === 'a1');
    processDamageReceivedTriggers(g, target, 1, () => {});
    expect(g.state.stack.length).toBe(1);
    g.resolveTopOfStack();
    expect(g.state.life).toEqual(expect.objectContaining({ p1: 39, p2: 39, p3: 39 }));
  });

  it('Glyph of Life: gain life only when the Wall is dealt damage by an attacking creature', () => {
    const g = setup('r33_glyph', 'glyph', [bear('a1', 'p2'), wall('w1', 'p1')]);
    const w = g.state.battlefield.find((p: any) => p.id === 'w1');
    processDamageReceivedTriggers(g, w, 2, () => {});
    expect(g.state.stack.length).toBe(0);
    w.blocking = ['a1'];
    g.state.battlefield.find((p: any) => p.id === 'a1').attacking = 'p1';
    processDamageReceivedTriggers(g, w, 2, () => {});
    expect(g.state.stack.length).toBe(1);
    g.resolveTopOfStack();
    expect(g.state.life.p1).toBe(42);
    expect(g.state.life.p2).toBe(40);
  });

  it('Gaze of Pain: an unblocked attacker of the caster triggers, with "it" bound to that attacker', () => {
    const g = setup('r33_gaze', 'gaze', [bear('m1', 'p1'), bear('o1', 'p2')]);
    g.state.battlefield.find((p: any) => p.id === 'm1').attacking = 'p2';
    const trig = getParsedAttacksUnblockedTriggers(g, 'p2').filter((t: any) => String(t.permanentId).startsWith('turn-scoped:'));
    expect(trig.length).toBe(1);
    expect(trig[0]).toEqual(expect.objectContaining({ controllerId: 'p1', mandatory: false, value: expect.objectContaining({ attackingCreatureId: 'm1' }) }));
    expect(queueParsedAttacksUnblockedTriggersOnce(g, 'p2')).toBe(1);
    expect(g.state.stack[0]).toEqual(expect.objectContaining({ triggerType: 'attacks_unblocked', interveningIfSubjectPermanentId: 'm1' }));
    g.state.stack = [];
    g.state.battlefield.find((p: any) => p.id === 'm1').attacking = undefined;
    g.state.battlefield.find((p: any) => p.id === 'o1').attacking = 'p1';
    expect(getParsedAttacksUnblockedTriggers(g, 'p1').filter((t: any) => String(t.permanentId).startsWith('turn-scoped:')).length).toBe(0);
  });

  it('Bonus Round: any player casting an instant or sorcery triggers; creature spells do not', () => {
    const g = setup('r33_bonus', 'bonus');
    const opp = (g: any, caster: string, card: any) => getOpponentSpellCastTriggers([...g.state.battlefield, ...getTurnScopedSpellTriggerSources(g.state)], caster, card, ['p1', 'p2', 'p3']);
    const shock = { id: 'sh', name: 'Shock', type_line: 'Instant', oracle_text: '' };
    expect(opp(g, 'p2', shock).length).toBe(1);
    expect(opp(g, 'p1', shock).length).toBe(1);
    expect(opp(g, 'p2', { id: 'cs', name: 'Elf', type_line: 'Creature - Elf', oracle_text: '' }).length).toBe(0);
  });

  it('Waltz of Rage / Gnawing Crescendo: only the caster\'s (nontoken) creatures dying this turn trigger', () => {
    const mine = bear('m1', 'p1'); const theirs = bear('o1', 'p2');
    const g = setup('r33_waltz', 'waltz', [mine, theirs]);
    expect(getDeathTriggers(g, mine, 'p1').length).toBe(1);
    expect(getDeathTriggers(g, theirs, 'p2').length).toBe(0);
    const token: any = bear('t1', 'p1'); token.isToken = true;
    const g2 = setup('r33_gnaw', 'gnaw', [bear('m2', 'p1'), token]);
    expect(getDeathTriggers(g2, g2.state.battlefield[0], 'p1').length).toBe(1);
    expect(getDeathTriggers(g2, token, 'p1').length).toBe(0);
  });
});
