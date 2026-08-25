/**
 * Origin: server/src/state/modules/triggers/intervening-if.ts
 * Cluster: countControlledEnteredThisTurn
 * Public: countControlledEnteredThisTurn
 */

import type { GameContext } from "../context.js";
import { findBattlefieldPermanent } from "./intervening-if-zone-lookups.js";
import {
  getLandsEnteredBattlefieldThisTurn,
  getArtifactsEnteredBattlefieldThisTurn,
  getEnchantmentsEnteredBattlefieldThisTurn,
  getPlaneswalkersEnteredBattlefieldThisTurn,
  getBattlesEnteredBattlefieldThisTurn,
  getCreaturesEnteredBattlefieldThisTurn,
} from "./intervening-if-this-turn-counts.js";

function countControlledEnteredThisTurn(ctx: GameContext, controllerId: string, typeLower: string, excludeId?: string): number | null {
  // Deterministic tracking when available. If the per-turn tracking map is missing (older game state),
  // fall through to the best-effort battlefield scan to avoid false negatives.
  if (typeLower === 'land') {
    const map = (ctx as any).state?.landsEnteredBattlefieldThisTurn;
    if (map && typeof map === 'object') {
      const n = getLandsEnteredBattlefieldThisTurn(ctx, controllerId);
      if (!excludeId) return n;
      if (n === 0) return 0;

      // For "another land" templates, exclude the source permanent if it is itself a land that entered this turn.
      // If there was exactly one land entry and we can't confirm whether it was the source land, stay conservative.
      if (n === 1) {
        const source = findBattlefieldPermanent(ctx, excludeId);
        if (source && String(source.controller || '') === String(controllerId)) {
          const tl = String(source.card?.type_line || '').toLowerCase();
          if (tl.includes('land')) {
            if (source.enteredThisTurn === true) return 0;
            if (source.enteredThisTurn === false) return 1;
            return null;
          }
        }
        return 1;
      }

      const source = findBattlefieldPermanent(ctx, excludeId);
      if (source && String(source.controller || '') === String(controllerId)) {
        const tl = String(source.card?.type_line || '').toLowerCase();
        if (tl.includes('land') && source.enteredThisTurn === true) {
          return Math.max(0, n - 1);
        }
      }
      return n;
    }
  }

  if (typeLower === 'creature') {
    const map = (ctx as any).state?.creaturesEnteredBattlefieldThisTurnByController;
    if (map && typeof map === 'object') {
      const n = getCreaturesEnteredBattlefieldThisTurn(ctx, controllerId);
      if (!excludeId) return n;
      if (n === 0) return 0;

      // For "another creature" templates, exclude the source permanent if it is itself a creature that entered this turn.
      // Prefer deterministic id-tracking if available.
      const idsByController = (ctx as any).state?.creaturesEnteredBattlefieldThisTurnIdsByController;
      const key = String(controllerId);
      const idsForController = idsByController && typeof idsByController === 'object' ? idsByController[key] : null;
      if (idsForController && typeof idsForController === 'object') {
        if ((idsForController as any)[String(excludeId)] === true) {
          return Math.max(0, n - 1);
        }
        return n;
      }

      if (n === 1) {
        const source = findBattlefieldPermanent(ctx, excludeId);
        if (source && String(source.controller || '') === String(controllerId)) {
          const tl = String(source.card?.type_line || '').toLowerCase();
          if (tl.includes('creature')) {
            if (source.enteredThisTurn === true) return 0;
            if (source.enteredThisTurn === false) return 1;
            return null;
          }
        }
        return 1;
      }

      const source = findBattlefieldPermanent(ctx, excludeId);
      if (source && String(source.controller || '') === String(controllerId)) {
        const tl = String(source.card?.type_line || '').toLowerCase();
        if (tl.includes('creature') && source.enteredThisTurn === true) {
          return Math.max(0, n - 1);
        }
      }

      return n;
    }
  }

  if (typeLower === 'artifact') {
    const map = (ctx as any).state?.artifactsEnteredBattlefieldThisTurnByController;
    if (map && typeof map === 'object') {
      const n = getArtifactsEnteredBattlefieldThisTurn(ctx, controllerId);
      if (!excludeId) return n;
      if (n === 0) return 0;

      // Prefer deterministic id-tracking if available.
      const idsByController = (ctx as any).state?.artifactsEnteredBattlefieldThisTurnIdsByController;
      const key = String(controllerId);
      const idsForController = idsByController && typeof idsByController === 'object' ? idsByController[key] : null;
      if (idsForController && typeof idsForController === 'object') {
        if ((idsForController as any)[String(excludeId)] === true) {
          return Math.max(0, n - 1);
        }
        return n;
      }

      // Conservative fallback: without id-tracking, "another" with exactly 1 is ambiguous.
      if (n >= 2) return 1;
      return null;
    }
  }

  if (typeLower === 'enchantment') {
    const map = (ctx as any).state?.enchantmentsEnteredBattlefieldThisTurnByController;
    if (map && typeof map === 'object') {
      const n = getEnchantmentsEnteredBattlefieldThisTurn(ctx, controllerId);
      if (!excludeId) return n;
      if (n === 0) return 0;

      const idsByController = (ctx as any).state?.enchantmentsEnteredBattlefieldThisTurnIdsByController;
      const key = String(controllerId);
      const idsForController = idsByController && typeof idsByController === 'object' ? idsByController[key] : null;
      if (idsForController && typeof idsForController === 'object') {
        if ((idsForController as any)[String(excludeId)] === true) {
          return Math.max(0, n - 1);
        }
        return n;
      }

      if (n >= 2) return 1;
      return null;
    }
  }

  if (typeLower === 'planeswalker') {
    const map = (ctx as any).state?.planeswalkersEnteredBattlefieldThisTurnByController;
    if (map && typeof map === 'object') {
      const n = getPlaneswalkersEnteredBattlefieldThisTurn(ctx, controllerId);
      if (!excludeId) return n;
      if (n === 0) return 0;

      const idsByController = (ctx as any).state?.planeswalkersEnteredBattlefieldThisTurnIdsByController;
      const key = String(controllerId);
      const idsForController = idsByController && typeof idsByController === 'object' ? idsByController[key] : null;
      if (idsForController && typeof idsForController === 'object') {
        if ((idsForController as any)[String(excludeId)] === true) {
          return Math.max(0, n - 1);
        }
        return n;
      }

      if (n >= 2) return 1;
      return null;
    }
  }

  if (typeLower === 'battle') {
    const map = (ctx as any).state?.battlesEnteredBattlefieldThisTurnByController;
    if (map && typeof map === 'object') {
      const n = getBattlesEnteredBattlefieldThisTurn(ctx, controllerId);
      if (!excludeId) return n;
      if (n === 0) return 0;

      const idsByController = (ctx as any).state?.battlesEnteredBattlefieldThisTurnIdsByController;
      const key = String(controllerId);
      const idsForController = idsByController && typeof idsByController === 'object' ? idsByController[key] : null;
      if (idsForController && typeof idsForController === 'object') {
        if ((idsForController as any)[String(excludeId)] === true) {
          return Math.max(0, n - 1);
        }
        return n;
      }

      if (n >= 2) return 1;
      return null;
    }
  }

  // Best-effort battlefield scan. If we have no evidence of entered-this-turn tracking,
  // return null to avoid false negatives that would suppress triggers.
  const battlefield = (ctx as any).state?.battlefield || [];
  if (!Array.isArray(battlefield)) return null;
  const hasEnteredTracking = battlefield.some((p: any) => p?.enteredThisTurn === true);
  if (!hasEnteredTracking) return null;

  return battlefield.filter((p: any) => {
    if (!p) return false;
    if (excludeId && String(p.id || '') === String(excludeId)) return false;
    if (String(p.controller || '') !== String(controllerId)) return false;
    if (p.enteredThisTurn !== true) return false;
    const tl = String(p.card?.type_line || '').toLowerCase();
    return tl.includes(typeLower);
  }).length;
}

export { countControlledEnteredThisTurn };
