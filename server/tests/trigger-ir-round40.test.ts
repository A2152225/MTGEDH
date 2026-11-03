import { describe, expect, it, afterEach } from 'vitest';
import { isInterveningIfSatisfied, setUnknownInterveningIfPolicy } from '../src/state/modules/triggers/intervening-if.js';
import { parseTriggerClause } from '../../rules-engine/src/triggerCondition/index.js';

const zone = (hand: any[] = []) => ({ hand, graveyard: [] as any[], exile: [], library: [] });
const perm = (id: string, controller: string, name: string, type_line: string, extra: any = {}, cardExtra: any = {}) => ({ id, controller, owner: controller, tapped: false, counters: {}, ...extra, card: { id: id + '_c', name, type_line, oracle_text: '', ...cardExtra } });
const ctxOf = (battlefield: any[], extra: any = {}) => ({ gameId: 'r40', isReplaying: false, state: { battlefield, stack: [] as any[], turnPlayer: 'p1', activePlayer: 'p1', players: [{ id: 'p1' }, { id: 'p2' }], zones: { p1: zone([1, 2]), p2: zone([1, 2, 3]) }, ...extra } } as any);
const sat = (ctx: any, src: any, clause: string) => isInterveningIfSatisfied(ctx, 'p1', 'Whenever this creature attacks, ' + clause + ', draw a card.', src);

describe('round 40 intervening-if: defending player', () => {
  afterEach(() => setUnknownInterveningIfPolicy('skip'));
  it('controls no <subtype>/<color> permanents', () => {
    const atk = perm('a', 'p1', 'Attacker', 'Creature - Human', { attacking: 'p2' });
    const wall = perm('w', 'p2', 'Wall of Stone', 'Creature - Wall', {}, { colors: ['R'] });
    expect(sat(ctxOf([atk, wall]), atk, 'if defending player controls no Walls')).toBe(false);
    expect(sat(ctxOf([atk]), atk, 'if defending player controls no Walls')).toBe(true);
    expect(sat(ctxOf([atk, wall]), atk, 'if defending player controls no black permanents')).toBe(true);
    const zomb = perm('z', 'p2', 'Zombie', 'Creature - Zombie', {}, { colors: ['B'] });
    expect(sat(ctxOf([atk, zomb]), atk, 'if defending player controls no black nontoken permanents')).toBe(false);
    expect(sat(ctxOf([atk, { ...zomb, isToken: true }]), atk, 'if defending player controls no black nontoken permanents')).toBe(true);
  });
  it('more lands / more cards in hand than you', () => {
    const atk = perm('a', 'p1', 'Attacker', 'Creature', { attacking: 'p2' });
    const l2 = perm('l2', 'p2', 'Forest', 'Basic Land - Forest');
    expect(sat(ctxOf([atk, l2]), atk, 'if defending player controls more lands than you')).toBe(true);
    expect(sat(ctxOf([atk, l2, perm('l1', 'p1', 'Forest', 'Basic Land - Forest')]), atk, 'if defending player controls more lands than you')).toBe(false);
    expect(sat(ctxOf([atk]), atk, 'if defending player has more cards in hand than you')).toBe(true);
  });
  it('defending player via refs and undecidable shapes are skipped with telemetry', () => {
    const src = perm('a', 'p1', 'Attacker', 'Creature');
    const ctx = ctxOf([src]);
    expect(isInterveningIfSatisfied(ctx, 'p1', 'Whenever this creature attacks, if defending player is poisoned in a weird way, draw a card.', src)).toBe(false);
    expect(ctx.state.unknownInterveningIfClauses['if defending player is poisoned in a weird way']).toBe(1);
    setUnknownInterveningIfPolicy('keep');
    expect(isInterveningIfSatisfied(ctx, 'p1', 'Whenever this creature attacks, if defending player is poisoned in a weird way, draw a card.', src)).toBe(null);
  });
});

describe('round 40 intervening-if: enchanted / equipped', () => {
  it('reads the attached permanent', () => {
    const host = perm('h', 'p1', 'Grizzly Bears', 'Creature - Bear Wolf', { power: 4 }, { colors: ['G'] });
    const aura = perm('au', 'p1', 'Aura', 'Enchantment - Aura', { attachedTo: 'h' });
    const ctx = ctxOf([host, aura]);
    expect(sat(ctx, aura, 'if enchanted creature is untapped')).toBe(true);
    expect(sat(ctx, aura, "if enchanted creature's power is 4 or greater")).toBe(true);
    expect(sat(ctx, aura, 'if enchanted creature is red')).toBe(false);
    expect(sat(ctx, aura, 'if enchanted creature is a Wolf or Werewolf')).toBe(true);
    host.tapped = true;
    expect(sat(ctx, aura, 'if enchanted creature is untapped')).toBe(false);
    const eq = perm('eq', 'p1', 'Sword', 'Artifact - Equipment', { attachedTo: 'h' });
    expect(sat(ctxOf([host, eq]), eq, 'if equipped creature is tapped')).toBe(true);
  });
});

describe('round 40 batched trigger parse', () => {
  it('one or more creatures you control with a qualifier enter / deal damage to one or more players', () => {
    const a: any = parseTriggerClause('Whenever one or more creatures you control with mana value 3 or less enter, draw a card.');
    expect(a?.condition.event).toBe('enters');
    expect(a?.condition.quantity).toBe('one_or_more');
    const b: any = parseTriggerClause('Whenever one or more creatures you control deal combat damage to one or more players, proliferate.');
    expect(b?.condition.event).toBe('deals_combat_damage_to_player');
    expect(b?.condition.quantity).toBe('one_or_more');
    expect(parseTriggerClause('Whenever one or more creatures you control become tapped, draw a card.')).toBeNull();
  });
});
