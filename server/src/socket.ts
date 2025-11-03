import type { Server, Socket } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
  GameID,
  ClientGameView,
  PlayerID,
  KnownCardRef
} from '../../shared/src';
import { createInitialGameState, type InMemoryGame, type GameEvent } from './state/gameState';
import { computeDiff } from './utils/diff';
import { createGameIfNotExists, getEvents, appendEvent } from './db';
import { parseDecklist, fetchCardsByExactNamesBatch, validateDeck, normalizeName, fetchCardByExactNameStrict } from './services/scryfall';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

const games: Map<GameID, InMemoryGame> = new Map();

function ensureGame(gameId: GameID): InMemoryGame {
  let game = games.get(gameId);
  if (!game) {
    game = createInitialGameState(gameId);
    createGameIfNotExists(gameId, String(game.state.format), game.state.startingLife);

    const persisted = getEvents(gameId);
    const replayEvents: GameEvent[] = persisted.map(e => {
      switch (e.type) {
        case 'join':
        case 'leave':
        case 'passPriority':
        case 'restart':
        case 'removePlayer':
        case 'skipPlayer':
        case 'unskipPlayer':
        case 'spectatorGrant':
        case 'spectatorRevoke':
        case 'deckImportResolved':
        case 'shuffleLibrary':
        case 'drawCards':
        case 'selectFromLibrary':
        // NEW
        case 'handIntoLibrary':
          return { type: e.type, ...(e.payload || {}) } as GameEvent;
        default:
          return e.payload as GameEvent;
      }
    });
    game.replay(replayEvents);

    games.set(gameId, game);
  }
  return game;
}

function broadcastGame(io: TypedServer, game: InMemoryGame, gameId: GameID) {
  const participants = game.participants();
  for (const p of participants) {
    const view = game.viewFor(p.playerId, p.spectator);
    io.to(p.socketId).emit('stateDiff', {
      gameId,
      diff: computeDiff<ClientGameView>(undefined, view, game.seq)
    });
  }
}

export function registerSocketHandlers(io: TypedServer) {
  io.on('connection', (socket: Socket) => {
    socket.on('joinGame', ({ gameId, playerName, spectator, seatToken }) => {
      const game = ensureGame(gameId);
      const { playerId, added, seatToken: resolvedToken } = game.join(
        socket.id, playerName, Boolean(spectator), undefined, seatToken
      );

      socket.data.gameId = gameId;
      socket.data.playerId = playerId;
      socket.data.spectator = spectator;

      socket.join(gameId);
      socket.emit('joined', { gameId, you: playerId, seatToken: resolvedToken });

      const view = game.viewFor(playerId, Boolean(spectator));
      socket.emit('state', { gameId, view, seq: game.seq });

      if (!spectator && added) {
        appendEvent(gameId, game.seq, 'join', {
          playerId, name: playerName, seat: view.players.find(p => p.id === playerId)?.seat, seatToken: resolvedToken
        });
      }

      socket.to(gameId).emit('stateDiff', { gameId, diff: computeDiff<ClientGameView>(undefined, view, game.seq) });
    });

    socket.on('requestState', ({ gameId }) => {
      const game = games.get(gameId);
      if (!game || !socket.data.playerId) return;
      const view = game.viewFor(socket.data.playerId, Boolean(socket.data.spectator));
      socket.emit('state', { gameId, view, seq: game.seq });
    });

    socket.on('passPriority', ({ gameId }) => {
      const game = games.get(gameId);
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!game || !pid) return;
      const changed = game.passPriority(pid);
      if (!changed) return;
      appendEvent(gameId, game.seq, 'passPriority', { by: pid });
      broadcastGame(io, game, gameId);
      io.to(gameId).emit('priority', { gameId, player: game.state.priority });
    });

    // Admin
    socket.on('restartGame', ({ gameId, preservePlayers }) => {
      const game = ensureGame(gameId);
      game.reset(Boolean(preservePlayers));
      appendEvent(gameId, game.seq, 'restart', { preservePlayers: Boolean(preservePlayers) });
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`, gameId, from: 'system',
        message: `Game restarted (${Boolean(preservePlayers) ? 'keeping players' : 'cleared roster'})`, ts: Date.now()
      });
      broadcastGame(io, game, gameId);
    });

    socket.on('removePlayer', ({ gameId, playerId }) => {
      const game = ensureGame(gameId);
      const removed = game.remove(playerId);
      if (!removed) return;
      appendEvent(gameId, game.seq, 'removePlayer', { playerId });
      io.to(gameId).emit('chat', { id: `m_${Date.now()}`, gameId, from: 'system', message: `Player ${playerId} was removed`, ts: Date.now() });
      broadcastGame(io, game, gameId);
    });

    socket.on('skipPlayer', ({ gameId, playerId }) => {
      const game = ensureGame(gameId);
      game.skip(playerId);
      appendEvent(gameId, game.seq, 'skipPlayer', { playerId });
      io.to(gameId).emit('chat', { id: `m_${Date.now()}`, gameId, from: 'system', message: `Player ${playerId} is now skipped`, ts: Date.now() });
      broadcastGame(io, game, gameId);
    });

    socket.on('unskipPlayer', ({ gameId, playerId }) => {
      const game = ensureGame(gameId);
      game.unskip(playerId);
      appendEvent(gameId, game.seq, 'unskipPlayer', { playerId });
      io.to(gameId).emit('chat', { id: `m_${Date.now()}`, gameId, from: 'system', message: `Player ${playerId} is no longer skipped`, ts: Date.now() });
      broadcastGame(io, game, gameId);
    });

    // Visibility control (players only)
    socket.on('grantSpectatorAccess', ({ gameId, spectatorId }) => {
      const game = games.get(gameId);
      const owner = socket.data.playerId as PlayerID | undefined;
      if (!game || !owner || socket.data.spectator) return; // spectators cannot grant
      const isPlayer = game.state.players.some(p => p.id === owner);
      if (!isPlayer) return;

      game.grantSpectatorAccess(owner, spectatorId);
      appendEvent(gameId, game.seq, 'spectatorGrant', { owner, spectator: spectatorId });

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`, gameId, from: 'system',
        message: `Player ${owner} granted hidden-info access to spectator ${spectatorId}`, ts: Date.now()
      });

      broadcastGame(io, game, gameId);
    });

    socket.on('revokeSpectatorAccess', ({ gameId, spectatorId }) => {
      const game = games.get(gameId);
      const owner = socket.data.playerId as PlayerID | undefined;
      if (!game || !owner || socket.data.spectator) return;
      const isPlayer = game.state.players.some(p => p.id === owner);
      if (!isPlayer) return;

      game.revokeSpectatorAccess(owner, spectatorId);
      appendEvent(gameId, game.seq, 'spectatorRevoke', { owner, spectator: spectatorId });

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`, gameId, from: 'system',
        message: `Player ${owner} revoked hidden-info access from spectator ${spectatorId}`, ts: Date.now()
      });

      broadcastGame(io, game, gameId);
    });

    // Deck import (batch + validate + strict retry for misses)
    socket.on('importDeck', async ({ gameId, list }) => {
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!pid || socket.data.spectator) return;
      const game = ensureGame(gameId);

      const parsed = parseDecklist(list); // aggregated counts per name
      const requestedNames = parsed.map(p => p.name);
      let byName: Map<string, any>;
      try {
        byName = await fetchCardsByExactNamesBatch(requestedNames);
      } catch (e: any) {
        socket.emit('error', { code: 'SCRYFALL', message: e?.message || 'Deck import failed' });
        return;
      }

      // Expand to full list with counts, using case-insensitive lookups
      const resolvedCards: Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text'>> = [];
      const validationCards: any[] = [];
      const missing: string[] = [];

      for (const { name, count } of parsed) {
        const key = normalizeName(name).toLowerCase();
        const c = byName.get(key);
        if (!c) {
          missing.push(name);
          continue;
        }
        for (let i = 0; i < count; i++) {
          validationCards.push(c);
          resolvedCards.push({ id: c.id, name: c.name, type_line: c.type_line, oracle_text: c.oracle_text });
        }
      }

      // Retry strict for any misses
      if (missing.length) {
        for (const miss of missing) {
          try {
            const c = await fetchCardByExactNameStrict(miss);
            const count = parsed.find(p => p.name === miss)?.count ?? 1;
            for (let i = 0; i < count; i++) {
              validationCards.push(c);
              resolvedCards.push({ id: c.id, name: c.name, type_line: c.type_line, oracle_text: c.oracle_text });
            }
          } catch {
            // Keep missing; will be reported as warning
          }
        }
      }

      game.importDeckResolved(pid, resolvedCards);
      appendEvent(gameId, game.seq, 'deckImportResolved', { playerId: pid, cards: resolvedCards });

      // Validate vs format (warn-only)
      const fmt = String(game.state.format);
      const report = validateDeck(fmt, validationCards);
      const expected = parsed.reduce((sum, p) => sum + p.count, 0);
      const summaryLines: string[] = [];
      summaryLines.push(`Player ${pid} imported ${resolvedCards.length}/${expected} cards.`);
      const stillMissing = parsed
        .filter(p => !resolvedCards.some(rc => rc.name.toLowerCase() === p.name.toLowerCase()))
        .map(p => p.name);
      if (stillMissing.length) {
        summaryLines.push(`Missing: ${stillMissing.slice(0, 10).join(', ')}${stillMissing.length > 10 ? ', …' : ''}`);
      }
      if (report.illegal.length) {
        summaryLines.push(
          `Illegal (${report.illegal.length}): ${report.illegal
            .slice(0, 10)
            .map(i => `${i.name} (${i.reason})`)
            .join(', ')}${report.illegal.length > 10 ? ', …' : ''}`
        );
      }
      if (report.warnings.length) {
        summaryLines.push(...report.warnings.map(w => `Warning: ${w}`));
      }

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`, gameId, from: 'system',
        message: summaryLines.join(' '), ts: Date.now()
      });
      broadcastGame(io, game, gameId);
    });

    socket.on('shuffleLibrary', ({ gameId }) => {
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!pid || socket.data.spectator) return;
      const game = ensureGame(gameId);
      game.shuffleLibrary(pid);
      appendEvent(gameId, game.seq, 'shuffleLibrary', { playerId: pid });
      io.to(gameId).emit('chat', { id: `m_${Date.now()}`, gameId, from: 'system', message: `Player ${pid} shuffled their library`, ts: Date.now() });
      broadcastGame(io, game, gameId);
    });

    // NEW: move entire hand into library, then shuffle
    socket.on('shuffleHandIntoLibrary', ({ gameId }) => {
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!pid || socket.data.spectator) return;
      const game = ensureGame(gameId);

      const moved = game.moveHandToLibrary(pid);
      if (moved > 0) {
        appendEvent(gameId, game.seq, 'handIntoLibrary', { playerId: pid });
      }
      // Always shuffle after, even if moved 0 (safe no-op shuffle on empty lib is fine)
      game.shuffleLibrary(pid);
      appendEvent(gameId, game.seq, 'shuffleLibrary', { playerId: pid });

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`, gameId, from: 'system',
        message: `Player ${pid} moved ${moved} card(s) from hand to library and shuffled`, ts: Date.now()
      });
      broadcastGame(io, game, gameId);
    });

    socket.on('drawCards', ({ gameId, count }) => {
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!pid || socket.data.spectator) return;
      const game = ensureGame(gameId);
      const n = Math.max(1, Math.min(50, count | 0));
      game.drawCards(pid, n);
      appendEvent(gameId, game.seq, 'drawCards', { playerId: pid, count: n });
      broadcastGame(io, game, gameId);
    });

    // Owner-only search with private results; match name, type, oracle text
    socket.on('searchLibrary', ({ gameId, query, limit }) => {
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!pid || socket.data.spectator) return;
      const game = ensureGame(gameId);
      const results = game.searchLibrary(pid, query || '', Math.max(1, Math.min(200, (limit ?? 100))));
      io.to(socket.id).emit('searchResults', { gameId, cards: results, total: results.length });
    });

    socket.on('selectFromSearch', ({ gameId, cardIds, moveTo, reveal }) => {
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!pid || socket.data.spectator) return;
      const game = ensureGame(gameId);
      const movedNames = game.selectFromLibrary(pid, cardIds, moveTo);
      appendEvent(gameId, game.seq, 'selectFromLibrary', { playerId: pid, cardIds, moveTo, reveal: Boolean(reveal) });
      if (reveal && movedNames.length) {
        io.to(gameId).emit('chat', { id: `m_${Date.now()}`, gameId, from: 'system', message: `Revealed: ${movedNames.join(', ')}`, ts: Date.now() });
      }
      broadcastGame(io, game, gameId);
    });

    socket.on('leaveGame', ({ gameId }) => {
      const game = games.get(gameId);
      if (!game) return;
      const left = game.leave(socket.data.playerId);
      socket.leave(gameId);
      if (left && socket.data.playerId) {
        appendEvent(gameId, game.seq, 'leave', { playerId: socket.data.playerId });
        broadcastGame(io, game, gameId);
      }
    });

    socket.on('disconnect', () => {
      const { gameId } = socket.data;
      if (!gameId) return;
      const game = games.get(gameId);
      if (!game) return;
      game.disconnect(socket.id);
    });
  });
}