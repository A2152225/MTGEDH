import { debugWarn } from "../../utils/debug.js";

export type DayNight = 'day' | 'night';

function isDayNight(value: unknown): value is DayNight {
  return value === 'day' || value === 'night';
}

function transformPermanentToFace(permanent: any, faceIndex: 0 | 1): void {
  if (!permanent?.card) return;
  const card: any = permanent.card;
  const faces: any[] = Array.isArray(card.card_faces) ? card.card_faces : [];
  if (faces.length < 2) return;
  const newFace = faces[faceIndex];
  if (!newFace) return;

  (permanent as any).transformed = faceIndex === 1;

  card.name = newFace.name || card.name;
  if ('power' in newFace) card.power = newFace.power;
  if ('toughness' in newFace) card.toughness = newFace.toughness;
  if (newFace.type_line) card.type_line = newFace.type_line;
  if (newFace.oracle_text) card.oracle_text = newFace.oracle_text;
  if (newFace.image_uris) card.image_uris = newFace.image_uris;
  if ('loyalty' in newFace) card.loyalty = newFace.loyalty;
}

export function applyDayNightTransforms(state: any): void {
  if (!state?.battlefield) return;
  const dn: unknown = state.dayNight;
  if (!isDayNight(dn)) return;

  try {
    const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
    for (const perm of battlefield) {
      if (!perm?.card) continue;
      const card: any = perm.card;
      const layout = card.layout;
      const faces = card.card_faces;
      if ((layout !== 'transform' && layout !== 'double_faced_token') || !Array.isArray(faces) || faces.length < 2) {
        continue;
      }

      const oracle = String(card.oracle_text || '').toLowerCase();
      const isFrontFaceUp = !(perm as any).transformed;
      const isBackFaceUp = (perm as any).transformed === true;

      // Daybound (front face) transforms as it becomes night.
      if (dn === 'night' && isFrontFaceUp && oracle.includes('daybound')) {
        transformPermanentToFace(perm, 1);
        continue;
      }

      // Nightbound (back face) transforms as it becomes day.
      if (dn === 'day' && isBackFaceUp && oracle.includes('nightbound')) {
        transformPermanentToFace(perm, 0);
        continue;
      }
    }
  } catch (err) {
    debugWarn(1, '[day-night] Failed to apply day/night transforms:', err);
  }
}

export function setDayNightState(state: any, next: DayNight): void {
  if (!state) return;
  const prev = state.dayNight;
  if (prev === next) return;

  state.dayNight = next;

  // Legacy aliases used by older templates / intervening-if fallbacks.
  // Keep these deterministic and derived from authoritative `state.dayNight`.
  try {
    state.dayNightState = next;
    state.day_night = next;
    state.isDay = next === 'day';
    state.isNight = next === 'night';
  } catch {
    // best-effort only
  }
  state.dayNightChangedThisTurn = true;
  state.dayNightChangedFrom = prev;
  state.dayNightChangedTo = next;

  applyDayNightTransforms(state);
}

export function ensureInitialDayNightDesignationFromBattlefield(state: any): void {
  if (!state?.battlefield) return;
  const dn: unknown = state.dayNight;
  if (isDayNight(dn)) return;

  try {
    const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
    let hasDaybound = false;
    let hasNightbound = false;
    for (const perm of battlefield) {
      const oracle = String(perm?.card?.oracle_text || '').toLowerCase();
      if (!hasDaybound && oracle.includes('daybound')) hasDaybound = true;
      if (!hasNightbound && oracle.includes('nightbound')) hasNightbound = true;
      if (hasDaybound && hasNightbound) break;
    }

    if (hasDaybound) setDayNightState(state, 'day');
    else if (hasNightbound) setDayNightState(state, 'night');
  } catch (err) {
    debugWarn(1, '[day-night] Failed to ensure initial day/night designation:', err);
  }
}
