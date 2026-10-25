import type { GameContext } from "./context.js";
import { queueLeftGraveyardTriggers, queuePutIntoGraveyardTriggers } from "./triggers/zone-change.js";

export function recordCardPutIntoGraveyardThisTurn(
  ctx: GameContext,
  ownerId: string,
  card: any,
  options?: { fromBattlefield?: boolean; controllerId?: string; originZone?: string }
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
      stateAny.permanentCardsPutIntoYourGraveyardThisTurn =
        stateAny.permanentCardsPutIntoYourGraveyardThisTurn || {};
      stateAny.permanentCardsPutIntoYourGraveyardThisTurn[owner] =
        (stateAny.permanentCardsPutIntoYourGraveyardThisTurn[owner] || 0) + 1;
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

    if (!(ctx as any)?.isReplaying) {
      queuePutIntoGraveyardTriggers(ctx, owner, card, options);
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

export function recordCardLeftGraveyardThisTurn(ctx: GameContext, ownerId: string, card?: any) {
  try {
    const stateAny = (ctx as any).state as any;
    const owner = String(ownerId || "").trim();
    if (!owner) return;

    // Alias fields used by various intervening-if templates.
    stateAny.cardLeftGraveyardThisTurn = stateAny.cardLeftGraveyardThisTurn || {};
    stateAny.cardsLeftGraveyardThisTurn = stateAny.cardsLeftGraveyardThisTurn || {};
    stateAny.leftGraveyardThisTurn = stateAny.leftGraveyardThisTurn || {};
    stateAny.cardLeftGraveyardThisTurn[owner] = true;
    stateAny.cardsLeftGraveyardThisTurn[owner] = true;
    stateAny.leftGraveyardThisTurn[owner] = true;

    // Additional alias fields used by some intervening-if templates.
    stateAny.cardLeftYourGraveyardThisTurn = stateAny.cardLeftYourGraveyardThisTurn || {};
    stateAny.cardLeftYourGraveyardThisTurn[owner] = true;

    const typeLine = String(card?.type_line || card?.card?.type_line || "").toLowerCase();
    if (typeLine.includes('creature')) {
      stateAny.creatureCardLeftGraveyardThisTurn = stateAny.creatureCardLeftGraveyardThisTurn || {};
      stateAny.creatureCardsLeftGraveyardThisTurn = stateAny.creatureCardsLeftGraveyardThisTurn || {};
      stateAny.creatureCardLeftGraveyardThisTurn[owner] = true;
      stateAny.creatureCardsLeftGraveyardThisTurn[owner] = true;

      stateAny.creatureCardLeftYourGraveyardThisTurn = stateAny.creatureCardLeftYourGraveyardThisTurn || {};
      stateAny.creatureCardLeftYourGraveyardThisTurn[owner] = true;
    }

    if (card && !(ctx as any)?.isReplaying) {
      queueLeftGraveyardTriggers(ctx, owner, card);
    }
  } catch {
    // best-effort only
  }
}

function getPermanentSpellTypeWords(card: any): string[] {
  const typeLine = String(card?.type_line || card?.typeLine || '').toLowerCase();
  return ['artifact', 'creature', 'enchantment', 'planeswalker', 'battle']
    .filter((typeWord) => new RegExp(`\\b${typeWord}\\b`, 'i').test(typeLine));
}

export function recordGraveyardPermanentTypesCastThisTurn(state: any, playerId: string, card: any): void {
  const permanentTypes = getPermanentSpellTypeWords(card);
  if (permanentTypes.length === 0) return;

  state.graveyardPermanentTypesCastThisTurn = state.graveyardPermanentTypesCastThisTurn || {};
  const playerEntry = state.graveyardPermanentTypesCastThisTurn[String(playerId)] =
    state.graveyardPermanentTypesCastThisTurn[String(playerId)] || {};

  for (const typeWord of permanentTypes) {
    playerEntry[typeWord] = true;
  }
}

/** Records the crime (if the targets make one) and returns whether these targets commit a crime. */
export function recordCommittedCrimeThisTurn(state: any, controllerId: string, targets: any[]): boolean {
  const normalizedController = String(controllerId || '').trim();
  if (!normalizedController || !Array.isArray(targets) || targets.length === 0) return false;

  try {
    const playerIds = new Set(
      Array.isArray(state?.players)
        ? state.players.map((player: any) => String(player?.id ?? '')).filter(Boolean)
        : [],
    );
    const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
    let committed = false;

    for (const target of targets) {
      if (target && typeof target === 'object' && (target.type === 'player' || target.type === 'permanent')) {
        if (target.type === 'player') {
          if (String(target.id || '') !== normalizedController) {
            committed = true;
            break;
          }
          continue;
        }
        const permController = target.controllerId ? String(target.controllerId) : '';
        if (permController && permController !== normalizedController) {
          committed = true;
          break;
        }
        continue;
      }

      const targetId = String(typeof target === 'string' ? target : (target?.id ?? '')).trim();
      if (!targetId) continue;
      if (playerIds.has(targetId)) {
        if (targetId !== normalizedController) {
          committed = true;
          break;
        }
        continue;
      }
      const perm = battlefield.find((entry: any) => String(entry?.id ?? '') === targetId);
      const permController = perm?.controller ? String(perm.controller) : '';
      if (permController && permController !== normalizedController) {
        committed = true;
        break;
      }
    }

    if (committed) {
      state.committedCrimeThisTurn = state.committedCrimeThisTurn || {};
      state.committedCrimeThisTurn[normalizedController] = true;
      state.crimeCommittedThisTurn = state.crimeCommittedThisTurn || {};
      state.crimeCommittedThisTurn[normalizedController] = true;
      state.hasCommittedCrimeThisTurn = state.hasCommittedCrimeThisTurn || {};
      state.hasCommittedCrimeThisTurn[normalizedController] = true;
    }
    return committed;
  } catch {
    // best-effort only
    return false;
  }
}
