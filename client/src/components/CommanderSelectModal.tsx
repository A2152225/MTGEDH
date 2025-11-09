import React, { useState, useEffect } from 'react';

export interface CommanderSelectModalProps {
  open: boolean;
  onClose: () => void;
  deckList: string;
  onConfirm: (names: string[]) => void;
  max: number; // allow up to 2 (commander + partner/background)
}

function parseDeckTopCandidates(deckList: string, limit: number): string[] {
  const lines = deckList.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const names: string[] = [];
  for (const line of lines) {
    // Basic parse: count prefix like "1 Card Name" or "Card Name"
    const m = line.match(/^(\d+)\s+(.+)$/);
    const candidate = m ? m[2].trim() : line.replace(/^\d+x?\s*/i,'').trim();
    if (!candidate) continue;
    if (!names.includes(candidate)) names.push(candidate);
    if (names.length >= limit) break;
  }
  return names.slice(0, limit);
}

export const CommanderSelectModal: React.FC<CommanderSelectModalProps> = ({
  open, onClose, deckList, onConfirm, max
}) => {
  const [entries, setEntries] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setEntries(parseDeckTopCandidates(deckList, max));
    }
  }, [open, deckList, max]);

  const updateEntry = (idx: number, val: string) => {
    setEntries(prev => prev.map((e,i) => i === idx ? val : e));
  };
  const addEntry = () => {
    if (entries.length >= max) return;
    setEntries(prev => [...prev, '']);
  };
  const removeEntry = (idx: number) => {
    setEntries(prev => prev.filter((_,i) => i !== idx));
  };
  const confirm = () => {
    const cleaned = entries.map(e => e.trim()).filter(Boolean);
    onConfirm(cleaned);
    onClose();
  };

  if (!open) return null;

  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', display:'flex',
      alignItems:'center', justifyContent:'center', zIndex:200
    }}>
      <div style={{
        background:'#1e1e1e', color:'#fff', padding:20, borderRadius:10,
        width:380, boxShadow:'0 8px 32px rgba(0,0,0,0.6)'
      }}>
        <h3 style={{ marginTop:0 }}>Select Commander(s)</h3>
        <p style={{ fontSize:12, opacity:0.8 }}>
          Choose up to {max} commander card name(s). Pre-filled from top of imported deck list.
        </p>
        <div style={{ display:'flex', flexDirection:'column', gap:8, marginTop:12 }}>
          {entries.map((e,i) => (
            <div key={i} style={{ display:'flex', gap:6 }}>
              <input
                value={e}
                onChange={ev => updateEntry(i, ev.target.value)}
                placeholder={`Commander ${i+1} name`}
                style={{ flex:1, padding:'4px 6px', borderRadius:6, border:'1px solid #444', background:'#111', color:'#eee' }}
              />
              <button
                onClick={() => removeEntry(i)}
                disabled={entries.length === 1}
                style={{ fontSize:12 }}
              >✕</button>
            </div>
          ))}
          {entries.length < max && (
            <button onClick={addEntry} style={{ alignSelf:'flex-start', fontSize:12 }}>+ Add Commander</button>
          )}
        </div>
        <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:16 }}>
          <button onClick={onClose}>Cancel</button>
          <button
            onClick={confirm}
            disabled={entries.every(e => !e.trim())}
            style={{ background:'#2b6cb0', color:'#fff', border:'1px solid #1d4f80', padding:'6px 12px', borderRadius:6 }}
          >Confirm</button>
        </div>
      </div>
    </div>
  );
};