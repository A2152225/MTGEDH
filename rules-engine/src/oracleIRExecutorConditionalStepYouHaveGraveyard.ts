/**
 * Origin: oracleIRExecutorConditionalStepSupport.ts
 * Cluster: evaluateConditionalWrapperCondition you-have-graveyard / entered-from / vote / mana-spent / vehicle-die-roll clauses
 * Public: tryEvaluateConditionalYouHaveGraveyard
 */
import type { EvaluateConditionalWrapperConditionParams } from './oracleIRExecutorConditionalStepSupportHelpers.js';
import {
  countYourGraveyardCards,
  getConditionalObjectZoneProvenance,
  getReferencedConditionalObject,
  getYourGraveyardCards,
  matchesCardTypeDescriptor,
  matchesTypeLine,
  movedCardsFromCtx,
  objectEnteredFromOrWasCastFromGraveyard,
  parseSmallNumberWord,
  topCardSharesCreatureTypeWithSource,
} from './oracleIRExecutorConditionalStepSupportHelpers.js';
import { getContextSourceObject } from './oracleIRExecutorContextRefUtils';
import { getProcessedBattlefield } from './oracleIRExecutorCreatureStepUtils';
import { getAmountOfManaSpent } from './oracleIRExecutorManaUtils';
import { evaluateModifyPtCondition } from './oracleIRExecutorModifyPtCondition';
import { findObjectByIdInState } from './oracleIRExecutorModifyPtWhereUtils';
import { deriveWinningVoteChoice, getCardManaValue } from './oracleIRExecutorPlayerUtils';
import { cardMatchesType, parseSimpleCardTypeFromText } from './oracleIRExecutorZoneOps';
import { splitCardMatchesName } from './splitCards';

export function tryEvaluateConditionalYouHaveGraveyard(
  params: EvaluateConditionalWrapperConditionParams,
): boolean | null | undefined {
  const {
    condition,
    nextState,
    controllerId,
    ctx,
    lastActionOutcome,
    pendingSteps,
    lastMovedCards,
    lastDiscardedCards,
    lastCreatedTokenIds,
  } = params;

  if (condition.kind !== 'if' && condition.kind !== 'as_long_as') return undefined;

  const raw = String(condition.raw || '').trim().toLowerCase();
  let normalizedRaw = raw.replace(/\u2019/g, "'").replace(/\s+/g, ' ').trim();
  if (normalizedRaw.startsWith('then ')) {
    normalizedRaw = normalizedRaw.replace(/^then\s+(?:if\s+)?/i, '').trim();
  }
  if (normalizedRaw.startsWith('if ')) {
    normalizedRaw = normalizedRaw.replace(/^if\s+/i, '').trim();
  }

  const battlefield = getProcessedBattlefield(nextState);

  {
    const youHaveGyCardCountMatch = normalizedRaw.match(/^you have ([a-z0-9]+) or more cards in your graveyard$/i);
    if (youHaveGyCardCountMatch) {
      const threshold = parseSmallNumberWord(String(youHaveGyCardCountMatch[1] || ''));
      if (threshold !== null) {
        return getYourGraveyardCards(nextState, controllerId).length >= threshold;
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
          ctx,
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
    const sourceId = String(ctx.sourceId || '').trim();
    const referencedObject = sourceId
      ? findObjectByIdInState(nextState, battlefield as any, sourceId)
      : getReferencedConditionalObject(nextState, battlefield, ctx);
    const provenance = referencedObject
      ? getConditionalObjectZoneProvenance(referencedObject)
      : {
          castFromZone: String(ctx.castFromZone || (ctx.selectorContext as any)?.castFromZone || '')
            .trim()
            .toLowerCase() || undefined,
          enteredFromZone: String(ctx.enteredFromZone || (ctx.selectorContext as any)?.enteredFromZone || '')
            .trim()
            .toLowerCase() || undefined,
        };
    if (normalizedRaw === 'it entered from your graveyard') {
      return provenance.enteredFromZone === 'graveyard';
    }
    return provenance.castFromZone === 'graveyard';
  }

  if (normalizedRaw === 'this spell was cast from your hand') {
    return String(ctx.castFromZone || '').trim().toLowerCase() === 'hand';
  }

  if (
    normalizedRaw === 'this spell was cast from anywhere other than your hand' ||
    normalizedRaw === 'this spell was cast from somewhere other than your hand'
  ) {
    const castFromZone = String(ctx.castFromZone || (ctx.selectorContext as any)?.castFromZone || '')
      .trim()
      .toLowerCase();
    if (!castFromZone || castFromZone === 'hand') return false;
    return true;
  }

  if (normalizedRaw === 'this spell was cast from exile') {
    const castFromZone = String(ctx.castFromZone || (ctx.selectorContext as any)?.castFromZone || '')
      .trim()
      .toLowerCase();
    if (castFromZone === 'exile') return true;
    if (castFromZone) return false;
    if ((ctx as any).castFromExile === true || (ctx.selectorContext as any)?.castFromExile === true) return true;
    return null;
  }

  if (normalizedRaw === 'it was cast' || normalizedRaw === 'he was cast' || normalizedRaw === 'she was cast') {
    if (ctx.wasCast === true || (ctx.selectorContext as any)?.wasCast === true) return true;
    if (ctx.wasCast === false || (ctx.selectorContext as any)?.wasCast === false) return false;
    const castFromZone = String(ctx.castFromZone || (ctx.selectorContext as any)?.castFromZone || '').trim().toLowerCase();
    if (castFromZone) return true;
    const referencedObject = getReferencedConditionalObject(nextState, battlefield, ctx);
    if (referencedObject) {
      const provenance = getConditionalObjectZoneProvenance(referencedObject);
      if (provenance.castFromZone) return true;
    }
    return null;
  }

  if (normalizedRaw === "it wasn't cast" || normalizedRaw === 'it was not cast') {
    if (ctx.wasCast === false || (ctx.selectorContext as any)?.wasCast === false) return true;
    if (ctx.wasCast === true || (ctx.selectorContext as any)?.wasCast === true) return false;
    const referencedObject = getReferencedConditionalObject(nextState, battlefield, ctx);
    const provenance = referencedObject
      ? getConditionalObjectZoneProvenance(referencedObject)
      : {
          castFromZone: String(ctx.castFromZone || (ctx.selectorContext as any)?.castFromZone || '')
            .trim()
            .toLowerCase() || undefined,
        };
    if (provenance.castFromZone) return false;
    return referencedObject ? true : null;
  }

  if (
    normalizedRaw === "you didn't cast it from your hand" ||
    normalizedRaw === 'you did not cast it from your hand'
  ) {
    const interveningSubjectId = String(
      ctx.selectorContext?.chosenObjectIds?.[0]
        || ctx.targetPermanentId
        || '',
    ).trim();
    const referencedObject = interveningSubjectId
      ? findObjectByIdInState(nextState, battlefield as any, interveningSubjectId)
      : getReferencedConditionalObject(nextState, battlefield, ctx);
    const provenance = referencedObject
      ? getConditionalObjectZoneProvenance(referencedObject)
      : null;
    if (provenance?.castFromZone) return provenance.castFromZone !== 'hand';
    const castFromZone = String(
      ctx.castFromZone || (ctx.selectorContext as any)?.castFromZone || ''
    )
      .trim()
      .toLowerCase();
    if (castFromZone) return castFromZone !== 'hand';
    return null;
  }

  if (
    normalizedRaw === 'this spell was cast from anywhere other than your hand' ||
    normalizedRaw === 'this spell was cast from somewhere other than your hand'
  ) {
    const castFromZone = String(
      ctx.castFromZone || (ctx.selectorContext as any)?.castFromZone || ''
    )
      .trim()
      .toLowerCase();
    if (castFromZone) return castFromZone !== 'hand';
    const referencedObject = getReferencedConditionalObject(nextState, battlefield, ctx);
    const provenance = referencedObject ? getConditionalObjectZoneProvenance(referencedObject) : null;
    if (provenance?.castFromZone) return provenance.castFromZone !== 'hand';
    return null;
  }

  if (normalizedRaw === 'no mana was spent to cast it') {
    if (ctx.noManaSpentToCast === true || (ctx.selectorContext as any)?.noManaSpentToCast === true) return true;
    if (ctx.noManaSpentToCast === false || (ctx.selectorContext as any)?.noManaSpentToCast === false) return false;
    const sourceRef = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, battlefield, idRaw)
    );
    const spent = getAmountOfManaSpent(sourceRef);
    if (spent !== null) return spent === 0;
    return null;
  }

  if (
    normalizedRaw === 'one or more of them entered from a graveyard or was cast from a graveyard' ||
    normalizedRaw === 'one or more of them entered from a graveyard or were cast from a graveyard'
  ) {
    const moved = movedCardsFromCtx(ctx, lastMovedCards);
    if (moved.some((card) => objectEnteredFromOrWasCastFromGraveyard(card))) return true;
    const antecedentIds = [
      ...(Array.isArray(ctx.lastAntecedentBattlefieldPermanentIds)
        ? ctx.lastAntecedentBattlefieldPermanentIds
        : []),
      ...(Array.isArray((ctx.selectorContext as any)?.lastAntecedentBattlefieldPermanentIds)
        ? (ctx.selectorContext as any).lastAntecedentBattlefieldPermanentIds
        : []),
    ].map((id) => String(id || '').trim()).filter(Boolean);
    if (antecedentIds.length > 0) {
      const battlefield = getProcessedBattlefield(nextState) as any[];
      return antecedentIds.some((id) => {
        const perm = battlefield.find((entry: any) => String(entry?.id || '').trim() === id);
        return perm ? objectEnteredFromOrWasCastFromGraveyard(perm) : false;
      });
    }
    return moved.length > 0 ? false : null;
  }

  if (normalizedRaw === 'they entered or were cast from a graveyard') {
    const explicit = (ctx as any)?.theyEnteredOrWereCastFromGraveyard;
    if (typeof explicit === 'boolean') return explicit;
    const ids: string[] = Array.isArray((ctx as any)?.thoseCreatureIds)
      ? (ctx as any).thoseCreatureIds
      : Array.isArray((ctx as any)?.referencedCreatureIds)
        ? (ctx as any).referencedCreatureIds
        : [];
    if (ids.length === 0) return null;
    const battlefield = getProcessedBattlefield(nextState) as any[];
    let sawAny = false;
    let sawUnknown = false;
    for (const id of ids) {
      const perm = battlefield.find((entry: any) => String(entry?.id || '').trim() === String(id).trim());
      if (!perm) {
        sawUnknown = true;
        continue;
      }
      sawAny = true;
      if (!objectEnteredFromOrWasCastFromGraveyard(perm)) return false;
    }
    if (!sawAny) return null;
    return sawUnknown ? null : true;
  }

  if (normalizedRaw === 'you would lose the game') {
    if (ctx.wouldLoseTheGame === true || (ctx.selectorContext as any)?.wouldLoseTheGame === true) return true;
    if (ctx.wouldLoseTheGame === false || (ctx.selectorContext as any)?.wouldLoseTheGame === false) return false;
    return true;
  }

  {
    const sacrificedTypeMatch = normalizedRaw.match(/^the sacrificed creature was a ([a-z]+)$/i);
    if (sacrificedTypeMatch) {
      const descriptor = String(sacrificedTypeMatch[1] || '').trim().toLowerCase();
      const snapshots = Array.isArray((ctx as any).lastSacrificedPermanents)
        ? ((ctx as any).lastSacrificedPermanents as any[])
        : [];
      if (snapshots.length > 0) {
        return snapshots.some((entry: any) =>
          matchesCardTypeDescriptor(entry, descriptor) ||
          new RegExp(`\\b${descriptor.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'i').test(
            String(entry?.type_line || entry?.card?.type_line || entry?.subtype || entry?.cardType || '')
          )
        );
      }
      if (lastActionOutcome?.stepKind !== 'sacrifice') return null;
      return false;
    }
  }

  {
    const sacrificedColorMatch = normalizedRaw.match(
      /^the sacrificed creature was (white|blue|black|red|green)$/i
    );
    if (sacrificedColorMatch) {
      const color = String(sacrificedColorMatch[1] || '').trim().toLowerCase();
      const colorLetter: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
      const snapshots = Array.isArray((ctx as any).lastSacrificedPermanents)
        ? ((ctx as any).lastSacrificedPermanents as any[])
        : [];
      if (snapshots.length > 0) {
        return snapshots.some((entry: any) => {
          const colors = Array.isArray(entry?.colors) ? entry.colors : Array.isArray(entry?.card?.colors) ? entry.card.colors : [];
          return colors.some((c: unknown) => String(c || '').toUpperCase() === colorLetter[color]);
        });
      }
      if (lastActionOutcome?.stepKind !== 'sacrifice') return null;
      return false;
    }
  }

  {
    const wasntSubtypeMatch = normalizedRaw.match(/^(?:it|this creature|this permanent) (?:wasn't|was not) (?:a|an) ([a-z0-9-]+)$/i);
    if (wasntSubtypeMatch) {
      const subtype = String(wasntSubtypeMatch[1] || '').trim().toLowerCase();
      const snapshots = Array.isArray((ctx as any).lastSacrificedPermanents)
        ? ((ctx as any).lastSacrificedPermanents as any[])
        : [];
      const subject =
        snapshots[0] ??
        getReferencedConditionalObject(nextState, battlefield, ctx);
      if (!subject) return null;
      const typeLine = String(subject?.type_line || subject?.card?.type_line || '').toLowerCase();
      return !new RegExp(`\\b${subtype.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'i').test(typeLine);
    }
  }

  if (normalizedRaw === 'you chose a creature this way') {
    const chosenIds = Array.isArray(ctx.selectorContext?.chosenObjectIds)
      ? ctx.selectorContext.chosenObjectIds
      : [];
    if (chosenIds.length === 0) return false;
    return chosenIds.some((id) => {
      const perm = battlefield.find(
        (entry: any) => String(entry?.id || '').trim() === String(id || '').trim()
      );
      return Boolean(perm) && /\bcreature\b/i.test(String((perm as any)?.type_line || (perm as any)?.card?.type_line || ''));
    });
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
    const hadNoCountersMatch = normalizedRaw.match(/^it had no ([a-z0-9/+ -]+) counters on it$/i);
    if (hadNoCountersMatch) {
      const counterName = String(hadNoCountersMatch[1] || '').trim().toLowerCase();
      const referencedObject = getReferencedConditionalObject(nextState, battlefield, ctx);
      if (!referencedObject) return false;
      const counters = ((referencedObject as any)?.counters || {}) as Record<string, unknown>;
      const count = Number(counters[counterName] ?? 0);
      return (Number.isFinite(count) ? count : 0) === 0;
    }
  }

  if (normalizedRaw === 'it had one or more counters on it') {
    const referencedObject = getReferencedConditionalObject(nextState, battlefield, ctx);
    if (!referencedObject) return false;
    const counters = ((referencedObject as any)?.counters || {}) as Record<string, unknown>;
    const total = Object.values(counters).reduce<number>((sum, value) => {
      const count = Number(value ?? 0);
      return sum + (Number.isFinite(count) ? count : 0);
    }, 0);
    return total > 0;
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
      if (normalizedTypeText === 'snow') {
        const card =
          (Array.isArray(lastMovedCards) && lastMovedCards.length > 0 ? lastMovedCards[lastMovedCards.length - 1] : null) ??
          getReferencedConditionalObject(nextState, battlefield, ctx);
        if (!card) {
          const libraryOwnerId = String(ctx.lastTopLibraryOwnerId || controllerId || '').trim();
          const player = (nextState.players || []).find((p: any) => String(p?.id || '').trim() === libraryOwnerId) as any;
          const topCard = Array.isArray(player?.library) && player.library.length > 0 ? player.library[0] : null;
          if (!topCard) return null;
          return matchesTypeLine(topCard?.type_line ?? topCard?.cardType, 'snow');
        }
        return matchesTypeLine(card?.type_line ?? card?.cardType, 'snow');
      }
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
  return undefined;
}
