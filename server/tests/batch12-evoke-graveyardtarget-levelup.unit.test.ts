import { describe, it, expect } from 'vitest';
import {
  parseEvokeExileColor, spellWasEvoked, scheduleEvokeSacrificeOnPermanentEntry,
  maybeResolveEvokeSacrificeTrigger, getEvokeExileCandidates, EVOKE_SACRIFICE_TRIGGER_TYPE,
} from '../src/state/modules/evokeKeyword.js';
import { graveyardCardsAreUntargetable } from '../src/state/modules/graveyardTargetingRestriction.js';
import { activeLevelUpText } from '../src/state/modules/levelUpActiveText.js';
import { getExceptColorBlockRestrictionReason } from '../src/socket/combat-handlers/combatExceptColorBlockRestriction.js';

function makeCtx(state: any): any {
  return { state, bumpSeq: () => {} };
}

describe('Batch 12 - evoke', () => {
  it('parses MH2 exile-a-card evoke costs', () => {
    expect(parseEvokeExileColor('Flying\nEvoke\u2014Exile a black card from your hand.')).toEqual({ symbol: 'B', word: 'black' });
    expect(parseEvokeExileColor('Evoke {2}{U}')).toBeNull();
  });

  it('detects evoked spells by alternate cost id or flag', () => {
    expect(spellWasEvoked({ alternateCostId: 'evoke' })).toBe(true);
    expect(spellWasEvoked({ alternateCostId: 'evoke_exile' })).toBe(true);
    expect(spellWasEvoked({}, { evokeCostWasPaid: true })).toBe(true);
    expect(spellWasEvoked({ alternateCostId: 'dash' })).toBe(false);
  });

  it('lists only other hand cards of the evoke color', () => {
    const hand = [
      { id: 'grief', name: 'Grief', mana_cost: '{2}{B}{B}', colors: ['B'] },
      { id: 'b1', name: 'Thoughtseize', mana_cost: '{B}', colors: ['B'] },
      { id: 'r1', name: 'Bolt', mana_cost: '{R}', colors: ['R'] },
    ];
    expect(getEvokeExileCandidates(hand, 'grief', 'B').map((c) => c.id)).toEqual(['b1']);
  });

  it('pushes a sacrifice trigger on entry only when evoked', () => {
    const state: any = { stack: [], battlefield: [] };
    const perm: any = { id: 'p1', controller: 'p', card: { name: 'Mulldrifter' } };
    expect(scheduleEvokeSacrificeOnPermanentEntry(makeCtx(state), perm, 'p' as any, 'Mulldrifter', { alternateCostId: 'dash' })).toBe(false);
    expect(state.stack).toHaveLength(0);
    expect(scheduleEvokeSacrificeOnPermanentEntry(makeCtx(state), perm, 'p' as any, 'Mulldrifter', { alternateCostId: 'evoke' })).toBe(true);
    expect(state.stack[0].triggerType).toBe(EVOKE_SACRIFICE_TRIGGER_TYPE);
    expect(perm.evoked).toBe(true);
    // no duplicate
    expect(scheduleEvokeSacrificeOnPermanentEntry(makeCtx(state), perm, 'p' as any, 'Mulldrifter', { alternateCostId: 'evoke' })).toBe(false);
  });

  it('resolving the trigger sacrifices the permanent', () => {
    const perm: any = { id: 'p1', controller: 'p', owner: 'p', card: { id: 'c1', name: 'Mulldrifter', type_line: 'Creature' } };
    const state: any = { stack: [], battlefield: [perm], zones: { p: { hand: [], graveyard: [], exile: [], graveyardCount: 0 } }, players: [{ id: 'p' }] };
    const item = { type: 'triggered_ability', triggerType: EVOKE_SACRIFICE_TRIGGER_TYPE, source: 'p1', controller: 'p' };
    expect(maybeResolveEvokeSacrificeTrigger(makeCtx(state), item)).toBe(true);
    expect(state.battlefield.find((p: any) => p.id === 'p1')).toBeUndefined();
    expect(maybeResolveEvokeSacrificeTrigger(makeCtx(state), { triggerType: 'etb' })).toBe(false);
  });
});

describe('Batch 12 - graveyard targeting restrictions', () => {
  const groundSeal = { id: 'gs', controller: 'a', card: { name: 'Ground Seal', oracle_text: "When Ground Seal enters, draw a card.\nCards in graveyards can't be the targets of spells or abilities." } };
  it('Ground Seal makes all graveyards untargetable', () => {
    expect(graveyardCardsAreUntargetable({ battlefield: [groundSeal] }, 'a', 'a')).toBe(true);
    expect(graveyardCardsAreUntargetable({ battlefield: [groundSeal] }, 'b', 'a')).toBe(true);
    expect(graveyardCardsAreUntargetable({ battlefield: [] }, 'b', 'a')).toBe(false);
  });
  it('face-down permanents do not apply the restriction', () => {
    expect(graveyardCardsAreUntargetable({ battlefield: [{ ...groundSeal, isFaceDown: true }] }, 'a', 'a')).toBe(false);
  });
  it('"your graveyard ... your opponents control" only protects its controller from opponents', () => {
    const p = { id: 'x', controller: 'a', card: { name: 'X', oracle_text: "Cards in your graveyard can't be the targets of spells or abilities your opponents control." } };
    expect(graveyardCardsAreUntargetable({ battlefield: [p] }, 'b', 'a')).toBe(true);
    expect(graveyardCardsAreUntargetable({ battlefield: [p] }, 'a', 'a')).toBe(false);
    expect(graveyardCardsAreUntargetable({ battlefield: [p] }, 'a', 'b')).toBe(false);
  });
});

describe('Batch 12 - level up bands', () => {
  const text = "Level up {2}\nLEVEL 1-3\n2/2\n~ can't be blocked except by black creatures.\nLEVEL 4+\n4/4\nFlying";
  it('keeps only the active band', () => {
    expect(activeLevelUpText(text, 0)).not.toMatch(/except by black/);
    expect(activeLevelUpText(text, 2)).toMatch(/except by black/);
    expect(activeLevelUpText(text, 5)).not.toMatch(/except by black/);
    expect(activeLevelUpText(text, 5)).toMatch(/Flying/);
  });
  it('block restriction reads the level counter', () => {
    const blocker = { card: { name: 'Bear', colors: ['G'], type_line: 'Creature' } };
    const mk = (lvl: number) => ({ counters: { level: lvl }, card: { name: 'Leveler', oracle_text: text } });
    expect(getExceptColorBlockRestrictionReason(mk(0), blocker, [], [])).toBeNull();
    expect(getExceptColorBlockRestrictionReason(mk(2), blocker, [], [])).toMatch(/except by B/);
    expect(getExceptColorBlockRestrictionReason(mk(4), blocker, [], [])).toBeNull();
  });
});