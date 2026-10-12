import type { BattlefieldPermanent } from '../../shared/src';
import { getLegalAttackers, getLegalBlockers, getGoadedAttackers, getGoadedAttackTargets } from './actions/combat';
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
import { playerIsLegalAttackTarget } from './playerInGameStatus';
import { planAIBlocks } from './aiEngineBlockPlanning';

type CombatDeckModifiers = { attackBias: number; preserveBias: number };
type CombatValueEvaluation = { combatValue: number; wantsToGetKilled: boolean; deathBenefit: number };

/** True when the defender has an untapped legal blocker that would kill this attacker. */
export function wouldDefenderLikelyBlockProfitably(
  attackerPerm: BattlefieldPermanent,
  defendingPlayerId: string,
  battlefield: readonly BattlefieldPermanent[],
): boolean {
  const attacker = createCombatCreature(attackerPerm, battlefield);
  const legalBlockerIds = getLegalBlockers(
    { battlefield } as any,
    defendingPlayerId,
    attacker.id,
  );

  for (const blockerId of legalBlockerIds) {
    const blockerPerm = battlefield.find((perm) => perm.id === blockerId);
    if (!blockerPerm || blockerPerm.tapped) continue;

    const blocker = createCombatCreature(blockerPerm, battlefield);
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
  return playerIsLegalAttackTarget(player, attackingPlayerId);
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
  const attacker = createCombatCreature(attackerPerm, battlefield);
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

  const attacker = createCombatCreature(attackerPerm, battlefield);
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

function isPermanentAttackingDefender(
  perm: any,
  defenderId: string,
  battlefield: readonly BattlefieldPermanent[],
): boolean {
  if (!perm || perm.controller === defenderId) return false;
  const explicitTargetPlayer = String(perm.targetPlayerId || perm.defendingPlayerId || '').trim();
  if (explicitTargetPlayer) return explicitTargetPlayer === defenderId;
  if (perm.attacking === true || perm.isAttacking === true) return true;
  const targetRef = String(perm.attacking || perm.targetPermanentId || '').trim();
  if (!targetRef) return false;
  if (targetRef === defenderId) return true;
  const targetPerm = battlefield.find((entry) => String(entry?.id || '') === targetRef);
  return Boolean(targetPerm && targetPerm.controller === defenderId);
}

function listAttackersForBlockDecision(
  context: AIDecisionContext,
  battlefield: readonly BattlefieldPermanent[],
): BattlefieldPermanent[] {
  const fromConstraints = Array.isArray(context.constraints?.attackers)
    ? context.constraints.attackers
    : [];
  const resolvedFromConstraints = fromConstraints
    .map((entry: any) => {
      if (!entry) return null;
      if (typeof entry === 'string') {
        return battlefield.find((perm) => perm.id === entry) || null;
      }
      const id = String(entry.id || '').trim();
      return (id ? battlefield.find((perm) => perm.id === id) : null) || entry;
    })
    .filter((perm: any) => perm && perm.controller !== context.playerId);

  if (resolvedFromConstraints.length > 0) {
    const aimedHere = resolvedFromConstraints.filter((perm: any) =>
      isPermanentAttackingDefender(perm, context.playerId, battlefield),
    ) as BattlefieldPermanent[];
    if (aimedHere.length > 0) return aimedHere;

    const aimedElsewhere = resolvedFromConstraints.some((perm: any) => {
      const targetRef = String(perm.attacking || perm.defendingPlayerId || perm.targetPlayerId || '').trim();
      return Boolean(targetRef) && targetRef !== 'true';
    });
    return aimedElsewhere ? [] : resolvedFromConstraints as BattlefieldPermanent[];
  }

  return battlefield.filter((perm) =>
    isPermanentAttackingDefender(perm, context.playerId, battlefield),
  );
}

function identicalAttackerEvalKey(perm: BattlefieldPermanent): string {
  const card = perm.card as { name?: string; type_line?: string } | undefined;
  const granted = ((perm as any).grantedAbilities || []).slice().sort().join('|');
  return [
    perm.controller,
    card?.name || '',
    perm.effectivePower ?? perm.basePower ?? '',
    perm.effectiveToughness ?? perm.baseToughness ?? '',
    perm.tapped ? 1 : 0,
    perm.summoningSickness ? 1 : 0,
    perm.isToken ? 1 : 0,
    (perm as any).isCommander ? 1 : 0,
    granted,
  ].join('\0');
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
  return playerIsLegalAttackTarget(player);
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
    playerIsLegalAttackTarget(candidate, context.playerId)
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
      const power = readPermanentPower(perm, context.gameState);
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
  const blockedEverywhereCache = new Map<string, boolean>();
  const smallAttackerBlockedEverywhere = (perm: BattlefieldPermanent) => {
    const key = identicalAttackerEvalKey(perm);
    const cached = blockedEverywhereCache.get(key);
    if (cached !== undefined) return cached;
    const blocked = isSmallVoluntaryAttacker(createCombatCreature(perm))
      && !attackerHasOpenLane(perm, opponents, globalBattlefield);
    blockedEverywhereCache.set(key, blocked);
    return blocked;
  };

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

  const attackingPermanents = listAttackersForBlockDecision(context, globalBattlefield);
  const attackerCreatures = attackingPermanents.map((perm) => createCombatCreature(perm, globalBattlefield));

  if (attackerCreatures.length === 0) {
    return {
      type: AIDecisionType.DECLARE_BLOCKERS,
      playerId: context.playerId,
      action: { blockers: [] },
      reasoning: 'No attackers to block',
      confidence: 1,
    };
  }

  const blockerEvaluations = blockerPermanents.map((perm: BattlefieldPermanent) => {
    const activeOpponents = context.gameState.players.filter((candidate: any) =>
      playerIsLegalAttackTarget(candidate, context.playerId)
    ).length;
    const evaluation = deps.evaluateCombatValue(perm, false, activeOpponents);
    const deckModifiers = deps.getCombatDeckModifiers(perm, config);
    return {
      perm,
      creature: createCombatCreature(perm, globalBattlefield),
      wantsToGetKilled: evaluation.wantsToGetKilled,
      deathBenefit: evaluation.deathBenefit,
      baseValue: deps.evaluatePermanentValue(perm),
      preserveBias: deckModifiers.preserveBias,
      attackBias: deckModifiers.attackBias,
    };
  });

  const { assignments: blockAssignments, deathTriggerBlocks: blockersWithDeathTriggers } =
    planAIBlocks(context, attackerCreatures, blockerEvaluations);

  let reasoning = `Blocking ${blockAssignments.length}/${attackerCreatures.length} attackers`;
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
