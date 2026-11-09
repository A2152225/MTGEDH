import { describe, expect, it } from 'vitest';
import { permanentToTriggerMatch, collectMatchingParsedEventLines } from '../src/state/modules/triggers/triggerConditionFamilyMatch.js';
import { processEquippedTriggers } from '../src/state/modules/triggerEmissionFamilyUtils.js';
import { parseTriggerClause, triggerConditionMatches } from '../../rules-engine/src/triggerCondition/index.js';

const cond = (s: string) => parseTriggerClause(s)?.condition as any;
const src = (id = 'host') => ({ id, controllerId: 'p1' } as any);
const spell = (type_line: string, controller = 'p1') =>
  permanentToTriggerMatch({ id: 'sp', controller, card: { id: 'sp', name: 'Spell', type_line, oracle_text: '' } } as any, controller) as any;

describe('round 45 uncovered families', () => {
  it('Aura becomes attached to this creature fires once on the host', () => {
    const c = cond('Whenever an Aura becomes attached to this creature, draw a card.');
    expect(c?.event).toBe('becomes_attached');
    expect(c.attachedToSource).toBe(true);
    const host = {
      id: 'host', controller: 'p1', owner: 'p1',
      card: { name: 'Bramble Elemental', type_line: 'Creature', oracle_text: 'Whenever an Aura becomes attached to this creature, create a 1/1 green Elemental creature token.' },
    };
    const aura = {
      id: 'aura1', controller: 'p2', owner: 'p2', attachedTo: 'host',
      card: { name: 'Pacifism', type_line: 'Enchantment - Aura', oracle_text: 'Enchant creature' },
    };
    const ctx: any = { gameId: 'r45', isReplaying: false, state: { battlefield: [host, aura], stack: [], turnNumber: 1, players: [{ id: 'p1' }, { id: 'p2' }] } };
    const queued = processEquippedTriggers(ctx, aura, host);
    const fromHost = queued.filter((q: any) => String(q?.effect || '').toLowerCase().includes('elemental'));
    expect(fromHost.length).toBe(1);
    // Stack dedupe: a second emit for the same attach does not double-queue.
    expect(processEquippedTriggers(ctx, aura, host).filter((q: any) => String(q?.effect || '').toLowerCase().includes('elemental')).length).toBe(0);
  });

  it('targets only this creature requires sole target', () => {
    const c = cond('Whenever you cast an instant or sorcery spell that targets only this creature, copy that spell.');
    expect(c?.targets).toBe('self_only');
    const s = spell('Instant');
    expect(triggerConditionMatches(c, s, src('host'), { targetPermanentIds: ['host'] } as any)).toBe(true);
    expect(triggerConditionMatches(c, s, src('host'), { targetPermanentIds: ['host', 'other'] } as any)).toBe(false);
    expect(triggerConditionMatches(c, s, src('host'), { targetPermanentIds: ['other'] } as any)).toBe(false);
  });

  it('enchanted player casts matches the enchanted player only', () => {
    const c = cond('Whenever enchanted player casts an instant or sorcery spell, copy that spell.');
    expect(c.alternatives[0].controller).toBe('enchanted_player');
    expect(triggerConditionMatches(c, spell('Instant', 'p2'), src('curse'), { enchantedPlayerId: 'p2' } as any)).toBe(true);
    expect(triggerConditionMatches(c, spell('Instant', 'p1'), src('curse'), { enchantedPlayerId: 'p2' } as any)).toBe(false);
  });

  it('you attack with your commander parses to commander attacks', () => {
    const c = cond('Whenever you attack with your commander, draw a card.');
    expect(c?.event).toBe('attacks');
    expect(c.quantity).toBe('one_or_more');
    expect(c.alternatives[0].subject.commander).toBe(true);
    const commander = permanentToTriggerMatch({
      id: 'cmd', controller: 'p1', isCommander: true,
      card: { name: 'Cmd', type_line: 'Creature - Human', oracle_text: '', power: '2', toughness: '2' },
    } as any, 'p1') as any;
    expect(triggerConditionMatches(c, commander, src('w'))).toBe(true);
    const bear = permanentToTriggerMatch({
      id: 'b', controller: 'p1',
      card: { name: 'Bear', type_line: 'Creature - Bear', oracle_text: '', power: '2', toughness: '2' },
    } as any, 'p1') as any;
    expect(triggerConditionMatches(c, bear, src('w'))).toBe(false);
  });
});
