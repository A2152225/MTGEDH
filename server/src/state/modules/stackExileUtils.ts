import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { uid } from '../utils.js';
import { debugWarn } from '../../utils/debug.js';

export function exileEntireStack(ctx: GameContext, invokedBy?: PlayerID): number {
  const s = ctx.state;
  if (!s || !Array.isArray(s.stack) || s.stack.length === 0) return 0;

  try {
    const zones = (s.zones = s.zones || {});
    const moved = s.stack.splice(0, s.stack.length);
    let count = 0;
    for (const item of moved) {
      const controller = (item && (item.controller as PlayerID)) || invokedBy || 'unknown';
      (zones[controller] as any) = (zones[controller] as any) || {
        hand: [],
        handCount: 0,
        libraryCount: ctx.libraries.get(controller)?.length ?? 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
      };
      const z = zones[controller] as any;
      z.exile = z.exile || [];
      if (item.card && typeof item.card === 'object') {
        const cardObj = { ...(item.card as any), zone: 'exile' };
        z.exile.push(cardObj);
      } else {
        z.exile.push({ id: item.id || uid('ex'), name: item.card?.name || 'exiled_effect', zone: 'exile' });
      }
      count++;
    }

    for (const pid of Object.keys(zones)) {
      const z = (zones as any)[pid];
      if (z) {
        z.graveyardCount = (z.graveyard || []).length;
        z.libraryCount = (ctx.libraries.get(pid) || []).length;
      }
    }

    ctx.bumpSeq();
    return count;
  } catch (err) {
    debugWarn(1, 'exileEntireStack failed:', err);
    return 0;
  }
}
