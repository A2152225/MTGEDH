import React, { useEffect, useState } from 'react';
import type { KnownCardRef } from '../../../shared/src';
import { createPortal } from 'react-dom';

/**
 * CommanderSelectModal (updated)
 *
 * Behavior changes:
 * - Modal is a fixed-height dialog (max 86vh) with header and footer pinned.
 * - The card gallery (and manual inputs) live in the middle scrollable area so
 *   the Confirm/Cancel controls remain visible at all times.
 *
 * Styling/markup:
 * - Container uses flex column layout: header (fixed), body (flex: 1; overflow:auto), footer (fixed).
 * - Body has padding and internal grid; on small screens it will still scroll.
 *
 * Other behavior unchanged: selection, manual name inputs, confirm returns (names, ids?).
 */

export interface CommanderSelectModalProps {
  open: boolean;
  onClose: () => void;
  deckList?: string;
  candidates?: KnownCardRef[];
  onConfirm: (names: string[], ids?: string[]) => void;
  max: number;
}

function parseDeckTopCandidates(deckList: string, limit: number): string[] {
  const lines = deckList.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const names: string[] = [];
  for (const line of lines) {
    const m = line.match(/^(\d+)\s+(.+)$/);
    const candidate = m ? m[2].trim() : line.replace(/^\d+x?\s*/i,'').trim();
    if (!candidate) continue;
    if (!names.includes(candidate)) names.push(candidate);
    if (names.length >= limit) break;
  }
  return names.slice(0, limit);
}

function normalizeNameLower(s: string) {
  return (s || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export const CommanderSelectModal: React.FC<CommanderSelectModalProps> = ({
  open, onClose, deckList = '', candidates = [], onConfirm, max
}) => {
  // Larger sizes preserved from prior change (can be tuned)
  const IMAGE_H = 293;
  const TILE_H = 347;

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [manualNames, setManualNames] = useState<string[]>(() => {
    const parsed = parseDeckTopCandidates(deckList || '', max);
    return parsed.concat(Array.from({ length: Math.max(0, max - parsed.length) }, () => '')).slice(0, max);
  });

  useEffect(() => {
    if (!open) return;
    if (candidates && candidates.length > 0) {
      const initial = candidates.slice(0, max).map(c => c.id).filter(Boolean) as string[];
      setSelectedIds(initial.slice(0, max));
      setManualNames(prev => {
        const copy = prev.slice(0, max);
        for (let i = 0; i < max; i++) {
          if (!copy[i] || !copy[i].trim()) {
            const c = candidates[i];
            if (c && c.name) copy[i] = c.name;
          }
        }
        return copy;
      });
    } else {
      const parsed = parseDeckTopCandidates(deckList || '', max);
      setManualNames(parsed.concat(Array.from({ length: Math.max(0, max - parsed.length) }, () => '')).slice(0, max));
      setSelectedIds([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, candidates]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const idx = prev.indexOf(id);
      if (idx >= 0) return prev.filter(x => x !== id);
      const next = [...prev, id].slice(0, max);
      return next;
    });
  };

  const removeSelected = (id: string) => {
    setSelectedIds(prev => prev.filter(x => x !== id));
  };

  const updateManual = (idx: number, val: string) => {
    setManualNames(prev => prev.map((p, i) => i === idx ? val : p));
    const matched = candidates?.find(c => normalizeNameLower(c.name) === normalizeNameLower(val));
    if (matched && matched.id) {
      setSelectedIds(prev => {
        if (prev.includes(matched.id)) return prev;
        return [...prev.slice(0, max - 1), matched.id].slice(0, max);
      });
    }
  };

  const confirm = () => {
    const selectedNamesFromIds = selectedIds.map(id => {
      const c = candidates?.find(x => x.id === id);
      return c ? c.name : id;
    });
    const manualRemaining = manualNames.map(n => (n || '').trim()).filter(Boolean);
    const outNames: string[] = [];
    for (const nm of selectedNamesFromIds) {
      if (!outNames.includes(nm)) outNames.push(nm);
    }
    for (const mn of manualRemaining) {
      if (outNames.length >= max) break;
      if (!outNames.includes(mn)) outNames.push(mn);
    }
    const outIds = selectedIds.length > 0 ? selectedIds.slice(0, outNames.length) : undefined;
    onConfirm(outNames.slice(0, max), outIds && outIds.length ? outIds : undefined);
    onClose();
  };

  if (!open) return null;

  const backdrop: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
    padding: 12
  };

  // Modal box: limit total height and use column flex layout
  const box: React.CSSProperties = {
    width: 980,
    maxWidth: '100%',
    maxHeight: '86vh',
    display: 'flex',
    flexDirection: 'column',
    background: '#0f1720',
    color: '#fff',
    borderRadius: 10,
    overflow: 'hidden',
    boxShadow: '0 12px 40px rgba(0,0,0,0.6)'
  };

  const headerStyle: React.CSSProperties = {
    padding: '16px',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12
  };

  const bodyStyle: React.CSSProperties = {
    padding: 16,
    overflowY: 'auto',
    flex: 1, // expand and scroll
  };

  const footerStyle: React.CSSProperties = {
    padding: '12px 16px',
    borderTop: '1px solid rgba(255,255,255,0.04)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    background: 'linear-gradient(180deg, rgba(0,0,0,0), rgba(0,0,0,0.02))'
  };

  const galleryStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `repeat(auto-fill, minmax(220px, 1fr))`,
    gap: 12
  };

  const tileStyleBase: React.CSSProperties = {
    position: 'relative',
    borderRadius: 8,
    overflow: 'hidden',
    border: '1px solid rgba(255,255,255,0.06)',
    cursor: 'pointer',
    background: '#071026',
    height: TILE_H
  };

  const imageContainerStyle: React.CSSProperties = {
    width: '100%',
    height: IMAGE_H,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#04101a',
    overflow: 'hidden',
    position: 'relative'
  };

  const nameStyle: React.CSSProperties = {
    padding: '8px',
    fontSize: 14,
    color: '#e2e8f0',
    lineHeight: 1.1,
    height: (TILE_H - IMAGE_H - 16),
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center'
  };

  return createPortal(
    <div style={backdrop} onClick={() => onClose()}>
      <div style={box} onClick={e => e.stopPropagation()}>
        {/* Header (pinned) */}
        <div style={headerStyle}>
          <div>
            <h3 style={{ margin: 0 }}>Select Commander(s)</h3>
            <div style={{ fontSize: 13, opacity: 0.85 }}>Click cards to select up to {max}. Use the manual inputs to edit or add names.</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { setSelectedIds([]); setManualNames(Array.from({ length: max }, () => '')); }}>Clear All</button>
            <button onClick={() => onClose()}>Close</button>
          </div>
        </div>

        {/* Body (scrollable) */}
        <div style={bodyStyle}>
          {candidates && candidates.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: '#cbd5e1', marginBottom: 8 }}>Candidate cards (click to toggle selection)</div>
              <div style={galleryStyle}>
                {candidates.map(c => {
                  const isSelected = selectedIds.includes(c.id);
                  const img = (c as any)?.image_uris?.normal || (c as any)?.image_uris?.small;
                  const mana = (c as any)?.mana_cost || (c as any)?.mana || null;
                  const power = (c as any)?.power ?? (c as any)?.powerToughness?.power ?? null;
                  const toughness = (c as any)?.toughness ?? (c as any)?.powerToughness?.toughness ?? null;
                  const ptText = (power != null && toughness != null) ? `${power}/${toughness}` : null;

                  return (
                    <div
                      key={c.id}
                      style={{
                        ...tileStyleBase,
                        border: isSelected ? '3px solid #2b6cb0' : tileStyleBase.border
                      }}
                      onClick={() => toggleSelect(c.id)}
                      title={c.name}
                    >
                      <div style={imageContainerStyle}>
                        {img
                          ? <img src={img} alt={c.name} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
                          : <div style={{ padding: 8, color: '#cbd5e1' }}>{c.name}</div>}
                        {mana && (
                          <div style={{
                            position: 'absolute',
                            right: 8,
                            top: 8,
                            background: 'rgba(0,0,0,0.6)',
                            padding: '4px 6px',
                            borderRadius: 6,
                            fontSize: 12,
                            color: '#f8fafc',
                            border: '1px solid rgba(255,255,255,0.06)'
                          }}>{mana}</div>
                        )}
                        {ptText && (
                          <div style={{
                            position: 'absolute',
                            right: 8,
                            bottom: 8,
                            background: 'rgba(0,0,0,0.6)',
                            padding: '3px 6px',
                            borderRadius: 6,
                            fontSize: 12,
                            color: '#fff',
                            border: '1px solid rgba(255,255,255,0.06)'
                          }}>{ptText}</div>
                        )}
                      </div>

                      <div style={nameStyle}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ fontWeight: 700, fontSize: 14, color: '#fff', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                            {c.name}
                          </div>
                        </div>
                      </div>

                      {isSelected && (
                        <button
                          onClick={(e) => { e.stopPropagation(); removeSelected(c.id); }}
                          style={{
                            position: 'absolute', right: 8, top: 8, background: 'transparent', color: '#fff',
                            border: 'none', borderRadius: 999, width: 26, height: 26, cursor: 'pointer', fontSize: 14, lineHeight: '26px'
                          }}
                          title="Remove"
                        >✕</button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 12, color: '#cbd5e1', marginBottom: 6 }}>Manual entries (optional — comma-separated partners are supported)</div>
            <div style={{ display: 'flex', gap: 8, flexDirection: 'column' }}>
              {manualNames.map((mn, i) => (
                <input
                  key={i}
                  value={mn}
                  onChange={e => updateManual(i, e.target.value)}
                  placeholder={`Commander ${i+1} name`}
                  style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid #334155', background: '#071022', color: '#fff' }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Footer (pinned) */}
        <div style={footerStyle}>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>
            Selected: {selectedIds.length > 0 ? selectedIds.map(id => (candidates?.find(c => c.id === id)?.name || id)).join(', ') : '—'}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => onClose()}>Cancel</button>
            <button
              onClick={confirm}
              disabled={(selectedIds.length === 0 && manualNames.every(n => !(n || '').trim()))}
              style={{ background: '#2563eb', color: '#fff', padding: '8px 12px', borderRadius: 8 }}
            >
              Confirm
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default CommanderSelectModal;