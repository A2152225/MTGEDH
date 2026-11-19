/**
 * Origin parent: server/src/state/modules/applyEvent.ts
 * Cluster: space sculptor sector assignment and the same-sector combat turn flag.
 * Public: applySpaceSculptorEvents
 */

import type { GameContext } from '../../context.js';
import type { GameEvent } from '../../types.js';
import { isSpaceSculptorSector } from '../../../../../rules-engine/src/spaceSculptor.js';

export function applySpaceSculptorEvents(ctx: GameContext, event: GameEvent): boolean {
  const type = String((event as any)?.type || '');
  if (type === 'assignSector') {
    const permanentId = String((event as any).permanentId || '').trim();
    const permanent = (ctx.state.battlefield || []).find((entry: any) => String(entry?.id || '') === permanentId);
    const sector = (event as any).sector;
    const stateAny = ctx.state as any;
    stateAny.spaceSculptorSectors = stateAny.spaceSculptorSectors || {};
    if (isSpaceSculptorSector(sector)) {
      if (permanent) permanent.sector = String(sector).toLowerCase();
      if (permanentId) stateAny.spaceSculptorSectors[permanentId] = String(sector).toLowerCase();
    } else {
      if (permanent) delete permanent.sector;
      if (permanentId) delete stateAny.spaceSculptorSectors[permanentId];
    }
    return true;
  }
  if (type === 'sameSectorBlocks') {
    const turn = Number((event as any).turn);
    if (Number.isFinite(turn)) (ctx.state as any).sameSectorBlocksTurn = turn;
    return true;
  }
  return false;
}
