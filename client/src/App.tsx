import React, { useEffect, useMemo, useState } from 'react';
import { socket } from './socket';
import type { ClientGameView, GameID, PlayerID } from '../../shared/src';

function seatTokenKey(gameId: GameID, name: string) {
  return `mtgedh:seatToken:${gameId}:${name.trim().toLowerCase()}`;
}

type ChatMsg = { id: string; gameId: GameID; from: PlayerID | 'system'; message: string; ts: number };
type SearchItem = { id: string; name: string };

export function App() {
  const [connected, setConnected] = useState(false);
  const [gameId, setGameId] = useState<GameID>('demo');
  const [name, setName] = useState('Player');
  const [joinAsSpectator, setJoinAsSpectator] = useState(false);

  const [you, setYou] = useState<PlayerID | null>(null);
  const [view, setView] = useState<ClientGameView | null>(null);
  const [priority, setPriority] = useState<PlayerID | null>(null);
  const [chat, setChat] = useState<ChatMsg[]>([]);

  const [deckText, setDeckText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchItem[]>([]);
  const [searchLimit, setSearchLimit] = useState(100);

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
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('joined');
      socket.off('state');
      socket.off('stateDiff');
      socket.off('priority');
      socket.off('chat');
      socket.off('searchResults');
    };
  }, [name]);

  const canPass = useMemo(() => !!view && !!you && view.priority === you, [view, you]);
  const isYouPlayer = useMemo(() => !!view && !!you && view.players.some(p => p.id === you), [view, you]);

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

  const removePlayer = (playerId: PlayerID) => {
    if (!view) return;
    socket.emit('removePlayer', { gameId: view.id, playerId });
  };

  const toggleSkip = (playerId: PlayerID, inactive: boolean | undefined) => {
    if (!view) return;
    socket.emit(inactive ? 'unskipPlayer' : 'skipPlayer', { gameId: view.id, playerId });
  };

  const grantAccess = (spectatorId: PlayerID) => view && socket.emit('grantSpectatorAccess', { gameId: view.id, spectatorId });
  const revokeAccess = (spectatorId: PlayerID) => view && socket.emit('revokeSpectatorAccess', { gameId: view.id, spectatorId });

  const importDeck = () => { if (view) { socket.emit('importDeck', { gameId: view.id, list: deckText }); setSearchResults([]); } };
  const shuffleLibrary = () => { if (view) { socket.emit('shuffleLibrary', { gameId: view.id }); setSearchResults([]); } };
  const drawOne = () => { if (view) { socket.emit('drawCards', { gameId: view.id, count: 1 }); setSearchResults([]); } };
  // NEW
  const handToLibraryShuffle = () => { if (view) { socket.emit('shuffleHandIntoLibrary', { gameId: view.id }); setSearchResults([]); } };

  const doSearch = () => view && socket.emit('searchLibrary', { gameId: view!.id, query: searchQuery, limit: searchLimit });
  const clearSearch = () => setSearchResults([]);
  const takeFromSearch = (id: string, reveal = false) => view && socket.emit('selectFromSearch', { gameId: view.id, cardIds: [id], moveTo: 'hand', reveal });

  const yourHand = useMemo(() => {
    if (!view || !you) return [];
    const z = view.zones?.[you];
    return (z?.hand ?? []) as any as Array<{ id: string; name?: string }>;
  }, [view, you]);

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
            Join as spectator
          </label>
          <button onClick={handleJoin} disabled={!connected}>Join</button>
          <button onClick={() => socket.emit('requestState', { gameId })} disabled={!connected}>Refresh</button>
        </div>

        {view && (
          <div style={{ marginTop: 16 }}>
            <div>Game: {view.id} | Format: {String(view.format)} | Turn: {view.turnPlayer}</div>
            <div>Your ID: {you}</div>
            <div>Priority: {priority ?? view.priority}</div>

            <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
              <button onClick={() => restart(true)}>Restart (keep players)</button>
              <button onClick={() => restart(false)}>Restart (clear roster)</button>
            </div>

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

            <button onClick={() => socket.emit('passPriority', { gameId: view.id })} disabled={!canPass}>
              Pass Priority
            </button>

            {isYouPlayer && (
              <>
                <h3 style={{ marginTop: 16 }}>Your Library</h3>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                  <button onClick={shuffleLibrary}>Shuffle</button>
                  <button onClick={drawOne}>Draw 1</button>
                  {/* NEW */}
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
                      <button onClick={() => { setSearchResults([]); /* reset before search */ socket.emit('searchLibrary', { gameId: view.id, query: searchQuery, limit: searchLimit }); }}>Search</button>
                      <button onClick={() => setSearchResults([])}>Clear</button>
                    </div>
                    <ul style={{ maxHeight: 180, overflow: 'auto', border: '1px solid #ddd', padding: 8 }}>
                      {searchResults.map(r => (
                        <li key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                          <span>{r.name}</span>
                          <span style={{ display: 'inline-flex', gap: 6 }}>
                            <button onClick={() => socket.emit('selectFromSearch', { gameId: view.id, cardIds: [r.id], moveTo: 'hand', reveal: false })}>Take</button>
                            <button onClick={() => socket.emit('selectFromSearch', { gameId: view.id, cardIds: [r.id], moveTo: 'hand', reveal: true })}>Reveal+Take</button>
                          </span>
                        </li>
                      ))}
                      {searchResults.length === 0 && <li style={{ opacity: 0.6 }}>No results</li>}
                    </ul>
                  </div>
                </div>

                <h3 style={{ marginTop: 16 }}>Your Hand</h3>
                <ul style={{ border: '1px solid #ddd', padding: 8, maxHeight: 160, overflow: 'auto' }}>
                  {(() => {
                    const z = view?.zones?.[you as PlayerID];
                    const hand = (z?.hand ?? []) as any as Array<{ id: string; name?: string }>;
                    return hand.length > 0 ? (
                      hand.map((c, idx) => <li key={`${c.id}-${idx}`}>{c.name ?? 'Card'}</li>)
                    ) : (
                      <li style={{ opacity: 0.6 }}>Empty</li>
                    );
                  })()}
                </ul>
              </>
            )}
          </div>
        )}
      </div>

      <div>
        <h3>Spectators</h3>
        <div style={{ border: '1px solid #ccc', padding: 8, marginBottom: 12 }}>
          {view?.spectators && view.spectators.length > 0 ? (
            <ul>
              {view.spectators.map(s => (
                <li key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span>{s.name} — {s.id}</span>
                  {isYouPlayer && (
                    s.hasAccessToYou
                      ? <button onClick={() => revokeAccess(s.id)}>Revoke access</button>
                      : <button onClick={() => grantAccess(s.id)}>Grant access</button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <div style={{ opacity: 0.6 }}>No spectators</div>
          )}
        </div>

        <h3>Chat</h3>
        <div style={{ border: '1px solid #ccc', padding: 8, height: 280, overflow: 'auto', background: '#fafafa' }}>
          {chat.map(m => (
            <div key={m.id} style={{ fontSize: 12 }}>
              <b>{m.from}</b>: {m.message} <span style={{ opacity: 0.6 }}>({new Date(m.ts).toLocaleTimeString()})</span>
            </div>
          ))}
          {chat.length === 0 && <div style={{ opacity: 0.6 }}>No messages</div>}
        </div>
      </div>
    </div>
  );
}