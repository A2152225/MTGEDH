import { describe, it, expect } from 'vitest';
import { getHeroicTriggers } from '../src/socket/game-actions-handlers/gameActionsSpellCopyHeroicTriggers.js';
import { getCardDrawTriggers } from '../src/state/modules/triggers/card-draw.js';
import { applyDealCombatDamageTriggerQueue } from '../src/state/modules/turn-handlers/turnCombatDamageTriggerQueue.js';

function perm(id: string, controller: string, card: any, extra: any = {}) {
  return { id, controller, owner: controller, tapped: false, counters: {}, card: { id: id + '_c', name: id, ...card }, ...extra };
}

describe('draw ordinals and heroic fire from IR', () => {
  const mastermind = perm('Faerie Mastermind', 'p1', { type_line: 'Creature - Faerie Rogue', oracle_text: 'Flash\nFlying\nWhenever an opponent draws their second card each turn, you draw a card.\n{3}{U}: Each player draws a card.' });
  const thirdy = perm('Thirdy', 'p1', { type_line: 'Enchantment', oracle_text: 'Whenever you draw your third card in a turn, you gain 2 life.' });
  const ctx: any = { state: { battlefield: [mastermind, thirdy], turnPlayer: 'p2', players: [{ id: 'p1' }, { id: 'p2' }] } };
  const names = (list: any[]) => list.map((t: any) => t.cardName);

  it('"opponent draws their second card" fires once, only on draw 2', () => {
    expect(names(getCardDrawTriggers(ctx, 'p2', undefined, 1))).not.toContain('Faerie Mastermind');
    expect(names(getCardDrawTriggers(ctx, 'p2', undefined, 2)).filter((n) => n === 'Faerie Mastermind')).toHaveLength(1);
    expect(names(getCardDrawTriggers(ctx, 'p2', undefined, 3))).not.toContain('Faerie Mastermind');
    expect(names(getCardDrawTriggers(ctx, 'p1', undefined, 2))).not.toContain('Faerie Mastermind');
  });

  it('"third card in a turn" fires only on the controller\'s draw 3', () => {
    expect(names(getCardDrawTriggers(ctx, 'p1', undefined, 2))).not.toContain('Thirdy');
    expect(names(getCardDrawTriggers(ctx, 'p1', undefined, 3)).filter((n) => n === 'Thirdy')).toHaveLength(1);
  });

  it('heroic fires once for a targeted creature and not otherwise', () => {
    const hero = perm('Favored Hoplite', 'p1', { type_line: 'Creature - Human Soldier', oracle_text: 'Heroic \u2014 Whenever you cast a spell that targets Favored Hoplite, put a +1/+1 counter on Favored Hoplite and prevent all damage that would be dealt to it this turn.' });
    const game: any = { state: { battlefield: [hero], turnPlayer: 'p1', players: [{ id: 'p1' }, { id: 'p2' }] } };
    expect(getHeroicTriggers(game, 'p1', ['Favored Hoplite'], { type_line: 'Instant' })).toHaveLength(1);
    expect(getHeroicTriggers(game, 'p1', ['other'], { type_line: 'Instant' })).toHaveLength(0);
    expect(getHeroicTriggers(game, 'p2', ['Favored Hoplite'], { type_line: 'Instant' })).toHaveLength(0);
  });
});

describe('batched combat damage', () => {
  it('"one or more creatures you control deal combat damage" fires once for two attackers', () => {
    const a = perm('Bear A', 'p1', { type_line: 'Creature - Bear', power: '2', toughness: '2', oracle_text: '' });
    const b = perm('Bear B', 'p1', { type_line: 'Creature - Bear', power: '2', toughness: '2', oracle_text: '' });
    const w = perm('Watcher', 'p1', { type_line: 'Enchantment', oracle_text: 'Whenever one or more creatures you control deal combat damage to a player, draw a card.' });
    const battlefield = [a, b, w];
    const state: any = { seq: 1, stack: [], battlefield, turnPlayer: 'p1', activePlayer: 'p1', phase: 'combat', step: 'DAMAGE',
      players: [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }],
      zones: { p1: { hand: [], graveyard: [], exile: [] }, p2: { hand: [], graveyard: [], exile: [] } } };
    const ctx: any = { state, gameId: 'g_batched', bumpSeq() { state.seq++; }, isReplaying: false };
    applyDealCombatDamageTriggerQueue(ctx, battlefield, {
      damageToPlayers: { p2: 4 }, attackersThatDealtDamage: { p2: new Set(['Bear A', 'Bear B']) },
      attackerDamageToPlayers: { p2: { 'Bear A': 2, 'Bear B': 2 } }, lifeGainForPlayers: {},
    } as any);
    const items = state.stack.filter((s: any) => String(s.source || s.permanentId || '') === 'Watcher');
    expect(items).toHaveLength(1);
  });
});
