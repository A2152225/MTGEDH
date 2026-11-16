import { describe, expect, it } from 'vitest';
import { parseTriggerClause, normalizeSelfNameInTriggerSentence } from '../../rules-engine/src/triggerCondition/index.js';
import { collectMatchingParsedEventLines } from '../src/state/modules/triggers/triggerConditionFamilyMatch.js';
import { emitNoncombatDamageEvent } from '../src/state/modules/triggers/noncombat-deals-damage.js';
import { emitFightsTriggers } from '../src/state/modules/triggers/fight-triggers.js';
import { appendGraveyardSourceEtbParsedLines } from '../src/state/modules/etbGraveyardSourceIr.js';

const cond = (s: string, name?: string) => parseTriggerClause(s, name)?.condition as any;
const sourceId = (x: any) => String(x?.permanentId || x?.source?.permanentId || x?.sourceId || x?.source || '');
const fromId = (list: any[], id: string) => list.filter((x) => sourceId(x) === id);
const perm = (id: string, controller: string, card: any, extra: any = {}) => ({
  id, controller, owner: controller, tapped: false, counters: {},
  card: { id: id + '_c', ...card }, ...extra,
});

function ctxOf(battlefield: any[], extra: Record<string, unknown> = {}) {
  const state: any = {
    seq: 1, stack: [], battlefield,
    players: [{ id: 'p1', life: 30 }, { id: 'p2', life: 20 }],
    commandZone: {},
    turnPlayer: 'p1', activePlayer: 'p1', turnNumber: 3, phase: 'main1', step: 'main',
    zones: {
      p1: { hand: [], graveyard: [], exile: [], library: [] },
      p2: { hand: [], graveyard: [], exile: [], library: [] },
    },
    spellsCastThisTurn: [],
    ...extra,
  };
  if (extra.zones) state.zones = extra.zones;
  return { state, gameId: 'r9', bumpSeq() { state.seq++; }, isReplaying: false } as any;
}

const GATE_ORACLE = 'Whenever a Gate you control enters, you may put this card from your graveyard on top of your library.';
const FOE_ORACLE = 'Whenever a creature you control fights, put two +1/+1 counters on it at the beginning of the next end step.';
const ELESH_ORACLE = "Whenever a source an opponent controls deals damage to you or a permanent you control, that source's controller loses 2 life unless they pay {1}.";
const PACE_ORACLE = 'Whenever a creature you control that entered this turn attacks, exile the top card of your library.';
const EXTRACTION_ORACLE = 'Whenever a creature blocks this creature, that creature gets -1/-1 until end of turn.';
const FALDORN_ORACLE = 'Whenever you cast a spell from exile or a land you control enters from exile, create a 2/2 green Wolf creature token.';
const TUI_ORACLE = 'Whenever Tui and La become tapped, draw a card.';

describe('legacy r9 near-misses, fights, and damage half-parses', () => {
  it('parses typal Gate, entered-this-turn attacks, fights, Elesh, Faldorn, and blocks-this', () => {
    const norm = normalizeSelfNameInTriggerSentence(GATE_ORACLE, 'Gate Colossus');
    expect(norm.toLowerCase()).toContain('gate you control');
    expect(norm.toLowerCase()).not.toContain('a this permanent you control');

    const gate = cond(GATE_ORACLE, 'Gate Colossus');
    expect(gate?.event).toBe('enters');
    expect(gate?.legacyRuntimeOnly).toBeFalsy();
    expect(gate?.sourceInGraveyard).toBe(true);

    const pace = cond(PACE_ORACLE, 'Pick Up the Pace');
    expect(pace?.event).toBe('attacks');
    expect(pace?.enteredThisTurn).toBe(true);
    expect(pace?.legacyRuntimeOnly).toBeFalsy();

    const fights = cond(FOE_ORACLE, 'Foe-Razer Regent');
    expect(fights?.event).toBe('fights');
    expect(fights?.legacyRuntimeOnly).toBeFalsy();

    const elesh = cond(ELESH_ORACLE, 'Elesh Norn');
    expect(elesh?.event).toBe('deals_damage');
    expect(elesh?.damageRecipient).toBe('you_or_permanent_you_control');
    expect(elesh?.legacyRuntimeOnly).toBeFalsy();

    const faldorn = cond(FALDORN_ORACLE, 'Faldorn, Dread Wolf Herald');
    expect(faldorn?.legacyRuntimeOnly).toBeFalsy();
    expect([faldorn?.event, faldorn?.pairedEvent].sort().join(',')).toBe('enters,spell_cast');

    const blocks = cond(EXTRACTION_ORACLE, 'Extraction Integrant');
    expect(blocks?.event).toBe('blocks');
    expect(blocks?.blockPartnerIsSource).toBe(true);
    expect(blocks?.legacyRuntimeOnly).toBeFalsy();

    const tui = cond(TUI_ORACLE, 'Tui and La, Moon and Ocean');
    expect(tui?.event).toBe('becomes_tapped');
    expect(tui?.legacyRuntimeOnly).toBeFalsy();
  });

  it('entered-this-turn attacks fire once only for a creature that entered this turn', () => {
    const watcher = perm('w', 'p1', { name: 'Pick Up the Pace', oracle_text: PACE_ORACLE, type_line: 'Instant' });
    const fresh = perm('a', 'p1', { name: 'Bear', oracle_text: '', type_line: 'Creature — Bear' }, { enteredThisTurn: true, attacking: true });
    const old = perm('b', 'p1', { name: 'Old Bear', oracle_text: '', type_line: 'Creature — Bear' }, { attacking: true });
    const ctx = ctxOf([watcher, fresh, old]);
    const atFresh = collectMatchingParsedEventLines({
      ctx, oracleText: PACE_ORACLE, event: 'attacks',
      subjectPermanent: fresh, subjectControllerId: 'p1', sourcePermanent: watcher,
    });
    expect(atFresh).toHaveLength(1);
    const atOld = collectMatchingParsedEventLines({
      ctx, oracleText: PACE_ORACLE, event: 'attacks',
      subjectPermanent: old, subjectControllerId: 'p1', sourcePermanent: watcher,
    });
    expect(atOld).toHaveLength(0);
  });

  it('Gate Colossus fires once from the graveyard when a Gate you control enters, and not otherwise', () => {
    const colossusCard = { id: 'gc', name: 'Gate Colossus', oracle_text: GATE_ORACLE, type_line: 'Artifact Creature — Construct' };
    const gate = perm('g', 'p1', { name: 'Izzet Guildgate', oracle_text: '', type_line: 'Land — Gate' });
    const mountain = perm('m', 'p1', { name: 'Mountain', oracle_text: '', type_line: 'Basic Land — Mountain' });
    const pending: any[] = [];
    const ctx = ctxOf([gate], {
      zones: {
        p1: { hand: [], graveyard: [colossusCard], exile: [], library: [] },
        p2: { hand: [], graveyard: [], exile: [], library: [] },
      },
    });
    appendGraveyardSourceEtbParsedLines({
      ctx, state: ctx.state, enteringPermanent: gate, enteringController: 'p1', pending,
      pushPending: (_state, list, item) => { list.push(item); },
    });
    expect(fromId(pending, 'gc')).toHaveLength(1);

    const pendingMountain: any[] = [];
    appendGraveyardSourceEtbParsedLines({
      ctx, state: ctx.state, enteringPermanent: mountain, enteringController: 'p1', pending: pendingMountain,
      pushPending: (_state, list, item) => { list.push(item); },
    });
    expect(fromId(pendingMountain, 'gc')).toHaveLength(0);

    const pendingOpp: any[] = [];
    const oppCtx = ctxOf([gate], {
      zones: {
        p1: { hand: [], graveyard: [], exile: [], library: [] },
        p2: { hand: [], graveyard: [colossusCard], exile: [], library: [] },
      },
    });
    appendGraveyardSourceEtbParsedLines({
      ctx: oppCtx, state: oppCtx.state, enteringPermanent: gate, enteringController: 'p1', pending: pendingOpp,
      pushPending: (_state, list, item) => { list.push(item); },
    });
    expect(fromId(pendingOpp, 'gc')).toHaveLength(0);
  });

  it('Foe-Razer Regent fires once when a creature you control fights, and not when only opponents fight', () => {
    const watcher = perm('w', 'p1', { name: 'Foe-Razer Regent', oracle_text: FOE_ORACLE, type_line: 'Creature — Dragon' });
    const yours = perm('a', 'p1', { name: 'Bear', oracle_text: '', type_line: 'Creature — Bear' }, { power: 2 });
    const opp = perm('b', 'p2', { name: 'Goat', oracle_text: '', type_line: 'Creature — Goat' }, { power: 2 });
    const otherOpp = perm('c', 'p2', { name: 'Ox', oracle_text: '', type_line: 'Creature — Ox' }, { power: 2 });
    const ctx = ctxOf([watcher, yours, opp, otherOpp]);
    emitFightsTriggers(ctx, yours, opp);
    expect(fromId(ctx.state.stack, 'w')).toHaveLength(1);

    ctx.state.stack = [];
    emitFightsTriggers(ctx, opp, otherOpp);
    expect(fromId(ctx.state.stack, 'w')).toHaveLength(0);
  });

  it('Elesh Norn fires once when an opponent source deals damage to you or a permanent you control', () => {
    const elesh = perm('w', 'p1', { name: 'Elesh Norn', oracle_text: ELESH_ORACLE, type_line: 'Creature — Phyrexian Praetor' });
    const opp = perm('s', 'p2', { name: 'Bolt Source', oracle_text: '', type_line: 'Creature — Elemental' });
    const yours = perm('c', 'p1', { name: 'Bear', oracle_text: '', type_line: 'Creature — Bear' });
    const ctx = ctxOf([elesh, opp, yours]);
    emitNoncombatDamageEvent(ctx, { sourcePermanentId: 's', playerIds: ['p1'] });
    expect(fromId(ctx.state.stack, 'w')).toHaveLength(1);

    ctx.state.stack = [];
    emitNoncombatDamageEvent(ctx, { sourcePermanentId: 's', permanentIds: ['c'] });
    expect(fromId(ctx.state.stack, 'w')).toHaveLength(1);

    ctx.state.stack = [];
    emitNoncombatDamageEvent(ctx, { sourcePermanentId: 'c', playerIds: ['p1'] });
    expect(fromId(ctx.state.stack, 'w')).toHaveLength(0);
  });

  it('Extraction Integrant fires once when a creature blocks it, and not when it blocks something else', () => {
    const integrant = perm('w', 'p1', { name: 'Extraction Integrant', oracle_text: EXTRACTION_ORACLE, type_line: 'Creature' }, { attacking: true });
    const blocker = perm('b', 'p2', { name: 'Wall', oracle_text: '', type_line: 'Creature — Wall' }, { blocking: ['w'] });
    const otherAtk = perm('a', 'p1', { name: 'Bear', oracle_text: '', type_line: 'Creature — Bear' }, { attacking: true });
    const otherBlocker = perm('d', 'p2', { name: 'Other Wall', oracle_text: '', type_line: 'Creature — Wall' }, { blocking: ['a'] });
    const ctx = ctxOf([integrant, blocker, otherAtk]);
    const hits = collectMatchingParsedEventLines({
      ctx, oracleText: EXTRACTION_ORACLE, event: 'blocks',
      subjectPermanent: blocker, subjectControllerId: 'p2', sourcePermanent: integrant,
      blockPartnerPermanent: integrant,
    });
    expect(hits).toHaveLength(1);

    const misses = collectMatchingParsedEventLines({
      ctx, oracleText: EXTRACTION_ORACLE, event: 'blocks',
      subjectPermanent: otherBlocker, subjectControllerId: 'p2', sourcePermanent: integrant,
      blockPartnerPermanent: otherAtk,
    });
    expect(misses).toHaveLength(0);
  });

  it('Tui and La become-tapped fires once on a self-tap', () => {
    const tui = perm('w', 'p1', { name: 'Tui and La, Moon and Ocean', oracle_text: TUI_ORACLE, type_line: 'Legendary Creature' });
    const ctx = ctxOf([tui]);
    const first = collectMatchingParsedEventLines({
      ctx, oracleText: TUI_ORACLE, event: 'becomes_tapped',
      subjectPermanent: tui, subjectControllerId: 'p1', sourcePermanent: tui,
    });
    expect(first).toHaveLength(1);
    const other = perm('x', 'p2', { name: 'Goat', oracle_text: '', type_line: 'Creature — Goat' });
    const miss = collectMatchingParsedEventLines({
      ctx, oracleText: TUI_ORACLE, event: 'becomes_tapped',
      subjectPermanent: other, subjectControllerId: 'p2', sourcePermanent: tui,
    });
    expect(miss).toHaveLength(0);
  });
});
