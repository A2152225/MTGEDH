/**
 * Builds the privacy-safe snapshot stored with a player issue report.
 *
 * Only what the reporting player is allowed to see is captured:
 *  - battlefield / stack / graveyard / exile: public zones (any controller)
 *  - hand / library: ONLY the reporting player's own cards
 *  - never opponents' hands or libraries, and never a face-down card's identity for a non-owner.
 */
import type { IssueReportRequest, IssueZone } from '../../../shared/src/issueReport.js';
import { getCurrentPowerToughness } from '../state/modules/currentPowerToughness.js';
import { getMarkedDamage } from '../../../shared/src/markedDamage.js';

export type IssueCardSnapshot = {
  found: boolean;
  cardId: string | null;
  permanentId: string | null;
  cardName: string;
  oracleId: string | null;
  scryfallId: string | null;
  typeLine: string | null;
  oracleText: string | null;
  zone: IssueZone;
  controller: string | null;
  owner: string | null;
  state: Record<string, unknown> | null;
};

const MAX_TEXT = 4000;
const MAX_JSON = 6000;

function str(value: unknown, max = MAX_TEXT): string | null {
  if (typeof value !== 'string' || !value) return null;
  return value.length > max ? value.slice(0, max) : value;
}

function cardOracleText(card: any): string | null {
  const direct = str(card?.oracle_text);
  if (direct) return direct;
  const faces = Array.isArray(card?.card_faces) ? card.card_faces : [];
  const joined = faces.map((f: any) => String(f?.oracle_text || '')).filter(Boolean).join('\n//\n');
  return str(joined);
}

function capJson<T>(value: T): T | string {
  try {
    const text = JSON.stringify(value);
    return text.length > MAX_JSON ? text.slice(0, MAX_JSON) + '…[truncated]' : value;
  } catch {
    return '[unserializable]';
  }
}

function idOf(x: any): string {
  return String(x?.id ?? x?.card?.id ?? '');
}

function matchesCard(entry: any, req: IssueReportRequest): boolean {
  const ids = [idOf(entry), String(entry?.card?.id ?? '')].filter(Boolean);
  return (req.cardId && ids.includes(req.cardId)) || (!!req.permanentId && idOf(entry) === req.permanentId);
}

function playerZone(state: any, playerId: string, zone: 'hand' | 'graveyard' | 'exile'): any[] {
  const list = state?.zones?.[playerId]?.[zone];
  return Array.isArray(list) ? list.filter((c: any) => c && typeof c === 'object') : [];
}

function buildPermanentState(perm: any, state: any): Record<string, unknown> {
  let currentPT: { power: number; toughness: number } | null = null;
  try {
    currentPT = getCurrentPowerToughness(perm, state) ?? null;
  } catch {
    currentPT = null;
  }
  const modifiers = Array.isArray(perm?.modifiers) ? perm.modifiers.slice(0, 30) : [];
  const attachedTo = perm?.attachedTo ? String(perm.attachedTo) : null;
  const attachments = Array.isArray(perm?.attachments)
    ? perm.attachments.map((id: string) => {
        const a = (state?.battlefield || []).find((p: any) => p?.id === id);
        return { id, name: a?.card?.name ?? null };
      })
    : [];
  return {
    tapped: !!perm?.tapped,
    counters: perm?.counters && typeof perm.counters === 'object' ? { ...perm.counters } : {},
    attachedTo: attachedTo
      ? { id: attachedTo, name: (state?.battlefield || []).find((p: any) => p?.id === attachedTo)?.card?.name ?? null }
      : null,
    attachments,
    currentPower: currentPT?.power ?? null,
    currentToughness: currentPT?.toughness ?? null,
    basePower: perm?.basePower ?? null,
    baseToughness: perm?.baseToughness ?? null,
    damageMarked: getMarkedDamage(perm),
    loyalty: perm?.loyalty ?? null,
    isToken: !!perm?.isToken,
    summoningSickness: !!perm?.summoningSickness,
    phasedOut: !!perm?.phasedOut,
    attacking: perm?.attacking ?? null,
    blocking: perm?.blocking ?? null,
    grantedAbilities: Array.isArray(perm?.grantedAbilities) ? perm.grantedAbilities.slice(0, 30) : [],
    modifiers: capJson(modifiers),
    temporaryEffects: capJson(Array.isArray(perm?.temporaryEffects) ? perm.temporaryEffects.slice(0, 20) : []),
    timestamp: perm?.timestamp ?? null,
  };
}

/** Locates the reported card inside the zone the client named, restricted to what the reporter may see. */
export function buildIssueCardSnapshot(game: any, playerId: string, req: IssueReportRequest): IssueCardSnapshot {
  const state = game?.state ?? {};
  const base: IssueCardSnapshot = {
    found: false,
    cardId: req.cardId || null,
    permanentId: req.permanentId || null,
    cardName: req.cardName,
    oracleId: null,
    scryfallId: null,
    typeLine: null,
    oracleText: null,
    zone: req.zone,
    controller: null,
    owner: null,
    state: null,
  };

  let card: any = null;
  let entry: any = null;
  let controller: string | null = null;
  let owner: string | null = null;
  let stateSnapshot: Record<string, unknown> | null = null;

  try {
    switch (req.zone) {
      case 'battlefield': {
        entry = (state.battlefield || []).find((p: any) => matchesCard(p, req));
        if (entry) {
          card = entry.card;
          controller = str(entry.controller);
          owner = str(entry.owner);
          stateSnapshot = buildPermanentState(entry, state);
          const faceDown = !!(entry.faceDown || card?.faceDown);
          if (faceDown && controller !== playerId) card = null;
        }
        break;
      }
      case 'stack': {
        entry = (state.stack || []).find((s: any) => matchesCard(s, req) || (req.cardId && s?.id === req.cardId));
        if (entry) {
          card = entry.card ?? { name: entry.sourceName };
          controller = str(entry.controller);
          stateSnapshot = {
            stackItemType: entry.type ?? null,
            description: str(entry.description, 500),
            targets: Array.isArray(entry.targets) ? entry.targets.slice(0, 10) : [],
          };
        }
        break;
      }
      case 'hand': {
        entry = playerZone(state, playerId, 'hand').find((c: any) => matchesCard(c, req));
        card = entry ?? null;
        controller = owner = entry ? playerId : null;
        break;
      }
      case 'graveyard':
      case 'exile': {
        const players: any[] = Array.isArray(state.players) ? state.players : [];
        for (const p of players) {
          const found = playerZone(state, String(p?.id), req.zone).find((c: any) => matchesCard(c, req));
          if (found) {
            entry = found;
            owner = String(p.id);
            break;
          }
        }
        card = entry ?? null;
        if (card && (card.faceDown || card.isFaceDown) && owner !== playerId) card = null;
        break;
      }
      case 'library': {
        const lib: any[] | undefined = game?.libraries?.get?.(playerId);
        entry = Array.isArray(lib) ? lib.find((c: any) => matchesCard(c, req)) : undefined;
        card = entry ?? null;
        controller = owner = entry ? playerId : null;
        break;
      }
      case 'commander': {
        const info = state?.commandZone?.[playerId];
        const cards: any[] = Array.isArray(info?.commanderCards) ? info.commanderCards : [];
        entry = cards.find((c: any) => matchesCard(c, req));
        card = entry ?? null;
        controller = owner = entry ? playerId : null;
        break;
      }
    }
  } catch {
    card = null;
  }

  if (!card) return { ...base, controller, owner, state: stateSnapshot };
  return {
    found: true,
    cardId: str(card.id) ?? base.cardId,
    permanentId: req.zone === 'battlefield' ? str(entry?.id) ?? base.permanentId : base.permanentId,
    cardName: str(card.name, 200) ?? base.cardName,
    oracleId: str(card.oracle_id, 100),
    scryfallId: str(card.scryfall_id ?? card.scryfallId, 100),
    typeLine: str(card.type_line, 300),
    oracleText: cardOracleText(card),
    zone: req.zone,
    controller,
    owner: owner ?? (req.zone === 'battlefield' ? str(entry?.owner) : null),
    state: stateSnapshot,
  };
}

/** Public turn/phase/priority/stack context; no hand or library contents. */
export function buildIssueGameContext(game: any, req: IssueReportRequest): Record<string, unknown> {
  const state = game?.state ?? {};
  const players: any[] = Array.isArray(state.players) ? state.players : [];
  const nameOf = (id: unknown) => players.find((p) => p?.id === id)?.name ?? null;
  const stack = (Array.isArray(state.stack) ? state.stack : []).slice(-15).map((s: any) => ({
    id: str(s?.id, 100),
    type: str(s?.type, 40),
    name: str(s?.card?.name ?? s?.sourceName, 200),
    controller: nameOf(s?.controller) ?? str(s?.controller, 100),
    description: str(s?.description, 300),
  }));
  return {
    turn: state.turnNumber ?? state.turn ?? null,
    phase: state.phase ?? null,
    step: state.step ?? null,
    activePlayer: nameOf(state.turnPlayer) ?? str(state.turnPlayer, 100),
    priorityHolder: nameOf(state.priority) ?? str(state.priority, 100),
    stack,
    battlefieldCount: Array.isArray(state.battlefield) ? state.battlefield.length : null,
    playerCount: players.length,
    recentLog: req.recentLog ?? [],
  };
}