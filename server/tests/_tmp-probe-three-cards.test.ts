import { it } from 'vitest';
import { tryApplyOracleIRToActivatedAbility } from '../src/state/modules/oracleIrAbilityExecution.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

function makeCtx(gameId: string, mutate?: (state: any) => void) {
  const state: any = {
    players: [{ id: 'p1', name: 'P1', life: 40 }, { id: 'p2', name: 'P2', life: 40 }],
    life: { p1: 40, p2: 40 },
    turnNumber: 5,
    turnPlayer: 'p1',
    priority: 'p1',
    phase: 'precombatMain',
    step: 'MAIN1',
    stack: [],
    battlefield: [
      { id: 'src', controller: 'p1', owner: 'p1', tapped: true, card: { id: 'src_c', name: 'Source', type_line: 'Legendary Creature — Advisor', oracle_text: '' } },
      { id: 'bear1', controller: 'p1', owner: 'p1', enteredThisTurn: true, summoningSickness: true, card: { id: 'b1', name: 'Grizzly Bears', type_line: 'Creature — Bear', power: '2', toughness: '2' } },
      { id: 'bear2', controller: 'p1', owner: 'p1', enteredThisTurn: true, summoningSickness: true, card: { id: 'b2', name: 'Grizzly Bears', type_line: 'Creature — Bear', power: '2', toughness: '2' } },
    ],
    zones: {
      p1: {
        hand: [{ id: 'h1', name: 'Island', type_line: 'Basic Land — Island', cmc: 0 }, { id: 'h2', name: 'Opt', type_line: 'Instant', cmc: 1, mana_cost: '{U}' }],
        library: [{ id: 'l1', name: 'Swamp', type_line: 'Basic Land — Swamp' }, { id: 'l2', name: 'Forest', type_line: 'Basic Land — Forest' }],
        graveyard: [],
        exile: [],
        handCount: 2,
        libraryCount: 2,
      },
      p2: { hand: [], library: [], graveyard: [], exile: [] },
    },
  };
  mutate?.(state);
  return {
    state,
    gameId,
    bumpSeq: () => {},
    libraries: new Map([['p1', state.zones.p1.library], ['p2', []]]),
  } as any;
}

const CASES: Array<[string, string, string, ((state: any) => void) | undefined, any]> = [
  ['guinan-two', 'Guinan, Ancient Advisor', '{1}, {T}: Put a +1/+1 counter on each creature you control that entered this turn. If you put two or more +1/+1 counters on creatures this way, draw a card.', undefined, {}],
  ['guinan-none', 'Guinan, Ancient Advisor', '{1}, {T}: Put a +1/+1 counter on each creature you control that entered this turn. If you put two or more +1/+1 counters on creatures this way, draw a card.', (state) => { for (const perm of state.battlefield) perm.enteredThisTurn = false; }, {}],
  ['guinan-only-self', 'Guinan, Ancient Advisor', '{1}, {T}: Put a +1/+1 counter on each creature you control that entered this turn. If you put two or more +1/+1 counters on creatures this way, draw a card.', (state) => { state.battlefield = state.battlefield.slice(0, 1); }, {}],
  ['moria-creature', 'Moria Scavenger', "{T}, Discard a card: Draw a card. If the discarded card was a creature card, amass Orcs 1. (Put a +1/+1 counter on an Army you control. It's also an Orc. If you don't control an Army, create a 0/0 black Orc Army creature token first.)", undefined, {}],
  ['moria-cost-creature', 'Moria Scavenger', "{T}, Discard a card: Draw a card. If the discarded card was a creature card, amass Orcs 1. (Put a +1/+1 counter on an Army you control. It's also an Orc. If you don't control an Army, create a 0/0 black Orc Army creature token first.)", undefined, { sourceItem: { id: 'stk1', discardedCardsForCost: [{ id: 'd1', name: 'Grizzly Bears', type_line: 'Creature — Bear' }] } }],
  ['moria-cost-land', 'Moria Scavenger', "{T}, Discard a card: Draw a card. If the discarded card was a creature card, amass Orcs 1. (Put a +1/+1 counter on an Army you control. It's also an Orc. If you don't control an Army, create a 0/0 black Orc Army creature token first.)", undefined, { sourceItem: { id: 'stk2', discardedCardsForCost: [{ id: 'd2', name: 'Swamp', type_line: 'Basic Land — Swamp' }] } }],
  ['azor', "Azor's Gateway", "{1}, {T}: Draw a card, then exile a card from your hand. If cards with five or more different mana values are exiled with Azor's Gateway, you gain 5 life, untap Azor's Gateway, and transform it.", undefined, {}],
];

it('server probe', () => {
  const all = [
    ...CASES,
    ...CASES.map(([label, name, text, mutate, extra]) => [`${label}-lower`, `${name} L-${label}`, text.toLowerCase(), mutate, extra] as (typeof CASES)[number]),
    ...CASES.map(([label, name, text, mutate, extra]) => [`${label}-effectonly`, `${name} E-${label}`, text.toLowerCase().replace(/^[^:]*:\s*/, ''), mutate, extra] as (typeof CASES)[number]),
  ];
  for (const [label, name, text, mutate, extra] of all) {
    const gameId = `probe_${label}`;
    const ctx = makeCtx(gameId, mutate);
    const result = tryApplyOracleIRToActivatedAbility(ctx, {
      controller: 'p1',
      sourceName: name,
      oracleText: text,
      sourcePermanentId: 'src',
      allowOptional: true,
      ...extra,
    });
    const queue = ResolutionQueueManager.getQueue(gameId)?.steps || [];
    console.log(`PROBE[${label}] result=${JSON.stringify(result)} queue=${JSON.stringify(queue.map((step: any) => ({ type: step.type, desc: step.description, player: step.playerId })))}`);
    console.log(`PROBE[${label}] counters=${JSON.stringify(ctx.state.battlefield.map((perm: any) => [perm.id, perm.card?.name, perm.counters || {}]))} hand=${ctx.state.zones.p1.hand.map((card: any) => card.id)} exile=${ctx.state.zones.p1.exile.map((card: any) => card.id)} life=${JSON.stringify(ctx.state.life)}`);
  }
});
