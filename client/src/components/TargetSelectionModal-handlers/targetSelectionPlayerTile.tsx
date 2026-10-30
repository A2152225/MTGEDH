// Origin parent: client/src/components/TargetSelectionModal.tsx
// Cluster moved: the two inline player-target tiles (opponent sections and type groups),
// plus the "reuse for identical triggers" footer toggle.
// Public entry symbols: PlayerTargetTile, RepeatForIdenticalTriggersToggle.
// Leaf must not import TargetSelectionModal.tsx or TargetSelectionModal-handlers/index.ts.

import React from 'react';
import type { TargetOption } from './targetSelectionModalSupport';
import { lifeTotalColor } from '../../utils/gameDisplayHelpers';

export function PlayerTargetTile({
  target,
  damagePreview,
  modeNote,
}: {
  target: TargetOption;
  damagePreview?: number;
  modeNote?: { text: string; preferred: boolean };
}) {
  const hasLife = typeof target.life === 'number';
  const lifeAfter = hasLife && typeof damagePreview === 'number' ? (target.life as number) - damagePreview : undefined;
  return (
    <div
      style={{
        position: 'relative',
        minHeight: 110,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 2,
        padding: 8,
        textAlign: 'center',
        pointerEvents: 'none',
        backgroundImage: target.imageUrl
          ? `linear-gradient(rgba(0,0,0,0.15), rgba(0,0,0,0.85)), url(${target.imageUrl})`
          : 'linear-gradient(135deg, #1f2937, #111827)',
        backgroundSize: 'cover',
        backgroundPosition: 'center top',
      }}
    >
      {!target.imageUrl && <div style={{ fontSize: 24, marginBottom: 'auto', paddingTop: 8 }}>👤</div>}
      <div style={{ fontWeight: 700, fontSize: 13, textShadow: '0 1px 3px #000' }}>
        {target.displayName || target.name}
      </div>
      {hasLife && (
        <div data-testid="target-option-life" style={{ fontSize: 18, fontWeight: 800, color: lifeTotalColor(target.life as number), textShadow: '0 1px 3px #000' }}>
          ♥ {target.life}
        </div>
      )}
      {typeof lifeAfter === 'number' && (
        <div style={{ fontSize: 10, color: lifeAfter <= 0 ? '#f87171' : '#fca5a5', fontWeight: 700 }}>
          {damagePreview} damage → {lifeAfter} life
        </div>
      )}
      {modeNote && (
        <div style={{ fontSize: 10, color: modeNote.preferred ? '#f59e0b' : '#888' }}>{modeNote.text}</div>
      )}
    </div>
  );
}

export function RepeatForIdenticalTriggersToggle({
  checked,
  onChange,
  sourceName,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  sourceName?: string;
}) {
  return (
    <label
      style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#d1d5db', marginRight: 'auto', cursor: 'pointer' }}
      title="Each following identical trigger is sent to this target automatically while it stays legal. You are asked again if it becomes illegal."
    >
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      Use this target for the remaining {sourceName ? `${sourceName} ` : ''}triggers
    </label>
  );
}
