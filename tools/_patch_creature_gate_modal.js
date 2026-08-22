const fs = require('fs');
const path = 'client/src/components/CombatControlModal.tsx';
let s = fs.readFileSync(path, 'utf8');
if (!s.includes('getControlledCreatureCombatGateReason')) {
  s = s.replace(
    'getCounterCombatRestrictionReason, hasCurrentKeyword, isCurrentlyCreature } from \'../utils/creatureUtils\';',
    'getCounterCombatRestrictionReason, getControlledCreatureCombatGateReason, hasCurrentKeyword, isCurrentlyCreature } from \'../utils/creatureUtils\';'
  );
  // Also try double-quote / multiline import forms
  if (!s.includes('getControlledCreatureCombatGateReason')) {
    s = s.replace(
      /import \{([^}]+)\} from '\.\.\/utils\/creatureUtils';/,
      (m, inner) => {
        if (inner.includes('getControlledCreatureCombatGateReason')) return m;
        return `import {${inner.replace('getCounterCombatRestrictionReason', 'getCounterCombatRestrictionReason, getControlledCreatureCombatGateReason')} } from '../utils/creatureUtils';`;
      }
    );
  }

  s = s.replace(
    `if (mode === 'attackers' && canAttack && !canCreatureAttackNow(perm, battlefield)) {
    canAttack = false;
    attackReason = attackReason
      || getCounterCombatRestrictionReason(perm, battlefield, 'attack')
      || (hasCurrentKeyword(perm, 'defender', battlefield) ? 'Has defender' : 'Summoning sickness');
  }`,
    `if (mode === 'attackers' && canAttack && !canCreatureAttackNow(perm, battlefield)) {
    canAttack = false;
    attackReason = attackReason
      || getControlledCreatureCombatGateReason(perm, battlefield, 'attack')
      || getCounterCombatRestrictionReason(perm, battlefield, 'attack')
      || (hasCurrentKeyword(perm, 'defender', battlefield) ? 'Has defender' : 'Summoning sickness');
  }`
  );

  s = s.replace(
    `if (mode === 'blockers' && canBlock && !canCreatureBlockNow(perm, battlefield)) {
    canBlock = false;
    blockReason = blockReason || getCounterCombatRestrictionReason(perm, battlefield, 'block') || "Can't block";
  }`,
    `if (mode === 'blockers' && canBlock && !canCreatureBlockNow(perm, battlefield)) {
    canBlock = false;
    blockReason = blockReason
      || getControlledCreatureCombatGateReason(perm, battlefield, 'block')
      || getCounterCombatRestrictionReason(perm, battlefield, 'block')
      || "Can't block";
  }`
  );

  // Soften the crude "can't block" text check so Bast's "can't attack or block unless" doesn't false-disable always
  // The old check: combinedText.includes("can't block") && !combinedText.includes("can't be blocked")
  // Bast text includes "can't ... block unless" which would always mark canBlock=false even with 3+ creatures!
  s = s.replace(
    `if (canBlock && combinedText.includes("can't block") && !combinedText.includes("can't be blocked")) {
    canBlock = false;
    blockReason = blockReason || "Can't block";
  }`,
    `// Unconditional "can't block" only — skip "can't block unless ..." gates (handled above).
  if (
    canBlock
    && /can(?:not|'t)\\s+block(?!\\s+unless)\\b/i.test(combinedText)
    && !/can(?:not|'t)\\s+be blocked\\b/i.test(combinedText)
  ) {
    canBlock = false;
    blockReason = blockReason || "Can't block";
  }`
  );
}
fs.writeFileSync(path, s);
console.log('CombatControlModal patched');
