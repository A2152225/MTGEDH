import React, { useState } from 'react';
import type { ClientGameView, PlayerID } from '../../../shared/src';

export function CommanderSection(props: {
  view: ClientGameView;
  you: PlayerID;
  onSetCommander: (names: string[]) => void;
  onCastCommander: (nameOrId: string) => void;
}) {
  const { view, you, onSetCommander, onCastCommander } = props;
  const [input, setInput] = useState('');

  const rows = (view.players || []).map(p => {
    const info = view.commandZone?.[p.id] as any;
    const names: string[] = info?.commanderNames || info?.commanderIds || [];
    const tax = info?.tax ?? 0;
    return { id: p.id, name: p.name, names, tax, you: p.id === you, info };
  });

  const onSubmit = () => {
    const names = input.split(',').map(s => s.trim()).filter(Boolean);
    if (names.length > 0) onSetCommander(names);
    setInput('');
  };

  return (
    <div style={{ marginTop: 16, border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
      <h3>Commander</h3>
      <div style={{ display: 'grid', gap: 8 }}>
        {rows.map(r => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div>
              <b>{r.name}</b> — commanders: {r.names.length ? r.names.join(' + ') : '—'} — tax: {r.tax}
            </div>
            {r.you && (
              <div style={{ display: 'inline-flex', gap: 6 }}>
                {r.names.map((nm, i) => (
                  <button key={`${nm}-${i}`} onClick={() => onCastCommander(nm)} title="Cast commander (updates tax)">
                    Cast {nm}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Commander name[, partner name]"
          style={{ flex: 1 }}
        />
        <button onClick={onSubmit}>Set Commander(s)</button>
      </div>
      <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
        Tip: enter one or two names (partners), comma-separated.
      </div>
    </div>
  );
}