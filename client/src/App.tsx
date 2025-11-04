import React, { useEffect, useMemo, useRef, useState } from 'react';
import { socket } from './socket';
import type {
  ClientGameView,
  GameID,
  PlayerID,
  BattlefieldPermanent,
  TargetRef,
  PaymentItem
} from '../../shared/src';
import { BattlefieldGrid, type ImagePref } from './components/BattlefieldGrid';
import { TokenGroups } from './components/TokenGroups';
import { TableLayout } from './components/TableLayout';
import { HandGallery } from './components/HandGallery';
import { CardPreviewLayer, showCardPreview, hideCardPreview } from './components/CardPreviewLayer';
import { PaymentPicker } from './components/PaymentPicker';
import { CommanderPanel } from './components/CommanderPanel';
import { ZonesPanel } from './components/ZonesPanel';

function seatTokenKey(gameId: GameID, name: string) {
  return `mtgedh:seatToken:${gameId}:${name.trim().toLowerCase()}`;
}

type ChatMsg = { id: string; gameId: GameID; from: PlayerID | 'system'; message: string; ts: number };
type SearchItem = { id: string; name: string };
type LayoutMode = 'rows' | 'table';

type Color = PaymentItem['mana'];

function isMainPhase(phase?: any, step?: any): boolean {
  return phase === 'PRECOMBAT_MAIN' || phase === 'POSTCOMBAT_MAIN' || step === 'MAIN1' || step === 'MAIN2';
}

function parseManaCost(manaCost?: string): { colors: Record<Color, number>; generic: number; hybrids: Color[][]; hasX: boolean } {
  const res: { colors: Record<Color, number>; generic: number; hybrids: Color[][]; hasX: boolean } =
    { colors: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, generic: 0, hybrids: [], hasX: false };
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
        if ((['W','U','B','R','G','C'] as const).includes(c)) res.colors[c] += 1;
        continue;
      }
      if (parts.length === 2 && (['W','U','B','R','G','C'] as const).includes(parts[0] as Color) && (['W','U','B','R','G','C'] as const).includes(parts[1] as Color)) {
        res.hybrids.push([parts[0] as Color, parts[1] as Color]);
        continue;
      }
      const num = parseInt(parts[0], 10);
      if (!Number.isNaN(num)) { res.generic += num; continue; }
    }
    if ((['W','U','B','R','G','C'] as const).includes(sym as Color)) {
      res.colors[sym as Color] += 1;
      continue;
    }
  }
  return res;
}
function paymentToPool(payment: PaymentItem[]): Record<Color, number> {
  return payment.reduce<Record<Color, number>>((acc, p) => {
    acc[p.mana] = (acc[p.mana] || 0) + 1;
    return acc;
  }, { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });
}
function canPayEnhanced(cost: { colors: Record<Color, number>; generic: number; hybrids: Color[][] }, pool: Record<Color, number>): boolean {
  const left: Record<Color, number> = { W: pool.W, U: pool.U, B: pool.B, R: pool.R, G: pool.G, C: pool.C };
  for (const c of (['W','U','B','R','G','C'] as const)) {
    if (left[c] < cost.colors[c]) return false;
    left[c] -= cost.colors[c];
  }
  for (const group of cost.hybrids) {
    let satisfied = false;
    for (const c of group) {
      if (left[c] > 0) { left[c] -= 1; satisfied = true; break; }
    }
    if (!satisfied) return false;
  }
  const total = (['W','U','B','R','G','C'] as const).reduce((a, c) => a + left[c], 0);
  return total >= cost.generic;
}

export function App() {
  // Connection/session
  const [connected, setConnected] = useState(false);
  const [gameId, setGameId] = useState<GameID>('demo');
  const [name, setName] = useState('Player');
  const [joinAsSpectator, setJoinAsSpectator] = useState(false);

  // Remember last successful join to auto-rejoin on reconnect
  const lastJoinRef = useRef<{ gameId: GameID; name: string; spectator: boolean } | null>(null);

  // Live state
  const [you, setYou] = useState<PlayerID | null>(null);
  const [view, setView] = useState<ClientGameView | null>(null);
  const [priority, setPriority] = useState<PlayerID | null>(null);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);

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
    manaCost?: string;
    sources?: Array<{ id: string; name: string; options: Color[] }>;
    payment: PaymentItem[];
    xValue: number;
  } | null>(null);

  // Socket wiring
  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
      const last = lastJoinRef.current;
      if (last) {
        const token = sessionStorage.getItem(seatTokenKey(last.gameId, last.name)) || undefined;
        socket.emit('joinGame', { gameId: last.gameId, playerName: last.name, spectator: last.spectator, seatToken: token });
      } else if (view) {
        const token = sessionStorage.getItem(seatTokenKey(view.id, name)) || undefined;
        socket.emit('joinGame', { gameId: view.id, playerName: name, spectator: joinAsSpectator, seatToken: token });
      }
      if (view) {
        socket.emit('requestState', { gameId: view.id });
      }
    };
    const onDisconnect = () => setConnected(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    socket.on('joined', ({ you, seatToken, gameId }) => {
      setYou(you);
      lastJoinRef.current = { gameId, name, spectator: joinAsSpectator };
      if (seatToken) sessionStorage.setItem(seatTokenKey(gameId, name), seatToken);
    });

    socket.on('state', ({ view }) => setView(view));
    socket.on('stateDiff', ({ diff }) => { if (diff.full) setView(diff.full); });
    socket.on('priority', ({ player }) => setPriority(player));
    socket.on('chat', (msg: ChatMsg) => setChat(prev => [...prev.slice(-99), msg]));
    socket.on('searchResults', ({ cards }) => setSearchResults(cards));
    socket.on('validTargets', ({ spellId, minTargets, maxTargets, targets, manaCost, paymentSources }) => {
      setTargeting({
        spellId,
        min: minTargets,
        max: maxTargets,
        targets,
        chosen: new Set(),
        manaCost,
        sources: paymentSources as any,
        payment: [],
        xValue: 0
      });
    });
    socket.on('error', ({ message }) => setLastError(message || 'Error'));

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
      socket.off('error');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, joinAsSpectator, view?.id]);

  // Refresh state when tab becomes visible or window regains focus
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && view) {
        socket.emit('requestState', { gameId: view.id });
      }
    };
    const onFocus = () => {
      if (view) socket.emit('requestState', { gameId: view.id });
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onFocus);
    };
  }, [view]);

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

  // Targeting-derived sets and handlers
  const validPermanentTargets = useMemo(() => {
    if (!targeting) return new Set<string>();
    return new Set(targeting.targets.filter(t => t.kind === 'permanent').map(t => t.id));
  }, [targeting]);

  const selectedPermanentTargets = useMemo(() => {
    if (!targeting) return new Set<string>();
    const ids = Array.from(targeting.chosen)
      .filter(k => k.startsWith('permanent:'))
      .map(k => k.split(':')[1]);
    return new Set(ids);
  }, [targeting]);

  const validPlayerTargets = useMemo(() => {
    if (!targeting) return new Set<string>();
    return new Set(targeting.targets.filter(t => t.kind === 'player').map(t => t.id));
  }, [targeting]);

  const selectedPlayerTargets = useMemo(() => {
    if (!targeting) return new Set<string>();
    const ids = Array.from(targeting.chosen)
      .filter(k => k.startsWith('player:'))
      .map(k => k.split(':')[1]);
    return new Set(ids);
  }, [targeting]);

  const paymentSelectedPerms = useMemo(() => {
    if (!targeting) return new Set<string>();
    return new Set((targeting.payment || []).map(p => p.permanentId));
  }, [targeting]);

  const yourLandsPlayed = useMemo(() => {
    if (!view || !you) return 0;
    return view.landsPlayedThisTurn?.[you] ?? 0;
  }, [view, you]);

  // Affordance helpers
  const reasonCannotPlayLand = (card: { type_line?: string }) => {
    if (!view || !you) return 'Not connected';
    const type = (card.type_line || '').toLowerCase();
    if (!/\bland\b/.test(type)) return 'Not a land';
    if (view.priority !== you) return 'You must have priority';
    if (view.turnPlayer !== you) return 'Only on your turn';
    if (!isMainPhase(view.phase, view.step)) return 'Only during a main phase';
    if ((view.stack?.length ?? 0) > 0) return 'Stack must be empty';
    if ((view.landsPlayedThisTurn?.[you] ?? 0) >= 1) return 'Already played a land this turn';
    return null;
  };

  const reasonCannotCast = (card: { type_line?: string }) => {
    if (!view || !you) return 'Not connected';
    if (view.priority !== you) return 'You must have priority';
    const tl = (card.type_line || '').toLowerCase();
    const isSorcery = /\bsorcery\b/.test(tl);
    if (isSorcery) {
      if (view.turnPlayer !== you) return 'Sorceries only on your turn';
      if (!isMainPhase(view.phase, view.step)) return 'Sorceries only during a main phase';
      if ((view.stack?.length ?? 0) > 0) return 'Stack must be empty for sorceries';
    }
    return null;
  };

  // Actions
  const handleJoin = () => {
    lastJoinRef.current = { gameId, name, spectator: joinAsSpectator };
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

  const syncChosen = (next: Set<string>, spellId: string) => {
    if (!view) return;
    const chosenArr: TargetRef[] = Array.from(next).map(k => {
      const [kind, id] = k.split(':');
      return { kind: kind as TargetRef['kind'], id } as TargetRef;
    });
    socket.emit('chooseTargets', { gameId: view.id, spellId, chosen: chosenArr });
  };

  const toggleChoose = (t: TargetRef) => {
    setTargeting(prev => {
      if (!prev) return prev;
      const key = `${t.kind}:${t.id}`;
      const next = new Set(prev.chosen);
      if (next.has(key)) next.delete(key);
      else if (next.size < prev.max) next.add(key);
      syncChosen(next, prev.spellId);
      return { ...prev, chosen: next };
    });
  };

  const cancelCast = () => { if (view && targeting) socket.emit('cancelCast', { gameId: view.id, spellId: targeting.spellId }); setTargeting(null); };
  const confirmCast = () => {
    if (view && targeting) {
      const payment = targeting.payment.length ? targeting.payment : undefined;
      const xValue = targeting.xValue || undefined;
      socket.emit('confirmCast', { gameId: view.id, spellId: targeting.spellId, payment, xValue });
      setTargeting(null);
    }
  };

  // Keybindings for targeting: Esc cancels, Enter confirms
  useEffect(() => {
    if (!targeting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelCast();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (targeting.chosen.size >= targeting.min && targeting.chosen.size <= targeting.max) {
          confirmCast();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targeting]);

  // Click handlers for board
  const onPermanentClick = (id: string) => {
    if (!targeting) return;
    if (!validPermanentTargets.has(id)) return;
    toggleChoose({ kind: 'permanent', id });
  };
  const onPlayerClick = (playerId: string) => {
    if (!targeting) return;
    if (!validPlayerTargets.has(playerId)) return;
    toggleChoose({ kind: 'player', id: playerId });
  };

  const nextTurn = () => { if (view) socket.emit('nextTurn', { gameId: view.id }); };
  const nextStep = () => { if (view) socket.emit('nextStep', { gameId: view.id }); };

  // Stack helpers
  const labelForTarget = (t: string) => {
    if (!view) return t;
    const [kind, id] = t.split(':');
    if (kind === 'player') {
      const p = view.players.find(x => x.id === id);
      return p ? `Player: ${p.name}` : `Player: ${id}`;
    }
    if (kind === 'permanent') {
      const perm = (view.battlefield || []).find(b => b.id === id);
      const name = ((perm?.card as any)?.name) || id;
      return `Permanent: ${name}`;
    }
    if (kind === 'stack') {
      const s = (view.stack || []).find(x => x.id === id);
      const n = ((s?.card as any)?.name) || id;
      return `Spell: ${n}`;
    }
    return t;
  };

  const confirmDisabledReason = useMemo(() => {
    if (!targeting || !view || !you) return '';
    if (targeting.chosen.size < targeting.min) return `Select at least ${targeting.min} target(s)`;
    if (targeting.chosen.size > targeting.max) return `Select at most ${targeting.max} target(s)`;
    if (view.priority !== you) return 'You must have priority to confirm';
    if (targeting.manaCost) {
      if (targeting.payment.length === 0) return ''; // allow server auto-pay
      const parsed = parseManaCost(targeting.manaCost);
      const cost = { colors: parsed.colors, generic: parsed.generic + Math.max(0, Number(targeting.xValue || 0) | 0), hybrids: parsed.hybrids };
      const pool = paymentToPool(targeting.payment);
      if (!canPayEnhanced(cost, pool)) return 'Select mana to pay the cost (or Clear to auto-pay)';
    }
    return '';
  }, [targeting, view, you]);

  return (
    <div style={{ fontFamily: 'system-ui', padding: 16, display: 'grid', gridTemplateColumns: '1fr 420px', gap: 16 }}>
      <div>
        <h1>MTGEDH</h1>
        <div>Status: {connected ? 'connected' : 'disconnected'}</div>
        {lastError && (
          <div style={{ marginTop: 8, padding: 8, background: '#fdecea', color: '#611a15', border: '1px solid #f5c2c0', borderRadius: 6 }}>
            {lastError} <button onClick={() => setLastError(null)} style={{ marginLeft: 8 }}>Dismiss</button>
          </div>
        )}

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
              <div>Phase: {String(view.phase)} {view.step ? `• Step: ${String(view.step)}` : ''}</div>
              <button onClick={() => socket.emit('toggleTurnDirection', { gameId: view.id })}>Reverse turn order</button>
              <label>Layout:
                <select value={layout} onChange={e => setLayout(e.target.value as LayoutMode)} style={{ marginLeft: 6 }}>
                  <option value="rows">Rows</option>
                  <option value="table">Table</option>
                </select>
              </label>
              <label>Image:
                <select value={imagePref} onChange={e => setImagePref(e.target.value as ImagePref)} style={{ marginLeft: 6 }}>
                  <option value="small">small</option>
                  <option value="normal">normal</option>
                  <option value="art_crop">art_crop</option>
                </select>
              </label>
              {you === view.turnPlayer && (
                <>
                  <button onClick={nextStep} disabled={(view.stack?.length ?? 0) > 0}>Next Step</button>
                  <button onClick={nextTurn} disabled={(view.stack?.length ?? 0) > 0}>Next Turn</button>
                  <span style={{ fontSize: 12, opacity: 0.8 }}>Lands played: {yourLandsPlayed}/1</span>
                </>
              )}
            </div>

            {/* Commander panel for you */}
            {isYouPlayer && you && (
              <div style={{ marginTop: 12 }}>
                <CommanderPanel view={view} you={you} isYouPlayer={isYouPlayer} />
              </div>
            )}

            {/* Admin/basic actions */}
            <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
              <button onClick={() => restart(true)}>Restart (keep players)</button>
              <button onClick={() => restart(false)}>Restart (clear roster)</button>
              <button onClick={() => socket.emit('passPriority', { gameId: view.id })} disabled={!canPass}>Pass Priority</button>
            </div>

            {/* Stack */}
            <h3 style={{ marginTop: 16 }}>Stack</h3>
            <div style={{ border: '1px solid #ddd', padding: 8, minHeight: 40 }}>
              {(view.stack ?? []).length === 0 && <div style={{ opacity: 0.6 }}>Empty</div>}
              {(view.stack ?? []).map((s, i) => {
                const name = (s.card as any)?.name || s.id;
                const tline = (s.card as any)?.type_line || '';
                const key = `stack:${s.id}`;
                const canTarget = !!targeting && targeting.targets.some(t => t.kind === 'stack' && t.id === s.id);
                const isSelected = !!targeting && targeting.chosen.has(key);
                const targets = (s.targets || []);
                const targetsLabel = targets.length ? targets.map(labelForTarget).join(', ') : '';

                const onClick = () => {
                  if (!targeting || !canTarget) return;
                  if (isSelected) {
                    const next = new Set(targeting.chosen);
                    next.delete(key);
                    const arr = Array.from(next).map(k => {
                      const [kind, id] = k.split(':');
                      return { kind: kind as TargetRef['kind'], id } as TargetRef;
                    });
                    socket.emit('chooseTargets', { gameId: view.id, spellId: targeting.spellId, chosen: arr });
                    setTargeting({ ...targeting, chosen: next });
                  } else {
                    if (targeting.chosen.size >= targeting.max) return;
                    const next = new Set(targeting.chosen);
                    next.add(key);
                    const arr = Array.from(next).map(k => {
                      const [kind, id] = k.split(':');
                      return { kind: kind as TargetRef['kind'], id } as TargetRef;
                    });
                    socket.emit('chooseTargets', { gameId: view.id, spellId: targeting.spellId, chosen: arr });
                    setTargeting({ ...targeting, chosen: next });
                  }
                };

                return (
                  <div
                    key={s.id}
                    onClick={onClick}
                    onMouseEnter={(e) => { showCardPreview(e.currentTarget as HTMLElement, s.card as any, { prefer: 'above', anchorPadding: 0 }); }}
                    onMouseLeave={() => hideCardPreview()}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr auto',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 8px',
                      borderRadius: 6,
                      border: '1px solid',
                      marginBottom: i < (view.stack.length - 1) ? 6 : 0,
                      cursor: targeting && canTarget ? 'pointer' : 'default',
                      borderColor: isSelected ? '#2b6cb0' : canTarget ? '#38a169' : '#eee',
                      background: isSelected ? 'rgba(43,108,176,0.1)' : 'transparent'
                    }}
                    title={canTarget ? 'Click to target this spell' : undefined}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name} — {tline}</div>
                      {targetsLabel && (
                        <div style={{ fontSize: 12, color: '#555', marginTop: 2 }}>
                          → targets: {targetsLabel}
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.7, textAlign: 'right' }}>by {s.controller}</div>
                  </div>
                );
              })}
            </div>

            {/* Players and board */}
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
                  highlightPermTargets={targeting ? new Set([...validPermanentTargets]) : undefined}
                  selectedPermTargets={targeting ? new Set([...selectedPermanentTargets, ...paymentSelectedPerms]) : undefined}
                  onPermanentClick={targeting ? onPermanentClick : undefined}
                  highlightPlayerTargets={targeting ? validPlayerTargets : undefined}
                  selectedPlayerTargets={targeting ? selectedPlayerTargets : undefined}
                  onPlayerClick={targeting ? onPlayerClick : undefined}
                />
              </div>
            ) : (
              <div style={{ marginTop: 16, display: 'grid', gap: 16 }}>
                {(view.players ?? []).map(p => {
                  const perms = battlefieldByPlayer.get(p.id) || [];
                  const tokens = perms.filter(x => (x.card as any)?.type_line === 'Token');
                  const nonTokens = perms.filter(x => (x.card as any)?.type_line !== 'Token');
                  const canTargetPlayer = targeting ? validPlayerTargets.has(p.id) : false;
                  const selPlayer = targeting ? selectedPlayerTargets.has(p.id) : false;
                  return (
                    <div key={p.id}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <div style={{ fontWeight: 700 }}>{p.name} — {p.id === you ? 'Your board' : 'Opponent'}</div>
                        {targeting && (
                          <button
                            onClick={() => onPlayerClick(p.id)}
                            disabled={!canTargetPlayer}
                            style={{
                              border: '1px solid',
                              borderColor: selPlayer ? '#2b6cb0' : canTargetPlayer ? '#38a169' : '#ccc',
                              background: 'transparent',
                              color: selPlayer ? '#2b6cb0' : canTargetPlayer ? '#38a169' : '#aaa',
                              padding: '2px 8px',
                              borderRadius: 6
                            }}
                            title={canTargetPlayer ? 'Target player' : 'Not a valid player target'}
                          >
                            {selPlayer ? 'Selected' : 'Target'}
                          </button>
                        )}
                      </div>
                      {nonTokens.length > 0 && (
                        <>
                          <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>Permanents</div>
                          <BattlefieldGrid
                            perms={nonTokens}
                            imagePref={imagePref}
                            onRemove={isYouPlayer ? (id => removePermanent(id)) : undefined}
                            onCounter={isYouPlayer ? ((id, kind, delta) => addCounter(id, kind, delta)) : undefined}
                            highlightTargets={targeting ? new Set([...validPermanentTargets]) : undefined}
                            selectedTargets={targeting ? new Set([...selectedPermanentTargets, ...paymentSelectedPerms]) : undefined}
                            onCardClick={targeting ? onPermanentClick : undefined}
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
                            highlightTargets={targeting ? new Set([...validPermanentTargets]) : undefined}
                            selectedTargets={targeting ? new Set([...selectedPermanentTargets, ...paymentSelectedPerms]) : undefined}
                            onTokenClick={targeting ? onPermanentClick : undefined}
                          />
                        </>
                      )}
                      {perms.length === 0 && <div style={{ opacity: 0.6 }}>Empty battlefield</div>}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Targeting footer bar */}
            {targeting && (
              <div style={{
                position: 'fixed', left: 0, right: 0, bottom: 0, background: '#fff',
                borderTop: '1px solid #ddd', padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 50
              }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div>
                    Select {targeting.min === targeting.max ? targeting.max : `${targeting.min}–${targeting.max}`} target(s)
                    <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.7 }}>
                      Chosen: {targeting.chosen.size}/{targeting.max}
                    </span>
                    {confirmDisabledReason && (
                      <span style={{ marginLeft: 12, fontSize: 12, color: '#a00' }}>
                        {confirmDisabledReason}
                      </span>
                    )}
                  </div>
                  {(targeting.manaCost || (targeting.sources && targeting.sources.length > 0)) && (
                    <PaymentPicker
                      manaCost={targeting.manaCost}
                      manaCostDisplay={targeting.manaCost}
                      sources={targeting.sources || []}
                      chosen={targeting.payment}
                      xValue={targeting.xValue}
                      onChangeX={(x) => setTargeting(prev => prev ? { ...prev, xValue: x } : prev)}
                      onChange={(next) => setTargeting(prev => prev ? { ...prev, payment: next } : prev)}
                    />
                  )}
                </div>
                <div style={{ display: 'inline-flex', gap: 8, alignItems: 'flex-start' }}>
                  <button onClick={cancelCast}>Cancel</button>
                  <button
                    onClick={confirmCast}
                    disabled={!!confirmDisabledReason}
                    title={confirmDisabledReason || 'Put on Stack'}
                  >
                    Put on Stack
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Sidebar */}
      <div>
        <h3>Chat</h3>
        <div style={{ border: '1px solid #ccc', padding: 8, height: 260, overflow: 'auto', background: '#fafafa' }}>
          {chat.map(m => (
            <div key={m.id} style={{ fontSize: 12 }}>
              <b>{m.from}</b>: {m.message} <span style={{ opacity: 0.6 }}>({new Date(m.ts).toLocaleTimeString()})</span>
            </div>
          ))}
          {chat.length === 0 && <div style={{ opacity: 0.6 }}>No messages</div>}
        </div>

        {/* Zones panel (Library/Graveyard/Exile) */}
        {view && (
          <ZonesPanel view={view} you={you} isYouPlayer={!!isYouPlayer} />
        )}
      </div>

      {/* Global card preview portal */}
      <CardPreviewLayer />
    </div>
  );
}

export default App;