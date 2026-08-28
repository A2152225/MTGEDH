// server/src/state/modules/turn-handlers/turnExpiredUntilNextTurnEffects.ts
// Origin parent: server/src/state/modules/turn.ts
// Cluster moved: removeExpiredUntilNextTurnEffects.
// Public entry symbols: removeExpiredUntilNextTurnEffects.
// Passed into runNextTurnStartOfTurn from nextTurn(). Leaf must not
// import turn.ts or turn-handlers/index.ts.

import type { GameContext } from "../../context.js";
import type { PlayerID } from "../../../../../shared/src/types.js";

function isUntilNextTurnGrantEntry(entry: any): boolean {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
  const duration = String(entry.duration || '').trim();
  if (duration === 'until_next_turn' || duration === 'until_your_next_turn') return true;
  if (String(entry.expiresOnControllerTurn || '').trim()) return true;
  return false;
}

function filterUntilNextTurnGrantBag(holder: any, fieldName: string, isExpiredGrant: (entry: any) => boolean): void {
  const entries = holder?.[fieldName];
  if (!Array.isArray(entries) || entries.length === 0) return;
  const next = entries.filter((entry: any) => !isExpiredGrant(entry));
  if (next.length > 0) {
    holder[fieldName] = next;
  } else {
    delete holder[fieldName];
  }
}

export function removeExpiredUntilNextTurnEffects(ctx: GameContext, currentPlayerId: PlayerID, currentTurn: number): void {
  const stateAny = (ctx as any).state as any;
  const battlefield = Array.isArray(stateAny?.battlefield) ? stateAny.battlefield : [];

  const isExpired = (entry: any) => {
    const controllerId = String(entry?.controllerId || '').trim();
    const turnApplied = Number(entry?.turnApplied ?? 0) || 0;
    return controllerId === String(currentPlayerId) && turnApplied < currentTurn;
  };

  const isExpiredUntilNextTurnGrant = (entry: any) => {
    if (!isUntilNextTurnGrantEntry(entry)) return false;
    const controllerId = String(entry?.controllerId || entry?.expiresOnControllerTurn || '').trim();
    const turnApplied = Number(entry?.turnApplied ?? 0) || 0;
    return controllerId === String(currentPlayerId) && turnApplied < currentTurn;
  };

  for (const permanent of battlefield) {
    if (!permanent) continue;

    if (Array.isArray((permanent as any).untilNextTurnGrants) && (permanent as any).untilNextTurnGrants.length > 0) {
      const activeEntries = ((permanent as any).untilNextTurnGrants as any[]).filter((entry) => !isExpired(entry));
      const expiredEntries = ((permanent as any).untilNextTurnGrants as any[]).filter((entry) => isExpired(entry));

      if (expiredEntries.length > 0 && Array.isArray((permanent as any).grantedAbilities)) {
        const remainingGrantTexts = new Set(
          activeEntries.flatMap((entry) => Array.isArray(entry?.grantedAbilities) ? entry.grantedAbilities.map((ability: any) => String(ability)) : [])
        );

        (permanent as any).grantedAbilities = ((permanent as any).grantedAbilities as any[]).filter((ability: any) => {
          const abilityText = String(ability);
          const expiredGrant = expiredEntries.some((entry) => Array.isArray(entry?.grantedAbilities) && entry.grantedAbilities.some((grantedAbility: any) => String(grantedAbility) === abilityText));
          return !expiredGrant || remainingGrantTexts.has(abilityText);
        });

        if ((permanent as any).grantedAbilities.length === 0) {
          delete (permanent as any).grantedAbilities;
        }
      }

      if (activeEntries.length > 0) {
        (permanent as any).untilNextTurnGrants = activeEntries;
      } else {
        delete (permanent as any).untilNextTurnGrants;
      }
    }

    for (const fieldName of ['untilNextTurnCantActivateAbilities', 'untilNextTurnLoseAllAbilities']) {
      const entries = (permanent as any)[fieldName];
      if (!Array.isArray(entries) || entries.length === 0) continue;
      const activeEntries = entries.filter((entry: any) => !isExpired(entry));
      if (activeEntries.length > 0) {
        (permanent as any)[fieldName] = activeEntries;
      } else {
        delete (permanent as any)[fieldName];
      }
    }

    for (const fieldName of ['staticAbilityGrantEffects', 'temporaryEffects', 'temporaryAbilities', 'grantedAbilities']) {
      filterUntilNextTurnGrantBag(permanent, fieldName, isExpiredUntilNextTurnGrant);
    }
  }

  if (Array.isArray(stateAny?.untilNextTurnSpellNameCastRestrictions)) {
    stateAny.untilNextTurnSpellNameCastRestrictions = stateAny.untilNextTurnSpellNameCastRestrictions.filter((entry: any) => !isExpired(entry));
    if (stateAny.untilNextTurnSpellNameCastRestrictions.length === 0) {
      delete stateAny.untilNextTurnSpellNameCastRestrictions;
    }
  }

  filterUntilNextTurnGrantBag(stateAny, 'staticAbilityGrantEffects', isExpiredUntilNextTurnGrant);
  filterUntilNextTurnGrantBag(stateAny, 'lastingEffects', isExpiredUntilNextTurnGrant);

  for (const player of Array.isArray(stateAny?.players) ? stateAny.players : []) {
    if (!player || typeof player !== 'object') continue;
    for (const fieldName of ['temporaryEffects', 'temporaryAbilities', 'grantedAbilities']) {
      filterUntilNextTurnGrantBag(player, fieldName, isExpiredUntilNextTurnGrant);
    }
  }
}
