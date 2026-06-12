import { collectOracleEffectSteps } from '../src/state/modules/trigger-runtime-wiring.js';
import { isTriggerStepRuntimeWired } from '../src/state/modules/trigger-runtime-wiring.js';

const samples = [
  ["it can't be blocked this turn and you scry 1.", 'Clockwork Droid'],
  ["it can't be blocked by creatures with power 2 or less this turn.", 'Test'],
  ['target creatures can\'t be blocked this turn.', 'Test'],
  ['it gets +3/+3 until end of turn.', 'Hydra Trainer'],
];

for (const [text, name] of samples) {
  const steps = collectOracleEffectSteps(text, name);
  const wired = steps.length > 0 && !steps.some((s) => s.kind === 'unknown')
    && steps.every((s) => isTriggerStepRuntimeWired(s));
  console.log(JSON.stringify(text), wired, steps.map((s) => s.kind));
}

process.exit(0);
