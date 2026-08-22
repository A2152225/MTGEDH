const fs = require('fs');
const path = 'server/src/socket/combat.ts';
let s = fs.readFileSync(path, 'utf8');

const importBlock = `import {
  countControlledCreaturesForCombatGate,
  getControlledCreatureCombatGateViolation,
  parseControlledCreatureCombatGate,
} from "../../../shared/src/controlledCreatureCombatGate.js";
`;

if (!s.includes('controlledCreatureCombatGate')) {
  s = s.replace(
    `from "../../../shared/src/counterCombatRestrictions.js";`,
    `from "../../../shared/src/counterCombatRestrictions.js";\n${importBlock}`
  );
}

const helper = `
function getOracleTextForCombatGate(permanent: any): string {
  return [
    String(permanent?.card?.oracle_text || ''),
    String(permanent?.oracle_text || ''),
    Array.isArray(permanent?.grantedAbilities) ? permanent.grantedAbilities.join('\\n') : '',
  ].join('\\n');
}

function getControlledCreatureGateViolationForPermanent(
  permanent: any,
  battlefield: any[] = [],
  controllerId: string | undefined,
  action: 'attack' | 'block',
): { illegal: boolean; reason?: string } {
  const oracleText = getOracleTextForCombatGate(permanent);
  const gate = parseControlledCreatureCombatGate(oracleText);
  if (!gate) return { illegal: false };

  const pid = String(controllerId || permanent?.controller || '').trim();
  const controlledCount = countControlledCreaturesForCombatGate({
    battlefield,
    controllerId: pid,
    isCreature: (perm) => isCurrentlyCreature(perm, battlefield, pid),
    excludePermanentId: gate.otherOnly ? String(permanent?.id || '') : null,
  });

  return getControlledCreatureCombatGateViolation({
    oracleText,
    controlledCreatureCount: controlledCount,
    action,
    permanentName: String(permanent?.card?.name || 'This creature'),
  });
}
`;

if (!s.includes('getControlledCreatureGateViolationForPermanent')) {
  // Insert before canPermanentAttack
  const marker = 'function canPermanentAttack(';
  const idx = s.indexOf(marker);
  if (idx < 0) throw new Error('canPermanentAttack not found');
  s = s.slice(0, idx) + helper + '\n' + s.slice(idx);
}

// Insert check at start of canPermanentAttack body (after opening brace + first comments/checks)
const attackNeedle = `function canPermanentAttack(
  permanent: any,
  battlefield: any[] = [],
  controllerId?: string
): { canAttack: boolean; reason?: string } {
  // Check for counters that prevent attacking (e.g., bribery counters with Gwafa Hazid)
  // Uses scalable pattern matching instead of hardcoded card checks
  const counterCheck = isCounterPreventingAttack(permanent, battlefield);`;

const attackInsert = `function canPermanentAttack(
  permanent: any,
  battlefield: any[] = [],
  controllerId?: string
): { canAttack: boolean; reason?: string } {
  const creatureGate = getControlledCreatureGateViolationForPermanent(
    permanent,
    battlefield,
    controllerId,
    'attack',
  );
  if (creatureGate.illegal) {
    return { canAttack: false, reason: creatureGate.reason || 'Creature-count combat gate' };
  }

  // Check for counters that prevent attacking (e.g., bribery counters with Gwafa Hazid)
  // Uses scalable pattern matching instead of hardcoded card checks
  const counterCheck = isCounterPreventingAttack(permanent, battlefield);`;

if (!s.includes("getControlledCreatureGateViolationForPermanent(\n    permanent,\n    battlefield,\n    controllerId,\n    'attack'")) {
  if (!s.includes(attackNeedle)) throw new Error('attack needle not found');
  s = s.replace(attackNeedle, attackInsert);
}

// Add block gate early in canBlockAttacker after counter check
const blockNeedle = `function canBlockAttacker(
  blocker: any,
  attacker: any,
  battlefield: any[] = [],
  blockerControllerId?: string
): { canBlock: boolean; reason?: string } {
  // Check for counters that prevent blocking (e.g., bribery counters with Gwafa Hazid)
  // Uses scalable pattern matching instead of hardcoded card checks
  const counterCheck = isCounterPreventingBlock(blocker, battlefield);
  if (counterCheck.isPrevented) {
    return { 
      canBlock: false, 
      reason: \`Has \${counterCheck.counterType} counter (\${counterCheck.sourceName} effect)\` 
    };
  }`;

const blockInsert = `function canBlockAttacker(
  blocker: any,
  attacker: any,
  battlefield: any[] = [],
  blockerControllerId?: string
): { canBlock: boolean; reason?: string } {
  const creatureGate = getControlledCreatureGateViolationForPermanent(
    blocker,
    battlefield,
    blockerControllerId,
    'block',
  );
  if (creatureGate.illegal) {
    return { canBlock: false, reason: creatureGate.reason || 'Creature-count combat gate' };
  }

  // Check for counters that prevent blocking (e.g., bribery counters with Gwafa Hazid)
  // Uses scalable pattern matching instead of hardcoded card checks
  const counterCheck = isCounterPreventingBlock(blocker, battlefield);
  if (counterCheck.isPrevented) {
    return { 
      canBlock: false, 
      reason: \`Has \${counterCheck.counterType} counter (\${counterCheck.sourceName} effect)\` 
    };
  }`;

if (!s.includes("getControlledCreatureGateViolationForPermanent(\n    blocker,")) {
  if (!s.includes(blockNeedle)) {
    // try softer: just find canBlockAttacker and inject after signature body start
    console.log('block needle exact match failed, trying softer');
    const soft = s.indexOf('function canBlockAttacker(');
    if (soft < 0) throw new Error('canBlockAttacker missing');
    const brace = s.indexOf('{', soft);
    const after = s.indexOf('\n', brace) + 1;
    const inject = `  const creatureGate = getControlledCreatureGateViolationForPermanent(
    blocker,
    battlefield,
    blockerControllerId,
    'block',
  );
  if (creatureGate.illegal) {
    return { canBlock: false, reason: creatureGate.reason || 'Creature-count combat gate' };
  }

`;
    s = s.slice(0, after) + inject + s.slice(after);
  } else {
    s = s.replace(blockNeedle, blockInsert);
  }
}

fs.writeFileSync(path, s);
console.log('combat.ts patched');
