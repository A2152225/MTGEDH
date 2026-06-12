import { collectOracleEffectSteps } from '../src/state/modules/trigger-runtime-wiring.js';
import { isTriggerStepRuntimeWired } from '../src/state/modules/trigger-runtime-wiring.js';

const samples = [
  ['Chart a Course', 'Draw two cards, then discard a card.'],
  ['Inspiring Call', 'Draw a card for each creature you control with a +1/+1 counter on it. Those creatures gain indestructible until end of turn.'],
  ['Divination', 'Draw two cards.'],
];

for (const [name, text] of samples) {
  const steps = collectOracleEffectSteps(text, name);
  const wired = steps.length > 0 && !steps.some((s) => s.kind === 'unknown')
    && steps.every((s) => isTriggerStepRuntimeWired(s));
  console.log(name, wired, steps.map((s) => s.kind));
}

process.exit(0);
