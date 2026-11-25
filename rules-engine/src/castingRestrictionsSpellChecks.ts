import type { BattlefieldPermanent, GameState } from '../../shared/src';
import { isCurrentlyCreature } from './actions/combat';
import { isAttackingPermanent } from './oracleIRExecutorCreatureStepUtils-handlers/oracleIRExecutorCreatureBattlefieldHelpers';
import { applyStaticAbilitiesToBattlefield } from './staticAbilities';
import type { SpellTimingRestriction } from './castingRestrictionsTypes';

const COMBAT_STEPS = ['begincombat', 'declareattackers', 'declareblockers', 'combatdamage', 'endcombat'] as const;
type CombatStep = typeof COMBAT_STEPS[number];

function normalizePhaseStep(value: unknown): string {
  return String(value || '').toLowerCase().replace(/[\s_]+/g, '');
}

function combatStepOf(phase: string, step: string): CombatStep | null {
  if ((COMBAT_STEPS as readonly string[]).includes(step)) return step as CombatStep;
  if ((COMBAT_STEPS as readonly string[]).includes(phase)) return phase as CombatStep;
  if (phase === 'combat') return 'begincombat';
  return null;
}

function combatStepIndex(step: CombatStep | null): number {
  return step ? COMBAT_STEPS.indexOf(step) : -1;
}

function isBeginningPhase(phase: string): boolean {
  return phase === 'beginning';
}

function isEndingPhase(phase: string): boolean {
  return phase === 'ending';
}

/** Live declareAttackers writes permanent.attacking = defending player or planeswalker id and often does not fill combat.attackers. */
function playerWasAttackedThisStep(gameState: any, playerId: string): boolean {
  const pid = String(playerId || '').trim();
  if (!pid) return false;
  const battlefield = Array.isArray(gameState?.battlefield) ? gameState.battlefield : [];
  const controlledIds = new Set(
    battlefield
      .filter((permanent: any) => String(permanent?.controller || '') === pid)
      .map((permanent: any) => String(permanent?.id || ''))
      .filter(Boolean),
  );
  const marksAttackOnPlayer = (raw: unknown): boolean => {
    const defender = String(raw || '').trim();
    return Boolean(defender) && (defender === pid || controlledIds.has(defender));
  };
  const defenderFromPermanent = (permanent: any): string =>
    String(permanent?.attacking || permanent?.attackingPlayerId || permanent?.defendingPlayerId || '').trim();

  for (const entry of gameState?.combat?.attackers || []) {
    if (typeof entry === 'string') {
      const permanent = battlefield.find((item: any) => String(item?.id || '') === entry);
      if (permanent && marksAttackOnPlayer(defenderFromPermanent(permanent))) return true;
      continue;
    }
    if (marksAttackOnPlayer(entry?.defendingPlayerId || entry?.defending || entry?.targetPlayerId)) return true;
    const permanentId = String(entry?.permanentId || entry?.cardId || entry?.id || '').trim();
    const permanent = battlefield.find((item: any) => String(item?.id || '') === permanentId);
    if (permanent && marksAttackOnPlayer(defenderFromPermanent(permanent))) return true;
  }

  return battlefield.some((permanent: any) => marksAttackOnPlayer(defenderFromPermanent(permanent)));
}

/**
 * Check timing restrictions from a card's oracle text
 */
export function checkSpellTimingRestriction(
  oracleText: string,
  currentPlayerId: string,
  activePlayerId: string,
  gameState?: GameState
): SpellTimingRestriction {
  const text = (oracleText || '').toLowerCase();
  const phase = normalizePhaseStep(gameState?.phase);
  const step = normalizePhaseStep((gameState as any)?.step);
  const combatStep = combatStepOf(phase, step);
  const isCombat = combatStep != null;
  const isOwnTurn = currentPlayerId === activePlayerId;
  const allow = (extra: Partial<SpellTimingRestriction> = {}): SpellTimingRestriction => ({ canCast: true, ...extra });
  const deny = (reason: string, extra: Partial<SpellTimingRestriction> = {}): SpellTimingRestriction => ({ canCast: false, reason, ...extra });

  if (/cast this spell only during the declare attackers step and only if you(?:'|\u2019)?ve been attacked this step/.test(text)) {
    const isDeclareAttackersStep = combatStep === 'declareattackers';
    if (!isDeclareAttackersStep) {
      return deny('This spell can only be cast during the declare attackers step');
    }

    const wasAttackedThisStep = playerWasAttackedThisStep(gameState, currentPlayerId);
    if (!wasAttackedThisStep) {
      return deny('You must have been attacked this step to cast this spell');
    }

    return allow();
  }

  if (/\bcast this spell only during the declare blockers step on an opponent'?s turn\b/.test(text)) {
    if (isOwnTurn || combatStep !== 'declareblockers') {
      return deny("This spell can only be cast during the declare blockers step on an opponent's turn");
    }
    return allow();
  }

  if (/\bcast this spell only during your declare attackers step\b/.test(text)) {
    if (!isOwnTurn || combatStep !== 'declareattackers') {
      return deny('This spell can only be cast during your declare attackers step');
    }
    return allow();
  }

  if (/\bcast this spell only during the declare attackers step\b/.test(text)) {
    if (combatStep !== 'declareattackers') {
      return deny('This spell can only be cast during the declare attackers step');
    }
    return allow();
  }

  if (/\bcast this spell only during the declare blockers step\b/.test(text)) {
    if (combatStep !== 'declareblockers') {
      return deny('This spell can only be cast during the declare blockers step');
    }
    return allow();
  }

  if (/\bcast this spell only during combat on (?:an opponent'?s|your) turn before blockers are declared\b/.test(text)
    || /\bcast this spell only during combat before blockers are declared\b/.test(text)) {
    const requiresOpponent = /on an opponent'?s turn/.test(text);
    const requiresOwn = /on your turn/.test(text);
    const beforeBlockers = isCombat && combatStepIndex(combatStep) >= 0 && combatStepIndex(combatStep) < COMBAT_STEPS.indexOf('declareblockers');
    if (!beforeBlockers || (requiresOpponent && isOwnTurn) || (requiresOwn && !isOwnTurn)) {
      return deny('This spell can only be cast during combat before blockers are declared');
    }
    return allow();
  }

  if (/\bcast this spell only during combat after blockers are declared\b/.test(text)) {
    if (!isCombat || combatStepIndex(combatStep) < COMBAT_STEPS.indexOf('declareblockers')) {
      return deny('This spell can only be cast during combat after blockers are declared');
    }
    return allow();
  }

  if (/\bcast this spell only during combat on an opponent'?s turn\b/.test(text)) {
    if (!isCombat || isOwnTurn) {
      return deny("This spell can only be cast during combat on an opponent's turn");
    }
    return allow({ requiresOpponentsTurn: true });
  }

  if (/\bcast this spell only during combat on your turn\b/.test(text)) {
    if (!isCombat || !isOwnTurn) {
      return deny('This spell can only be cast during combat on your turn');
    }
    return allow({ requiresOwnTurn: true });
  }

  if (/\bcast this spell only during combat\b/.test(text) || /\bcast only during combat\b/.test(text)) {
    if (!isCombat) {
      return deny('This spell can only be cast during combat');
    }
    return allow();
  }

  if (/\bcast this spell only before combat or during combat before blockers are declared\b/.test(text)) {
    const beforeBlockersInCombat = isCombat && combatStepIndex(combatStep) >= 0 && combatStepIndex(combatStep) < COMBAT_STEPS.indexOf('declareblockers');
    const beforeCombat = !isCombat && !isEndingPhase(phase) && phase !== 'postcombatmain';
    if (!beforeCombat && !beforeBlockersInCombat) {
      return deny('This spell can only be cast before combat or during combat before blockers are declared');
    }
    return allow();
  }

  if (/\bcast this spell only during an opponent'?s turn,\s*before attackers are declared\b/.test(text)) {
    const beforeAttackers = !isCombat || combatStep === 'begincombat';
    if (isOwnTurn || !beforeAttackers) {
      return deny("This spell can only be cast during an opponent's turn, before attackers are declared");
    }
    return allow({ requiresOpponentsTurn: true });
  }

  if (/\bcast this spell only during an opponent'?s turn after their upkeep step\b/.test(text)) {
    const stillInOrBeforeUpkeep = isBeginningPhase(phase) && (step === 'untap' || step === 'upkeep' || step === '');
    if (isOwnTurn || stillInOrBeforeUpkeep) {
      return deny("This spell can only be cast during an opponent's turn after their upkeep step");
    }
    return allow({ requiresOpponentsTurn: true });
  }

  if (/\bcast this spell only during an opponent'?s upkeep\b/.test(text)) {
    if (isOwnTurn || !isBeginningPhase(phase) || step !== 'upkeep') {
      return deny("This spell can only be cast during an opponent's upkeep");
    }
    return allow({ requiresOpponentsTurn: true });
  }

  if (text.includes("cast this spell only during an opponent's turn") ||
      text.includes("cast only during an opponent's turn")) {
    if (isOwnTurn) {
      return deny("This spell can only be cast during an opponent's turn", { requiresOpponentsTurn: true });
    }
    return allow({ requiresOpponentsTurn: true });
  }

  if (/\bcast this spell only during your end step\b/.test(text)) {
    if (!isOwnTurn || !isEndingPhase(phase) || (step && step !== 'endstep' && step !== 'end')) {
      return deny('This spell can only be cast during your end step');
    }
    return allow({ requiresOwnTurn: true });
  }

  if (text.includes('cast this spell only during your turn') ||
      text.includes('cast only during your turn')) {
    if (!isOwnTurn) {
      return deny('This spell can only be cast during your turn', { requiresOwnTurn: true });
    }
    return allow({ requiresOwnTurn: true });
  }

  if (/\bcast this spell only before the combat damage step\b/.test(text)) {
    if (isCombat && combatStepIndex(combatStep) >= COMBAT_STEPS.indexOf('combatdamage')) {
      return deny('This spell can only be cast before the combat damage step');
    }
    return allow();
  }

  if (/\bcast this spell only before blockers are declared\b/.test(text) ||
      text.includes('cast only before blockers')) {
    if (isCombat && combatStepIndex(combatStep) >= COMBAT_STEPS.indexOf('declareblockers')) {
      return deny('This spell can only be cast before blockers are declared');
    }
    return allow();
  }

  if (text.includes('cast this spell only before attackers are declared') ||
      text.includes('cast only before attackers')) {
    if (isCombat && combatStep !== 'begincombat') {
      return deny('This spell can only be cast before attackers are declared');
    }
    return allow();
  }

  if (/\bcast this spell only after combat\b/.test(text)) {
    const afterCombat = phase === 'postcombatmain' || isEndingPhase(phase);
    if (!afterCombat) {
      return deny('This spell can only be cast after combat');
    }
    return allow();
  }

  return allow();
}

/**
 * Check if a spell requires specific targets and if those targets exist
 */
export function hasValidTargetsForSpell(
  oracleText: string,
  gameState: GameState,
  currentPlayerId: string
): { hasTargets: boolean; reason?: string } {
  const text = (oracleText || '').toLowerCase();
  const battlefield = getProcessedBattlefield(gameState);

  if (text.includes('cast this spell only during an opponent\'s turn') &&
      text.includes('target creature that player controls')) {
    const activePlayerId = gameState.turnPlayer || gameState.players[gameState.activePlayerIndex || 0]?.id;
    const opponentCreatures = battlefield.filter(perm => isCurrentlyCreature(perm) && perm.controller === activePlayerId);

    if (opponentCreatures.length === 0) {
      return {
        hasTargets: false,
        reason: 'The opponent whose turn it is controls no creatures',
      };
    }

    return { hasTargets: true };
  }

  if (text.includes('target creature')) {
    const creatures = battlefield.filter(perm => isCurrentlyCreature(perm));
    if (creatures.length === 0) {
      return {
        hasTargets: false,
        reason: 'No creatures on the battlefield',
      };
    }
  }

  if (text.includes('attacking creature') || text.includes('sacrifices an attacking creature')) {
    const phase = (gameState.phase || '').toString().toLowerCase();
    const step = (gameState.step || '').toString().toLowerCase();
    const isCombat = phase.includes('combat') || step.includes('attack') || step.includes('block') || step.includes('damage');

    if (!isCombat) {
      return {
        hasTargets: false,
        reason: 'Can only be cast during combat (requires attacking creatures)',
      };
    }

    const attackingCreatures = battlefield.filter(perm => {
      return isCurrentlyCreature(perm) && isAttackingPermanent(perm);
    });

    if (attackingCreatures.length === 0) {
      return {
        hasTargets: false,
        reason: 'No attacking creatures on the battlefield',
      };
    }
  }

  if (text.includes('target opponent')) {
    const opponents = gameState.players.filter(p => p.id !== currentPlayerId);
    if (opponents.length === 0) {
      return {
        hasTargets: false,
        reason: 'No opponents',
      };
    }
  }

  return { hasTargets: true };
}

function getProcessedBattlefield(gameState: GameState): BattlefieldPermanent[] {
  return applyStaticAbilitiesToBattlefield(
    (gameState.battlefield || []) as BattlefieldPermanent[]
  ) as BattlefieldPermanent[];
}
