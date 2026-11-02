// server/src/socket/resolution-handlers/optionChoiceEquipAlternativeCost.ts
// B39: response half of targetSelectionEquipAlternativeCost.ts. Re-enters the battlefield ability handler
// with the chosen single cost (equipChosenCost marks the choice as made) and the originally chosen target.
// Replay: no own event; the chosen cost is recorded by the downstream equip*CostPaid / activation events.
// Origin parent: optionChoiceResponseHandlers.ts (handleOptionChoiceResponse).
// Public entry symbols: tryHandleEquipAlternativeCostChoice.

import type { Server } from "socket.io";
import type { ResolutionStep, ResolutionStepResponse } from "../../state/resolution/index.js";
import { getResolutionHandlerDeps } from "../resolutionHandlerDeps.js";
import { emitToPlayer } from "../util.js";
import { altCostField } from "./targetSelectionEquipAlternativeCost.js";

function selectedId(sel: any): string {
  if (Array.isArray(sel)) return selectedId(sel[0]);
  if (sel && typeof sel === 'object') return String(sel.id ?? '');
  return String(sel ?? '');
}

export async function tryHandleEquipAlternativeCostChoice(
  io: Server, game: any, gameId: string, step: ResolutionStep, response: ResolutionStepResponse,
): Promise<boolean> {
  const s = step as any;
  if (s?.equipAlternativeCostChoice !== true) return false;
  const options: string[] = Array.isArray(s.equipAlternativeCostOptions) ? s.equipAlternativeCostOptions : [];
  const id = selectedId((response as any).selections);
  const chosen = options[Number(id.replace(/^alt_/, ''))] || options.find((o) => o === id);
  if (!chosen) {
    if (!(response as any).cancelled) emitToPlayer(io, String(response.playerId) as any, 'error', { code: 'INVALID_CHOICE', message: 'Choose a cost to pay.' });
    return true;
  }
  const continuation: any = { ...(s.equipAltContinuation || {}), equipChosenCost: chosen };
  continuation[altCostField(continuation)] = chosen; // B41: equip, fortify or reconfigure
  await getResolutionHandlerDeps().handleBattlefieldAbilityTargetSelection(
    io, game, gameId, continuation as any,
    { ...(response as any), selections: Array.isArray(s.equipTargetIds) ? [...s.equipTargetIds] : [] } as any,
  );
  return true;
}
