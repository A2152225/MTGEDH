/**
 * Toggle + panel for kitchen-table Manual Mode.
 * Clicking the button again hides the verb options; the toggle itself stays.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  MANUAL_VERB_CATALOG,
  type ManualVerbCategory,
  type ManualVerbDef,
} from '../../../shared/src/manualAction';
import { colors, fontSize, radii, spacing, z } from '../theme';
import {
  isManualModeEnabled,
  setManualModeEnabled,
  subscribeManualMode,
} from '../utils/manualModeStore';
import { ManualModeVerbForm } from './ManualMode-handlers/ManualModeVerbForm';
import type { ManualAck } from './ManualMode-handlers/manualModeEmit';

const CATEGORIES: ManualVerbCategory[] = [
  'Library',
  'Hand',
  'Graveyard',
  'Exile',
  'Battlefield',
  'Stack',
  'State & numbers',
  'Turn & game',
];

const toggleStyle = (enabled: boolean, variant: 'rail' | 'settings' | 'mobile'): React.CSSProperties => ({
  width: '100%',
  padding: variant === 'mobile' ? '12px 14px' : '8px 12px',
  minHeight: variant === 'mobile' ? 48 : undefined,
  borderRadius: radii.md,
  border: enabled ? `1px solid ${colors.accent}` : '1px solid #444',
  backgroundColor: enabled ? 'rgba(212,169,94,0.22)' : variant === 'mobile' ? colors.surfaceTransparent : '#2a2a2a',
  color: colors.textPrimary,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: variant === 'mobile' ? 'flex-start' : 'center',
  gap: 8,
  fontSize: variant === 'mobile' ? fontSize.md : 13,
  fontWeight: 600,
  textAlign: variant === 'mobile' ? 'left' : 'center',
});

export function ManualModeControl(props: {
  gameId?: string | null;
  you?: string | null;
  view?: any;
  variant?: 'rail' | 'settings' | 'mobile';
}): React.ReactElement | null {
  const variant = props.variant || 'rail';
  const [enabled, setEnabled] = useState(isManualModeEnabled);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ManualVerbCategory | 'All'>('All');
  const [selected, setSelected] = useState<ManualVerbDef | null>(null);
  const [status, setStatus] = useState('');

  useEffect(() => subscribeManualMode(() => setEnabled(isManualModeEnabled())), []);

  const verbs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return MANUAL_VERB_CATALOG.filter((verb) => {
      if (category !== 'All' && verb.category !== category) return false;
      if (!q) return true;
      return `${verb.label} ${verb.behavior} ${verb.category}`.toLowerCase().includes(q);
    });
  }, [query, category]);

  if (!props.gameId || !props.you) return null;

  return (
    <div>
      <button
        type="button"
        onClick={() => setManualModeEnabled(!enabled)}
        style={toggleStyle(enabled, variant)}
        title="Manually change the table when a card does not work. Changes are logged for replay."
      >
        ✎ Manual Mode{enabled ? ' · On' : ''}
      </button>

      {enabled && (
        <div
          style={{
            marginTop: 8,
            padding: 12,
            borderRadius: radii.lg,
            border: `1px solid ${colors.accent}`,
            backgroundColor: '#16161f',
            color: colors.textPrimary,
            maxHeight: variant === 'mobile' ? '70vh' : 520,
            overflow: 'auto',
            position: variant === 'settings' ? 'relative' : undefined,
            zIndex: variant === 'settings' ? z.popover : undefined,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: fontSize.sm, marginBottom: 6 }}>
            Manual table actions
          </div>
          <div style={{ fontSize: fontSize.xs, color: colors.textSecondary, marginBottom: 10 }}>
            Physical corrections only — no triggers or replacement effects. Every apply is written to the game log for replay.
            Right-click cards for extra Move to… options while this is on.
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search verbs…"
            style={{
              width: '100%',
              marginBottom: 8,
              padding: '6px 8px',
              borderRadius: radii.sm,
              border: `1px solid ${colors.border}`,
              background: '#111',
              color: colors.textPrimary,
              fontSize: fontSize.sm,
            }}
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
            {(['All', ...CATEGORIES] as Array<ManualVerbCategory | 'All'>).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => { setCategory(cat); setSelected(null); }}
                style={{
                  padding: '3px 8px',
                  borderRadius: radii.pill,
                  border: category === cat ? `1px solid ${colors.accent}` : `1px solid ${colors.border}`,
                  background: category === cat ? colors.accentSoft : 'transparent',
                  color: colors.textPrimary,
                  cursor: 'pointer',
                  fontSize: fontSize.xxs,
                }}
              >
                {cat}
              </button>
            ))}
          </div>
          {!selected && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {verbs.map((verb) => (
                <button
                  key={verb.id}
                  type="button"
                  onClick={() => setSelected(verb)}
                  style={{
                    textAlign: 'left',
                    padding: '6px 8px',
                    borderRadius: radii.sm,
                    border: `1px solid ${colors.borderSubtle}`,
                    background: 'transparent',
                    color: colors.textPrimary,
                    cursor: 'pointer',
                    fontSize: fontSize.sm,
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{verb.label}</div>
                  <div style={{ fontSize: fontSize.xxs, color: colors.textMuted }}>{verb.category}</div>
                </button>
              ))}
            </div>
          )}
          {selected && (
            <div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                style={{
                  marginBottom: 8,
                  border: 'none',
                  background: 'transparent',
                  color: colors.accentStrong,
                  cursor: 'pointer',
                  fontSize: fontSize.xs,
                }}
              >
                ← {selected.label}
              </button>
              <ManualModeVerbForm
                key={selected.id}
                gameId={props.gameId}
                you={props.you}
                view={props.view}
                verb={selected}
                onResult={(ack: ManualAck) => {
                  setStatus(ack.ok ? (ack.summary || 'Applied.') : (ack.error || 'Failed.'));
                }}
              />
            </div>
          )}
          {status && (
            <div style={{ marginTop: 8, fontSize: fontSize.xs, color: colors.accentStrong }}>{status}</div>
          )}
        </div>
      )}
    </div>
  );
}

export default ManualModeControl;
