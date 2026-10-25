import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import { triggerETBEffectsForPermanent } from '../src/state/modules/triggerEtbPermanentEffects.js';
import { applyDealCombatDamageTriggerQueue } from '../src/state/modules/turn-handlers/turnCombatDamageTriggerQueue.js';

function perm(id: string, controller: string, card: any, extra: any = {}) {
  return { id, controller, owner: controller, tapped: false, counters: {}, card: { id: id + '_c', name: id, ...card }, ...extra };
}

describe('IR + legacy single-fire regressions', () => {
  it('Sword (equipped creature deals combat damage to a player) triggers exactly once', () => {
    const bear = perm('Bear', 'p1', { type_line: 'Creature - Bear', power: '2', toughness: '2', oracle_text: '' });
    const sword = perm('Sword of Light and Shadow', 'p1', {
      type_line: 'Artifact - Equipment',
      oracle_text: 'Equipped creature gets +2/+2 and has protection from white and from black.\nWhenever equipped creature deals combat damage to a player, you gain 3 life and you may return up to one target creature card from your graveyard to your hand.\nEquip {2}',
    }, { attachedTo: 'Bear' });
    const battlefield = [bear, sword];
    const state: any = { seq: 1, stack: [], battlefield, turnPlayer: 'p1', activePlayer: 'p1', phase: 'combat', step: 'DAMAGE',
      players: [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }],
      zones: { p1: { hand: [], graveyard: [], exile: [] }, p2: { hand: [], graveyard: [], exile: [] } } };
    const ctx: any = { state, gameId: 'g_sword', bumpSeq() { state.seq++; }, isReplaying: false };
    applyDealCombatDamageTriggerQueue(ctx, battlefield, {
      damageToPlayers: { p2: 4 }, attackersThatDealtDamage: { p2: new Set(['Bear']) },
      attackerDamageToPlayers: { p2: { Bear: 4 } }, lifeGainForPlayers: {},
    } as any);
    const swordItems = state.stack.filter((s: any) => /Sword of Light and Shadow/.test(String(s.sourceName || s.source || s.cardName || '')));
    expect(swordItems).toHaveLength(1);
  });

  it('Siege battle enters trigger fires exactly once', () => {
    const g: any = createInitialGameState('t_siege_single_fire');
    g.applyEvent({ type: 'join', playerId: 'p1', name: 'P1' });
    const siege: any = perm('Invasion of Tarkir', 'p1', {
      type_line: 'Battle - Siege',
      oracle_text: '(As a Siege enters, choose an opponent to protect it. You and others can attack it. When it\'s defeated, exile it, then cast it transformed.)\nWhen Invasion of Tarkir enters, reveal any number of Dragon cards from your hand. When you do, Invasion of Tarkir deals X damage to any target, where X is 2 plus the number of Dragon cards revealed this way.',
    });
    g.state.battlefield.push(siege);
    const before = (g.state.stack || []).length;
    triggerETBEffectsForPermanent(g, siege, 'p1');
    const items = (g.state.stack || []).slice(before).filter((s: any) => /Invasion of Tarkir/.test(String(s.sourceName || s.source || s.cardName || '')));
    expect(items).toHaveLength(1);
  });
});
