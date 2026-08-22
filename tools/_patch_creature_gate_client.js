const fs = require('fs');
const path = 'client/src/utils/creatureUtils.ts';
let s = fs.readFileSync(path, 'utf8');

if (!s.includes('controlledCreatureCombatGate')) {
  s = s.replace(
    `} from '../../../shared/src/counterCombatRestrictions';`,
    `} from '../../../shared/src/counterCombatRestrictions';
import {
  countControlledCreaturesForCombatGate,
  getControlledCreatureCombatGateViolation,
  parseControlledCreatureCombatGate,
} from '../../../shared/src/controlledCreatureCombatGate';`
  );
}

const helper = `
function getOracleTextForCombatGate(perm: BattlefieldPermanent): string {
  return [
    String((perm.card as any)?.oracle_text || ''),
    String((perm as any).oracle_text || ''),
    Array.isArray((perm as any).grantedAbilities) ? (perm as any).grantedAbilities.join('\\n') : '',
  ].join('\\n');
}

function failsControlledCreatureCombatGate(
  perm: BattlefieldPermanent,
  battlefield: readonly BattlefieldPermanent[] | undefined,
  action: 'attack' | 'block',
): boolean {
  const field = battlefield || [];
  const oracleText = getOracleTextForCombatGate(perm);
  const gate = parseControlledCreatureCombatGate(oracleText);
  if (!gate) return false;

  const controllerId = String(perm.controller || '').trim();
  const controlledCount = countControlledCreaturesForCombatGate({
    battlefield: field,
    controllerId,
    isCreature: (p) => isCurrentlyCreature(p as BattlefieldPermanent),
    excludePermanentId: gate.otherOnly ? String(perm.id || '') : null,
  });

  return getControlledCreatureCombatGateViolation({
    oracleText,
    controlledCreatureCount: controlledCount,
    action,
    permanentName: String((perm.card as any)?.name || 'This creature'),
  }).illegal;
}
`;

if (!s.includes('failsControlledCreatureCombatGate')) {
  // Insert before canCreatureAttackNow
  const marker = 'export function canCreatureAttackNow(';
  const idx = s.indexOf(marker);
  if (idx < 0) throw new Error('canCreatureAttackNow not found');
  s = s.slice(0, idx) + helper + '\n' + s.slice(idx);
}

if (!s.includes("failsControlledCreatureCombatGate(perm, battlefield, 'attack')")) {
  s = s.replace(
    `export function canCreatureAttackNow(
  perm: BattlefieldPermanent,
  battlefield?: BattlefieldPermanent[],
): boolean {
  const field = battlefield || [];
  const counterCheck = isCounterPreventingAttack(perm, field);
  if (counterCheck.isPrevented) {
    return false;
  }`,
    `export function canCreatureAttackNow(
  perm: BattlefieldPermanent,
  battlefield?: BattlefieldPermanent[],
): boolean {
  const field = battlefield || [];
  if (failsControlledCreatureCombatGate(perm, field, 'attack')) {
    return false;
  }
  const counterCheck = isCounterPreventingAttack(perm, field);
  if (counterCheck.isPrevented) {
    return false;
  }`
  );
}

if (!s.includes("failsControlledCreatureCombatGate(perm, battlefield, 'block')")) {
  s = s.replace(
    `export function canCreatureBlockNow(
  perm: BattlefieldPermanent,
  battlefield?: BattlefieldPermanent[],
): boolean {
  const field = battlefield || [];
  const counterCheck = isCounterPreventingBlock(perm, field);
  if (counterCheck.isPrevented) {
    return false;
  }`,
    `export function canCreatureBlockNow(
  perm: BattlefieldPermanent,
  battlefield?: BattlefieldPermanent[],
): boolean {
  const field = battlefield || [];
  if (failsControlledCreatureCombatGate(perm, field, 'block')) {
    return false;
  }
  const counterCheck = isCounterPreventingBlock(perm, field);
  if (counterCheck.isPrevented) {
    return false;
  }`
  );
}

// Improve CombatControlModal reason for the gate - optional: getCounterCombatRestrictionReason style
// Add getControlledCreatureCombatGateReason export for UI messages
if (!s.includes('export function getControlledCreatureCombatGateReason')) {
  s += `
export function getControlledCreatureCombatGateReason(
  perm: BattlefieldPermanent,
  battlefield: readonly BattlefieldPermanent[],
  action: 'attack' | 'block',
): string | undefined {
  const oracleText = getOracleTextForCombatGate(perm);
  const gate = parseControlledCreatureCombatGate(oracleText);
  if (!gate) return undefined;
  const controllerId = String(perm.controller || '').trim();
  const controlledCount = countControlledCreaturesForCombatGate({
    battlefield,
    controllerId,
    isCreature: (p) => isCurrentlyCreature(p as BattlefieldPermanent),
    excludePermanentId: gate.otherOnly ? String(perm.id || '') : null,
  });
  const violation = getControlledCreatureCombatGateViolation({
    oracleText,
    controlledCreatureCount: controlledCount,
    action,
    permanentName: String((perm.card as any)?.name || 'This creature'),
  });
  return violation.illegal ? violation.reason : undefined;
}
`;
}

fs.writeFileSync(path, s);
console.log('creatureUtils patched');
