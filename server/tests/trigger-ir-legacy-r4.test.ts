import { describe, expect, it } from 'vitest';
import { parseTriggerClause, triggerConditionMatches } from '../../rules-engine/src/triggerCondition/index.js';
import { getAttackTriggersForCreatures } from '../src/state/modules/triggers/combat.js';
import { getSpellCastTriggers } from '../src/state/modules/triggers/spell-cast-get-triggers.js';
import { getDeathTriggers } from '../src/state/modules/triggers/death-emission.js';
import { detectLifegainTriggers } from '../src/state/modules/triggers/lifegain.js';
import { triggerETBEffectsForPermanent } from '../src/state/modules/triggerEtbPermanentEffects.js';
import { getETBTriggersForPermanent } from '../src/state/modules/triggers/etb-detection.js';

const cond = (s: string, name?: string) => parseTriggerClause(s, name)?.condition as any;
const src = (extra: Record<string, unknown> = {}) => ({ id: 'w', controllerId: 'p1', ...extra } as any);

function ctxOf(battlefield: any[], extra: Record<string, unknown> = {}) {
  const state: any = {
    seq: 1, stack: [], battlefield,
    players: [{ id: 'p1', life: 20 }, { id: 'p2', life: 20 }], commandZone: {},
    turnPlayer: 'p1', activePlayer: 'p1', turnNumber: 3, phase: 'combat', step: 'declare_attackers',
    zones: { p1: { hand: [], graveyard: [], exile: [], library: [] }, p2: { hand: [], graveyard: [], exile: [], library: [] } },
    spellsCastThisTurn: [],
    lifegainTriggersFiredThisTurn: {},
    ...extra,
  };
  return { state, gameId: 'r4', bumpSeq() { state.seq++; }, isReplaying: false } as any;
}
const perm = (id: string, controller: string, card: any, extra: any = {}) => ({
  id, controller, owner: controller, tapped: false, counters: {},
  card: { id: id + '_c', ...card }, ...extra,
});
const sourceId = (x: any) => String(x?.permanentId || x?.source?.permanentId || x?.sourceId || x?.source || '');
const fromW = (list: any[]) => list.filter((x) => sourceId(x) === 'w');
const stackFrom = (g: any, id: string) => (g.state.stack || []).filter((x: any) => sourceId(x) === id);

describe('legacy-r4: short names and dual-event families', () => {
  it('normalizes legendary short names so named self-ETB parses as IR', () => {
    const phage = cond('When Phage enters, if you didn\'t cast it from your hand, you lose the game.', 'Phage the Untouchable');
    expect(phage?.event).toBe('enters');
    expect(phage?.legacyRuntimeOnly).toBeFalsy();
    expect(phage?.alternatives?.[0]?.source).toBe('self');

    const acer = cond('When Acererak enters, venture into the dungeon.', 'Acererak the Archlich');
    expect(acer?.event).toBe('enters');
    expect(acer?.legacyRuntimeOnly).toBeFalsy();

    const rosie = cond('When Rosie Cotton enters, create a Food token.', 'Rosie Cotton of South Lane');
    expect(rosie?.event).toBe('enters');

    const kiora = cond('When Kiora enters, create a 5/5 red Dragon creature token with flying.', 'Kiora of Fire and Ashes');
    expect(kiora?.event).toBe('enters');

    const tivadar = cond('When Tivadar enters, destroy target Goblin.', 'Tivadar of Thorn');
    expect(tivadar?.event).toBe('enters');
  });

  it('combines enters-and-whenever / upkeep-and-cast / enters-or-attacks', () => {
    const mach = cond('When MACH-1 enters and whenever you gain life, surveil 1. This ability triggers only once each turn.', 'MACH-1, Swooping Scoundrel');
    expect(mach?.event).toBe('enters');
    expect(mach?.pairedEvent).toBe('gains_life');
    expect(mach?.pairedCondition?.event).toBe('gains_life');
    expect(mach?.legacyRuntimeOnly).toBeFalsy();

    const shrine = cond('At the beginning of your upkeep and whenever you cast a black spell, put a charge counter on this artifact.');
    expect(shrine?.event).toBe('beginning_of_upkeep');
    expect(shrine?.pairedEvent).toBe('spell_cast');
    expect(shrine?.pairedCondition?.event).toBe('spell_cast');
    expect(shrine?.legacyRuntimeOnly).toBeFalsy();

    const cmd = cond('Whenever a commander you control enters or attacks, proliferate.');
    expect(cmd?.event).toBe('enters');
    expect(cmd?.pairedEvent).toBe('attacks');
    expect(cmd?.legacyRuntimeOnly).toBeFalsy();
    expect(cmd?.alternatives?.[0]?.subject?.commander).toBe(true);
  });

  it('promotes play-a-card, staff color-or-land, qualified ETB, and leftover combat/attack/death shapes', () => {
    const play = cond('Whenever you play a card, draw a card.');
    expect(play?.event).toBe('plays_land');
    expect(play?.pairedEvent).toBe('spell_cast');
    expect(play?.legacyRuntimeOnly).toBeFalsy();

    const staff = cond('Whenever you cast a black spell or a Swamp you control enters, you gain 1 life.');
    expect(staff?.event).toBe('spell_cast');
    expect(staff?.pairedEvent).toBe('enters');
    expect(staff?.pairedCondition?.event).toBe('enters');
    expect(staff?.legacyRuntimeOnly).toBeFalsy();

    const tapped = cond('Whenever a permanent you control enters tapped, untap it.');
    expect(tapped?.event).toBe('enters');
    expect(tapped?.entersTapped).toBe(true);
    expect(tapped?.legacyRuntimeOnly).toBeFalsy();

    const combatEtb = cond('Whenever a creature you control enters during combat, draw a card.');
    expect(combatEtb?.event).toBe('enters');
    expect(combatEtb?.duringCombat).toBe(true);

    const gy = cond('Whenever this creature or another permanent enters from a graveyard, draw a card.');
    expect(gy?.event).toBe('enters');
    expect(gy?.fromZone).toBe('graveyard');

    const counter = cond('Whenever a creature you control with a counter on it deals combat damage to a player, draw a card.');
    expect(counter?.event).toBe('deals_combat_damage_to_player');
    expect(counter?.legacyRuntimeOnly).toBeFalsy();
    expect(counter?.alternatives?.[0]?.subject?.counters?.[0]?.minimum).toBe(1);

    const cmdDmg = cond('When your commander deals combat damage to a player, you become the monarch.');
    expect(cmdDmg?.event).toBe('deals_combat_damage_to_player');
    expect(cmdDmg?.alternatives?.[0]?.subject?.commander).toBe(true);
    expect(cmdDmg?.legacyRuntimeOnly).toBeFalsy();

    const dmgYou = cond('Whenever a creature deals damage to you, put a gold counter on it.');
    expect(dmgYou?.event).toMatch(/deals/);
    expect(dmgYou?.damagedPlayer).toBe('you');
    expect(dmgYou?.legacyRuntimeOnly).toBeFalsy();

    const delayedDmg = cond('Whenever it deals combat damage to a player this turn, exile that many cards.');
    expect(delayedDmg?.event).toBe('deals_combat_damage_to_player');
    expect(delayedDmg?.delayedRider).toBe(true);
    expect(delayedDmg?.thisTurn).toBe(true);

    const thatDies = cond('When that creature dies, its owner loses the game.');
    expect(thatDies?.event).toBe('dies');
    expect(thatDies?.delayedRider).toBe(true);
    expect(thatDies?.legacyRuntimeOnly).toBeFalsy();

    const attackOpps = cond('Whenever one or more creatures attack one of your opponents, those creatures gain menace until end of turn.');
    expect(attackOpps?.event).toBe('attacks');
    expect(attackOpps?.attackedPlayer).toBe('opponent');
    expect(attackOpps?.legacyRuntimeOnly).toBeFalsy();

    const oppYou = cond('Whenever an opponent attacks you with two or more creatures, draw a card.');
    expect(oppYou?.event).toBe('attacks');
    expect(oppYou?.attackedPlayer).toBe('you');
    expect(oppYou?.minAttackers).toBe(2);
    expect(oppYou?.legacyRuntimeOnly).toBeFalsy();
  });
});

describe('legacy-r4: fires exactly once', () => {
  it('named self-ETB still fires once from the ETB detector', () => {
    const text = 'When Phage enters, if you didn\'t cast it from your hand, you lose the game.';
    const phage = perm('w', 'p1', { name: 'Phage the Untouchable', type_line: 'Legendary Creature - Avatar Minion', oracle_text: text, power: '4', toughness: '4' });
    const n = getETBTriggersForPermanent(phage.card, phage, ctxOf([phage]).state) as any[];
    expect(n.length).toBe(1);
  });

  it('commander enters-or-attacks: ETB of another commander and attack each fire once', () => {
    const text = 'Whenever a commander you control enters or attacks, proliferate.';
    const watcher = perm('w', 'p1', { name: 'Norn\'s Choirmaster', type_line: 'Creature - Phyrexian Angel', oracle_text: text, power: '2', toughness: '2' });
    const commander = perm('c1', 'p1', { name: 'Atraxa', type_line: 'Legendary Creature - Phyrexian Angel', oracle_text: '', power: '4', toughness: '4' }, { isCommander: true });
    const g = ctxOf([watcher]);
    triggerETBEffectsForPermanent(g, commander, 'p1');
    expect(stackFrom(g, 'w').length).toBe(1);

    const attacker = { ...commander, id: 'c2', attacking: 'p2' };
    const attacks = fromW(getAttackTriggersForCreatures(ctxOf([watcher, attacker]), [attacker], 'p1', 'p2') as any[]);
    expect(attacks.length).toBe(1);
  });

  it('MACH-1 life-gain half fires once via pairedCondition (not suppressed)', () => {
    const text = 'When MACH-1 enters and whenever you gain life, surveil 1. This ability triggers only once each turn.';
    const mach = perm('w', 'p1', { name: 'MACH-1, Swooping Scoundrel', type_line: 'Legendary Creature - Human Rogue', oracle_text: text, power: '2', toughness: '2' });
    const c = cond(text, 'MACH-1, Swooping Scoundrel');
    expect(triggerConditionMatches(c.pairedCondition, { id: '', typeLine: '', controllerId: 'p1', anyObject: true } as any, src(), {} as any)).toBe(true);
    const hits = detectLifegainTriggers(ctxOf([mach], { phase: 'main1', step: 'main' }), 'p1', 1);
    expect(fromW(hits as any[]).length).toBe(1);
  });

  it('play-a-card and shrine color-spell halves fire once on a matching spell', () => {
    const play = perm('w', 'p1', { name: 'Null Profusion', type_line: 'Enchantment', oracle_text: 'Whenever you play a card, draw a card.' });
    const shrine = perm('s1', 'p1', { name: 'Shrine of Limitless Power', type_line: 'Artifact', oracle_text: 'At the beginning of your upkeep and whenever you cast a black spell, put a charge counter on this artifact.' });
    const bolt = { id: 'b', name: 'Doom Blade', type_line: 'Instant', oracle_text: 'Destroy target nonblack creature.', mana_cost: '{1}{B}', colors: ['B'], color_identity: ['B'] };
    const g = ctxOf([play, shrine], { phase: 'main1', step: 'main' });
    const hits = getSpellCastTriggers(g, 'p1', bolt) as any[];
    expect(hits.filter((x) => sourceId(x) === 'w').length).toBe(1);
    expect(hits.filter((x) => sourceId(x) === 's1').length).toBe(1);
  });

  it('opponent-attacks-you-with-two-or-more fires once and not for a solo attacker', () => {
    const text = 'Whenever an opponent attacks you with two or more creatures, draw a card.';
    const watcher = perm('w', 'p1', { name: 'Everett K. Ross, Hapless Attache', type_line: 'Creature - Human', oracle_text: text, power: '1', toughness: '3' });
    const a1 = perm('a1', 'p2', { name: 'Bear', type_line: 'Creature - Bear', oracle_text: '', power: '2', toughness: '2' }, { attacking: 'p1' });
    const a2 = perm('a2', 'p2', { name: 'Cat', type_line: 'Creature - Cat', oracle_text: '', power: '1', toughness: '1' }, { attacking: 'p1' });
    expect(fromW(getAttackTriggersForCreatures(ctxOf([watcher, a1, a2]), [a1, a2], 'p2', 'p1') as any[]).length).toBe(1);
    expect(fromW(getAttackTriggersForCreatures(ctxOf([watcher, a1]), [a1], 'p2', 'p1') as any[]).length).toBe(0);
  });

  it('that-creature-dies delayed rider is IR fail-closed and does not double with parsed_dies', () => {
    const text = 'When that creature dies, its owner loses the game.';
    const c = cond(text);
    expect(c?.delayedRider).toBe(true);
    expect(triggerConditionMatches(c, { id: 'd1', controllerId: 'p2', typeLine: 'Creature - Bear' } as any, src(), {} as any)).toBe(false);
    const watcher = perm('w', 'p1', { name: 'The Deck of Many Things', type_line: 'Legendary Artifact', oracle_text: text });
    const dying = perm('d1', 'p2', { name: 'Bear', type_line: 'Creature - Bear', oracle_text: '', power: '2', toughness: '2' });
    const hits = fromW(getDeathTriggers(ctxOf([watcher, dying]), dying, 'p2') as any[]);
    // Dedicated delayed-watcher leftover may still emit once; parsed_dies must not add a second.
    expect(hits.length).toBeLessThanOrEqual(1);
    expect(hits.filter((h: any) => String(h.triggerType || '') === 'parsed_dies').length).toBe(0);
  });

  it('enters-tapped watcher fires once for a tapped land and not for an untapped one', () => {
    const text = 'Whenever a permanent you control enters tapped, untap it.';
    const watcher = perm('w', 'p1', { name: 'Amulet of Vigor', type_line: 'Artifact', oracle_text: text });
    const tappedLand = perm('l1', 'p1', { name: 'Forest', type_line: 'Basic Land - Forest', oracle_text: '' }, { tapped: true });
    const g1 = ctxOf([watcher], { phase: 'main1', step: 'main' });
    triggerETBEffectsForPermanent(g1, tappedLand, 'p1');
    expect(stackFrom(g1, 'w').length).toBe(1);

    const untapped = perm('l2', 'p1', { name: 'Island', type_line: 'Basic Land - Island', oracle_text: '' }, { tapped: false });
    const g2 = ctxOf([watcher], { phase: 'main1', step: 'main' });
    triggerETBEffectsForPermanent(g2, untapped, 'p1');
    expect(stackFrom(g2, 'w').length).toBe(0);
  });
});

describe('legacy-r4 census samples', () => {
  it('promoted leftover families are IR without legacyRuntimeOnly', () => {
    const samples: Array<[string, string, string?]> = [
      ['When Phage enters, if you didn\'t cast it from your hand, you lose the game.', 'enters', 'Phage the Untouchable'],
      ['When MACH-1 enters and whenever you gain life, surveil 1.', 'enters', 'MACH-1, Swooping Scoundrel'],
      ['Whenever a commander you control enters or attacks, proliferate.', 'enters', undefined],
      ['Whenever you play a card, draw a card.', 'plays_land', undefined],
      ['At the beginning of your upkeep and whenever you cast a black spell, put a charge counter on this artifact.', 'beginning_of_upkeep', undefined],
      ['Whenever you cast a black spell or a Swamp you control enters, you gain 1 life.', 'spell_cast', undefined],
      ['Whenever a permanent you control enters tapped, untap it.', 'enters', undefined],
      ['Whenever a creature you control enters during combat, draw a card.', 'enters', undefined],
      ['Whenever a creature you control with a counter on it deals combat damage to a player, draw a card.', 'deals_combat_damage_to_player', undefined],
      ['When your commander deals combat damage to a player, you become the monarch.', 'deals_combat_damage_to_player', undefined],
      ['Whenever a creature deals damage to you, put a gold counter on it.', 'deals_damage', undefined],
      ['Whenever it deals combat damage to a player this turn, exile cards.', 'deals_combat_damage_to_player', undefined],
      ['When that creature dies, its owner loses the game.', 'dies', undefined],
      ['Whenever one or more creatures attack one of your opponents, they gain menace.', 'attacks', undefined],
      ['Whenever an opponent attacks you with two or more creatures, draw a card.', 'attacks', undefined],
    ];
    for (const [text, event, name] of samples) {
      const c = cond(text, name);
      expect(c?.event, text).toBe(event);
      expect(c?.legacyRuntimeOnly, text).toBeFalsy();
    }
  });
});
