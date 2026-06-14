import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { getContextSourceObject } from './oracleIRExecutorContextRefUtils';
import { getProcessedBattlefield } from './oracleIRExecutorCreatureStepUtils';
import { getAmountOfManaSpent, getAmountOfSpecificManaSymbolSpent, getColorsFromObject } from './oracleIRExecutorManaUtils';
import { findObjectByIdInState } from './oracleIRExecutorModifyPtWhereUtils';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';
import { haveSameName } from './types/cardParts';

type LastActionOutcome = {
  readonly kind: 'applied' | 'choice_required' | 'impossible' | 'unsupported';
  readonly stepKind: OracleEffectStep['kind'];
  readonly count?: number;
} | null;

export type Batch368BulkParams = {
  normalizedRaw: string;
  nextState: GameState;
  controllerId: PlayerID;
  ctx: OracleIRExecutionContext;
  lastActionOutcome: LastActionOutcome;
  lastMovedCards?: readonly any[];
  getCastManaSpendSource: (nextState: GameState, ctx: OracleIRExecutionContext) => any | null;
  getConditionalSubjectCard: (params: Batch368BulkParams) => any | null;
  getReferencedObject: (nextState: GameState, ctx: OracleIRExecutionContext) => any | null;
  controlledCreatures: (nextState: GameState, controllerId: PlayerID) => any[];
  getControlledTypeEnteredThisTurnCount: (
    nextState: GameState,
    controllerId: PlayerID,
    typeLower: string,
    excludeId?: string
  ) => number | null;
  getGraveyardCards: (nextState: GameState, controllerId: PlayerID) => any[];
  getSourceCounterCount: (nextState: GameState, ctx: OracleIRExecutionContext, counterName: string) => number;
  getControllerLife: (nextState: GameState, controllerId: PlayerID) => number | null;
  parseSmallNumberWord: (text: string) => number | null;
  objectHasType: (object: any, type: string) => boolean;
  objectHasKeyword: (object: any, keyword: string) => boolean;
  isPermanentAttacking: (perm: any) => boolean;
  cardMatchesChosenColor: (card: any, chosenColor: string) => boolean;
  contextualCardsFrom: (params: Batch368BulkParams) => any[];
  movedCardsFrom: (params: Batch368BulkParams) => any[];
  objectHasAnyCounters: (object: any) => boolean;
  getTeamPlayerIds: (nextState: GameState, controllerId: PlayerID) => readonly string[];
};

function getSpentForSymbol(obj: any, sym: string): number | null {
  const breakdown = (obj as any)?.manaSpentBreakdown ?? (obj as any)?.card?.manaSpentBreakdown;
  if (breakdown && typeof breakdown === 'object') {
    const letter = String(sym || '').toUpperCase();
    const mapKey =
      letter === 'W'
        ? 'white'
        : letter === 'U'
          ? 'blue'
          : letter === 'B'
            ? 'black'
            : letter === 'R'
              ? 'red'
              : letter === 'G'
                ? 'green'
                : letter === 'C'
                  ? 'colorless'
                  : letter.toLowerCase();
    const n = Number((breakdown as Record<string, unknown>)[mapKey]);
    if (Number.isFinite(n)) return n;
  }
  return getAmountOfSpecificManaSymbolSpent(obj, sym);
}

function manaSymbolSequenceWasSpent(obj: any, symbols: readonly string[]): boolean | null {
  const required = new Map<string, number>();
  for (const sym of symbols) {
    const color = String(sym || '').toLowerCase();
    if (!color) continue;
    required.set(color, (required.get(color) ?? 0) + 1);
  }
  if (required.size === 0) return null;
  for (const [color, count] of required) {
    const spent = getSpentForSymbol(obj, color);
    if (spent === null) return null;
    if (spent < count) return false;
  }
  return true;
}

function permanentMatchesGodDemigodOrLegendaryEnchantment(perm: any, objectHasType: (o: any, t: string) => boolean): boolean {
  const typeLine = getExecutorTypeLineLower(perm);
  if (/\bgod\b/.test(typeLine) || objectHasType(perm, 'god')) return true;
  if (/\bdemigod\b/.test(typeLine) || objectHasType(perm, 'demigod')) return true;
  return typeLine.includes('legendary') && typeLine.includes('enchantment');
}

function countMountainsOtherThanSource(nextState: GameState, controllerId: PlayerID, sourceId: string): number {
  return (getProcessedBattlefield(nextState) as any[]).filter((perm: any) => {
    if (String(perm?.controller || '').trim() !== String(controllerId || '').trim()) return false;
    if (sourceId && String(perm?.id || '').trim() === sourceId) return false;
    const typeLine = getExecutorTypeLineLower(perm);
    return typeLine.includes('mountain');
  }).length;
}

function controllerPlayedLandOrCastSpellFromNonHandThisTurn(nextState: GameState, controllerId: PlayerID): boolean | null {
  const stateAny = nextState as any;
  const pid = String(controllerId || '').trim();
  const keys = [
    'playedCardFromExileThisTurn',
    'playedFromExileThisTurn',
    'castFromExileThisTurn',
    'castFromGraveyardThisTurn',
    'playedLandFromGraveyardThisTurn',
    'playedLandFromExileThisTurn',
    'castFromLibraryThisTurn',
  ];
  let hasTracker = false;
  for (const key of keys) {
    if (stateAny?.[key] && typeof stateAny[key] === 'object') {
      hasTracker = true;
      const v = stateAny[key][pid];
      if (v === true || (typeof v === 'number' && v > 0)) return true;
    }
  }
  return hasTracker ? false : null;
}

function snowOfSpellColorsWasSpentToCast(
  nextState: GameState,
  ctx: OracleIRExecutionContext,
  getCastManaSpendSource: Batch368BulkParams['getCastManaSpendSource']
): boolean | null {
  const item = getCastManaSpendSource(nextState, ctx);
  if (!item) return null;
  const known =
    (item as any)?.snowManaOfSpellColorsSpentKnown ?? (item as any)?.card?.snowManaOfSpellColorsSpentKnown;
  const val = (item as any)?.snowManaOfSpellColorsSpent ?? (item as any)?.card?.snowManaOfSpellColorsSpent;
  if (known === true && typeof val === 'boolean') return val;
  const colors = getColorsFromObject(item);
  if (colors.length === 0) return false;
  const snowByColor = (item as any)?.snowManaSpentByColor ?? (item as any)?.card?.snowManaSpentByColor;
  if (snowByColor && typeof snowByColor === 'object') {
    for (const c of colors) {
      const n = Number((snowByColor as any)[c] ?? (snowByColor as any)[c.toLowerCase()]);
      if (Number.isFinite(n) && n > 0) return true;
    }
    return known === true ? false : null;
  }
  return null;
}

function sourceAttackedThisCombat(nextState: GameState, ctx: OracleIRExecutionContext): boolean | null {
  const source = getContextSourceObject(ctx, (idRaw: string) =>
    findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
  );
  if (!source) return null;
  const sourceId = String((source as any)?.id || ctx.sourceId || '').trim();
  const owner = String((source as any)?.controller || ctx.controllerId || '').trim();
  if (!sourceId || !owner) return null;
  const map = (nextState as any)?.attackersDeclaredThisCombatByPlayer;
  if (map && typeof map === 'object' && Object.prototype.hasOwnProperty.call(map, owner)) {
    const entries = (map as any)[owner];
    if (!Array.isArray(entries)) return null;
    return entries.some((e: any) => String(e?.id ?? e?.permanentId ?? e ?? '').trim() === sourceId);
  }
  const marker = (nextState as any)?.attackedOrBlockedThisCombatByPermanentId?.[sourceId];
  if (typeof marker === 'boolean') return marker;
  return Boolean((source as any)?.attacking || (source as any)?.attackedThisCombat) ? true : null;
}

function findBattlefieldPermanentByName(battlefield: any[], name: string): any | null {
  const target = String(name || '').trim().toLowerCase();
  if (!target) return null;
  const matches = battlefield.filter(
    (perm) => String(perm?.name || perm?.card?.name || '').trim().toLowerCase() === target
  );
  return matches.length === 1 ? matches[0] : matches[0] ?? null;
}

export function evaluateBatch368BulkConditionalClause(params: Batch368BulkParams): boolean | null {
  const { normalizedRaw, nextState, controllerId, ctx } = params;

  if (normalizedRaw === 'the token is an aura') {
    const token = params.getConditionalSubjectCard(params) ?? params.getReferencedObject(nextState, ctx);
    if (!token) return null;
    return Boolean((token as any)?.isToken) && getExecutorTypeLineLower(token).includes('aura');
  }

  {
    const m = normalizedRaw.match(/^((?:\{[wubrgcs]\})+) was spent to cast (?:it|this spell|that spell)$/i);
    if (m) {
      const symbols = [...String(m[1]).matchAll(/\{([wubrgcs])\}/gi)].map((x) => String(x[1] || '').toLowerCase());
      const castSource = params.getCastManaSpendSource(nextState, ctx);
      if (!castSource || !symbols.length) return null;
      return manaSymbolSequenceWasSpent(castSource, symbols);
    }
  }

  if (normalizedRaw === 'you control the artifact with the greatest mana value or tied for the greatest mana value') {
    const artifacts = (getProcessedBattlefield(nextState) as any[]).filter((p) =>
      getExecutorTypeLineLower(p).includes('artifact')
    );
    if (artifacts.length === 0) return false;
    let maxKnown = -Infinity;
    let hasUnknown = false;
    let unknownOnOpponent = false;
    for (const p of artifacts) {
      const mv = Number(p?.manaValue ?? p?.cmc ?? p?.card?.cmc ?? p?.card?.manaValue);
      const owner = String(p?.controller || '').trim();
      if (!Number.isFinite(mv)) {
        hasUnknown = true;
        if (owner !== String(controllerId || '').trim()) unknownOnOpponent = true;
        continue;
      }
      if (mv > maxKnown) maxKnown = mv;
    }
    if (maxKnown === -Infinity) return null;
    const youHaveMax = artifacts.some(
      (p) =>
        String(p?.controller || '').trim() === String(controllerId || '').trim() &&
        Number(p?.manaValue ?? p?.cmc ?? p?.card?.cmc ?? p?.card?.manaValue) === maxKnown
    );
    if (!hasUnknown) return youHaveMax;
    return youHaveMax && !unknownOnOpponent ? true : null;
  }

  {
    const m = normalizedRaw.match(/^there are no ([a-z][a-z0-9'’\- ]*) counters on this land$/i);
    if (m) {
      return params.getSourceCounterCount(nextState, ctx, String(m[1] || '').trim()) === 0;
    }
  }

  {
    const m = normalizedRaw.match(
      /^([a-z0-9]+) or more (artifacts|creatures|enchantments|planeswalkers|lands|battles) entered (?:the )?battlefield under your control this turn$/i
    );
    if (m) {
      const threshold = params.parseSmallNumberWord(String(m[1] || ''));
      const typeLower = String(m[2] || '').replace(/s$/, '').toLowerCase();
      if (threshold === null) return null;
      const count = params.getControlledTypeEnteredThisTurnCount(nextState, controllerId, typeLower);
      return count === null ? null : count >= threshold;
    }
  }

  if (normalizedRaw === 'your life total is less than your starting life total') {
    const life = params.getControllerLife(nextState, controllerId);
    const starting = Number((nextState as any)?.startingLife ?? 40);
    if (life === null || !Number.isFinite(starting)) return null;
    return life < starting;
  }

  if (normalizedRaw === 'your team gained life this turn') {
    const teamIds = params.getTeamPlayerIds(nextState, controllerId);
    const map = (nextState as any)?.lifeGainedThisTurn;
    if (!map || typeof map !== 'object') return null;
    return teamIds.some((id) => {
      const v = Number((map as any)[id]);
      return Number.isFinite(v) && v > 0;
    });
  }

  if (normalizedRaw === 'you both own and control this land and a creature named hanweir garrison') {
    const battlefield = getProcessedBattlefield(nextState) as any[];
    const sourceId = String(ctx.sourceId || '').trim();
    const source = sourceId ? battlefield.find((p) => String(p?.id || '').trim() === sourceId) : null;
    if (!source) return null;
    const sourceOwner = String((source as any)?.owner ?? (source as any)?.controller ?? '').trim();
    const sourceController = String((source as any)?.controller ?? '').trim();
    if (sourceOwner !== controllerId || sourceController !== controllerId) return false;
    const named = findBattlefieldPermanentByName(battlefield, 'Hanweir Garrison');
    if (!named) return false;
    return (
      String((named as any)?.owner ?? (named as any)?.controller ?? '').trim() === controllerId &&
      String((named as any)?.controller ?? '').trim() === controllerId
    );
  }

  if (normalizedRaw === 'all lands on the battlefield are islands') {
    const lands = (getProcessedBattlefield(nextState) as any[]).filter((p) => params.objectHasType(p, 'land'));
    if (lands.length === 0) return true;
    return lands.every((p) => getExecutorTypeLineLower(p).includes('island'));
  }

  if (normalizedRaw === 'this permanent attacked this combat') {
    return sourceAttackedThisCombat(nextState, ctx);
  }

  if (normalizedRaw === 'you control exactly one creature') {
    return params.controlledCreatures(nextState, controllerId).length === 1;
  }

  if (normalizedRaw === 'each opponent who cast a spell this turn with the same name as that card') {
    const refName = String(
      (ctx as any)?.referencedCardName ??
        (ctx as any)?.targetCardName ??
        params.contextualCardsFrom(params).at(-1)?.name ??
        ''
    ).trim();
    if (!refName) return null;
    const spells = (nextState as any)?.spellsCastThisTurn;
    if (!Array.isArray(spells)) return null;
    const opponents = new Set(
      (nextState.players || [])
        .map((p: any) => String(p?.id || '').trim())
        .filter((id: string) => id && id !== String(controllerId || '').trim())
    );
    return spells.some((spell: any) => {
      const caster = String(spell?.casterId || spell?.controller || '').trim();
      if (!caster || caster === String(controllerId || '').trim()) return false;
      if (opponents.size > 0 && !opponents.has(caster)) return false;
      const name = String(spell?.card?.name ?? spell?.name ?? '').trim();
      return name ? haveSameName(refName, name) : false;
    });
  }

  if (normalizedRaw === 'the sacrificed artifact was legendary') {
    const snapshots = Array.isArray((ctx as any).lastSacrificedPermanents)
      ? ((ctx as any).lastSacrificedPermanents as any[])
      : [];
    if (snapshots.length > 0) {
      return snapshots.some((entry) => {
        const typeLine = getExecutorTypeLineLower(entry);
        return typeLine.includes('artifact') && typeLine.includes('legendary');
      });
    }
    if (params.lastActionOutcome?.stepKind !== 'sacrifice') return null;
    return false;
  }

  if (normalizedRaw === 'you created a token this turn') {
    const raw =
      (nextState as any)?.tokensCreatedThisTurn?.[controllerId] ??
      (nextState as any)?.tokenCreatedThisTurn?.[controllerId];
    if (typeof raw === 'number') return raw > 0;
    if (typeof raw === 'boolean') return raw;
    return (nextState as any)?.tokensCreatedThisTurn ? false : null;
  }

  if (normalizedRaw === 'you control a god, a demigod, or a legendary enchantment') {
    return (getProcessedBattlefield(nextState) as any[]).some(
      (perm) =>
        String(perm?.controller || '').trim() === String(controllerId || '').trim() &&
        permanentMatchesGodDemigodOrLegendaryEnchantment(perm, params.objectHasType)
    );
  }

  {
    const m = normalizedRaw.match(/^an opponent has (\d+) or less life$/i);
    if (m) {
      const threshold = Number.parseInt(String(m[1] || ''), 10);
      if (!Number.isFinite(threshold)) return null;
      return (nextState.players || []).some((player: any) => {
        const playerId = String(player?.id || '').trim();
        if (!playerId || playerId === String(controllerId || '').trim()) return false;
        const life = Number(player?.life);
        return Number.isFinite(life) && life <= threshold;
      });
    }
  }

  if (normalizedRaw === 'this card is the only creature card in your graveyard') {
    const graveyard = params.getGraveyardCards(nextState, controllerId);
    if (graveyard.length === 0) return false;
    const creatureCards = graveyard.filter((c) => params.objectHasType(c, 'creature'));
    if (creatureCards.length !== 1) return creatureCards.length === 0 ? false : false;
    const sourceId = String(ctx.sourceId || '').trim();
    if (sourceId) {
      return creatureCards.some((c) => String(c?.id || c?.card?.id || '').trim() === sourceId);
    }
    return true;
  }

  if (
    normalizedRaw ===
      "you've played a land or cast a spell this turn from anywhere other than your hand" ||
    normalizedRaw === 'you have played a land or cast a spell this turn from anywhere other than your hand'
  ) {
    return controllerPlayedLandOrCastSpellFromNonHandThisTurn(nextState, controllerId);
  }

  if (normalizedRaw === 'a player discarded a card this turn') {
    if ((nextState as any)?.anyPlayerDiscardedCardThisTurn === true) return true;
    const map = (nextState as any)?.discardedCardThisTurn;
    if (!map || typeof map !== 'object') return null;
    return Object.values(map as Record<string, unknown>).some((v) => v === true || (typeof v === 'number' && v > 0));
  }

  if (normalizedRaw === "{s} of any of that spell's colors was spent to cast it") {
    return snowOfSpellColorsWasSpentToCast(nextState, ctx, params.getCastManaSpendSource);
  }

  if (normalizedRaw === 'you had a land enter the battlefield under your control this turn') {
    const count = params.getControlledTypeEnteredThisTurnCount(nextState, controllerId, 'land');
    return count === null ? null : count > 0;
  }

  if (
    normalizedRaw ===
    'the number of attacking creatures is greater than the number of quest counters on this permanent'
  ) {
    const quest = params.getSourceCounterCount(nextState, ctx, 'quest');
    const map = (nextState as any)?.attackersDeclaredThisCombatByPlayer;
    let attackerCount: number | null = null;
    if (map && typeof map === 'object') {
      const list = (map as any)[controllerId];
      if (Array.isArray(list)) attackerCount = list.length;
    }
    if (attackerCount === null) {
      attackerCount = (getProcessedBattlefield(nextState) as any[]).filter(
        (p) =>
          String(p?.controller || '').trim() === String(controllerId || '').trim() &&
          params.isPermanentAttacking(p)
      ).length;
    }
    return attackerCount > quest;
  }

  if (normalizedRaw === 'a nonred permanent is dealt damage this way') {
    if (params.lastActionOutcome?.kind === 'impossible') return false;
    const damaged = params.movedCardsFrom(params);
    const cards = damaged.length > 0 ? damaged : params.contextualCardsFrom(params);
    if (cards.length === 0) return null;
    return cards.some((card) => {
      if (!params.objectHasType(card, 'permanent') && !params.objectHasType(card, 'creature') && !params.objectHasType(card, 'artifact')) {
        const tl = getExecutorTypeLineLower(card);
        if (!tl.includes('creature') && !tl.includes('artifact') && !tl.includes('enchantment') && !tl.includes('planeswalker')) {
          return false;
        }
      }
      return !params.cardMatchesChosenColor(card, 'red');
    });
  }

  if (normalizedRaw === 'you control at least five other mountains') {
    const sourceId = String(ctx.sourceId || '').trim();
    return countMountainsOtherThanSource(nextState, controllerId, sourceId) >= 5;
  }

  if (normalizedRaw === 'this creature has defender') {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
    );
    if (!source) return null;
    return params.objectHasKeyword(source, 'defender');
  }

  if (normalizedRaw === 'a white creature is attacking') {
    return (getProcessedBattlefield(nextState) as any[]).some(
      (perm) =>
        params.isPermanentAttacking(perm) &&
        (params.cardMatchesChosenColor(perm, 'white') || getColorsFromObject(perm).includes('W'))
    );
  }

  {
    const underpayClauses = new Set([
      'the amount of mana spent to cast that spell was less than its mana value',
      'the amount of mana spent to cast this spell was less than its mana value',
    ]);
    if (underpayClauses.has(normalizedRaw)) {
      const castSource = params.getCastManaSpendSource(nextState, ctx);
      if (!castSource) return null;
      const spent = getAmountOfManaSpent(castSource);
      const manaValue = Number(
        castSource?.manaValue ?? castSource?.card?.manaValue ?? castSource?.card?.cmc ?? castSource?.cmc
      );
      if (spent === null || !Number.isFinite(manaValue)) return null;
      return spent < manaValue;
    }
  }

  if (normalizedRaw === 'they were attacked this turn by an assassin you controlled') {
    const thatPlayerId = String(
      (ctx as any)?.thatPlayerId ?? ctx.targetPlayerId ?? ctx.referencedPlayerId ?? ''
    ).trim();
    const flag = (ctx as any)?.theyWereAttackedThisTurnByAssassinYouControlled;
    if (typeof flag === 'boolean') return flag;
    const map = (nextState as any)?.attackedByAssassinThisTurnByPlayer;
    if (!map || typeof map !== 'object') return null;
    const inner = (map as any)[controllerId];
    if (inner && typeof inner === 'object' && thatPlayerId) {
      const hit = (inner as Record<string, unknown>)[thatPlayerId];
      return hit === true ? true : hit === false ? false : false;
    }
    return false;
  }

  if (normalizedRaw === 'that creature entered this turn') {
    const refId = String(
      ctx.targetCreatureId ||
        ctx.targetPermanentId ||
        (ctx as any)?.damageSourceCreatureIds?.[0] ||
        ''
    ).trim();
    const ref = refId
      ? findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, refId)
      : params.getReferencedObject(nextState, ctx);
    if (!ref) return null;
    return Boolean((ref as any)?.enteredThisTurn);
  }

  if (normalizedRaw === 'it had a counter on it') {
    const cards = [
      ...params.contextualCardsFrom(params),
      params.getConditionalSubjectCard(params),
      params.getReferencedObject(nextState, ctx),
    ].filter(Boolean);
    for (const obj of cards) {
      if (params.objectHasAnyCounters(obj)) return true;
    }
    if (cards.length === 0) return null;
    return false;
  }

  return null;
}
