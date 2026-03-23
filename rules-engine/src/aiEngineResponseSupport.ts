import type { BattlefieldPermanent } from '../../shared/src';
import { getCreatureToughness, createCombatCreature, calculateLethalDamage, type CombatCreature } from './combatAutomation';
import { AIDecisionType, type AIDecision, type AIDecisionContext } from './AIEngine';

export function makeTriggeredAbilityDecision(context: AIDecisionContext): AIDecision {
  const { playerId, constraints } = context;
  const isOptional = constraints?.optional || false;
  const effectText = constraints?.effect || '';

  if (isOptional) {
    const beneficial =
      effectText.includes('draw') ||
      effectText.includes('gain') ||
      effectText.includes('+1/+1') ||
      effectText.includes('create') ||
      effectText.includes('search');

    const harmful =
      effectText.includes('discard') ||
      effectText.includes('sacrifice') ||
      effectText.includes('lose') ||
      effectText.includes('damage to you');

    const accept = beneficial && !harmful;

    return {
      type: AIDecisionType.TRIGGERED_ABILITY,
      playerId,
      action: { accept, triggered: true },
      reasoning: accept ? 'Accepting beneficial trigger' : 'Declining harmful/neutral trigger',
      confidence: 0.7,
    };
  }

  return {
    type: AIDecisionType.TRIGGERED_ABILITY,
    playerId,
    action: { accept: true, triggered: true },
    reasoning: 'Mandatory trigger - must resolve',
    confidence: 1,
  };
}

export function makeDamageAssignmentDecision(
  context: AIDecisionContext,
  getProcessedBattlefield: (gameState: any) => BattlefieldPermanent[]
): AIDecision {
  const { playerId, constraints } = context;
  const attacker = constraints?.attacker;
  const blockers = constraints?.blockers || [];
  const hasTrample = constraints?.trample || false;

  if (!attacker || blockers.length === 0) {
    return {
      type: AIDecisionType.ASSIGN_DAMAGE,
      playerId,
      action: { assignments: [], trampleDamage: 0 },
      reasoning: 'No blockers to assign damage to',
      confidence: 1,
    };
  }

  const processedBattlefield = getProcessedBattlefield(context.gameState);
  const processedAttacker = processedBattlefield.find((perm: BattlefieldPermanent) => perm.id === attacker.id) || attacker;
  const attackerCreature = createCombatCreature(processedAttacker as BattlefieldPermanent);
  const blockerCreatures = blockers.map((b: BattlefieldPermanent) => {
    const processedBlocker = processedBattlefield.find((perm: BattlefieldPermanent) => perm.id === b.id) || b;
    return createCombatCreature(processedBlocker as BattlefieldPermanent);
  });

  blockerCreatures.sort((a: CombatCreature, b: CombatCreature) => a.toughness - b.toughness);

  const assignments: { blockerId: string; damage: number }[] = [];
  let remainingPower = attackerCreature.power;

  for (const blocker of blockerCreatures) {
    if (remainingPower <= 0) break;

    const lethalDamage = calculateLethalDamage(attackerCreature, blocker);
    const assigned = Math.min(remainingPower, lethalDamage);

    assignments.push({
      blockerId: blocker.id,
      damage: assigned,
    });

    remainingPower -= assigned;
  }

  const trampleDamage = hasTrample ? remainingPower : 0;

  return {
    type: AIDecisionType.ASSIGN_DAMAGE,
    playerId,
    action: { assignments, trampleDamage },
    reasoning: `Assigned damage to ${assignments.length} blockers, ${trampleDamage} trample`,
    confidence: 0.9,
  };
}

export function makeBlockerOrderDecision(
  context: AIDecisionContext,
  getProcessedBattlefield: (gameState: any) => BattlefieldPermanent[]
): AIDecision {
  const { playerId, options } = context;
  const blockers = options || [];

  if (blockers.length === 0) {
    return {
      type: AIDecisionType.ORDER_BLOCKERS,
      playerId,
      action: { order: [] },
      reasoning: 'No blockers to order',
      confidence: 1,
    };
  }

  const processedBattlefield = getProcessedBattlefield(context.gameState);
  const resolvePermanent = (perm: any) =>
    typeof perm === 'object' && perm?.id
      ? processedBattlefield.find((entry: BattlefieldPermanent) => entry.id === perm.id) || perm
      : perm;

  const ordered = [...blockers].sort((a: any, b: any) => {
    const aToughness = typeof a === 'object' ? getCreatureToughness(resolvePermanent(a)) : 0;
    const bToughness = typeof b === 'object' ? getCreatureToughness(resolvePermanent(b)) : 0;
    return aToughness - bToughness;
  });

  const order = ordered.map((b: any) => (typeof b === 'string' ? b : b.id));

  return {
    type: AIDecisionType.ORDER_BLOCKERS,
    playerId,
    action: { order },
    reasoning: 'Ordered blockers by ascending toughness',
    confidence: 0.8,
  };
}
