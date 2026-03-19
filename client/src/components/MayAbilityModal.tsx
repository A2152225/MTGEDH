/**
 * MayAbilityModal.tsx
 *
 * Prompt shown to a human player when a triggered or activated ability
 * contains an optional "you may" effect (e.g. "You may draw a card.").
 *
 * Features
 * ─────────
 * • Shows the source card image, the full trigger text and the specific
 *   optional effect.
 * • Yes / No buttons that submit a Resolution Queue response.
 * • "Always yes" / "Always no" toggles that persist the preference via the
 *   `setMayAutoPreference` socket event so future instances auto-resolve.
 * • An "undo preference" link so the player can clear a saved preference
 *   inline without opening a settings panel.
 */

import React, { useState } from 'react';
import { socket } from '../socket';

export interface MayAbilityModalData {
  /** Resolution queue step ID to respond to */
  stepId: string;
  /** Display name of the source card/ability */
  sourceName: string;
  /** URL of the source card image (optional) */
  sourceImage?: string;
  /** Short description of just the optional part, e.g. "draw a card" */
  effectText: string;
  /** Full oracle sentence for context, e.g. "Whenever ~ enters, you may draw a card." */
  fullAbilityText?: string;
  /** Opaque key used to store the auto-preference ("{sourceName_lower}:{effectText_lower}") */
  effectKey: string;
  /** Game ID, needed to emit setMayAutoPreference */
  gameId: string;
}

export interface MayAbilityModalProps {
  open: boolean;
  data: MayAbilityModalData | null;
  onYes: (stepId: string) => void;
  onNo: (stepId: string) => void;
}

export function MayAbilityModal({ open, data, onYes, onNo }: MayAbilityModalProps) {
  const [saving, setSaving] = useState(false);
  const [yesCount, setYesCount] = useState(2);

  if (!open || !data) return null;

  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  const handleSetAutoPreference = (value: 'yes' | 'no') => {
    setSaving(true);
    socket.emit('setMayAutoPreference', {
      gameId: data.gameId,
      effectKey: data.effectKey,
      value,
    });
    if (value === 'yes') {
      onYes(data.stepId);
    } else {
      onNo(data.stepId);
    }
    setSaving(false);
  };

  /**
   * Yes for N times: fire yes now (current instance) and store a countdown
   * of N-1 so the next N-1 occurrences auto-resolve yes, then revert to prompting.
   */
  const handleYesForN = (n: number) => {
    const remaining = Math.max(1, Math.floor(n)) - 1;
    if (remaining > 0) {
      socket.emit('setMayAutoPreference', {
        gameId: data.gameId,
        effectKey: data.effectKey,
        value: remaining,
      });
    }
    onYes(data.stepId);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.80)',
        zIndex: 10010,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
          border: '1px solid rgba(147, 112, 219, 0.45)',
          borderRadius: 14,
          width: 440,
          maxWidth: '96vw',
          padding: '22px 24px 20px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.55)',
          color: '#e8e8f0',
          fontFamily: 'inherit',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
          {data.sourceImage && (
            <img
              src={data.sourceImage}
              alt={data.sourceName}
              style={{
                width: 54,
                height: 75,
                borderRadius: 5,
                objectFit: 'cover',
                boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
                flexShrink: 0,
              }}
            />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, color: '#9a8fc0', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 3 }}>
              Optional Ability
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#d4c4ff', lineHeight: 1.2 }}>
              {data.sourceName}
            </div>
          </div>
        </div>

        {/* Trigger text */}
        {data.fullAbilityText && (
          <div
            style={{
              fontSize: 13,
              color: '#b0a8c8',
              fontStyle: 'italic',
              background: 'rgba(255,255,255,0.04)',
              borderRadius: 7,
              padding: '8px 11px',
              marginBottom: 14,
              lineHeight: 1.45,
            }}
          >
            {data.fullAbilityText}
          </div>
        )}

        {/* Decision prompt */}
        <div style={{ fontSize: 15, color: '#e8e4f8', marginBottom: 20, lineHeight: 1.4 }}>
          Do you want to{' '}
          <span style={{ color: '#b8a0ff', fontWeight: 600 }}>
            {capitalize(data.effectText)}
          </span>
          ?
        </div>

        {/* Primary buttons */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
          <button
            disabled={saving}
            onClick={() => onYes(data.stepId)}
            style={{
              flex: 1,
              padding: '10px 0',
              background: 'linear-gradient(135deg, #4e3b8a, #6a4fa0)',
              border: '1px solid #7c5fc8',
              borderRadius: 8,
              color: '#fff',
              fontSize: 15,
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
          >
            Yes
          </button>
          <button
            disabled={saving}
            onClick={() => onNo(data.stepId)}
            style={{
              flex: 1,
              padding: '10px 0',
              background: 'rgba(255,255,255,0.07)',
              border: '1px solid rgba(255,255,255,0.18)',
              borderRadius: 8,
              color: '#c8c0e0',
              fontSize: 15,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.75')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
          >
            No
          </button>
        </div>

        {/* Yes for N times row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 14,
            padding: '9px 11px',
            background: 'rgba(255,255,255,0.04)',
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.07)',
          }}
        >
          <span style={{ fontSize: 13, color: '#b0a8c8', flexShrink: 0 }}>Yes for</span>
          <input
            type="number"
            min={1}
            max={99}
            value={yesCount}
            onChange={e => setYesCount(Math.max(1, parseInt(e.target.value, 10) || 1))}
            style={{
              width: 48,
              padding: '3px 6px',
              borderRadius: 5,
              border: '1px solid rgba(255,255,255,0.2)',
              background: 'rgba(255,255,255,0.1)',
              color: '#e8e4f8',
              fontSize: 14,
              textAlign: 'center',
            }}
          />
          <span style={{ fontSize: 13, color: '#b0a8c8', flex: 1 }}>times, then skip</span>
          <button
            disabled={saving}
            onClick={() => handleYesForN(yesCount)}
            style={{
              padding: '5px 13px',
              background: 'rgba(80, 160, 80, 0.18)',
              border: '1px solid rgba(100, 200, 100, 0.35)',
              borderRadius: 6,
              color: '#9ee09e',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              opacity: saving ? 0.5 : 1,
            }}
            title={`Say yes to this effect ${yesCount} time(s), then stop auto-resolving`}
          >
            Yes ×{yesCount}
          </button>
        </div>

        {/* Auto-preference section */}
        <div
          style={{
            borderTop: '1px solid rgba(255,255,255,0.08)',
            paddingTop: 12,
            display: 'flex',
            justifyContent: 'center',
            gap: 16,
          }}
        >
          <button
            disabled={saving}
            onClick={() => handleSetAutoPreference('yes')}
            style={{
              background: 'none',
              border: 'none',
              color: '#7cc87c',
              fontSize: 12,
              cursor: 'pointer',
              textDecoration: 'underline',
              padding: 0,
              opacity: saving ? 0.5 : 1,
            }}
            title={`Always automatically say Yes to "${data.effectText}" from ${data.sourceName}`}
          >
            Always Yes
          </button>
          <span style={{ color: '#555', fontSize: 12 }}>·</span>
          <button
            disabled={saving}
            onClick={() => handleSetAutoPreference('no')}
            style={{
              background: 'none',
              border: 'none',
              color: '#c87c7c',
              fontSize: 12,
              cursor: 'pointer',
              textDecoration: 'underline',
              padding: 0,
              opacity: saving ? 0.5 : 1,
            }}
            title={`Always automatically say No to "${data.effectText}" from ${data.sourceName}`}
          >
            Always No
          </button>
        </div>
      </div>
    </div>
  );
}

export default MayAbilityModal;
