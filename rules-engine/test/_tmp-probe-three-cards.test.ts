import { it } from 'vitest';
import type { GameState } from '../../shared/src/index.js';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor.js';
import { parseOracleTextToIR } from '../src/oracleIRParser.js';

const CARDS: Array<[string, string]> = [
  ['Guinan, Ancient Advisor', '{1}, {T}: Put a +1/+1 counter on each creature you control that entered this turn. If you put two or more +1/+1 counters on creatures this way, draw a card.'],
  ['Moria Scavenger', "Deathtouch, haste\n{T}, Discard a card: Draw a card. If the discarded card was a creature card, amass Orcs 1. (Put a +1/+1 counter on an Army you control. It's also an Orc. If you don't control an Army, create a 0/0 black Orc Army creature token first.)"],
  ["Azor's Gateway", "{1}, {T}: Draw a card, then exile a card from your hand. If cards with five or more different mana values are exiled with Azor's Gateway, you gain 5 life, untap Azor's Gateway, and transform it."],
];

function game(): GameState {
  return {
    turnNumber: 5,
    players: [
      { id: 'p1', life: 40 },
      { id: 'p2', life: 40 },
    ],
    battlefield: [
      { id: 'src', controller: 'p1', owner: 'p1', card: { name: 'Source', type_line: 'Legendary Creature — Advisor' }, enteredThisTurn: false },
      { id: 'bear1', controller: 'p1', owner: 'p1', enteredThisTurn: true, enteredBattlefieldThisTurn: true, card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', power: '2', toughness: '2' } },
      { id: 'bear2', controller: 'p1', owner: 'p1', enteredThisTurn: true, enteredBattlefieldThisTurn: true, card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', power: '2', toughness: '2' } },
    ],
    zones: {
      p1: {
        hand: [{ id: 'h1', name: 'Island', type_line: 'Basic Land — Island' }, { id: 'h2', name: 'Opt', type_line: 'Instant', cmc: 1 }],
        library: [{ id: 'l1', name: 'Swamp', type_line: 'Basic Land — Swamp' }, { id: 'l2', name: 'Forest', type_line: 'Basic Land — Forest' }],
        graveyard: [],
        exile: [],
      },
      p2: { hand: [], library: [], graveyard: [], exile: [] },
    },
  } as unknown as GameState;
}

it('guinan variants', () => {
  const [name, text] = CARDS[0];
  const steps = parseOracleTextToIR(text, name).abilities.flatMap((ability) => ability.steps || []);
  const variants: Array<[string, (state: any) => void, any]> = [
    ['none entered', (state) => { for (const perm of state.battlefield) { perm.enteredThisTurn = false; delete perm.enteredBattlefieldThisTurn; } }, {}],
    ['one entered', (state) => { state.battlefield[2].enteredThisTurn = false; }, {}],
    ['none entered + interactive', (state) => { for (const perm of state.battlefield) perm.enteredThisTurn = false; }, { interactivePlayerChoices: true }],
    ['only source on bf', (state) => { state.battlefield = state.battlefield.slice(0, 1); }, {}],
  ];
  for (const [label, mutate, extra] of variants) {
    const state = game() as any;
    mutate(state);
    const result = applyOracleIRStepsToGameState(
      state,
      steps,
      buildOracleIRExecutionContext({ controllerId: 'p1', sourceId: 'src', sourceName: name, sourceObjectType: 'ability', selectorContext: {}, ...extra } as any),
      { allowOptional: true },
    );
    console.log(`GUINAN[${label}] APPLIED ${JSON.stringify(result.appliedSteps.map((step) => step.kind))} SKIPPED ${JSON.stringify(result.skippedSteps.map((step) => step.kind))} LOG ${JSON.stringify(result.log)}`);
  }
});

it('parse variants', () => {
  const variants: Array<[string, string]> = [
    ['amass-plain', 'Draw a card. Amass Orcs 1.'],
    ['amass-plain-reminder', "Draw a card. Amass Orcs 1. (Put a +1/+1 counter on an Army you control. It's also an Orc. If you don't control an Army, create a 0/0 black Orc Army creature token first.)"],
    ['amass-if', 'Draw a card. If the discarded card was a creature card, amass Orcs 1.'],
    ['amass-if-reminder', "Draw a card. If the discarded card was a creature card, amass Orcs 1. (Put a +1/+1 counter on an Army you control. It's also an Orc. If you don't control an Army, create a 0/0 black Orc Army creature token first.)"],
    ['gain-if', 'Draw a card. If the discarded card was a creature card, you gain 2 life.'],
    ['azor-full', "Draw a card, then exile a card from your hand. If cards with five or more different mana values are exiled with Azor's Gateway, you gain 5 life, untap Azor's Gateway, and transform it."],
    ['azor-tail', "If cards with five or more different mana values are exiled with Azor's Gateway, you gain 5 life, untap Azor's Gateway, and transform it."],
    ['tail-plain', "You gain 5 life, untap Azor's Gateway, and transform it."],
    ['tail-two', "Untap Azor's Gateway, then transform it."],
    ['exile-hand', 'Exile a card from your hand.'],
  ];
  for (const [label, text] of variants) {
    const ir = parseOracleTextToIR(text, label.startsWith('azor') || label.startsWith('tail') ? "Azor's Gateway" : 'Moria Scavenger');
    for (const ability of ir.abilities) {
      for (const step of ability.steps || []) console.log(`PARSE[${label}] ${JSON.stringify(step)}`);
    }
  }
});

it('probe', () => {
  for (const [name, text] of CARDS) {
    const ir = parseOracleTextToIR(text, name);
    console.log(`\n===== ${name}`);
    for (const ability of ir.abilities) {
      console.log(`ABILITY type=${(ability as any).type} cost=${JSON.stringify((ability as any).cost || (ability as any).costText || '')}`);
      for (const step of ability.steps || []) console.log('  STEP', JSON.stringify(step));
    }
    const steps = ir.abilities.filter((ability: any) => ability.type === 'activated').flatMap((ability) => ability.steps || []);
    const result = applyOracleIRStepsToGameState(
      game(),
      steps,
      buildOracleIRExecutionContext({ controllerId: 'p1', sourceId: 'src', sourceName: name, sourceObjectType: 'ability', selectorContext: {} } as any),
      { allowOptional: true },
    );
    console.log('APPLIED', result.appliedSteps.map((step) => step.kind));
    console.log('SKIPPED', result.skippedSteps.map((step) => `${step.kind}:${(step as any).raw}`));
    console.log('LOG', JSON.stringify(result.log));
    console.log('PENDING', JSON.stringify((result as any).pendingChoice || (result as any).pendingChoices || (result as any).choiceRequired || null));
  }
});
