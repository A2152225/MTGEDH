import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { appendEvent } from '../../db/index.js';
import { isCreatureNow } from '../creatureTypeNow.js';
import { debug, debugWarn } from '../../utils/debug.js';

export function attachEquipmentToCreature(
  ctx: GameContext,
  state: any,
  controller: PlayerID,
  options: {
    equipmentId: string;
    targetCreatureId: string;
    sourceName?: string;
    equipmentName?: string;
    targetCreatureName?: string;
  },
): boolean {
  const battlefield = state.battlefield || [];
  const equipmentId = String(options.equipmentId || '').trim();
  const targetCreatureId = String(options.targetCreatureId || '').trim();
  const equipment = battlefield.find((permanent: any) => permanent?.id === equipmentId);
  const targetCreature = battlefield.find((permanent: any) => permanent?.id === targetCreatureId);
  const equipmentName = options.equipmentName || options.sourceName || 'Equipment';
  const targetCreatureName = options.targetCreatureName || targetCreature?.card?.name || 'creature';

  if (!equipment) {
    debug(2, `[resolveTopOfStack] Equipment ${equipmentName || equipmentId} no longer on battlefield`);
    return false;
  }

  if (!targetCreature) {
    debug(2, `[resolveTopOfStack] Target creature ${targetCreatureName || targetCreatureId} no longer on battlefield`);
    return false;
  }

  if (!isCreatureNow(targetCreature)) {
    debug(2, `[resolveTopOfStack] Target ${targetCreatureName || targetCreatureId} is no longer a creature`);
    return false;
  }

  if (equipment.attachedTo) {
    const previousTarget = battlefield.find((permanent: any) => permanent?.id === equipment.attachedTo);
    if (previousTarget && previousTarget.attachedEquipment) {
      previousTarget.attachedEquipment = (previousTarget.attachedEquipment as string[]).filter(
        (id: string) => id !== equipmentId,
      );
      if (previousTarget.attachedEquipment.length === 0) {
        previousTarget.isEquipped = false;
      }
    }
  }

  equipment.attachedTo = targetCreatureId;

  if (!targetCreature.attachedEquipment) {
    targetCreature.attachedEquipment = [];
  }
  if (!targetCreature.attachedEquipment.includes(equipmentId)) {
    targetCreature.attachedEquipment.push(equipmentId);
  }

  targetCreature.isEquipped = true;

  try {
    const gameId = String((ctx as any).gameId || '').trim();
    if (gameId) {
      appendEvent(gameId, (state as any).seq ?? 0, 'equipPermanent', {
        playerId: controller,
        equipmentId,
        equipmentName,
        targetCreatureId,
        targetCreatureName,
      });
    }
  } catch (err) {
    debugWarn(1, '[resolveTopOfStack] appendEvent(equipPermanent) failed:', err);
  }

  debug(2, `[resolveTopOfStack] ${equipmentName || 'Equipment'} equipped to ${targetCreatureName || 'creature'}`);
  return true;
}
