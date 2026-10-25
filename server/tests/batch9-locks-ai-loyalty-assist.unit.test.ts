import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/socket/util.js', async (orig) => ({ ...(await (orig as any)()), broadcastGame: vi.fn() }));
import { isLikelyManaActivation } from '../src/state/modules/activationManaAbilityClassifier.js';
import { buildAIActivatedAbilityResolverCandidates } from '../src/socket/ai-handlers/aiActivatedAbilityResolver.js';
import { parseActivatedAbilities } from '../../client/src/utils/activatedAbilityParser-handlers/parseActivatedAbilities.js';
import {
  applyAssistPaymentChoice,
  consumeAssistCredit,
  requestAssistForPendingCast,
} from '../src/socket/assistPaymentFlow.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

describe('batch 9: mana-exempt lock does not exempt special activations', () => {
  it('equip / crew / station / level up are never mana abilities', () => {
    expect(isLikelyManaActivation('perm-equip-0', 'Equip {2}')).toBe(false);
    expect(isLikelyManaActivation('perm-crew-0', 'Crew 3')).toBe(false);
    expect(isLikelyManaActivation('perm-station-0', 'Station')).toBe(false);
    expect(isLikelyManaActivation('perm-level-up-0', 'Level up {1}{U}')).toBe(false);
  });
  it('a real mana ability is still mana', () => {
    expect(isLikelyManaActivation('perm-mana-0', '{T}: Add {G}.')).toBe(true);
    expect(isLikelyManaActivation('perm-ability-1', '{T}: Add one mana of any color.')).toBe(true);
  });
  it('targeted or loyalty abilities are not mana', () => {
    expect(isLikelyManaActivation('perm-ability-0', '{T}: Add {R}. It deals 1 damage to target player.')).toBe(false);
    expect(isLikelyManaActivation('perm-pw-ability-0', '+1: Add {R}{R}.')).toBe(false);
  });
});

describe('batch 9: AI sees granted loyalty abilities', () => {
  it('resolver candidates include a loyalty ability granted by another permanent', () => {
    const pw = { id: 'pw', controller: 'p1', card: { id: 'pwc', name: 'Test Walker', type_line: 'Legendary Planeswalker - Test', oracle_text: '+1: Scry 1.' } };
    const granter = { id: 'g', controller: 'p1', card: { id: 'gc', name: 'Granter', type_line: 'Enchantment', oracle_text: 'Planeswalkers you control have "\u22124: Draw a card."' } };
    const without = buildAIActivatedAbilityResolverCandidates(pw);
    const withGrant = buildAIActivatedAbilityResolverCandidates(pw, [pw, granter]);
    expect(withGrant.length).toBe(without.length + 1);
    expect(JSON.stringify(withGrant)).toMatch(/Draw a card/);
  });
});

describe('batch 9: client keyword-cost split still parses', () => {
  it('level up, outlast and monstrosity still parse after moving to parseKeywordCostAbilities', () => {
    const lv = parseActivatedAbilities({ id: 'x', name: 'Leveler', type_line: 'Creature - Human', oracle_text: 'Level up {1}{W}' } as any);
    expect(lv.some((a: any) => /level/i.test(`${a.label} ${a.description} ${a.id}`))).toBe(true);
    const ol = parseActivatedAbilities({ id: 'y', name: 'Outlaster', type_line: 'Creature - Human', oracle_text: 'Outlast {1}{W}' } as any);
    expect(ol.some((a: any) => /outlast/i.test(`${a.label} ${a.description} ${a.id}`))).toBe(true);
    const mo = parseActivatedAbilities({ id: 'z', name: 'Big', type_line: 'Creature - Giant', oracle_text: '{5}{G}: Monstrosity 3.' } as any);
    expect(mo.some((a: any) => /monstros/i.test(`${a.label} ${a.description} ${a.id} ${a.effect}`))).toBe(true);
  });
});

describe('batch 9: assist wired into cast/payment flow', () => {
  const mk = () => {
    const card = { id: 'spell1', name: 'Assisted Spell', oracle_text: 'Assist\nDraw three cards.', mana_cost: '{4}{U}' };
    const game: any = {
      state: {
        turnNumber: 3,
        players: [{ id: 'p1' }, { id: 'p2' }],
        zones: { p1: { hand: [card] } },
        manaPool: { p2: { colorless: 0, white: 0, blue: 0, black: 0, red: 3, green: 0 } },
        pendingSpellCasts: { e1: { cardId: 'spell1', cardName: 'Assisted Spell', manaCost: '{4}{U}', playerId: 'p1', xValue: 0 } },
      },
    };
    return game;
  };
  it('queues a NUMBER_CHOICE prompt for the helper, capped at the generic cost', () => {
    const game = mk();
    const spy = vi.spyOn(ResolutionQueueManager, 'addStep').mockImplementation(((_g: string, s: any) => s) as any);
    expect(requestAssistForPendingCast(game, 'g1', 'p1', 'e1', 'p2')).toBeNull();
    const step: any = spy.mock.calls[0][1];
    expect(step.playerId).toBe('p2');
    expect(step.maxValue).toBe(4);
    expect(step.assistPaymentChoice).toBe(true);
    expect(requestAssistForPendingCast(game, 'g1', 'p1', 'e1', 'p1')).toBe('HELPER_MUST_BE_OTHER_PLAYER');
    expect(requestAssistForPendingCast(game, 'g1', 'p1', 'nope', 'p2')).toBe('NO_PENDING_CAST');
    spy.mockRestore();
  });
  it('helper payment drains their pool and reduces the caster generic cost once', () => {
    const game = mk();
    const step = { playerId: 'p2', maxValue: 4, assistPaymentChoice: true, assistEffectId: 'e1', assistCasterId: 'p1', assistCardId: 'spell1' };
    expect(applyAssistPaymentChoice(game, step, 'p2', 2)).toBe(2);
    expect(game.state.manaPool.p2.red).toBe(1);
    expect(consumeAssistCredit(game.state, 'p1', 'spell1', 4)).toBe(2);
    expect(consumeAssistCredit(game.state, 'p1', 'spell1', 4)).toBe(4);
  });
  it('rejects overpay beyond pool and stale credit from another turn', () => {
    const game = mk();
    const step = { playerId: 'p2', maxValue: 4, assistPaymentChoice: true, assistEffectId: 'e1', assistCasterId: 'p1', assistCardId: 'spell1' };
    expect(applyAssistPaymentChoice(game, step, 'p2', 4)).toBe(0);
    expect(applyAssistPaymentChoice(game, step, 'p1', 1)).toBe(0);
    expect(applyAssistPaymentChoice(game, step, 'p2', 1)).toBe(1);
    game.state.turnNumber = 4;
    expect(consumeAssistCredit(game.state, 'p1', 'spell1', 4)).toBe(4);
  });
});