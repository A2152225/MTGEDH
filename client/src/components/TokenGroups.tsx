import React, { useMemo, useState, useRef, useEffect } from 'react';
import type { BattlefieldPermanent, KnownCardRef } from '../../../shared/src';

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

// Get token image URL from card data
function getTokenImageUrl(token: BattlefieldPermanent): string | undefined {
  const card = token.card as KnownCardRef;
  // Try to get image from image_uris
  if (card?.image_uris) {
    return card.image_uris.normal || card.image_uris.small || card.image_uris.art_crop;
  }
  return undefined;
}

// Get color indicator for tokens without images
function getTokenColorIndicator(token: BattlefieldPermanent): string {
  const card = token.card as KnownCardRef;
  const colors = card?.colors || [];
  if (colors.length === 0) return '⬜'; // Colorless
  if (colors.length > 1) return '🌈'; // Multi-color
  const colorMap: Record<string, string> = {
    'W': '⚪', 'U': '🔵', 'B': '⚫', 'R': '🔴', 'G': '🟢'
  };
  return colorMap[colors[0]] || '⬜';
}

// Get icon for common token types
function getTokenTypeIcon(name: string): string {
  const nameLower = name.toLowerCase();
  // Artifact tokens
  if (nameLower.includes('treasure')) return '💰';
  if (nameLower.includes('food')) return '🍎';
  if (nameLower.includes('clue')) return '🔍';
  if (nameLower.includes('blood')) return '🩸';
  if (nameLower.includes('map')) return '🗺️';
  if (nameLower.includes('powerstone')) return '💎';
  if (nameLower.includes('gold')) return '🪙';
  // Creature tokens
  if (nameLower.includes('soldier')) return '⚔️';
  if (nameLower.includes('spirit')) return '👻';
  if (nameLower.includes('zombie')) return '🧟';
  if (nameLower.includes('goblin')) return '👺';
  if (nameLower.includes('angel')) return '👼';
  if (nameLower.includes('demon')) return '😈';
  if (nameLower.includes('dragon')) return '🐉';
  if (nameLower.includes('beast')) return '🦁';
  if (nameLower.includes('wolf')) return '🐺';
  if (nameLower.includes('elemental')) return '🔥';
  if (nameLower.includes('cat')) return '🐱';
  if (nameLower.includes('bird')) return '🐦';
  if (nameLower.includes('snake')) return '🐍';
  if (nameLower.includes('rat')) return '🐀';
  if (nameLower.includes('bat')) return '🦇';
  if (nameLower.includes('insect')) return '🦗';
  if (nameLower.includes('saproling')) return '🍄';
  if (nameLower.includes('thopter')) return '🤖';
  if (nameLower.includes('servo')) return '🔧';
  if (nameLower.includes('rabbit') || nameLower.includes('bunny')) return '🐰';
  if (nameLower.includes('squirrel')) return '🐿️';
  if (nameLower.includes('human')) return '👤';
  if (nameLower.includes('knight')) return '🛡️';
  if (nameLower.includes('elf')) return '🧝';
  if (nameLower.includes('faerie')) return '🧚';
  return '🪙'; // Default token icon
}

/** Token group data structure */
interface TokenGroup {
  key: string;
  name: string;
  countersSig: string;
  ptSig: string;
  attached: boolean;
  ids: string[];
  token?: BattlefieldPermanent;
  imageUrl?: string;
  tapped: boolean;
  summoningSick: boolean;
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
      const imageUrl = getTokenImageUrl(t);
      const tapped = t.tapped ?? false;
      const summoningSick = t.summoningSickness ?? false;

      let key = name;
      if (groupMode.includes('pt')) key += `|pt:${pt}`;
      if (groupMode.includes('counters')) key += `|c:${countersSig}`;
      if (groupMode.includes('attach')) key += `|attach:${attached ? 'y' : 'n'}`;
      // Also group by tapped status for visual clarity
      key += `|tapped:${tapped ? 'y' : 'n'}`;

      // Handle server-side grouped tokens (optimization for games with many tokens)
      // If this is a grouped token, expand its IDs into the group
      if ((t as any).isGroupedTokens && (t as any).tokenCount && (t as any).groupedTokenIds) {
        const groupedIds = (t as any).groupedTokenIds as string[];
        const g = map.get(key) || { 
          key, name, countersSig, ptSig: pt, attached, ids: [], token: t, 
          imageUrl, tapped, summoningSick 
        };
        // Add all grouped token IDs
        g.ids.push(...groupedIds);
        map.set(key, g);
      } else {
        const g = map.get(key) || { 
          key, name, countersSig, ptSig: pt, attached, ids: [], token: t, 
          imageUrl, tapped, summoningSick 
        };
        g.ids.push(t.id);
        map.set(key, g);
      }
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
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
      {groups.map(g => {
        const oneId = g.ids.length === 1 ? g.ids[0] : null;
        const canQuickTarget = !!oneId && (highlightTargets?.has(oneId!) ?? false);
        const isSelected = !!oneId && (selectedTargets?.has(oneId!) ?? false);
        const hasImage = !!g.imageUrl;
        const tokenIcon = getTokenTypeIcon(g.name);
        const colorIndicator = g.token ? getTokenColorIndicator(g.token) : '⬜';

        return (
          <div 
            key={g.key} 
            style={{ 
              border: `2px solid ${g.tapped ? '#666' : '#444'}`, 
              borderRadius: 8, 
              background: g.tapped ? 'rgba(50,50,50,0.9)' : 'rgba(20,20,30,0.95)', 
              color: '#eee',
              overflow: 'hidden',
              transform: g.tapped ? 'rotate(5deg)' : 'none',
              opacity: g.tapped ? 0.85 : 1,
              transition: 'all 0.2s ease',
            }}
          >
            {/* Token image or placeholder */}
            <div style={{
              position: 'relative',
              width: '100%',
              height: hasImage ? 100 : 60,
              background: hasImage ? 'transparent' : `linear-gradient(135deg, #2a2a3e 0%, #1a1a2e 100%)`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}>
              {hasImage ? (
                <img 
                  src={g.imageUrl} 
                  alt={g.name}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    objectPosition: 'top',
                  }}
                />
              ) : (
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 4,
                }}>
                  <span style={{ fontSize: 28 }}>{tokenIcon}</span>
                  <span style={{ fontSize: 12, color: '#888' }}>{colorIndicator}</span>
                </div>
              )}
              
              {/* Count badge - positioned in upper LEFT corner */}
              <div style={{
                position: 'absolute',
                top: 4,
                left: 4,
                background: 'linear-gradient(135deg, rgba(147,51,234,0.95), rgba(126,34,206,0.95))',
                color: '#fff',
                fontWeight: 700,
                fontSize: 14,
                padding: '2px 8px',
                borderRadius: 12,
                border: '2px solid rgba(255,255,255,0.4)',
                boxShadow: '0 2px 8px rgba(147,51,234,0.6), inset 0 1px 0 rgba(255,255,255,0.2)',
                zIndex: 10,
              }}>
                {g.ids.length}×
              </div>

              {/* Tapped indicator */}
              {g.tapped && (
                <div style={{
                  position: 'absolute',
                  bottom: 4,
                  left: 4,
                  background: 'rgba(255,165,0,0.9)',
                  color: '#000',
                  fontWeight: 600,
                  fontSize: 10,
                  padding: '1px 6px',
                  borderRadius: 4,
                }}>
                  TAPPED
                </div>
              )}
            </div>

            {/* Token info */}
            <div style={{ padding: 8 }}>
              <div style={{ 
                fontWeight: 600, 
                fontSize: 13, 
                marginBottom: 4,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {g.name}
              </div>
              
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: 8, 
                fontSize: 12, 
                color: '#aaa',
                marginBottom: 8,
              }}>
                {g.ptSig !== '-/-' && (
                  <span style={{
                    background: 'rgba(100,100,200,0.3)',
                    padding: '1px 6px',
                    borderRadius: 4,
                    fontWeight: 600,
                    color: '#ccc',
                  }}>
                    {g.ptSig}
                  </span>
                )}
                {g.countersSig && (
                  <span style={{
                    background: 'rgba(100,200,100,0.3)',
                    padding: '1px 6px',
                    borderRadius: 4,
                    color: '#9f9',
                  }}>
                    {g.countersSig}
                  </span>
                )}
                {g.attached && (
                  <span style={{ color: '#f9a' }}>⛓️</span>
                )}
              </div>

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                <button 
                  onClick={() => onBulkCounter(g.ids, { '+1/+1': +1 })}
                  style={{
                    background: 'rgba(34,197,94,0.2)',
                    border: '1px solid rgba(34,197,94,0.4)',
                    borderRadius: 4,
                    padding: '2px 6px',
                    fontSize: 10,
                    color: '#86efac',
                    cursor: 'pointer',
                  }}
                >
                  +1/+1
                </button>
                <button 
                  onClick={() => onBulkCounter(g.ids, { '+1/+1': -1 })}
                  style={{
                    background: 'rgba(239,68,68,0.2)',
                    border: '1px solid rgba(239,68,68,0.4)',
                    borderRadius: 4,
                    padding: '2px 6px',
                    fontSize: 10,
                    color: '#fca5a5',
                    cursor: 'pointer',
                  }}
                >
                  -1/-1
                </button>
                <button 
                  onClick={() => setExpanded(expanded === g.key ? null : g.key)}
                  style={{
                    background: 'rgba(59,130,246,0.2)',
                    border: '1px solid rgba(59,130,246,0.4)',
                    borderRadius: 4,
                    padding: '2px 6px',
                    fontSize: 10,
                    color: '#93c5fd',
                    cursor: 'pointer',
                  }}
                >
                  {expanded === g.key ? '▲' : '▼'}
                </button>
                {oneId && onTokenClick && (
                  <button
                    onClick={() => onTokenClick(oneId)}
                    disabled={!canQuickTarget}
                    style={{
                      background: isSelected ? 'rgba(37,99,235,0.3)' : canQuickTarget ? 'rgba(34,197,94,0.2)' : 'rgba(100,100,100,0.2)',
                      border: '1px solid',
                      borderColor: isSelected ? '#2563eb' : canQuickTarget ? '#22c55e' : '#444',
                      borderRadius: 4,
                      padding: '2px 6px',
                      fontSize: 10,
                      color: isSelected ? '#93c5fd' : canQuickTarget ? '#86efac' : '#666',
                      cursor: canQuickTarget ? 'pointer' : 'not-allowed',
                    }}
                    title={canQuickTarget ? 'Target this token' : 'Not a valid target'}
                  >
                    {isSelected ? '✓' : '🎯'}
                  </button>
                )}
              </div>
            </div>

            {/* Expanded list */}
            {expanded === g.key && (
              <div style={{ 
                padding: 8, 
                borderTop: '1px solid #333', 
                maxHeight: 150, 
                overflow: 'auto',
                background: 'rgba(0,0,0,0.3)',
              }}>
                {g.ids.map(id => {
                  const hl = highlightTargets?.has(id) ?? false;
                  const sel = selectedTargets?.has(id) ?? false;
                  return (
                    <div
                      key={id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: 11,
                        border: '1px solid',
                        borderColor: sel ? '#2563eb' : hl ? '#22c55e' : '#333',
                        background: sel ? 'rgba(37,99,235,0.1)' : hl ? 'rgba(34,197,94,0.1)' : 'transparent',
                        padding: 4,
                        borderRadius: 4,
                        marginBottom: 4
                      }}
                    >
                      <span style={{ color: '#888', fontFamily: 'monospace', fontSize: 10 }}>
                        {id.slice(0, 6)}
                      </span>
                      <span style={{ display: 'inline-flex', gap: 3 }}>
                        <button 
                          onClick={() => onBulkCounter([id], { '+1/+1': +1 })}
                          style={{
                            background: 'rgba(34,197,94,0.2)',
                            border: '1px solid rgba(34,197,94,0.4)',
                            borderRadius: 3,
                            padding: '1px 4px',
                            fontSize: 9,
                            color: '#86efac',
                            cursor: 'pointer',
                          }}
                        >
                          +1
                        </button>
                        <button 
                          onClick={() => onBulkCounter([id], { '+1/+1': -1 })}
                          style={{
                            background: 'rgba(239,68,68,0.2)',
                            border: '1px solid rgba(239,68,68,0.4)',
                            borderRadius: 3,
                            padding: '1px 4px',
                            fontSize: 9,
                            color: '#fca5a5',
                            cursor: 'pointer',
                          }}
                        >
                          -1
                        </button>
                        {onTokenClick && (
                          <button
                            onClick={() => onTokenClick(id)}
                            disabled={!hl}
                            style={{
                              background: sel ? 'rgba(37,99,235,0.3)' : hl ? 'rgba(34,197,94,0.2)' : 'rgba(100,100,100,0.2)',
                              border: '1px solid',
                              borderColor: sel ? '#2563eb' : hl ? '#22c55e' : '#444',
                              borderRadius: 3,
                              padding: '1px 4px',
                              fontSize: 9,
                              color: sel ? '#93c5fd' : hl ? '#86efac' : '#666',
                              cursor: hl ? 'pointer' : 'not-allowed',
                            }}
                          >
                            {sel ? '✓' : '🎯'}
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