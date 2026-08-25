// Origin parent: client/src/components/CombatSelectionModal.tsx
// Cluster moved: DangerBadge, DangerIndicatorBadges.
// Public entry symbols: DangerIndicatorBadges.
// Leaf must not import CombatSelectionModal.tsx or CombatSelectionModal-handlers/index.ts.

import React from 'react';
import type { DangerIndicators } from './combatSelectionModalCreatureInfo';

/**
 * Danger badge component for displaying combat abilities
 */
function DangerBadge({ label, color, tooltip }: { label: string; color: string; tooltip: string }) {
  return (
    <span
      title={tooltip}
      style={{
        display: 'inline-block',
        padding: '2px 4px',
        fontSize: 8,
        fontWeight: 600,
        borderRadius: 3,
        backgroundColor: color,
        color: '#fff',
        marginRight: 2,
        marginBottom: 2,
        textShadow: '0 1px 1px rgba(0,0,0,0.5)',
      }}
    >
      {label}
    </span>
  );
}

/**
 * Render danger indicators for a creature
 */
export function DangerIndicatorBadges({ dangers }: { dangers: DangerIndicators }) {
  const badges: React.ReactNode[] = [];
  
  // Goad indicator - show first as it affects combat requirements
  if (dangers.goaded) {
    const goadedByCount = dangers.goadedBy?.length || 1;
    const goadTooltip = goadedByCount > 1 
      ? `Goaded by ${goadedByCount} players - Must attack if able, cannot attack goaders unless only option`
      : 'Goaded - Must attack if able, cannot attack goader unless only option';
    badges.push(<DangerBadge key="goad" label="🎯GOAD" color="#d97706" tooltip={goadTooltip} />);
  }
  
  if (dangers.lure) {
    badges.push(<DangerBadge key="lure" label="🧲LURE" color="#f472b6" tooltip="Lure - All creatures able to block this creature must do so" />);
  }
  
  if (dangers.deathtouch) {
    badges.push(<DangerBadge key="dt" label="☠️DT" color="#10b981" tooltip="Deathtouch - Any damage destroys" />);
  }
  if (dangers.infect) {
    badges.push(<DangerBadge key="inf" label="☣️INF" color="#22c55e" tooltip="Infect - Deals damage as poison/−1/−1 counters" />);
  }
  if (dangers.toxic > 0) {
    badges.push(<DangerBadge key="tox" label={`☠️T${dangers.toxic}`} color="#84cc16" tooltip={`Toxic ${dangers.toxic} - Deals ${dangers.toxic} poison counter(s) on combat damage`} />);
  }
  if (dangers.trample) {
    badges.push(<DangerBadge key="trm" label="🦶TRM" color="#34d399" tooltip="Trample - Excess damage goes through" />);
  }
  if (dangers.menace) {
    badges.push(<DangerBadge key="men" label="👹MEN" color="#f87171" tooltip="Menace - Must be blocked by 2+ creatures" />);
  }
  if (dangers.firstStrike) {
    badges.push(<DangerBadge key="1st" label="⚡1ST" color="#ef4444" tooltip="First Strike - Deals damage first" />);
  }
  if (dangers.doubleStrike) {
    badges.push(<DangerBadge key="2x" label="⚡⚡2X" color="#dc2626" tooltip="Double Strike - Deals first strike and normal damage" />);
  }
  if (dangers.lifelink) {
    badges.push(<DangerBadge key="ll" label="❤️LL" color="#f0abfc" tooltip="Lifelink - Damage heals controller" />);
  }
  if (dangers.indestructible) {
    badges.push(<DangerBadge key="ind" label="🛡️IND" color="#eab308" tooltip="Indestructible - Cannot be destroyed" />);
  }
  
  if (badges.length === 0) return null;
  
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', marginTop: 4, justifyContent: 'center' }}>
      {badges}
    </div>
  );
}
