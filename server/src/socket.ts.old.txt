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

// Saved deck pool (SQLite-backed; general pool)
import {
  saveDeck as saveDeckDB,
  listDecks,
  getDeck as getDeckDB,
  renameDeck as renameDeckDB,
  deleteDeck as deleteDeckDB
} from './db/decks';

// types
type TypedServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

const games: Map<GameID, InMemoryGame> = new Map();

// Priority timeout timers per game
const priorityTimers = new Map<GameID, NodeJS.Timeout>();
const PRIORITY_TIMEOUT_MS = 30_000;

function clearPriorityTimer(gameId: GameID) {
  const t = priorityTimers.get(gameId);
  if (t) {
    clearTimeout(t);
    priorityTimers.delete(gameId);
  }
}

function schedulePriorityTimeout(io: TypedServer, game: InMemoryGame, gameId: GameID) {
  // Always clear any existing timer first
  clearPriorityTimer(gameId);

  // Only schedule when a priority window is active
  if (!game.state.active || !game.state.priority) return;

  // Determine count of active (non-skipped) players
  const activePlayers = (game.state.players as any[]).filter(p => !p.inactive);
  const activeCount = activePlayers.length;

  // Single-player: immediately auto-pass only when the stack is non-empty to progress resolutions.
  // This avoids spamming chat during empty-stack "test draws" sessions.
  if (activeCount === 1) {
    if (game.state.stack.length === 0) return;
    priorityTimers.set(
      gameId,
      setTimeout(() => {
        doAutoPass(io, game, gameId, 'auto-pass (single player)');
      }, 0)
    );
    return;
  }

  // Multi-player: schedule a 30s timeout if state remains unchanged
  const startSeq = game.seq;
  const startPriority = game.state.priority;
  const startStackDepth = game.state.stack.length;

  const t = setTimeout(() => {
    priorityTimers.delete(gameId);
    // Re-validate conditions before auto-pass
    const g = games.get(gameId);
    if (!g || !g.state.active) return;
    if (g.seq !== startSeq) return; // state changed in between; a new timer should be scheduled elsewhere
    if (g.state.priority !== startPriority) return; // priority moved
    if (g.state.stack.length !== startStackDepth) return; // stack changed
    doAutoPass(io, g, gameId, 'auto-pass (30s timeout)');
  }, PRIORITY_TIMEOUT_MS);

  priorityTimers.set(gameId, t);
}

function doAutoPass(io: TypedServer, game: InMemoryGame, gameId: GameID, reason: string) {
  const pid = game.state.priority as PlayerID;
  if (!pid) return;

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
      message: `Top of stack resolved (automatic).`,
      ts: Date.now()
    });
  }

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `Priority passed automatically (${reason}).`,
    ts: Date.now()
  });

  broadcastGame(io, game, gameId);
  io.to(gameId).emit('priority', { gameId, player: game.state.priority });

  // Schedule next window (if any)
  schedulePriorityTimeout(io, game, gameId);
}

const newSpellId = () => `sp_${Math.random().toString(36).slice(2, 9)}`;
const newStackId = () => `st_${Math.random().toString(36).slice(2, 9)}`;
const newDeckId = () => `deck_${Math.random().toString(36).slice(2, 10)}`;

function ensureGame(gameId: GameID): InMemoryGame {
  let game = games.get(gameId);
  if (!game) {
    game = createInitialGameState(gameId);
    const fmt = ((game as any)?.state?.format ?? 'commander') as any;
    const life = Number(((game as any)?.state?.startingLife ?? 40)) | 0;
    createGameIfNotExists(gameId, String(fmt), life);
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
  // After broadcasting any state change, attempt to schedule a priority timeout.
  schedulePriorityTimeout(io, game, gameId);
}

function isMainPhase(phase?: any, step?: any): boolean {
  return phase === GamePhase.PRECOMBAT_MAIN || phase === GamePhase.POSTCOMBAT_MAIN || step === GameStep.MAIN1 || step === GameStep.MAIN2;
}

// Payment/mana helpers
type Color = 'W' | 'U' | 'B' | 'R' | 'G' | 'C';
const COLORS: Color[] = ['W', 'U', 'B', 'R', 'G', 'C'];

// Parse {1}{W}{U/B}{W/P}{X}
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
        const a = parts[0] as Color;
        const b = parts[1] as Color;
        res.hybrids.push([a, b]);
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

/**
 * Robust importer for raw deck text (no auto-save). Returns resolved cards for suggestion logic.
 */
async function importDeckTextIntoGame(
  io: TypedServer,
  game: InMemoryGame,
  gameId: GameID,
  playerId: PlayerID,
  list: string
): Promise<Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris'>>> {
  const parsed = parseDecklist(list);
  const requestedNames = parsed.map(p => p.name);

  let byName: Map<string, any> | null = null;
  try {
    byName = await fetchCardsByExactNamesBatch(requestedNames);
  } catch {
    byName = null;
  }

  const resolvedCards: Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris'>> = [];
  const validationCards: any[] = [];
  const missing: string[] = [];

  if (byName) {
    for (const { name, count } of parsed) {
      const key = normalizeName(name).toLowerCase();
      const c = byName.get(key);
      if (!c) { missing.push(name); continue; }
      for (let i = 0; i < count; i++) {
        validationCards.push(c);
        resolvedCards.push({ id: c.id, name: c.name, type_line: c.type_line, oracle_text: c.oracle_text, image_uris: c.image_uris });
      }
    }
  } else {
    for (const { name, count } of parsed) {
      try {
        const c = await fetchCardByExactNameStrict(name);
        for (let i = 0; i < count; i++) {
          validationCards.push(c);
          resolvedCards.push({ id: c.id, name: c.name, type_line: c.type_line, oracle_text: c.oracle_text, image_uris: c.image_uris });
        }
      } catch {
        missing.push(name);
      }
    }
  }

  if (missing.length) {
    io.to(game.participants().find(p => p.playerId === playerId)?.socketId || '').emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `Missing from Scryfall: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ', …' : ''}`,
      ts: Date.now()
    });
  }

  game.importDeckResolved(playerId, resolvedCards);
  appendEvent(gameId, game.seq, 'deckImportResolved', { playerId, cards: resolvedCards });

  const fmt = String(game.state.format);
  const report = validateDeck(fmt, validationCards);
  const expected = parsed.reduce((sum, p) => sum + p.count, 0);
  const summaryLines: string[] = [];
  summaryLines.push(`Player ${playerId} imported ${resolvedCards.length}/${expected} cards.`);
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

  return resolvedCards;
}

// Commander suggestion heuristic (top legendary + partner/background if any)
function suggestCommandersFromResolved(cards: Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text'>>) {
  const isLegendary = (tl?: string) => (tl || '').toLowerCase().includes('legendary');
  const isEligibleType = (tl?: string) => {
    const t = (tl || '').toLowerCase();
    return t.includes('creature') || t.includes('planeswalker') || t.includes('background');
  };
  const hasPartnerish = (oracle?: string, tl?: string) => {
    const o = (oracle || '').toLowerCase();
    const t = (tl || '').toLowerCase();
    return o.includes('partner') || o.includes('background') || t.includes('background');
  };
  const pool = cards.filter(c => isLegendary(c.type_line) && isEligibleType(c.type_line));
  const first = pool[0];
  const second = pool.slice(1).find(c => hasPartnerish(c.oracle_text, c.type_line));
  const names: string[] = [];
  if (first?.name) names.push(first.name);
  if (second?.name) names.push(second.name);
  return names.slice(0, 2);
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
      // Priority timeout is scheduled on broadcastGame; join does not broadcast to all, so schedule explicitly if needed.
      schedulePriorityTimeout(io, game, gameId);
    });

    // Request state refresh
    socket.on('requestState', ({ gameId }) => {
      const game = games.get(gameId);
      if (!game || !socket.data.playerId) return;
      const view = game.viewFor(socket.data.playerId, Boolean(socket.data.spectator));
      socket.emit('state', { gameId, view, seq: game.seq });
      // Optionally schedule timer after refresh (no-op if not in a priority window)
      schedulePriorityTimeout(io, game, gameId);
    });

    // Commander: set/cast/move
    socket.on('setCommander', async ({ gameId, commanderNames }) => {
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!pid || socket.data.spectator) return;
      const game = ensureGame(gameId);
      const ids: string[] = [];
      for (const name of commanderNames) {
        try {
          const card = await fetchCardByExactNameStrict(name);
          if (card?.id) ids.push(card.id);
        } catch {
          // ignore not found
        }
      }
      game.applyEvent({ type: 'setCommander', playerId: pid, commanderNames, commanderIds: ids });
      appendEvent(gameId, game.seq, 'setCommander', { playerId: pid, commanderNames, commanderIds: ids });
      broadcastGame(io, game, gameId);
    });

    socket.on('castCommander', async ({ gameId, commanderNameOrId }) => {
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!pid || socket.data.spectator) return;
      const game = ensureGame(gameId);

      if (game.state.priority !== pid) {
        socket.emit('error', { code: 'CAST', message: 'You must have priority to cast a spell' });
        return;
      }

      const info = game.state.commandZone?.[pid];
      if (!info) { socket.emit('error', { code: 'CMD', message: 'No commander set' }); return; }
      const idOrName = commanderNameOrId;
      let card: any | null = null;
      try {
        card = await fetchCardByExactNameStrict(idOrName);
      } catch {
        // ignore
      }
      if (!card) {
        socket.emit('error', { code: 'CMD', message: `Commander "${commanderNameOrId}" not found` });
        return;
      }

      const baseManaCost = card.mana_cost as string | undefined;
      const tax = Number(info.tax || 0) || 0;
      const displayCost = appendGenericToCostString(baseManaCost, tax);

      const spec = categorizeSpell(card.name, card.oracle_text);
      const valid = spec ? evalTargets(game.state, pid, spec) : [];
      const spellId = newSpellId();

      // Compute payment sources
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
        fromZone: 'commandZone',
        cardSnapshot: {
          id: card.id,
          name: card.name,
          type_line: card.type_line,
          oracle_text: card.oracle_text,
          image_uris: card.image_uris,
          mana_cost: card.mana_cost,
          power: card.power,
          toughness: card.toughness
        },
        spec: spec ?? null,
        valid,
        chosen: [],
        min: spec?.minTargets ?? 0,
        max: spec?.maxTargets ?? 0,
        manaCost: displayCost
      });

      socket.emit('validTargets', {
        gameId,
        spellId,
        minTargets: spec?.minTargets ?? 0,
        maxTargets: spec?.maxTargets ?? 0,
        targets: valid,
        note: !spec ? 'No targets required' : (spec.minTargets === 0 && spec.maxTargets === 0 ? 'No selection required; confirm to put on stack' : undefined),
        manaCost: displayCost,
        paymentSources: sources
      });
    });

    // Targeting and casting state on server
    type PendingCast = {
      spellId: string;
      caster: PlayerID;
      fromZone: 'hand' | 'commandZone';
      cardInHandId?: string; // present for hand-cast
      cardSnapshot: Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris'> & {
        mana_cost?: string;
        power?: string | number;
        toughness?: string | number;
      };
      spec: NonNullable<ReturnType<typeof categorizeSpell>> | null;
      valid: TargetRef[];
      chosen: TargetRef[];
      min: number;
      max: number;
      manaCost?: string; // display string (augmented with commander tax if any)
    };

    const pendingByGame: Map<GameID, Map<string, PendingCast>> = new Map();

    socket.on('moveCommanderToCommandZone', ({ gameId, commanderNameOrId }) => {
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!pid || socket.data.spectator) return;
      const game = ensureGame(gameId);
      const info = game.state.commandZone?.[pid];
      const id = info?.commanderIds?.find(x => x === commanderNameOrId) || commanderNameOrId;
      game.applyEvent({ type: 'moveCommanderToCZ', playerId: pid, commanderId: id });
      appendEvent(gameId, game.seq, 'moveCommanderToCZ', { playerId: pid, commanderId: id });
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
      // Timer scheduled via broadcastGame
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
      // Timer scheduled via broadcastGame
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
      // Timer scheduled via broadcastGame
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

    // Deck import (supports deckName; still auto-saves only if deckName provided)
    socket.on('importDeck', async ({ gameId, list, deckName }) => {
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

      const handCountBefore = game.state.zones?.[pid]?.handCount ?? 0;
      if (handCountBefore === 0) {
        const isCommanderFmt = String(game.state.format).toLowerCase() === 'commander';
        if (isCommanderFmt) {
          game.flagPendingOpeningDraw(pid);
          const sockId = game.participants().find(p => p.playerId === pid)?.socketId;
          const names = suggestCommandersFromResolved(resolvedCards);
          if (sockId) (io.to(sockId) as any).emit('suggestCommanders', { gameId, names });
        } else {
          game.shuffleLibrary(pid);
          appendEvent(gameId, game.seq, 'shuffleLibrary', { playerId: pid });
          game.drawCards(pid, 7);
          appendEvent(gameId, game.seq, 'drawCards', { playerId: pid, count: 7 });
        }
        broadcastGame(io, game, gameId);
      }

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

      // Auto-save to server pool if a deckName was provided (explicit)
      if (deckName && deckName.trim()) {
        try {
          const id = newDeckId();
          const name = deckName.trim();
          const created_by_name = (game.state.players as any[])?.find(p => p.id === pid)?.name || String(pid);
          const card_count = parsed.reduce((a, p) => a + (p.count || 0), 0);
          saveDeckDB({
            id,
            name,
            text: list,
            created_by_id: pid,
            created_by_name,
            card_count
          });
          const d = getDeckDB(id);
          if (d) {
            const { text: _omit, entries: _omit2, ...summary } = d as any;
            socket.emit('deckSaved', { gameId, deck: summary });
            io.to(gameId).emit('savedDecksList', { gameId, decks: listDecks() });
          }
        } catch {
          socket.emit('deckError', { gameId, message: 'Auto-save failed.' });
        }
      }
    });

    // Saved deck pool (players only; spectators ignored)
    socket.on('listSavedDecks', ({ gameId }) => {
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!pid || socket.data.spectator) return;
      const decks = listDecks();
      socket.emit('savedDecksList', { gameId, decks });
    });

    socket.on('getSavedDeck', ({ gameId, deckId }) => {
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!pid || socket.data.spectator) return;
      const deck = getDeckDB(deckId);
      if (!deck) {
        socket.emit('deckError', { gameId, message: 'Deck not found.' });
        return;
      }
      socket.emit('savedDeckDetail', { gameId, deck });
    });

    // UPDATED: robust import of saved deck + commander suggestion
    socket.on('useSavedDeck', async ({ gameId, deckId }) => {
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!pid || socket.data.spectator) {
        socket.emit('deckError', { gameId, message: 'Spectators cannot use saved decks.' });
        return;
      }
      const game = ensureGame(gameId);
      const deck = getDeckDB(deckId);
      if (!deck) {
        socket.emit('deckError', { gameId, message: 'Deck not found.' });
        return;
      }
      try {
        const resolvedCards = await importDeckTextIntoGame(io, game, gameId, pid, deck.text);
        const handEmpty = (game.state.zones?.[pid]?.handCount ?? 0) === 0;
        if (handEmpty) {
          const isCommanderFmt = String(game.state.format).toLowerCase() === 'commander';
          if (isCommanderFmt) {
            game.flagPendingOpeningDraw(pid);
            const sockId = game.participants().find(p => p.playerId === pid)?.socketId;
            const names = suggestCommandersFromResolved(resolvedCards);
            if (sockId) (io.to(sockId) as any).emit('suggestCommanders', { gameId, names });
          } else {
            game.shuffleLibrary(pid);
            appendEvent(gameId, game.seq, 'shuffleLibrary', { playerId: pid });
            game.drawCards(pid, 7);
            appendEvent(gameId, game.seq, 'drawCards', { playerId: pid, count: 7 });
          }
          broadcastGame(io, game, gameId);
        }
      } catch (e) {
        socket.emit('deckError', { gameId, message: 'Use deck failed.' });
      }
    });

    socket.on('saveDeck', ({ gameId, name, list }) => {
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!pid || socket.data.spectator) {
        socket.emit('deckError', { gameId, message: 'Spectators cannot save decks.' });
        return;
      }
      if (!name || !name.trim()) { socket.emit('deckError', { gameId, message: 'Deck name required.' }); return; }
      if (!list || !list.trim()) { socket.emit('deckError', { gameId, message: 'Deck list empty.' }); return; }
      if (list.length > 400_000) { socket.emit('deckError', { gameId, message: 'Deck text too large.' }); return; }

      try {
        const id = newDeckId();
        const game = ensureGame(gameId);
        const created_by_name = (game.state.players as any[])?.find(p => p.id === pid)?.name || String(pid);
        const parsed = parseDecklist(list);
        const card_count = parsed.reduce((a, p) => a + (p.count || 0), 0);

        saveDeckDB({
          id,
          name: name.trim(),
          text: list,
          created_by_id: pid,
          created_by_name,
          card_count
        });
        const d = getDeckDB(id);
        if (d) {
          const { text: _omit, entries: _omit2, ...summary } = d as any;
          socket.emit('deckSaved', { gameId, deck: summary });
          io.to(gameId).emit('savedDecksList', { gameId, decks: listDecks() });
        }
      } catch {
        socket.emit('deckError', { gameId, message: 'Save failed.' });
      }
    });

    // Anyone can rename
    socket.on('renameSavedDeck', ({ gameId, deckId, name }) => {
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!pid || socket.data.spectator) return;
      if (!name || !name.trim()) { socket.emit('deckError', { gameId, message: 'Name required.' }); return; }
      const updated = renameDeckDB(deckId, name.trim());
      if (!updated) { socket.emit('deckError', { gameId, message: 'Rename failed or deck not found.' }); return; }
      socket.emit('deckRenamed', { gameId, deck: updated });
      io.to(gameId).emit('savedDecksList', { gameId, decks: listDecks() });
    });

    // Delete with relaxed permission (creator id OR matching current name)
    socket.on('deleteSavedDeck', ({ gameId, deckId }) => {
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!pid || socket.data.spectator) return;
      const deck = getDeckDB(deckId);
      if (!deck) { socket.emit('deckError', { gameId, message: 'Deck not found.' }); return; }
      const game = ensureGame(gameId);
      const currentName = (game.state.players as any[])?.find(p => p.id === pid)?.name || '';
      const allowed =
        deck.created_by_id === pid ||
        (deck.created_by_name || '').trim().toLowerCase() === currentName.trim().toLowerCase();
      if (!allowed) { socket.emit('deckError', { gameId, message: 'Only creator can delete.' }); return; }
      if (!deleteDeckDB(deckId)) { socket.emit('deckError', { gameId, message: 'Delete failed.' }); return; }
      socket.emit('deckDeleted', { gameId, deckId });
      io.to(gameId).emit('savedDecksList', { gameId, decks: listDecks() });
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

      const isFromHand = pending.fromZone === 'hand';
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

      let paymentList: PaymentItem[] = Array.isArray(payment) ? payment : [];
      if (!paymentList.length) {
        const sources = (game.state.battlefield || [])
          .filter(p => p.controller === pid && !p.tapped)
          .map(p => ({ id: p.id, options: manaOptionsForPermanent(p) }))
          .filter(s => s.options.length > 0);
        const auto = autoSelectPayment(sources, costForPay);
        if (!auto) {
          socket.emit('error', { code: 'PAY', message: costForPay.hybrids.length ? 'Hybrid mana requires manual selection' : 'Costs cannot be fully met with available untapped sources' });
          return;
        }
        paymentList = auto;
      }

      for (const p of paymentList) {
        const perm = game.state.battlefield.find(b => b.id === p.permanentId);
        if (!perm) { socket.emit('error', { code: 'PAY', message: 'Invalid payment source' }); return; }
        if (perm.controller !== pid) { socket.emit('error', { code: 'PAY', message: 'You do not control a payment source' }); return; }
        if (perm.tapped) { socket.emit('error', { code: 'PAY', message: 'A chosen source is already tapped' }); return; }
        const opts = manaOptionsForPermanent(perm);
        if (!opts.includes(p.mana as Color)) {
          socket.emit('error', { code: 'PAY', message: `Source cannot produce ${p.mana}` });
          return;
        }
      }

      const pool = paymentToPool(paymentList);
      if (!canPayEnhanced(costForPay, pool)) {
        socket.emit('error', { code: 'PAY', message: 'Costs cannot be fully met with selected payment' });
        return;
      }

      for (const p of paymentList) {
        const perm = game.state.battlefield.find(b => b.id === p.permanentId);
        if (perm) perm.tapped = true;
      }

      if (isFromHand) {
        const idxInHand = hand.findIndex(c => c.id === pending.cardInHandId);
        if (idxInHand >= 0) {
          hand.splice(idxInHand, 1);
          z!.handCount = hand.length;
        }
      } else {
        const info = game.state.commandZone?.[pid];
        const id = info?.commanderIds?.find(x => x === card.id) || card.id;
        game.applyEvent({ type: 'castCommander', playerId: pid, commanderId: id });
        appendEvent(gameId, game.seq, 'castCommander', { playerId: pid, commanderId: id });
      }

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
      // Timer scheduled via broadcastGame
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
        image_uris: card.image_uris,
        mana_cost: card.mana_cost,
        power: card.power,
        toughness: card.toughness
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

    // Hand ops
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

    // Search
    socket.on('searchLibrary', ({ gameId, query, limit }) => {
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!pid || socket.data.spectator) return;
      const game = ensureGame(gameId);
      const results = game.searchLibrary(pid, query || '', Math.max(1, Math.min(100, Number(limit || 100))));
      io.to(socket.id).emit('searchResults', { gameId, cards: results, total: results.length });
    });

    socket.on('selectFromSearch', ({ gameId, cardIds, moveTo, reveal }) => {
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!pid || socket.data.spectator) return;
      const game = ensureGame(gameId);
      const movedNames = game.selectFromLibrary(pid, Array.isArray(cardIds) ? cardIds : [], moveTo);
      appendEvent(gameId, game.seq, 'selectFromLibrary', { playerId: pid, cardIds: cardIds || [], moveTo, reveal: Boolean(reveal) });
      if (movedNames.length) {
        io.to(gameId).emit('chat', {
          id: `m_${Date.now()}`,
          gameId,
          from: 'system',
          message: `Player ${pid} fetched ${movedNames.slice(0, 3).join(', ')}${movedNames.length > 3 ? '…' : ''} to ${moveTo}`,
          ts: Date.now()
        });
      }
      broadcastGame(io, game, gameId);
    });

    // Library peeks (Scry/Surveil)
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
      const snapshot = game.peekTopN(pid, n).map((c) => c.id);
      const union = [...(keepTopOrder || []), ...(bottomOrder || [])];
      const sameSets = snapshot.length === union.length && snapshot.every((id: string) => union.includes(id));
      if (!sameSets) {
        io.to(socket.id).emit('error', { code: 'SCRY', message: 'Scry selection no longer matches top cards' });
        return;
      }
      game.applyEvent({ type: 'scryResolve', playerId: pid, keepTopOrder: keepTopOrder || [], bottomOrder: bottomOrder || [] });
      appendEvent(gameId, game.seq, 'scryResolve', { playerId: pid, keepTopOrder: keepTopOrder || [], bottomOrder: bottomOrder || [] });
      broadcastGame(io, game, gameId);
    });

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
      const snapshot = game.peekTopN(pid, n).map((c) => c.id);
      const union = [...(toGraveyard || []), ...(keepTopOrder || [])];
      const sameSets = snapshot.length === union.length && snapshot.every((id: string) => union.includes(id));
      if (!sameSets) {
        io.to(socket.id).emit('error', { code: 'SURVEIL', message: 'Surveil selection no longer matches top cards' });
        return;
      }
      game.applyEvent({ type: 'surveilResolve', playerId: pid, toGraveyard: toGraveyard || [], keepTopOrder: keepTopOrder || [] });
      appendEvent(gameId, game.seq, 'surveilResolve', { playerId: pid, toGraveyard: toGraveyard || [], keepTopOrder: keepTopOrder || [] });
      broadcastGame(io, game, gameId);
    });

    // Free positioning
    socket.on('updatePermanentPos', ({ gameId, permanentId, x, y, z }) => {
      const game = ensureGame(gameId);
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!pid || socket.data.spectator) return;
      const perm = game.state.battlefield.find(b => b.id === permanentId);
      if (!perm) return;
      if (perm.controller !== pid) {
        socket.emit('error', { code: 'POS', message: 'You can only move your own permanents' });
        return;
      }
      game.applyEvent({ type: 'updatePermanentPos', permanentId, x, y, z });
      appendEvent(gameId, game.seq, 'updatePermanentPos', { permanentId, x, y, z });
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
      // Reschedule timer if priority holder disconnected
      if (game.state.priority) schedulePriorityTimeout(io, game, gameId);
    });
  });
}