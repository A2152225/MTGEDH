import React, { useEffect, useMemo, useState } from 'react';
import { socket } from '../socket';
import type { SavedDeckSummary, SavedDeckDetail, GameID } from '../../../shared/src/decks';

type SavedLocalDeck = { id: string; name: string; text: string; savedAt: number };

const STORAGE_KEY = 'mtgedh:savedDecksLocal';

function loadLocal(): SavedLocalDeck[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as SavedLocalDeck[];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function saveLocalAll(list: SavedLocalDeck[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}
function uid(prefix='d'): string {
  return `${prefix}_${Math.random().toString(36).slice(2,10)}`;
}

export function DeckManagerModal(props: {
  open: boolean;
  onClose: () => void;
  onImportText: (text: string, name?: string) => void;
  gameId?: GameID;
  canServer?: boolean;
}) {
  const { open, onClose, onImportText, gameId, canServer } = props;
  const [tab, setTab] = useState<'local' | 'server' | 'preview'>('local');

  // Local state
  const [localList, setLocalList] = useState<SavedLocalDeck[]>([]);
  const [localName, setLocalName] = useState('');
  const [localText, setLocalText] = useState('');
  const [localFilter, setLocalFilter] = useState('');
  const [localErr, setLocalErr] = useState<string | null>(null);

  // Server state
  const [serverDecks, setServerDecks] = useState<SavedDeckSummary[]>([]);
  const [serverFilter, setServerFilter] = useState('');
  const [detail, setDetail] = useState<SavedDeckDetail | null>(null);
  const [serverErr, setServerErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLocalList(loadLocal());
    if (canServer && gameId) {
      socket.emit('listSavedDecks', { gameId });
    }
  }, [open, canServer, gameId]);

  useEffect(() => {
    if (!open) return;
    const onList = ({ decks }: { decks: SavedDeckSummary[] }) => setServerDecks(decks);
    const onDetail = ({ deck }: { deck: SavedDeckDetail }) => {
      setDetail(deck);
      setTab('preview');
    };
    const onSaved = ({ deck }: { deck: SavedDeckSummary }) => {
      setSaving(false);
      socket.emit('listSavedDecks', { gameId });
    };
    const onRenamed = ({ deck }: { deck: SavedDeckSummary }) => {
      setServerDecks(prev => prev.map(d => d.id === deck.id ? deck : d));
    };
    const onDeleted = ({ deckId }: { deckId: string }) => {
      setServerDecks(prev => prev.filter(d => d.id !== deckId));
      if (detail?.id === deckId) setDetail(null);
    };
    const onError = ({ message }: { message: string }) => setServerErr(message);

    socket.on('savedDecksList', onList);
    socket.on('savedDeckDetail', onDetail);
    socket.on('deckSaved', onSaved);
    socket.on('deckRenamed', onRenamed);
    socket.on('deckDeleted', onDeleted);
    socket.on('deckError', onError);

    return () => {
      socket.off('savedDecksList', onList);
      socket.off('savedDeckDetail', onDetail);
      socket.off('deckSaved', onSaved);
      socket.off('deckRenamed', onRenamed);
      socket.off('deckDeleted', onDeleted);
      socket.off('deckError', onError);
    };
  }, [open, gameId, detail]);

  const filteredLocal = useMemo(() => {
    const q = localFilter.trim().toLowerCase();
    if (!q) return localList.slice().sort((a,b)=>b.savedAt-a.savedAt);
    return localList.filter(d => d.name.toLowerCase().includes(q)).sort((a,b)=>b.savedAt-a.savedAt);
  }, [localList, localFilter]);

  const filteredServer = useMemo(() => {
    const q = serverFilter.trim().toLowerCase();
    if (!q) return serverDecks;
    return serverDecks.filter(d => d.name.toLowerCase().includes(q));
  }, [serverDecks, serverFilter]);

  if (!open) return null;

  const saveLocal = () => {
    if (!localText.trim()) { setLocalErr('Empty list'); return; }
    if (!localName.trim()) { setLocalErr('Name required'); return; }
    const deck: SavedLocalDeck = { id: uid('l'), name: localName.trim(), text: localText, savedAt: Date.now() };
    const next = [deck, ...localList].slice(0, 200);
    saveLocalAll(next);
    setLocalList(next);
    setLocalName('');
    setLocalText('');
    setLocalErr(null);
  };

  const importLocal = (d: SavedLocalDeck) => {
    onImportText(d.text, d.name);
  };

  const importServer = (deckId: string) => {
    if (!gameId) return;
    socket.emit('useSavedDeck', { gameId, deckId });
  };

  const requestDetail = (deckId: string) => {
    if (!gameId) return;
    socket.emit('getSavedDeck', { gameId, deckId });
  };

  const saveServer = () => {
    if (!canServer || !gameId) return;
    if (!localText.trim() || !localName.trim()) { setServerErr('Name & text required'); return; }
    setSaving(true);
    socket.emit('saveDeck', { gameId, name: localName.trim(), list: localText });
  };

  const renameServerDeck = (d: SavedDeckSummary, newName: string) => {
    if (!gameId || !newName.trim()) return;
    socket.emit('renameSavedDeck', { gameId, deckId: d.id, name: newName.trim() });
  };

  const deleteServerDeck = (d: SavedDeckSummary) => {
    if (!gameId) return;
    if (!confirm(`Delete deck "${d.name}"?`)) return;
    socket.emit('deleteSavedDeck', { gameId, deckId: d.id });
  };

  return (
    <div style={backdrop}>
      <div style={modal}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
          <h4 style={{ margin:0, fontSize:15 }}>Deck Manager</h4>
          <button onClick={onClose}>Close</button>
        </div>

        {/* Tabs */}
        <div style={{ display:'flex', gap:8, marginBottom:8 }}>
          <button onClick={()=>{ setTab('local'); setDetail(null); }} disabled={tab==='local'}>Local</button>
          {canServer && <button onClick={()=>{ setTab('server'); setDetail(null); }} disabled={tab==='server'}>Server</button>}
          {detail && <button onClick={()=> setTab('preview')} disabled={tab==='preview'}>Preview</button>}
        </div>

        {tab === 'local' && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
            <div>
              <div style={{ fontSize:12, marginBottom:6 }}>Paste decklist</div>
              <textarea
                value={localText}
                onChange={e=>setLocalText(e.target.value)}
                placeholder='e.g. 4 Lightning Bolt'
                style={{ width:'100%', height:180, resize:'vertical', fontSize:12 }}
              />
              <input
                value={localName}
                onChange={e=>setLocalName(e.target.value)}
                placeholder='Name'
                style={{ width:'100%', marginTop:8 }}
              />
              <div style={{ display:'flex', gap:8, marginTop:8 }}>
                <input
                  type="file"
                  accept=".txt,text/plain"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const content = await file.text();
                    setLocalText(content);
                  }}
                />
                <button onClick={saveLocal} disabled={!localText.trim() || !localName.trim()}>Save Locally</button>
                {canServer && (
                  <button onClick={saveServer} disabled={!localText.trim() || !localName.trim() || saving}>
                    {saving ? 'Saving…' : 'Save to Server'}
                  </button>
                )}
              </div>
              {localErr && <div style={{ marginTop:6, fontSize:11, color:'#f87171' }}>{localErr}</div>}
            </div>
            <div>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                <span style={{ fontSize:12 }}>Local Decks ({localList.length})</span>
                <input
                  value={localFilter}
                  onChange={e=>setLocalFilter(e.target.value)}
                  placeholder='Filter'
                  style={{ width:140 }}
                />
              </div>
              <div style={{ border:'1px solid #333', borderRadius:6, padding:6, maxHeight:260, overflowY:'auto', background:'#111' }}>
                {filteredLocal.length === 0 && <div style={{ fontSize:12, color:'#888' }}>No decks</div>}
                {filteredLocal.map(d=>(
                  <div key={d.id} style={{ borderBottom:'1px solid #222', padding:'6px 4px', display:'grid', gridTemplateColumns:'1fr auto auto', gap:8, alignItems:'center' }}>
                    <div style={{ minWidth:0 }}>
                      <div style={{ fontSize:12, color:'#eee', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{d.name}</div>
                      <div style={{ fontSize:10, color:'#999' }}>{new Date(d.savedAt).toLocaleString()}</div>
                    </div>
                    <button onClick={()=>importLocal(d)} style={{ fontSize:11 }}>Import</button>
                    <button
                      onClick={()=>{
                        if (!confirm(`Delete local deck "${d.name}"?`)) return;
                        const next = localList.filter(x=>x.id!==d.id);
                        saveLocalAll(next);
                        setLocalList(next);
                      }}
                      style={{ fontSize:11, color:'#f87171' }}
                    >Delete</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === 'server' && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
            <div>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                <span style={{ fontSize:12 }}>Server Decks ({serverDecks.length})</span>
                <input
                  value={serverFilter}
                  onChange={e=>setServerFilter(e.target.value)}
                  placeholder='Filter'
                  style={{ width:140 }}
                />
              </div>
              <div style={{ border:'1px solid #333', borderRadius:6, padding:6, maxHeight:320, overflowY:'auto', background:'#111' }}>
                {filteredServer.length === 0 && <div style={{ fontSize:12, color:'#888' }}>None</div>}
                {filteredServer.map(d=>(
                  <div key={d.id} style={{ borderBottom:'1px solid #222', padding:'6px 4px', display:'grid', gridTemplateColumns:'1fr auto auto auto', gap:8, alignItems:'center' }}>
                    <div style={{ minWidth:0 }}>
                      <div style={{ fontSize:12, color:'#eee', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{d.name}</div>
                      <div style={{ fontSize:10, color:'#999' }}>
                        {new Date(d.created_at).toLocaleDateString()} • {d.created_by_name} • {d.card_count} cards
                      </div>
                    </div>
                    <button onClick={()=>requestDetail(d.id)} style={{ fontSize:11 }}>View</button>
                    <button onClick={()=>importServer(d.id)} style={{ fontSize:11 }}>Use</button>
                    <button
                      onClick={()=>{
                        const newName = prompt('Rename deck', d.name);
                        if (!newName || !newName.trim()) return;
                        renameServerDeck(d, newName.trim());
                      }}
                      disabled={socket.data?.playerId !== d.created_by_id}
                      style={{ fontSize:11 }}
                    >Rename</button>
                    <button
                      onClick={()=>deleteServerDeck(d)}
                      disabled={socket.data?.playerId !== d.created_by_id}
                      style={{ fontSize:11, color:'#f87171' }}
                    >Delete</button>
                  </div>
                ))}
              </div>
              {serverErr && <div style={{ marginTop:8, fontSize:11, color:'#f87171' }}>{serverErr}</div>}
            </div>
            <div>
              <div style={{ fontSize:12, marginBottom:6 }}>Save current pasted deck (from Local tab)</div>
              <textarea
                value={localText}
                onChange={e=>setLocalText(e.target.value)}
                placeholder='Paste list, switch name below'
                style={{ width:'100%', height:180, resize:'vertical', fontSize:12 }}
              />
              <input
                value={localName}
                onChange={e=>setLocalName(e.target.value)}
                placeholder='Name'
                style={{ width:'100%', marginTop:8 }}
              />
              <button
                onClick={saveServer}
                disabled={!localText.trim() || !localName.trim() || saving}
                style={{ marginTop:8 }}
              >
                {saving ? 'Saving…' : 'Save to Server'}
              </button>
            </div>
          </div>
        )}

        {tab === 'preview' && detail && (
          <div>
            <h5 style={{ margin:'4px 0', fontSize:14 }}>{detail.name}</h5>
            <div style={{ fontSize:12, opacity:0.7, marginBottom:6 }}>
              By {detail.created_by_name} • {new Date(detail.created_at).toLocaleString()} • {detail.card_count} cards
            </div>
            <div style={{ maxHeight:360, overflowY:'auto', border:'1px solid #333', padding:8, borderRadius:6, background:'#111' }}>
              <pre style={{ fontSize:11, lineHeight:'14px', whiteSpace:'pre-wrap' }}>{detail.text}</pre>
            </div>
            <div style={{ marginTop:8, display:'flex', gap:8 }}>
              <button onClick={()=>importServer(detail.id)}>Use This Deck</button>
              <button onClick={()=>setTab('server')}>Back</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const backdrop:React.CSSProperties={
  position:'fixed', inset:0,
  background:'rgba(0,0,0,0.45)',
  display:'flex', alignItems:'center', justifyContent:'center',
  zIndex:120
};
const modal:React.CSSProperties={
  background:'#202225',
  border:'1px solid #444',
  borderRadius:8,
  padding:'14px 16px',
  width:880,
  maxWidth:'96vw',
  boxShadow:'0 4px 18px rgba(0,0,0,0.65)',
  color:'#eee'
};