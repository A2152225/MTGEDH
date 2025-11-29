/**
 * IgnoredTriggersPanel.tsx
 * 
 * A separate, persistent UI panel for viewing and managing ignored/auto-resolved triggers.
 * This panel is always visible (when there are ignored sources) regardless of the stack state,
 * allowing players to see which triggers are being auto-resolved and stop ignoring specific sources.
 * 
 * Requirements addressed:
 * - All players can see and manage their ignored trigger sources
 * - Separate from the stack UI so it's visible even when the stack is empty
 * - Shows counts of auto-resolved triggers
 */

import React, { useState } from 'react';
import type { PlayerID } from '../../../shared/src';

export interface IgnoredTriggerSource {
  sourceName: string;
  count: number;
  effect: string;
  imageUrl?: string;
}

interface Props {
  ignoredSources: Map<string, IgnoredTriggerSource>;
  onStopIgnoring: (sourceKey: string) => void;
  you?: PlayerID;
}

export function IgnoredTriggersPanel({ ignoredSources, onStopIgnoring, you }: Props) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  // Don't render if no ignored sources
  if (!ignoredSources || ignoredSources.size === 0) {
    return null;
  }

  const totalCount = Array.from(ignoredSources.values()).reduce((sum, s) => sum + s.count, 0);

  if (isMinimized) {
    return (
      <div
        onClick={() => setIsMinimized(false)}
        style={{
          position: 'fixed',
          bottom: 16,
          right: 16,
          background: 'linear-gradient(135deg, rgba(99,102,241,0.9), rgba(139,92,246,0.9))',
          border: '2px solid #818cf8',
          borderRadius: 8,
          padding: '8px 12px',
          cursor: 'pointer',
          zIndex: 1000,
          boxShadow: '0 4px 12px rgba(99,102,241,0.4)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
        title="Click to expand ignored triggers panel"
      >
        <span style={{ fontSize: 16 }}>🔄</span>
        <span style={{ color: 'white', fontWeight: 600, fontSize: 12 }}>
          {totalCount} Auto-resolved
        </span>
        <span style={{
          background: 'rgba(255,255,255,0.2)',
          borderRadius: 10,
          padding: '2px 8px',
          fontSize: 11,
          color: 'white',
        }}>
          {ignoredSources.size} source{ignoredSources.size !== 1 ? 's' : ''}
        </span>
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        background: 'linear-gradient(135deg, rgba(30,30,50,0.95), rgba(40,40,70,0.95))',
        border: '2px solid #6366f1',
        borderRadius: 12,
        padding: isCollapsed ? '8px 12px' : 16,
        minWidth: isCollapsed ? 200 : 280,
        maxWidth: 360,
        maxHeight: 400,
        overflowY: 'auto',
        zIndex: 1000,
        boxShadow: '0 8px 32px rgba(99,102,241,0.3)',
        backdropFilter: 'blur(8px)',
      }}
    >
      {/* Header */}
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
          <span style={{ fontSize: 18 }}>🔄</span>
          <span style={{
            fontSize: 14,
            fontWeight: 'bold',
            color: '#e5e7eb',
          }}>
            Auto-Resolving Triggers
          </span>
          <span style={{
            background: '#6366f1',
            color: 'white',
            padding: '2px 8px',
            borderRadius: 10,
            fontSize: 11,
            fontWeight: 'bold',
          }}>
            {totalCount}
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

      {/* Collapsed view - just show source count */}
      {isCollapsed ? (
        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
          {ignoredSources.size} trigger source{ignoredSources.size !== 1 ? 's' : ''} being auto-resolved
        </div>
      ) : (
        <>
          {/* Description */}
          <div style={{
            fontSize: 11,
            color: '#9ca3af',
            marginBottom: 12,
            paddingBottom: 8,
            borderBottom: '1px solid rgba(99,102,241,0.2)',
          }}>
            These triggers are automatically resolved without prompts. Click ✕ to stop auto-resolving.
          </div>

          {/* Source list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {Array.from(ignoredSources.entries()).map(([key, data]) => (
              <div
                key={key}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  padding: '10px 12px',
                  background: 'rgba(99,102,241,0.1)',
                  border: '1px solid rgba(99,102,241,0.3)',
                  borderRadius: 8,
                }}
              >
                {/* Card image */}
                {data.imageUrl && (
                  <img
                    src={data.imageUrl}
                    alt={data.sourceName}
                    style={{
                      width: 40,
                      height: 56,
                      borderRadius: 4,
                      objectFit: 'cover',
                      border: '1px solid rgba(255,255,255,0.2)',
                      flexShrink: 0,
                    }}
                  />
                )}

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#e5e7eb',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {data.sourceName}
                  </div>
                  <div style={{
                    fontSize: 11,
                    color: '#a78bfa',
                    marginTop: 2,
                    fontStyle: 'italic',
                  }}>
                    {data.effect}
                  </div>
                  <div style={{
                    fontSize: 11,
                    color: '#10b981',
                    marginTop: 4,
                    fontWeight: 500,
                  }}>
                    {data.count}× auto-resolved
                  </div>
                </div>

                {/* Stop ignoring button */}
                <button
                  onClick={() => onStopIgnoring(key)}
                  title="Stop auto-resolving this trigger source"
                  style={{
                    padding: '4px 8px',
                    fontSize: 12,
                    borderRadius: 4,
                    border: '1px solid #ef4444',
                    background: 'rgba(239,68,68,0.2)',
                    color: '#fca5a5',
                    cursor: 'pointer',
                    flexShrink: 0,
                    transition: 'all 0.2s',
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.background = 'rgba(239,68,68,0.4)';
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.background = 'rgba(239,68,68,0.2)';
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          {/* Clear all button */}
          {ignoredSources.size > 1 && (
            <button
              onClick={() => {
                for (const key of ignoredSources.keys()) {
                  onStopIgnoring(key);
                }
              }}
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
              Stop Auto-Resolving All
            </button>
          )}
        </>
      )}
    </div>
  );
}

export default IgnoredTriggersPanel;
