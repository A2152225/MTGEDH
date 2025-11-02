import React, { useEffect, useMemo, useState } from 'react';
import { socket } from './socket';
import type { ClientGameView, GameID, PlayerID } from '../../shared/src';

function seatTokenKey(gameId: GameID) {
  return `mtgedh:seatToken:${gameId}`;
}

type ChatMsg = { id: string; gameId: GameID; from: PlayerID | 'system'; message: string; ts: number };

export function App() {
  const [connected, setConnected] = useState(false);
  const [gameId, setGameId] = useState<GameID>('demo');
  const [name, setName] = useState('Player');
  const [you, setYou] = useState<PlayerID | null>(null);
  const [view, setView] = useState<ClientGameView | null>(null);
  const [priority, setPriority] = useState<PlayerID | null>(null);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [spectatorToGrant, setSpectatorToGrant] = useState<PlayerID>('.');

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('joined', ({ you, seatToken, gameId }) => {
      setYou(you);
      if (seatToken) localStorage.setItem(seatTokenKey(gameId), seatToken);
    });
    socket.on('state', ({ view }) => setView(view));
    socket.on('stateDiff', ({ diff }) => {
      if (diff.full) setView(diff.full);
    });
    socket.on('priority', ({ player }) => setPriority(player));
    socket.on('chat', (msg: ChatMsg) => {
      setChat(prev => [...prev.slice(-99), msg]);
    });

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('joined');
      socket.off('state');
      socket.off('stateDiff');
      socket.off('priority');
      socket.off('chat');
    };
  }, []);

  const canPass = useMemo(() => {
    if (!view || !you) return false;
    return view.priority === you;
  }, [view, you]);

  const handleJoin = () => {
    const token = localStorage.getItem(seatTokenKey(gameId)) || undefined;
    socket.emit('joinGame', { gameId, playerName: name, seatToken: token });
  };

  const grantAccess = () => {
    if (!view) return;
    const id = spectatorToGrant.trim();
    if (!id || id === '.') return;
    socket.emit('grantSpectatorAccess', { gameId: view.id, spectatorId: id as PlayerID });
    setSpectatorToGrant('.');
  };

  return (
    <div style={{ fontFamily: 'system-ui', padding: 16, display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16 }}>
      <div>
        <h1>MTGEDH</h1>
        <div>Status: {connected ? 'connected' : 'disconnected'}</div>

        <div style={{ marginTop: 12 }}>
          <input value={gameId} onChange={e => setGameId(e.target.value)} placeholder="Game ID" />
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Name" />
          <button onClick={handleJoin} disabled={!connected}>
            Join
          </button>
          <button onClick={() => socket.emit('requestState', { gameId })} disabled={!connected}>
            Refresh
          </button>
        </div>

        {view && (
          <div style={{ marginTop: 16 }}>
            <div>Game: {view.id} | Format: {String(view.format)} | Turn: {view.turnPlayer}</div>
            <div>Your ID: {you}</div>
            <div>Priority: {priority ?? view.priority}</div>

            <h3>Players</h3>
            <ul>
              {view.players.map(p => {
                const z = view.zones?.[p.id];
                const counts = `hand ${z?.handCount ?? 0} | library ${z?.libraryCount ?? 0} | graveyard ${z?.graveyardCount ?? 0}`;
                return (
                  <li key={p.id} style={{ marginBottom: 8 }}>
                    {p.name} (seat {p.seat}) — life {view.life[p.id] ?? '-'}
                    {you === p.id ? ' (you)' : ''} — {counts}
                  </li>
                );
              })}
            </ul>

            <button onClick={() => socket.emit('passPriority', { gameId: view.id })} disabled={!canPass}>
              Pass Priority
            </button>
          </div>
        )}
      </div>

      <div>
        <h3>Spectator Access</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={spectatorToGrant} onChange={e => setSpectatorToGrant(e.target.value as PlayerID)} placeholder="Spectator ID" />
          <button onClick={grantAccess} disabled={!view}>Grant</button>
        </div>

        <h3 style={{ marginTop: 16 }}>Chat</h3>
        <div style={{ border: '1px solid #ccc', padding: 8, height: 240, overflow: 'auto', background: '#fafafa' }}>
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