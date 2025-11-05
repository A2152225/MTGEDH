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
  TargetRef,
  PaymentItem,
} from '../../shared/src';
import { GamePhase, GameStep } from '../../shared/src';
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

// Typed server
type TypedServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

const games: Map<GameID, InMemoryGame> = new Map();

type PendingCast = {
  spellId: string;
  caster: PlayerID;
  fromZone: 'hand' | 'commandZone';
  cardInHandId?: string;
  cardSnapshot: Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris'>;
  spec: NonNullable<ReturnType<typeof categorizeSpell>> | null;
  valid: TargetRef[];
  chosen: TargetRef[];
  min: number;
  max: number;
  manaCost?: string;
};
const pendingByGame: Map<GameID, Map<string, PendingCast>> = new Map();

const newSpellId = () => `sp_${Math.random().toString(36).slice(2, 9)}`;
const newStackId = () => `st_${Math.random().toString(36).slice(2, 9)}`;

function ensureGame(gameId: GameID): InMemoryGame {
  let game = games.get(gameId);
  if (!game) {
    game = createInitialGameState(gameId);
    createGameIfNotExists(gameId, String(game.state.format), game.state.startingLife);
    const persisted = getEvents(gameId);
    const replayEvents: GameEvent[] = persisted.map(e => ({ type: e.type as any, ...(e.payload || {}) }));
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

function isMainPhase(phase?: any, step?: any): boolean {
  return phase === GamePhase.PRECOMBAT_MAIN || phase === GamePhase.POSTCOMBAT_MAIN || step === GameStep.MAIN1 || step === GameStep.MAIN2;
}

// Mana helpers
type Color = 'W' | 'U' | 'B' | 'R' | 'G' | 'C';
const COLORS: Color[] = ['W', 'U', 'B', 'R', 'G', 'C'];

function parseManaCost(manaCost?: string): {
  colors: Record<Color, number>;
  generic: number;
  hybrids: Color[][];
  hasX: boolean;
} {
  const res = { colors: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 } as Record<Color, number>, generic: 0, hybrids: [] as Color[][], hasX: false };
  if (!manaCost) return res;
  const tokens = manaCost.match(/\{[^}]+\}/g) || [];
  for (const t of tokens) {
    const sym = t.replace(/[{}]/g, '').toUpperCase();
    if (sym === 'X') { res.hasX = true; continue; }
    if (/^\d+$/.test(sym)) { res.generic += parseInt(sym, 10); continue; }
    if (sym.includes('/')) {
      const parts = sym.split('/');
      if (parts.length === 2 && parts[1] === 'P') {
        const c = parts[0] as Color;
        if ((COLORS as readonly string[]).includes(c)) res.colors[c] += 1;
        continue;
      }
      if (parts.length === 2 && (COLORS as readonly string[]).includes(parts[0] as Color) && (COLORS as readonly string[]).includes(parts[1] as Color)) {
        res.hybrids.push([parts[0] as Color, parts[1] as Color]);
        continue;
      }
      const num = parseInt(parts[0], 10);
      if (!Number.isNaN(num)) { res.generic += num; continue; }
    }
    if ((COLORS as readonly string[]).includes(sym)) { res.colors[sym as Color] += 1; continue; }
  }
  return res;
}

function parseManaOptionsFromOracle(oracle: string): Color[] {
  const opts = new Set<Color>();
  const lines = oracle.split('\n');
  for (const line of lines) {
    if (!/add/i.test(line)) continue;
    const matches = line.match(/\{[WUBRGC]\}/g);
    if (matches) for (const m of matches) opts.add(m.replace(/[{}]/g, '') as Color);
    if (/any color/i.test(line)) { for (const c of ['W', 'U', 'B', 'R', 'G'] as Color[]) opts.add(c); }
  }
  return Array.from(opts);
}
// fallback from type_line to handle basics and Wastes
function fallbackOptionsFromTypeLine(typeLine: string): Color[] {
  const tl = (typeLine || '').toLowerCase();
  const opts = new Set<Color>();
  if (/\bplains\b/.test(tl)) opts.add('W');
  if (/\bisland\b/.test(tl)) opts.add('U');
  if (/\bswamp\b/.test(tl)) opts.add('B');
  if (/\bmountain\b/.test(tl)) opts.add('R');
  if (/\bforest\b/.test(tl)) opts.add('G');
  if (/\bwastes\b/.test(tl)) opts.add('C');
  return Array.from(opts);
}
function manaOptionsForPermanent(perm: any): Color[] {
  const oracle = ((perm.card as any)?.oracle_text || '') as string;
  const typeLine = ((perm.card as any)?.type_line || '') as string;
  const byOracle = parseManaOptionsFromOracle(oracle);
  return byOracle.length ? byOracle : fallbackOptionsFromTypeLine(typeLine);
}
function paymentToPool(payment?: PaymentItem[]): Record<Color, number> {
  const pool: Record<Color, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  for (const p of (payment || [])) {
    if (COLORS.includes(p.mana as Color)) pool[p.mana as Color] += 1;
  }
  return pool;
}
function canPayEnhanced(
  baseCost: { colors: Record<Color, number>; generic: number; hybrids: Color[][] },
  pool: Record<Color, number>
): boolean {
  const leftPool: Record<Color, number> = { W: pool.W, U: pool.U, B: pool.B, R: pool.R, G: pool.G, C: pool.C };
  for (const c of COLORS) {
    if (leftPool[c] < baseCost.colors[c]) return false;
    leftPool[c] -= baseCost.colors[c];
  }
  for (const group of baseCost.hybrids) {
    let satisfied = false;
    for (const c of group) {
      if (leftPool[c] > 0) { leftPool[c] -= 1; satisfied = true; break; }
    }
    if (!satisfied) return false;
  }
  const totalRemaining = COLORS.reduce((a, c) => a + (leftPool[c] || 0), 0);
  return totalRemaining >= baseCost.generic;
}

// NEW: simple greedy auto-payment for non-hybrid costs; colored first, then generic
function autoSelectPayment(
  sources: Array<{ id: string; options: Color[] }>,
  cost: { colors: Record<Color, number>; generic: number; hybrids: Color[][] }
): PaymentItem[] | null {
  if ((cost.hybrids || []).length > 0) return null;
  const remainingColors: Record<Color, number> = { W: cost.colors.W, U: cost.colors.U, B: cost.colors.B, R: cost.colors.R, G: cost.colors.G, C: cost.colors.C };
  let remainingGeneric = cost.generic;
  const unused = sources.slice();
  const payment: PaymentItem[] = [];
  for (const c of COLORS) {
    while (remainingColors[c] > 0) {
      const idx = unused.findIndex(s => s.options.includes(c));
      if (idx < 0) return null;
      const src = unused.splice(idx, 1)[0];
      payment.push({ permanentId: src.id, mana: c });
      remainingColors[c] -= 1;
    }
  }
  for (let i = 0; i < remainingGeneric; i++) {
    if (unused.length === 0) return null;
    const src = unused.shift()!;
    const mana = src.options[0]!;
    payment.push({ permanentId: src.id, mana });
  }
  return payment;
}

function appendGenericToCostString(manaCost: string | undefined, genericAdd: number): string | undefined {
  if (!manaCost) return genericAdd > 0 ? `{${genericAdd}}` : undefined;
  if (genericAdd <= 0) return manaCost;
  const parts: string[] = [];
  let left = genericAdd;
  while (left >= 2) { parts.push('{2}'); left -= 2; }
  if (left === 1) parts.push('{1}');
  return `${manaCost}${parts.join('')}`;
}

export function registerSocketHandlers(io: TypedServer) {
  io.on('connection', (socket: Socket) => {
    // Join
    socket.on('joinGame', ({ gameId, playerName, spectator, seatToken }) => {
      const game = ensureGame(gameId);

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

      socket.to(gameId).emit('stateDiff', { gameId, diff: computeDiff<ClientGameView>(undefined, view, game.seq) });
    });

    // Request state refresh
    socket.on('requestState', ({ gameId }) => {
      const game = games.get(gameId);
      if (!game || !socket.data.playerId) return;
      const view = game.viewFor(socket.data.playerId, Boolean(socket.data.spectator));
      socket.emit('state', { gameId, view, seq: game.seq });
    });

    // Visibility grants
    socket.on('grantSpectatorAccess', ({ gameId, spectatorId }) => {
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!pid || socket.data.spectator) return;
      const game = ensureGame(gameId);
      game.grantSpectatorAccess(pid, spectatorId);
      appendEvent(gameId, game.seq, 'spectatorGrant', { owner: pid, spectator: spectatorId });
      broadcastGame(io, game, gameId);
    });
    socket.on('revokeSpectatorAccess', ({ gameId, spectatorId }) => {
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!pid || socket.data.spectator) return;
      const game = ensureGame(gameId);
      game.revokeSpectatorAccess(pid, spectatorId);
      appendEvent(gameId, game.seq, 'spectatorRevoke', { owner: pid, spectator: spectatorId });
      broadcastGame(io, game, gameId);
    });

    // Priority
    socket.on('passPriority', ({ gameId }) => {
      const game = games.get(gameId);
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!game || !pid) return;
      const { changed, resolvedNow } = game.passPriority(pid);
      if (!changed) return;
      appendEvent(gameId, game.seq, 'passPriority', { by: pid });
      if (resolvedNow) {
        game.applyEvent({ type: 'resolveTopOfStack' });
        appendEvent(gameId, game.seq, 'resolveTopOfStack', {});
        io.to(gameId).emit('chat', {
          id: `m_${Date.now()}`,
          gameId,
          from: 'system',
          message: 'Top of stack resolved.',
          ts: Date.now()
        });
      }
      broadcastGame(io, game, gameId);
      io.to(gameId).emit('priority', { gameId, player: game.state.priority });
    });

    // Next turn/step
    socket.on('nextTurn', ({ gameId }) => {
      const pid = socket.data.playerId as PlayerID | undefined;
      const game = ensureGame(gameId);
      if (!pid || socket.data.spectator) return;
      if (game.state.turnPlayer !== pid) {
        socket.emit('error', { code: 'TURN', message: 'Only the active player can advance the turn' });
        return;
      }
      if (game.state.stack.length > 0) {
        socket.emit('error', { code: 'TURN', message: 'Cannot advance turn while the stack is not empty' });
        return;
      }
      game.nextTurn();
      appendEvent(gameId, game.seq, 'nextTurn', {});
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `Turn advanced. Active player: ${game.state.turnPlayer}`,
        ts: Date.now()
      });
      broadcastGame(io, game, gameId);
      io.to(gameId).emit('priority', { gameId, player: game.state.priority });
    });

    socket.on('nextStep', ({ gameId }) => {
      const pid = socket.data.playerId as PlayerID | undefined;
      const game = ensureGame(gameId);
      if (!pid || socket.data.spectator) return;
      if (game.state.turnPlayer !== pid) {
        socket.emit('error', { code: 'TURN', message: 'Only the active player can advance the step' });
        return;
      }
      if ((game.state.stack ?? []).length > 0) {
        socket.emit('error', { code: 'TURN', message: 'Cannot advance step while the stack is not empty' });
        return;
      }
      game.nextStep();
      appendEvent(gameId, game.seq, 'nextStep', {});
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `Step advanced: ${String(game.state.phase)} / ${String(game.state.step)}`,
        ts: Date.now()
      });
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
        message: `Game restarted (${Boolean(preservePlayers) ? 'keeping players; opening hands drawn' : 'cleared roster'})`,
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

    // Deck import
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
            // keep missing
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

    // Hand ops (server-authoritative; persisted)
    socket.on('reorderHand', ({ gameId, order }) => {
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!pid || socket.data.spectator) return;
      const game = ensureGame(gameId);
      if (!Array.isArray(order)) {
        socket.emit('error', { code: 'HAND', message: 'Invalid hand order' });
        return;
      }
      game.applyEvent({ type: 'reorderHand', playerId: pid, order });
      appendEvent(gameId, game.seq, 'reorderHand', { playerId: pid, order });
      broadcastGame(io, game, gameId);
    });

    socket.on('shuffleHand', ({ gameId }) => {
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!pid || socket.data.spectator) return;
      const game = ensureGame(gameId);
      game.applyEvent({ type: 'shuffleHand', playerId: pid });
      appendEvent(gameId, game.seq, 'shuffleHand', { playerId: pid });
      broadcastGame(io, game, gameId);
    });

    // Targeting + casting flow with payment
    socket.on('beginCast', async ({ gameId, cardId }) => {
      const game = ensureGame(gameId);
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!pid || socket.data.spectator) return;

      if (game.state.priority !== pid) {
        socket.emit('error', { code: 'CAST', message: 'You must have priority to cast a spell' });
        return;
      }

      const z = game.state.zones?.[pid];
      const hand = (z?.hand ?? []) as any[];
      const card = hand.find(c => c.id === cardId);
      if (!card) {
        socket.emit('error', { code: 'CAST', message: 'Card not in hand' });
        return;
      }

      const spec = categorizeSpell(card.name, card.oracle_text);
      const valid = spec ? evalTargets(game.state, pid, spec) : [];
      const spellId = newSpellId();

      let manaCost: string | undefined = (card as any).mana_cost;
      if (!manaCost) {
        try {
          const scry = await fetchCardByExactNameStrict(card.name);
          manaCost = scry?.mana_cost || undefined;
        } catch {
          manaCost = undefined;
        }
      }

      const sources = (game.state.battlefield || [])
        .filter(p => p.controller === pid && !p.tapped)
        .map(p => {
          const opts = manaOptionsForPermanent(p);
          if (opts.length === 0) return null;
          const name = ((p.card as any)?.name) || p.id;
          return { id: p.id, name, options: opts };
        })
        .filter(Boolean) as Array<{ id: string; name: string; options: Color[] }>;

      let map = pendingByGame.get(gameId);
      if (!map) { map = new Map(); pendingByGame.set(gameId, map); }
      map.set(spellId, {
        spellId,
        caster: pid,
        fromZone: 'hand',
        cardInHandId: card.id,
        cardSnapshot: {
          id: card.id,
          name: card.name,
          type_line: card.type_line,
          oracle_text: card.oracle_text,
          image_uris: card.image_uris
        },
        spec: spec ?? null,
        valid,
        chosen: [],
        min: spec?.minTargets ?? 0,
        max: spec?.maxTargets ?? 0,
        manaCost
      });

      socket.emit('validTargets', {
        gameId,
        spellId,
        minTargets: spec?.minTargets ?? 0,
        maxTargets: spec?.maxTargets ?? 0,
        targets: valid,
        note: !spec ? 'No targets required' : (spec.minTargets === 0 && spec.maxTargets === 0 ? 'No selection required; confirm to put on stack' : undefined),
        manaCost,
        paymentSources: sources
      });
    });

    socket.on('chooseTargets', ({ gameId, spellId, chosen }) => {
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!pid) return;
      const map = pendingByGame.get(gameId);
      const pending = map?.get(spellId);
      if (!pending || pending.caster !== pid) return;

      const allow = new Set(pending.valid.map(t => `${t.kind}:${t.id}`));
      const filtered = pending.spec
        ? chosen.filter(t => allow.has(`${t.kind}:${t.id}`)).slice(0, pending.max)
        : [];
      pending.chosen = filtered;
    });

    socket.on('cancelCast', ({ gameId, spellId }) => {
      const pid = socket.data.playerId as PlayerID | undefined;
      const map = pendingByGame.get(gameId);
      const pending = map?.get(spellId);
      if (!pending || pending.caster !== pid) return;
      map!.delete(spellId);
    });

    socket.on('confirmCast', async ({ gameId, spellId, payment, xValue }) => {
      const game = ensureGame(gameId);
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!pid) return;
      const map = pendingByGame.get(gameId);
      const pending = map?.get(spellId);
      if (!pending || pending.caster !== pid) return;

      if (game.state.priority !== pid) {
        socket.emit('error', { code: 'CAST', message: 'You must have priority to cast a spell' });
        return;
      }

      let isFromHand = pending.fromZone === 'hand';
      let hand: any[] = [];
      let z = game.state.zones?.[pid];
      if (isFromHand) {
        hand = (z?.hand ?? []) as any[];
        const idxInHand = hand.findIndex(c => c.id === pending.cardInHandId);
        if (idxInHand < 0) {
          socket.emit('error', { code: 'CAST', message: `Card not in hand` });
          return;
        }
      }

      const card = pending.cardSnapshot;

      // Sorcery-speed enforcement
      const typeLine = (card?.type_line || '').toLowerCase();
      const isSorcery = /\bsorcery\b/.test(typeLine);
      if (isSorcery) {
        if (game.state.stack.length > 0) {
          socket.emit('error', { code: 'CAST', message: 'Sorceries can only be cast when the stack is empty' });
          return;
        }
        if (game.state.turnPlayer !== pid) {
          socket.emit('error', { code: 'CAST', message: 'Sorceries can only be cast during your turn' });
          return;
        }
        if (!isMainPhase(game.state.phase, game.state.step)) {
          socket.emit('error', { code: 'CAST', message: 'Sorceries can only be cast during a main phase' });
          return;
        }
      }

      // Payment validation (with auto-pay fallback)
      const manaCostStr = pending.manaCost || (await (async () => {
        try { const scry = await fetchCardByExactNameStrict(card.name); return scry?.mana_cost || ''; } catch { return ''; }
      })());

      const parsed = parseManaCost(manaCostStr);
      const x = Math.max(0, Number(xValue || 0) | 0);
      const costForPay: { colors: Record<Color, number>; generic: number; hybrids: Color[][] } = {
        colors: { ...parsed.colors },
        generic: parsed.generic + x,
        hybrids: []
      };

      let pool = paymentToPool(payment || []);
      if (!payment || !payment.length) {
        // Allow autodetection if pool is empty; skip hybrid support for simplicity
      }
      if (!canPayEnhanced({ colors: costForPay.colors, generic: costForPay.generic, hybrids: [] }, pool)) {
        socket.emit('error', { code: 'PAY', message: 'Costs cannot be fully met with selected payment' });
        return;
      }

      // Apply taps
      for (const pmt of (payment || [])) {
        const perm = game.state.battlefield.find(b => b.id === pmt.permanentId);
        if (perm) perm.tapped = true;
      }

      // Move the card from hand if needed
      if (isFromHand) {
        const idxInHand = hand.findIndex(c => c.id === pending.cardInHandId);
        if (idxInHand >= 0) {
          hand.splice(idxInHand, 1);
          z!.handCount = hand.length;
        }
      } else {
        // Commander: bump commander tax now that cast is declared
        const info = game.state.commandZone?.[pid];
        const id = info?.commanderIds?.find(x => x === card.id) || card.id;
        game.applyEvent({ type: 'castCommander', playerId: pid, commanderId: id });
        appendEvent(gameId, game.seq, 'castCommander', { playerId: pid, commanderId: id });
      }

      // Push to stack
      const targetsEncoded = pending.chosen.map(t => `${t.kind}:${t.id}`);
      const stackId = newStackId();
      const item = {
        id: stackId,
        controller: pid,
        card: {
          id: card.id,
          name: card.name,
          type_line: card.type_line,
          oracle_text: card.oracle_text,
          image_uris: (card as any).image_uris
        },
        targets: targetsEncoded
      };
      game.applyEvent({ type: 'pushStack', item });
      appendEvent(gameId, game.seq, 'pushStack', { item });

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `Player ${pid} cast ${card.name || 'a spell'}`,
        ts: Date.now()
      });

      map!.delete(spellId);
      broadcastGame(io, game, gameId);
    });

    // Lands
    socket.on('playLand', ({ gameId, cardId }) => {
      const game = ensureGame(gameId);
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!pid || socket.data.spectator) return;

      if (game.state.priority !== pid) {
        socket.emit('error', { code: 'PLAY', message: 'You must have priority to play a land' });
        return;
      }
      if (game.state.turnPlayer !== pid) {
        socket.emit('error', { code: 'PLAY', message: 'You can only play lands during your turn' });
        return;
      }
      if (!isMainPhase(game.state.phase, game.state.step)) {
        socket.emit('error', { code: 'PLAY', message: 'You can only play lands during a main phase' });
        return;
      }
      if ((game.state.stack ?? []).length > 0) {
        socket.emit('error', { code: 'PLAY', message: 'You can only play lands when the stack is empty' });
        return;
      }
      const played = game.state.landsPlayedThisTurn?.[pid] ?? 0;
      if (played >= 1) {
        socket.emit('error', { code: 'PLAY', message: 'You have already played a land this turn' });
        return;
      }

      const z = game.state.zones?.[pid];
      const hand = (z?.hand ?? []) as any[];
      const idx = hand.findIndex(c => c.id === cardId);
      if (idx < 0) { socket.emit('error', { code: 'PLAY', message: 'Land not in hand' }); return; }
      const card = hand[idx];
      const typeLine = (card.type_line || '').toLowerCase();
      if (!/\bland\b/.test(typeLine)) {
        socket.emit('error', { code: 'PLAY', message: 'Only lands can be played with Play Land' });
        return;
      }
      hand.splice(idx, 1);
      z!.handCount = hand.length;

      const snapshot = {
        id: card.id,
        name: card.name,
        type_line: card.type_line,
        oracle_text: card.oracle_text,
        image_uris: card.image_uris
      };
      game.applyEvent({ type: 'playLand', playerId: pid, card: snapshot });
      appendEvent(gameId, game.seq, 'playLand', { playerId: pid, card: snapshot });

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `Player ${pid} played ${card.name}`,
        ts: Date.now()
      });

      broadcastGame(io, game, gameId);
    });

    // Scry
    socket.on('beginScry', ({ gameId, count }) => {
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!pid || socket.data.spectator) return;
      const game = ensureGame(gameId);
      const n = Math.max(0, Math.min(10, Number(count) | 0));
      const cards = game.peekTopN(pid, n);
      io.to(socket.id).emit('scryPeek', { gameId, cards });
    });

    socket.on('confirmScry', ({ gameId, keepTopOrder, bottomOrder }) => {
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!pid || socket.data.spectator) return;
      const game = ensureGame(gameId);
      const n = (keepTopOrder?.length || 0) + (bottomOrder?.length || 0);
      const snapshot = game.peekTopN(pid, n).map(c => c.id);
      const union = [...(keepTopOrder || []), ...(bottomOrder || [])];
      const sameSets = snapshot.length === union.length && snapshot.every(id => union.includes(id));
      if (!sameSets) {
        io.to(socket.id).emit('error', { code: 'SCRY', message: 'Scry selection no longer matches top cards' });
        return;
      }
      game.applyEvent({ type: 'scryResolve', playerId: pid, keepTopOrder, bottomOrder });
      appendEvent(gameId, game.seq, 'scryResolve', { playerId: pid, keepTopOrder, bottomOrder });
      broadcastGame(io, game, gameId);
    });

    // Surveil
    socket.on('beginSurveil', ({ gameId, count }) => {
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!pid || socket.data.spectator) return;
      const game = ensureGame(gameId);
      const n = Math.max(0, Math.min(10, Number(count) | 0));
      const cards = game.peekTopN(pid, n);
      io.to(socket.id).emit('surveilPeek', { gameId, cards });
    });

    socket.on('confirmSurveil', ({ gameId, toGraveyard, keepTopOrder }) => {
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!pid || socket.data.spectator) return;
      const game = ensureGame(gameId);
      const n = (toGraveyard?.length || 0) + (keepTopOrder?.length || 0);
      const snapshot = game.peekTopN(pid, n).map(c => c.id);
      const union = [...(toGraveyard || []), ...(keepTopOrder || [])];
      const sameSets = snapshot.length === union.length && snapshot.every(id => union.includes(id));
      if (!sameSets) {
        io.to(socket.id).emit('error', { code: 'SURVEIL', message: 'Surveil selection no longer matches top cards' });
        return;
      }
      game.applyEvent({ type: 'surveilResolve', playerId: pid, toGraveyard, keepTopOrder });
      appendEvent(gameId, game.seq, 'surveilResolve', { playerId: pid, toGraveyard, keepTopOrder });
      broadcastGame(io, game, gameId);
    });

    // Leave/disconnect
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