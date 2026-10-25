// Origin parent: client/src/components/TargetSelectionModal.tsx
// Cluster moved: TargetType, TargetOption, TargetSelectionGroup,
// isGroupedTargetSelectionComplete, formatControllerGroupLabel, ownershipStyle,
// PermanentOwnershipBadge, PermanentTargetCaption, TargetSelectionModalProps (~19-223).
// Public entry symbols: TargetType, TargetOption, TargetSelectionGroup,
// isGroupedTargetSelectionComplete, TargetSelectionModalProps,
// formatControllerGroupLabel, ownershipStyle, PermanentOwnershipBadge,
// PermanentTargetCaption.
// Leaf must not import TargetSelectionModal.tsx or TargetSelectionModal-handlers/index.ts.

import type { KnownCardRef, BattlefieldPermanent } from '../../../../shared/src';
import type { TargetOptionPowerToughness } from '../../utils/targetOptionPowerToughness';
import { getPTColor } from '../FreeField-handlers/freeFieldDisplayUtils';

export type TargetType = 'permanent' | 'player' | 'card' | 'stack';

export interface TargetOption {
  id: string;
  type: TargetType;
  name: string;
  displayName?: string;
  imageUrl?: string;
  // For permanents
  controller?: string;
  controllerName?: string;
  typeLine?: string;
  tapped?: boolean;
  /** Current (effective) creature P/T, same as the battlefield badge. */
  powerToughness?: TargetOptionPowerToughness;
  // For players
  life?: number;
  // For cards
  zone?: string;
  owner?: string;
  ownerName?: string;
  card?: KnownCardRef | BattlefieldPermanent;
  /** Flagbearer the caster must choose among their targets if able. */
  flagbearerRequired?: boolean;
}

export interface TargetSelectionGroup {
  playerId: string;
  label?: string;
  required?: boolean;
  minTargets: number;
  maxTargets: number;
  targets: TargetOption[];
}

export function isGroupedTargetSelectionComplete(
  selectedIds: ReadonlySet<string>,
  groups: readonly TargetSelectionGroup[],
  minTargets: number,
  maxTargets: number,
): boolean {
  if (selectedIds.size < minTargets || selectedIds.size > maxTargets) return false;
  for (const group of groups) {
    const count = group.targets.filter((target) => selectedIds.has(target.id)).length;
    if (count < group.minTargets || count > group.maxTargets) return false;
  }
  return true;
}

function formatControllerGroupLabel(
  controllerId: string | undefined,
  controllerName: string | undefined,
  _viewerPlayerId?: string,
): string {
  const name = String(controllerName || controllerId || 'Unknown').trim() || 'Unknown';
  return `${name}'s permanents`;
}

function ownershipStyle(isYours: boolean): {
  border: string;
  tint: string;
  badgeBg: string;
  badgeText: string;
} {
  if (isYours) {
    return {
      border: 'rgba(56, 189, 248, 0.85)',
      tint: 'rgba(14, 116, 144, 0.18)',
      badgeBg: 'rgba(8, 145, 178, 0.95)',
      badgeText: '#ecfeff',
    };
  }
  return {
    border: 'rgba(251, 146, 60, 0.8)',
    tint: 'rgba(154, 52, 18, 0.16)',
    badgeBg: 'rgba(234, 88, 12, 0.95)',
    badgeText: '#fff7ed',
  };
}

function PermanentOwnershipBadge({
  isYours,
  controllerLabel,
}: {
  isYours: boolean;
  controllerLabel?: string;
}) {
  const style = ownershipStyle(isYours);
  const label = String(controllerLabel || 'Unknown').trim() || 'Unknown';
  return (
    <div
      style={{
        position: 'absolute',
        top: 4,
        left: 4,
        zIndex: 2,
        padding: '2px 6px',
        borderRadius: 4,
        fontSize: 9,
        fontWeight: 800,
        letterSpacing: '0.03em',
        color: style.badgeText,
        backgroundColor: style.badgeBg,
        boxShadow: '0 1px 4px rgba(0,0,0,0.45)',
        maxWidth: '78%',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
      }}
      title={label}
    >
      {label}
    </div>
  );
}

function PermanentTargetCaption({
  target,
  viewerPlayerId,
}: {
  target: TargetOption;
  viewerPlayerId?: string;
}) {
  const isYours = Boolean(viewerPlayerId && target.controller && target.controller === viewerPlayerId);
  // Prefer real table names for politics ("tap King's Command Tower").
  const controllerLabel = target.controllerName || target.controller;
  const ownerLabel = target.ownerName || target.owner;
  const showOwner = Boolean(ownerLabel && ownerLabel !== controllerLabel);
  return (
    <div
      style={{
        padding: '4px 6px',
        fontSize: 10,
        pointerEvents: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        minHeight: 34,
      }}
    >
      <div
        style={{
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          fontWeight: 600,
        }}
      >
        {target.displayName || target.name}
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 4,
          alignItems: 'center',
          color: '#9ca3af',
          lineHeight: 1.2,
        }}
      >
        {target.powerToughness && (
          <span
            data-testid="target-option-pt"
            title={
              typeof target.powerToughness.basePower === 'number' && typeof target.powerToughness.baseToughness === 'number'
                ? `Current P/T (printed ${target.powerToughness.basePower}/${target.powerToughness.baseToughness})`
                : 'Current P/T'
            }
            style={{ fontWeight: 800 }}
          >
            <span style={{ color: getPTColor(target.powerToughness.basePower, target.powerToughness.power) }}>
              {target.powerToughness.power}
            </span>
            <span style={{ color: '#d1d5db' }}>/</span>
            <span style={{ color: getPTColor(target.powerToughness.baseToughness, target.powerToughness.toughness) }}>
              {target.powerToughness.toughness}
            </span>
          </span>
        )}
        {typeof target.tapped === 'boolean' && (
          <span
            style={{
              color: target.tapped ? '#fbbf24' : '#86efac',
              fontWeight: 600,
            }}
          >
            {target.tapped ? 'Tapped' : 'Untapped'}
          </span>
        )}
        {controllerLabel ? (
          <span style={{ color: isYours ? '#67e8f9' : '#fdba74', fontWeight: 700 }}>
            {controllerLabel}
          </span>
        ) : null}
        {showOwner ? <span style={{ opacity: 0.85 }}>(owned by {ownerLabel})</span> : null}
      </div>
    </div>
  );
}

export interface TargetSelectionModalProps {
  open: boolean;
  title: string;
  description?: string;
  contextSteps?: string[];
  selectedMode?: { name: string; description?: string };
  viewerPlayerId?: string;
  source?: { name: string; imageUrl?: string };
  targets: TargetOption[];
  minTargets: number;
  maxTargets: number;
  /** Paid per chosen target (Magnetic Mountain untap); shows a running total. */
  costPerTarget?: number;
  /** Controller-grouped targeting, including each-player effects. */
  targetGroups?: TargetSelectionGroup[];
  /** When true, targets are chosen per opponent (up to N each). */
  perOpponent?: boolean;
  opponents?: Array<{ id: string; name: string }>;
  targetsPerOpponent?: Record<string, TargetOption[]>;
  minTargetsPerOpponent?: number;
  maxTargetsPerOpponent?: number;
  // Grouping
  groupByType?: boolean;
  groupByController?: boolean;
  // Selection handlers
  onConfirm: (selectedTargetIds: string[]) => void;
  onCancel: () => void;
}


export {
  formatControllerGroupLabel,
  ownershipStyle,
  PermanentOwnershipBadge,
  PermanentTargetCaption,
};

/** Marks a Flagbearer the player must target if able. */
export function FlagbearerRequiredBadge() {
  return (
    <div title="You must choose at least one Flagbearer" style={{ fontSize: 10, fontWeight: 700, color: '#fbbf24', background: 'rgba(251,191,36,0.15)', border: '1px solid #fbbf24', borderRadius: 4, padding: '1px 4px', marginTop: 2, display: 'inline-block' }}>
      Flagbearer — must target
    </div>
  );
}
