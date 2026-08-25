// Origin parent: rules-engine/src/RulesEngineAdapter.ts
// Cluster moved: keyword-cost and resolved-spell zone helpers
// (buyback/replicate/disturb, rebound, GY/exile/battlefield destinations).
// Public entry symbols: extractKeywordCostFromOracleText, getIntrinsicGraveyardCastMetadata,
// buildTransformedCardFace, addManaCostValues, manaCostsEqual, multiplyManaCost,
// shouldPayBuyback, getReplicateCount, getEffectiveKeywordAdjustedManaCostInput,
// getEffectiveBuybackManaCostInput, didPayBuyback, sanitizeSpellCardAfterStackExit,
// moveResolvedNonPermanentSpellToZone, spellCardHasKeyword, registerReboundDelayedTrigger,
// moveResolvedPermanentSpellToBattlefield.
// Class methods become thin wrappers that call these via .call(this, ...).
// Leaf must not import RulesEngineAdapter.ts or RulesEngineAdapter-handlers/index.ts.

import type { GameState, PlayerID } from '../../../shared/src';
import {
  createDelayedTrigger,
  createDelayedTriggerRegistry,
  DelayedTriggerTiming,
  registerDelayedTrigger,
} from '../delayedTriggeredAbilities';
import { stripPlayableFromExileTags } from '../playableFromExile';
import { stripPlayableFromGraveyardTags } from '../playableFromGraveyard';
import type { ManaCost } from '../types/mana';

/** Adapter instance passed as `this` from RulesEngineAdapter thin wrappers. */
export type AdapterKeywordCostHost = any;

export function extractKeywordCostFromOracleText(card: any, keyword: string): string | undefined {
    const normalizedKeyword = String(keyword || '').trim().toLowerCase();
    if (!normalizedKeyword) return undefined;

    const oracleText = String(card?.oracle_text || card?.card?.oracle_text || '');
    if (!oracleText) return undefined;

    const keywordPattern = new RegExp(`^${normalizedKeyword}\\s+(?:[\\u2014-]\\s*)?(.+)$`, 'i');
    for (const rawLine of oracleText.split(/\r?\n/)) {
      const line = String(rawLine || '').trim();
      if (!line) continue;
      const match = line.match(keywordPattern);
      if (!match) continue;
      const cost = String(match[1] || '')
        .replace(/\s+\([^()]*\)\s*$/, '')
        .trim();
      if (cost) return cost;
    }

    return undefined;
  }

export function getIntrinsicGraveyardCastMetadata(sourceCard: any, fromZone: string): {
    readonly cost?: string;
    readonly entersBattlefieldTransformed?: boolean;
  } {
    if (String(fromZone || '').trim().toLowerCase() !== 'graveyard') return {};

    const disturbCost = this.extractKeywordCostFromOracleText(sourceCard, 'disturb');
    if (disturbCost) {
      return {
        cost: disturbCost,
        entersBattlefieldTransformed: true,
      };
    }

    return {};
  }

export function buildTransformedCardFace(sourceCard: any): any {
    const base = sourceCard && typeof sourceCard === 'object' ? sourceCard : {};
    const faces = Array.isArray(base?.card_faces) ? base.card_faces : [];
    const backFace = faces.length >= 2 && faces[1] && typeof faces[1] === 'object' ? faces[1] : null;
    if (!backFace) return base;

    return {
      ...base,
      ...backFace,
      transformed: true,
      currentFace: 'back',
    };
  }

export function addManaCostValues(left: string | ManaCost | undefined, right: string | ManaCost | undefined): ManaCost {
    const leftCost = this.parseManaCostString(left);
    const rightCost = this.parseManaCostString(right);
    return {
      generic: (leftCost.generic || 0) + (rightCost.generic || 0),
      white: (leftCost.white || 0) + (rightCost.white || 0),
      blue: (leftCost.blue || 0) + (rightCost.blue || 0),
      black: (leftCost.black || 0) + (rightCost.black || 0),
      red: (leftCost.red || 0) + (rightCost.red || 0),
      green: (leftCost.green || 0) + (rightCost.green || 0),
      colorless: (leftCost.colorless || 0) + (rightCost.colorless || 0),
    };
  }

export function manaCostsEqual(left: ManaCost, right: ManaCost): boolean {
    return (
      (left.generic || 0) === (right.generic || 0) &&
      (left.white || 0) === (right.white || 0) &&
      (left.blue || 0) === (right.blue || 0) &&
      (left.black || 0) === (right.black || 0) &&
      (left.red || 0) === (right.red || 0) &&
      (left.green || 0) === (right.green || 0) &&
      (left.colorless || 0) === (right.colorless || 0)
    );
  }

export function multiplyManaCost(cost: string | ManaCost | undefined, count: number): ManaCost {
    const normalizedCount = Math.max(0, Math.floor(Number(count) || 0));
    const parsed = this.parseManaCostString(cost);
    return {
      generic: (parsed.generic || 0) * normalizedCount,
      white: (parsed.white || 0) * normalizedCount,
      blue: (parsed.blue || 0) * normalizedCount,
      black: (parsed.black || 0) * normalizedCount,
      red: (parsed.red || 0) * normalizedCount,
      green: (parsed.green || 0) * normalizedCount,
      colorless: (parsed.colorless || 0) * normalizedCount,
    };
  }

export function shouldPayBuyback(action: any): boolean {
    if (action?.payBuyback === true || action?.buyback === true) {
      return true;
    }

    const additionalCosts = Array.isArray(action?.additionalCosts) ? action.additionalCosts : [];
    return additionalCosts.some((cost: any) => {
      if (typeof cost === 'string') {
        return String(cost).trim().toLowerCase() === 'buyback';
      }

      const type = String(cost?.type || cost?.keyword || '').trim().toLowerCase();
      return type === 'buyback';
    });
  }

export function getReplicateCount(action: any): number {
    return Math.max(0, Math.floor(Number(action?.replicateCount) || 0));
  }

export function getEffectiveKeywordAdjustedManaCostInput(action: any, sourceCard: any, fromZone: string): ManaCost | undefined {
    if (String(fromZone || '').trim().toLowerCase() !== 'hand') {
      return undefined;
    }

    const ignoresManaCost = Boolean((sourceCard as any)?.withoutPayingManaCost);
    let totalCost = this.parseManaCostString(
      ignoresManaCost ? {} : ((sourceCard as any)?.mana_cost ?? (sourceCard as any)?.manaCost)
    );
    let changed = false;

    const replicateCount = this.getReplicateCount(action);
    if (replicateCount > 0) {
      const replicateCost = this.extractKeywordCostFromOracleText(sourceCard, 'replicate');
      if (replicateCost) {
        totalCost = this.addManaCostValues(totalCost, this.multiplyManaCost(replicateCost, replicateCount));
        changed = true;
      }
    }

    if (this.shouldPayBuyback(action)) {
      const buybackCost = this.extractKeywordCostFromOracleText(sourceCard, 'buyback');
      if (buybackCost) {
        totalCost = this.addManaCostValues(totalCost, buybackCost);
        changed = true;
      }
    }

    return changed ? totalCost : undefined;
  }

export function getEffectiveBuybackManaCostInput(action: any, sourceCard: any, fromZone: string): ManaCost | undefined {
    if (String(fromZone || '').trim().toLowerCase() !== 'hand' || !this.shouldPayBuyback(action)) {
      return undefined;
    }

    const buybackCost = this.extractKeywordCostFromOracleText(sourceCard, 'buyback');
    if (!buybackCost) return undefined;

    const baseCost = Boolean((sourceCard as any)?.withoutPayingManaCost)
      ? {}
      : ((sourceCard as any)?.mana_cost ?? (sourceCard as any)?.manaCost);

    return this.addManaCostValues(baseCost, buybackCost);
  }

export function didPayBuyback(action: any, sourceCard: any, fromZone: string): boolean {
    if (String(fromZone || '').trim().toLowerCase() !== 'hand') return false;

    const buybackCost = this.extractKeywordCostFromOracleText(sourceCard, 'buyback');
    if (!buybackCost) return false;

    if (this.shouldPayBuyback(action)) return true;
    if (!action?.manaCost) return false;

    const combinedCost = this.addManaCostValues(
      Boolean((sourceCard as any)?.withoutPayingManaCost)
        ? {}
        : ((sourceCard as any)?.mana_cost ?? (sourceCard as any)?.manaCost),
      buybackCost
    );
    return this.manaCostsEqual(this.parseManaCostString(action.manaCost), combinedCost);
  }

export function sanitizeSpellCardAfterStackExit(card: any): any {
    const strippedPlayableTags = stripPlayableFromGraveyardTags(stripPlayableFromExileTags(card));
    const {
      entersBattlefieldWithCounters,
      entersBattlefieldTransformed,
      exileInsteadOfGraveyard,
      returnToHandInsteadOfGraveyard,
      ...rest
    } = (strippedPlayableTags || {}) as any;
    return rest;
  }

export function moveResolvedNonPermanentSpellToZone(
    state: GameState,
    stackObject: any,
    zone: 'graveyard' | 'exile' | 'hand'
  ): GameState {
    const ownerId = String(stackObject?.ownerId || stackObject?.controllerId || '').trim();
    if (!ownerId) return state;

    const stackCard = stackObject?.card && typeof stackObject.card === 'object'
      ? stackObject.card
      : {};
    const cardToMove = this.sanitizeSpellCardAfterStackExit({
      ...stackCard,
      id: String(stackCard?.id || stackObject?.spellId || stackObject?.id || ''),
      name: String(stackCard?.name || stackObject?.cardName || 'Unknown Card'),
      type_line: String(stackCard?.type_line || ''),
      oracle_text: String(stackCard?.oracle_text || stackObject?.triggerMeta?.effectText || ''),
    });

    const updatedPlayers = (state.players || []).map((player: any) => {
      if (player.id !== ownerId) return player;

      const zoneCards = Array.isArray(player?.[zone]) ? [...player[zone]] : [];
      return {
        ...player,
        [zone]: [...zoneCards, cardToMove],
      };
    });

    return {
      ...state,
      players: updatedPlayers as any,
    };
  }

export function spellCardHasKeyword(stackObject: any, keyword: string): boolean {
    const normalizedKeyword = String(keyword || '').trim().toLowerCase();
    if (!normalizedKeyword) return false;

    const stackCard = stackObject?.card && typeof stackObject.card === 'object'
      ? stackObject.card
      : {};

    if (
      Array.isArray((stackCard as any)?.keywords) &&
      (stackCard as any).keywords.some((value: unknown) => String(value || '').trim().toLowerCase() === normalizedKeyword)
    ) {
      return true;
    }

    const oracleText = String(stackCard?.oracle_text || stackObject?.triggerMeta?.effectText || '').trim();
    if (!oracleText) return false;

    return oracleText
      .split(/\r?\n/)
      .map(line => String(line || '').trim())
      .filter(Boolean)
      .some(line => /^rebound(?:\s|\(|$)/i.test(line));
  }

export function registerReboundDelayedTrigger(state: GameState, stackObject: any): GameState {
    const cardId = String(stackObject?.spellId || stackObject?.card?.id || stackObject?.id || '').trim();
    const controllerId = String(stackObject?.controllerId || stackObject?.controller || '').trim() as PlayerID;
    const sourceName = String(stackObject?.cardName || stackObject?.card?.name || 'Rebound').trim() || 'Rebound';
    if (!cardId || !controllerId) return state;

    const currentTurn = Number((state as any).turnNumber ?? (state as any).turn ?? 0) || 0;
    const delayedTrigger = createDelayedTrigger(
      cardId,
      sourceName,
      controllerId,
      DelayedTriggerTiming.YOUR_NEXT_UPKEEP,
      'You may cast this card from exile without paying its mana cost.',
      currentTurn,
      {
        eventDataSnapshot: {
          sourceId: cardId,
          sourceControllerId: controllerId,
          chosenObjectIds: [cardId],
        },
      }
    );

    const registry = (state as any).delayedTriggerRegistry || createDelayedTriggerRegistry();
    const nextRegistry = registerDelayedTrigger(registry, delayedTrigger);
    return {
      ...(state as any),
      delayedTriggerRegistry: nextRegistry,
    } as GameState;
  }

export function moveResolvedPermanentSpellToBattlefield(state: GameState, stackObject: any): GameState {
    const stackCard = stackObject?.card && typeof stackObject.card === 'object'
      ? stackObject.card
      : {};
    const permanentId = String(stackCard?.id || stackObject?.spellId || stackObject?.id || '');
    const ownerId = String(stackObject?.ownerId || stackObject?.controllerId || '').trim();
    const controllerId = String(stackObject?.controllerId || ownerId).trim();
    if (!permanentId || !controllerId) return state;

    const permanent = {
      id: permanentId,
      controller: controllerId,
      owner: ownerId || controllerId,
      name: String(stackCard?.name || stackObject?.cardName || 'Unknown Permanent'),
      type_line: String(stackCard?.type_line || ''),
      manaCost: stackCard?.mana_cost ?? stackCard?.manaCost,
      power: stackCard?.power,
      toughness: stackCard?.toughness,
      tapped: false,
      summoningSickness: true,
      counters:
        stackCard?.entersBattlefieldWithCounters && typeof stackCard.entersBattlefieldWithCounters === 'object'
          ? { ...(stackCard.entersBattlefieldWithCounters as Record<string, number>) }
          : {},
      attachments: [],
      card: this.sanitizeSpellCardAfterStackExit(stackCard),
    } as any;

    return {
      ...(state as any),
      battlefield: [...((state.battlefield || []) as any[]), permanent],
    } as any;
  }
