// client/src/utils/faceDownUi.ts
// Morph / megamorph / disguise client glue: turn-face-up requests, the reveal prompt
// (server -> 'turnFaceUpRevealPrompt'), the 'cardRevealed' toast and turn-up cost labels.
// Public entry symbols: installFaceDownListeners, requestTurnFaceUp, subscribeRevealPrompt,
// getPendingRevealPrompt, clearRevealPrompt, describeTurnFaceUpCostLabel, isFaceDownPermanent, lookupKnownCard.

import { toast } from '../components/ToastHost';

export interface TurnFaceUpCostView {
  kind?: string;
  raw?: string;
  manaCost?: string;
  revealColor?: string;
  revealColorWord?: string;
  lifeCost?: number;
}

export interface TurnFaceUpRevealPrompt {
  gameId: string;
  permanentId: string;
  colorWord?: string;
  candidateCardIds: string[];
  /** 'reveal' (default) | 'return' | 'sacrifice' | 'discard' */
  component?: string;
  description?: string;
  count?: number;
}

export interface TurnFaceUpCostChoices { reveal?: string; return?: string[]; sacrifice?: string[]; discard?: string[] }

type Sock = { on: (ev: string, fn: (p: any) => void) => unknown; emit: (ev: string, p: any) => unknown };

let sockRef: Sock | null = null;
let currentGameId = '';
let pending: TurnFaceUpRevealPrompt | null = null;
const listeners = new Set<(p: TurnFaceUpRevealPrompt | null) => void>();
const knownCards = new Map<string, any>();
/** Cost parts chosen so far per permanent (server may prompt for each part in turn). */
const accumulated = new Map<string, TurnFaceUpCostChoices>();
const seenReveals = new Set<string>();
let revealsSeeded = false;
const pendingToasts = new Map<string, { name?: string; revealed?: string; timer: any }>();
const TOAST_MERGE_MS = 80;

export function isFaceDownPermanent(perm: any): boolean {
  return !!perm && (perm.isFaceDown === true || perm.card?.isFaceDownStub === true);
}

/** Short label for the "Turn face up (cost)" button. */
export function describeTurnFaceUpCostLabel(cost: TurnFaceUpCostView | string | null | undefined): string {
  if (!cost) return '';
  if (typeof cost === 'string') return cost;
  if (cost.manaCost) return cost.manaCost;
  if (cost.revealColorWord) return `reveal a ${cost.revealColorWord} card`;
  if (typeof cost.lifeCost === 'number') return `${cost.lifeCost} life`;
  return String(cost.raw || '');
}

function cacheHandCards(view: any): void {
  const zones = view?.zones;
  if (!zones || typeof zones !== 'object') return;
  for (const z of Object.values<any>(zones)) {
    for (const c of Array.isArray(z?.hand) ? z.hand : []) {
      if (c && c.id && c.name) knownCards.set(String(c.id), c);
    }
  }
}

function cacheBattlefield(view: any): void {
  for (const p of Array.isArray(view?.battlefield) ? view.battlefield : []) {
    const c = p?.faceUpCard || p?.card;
    const name = c?.name || c?.displayName;
    if (p?.id && name) knownCards.set(String(p.id), { ...c, name, isPermanent: true });
  }
}

/** Toast reveal-log entries (view.faceDownReveals) we haven't shown yet; first state seeds silently. */
export function describeFaceDownRevealEntry(e: any): string {
  const name = e?.card?.name || 'a card';
  return e?.reason === 'game_end'
    ? `Face-down permanent revealed at game end: ${name}.`
    : `Face-down permanent left the battlefield: it was ${name}.`;
}

function processRevealLog(view: any): void {
  const list = Array.isArray(view?.faceDownReveals) ? view.faceDownReveals : [];
  const fresh = list.filter((e: any) => e?.revealId && !seenReveals.has(String(e.revealId)));
  for (const e of fresh) seenReveals.add(String(e.revealId));
  if (!revealsSeeded) { revealsSeeded = true; return; }
  for (const e of fresh) toast.info(describeFaceDownRevealEntry(e));
}

function onState(view: any): void {
  cacheHandCards(view);
  cacheBattlefield(view);
  processRevealLog(view);
}

/** 'turn_face_up' + 'turn_face_up_cost' arrive as two events; merge into one toast. */
function queueRevealToast(p: any): void {
  const key = String(p?.permanentId || p?.cardName || 'x');
  const cur = pendingToasts.get(key) || { timer: null as any };
  if (p.reason === 'turn_face_up') cur.name = p.cardName || p.card?.name || cur.name;
  else cur.revealed = p.card?.name || cur.revealed;
  if (!cur.timer) {
    cur.timer = setTimeout(() => {
      pendingToasts.delete(key);
      toast.info(describeTurnFaceUpReveal({ cardName: cur.name, card: cur.revealed ? { name: cur.revealed } : undefined }));
    }, TOAST_MERGE_MS);
  }
  pendingToasts.set(key, cur);
  if (p.reason === 'turn_face_up' && p.permanentId) accumulated.delete(String(p.permanentId));
}

/** Merge one answered prompt into the accumulated costChoices for that permanent. */
export function mergeCostChoice(prev: TurnFaceUpCostChoices | undefined, component: string | undefined, ids: string[]): TurnFaceUpCostChoices {
  const next: TurnFaceUpCostChoices = { ...(prev || {}) };
  const comp = String(component || 'reveal');
  if (comp === 'reveal') next.reveal = ids[0];
  else if (comp === 'return' || comp === 'sacrifice' || comp === 'discard') next[comp] = ids.slice();
  return next;
}

/** Answer the pending prompt with the chosen ids and resend turnFaceUp with all choices so far. */
export function answerCostPrompt(ids: string[]): boolean {
  const pr = pending;
  if (!pr) return false;
  const choices = mergeCostChoice(accumulated.get(pr.permanentId), pr.component, ids);
  accumulated.set(pr.permanentId, choices);
  setPending(null);
  if (!sockRef) return false;
  sockRef.emit('turnFaceUp', {
    gameId: pr.gameId || currentGameId,
    permanentId: pr.permanentId,
    ...(choices.reveal ? { revealCardId: choices.reveal } : {}),
    costChoices: choices,
  });
  return true;
}

export function lookupKnownCard(id: string): any | undefined {
  return knownCards.get(String(id));
}

function setPending(p: TurnFaceUpRevealPrompt | null): void {
  pending = p;
  for (const fn of Array.from(listeners)) fn(p);
}

export function getPendingRevealPrompt(): TurnFaceUpRevealPrompt | null { return pending; }
export function clearRevealPrompt(): void {
  if (pending) accumulated.delete(pending.permanentId);
  setPending(null);
}
export function subscribeRevealPrompt(fn: (p: TurnFaceUpRevealPrompt | null) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function requestTurnFaceUp(permanentId: string, revealCardId?: string, gameId?: string): boolean {
  const gid = gameId || pending?.gameId || currentGameId;
  if (!sockRef || !gid || !permanentId) return false;
  if (!revealCardId) accumulated.delete(String(permanentId));
  sockRef.emit('turnFaceUp', { gameId: gid, permanentId, ...(revealCardId ? { revealCardId } : {}) });
  return true;
}

/** Toast text for 'cardRevealed' (reason turn_face_up): cardName = permanent turned up, card = revealed card. */
export function describeTurnFaceUpReveal(p: any): string {
  const name = p?.cardName ? String(p.cardName) : '';
  const revealed = p?.card?.name ? String(p.card.name) : '';
  const base = name ? `${name} was turned face up` : 'A face-down permanent was turned face up';
  return revealed && revealed !== name ? `${base} (revealed ${revealed}).` : `${base}.`;
}

/** Idempotent per socket. */
export function installFaceDownListeners(sock: Sock): void {
  if (sockRef === sock) return;
  sockRef = sock;
  sock.on('joined', (p: any) => { if (p?.gameId) currentGameId = String(p.gameId); });
  sock.on('state', (p: any) => {
    if (p && typeof p === 'object' && 'gameId' in p && 'view' in p) {
      if (p.gameId) currentGameId = String(p.gameId);
      onState(p.view);
    } else if (p) {
      if (p.id || p.gameId) currentGameId = String(p.id || p.gameId);
      onState(p);
    }
  });
  sock.on('turnFaceUpRevealPrompt', (p: any) => {
    if (!p?.permanentId) return;
    setPending({
      gameId: String(p.gameId || currentGameId),
      permanentId: String(p.permanentId),
      colorWord: p.colorWord ? String(p.colorWord) : undefined,
      candidateCardIds: Array.isArray(p.candidateCardIds) ? p.candidateCardIds.map(String) : [],
      component: 'reveal',
      count: 1,
    });
  });
  sock.on('turnFaceUpCostPrompt', (p: any) => {
    if (!p?.permanentId) return;
    setPending({
      gameId: String(p.gameId || currentGameId),
      permanentId: String(p.permanentId),
      colorWord: p.colorWord ? String(p.colorWord) : undefined,
      candidateCardIds: Array.isArray(p.candidateIds) ? p.candidateIds.map(String) : [],
      component: String(p.component || 'reveal'),
      description: p.description ? String(p.description) : undefined,
      count: Math.max(1, Number(p.count) || 1),
    });
  });
  sock.on('cardRevealed', (p: any) => {
    if (p?.reason !== 'turn_face_up' && p?.reason !== 'turn_face_up_cost') return;
    queueRevealToast(p);
  });
}

/** Test hook. */
export function __resetFaceDownUiForTests(): void {
  sockRef = null; currentGameId = ''; pending = null; listeners.clear(); knownCards.clear();
  accumulated.clear(); seenReveals.clear(); revealsSeeded = false;
  for (const t of pendingToasts.values()) clearTimeout(t.timer);
  pendingToasts.clear();
}
