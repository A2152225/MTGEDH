// Origin parent: oracleIRParserPostprocessCurrentBatchSurfaces.ts
// Cluster: split compound "put a +1/+1 counter on ~ and you gain N life" into
// add_counter + gain_life (Scavenging Ooze family).
// Public entry: splitAddCounterAndGainLifeStepsInAbilities.

import type { OracleEffectStep, OracleIRAbility } from './oracleIR.js';

function splitAddCounterAndGainLifeSteps(steps: readonly OracleEffectStep[]): OracleEffectStep[] {
  return steps.flatMap((step) => {
    if (step.kind === 'conditional') {
      const conditional = step as Extract<OracleEffectStep, { kind: 'conditional' }> & {
        steps?: readonly OracleEffectStep[];
        then?: readonly OracleEffectStep[];
        else?: readonly OracleEffectStep[];
        elseSteps?: readonly OracleEffectStep[];
      };
      const next: any = { ...conditional };
      if (Array.isArray(conditional.steps)) next.steps = splitAddCounterAndGainLifeSteps(conditional.steps);
      if (Array.isArray(conditional.then)) next.then = splitAddCounterAndGainLifeSteps(conditional.then);
      if (Array.isArray(conditional.else)) next.else = splitAddCounterAndGainLifeSteps(conditional.else);
      if (Array.isArray(conditional.elseSteps)) {
        next.elseSteps = splitAddCounterAndGainLifeSteps(conditional.elseSteps);
      }
      return [next as OracleEffectStep];
    }

    if (step.kind !== 'add_counter') return [step];

    const addStep = step as Extract<OracleEffectStep, { kind: 'add_counter' }>;
    const targetText = String((addStep.target as any)?.text || '').trim();
    const raw = String(addStep.raw || '').trim();
    const fromTarget = targetText.match(/^(.+?)\s+and you gain (\d+) life$/i);
    const fromRaw = raw.match(
      /^put (?:a|an|\d+)\s+.+?\s+counters?\s+on\s+(.+?)\s+and you gain (\d+) life$/i,
    );
    const match = fromTarget || fromRaw;
    if (!match) return [step];

    const cleanedTarget = String(match[1] || '').trim();
    const lifeAmount = Number.parseInt(String(match[2] || ''), 10);
    if (!cleanedTarget || !Number.isFinite(lifeAmount) || lifeAmount <= 0) return [step];

    const counterOnlyRaw = raw.replace(/\s+and you gain \d+ life\.?$/i, '').trim() || raw;
    return [
      {
        ...addStep,
        target: { kind: 'raw', text: cleanedTarget },
        raw: counterOnlyRaw,
      } as OracleEffectStep,
      {
        kind: 'gain_life',
        who: { kind: 'you' },
        amount: { kind: 'number', value: lifeAmount },
        raw: `you gain ${lifeAmount} life`,
      } as OracleEffectStep,
    ];
  });
}

export function splitAddCounterAndGainLifeStepsInAbilities(
  abilities: readonly OracleIRAbility[],
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const steps = Array.isArray(ability.steps) ? ability.steps : [];
    if (steps.length === 0) return ability;
    const nextSteps = splitAddCounterAndGainLifeSteps(steps);
    if (nextSteps.length === steps.length && nextSteps.every((step, index) => step === steps[index])) {
      return ability;
    }
    return { ...ability, steps: nextSteps };
  });
}
