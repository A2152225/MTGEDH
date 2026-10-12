// rules-engine/src/aiEngineBlockPlanning.ts
// Declare-blockers planning for the AI defender (split from aiEngineCombatSupport.ts).
// Free blocks and good trades always; chump blocks only when the attack is lethal
// (life or commander damage), cheapest chump first, stopping once the rest is survivable.
// Menace attackers need two blockers; a big attacker may be double-blocked when that kills
// it and the worst-case loss is cheaper than the attacker.
// Public entry symbols: planAIBlocks, evaluateSingleBlockOutcome, readCommanderDamageTaken.

import { getBlockerCapacity } from './actions/combat';
import { canCreatureBlock, type CombatCreature } from './combatAutomation';
import type { AIDecisionContext } from './AIEngine';

export interface BlockerEvaluation {
  readonly perm: any;
  readonly creature: CombatCreature;
  readonly wantsToGetKilled: boolean;
  readonly deathBenefit: number;
  readonly baseValue: number;
  readonly preserveBias: number;
  readonly attackBias: number;
}

export interface BlockAssignment { blockerId: string; attackerId: string }

function markedDamage(perm: any): number {
  const raw = perm?.damageMarked ?? perm?.markedDamage ?? perm?.damage ?? perm?.counters?.damage ?? 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function hitDamage(c: CombatCreature): number {
  return c.keywords.doubleStrike ? c.power * 2 : c.power;
}

export function evaluateSingleBlockOutcome(blocker: CombatCreature, attacker: CombatCreature): {
  blockerSurvives: boolean;
  attackerDies: boolean;
} {
  const blockerToughness = blocker.toughness - markedDamage(blocker.permanent);
  const attackerToughness = attacker.toughness - markedDamage(attacker.permanent);
  const attackerKills = !blocker.keywords.indestructible && attacker.power > 0
    && (attacker.keywords.deathtouch || hitDamage(attacker) >= blockerToughness);
  const blockerKills = !attacker.keywords.indestructible && blocker.power > 0
    && (blocker.keywords.deathtouch || hitDamage(blocker) >= attackerToughness);
  const attackerFirst = attacker.keywords.firstStrike || attacker.keywords.doubleStrike;
  const blockerFirst = blocker.keywords.firstStrike || blocker.keywords.doubleStrike;
  let blockerSurvives = !attackerKills;
  let attackerDies = blockerKills;
  // First strike on one side only: whoever strikes first and kills takes no damage back.
  if (attackerFirst && !blockerFirst && attackerKills
    && (attacker.keywords.deathtouch || attacker.power >= blockerToughness)) attackerDies = false;
  if (blockerFirst && !attackerFirst && blockerKills
    && (blocker.keywords.deathtouch || blocker.power >= attackerToughness)) blockerSurvives = true;
  return { blockerSurvives, attackerDies };
}

function isCommanderAttacker(gameState: any, attacker: CombatCreature): boolean {
  const perm: any = attacker.permanent;
  if (perm?.isCommander === true || perm?.card?.zone === 'command') return true;
  const ids = gameState?.commandZone?.[attacker.controllerId]?.commanderIds;
  const cardId = String(perm?.card?.id || '');
  return Array.isArray(ids) && cardId !== '' && ids.map(String).includes(cardId);
}

/** Commander damage the defender already took from this attacker (server keys by card id). */
export function readCommanderDamageTaken(gameState: any, defenderId: string, attacker: CombatCreature): number {
  const table = gameState?.commanderDamage?.[defenderId] || {};
  const perm: any = attacker.permanent;
  const keys = [perm?.card?.id, perm?.id, `${attacker.controllerId}-${attacker.name}`, attacker.name];
  for (const key of keys) {
    const value = Number(table[String(key || '')]);
    if (key && Number.isFinite(value) && value > 0) return value;
  }
  return 0;
}

// Same scale for attackers and blockers so trades compare like with like.
function creatureValue(gameState: any, c: CombatCreature): number {
  let value = c.power + c.toughness;
  if (c.keywords.deathtouch) value += 2;
  if (c.keywords.flying) value += 1;
  if (c.keywords.lifelink) value += 1;
  if (isCommanderAttacker(gameState, c)) value += 8;
  return value;
}

function readLife(gameState: any, playerId: string): number {
  const fromMap = gameState?.life?.[playerId];
  if (typeof fromMap === 'number') return fromMap;
  const player = (gameState?.players || []).find((entry: any) => entry?.id === playerId);
  return typeof player?.life === 'number' ? player.life : 40;
}

export function planAIBlocks(
  context: AIDecisionContext,
  attackers: readonly CombatCreature[],
  blockers: readonly BlockerEvaluation[],
): { assignments: BlockAssignment[]; deathTriggerBlocks: number } {
  const gameState: any = context.gameState;
  const defenderId = context.playerId;
  const life = readLife(gameState, defenderId);
  const assignments: BlockAssignment[] = [];
  const usage = new Map<string, number>();
  let deathTriggerBlocks = 0;

  const hasCapacity = (b: BlockerEvaluation) => (usage.get(b.creature.id) || 0) < getBlockerCapacity(b.perm);
  const use = (b: BlockerEvaluation, attacker: CombatCreature) => {
    assignments.push({ blockerId: b.creature.id, attackerId: attacker.id });
    usage.set(b.creature.id, (usage.get(b.creature.id) || 0) + 1);
    if (b.wantsToGetKilled) deathTriggerBlocks++;
  };
  const commanderLethal = (a: CombatCreature) =>
    isCommanderAttacker(gameState, a) && readCommanderDamageTaken(gameState, defenderId, a) + hitDamage(a) >= 21;

  let incoming = attackers.reduce((sum, a) => sum + hitDamage(a), 0);
  const threat = (a: CombatCreature) => hitDamage(a) + (commanderLethal(a) ? 1000 : 0)
    + (isCommanderAttacker(gameState, a) ? 10 : 0) + (a.keywords.deathtouch ? 4 : 0) + (a.keywords.trample ? 3 : 0);
  const ordered = [...attackers].sort((a, b) => threat(b) - threat(a));
  const unhandled: CombatCreature[] = [];

  for (const attacker of ordered) {
    const mustStop = commanderLethal(attacker) || incoming >= life;
    if (attacker.keywords.menace) { unhandled.push(attacker); continue; }
    const attackerValue = creatureValue(gameState, attacker);
    let best: { b: BlockerEvaluation; score: number; survives: boolean } | null = null;
    for (const b of blockers) {
      if (!hasCapacity(b)) continue;
      if (!canCreatureBlock(b.creature, attacker, []).legal) continue;
      const { blockerSurvives, attackerDies } = evaluateSingleBlockOutcome(b.creature, attacker);
      const blockerValue = creatureValue(gameState, b.creature);
      let score: number;
      if (blockerSurvives && attackerDies) score = 60 + attackerValue;
      else if (blockerSurvives) score = 25; // free block: no loss, damage prevented
      else if (attackerDies) score = 5 + (attackerValue - blockerValue) * 3 - b.preserveBias; // trade
      // Chump only when the attack must be stopped, and then with the cheapest creature.
      else score = (mustStop ? 0 : -1000) - blockerValue - Math.max(0, b.baseValue) / 10;
      if (b.wantsToGetKilled && !blockerSurvives) score += 50 + b.deathBenefit * 5;
      if (blockerSurvives && b.attackBias > 0) score += Math.min(6, b.attackBias / 2);
      if (mustStop) score += 200;
      if (!best || score > best.score) best = { b, score, survives: blockerSurvives };
    }
    if (best && (best.score > 0 || mustStop)) {
      use(best.b, attacker);
      const prevented = attacker.keywords.trample
        ? Math.min(hitDamage(attacker), Math.max(0, best.b.creature.toughness))
        : hitDamage(attacker);
      incoming -= prevented;
    } else {
      unhandled.push(attacker);
    }
  }

  // Double blocks: menace attackers (need two) and big attackers no single blocker handles well.
  for (const attacker of unhandled) {
    const mustStop = commanderLethal(attacker) || incoming >= life;
    const legal = blockers.filter((b) => hasCapacity(b) && canCreatureBlock(b.creature, attacker, []).legal);
    const attackerValue = creatureValue(gameState, attacker);
    const attackerToughness = attacker.toughness - markedDamage(attacker.permanent);
    let bestPair: { pair: [BlockerEvaluation, BlockerEvaluation]; loss: number } | null = null;
    for (let i = 0; i < legal.length; i++) {
      for (let j = i + 1; j < legal.length; j++) {
        const pair: [BlockerEvaluation, BlockerEvaluation] = [legal[i], legal[j]];
        const kills = !attacker.keywords.indestructible && (
          pair.some((b) => b.creature.keywords.deathtouch && b.creature.power > 0)
          || pair.reduce((s, b) => s + hitDamage(b.creature), 0) >= attackerToughness);
        // Worst case the attacker kills what its damage can reach (deathtouch: one per point).
        const killable = pair
          .map((b) => ({ b, t: b.creature.toughness - markedDamage(b.perm), v: creatureValue(gameState, b.creature) }))
          .filter((x) => !x.b.creature.keywords.indestructible)
          .sort((x, y) => y.v - x.v);
        let budget = hitDamage(attacker);
        let loss = 0;
        for (const x of killable) {
          const need = attacker.keywords.deathtouch ? 1 : x.t;
          if (budget >= need) { budget -= need; loss += x.v; }
        }
        const acceptable = mustStop || (kills && loss < attackerValue);
        if (!acceptable) continue;
        if (!bestPair || loss < bestPair.loss) bestPair = { pair, loss };
      }
    }
    if (bestPair) {
      for (const b of bestPair.pair) use(b, attacker);
      incoming -= hitDamage(attacker);
    }
  }

  return { assignments, deathTriggerBlocks };
}
