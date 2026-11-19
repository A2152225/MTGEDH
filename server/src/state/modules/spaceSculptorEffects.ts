/**
 * Sector-of-your-choice effects for space sculptor loyalty abilities.
 * Kept out of spaceSculptor.ts so state-based actions do not import counters.
 * Public: applySpaceSculptorSectorEffect
 */

import type { GameContext } from '../context.js';
import { isSpaceSculptorSector, type SpaceSculptorSector } from '../../../../rules-engine/src/spaceSculptor.js';
import { destroyPermanent, updateCounters } from './counters_tokens.js';

function isCreature(permanent: any): boolean {
  if (!permanent || permanent.phasedOut) return false;
  return /\bcreature\b/i.test(String(permanent?.card?.type_line || permanent?.type_line || ''));
}

function creaturesInSector(state: any, sector: SpaceSculptorSector): any[] {
  const assigned = state?.spaceSculptorSectors || {};
  return (Array.isArray(state?.battlefield) ? state.battlefield : []).filter((permanent: any) => {
    if (!isCreature(permanent)) return false;
    const id = String(permanent.id || '');
    return String(assigned[id] || permanent.sector || '') === sector;
  });
}

export function applySpaceSculptorSectorEffect(
  ctx: GameContext,
  step: any,
  selectedId: string,
): { ok: boolean; error?: string } {
  const sectorName = String(selectedId || '').trim().toLowerCase();
  if (!isSpaceSculptorSector(sectorName)) {
    return { ok: false, error: 'Choose alpha, beta, or gamma sector.' };
  }
  const state = (ctx as any).state;
  const effect = String(step?.spaceSculptorEffect || '');
  const targets = creaturesInSector(state, sectorName);
  if (effect === 'counters') {
    for (const permanent of targets) {
      updateCounters(ctx, String(permanent.id || ''), { '+1/+1': 1 });
    }
    return { ok: true };
  }
  if (effect === 'destroy') {
    for (const permanent of [...targets]) {
      destroyPermanent(ctx, String(permanent.id || ''), true);
    }
    return { ok: true };
  }
  return { ok: false, error: 'That sector choice has no effect.' };
}
