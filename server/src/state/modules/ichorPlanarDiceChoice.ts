/**
 * Ichor Elixir: after extra planar dice are rolled, the player chooses
 * which face(s) to ignore. Consumes state.ichorPlanarDicePending.
 *
 * Public: applyPlanarDieFaces, queueIchorPlanarDiceIgnoreChoice,
 * applyIchorPlanarDiceIgnoredIndexes, consumeIchorPlanarDicePending,
 * keptPlanarDieFacesAfterIgnore.
 */
import type { GameContext } from '../context.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import type { PlanarDieFace } from './planarDie.js';
import { queueParsedKeywordAction } from './triggerEmissionFamilyUtils.js';

export type IchorPlanarDicePending = {
  playerId: string;
  ignore: number;
  faces: PlanarDieFace[];
};

function activePlaneName(state: any): string {
  const plane = state?.activePlane || state?.currentPlane;
  return String(plane?.name || plane || '').trim().toLowerCase();
}

export function isChaosPlanarDieFace(state: any, face: PlanarDieFace): boolean {
  const chaoticAether = activePlaneName(state) === 'chaotic aether';
  return face === 'chaos' || (chaoticAether && face === 'blank');
}

export function formatPlanarDieFaceLabel(face: PlanarDieFace, index: number, total: number): string {
  const name = face === 'chaos' ? 'Chaos' : face === 'planeswalk' ? 'Planeswalk' : 'Blank';
  return total > 1 ? `${name} (roll ${index + 1})` : name;
}

export function getIchorPlanarDicePending(state: any): IchorPlanarDicePending | null {
  const pending = state?.ichorPlanarDicePending;
  if (!pending || typeof pending !== 'object') return null;
  const playerId = String(pending.playerId || '').trim();
  const faces = Array.isArray(pending.faces) ? pending.faces.filter((face: any) => face === 'chaos' || face === 'planeswalk' || face === 'blank') : [];
  const ignore = Math.max(0, Math.floor(Number(pending.ignore) || 0));
  if (!playerId || faces.length === 0) return null;
  return { playerId, ignore, faces };
}

export function consumeIchorPlanarDicePending(state: any): IchorPlanarDicePending | null {
  const pending = getIchorPlanarDicePending(state);
  if (state && Object.prototype.hasOwnProperty.call(state, 'ichorPlanarDicePending')) {
    delete state.ichorPlanarDicePending;
  }
  return pending;
}

export function keptPlanarDieFacesAfterIgnore(faces: PlanarDieFace[], ignoredIndexes: number[]): PlanarDieFace[] {
  const ignore = new Set(
    (Array.isArray(ignoredIndexes) ? ignoredIndexes : [])
      .map((index) => Math.floor(Number(index)))
      .filter((index) => Number.isInteger(index) && index >= 0 && index < faces.length),
  );
  return faces.filter((_, index) => !ignore.has(index));
}

export function applyPlanarDieFaces(
  ctx: GameContext,
  playerId: string,
  faces: readonly PlanarDieFace[],
): void {
  const state = (ctx as any)?.state;
  if (!state || !playerId || !Array.isArray(faces) || faces.length === 0) return;
  state.planarDieRollsThisTurn = Array.isArray(state.planarDieRollsThisTurn) ? state.planarDieRollsThisTurn : [];
  for (const face of faces) {
    const chaos = isChaosPlanarDieFace(state, face);
    state.planarDieRollsThisTurn.push({ playerId, face, chaos, ts: Date.now() });
    state.lastPlanarDieRoll = { playerId, face, chaos };
    queueParsedKeywordAction(ctx, playerId, 'roll_planar_die');
    if (chaos) queueParsedKeywordAction(ctx, playerId, 'chaos');
  }
}

export function resolveIchorPlanarDiceGameId(ctx: GameContext): string {
  return String((ctx as any)?.gameId || (ctx as any)?.state?.gameId || (ctx as any)?.id || '').trim();
}

export function queueIchorPlanarDiceIgnoreChoice(ctx: GameContext): boolean {
  const state = (ctx as any)?.state;
  const pending = getIchorPlanarDicePending(state);
  if (!pending || pending.ignore <= 0) return false;
  const gameId = resolveIchorPlanarDiceGameId(ctx);
  if (!gameId) return false;
  const ignore = Math.min(pending.ignore, pending.faces.length);
  if (ignore <= 0) return false;

  const existing = ResolutionQueueManager
    .getStepsForPlayer(gameId, pending.playerId as any)
    .find((step: any) => step?.ichorPlanarDiceChoice === true);
  if (existing) return true;

  const options = pending.faces.map((face, index) => ({
    id: `ichor-face-${index}`,
    label: formatPlanarDieFaceLabel(face, index, pending.faces.length),
  }));

  ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: pending.playerId as any,
    sourceId: 'ichor-elixir',
    sourceName: 'Ichor Elixir',
    description: ignore === 1
      ? 'Ichor Elixir: Choose one rolled planar die face to ignore.'
      : `Ichor Elixir: Choose ${ignore} rolled planar die faces to ignore.`,
    mandatory: true,
    options,
    minSelections: ignore,
    maxSelections: ignore,
    ichorPlanarDiceChoice: true,
    ichorIgnoreCount: ignore,
    ichorFaces: [...pending.faces],
  } as any);
  return true;
}

export function parseIchorIgnoredFaceIndexes(selections: unknown, faceCount: number): number[] {
  const raw = Array.isArray(selections)
    ? selections
    : typeof selections === 'string'
      ? [selections]
      : selections && typeof selections === 'object'
        ? [selections]
        : [];
  const indexes: number[] = [];
  for (const entry of raw) {
    const id = typeof entry === 'string'
      ? entry
      : String((entry as any)?.id || (entry as any)?.value || (entry as any)?.optionId || '');
    const match = /^ichor-face-(\d+)$/.exec(id.trim());
    if (!match) continue;
    const index = Number(match[1]);
    if (!Number.isInteger(index) || index < 0 || index >= faceCount || indexes.includes(index)) continue;
    indexes.push(index);
  }
  return indexes;
}

export function applyIchorPlanarDiceIgnoredIndexes(
  ctx: GameContext,
  ignoredIndexes: number[],
): PlanarDieFace[] {
  const pending = consumeIchorPlanarDicePending((ctx as any)?.state);
  if (!pending) return [];
  const kept = keptPlanarDieFacesAfterIgnore(pending.faces, ignoredIndexes);
  applyPlanarDieFaces(ctx, pending.playerId, kept);
  return kept;
}
