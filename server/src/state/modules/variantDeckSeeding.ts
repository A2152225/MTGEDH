/**
 * Planechase / Archenemy deck import: split variant cards out of an imported decklist and seed
 * the planar deck (shared) and scheme deck (the archenemy's).
 *
 * Planes, phenomena and schemes are NOT part of the playable library. They arrive either inside a
 * pasted decklist (type lines Plane / Phenomenon / Scheme) or from a precon's stored variant cards
 * (preconDeckVariantCardStore). Either way they are stripped from the library and seeded here.
 *
 * Persistence (replay rule): `seedVariantDecks` appends ONE `importVariantDecks` event whose payload
 * is the resulting snapshot (contributions, shuffled deck, starting plane, scheme deck). Replay
 * restores that snapshot (applyEventPlanechaseArchenemyEvents.ts) and never reshuffles.
 *
 * Public: partitionVariantCards, seedVariantDecks, assemblePlanarDeck, applyVariantDeckSnapshot,
 * isVariantSeedingClosed.
 *
 * Rules (verified against docs/rules/MagicCompRules_20261106.txt):
 * - CR 901.5 / 103.7: the game cannot begin on a phenomenon, so phenomena at the top of the freshly
 *   shuffled planar deck go to the bottom until a plane is face up.
 * - CR 901.15 (single communal planar deck, which is what the merged deck is): each card needs a
 *   different English name, so duplicate names are dropped (first contributor in seat order wins),
 *   and the planar controller is considered the owner of every card, so planar cards carry no
 *   `owner` (asCommandZoneAbilitySource falls back to the planar controller) and record who
 *   contributed them in `contributedBy` only.
 * - CR 904.5: the archenemy starts at 40 life; saved in the snapshot as `archenemyLife`.
 */
import { appendEvent } from '../../db/index.js';
import { debugWarn } from '../../utils/debug.js';
import {
  isOngoingSchemeTypeLine,
  isPhenomenonTypeLine,
  isPlaneTypeLine,
  isSchemeTypeLine,
} from './planechaseOracleNormalize.js';
import { isArchenemyEnabled, getArchenemyPlayerId } from './archenemyRuntime.js';
import { isPlanechaseEnabled, seedActivePlaneAliases } from './planechaseRuntime.js';

export type VariantCardsInput = { planar: any[]; schemes: any[] };

export type VariantSeedResult = {
  planarSeeded: number;
  schemesSeeded: number;
  /** Player-facing explanations (ignored cards, closed seeding, second archenemy...). */
  notes: string[];
  startingPlane: any | null;
};

type TypeLineCard = { type_line?: unknown; typeLine?: unknown; card_faces?: any[] };

function typeLineOf(card: TypeLineCard | null | undefined): string {
  const direct = String(card?.type_line || card?.typeLine || '');
  if (direct) return direct;
  const face = Array.isArray(card?.card_faces) ? card!.card_faces![0] : null;
  return String(face?.type_line || '');
}

/** Split a resolved card list into playable cards, planar cards (planes + phenomena) and schemes. */
export function partitionVariantCards<T extends TypeLineCard>(
  cards: readonly T[] | null | undefined,
): { playable: T[]; planar: T[]; schemes: T[] } {
  const playable: T[] = [];
  const planar: T[] = [];
  const schemes: T[] = [];
  for (const card of cards || []) {
    const typeLine = typeLineOf(card);
    if (isSchemeTypeLine(typeLine) || isOngoingSchemeTypeLine(typeLine)) schemes.push(card);
    else if (isPhenomenonTypeLine(typeLine) || isPlaneTypeLine(typeLine)) planar.push(card);
    else playable.push(card);
  }
  return { playable, planar, schemes };
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function slug(value: unknown): string {
  return String(value || 'card').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'card';
}

/** CR 904.5: the archenemy's starting life total. */
export const ARCHENEMY_STARTING_LIFE = 40;

/**
 * Give every contributed card a unique id (resolver ids are kept when present).
 * Schemes are owned by the archenemy (CR 904.7). Planar cards are not stamped with an owner:
 * in the communal planar deck the planar controller is the owner (CR 901.15b).
 */
function stampCards(cards: any[], contributorId: string, prefix: string, owned: boolean): any[] {
  return cards.map((card, index) => {
    const { owner: _discardedOwner, ...rest } = card || {};
    const stamped: any = {
      ...rest,
      id: String(card?.id || `${prefix}_${slug(card?.name)}_${slug(contributorId)}_${index}`),
    };
    if (owned) stamped.owner = contributorId;
    else stamped.contributedBy = contributorId;
    return stamped;
  });
}

/**
 * Shuffle every player's planes into one shared planar deck, then turn the top plane face up
 * (phenomena go to the bottom). Contribution order follows seat order so it is stable.
 */
export function assemblePlanarDeck(
  contributions: Record<string, any[]>,
  seatOrder: readonly string[],
  random: () => number = Math.random,
): { deck: any[]; startingPlane: any | null; droppedDuplicates: string[] } {
  const ordered = [
    ...seatOrder.filter((id) => contributions[id]),
    ...Object.keys(contributions).filter((id) => !seatOrder.includes(id)),
  ];

  // CR 901.15a: every card in the communal planar deck has a different English name.
  const seenNames = new Set<string>();
  const droppedDuplicates: string[] = [];
  const unique: any[] = [];
  for (const card of ordered.flatMap((id) => contributions[id] || [])) {
    const key = String(card?.name || '').trim().toLowerCase();
    if (key && seenNames.has(key)) {
      droppedDuplicates.push(String(card.name));
      continue;
    }
    if (key) seenNames.add(key);
    unique.push(card);
  }
  const deck = shuffled(unique, random);

  let startingPlane: any | null = null;
  for (let i = 0; i < deck.length; i++) {
    const top = deck.shift()!;
    if (isPhenomenonTypeLine(typeLineOf(top))) {
      deck.push(top);
      continue;
    }
    startingPlane = top;
    break;
  }
  return { deck, startingPlane, droppedDuplicates };
}

/** Seeding changes the decks, so it is only allowed before the first turn / planeswalk. */
export function isVariantSeedingClosed(state: any): boolean {
  return Number(state?.turnNumber ?? 0) > 0 || Number(state?.planeswalksAttempted ?? 0) > 0;
}

function seatOrderOf(state: any): string[] {
  return (Array.isArray(state?.players) ? state.players : [])
    .map((player: any) => String(player?.id || ''))
    .filter(Boolean);
}

/** CR 904.5: the archenemy starts at 40. The import just reset life to the game's starting life. */
function setArchenemyLife(ctx: any, state: any, playerId: string): void {
  if (state.life && typeof state.life === 'object') state.life[playerId] = ARCHENEMY_STARTING_LIFE;
  if (ctx?.life && typeof ctx.life === 'object' && ctx.life !== state.life) {
    ctx.life[playerId] = ARCHENEMY_STARTING_LIFE;
  }
}

function currentSeq(ctx: any, state: any): number {
  const raw = ctx?.seq;
  if (typeof raw === 'number') return raw;
  if (raw && typeof raw.value === 'number') return raw.value;
  return Number(state?.seq ?? 0);
}

/**
 * Seed the planar / scheme decks from one player's import. Mutates `ctx.state` and, when anything
 * changed outside replay, appends the `importVariantDecks` snapshot event.
 */
export function seedVariantDecks(
  ctx: any,
  playerId: string,
  cards: VariantCardsInput,
  options: { gameId?: string; random?: () => number } = {},
): VariantSeedResult {
  const state = ctx?.state;
  const result: VariantSeedResult = { planarSeeded: 0, schemesSeeded: 0, notes: [], startingPlane: null };
  const planar = Array.isArray(cards?.planar) ? cards.planar : [];
  const schemes = Array.isArray(cards?.schemes) ? cards.schemes : [];
  if (!state || (planar.length === 0 && schemes.length === 0)) return result;

  const random = options.random ?? Math.random;
  const payload: Record<string, unknown> = { playerId };

  if (isVariantSeedingClosed(state)) {
    result.notes.push(
      `The game has already started, so ${planar.length + schemes.length} planar/scheme card(s) were not added.`,
    );
    return result;
  }

  if (planar.length > 0) {
    if (!isPlanechaseEnabled(state)) {
      result.notes.push(`${planar.length} planar card(s) ignored: Planechase is not enabled for this game.`);
    } else {
      state.planarContributions = state.planarContributions || {};
      state.planarContributions[playerId] = stampCards(planar, playerId, 'plane', false);
      const { deck, startingPlane, droppedDuplicates } = assemblePlanarDeck(
        state.planarContributions,
        seatOrderOf(state),
        random,
      );
      if (droppedDuplicates.length > 0) {
        result.notes.push(
          `${droppedDuplicates.length} planar card(s) share a name with one already in the deck and were left out ` +
            `(each card in the communal planar deck needs a different name): ${droppedDuplicates.join(', ')}.`,
        );
      }
      state.planarDeckFaceDown = deck;
      seedActivePlaneAliases(state, startingPlane);
      result.planarSeeded = state.planarContributions[playerId].length;
      result.startingPlane = startingPlane;
      payload.planarContributions = state.planarContributions;
      payload.planarDeckFaceDown = deck;
      payload.currentPlane = startingPlane;
    }
  }

  if (schemes.length > 0) {
    const existing = getArchenemyPlayerId(state);
    if (!isArchenemyEnabled(state)) {
      result.notes.push(`${schemes.length} scheme card(s) ignored: Archenemy is not enabled for this game.`);
    } else if (existing && existing !== playerId) {
      result.notes.push(`${schemes.length} scheme card(s) ignored: player ${existing} is already the archenemy.`);
    } else {
      state.archenemyPlayerId = playerId;
      state.schemeDeck = shuffled(stampCards(schemes, playerId, 'scheme', true), random);
      state.ongoingSchemes = [];
      state.activeSchemes = state.ongoingSchemes;
      state.schemeGraveyard = [];
      delete state.lastSchemeInMotion;
      result.schemesSeeded = state.schemeDeck.length;
      setArchenemyLife(ctx, state, playerId);
      payload.archenemyLife = ARCHENEMY_STARTING_LIFE;
      payload.archenemyPlayerId = playerId;
      payload.schemeDeck = state.schemeDeck;
      payload.ongoingSchemes = [];
      payload.schemeGraveyard = [];
    }
  }

  if (result.planarSeeded === 0 && result.schemesSeeded === 0) return result;

  try {
    if (typeof ctx.bumpSeq === 'function') ctx.bumpSeq();
  } catch {
    /* best-effort */
  }

  const gameId = String(options.gameId || ctx?.gameId || '').trim();
  if (gameId && !ctx?.isReplaying) {
    try {
      appendEvent(gameId, currentSeq(ctx, state), 'importVariantDecks', payload);
    } catch (err) {
      debugWarn(1, '[seedVariantDecks] appendEvent failed:', err);
    }
  }
  return result;
}

/** Replay: restore the snapshot written by seedVariantDecks. Never shuffles. */
export function applyVariantDeckSnapshot(state: any, event: Record<string, any>): void {
  if (!state || !event) return;
  if (event.planarContributions && typeof event.planarContributions === 'object') {
    state.planarContributions = JSON.parse(JSON.stringify(event.planarContributions));
  }
  if (Array.isArray(event.planarDeckFaceDown)) {
    state.planarDeckFaceDown = [...event.planarDeckFaceDown];
    seedActivePlaneAliases(state, event.currentPlane ?? null);
  }
  if (event.archenemyPlayerId) {
    state.archenemyPlayerId = String(event.archenemyPlayerId);
    const life = Number(event.archenemyLife);
    if (Number.isFinite(life) && state.life && typeof state.life === 'object') {
      state.life[state.archenemyPlayerId] = life;
    }
  }
  if (Array.isArray(event.schemeDeck)) {
    state.schemeDeck = [...event.schemeDeck];
    state.ongoingSchemes = Array.isArray(event.ongoingSchemes) ? [...event.ongoingSchemes] : [];
    state.activeSchemes = state.ongoingSchemes;
    state.schemeGraveyard = Array.isArray(event.schemeGraveyard) ? [...event.schemeGraveyard] : [];
    delete state.lastSchemeInMotion;
  }
}
