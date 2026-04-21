import { parseOracleTextToIR } from './src/oracleIRParser';

const text = 'Whenever enchanted creature attacks, reveal cards from the top of your library until you reveal an Aura card. You may put that card onto the battlefield. If you don\'t, put it into your hand. Put the rest on the bottom of your library in a random order.';

const parsed = parseOracleTextToIR(text);

function logSteps(steps: any[], indent: string = '') {
  if (!steps) return;
  steps.forEach((step: any, index: number) => {
    console.log(`${indent}${index} ${step.kind} ${step.raw || step.text || ''}`);
    if (step.steps) {
      logSteps(step.steps, indent + '  ');
    }
    if (step.thenSteps) {
      console.log(`${indent}  THEN:`);
      logSteps(step.thenSteps, indent + '    ');
    }
    if (step.elseSteps) {
      console.log(`${indent}  ELSE:`);
      logSteps(step.elseSteps, indent + '    ');
    }
  });
}

if (parsed) {
  const abilities = Array.isArray(parsed) ? parsed : (parsed.abilities || [parsed]);
  abilities.forEach((ability: any, abilityIndex: number) => {
    console.log(`Ability ${abilityIndex} (${ability.type || 'unknown'}):`);
    logSteps(ability.steps, '  ');
  });
} else {
  console.log('Failed to parse (result was null/undefined).');
}
