import React, { useEffect, useMemo, useState } from 'react';
import { socket } from './socket';
import type {
  ClientGameView,
  GameID,
  PlayerID,
  BattlefieldPermanent,
  TargetRef
} from '../../shared/src';
import { BattlefieldGrid, type ImagePref } from './components/BattlefieldGrid';
import { TokenGroups } from './components/TokenGroups';
import { TableLayout } from './components/TableLayout';

function seatTokenKey(gameId: GameID, name: string) {
  return `mtgedh:seatToken:${gameId}:${name.trim().toLowerCase()}`;
}

type ChatMsg = { id: string; gameId: GameID; from: PlayerID | 'system'; message: string; ts: number };
type SearchItem = { id: string; name: string };
type LayoutMode = 'rows' | 'table';

export function App() {
  // Connection/session
  const [connected, setConnected] = useState(false);
  const [gameId, setGameId] = useState<GameID>('demo');
  const [name, setName] = useState('Player');
  const [joinAsSpectator, setJoinAsSpectator] = useState(false);

  // Live state
  const [you, setYou] = useState<PlayerID | null>(null);
  const [view, setView] = useState<ClientGameView | null>(null);
  const [priority, setPriority] = useState<PlayerID | null>(null);
  const [chat, setChat] = useState<ChatMsg[]>([]);

  // Deck/search
  const [deckText, setDeckText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchItem[]>([]);
  const [searchLimit, setSearchLimit] = useState(100);

  // Visual prefs
  const [imagePref, setImagePref] = useState<ImagePref>(() => (localStorage.getItem('mtgedh:imagePref') as ImagePref) || 'normal');
  const [groupTokensByCounters, setGroupTokensByCounters] = useState(false);
  const [layout, setLayout] = useState<LayoutMode>(() => (localStorage.getItem('mtgedh:layout') as LayoutMode) || 'rows');

  // Targeting overlay state
  const [targeting, setTargeting] = useState<{
    spellId: string;
    min: number;
    max: number;
    targets: TargetRef[];
    chosen: Set<string>;
  } | null>(null);

  // Socket wiring
  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    socket.on('joined', ({ you, seatToken, gameId }) => {
      setYou(you);
      if (seatToken) sessionStorage.setItem(seatTokenKey(gameId, name), seatToken);
    });

    socket.on('state', ({ view }) => setView(view));
    socket.on('stateDiff', ({ diff }) => { if (diff.full) setView(diff.full); });
    socket.on('priority', ({ player }) => setPriority(player));
    socket.on('chat', (msg: ChatMsg) => setChat(prev => [...prev.slice(-99), msg]));
    socket.on('searchResults', ({ cards }) => setSearchResults(cards));
    socket.on('validTargets', ({ spellId, minTargets, maxTargets, targets }) => {
      setTargeting({ spellId, min: minTargets, max: maxTargets, targets, chosen: new Set() });
    });

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('joined');
      socket.off('state');
      socket.off('stateDiff');
      socket.off('priority');
      socket.off('chat');
      socket.off('searchResults');
      socket.off('validTargets');
    };
  }, [name]);

  // Derived flags/data
  const canPass = useMemo(() => !!view && !!you && view.priority === you, [view, you]);
  const isYouPlayer = useMemo(() => !!view && !!you && view.players.some(p => p.id === you), [view, you]);

  const battlefieldByPlayer = useMemo(() => {
    const map = new Map<PlayerID, BattlefieldPermanent[]>();
    for (const p of (view?.players ?? [])) map.set(p.id, []);
    for (const perm of (view?.battlefield ?? [])) {
      const arr = map.get(perm.controller) || [];
      arr.push(perm);
      map.set(perm.controller, arr);
    }
    return map;
  }, [view]);

  const attachedToSet = useMemo(() => {
    const set = new Set<string>();
    for (const perm of (view?.battlefield ?? [])) {
      if (perm.attachedTo) set.add(perm.attachedTo);
    }
    return set;
  }, [view]);

  const turnDirLabel = useMemo(() => (view?.turnDirection ?? 1) === 1 ? 'Clockwise' : 'Counter-clockwise', [view?.turnDirection]);

  // Actions
  const handleJoin = () => {
    const token = sessionStorage.getItem(seatTokenKey(gameId, name)) || undefined;
    socket.emit('joinGame', { gameId, playerName: name, spectator: joinAsSpectator, seatToken: token });
  };

  const restart = (preservePlayers: boolean) => {
    if (!view) return;
    socket.emit('restartGame', { gameId: view.id, preservePlayers });
    if (!preservePlayers) sessionStorage.removeItem(seatTokenKey(view.id, name));
    setSearchResults([]);
  };

  const removePlayer = (playerId: PlayerID) => view && socket.emit('removePlayer', { gameId: view.id, playerId });
  const toggleSkip = (playerId: PlayerID, inactive: boolean | undefined) =>
    view && socket.emit(inactive ? 'unskipPlayer' : 'skipPlayer', { gameId: view.id, playerId });

  const grantAccess = (spectatorId: PlayerID) => view && socket.emit('grantSpectatorAccess', { gameId: view.id, spectatorId });
  const revokeAccess = (spectatorId: PlayerID) => view && socket.emit('revokeSpectatorAccess', { gameId: view.id, spectatorId });

  const importDeck = () => { if (view) { socket.emit('importDeck', { gameId: view.id, list: deckText }); setSearchResults([]); } };
  const shuffleLibrary = () => { if (view) { socket.emit('shuffleLibrary', { gameId: view.id }); setSearchResults([]); } };
  const drawOne = () => { if (view) { socket.emit('drawCards', { gameId: view.id, count: 1 }); setSearchResults([]); } };
  const handToLibraryShuffle = () => { if (view) { socket.emit('shuffleHandIntoLibrary', { gameId: view.id }); setSearchResults([]); } };

  const doSearch = () => view && socket.emit('searchLibrary', { gameId: view!.id, query: searchQuery, limit: searchLimit });
  const clearSearch = () => setSearchResults([]);
  const takeFromSearch = (id: string, reveal = false) => view && socket.emit('selectFromSearch', { gameId: view.id, cardIds: [id], moveTo: 'hand', reveal });

  const addCounter = (permId: string, kind: string, delta: number) =>
    view && socket.emit('updateCounters', { gameId: view.id, permanentId: permId, deltas: { [kind]: delta } });
  const bulkCounter = (ids: string[], deltas: Record<string, number>) =>
    view && ids.length > 0 && socket.emit('updateCountersBulk', { gameId: view.id, updates: ids.map(id => ({ permanentId: id, deltas })) });
  const removePermanent = (permId: string) => view && socket.emit('removePermanent', { gameId: view.id, permanentId: permId });

  const setPref = (pref: ImagePref) => { setImagePref(pref); localStorage.setItem('mtgedh:imagePref', pref); };
  const setLayoutPref = (m: LayoutMode) => { setLayout(m); localStorage.setItem('mtgedh:layout', m); };

  // Targeting flow
  const beginCast = (cardId: string) => view && socket.emit('beginCast', { gameId: view.id, cardId });
  const toggleChoose = (t: TargetRef) => {
    setTargeting(prev => {
      if (!prev || !view) return prev;
      const key = `${t.kind}:${t.id}`;
      const next = new Set(prev.chosen);
      if (next.has(key)) next.delete(key);
      else if (next.size < prev.max) next.add(key);

      const chosenArr: TargetRef[] = Array.from(next).map(k => {
        const [kind, id] = k.split(':');
        return { kind: kind as TargetRef['kind'], id } as TargetRef;
      });
      socket.emit('chooseTargets', { gameId: view.id, spellId: prev.spellId, chosen: chosenArr });
      return { ...prev, chosen: next };
    });
  };
  const cancelCast = () => { if (view && targeting) socket.emit('cancelCast', { gameId: view.id, spellId: targeting.spellId }); setTargeting(null); };
  const confirmCast = () => { if (view && targeting) socket.emit('confirmCast', { gameId: view.id, spellId: targeting.spellId }); setTargeting(null); };

  return (
    <div style={{ fontFamily: 'system-ui', padding: 16, display: 'grid', gridTemplateColumns: '1fr 420px', gap: 16 }}>
      <div>
        <h1>MTGEDH</h1>
        <div>Status: {connected ? 'connected' : 'disconnected'}</div>

        <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input value={gameId} onChange={e => setGameId(e.target.value)} placeholder="Game ID" />
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Name" />
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={joinAsSpectator} onChange={e => setJoinAsSpectator(e.target.checked)} />
            Spectator
          </label>
          <button onClick={handleJoin} disabled={!connected}>Join</button>
          <button onClick={() => socket.emit('requestState', { gameId })} disabled={!connected}>Refresh</button>
        </div>

        {view && (
          <>
            <div style={{ marginTop: 8, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <div>Game: {view.id} | Format: {String(view.format)} | Turn: {view.turnPlayer}</div>
              <div>Priority: {priority ?? view.priority}</div>
              <div>Turn order: {turnDirLabel}</div>
              <button onClick={() => socket.emit('toggleTurnDirection', { gameId: view.id })}>Reverse turn order</button>
              <label>Layout:
                <select value={layout} onChange={e => setLayoutPref(e.target.value as LayoutMode)} style={{ marginLeft: 6 }}>
                  <option value="rows">Rows</option>
                  <option value="table">Table</option>
                </select>
              </label>
              <label>Image:
                <select value={imagePref} onChange={e => setPref(e.target.value as ImagePref)} style={{ marginLeft: 6 }}>
                  <option value="small">small</option>
                  <option value="normal">normal</option>
                  <option value="art_crop">art_crop</option>
                </select>
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={groupTokensByCounters} onChange={e => setGroupTokensByCounters(e.target.checked)} />
                Group tokens by counters
              </label>
              <span style={{ fontSize: 12, opacity: 0.7 }}>
                Card images courtesy of <a href="https://scryfall.com/docs/api" target="_blank" rel="noreferrer">Scryfall</a>
              </span>
            </div>

            {/* Admin/basic actions */}
            <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
              <button onClick={() => restart(true)}>Restart (keep players)</button>
              <button onClick={() => restart(false)}>Restart (clear roster)</button>
              <button onClick={() => socket.emit('passPriority', { gameId: view.id })} disabled={!canPass}>Pass Priority</button>
            </div>

            {/* Per-player controls */}
            <h3 style={{ marginTop: 16 }}>Players</h3>
            <ul>
              {view.players.map(p => {
                const z = view.zones?.[p.id];
                const counts = `hand ${z?.handCount ?? 0} | library ${z?.libraryCount ?? 0} | graveyard ${z?.graveyardCount ?? 0}`;
                const isYouRow = you === p.id;
                return (
                  <li key={p.id} style={{ marginBottom: 8 }}>
                    <span>
                      {p.name} (seat {p.seat}) — life {view.life[p.id] ?? '-'}
                      {isYouRow ? ' (you)' : ''} — {counts}
                      {p.inactive ? ' — [SKIPPED]' : ''}
                    </span>
                    <span style={{ marginLeft: 8, display: 'inline-flex', gap: 6 }}>
                      <button onClick={() => toggleSkip(p.id, p.inactive)}>{p.inactive ? 'Unskip' : 'Skip'}</button>
                      <button onClick={() => removePlayer(p.id)}>Remove</button>
                    </span>
                  </li>
                );
              })}
            </ul>

            {isYouPlayer && (
              <>
                <h3 style={{ marginTop: 16 }}>Your Library</h3>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                  <button onClick={shuffleLibrary}>Shuffle</button>
                  <button onClick={drawOne}>Draw 1</button>
                  <button onClick={handToLibraryShuffle}>Hand → Library + Shuffle</button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <div>Import deck</div>
                    <textarea
                      value={deckText}
                      onChange={e => setDeckText(e.target.value)}
                      placeholder="Paste decklist (e.g., '1x Sol Ring' or 'Island x96')"
                      rows={6}
                      style={{ width: '100%' }}
                    />
                    <div style={{ marginTop: 8 }}>
                      <button onClick={importDeck}>Import</button>
                    </div>
                  </div>

                  <div>
                    <div>Search library</div>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                      <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Name / type / rules text..." />
                      <input
                        type="number"
                        value={searchLimit}
                        min={1}
                        max={200}
                        onChange={e => setSearchLimit(Math.max(1, Math.min(200, Number(e.target.value) || 1)))}
                        style={{ width: 72 }}
                        title="Max results"
                      />
                      <button onClick={() => { setSearchResults([]); doSearch(); }}>Search</button>
                      <button onClick={clearSearch}>Clear</button>
                    </div>
                    <ul style={{ maxHeight: 180, overflow: 'auto', border: '1px solid #ddd', padding: 8 }}>
                      {searchResults.map(r => (
                        <li key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                          <span>{r.name}</span>
                          <span style={{ display: 'inline-flex', gap: 6 }}>
                            <button onClick={() => takeFromSearch(r.id, false)}>Take</button>
                            <button onClick={() => takeFromSearch(r.id, true)}>Reveal+Take</button>
                          </span>
                        </li>
                      ))}
                      {searchResults.length === 0 && <li style={{ opacity: 0.6 }}>No results</li>}
                    </ul>
                  </div>
                </div>

                {/* Your Hand with Cast button */}
                <h3 style={{ marginTop: 16 }}>Your Hand</h3>
                <ul style={{ border: '1px solid #ddd', padding: 8, maxHeight: 160, overflow: 'auto' }}>
                  {(() => {
                    const z = view?.zones?.[you as PlayerID];
                    const hand = (z?.hand ?? []) as any as Array<{ id: string; name?: string }>;
                    return hand.length > 0 ? (
                      hand.map((c, idx) => (
                        <li key={`${c.id}-${idx}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                          <span>{c.name ?? 'Card'}</span>
                          <span style={{ display: 'inline-flex', gap: 6 }}>
                            <button onClick={() => beginCast(c.id)}>Cast</button>
                          </span>
                        </li>
                      ))
                    ) : (
                      <li style={{ opacity: 0.6 }}>Empty</li>
                    );
                  })()}
                </ul>
              </>
            )}

            {/* Board */}
            {layout === 'table' ? (
              <div style={{ marginTop: 16 }}>
                <TableLayout
                  players={view.players}
                  permanentsByPlayer={battlefieldByPlayer}
                  imagePref={imagePref}
                  isYouPlayer={!!isYouPlayer}
                  onRemove={removePermanent}
                  onCounter={addCounter}
                  onBulkCounter={bulkCounter}
                  groupTokensByCounters={groupTokensByCounters}
                />
              </div>
            ) : (
              <div style={{ marginTop: 16, display: 'grid', gap: 16 }}>
                {(view.players ?? []).map(p => {
                  const perms = battlefieldByPlayer.get(p.id) || [];
                  const tokens = perms.filter(x => (x.card as any)?.type_line === 'Token');
                  const nonTokens = perms.filter(x => (x.card as any)?.type_line !== 'Token');
                  return (
                    <div key={p.id}>
                      <div style={{ fontWeight: 700, marginBottom: 8 }}>{p.name} — {p.id === you ? 'Your board' : 'Opponent'}</div>
                      {nonTokens.length > 0 && (
                        <>
                          <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>Permanents</div>
                          <BattlefieldGrid
                            perms={nonTokens}
                            imagePref={imagePref}
                            onRemove={isYouPlayer ? (id => removePermanent(id)) : undefined}
                            onCounter={isYouPlayer ? ((id, kind, delta) => addCounter(id, kind, delta)) : undefined}
                          />
                        </>
                      )}
                      {tokens.length > 0 && (
                        <>
                          <div style={{ fontSize: 12, opacity: 0.7, margin: '12px 0 6px' }}>Tokens</div>
                          <TokenGroups
                            tokens={tokens}
                            groupMode={groupTokensByCounters ? 'name+counters+pt+attach' : 'name+pt+attach'}
                            attachedToSet={attachedToSet}
                            onBulkCounter={(ids, deltas) => bulkCounter(ids, deltas)}
                          />
                        </>
                      )}
                      {perms.length === 0 && <div style={{ opacity: 0.6 }}>Empty battlefield</div>}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Sidebar */}
      <div>
        <h3>Chat</h3>
        <div style={{ border: '1px solid #ccc', padding: 8, height: 360, overflow: 'auto', background: '#fafafa' }}>
          {chat.map(m => (
            <div key={m.id} style={{ fontSize: 12 }}>
              <b>{m.from}</b>: {m.message} <span style={{ opacity: 0.6 }}>({new Date(m.ts).toLocaleTimeString()})</span>
            </div>
          ))}
          {chat.length === 0 && <div style={{ opacity: 0.6 }}>No messages</div>}
        </div>
      </div>

      {/* Targeting overlay */}
      {targeting && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999
        }}>
          <div style={{ background: '#fff', borderRadius: 8, padding: 16, width: 520, maxHeight: '70vh', overflow: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>Select targets</h3>
              <button onClick={cancelCast}>Close</button>
            </div>
            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>
              Choose {targeting.min === targeting.max ? targeting.max : `${targeting.min}–${targeting.max}`} target(s)
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              {targeting.targets.map(t => {
                const key = `${t.kind}:${t.id}`;
                const checked = targeting.chosen.has(key);
                return (
                  <label key={key} style={{ display: 'flex', gap: 8, alignItems: 'center', border: '1px solid #eee', borderRadius: 6, padding: 6 }}>
                    <input type="checkbox" checked={checked} onChange={() => toggleChoose(t)} />
                    <span>{t.kind} — {t.id}</span>
                  </label>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
              <button onClick={cancelCast}>Cancel</button>
              <button
                onClick={confirmCast}
                disabled={targeting.chosen.size < targeting.min || targeting.chosen.size > targeting.max}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;