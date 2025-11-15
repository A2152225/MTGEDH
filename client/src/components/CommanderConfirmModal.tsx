import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { socket } from '../socket';
import type { GameID } from '../../../shared/src';

/**
 * CommanderConfirmModal
 *
 * - Responsive, non-skinny modal for confirming commander selection after an import.
 * - Accepts either `initialNames` (preferred) or legacy `suggested` prop.
 * - Calls onConfirm(names) if provided; otherwise emits setCommander socket event.
 *
 * Usage:
 * <CommanderConfirmModal
 *   open={open}
 *   gameId={gameId}
 *   initialNames={['Card A', 'Card B']}
 *   onClose={() => {}}
 *   onConfirm={(names) => {}}
 * />
 */
export function CommanderConfirmModal(props: {
  open: boolean;
  gameId: GameID;
  // Accept either initialNames (newer) or suggested (older)
  initialNames?: string[]; 
  suggested?: string[];
  onClose: () => void;
  onConfirm?: (names: string[]) => void;
}) {
  const { open, gameId, initialNames, suggested, onClose, onConfirm } = props;
  const seed = initialNames ?? suggested ?? [];
  const [c1, setC1] = useState<string>(seed[0] || '');
  const [c2, setC2] = useState<string>(seed[1] || '');

  useEffect(() => {
    setC1((initialNames ?? suggested ?? [])[0] || '');
    setC2((initialNames ?? suggested ?? [])[1] || '');
  }, [initialNames, suggested, open]);

  if (!open) return null;

  const backdrop: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.58)',
    zIndex: 4000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  };

  // Modal box: set minWidth to avoid skinny column layout, center and be responsive.
  const box: React.CSSProperties = {
    width: 'min(920px, 96vw)',
    minWidth: 640,
    background: '#1f2937',
    color: '#fff',
    border: '1px solid #374151',
    borderRadius: 10,
    padding: 16,
    boxShadow: '0 10px 40px rgba(0,0,0,0.6)',
    maxHeight: '90vh',
    overflow: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 12
  };

  const headerRow: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 };
  const label: React.CSSProperties = { fontSize: 13, opacity: 0.85, marginBottom: 6 };
  const inputsGrid: React.CSSProperties = {
    display: 'grid',
    gap: 10,
    // two columns on wider screens, collapse to single column below ~720px
    gridTemplateColumns: '1fr 1fr'
  };
  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 10px',
    borderRadius: 8,
    border: '1px solid #374151',
    background: '#0f1720',
    color: '#fff',
    fontSize: 13,
    boxSizing: 'border-box'
  };

  const footerRow: React.CSSProperties = { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 6 };

  const handleConfirm = () => {
    const names = [c1, c2].map(s => s.trim()).filter(Boolean);
    if (onConfirm) {
      try { onConfirm(names); } catch (e) { /* swallow */ }
    } else {
      socket.emit('setCommander', { gameId, commanderNames: names });
    }
    onClose();
  };

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return createPortal(
    <div style={backdrop} onClick={() => onClose()}>
      <div style={box} onClick={stop}>
        <div style={headerRow}>
          <div>
            <h3 style={{ margin: 0, fontSize: 18 }}>Confirm Commander</h3>
            <div style={{ fontSize: 12, opacity: 0.85, marginTop: 6 }}>
              Confirm your commander(s). Adjust names if needed, then confirm to finalize selection and proceed with opening flow.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { setC1(''); setC2(''); }} style={{ background: 'transparent', color: '#ddd', border: '1px solid #333', padding: '6px 10px', borderRadius: 8 }}>Clear</button>
            <button onClick={() => onClose()} style={{ background: 'transparent', color: '#ddd', border: '1px solid #333', padding: '6px 10px', borderRadius: 8 }}>Close</button>
          </div>
        </div>

        <div style={inputsGrid}>
          <div>
            <div style={label}>Commander</div>
            <input
              value={c1}
              onChange={e => setC1(e.target.value)}
              placeholder="Commander name"
              style={inputStyle}
              autoFocus
            />
          </div>

          <div>
            <div style={label}>Partner / Background (optional)</div>
            <input
              value={c2}
              onChange={e => setC2(e.target.value)}
              placeholder="Partner or background name (optional)"
              style={inputStyle}
            />
          </div>
        </div>

        <div style={{ fontSize: 12, color: '#cbd5e1', opacity: 0.95 }}>
          Tip: If you imported a Commander deck, suggested names are prefilled. If your deck uses Partner or Background, include the second commander here.
        </div>

        <div style={footerRow}>
          <button
            onClick={() => onClose()}
            style={{ padding: '8px 12px', borderRadius: 8, background: 'transparent', color: '#ddd', border: '1px solid #374151' }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!c1.trim()}
            style={{
              padding: '8px 14px',
              borderRadius: 8,
              background: c1.trim() ? '#2563eb' : '#334155',
              color: '#fff',
              border: '1px solid rgba(0,0,0,0.2)',
              cursor: c1.trim() ? 'pointer' : 'not-allowed',
              opacity: c1.trim() ? 1 : 0.7
            }}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default CommanderConfirmModal;