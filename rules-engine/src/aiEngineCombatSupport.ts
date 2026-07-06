import type { BattlefieldPermanent } from '../../shared/src';
import { getLegalAttackers, getLegalBlockers, getBlockerCapacity, getGoadedAttackers, getGoadedAttackTargets } from './actions/combat';
import { canCreatureBlock, createCombatCreature, type CombatCreature } from './combatAutomation';
import { SynergyArchetype } from './CardAnalyzer';
import {
  battlefieldHasManaRetention,
  findAttackManaRetentionEquipmentAttachedTo,
  getPlayerGreenManaInPool,
  readPermanentPower,
} from './aiEngineManaPoolSupport';
import { AIStrategy, AIDecisionType, type AIDecision, type AIDecisionContext, type AIPlayerConfig } from './AIEngine';
import { shouldPreserveInCombat } from './aiEngineValueSupport';

type CombatDeckModifiers = { attackBias: number; preserveBias: number };
type CombatValueEvaluation = { combatValue: number; wantsToGetKilled: boolean; deathBenefit: number };

/** True when the defender has an untapped legal blocker that would kill this attacker. */
export function wouldDefenderLikelyBlockProfitably(
  attackerPerm: BattlefieldPermanent,
  defendingPlayerId: string,
  battlefield: readonly BattlefieldPermanent[],
): boolean {
  const attacker = createCombatCreature(attackerPerm);
  const legalBlockerIds = getLegalBlockers(
    { battlefield: [...battlefield] } as any,
    defendingPlayerId,
    attacker.id,
  );

  for (const blockerId of legalBlockerIds) {
    const blockerPerm = battlefield.find((perm) => perm.id === blockerId);
    if (!blockerPerm || blockerPerm.tapped) continue;

    const blocker = createCombatCreature(blockerPerm);
    const validation = canCreatureBlock(blocker, attacker, []);
    if (!validation.legal) continue;

    const attackerDies =
      attacker.toughness <= blocker.power || blocker.keywords.deathtouch;
    if (attackerDies) {
      return true;
    }
  }

  return false;
}

function isActiveCombatOpponent(player: any, attackingPlayerId: string): boolean {
  return Boolean(player?.id)
    && player.id !== attackingPlayerId
    && !player?.hasLost
    && !player?.eliminated
    && !player?.conceded
    && !player?.spectator
    && !player?.isSpectator;
}

function listActiveOpponents(gameState: AIDecisionContext['gameState'], attackingPlayerId: string) {
  return gameState.players
    .filter((player: any) => isActiveCombatOpponent(player, attackingPlayerId))
    .map((player) => ({ id: player.id, life: player.life ?? 40 }));
}

/** True when a small attacker can find at least one opponent without a profitable block. */
export function attackerHasOpenLane(
  attackerPerm: BattlefieldPermanent,
  opponents: ReadonlyArray<{ id: string }>,
  battlefield: readonly BattlefieldPermanent[],
): boolean {
  const attacker = createCombatCreature(attackerPerm);
  if (!isSmallVoluntaryAttacker(attacker)) return true;
  return opponents.some(
    (opp) => !wouldDefenderLikelyBlockProfitably(attackerPerm, opp.id, battlefield),
  );
}

/** In multiplayer, route each attacker at the player most likely to take the damage. */
export function selectBestDefenderForAttacker(
  attackerPerm: BattlefieldPermanent,
  opponents: ReadonlyArray<{ id: string; life?: number }>,
  battlefield: readonly BattlefieldPermanent[],
  fallbackTarget: string,
): string {
  if (opponents.length === 0) return fallbackTarget;

  const attacker = createCombatCreature(attackerPerm);
  const small = isSmallVoluntaryAttacker(attacker);
  const isCommander = Boolean((attackerPerm as any).isCommander);

  const scored = opponents.map((opp) => {
    const profitableBlock = wouldDefenderLikelyBlockProfitably(attackerPerm, opp.id, battlefield);
    let score = 0;

    if (profitableBlock && small) {
      score -= 500;
    } else if (!profitableBlock) {
      score += 100;
    }

    // Prefer lower life when lanes are otherwise similar (chip / race).
    score += Math.max(0, 40 - (opp.life ?? 40));

    return { id: opp.id, score };
  });

  scored.sort((a, b) => b.score - a.score);

  if (small && !isCommander && scored[0].score < 0) {
    return fallbackTarget;
  }

  return scored[0]?.id || fallbackTarget;
}

function isSmallVoluntaryAttacker(attacker: CombatCreature): boolean {
  return attacker.power + attacker.toughness <= 4;
}

/** Strategy tunes how eager the AI is to attack; combat sanity is always applied. */
export function getStrategyAttackModifiers(strategy: AIStrategy): {
  minVoluntaryAttackValue: number;
  maxAttackFraction: number;
} {
  switch (strategy) {
    case AIStrategy.AGGRESSIVE:
      return { minVoluntaryAttackValue: -4, maxAttackFraction: 1 };
    case AIStrategy.DEFENSIVE:
      return { minVoluntaryAttackValue: 1, maxAttackFraction: 0.5 };
    case AIStrategy.CONTROL:
      return { minVoluntaryAttackValue: 0, maxAttackFraction: 0.75 };
    case AIStrategy.COMBO:
      return { minVoluntaryAttackValue: 2, maxAttackFraction: 0.35 };
    case AIStrategy.RANDOM:
    case AIStrategy.BASIC:
    default:
      return { minVoluntaryAttackValue: 0, maxAttackFraction: 1 };
  }
}

function isActiveCombatPlayer(player: any): boolean {
  return Boolean(player?.id) && !player?.hasLost && !player?.eliminated && !player?.conceded && !player?.spectator && !player?.isSpectator;
}

export function makeBasicAttackDecision(
  context: AIDecisionContext,
  config: AIPlayerConfig,
  deps: {
    getProcessedBattlefield: (gameState: AIDecisionContext['gameState']) => BattlefieldPermanent[];
    selectAttackTarget: (gameState: AIDecisionContext['gameState'], playerId: string) => string;
    getCombatDeckModifiers: (perm: BattlefieldPermanent, config: AIPlayerConfig) => CombatDeckModifiers;
    evaluateCombatValue: (perm: BattlefieldPermanent, isAttacking: boolean, opponentCount?: number) => CombatValueEvaluation;
    getPrimaryArchetypes: (config: AIPlayerConfig) => readonly SynergyArchetype[];
    shouldMakeMistake: (difficulty?: number) => boolean;
  }
): AIDecision {
  const difficulty = config.difficulty ?? 0.5;
  const { minVoluntaryAttackValue, maxAttackFraction } = getStrategyAttackModifiers(config.strategy);
  const legalAttackerIds = getLegalAttackers(context.gameState, context.playerId);

  if (legalAttackerIds.length === 0) {
    return {
      type: AIDecisionType.DECLARE_ATTACKERS,
      playerId: context.playerId,
      action: { attackers: [] },
      reasoning: 'No creatures can legally attack',
      confidence: 1,
    };
  }

  const player = context.gameState.players.find(p => p.id === context.playerId);
  const globalBattlefield = deps.getProcessedBattlefield(context.gameState);
  const findPermanent = (id: string) => globalBattlefield.find((p: any) => p.id === id);

  if (!player) {
    const targetPlayer = deps.selectAttackTarget(context.gameState, context.playerId);
    const attackers = legalAttackerIds.map(id => ({
      creatureId: id,
      defendingPlayerId: targetPlayer,
    }));

    return {
      type: AIDecisionType.DECLARE_ATTACKERS,
      playerId: context.playerId,
      action: { attackers },
      reasoning: `Attacking with ${legalAttackerIds.length} legal creatures`,
      confidence: 0.6,
    };
  }

  const goadedCreatureIds = getGoadedAttackers(context.gameState, context.playerId);
  const goadedSet = new Set(goadedCreatureIds);
  const activeOpponents = context.gameState.players.filter((candidate: any) =>
    candidate?.id && candidate.id !== context.playerId && !candidate?.hasLost && !candidate?.eliminated && !candidate?.conceded
  ).length;
  const allPlayerIds = context.gameState.players
    .filter((p: any) => isActiveCombatPlayer(p) || p.id === context.playerId)
    .map(p => p.id);
  const goadedAttackers: Array<{ creatureId: string; defendingPlayerId: string }> = [];

  for (const goadedId of goadedCreatureIds) {
    const perm = findPermanent(goadedId);
    if (!perm) continue;

    const validTargets = getGoadedAttackTargets(perm, allPlayerIds, context.gameState.turn, globalBattlefield as any[]);
    if (validTargets.length === 0) continue;

    const targetPlayer = validTargets.reduce((lowest, current) => {
      const currentLife = context.gameState.players.find(p => p.id === current)?.life || 40;
      const lowestLife = context.gameState.players.find(p => p.id === lowest)?.life || 40;
      return currentLife < lowestLife ? current : lowest;
    });

    goadedAttackers.push({
      creatureId: goadedId,
      defendingPlayerId: targetPlayer,
    });
  }

  const nonGoadedLegalAttackerIds = legalAttackerIds.filter(id => !goadedSet.has(id));
  const attackerEvaluations = nonGoadedLegalAttackerIds.map(id => {
    const perm = findPermanent(id);
    if (!perm) return { id, value: 0, wantsToGetKilled: false };

    const evaluation = deps.evaluateCombatValue(perm, true, activeOpponents);
    const deckModifiers = deps.getCombatDeckModifiers(perm, config);
    let attackManaEngineBonus = 0;
    if (findAttackManaRetentionEquipmentAttachedTo(globalBattlefield, id)) {
      const power = readPermanentPower(perm);
      attackManaEngineBonus = 12 + Math.min(32, power * 2);
      if (battlefieldHasManaRetention(globalBattlefield, context.playerId)) {
        attackManaEngineBonus += 6 + Math.min(12, getPlayerGreenManaInPool(context.gameState, context.playerId));
      }
    }
    return {
      id,
      value: evaluation.combatValue + deckModifiers.attackBias - deckModifiers.preserveBias + attackManaEngineBonus,
      wantsToGetKilled: evaluation.wantsToGetKilled,
      deathBenefit: evaluation.deathBenefit,
      isCommander: Boolean((perm as any).isCommander),
      preserveBias: deckModifiers.preserveBias,
      attackBias: deckModifiers.attackBias,
    };
  });

  const targetPlayer = deps.selectAttackTarget(context.gameState, context.playerId);
  const opponents = listActiveOpponents(context.gameState, context.playerId);
  const smallAttackerBlockedEverywhere = (perm: BattlefieldPermanent) =>
    isSmallVoluntaryAttacker(createCombatCreature(perm))
    && !attackerHasOpenLane(perm, opponents, globalBattlefield);

  const suicideAttackers = attackerEvaluations
    .filter((entry) => entry.wantsToGetKilled && entry.deathBenefit >= 8)
    .map((entry) => entry.id);

  let regularAttackers = attackerEvaluations
    .filter((entry) => {
      const perm = findPermanent(entry.id);
      if (!perm || entry.wantsToGetKilled) return false;
      if (shouldPreserveInCombat(perm)) return false;
      if (smallAttackerBlockedEverywhere(perm)) return false;
      return entry.value > minVoluntaryAttackValue;
    })
    .sort((a, b) => b.value - a.value)
    .map(e => e.id);

  const archetypes = deps.getPrimaryArchetypes(config);
  if (archetypes.includes(SynergyArchetype.VOLTRON)) {
    regularAttackers = attackerEvaluations
      .filter((entry) => {
        const perm = findPermanent(entry.id);
        if (!perm || entry.wantsToGetKilled || shouldPreserveInCombat(perm)) return false;
        if (
          !entry.isCommander &&
          !(entry.attackBias >= entry.preserveBias + 5) &&
          smallAttackerBlockedEverywhere(perm)
        ) {
          return false;
        }
        return entry.isCommander || entry.attackBias >= entry.preserveBias + 5;
      })
      .sort((a, b) => b.value - a.value)
      .map(e => e.id);
  }

  if (archetypes.includes(SynergyArchetype.COMBO) || archetypes.includes(SynergyArchetype.SPELLSLINGER)) {
    regularAttackers = attackerEvaluations
      .filter((entry) => {
        const perm = findPermanent(entry.id);
        if (!perm || entry.wantsToGetKilled || shouldPreserveInCombat(perm)) return false;
        if (smallAttackerBlockedEverywhere(perm)) return false;
        return entry.attackBias >= entry.preserveBias;
      })
      .sort((a, b) => b.value - a.value)
      .map(e => e.id);
  }

  if (
    archetypes.includes(SynergyArchetype.ARISTOCRATS) ||
    (archetypes.includes(SynergyArchetype.TOKENS) && archetypes.includes(SynergyArchetype.ARISTOCRATS))
  ) {
    regularAttackers = attackerEvaluations
      .filter((entry) => {
        const perm = findPermanent(entry.id);
        if (!perm || entry.wantsToGetKilled || shouldPreserveInCombat(perm)) return false;
        if (entry.preserveBias > entry.attackBias + 2) return false;
        if (smallAttackerBlockedEverywhere(perm)) return false;
        return entry.attackBias >= entry.preserveBias;
      })
      .sort((a, b) => b.value - a.value)
      .map(e => e.id);
  }

  if (
    !archetypes.includes(SynergyArchetype.VOLTRON) &&
    !archetypes.includes(SynergyArchetype.COMBO) &&
    !archetypes.includes(SynergyArchetype.SPELLSLINGER) &&
    !archetypes.includes(SynergyArchetype.ARISTOCRATS) &&
    !archetypes.includes(SynergyArchetype.TOKENS) &&
    deps.shouldMakeMistake(difficulty)
  ) {
    if (Math.random() < 0.5) {
      regularAttackers = regularAttackers.slice(0, Math.floor(regularAttackers.length / 2));
    } else {
      // Overcommit mistake: still avoid throwing small death-payoff creatures into blocks.
      const preserveDeathPayoffIds = new Set(
        attackerEvaluations
          .filter((entry) => {
            if (suicideAttackers.includes(entry.id)) return false;
            const perm = findPermanent(entry.id);
            return Boolean(perm) && (entry.deathBenefit > 0 || shouldPreserveInCombat(perm!));
          })
          .map((entry) => entry.id),
      );
      regularAttackers = nonGoadedLegalAttackerIds.filter(
        (id) => {
          if (suicideAttackers.includes(id) || preserveDeathPayoffIds.has(id)) return false;
          const perm = findPermanent(id);
          if (!perm) return false;
          if (smallAttackerBlockedEverywhere(perm)) return false;
          return true;
        },
      );
    }
  }

  if (maxAttackFraction < 1 && regularAttackers.length > 1) {
    const cap = Math.max(1, Math.floor(regularAttackers.length * maxAttackFraction));
    regularAttackers = regularAttackers.slice(0, cap);
  }

  const voluntaryAttackers = [...suicideAttackers, ...regularAttackers].map((id) => {
    const perm = findPermanent(id);
    const defendingPlayerId = perm
      ? (suicideAttackers.includes(id)
        ? targetPlayer
        : selectBestDefenderForAttacker(perm, opponents, globalBattlefield, targetPlayer))
      : targetPlayer;
    return { creatureId: id, defendingPlayerId };
  });
  const allAttackers = [...goadedAttackers, ...voluntaryAttackers];

  let reasoning = `Attacking with ${allAttackers.length} creatures`;
  if (goadedCreatureIds.length > 0) {
    reasoning += ` (including ${goadedCreatureIds.length} goaded)`;
  }
  if (suicideAttackers.length > 0) {
    reasoning += ` (including ${suicideAttackers.length} with beneficial death triggers)`;
  }

  return {
    type: AIDecisionType.DECLARE_ATTACKERS,
    playerId: context.playerId,
    action: { attackers: allAttackers },
    reasoning,
    confidence: 0.7,
  };
}

export function makeBasicBlockDecision(
  context: AIDecisionContext,
  config: AIPlayerConfig,
  deps: {
    getProcessedBattlefield: (gameState: AIDecisionContext['gameState']) => BattlefieldPermanent[];
    getCombatDeckModifiers: (perm: BattlefieldPermanent, config: AIPlayerConfig) => CombatDeckModifiers;
    evaluateCombatValue: (perm: BattlefieldPermanent, isAttacking: boolean, opponentCount?: number) => CombatValueEvaluation;
    evaluatePermanentValue: (perm: BattlefieldPermanent) => number;
  }
): AIDecision {
  const legalBlockerIds = getLegalBlockers(context.gameState, context.playerId);

  if (legalBlockerIds.length === 0) {
    return {
      type: AIDecisionType.DECLARE_BLOCKERS,
      playerId: context.playerId,
      action: { blockers: [] },
      reasoning: 'No creatures can legally block',
      confidence: 1,
    };
  }

  const attackingCreatures = context.constraints?.attackers || [];
  if (attackingCreatures.length === 0) {
    return {
      type: AIDecisionType.DECLARE_BLOCKERS,
      playerId: context.playerId,
      action: { blockers: [] },
      reasoning: 'No attackers to block',
      confidence: 1,
    };
  }

  const globalBattlefield = deps.getProcessedBattlefield(context.gameState);
  const blockerPermanents = globalBattlefield.filter((p: any) => p.controller === context.playerId && legalBlockerIds.includes(p.id));

  if (blockerPermanents.length === 0) {
    return {
      type: AIDecisionType.DECLARE_BLOCKERS,
      playerId: context.playerId,
      action: { blockers: [] },
      reasoning: 'No blockers available',
      confidence: 1,
    };
  }

  const blockerEvaluations = blockerPermanents.map((perm: BattlefieldPermanent) => {
    const activeOpponents = context.gameState.players.filter((candidate: any) =>
      candidate?.id && candidate.id !== context.playerId && !candidate?.hasLost && !candidate?.eliminated && !candidate?.conceded
    ).length;
    const evaluation = deps.evaluateCombatValue(perm, false, activeOpponents);
    const deckModifiers = deps.getCombatDeckModifiers(perm, config);
    return {
      perm,
      creature: createCombatCreature(perm),
      wantsToGetKilled: evaluation.wantsToGetKilled,
      deathBenefit: evaluation.deathBenefit,
      baseValue: deps.evaluatePermanentValue(perm),
      preserveBias: deckModifiers.preserveBias,
      attackBias: deckModifiers.attackBias,
    };
  });

  const attackerCreatures = attackingCreatures
    .map((a: any) => {
      if (typeof a === 'object' && a.id) {
        const processedAttacker = globalBattlefield.find((perm: BattlefieldPermanent) => perm.id === a.id) || a;
        return createCombatCreature(processedAttacker as BattlefieldPermanent);
      }
      return null;
    })
    .filter(Boolean) as CombatCreature[];

  const player = context.gameState.players.find(p => p.id === context.playerId);
  const playerLife = player?.life || 40;
  const totalAttackerDamage = attackerCreatures.reduce((sum, a) => sum + a.power, 0);
  let isLethalIfUnblocked = totalAttackerDamage >= playerLife;

  const commanderDamage = (context.gameState as any)?.commanderDamage?.[context.playerId] || {};
  for (const attacker of attackerCreatures) {
    const isCommander = attacker.permanent.isCommander || (attacker.permanent.card as any)?.zone === 'command';
    if (!isCommander) continue;

    const commanderKey = `${attacker.controllerId}-${attacker.name}`;
    const existingDamage = commanderDamage[commanderKey] || 0;
    const totalCommanderDamage = existingDamage + attacker.power;
    if (totalCommanderDamage >= 21) {
      isLethalIfUnblocked = true;
      console.log(
        `[AI] Commander damage lethal threat detected: ${attacker.name} would deal ${totalCommanderDamage} total commander damage (${existingDamage} existing + ${attacker.power} new)`
      );
      break;
    }
  }

  const sortedAttackers = [...attackerCreatures].sort((a, b) => {
    let aThreat = a.power + (a.keywords.trample ? 3 : 0) + (a.keywords.deathtouch ? 4 : 0) + (a.keywords.flying ? 2 : 0);
    let bThreat = b.power + (b.keywords.trample ? 3 : 0) + (b.keywords.deathtouch ? 4 : 0) + (b.keywords.flying ? 2 : 0);

    const aIsCommander = a.permanent.isCommander || (a.permanent.card as any)?.zone === 'command';
    const bIsCommander = b.permanent.isCommander || (b.permanent.card as any)?.zone === 'command';
    if (aIsCommander) aThreat += 10;
    if (bIsCommander) bThreat += 10;

    if (aIsCommander) {
      const aCommanderKey = `${a.controllerId}-${a.name}`;
      const aExistingDamage = commanderDamage[aCommanderKey] || 0;
      if (aExistingDamage + a.power >= 21) aThreat += 100;
    }
    if (bIsCommander) {
      const bCommanderKey = `${b.controllerId}-${b.name}`;
      const bExistingDamage = commanderDamage[bCommanderKey] || 0;
      if (bExistingDamage + b.power >= 21) bThreat += 100;
    }

    return bThreat - aThreat;
  });

  const blockAssignments: { blockerId: string; attackerId: string }[] = [];
  const blockerUsageCount = new Map<string, number>();
  let blockersWithDeathTriggers = 0;

  for (const attacker of sortedAttackers) {
    let bestBlocker: (typeof blockerEvaluations)[number] | null = null;
    let bestScore = -Infinity;

    for (const blockerEval of blockerEvaluations) {
      const currentAssignments = blockerUsageCount.get(blockerEval.creature.id) || 0;
      const blockerCapacity = getBlockerCapacity(blockerEval.perm);
      if (currentAssignments >= blockerCapacity) continue;

      const validation = canCreatureBlock(blockerEval.creature, attacker, []);
      if (!validation.legal) continue;

      let score = 0;
      const blockerSurvives = blockerEval.creature.toughness > attacker.power;
      const attackerDies = attacker.toughness <= blockerEval.creature.power || blockerEval.creature.keywords.deathtouch;
      const blockerDies = !blockerSurvives;

      if (blockerEval.wantsToGetKilled && blockerDies) {
        score += 50 + blockerEval.deathBenefit * 5;
      }
      if (blockerSurvives && attackerDies) {
        score += 30;
      }
      if (attackerDies && blockerDies && !blockerEval.wantsToGetKilled) {
        score += 15;
      }
      if (attacker.keywords.trample) {
        score += 20;
      }
      if (attacker.keywords.flying && blockerEval.creature.keywords.flying) {
        score += 10;
      }
      if (attacker.keywords.deathtouch) {
        score += 15;
      }
      if (isLethalIfUnblocked) {
        score += 100;
      } else if (attacker.power >= 4 && blockerDies && !attackerDies) {
        score += 10;
      }
      if (blockerDies && !blockerEval.wantsToGetKilled && !attackerDies && !isLethalIfUnblocked) {
        score -= blockerEval.baseValue * 2;
      }
      if (blockerDies && !isLethalIfUnblocked) {
        score -= blockerEval.preserveBias;
      }
      if (!blockerDies && blockerEval.attackBias > 0) {
        score += Math.min(6, blockerEval.attackBias / 2);
      }

      if (score > bestScore) {
        bestScore = score;
        bestBlocker = blockerEval;
      }
    }

    const minScoreThreshold = isLethalIfUnblocked ? -50 : 0;
    if (bestBlocker && bestScore >= minScoreThreshold) {
      blockAssignments.push({
        blockerId: bestBlocker.creature.id,
        attackerId: attacker.id,
      });
      blockerUsageCount.set(bestBlocker.creature.id, (blockerUsageCount.get(bestBlocker.creature.id) || 0) + 1);

      if (bestBlocker.wantsToGetKilled) {
        blockersWithDeathTriggers++;
      }
    }
  }

  let reasoning = `Blocking ${blockAssignments.length}/${sortedAttackers.length} attackers`;
  if (blockersWithDeathTriggers > 0) {
    reasoning += ` (${blockersWithDeathTriggers} with beneficial death triggers!)`;
  }

  return {
    type: AIDecisionType.DECLARE_BLOCKERS,
    playerId: context.playerId,
    action: { blockers: blockAssignments },
    reasoning,
    confidence: 0.8,
  };
}
