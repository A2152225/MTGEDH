/**
 * Build a seat-scoped Observation from game state.
 *
 * Origin: AI_Upgrade Phase 0-1 (P0-1).
 * Public entry symbols: buildObservation.
 *
 * Copies fields by name. Never spreads a whole player or card object, so a new
 * hidden field cannot slip through. Face-down permanents and face-down exile
 * omit name and oracle text. Arrays are sorted for stable snapshots.
 */

import type { PlayerID } from '../../../shared/src/types.js';
import type { BattlefieldPermanent } from '../../../shared/src/types-handlers/battlefieldPermanent.js';
import type { ManaPool } from '../../../shared/src/types-handlers/manaPoolTypes.js';
import { extractCombatKeywords, getCreaturePower, getCreatureToughness } from '../combatAutomation.js';
import { permanentHasManaAbilities } from '../permanentAbilityDiscovery.js';
import { getPermanentTypeNames } from '../permanentTypeUtils.js';
import type {
  BuildObservationOptions,
  CardView,
  CommanderView,
  Observation,
  OpponentView,
  PermanentKeywordsView,
  PermanentView,
  StackItemView,
} from './observation.js';

const EMPTY_MANA_POOL: ManaPool = {
  white: 0,
  blue: 0,
  black: 0,
  red: 0,
  green: 0,
  colorless: 0,
};

function isGone(player: any): boolean {
  if (!player || typeof player !== 'object') return false;
  return Boolean(
    player.hasLost
    || player.eliminated
    || player.conceded
    || player.spectator
    || player.isSpectator
    || player.inactive,
  );
}

function readLife(state: any, playerId: PlayerID, player?: any): number {
  const fromMap = state?.life?.[playerId];
  if (typeof fromMap === 'number' && Number.isFinite(fromMap)) return fromMap;
  const fromPlayer = player?.life;
  if (typeof fromPlayer === 'number' && Number.isFinite(fromPlayer)) return fromPlayer;
  return 40;
}

function isFaceDownCard(card: any): boolean {
  return Boolean(card?.faceDown || card?.isFaceDown || card?.facedown);
}

function isFaceDownPermanent(perm: any): boolean {
  return Boolean(perm?.isFaceDown || perm?.faceDown || isFaceDownCard(perm?.card));
}

function cardCmc(card: any): number {
  if (typeof card?.cmc === 'number' && Number.isFinite(card.cmc)) return card.cmc;
  const cost = String(card?.mana_cost || card?.manaCost || '');
  if (!cost) return 0;
  let total = 0;
  const generic = cost.match(/\{(\d+)\}/g);
  if (generic) {
    for (const g of generic) total += Number(g.replace(/[{}]/g, '')) || 0;
  }
  const colored = cost.match(/\{[WUBRGC]\}/gi);
  if (colored) total += colored.length;
  const hybrid = cost.match(/\{[^}/]+\/[^}]+\}/g);
  if (hybrid) total += hybrid.length;
  return total;
}

function toCardView(card: any, opts?: { forceFaceDown?: boolean }): CardView {
  const faceDown = Boolean(opts?.forceFaceDown || isFaceDownCard(card));
  const id = String(card?.id || '');
  if (faceDown) {
    return { id, faceDown: true };
  }
  const name = typeof card?.name === 'string' ? card.name : undefined;
  const typeLine = typeof card?.type_line === 'string'
    ? card.type_line
    : (typeof card?.typeLine === 'string' ? card.typeLine : undefined);
  const oracleText = typeof card?.oracle_text === 'string'
    ? card.oracle_text
    : (typeof card?.oracleText === 'string' ? card.oracleText : undefined);
  const manaCost = typeof card?.mana_cost === 'string'
    ? card.mana_cost
    : (typeof card?.manaCost === 'string' ? card.manaCost : undefined);
  const view: CardView = { id, faceDown: false };
  if (name !== undefined) view.name = name;
  if (typeLine !== undefined) view.typeLine = typeLine;
  if (oracleText !== undefined) view.oracleText = oracleText;
  if (manaCost !== undefined) view.manaCost = manaCost;
  view.cmc = cardCmc(card);
  return view;
}

function sortById<T extends { id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function sortDeckList(items: CardView[]): CardView[] {
  return [...items].sort((a, b) => {
    const an = String(a.name || '');
    const bn = String(b.name || '');
    if (an !== bn) return an < bn ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

function permanentProducesMana(perm: BattlefieldPermanent): boolean {
  if (permanentHasManaAbilities(perm)) return true;
  // Basic lands sometimes arrive with empty oracle text in fixtures; they still produce mana.
  const typeLine = String((perm as any)?.card?.type_line || (perm as any)?.type_line || '').toLowerCase();
  return typeLine.includes('basic') && typeLine.includes('land');
}

function toKeywordsView(perm: BattlefieldPermanent, battlefield: readonly BattlefieldPermanent[]): PermanentKeywordsView {
  const k = extractCombatKeywords(perm, battlefield);
  return {
    flying: Boolean(k.flying),
    deathtouch: Boolean(k.deathtouch),
    lifelink: Boolean(k.lifelink),
    trample: Boolean(k.trample),
    indestructible: Boolean(k.indestructible),
    doubleStrike: Boolean(k.doubleStrike),
    firstStrike: Boolean(k.firstStrike),
    menace: Boolean(k.menace),
    haste: Boolean(k.haste),
    defender: Boolean(k.defender),
    vigilance: Boolean(k.vigilance),
  };
}

function copyCounters(counters: any): Record<string, number> {
  const out: Record<string, number> = {};
  if (!counters || typeof counters !== 'object') return out;
  for (const [key, value] of Object.entries(counters)) {
    const n = Number(value);
    if (Number.isFinite(n) && n !== 0) out[String(key)] = n;
  }
  return out;
}

function toPermanentView(
  perm: any,
  battlefield: readonly BattlefieldPermanent[],
): PermanentView {
  const faceDown = isFaceDownPermanent(perm);
  const card = perm?.card || {};
  const types = getPermanentTypeNames(perm).map((t) => String(t).toLowerCase());
  const isCreature = types.includes('creature');
  const typeLine = faceDown
    ? ''
    : String(card?.type_line || perm?.type_line || '');
  const oracleText = faceDown
    ? ''
    : String(card?.oracle_text || perm?.oracle_text || '');
  const view: PermanentView = {
    id: String(perm?.id || ''),
    controller: String(perm?.controller || '') as PlayerID,
    typeLine,
    types,
    oracleText,
    isToken: Boolean(perm?.isToken),
    isCommander: Boolean(perm?.isCommander),
    power: isCreature ? getCreaturePower(perm) : 0,
    toughness: isCreature ? getCreatureToughness(perm) : 0,
    keywords: faceDown
      ? {
          flying: false,
          deathtouch: false,
          lifelink: false,
          trample: false,
          indestructible: false,
          doubleStrike: false,
          firstStrike: false,
          menace: false,
          haste: false,
          defender: false,
          vigilance: false,
        }
      : toKeywordsView(perm, battlefield),
    tapped: Boolean(perm?.tapped),
    summoningSick: Boolean(perm?.summoningSickness),
    counters: copyCounters(perm?.counters),
    producesMana: faceDown ? false : permanentProducesMana(perm),
    faceDown,
  };
  if (!faceDown && typeof card?.name === 'string') view.name = card.name;
  if (types.includes('planeswalker')) {
    const loyalty = typeof perm?.loyalty === 'number'
      ? perm.loyalty
      : Number(perm?.counters?.loyalty);
    if (Number.isFinite(loyalty)) view.loyalty = loyalty;
  }
  return view;
}

function zoneCards(state: any, playerId: PlayerID, zone: 'hand' | 'graveyard' | 'exile' | 'library'): any[] {
  const z = state?.zones?.[playerId];
  const arr = z?.[zone];
  return Array.isArray(arr) ? arr : [];
}

function librarySizeFor(
  state: any,
  playerId: PlayerID,
  options?: BuildObservationOptions,
): number {
  const fromOpts = options?.librarySizes?.[playerId];
  if (typeof fromOpts === 'number' && Number.isFinite(fromOpts)) return Math.max(0, fromOpts);
  const z = state?.zones?.[playerId];
  if (typeof z?.libraryCount === 'number' && Number.isFinite(z.libraryCount)) {
    return Math.max(0, z.libraryCount);
  }
  const lib = zoneCards(state, playerId, 'library');
  return lib.length;
}

function ownDeckList(state: any, seat: PlayerID, options?: BuildObservationOptions): CardView[] {
  const source = Array.isArray(options?.ownLibrary)
    ? options!.ownLibrary!
    : zoneCards(state, seat, 'library');
  const views: CardView[] = [];
  for (const card of source) {
    if (!card || typeof card !== 'object') continue;
    views.push(toCardView(card));
  }
  return sortDeckList(views);
}

function commandViews(state: any, playerId: PlayerID): CommanderView[] {
  const cz = state?.commandZone?.[playerId];
  if (!cz) return [];
  const cards = Array.isArray(cz)
    ? cz
    : (Array.isArray(cz.commanderCards) ? cz.commanderCards : []);
  const inZone = cz?.inCommandZone;
  const taxById = cz?.taxById && typeof cz.taxById === 'object' ? cz.taxById : null;
  const defaultTax = typeof cz?.tax === 'number' ? cz.tax : undefined;
  const views: CommanderView[] = [];
  for (const card of cards) {
    if (!card || typeof card !== 'object') continue;
    const id = String(card.id || '');
    if (!id) continue;
    const inCommandZone = Array.isArray(inZone)
      ? inZone.map(String).includes(id)
      : (inZone === false ? false : true);
    const view: CommanderView = {
      id,
      inCommandZone,
    };
    if (typeof card.name === 'string') view.name = card.name;
    if (typeof card.type_line === 'string') view.typeLine = card.type_line;
    const tax = taxById && typeof taxById[id] === 'number' ? taxById[id] : defaultTax;
    if (typeof tax === 'number') view.tax = tax;
    views.push(view);
  }
  return sortById(views);
}

function copyManaPool(pool: any): ManaPool {
  if (!pool || typeof pool !== 'object') return { ...EMPTY_MANA_POOL };
  return {
    white: Number(pool.white) || 0,
    blue: Number(pool.blue) || 0,
    black: Number(pool.black) || 0,
    red: Number(pool.red) || 0,
    green: Number(pool.green) || 0,
    colorless: Number(pool.colorless) || 0,
    ...(typeof pool.generic === 'number' ? { generic: pool.generic } : {}),
  };
}

function toStackItemView(item: any): StackItemView {
  const card = item?.card;
  const name = String(
    card?.name
    || item?.source?.cardName
    || item?.ability?.text
    || item?.description
    || '',
  );
  return {
    id: String(item?.id || ''),
    controller: String(item?.controller || '') as PlayerID,
    name,
    cmc: cardCmc(card),
    type: String(item?.type || 'spell'),
  };
}

function copyCommanderDamage(state: any): Record<PlayerID, Record<string, number>> {
  const raw = state?.commanderDamage;
  const out: Record<PlayerID, Record<string, number>> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [victim, byCommander] of Object.entries(raw)) {
    if (!byCommander || typeof byCommander !== 'object') continue;
    const inner: Record<string, number> = {};
    for (const [commanderId, dmg] of Object.entries(byCommander as Record<string, unknown>)) {
      const n = Number(dmg);
      if (Number.isFinite(n) && n !== 0) inner[String(commanderId)] = n;
    }
    out[String(victim) as PlayerID] = inner;
  }
  return out;
}

/**
 * Turn game state into exactly what one seat may know.
 * Pass ownLibrary / librarySizes when libraries live outside state (server Game.libraries).
 */
export function buildObservation(
  state: any,
  seat: PlayerID,
  options?: BuildObservationOptions,
): Observation {
  const players: any[] = Array.isArray(state?.players) ? state.players : [];
  const seatPlayer = players.find((p) => String(p?.id) === String(seat));
  const battlefieldAll: BattlefieldPermanent[] = Array.isArray(state?.battlefield)
    ? state.battlefield
    : [];

  const selfBattlefield = sortById(
    battlefieldAll
      .filter((p) => String((p as any)?.controller) === String(seat))
      .map((p) => toPermanentView(p, battlefieldAll)),
  );

  const selfHand = sortById(
    zoneCards(state, seat, 'hand').map((c) => toCardView(c)),
  );
  const selfGy = sortById(
    zoneCards(state, seat, 'graveyard').map((c) => toCardView(c)),
  );
  const selfExile = sortById(
    zoneCards(state, seat, 'exile').map((c) => toCardView(c, {
      forceFaceDown: isFaceDownCard(c),
    })),
  );

  const opponents: OpponentView[] = [];
  for (const player of players) {
    const id = String(player?.id || '') as PlayerID;
    if (!id || id === String(seat)) continue;
    const oppBattlefield = sortById(
      battlefieldAll
        .filter((p) => String((p as any)?.controller) === String(id))
        .map((p) => toPermanentView(p, battlefieldAll)),
    );
    const hand = zoneCards(state, id, 'hand');
    const handSize = typeof state?.zones?.[id]?.handCount === 'number'
      ? Math.max(0, state.zones[id].handCount)
      : hand.length;
    opponents.push({
      id,
      life: readLife(state, id, player),
      handSize,
      librarySize: librarySizeFor(state, id, options),
      graveyard: sortById(zoneCards(state, id, 'graveyard').map((c) => toCardView(c))),
      exile: sortById(zoneCards(state, id, 'exile').map((c) => toCardView(c, {
        forceFaceDown: isFaceDownCard(c),
      }))),
      battlefield: oppBattlefield,
      commanders: commandViews(state, id),
      eliminated: isGone(player),
    });
  }
  opponents.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const stackRaw: any[] = Array.isArray(state?.stack) ? state.stack : [];
  // Stack grows by push; top is the last element. Preserve order for the view.
  const stack: StackItemView[] = stackRaw.map(toStackItemView);

  const manaRaw = state?.manaPool?.[seat] ?? seatPlayer?.manaPool;

  const observation: Observation = {
    seat,
    turn: Number(state?.turnNumber ?? state?.turn ?? 1) || 1,
    phase: String(state?.phase || ''),
    activeSeat: String(state?.turnPlayer || state?.activePlayer || '') as PlayerID,
    priority: String(state?.priority || '') as PlayerID,
    self: {
      life: readLife(state, seat, seatPlayer),
      hand: selfHand,
      deckList: ownDeckList(state, seat, options),
      librarySize: librarySizeFor(state, seat, options),
      graveyard: selfGy,
      exile: selfExile,
      battlefield: selfBattlefield,
      commanders: commandViews(state, seat),
      manaPool: copyManaPool(manaRaw),
    },
    opponents,
    stack,
    commanderDamage: copyCommanderDamage(state),
  };
  if (state?.step != null && state.step !== '') {
    observation.step = String(state.step);
  }
  return observation;
}
