from pathlib import Path
test2 = Path(r"D:/Git/MTGEDH/server/tests/attacks-a-player-alone.unit.test.ts")
test2.write_text(r'''import { describe, expect, it } from 'vitest';
import { detectAttackTriggers } from '../src/state/modules/triggered-abilities.js';
import {
  isAttackWatcherTriggerType,
  planAttackWatcherQueue,
} from '../src/state/modules/triggers/attack-watcher-queue.js';

const PLAYER_ALONE_ORACLE =
  'Whenever a creature you control attacks a player alone, draw a card.';
const EXALTED_ALONE_ORACLE =
  'Whenever a creature you control attacks alone, it gets +1/+1 until end of turn.';

function perm(id: string, controller: string, card: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    id,
    controller,
    owner: controller,
    tapped: true,
    counters: {},
    card: { id: `${id}_card`, ...card },
    ...extra,
  };
}

function plan(
  trigger: any,
  source: any,
  attackers: any[],
  battlefield: any[] = attackers,
  attackedBy: Record<string, string> = {},
) {
  return planAttackWatcherQueue(
    trigger,
    source,
    attackers,
    'p1',
    ['p2', 'p3', 'p4'],
    battlefield,
    (attacker) => String(attackedBy[String(attacker?.id || '')] || attacker?.attacking || 'p2'),
  );
}

describe('CR 506.6 attacks a player alone vs exalted attacks alone', () => {
  it('detects creature_attacks_a_player_alone distinctly from creature_attacks_alone', () => {
    const aloneSource = perm('source_alone', 'p1', {
      name: 'Alone Watcher',
      type_line: 'Creature — Human',
      oracle_text: EXALTED_ALONE_ORACLE,
    });
    const playerAloneSource = perm('source_player_alone', 'p1', {
      name: 'Player Alone Watcher',
      type_line: 'Creature — Human',
      oracle_text: PLAYER_ALONE_ORACLE,
    });

    const aloneTriggers = detectAttackTriggers(aloneSource.card, aloneSource);
    const playerAloneTriggers = detectAttackTriggers(playerAloneSource.card, playerAloneSource);

    expect(aloneTriggers.some((t) => t.triggerType === 'creature_attacks_alone')).toBe(true);
    expect(aloneTriggers.some((t) => t.triggerType === 'creature_attacks_a_player_alone')).toBe(false);

    expect(playerAloneTriggers.some((t) => t.triggerType === 'creature_attacks_a_player_alone')).toBe(true);
    expect(playerAloneTriggers.some((t) => t.triggerType === 'creature_attacks_alone')).toBe(false);
    expect(isAttackWatcherTriggerType('creature_attacks_a_player_alone')).toBe(true);
  });

  it('fires per creature when one attacker is sent at each of three opponents', () => {
    const source = perm('watcher', 'p1', {
      name: 'Player Alone Watcher',
      type_line: 'Enchantment',
      oracle_text: PLAYER_ALONE_ORACLE,
    });
    const trigger = detectAttackTriggers(source.card, source).find(
      (entry) => entry.triggerType === 'creature_attacks_a_player_alone',
    );
    expect(trigger).toBeDefined();

    const z1 = perm('z1', 'p1', { name: 'Zombie', type_line: 'Creature — Zombie', power: '2', toughness: '2' }, { attacking: 'p2' });
    const z2 = perm('z2', 'p1', { name: 'Zombie', type_line: 'Creature — Zombie', power: '2', toughness: '2' }, { attacking: 'p3' });
    const z3 = perm('z3', 'p1', { name: 'Zombie', type_line: 'Creature — Zombie', power: '2', toughness: '2' }, { attacking: 'p4' });

    const result = plan(trigger, source, [z1, z2, z3], [source, z1, z2, z3], {
      z1: 'p2',
      z2: 'p3',
      z3: 'p4',
    });

    expect(result.kind).toBe('per_attacker');
    expect((result as any).attackers.map((a: any) => a.id).sort()).toEqual(['z1', 'z2', 'z3']);
  });

  it('does not fire exalted-style attacks alone in the three-opponent one-each case', () => {
    const source = perm('watcher', 'p1', {
      name: 'Alone Watcher',
      type_line: 'Enchantment',
      oracle_text: EXALTED_ALONE_ORACLE,
    });
    const trigger = detectAttackTriggers(source.card, source).find(
      (entry) => entry.triggerType === 'creature_attacks_alone',
    );
    expect(trigger).toBeDefined();

    const z1 = perm('z1', 'p1', { name: 'Zombie', type_line: 'Creature — Zombie' }, { attacking: 'p2' });
    const z2 = perm('z2', 'p1', { name: 'Zombie', type_line: 'Creature — Zombie' }, { attacking: 'p3' });
    const z3 = perm('z3', 'p1', { name: 'Zombie', type_line: 'Creature — Zombie' }, { attacking: 'p4' });

    const result = plan(trigger, source, [z1, z2, z3], [source, z1, z2, z3], {
      z1: 'p2',
      z2: 'p3',
      z3: 'p4',
    });
    expect(result.kind).toBe('skip');
  });

  it('skips attacks-a-player-alone when two creatures attack the same player', () => {
    const source = perm('watcher', 'p1', {
      name: 'Player Alone Watcher',
      type_line: 'Enchantment',
      oracle_text: PLAYER_ALONE_ORACLE,
    });
    const trigger = detectAttackTriggers(source.card, source).find(
      (entry) => entry.triggerType === 'creature_attacks_a_player_alone',
    );
    expect(trigger).toBeDefined();

    const z1 = perm('z1', 'p1', { name: 'Zombie', type_line: 'Creature — Zombie' }, { attacking: 'p2' });
    const z2 = perm('z2', 'p1', { name: 'Zombie', type_line: 'Creature — Zombie' }, { attacking: 'p2' });
    const z3 = perm('z3', 'p1', { name: 'Zombie', type_line: 'Creature — Zombie' }, { attacking: 'p3' });

    const result = plan(trigger, source, [z1, z2, z3], [source, z1, z2, z3], {
      z1: 'p2',
      z2: 'p2',
      z3: 'p3',
    });

    expect(result.kind).toBe('per_attacker');
    expect((result as any).attackers.map((a: any) => a.id)).toEqual(['z3']);
  });
});
''', encoding='utf-8', newline='\n')
print('wrote', test2)
