import { describe, expect, it } from 'vitest';
import { permanentToTriggerMatch, collectMatchingParsedEventLines } from '../src/state/modules/triggers/triggerConditionFamilyMatch.js';
import { queueParsedKeywordAction } from '../src/state/modules/triggerEmissionFamilyUtils.js';
import { detectBeginningOfCombatTriggers, getBeginningOfCombatTriggers } from '../src/state/modules/triggers/combat.js';
import { detectPrecombatMainTriggers, getPrecombatMainTriggers } from '../src/state/modules/triggers/turn-phases.js';
import { parseTriggerClause, triggerConditionMatches } from '../../rules-engine/src/triggerCondition/index.js';

const cond = (s: string) => parseTriggerClause(s)?.condition as any;
const src = (id = 'w', extra: Record<string, unknown> = {}) => ({ id, controllerId: 'p1', ...extra } as any);
const spell = (name: string, type_line = 'Instant', controller = 'p2') =>
  ({ id: 'sp', name, typeLine: type_line, controllerId: controller } as any);

function emitCtx(oracle: string, name = 'Watcher') {
  const permanent = {
    id: 'w1', controller: 'p1', owner: 'p1',
    card: { name, type_line: 'Creature', oracle_text: oracle },
  };
  const ctx: any = {
    gameId: 'r46', isReplaying: false,
    state: { battlefield: [permanent], stack: [], turnNumber: 1, players: [{ id: 'p1' }, { id: 'p2' }] },
  };
  return { ctx, permanent };
}

describe('round 46 uncovered families', () => {
  it('each-player first main fires via legacy detector + getter', () => {
    const card = {
      name: "Eladamri's Vineyard",
      oracle_text: "At the beginning of each player's first main phase, that player adds {G}{G}.",
      type_line: 'Enchantment',
    };
    const permanent = { id: 'v', controller: 'p1', card };
    const detected = detectPrecombatMainTriggers(card, permanent);
    expect(detected.length).toBeGreaterThanOrEqual(1);
    expect(detected.some((t: any) => /adds/i.test(String(t.effect || t.description || '')))).toBe(true);
    const ctx: any = {
      gameId: 'r46', isReplaying: false,
      state: { battlefield: [permanent], stack: [], turnNumber: 1, players: [{ id: 'p1' }, { id: 'p2' }], activePlayer: 'p2' },
    };
    const queued = getPrecombatMainTriggers(ctx, 'p2');
    expect(queued.length).toBeGreaterThanOrEqual(1);
    expect(queued.some((t: any) => String(t.permanentId) === 'v')).toBe(true);
  });

  it("combat on each opponent's turn fires via legacy detector + getter", () => {
    const card = {
      name: 'Fight or Flight',
      oracle_text: "At the beginning of combat on each opponent's turn, separate all creatures that player controls into two piles.",
      type_line: 'Enchantment',
    };
    const permanent = { id: 'f', controller: 'p1', card };
    const detected = detectBeginningOfCombatTriggers(card, permanent);
    expect(detected.some((t: any) => t.triggerType === 'opponent_turn_combat')).toBe(true);
    const ctx: any = {
      gameId: 'r46', isReplaying: false,
      state: {
        battlefield: [permanent], stack: [], turnNumber: 1,
        players: [{ id: 'p1' }, { id: 'p2' }], activePlayer: 'p2',
      },
    };
    const queued = getBeginningOfCombatTriggers(ctx, 'p2');
    expect(queued.some((t: any) => String(t.permanentId) === 'f')).toBe(true);
  });

  it('win/lose coin flip parse and queue once', () => {
    expect(cond('Whenever a player wins a coin flip, draw a card.')?.action).toBe('win_coin_flip');
    expect(cond('Whenever you lose a coin flip, this creature deals 1 damage to any target.')?.action).toBe('lose_coin_flip');
    const { ctx } = emitCtx('Whenever a player wins a coin flip, draw a card.\nWhenever you lose a coin flip, this creature deals 1 damage to any target.');
    expect(queueParsedKeywordAction(ctx, 'p1', 'win_coin_flip').filter((q: any) => /draw a card/i.test(String(q.effect || ''))).length).toBe(1);
    expect(queueParsedKeywordAction(ctx, 'p1', 'win_coin_flip').filter((q: any) => /draw a card/i.test(String(q.effect || ''))).length).toBe(0);
    expect(queueParsedKeywordAction(ctx, 'p1', 'lose_coin_flip').filter((q: any) => /deals 1 damage/i.test(String(q.effect || ''))).length).toBe(1);
    expect(queueParsedKeywordAction(ctx, 'p1', 'lose_coin_flip').filter((q: any) => /deals 1 damage/i.test(String(q.effect || ''))).length).toBe(0);
  });

  it('collect evidence / get energy / place sticker / saga final queue once', () => {
    expect(cond('Whenever you collect evidence, investigate.')?.action).toBe('collect_evidence');
    expect(cond('Whenever you get one or more {E} (energy counters), put a +1/+1 counter on target creature you control.')?.action).toBe('get_energy');
    expect(cond('Whenever you place a sticker, create a Treasure token.')?.action).toBe('place_sticker');
    expect(cond('Whenever the final chapter ability of a Saga you control resolves, draw two cards.')?.action).toBe('saga_final_chapter');
    const { ctx } = emitCtx(
      'Whenever you collect evidence, investigate.\n' +
      'Whenever you get one or more {E} (energy counters), put a +1/+1 counter on target creature you control.\n' +
      'Whenever you place a sticker, create a Treasure token.\n' +
      'Whenever the final chapter ability of a Saga you control resolves, draw two cards.',
    );
    expect(queueParsedKeywordAction(ctx, 'p1', 'collect_evidence').filter((q: any) => /investigate/i.test(String(q.effect || ''))).length).toBe(1);
    expect(queueParsedKeywordAction(ctx, 'p1', 'collect_evidence').filter((q: any) => /investigate/i.test(String(q.effect || ''))).length).toBe(0);
    expect(queueParsedKeywordAction(ctx, 'p1', 'get_energy').filter((q: any) => /\+1\/\+1/i.test(String(q.effect || ''))).length).toBe(1);
    expect(queueParsedKeywordAction(ctx, 'p1', 'get_energy').filter((q: any) => /\+1\/\+1/i.test(String(q.effect || ''))).length).toBe(0);
    expect(queueParsedKeywordAction(ctx, 'p1', 'place_sticker').filter((q: any) => /treasure/i.test(String(q.effect || ''))).length).toBe(1);
    expect(queueParsedKeywordAction(ctx, 'p1', 'place_sticker').filter((q: any) => /treasure/i.test(String(q.effect || ''))).length).toBe(0);
    const sagaFirst = queueParsedKeywordAction(ctx, 'p1', 'saga_final_chapter').filter((q: any) => /draw two cards/i.test(String(q.effect || '')));
    expect(sagaFirst.length).toBe(1);
    expect(queueParsedKeywordAction(ctx, 'p1', 'saga_final_chapter').filter((q: any) => /draw two cards/i.test(String(q.effect || ''))).length).toBe(0);
  });

  it('Curse of Silence chosen name matches', () => {
    const c = cond('Whenever enchanted player casts a spell with the chosen name, you may sacrifice this Aura. If you do, draw a card.');
    expect(c?.requiresChosenName).toBe(true);
    expect(c.alternatives[0].controller).toBe('enchanted_player');
    const aura = src('curse', { chosenCardName: 'Lightning Bolt' });
    expect(triggerConditionMatches(c, spell('Lightning Bolt'), aura, { enchantedPlayerId: 'p2', spellName: 'Lightning Bolt', spellOrdinal: 2 } as any)).toBe(true);
    expect(triggerConditionMatches(c, spell('Shock'), aura, { enchantedPlayerId: 'p2', spellName: 'Shock', spellOrdinal: 2 } as any)).toBe(false);
  });

  it('Curse of Shaken Faith excludes first cast unless copy', () => {
    const c = cond('Whenever enchanted player casts a spell other than the first spell they cast each turn or copies a spell, this Aura deals 2 damage to them.');
    expect(c?.excludeFirstSpellEachTurn).toBe(true);
    expect(c?.orSpellCopy).toBe(true);
    const aura = src('curse');
    expect(triggerConditionMatches(c, spell('Bolt'), aura, { enchantedPlayerId: 'p2', spellOrdinal: 1 } as any)).toBe(false);
    expect(triggerConditionMatches(c, spell('Bolt'), aura, { enchantedPlayerId: 'p2', spellOrdinal: 2 } as any)).toBe(true);
    expect(triggerConditionMatches(c, spell('Bolt'), aura, { enchantedPlayerId: 'p2', spellOrdinal: 1, isSpellCopy: true } as any)).toBe(true);
  });

  it('targets one or more permanents + sacrifice Treasure/during your turn', () => {
    const t = cond('Whenever you cast a spell that targets one or more permanents, draw a card.');
    expect(t?.targets).toBe('permanent');
    expect(triggerConditionMatches(t, spell('Pacifism', 'Enchantment - Aura', 'p1'), src(), {
      targetPermanentIds: ['c1'],
      targetPermanents: [{ typeLine: 'Creature — Bear', controllerId: 'p2' }],
    } as any)).toBe(true);
    expect(triggerConditionMatches(t, spell('Shock', 'Instant', 'p1'), src(), { targetPermanentIds: [] } as any)).toBe(false);

    const treasure = cond('Whenever you sacrifice a Treasure, draw a card.');
    expect(treasure?.event).toBe('sacrifices');
    const during = cond('Whenever you sacrifice another nontoken permanent during your turn, put a +1/+1 counter on up to one other target creature.');
    expect(during?.whoseTurn).toBe('you');
  });

  it('discard this way / connive remain covered by special runtime paths', () => {
    expect(cond('When you discard a card this way, draw a card.')?.event).toBe('discards');
    expect(cond('Whenever a creature you control connives, proliferate.')?.action).toBe('connive');
  });
});