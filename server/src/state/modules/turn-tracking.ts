import type { GameContext } from "./context.js";

export function recordCardPutIntoGraveyardThisTurn(
  ctx: GameContext,
  ownerId: string,
  card: any,
  options?: { fromBattlefield?: boolean; controllerId?: string }
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

    // Descend (LCI): you "descended" if a permanent card was put into your graveyard this turn.
    // Be conservative: only set true on positive evidence.
    if (
      typeLine.includes('artifact') ||
      typeLine.includes('creature') ||
      typeLine.includes('enchantment') ||
      typeLine.includes('land') ||
      typeLine.includes('planeswalker') ||
      typeLine.includes('battle')
    ) {
      stateAny.descendedThisTurn = stateAny.descendedThisTurn || {};
      stateAny.descendedThisTurn[owner] = true;
    }

    // Revolt-style tracking: a permanent left the battlefield under a controller's control.
    // Use controller-at-leave-time when provided; fall back to owner.
    if (options?.fromBattlefield) {
      const controllerAtLeave = String(options?.controllerId || owner).trim();
      if (controllerAtLeave) {
        stateAny.permanentLeftBattlefieldThisTurn = stateAny.permanentLeftBattlefieldThisTurn || {};
        stateAny.permanentLeftBattlefieldThisTurn[controllerAtLeave] = true;
      }
    }

    if (typeLine.includes("creature")) {
      stateAny.creatureCardPutIntoYourGraveyardThisTurn = stateAny.creatureCardPutIntoYourGraveyardThisTurn || {};
      stateAny.creatureCardPutIntoYourGraveyardThisTurn[owner] = true;
    }

    // Battlefield-only, typed graveyard tracking for intervening-if templates.
    if (options?.fromBattlefield) {
      if (typeLine.includes('enchantment')) {
        stateAny.enchantmentPutIntoYourGraveyardFromBattlefieldThisTurn =
          stateAny.enchantmentPutIntoYourGraveyardFromBattlefieldThisTurn || {};
        stateAny.enchantmentPutIntoYourGraveyardFromBattlefieldThisTurn[owner] = true;
      }

      // "a land you controlled ..." must be tracked by controller at the time it left the battlefield.
      const controller = String(options?.controllerId || '').trim();
      if (controller && typeLine.includes('land')) {
        stateAny.landYouControlledPutIntoGraveyardFromBattlefieldThisTurn =
          stateAny.landYouControlledPutIntoGraveyardFromBattlefieldThisTurn || {};
        stateAny.landYouControlledPutIntoGraveyardFromBattlefieldThisTurn[controller] = true;
      }

      if (typeLine.includes('artifact') || typeLine.includes('creature')) {
        stateAny.artifactOrCreaturePutIntoGraveyardFromBattlefieldThisTurn = true;
      }
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
