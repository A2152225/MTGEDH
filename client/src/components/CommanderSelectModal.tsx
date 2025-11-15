import React, { useEffect, useMemo, useState } from 'react';
import type { KnownCardRef } from '../../../shared/src';
import { createPortal } from 'react-dom';

/**
 * CommanderSelectModal (full UI)
 *
 * - Preferred flow when importedCandidates are present: shows a gallery of candidate cards
 *   with images (if available). Click a card to toggle selection (up to `max`).
 * - Selected cards get an outline and a remove (×) control.
 * - Also provides manual name inputs (fallback/edits).
 * - onConfirm returns (names: string[], ids?: string[]) — ids present if any selected card had ids.
 *
 * Props:
 *  - open: boolean
 *  - onClose: () => void
 *  - deckList?: string  (optional)
 *  - candidates?: KnownCardRef[] (optional)
 *  - onConfirm: (names: string[], ids?: string[]) => void
 *  - max: number (typically 2)
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
  // Selected ids in order of selection (max length = max)
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // Manual name entries (free form)
  const [manualNames, setManualNames] = useState<string[]>(() => {
    const parsed = parseDeckTopCandidates(deckList || '', max);
    return parsed.concat(Array.from({ length: Math.max(0, max - parsed.length) }, () => '')).slice(0, max);
  });

  // When modal opens, prefill selection from candidates top items if present
  useEffect(() => {
    if (!open) return;
    if (candidates && candidates.length > 0) {
      // select up to `max` first candidates by default (but do not overwrite existing manual edits)
      const initial = candidates.slice(0, max).map(c => c.id).filter(Boolean) as string[];
      setSelectedIds(initial.slice(0, max));
      // Pre-fill manual names from selected candidates if manual slots empty
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
      // no candidates: just parse deckList into manual slots
      const parsed = parseDeckTopCandidates(deckList || '', max);
      setManualNames(parsed.concat(Array.from({ length: Math.max(0, max - parsed.length) }, () => '')).slice(0, max));
      setSelectedIds([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, candidates]);

  // Toggle selection of a candidate id
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const exists = prev.indexOf(id);
      if (exists >= 0) {
        // remove
        return prev.filter(x => x !== id);
      }
      // add (append), but keep size <= max
      const next = [...prev, id].slice(0, max);
      return next;
    });
  };

  const removeSelected = (id: string) => {
    setSelectedIds(prev => prev.filter(x => x !== id));
  };

  const updateManual = (idx: number, val: string) => {
    setManualNames(prev => prev.map((p, i) => i === idx ? val : p));
    // if manual input matches a candidate name, automatically add its id to selection if not present
    const matched = candidates?.find(c => normalizeNameLower(c.name) === normalizeNameLower(val));
    if (matched && matched.id) {
      setSelectedIds(prev => {
        if (prev.includes(matched.id)) return prev;
        return [...prev.slice(0, max - 1), matched.id].slice(0, max);
      });
    }
  };

  const confirm = () => {
    // Build final names: first use selected ids' names (preserve order of selection),
    // then fill from manualNames for any remaining slots (trim & filter empty)
    const selectedNamesFromIds = selectedIds.map(id => {
      const c = candidates?.find(x => x.id === id);
      return c ? c.name : id;
    });
    const manualRemaining = manualNames.map(n => (n || '').trim()).filter(Boolean);
    // Merge while preserving selectedIds order and then manual names not duplicated
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
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000
  };
  const box: React.CSSProperties = {
    width: 880, maxWidth: '96vw', maxHeight: '86vh', overflow: 'auto',
    background: '#0f1720', color: '#fff', borderRadius: 10, padding: 16, boxShadow: '0 12px 40px rgba(0,0,0,0.6)'
  };
  const galleryStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 };

  return createPortal(
    <div style={backdrop} onClick={() => onClose()}>
      <div style={box} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <h3 style={{ margin: 0 }}>Select Commander(s)</h3>
            <div style={{ fontSize: 13, opacity: 0.85 }}>Click cards to select up to {max}. Use the manual inputs to edit or add names.</div>
          </div>
          <div>
            <button onClick={() => { setSelectedIds([]); setManualNames(Array.from({ length: max }, () => '')); }} style={{ marginRight: 8 }}>Clear All</button>
            <button onClick={() => onClose()}>Close</button>
          </div>
        </div>

        {candidates && candidates.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: '#cbd5e1', marginBottom: 8 }}>Candidate cards (click to toggle selection)</div>
            <div style={galleryStyle}>
              {candidates.map(c => {
                const isSelected = selectedIds.includes(c.id);
                const img = (c as any)?.image_uris?.normal || (c as any)?.image_uris?.small;
                return (
                  <div key={c.id} style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', border: isSelected ? '3px solid #2b6cb0' : '1px solid rgba(255,255,255,0.06)', cursor: 'pointer', background: '#071026' }}
                    onClick={() => toggleSelect(c.id)}
                    title={c.name}>
                    <div style={{ width: '100%', height: 190, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#04101a' }}>
                      {img ? <img src={img} alt={c.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : <div style={{ padding: 8, color: '#cbd5e1' }}>{c.name}</div>}
                    </div>
                    <div style={{ padding: 8, fontSize: 13, color: '#e2e8f0' }}>{c.name}</div>
                    {isSelected && (
                      <button
                        onClick={(e) => { e.stopPropagation(); removeSelected(c.id); }}
                        style={{
                          position: 'absolute', right: 6, top: 6, background: '#111827', color: '#fff',
                          border: 'none', borderRadius: 999, width: 28, height: 28, cursor: 'pointer'
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
              <input key={i} value={mn} onChange={e => updateManual(i, e.target.value)} placeholder={`Commander ${i+1} name`} style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid #334155', background: '#071022', color: '#fff' }} />
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>
            Selected: {selectedIds.length > 0 ? selectedIds.map(id => (candidates?.find(c => c.id === id)?.name || id)).join(', ') : '—'}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => onClose()}>Cancel</button>
            <button onClick={confirm} disabled={(selectedIds.length === 0 && manualNames.every(n => !(n || '').trim()))} style={{ background: '#2563eb', color: '#fff', padding: '8px 12px', borderRadius: 8 }}>
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