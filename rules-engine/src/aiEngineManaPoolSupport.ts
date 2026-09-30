import type { BattlefieldPermanent, GameState, PlayerID } from '../../shared/src';
import { getLegalAttackers } from './actions/combat';
import { readCurrentPowerFromHook } from './currentPowerToughnessHook';
import { applyStaticAbilitiesToBattlefield } from './staticAbilities';

/**
 * Power of a permanent for AI evaluation. With a game state, a battlefield permanent reads its current
 * power (anthems, pumps, set-base effects, counters): the server's shared calculation when registered,
 * otherwise the rules-engine static-ability pass. Without a state, or for objects that are not on the
 * battlefield, it keeps reading the recorded/printed values as before.
 */
export function readPermanentPower(perm: BattlefieldPermanent, gameState?: GameState): number {
  if (gameState && Array.isArray(gameState.battlefield)) {
    const permanentId = String((perm as any)?.id || '').trim();
    if (permanentId && gameState.battlefield.some((entry) => String((entry as any)?.id || '').trim() === permanentId)) {
      const hooked = readCurrentPowerFromHook(gameState, perm);
      if (hooked !== null) return Math.max(0, hooked);
      try {
        const processed = applyStaticAbilitiesToBattlefield(gameState.battlefield as BattlefieldPermanent[], gameState)
          .find((entry) => String((entry as any)?.id || '').trim() === permanentId);
        const effective = Number((processed as any)?.effectivePower);
        if (Number.isFinite(effective)) return Math.max(0, effective);
      } catch {
        // fall through to the recorded values
      }
    }
  }
  const raw =
    (perm as any).effectivePower
    ?? (perm as any).power
    ?? (perm as any).basePower
    ?? (perm.card as { power?: string | number })?.power
    ?? 0;
  const parsed = Number.parseInt(String(raw).replace(/\D.*$/, ''), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function battlefieldHasManaRetention(
  battlefield: readonly BattlefieldPermanent[],
  playerId: PlayerID,
): boolean {
  for (const perm of battlefield) {
    if (perm.controller !== playerId) continue;
    const oracle = String((perm.card as { oracle_text?: string })?.oracle_text || '').toLowerCase();
    const name = String((perm.card as { name?: string })?.name || '').toLowerCase();
    if (
      /don't lose unspent (?:green |red )?mana|doesn't empty|mana pools? do(?:n't| not) empty|mana becomes colorless instead/i.test(oracle)
    ) {
      return true;
    }
    if (/omnath, locus of mana|leyline tyrant|kruphix|horizon stone|upwelling/i.test(name)) {
      return true;
    }
  }
  return false;
}

export function isPowerScaledGreenManaAbilityText(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    /add an amount of \{g\}/i.test(lower)
    || /add \{g\} equal to/i.test(lower)
    || (lower.includes('greatest power') && lower.includes('among creatures') && lower.includes('add'))
  );
}

export function isAttackManaRetentionEquipmentText(oracle: string): boolean {
  const lower = oracle.toLowerCase();
  // Tanuki: attack mana won't empty at step/phase boundaries until EOT.
  // With Omnath, that green then persists for the whole turn like any other green in the pool.
  return (
    /whenever .*(?:attacks|attack)/i.test(lower)
    && /add an amount of \{g\}|add \{g\}/i.test(lower)
    && (
      /don't lose.*mana|unspent mana|until end of turn/i.test(lower)
      || /equal to (?:its|this creature's|equipped creature's|~'s) power/i.test(lower)
    )
  );
}

export function isOmnathGreenManaRetentionCreature(perm: BattlefieldPermanent): boolean {
  const oracle = String((perm.card as { oracle_text?: string })?.oracle_text || '').toLowerCase();
  const typeLine = String((perm.card as { type_line?: string })?.type_line || '').toLowerCase();
  if (!typeLine.includes('creature')) return false;
  return oracle.includes('unspent green mana') && /don't lose|doesn't empty/i.test(oracle);
}

export function findOmnathGreenManaRetentionCreature(
  battlefield: readonly BattlefieldPermanent[],
  playerId: PlayerID,
  legalAttackerIds: ReadonlySet<string>,
): BattlefieldPermanent | null {
  for (const perm of battlefield) {
    if (perm.controller !== playerId) continue;
    if (!legalAttackerIds.has(String(perm.id || ''))) continue;
    if (isOmnathGreenManaRetentionCreature(perm)) {
      return perm;
    }
  }
  return null;
}

export function getGreatestAttackableCreaturePower(
  gameState: GameState,
  playerId: PlayerID,
): number {
  const battlefield = Array.isArray(gameState.battlefield) ? gameState.battlefield : [];
  const legalAttackerIds = new Set(getLegalAttackers(gameState, playerId));
  let best = 0;

  for (const perm of battlefield) {
    if (!legalAttackerIds.has(String(perm.id || ''))) continue;
    best = Math.max(best, readPermanentPower(perm, gameState));
  }

  return best;
}

export function scoreAttackManaEngineReconfigureTarget(
  gameState: GameState,
  playerId: PlayerID,
  permanent: BattlefieldPermanent,
  readPower: (perm: BattlefieldPermanent) => number = (perm) => readPermanentPower(perm, gameState),
): number {
  const legalAttackerIds = new Set(getLegalAttackers(gameState, playerId));
  const permanentId = String(permanent.id || '');
  if (!permanentId || !legalAttackerIds.has(permanentId)) {
    return -9999;
  }

  const battlefield = Array.isArray(gameState.battlefield) ? gameState.battlefield : [];
  const power = readPower(permanent);
  const omnath = findOmnathGreenManaRetentionCreature(battlefield, playerId, legalAttackerIds);

  if (omnath) {
    const omnathId = String(omnath.id || '');
    const omnathPower = readPower(omnath);
    const hasStrongerAttacker = battlefield.some((entry) => {
      const entryId = String(entry.id || '');
      return entry.controller === playerId
        && legalAttackerIds.has(entryId)
        && entryId !== omnathId
        && readPower(entry) > omnathPower;
    });

    if (permanentId === omnathId) {
      return hasStrongerAttacker ? omnathPower * 5 : 10_000 + omnathPower;
    }
    if (power > omnathPower) {
      return 10_001 + power * 5;
    }
    return power * 5;
  }

  return power * 5;
}

export function findBestAttackManaEngineReconfigureTarget(
  gameState: GameState,
  playerId: PlayerID,
  readPower: (perm: BattlefieldPermanent) => number = (perm) => readPermanentPower(perm, gameState),
): BattlefieldPermanent | null {
  const battlefield = Array.isArray(gameState.battlefield) ? gameState.battlefield : [];
  let bestTarget: BattlefieldPermanent | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const perm of battlefield) {
    const score = scoreAttackManaEngineReconfigureTarget(gameState, playerId, perm, readPower);
    if (score > bestScore) {
      bestScore = score;
      bestTarget = perm;
    }
  }

  return bestTarget;
}

/** One {3} reconfigure attach moves Tanuki directly (creature→creature, or onto a host). */
export function evaluateAttackManaEngineReconfigureAttachValue(
  gameState: GameState,
  playerId: PlayerID,
  equipment: BattlefieldPermanent,
  readPower: (perm: BattlefieldPermanent) => number = (perm) => readPermanentPower(perm, gameState),
): number {
  const equipOracle = String((equipment.card as { oracle_text?: string })?.oracle_text || '');
  if (!isAttackManaRetentionEquipmentText(equipOracle)) {
    return 0;
  }

  const battlefield = Array.isArray(gameState.battlefield) ? gameState.battlefield : [];
  const bestTarget = findBestAttackManaEngineReconfigureTarget(gameState, playerId, readPower);
  if (!bestTarget) {
    return 0;
  }

  const bestPower = readPower(bestTarget);
  const bestTargetId = String(bestTarget.id || '');
  const attachedToId = String((equipment as any).attachedTo || '').trim();
  const reconfigureCostPenalty = 2;

  if (attachedToId) {
    if (attachedToId === bestTargetId) {
      return 0;
    }
    const currentHost = battlefield.find((entry) => String(entry.id || '') === attachedToId);
    const currentPower = currentHost ? readPower(currentHost) : 0;
    const powerGain = bestPower - currentPower;
    if (powerGain <= 0) {
      return 0;
    }

    let value = 20 + powerGain * 10;
    if (battlefieldHasManaRetention(battlefield, playerId)) {
      value += 12 + Math.min(24, powerGain * 3);
    }
    return Math.max(0, value - reconfigureCostPenalty);
  }

  let value = 24 + Math.min(44, bestPower * 2);
  if (battlefieldHasManaRetention(battlefield, playerId)) {
    value += 14;
  }
  return Math.max(0, value - reconfigureCostPenalty);
}

export function getGreatestControlledCreaturePower(
  battlefield: readonly BattlefieldPermanent[],
  playerId: PlayerID,
  gameState?: GameState,
): number {
  let best = 0;
  for (const perm of battlefield) {
    if (perm.controller !== playerId) continue;
    const typeLine = String((perm.card as { type_line?: string })?.type_line || '').toLowerCase();
    if (!typeLine.includes('creature')) continue;
    best = Math.max(best, readPermanentPower(perm, gameState));
  }
  return best;
}

export function getPlayerGreenManaInPool(gameState: GameState, playerId: PlayerID): number {
  const poolRecord = (gameState as { manaPool?: Record<string, { green?: number }> }).manaPool;
  const fromRecord = poolRecord?.[playerId]?.green;
  if (typeof fromRecord === 'number') return fromRecord;

  const player = gameState.players?.find((entry) => entry.id === playerId) as { manaPool?: { green?: number } } | undefined;
  return Number(player?.manaPool?.green || 0);
}

export function findAttackManaRetentionEquipmentAttachedTo(
  battlefield: readonly BattlefieldPermanent[],
  creatureId: string,
): BattlefieldPermanent | null {
  for (const perm of battlefield) {
    if (String((perm as any).attachedTo || '') !== creatureId) continue;
    const oracle = String((perm.card as { oracle_text?: string })?.oracle_text || '');
    if (isAttackManaRetentionEquipmentText(oracle)) {
      return perm;
    }
  }
  return null;
}
