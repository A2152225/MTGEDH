/**
 * Space sculptor live rules (CR 702.158, 704.5u).
 * Origin: keyword gap — the parser recognized the word and nothing assigned sectors.
 * Public: queueSpaceSculptorSectorChoices, applySpaceSculptorOptionChoice,
 *   tryResolveSpaceSculptorAbility, sameSectorBlocksThisTurn,
 *   spaceSculptorBlockReason.
 */

import type { PlayerID } from '../../../../shared/src/index.js';
import {
  isSpaceSculptorSector,
  oracleHasSpaceSculptor,
  sectorsAreDifferent,
  SPACE_SCULPTOR_SECTORS,
  type SpaceSculptorSector,
} from '../../../../rules-engine/src/spaceSculptor.js';
import { appendEvent } from '../../db/index.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import type { GameContext } from '../context.js';

function oracleOf(permanent: any): string {
  return String(permanent?.card?.oracle_text || permanent?.oracle_text || '');
}

function isCreature(permanent: any): boolean {
  if (!permanent || permanent.phasedOut) return false;
  return /\bcreature\b/i.test(String(permanent?.card?.type_line || permanent?.type_line || ''));
}

export function permanentHasSpaceSculptor(permanent: any): boolean {
  return oracleHasSpaceSculptor(oracleOf(permanent));
}

function currentTurn(state: any): number {
  const turn = Number(state?.turnNumber ?? state?.turn ?? 0);
  return Number.isFinite(turn) ? turn : 0;
}

export function sameSectorBlocksThisTurn(state: any): boolean {
  return Number(state?.sameSectorBlocksTurn) === currentTurn(state) && currentTurn(state) > 0;
}

export function spaceSculptorBlockReason(attacker: any, blocker: any, state: any): string | null {
  if (!sameSectorBlocksThisTurn(state)) return null;
  if (!sectorsAreDifferent(sectorOf(state, attacker), sectorOf(state, blocker))) return null;
  return 'Creatures can be blocked this turn only by creatures in the same sector';
}

function playerOrder(state: any): string[] {
  const ids = (Array.isArray(state?.players) ? state.players : [])
    .map((player: any) => String(player?.id || '').trim())
    .filter(Boolean);
  const active = String(state?.activePlayer || state?.turnPlayer || '').trim();
  const index = ids.indexOf(active);
  if (index <= 0) return ids;
  return [...ids.slice(index), ...ids.slice(0, index)];
}

function pendingSectorStep(gameId: string): boolean {
  if (!gameId) return false;
  const queue = ResolutionQueueManager.getQueue(gameId);
  const steps = [queue.activeStep, ...(queue.steps || [])].filter(Boolean);
  return steps.some((step: any) => step?.spaceSculptorSectorChoice === true || step?.spaceSculptorEffectChoice === true);
}

function persist(ctx: GameContext, type: string, payload: Record<string, unknown>): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId) return;
  try {
    appendEvent(gameId, Number((ctx as any).seq || 0), type, payload);
  } catch {
    // Live mutation already happened. Replay reads the event when the database is open.
  }
}

function sectorMap(state: any): Record<string, string> {
  if (!state.spaceSculptorSectors || typeof state.spaceSculptorSectors !== 'object') {
    state.spaceSculptorSectors = {};
  }
  return state.spaceSculptorSectors;
}

function setSector(ctx: GameContext, permanent: any, sector: SpaceSculptorSector | null): void {
  const state = (ctx as any).state;
  const id = String(permanent?.id || '');
  if (sector) {
    permanent.sector = sector;
    if (id) sectorMap(state)[id] = sector;
  } else {
    delete permanent.sector;
    if (id) delete sectorMap(state)[id];
  }
  persist(ctx, 'assignSector', {
    permanentId: id,
    sector,
    playerId: String(permanent.controller || ''),
  });
}

export function sectorOf(state: any, permanent: any): string {
  const id = String(permanent?.id || '');
  return String(state?.spaceSculptorSectors?.[id] || permanent?.sector || '');
}

export function queueSpaceSculptorSectorChoices(ctx: GameContext): boolean {
  if ((ctx as any).isReplaying) return false;
  const state = (ctx as any).state;
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const gameId = String((ctx as any).gameId || '').trim();
  const sculptors = battlefield.filter(permanentHasSpaceSculptor);
  if (sculptors.length === 0) {
    let cleared = false;
    for (const permanent of battlefield) {
      if (!permanent?.sector) continue;
      setSector(ctx, permanent, null);
      cleared = true;
    }
    return cleared;
  }
  if (!gameId || pendingSectorStep(gameId)) return false;

  const sculptorControllers = new Set(sculptors.map((permanent: any) => String(permanent.controller || '')));
  const unassigned = battlefield.filter((permanent: any) => isCreature(permanent) && !isSpaceSculptorSector(sectorOf(state, permanent)));
  if (unassigned.length === 0) return false;

  const order = playerOrder(state);
  const ranked = [
    ...order.filter((id) => !sculptorControllers.has(id)),
    ...order.filter((id) => sculptorControllers.has(id)),
  ];
  const nextPlayer = ranked.find((id) => unassigned.some((permanent: any) => String(permanent.controller || '') === id));
  const creature = unassigned.find((permanent: any) => String(permanent.controller || '') === nextPlayer);
  if (!creature || !nextPlayer) return false;

  ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: nextPlayer as PlayerID,
    sourceName: 'Space sculptor',
    description: `Choose a sector for ${String(creature.card?.name || 'this creature')}.`,
    mandatory: true,
    minSelections: 1,
    maxSelections: 1,
    spaceSculptorSectorChoice: true,
    spaceSculptorPermanentId: String(creature.id || ''),
    options: SPACE_SCULPTOR_SECTORS.map((sector) => ({
      id: sector,
      label: `${sector[0].toUpperCase()}${sector.slice(1)} sector`,
    })),
  } as any);
  return true;
}

export function applySpaceSculptorOptionChoice(
  ctx: GameContext,
  step: any,
  selectedId: string,
): { ok: boolean; error?: string } {
  const sectorName = String(selectedId || '').trim().toLowerCase();
  if (!isSpaceSculptorSector(sectorName)) {
    return { ok: false, error: 'Choose alpha, beta, or gamma sector.' };
  }
  const state = (ctx as any).state;
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];

  if (step?.spaceSculptorSectorChoice === true) {
    const permanentId = String(step.spaceSculptorPermanentId || '').trim();
    const permanent = battlefield.find((entry: any) => String(entry?.id || '') === permanentId);
    if (!permanent) return { ok: false, error: 'That creature is no longer on the battlefield.' };
    setSector(ctx, permanent, sectorName);
    queueSpaceSculptorSectorChoices(ctx);
    return { ok: true };
  }
  return { ok: false, error: 'That sector choice has no effect.' };
}

function abilityText(item: any): string {
  return [item?.activatedAbilityText, item?.description, item?.effect].filter(Boolean).join('\n');
}

function queueSectorEffect(ctx: GameContext, controller: string, effect: 'counters' | 'destroy', sourceName: string): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId) return;
  const verb = effect === 'counters' ? 'put a +1/+1 counter on each creature in' : 'destroy all creatures in';
  ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: controller as PlayerID,
    sourceName,
    description: `Choose a sector. You will ${verb} that sector.`,
    mandatory: true,
    minSelections: 1,
    maxSelections: 1,
    spaceSculptorEffectChoice: true,
    spaceSculptorEffect: effect,
    options: SPACE_SCULPTOR_SECTORS.map((sector) => ({
      id: sector,
      label: `${sector[0].toUpperCase()}${sector.slice(1)} sector`,
    })),
  } as any);
}

/** Loyalty and activated text that refers to sectors. Returns true when it owned the ability. */
export function tryResolveSpaceSculptorAbility(ctx: GameContext, item: any, controller: string): boolean {
  const text = abilityText(item);
  const state = (ctx as any).state;
  if (!state || !text) return false;
  if (/creatures in each sector can be blocked this turn only by creatures in the same sector/i.test(text)) {
    const turn = currentTurn(state);
    state.sameSectorBlocksTurn = turn;
    persist(ctx, 'sameSectorBlocks', { turn, playerId: controller });
    return true;
  }
  if (/put a \+1\/\+1 counter on each creature in the sector of your choice/i.test(text)) {
    queueSectorEffect(ctx, controller, 'counters', String(item?.sourceName || 'Space sculptor'));
    return true;
  }
  if (/destroy all creatures in the sector of your choice/i.test(text)) {
    queueSectorEffect(ctx, controller, 'destroy', String(item?.sourceName || 'Space sculptor'));
    return true;
  }
  return false;
}
