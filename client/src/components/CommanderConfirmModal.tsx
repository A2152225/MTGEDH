import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { socket } from '../socket';
import type { GameID } from '../../../shared/src';

/**
 * CommanderConfirmModal
 *
 * Responsive, non-skinny modal for confirming commander selection after an import.
 */
export function CommanderConfirmModal(props: {
  open: boolean;
  gameId: GameID;
  initialNames?: string[];
  suggested?: string[];
  onClose: () => void;
  onConfirm?: (names: string[]) => void;
}) {
  const { open, gameId, initialNames, suggested, onClose, onConfirm } = props;
  const seed = initialNames ?? suggested ?? [];
  const [c1, setC1] = useState(seed[0] || '');
  const [c2, setC2] = useState(seed[1] || '');

  useEffect(() => {
    setC1((initialNames ?? suggested ?? [])[0] || '');
    setC2((initialNames ?? suggested ?? [])[1] || '');
  }, [initialNames, suggested, open]);

  if (!open) return null;

  const backdrop: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.58)', zIndex: 4000,
    display: 'flex', alignItems: 'center', justifyContent: 'center'
  };

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

  const inputsGrid: React.CSSProperties = {
    display: 'grid',
    gap: 10,
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

  const handleConfirm = () => {
    const names = [c1, c2].map(s => s.trim()).filter(Boolean);
    if (onConfirm) onConfirm(names);
    else socket.emit('setCommander', { gameId, commanderNames: names });
    onClose();
  };

  return createPortal(
    <div style={backdrop} onClick={() => onClose()}>
      <div style={box} onClick={e => e.stopPropagation()}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'start' }}>
          <div>
            <h3 style={{ margin: 0 }}>Confirm Commander</h3>
            <div style={{ fontSize: 12, opacity: 0.85, marginTop: 6 }}>
              Adjust suggested commander(s) if needed, then confirm to finalize selection and trigger opening flow.
            </div>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={() => { setC1(''); setC2(''); }} style={{ background:'transparent', border:'1px solid #333', color:'#ddd', padding:'6px 10px', borderRadius:8 }}>Clear</button>
            <button onClick={() => onClose()} style={{ background:'transparent', border:'1px solid #333', color:'#ddd', padding:'6px 10px', borderRadius:8 }}>Close</button>
          </div>
        </div>

        <div style={inputsGrid}>
          <div>
            <div style={{ fontSize:12, opacity:0.85, marginBottom:6 }}>Commander</div>
            <input value={c1} onChange={e => setC1(e.target.value)} placeholder="Commander name" style={inputStyle} autoFocus />
          </div>
          <div>
            <div style={{ fontSize:12, opacity:0.85, marginBottom:6 }}>Partner / Background (optional)</div>
            <input value={c2} onChange={e => setC2(e.target.value)} placeholder="Partner or background" style={inputStyle} />
          </div>
        </div>

        <div style={{ fontSize:12, color:'#cbd5e1' }}>
          Tip: Suggested names are pre-filled from the imported deck. Include partner/background as second entry if applicable.
        </div>

        <div style={{ display:'flex', justifyContent:'flex-end', gap:10 }}>
          <button onClick={() => onClose()} style={{ padding:'8px 12px', borderRadius:8, background:'transparent', color:'#ddd', border:'1px solid #374151' }}>Cancel</button>
          <button onClick={handleConfirm} disabled={!c1.trim()} style={{ padding:'8px 14px', borderRadius:8, background: c1.trim() ? '#2563eb' : '#334155', color:'#fff', border:'1px solid rgba(0,0,0,0.2)' }}>
            Confirm
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default CommanderConfirmModal;