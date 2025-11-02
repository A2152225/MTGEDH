import React, { useEffect, useMemo, useState } from 'react';
import { socket } from './socket';
import type { ClientGameView, GameID, PlayerID } from '../../shared/src';

export function App() {
  const [connected, setConnected] = useState(false);
  const [gameId, setGameId] = useState<GameID>('demo');
  const [name, setName] = useState('Player');
  const [you, setYou] = useState<PlayerID | null>(null);
  const [view, setView] = useState<ClientGameView | null>(null);
  const [priority, setPriority] = useState<PlayerID | null>(null);

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('joined', ({ you }) => setYou(you));
    socket.on('state', ({ view }) => setView(view));
    socket.on('stateDiff', ({ diff }) => {
      if (diff.full) setView(diff.full);
      // patch handling later
    });
    socket.on('priority', ({ player }) => setPriority(player));

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('joined');
      socket.off('state');
      socket.off('stateDiff');
      socket.off('priority');
    };
  }, []);

  const canPass = useMemo(() => {
    if (!view || !you) return false;
    return view.priority === you;
  }, [view, you]);

  return (
    <div style={{ fontFamily: 'system-ui', padding: 16 }}>
      <h1>MTGEDH</h1>
      <div>Status: {connected ? 'connected' : 'disconnected'}</div>

      <div style={{ marginTop: 12 }}>
        <input value={gameId} onChange={e => setGameId(e.target.value)} placeholder="Game ID" />
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Name" />
        <button
          onClick={() => socket.emit('joinGame', { gameId, playerName: name })}
          disabled={!connected}
        >
          Join
        </button>
        <button onClick={() => socket.emit('requestState', { gameId })} disabled={!connected}>
          Refresh
        </button>
      </div>

      {view && (
        <div style={{ marginTop: 16 }}>
          <div>Game: {view.id} | Format: {view.format} | Turn: {view.turnPlayer}</div>
          <div>Priority: {priority ?? view.priority}</div>
          <h3>Players</h3>
          <ul>
            {view.players.map(p => (
              <li key={p.id}>
                {p.name} (seat {p.seat}) — life {view.life[p.id] ?? '-'}
                {you === p.id ? ' (you)' : ''}
              </li>
            ))}
          </ul>
          <button onClick={() => socket.emit('passPriority', { gameId })} disabled={!canPass}>
            Pass Priority
          </button>
        </div>
      )}
    </div>
  );
}