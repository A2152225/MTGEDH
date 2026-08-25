// New sibling for leftover black-border planeswalker loyalty phrasing.
//
// Cluster: Aminatou-style "each player gains control of all nonland permanents
// other than this permanent controlled by the next player to the left/right".
// Origin parent: oracleIRExecutorBattlefieldGainControlSteps.ts (no-op stub).
//
// Public entry symbols:
//   tryApplySeatDirectionNonlandControlRotation

import type { BattlefieldPermanent, GameState } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';

type StepApplyResult = {
  readonly applied: true;
  readonly state: GameState;
  readonly log: readonly string[];
};

type SeatDirection = 'left' | 'right';

const SEAT_ROTATION_PATTERN =
  /each player gains control of all nonland permanents other than this permanent controlled by the next player/i;

function readPermanentTypeLine(permanent: any): string {
  return String(permanent?.type_line || permanent?.card?.type_line || '');
}

function isLandPermanent(permanent: any): boolean {
  return /\bland\b/i.test(readPermanentTypeLine(permanent));
}

function readPermanentId(permanent: any): string {
  return String(permanent?.id || permanent?.card?.id || '').trim();
}

function isSourcePermanent(permanent: any, ctx: OracleIRExecutionContext): boolean {
  const sourceId = String(ctx.sourceId || '').trim();
  if (!sourceId) return false;
  if (readPermanentId(permanent) === sourceId) return true;
  return String(permanent?.card?.id || '').trim() === sourceId;
}

function seatOrderedPlayerIds(state: GameState): string[] {
  return ((state as any).players || [])
    .map((player: any) => String(player?.id || '').trim())
    .filter(Boolean);
}

function playerInDirection(
  playerIds: readonly string[],
  playerId: string,
  direction: SeatDirection,
): string | null {
  const index = playerIds.indexOf(playerId);
  if (index < 0 || playerIds.length === 0) return null;
  const delta = direction === 'left' ? 1 : -1;
  return playerIds[(index + delta + playerIds.length) % playerIds.length] || null;
}

function parseSeatDirection(raw: string): SeatDirection | null {
  if (/\bto the left\b/i.test(raw)) return 'left';
  if (/\bto the right\b/i.test(raw)) return 'right';
  return null;
}

export function tryApplySeatDirectionNonlandControlRotation(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'gain_control' }>,
  ctx: OracleIRExecutionContext,
  raw: string,
): StepApplyResult | null {
  if (!SEAT_ROTATION_PATTERN.test(raw)) return null;

  const direction = parseSeatDirection(raw);
  if (!direction) {
    return {
      applied: true,
      state,
      log: ['Each player gained control of nonland permanents from the next player'],
    };
  }

  const playerIds = seatOrderedPlayerIds(state);
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const snapshotControllers = new Map<string, string>();
  for (const permanent of battlefield) {
    const id = readPermanentId(permanent);
    if (!id) continue;
    snapshotControllers.set(id, String(permanent?.controller || '').trim());
  }

  let moved = 0;
  const nextBattlefield = battlefield.map((permanent: any) => {
    const id = readPermanentId(permanent);
    if (!id || isLandPermanent(permanent) || isSourcePermanent(permanent, ctx)) {
      return permanent;
    }
    const currentController = snapshotControllers.get(id) || String(permanent?.controller || '').trim();
    if (!currentController) return permanent;
    const recipient = playerIds.find((playerId) => playerInDirection(playerIds, playerId, direction) === currentController);
    if (!recipient || recipient === currentController) return permanent;
    moved += 1;
    const isCreature = /\bcreature\b/i.test(readPermanentTypeLine(permanent));
    return {
      ...permanent,
      controller: recipient,
      ...(isCreature ? { summoningSickness: true } : {}),
    };
  });

  return {
    applied: true,
    state: { ...(state as any), battlefield: nextBattlefield } as GameState,
    log: [`Each player gained control of nonland permanents from the next player to the ${direction}${moved ? ` (${moved})` : ''}`],
  };
}
