import { describe, expect, it } from 'vitest';
import { queueParsedKeywordAction, queueParsedSubjectEvent } from '../src/state/modules/triggerEmissionFamilyUtils.js';
import { parseTriggerClause, triggerConditionMatches } from '../../rules-engine/src/triggerCondition/index.js';

const cond = (s: string) => parseTriggerClause(s)?.condition as any;
const src = (extra: Record<string, unknown> = {}) => ({ id: 'w', controllerId: 'p1', ...extra } as any);

function emitCtx(oracle: string) {
  const permanent = { id: 'w1', controller: 'p1', owner: 'p1', card: { name: 'Watcher', type_line: 'Creature', oracle_text: oracle } };
  const ctx: any = { gameId: 'r49', isReplaying: false, state: { battlefield: [permanent], stack: [], turnNumber: 1, players: [{ id: 'p1' }, { id: 'p2' }] } };
  return { ctx, permanent };
}

describe('round 49 uncovered families', () => {
  it('attack with eight or more + opponent scries + win a clash fire once', () => {
    const atk = cond('Whenever you attack with eight or more creatures, create two 2/2 white Knight creature tokens.');
    expect(atk?.event).toBe('attacks');
    expect(atk?.minOtherAttackers).toBe(7);
    expect(cond('Whenever an opponent scries, you may draw a card.')?.action).toBe('scry');
    expect(cond('Whenever you win a clash, draw a card.')?.action).toBe('win_clash');
    const clash = emitCtx('Whenever you win a clash, draw a card.');
    expect(queueParsedKeywordAction(clash.ctx, 'p1', 'win_clash').filter((q: any) => /draw a card/i.test(String(q.effect || ''))).length).toBe(1);
    expect(queueParsedKeywordAction(clash.ctx, 'p1', 'win_clash').filter((q: any) => /draw a card/i.test(String(q.effect || ''))).length).toBe(0);
    const scry = emitCtx('Whenever an opponent scries, you may draw a card.');
    expect(queueParsedKeywordAction(scry.ctx, 'p2', 'scry').filter((q: any) => /draw a card/i.test(String(q.effect || ''))).length).toBe(1);
    expect(queueParsedKeywordAction(scry.ctx, 'p2', 'scry').filter((q: any) => /draw a card/i.test(String(q.effect || ''))).length).toBe(0);
  });

  it('you or another permanent becomes target + crime during your turn + first life/tokens', () => {
    const target = cond('Whenever you or another permanent you control becomes the target of a spell or ability an opponent controls, draw a card.');
    expect(target?.event).toBe('becomes_target');
    expect(target?.orControllerPlayer).toBe(true);
    const crime = cond('Whenever you commit a crime during your turn, put a +1/+1 counter on this creature.');
    expect(crime?.event).toBe('commits_crime');
    expect(crime?.whoseTurn).toBe('you');
    const life = cond('Whenever you gain life for the first time during each of your turns, create a Cat token.');
    expect(life?.onceEachTurn).toBe(true);
    expect(life?.whoseTurn).toBe('you');
    const tokens = cond('Whenever you create one or more tokens for the first time each turn, create a 1/1 Bird creature token.');
    expect(tokens?.event).toBe('creates_token');
    expect(tokens?.onceEachTurn).toBe(true);
    const { ctx } = emitCtx('Whenever you create one or more tokens for the first time each turn, create a 1/1 Bird creature token.');
    const subject = { id: 't1', controller: 'p1', card: { name: 'Bird', type_line: 'Creature - Bird', isToken: true } };
    expect(queueParsedSubjectEvent(ctx, {
      event: 'creates_token',
      subjectPermanent: subject,
      subjectControllerId: 'p1',
      triggerType: 'creates_token',
    }).filter((q: any) => /bird/i.test(String(q.effect || ''))).length).toBe(1);
    expect(queueParsedSubjectEvent(ctx, {
      event: 'creates_token',
      subjectPermanent: subject,
      subjectControllerId: 'p1',
      triggerType: 'creates_token',
    }).filter((q: any) => /bird/i.test(String(q.effect || ''))).length).toBe(0);
  });

  it('gain control from another player + put into graveyard variants fire once', () => {
    expect(cond('When you gain control of this enchantment from another player, destroy all creatures.')?.event).toBe('gains_control');
    const gy = cond('Whenever a permanent you control is put into a graveyard, you get {E}.');
    expect(gy?.event).toBe('put_into_graveyard');
    const cards = cond('Whenever one or more creature cards are put into graveyards from anywhere, investigate.');
    expect(cards?.event).toBe('put_into_graveyard');
    expect(cards?.fromZone).toBe('anywhere');
    const { ctx } = emitCtx('Whenever a permanent you control is put into a graveyard, you get {E}.');
    const perm = { id: 'p2', controller: 'p1', card: { name: 'Sol Ring', type_line: 'Artifact' } };
    expect(queueParsedSubjectEvent(ctx, {
      event: 'put_into_graveyard',
      subjectPermanent: perm,
      subjectControllerId: 'p1',
      triggerType: 'put_into_graveyard',
      fromZone: 'battlefield',
    }).filter((q: any) => /\{E\}|energy/i.test(String(q.effect || '')) || /get/i.test(String(q.effect || ''))).length).toBe(1);
    expect(queueParsedSubjectEvent(ctx, {
      event: 'put_into_graveyard',
      subjectPermanent: perm,
      subjectControllerId: 'p1',
      triggerType: 'put_into_graveyard',
      fromZone: 'battlefield',
    }).filter((q: any) => /\{E\}|energy/i.test(String(q.effect || '')) || /get/i.test(String(q.effect || ''))).length).toBe(0);
  });

  it('phase enchanted player/controller + passive is cast + second spell during their turn', () => {
    expect(cond("At the beginning of each of enchanted player's postcombat main phases, there is an additional beginning phase after this phase.")?.whoseTurn).toBe('enchanted_player');
    expect(cond("At the beginning of the draw step of enchanted creature's controller, draw a card.")).toMatchObject({
      event: 'beginning_of_draw_step',
      whoseTurn: 'enchanted_controller',
    });
    const cast = cond('Whenever an instant or sorcery spell is cast during your turn, Sentinel Tower deals 1 damage to each opponent.');
    expect(cast?.event).toBe('spell_cast');
    expect(cast?.whoseTurn).toBe('you');
    expect(cond('Whenever a player casts their second spell during their turn, draw a card.')?.ordinal).toBe('second');
  });

  it('green or white block partner + goaded combat damage to one of your opponents', () => {
    const block = cond('Whenever this creature blocks or becomes blocked by a green or white creature, destroy that creature at end of combat.');
    expect(block?.event).toBe('blocks');
    expect(block?.pairedEvent).toBe('becomes_blocked');
    expect(block?.blockPartner?.colors).toEqual(expect.arrayContaining(['g', 'w']));
    expect(triggerConditionMatches(block, { id: 'w', typeLine: 'Creature', controllerId: 'p1' } as any, src(), {
      blockPartner: { id: 'bp', typeLine: 'Creature - Elf', controllerId: 'p2', colors: ['g'] },
    } as any)).toBe(true);
    expect(triggerConditionMatches(block, { id: 'w', typeLine: 'Creature', controllerId: 'p1' } as any, src(), {
      blockPartner: { id: 'bp', typeLine: 'Creature - Goblin', controllerId: 'p2', colors: ['r'] },
    } as any)).toBe(false);

    const dmg = cond('Whenever one or more goaded creatures deal combat damage to one of your opponents, draw a card.');
    expect(dmg?.event).toBe('deals_combat_damage_to_player');
    expect(dmg?.alternatives[0].subject.goaded).toBe(true);
    expect(triggerConditionMatches(dmg, { id: 'g1', typeLine: 'Creature', controllerId: 'p1', goaded: true } as any, src())).toBe(true);
    expect(triggerConditionMatches(dmg, { id: 'g1', typeLine: 'Creature', controllerId: 'p1', goaded: false } as any, src())).toBe(false);
  });
});