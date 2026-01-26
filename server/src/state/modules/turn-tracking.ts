import type { GameContext } from "./context.js";

export function recordCardPutIntoGraveyardThisTurn(
  ctx: GameContext,
  ownerId: string,
  card: any,
  options?: { fromBattlefield?: boolean }
) {
  try {
    const stateAny = (ctx as any).state as any;
    const owner = String(ownerId || "");
    if (!owner) return;

    stateAny.cardsPutIntoYourGraveyardThisTurn = stateAny.cardsPutIntoYourGraveyardThisTurn || {};
    stateAny.cardsPutIntoYourGraveyardThisTurn[owner] = (stateAny.cardsPutIntoYourGraveyardThisTurn[owner] || 0) + 1;

    if (!options?.fromBattlefield) {
      stateAny.cardsPutIntoYourGraveyardFromNonBattlefieldThisTurn = stateAny.cardsPutIntoYourGraveyardFromNonBattlefieldThisTurn || {};
      stateAny.cardsPutIntoYourGraveyardFromNonBattlefieldThisTurn[owner] =
        (stateAny.cardsPutIntoYourGraveyardFromNonBattlefieldThisTurn[owner] || 0) + 1;
    }

    const typeLine = String(card?.type_line || "").toLowerCase();
    if (typeLine.includes("creature")) {
      stateAny.creatureCardPutIntoYourGraveyardThisTurn = stateAny.creatureCardPutIntoYourGraveyardThisTurn || {};
      stateAny.creatureCardPutIntoYourGraveyardThisTurn[owner] = true;
    }
  } catch {
    // best-effort only
  }
}

export function recordPermanentPutIntoHandFromBattlefieldThisTurn(ctx: GameContext, ownerId: string) {
  try {
    const stateAny = (ctx as any).state as any;
    const owner = String(ownerId || "");
    if (!owner) return;
    stateAny.permanentPutIntoHandFromBattlefieldThisTurn = stateAny.permanentPutIntoHandFromBattlefieldThisTurn || {};
    stateAny.permanentPutIntoHandFromBattlefieldThisTurn[owner] = true;
  } catch {
    // best-effort only
  }
}
