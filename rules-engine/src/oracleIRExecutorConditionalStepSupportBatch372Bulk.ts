import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { collectCommandZoneObjects } from './oracleIRExecutorCommanderUtils';
import { getContextSourceObject } from './oracleIRExecutorContextRefUtils';
import { getProcessedBattlefield } from './oracleIRExecutorCreatureStepUtils';
import { findObjectByIdInState } from './oracleIRExecutorModifyPtWhereUtils';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';
import { haveSameName } from './types/cardParts';

type LastActionOutcome = {
  readonly kind: 'applied' | 'choice_required' | 'impossible' | 'unsupported';
  readonly stepKind: OracleEffectStep['kind'];
  readonly count?: number;
} | null;

export type Batch372BulkParams = {
  normalizedRaw: string;
  nextState: GameState;
  controllerId: PlayerID;
  ctx: OracleIRExecutionContext;
  lastActionOutcome: LastActionOutcome;
  lastMovedCards?: readonly any[];
  getConditionalSubjectCard: (params: Batch372BulkParams) => any | null;
  getReferencedObject: (nextState: GameState, ctx: OracleIRExecutionContext) => any | null;
  controlledCreatures: (nextState: GameState, controllerId: PlayerID) => any[];
  getGraveyardCards: (nextState: GameState, controllerId: PlayerID) => any[];
  getControllerLife: (nextState: GameState, controllerId: PlayerID) => number | null;
  parseSmallNumberWord: (text: string) => number | null;
  objectHasType: (object: any, type: string) => boolean;
  objectHasKeyword: (object: any, keyword: string) => boolean;
  getPlayerHandCount: (nextState: GameState, playerId: PlayerID) => number;
  getCreaturePower: (perm: any) => number;
  movedCardsFrom: (params: Batch372BulkParams) => any[];
};

function getDefendingPlayerId(
  nextState: GameState,
  ctx: OracleIRExecutionContext,
  controllerId: PlayerID
): string | null {
  const source = getContextSourceObject(ctx, (idRaw: string) =>
    findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
  );
  const fromCtx = String(
    (ctx as any)?.defendingPlayerId ??
      ctx.selectorContext?.targetOpponentId ??
      ctx.selectorContext?.targetPlayerId ??
      (ctx as any)?.thatPlayerId ??
      ''
  ).trim();
  if (fromCtx) return fromCtx;
  const fromSource = String((source as any)?.defendingPlayerId ?? (source as any)?.attacking ?? '').trim();
  return fromSource || null;
}

function cardMatchesHistoric(card: any): boolean {
  const typeLine = getExecutorTypeLineLower(card);
  return typeLine.includes('artifact') || typeLine.includes('legendary') || typeLine.includes('saga');
}

function getCounterCount(object: any, counterName: string): number | null {
  const counters = (object as any)?.counters;
  if (!counters || typeof counters !== 'object') return 0;
  const target = String(counterName || '').trim().toLowerCase();
  for (const [key, value] of Object.entries(counters as Record<string, unknown>)) {
    if (String(key || '').trim().toLowerCase() !== target) continue;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return 0;
}

function findNamedControlledPermanent(nextState: GameState, controllerId: PlayerID, name: string): boolean {
  const target = String(name || '').trim();
  if (!target) return false;
  for (const perm of getProcessedBattlefield(nextState) as any[]) {
    if (String(perm?.controller || '').trim() !== String(controllerId || '').trim()) continue;
    const n = String(perm?.name ?? perm?.card?.name ?? '').trim();
    if (n && haveSameName(n, target)) return true;
  }
  for (const obj of collectCommandZoneObjects(
    nextState,
    controllerId,
    (id) => findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, id),
  ) as any[]) {
    if (String(obj?.controller || '').trim() !== String(controllerId || '').trim()) continue;
    const n = String(obj?.name ?? obj?.card?.name ?? '').trim();
    if (n && haveSameName(n, target)) return true;
  }
  return false;
}

function countDeliriumTypes(graveyard: readonly any[]): number {
  const types = new Set<string>();
  for (const card of graveyard) {
    const tl = getExecutorTypeLineLower(card);
    if (tl.includes('artifact')) types.add('artifact');
    if (tl.includes('creature')) types.add('creature');
    if (tl.includes('enchantment')) types.add('enchantment');
    if (tl.includes('instant')) types.add('instant');
    if (tl.includes('land')) types.add('land');
    if (tl.includes('planeswalker')) types.add('planeswalker');
    if (tl.includes('sorcery')) types.add('sorcery');
    if (tl.includes('battle')) types.add('battle');
  }
  return types.size;
}

function isNight(nextState: GameState): boolean | null {
  const dayNight = String((nextState as any)?.dayNight ?? (nextState as any)?.daynight ?? '').trim().toLowerCase();
  if (dayNight === 'night') return true;
  if (dayNight === 'day') return false;
  if ((nextState as any)?.isNight === true) return true;
  if ((nextState as any)?.isNight === false) return false;
  return null;
}

export function evaluateBatch372BulkConditionalClause(params: Batch372BulkParams): boolean | null {
  const { normalizedRaw, nextState, controllerId, ctx } = params;

  if (normalizedRaw === 'it enlisted a creature this combat') {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
    );
    if ((ctx as any)?.enlistedCreatureThisCombat === true) return true;
    if ((ctx as any)?.enlistedCreatureThisCombat === false) return false;
    if (!source) return null;
    return Boolean(
      (source as any)?.enlistedThisCombat ??
        (source as any)?.enlistedCreatureThisCombat ??
        (ctx as any)?.enlistedThisCombat
    );
  }

  if (/^target creature you control gets \+2\/\+0 until end of turn if it's night/i.test(normalizedRaw)) {
    return isNight(nextState);
  }

  if (/discard a card unless you waterbend \{2\}/i.test(normalizedRaw)) {
    const paid =
      (ctx as any)?.waterbendWasPaid ??
      ctx.selectorContext?.waterbendWasPaid ??
      (ctx as any)?.optionalAdditionalCostWasPaid;
    if (paid === true) return true;
    if (paid === false) return false;
    return null;
  }

  if (/you controlled a faerie as you cast this spell/i.test(normalizedRaw)) {
    const controlled =
      (ctx as any)?.controlledFaerieAsCast ??
      (ctx.selectorContext as any)?.controlledFaerieAsCast ??
      (ctx as any)?.faerieControlledAsCast;
    if (typeof controlled === 'boolean') return controlled;
    return (getProcessedBattlefield(nextState) as any[]).some((perm: any) => {
      if (String(perm?.controller || '').trim() !== String(controllerId || '').trim()) return false;
      return params.objectHasType(perm, 'faerie');
    });
  }

  if (/discard a card unless you exile a historic card from your graveyard/i.test(normalizedRaw)) {
    const unlessPaid =
      (ctx as any)?.unlessExiledHistoricFromGraveyard ??
      (ctx.selectorContext as any)?.unlessExiledHistoricFromGraveyard;
    if (unlessPaid === true) return true;
    if (unlessPaid === false) return false;
    return params.getGraveyardCards(nextState, controllerId).some((card) => cardMatchesHistoric(card));
  }

  if (normalizedRaw === 'that creature was cast for its warp cost') {
    const ref = params.getReferencedObject(nextState, ctx) ?? params.movedCardsFrom(params)[0];
    if (!ref) return null;
    const alt =
      (ref as any)?.alternateCostId ??
      (ref as any)?.alternateCostKind ??
      (ref as any)?.castWithWarp ??
      (ref as any)?.warpCostPaid ??
      (ctx as any)?.warpCostPaid;
    if (typeof alt === 'string') return alt.toLowerCase() === 'warp';
    if (typeof alt === 'boolean') return alt;
    return null;
  }

  if (normalizedRaw === 'sickness gets more votes') {
    const votes = (nextState as any)?.councilVoteResults ?? (ctx as any)?.councilVoteResults;
    if (!votes || typeof votes !== 'object') return null;
    const sickness = Number((votes as Record<string, unknown>).sickness ?? (votes as any).Sickness ?? NaN);
    const psychosis = Number((votes as Record<string, unknown>).psychosis ?? (votes as any).Psychosis ?? NaN);
    if (!Number.isFinite(sickness) || !Number.isFinite(psychosis)) return null;
    return sickness > psychosis;
  }

  if (normalizedRaw === 'defending player has more cards in hand than you') {
    const defendingPlayerId = getDefendingPlayerId(nextState, ctx, controllerId);
    if (!defendingPlayerId) return null;
    return (
      params.getPlayerHandCount(nextState, defendingPlayerId as PlayerID) >
      params.getPlayerHandCount(nextState, controllerId)
    );
  }

  if (normalizedRaw === 'no permanents left the battlefield this turn') {
    const map = (nextState as any)?.permanentLeftBattlefieldThisTurn;
    if (!map || typeof map !== 'object') {
      const legacy = (nextState as any)?.permanentsLeftBattlefieldThisTurn;
      if (typeof legacy === 'boolean') return !legacy;
      return null;
    }
    const playerIds =
      (nextState.players || [])
        .map((p: any) => String(p?.id || '').trim())
        .filter(Boolean).length > 0
        ? (nextState.players || []).map((p: any) => String(p?.id || '').trim()).filter(Boolean)
        : Object.keys(map as Record<string, unknown>);
    if (playerIds.length === 0) return null;
    for (const pid of playerIds) {
      const v = (map as Record<string, unknown>)[pid];
      if (typeof v !== 'boolean') return null;
      if (v === true) return false;
    }
    return true;
  }

  if (
    normalizedRaw ===
      "you've cast a spell named peer through depths and a spell named reach through mists this turn" ||
    normalizedRaw ===
      "you've cast a spell named Peer Through Depths and a spell named Reach Through Mists this turn"
  ) {
    const named =
      (nextState as any)?.spellsCastNamedThisTurn?.[String(controllerId || '').trim()] ??
      (ctx as any)?.spellsCastNamedThisTurn;
    if (Array.isArray(named)) {
      const lower = named.map((n) => String(n || '').trim().toLowerCase());
      return lower.includes('peer through depths') && lower.includes('reach through mists');
    }
    const map = (nextState as any)?.namedSpellsCastThisTurn?.[String(controllerId || '').trim()];
    if (map && typeof map === 'object') {
      return Boolean((map as any).peerThroughDepths && (map as any).reachThroughMists);
    }
    return null;
  }

  if (
    normalizedRaw ===
      "it doesn't have the same name as another creature you control or a creature card in your graveyard" ||
    normalizedRaw ===
      'it does not have the same name as another creature you control or a creature card in your graveyard'
  ) {
    const subject = params.getConditionalSubjectCard(params) ?? params.getReferencedObject(nextState, ctx);
    if (!subject) return null;
    const name = String((subject as any)?.name ?? (subject as any)?.card?.name ?? '').trim();
    if (!name) return null;
    for (const card of params.getGraveyardCards(nextState, controllerId)) {
      const cn = String((card as any)?.name ?? (card as any)?.card?.name ?? '').trim();
      if (!cn || !haveSameName(cn, name)) continue;
      if (!getExecutorTypeLineLower(card).includes('creature')) continue;
      return false;
    }
    const sourceId = String((subject as any)?.id ?? ctx.sourceId ?? '').trim();
    for (const perm of params.controlledCreatures(nextState, controllerId)) {
      const id = String((perm as any)?.id || '').trim();
      if (sourceId && id === sourceId) continue;
      const otherName = String((perm as any)?.name ?? (perm as any)?.card?.name ?? '').trim();
      if (otherName && haveSameName(otherName, name)) return false;
    }
    return true;
  }

  if (normalizedRaw === "it doesn't have first strike" || normalizedRaw === 'it does not have first strike') {
    const ref = params.getReferencedObject(nextState, ctx) ?? params.getConditionalSubjectCard(params);
    if (!ref) return null;
    return !params.objectHasKeyword(ref, 'first strike');
  }

  if (normalizedRaw === 'it has first strike') {
    const ref = params.getReferencedObject(nextState, ctx) ?? params.getConditionalSubjectCard(params);
    if (!ref) return null;
    return params.objectHasKeyword(ref, 'first strike');
  }

  if (normalizedRaw === 'it had a revival counter on it') {
    const ref = params.movedCardsFrom(params)[0] ?? params.getReferencedObject(nextState, ctx);
    if (!ref) return null;
    const count = getCounterCount(ref, 'revival');
    return count === null ? null : count >= 1;
  }

  if (/discard a card unless you return a land you control to its owner's hand/i.test(normalizedRaw)) {
    const paid =
      (ctx as any)?.unlessReturnedLandToHand ??
      (ctx.selectorContext as any)?.unlessReturnedLandToHand;
    if (paid === true) return true;
    if (paid === false) return false;
    return (getProcessedBattlefield(nextState) as any[]).some((perm: any) => {
      if (String(perm?.controller || '').trim() !== String(controllerId || '').trim()) return false;
      return getExecutorTypeLineLower(perm).includes('land');
    });
  }

  if (/there are four or more card types among cards in your graveyard/i.test(normalizedRaw)) {
    const graveyard = params.getGraveyardCards(nextState, controllerId);
    return countDeliriumTypes(graveyard) >= 4;
  }

  if (normalizedRaw === "this creature doesn't have a +1/+1 counter on it") {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
    );
    if (!source) return null;
    const count = getCounterCount(source, '+1/+1');
    return count === null ? null : count === 0;
  }

  if (normalizedRaw === 'you both own and control this permanent and a creature named fang') {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
    );
    if (!source) return null;
    if (String((source as any)?.controller || '').trim() !== String(controllerId || '').trim()) return false;
    if (String((source as any)?.owner || (source as any)?.ownerId || (source as any)?.controller || '').trim() !== String(controllerId || '').trim()) {
      return false;
    }
    return findNamedControlledPermanent(nextState, controllerId, 'Fang');
  }

  if (normalizedRaw === 'this enchantment has twenty or more growth counters on it') {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
    );
    if (!source) return null;
    const count = getCounterCount(source, 'growth');
    return count === null ? null : count >= 20;
  }

  if (normalizedRaw === "the card's mana value is 1 or less") {
    const ref = params.movedCardsFrom(params)[0] ?? params.getReferencedObject(nextState, ctx);
    if (ref) {
      const mv = Number((ref as any)?.manaValue ?? (ref as any)?.cmc ?? (ref as any)?.card?.manaValue ?? NaN);
      if (Number.isFinite(mv)) return mv <= 1;
    }
    const movedId = String((ref as any)?.id || params.movedCardsFrom(params)[0]?.id || '').trim();
    if (movedId) {
      for (const player of nextState.players || []) {
        for (const zone of ['exile', 'hand', 'graveyard'] as const) {
          const cards = Array.isArray((player as any)?.[zone]) ? (player as any)[zone] : [];
          const found = cards.find((card: any) => String(card?.id || '').trim() === movedId);
          if (found) {
            const zoneMv = Number((found as any)?.manaValue ?? (found as any)?.cmc ?? NaN);
            if (Number.isFinite(zoneMv)) return zoneMv <= 1;
          }
        }
      }
    }
    return null;
  }

  if (normalizedRaw === 'a giant') {
    const flag =
      (ctx as any)?.giantWizardOrControlledSpellDamagedIt ??
      (ctx as any)?.damageFromGiantWizardOrSpellThisTurn;
    return typeof flag === 'boolean' ? flag : null;
  }

  if (normalizedRaw === 'you drew two or more cards this turn') {
    const drawn = Number((nextState as any)?.cardsDrawnThisTurn?.[String(controllerId || '').trim()] ?? NaN);
    return Number.isFinite(drawn) ? drawn >= 2 : null;
  }

  if (normalizedRaw === 'you had another creature enter the battlefield under your control last turn') {
    const map = (nextState as any)?.creaturesEnteredBattlefieldUnderControlLastTurn;
    if (map && typeof map === 'object') {
      const v = (map as Record<string, unknown>)[String(controllerId || '').trim()];
      if (typeof v === 'boolean') return v;
      if (typeof v === 'number') return v >= 1;
    }
    return null;
  }

  if (normalizedRaw === 'you have 40 or more life') {
    const life = params.getControllerLife(nextState, controllerId);
    return life === null ? null : life >= 40;
  }

  if (normalizedRaw === 'this creature is equipped') {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
    );
    if (!source) return null;
    if (Boolean((source as any)?.isEquipped)) return true;
    const attachedEquipment = (source as any)?.attachedEquipment;
    if (Array.isArray(attachedEquipment) && attachedEquipment.length > 0) return true;
    const sourceId = String((source as any)?.id || '').trim();
    if (!sourceId) return false;
    return (getProcessedBattlefield(nextState) as any[]).some((perm: any) => {
      if (String(perm?.attachedTo || '').trim() !== sourceId) return false;
      const tl = getExecutorTypeLineLower(perm);
      return tl.includes('equipment') || tl.includes('artifact');
    });
  }

  {
    const damageMatch = normalizedRaw.match(/^it has dealt (ten|\d+|[a-z]+) or more damage to that player this turn$/i);
    if (damageMatch) {
      const threshold = params.parseSmallNumberWord(String(damageMatch[1] || ''));
      if (threshold === null) return null;
      const dealt = Number((ctx as any)?.damageDealtToThatPlayerThisTurn ?? (ctx as any)?.damageDealtToTargetPlayerThisTurn ?? NaN);
      return Number.isFinite(dealt) ? dealt >= threshold : null;
    }
  }

  if (normalizedRaw === "you didn't play a land this turn" || normalizedRaw === 'you did not play a land this turn') {
    const map = (nextState as any)?.landsPlayedThisTurn;
    if (map && typeof map === 'object') {
      const n = Number((map as Record<string, unknown>)[String(controllerId || '').trim()]);
      return Number.isFinite(n) ? n === 0 : null;
    }
    const flag = (nextState as any)?.playedLandThisTurn?.[String(controllerId || '').trim()];
    return typeof flag === 'boolean' ? !flag : null;
  }

  if (normalizedRaw === 'its power was different from its base power') {
    const ref = params.movedCardsFrom(params)[0] ?? params.getReferencedObject(nextState, ctx);
    if (!ref) return null;
    const current = params.getCreaturePower(ref);
    const base = Number((ref as any)?.basePower ?? (ref as any)?.printedPower ?? NaN);
    if (!Number.isFinite(base)) return null;
    return current !== base;
  }

  if (normalizedRaw === 'you control no other creatures') {
    const sourceId = String(ctx.sourceId || '').trim();
    const count = params.controlledCreatures(nextState, controllerId).filter((perm) => {
      const id = String((perm as any)?.id || '').trim();
      return !sourceId || id !== sourceId;
    }).length;
    return count === 0;
  }

  if (normalizedRaw === "it isn't a vehicle" || normalizedRaw === 'it is not a vehicle') {
    const ref = params.getReferencedObject(nextState, ctx) ?? params.getConditionalSubjectCard(params);
    if (!ref) return null;
    return !params.objectHasType(ref, 'vehicle');
  }

  if (normalizedRaw === "this creature hasn't been exerted this turn") {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
    );
    if (!source) return null;
    if ((source as any)?.exertedThisTurn === true) return false;
    if ((source as any)?.exertedThisTurn === false) return true;
    if ((source as any)?.wasExertedThisTurn === true) return false;
    if ((source as any)?.wasExertedThisTurn === false) return true;
    return null;
  }

  if (normalizedRaw === 'that artifact had counters on it') {
    const snapshots = Array.isArray((ctx as any)?.lastDestroyedPermanents)
      ? ((ctx as any).lastDestroyedPermanents as any[])
      : Array.isArray((ctx as any)?.lastMovedCards)
        ? ((ctx as any).lastMovedCards as any[])
        : params.movedCardsFrom(params);
    return snapshots.some((entry) => {
      const counters = (entry as any)?.counters;
      if (!counters || typeof counters !== 'object') return false;
      return Object.values(counters as Record<string, unknown>).some((v) => Number(v) > 0);
    });
  }

  if (normalizedRaw === 'there are no arrowhead counters on this artifact') {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
    );
    if (!source) return null;
    const count = getCounterCount(source, 'arrowhead');
    return count === null ? null : count === 0;
  }

  if (normalizedRaw === 'that permanent was a nissa planeswalker') {
    const ref = params.movedCardsFrom(params)[0] ?? params.getReferencedObject(nextState, ctx);
    if (!ref) return null;
    const name = String((ref as any)?.name ?? (ref as any)?.card?.name ?? '').trim().toLowerCase();
    const tl = getExecutorTypeLineLower(ref);
    return tl.includes('planeswalker') && name.includes('nissa');
  }

  if (normalizedRaw === 'that card is exiled') {
    if (params.lastActionOutcome?.stepKind === 'exile' && params.lastActionOutcome.kind === 'applied') return true;
    const moved = params.movedCardsFrom(params);
    if (moved.length > 0) return true;
    return null;
  }

  if (normalizedRaw === 'there are four or more cards exiled with this artifact') {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
    );
    const exiled = (source as any)?.exiledCards ?? (source as any)?.cardsExiledWithThis;
    if (Array.isArray(exiled)) return exiled.length >= 4;
    const count = Number((source as any)?.exiledCardCount ?? NaN);
    return Number.isFinite(count) ? count >= 4 : null;
  }

  if (normalizedRaw === 'each player has 10 or less life') {
    const players = nextState.players || [];
    if (players.length === 0) return null;
    for (const player of players) {
      const pid = String((player as any)?.id || '').trim() as PlayerID;
      const life = params.getControllerLife(nextState, pid);
      if (life === null || life > 10) return false;
    }
    return true;
  }

  {
    const mvMatch = normalizedRaw.match(
      /^the total mana value of the cards exiled this way is (thirteen|\d+|[a-z]+) or less$/i
    );
    if (mvMatch) {
      const threshold = params.parseSmallNumberWord(String(mvMatch[1] || ''));
      if (threshold === null) return null;
      const total = Number((ctx as any)?.totalManaValueExiledThisWay ?? NaN);
      return Number.isFinite(total) ? total <= threshold : null;
    }
  }

  if (normalizedRaw === 'this permanent is in the command zone') {
    const sourceId = String(ctx.sourceId || '').trim();
    return (collectCommandZoneObjects(
      nextState,
      controllerId,
      (id) => findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, id),
    ) as any[]).some(
      (obj) => String(obj?.id || '').trim() === sourceId
    );
  }

  if (normalizedRaw === 'there are two or more other creatures on the battlefield') {
    const sourceId = String(ctx.sourceId || '').trim();
    let count = 0;
    for (const perm of getProcessedBattlefield(nextState) as any[]) {
      const id = String(perm?.id || '').trim();
      if (sourceId && id === sourceId) continue;
      if (!getExecutorTypeLineLower(perm).includes('creature')) continue;
      count += 1;
    }
    return count >= 2;
  }

  if (normalizedRaw === 'a player was dealt combat damage by a zombie this turn') {
    const map = (nextState as any)?.combatDamageByZombieThisTurn;
    if (typeof map === 'boolean') return map;
    if (map && typeof map === 'object') {
      return Object.values(map as Record<string, unknown>).some((v) => v === true);
    }
    return null;
  }

  if (normalizedRaw === "it's enchanted" || normalizedRaw === 'it is enchanted') {
    const ref = params.getReferencedObject(nextState, ctx);
    if (!ref) return null;
    const refId = String((ref as any)?.id || '').trim();
    if (!refId) return false;
    return (getProcessedBattlefield(nextState) as any[]).some((perm: any) => {
      if (String(perm?.attachedTo || '').trim() !== refId) return false;
      const tl = getExecutorTypeLineLower(perm);
      return tl.includes('aura') || tl.includes('enchantment');
    });
  }

  if (normalizedRaw === "this spell's freerunning cost was paid") {
    const paid =
      (ctx as any)?.freerunningCostPaid ??
      (ctx as any)?.alternateCostId ??
      (ctx.selectorContext as any)?.freerunningCostPaid;
    if (typeof paid === 'string') return paid.toLowerCase() === 'freerunning';
    if (typeof paid === 'boolean') return paid;
    return null;
  }

  if (normalizedRaw === "you didn't play a card from exile this turn") {
    const map = (nextState as any)?.playedFromExileThisTurn;
    if (map && typeof map === 'object') {
      const v = (map as Record<string, unknown>)[String(controllerId || '').trim()];
      return typeof v === 'boolean' ? !v : null;
    }
    return null;
  }

  return null;
}
