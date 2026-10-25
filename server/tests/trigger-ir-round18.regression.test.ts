import { describe, expect, it } from 'vitest';
import { queueDiscardTriggeredAbilities } from '../src/state/modules/triggers/discard.js';
import { resolveDiscardCauseController } from '../src/state/modules/triggers/eventSpecificLegacyTriggers.js';
import { bridgeGameStateOracleEffectsAfterOracleIR } from '../src/state/modules/triggerGameStateOracleBridgeUtils.js';
import { triggerAbilityActivatedTriggers } from '../src/state/modules/triggers/ability-activated.js';
import { applyExplore } from '../src/state/modules/zones.js';
import { applyPermanentKeywordEvents } from '../src/state/modules/apply-event-handlers/applyEventPermanentKeywordEvents.js';

const perm = (id: string, controller: string, card: any, extra: any = {}) => ({ id, controller, owner: controller, tapped: false, counters: {}, card: { id: id + '_c', ...card }, ...extra });
function mkCtx(battlefield: any[], extra: any = {}) {
  const state: any = { battlefield, stack: [], players: [{ id: 'p1' }, { id: 'p2' }], turnPlayer: 'p1', activePlayer: 'p1', phase: 'main1', step: 'main', zones: { p1: { hand: [], graveyard: [], handCount: 0, graveyardCount: 0, libraryCount: 0 } }, ...extra };
  return { state, libraries: new Map<string, any[]>(), bumpSeq() {}, isReplaying: false } as any;
}
const ofType = (ctx: any, t: string) => ctx.state.stack.filter((s: any) => s.triggerType === t);

const SAND_GOLEM = { id: 'sg', name: 'Sand Golem', type_line: 'Artifact Creature - Golem', oracle_text: 'When a spell or ability an opponent controls causes you to discard this card, return this card from your graveyard to the battlefield with a +1/+1 counter on it at the beginning of the next end step.' };
const TITANBONES = { id: 'tb', name: 'Titanbones, Towering Heart', type_line: 'Legendary Creature - Skeleton Giant', oracle_text: 'Trample\nWhen you discard this card, you gain 3 life.' };
const EDGAR = { id: 'ea', name: "Edgar's Awakening", type_line: 'Instant', oracle_text: "Return target creature card from your graveyard to your hand.\nWhen you discard this card, you may pay {B}. When you do, return target creature card from your graveyard to your hand." };
const COW = { id: 'bc', name: 'Bartered Cow', type_line: 'Creature - Ox', oracle_text: 'When this creature dies and when you discard this card, create a Food token.' };

describe('round 18 (1): self-discard family', () => {
  it('Sand Golem fires only when an opponent caused the discard', () => {
    let ctx = mkCtx([]);
    queueDiscardTriggeredAbilities(ctx, 'p1', [SAND_GOLEM], { causeControllerId: 'p2' });
    expect(ofType(ctx, 'opponent_caused_self_discard')).toHaveLength(1);
    expect(ofType(ctx, 'opponent_caused_self_discard')[0]).toMatchObject({ controller: 'p1', source: 'sg' });
    ctx = mkCtx([]);
    queueDiscardTriggeredAbilities(ctx, 'p1', [SAND_GOLEM], { causeControllerId: 'p1' });
    expect(ctx.state.stack).toHaveLength(0);
    ctx = mkCtx([]);
    queueDiscardTriggeredAbilities(ctx, 'p1', [SAND_GOLEM]);
    expect(ctx.state.stack).toHaveLength(0);
  });
  it('Titanbones, Bartered Cow and Edgar fire on any discard; Edgar keeps its reflexive rider', () => {
    const ctx = mkCtx([]);
    queueDiscardTriggeredAbilities(ctx, 'p1', [TITANBONES, COW, EDGAR], { fromCycling: true });
    const items = ofType(ctx, 'self_discard');
    expect(items.map((i: any) => i.sourceName).sort()).toEqual(["Bartered Cow", "Edgar's Awakening", 'Titanbones, Towering Heart']);
    expect(items.find((i: any) => i.source === 'ea').effect).toMatch(/When you do, return target creature card/);
  });
  it('resolves the cause controller from the step source', () => {
    const state = { battlefield: [perm('mind', 'p2', { name: 'Liliana' })], stack: [] };
    expect(resolveDiscardCauseController(state, { sourceId: 'mind' })).toBe('p2');
    expect(resolveDiscardCauseController(state, { sourceId: 'nope' })).toBe('');
  });
});

describe('round 18 (3): cycle half of cast or cycle', () => {
  it('Warped Tusker fires when cycled, not on a plain discard', () => {
    const tusker = { id: 'wt', name: 'Warped Tusker', type_line: 'Creature - Eldrazi Elephant', oracle_text: 'When you cast or cycle Warped Tusker, create a 0/1 colorless Eldrazi Spawn creature token with "Sacrifice this token: Add {C}."\nCycling {2}' };
    let ctx = mkCtx([]);
    queueDiscardTriggeredAbilities(ctx, 'p1', [tusker], { fromCycling: true });
    expect(ofType(ctx, 'cycled_self')).toHaveLength(1);
    expect(ofType(ctx, 'cycled_self')[0].effect).toMatch(/Eldrazi Spawn/);
    ctx = mkCtx([]);
    queueDiscardTriggeredAbilities(ctx, 'p1', [tusker]);
    expect(ctx.state.stack).toHaveLength(0);
  });
});

describe('round 18 (2): queue lists', () => {
  it('die roll: Dee Kay, Finder of the Lost fires per matching result', () => {
    const dk = perm('dk', 'p1', { name: 'Dee Kay, Finder of the Lost', type_line: 'Legendary Creature - Human Rogue', oracle_text: 'Whenever you roll a 2, each opponent loses 1 life and you gain 1 life.\nWhenever you roll a 4, you may tap or untap target artifact or creature.\nWhenever you roll a 6, return target creature card from your graveyard to your hand.' });
    const ctx = mkCtx([dk], { lastDieRollByPlayer: { p1: { sides: 6, result: 2, results: [2] } } });
    bridgeGameStateOracleEffectsAfterOracleIR(ctx, ctx.state, { appliedSteps: [{ kind: 'roll_die', raw: 'roll a six-sided die' }], skippedSteps: [] } as any, { controller: 'p1', sourceName: 'Src', triggerItem: { id: 't' } });
    const items = ofType(ctx, 'die_roll_single_result');
    expect(items).toHaveLength(1);
    expect(items[0].effect).toMatch(/each opponent loses 1 life/);
  });
  it('explores: Wildgrowth Walker fires; Nicanzil filters land vs nonland', () => {
    const ww = perm('ww', 'p1', { name: 'Wildgrowth Walker', type_line: 'Creature - Elemental', oracle_text: 'Whenever a creature you control explores, put a +1/+1 counter on this creature and you gain 3 life.' });
    const nz = perm('nz', 'p1', { name: 'Nicanzil, Current Conductor', type_line: 'Legendary Creature - Merfolk Scout', oracle_text: 'Whenever a creature you control explores a land card, you may put a land card from your hand onto the battlefield tapped.\nWhenever a creature you control explores a nonland card, put a +1/+1 counter on Nicanzil.' });
    const ex = perm('ex', 'p1', { name: 'Explorer', type_line: 'Creature - Merfolk', oracle_text: '' });
    const ctx = mkCtx([ww, nz, ex]);
    ctx.libraries.set('p1', [{ id: 'top', name: 'Forest', type_line: 'Basic Land - Forest' }]);
    applyExplore(ctx, 'p1', 'ex', 'top', true, false);
    const items = ofType(ctx, 'creature_explores');
    expect(items.map((i: any) => i.source).sort()).toEqual(['nz', 'ww']);
    expect(items.find((i: any) => i.source === 'nz').effect).toMatch(/land card from your hand/);
  });
  it('loyalty: Chandra\'s Regulator fires for a Chandra, not for a Jace', () => {
    const reg = perm('reg', 'p1', { name: "Chandra's Regulator", type_line: 'Legendary Artifact', oracle_text: "Whenever you activate a loyalty ability of a Chandra planeswalker, you may pay {1}. If you do, copy that ability. You may choose new targets for the copy." });
    for (const [type, n] of [['Legendary Planeswalker - Chandra', 1], ['Legendary Planeswalker - Jace', 0]] as const) {
      const pw = perm('pw', 'p1', { name: 'Walker', type_line: type, oracle_text: '+1: Draw a card.' });
      const ctx = mkCtx([reg, pw]);
      ctx.state.stack.push({ id: 'ab1', type: 'ability', controller: 'p1', source: 'pw', planeswalker: { abilityIndex: 0, loyaltyCost: 1 } });
      triggerAbilityActivatedTriggers(ctx, { activatedBy: 'p1', sourcePermanentId: 'pw', isManaAbility: false, abilityText: 'Draw a card.', stackItemId: 'ab1' } as any);
      expect(ofType(ctx, 'loyalty_ability_activated'), type).toHaveLength(n);
    }
  });
  it('crew: Veteran Motorist fires when it crews; Reckless Velocitaur needs your main phase', () => {
    const vm = perm('vm', 'p1', { name: 'Veteran Motorist', type_line: 'Creature - Dwarf Pilot', power: '3', toughness: '2', oracle_text: 'When this creature enters, scry 2.\nWhenever this creature crews a Vehicle, that Vehicle gets +1/+1 until end of turn.' });
    const rv = perm('rv', 'p1', { name: 'Reckless Velocitaur', type_line: 'Creature - Dinosaur', power: '4', toughness: '3', oracle_text: 'Whenever this creature saddles a Mount or crews a Vehicle during your main phase, that Mount or Vehicle gets +2/+0 and gains trample until end of turn.' });
    const v = perm('veh', 'p1', { name: 'Smuggler\'s Copter', type_line: 'Artifact - Vehicle', power: '3', toughness: '3', oracle_text: 'Crew 1' });
    let ctx = mkCtx([vm, rv, v]);
    applyPermanentKeywordEvents(ctx, { type: 'crewVehicle', playerId: 'p1', vehicleId: 'veh', crewerIds: ['vm', 'rv'] } as any);
    expect(ofType(ctx, 'crew_vehicle').map((i: any) => i.source).sort()).toEqual(['rv', 'vm']);
    ctx = mkCtx([vm, rv, v], { phase: 'combat', step: 'beginCombat' });
    applyPermanentKeywordEvents(ctx, { type: 'crewVehicle', playerId: 'p1', vehicleId: 'veh', crewerIds: ['vm', 'rv'] } as any);
    expect(ofType(ctx, 'crew_vehicle').map((i: any) => i.source)).toEqual(['vm']);
  });
});
