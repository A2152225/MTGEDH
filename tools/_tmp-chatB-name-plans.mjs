// Chat B split helper: give the generated guard-run plans real module names, helper names
// and headers. The generator only knows sizes, so naming stays a deliberate manual step.
import fs from 'node:fs';

const CHAIN = process.argv[2] || 'parseCurrentResidualUnknownStep';

const NAMES = [
  {
    module: 'oracleIRParserPostprocessTriggerResidualMassTemporaryPtGrants',
    prefix: 'parseTriggerResidualMassTemporaryPtGrants',
    blurb:
      'mass temporary P/T grants - self, other creatures, "they", each creature, and each opponent\'s\n// creatures - plus the flip and combat-damage-prevention fragments that sit with them',
  },
  {
    module: 'oracleIRParserPostprocessTriggerResidualScaledAndSubtypePtGrants',
    prefix: 'parseTriggerResidualScaledAndSubtypePtGrants',
    blurb:
      'for-each scaled P/T grants and the subtype, token and "creatures you don\'t control" scoped variants',
  },
  {
    module: 'oracleIRParserPostprocessTriggerResidualCompoundPtAndKeywordGrants',
    prefix: 'parseTriggerResidualCompoundPtAndKeywordGrants',
    blurb:
      'compound "gets +N/+N and gains <keyword>" grants across self, target, team and subtype scopes',
  },
  {
    module: 'oracleIRParserPostprocessTriggerResidualTargetedPtAndCombatRestrictions',
    prefix: 'parseTriggerResidualTargetedPtAndCombatRestrictions',
    blurb:
      'targeted P/T grants with an X amount, can\'t-block and sacrifice-at-end-step riders, and the small\n// payment and guessing fragments beside them',
  },
  {
    module: 'oracleIRParserPostprocessTriggerResidualCopyAndGameStateFragments',
    prefix: 'parseTriggerResidualCopyAndGameStateFragments',
    blurb:
      'become-a-copy fragments, life and draw doubling, lose-the-game replacements and control changes',
  },
];

const plans = JSON.parse(fs.readFileSync('tools/_tmp-chatB-plans.json', 'utf8'));
if (plans.length !== NAMES.length) {
  console.error(`plan count ${plans.length} does not match the ${NAMES.length} names on hand`);
  process.exit(1);
}

const named = plans.map((plan, i) => {
  const { module, prefix, blurb } = NAMES[i];
  return {
    ...plan,
    out: `rules-engine/src/${module}.ts`,
    header: undefined,
    headerText: `// Extracted from rules-engine/src/oracleIRParserPostprocess.ts (chat B 40KB split campaign).
//
// Cluster: runs of guards lifted out of ${CHAIN}'s chain covering
// ${blurb}.
//
// Every helper keeps its guards in their original order and returns null when none matched, so the
// caller resumes the chain exactly where the run used to sit.${
      plan.chunks.some((c) => (c.prologue || []).length)
        ? '\n// staticMetadata / temporaryMetadata are verbatim copies of the chain prologue.'
        : ''
    }

import type { OracleEffectStep } from './oracleIR';
import { parseObjectSelector } from './oracleIRParserUtils';

`,
    chunks: plan.chunks.map((chunk, ci) => ({ ...chunk, name: `${prefix}${romanish(ci + 1)}` })),
  };
});

function romanish(n) {
  const words = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen',
  ];
  return words[n] ?? `Part${n}`;
}

fs.writeFileSync('tools/_tmp-chatB-plans-named.json', JSON.stringify(named, null, 2));
for (const plan of named) {
  console.log(`${plan.out}  ${plan.chunks.length} helpers`);
}
