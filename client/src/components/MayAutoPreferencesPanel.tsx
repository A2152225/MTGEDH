/**
 * Persistent panel for viewing / clearing "you may" auto-preferences
 * (Always Yes / Always No / No until targets change / Yes ×N).
 * Mirrors IgnoredCardsPanel so preferences stay visible after the prompt closes.
 */

import React, { useState } from 'react';
import type { PlayerID } from '../../../shared/src';
import {
  formatMayAutoPreferenceLabel,
  splitMayAutoPreferenceEffectKey,
} from '../../../shared/src/mayAutoPreference';

export interface MayAutoPreferenceEntry {
  effectKey: string;
  value: 'yes' | 'no' | number | string;
}

interface Props {
  preferences: MayAutoPreferenceEntry[];
  onClear: (effectKey: string) => void;
  onClearAll: () => void;
  you?: PlayerID;
}

function titleCaseSource(name: string): string {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function MayAutoPreferencesPanel({ preferences, onClear, onClearAll }: Props) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  if (!preferences || preferences.length === 0) {
    return null;
  }

  if (isMinimized) {
    return (
      <div
        onClick={() => setIsMinimized(false)}
        style={{
          position: 'fixed',
          bottom: 16,
          left: 200,
          background: 'linear-gradient(135deg, rgba(220,38,38,0.9), rgba(185,28,28,0.9))',
          border: '2px solid #f87171',
          borderRadius: 8,
          padding: '8px 12px',
          cursor: 'pointer',
          zIndex: 1000,
          boxShadow: '0 4px 12px rgba(220,38,38,0.4)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
        title="Click to expand may-ability auto preferences"
      >
        <span style={{ fontSize: 16 }}>⛔</span>
        <span style={{ color: 'white', fontWeight: 600, fontSize: 12 }}>
          {preferences.length} Auto May
        </span>
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        left: 200,
        background: 'linear-gradient(135deg, rgba(40,20,20,0.95), rgba(50,25,25,0.95))',
        border: '2px solid #ef4444',
        borderRadius: 12,
        padding: isCollapsed ? '8px 12px' : 16,
        minWidth: isCollapsed ? 200 : 280,
        maxWidth: 360,
        maxHeight: 400,
        overflowY: 'auto',
        zIndex: 1000,
        boxShadow: '0 8px 32px rgba(239,68,68,0.3)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer',
          marginBottom: isCollapsed ? 0 : 12,
        }}
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>⛔</span>
          <span style={{ fontSize: 14, fontWeight: 'bold', color: '#e5e7eb' }}>
            Auto May Preferences
          </span>
          <span style={{
            background: '#ef4444',
            color: 'white',
            padding: '2px 8px',
            borderRadius: 10,
            fontSize: 11,
            fontWeight: 'bold',
          }}>
            {preferences.length}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsMinimized(true);
            }}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#9ca3af',
              cursor: 'pointer',
              fontSize: 14,
              padding: '2px 6px',
            }}
            title="Minimize"
          >
            ─
          </button>
          <span style={{ color: '#9ca3af', fontSize: 12 }}>
            {isCollapsed ? '▸' : '▾'}
          </span>
        </div>
      </div>

      {isCollapsed ? (
        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
          {preferences.length} may abilit{preferences.length !== 1 ? 'ies' : 'y'} auto-responding
        </div>
      ) : (
        <>
          <div style={{
            fontSize: 11,
            color: '#9ca3af',
            marginBottom: 12,
            paddingBottom: 8,
            borderBottom: '1px solid rgba(239,68,68,0.2)',
          }}>
            These optional abilities skip or auto-accept without prompts. Click ✕ to ask each time again.
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {preferences.map((entry) => {
              const { sourceName, effectText } = splitMayAutoPreferenceEffectKey(entry.effectKey);
              const label = formatMayAutoPreferenceLabel(entry.value);
              return (
                <div
                  key={entry.effectKey}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    padding: '10px 12px',
                    background: 'rgba(239,68,68,0.1)',
                    border: '1px solid rgba(239,68,68,0.3)',
                    borderRadius: 8,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: '#e5e7eb',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
                      {titleCaseSource(sourceName)}
                    </div>
                    {effectText ? (
                      <div style={{
                        fontSize: 11,
                        color: '#fca5a5',
                        marginTop: 2,
                        fontStyle: 'italic',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                      }}>
                        {effectText}
                      </div>
                    ) : null}
                    <div style={{
                      fontSize: 11,
                      color: '#fbbf24',
                      marginTop: 4,
                      fontWeight: 500,
                    }}>
                      {label}
                    </div>
                  </div>

                  <button
                    onClick={() => onClear(entry.effectKey)}
                    title="Ask each time again"
                    style={{
                      padding: '4px 8px',
                      fontSize: 12,
                      borderRadius: 4,
                      border: '1px solid #ef4444',
                      background: 'rgba(239,68,68,0.2)',
                      color: '#fca5a5',
                      cursor: 'pointer',
                      flexShrink: 0,
                    }}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>

          {preferences.length > 1 && (
            <button
              onClick={onClearAll}
              style={{
                width: '100%',
                marginTop: 12,
                padding: '8px 12px',
                fontSize: 12,
                borderRadius: 6,
                border: '1px solid #6b7280',
                background: 'rgba(107,114,128,0.2)',
                color: '#d1d5db',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              Clear All Preferences
            </button>
          )}
        </>
      )}
    </div>
  );
}

export default MayAutoPreferencesPanel;
