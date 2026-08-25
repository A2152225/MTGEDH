// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: resolveEquippedCreaturesYouControl.
// Public entry: resolveEquippedCreaturesYouControl.

import type { BattlefieldPermanent } from '../../shared/src';
import { typeLineHasSubtype } from './oracleIRExecutorBattlefieldSubtypeUtils';
import { permanentMatchesType } from './oracleIRExecutorBattlefieldOps';

export function resolveEquippedCreaturesYouControl(
  battlefield: readonly BattlefieldPermanent[],
  controllerId: string
): BattlefieldPermanent[] {
  const equippedHostIds = new Set(
    battlefield
      .filter(
        (perm: any) =>
          String(perm?.controller || '').trim() === controllerId &&
          permanentMatchesType(perm, 'artifact') &&
          typeLineHasSubtype(perm, 'equipment')
      )
      .map((perm: any) => String(perm?.attachedTo || '').trim())
      .filter(Boolean)
  );
  return battlefield.filter((perm: any) => {
    const id = String(perm?.id || '').trim();
    if (String(perm?.controller || '').trim() !== controllerId) return false;
    if (!permanentMatchesType(perm, 'creature')) return false;
    return (
      equippedHostIds.has(id) ||
      Boolean((perm as any)?.isEquipped) ||
      (Array.isArray((perm as any)?.attachedEquipment) && (perm as any).attachedEquipment.length > 0)
    );
  });
}


