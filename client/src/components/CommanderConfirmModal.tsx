import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { socket } from '../socket';
import type { GameID } from '../../../shared/src';

export function CommanderConfirmModal(props: {
  open: boolean;
  gameId: GameID;
  suggested: string[];
  onClose: () => void;
}) {
  const { open, gameId, suggested, onClose } = props;
  const [c1, setC1] = useState(suggested[0] || '');
  const [c2, setC2] = useState(suggested[1] || '');

  useEffect(() => {
    setC1(suggested[0] || '');
    setC2(suggested[1] || '');
  }, [suggested]);

  if (!open) return null;

  const backdrop: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 4000
  };
  const box: React.CSSProperties = {
    position: 'fixed', left: '50%', top: '20%', transform: 'translate(-50%, 0)',
    width: 520, maxWidth: '96vw', background: '#1f2937', color: '#fff', border: '1px solid #374151',
    borderRadius: 8, padding: 14, boxShadow: '0 6px 24px rgba(0,0,0,0.6)'
  };
  const label: React.CSSProperties = { fontSize: 12, opacity: 0.8, marginBottom: 4 };

  const confirm = () => {
    const names = [c1, c2].map(s => s.trim()).filter(Boolean);
    socket.emit('setCommander', { gameId, commanderNames: names });
    onClose();
  };

  return createPortal(
    <div style={backdrop} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={box}>
        <h4 style={{ margin: '0 0 8px' }}>Confirm Commanders</h4>
        <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 8 }}>
          We suggested the top card as commander, and a partner/background if present. Adjust if needed, then confirm to shuffle and draw 7.
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          <div>
            <div style={label}>Commander</div>
            <input value={c1} onChange={e => setC1(e.target.value)} placeholder="Commander name" style={{ width: '100%' }} />
          </div>
          <div>
            <div style={label}>Partner/Background (optional)</div>
            <input value={c2} onChange={e => setC2(e.target.value)} placeholder="Partner/background name" style={{ width: '100%' }} />
          </div>
        </div>
        <div style={{ marginTop: 10, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" onClick={confirm} disabled={!c1.trim()}>Confirm</button>
        </div>
      </div>
    </div>,
    document.body
  );
}