import type { Server, Socket } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
  GameID,
  ClientGameView,
  PlayerID,
  KnownCardRef,
  TargetRef
} from '../../shared/src';
import { createInitialGameState, type InMemoryGame, type GameEvent } from './state/gameState';
import { computeDiff } from './utils/diff';
import { createGameIfNotExists, getEvents, appendEvent } from './db';
import {
  parseDecklist,
  fetchCardsByExactNamesBatch,
  validateDeck,
  normalizeName,
  fetchCardByExactNameStrict
} from './services/scryfall';
import { categorizeSpell, evaluateTargeting as evalTargets } from './rules-engine/targeting';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

const games: Map<GameID, InMemoryGame> = new Map();

// Pending casts are ephemeral and not persisted; only final resolveSpell is persisted.
type PendingCast = {
  spellId: string;
  caster: PlayerID;
  cardId: string;
  spec: NonNullable<ReturnType<typeof categorizeSpell>>;
  valid: TargetRef[];
  chosen: TargetRef[];
  min: number;
  max: number;
};
const pendingByGame: Map<GameID, Map<string, PendingCast>> = new Map();
const newSpellId = () => `sp_${Math.random().toString(36).slice(2, 9)}`;

function ensureGame(gameId: GameID): InMemoryGame {
  let game = games.get(gameId);
  if (!game) {
    game = createInitialGameState(gameId);
    createGameIfNotExists(gameId, String(game.state.format), game.state.startingLife);

    const persisted = getEvents(gameId);
    const replayEvents: GameEvent[] = persisted.map(e => {
      switch (e.type) {
        case 'rngSeed':
        case 'setTurnDirection':
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
        case 'handIntoLibrary':
        case 'setCommander':
        case 'castCommander':
        case 'moveCommanderToCZ':
        case 'updateCounters':
        case 'updateCountersBulk':
        case 'createToken':
        case 'removePermanent':
        case 'dealDamage':
        case 'resolveSpell':
          return { type: e.type, ...(e.payload || {}) } as GameEvent;
        default:
          // Fallback for any unknown legacy event payloads
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
    // Join
    socket.on('joinGame', ({ gameId, playerName, spectator, seatToken }) => {
      const game = ensureGame(gameId);

      // Seed RNG if needed
      if (!game.hasRngSeed()) {
        const seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
        game.seedRng(seed);
        appendEvent(gameId, game.seq, 'rngSeed', { seed });
      }

      const { playerId, added, seatToken: resolvedToken } = game.join(
        socket.id,
        playerName,
        Boolean(spectator),
        undefined,
        seatToken
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
          playerId,
          name: playerName,
          seat: view.players.find(p => p.id === playerId)?.seat,
          seatToken: resolvedToken
        });
      }

      // Let others get the current snapshot as diff
      socket.to(gameId).emit('stateDiff', { gameId, diff: computeDiff<ClientGameView>(undefined, view, game.seq) });
    });

    // Request state refresh
    socket.on('requestState', ({ gameId }) => {
      const game = games.get(gameId);
      if (!game || !socket.data.playerId) return;
      const view = game.viewFor(socket.data.playerId, Boolean(socket.data.spectator));
      socket.emit('state', { gameId, view, seq: game.seq });
    });

    // Priority
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

    // Turn order direction toggle
    socket.on('toggleTurnDirection', ({ gameId }) => {
      const game = ensureGame(gameId);
      const current = (game.state.turnDirection ?? 1) as 1 | -1;
      const next = (current === 1 ? -1 : 1) as 1 | -1;
      game.setTurnDirection(next);
      appendEvent(gameId, game.seq, 'setTurnDirection', { direction: next });
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `Turn order now ${next === 1 ? 'clockwise' : 'counter-clockwise'}`,
        ts: Date.now()
      });
      broadcastGame(io, game, gameId);
    });

    // Admin
    socket.on('restartGame', ({ gameId, preservePlayers }) => {
      const game = ensureGame(gameId);
      game.reset(Boolean(preservePlayers));
      appendEvent(gameId, game.seq, 'restart', { preservePlayers: Boolean(preservePlayers) });
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `Game restarted (${Boolean(preservePlayers) ? 'keeping players' : 'cleared roster'})`,
        ts: Date.now()
      });
      broadcastGame(io, game, gameId);
    });

    socket.on('removePlayer', ({ gameId, playerId }) => {
      const game = ensureGame(gameId);
      const removed = game.remove(playerId);
      if (!removed) return;
      appendEvent(gameId, game.seq, 'removePlayer', { playerId });
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `Player ${playerId} was removed`,
        ts: Date.now()
      });
      broadcastGame(io, game, gameId);
    });

    socket.on('skipPlayer', ({ gameId, playerId }) => {
      const game = ensureGame(gameId);
      game.skip(playerId);
      appendEvent(gameId, game.seq, 'skipPlayer', { playerId });
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `Player ${playerId} is now skipped`,
        ts: Date.now()
      });
      broadcastGame(io, game, gameId);
    });

    socket.on('unskipPlayer', ({ gameId, playerId }) => {
      const game = ensureGame(gameId);
      game.unskip(playerId);
      appendEvent(gameId, game.seq, 'unskipPlayer', { playerId });
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `Player ${playerId} is no longer skipped`,
        ts: Date.now()
      });
      broadcastGame(io, game, gameId);
    });

    // Visibility control (players only)
    socket.on('grantSpectatorAccess', ({ gameId, spectatorId }) => {
      const game = games.get(gameId);
      const owner = socket.data.playerId as PlayerID | undefined;
      if (!game || !owner || socket.data.spectator) return;
      const isPlayer = game.state.players.some(p => p.id === owner);
      if (!isPlayer) return;

      game.grantSpectatorAccess(owner, spectatorId);
      appendEvent(gameId, game.seq, 'spectatorGrant', { owner, spectator: spectatorId });

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `Player ${owner} granted hidden-info access to spectator ${spectatorId}`,
        ts: Date.now()
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
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `Player ${owner} revoked hidden-info access from spectator ${spectatorId}`,
        ts: Date.now()
      });

      broadcastGame(io, game, gameId);
    });

    // Deck import (batch + validate + strict retry for misses)
    socket.on('importDeck', async ({ gameId, list }) => {
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!pid || socket.data.spectator) return;
      const game = ensureGame(gameId);

      const parsed = parseDecklist(list);
      const requestedNames = parsed.map(p => p.name);
      let byName: Map<string, any>;
      try {
        byName = await fetchCardsByExactNamesBatch(requestedNames);
      } catch (e: any) {
        socket.emit('error', { code: 'SCRYFALL', message: e?.message || 'Deck import failed' });
        return;
      }

      const resolvedCards: Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris'>> = [];
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
          resolvedCards.push({
            id: c.id,
            name: c.name,
            type_line: c.type_line,
            oracle_text: c.oracle_text,
            image_uris: c.image_uris
          });
        }
      }

      if (missing.length) {
        for (const miss of missing) {
          try {
            const c = await fetchCardByExactNameStrict(miss);
            const count = parsed.find(p => p.name === miss)?.count ?? 1;
            for (let i = 0; i < count; i++) {
              validationCards.push(c);
              resolvedCards.push({
                id: c.id,
                name: c.name,
                type_line: c.type_line,
                oracle_text: c.oracle_text,
                image_uris: c.image_uris
              });
            }
          } catch {
            // keep missing; warn below
          }
        }
      }

      game.importDeckResolved(pid, resolvedCards);
      appendEvent(gameId, game.seq, 'deckImportResolved', { playerId: pid, cards: resolvedCards });

      const fmt = String(game.state.format);
      const report = validateDeck(fmt, validationCards);
      const expected = parsed.reduce((sum, p) => sum + p.count, 0);
      const summaryLines: string[] = [];
      summaryLines.push(`Player ${pid} imported ${resolvedCards.length}/${expected} cards.`);
      const stillMissing = parsed
        .filter(p => !resolvedCards.some(rc => rc.name.toLowerCase() === p.name.toLowerCase()))
        .map(p => p.name);
      if (stillMissing.length) summaryLines.push(`Missing: ${stillMissing.slice(0, 10).join(', ')}${stillMissing.length > 10 ? ', …' : ''}`);
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
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: summaryLines.join(' '),
        ts: Date.now()
      });
      broadcastGame(io, game, gameId);
    });

    // Library ops
    socket.on('shuffleLibrary', ({ gameId }) => {
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!pid || socket.data.spectator) return;
      const game = ensureGame(gameId);
      game.shuffleLibrary(pid);
      appendEvent(gameId, game.seq, 'shuffleLibrary', { playerId: pid });
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `Player ${pid} shuffled their library`,
        ts: Date.now()
      });
      broadcastGame(io, game, gameId);
    });

    socket.on('shuffleHandIntoLibrary', ({ gameId }) => {
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!pid || socket.data.spectator) return;
      const game = ensureGame(gameId);

      const moved = game.moveHandToLibrary(pid);
      if (moved > 0) appendEvent(gameId, game.seq, 'handIntoLibrary', { playerId: pid });
      game.shuffleLibrary(pid);
      appendEvent(gameId, game.seq, 'shuffleLibrary', { playerId: pid });

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `Player ${pid} moved ${moved} card(s) from hand to library and shuffled`,
        ts: Date.now()
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

    // Search/select (owner only)
    socket.on('searchLibrary', ({ gameId, query, limit }) => {
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!pid || socket.data.spectator) return;
      const game = ensureGame(gameId);
      const results = game.searchLibrary(pid, query || '', Math.max(1, Math.min(200, limit ?? 100)));
      io.to(socket.id).emit('searchResults', { gameId, cards: results, total: results.length });
    });

    socket.on('selectFromSearch', ({ gameId, cardIds, moveTo, reveal }) => {
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!pid || socket.data.spectator) return;
      const game = ensureGame(gameId);
      const movedNames = game.selectFromLibrary(pid, cardIds, moveTo);
      appendEvent(gameId, game.seq, 'selectFromLibrary', { playerId: pid, cardIds, moveTo, reveal: Boolean(reveal) });
      if (reveal && movedNames.length) {
        io.to(gameId).emit('chat', {
          id: `m_${Date.now()}`,
          gameId,
          from: 'system',
          message: `Revealed: ${movedNames.join(', ')}`,
          ts: Date.now()
        });
      }
      broadcastGame(io, game, gameId);
    });

    // Commander core
    socket.on('setCommander', ({ gameId, commanderNames }) => {
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!pid || socket.data.spectator) return;
      const game = ensureGame(gameId);

      // Best-effort resolve names to ids from visible zones (hand, graveyard) and owned battlefield permanents
      const zones = game.state.zones?.[pid];
      const candidates: { id: string; name: string }[] = [];
      const push = (arr?: any[]) => (arr || []).forEach((c: any) => candidates.push({ id: c.id, name: c.name }));
      push(zones?.hand as any[]);
      push(zones?.graveyard as any[]);
      for (const perm of game.state.battlefield) {
        if (perm.owner === pid && (perm.card as any).name) {
          candidates.push({ id: (perm.card as any).id, name: (perm.card as any).name });
        }
      }
      const ids: string[] = [];
      for (const name of commanderNames) {
        const found = candidates.find(c => c.name.toLowerCase() === name.trim().toLowerCase());
        ids.push(found?.id ?? `cmd_${name.trim().toLowerCase()}`);
      }

      game.setCommander(pid, commanderNames, ids);
      appendEvent(gameId, game.seq, 'setCommander', { playerId: pid, commanderNames, commanderIds: ids });
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `Player ${pid} set commander(s): ${commanderNames.join(' / ')}`,
        ts: Date.now()
      });
      broadcastGame(io, game, gameId);
    });

    socket.on('castCommander', ({ gameId, commanderNameOrId }) => {
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!pid || socket.data.spectator) return;
      const game = ensureGame(gameId);
      const info = game.state.commandZone[pid];
      if (!info) return;
      const id =
        info.commanderIds.find(cid => cid === commanderNameOrId) ||
        info.commanderIds[
          info.commanderNames?.findIndex(n => n?.toLowerCase() === commanderNameOrId.trim().toLowerCase()) ?? -1
        ];
      if (!id) return;
      game.castCommander(pid, id);
      appendEvent(gameId, game.seq, 'castCommander', { playerId: pid, commanderId: id });
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `Player ${pid} cast their commander (${info.commanderNames?.[info.commanderIds.indexOf(id)] ?? id}); tax now ${game.state.commandZone[pid].taxById?.[id] ?? 0}`,
        ts: Date.now()
      });
      broadcastGame(io, game, gameId);
    });

    socket.on('moveCommanderToCommandZone', ({ gameId, commanderNameOrId }) => {
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!pid || socket.data.spectator) return;
      const game = ensureGame(gameId);
      const info = game.state.commandZone[pid];
      if (!info) return;
      const id =
        info.commanderIds.find(cid => cid === commanderNameOrId) ||
        info.commanderIds[
          info.commanderNames?.findIndex(n => n?.toLowerCase() === commanderNameOrId.trim().toLowerCase()) ?? -1
        ];
      if (!id) return;
      game.moveCommanderToCZ(pid, id);
      appendEvent(gameId, game.seq, 'moveCommanderToCZ', { playerId: pid, commanderId: id });
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `Player ${pid} moved commander back to command zone`,
        ts: Date.now()
      });
      broadcastGame(io, game, gameId);
    });

    // Counters/tokens
    socket.on('updateCounters', ({ gameId, permanentId, deltas }) => {
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!pid || socket.data.spectator) return;
      const game = ensureGame(gameId);
      game.updateCounters(permanentId, deltas);
      appendEvent(gameId, game.seq, 'updateCounters', { permanentId, deltas });
      broadcastGame(io, game, gameId);
    });

    socket.on('updateCountersBulk', ({ gameId, updates }) => {
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!pid || socket.data.spectator) return;
      const game = ensureGame(gameId);
      // Apply via event to keep replay deterministic
      if (updates?.length) {
        game.applyEvent({ type: 'updateCountersBulk', updates });
        appendEvent(gameId, game.seq, 'updateCountersBulk', { updates });
        broadcastGame(io, game, gameId);
      }
    });

    socket.on('createToken', ({ gameId, name, count, basePower, baseToughness }) => {
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!pid || socket.data.spectator) return;
      const game = ensureGame(gameId);
      game.createToken(pid, name, count, basePower, baseToughness);
      appendEvent(gameId, game.seq, 'createToken', { controller: pid, name, count, basePower, baseToughness });
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `Player ${pid} created ${count ?? 1} ${name} token(s)`,
        ts: Date.now()
      });
      broadcastGame(io, game, gameId);
    });

    socket.on('removePermanent', ({ gameId, permanentId }) => {
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!pid || socket.data.spectator) return;
      const game = ensureGame(gameId);
      game.removePermanent(permanentId);
      appendEvent(gameId, game.seq, 'removePermanent', { permanentId });
      broadcastGame(io, game, gameId);
    });

    // Rules-engine damage (wither/infect path already exists server-side)
    socket.on('dealDamage', ({ gameId, targetPermanentId, amount, wither, infect }) => {
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!pid || socket.data.spectator) return;
      const game = ensureGame(gameId);
      const a = Math.max(0, amount | 0);
      game.applyEvent({ type: 'dealDamage', targetPermanentId, amount: a, wither, infect });
      appendEvent(gameId, game.seq, 'dealDamage', { targetPermanentId, amount: a, wither: Boolean(wither), infect: Boolean(infect) });
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `Damage: ${a} to ${targetPermanentId}${wither ? ' (Wither)' : ''}${infect ? ' (Infect)' : ''}`,
        ts: Date.now()
      });
      broadcastGame(io, game, gameId);
    });

    // Targeting + casting flow
    socket.on('beginCast', ({ gameId, cardId }) => {
      const game = ensureGame(gameId);
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!pid || socket.data.spectator) return;

      // Validate card is in hand
      const z = game.state.zones?.[pid];
      const hand = (z?.hand ?? []) as any[];
      const card = hand.find(c => c.id === cardId);
      if (!card) {
        socket.emit('error', { code: 'CAST', message: 'Card not in hand' });
        return;
      }

      const spec = categorizeSpell(card.name, card.oracle_text);
      if (!spec) {
        socket.emit('error', { code: 'CAST', message: 'This card is not supported for auto-targeting yet' });
        return;
      }

      const valid = evalTargets(game.state, pid, spec);
      const spellId = newSpellId();
      let map = pendingByGame.get(gameId);
      if (!map) {
        map = new Map();
        pendingByGame.set(gameId, map);
      }
      map.set(spellId, {
        spellId,
        caster: pid,
        cardId,
        spec,
        valid,
        chosen: [],
        min: spec.minTargets,
        max: spec.maxTargets
      });

      socket.emit('validTargets', {
        gameId,
        spellId,
        minTargets: spec.minTargets,
        maxTargets: spec.maxTargets,
        targets: valid,
        note: spec.minTargets === 0 && spec.maxTargets === 0 ? 'No selection required; confirm to resolve' : undefined
      });
    });

    socket.on('chooseTargets', ({ gameId, spellId, chosen }) => {
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!pid) return;
      const map = pendingByGame.get(gameId);
      const pending = map?.get(spellId);
      if (!pending || pending.caster !== pid) return;

      // Validate chosen are subset of valid and enforce max
      const allow = new Set(pending.valid.map(t => `${t.kind}:${t.id}`));
      const filtered = chosen.filter(t => allow.has(`${t.kind}:${t.id}`)).slice(0, pending.max);
      pending.chosen = filtered;
    });

    socket.on('cancelCast', ({ gameId, spellId }) => {
      const pid = socket.data.playerId as PlayerID | undefined;
      const map = pendingByGame.get(gameId);
      const pending = map?.get(spellId);
      if (!pending || pending.caster !== pid) return;
      map!.delete(spellId);
    });

    socket.on('confirmCast', ({ gameId, spellId }) => {
      const game = ensureGame(gameId);
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!pid) return;
      const map = pendingByGame.get(gameId);
      const pending = map?.get(spellId);
      if (!pending || pending.caster !== pid) return;

      if (pending.min > 0 && pending.chosen.length < pending.min) {
        socket.emit('error', { code: 'CAST', message: `Select at least ${pending.min} target(s)` });
        return;
      }

      // Move the card from hand to graveyard (simple resolution path)
      const z = game.state.zones?.[pid];
      const hand = (z?.hand ?? []) as any[];
      const i = hand.findIndex(c => c.id === pending.cardId);
      if (i >= 0) {
        const card = hand.splice(i, 1)[0];
        z!.handCount = hand.length;
        z!.graveyard.push({
          id: card.id,
          name: card.name,
          type_line: card.type_line,
          oracle_text: card.oracle_text,
          zone: 'graveyard'
        });
        z!.graveyardCount = z!.graveyard.length;
      }

      // Persist and apply resolution (effects handled in gameState applyEvent)
      game.applyEvent({
        type: 'resolveSpell',
        caster: pid,
        cardId: pending.cardId,
        spec: pending.spec,
        chosen: pending.chosen
      });
      appendEvent(gameId, game.seq, 'resolveSpell', {
        caster: pid,
        cardId: pending.cardId,
        spec: pending.spec,
        chosen: pending.chosen
      });

      map!.delete(spellId);
      broadcastGame(io, game, gameId);
    });

    // Leave
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

    // Disconnect
    socket.on('disconnect', () => {
      const { gameId } = socket.data;
      if (!gameId) return;
      const game = games.get(gameId);
      if (!game) return;
      game.disconnect(socket.id);
    });
  });
}