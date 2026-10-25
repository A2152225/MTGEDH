import { describe, expect, it, vi } from 'vitest';
const queued: any[] = [];
vi.mock('../src/socket/util.js', async (orig) => ({ ...(await (orig as any)()), broadcastGame: vi.fn(), canPayManaCostStringWithAvailableSources: vi.fn((_s: any, _p: any, cost: string) => cost !== '{U}{U}{U}{U}{U}{U}{U}') }));
vi.mock('../src/socket/optional-payment-prompts.js', async (orig) => ({ ...(await (orig as any)()), queueOptionalPaymentStep: vi.fn((_g: string, step: any) => { queued.push(step); }) }));
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';
import { parseCumulativeUpkeepCost, scaleManaCost, chooseAICumulativeUpkeepPayment, maybeQueueCumulativeUpkeepTriggeredAbility } from '../src/state/modules/cumulativeUpkeepPayment.js';
import { detectUntapStepEffects } from '../src/state/modules/triggers/turn-phases-handlers/turnPhaseUntapStepEffects.js';
import { getExceptColorBlockRestrictionReason } from '../src/socket/combat-handlers/combatExceptColorBlockRestriction.js';

const sys = (line: string, name = 'Test Card') => String(classifyStaticCensusLine(line, name)?.system ?? '');

describe('Batch 11: cumulative upkeep payment', () => {
  it('parses life and mana costs', () => {
    expect(parseCumulativeUpkeepCost('Pay 1 life')).toEqual({ kind: 'life', amount: 1 });
    expect(parseCumulativeUpkeepCost('\u2014Pay 2 life.')).toEqual({ kind: 'life', amount: 2 });
    expect(parseCumulativeUpkeepCost('{G} or {W}')).toEqual({ kind: 'mana', options: ['{G}', '{W}'] });
    expect(parseCumulativeUpkeepCost('{1}{U}')).toEqual({ kind: 'mana', options: ['{1}{U}'] });
    expect(parseCumulativeUpkeepCost('Sacrifice a land')).toBeNull();
  });
  it('scales mana per age counter', () => {
    expect(scaleManaCost('{1}', 3)).toBe('{3}');
    expect(scaleManaCost('{1}{U}', 2)).toBe('{2}{U}{U}');
  });
  it('AI pays cheap life, declines when low', () => {
    expect(chooseAICumulativeUpkeepPayment({ state: { life: { p1: 30 } } }, 'p1', { lifeCost: 3, ageCounters: 3 })).toBe('pay');
    expect(chooseAICumulativeUpkeepPayment({ state: { life: { p1: 12 } } }, 'p1', { lifeCost: 4, ageCounters: 4 })).toBe('decline');
  });
  it('AI pays affordable mana, declines unaffordable or huge', () => {
    expect(chooseAICumulativeUpkeepPayment({ state: {} }, 'p1', { manaCost: '{2}', ageCounters: 2 })).toBe('pay');
    expect(chooseAICumulativeUpkeepPayment({ state: {} }, 'p1', { manaCost: '{U}{U}{U}{U}{U}{U}{U}', ageCounters: 7 })).toBe('decline');
    expect(chooseAICumulativeUpkeepPayment({ state: {} }, 'p1', { manaCost: '{9}', ageCounters: 9 })).toBe('decline');
  });
  it('adds an age counter and queues a pay-or-sacrifice prompt', () => {
    queued.length = 0;
    const perm: any = { id: 'perm1', controller: 'p1', counters: { age: 1 }, card: { name: 'Glacial Chasm' } };
    const ctx: any = { gameId: 'g1', state: { battlefield: [perm], life: { p1: 20 } }, bumpSeq: vi.fn() };
    const ok = maybeQueueCumulativeUpkeepTriggeredAbility(ctx, { source: 'perm1' }, 'p1', 'Glacial Chasm', 'perm1', 'Pay 2 life for each age counter (will be 2)');
    expect(ok).toBe(true);
    expect(perm.counters.age).toBe(2);
    expect(queued).toHaveLength(1);
    expect(queued[0].validationKind).toBe('life');
    expect(queued[0].stepData).toMatchObject({ cumulativeUpkeepChoice: true, ageCounters: 2, lifeCost: 4 });
  });
  it('queues a scaled mana prompt and ignores non-cumulative descriptions', () => {
    queued.length = 0;
    const perm: any = { id: 'm1', controller: 'p1', counters: {}, card: { name: 'Owl' } };
    const ctx: any = { gameId: 'g1', state: { battlefield: [perm] }, bumpSeq: vi.fn() };
    expect(maybeQueueCumulativeUpkeepTriggeredAbility(ctx, { source: 'm1' }, 'p1', 'Owl', 'm1', 'Pay {W} or {U} for each age counter')).toBe(true);
    expect(queued[0].stepData.manaCost).toBe('{W}');
    expect(maybeQueueCumulativeUpkeepTriggeredAbility(ctx, { source: 'm1' }, 'p1', 'Owl', 'm1', 'Draw a card')).toBe(false);
  });
});

describe('Batch 11: untap during each other player\'s untap step', () => {
  for (const [name, text] of [
    ["Bender's Waterskin", "Untap Bender's Waterskin during each other player's untap step."],
    ['Endbringer', "Untap Endbringer during each other player's untap step."],
    ['Test Enchantment', "Untap this enchantment during each other player's untap step."],
    ['Victory Chimes, Bell', "Untap Victory Chimes during each other player's untap step."],
  ]) {
    it(`detects ${name}`, () => {
      const effects = detectUntapStepEffects({ name, oracle_text: text }, { id: 'x', controller: 'p1', card: { name, oracle_text: text } });
      expect(effects.length).toBeGreaterThan(0);
    });
  }
});

describe('Batch 11: except/attached color block restriction', () => {
  const black = { id: 'b', colors: ['B'] };
  const red = { id: 'r', colors: ['R'] };
  it('self except-by', () => {
    const atk = { id: 'a', card: { name: 'Dread Warlock', oracle_text: "Dread Warlock can't be blocked except by black creatures." } };
    expect(getExceptColorBlockRestrictionReason(atk, black, [])).toBeNull();
    expect(getExceptColorBlockRestrictionReason(atk, red, [])).toMatch(/except/);
  });
  it('ignores level-up oracle text', () => {
    const atk = { id: 'a', card: { oracle_text: "Level up {2}{B}\nLEVEL 5+\n4/4\nZulaport Enforcer can't be blocked except by black creatures." } };
    expect(getExceptColorBlockRestrictionReason(atk, red, [])).toBeNull();
  });
  it('aura scarab', () => {
    const atk = { id: 'a', card: { oracle_text: '' } };
    const aura = { id: 'aura', attachedTo: 'a', card: { oracle_text: "Enchant creature\nEnchanted creature can't be blocked by black creatures.\nEnchanted creature gets +2/+2 as long as an opponent controls a black permanent." } };
    expect(getExceptColorBlockRestrictionReason(atk, black, [], [aura])).toMatch(/blocked by B/);
    expect(getExceptColorBlockRestrictionReason(atk, red, [], [aura])).toBeNull();
  });
});

describe('Batch 11: classifier entries', () => {
  it('classifies new families', () => {
    expect(sys('Cumulative upkeep\u2014Pay 1 life.')).toMatch(/cumulativeUpkeepPayment/);
    expect(sys('Cumulative upkeep {G} or {W}. (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)')).toMatch(/cumulativeUpkeepPayment/);
    expect(sys("Untap Endbringer during each other player's untap step.", 'Endbringer')).toMatch(/turnPhaseUntapStepEffects/);
    expect(sys("Enchanted creature can't be blocked by black creatures.")).toMatch(/combatExceptColorBlockRestriction/);
    expect(sys("Dread Warlock can't be blocked except by black creatures.", 'Dread Warlock')).toMatch(/combatExceptColorBlockRestriction/);
    expect(sys('Reveal Lore Seeker as you draft it.', 'Lore Seeker')).toMatch(/draft-only/);
  });
});