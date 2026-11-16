// server/src/state/modules/equipOnceEachTurn.ts
// Gate Equip abilities that carry "Activate only once each turn" (Shredder's Armor, Leather Armor, etc.).
import {
  textHasActivateOnlyOnceEachTurn,
  type ParsedEquipAbility,
} from '../../../../shared/src/equipAbilities.js';
import {
  hasOncePerTurnActivatedAbilityPendingOnStack,
  hasUsedOnceDuringEachActivatedAbilityThisTurn,
  markOnceDuringEachActivatedAbilityUsedThisTurn,
} from '../../../../rules-engine/src/stationPermanentUtils.js';
import { ResolutionQueueManager } from '../resolution/index.js';

export function equipAbilityIsOnceEachTurn(
  permanent: any,
  selected?: ParsedEquipAbility | null,
): boolean {
  if (selected && selected.onceEachTurn === true) return true;
  if (selected && selected.onceEachTurn === false) return false;
  const oracle = String(permanent?.card?.oracle_text || permanent?.oracle_text || '');
  return textHasActivateOnlyOnceEachTurn(oracle);
}

export function readEquipAbilityIndex(abilityId: unknown, fallback = 0): number {
  const match = String(abilityId || '').match(/-equip-(\d+)$/i);
  if (match) return Number.parseInt(match[1], 10);
  const numeric = Number(abilityId);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function pendingEquipActivationForPermanent(gameId: string, permanentId: string): boolean {
  const queue = ResolutionQueueManager.getQueue(gameId);
  const normalized = String(permanentId || '');
  if (!normalized) return false;
  return (queue?.steps || []).some((step: any) => {
    if (String(step?.abilityType || '') !== 'equip') return false;
    const id = String(step?.equipmentId || step?.permanentId || step?.sourceId || '');
    return id === normalized;
  });
}

export function getEquipOnceEachTurnBlock(
  game: any,
  gameId: string,
  permanent: any,
  permanentId: string,
  abilityIndex: number,
): { code: string; message: string } | null {
  const name = String(permanent?.card?.name || 'Equipment');
  if (hasUsedOnceDuringEachActivatedAbilityThisTurn(permanent, abilityIndex)) {
    return {
      code: 'ABILITY_ALREADY_USED',
      message: `${name}'s Equip ability can only be activated once each turn.`,
    };
  }
  const stack = Array.isArray(game?.state?.stack) ? game.state.stack : [];
  if (hasOncePerTurnActivatedAbilityPendingOnStack(stack, String(permanentId), abilityIndex)) {
    return {
      code: 'ABILITY_ALREADY_USED',
      message: `${name}'s Equip ability is already on the stack.`,
    };
  }
  if (pendingEquipActivationForPermanent(gameId, String(permanentId))) {
    return {
      code: 'ABILITY_ALREADY_USED',
      message: `${name}'s Equip ability is already being activated.`,
    };
  }
  return null;
}

export function stampEquipOnceEachTurnOnStackItem(
  stackItem: any,
  permanent: any,
  abilityIndex: number,
  onceEachTurn: boolean,
): void {
  if (!onceEachTurn || !stackItem) return;
  stackItem.oncePerTurnActivated = true;
  stackItem.activatedAbilityIndex = abilityIndex;
  if (permanent) {
    markOnceDuringEachActivatedAbilityUsedThisTurn(permanent, abilityIndex);
  }
}

export function stampEquipOnceEachTurnFromStep(
  stackItem: any,
  permanent: any,
  step: any,
): void {
  const abilityIndex = Number.isFinite(Number(step?.equipAbilityIndex))
    ? Number(step.equipAbilityIndex)
    : readEquipAbilityIndex(step?.abilityId, 0);
  const onceEachTurn = step?.equipOnceEachTurn === true || equipAbilityIsOnceEachTurn(permanent);
  stampEquipOnceEachTurnOnStackItem(stackItem, permanent, abilityIndex, onceEachTurn);
}

export function abilityTextIsOnceEachTurn(text: string): boolean {
  return textHasActivateOnlyOnceEachTurn(String(text || ''));
}

export function pendingActivationForPermanent(
  gameId: string,
  permanentId: string,
  predicate?: (step: any) => boolean,
): boolean {
  const queue = ResolutionQueueManager.getQueue(gameId);
  const normalized = String(permanentId || '');
  if (!normalized) return false;
  return (queue?.steps || []).some((step: any) => {
    if (predicate && !predicate(step)) return false;
    const id = String(step?.equipmentId || step?.permanentId || step?.sourceId || '');
    return id === normalized;
  });
}

export function getActivateOnceEachTurnBlock(
  game: any,
  gameId: string,
  permanent: any,
  permanentId: string,
  abilityIndex: number,
  opts?: { noun?: string; pending?: () => boolean },
): { code: string; message: string } | null {
  const name = String(permanent?.card?.name || 'Permanent');
  const noun = opts?.noun || 'ability';
  if (hasUsedOnceDuringEachActivatedAbilityThisTurn(permanent, abilityIndex)) {
    return {
      code: 'ABILITY_ALREADY_USED',
      message: `${name}'s ${noun} can only be activated once each turn.`,
    };
  }
  const stack = Array.isArray(game?.state?.stack) ? game.state.stack : [];
  if (hasOncePerTurnActivatedAbilityPendingOnStack(stack, String(permanentId), abilityIndex)) {
    return {
      code: 'ABILITY_ALREADY_USED',
      message: `${name}'s ${noun} is already on the stack.`,
    };
  }
  const pending = opts?.pending
    ? opts.pending()
    : pendingActivationForPermanent(gameId, String(permanentId));
  if (pending) {
    return {
      code: 'ABILITY_ALREADY_USED',
      message: `${name}'s ${noun} is already being activated.`,
    };
  }
  return null;
}

