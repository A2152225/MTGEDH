import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { getContextSourceObject } from './oracleIRExecutorContextRefUtils';
import { getAmountOfManaSpent, getAmountOfSpecificManaSymbolSpent } from './oracleIRExecutorManaUtils';
import { evaluateModifyPtCondition } from './oracleIRExecutorModifyPtCondition';
import { findObjectByIdInState, getCreatureSubtypeKeys } from './oracleIRExecutorModifyPtWhereUtils';
import { getProcessedBattlefield } from './oracleIRExecutorCreatureStepUtils';
import { getExecutorTypeLineLower, hasExecutorClass } from './oracleIRExecutorPermanentUtils';
import { deriveWinningVoteChoice, getCardManaValue } from './oracleIRExecutorPlayerUtils';
import { cardMatchesType, parseSimpleCardTypeFromText } from './oracleIRExecutorZoneOps';
import { splitCardMatchesName } from './splitCards';

type ConditionalCondition = Extract<OracleEffectStep, { kind: 'conditional' }>['condition'];

type LastActionOutcome = {
  readonly kind: 'applied' | 'choice_required' | 'impossible' | 'unsupported';
  readonly stepKind: OracleEffectStep['kind'];
  readonly count?: number;
} | null;

function normalizeContextualReferenceText(value: unknown): string {
  return String(value || '')
    .replace(/\u2019/g, "'")
    .trim()
    .toLowerCase();
}

function isContextualGraveyardMoveReference(step: OracleEffectStep): boolean {
  if (step.kind !== 'move_zone') return false;
  const text = normalizeContextualReferenceText((step.what as any)?.text || (step.what as any)?.raw || '');
  return /^(?:that card|that creature|that permanent)(?: from (?:(?:the |your |their |target player's |target opponent's |an opponent's |its owner's |its controller's |that player's |one of your opponents' )?graveyard))?$/.test(
    text
  );
}

function getYourGraveyardCards(nextState: GameState, controllerId: PlayerID): any[] {
  const player = (nextState.players || []).find((p: any) => String(p?.id || '').trim() === String(controllerId || '').trim()) as any;
  return Array.isArray(player?.graveyard) ? player.graveyard : [];
}

function countYourGraveyardCards(params: {
  nextState: GameState;
  controllerId: PlayerID;
  typeName?: string;
  pendingSteps?: readonly OracleEffectStep[];
  lastMovedCards?: readonly any[];
}): number {
  const { nextState, controllerId, typeName, pendingSteps, lastMovedCards } = params;
  const graveyard = getYourGraveyardCards(nextState, controllerId);
  const normalizedTypeName = String(typeName || '').trim().toLowerCase();
  const baseCount = normalizedTypeName
    ? graveyard.filter((card: any) => cardHasType(card, normalizedTypeName)).length
    : graveyard.length;

  if (!Array.isArray(lastMovedCards) || lastMovedCards.length === 0) return baseCount;
  if (!Array.isArray(pendingSteps) || !pendingSteps.some(isContextualGraveyardMoveReference)) return baseCount;

  const graveyardIds = new Set(
    graveyard
      .map((card: any) => String(card?.id || '').trim())
      .filter(Boolean)
  );

  const adjustment = lastMovedCards.filter((card: any) => {
    const cardId = String(card?.id || '').trim();
    if (!cardId || graveyardIds.has(cardId)) return false;
    return normalizedTypeName ? cardHasType(card, normalizedTypeName) : true;
  }).length;

  return baseCount + adjustment;
}

function parseSmallNumberWord(raw: string): number | null {
  const text = String(raw || '').trim().toLowerCase();
  if (!text) return null;
  if (/^\d+$/.test(text)) return parseInt(text, 10);

  const lookup: Record<string, number> = {
    zero: 0,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
  };
  return Number.isFinite(lookup[text]) ? lookup[text] : null;
}

function matchesTypeLine(value: unknown, typeName: string): boolean {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return false;
  return new RegExp(`\\b${typeName.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'i').test(text);
}

function battlefieldObjectHasType(object: any, typeName: string): boolean {
  const normalizedTypeName = String(typeName || '').trim().toLowerCase();
  if (!normalizedTypeName) return false;

  if (hasExecutorClass(object, normalizedTypeName)) {
    return true;
  }

  return matchesTypeLine(getExecutorTypeLineLower(object), normalizedTypeName);
}

function battlefieldObjectMatchesDescriptor(object: any, descriptorRaw: string): boolean {
  const descriptor = String(descriptorRaw || '')
    .trim()
    .toLowerCase()
    .replace(/^an?\s+/i, '')
    .replace(/\s+cards?$/i, '')
    .trim();
  if (!descriptor) return true;

  const parts = descriptor.split(/\s+/g).filter(Boolean);
  return parts.every(part => battlefieldObjectHasType(object, part));
}

function countControlledBattlefieldObjectsMatching(params: {
  battlefield: readonly any[];
  controllerId: PlayerID;
  typeNames: readonly string[];
  tappedOnly?: boolean;
}): number {
  const { battlefield, controllerId, typeNames, tappedOnly } = params;
  return battlefield.filter((perm: any) => {
    if (String(perm?.controller || '').trim() !== String(controllerId || '').trim()) return false;
    if (tappedOnly && perm?.tapped !== true) return false;
    return typeNames.some((typeName) => battlefieldObjectHasType(perm, typeName));
  }).length;
}

function cardHasType(card: any, typeName: string): boolean {
  if (typeName === 'permanent') {
    return (
      matchesTypeLine(card?.type_line, 'artifact') ||
      matchesTypeLine(card?.type_line, 'battle') ||
      matchesTypeLine(card?.type_line, 'creature') ||
      matchesTypeLine(card?.type_line, 'enchantment') ||
      matchesTypeLine(card?.type_line, 'land') ||
      matchesTypeLine(card?.type_line, 'planeswalker') ||
      matchesTypeLine(card?.cardType, 'artifact') ||
      matchesTypeLine(card?.cardType, 'battle') ||
      matchesTypeLine(card?.cardType, 'creature') ||
      matchesTypeLine(card?.cardType, 'enchantment') ||
      matchesTypeLine(card?.cardType, 'land') ||
      matchesTypeLine(card?.cardType, 'planeswalker')
    );
  }
  return matchesTypeLine(card?.type_line, typeName) || matchesTypeLine(card?.cardType, typeName);
}

function matchesCardTypeDescriptor(card: any, descriptorRaw: string): boolean {
  const descriptor = String(descriptorRaw || '')
    .trim()
    .toLowerCase()
    .replace(/^an?\s+/i, '')
    .replace(/\s+cards?$/i, '')
    .trim();
  if (!descriptor) return true;

  const orParts = descriptor.split(/\s+or\s+/i).map(part => part.trim()).filter(Boolean);
  if (orParts.length > 1) {
    return orParts.some(part => matchesCardTypeDescriptor(card, part));
  }

  const commaParts = descriptor.split(/\s*,\s*/).map(part => part.trim()).filter(Boolean);
  if (commaParts.length > 1) {
    return commaParts.every(part => matchesCardTypeDescriptor(card, part));
  }

  if (descriptor.startsWith('non') && descriptor.length > 3) {
    return !cardHasType(card, descriptor.slice(3).trim());
  }

  return cardHasType(card, descriptor);
}

function getSingleChosenObjectId(ctx: OracleIRExecutionContext): string {
  const chosen = Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : [];
  const normalized = chosen.map(id => String(id || '').trim()).filter(Boolean);
  return normalized.length === 1 ? normalized[0] : '';
}

function splitCompositeCondition(raw: string, delimiter: 'and' | 'or'): string[] | null {
  const normalized = String(raw || '').trim();
  if (!normalized) return null;
  if (delimiter === 'or' && /\bor\s+(?:more|less)\b/i.test(normalized)) return null;
  const pattern = delimiter === 'and' ? /\s+and\s+/i : /\s+or\s+/i;
  const parts = normalized.split(pattern).map(part => part.trim()).filter(Boolean);
  return parts.length > 1 ? parts : null;
}

function getReferencedConditionalObject(
  nextState: GameState,
  battlefield: readonly any[],
  ctx: OracleIRExecutionContext
): any | null {
  const referencedId =
    String(ctx.targetPermanentId || '').trim() ||
    getSingleChosenObjectId(ctx) ||
    String(ctx.sourceId || '').trim();
  if (!referencedId) return null;
  return findObjectByIdInState(nextState, battlefield as any, referencedId);
}

function getConditionalObjectZoneProvenance(object: any): { castFromZone?: string; enteredFromZone?: string } {
  const castFromZone = String(object?.castFromZone || object?.card?.castFromZone || '').trim().toLowerCase() || undefined;
  const enteredFromZone =
    String(object?.enteredFromZone || object?.card?.enteredFromZone || '').trim().toLowerCase() || undefined;
  return { castFromZone, enteredFromZone };
}

function getTopLibraryCard(nextState: GameState, ownerId: string): any | null {
  const normalizedOwnerId = String(ownerId || '').trim();
  if (!normalizedOwnerId) return null;
  const player = (nextState.players || []).find((entry: any) => String(entry?.id || '').trim() === normalizedOwnerId) as any;
  return Array.isArray(player?.library) && player.library.length > 0 ? player.library[0] : null;
}

function getBattlefieldCreaturePower(perm: any): number {
  if (typeof perm?.effectivePower === 'number' && Number.isFinite(perm.effectivePower)) {
    return perm.effectivePower;
  }
  const basePower = perm?.power ?? perm?.card?.power ?? perm?.basePower;
  let power = Number.parseInt(String(basePower ?? '0'), 10);
  if (!Number.isFinite(power)) power = 0;
  const counters = ((perm as any)?.counters || {}) as Record<string, unknown>;
  power += Number(counters['+1/+1'] ?? 0);
  power -= Number(counters['-1/-1'] ?? 0);
  return power;
}

function controllerAttackedThisTurn(nextState: GameState, playerId: PlayerID): boolean {
  const normalizedPlayerId = String(playerId || '').trim();
  const attackersByPlayer = (nextState as any)?.attackersDeclaredThisCombatByPlayer;
  if (attackersByPlayer && typeof attackersByPlayer === 'object') {
    const attackers = (attackersByPlayer as Record<string, unknown>)[normalizedPlayerId];
    if (Array.isArray(attackers) && attackers.length > 0) return true;
  }

  const battlefield = getProcessedBattlefield(nextState) as any[];
  return battlefield.some(
    (perm: any) =>
      String(perm?.controller || '').trim() === normalizedPlayerId &&
      (perm?.attackedThisTurn === true || Boolean(perm?.attacking) || perm?.isAttacking === true)
  );
}

function controllerAttackedWithPowerAtLeast(
  nextState: GameState,
  playerId: PlayerID,
  threshold: number
): boolean {
  const normalizedPlayerId = String(playerId || '').trim();
  const battlefield = getProcessedBattlefield(nextState) as any[];
  return battlefield.some((perm: any) => {
    if (String(perm?.controller || '').trim() !== normalizedPlayerId) return false;
    if (
      perm?.attackedThisTurn !== true &&
      !perm?.attacking &&
      perm?.isAttacking !== true
    ) {
      return false;
    }
    return !battlefieldObjectHasType(perm, 'creature')
      ? false
      : getBattlefieldCreaturePower(perm) >= threshold;
  });
}

function controllerControlsGreatestPowerCreature(nextState: GameState, playerId: PlayerID): boolean {
  const normalizedPlayerId = String(playerId || '').trim();
  const battlefield = getProcessedBattlefield(nextState) as any[];
  const creatures = battlefield.filter((perm: any) => battlefieldObjectHasType(perm, 'creature'));
  if (creatures.length === 0) return false;

  const maxPower = Math.max(...creatures.map((perm: any) => getBattlefieldCreaturePower(perm)));
  return creatures.some(
    (perm: any) =>
      String(perm?.controller || '').trim() === normalizedPlayerId &&
      getBattlefieldCreaturePower(perm) === maxPower
  );
}

function countControlledCreaturesWithSubtype(
  nextState: GameState,
  controllerId: PlayerID,
  subtype: string
): number {
  const normalizedSubtype = String(subtype || '').trim().toLowerCase();
  if (!normalizedSubtype) return 0;
  const battlefield = getProcessedBattlefield(nextState) as any[];
  return battlefield.filter((perm: any) => {
    if (String(perm?.controller || '').trim() !== String(controllerId || '').trim()) return false;
    if (!battlefieldObjectHasType(perm, 'creature')) return false;
    const subtypes = getCreatureSubtypeKeys(perm, getExecutorTypeLineLower);
    return subtypes.some((entry: string) => entry.toLowerCase() === normalizedSubtype);
  }).length;
}

function controllerHasFullParty(nextState: GameState, controllerId: PlayerID): boolean {
  const roles = ['cleric', 'rogue', 'warrior', 'wizard'];
  return roles.every(role => countControlledCreaturesWithSubtype(nextState, controllerId, role) > 0);
}

function getPlayerPoisonCounters(nextState: GameState, playerId: string): number {
  const normalizedPlayerId = String(playerId || '').trim();
  const map = (nextState as any)?.poisonCounters;
  if (map && typeof map === 'object' && Number.isFinite(Number((map as Record<string, unknown>)[normalizedPlayerId]))) {
    return Number((map as Record<string, unknown>)[normalizedPlayerId]);
  }
  const player = (nextState.players || []).find(
    (entry: any) => String(entry?.id || '').trim() === normalizedPlayerId
  ) as any;
  const direct = Number(player?.poisonCounters);
  return Number.isFinite(direct) ? direct : 0;
}

function resolveKickedStatus(nextState: GameState, ctx: OracleIRExecutionContext, sourceRef: any): boolean | null {
  const candidates = [
    sourceRef,
    ((nextState as any)?.stack || []).find(
      (entry: any) => String(entry?.id || '').trim() === String(ctx.targetSpellId || ctx.selectorContext?.targetSpellId || '').trim()
    ),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const explicit = (candidate as any)?.wasKicked ?? (candidate as any)?.card?.wasKicked;
    if (typeof explicit === 'boolean') return explicit;
    const count =
      (candidate as any)?.kickerPaidCount ??
      (candidate as any)?.timesKicked ??
      (candidate as any)?.kickedTimes ??
      (candidate as any)?.card?.kickerPaidCount ??
      (candidate as any)?.card?.timesKicked ??
      (candidate as any)?.card?.kickedTimes;
    if (typeof count === 'number') return count > 0;
  }

  return null;
}

function resolveTargetSpellManaValue(nextState: GameState, ctx: OracleIRExecutionContext): number | null {
  if (typeof ctx.referenceSpellManaValue === 'number' && Number.isFinite(ctx.referenceSpellManaValue)) {
    return ctx.referenceSpellManaValue;
  }

  const selectorSpellManaValue = Number(ctx.selectorContext?.spellManaValue);
  if (Number.isFinite(selectorSpellManaValue)) {
    return selectorSpellManaValue;
  }

  const targetSpellId = String(ctx.targetSpellId || ctx.selectorContext?.targetSpellId || '').trim();
  if (!targetSpellId) return null;

  const stackSpell = ((nextState as any)?.stack || []).find(
    (entry: any) => String(entry?.id || '').trim() === targetSpellId
  );
  if (!stackSpell) return null;
  return getCardManaValue(stackSpell.card || stackSpell);
}

function topCardSharesCreatureTypeWithSource(nextState: GameState, ownerId: string, sourceRef: any): boolean {
  const topCard = getTopLibraryCard(nextState, ownerId);
  if (!topCard || !sourceRef) return false;

  const topCardSubtypes = new Set(getCreatureSubtypeKeys(topCard, getExecutorTypeLineLower));
  const sourceSubtypes = new Set(getCreatureSubtypeKeys(sourceRef, getExecutorTypeLineLower));
  if (topCardSubtypes.size === 0 || sourceSubtypes.size === 0) return false;

  for (const subtype of topCardSubtypes) {
    if (sourceSubtypes.has(subtype)) return true;
  }
  return false;
}

export function evaluateConditionalWrapperCondition(params: {
  condition: ConditionalCondition;
  nextState: GameState;
  controllerId: PlayerID;
  ctx: OracleIRExecutionContext;
  lastActionOutcome: LastActionOutcome;
  lastStepOutcome?: LastActionOutcome;
  lastConditionalEvaluation?: boolean | null;
  pendingSteps?: readonly OracleEffectStep[];
  lastMovedCards?: readonly any[];
  lastDiscardedCards?: readonly any[];
}): boolean | null {
  const {
    condition,
    nextState,
    controllerId,
    ctx,
    lastActionOutcome,
    lastStepOutcome = null,
    lastConditionalEvaluation,
    pendingSteps,
    lastMovedCards,
    lastDiscardedCards,
  } = params;

  const getAffirmativeAntecedentOutcome = (): LastActionOutcome =>
    lastActionOutcome ?? lastStepOutcome;
  if (condition.kind !== 'if' && condition.kind !== 'as_long_as') return null;

  const raw = String(condition.raw || '').trim().toLowerCase();
  const normalizedRaw = raw.replace(/\u2019/g, "'").replace(/\s+/g, ' ').trim();

  if (normalizedRaw === 'otherwise') {
    return typeof lastConditionalEvaluation === 'boolean' ? !lastConditionalEvaluation : null;
  }

  {
    const movedCardTypeMatch = normalizedRaw.match(/^it was (?:a|an)\s+(.+?)(?:\s+card)?$/i);
    if (movedCardTypeMatch) {
      if (lastActionOutcome?.kind === 'impossible') return false;
      if (lastActionOutcome?.stepKind !== 'move_zone' && lastActionOutcome?.stepKind !== 'discard') return null;

      const descriptor = String(movedCardTypeMatch[1] || '').trim().toLowerCase();
      const movedCards = lastActionOutcome?.stepKind === 'discard'
        ? (Array.isArray(lastDiscardedCards) ? lastDiscardedCards : [])
        : (Array.isArray(lastMovedCards) ? lastMovedCards : []);
      return movedCards.some((card: any) => matchesCardTypeDescriptor(card, descriptor));
    }
  }

  {
    const movedCardTypeNegatedMatch = normalizedRaw.match(/^it was not (?:a|an)\s+(.+?)(?:\s+card)?$/i);
    if (movedCardTypeNegatedMatch) {
      if (lastActionOutcome?.kind === 'impossible') return false;
      if (lastActionOutcome?.stepKind !== 'move_zone' && lastActionOutcome?.stepKind !== 'discard') return null;

      const descriptor = String(movedCardTypeNegatedMatch[1] || '').trim().toLowerCase();
      const movedCards = lastActionOutcome?.stepKind === 'discard'
        ? (Array.isArray(lastDiscardedCards) ? lastDiscardedCards : [])
        : (Array.isArray(lastMovedCards) ? lastMovedCards : []);
      return movedCards.length > 0 && movedCards.every((card: any) => !matchesCardTypeDescriptor(card, descriptor));
    }
  }

  {
    const discardedThisWayMatch = normalizedRaw.match(/^a[n]?\s+(.+?)\s+card\s+was\s+discarded\s+this\s+way$/i);
    if (discardedThisWayMatch) {
      if (lastActionOutcome?.kind === 'impossible') return false;
      if (lastActionOutcome?.stepKind !== 'discard') return null;

      const descriptor = String(discardedThisWayMatch[1] || '').trim().toLowerCase();
      const discardedCards = Array.isArray(lastDiscardedCards) ? lastDiscardedCards : [];
      return discardedCards.some((card: any) => matchesCardTypeDescriptor(card, descriptor));
    }
  }

  {
    const youDiscardThisWayMatch = normalizedRaw.match(/^you discard (?:a|an) (.+?) card this way$/i);
    if (youDiscardThisWayMatch) {
      if (lastActionOutcome?.kind === 'impossible') return false;
      if (lastActionOutcome?.stepKind !== 'discard') return null;

      const descriptor = String(youDiscardThisWayMatch[1] || '').trim().toLowerCase();
      const discardedCards = Array.isArray(lastDiscardedCards) ? lastDiscardedCards : [];
      return discardedCards.some((card: any) => matchesCardTypeDescriptor(card, descriptor));
    }
  }

  {
    const putIntoExileThisWayMatch = normalizedRaw.match(/^(?:a|an)\s+(.+?)\s+is put into exile this way$/i);
    if (putIntoExileThisWayMatch) {
      if (lastActionOutcome?.kind === 'impossible') return false;
      if (lastActionOutcome?.stepKind !== 'move_zone' && lastActionOutcome?.stepKind !== 'exile') return null;

      const descriptor = String(putIntoExileThisWayMatch[1] || '').trim().toLowerCase();
      const movedCards = Array.isArray(lastMovedCards) ? lastMovedCards : [];
      return movedCards.some((card: any) => matchesCardTypeDescriptor(card, descriptor));
    }
  }

  {
    const exiledThisWayMatch = normalizedRaw.match(/^(.*?)\s+card\s+(?:was exiled|is exiled|is put into exile)\s+this way$/i);
    if (exiledThisWayMatch) {
      if (lastActionOutcome?.kind === 'impossible') return false;
      if (lastActionOutcome?.stepKind !== 'move_zone' && lastActionOutcome?.stepKind !== 'exile') return null;

      const rawDescriptor = String(exiledThisWayMatch[1] || '').trim().toLowerCase();
      const descriptor = rawDescriptor.replace(/^an?\s+/i, '').trim();
      const movedCards = Array.isArray(lastMovedCards) ? lastMovedCards : [];
      if (!descriptor || rawDescriptor === 'a' || rawDescriptor === 'an') return movedCards.length > 0;
      return movedCards.some((card: any) => matchesCardTypeDescriptor(card, descriptor));
    }
  }

  {
    const milledThisWayMatch = normalizedRaw.match(/^(?:a|an)\s+(.+?)\s+card\s+was\s+milled\s+this\s+way$/i);
    if (milledThisWayMatch) {
      const descriptor = String(milledThisWayMatch[1] || '').trim().toLowerCase();
      const milledCards = Array.isArray(ctx.lastMilledCards) ? ctx.lastMilledCards : [];
      return milledCards.some((card: any) => matchesCardTypeDescriptor(card, descriptor));
    }
  }

  {
    const unlessNotMatch = normalizedRaw.match(/^not \((.+)\)$/i);
    if (unlessNotMatch) {
      const inner = String(unlessNotMatch[1] || '').trim().toLowerCase();
      const manaSpentUnlessMatch = inner.match(/^\{([wubrgcs])\} was spent to cast it$/);
      const satisfied = manaSpentUnlessMatch
        ? (() => {
            const sourceRef = getContextSourceObject(ctx, (idRaw: string) =>
              findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
            );
            const spent = getAmountOfSpecificManaSymbolSpent(sourceRef, manaSpentUnlessMatch[1]);
            return spent === null ? null : spent > 0;
          })()
        : /^you discard (?:a|an) /.test(inner) ||
            /^you exile (?:a|an) card from your graveyard/.test(inner) ||
            /^you exile the top creature card of your graveyard/.test(inner) ||
            /^you return (?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) /.test(inner) ||
            /^you return another creature you control to its owner's hand/.test(inner) ||
            /^you sacrifice (?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) /.test(inner)
          ? true
          : /^you pay \{/.test(inner)
            ? false
            : null;
      if (satisfied === null) return null;
      return !satisfied;
    }
  }

  if (normalizedRaw === 'an opponent controls more lands than you') {
    const battlefield = getProcessedBattlefield(nextState) as any[];
    const countLands = (playerId: string): number =>
      battlefield.filter(
        (perm: any) =>
          String(perm?.controller || '').trim() === playerId && battlefieldObjectHasType(perm, 'land')
      ).length;
    const youLands = countLands(String(controllerId || '').trim());
    const opponentIds = (nextState.players || [])
      .map((player: any) => String(player?.id || '').trim())
      .filter((playerId: string) => playerId && playerId !== String(controllerId || '').trim());
    return opponentIds.some((opponentId: string) => countLands(opponentId) > youLands);
  }

  if (
    normalizedRaw === 'this is the second time this ability has resolved this turn' ||
    normalizedRaw === "it's the second time"
  ) {
    const count = Number(ctx.abilityResolveCountThisTurn);
    return Number.isFinite(count) ? count >= 2 : false;
  }

  if (normalizedRaw === "it's the third time") {
    const count = Number(ctx.abilityResolveCountThisTurn);
    return Number.isFinite(count) ? count >= 3 : false;
  }

  if (
    normalizedRaw === 'a permanent left the battlefield under your control this turn' ||
    normalizedRaw === 'a permanent you controlled left the battlefield this turn'
  ) {
    const map = (nextState as any)?.permanentLeftBattlefieldThisTurn;
    return typeof map?.[controllerId] === 'boolean' ? map[controllerId] : null;
  }

  if (normalizedRaw === 'you attacked this turn') {
    return controllerAttackedThisTurn(nextState, controllerId);
  }

  {
    const attackedWithPowerMatch = normalizedRaw.match(
      /^you attacked this turn with a creature with power (\d+) or greater$/
    );
    if (attackedWithPowerMatch) {
      const threshold = Number.parseInt(String(attackedWithPowerMatch[1] || ''), 10);
      return Number.isFinite(threshold)
        ? controllerAttackedWithPowerAtLeast(nextState, controllerId, threshold)
        : null;
    }
  }

  if (normalizedRaw === 'you control the creature with the greatest power or tied for the greatest power') {
    return controllerControlsGreatestPowerCreature(nextState, controllerId);
  }

  if (
    normalizedRaw === "you didn't put a card into your hand this way" ||
    normalizedRaw === 'you did not put a card into your hand this way'
  ) {
    if (lastActionOutcome?.kind === 'impossible') return true;
    if (
      lastActionOutcome?.stepKind === 'look_choose_from_top' ||
      lastActionOutcome?.stepKind === 'move_zone' ||
      lastActionOutcome?.stepKind === 'search_library'
    ) {
      if (lastActionOutcome.kind === 'applied') {
        const movedCards = Array.isArray(lastMovedCards) ? lastMovedCards : [];
        return movedCards.length === 0;
      }
      if (lastActionOutcome.kind === 'impossible') return true;
      return lastActionOutcome.kind !== 'applied';
    }
    return null;
  }

  if (
    normalizedRaw === 'this creature would die' ||
    normalizedRaw === 'this permanent would die' ||
    normalizedRaw === 'it would die'
  ) {
    return true;
  }

  if (
    normalizedRaw === "it isn't a creature" ||
    normalizedRaw === 'it is not a creature' ||
    normalizedRaw === "this permanent isn't a creature" ||
    normalizedRaw === 'this permanent is not a creature'
  ) {
    const referencedObject = getReferencedConditionalObject(nextState, getProcessedBattlefield(nextState), ctx);
    if (!referencedObject) return null;
    return !battlefieldObjectHasType(referencedObject, 'creature');
  }

  if (normalizedRaw === "it's suspected" || normalizedRaw === 'it is suspected' || normalizedRaw === 'this creature is suspected') {
    const referencedObject = getReferencedConditionalObject(nextState, getProcessedBattlefield(nextState), ctx);
    if (!referencedObject) return null;
    return Boolean(
      (referencedObject as any)?.suspected ??
        (referencedObject as any)?.isSuspected ??
        (referencedObject as any)?.card?.suspected ??
        (referencedObject as any)?.card?.isSuspected
    );
  }

  if (normalizedRaw === 'it was attacking' || normalizedRaw === 'this creature was attacking') {
    const referencedObject = getReferencedConditionalObject(nextState, getProcessedBattlefield(nextState), ctx);
    if (!referencedObject) return null;
    return (
      (referencedObject as any)?.attackedThisTurn === true ||
      Boolean((referencedObject as any)?.attacking) ||
      (referencedObject as any)?.isAttacking === true
    );
  }

  {
    const spellMvMatch = normalizedRaw.match(/^that spell(?:'s)? (?:has )?mana value (?:is )?(\d+) or greater$/);
    if (spellMvMatch) {
      const threshold = Number.parseInt(String(spellMvMatch[1] || ''), 10);
      const manaValue = resolveTargetSpellManaValue(nextState, ctx);
      if (!Number.isFinite(threshold) || manaValue === null) return null;
      return manaValue >= threshold;
    }
  }

  if (normalizedRaw === 'that player has more cards in hand than you') {
    const thatPlayerId = String(
      ctx.selectorContext?.targetOpponentId || ctx.selectorContext?.targetPlayerId || ''
    ).trim();
    if (!thatPlayerId) return null;
    const youPlayer = (nextState.players || []).find(
      (player: any) => String(player?.id || '').trim() === String(controllerId || '').trim()
    ) as any;
    const thatPlayer = (nextState.players || []).find(
      (player: any) => String(player?.id || '').trim() === thatPlayerId
    ) as any;
    const yourHandCount = Array.isArray(youPlayer?.hand) ? youPlayer.hand.length : 0;
    const theirHandCount = Array.isArray(thatPlayer?.hand) ? thatPlayer.hand.length : 0;
    return theirHandCount > yourHandCount;
  }

  {
    const graveyardTypeMatch = normalizedRaw.match(/^there is an? ([a-z0-9' -]+) card in your graveyard$/i);
    if (graveyardTypeMatch) {
      const descriptor = String(graveyardTypeMatch[1] || '').trim().toLowerCase();
      const graveyard = getYourGraveyardCards(nextState, controllerId);
      return graveyard.some((card: any) => matchesCardTypeDescriptor(card, descriptor));
    }
  }

  if (normalizedRaw === 'that creature is legendary' || normalizedRaw === 'that permanent is legendary') {
    const referencedObject = getReferencedConditionalObject(nextState, getProcessedBattlefield(nextState), ctx);
    if (!referencedObject) return null;
    return (
      battlefieldObjectHasType(referencedObject, 'legendary') ||
      matchesTypeLine(getExecutorTypeLineLower(referencedObject), 'legendary')
    );
  }

  if (normalizedRaw === 'you controlled it') {
    const referencedObject = getReferencedConditionalObject(nextState, getProcessedBattlefield(nextState), ctx);
    if (!referencedObject) return true;
    return String((referencedObject as any)?.controller || '').trim() === String(controllerId || '').trim();
  }

  if (normalizedRaw === 'a creature an opponent controls would die') {
    return true;
  }

  if (normalizedRaw === "each opponent who didn't discard a nonland card this way") {
    if (lastActionOutcome?.kind === 'impossible') return false;
    if (lastActionOutcome?.stepKind === 'discard' && lastActionOutcome.kind === 'applied') return true;
    return true;
  }

  if (
    normalizedRaw === 'a card or token would be put into your graveyard from anywhere' ||
    normalizedRaw === 'a spell cast this way would be put into a graveyard'
  ) {
    return true;
  }

  if (normalizedRaw === 'this is the first time this ability has resolved this turn') {
    const count = Number(ctx.abilityResolveCountThisTurn);
    return Number.isFinite(count) ? count >= 1 : true;
  }

  if (normalizedRaw === 'they guessed wrong') {
    const guessCorrect = (ctx as { readonly lastGuessCorrect?: boolean }).lastGuessCorrect;
    return typeof guessCorrect === 'boolean' ? !guessCorrect : false;
  }

  if (normalizedRaw === 'you control that creature' || normalizedRaw === 'you control that permanent') {
    const referencedObject = getReferencedConditionalObject(nextState, getProcessedBattlefield(nextState), ctx);
    if (!referencedObject) return null;
    return String((referencedObject as any)?.controller || '').trim() === String(controllerId || '').trim();
  }

  if (
    normalizedRaw === 'that creature would die this turn' ||
    normalizedRaw === 'that permanent would die this turn'
  ) {
    return true;
  }

  if (normalizedRaw === 'that spell is countered this way') {
    if (lastActionOutcome?.kind === 'impossible') return false;
    if (lastActionOutcome?.stepKind === 'counter_spell' && lastActionOutcome.kind === 'applied') return true;
    if (lastActionOutcome?.stepKind === 'counter_spell') return false;
    return null;
  }

  if (normalizedRaw === 'you have a full party') {
    return controllerHasFullParty(nextState, controllerId);
  }

  {
    const poisonMatch = normalizedRaw.match(/^an opponent has (three|[a-z0-9]+) or more poison counters$/);
    if (poisonMatch) {
      const threshold = parseSmallNumberWord(String(poisonMatch[1] || '').trim());
      if (threshold === null) return null;
      const opponentIds = (nextState.players || [])
        .map((player: any) => String(player?.id || '').trim())
        .filter((playerId: string) => playerId && playerId !== String(controllerId || '').trim());
      return opponentIds.some((opponentId: string) => getPlayerPoisonCounters(nextState, opponentId) >= threshold);
    }
  }

  if (
    normalizedRaw === 'a nonland permanent left the battlefield this turn or a spell was warped this turn'
  ) {
    const leftMap = (nextState as any)?.permanentLeftBattlefieldThisTurn;
    const leftBattlefield =
      typeof leftMap?.[controllerId] === 'boolean' ? leftMap[controllerId] : false;
    const warpedMap = (nextState as any)?.spellWarpedThisTurn;
    const warped =
      typeof warpedMap?.[controllerId] === 'boolean'
        ? warpedMap[controllerId]
        : Boolean((nextState as any)?.spellWarpedThisTurn);
    return leftBattlefield || warped;
  }

  {
    const genericCounterThresholdMatch = normalizedRaw.match(
      /^it has (three|[a-z0-9]+) or more ([a-z0-9/+ -]+) counters on it$/i
    );
    if (genericCounterThresholdMatch) {
      const threshold = parseSmallNumberWord(String(genericCounterThresholdMatch[1] || '').trim());
      const counterName = String(genericCounterThresholdMatch[2] || '').trim().toLowerCase();
      if (threshold !== null && counterName) {
        const referencedObject = getReferencedConditionalObject(nextState, getProcessedBattlefield(nextState), ctx);
        if (!referencedObject) return null;
        const counters = ((referencedObject as any)?.counters || {}) as Record<string, unknown>;
        const count = Number(counters[counterName] ?? 0);
        return (Number.isFinite(count) ? count : 0) >= threshold;
      }
    }
  }

  const sourceRefForEarlyChecks = getContextSourceObject(ctx, (idRaw: string) =>
    findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
  );

  if (normalizedRaw === 'it was kicked' || normalizedRaw === 'this spell was kicked') {
    const kicked = resolveKickedStatus(nextState, ctx, sourceRefForEarlyChecks);
    return kicked === null ? null : kicked;
  }

  const andParts = splitCompositeCondition(normalizedRaw, 'and');
  if (andParts) {
    const results = andParts.map(part =>
      evaluateConditionalWrapperCondition({
        ...params,
        condition: { ...condition, raw: part },
      })
    );
    return results.every(result => result === true)
      ? true
      : results.some(result => result === false)
        ? false
        : null;
  }

  const orParts = splitCompositeCondition(normalizedRaw, 'or');
  if (orParts) {
    const results = orParts.map(part =>
      evaluateConditionalWrapperCondition({
        ...params,
        condition: { ...condition, raw: part },
      })
    );
    return results.some(result => result === true)
      ? true
      : results.every(result => result === false)
        ? false
        : null;
  }

  {
    const youDoNotControlMatch = normalizedRaw.match(/^you (?:don't|do not) control (?:a|an|one or more)\s+(.+)$/i);
    if (youDoNotControlMatch) {
      const descriptor = String(youDoNotControlMatch[1] || '').trim();
      const battlefield = getProcessedBattlefield(nextState) as any[];
      return !battlefield.some(
        (perm: any) =>
          String(perm?.controller || '').trim() === controllerId &&
          battlefieldObjectMatchesDescriptor(perm, descriptor)
      );
    }
  }

  if (
    /^you (?:don't|do not)\b/i.test(normalizedRaw) ||
    /^they (?:don't|do not)\b/i.test(normalizedRaw) ||
    /^the player (?:doesn't|does not)\b/i.test(normalizedRaw) ||
    /^that player (?:doesn't|does not)\b/i.test(normalizedRaw) ||
    /^a player (?:doesn't|does not)\b/i.test(normalizedRaw) ||
    /^each opponent who (?:doesn't|does not)\b/i.test(normalizedRaw) ||
    /^the player can't\b/i.test(normalizedRaw) ||
    normalizedRaw === "it doesn't" ||
    normalizedRaw === 'it does not'
  ) {
    if (lastActionOutcome?.kind === 'impossible') return true;
    if (lastActionOutcome?.kind === 'applied') return false;
    if (lastActionOutcome) return true;
    if (normalizedRaw === "you don't" || normalizedRaw === 'you do not') return true;
    return null;
  }

  if (
    normalizedRaw === 'you do' ||
    normalizedRaw === 'the player does' ||
    normalizedRaw === 'a player does' ||
    normalizedRaw === 'they do' ||
    normalizedRaw === 'that player does'
  ) {
    const antecedent = getAffirmativeAntecedentOutcome();
    if (antecedent?.kind === 'applied' && antecedent.stepKind === 'tap_matching_permanents') {
      const count = Number(antecedent.count ?? 0);
      return Number.isFinite(count) ? count > 0 : true;
    }
    if (antecedent?.kind === 'applied') return true;
    if (antecedent) return false;
    return null;
  }

  if (
    normalizedRaw === 'you search your library this way' ||
    normalizedRaw === 'they search their library this way' ||
    normalizedRaw === 'that player searches their library this way' ||
    normalizedRaw === 'an opponent searches their library this way' ||
    normalizedRaw === 'you searched your library this way'
  ) {
    if (ctx.searchedLibraryThisWay === true) return true;
    const antecedent = getAffirmativeAntecedentOutcome();
    if (antecedent?.stepKind === 'search_library' && antecedent.kind === 'applied') return true;
    if (antecedent?.stepKind === 'search_library' || ctx.searchedLibraryThisWay === false) return false;
    return null;
  }

  if (
    normalizedRaw === 'that spell would be put into a graveyard' ||
    normalizedRaw === 'that spell would be put into a graveyard from anywhere' ||
    normalizedRaw === 'it would be put into a graveyard' ||
    normalizedRaw === 'this spell would be put into a graveyard'
  ) {
    const antecedent = getAffirmativeAntecedentOutcome();
    if (
      antecedent?.kind === 'applied' &&
      (antecedent.stepKind === 'grant_graveyard_permission' ||
        antecedent.stepKind === 'cast_spell' ||
        antecedent.stepKind === 'copy_spell')
    ) {
      return true;
    }
    if (antecedent) return false;
    return null;
  }

  if (
    normalizedRaw === 'this permanent would be put into a graveyard from anywhere' ||
    normalizedRaw === 'this creature would be put into a graveyard from anywhere'
  ) {
    return true;
  }

  if (normalizedRaw === "you can't" || normalizedRaw === 'you cannot') {
    if (lastActionOutcome?.kind === 'impossible') return true;
    if (lastActionOutcome?.kind === 'applied' || lastActionOutcome?.kind === 'choice_required') return false;
    return null;
  }

  if (normalizedRaw === 'a creature died this turn') {
    return Boolean((nextState as any)?.creatureDiedThisTurn);
  }

  if (normalizedRaw === 'you gained life this turn') {
    return Number(((nextState as any)?.lifeGainedThisTurn || {})?.[controllerId] || 0) > 0;
  }

  if (normalizedRaw === 'evidence was collected') {
    return typeof ctx.lastCollectedEvidence === 'boolean' ? ctx.lastCollectedEvidence : null;
  }

  if (
    normalizedRaw === 'defending player has the most life or is tied for the most life' ||
    normalizedRaw === 'the defending player has the most life or is tied for the most life'
  ) {
    const defendingPlayerId = String(
      ctx.selectorContext?.targetOpponentId || ctx.selectorContext?.targetPlayerId || ''
    ).trim();
    if (!defendingPlayerId) return null;

    const lifeTotals = ((nextState as any)?.players || [])
      .map((player: any) => Number(player?.life))
      .filter((life: number) => Number.isFinite(life));
    if (lifeTotals.length === 0) return null;

    const defendingPlayer = ((nextState as any)?.players || []).find(
      (player: any) => String(player?.id || '').trim() === defendingPlayerId
    );
    const defendingLife = Number((defendingPlayer as any)?.life);
    if (!Number.isFinite(defendingLife)) return null;

    return defendingLife === Math.max(...lifeTotals);
  }

  if (
    normalizedRaw === "this creature isn't renowned" ||
    normalizedRaw === "this permanent isn't renowned" ||
    normalizedRaw === "it isn't renowned" ||
    normalizedRaw === "this creature is not renowned" ||
    normalizedRaw === "this permanent is not renowned" ||
    normalizedRaw === "it is not renowned"
  ) {
    const battlefield = getProcessedBattlefield(nextState);
    const referencedObject = getReferencedConditionalObject(nextState, battlefield, ctx);
    if (!referencedObject) return null;
    const isRenowned =
      typeof (referencedObject as any)?.isRenowned === 'boolean'
        ? Boolean((referencedObject as any).isRenowned)
        : typeof (referencedObject as any)?.renowned === 'boolean'
          ? Boolean((referencedObject as any).renowned)
          : false;
    return !isRenowned;
  }

  {
    const youControlMatch = normalizedRaw.match(/^you control (?:a|an|one or more)\s+(.+)$/i);
    if (youControlMatch) {
      const descriptor = String(youControlMatch[1] || '').trim();
      const battlefield = getProcessedBattlefield(nextState) as any[];
      return battlefield.some(
        (perm: any) =>
          String(perm?.controller || '').trim() === controllerId &&
          battlefieldObjectMatchesDescriptor(perm, descriptor)
      );
    }
  }

  {
    const gainedLifeThresholdMatch = normalizedRaw.match(/^you gained ([a-z0-9]+) or more life this turn$/i);
    if (gainedLifeThresholdMatch) {
      const threshold = parseSmallNumberWord(String(gainedLifeThresholdMatch[1] || ''));
      if (threshold !== null) {
        return Number(((nextState as any)?.lifeGainedThisTurn || {})?.[controllerId] || 0) >= threshold;
      }
    }
  }

  if (normalizedRaw === "you're the monarch" || normalizedRaw === 'you are the monarch') {
    return String((nextState as any)?.monarch || '').trim() === String(controllerId || '').trim();
  }

  if (
    normalizedRaw === 'you have the initiative' ||
    normalizedRaw === "you've got the initiative"
  ) {
    return String((nextState as any)?.initiative || '').trim() === String(controllerId || '').trim();
  }

  if (
    normalizedRaw === 'you completed a dungeon this turn' ||
    normalizedRaw === "you've completed a dungeon this turn" ||
    normalizedRaw === 'you have completed a dungeon this turn'
  ) {
    return Boolean(((nextState as any)?.dungeonCompletedThisTurn || {})?.[controllerId]);
  }

  if (
    normalizedRaw === 'you completed a dungeon' ||
    normalizedRaw === "you've completed a dungeon" ||
    normalizedRaw === 'you have completed a dungeon'
  ) {
    return Boolean(((nextState as any)?.dungeonCompleted || {})?.[controllerId]);
  }

  if (normalizedRaw === 'the gift was promised') {
    return typeof ctx.giftPromised === 'boolean' ? ctx.giftPromised : null;
  }

  if (normalizedRaw === "it's your turn" || normalizedRaw === 'it is your turn' || normalizedRaw === 'your turn') {
    return String((nextState as any)?.turnPlayer || '').trim() === String(controllerId || '').trim();
  }

  const battlefield = getProcessedBattlefield(nextState);

  {
    const noCountersMatch = normalizedRaw.match(
      /^(?:there are no|it has no|this creature has no|this permanent has no)\s+(.+?)\s+counters?\s+on\s+it$/i
    );
    if (noCountersMatch) {
      const referencedObject = getReferencedConditionalObject(nextState, battlefield, ctx);
      if (!referencedObject) return null;
      const counterName = String(noCountersMatch[1] || '').trim().toLowerCase();
      if (!counterName) return null;
      const counters = ((referencedObject as any)?.counters || {}) as Record<string, unknown>;
      const count = Number(counters[counterName] ?? 0);
      return (Number.isFinite(count) ? count : 0) === 0;
    }
  }

  {
    const thatLandIsTypeMatch = normalizedRaw.match(/^that land is (?:a|an) ([a-z0-9' -]+)$/i);
    if (thatLandIsTypeMatch) {
      const typeName = String(thatLandIsTypeMatch[1] || '').trim().toLowerCase();
      const chosenObjectId = getSingleChosenObjectId(ctx);
      if (!typeName || !chosenObjectId) return null;
      const referencedLand = battlefield.find(
        (perm: any) => String(perm?.id || '').trim() === chosenObjectId
      );
      return referencedLand ? battlefieldObjectHasType(referencedLand, typeName) : false;
    }
  }

  {
    const contextualCardTypeMatch = normalizedRaw.match(
      /^(?:it(?:'s| is)?|that card|that creature|that permanent|this card|this permanent) (?:is )?(?:a|an) ([a-z0-9' -]+?)(?: card)?$/i
    );
    if (contextualCardTypeMatch) {
      const typeName = String(contextualCardTypeMatch[1] || '').trim().toLowerCase();
      const referencedId =
        String(ctx.targetPermanentId || '').trim() ||
        getSingleChosenObjectId(ctx) ||
        String(ctx.sourceId || '').trim();
      if (typeName && referencedId) {
        const referencedObject = findObjectByIdInState(nextState, battlefield as any, referencedId);
        if (!referencedObject) return false;

        const battlefieldObject = battlefield.find(
          (perm: any) => String(perm?.id || '').trim() === referencedId
        );
        return battlefieldObject
          ? battlefieldObjectHasType(battlefieldObject, typeName)
          : cardHasType(referencedObject, typeName);
      }
    }
  }

  {
    const youControlCountMatch = raw.match(/^you control ([a-z0-9]+) or more ([a-z0-9' -]+?)(?:s)?$/i);
    if (youControlCountMatch) {
      const threshold = parseSmallNumberWord(String(youControlCountMatch[1] || ''));
      const typeName = String(youControlCountMatch[2] || '').trim().toLowerCase();
      if (threshold !== null && typeName) {
        const count = battlefield.filter((perm: any) =>
          String(perm?.controller || '').trim() === String(controllerId || '').trim() &&
          battlefieldObjectHasType(perm, typeName)
        ).length;
        return count >= threshold;
      }
    }
  }

  {
    const youControlSingleMatch = raw.match(/^you control (?:a|an) ([a-z0-9' -]+)$/i);
    if (youControlSingleMatch) {
      const typeName = String(youControlSingleMatch[1] || '').trim().toLowerCase();
      if (typeName) {
        return countControlledBattlefieldObjectsMatching({
          battlefield,
          controllerId,
          typeNames: [typeName],
        }) >= 1;
      }
    }
  }

  {
    const tappedMixedTypeMatch = raw.match(
      /^you control ([a-z0-9]+) or more tapped ([a-z0-9' -]+?)s? and\/or ([a-z0-9' -]+?)s?$/i
    );
    if (tappedMixedTypeMatch) {
      const threshold = parseSmallNumberWord(String(tappedMixedTypeMatch[1] || ''));
      const firstType = String(tappedMixedTypeMatch[2] || '').trim().toLowerCase();
      const secondType = String(tappedMixedTypeMatch[3] || '').trim().toLowerCase();
      if (threshold !== null && firstType && secondType) {
        return countControlledBattlefieldObjectsMatching({
          battlefield,
          controllerId,
          typeNames: [firstType, secondType],
          tappedOnly: true,
        }) >= threshold;
      }
    }
  }

  {
    const graveyardCountMatch = raw.match(/^([a-z0-9]+) or more ([a-z0-9' -]+?) cards are in your graveyard$/i);
    if (graveyardCountMatch) {
      const threshold = parseSmallNumberWord(String(graveyardCountMatch[1] || ''));
      const typeName = String(graveyardCountMatch[2] || '').trim().toLowerCase();
      if (threshold !== null && typeName) {
        const count = countYourGraveyardCards({
          nextState,
          controllerId,
          typeName,
          pendingSteps,
          lastMovedCards,
        });
        return count >= threshold;
      }
    }
  }

  {
    const thereAreGraveyardCountMatch = raw.match(/^there are ([a-z0-9]+) or more(?: ([a-z0-9' -]+?))? cards in your graveyard$/i);
    if (thereAreGraveyardCountMatch) {
      const threshold = parseSmallNumberWord(String(thereAreGraveyardCountMatch[1] || ''));
      const typeName = String(thereAreGraveyardCountMatch[2] || '').trim().toLowerCase();
      if (threshold !== null) {
        const count = countYourGraveyardCards({
          nextState,
          controllerId,
          typeName,
          pendingSteps,
          lastMovedCards,
        });
        return count >= threshold;
      }
    }
  }

  {
    const youHaveGraveyardCountMatch = raw.match(/^you have ([a-z0-9]+) or more ([a-z0-9' -]+?) cards in your graveyard$/i);
    if (youHaveGraveyardCountMatch) {
      const threshold = parseSmallNumberWord(String(youHaveGraveyardCountMatch[1] || ''));
      const typeName = String(youHaveGraveyardCountMatch[2] || '').trim().toLowerCase();
      if (threshold !== null && typeName) {
        const count = countYourGraveyardCards({
          nextState,
          controllerId,
          typeName,
          pendingSteps,
          lastMovedCards,
        });
        return count >= threshold;
      }
    }
  }

  {
    const namedInYourGraveyardMatch = normalizedRaw.match(/^([a-z0-9][a-z0-9,' -]*) is in your graveyard$/i);
    if (namedInYourGraveyardMatch) {
      const expectedName = String(namedInYourGraveyardMatch[1] || '').trim().toLowerCase();
      if (expectedName === 'this card' || expectedName === 'this permanent' || expectedName === 'it') {
        // Let the dedicated self-reference branch below handle these.
      } else {
      const player = (nextState.players || []).find((p: any) => String(p?.id || '').trim() === String(controllerId || '').trim()) as any;
      if (expectedName && player) {
        return (Array.isArray(player?.graveyard) ? player.graveyard : []).some((card: any) =>
          String(card?.name || '').trim().toLowerCase() === expectedName
        );
      }
      }
    }
  }

  if (normalizedRaw === 'this card is in your graveyard' || normalizedRaw === 'this permanent is in your graveyard' || normalizedRaw === 'it is in your graveyard') {
    const player = (nextState.players || []).find((p: any) => String(p?.id || '').trim() === String(controllerId || '').trim()) as any;
    const sourceId = String(ctx.sourceId || '').trim();
    const sourceName = String(ctx.sourceName || '').trim().toLowerCase();
    if (!player) return null;
    return (Array.isArray(player?.graveyard) ? player.graveyard : []).some((card: any) =>
      (sourceId && String(card?.id || '').trim() === sourceId) ||
      (sourceName && String(card?.name || '').trim().toLowerCase() === sourceName)
    );
  }

  if (
    normalizedRaw === 'it was cast from your graveyard' ||
    normalizedRaw === 'it was cast from a graveyard' ||
    normalizedRaw === 'you cast it from your graveyard' ||
    normalizedRaw === 'this spell was cast from your graveyard' ||
    normalizedRaw === 'this spell was cast from a graveyard' ||
    normalizedRaw === 'it entered from your graveyard'
  ) {
    const referencedObject = getReferencedConditionalObject(nextState, battlefield, ctx);
    const provenance = referencedObject
      ? getConditionalObjectZoneProvenance(referencedObject)
      : {
          castFromZone: String(ctx.castFromZone || '').trim().toLowerCase() || undefined,
          enteredFromZone: String(ctx.enteredFromZone || '').trim().toLowerCase() || undefined,
        };
    if (normalizedRaw === 'it entered from your graveyard') {
      return provenance.enteredFromZone === 'graveyard';
    }
    return provenance.castFromZone === 'graveyard';
  }

  if (normalizedRaw === 'it escaped' || normalizedRaw === 'this permanent escaped') {
    const referencedObject = getReferencedConditionalObject(nextState, battlefield, ctx);
    const provenance = referencedObject
      ? getConditionalObjectZoneProvenance(referencedObject)
      : {
          castFromZone: String(ctx.castFromZone || '').trim().toLowerCase() || undefined,
          enteredFromZone: String(ctx.enteredFromZone || '').trim().toLowerCase() || undefined,
        };
    return provenance.castFromZone === 'graveyard';
  }

  if (
    normalizedRaw === "it didn't escape" ||
    normalizedRaw === 'it did not escape' ||
    normalizedRaw === "this permanent didn't escape" ||
    normalizedRaw === 'this permanent did not escape'
  ) {
    const referencedObject = getReferencedConditionalObject(nextState, battlefield, ctx);
    const provenance = referencedObject
      ? getConditionalObjectZoneProvenance(referencedObject)
      : {
          castFromZone: String(ctx.castFromZone || '').trim().toLowerCase() || undefined,
          enteredFromZone: String(ctx.enteredFromZone || '').trim().toLowerCase() || undefined,
        };
    return provenance.castFromZone !== 'graveyard';
  }

  {
    const hadNoCountersMatch = normalizedRaw.match(/^it had no ([+-]1\/[+-]1) counters on it$/i);
    if (hadNoCountersMatch) {
      const counterName = String(hadNoCountersMatch[1] || '').trim();
      const referencedObject = getReferencedConditionalObject(nextState, battlefield, ctx);
      if (!referencedObject) return null;
      const counters = ((referencedObject as any)?.counters || {}) as Record<string, unknown>;
      const count = Number(counters[counterName] ?? 0);
      return (Number.isFinite(count) ? count : 0) === 0;
    }
  }

  {
    const hasCountersThresholdMatch = normalizedRaw.match(
      /^it has (three|[a-z0-9]+) or more ([+-]1\/[+-]1) counters on it$/i
    );
    if (hasCountersThresholdMatch) {
      const threshold = parseSmallNumberWord(String(hasCountersThresholdMatch[1] || '').trim());
      const counterName = String(hasCountersThresholdMatch[2] || '').trim();
      if (threshold !== null && counterName) {
        const referencedObject = getReferencedConditionalObject(nextState, battlefield, ctx);
        if (!referencedObject) return null;
        const counters = ((referencedObject as any)?.counters || {}) as Record<string, unknown>;
        const count = Number(counters[counterName] ?? 0);
        return (Number.isFinite(count) ? count : 0) >= threshold;
      }
    }
  }

  const generic = evaluateModifyPtCondition(nextState, controllerId, condition.raw);
  if (generic !== null) return generic;

  const sourceRef = getContextSourceObject(ctx, (idRaw: string) => findObjectByIdInState(nextState, battlefield, idRaw));

  {
    const manaSpentMatch = raw.match(/^([a-z0-9]+)\s+or\s+more\s+mana\s+was\s+spent\s+to\s+cast\s+that\s+spell$/i);
    if (manaSpentMatch) {
      const threshold = parseSmallNumberWord(String(manaSpentMatch[1] || ''));
      if (threshold === null) return null;
      const spent = getAmountOfManaSpent(sourceRef);
      if (spent === null) return null;
      return spent >= threshold;
    }
  }

  if (normalizedRaw === 'you win the flip') {
    return typeof ctx.wonCoinFlip === 'boolean' ? ctx.wonCoinFlip : null;
  }

  if (normalizedRaw === 'you lose the flip') {
    return typeof ctx.wonCoinFlip === 'boolean' ? !ctx.wonCoinFlip : false;
  }

  if (
    normalizedRaw === 'you win' ||
    normalizedRaw === 'you won' ||
    normalizedRaw === 'you win the clash' ||
    normalizedRaw === 'you won the clash'
  ) {
    return typeof ctx.lastClashWon === 'boolean' ? ctx.lastClashWon : null;
  }

  if (
    normalizedRaw === "it's on the battlefield" ||
    normalizedRaw === 'it is on the battlefield' ||
    normalizedRaw === 'this permanent is on the battlefield'
  ) {
    if (sourceRef) return true;
    const sourceName = String(ctx.sourceName || '').trim().toLowerCase();
    if (!sourceName) return null;
    return battlefield.some((perm: any) => String(perm?.name || perm?.card?.name || '').trim().toLowerCase() === sourceName);
  }

  {
    const namedOnBattlefieldMatch = normalizedRaw.match(/^([a-z0-9][a-z0-9,' -]*) is on the battlefield$/i);
    if (namedOnBattlefieldMatch) {
      const expectedName = String(namedOnBattlefieldMatch[1] || '').trim().toLowerCase();
      if (expectedName) {
        return battlefield.some((perm: any) => String(perm?.name || perm?.card?.name || '').trim().toLowerCase() === expectedName);
      }
    }
  }

  if (
    normalizedRaw === "it's tapped" ||
    normalizedRaw === 'it is tapped' ||
    normalizedRaw === 'this permanent is tapped' ||
    normalizedRaw === 'this creature is tapped'
  ) {
    return sourceRef ? Boolean((sourceRef as any)?.tapped) : null;
  }

  {
    const namedTappedMatch = normalizedRaw.match(/^([a-z0-9][a-z0-9,' -]*) is tapped$/i);
    if (namedTappedMatch) {
      const expectedName = String(namedTappedMatch[1] || '').trim().toLowerCase();
      const match = battlefield.find((perm: any) =>
        String(perm?.name || perm?.card?.name || '').trim().toLowerCase() === expectedName
      ) as any;
      return match ? Boolean(match.tapped) : false;
    }
  }

  {
    const voteWinnerMatch = normalizedRaw.match(/^([a-z0-9][a-z0-9' -]*) gets more votes$/i);
    if (voteWinnerMatch) {
      const expected = String(voteWinnerMatch[1] || '').trim().toLowerCase();
      const winningVoteChoice = deriveWinningVoteChoice(ctx);
      const actual = winningVoteChoice === null ? '' : String(winningVoteChoice || '').trim().toLowerCase();
      if (!expected || !actual) return null;
      return actual === expected;
    }
  }

  if (normalizedRaw === 'the vote is tied' || normalizedRaw === 'vote is tied') {
    const winningVoteChoice = deriveWinningVoteChoice(ctx);
    return winningVoteChoice === null ? true : typeof winningVoteChoice === 'undefined' ? null : false;
  }

  {
    const topCardTypePrefixMatch = normalizedRaw.match(/^(it(?:'s| is)|that card is)\s+(.+)$/i);
    if (topCardTypePrefixMatch) {
      const normalizedTypeText = String(topCardTypePrefixMatch[2] || '')
        .trim()
        .replace(/^an?\s+/i, '')
        .replace(/\s+card$/i, '')
        .trim();
      const parsedType = parseSimpleCardTypeFromText(normalizedTypeText);
      if (parsedType) {
        const libraryOwnerId = String(ctx.lastTopLibraryOwnerId || controllerId || '').trim();
        const player = (nextState.players || []).find((p: any) => String(p?.id || '').trim() === libraryOwnerId) as any;
        const topCard = Array.isArray(player?.library) && player.library.length > 0 ? player.library[0] : null;
        if (!topCard) return null;
        return cardMatchesType(topCard, parsedType);
      }
    }
  }

  if (
    normalizedRaw === 'it shares a creature type with this creature' ||
    normalizedRaw === 'that card shares a creature type with this creature' ||
    normalizedRaw === 'it shares a creature type with this permanent' ||
    normalizedRaw === 'that card shares a creature type with this permanent'
  ) {
    const libraryOwnerId = String(ctx.lastTopLibraryOwnerId || controllerId || '').trim();
    if (!libraryOwnerId) return null;
    return topCardSharesCreatureTypeWithSource(nextState, libraryOwnerId, sourceRef);
  }

  if (!sourceRef) return null;

  if (normalizedRaw === 'that card has the chosen name') {
    const chosenName = String(
      ctx.selectorContext?.chosenCardName || (sourceRef as any)?.chosenCardName || (sourceRef as any)?.card?.chosenCardName || ''
    ).trim();
    if (!chosenName) return null;

    const libraryOwnerId = String(ctx.lastTopLibraryOwnerId || controllerId || '').trim();
    const player = (nextState.players || []).find((p: any) => String(p?.id || '').trim() === libraryOwnerId) as any;
    const topCard = Array.isArray(player?.library) && player.library.length > 0 ? player.library[0] : null;
    if (!topCard) return null;

    const normalizedChosenName = chosenName.toLowerCase();
    const topCardNames = new Set<string>();
    const pushName = (value: unknown) => {
      const normalized = String(value || '').trim().toLowerCase();
      if (normalized) topCardNames.add(normalized);
    };
    pushName((topCard as any)?.name);
    for (const face of Array.isArray((topCard as any)?.card_faces) ? (topCard as any).card_faces : []) {
      pushName((face as any)?.name);
    }
    if (topCardNames.has(normalizedChosenName)) return true;

    const leftName = String((topCard as any)?.leftHalf?.name || '').trim();
    const rightName = String((topCard as any)?.rightHalf?.name || '').trim();
    if (leftName && rightName) {
      try {
        return splitCardMatchesName(
          {
            type: 'split-card',
            leftHalf: {
              name: leftName,
              manaCost: '',
              types: [],
              subtypes: [],
              supertypes: [],
              text: '',
              power: null,
              toughness: null,
              loyalty: null,
              colors: [],
            },
            rightHalf: {
              name: rightName,
              manaCost: '',
              types: [],
              subtypes: [],
              supertypes: [],
              text: '',
              power: null,
              toughness: null,
              loyalty: null,
              colors: [],
            },
            hasSharedTypeLine: false,
          },
          chosenName
        );
      } catch {
        return null;
      }
    }
    return false;
  }

  if (raw === 'all five types on this permanent have counters over them') {
    const counters = ((sourceRef as any)?.counters || (sourceRef as any)?.card?.counters || {}) as Record<string, unknown>;
    const requiredKeys = ['artifact', 'creature', 'enchantment', 'instant', 'sorcery'];
    return requiredKeys.every(key => Number((counters as any)[key]) > 0);
  }

  if (
    raw === "the result is equal to this vehicle's mana value" ||
    raw === "the result is equal to this permanent's mana value"
  ) {
    const rolled = Number((nextState as any)?.lastDieRollByPlayer?.[controllerId]);
    if (!Number.isFinite(rolled)) return null;
    const manaValue = getCardManaValue((sourceRef as any)?.card || sourceRef);
    if (manaValue === null) return null;
    return rolled === manaValue;
  }

  return null;
}

export function resolveConditionalReferenceAmount(params: {
  condition: ConditionalCondition;
  nextState: GameState;
  ctx: OracleIRExecutionContext;
}): number | null {
  const { condition, nextState, ctx } = params;
  if (condition.kind !== 'if' && condition.kind !== 'as_long_as') return null;

  const battlefield = getProcessedBattlefield(nextState);
  const sourceRef = getContextSourceObject(ctx, (idRaw: string) => findObjectByIdInState(nextState, battlefield, idRaw));
  if (!sourceRef) return null;

  const raw = String(condition.raw || '').trim().toLowerCase();
  if (
    raw === "the result is equal to this vehicle's mana value" ||
    raw === "the result is equal to this permanent's mana value"
  ) {
    const controllerId = String(ctx.controllerId || '').trim();
    const rolled = Number((nextState as any)?.lastDieRollByPlayer?.[controllerId]);
    return Number.isFinite(rolled) ? rolled : null;
  }

  const manaSpentMatch = raw.match(/^([a-z0-9]+)\s+or\s+more\s+mana\s+was\s+spent\s+to\s+cast\s+that\s+spell$/i);
  if (!manaSpentMatch) return null;

  return getAmountOfManaSpent(sourceRef);
}

export function applyConditionalReferenceAmount(step: OracleEffectStep, resolvedAmount: number | null): OracleEffectStep {
  if (resolvedAmount === null || !('amount' in (step as any))) return step;

  const amount = (step as any).amount;
  const raw = String(amount?.raw || '').trim().toLowerCase();
  if (amount?.kind !== 'unknown' || raw !== 'that much') return step;

  return {
    ...(step as any),
    amount: { kind: 'number', value: Math.max(0, resolvedAmount) },
  } as OracleEffectStep;
}
