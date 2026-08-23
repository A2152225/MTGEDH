/**
 * socket/resolutionRegisterPreCompleteValidationForExtractedSteps.ts
 *
 * Pre-complete selection validation for step types whose response handlers are
 * already extracted behind the resolutionHandlerDeps seam (MODAL_CHOICE, CLASH, TWO_PILE_SPLIT, PONDER_EFFECT, SCRY, SURVEIL, FATESEAL, BOTTOM_ORDER, VOTE, PROLIFERATE, LIM_DULS_VAULT, COLOR_CHOICE, CREATURE_TYPE_CHOICE, CARD_NAME_CHOICE, JOIN_FORCES, TEMPTING_OFFER, CASCADE, LIFE_REDISTRIBUTION).
 *
 * Called from registerResolutionHandlers before ResolutionQueueManager.completeStep.
 * Returns false when validation failed (error already emitted on socket).
 */

import type { Socket } from "socket.io";
import { lookupLocalCardByNameSync } from "../services/localCardLookup.js";
import { normalizeCardName } from "../state/modules/chosen-name-restrictions.js";
import { debugWarn } from "../utils/debug.js";
import {
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../state/resolution/index.js";

export type ExtractedStepPreCompleteValidationArgs = {
  socket: Socket;
  step: ResolutionStep;
  response: ResolutionStepResponse;
  cancelled: boolean;
  /** Required for LIM_DULS_VAULT / COLOR / CREATURE_TYPE / CARD_NAME existence checks. */
  game?: any;
  /** Responding player id (socket auth). */
  pid?: string;
};

/**
 * Validate selections for already-extracted response step types.
 * @returns false if the socket handler should abort; true to continue.
 */
export function validateExtractedStepTypesBeforeComplete(
  args: ExtractedStepPreCompleteValidationArgs,
): boolean {
  const { socket, step, response, cancelled, game, pid } = args;

// Validate MODAL_CHOICE selections before completing the step.
// If we complete first, invalid input would permanently consume the step and strand the player.
if (step.type === ResolutionStepType.MODAL_CHOICE) {
  const stepAny = step as any;

  if (cancelled) {
    if (step.mandatory) {
      socket.emit('error', { code: 'STEP_MANDATORY', message: 'This step is mandatory and cannot be cancelled' });
      return false;
    }
  } else {
    const minSelections = Number(stepAny?.minSelections ?? 0);
    const maxSelections = Number(stepAny?.maxSelections ?? Infinity);

    const normalizeSelections = (raw: any): string[] | null => {
      if (raw == null) return [];
      if (typeof raw === 'string') return raw === 'decline' ? [] : [raw];
      if (Array.isArray(raw)) {
        const strings = raw.filter((s: any) => typeof s === 'string') as string[];
        if (strings.includes('decline')) return [];
        return strings;
      }
      return null;
    };

    const selectionIds = normalizeSelections(response.selections);
    if (!selectionIds) {
      socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid modal selection format' });
      return false;
    }

    const unique = Array.from(new Set(selectionIds));
    if (unique.length !== selectionIds.length) {
      socket.emit('error', { code: 'INVALID_SELECTION', message: 'Duplicate option selected' });
      return false;
    }

    if ((Number.isFinite(minSelections) ? selectionIds.length : 0) < (Number.isFinite(minSelections) ? minSelections : 0) ||
        (Number.isFinite(maxSelections) ? selectionIds.length : 0) > (Number.isFinite(maxSelections) ? maxSelections : Infinity)) {
      socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid number of selections' });
      return false;
    }

    const extractOptionId = (opt: any): string | null => {
      if (typeof opt === 'string') return opt;
      if (opt && typeof opt === 'object') {
        const id = (opt as any).id;
        if (typeof id === 'string' && id.trim()) return id;
        const value = (opt as any).value;
        if (typeof value === 'string' && value.trim()) return value;
      }
      return null;
    };

    const rawOptions = Array.isArray(stepAny?.options) ? stepAny.options : [];
    const optionIds = rawOptions.map(extractOptionId).filter(Boolean) as string[];
    const optionIdSet = new Set(optionIds);

    // Put-from-hand modal: additionally enforce chosen id is one of the precomputed validCardIds.
    const putFromHandData = stepAny?.putFromHandData;
    if (putFromHandData && selectionIds.length > 0) {
      const validCardIds = new Set((putFromHandData.validCardIds || []).map((x: any) => String(x)));
      if (!validCardIds.has(String(selectionIds[0]))) {
        socket.emit('error', { code: 'INVALID_SELECTION', message: 'Selected card is not a valid choice' });
        return false;
      }
    }

    // Keyword counter modals: enforce the configured allowed set (defense-in-depth).
    if (stepAny?.keywordCounterChoiceData && selectionIds.length > 0) {
      const keywordMap = new Map<string, string>();
      for (const keyword of Array.isArray(stepAny.keywordCounterChoiceData?.allowedKeywords)
        ? stepAny.keywordCounterChoiceData.allowedKeywords
        : []) {
        const canonical = String(keyword).toLowerCase().trim();
        if (!canonical) continue;
        keywordMap.set(canonical.replace(/\s+/g, '_'), canonical);
      }
      if (keywordMap.size > 0 && !keywordMap.has(String(selectionIds[0]).toLowerCase().trim())) {
        socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid counter choice' });
        return false;
      }
    }

    if (optionIds.length > 0 && selectionIds.some((id) => !optionIdSet.has(String(id)))) {
      socket.emit('error', { code: 'INVALID_SELECTION', message: 'Selected option is not valid' });
      return false;
    }
  }
}

// Validate CLASH selections before completing the step.
// If we complete first, malformed input would permanently consume the step.
if (step.type === ResolutionStepType.CLASH) {
  if (cancelled) {
    if (step.mandatory) {
      socket.emit('error', { code: 'STEP_MANDATORY', message: 'This step is mandatory and cannot be cancelled' });
      return false;
    }
  } else {
    const raw: any = response.selections as any;
    const isValid =
      typeof raw === 'boolean' ||
      (typeof raw === 'string' && (raw === 'top' || raw === 'bottom' || raw === 'true' || raw === 'false')) ||
      (raw && typeof raw === 'object' && !Array.isArray(raw) && typeof raw.putOnBottom === 'boolean');

    if (!isValid) {
      socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid clash selection' });
      return false;
    }
  }
}

// Validate TWO_PILE_SPLIT selections before completing the step.
// The handler can currently normalize/fallback; reject malformed/partial assignments so the step is not consumed.
if (step.type === ResolutionStepType.TWO_PILE_SPLIT) {
  const stepAny = step as any;

  if (cancelled) {
    if (step.mandatory) {
      socket.emit('error', { code: 'STEP_MANDATORY', message: 'This step is mandatory and cannot be cancelled' });
      return false;
    }
  } else {
    const items: any[] = Array.isArray(stepAny?.items) ? stepAny.items : [];
    const itemIds = items.map((it: any) => String(it?.id || '')).filter(Boolean);
    const allowed = new Set(itemIds);

    const raw: any = response.selections as any;
    const pileCount = Math.max(2, Math.floor(Number(stepAny.pileCount ?? 2)));
    let pilesIn: any[][] | null = null;

    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      if (
        Array.isArray(raw.piles)
        && raw.piles.length === pileCount
        && raw.piles.every((pile: any) => Array.isArray(pile))
      ) {
        pilesIn = raw.piles;
      } else if (pileCount === 2 && Array.isArray(raw.pileA) && Array.isArray(raw.pileB)) {
        pilesIn = [raw.pileA, raw.pileB];
      } else if (
        pileCount === 3
        && Array.isArray(raw.pileA)
        && Array.isArray(raw.pileB)
        && Array.isArray(raw.pileC)
      ) {
        pilesIn = [raw.pileA, raw.pileB, raw.pileC];
      }
    }

    if (!pilesIn) {
      socket.emit('error', { code: 'INVALID_SELECTION', message: `Invalid ${pileCount}-pile split format` });
      return false;
    }

    const normalizeIds = (arr: any[]): string[] =>
      arr
        .map((x: any) => (typeof x === 'string' ? x : x?.id))
        .filter(Boolean)
        .map((x: any) => String(x))
        .filter((x: string) => x.trim().length > 0);

    const piles = pilesIn.map(normalizeIds);
    const all = piles.flat();
    const seen = new Set(all);
    if (seen.size !== all.length) {
      socket.emit('error', { code: 'INVALID_SELECTION', message: 'Duplicate item assigned in pile split' });
      return false;
    }
    if (all.some((id) => !allowed.has(String(id)))) {
      socket.emit('error', { code: 'INVALID_SELECTION', message: 'Pile split contains invalid item id' });
      return false;
    }
    if (itemIds.length !== seen.size) {
      socket.emit('error', { code: 'INVALID_SELECTION', message: 'Pile split must assign all items' });
      return false;
    }

    const minPerPile = Number(stepAny.minPerPile ?? 0);
    if (
      Number.isFinite(minPerPile)
      && minPerPile > 0
      && piles.some((pile) => pile.length < minPerPile)
    ) {
      socket.emit('error', { code: 'INVALID_SELECTION', message: `Each pile must contain at least ${minPerPile} item(s)` });
      return false;
    }
  }
}

// Validate PONDER_EFFECT selections before completing the step.
// The handler assumes shape; if we completed first, malformed selections would consume the step.
if (step.type === ResolutionStepType.PONDER_EFFECT) {
  const stepAny = step as any;

  if (cancelled) {
    if (step.mandatory) {
      socket.emit('error', { code: 'STEP_MANDATORY', message: 'This step is mandatory and cannot be cancelled' });
      return false;
    }
  } else {
    const raw: any = response.selections as any;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid ponder selection format' });
      return false;
    }

    const shouldShuffle = Boolean((raw as any).shouldShuffle);
    const newOrderRaw = (raw as any).newOrder;
    const toHandRaw = (raw as any).toHand;

    if ((raw as any).shouldShuffle != null && typeof (raw as any).shouldShuffle !== 'boolean') {
      socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid ponder shuffle selection' });
      return false;
    }

    if (!shouldShuffle) {
      if (!Array.isArray(newOrderRaw) || !newOrderRaw.every((x: any) => typeof x === 'string')) {
        socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid ponder order selection' });
        return false;
      }
    } else {
      if (newOrderRaw != null && (!Array.isArray(newOrderRaw) || !newOrderRaw.every((x: any) => typeof x === 'string'))) {
        socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid ponder order selection' });
        return false;
      }
    }

    if (toHandRaw != null && (!Array.isArray(toHandRaw) || !toHandRaw.every((x: any) => typeof x === 'string'))) {
      socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid ponder to-hand selection' });
      return false;
    }

    const cardCount = Number(stepAny.cardCount || (Array.isArray(stepAny.cards) ? stepAny.cards.length : 0) || 0);
    const stepCards: any[] = Array.isArray(stepAny.cards) ? stepAny.cards : [];
    const allowedIds = new Set(stepCards.map((c: any) => String(c?.id)).filter(Boolean));

    // Best-effort: when step.cards is present, ensure selections reference only those cards.
    if (allowedIds.size > 0) {
      const toHand = Array.isArray(toHandRaw) ? toHandRaw.map(String) : [];
      const newOrder = Array.isArray(newOrderRaw) ? newOrderRaw.map(String) : [];

      const allIds = [...toHand, ...newOrder];
      const seen = new Set(allIds);
      if (seen.size !== allIds.length) {
        socket.emit('error', { code: 'INVALID_SELECTION', message: 'Duplicate card id in ponder selection' });
        return false;
      }

      if (allIds.some((id) => !allowedIds.has(String(id)))) {
        socket.emit('error', { code: 'INVALID_SELECTION', message: 'Ponder selection contains invalid card id' });
        return false;
      }

      if (!shouldShuffle) {
        const expectedRemaining = Math.max(0, allowedIds.size - toHand.length);
        if (newOrder.length !== expectedRemaining) {
          socket.emit('error', { code: 'INVALID_SELECTION', message: 'Ponder selection must order all remaining cards' });
          return false;
        }
      }
    } else {
      // If step.cards is missing, still require a reasonable cardCount.
      if (!Number.isFinite(cardCount) || cardCount <= 0) {
        socket.emit('error', { code: 'INVALID_STEP', message: 'Invalid ponder step' });
        return false;
      }
    }
  }
}

// Validate SCRY selections before completing the step.
// If we complete first, invalid input would permanently consume the step and potentially desync the library.
if (step.type === ResolutionStepType.SCRY) {
  const stepAny = step as any;

  if (cancelled) {
    socket.emit('error', { code: 'STEP_MANDATORY', message: 'This step is mandatory and cannot be cancelled' });
    return false;
  }

  const raw: any = response.selections as any;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid scry selection format' });
    return false;
  }

  const normalizeIdList = (v: any): string[] | null => {
    if (!Array.isArray(v)) return null;
    return v
      .map((x: any) => (typeof x === 'string' ? x : x?.id))
      .filter(Boolean)
      .map((x: any) => String(x));
  };

  const keepTopIds = normalizeIdList(raw.keepTopOrder);
  const bottomIds = normalizeIdList(raw.bottomOrder);
  if (!keepTopIds || !bottomIds) {
    socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid scry selection format' });
    return false;
  }

  const cards: any[] = Array.isArray(stepAny.cards) ? stepAny.cards : [];
  const stepCardIds = cards.map((c: any) => String(c?.id)).filter(Boolean);
  const expected = stepCardIds.length;

  const allIds = [...keepTopIds, ...bottomIds];
  if (allIds.length !== expected) {
    socket.emit('error', { code: 'INVALID_SELECTION', message: 'Scry selection must account for all cards' });
    return false;
  }
  const seen = new Set(allIds);
  if (seen.size !== allIds.length) {
    socket.emit('error', { code: 'INVALID_SELECTION', message: 'Duplicate card selected' });
    return false;
  }
  const stepSet = new Set(stepCardIds);
  if (!allIds.every((id) => stepSet.has(String(id)))) {
    socket.emit('error', { code: 'INVALID_SELECTION', message: 'Scry selection contains invalid card(s)' });
    return false;
  }
}

// Validate SURVEIL selections before completing the step.
if (step.type === ResolutionStepType.SURVEIL) {
  const stepAny = step as any;

  if (cancelled) {
    socket.emit('error', { code: 'STEP_MANDATORY', message: 'This step is mandatory and cannot be cancelled' });
    return false;
  }

  const raw: any = response.selections as any;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid surveil selection format' });
    return false;
  }

  const normalizeIdList = (v: any): string[] | null => {
    if (!Array.isArray(v)) return null;
    return v
      .map((x: any) => (typeof x === 'string' ? x : x?.id))
      .filter(Boolean)
      .map((x: any) => String(x));
  };

  const keepTopIds = normalizeIdList(raw.keepTopOrder);
  const toGraveyardIds = normalizeIdList(raw.toGraveyard);
  if (!keepTopIds || !toGraveyardIds) {
    socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid surveil selection format' });
    return false;
  }

  const cards: any[] = Array.isArray(stepAny.cards) ? stepAny.cards : [];
  const stepCardIds = cards.map((c: any) => String(c?.id)).filter(Boolean);
  const expected = stepCardIds.length;

  const allIds = [...keepTopIds, ...toGraveyardIds];
  if (allIds.length !== expected) {
    socket.emit('error', { code: 'INVALID_SELECTION', message: 'Surveil selection must account for all cards' });
    return false;
  }
  const seen = new Set(allIds);
  if (seen.size !== allIds.length) {
    socket.emit('error', { code: 'INVALID_SELECTION', message: 'Duplicate card selected' });
    return false;
  }
  const stepSet = new Set(stepCardIds);
  if (!allIds.every((id) => stepSet.has(String(id)))) {
    socket.emit('error', { code: 'INVALID_SELECTION', message: 'Surveil selection contains invalid card(s)' });
    return false;
  }
}

// Validate FATESEAL selections before completing the step.
if (step.type === ResolutionStepType.FATESEAL) {
  const stepAny = step as any;

  if (cancelled) {
    socket.emit('error', { code: 'STEP_MANDATORY', message: 'This step is mandatory and cannot be cancelled' });
    return false;
  }

  const raw: any = response.selections as any;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid fateseal selection format' });
    return false;
  }

  const normalizeIdList = (v: any): string[] | null => {
    if (!Array.isArray(v)) return null;
    return v
      .map((x: any) => (typeof x === 'string' ? x : x?.id))
      .filter(Boolean)
      .map((x: any) => String(x));
  };

  const keepTopIds = normalizeIdList(raw.keepTopOrder);
  const bottomIds = normalizeIdList(raw.bottomOrder);
  if (!keepTopIds || !bottomIds) {
    socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid fateseal selection format' });
    return false;
  }

  const cards: any[] = Array.isArray(stepAny.cards) ? stepAny.cards : [];
  const stepCardIds = cards.map((c: any) => String(c?.id)).filter(Boolean);
  const expected = stepCardIds.length;

  const allIds = [...keepTopIds, ...bottomIds];
  if (allIds.length !== expected) {
    socket.emit('error', { code: 'INVALID_SELECTION', message: 'Fateseal selection must account for all cards' });
    return false;
  }
  const seen = new Set(allIds);
  if (seen.size !== allIds.length) {
    socket.emit('error', { code: 'INVALID_SELECTION', message: 'Duplicate card selected' });
    return false;
  }
  const stepSet = new Set(stepCardIds);
  if (!allIds.every((id) => stepSet.has(String(id)))) {
    socket.emit('error', { code: 'INVALID_SELECTION', message: 'Fateseal selection contains invalid card(s)' });
    return false;
  }
}

// Validate BOTTOM_ORDER selections before completing the step.
// The handler returns early on invalid permutations; completing first would permanently consume the step.
if (step.type === ResolutionStepType.BOTTOM_ORDER) {
  const stepAny = step as any;

  if (cancelled) {
    if (step.mandatory) {
      socket.emit('error', { code: 'STEP_MANDATORY', message: 'This step is mandatory and cannot be cancelled' });
      return false;
    }
  } else {
    const raw: any = response.selections as any;
    const rawBottomOrder =
      raw && typeof raw === 'object' && !Array.isArray(raw) && 'bottomOrder' in raw
        ? (raw as any).bottomOrder
        : raw;

    if (!Array.isArray(rawBottomOrder)) {
      socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid bottom order format' });
      return false;
    }

    const bottomIds = rawBottomOrder
      .map((x: any) => (typeof x === 'string' ? x : x?.id))
      .filter(Boolean)
      .map((x: any) => String(x));

    const cards: any[] = Array.isArray(stepAny.cards) ? stepAny.cards : [];
    const stepCardIds = cards.map((c: any) => String(c?.id)).filter(Boolean);

    if (bottomIds.length !== stepCardIds.length) {
      socket.emit('error', { code: 'INVALID_SELECTION', message: 'Bottom order must include all cards' });
      return false;
    }
    const seen = new Set(bottomIds);
    if (seen.size !== bottomIds.length) {
      socket.emit('error', { code: 'INVALID_SELECTION', message: 'Duplicate card selected' });
      return false;
    }
    const stepSet = new Set(stepCardIds);
    if (!bottomIds.every((id) => stepSet.has(String(id)))) {
      socket.emit('error', { code: 'INVALID_SELECTION', message: 'Bottom order contains invalid card(s)' });
      return false;
    }
  }
}

function canonicalizeCardNameChoiceSelection(selection: string, candidateNames: unknown): string | undefined {
  const trimmed = String(selection || '').trim();
  if (!trimmed) return undefined;

  const normalizedSelection = normalizeCardName(trimmed);

  if (Array.isArray(candidateNames) && candidateNames.length > 0) {
    for (const candidateName of candidateNames) {
      if (typeof candidateName !== 'string') continue;
      if (normalizeCardName(candidateName) === normalizedSelection) {
        return candidateName;
      }
    }

    return undefined;
  }

  try {
    const localRecord = lookupLocalCardByNameSync(trimmed);
    const canonicalName = String(localRecord?.name || '').trim();
    if (canonicalName && normalizeCardName(canonicalName) === normalizedSelection) {
      return canonicalName;
    }
  } catch (error) {
    debugWarn(1, '[Resolution] Failed local validation for card name choice:', error);
  }

  return undefined;
}

    // Validate VOTE selections before completing the step.
    // If we complete first, invalid input would permanently consume the step and skip the vote.
    if (step.type === ResolutionStepType.VOTE) {
      const stepAny = step as any;

      if (cancelled) {
        if (step.mandatory) {
          socket.emit('error', { code: 'STEP_MANDATORY', message: 'This step is mandatory and cannot be cancelled' });
          return false;
        }
      } else {
        const raw: any = response.selections as any;
        const choice = typeof raw === 'string' ? raw : raw && typeof raw === 'object' ? raw.choice : undefined;
        const voteCountRaw = raw && typeof raw === 'object' ? raw.voteCount : undefined;
        const voteCount = voteCountRaw == null ? 1 : Number(voteCountRaw);

        const choices: any[] = Array.isArray(stepAny?.choices) ? stepAny.choices : [];
        if (!choice || typeof choice !== 'string' || !choices.includes(choice)) {
          socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid vote choice' });
          return false;
        }
        if (!Number.isFinite(voteCount) || voteCount < 1 || Math.floor(voteCount) !== voteCount) {
          socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid vote count' });
          return false;
        }
      }
    }

    // Validate PROLIFERATE selections before completing the step.
    // If we complete first, malformed input (or invalid IDs) would permanently consume the step.
    if (step.type === ResolutionStepType.PROLIFERATE) {
      if (cancelled) {
        if (step.mandatory) {
          socket.emit('error', { code: 'STEP_MANDATORY', message: 'This step is mandatory and cannot be cancelled' });
          return false;
        }
      } else {
        const stepAny = step as any;
        const raw: any = response.selections as any;
        const rawIds = Array.isArray(raw)
          ? raw
          : raw && typeof raw === 'object' && !Array.isArray(raw)
            ? (raw as any).selectedTargetIds
            : null;

        if (rawIds != null && (!Array.isArray(rawIds) || !rawIds.every((x: any) => typeof x === 'string'))) {
          socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid proliferate selection format' });
          return false;
        }

        const selectedIds: string[] = Array.isArray(rawIds) ? rawIds.map(String) : [];
        const unique = Array.from(new Set(selectedIds));
        if (unique.length !== selectedIds.length) {
          socket.emit('error', { code: 'INVALID_SELECTION', message: 'Duplicate proliferate target selected' });
          return false;
        }

        const availableTargets: any[] = Array.isArray(stepAny?.availableTargets) ? stepAny.availableTargets : [];
        const allowed = new Set(availableTargets.map((t: any) => String(t?.id)).filter(Boolean));
        if (selectedIds.some((id: string) => !allowed.has(String(id)))) {
          socket.emit('error', { code: 'INVALID_SELECTION', message: 'One or more selected proliferate targets are not valid' });
          return false;
        }
      }
    }

                    if (step.type === ResolutionStepType.LIM_DULS_VAULT) {
      const stepAny = step as any;

      if (cancelled) {
        socket.emit('error', { code: 'STEP_MANDATORY', message: 'This step is mandatory and cannot be cancelled' });
        return false;
      }

      const raw: any = response.selections as any;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid Lim-Dul\'s Vault selection format' });
        return false;
      }

      const action = String(raw.action || '').trim();
      if (action !== 'continue' && action !== 'finish') {
        socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid Lim-Dul\'s Vault action' });
        return false;
      }

      const orderedIds = Array.isArray(raw.orderedIds)
        ? raw.orderedIds.map((value: any) => String(value || '')).filter(Boolean)
        : [];
      const cards: any[] = Array.isArray(stepAny.cards) ? stepAny.cards : [];
      const stepCardIds = cards.map((card: any) => String(card?.id || '')).filter(Boolean);

      if (orderedIds.length !== stepCardIds.length) {
        socket.emit('error', { code: 'INVALID_SELECTION', message: 'Lim-Dul\'s Vault order must include all revealed cards' });
        return false;
      }
      const seen = new Set(orderedIds);
      if (seen.size !== orderedIds.length) {
        socket.emit('error', { code: 'INVALID_SELECTION', message: 'Duplicate card selected' });
        return false;
      }
      const stepSet = new Set(stepCardIds);
      if (!orderedIds.every((id: string) => stepSet.has(id))) {
        socket.emit('error', { code: 'INVALID_SELECTION', message: 'Lim-Dul\'s Vault selection contains invalid card(s)' });
        return false;
      }

      if (action === 'continue') {
        const currentLife = Number((game.state as any)?.life?.[pid] ?? (game.state as any)?.startingLife ?? 40);
        if (!Number.isFinite(currentLife) || currentLife <= 1) {
          socket.emit('error', { code: 'INSUFFICIENT_LIFE', message: 'You do not have enough life to continue with Lim-Dul\'s Vault' });
          return false;
        }
      }
    }

    // Validate COLOR_CHOICE selections before completing the step.
    // The handler returns early on missing/invalid colors or missing referenced objects.
    if (step.type === ResolutionStepType.COLOR_CHOICE) {
      const stepAny = step as any;

      if (cancelled) {
        if (step.mandatory) {
          socket.emit('error', { code: 'STEP_MANDATORY', message: 'This step is mandatory and cannot be cancelled' });
          return false;
        }
      } else {
        const raw: any = response.selections as any;
        const selection = Array.isArray(raw) ? raw[0] : raw;
        if (!selection || typeof selection !== 'string') {
          socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid color selection' });
          return false;
        }

        const stepColors = Array.isArray(stepAny.colors) && stepAny.colors.length > 0
          ? stepAny.colors.map((c: any) => String(c).toLowerCase())
          : ['white', 'blue', 'black', 'red', 'green'];
        const colorLower = String(selection).toLowerCase();
        if (!stepColors.includes(colorLower)) {
          socket.emit('error', { code: 'INVALID_COLOR', message: `Invalid color selection (${selection})` });
          return false;
        }

        const spellId = String(stepAny.spellId || '').trim();
        const permanentId = String(stepAny.permanentId || stepAny.sourceId || '').trim();
        const stateAny = game.state as any;

        if (spellId) {
          const stack: any[] = Array.isArray(stateAny?.stack) ? stateAny.stack : [];
          const spellOnStack = stack.find((s: any) => s && (
            String(s.id) === spellId
            || String(s.cardId) === spellId
            || String(s.card?.id) === spellId
          ));
          if (!spellOnStack) {
            socket.emit('error', { code: 'INVALID_STEP', message: 'Spell no longer on stack' });
            return false;
          }
        } else if (permanentId) {
          const battlefield: any[] = Array.isArray(stateAny?.battlefield) ? stateAny.battlefield : [];
          const perm = battlefield.find((p: any) => p && String(p.id) === permanentId);
          if (!perm) {
            socket.emit('error', { code: 'PERMANENT_NOT_FOUND', message: 'Permanent no longer on battlefield' });
            return false;
          }
        }
      }
    }

    // Validate CREATURE_TYPE_CHOICE selections before completing the step.
    if (step.type === ResolutionStepType.CREATURE_TYPE_CHOICE) {
      const stepAny = step as any;

      if (cancelled) {
        if (step.mandatory) {
          socket.emit('error', { code: 'STEP_MANDATORY', message: 'This step is mandatory and cannot be cancelled' });
          return false;
        }
      } else {
        const raw: any = response.selections as any;
        const selection = Array.isArray(raw) ? raw[0] : raw;
        if (!selection || typeof selection !== 'string' || !String(selection).trim()) {
          socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid creature type selection' });
          return false;
        }

        const offeredCreatureTypes = Array.isArray(stepAny.offeredCreatureTypes)
          ? stepAny.offeredCreatureTypes.map((type: any) => String(type || '').trim()).filter(Boolean)
          : [];
        if (
          offeredCreatureTypes.length > 0
          && !offeredCreatureTypes.some((type: string) => type.toLowerCase() === String(selection).trim().toLowerCase())
        ) {
          socket.emit('error', { code: 'INVALID_SELECTION', message: 'Selected creature type is not among the offered choices' });
          return false;
        }

        const spellId = String(stepAny.spellId || '').trim();
        if (spellId) {
          const stack: any[] = Array.isArray((game.state as any)?.stack) ? (game.state as any).stack : [];
          const stackItem = stack.find((item: any) => item && (String(item.id || '') === spellId || String(item.cardId || '') === spellId));
          if (!stackItem) {
            socket.emit('error', { code: 'SPELL_NOT_FOUND', message: 'Spell is no longer on the stack' });
            return false;
          }
        }

        const permanentId = String(stepAny.permanentId || stepAny.sourceId || '').trim();
        if (permanentId && !spellId) {
          const battlefield: any[] = Array.isArray((game.state as any)?.battlefield) ? (game.state as any).battlefield : [];
          const perm = battlefield.find((p: any) => p && String(p.id) === permanentId);
          if (!perm) {
            socket.emit('error', { code: 'PERMANENT_NOT_FOUND', message: 'Permanent no longer on battlefield' });
            return false;
          }
        }
      }
    }

    // Validate CARD_NAME_CHOICE selections before completing the step.
    if (step.type === ResolutionStepType.CARD_NAME_CHOICE) {
      const stepAny = step as any;

      if (cancelled) {
        if (step.mandatory) {
          socket.emit('error', { code: 'STEP_MANDATORY', message: 'This step is mandatory and cannot be cancelled' });
          return false;
        }
      } else {
        const raw: any = response.selections as any;
        const selection = Array.isArray(raw) ? raw[0] : raw;
        if (!selection || typeof selection !== 'string' || !String(selection).trim()) {
          socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid card name selection' });
          return false;
        }

        const canonicalSelection = canonicalizeCardNameChoiceSelection(selection, stepAny.candidateNames);
        if (!canonicalSelection) {
          socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid card name selection' });
          return false;
        }

        (response as any).selections = canonicalSelection;

        const permanentId = String(stepAny.permanentId || stepAny.sourceId || '').trim();
        if (permanentId) {
          const battlefield: any[] = Array.isArray((game.state as any)?.battlefield) ? (game.state as any).battlefield : [];
          const perm = battlefield.find((p: any) => p && String(p.id) === permanentId);
          if (!perm) {
            socket.emit('error', { code: 'PERMANENT_NOT_FOUND', message: 'Permanent no longer on battlefield' });
            return false;
          }
        }
      }
    }


    // Validate JOIN_FORCES mana contribution before completing the step.
    // The handler early-returns on invalid contributions; if we completed first we'd consume the step.
    if (step.type === ResolutionStepType.JOIN_FORCES) {
      const stepAny = step as any;

      if (cancelled) {
        if (step.mandatory) {
          socket.emit('error', { code: 'STEP_MANDATORY', message: 'This step is mandatory and cannot be cancelled' });
          return false;
        }
      } else {
        const selection = response.selections as any;

        let contribution = 0;
        if (typeof selection === 'number') {
          contribution = Math.max(0, Math.floor(selection));
        } else if (typeof selection === 'object' && selection !== null && !Array.isArray(selection)) {
          contribution = Math.max(0, Math.floor((selection as any).amount || 0));
        } else if (typeof selection === 'string' && selection.trim()) {
          const n = Number(selection);
          if (Number.isFinite(n)) contribution = Math.max(0, Math.floor(n));
        }

        if (!Number.isFinite(contribution) || contribution < 0) {
          socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid mana contribution' });
          return false;
        }

        const availableMana = Number(stepAny.availableMana ?? 0);
        if (Number.isFinite(availableMana) && contribution > availableMana) {
          socket.emit('error', {
            code: 'INSUFFICIENT_MANA',
            message: `Contribution ${contribution} exceeds available mana ${availableMana}`,
          });
          return false;
        }
      }
    }

    // Validate TEMPTING_OFFER selections before completing the step.
    // If we complete first, malformed input would permanently consume the step and force an unintended accept/decline.
    if (step.type === ResolutionStepType.TEMPTING_OFFER) {
      if (cancelled) {
        if (step.mandatory) {
          socket.emit('error', { code: 'STEP_MANDATORY', message: 'This step is mandatory and cannot be cancelled' });
          return false;
        }
      } else {
        const raw: any = response.selections as any;
        const okString = (s: string) => ['accept', 'decline', 'true', 'false'].includes(s);

        const isValid =
          typeof raw === 'boolean' ||
          (typeof raw === 'string' && okString(raw)) ||
          (raw && typeof raw === 'object' && !Array.isArray(raw) && (typeof raw.accept === 'boolean' || typeof raw.accepted === 'boolean'));

        if (!isValid) {
          socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid tempting offer selection' });
          return false;
        }
      }
    }

    // Validate CASCADE selections before completing the step.
    // If we complete first, malformed input would permanently consume the step and force an unintended cast/decline.
    if (step.type === ResolutionStepType.CASCADE) {
      if (cancelled) {
        if (step.mandatory) {
          socket.emit('error', { code: 'STEP_MANDATORY', message: 'This step is mandatory and cannot be cancelled' });
          return false;
        }
      } else {
        const raw: any = response.selections as any;
        const isValid =
          typeof raw === 'boolean' ||
          (typeof raw === 'string' && (raw === 'cast' || raw === 'decline')) ||
          (raw && typeof raw === 'object' && !Array.isArray(raw) && typeof raw.cast === 'boolean');

        if (!isValid) {
          socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid cascade selection' });
          return false;
        }
      }
    }

    if (step.type === ResolutionStepType.LIFE_REDISTRIBUTION) {
      if (cancelled) {
        if (step.mandatory) {
          socket.emit('error', { code: 'STEP_MANDATORY', message: 'This step is mandatory and cannot be cancelled' });
          return false;
        }
      } else {
        const stepAny = step as any;
        const raw: any = response.selections as any;
        const lifeByPlayerId = raw?.lifeByPlayerId ?? raw;
        if (!lifeByPlayerId || typeof lifeByPlayerId !== 'object' || Array.isArray(lifeByPlayerId)) {
          socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid life redistribution selection format' });
          return false;
        }

        const players: any[] = Array.isArray(stepAny?.players) ? stepAny.players : [];
        const allowed = new Map<string, number>(
          players.map((player: any) => [String(player?.id || ''), Math.max(0, Math.floor(Number(player?.life ?? 0)))]),
        );

        const participantIds = Object.keys(lifeByPlayerId).map(String).filter((id) => allowed.has(id));
        const poolTotal = participantIds.reduce((sum, id) => sum + (allowed.get(id) ?? 0), 0);
        const assignedTotal = participantIds.reduce((sum, id) => {
          const amount = Number((lifeByPlayerId as Record<string, unknown>)[id] ?? NaN);
          return sum + (Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : 0);
        }, 0);

        if (participantIds.some((id) => !allowed.has(id))) {
          socket.emit('error', { code: 'INVALID_SELECTION', message: 'One or more selected players are not valid' });
          return false;
        }

        if (participantIds.length > 0 && assignedTotal !== poolTotal) {
          socket.emit('error', {
            code: 'INVALID_SELECTION',
            message: `Assigned life total (${assignedTotal}) must equal the selected players' pool (${poolTotal})`,
          });
          return false;
        }
      }
    }

  return true;
}
