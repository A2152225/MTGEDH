import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { getContextSourceObject } from './oracleIRExecutorContextRefUtils';
import { getAmountOfManaSpent } from './oracleIRExecutorManaUtils';
import { evaluateModifyPtCondition } from './oracleIRExecutorModifyPtCondition';
import { findObjectByIdInState } from './oracleIRExecutorModifyPtWhereUtils';
import { getProcessedBattlefield } from './oracleIRExecutorCreatureStepUtils';
import { getCardManaValue } from './oracleIRExecutorPlayerUtils';
import { splitCardMatchesName } from './splitCards';

type ConditionalCondition = Extract<OracleEffectStep, { kind: 'conditional' }>['condition'];

type LastActionOutcome = {
  readonly kind: 'applied' | 'choice_required' | 'impossible' | 'unsupported';
  readonly stepKind: OracleEffectStep['kind'];
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
  return (
    matchesTypeLine(object?.type_line, typeName) ||
    matchesTypeLine(object?.cardType, typeName) ||
    matchesTypeLine(object?.card?.type_line, typeName) ||
    matchesTypeLine(object?.card?.cardType, typeName)
  );
}

function cardHasType(card: any, typeName: string): boolean {
  return matchesTypeLine(card?.type_line, typeName) || matchesTypeLine(card?.cardType, typeName);
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

export function evaluateConditionalWrapperCondition(params: {
  condition: ConditionalCondition;
  nextState: GameState;
  controllerId: PlayerID;
  ctx: OracleIRExecutionContext;
  lastActionOutcome: LastActionOutcome;
  pendingSteps?: readonly OracleEffectStep[];
  lastMovedCards?: readonly any[];
}): boolean | null {
  const { condition, nextState, controllerId, ctx, lastActionOutcome, pendingSteps, lastMovedCards } = params;
  if (condition.kind !== 'if' && condition.kind !== 'as_long_as') return null;

  const raw = String(condition.raw || '').trim().toLowerCase();
  const normalizedRaw = raw.replace(/\u2019/g, "'").replace(/\s+/g, ' ').trim();
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

  if (/^you (?:don't|do not)\b/i.test(normalizedRaw)) {
    if (lastActionOutcome?.kind === 'impossible') return true;
    if (lastActionOutcome?.kind === 'applied') return false;
    return null;
  }

  if (normalizedRaw === 'you do') {
    if (lastActionOutcome?.kind === 'applied') return true;
    if (lastActionOutcome?.kind === 'impossible' || lastActionOutcome?.kind === 'choice_required') return false;
    return null;
  }

  {
    const exiledThisWayMatch = normalizedRaw.match(
      /^a(?:(n)\s+)?(?:(?<type>[a-z0-9' -]+?)\s+)?card\s+(?:was exiled|is put into exile)\s+this way$/i
    );
    if (exiledThisWayMatch) {
      if (lastActionOutcome?.kind === 'impossible') return false;
      if (lastActionOutcome?.stepKind !== 'move_zone') return null;

      const typeName = String((exiledThisWayMatch.groups as any)?.type || '').trim().toLowerCase();
      const movedCards = Array.isArray(lastMovedCards) ? lastMovedCards : [];
      if (!typeName) return movedCards.length > 0;
      if (typeName.startsWith('non') && typeName.length > 3) {
        const positiveType = typeName.slice(3).trim();
        return positiveType ? movedCards.some((card: any) => !cardHasType(card, positiveType)) : null;
      }
      return movedCards.some((card: any) => cardHasType(card, typeName));
    }
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

  if (normalizedRaw === 'the gift was promised') {
    return typeof ctx.giftPromised === 'boolean' ? ctx.giftPromised : null;
  }

  if (normalizedRaw === "it's your turn" || normalizedRaw === 'it is your turn' || normalizedRaw === 'your turn') {
    return String((nextState as any)?.turnPlayer || '').trim() === String(controllerId || '').trim();
  }

  const battlefield = getProcessedBattlefield(nextState);

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
      if (!typeName || !referencedId) return null;
      const referencedObject = findObjectByIdInState(nextState, battlefield as any, referencedId);
      return referencedObject ? cardHasType(referencedObject, typeName) : false;
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

  const generic = evaluateModifyPtCondition(nextState, controllerId, condition.raw);
  if (generic !== null) return generic;

  const sourceRef = getContextSourceObject(ctx, (idRaw: string) => findObjectByIdInState(nextState, battlefield, idRaw));

  if (normalizedRaw === 'you win the flip') {
    return typeof ctx.wonCoinFlip === 'boolean' ? ctx.wonCoinFlip : null;
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

  if (!sourceRef) return null;

  {
    const voteWinnerMatch = normalizedRaw.match(/^([a-z0-9][a-z0-9' -]*) gets more votes$/i);
    if (voteWinnerMatch) {
      const expected = String(voteWinnerMatch[1] || '').trim().toLowerCase();
      const actual = String(ctx.winningVoteChoice || '').trim().toLowerCase();
      if (!expected || !actual) return null;
      return actual === expected;
    }
  }

  if (normalizedRaw === 'that card has the chosen name') {
    const chosenName = String((sourceRef as any)?.chosenCardName || (sourceRef as any)?.card?.chosenCardName || '').trim();
    if (!chosenName) return null;

    const player = (nextState.players || []).find((p: any) => String(p?.id || '').trim() === controllerId) as any;
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

  const manaSpentMatch = raw.match(/^([a-z0-9]+)\s+or\s+more\s+mana\s+was\s+spent\s+to\s+cast\s+that\s+spell$/i);
  if (manaSpentMatch) {
    const threshold = parseSmallNumberWord(String(manaSpentMatch[1] || ''));
    if (threshold === null) return null;
    const spent = getAmountOfManaSpent(sourceRef);
    if (spent === null) return null;
    return spent >= threshold;
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
