import React, { useMemo, useState } from 'react';
import { loadLocalSavedDecks, saveLocalSavedDecks } from '../utils/localDeckStorage';
import { saveServerDeckViaApi } from '../utils/serverDeckApi';

type Row = { id: string; name: string; text: string; selected: boolean; visibility: 'private' | 'public' };

export function MoveLocalDecksModal(props: {
  open: boolean;
  onClose: () => void;
}) {
  const { open, onClose } = props;
  const localDecks = useMemo(() => (open ? loadLocalSavedDecks() : []), [open]);
  const [rows, setRows] = useState<Row[]>([]);
  const [bulk, setBulk] = useState<'private' | 'public'>('private');
  const [removeLocal, setRemoveLocal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setRows(loadLocalSavedDecks().map((d) => ({
      id: d.id,
      name: d.name,
      text: d.text,
      selected: true,
      visibility: 'private',
    })));
    setMessage(null);
    setRemoveLocal(false);
  }, [open]);

  if (!open) return null;
  if (localDecks.length === 0) return null;

  const selected = rows.filter((r) => r.selected && r.text.trim());

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 140, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#202225', border: '1px solid #444', borderRadius: 8, padding: 16, width: 460, maxWidth: '94vw', color: '#eee', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
        <h4 style={{ margin: '0 0 8px', fontSize: 14 }}>Save local decks to the server?</h4>
        <p style={{ fontSize: 12, margin: '0 0 10px', color: '#cbd5e1' }}>
          You have local decks in this browser. Choose which to upload. Local copies stay unless you check remove.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, fontSize: 12 }}>
          <span>Bulk default</span>
          <select value={bulk} onChange={(e) => {
            const vis = e.target.value === 'public' ? 'public' : 'private';
            setBulk(vis);
            setRows((prev) => prev.map((r) => ({ ...r, visibility: vis })));
          }}>
            <option value="private">Private</option>
            <option value="public">Public</option>
          </select>
        </div>
        <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid #333', borderRadius: 6, background: '#111', padding: 6 }}>
          {rows.map((row) => (
            <label key={row.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 4px', borderBottom: '1px solid #222', fontSize: 12 }}>
              <input
                type="checkbox"
                checked={row.selected}
                onChange={(e) => setRows((prev) => prev.map((r) => r.id === row.id ? { ...r, selected: e.target.checked } : r))}
              />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</span>
              <select
                value={row.visibility}
                onChange={(e) => setRows((prev) => prev.map((r) => r.id === row.id ? { ...r, visibility: e.target.value === 'public' ? 'public' : 'private' } : r))}
              >
                <option value="private">Private</option>
                <option value="public">Public</option>
              </select>
            </label>
          ))}
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, fontSize: 12 }}>
          <input type="checkbox" checked={removeLocal} onChange={(e) => setRemoveLocal(e.target.checked)} />
          Remove local copies after upload
        </label>
        {message && <div style={{ marginTop: 8, fontSize: 12, color: message.startsWith('Saved') ? '#86efac' : '#f87171' }}>{message}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} disabled={busy}>Not now</button>
          <button
            type="button"
            disabled={busy || selected.length === 0}
            onClick={() => {
              setBusy(true);
              setMessage(null);
              void (async () => {
                try {
                  for (const row of selected) {
                    await saveServerDeckViaApi({
                      name: row.name || 'Deck',
                      text: row.text,
                      visibility: row.visibility,
                      cacheCards: true,
                    });
                  }
                  if (removeLocal) {
                    const keep = loadLocalSavedDecks().filter((d) => !selected.some((r) => r.id === d.id));
                    saveLocalSavedDecks(keep);
                  }
                  setMessage(`Saved ${selected.length} deck${selected.length === 1 ? '' : 's'} to the server.`);
                  setTimeout(onClose, 600);
                } catch (err) {
                  setMessage(err instanceof Error ? err.message : 'Upload failed');
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            {busy ? 'Saving?' : 'Save to server'}
          </button>
        </div>
      </div>
    </div>
  );
}
