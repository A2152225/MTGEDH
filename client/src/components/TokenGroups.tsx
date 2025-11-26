import React, { useMemo, useState, useRef, useEffect } from 'react';
import type { BattlefieldPermanent } from '../../../shared/src';

function sigCounters(c?: Readonly<Record<string, number>>) {
  const entries = Object.entries(c || {}).filter(([, v]) => (v || 0) > 0).sort(([a], [b]) => a.localeCompare(b));
  return entries.map(([k, v]) => `${k}:${v}`).join('|');
}
function sigPT(p?: number, t?: number) {
  return (p ?? '-') + '/' + (t ?? '-');
}

type GroupMode = 'name' | 'name+counters' | 'name+pt+attach' | 'name+counters+pt+attach';

// Threshold for when to collapse tokens into a popup
const COLLAPSE_THRESHOLD = 5;

/** Token group data structure */
interface TokenGroup {
  key: string;
  name: string;
  countersSig: string;
  ptSig: string;
  attached: boolean;
  ids: string[];
  token?: BattlefieldPermanent;
}

export function TokenGroups(props: {
  tokens: BattlefieldPermanent[];
  groupMode: GroupMode;
  attachedToSet?: Set<string>;
  onBulkCounter: (ids: string[], deltas: Record<string, number>) => void;
  // Targeting support for tokens
  highlightTargets?: ReadonlySet<string>;
  selectedTargets?: ReadonlySet<string>;
  onTokenClick?: (id: string) => void;
  // New: Allow collapsible mode for many tokens
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}) {
  const { tokens, groupMode, attachedToSet, onBulkCounter, highlightTargets, selectedTargets, onTokenClick,
    collapsible = true, defaultCollapsed = false } = props;
  const [expanded, setExpanded] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const [popupOpen, setPopupOpen] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);

  // Auto-collapse when there are many tokens
  const shouldShowCollapseOption = collapsible && tokens.length >= COLLAPSE_THRESHOLD;

  // Close popup when clicking outside
  useEffect(() => {
    if (!popupOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setPopupOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPopupOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [popupOpen]);

  const groups = useMemo<TokenGroup[]>(() => {
    const map = new Map<string, TokenGroup>();
    for (const t of tokens) {
      const name = ((t.card as any)?.name as string) || 'Token';
      const countersSig = sigCounters(t.counters);
      const pt = sigPT(t.basePower, t.baseToughness);
      const attached = attachedToSet?.has(t.id) ?? false;

      let key = name;
      if (groupMode.includes('pt')) key += `|pt:${pt}`;
      if (groupMode.includes('counters')) key += `|c:${countersSig}`;
      if (groupMode.includes('attach')) key += `|attach:${attached ? 'y' : 'n'}`;

      const g = map.get(key) || { key, name, countersSig, ptSig: pt, attached, ids: [], token: t };
      g.ids.push(t.id);
      map.set(key, g);
    }
    return Array.from(map.values());
  }, [tokens, groupMode, attachedToSet]);

  // Collapsed summary view
  if (shouldShowCollapseOption && isCollapsed) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        background: 'rgba(0,0,0,0.4)',
        borderRadius: 8,
        border: '1px solid rgba(255,255,255,0.1)',
      }}>
        <span style={{ fontSize: 14 }}>🪙</span>
        <span style={{ color: '#e5e5e5', fontWeight: 500 }}>
          {tokens.length} Token{tokens.length !== 1 ? 's' : ''} ({groups.length} type{groups.length !== 1 ? 's' : ''})
        </span>
        <button
          onClick={() => setPopupOpen(true)}
          style={{
            background: 'rgba(59,130,246,0.2)',
            border: '1px solid rgba(59,130,246,0.4)',
            borderRadius: 4,
            padding: '3px 8px',
            fontSize: 11,
            color: '#93c5fd',
            cursor: 'pointer',
          }}
        >
          Manage
        </button>
        <button
          onClick={() => setIsCollapsed(false)}
          style={{
            background: 'transparent',
            border: 'none',
            padding: '2px 6px',
            fontSize: 11,
            color: '#9ca3af',
            cursor: 'pointer',
          }}
        >
          Expand ▼
        </button>

        {/* Popup modal for token management */}
        {popupOpen && (
          <div
            ref={popupRef}
            style={{
              position: 'fixed',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              zIndex: 9000,
              background: '#1a1a2e',
              border: '1px solid #4a4a6a',
              borderRadius: 12,
              boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
              padding: 16,
              maxWidth: '90vw',
              maxHeight: '80vh',
              overflow: 'auto',
              minWidth: 400,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0, color: '#fff', fontSize: 16 }}>
                🪙 Token Management ({tokens.length} total)
              </h3>
              <button
                onClick={() => setPopupOpen(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: 18,
                  color: '#888',
                  cursor: 'pointer',
                }}
              >
                ×
              </button>
            </div>
            <TokenGroupsContent
              groups={groups}
              expanded={expanded}
              setExpanded={setExpanded}
              onBulkCounter={onBulkCounter}
              highlightTargets={highlightTargets}
              selectedTargets={selectedTargets}
              onTokenClick={onTokenClick}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      {shouldShowCollapseOption && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
          <button
            onClick={() => setIsCollapsed(true)}
            style={{
              background: 'transparent',
              border: 'none',
              padding: '2px 8px',
              fontSize: 11,
              color: '#9ca3af',
              cursor: 'pointer',
            }}
          >
            Collapse ▲
          </button>
        </div>
      )}
      <TokenGroupsContent
        groups={groups}
        expanded={expanded}
        setExpanded={setExpanded}
        onBulkCounter={onBulkCounter}
        highlightTargets={highlightTargets}
        selectedTargets={selectedTargets}
        onTokenClick={onTokenClick}
      />
    </div>
  );
}

// Extracted content component for reuse
function TokenGroupsContent(props: {
  groups: TokenGroup[];
  expanded: string | null;
  setExpanded: (key: string | null) => void;
  onBulkCounter: (ids: string[], deltas: Record<string, number>) => void;
  highlightTargets?: ReadonlySet<string>;
  selectedTargets?: ReadonlySet<string>;
  onTokenClick?: (id: string) => void;
}) {
  const { groups, expanded, setExpanded, onBulkCounter, highlightTargets, selectedTargets, onTokenClick } = props;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
      {groups.map(g => {
        const oneId = g.ids.length === 1 ? g.ids[0] : null;
        const canQuickTarget = !!oneId && (highlightTargets?.has(oneId!) ?? false);
        const isSelected = !!oneId && (selectedTargets?.has(oneId!) ?? false);

        return (
          <div key={g.key} style={{ border: '1px solid #ddd', borderRadius: 6, padding: 8, background: '#111', color: '#eee' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <div>
                <div style={{ fontWeight: 600 }}>{g.name}</div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>
                  {g.ptSig !== '-/-' ? g.ptSig : ''} {g.countersSig ? ` • ${g.countersSig}` : ''} {g.attached ? ' • attached' : ''}
                </div>
              </div>
              <div style={{ fontWeight: 700 }}>{g.ids.length}×</div>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              <button onClick={() => onBulkCounter(g.ids, { '+1/+1': +1 })}>All +1/+1</button>
              <button onClick={() => onBulkCounter(g.ids, { '+1/+1': -1 })}>All -1/+1</button>
              <button onClick={() => onBulkCounter(g.ids, { '-1/-1': +1 })}>All -1/-1</button>
              <button onClick={() => onBulkCounter(g.ids, { '-1/-1': -1 })}>All +1/-1</button>
              <button onClick={() => setExpanded(expanded === g.key ? null : g.key)}>{expanded === g.key ? 'Hide' : 'Show'} list</button>
              {oneId && onTokenClick && (
                <button
                  onClick={() => onTokenClick(oneId)}
                  disabled={!canQuickTarget}
                  style={{
                    border: '1px solid',
                    borderColor: isSelected ? '#2b6cb0' : canQuickTarget ? '#38a169' : '#444',
                    color: isSelected ? '#2b6cb0' : canQuickTarget ? '#38a169' : '#888',
                    background: 'transparent'
                  }}
                  title={canQuickTarget ? 'Target this token' : 'Not a valid target'}
                >
                  {isSelected ? 'Selected' : 'Target'}
                </button>
              )}
            </div>
            {expanded === g.key && (
              <div style={{ marginTop: 8, maxHeight: 200, overflow: 'auto', borderTop: '1px solid #333', paddingTop: 8 }}>
                {g.ids.map(id => {
                  const hl = highlightTargets?.has(id) ?? false;
                  const sel = selectedTargets?.has(id) ?? false;
                  return (
                    <div
                      key={id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 8,
                        fontSize: 12,
                        border: '1px solid',
                        borderColor: sel ? '#2b6cb0' : hl ? '#38a169' : '#333',
                        padding: 6,
                        borderRadius: 6,
                        marginBottom: 6
                      }}
                    >
                      <span>{id.slice(0, 8)}…</span>
                      <span style={{ display: 'inline-flex', gap: 6 }}>
                        <button onClick={() => onBulkCounter([id], { '+1/+1': +1 })}>+1</button>
                        <button onClick={() => onBulkCounter([id], { '+1/+1': -1 })}>-1</button>
                        <button onClick={() => onBulkCounter([id], { '-1/-1': +1 })}>-1/-1 +1</button>
                        <button onClick={() => onBulkCounter([id], { '-1/-1': -1 })}>-1/-1 -1</button>
                        {onTokenClick && (
                          <button
                            onClick={() => onTokenClick(id)}
                            disabled={!hl}
                            style={{
                              border: '1px solid',
                              borderColor: sel ? '#2b6cb0' : hl ? '#38a169' : '#444',
                              color: sel ? '#2b6cb0' : hl ? '#38a169' : '#888',
                              background: 'transparent'
                            }}
                            title={hl ? 'Target this token' : 'Not a valid target'}
                          >
                            {sel ? 'Selected' : 'Target'}
                          </button>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}