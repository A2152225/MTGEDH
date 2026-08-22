const fs = require('fs');
const path = 'client/src/components/CombatControlModal.tsx';
let s = fs.readFileSync(path, 'utf8');

// Fix import line
if (!s.includes('getControlledCreatureCombatGateReason')) {
  s = s.replace(
    'getCounterCombatRestrictionReason, hasCurrentKeyword, isCurrentlyCreature } from \'../utils/creatureUtils\';',
    'getCounterCombatRestrictionReason, getControlledCreatureCombatGateReason, hasCurrentKeyword, isCurrentlyCreature } from \'../utils/creatureUtils\';'
  );
}

// Fix attack reason chain
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

// Critical: don't treat "can't attack or block unless ..." as unconditional can't block
const oldCrude = `// Check can't block from card text (non-counter sources)
  if (canBlock && combinedText.includes("can't block") && !combinedText.includes("can't be blocked")) {
    canBlock = false;
    blockReason = blockReason || "Can't block";
  }`;

const newCrude = `// Unconditional "can't block" only — "can't block unless ..." is handled by the shared gate helper.
  if (
    canBlock
    && /can(?:not|'t)\\s+block(?!\\s+unless)\\b/i.test(combinedText)
    && !/can(?:not|'t)\\s+be blocked\\b/i.test(combinedText)
    && !/can(?:not|'t)\\s+attack\\s+or\\s+block\\s+unless\\b/i.test(combinedText)
  ) {
    canBlock = false;
    blockReason = blockReason || "Can't block";
  }`;

if (s.includes(oldCrude)) {
  s = s.replace(oldCrude, newCrude);
  console.log('replaced crude cant-block check');
} else if (s.includes('combinedText.includes("can\'t block")')) {
  // alternate quote style
  s = s.replace(
    /if \(canBlock && combinedText\.includes\("can't block"\) && !combinedText\.includes\("can't be blocked"\)\) \{\s*canBlock = false;\s*blockReason = blockReason \|\| "Can't block";\s*\}/,
    newCrude.replace(/^\/\/[^\n]*\n\s*/, '')
  );
  console.log('regex-replaced crude check');
} else {
  console.log('crude check pattern not found');
  const idx = s.indexOf("can't block");
  console.log('nearby', s.slice(Math.max(0, idx-80), idx+120));
}

fs.writeFileSync(path, s);
console.log('done');
