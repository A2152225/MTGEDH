/**
 * Planechase runtime (CR 901 / 311 / 312): planeswalk, chaos ensues, phenomenon
 * encounter. Does not expose player deck UI — call sites seed planarDeckFaceDown /
 * currentPlane when houseRules.enablePlanechase is on.
 *
 * Public: isPlanechaseEnabled, getPlanarController, chaosEnsues,
 * planeswalk, encounterPhenomenon, applyPlanarDieFaceEffects,
 * firePlaneswalkHereTriggers, firePlanarDieRollTriggers, seedActivePlaneAliases.
 */

import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { detectAbilityActivatedTriggers } from './triggers/ability-activated-detection.js';
import { queueGenericTriggeredAbility } from './triggerEmissionFamilyUtils.js';
import { appendEvent } from '../../db/index.js';
import {
  asCommandZoneAbilitySource,
  getActivePlaneCard,
} from './commandZoneAbilitySources.js';
import {
  isPhenomenonTypeLine,
  isPlaneTypeLine,
  normalizePlanechaseOracleText,
} from './planechaseOracleNormalize.js';
import type { PlanarDieFace } from './planarDie.js';

function isChaosFace(state: any, face: PlanarDieFace): boolean {
  // Chaotic Aether is a phenomenon that leaves a lasting replacement until the next
  // planeswalk away from a plane (CR 312 / phenomenon text).
  return face === 'chaos' || (state?.chaoticAetherActive === true && face === 'blank');
}

export function isPlanechaseEnabled(state: any): boolean {
  return state?.houseRules?.enablePlanechase === true;
}

export function getPlanarController(state: any, fallbackPlayerId?: string): string {
  // CR 311.5: the planar controller is the active player, and that changes when
  // the active player changes. A value saved at the last planeswalk is stale.
  const active = String(state?.turnPlayer || state?.activePlayer || '').trim();
  if (active) return active;
  return String(fallbackPlayerId || state?.planarController || '').trim();
}

/** Keep activePlane / currentPlane mirrors in sync for legacy readers. */
export function seedActivePlaneAliases(state: any, plane: any | null): void {
  if (!state) return;
  if (plane) {
    state.currentPlane = plane;
    state.activePlane = plane;
  } else {
    delete state.currentPlane;
    delete state.activePlane;
  }
}

function ensurePlanarDeck(state: any): any[] {
  if (!Array.isArray(state.planarDeckFaceDown)) state.planarDeckFaceDown = [];
  return state.planarDeckFaceDown;
}

function queueCommandZoneTriggers(
  ctx: GameContext,
  source: any,
  triggerType: string,
  effect: string,
  extras?: Record<string, unknown>,
): any | null {
  const effectText = String(effect || '').trim();
  if (!effectText) return null;
  return queueGenericTriggeredAbility(
    ctx,
    {
      permanentId: String(source.id || ''),
      controllerId: String(source.controller || '') as PlayerID,
      cardName: String(source.card?.name || source.name || 'Command zone card'),
      effect: effectText,
      description: effectText,
      mandatory: !/^you may\b/i.test(effectText),
      _sourceSnapshot: source,
    },
    triggerType,
    extras,
  );
}

function detectTriggersForCommandCard(card: any, source: any, state: any): any[] {
  const normalizedCard = {
    ...card,
    oracle_text: normalizePlanechaseOracleText(card?.oracle_text || card?.text || ''),
    type_line: String(card?.type_line || source?.type_line || ''),
  };
  return detectAbilityActivatedTriggers(normalizedCard, source, state);
}

/**
 * CR 311.7: chaos ensues — fire the face-up plane's chaos ability.
 */
export function chaosEnsues(ctx: GameContext, playerId: string): any[] {
  const state = (ctx as any)?.state;
  if (!state) return [];
  const plane = getActivePlaneCard(state);
  if (!plane) {
    debug(2, '[chaosEnsues] no active plane');
    return [];
  }
  const controller = getPlanarController(state, playerId);
  const source = asCommandZoneAbilitySource(plane, controller, 'plane');
  const triggers = detectTriggersForCommandCard(source.card, source, state)
    .filter((t) => t.triggerType === 'chaos_ensues');
  const queued: any[] = [];
  for (const trigger of triggers) {
    const item = queueCommandZoneTriggers(ctx, source, 'chaos_ensues', trigger.effect, {
      planarController: controller,
      chaosEnsues: true,
    });
    if (item) queued.push(item);
  }
  // Fallback: parse normalized oracle directly when detector missed (e.g. {CHAOS} only).
  if (queued.length === 0) {
    const oracle = normalizePlanechaseOracleText(source.card.oracle_text);
    const match = oracle.match(/whenever chaos ensues,?\s*(.+)/is);
    if (match) {
      const effect = String(match[1] || '').trim().replace(/\s+/g, ' ');
      const item = queueCommandZoneTriggers(ctx, source, 'chaos_ensues', effect, {
        planarController: controller,
        chaosEnsues: true,
      });
      if (item) queued.push(item);
    }
  }
  debug(1, `[chaosEnsues] queued ${queued.length} chaos abilit(y/ies) from ${source.card?.name}`);
  return queued;
}

/**
 * Fire "Whenever you planeswalk here" / "When you planeswalk to ~" on the new plane.
 */
export function firePlaneswalkHereTriggers(ctx: GameContext, playerId: string, plane: any): any[] {
  const state = (ctx as any)?.state;
  if (!state || !plane) return [];
  const controller = getPlanarController(state, playerId);
  const source = asCommandZoneAbilitySource(plane, controller, 'plane');
  const triggers = detectTriggersForCommandCard(source.card, source, state)
    .filter((t) => t.triggerType === 'planeswalk_here');
  const queued: any[] = [];
  for (const trigger of triggers) {
    const item = queueCommandZoneTriggers(ctx, source, 'planeswalk_here', trigger.effect, {
      planarController: controller,
      planeswalkHere: true,
    });
    if (item) queued.push(item);
  }
  // Dual phrasing: "When you planeswalk to NAME and at the beginning of your upkeep"
  // is handled separately by upkeep emitters; the planeswalk-to half:
  if (queued.length === 0) {
    const oracle = normalizePlanechaseOracleText(source.card.oracle_text);
    const name = String(source.card.name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`when(?:ever)? you planeswalk (?:here|to ${name}),?\\s*(.+)`, 'is'),
      /when(?:ever)? you planeswalk here,?\s*(.+)/is,
    ];
    for (const pattern of patterns) {
      const match = oracle.match(pattern);
      if (!match) continue;
      // Stop at next trigger header if multi-ability.
      let effect = String(match[1] || '').trim();
      effect = effect.split(/\n(?=whenever |when |at the )/i)[0].trim();
      // "and at the beginning of your upkeep, ..." — keep only the planeswalk half before "and at".
      const andAt = effect.match(/^(.*?)\s+and at the beginning of /i);
      if (andAt) effect = String(andAt[1] || '').trim();
      if (!effect) continue;
      const item = queueCommandZoneTriggers(ctx, source, 'planeswalk_here', effect, {
        planarController: controller,
        planeswalkHere: true,
      });
      if (item) queued.push(item);
      break;
    }
  }
  return queued;
}

/**
 * Phenomenon encounter (CR 312): fire "When you encounter …", then the phenomenon
 * is put on the bottom of the planar deck as part of continuing to planeswalk.
 */
export function encounterPhenomenon(ctx: GameContext, playerId: string, phenomenon: any): any[] {
  const state = (ctx as any)?.state;
  if (!state || !phenomenon) return [];
  const controller = getPlanarController(state, playerId);
  const source = asCommandZoneAbilitySource(phenomenon, controller, 'phenomenon');
  const phenomenonName = String(source.card?.name || '').trim().toLowerCase();
  if (phenomenonName === 'chaotic aether') {
    state.chaoticAetherActive = true;
  }
  const triggers = detectTriggersForCommandCard(source.card, source, state)
    .filter((t) => t.triggerType === 'encounter_phenomenon' || t.triggerType === 'named_encounter');
  const queued: any[] = [];
  for (const trigger of triggers) {
    const item = queueCommandZoneTriggers(ctx, source, trigger.triggerType, trigger.effect, {
      planarController: controller,
      encounterPhenomenon: true,
    });
    if (item) queued.push(item);
  }
  if (queued.length === 0) {
    const oracle = normalizePlanechaseOracleText(source.card.oracle_text);
    const match = oracle.match(/when you encounter [^,]+,?\s*(.+)/is);
    if (match) {
      let effect = String(match[1] || '').trim();
      // Strip trailing reminder "(Then planeswalk away from this phenomenon.)"
      effect = effect.replace(/\(then planeswalk away from this phenomenon\.?\)/i, '').trim();
      const item = queueCommandZoneTriggers(ctx, source, 'encounter_phenomenon', effect, {
        planarController: controller,
        encounterPhenomenon: true,
      });
      if (item) queued.push(item);
    }
  }
  return queued;
}

function putCardOnBottomOfPlanarDeck(state: any, card: any): void {
  const deck = ensurePlanarDeck(state);
  deck.push(card);
}

function drawTopPlanarCard(state: any): any | null {
  const deck = ensurePlanarDeck(state);
  if (deck.length === 0) return null;
  return deck.shift() || null;
}

/**
 * CR 701.31 / 901.8: planeswalk — leave current plane, reveal until a plane is face up.
 * Phenomena encountered along the way fire and go to the bottom.
 */
export function planeswalk(ctx: GameContext, playerId: string): {
  ok: boolean;
  plane: any | null;
  phenomenaEncountered: any[];
  queued: any[];
  reason?: string;
} {
  const state = (ctx as any)?.state;
  if (!state) return { ok: false, plane: null, phenomenaEncountered: [], queued: [], reason: 'no state' };
  if (!isPlanechaseEnabled(state)) {
    return { ok: false, plane: null, phenomenaEncountered: [], queued: [], reason: 'planechase disabled' };
  }

  const previous = getActivePlaneCard(state);
  if (previous) putCardOnBottomOfPlanarDeck(state, previous);

  const phenomenaEncountered: any[] = [];
  const queued: any[] = [];
  let nextPlane: any | null = null;
  const safety = Math.max(1, ensurePlanarDeck(state).length + 2);
  for (let i = 0; i < safety; i++) {
    const card = drawTopPlanarCard(state);
    if (!card) break;
    const typeLine = String(card.type_line || card.typeLine || '');
    if (isPhenomenonTypeLine(typeLine)) {
      phenomenaEncountered.push(card);
      seedActivePlaneAliases(state, card); // briefly face-up for encounter abilities
      queued.push(...encounterPhenomenon(ctx, playerId, card));
      putCardOnBottomOfPlanarDeck(state, card);
      continue;
    }
    // Treat missing type as plane when coming from planar deck.
    if (isPlaneTypeLine(typeLine) || !typeLine || !isPhenomenonTypeLine(typeLine)) {
      nextPlane = card;
      break;
    }
    putCardOnBottomOfPlanarDeck(state, card);
  }

  seedActivePlaneAliases(state, nextPlane);
  state.planarController = getPlanarController(state, playerId);
  state.planeswalkedThisTurn = true;
  state.planeswalksAttempted = Math.max(0, Number(state.planeswalksAttempted) || 0) + 1;
  // Chaotic Aether lasts until a player planeswalks away from a plane.
  if (previous && isPlaneTypeLine(String(previous.type_line || previous.typeLine || 'Plane'))) {
    state.chaoticAetherActive = false;
  }

  if (nextPlane) {
    const name = String(nextPlane.name || '').trim().toLowerCase();
    state.planeswalkedToThisTurn = state.planeswalkedToThisTurn || {};
    const list = Array.isArray(state.planeswalkedToThisTurn[playerId])
      ? state.planeswalkedToThisTurn[playerId]
      : [];
    if (name) list.push(name);
    state.planeswalkedToThisTurn[playerId] = list;
    state.planeswalkedToPlanesThisTurn = state.planeswalkedToThisTurn;
  }

  const gameId = String((ctx as any)?.gameId || '').trim();
  if (gameId && !(ctx as any)?.isReplaying) {
    try {
      appendEvent(gameId, Number(state.seq ?? (ctx as any).seq?.value ?? 0), 'planeswalk', {
        playerId,
        fromPlane: previous || null,
        toPlane: nextPlane || null,
        planarDeckFaceDown: Array.isArray(state.planarDeckFaceDown)
          ? state.planarDeckFaceDown.map((card: any) => card)
          : [],
        phenomenaEncountered: phenomenaEncountered.map((p) => ({ id: p?.id, name: p?.name })),
        chaoticAetherActive: state.chaoticAetherActive === true,
        planeswalkedToThisTurn: state.planeswalkedToThisTurn,
        planeswalksAttempted: state.planeswalksAttempted,
        oracleIrReplayMutation: true,
      });
    } catch (err) {
      debugWarn(1, '[planeswalk] appendEvent failed:', err);
    }
  }

  // "When you planeswalk to X" triggers are queued AFTER the snapshot is saved: a reload keeps a
  // pending trigger on the stack only when the last logged event is its pushTriggeredAbility
  // (replay-prompt-cleanup.ts). Known gap: phenomenon "when you encounter" triggers are still
  // queued inside the loop above, before this snapshot.
  if (nextPlane) queued.push(...firePlaneswalkHereTriggers(ctx, playerId, nextPlane));

  debug(1, `[planeswalk] ${playerId} → ${nextPlane?.name || 'none'} (phenomena=${phenomenaEncountered.length})`);
  return { ok: Boolean(nextPlane), plane: nextPlane, phenomenaEncountered, queued };
}

/**
 * "Whenever you roll the planar die" fires for every face. "Whenever you roll a blank"
 * fires only for a blank that was not replaced by chaos (Chaotic Aether).
 */
export function firePlanarDieRollTriggers(ctx: GameContext, playerId: string, face: PlanarDieFace): any[] {
  const state = (ctx as any)?.state;
  if (!state) return [];
  const plane = getActivePlaneCard(state);
  if (!plane) return [];
  const controller = getPlanarController(state, playerId);
  const typeLine = String(plane.type_line || plane.typeLine || '');
  const kind = isPhenomenonTypeLine(typeLine) ? 'phenomenon' : 'plane';
  const source = asCommandZoneAbilitySource(plane, controller, kind);
  const blankCounts = face === 'blank' && !isChaosFace(state, face);
  const triggers = detectTriggersForCommandCard(source.card, source, state).filter((trigger) => {
    if (trigger.triggerType === 'planar_die_roll') return true;
    return blankCounts && trigger.triggerType === 'planar_die_blank';
  });
  const queued: any[] = [];
  for (const trigger of triggers) {
    const item = queueCommandZoneTriggers(ctx, source, trigger.triggerType, trigger.effect, {
      planarController: controller,
      planarDieFace: face,
    });
    if (item) queued.push(item);
  }
  return queued;
}

/**
 * Apply planar die face results after blanks/chaos/planeswalk are known.
 */
export function applyPlanarDieFaceEffects(
  ctx: GameContext,
  playerId: string,
  faces: readonly PlanarDieFace[],
): void {
  const state = (ctx as any)?.state;
  if (!state || !faces?.length) return;
  for (const face of faces) {
    firePlanarDieRollTriggers(ctx, playerId, face);
    if (isChaosFace(state, face)) {
      chaosEnsues(ctx, playerId);
      continue;
    }
    if (face === 'planeswalk') {
      // Inherent planeswalking ability (CR 901.8) — resolve immediately for engine use.
      planeswalk(ctx, playerId);
    }
  }
}
