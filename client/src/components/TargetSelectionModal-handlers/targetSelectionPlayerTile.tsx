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
  count,
  maxCount,
  onCountChange,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  sourceName?: string;
  /** How many of the following triggers reuse this target (the rest ask again). */
  count: number;
  maxCount: number;
  onCountChange: (next: number) => void;
}) {
  const clamp = (value: number) => Math.max(1, Math.min(maxCount, Math.floor(value) || 1));
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#d1d5db', marginRight: 'auto' }}
      title="That many following identical triggers go to this target automatically while it stays legal; after that you choose again."
    >
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        Also use this target for the next
      </label>
      <input
        type="number"
        min={1}
        max={maxCount}
        value={count}
        onChange={(e) => {
          onCountChange(clamp(Number(e.target.value)));
          onChange(true);
        }}
        style={{ width: 48, textAlign: 'center', fontSize: 12, padding: '1px 4px' }}
        aria-label="Number of following triggers to send to this target"
      />
      <span>of {maxCount} remaining {sourceName ? `${sourceName} ` : ''}triggers</span>
    </div>
  );
}
