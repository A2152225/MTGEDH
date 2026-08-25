// Origin parent: client/src/components/CombatSelectionModal.tsx
// Cluster moved: resolveAttackTargetLabel, AttackTargetBadge, getCombatCardPreviewHandlers.
// Public entry symbols: resolveAttackTargetLabel, AttackTargetBadge, getCombatCardPreviewHandlers.
// Leaf must not import CombatSelectionModal.tsx or CombatSelectionModal-handlers/index.ts.

import React from 'react';
import type { BattlefieldPermanent, KnownCardRef } from '../../../../shared/src';
import { hideCardPreview, showCardPreview } from '../CardPreviewLayer';

/** Resolve who an attacker is targeting (player or planeswalker/battle). */
export function resolveAttackTargetLabel(
  attacker: BattlefieldPermanent,
  battlefield: readonly BattlefieldPermanent[],
  playerNameById: ReadonlyMap<string, string>,
  previewTargetPlayerId?: string,
): string | null {
  const rawTarget = previewTargetPlayerId || (attacker as { attacking?: string }).attacking;
  if (!rawTarget || typeof rawTarget !== 'string') return null;

  const playerName = playerNameById.get(rawTarget);
  if (playerName) return playerName;

  const targetPerm = battlefield.find((perm) => String(perm?.id || '') === rawTarget);
  if (targetPerm) {
    const cardName = String((targetPerm.card as KnownCardRef | undefined)?.name || 'Permanent');
    const controllerName = playerNameById.get(String(targetPerm.controller || ''));
    return controllerName ? `${cardName} (${controllerName})` : cardName;
  }

  return rawTarget;
}

export function AttackTargetBadge({ label }: { label: string }) {
  return (
    <div
      style={{
        width: '100%',
        marginTop: 6,
        padding: '4px 6px',
        fontSize: 10,
        borderRadius: 4,
        border: '1px solid rgba(239, 68, 68, 0.35)',
        background: 'rgba(239, 68, 68, 0.12)',
        color: '#fecaca',
        textAlign: 'center',
      }}
    >
      Attacking → {label}
    </div>
  );
}

export function getCombatCardPreviewHandlers(
  permanent: BattlefieldPermanent | undefined,
  prefer: 'left' | 'right' | 'above' | 'below' | 'auto' = 'right',
): Pick<React.HTMLAttributes<HTMLElement>, 'onMouseEnter' | 'onMouseLeave'> {
  const card = permanent?.card as KnownCardRef | undefined;
  if (!card) return {};
  return {
    onMouseEnter: (e) => {
      showCardPreview(e.currentTarget as HTMLElement, card, { prefer, anchorPadding: 8 });
    },
    onMouseLeave: (e) => {
      hideCardPreview(e.currentTarget as HTMLElement);
    },
  };
}
