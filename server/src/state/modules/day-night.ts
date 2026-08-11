import { debugWarn } from "../../utils/debug.js";
import type { GameContext } from "../context.js";
import { processTransformTriggers } from "./triggerEmissionFamilyUtils.js";
import { uid } from "../utils.js";

export type DayNight = 'day' | 'night';

function isDayNight(value: unknown): value is DayNight {
  return value === 'day' || value === 'night';
}

/**
 * "As this creature transforms into NAME, you get an emblem with \"…\"."
 * Applies when transforming onto the face that prints that replacement text.
 */
function createEmblemFromTransformIntoFace(
  ctx: GameContext | undefined,
  permanent: any,
  newFace: any,
): void {
  if (!ctx?.state || !newFace) return;
  const oracle = String(newFace.oracle_text || '');
  const match = oracle.match(
    /as this creature transforms into .+?,\s*you get an emblem with\s*["\u201C]([^"\u201D]+)["\u201D]/i,
  );
  if (!match) return;

  const effect = String(match[1] || '').trim();
  if (!effect) return;

  const stateAny = ctx.state as any;
  stateAny.emblems = Array.isArray(stateAny.emblems) ? stateAny.emblems : [];
  const controller = String(permanent?.controller || '').trim();
  const sourceName = String(newFace.name || permanent?.card?.name || 'Emblem').trim() || 'Emblem';
  stateAny.emblems.push({
    id: uid('emblem'),
    controller,
    sourceName,
    effect,
  });
}

export function transformPermanentToFace(
  permanent: any,
  faceIndex: 0 | 1,
  ctx?: GameContext,
): void {
  if (!permanent?.card) return;
  const card: any = permanent.card;
  const faces: any[] = Array.isArray(card.card_faces) ? card.card_faces : [];
  if (faces.length < 2) return;
  const newFace = faces[faceIndex];
  if (!newFace) return;

  const previousTransformed = (permanent as any).transformed === true;
  const nextTransformed = faceIndex === 1;
  (permanent as any).transformed = nextTransformed;

  card.name = newFace.name || card.name;
  if ('power' in newFace) card.power = newFace.power;
  if ('toughness' in newFace) card.toughness = newFace.toughness;
  if (newFace.type_line) card.type_line = newFace.type_line;
  if (newFace.oracle_text) card.oracle_text = newFace.oracle_text;
  if (newFace.image_uris) card.image_uris = newFace.image_uris;
  if ('loyalty' in newFace) card.loyalty = newFace.loyalty;

  if (ctx && previousTransformed !== nextTransformed) {
    try {
      // Super Nova / similar: emblem is created as the permanent transforms into that face.
      createEmblemFromTransformIntoFace(ctx, permanent, newFace);
    } catch (err) {
      debugWarn(1, '[day-night] createEmblemFromTransformIntoFace failed:', err);
    }
    try {
      processTransformTriggers(ctx, permanent);
    } catch (err) {
      debugWarn(1, '[day-night] processTransformTriggers failed:', err);
    }
  }
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

export function applyExplicitDayNightChangeFromText(state: any, rawText: string): void {
  if (!state || !rawText) return;
  try {
    const text = String(rawText).replace(/\u2019/g, "'").toLowerCase();

    if (text.includes('daybound') || text.includes('nightbound')) return;

    const toggleNightToDay = /if\s+(?:it'?s|it\s+is)\s+night\s*,\s*it\s+becomes\s+day\b[\s\S]*?otherwise\s*,\s*it\s+becomes\s+night\b/.test(text);
    const toggleDayToNight = /if\s+(?:it'?s|it\s+is)\s+day\s*,\s*it\s+becomes\s+night\b[\s\S]*?otherwise\s*,\s*it\s+becomes\s+day\b/.test(text);
    if (toggleNightToDay) {
      setDayNightState(state, state.dayNight === 'night' ? 'day' : 'night');
      return;
    }
    if (toggleDayToNight) {
      setDayNightState(state, state.dayNight === 'day' ? 'night' : 'day');
      return;
    }

    const conditionalDayToNight = /\bif\s+(?:it'?s|it\s+is)\s+day\s*,?\s*it\s+becomes\s+night\b/.test(text);
    const conditionalNightToDay = /\bif\s+(?:it'?s|it\s+is)\s+night\s*,?\s*it\s+becomes\s+day\b/.test(text);
    if (conditionalDayToNight) {
      if (state.dayNight === 'day') setDayNightState(state, 'night');
      return;
    }
    if (conditionalNightToDay) {
      if (state.dayNight === 'night') setDayNightState(state, 'day');
      return;
    }

    if (/\bit\s+becomes\s+day\b/.test(text)) {
      setDayNightState(state, 'day');
      return;
    }
    if (/\bit\s+becomes\s+night\b/.test(text)) {
      setDayNightState(state, 'night');
      return;
    }
  } catch {
    // best-effort
  }
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
