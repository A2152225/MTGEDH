// Origin parent: applyEvent.ts
// Cluster: extra combat scheduled by "after this phase, there is an additional combat phase".
// Public entry: applyExtraCombatEvents(ctx, e) -> true when it handled the event.

import type { GameContext } from '../../context';
import type { GameEvent } from '../../types';
import { recordExtraCombat } from '../turn-handlers/turnScheduledStepsAndExtras.js';

export function applyExtraCombatEvents(ctx: GameContext, e: GameEvent): boolean {
  if (e.type !== 'scheduleExtraCombat') return false;
  recordExtraCombat(
    ctx,
    String((e as any).source || 'Unknown'),
    (e as any).untapAttackers === true,
  );
  return true;
}
