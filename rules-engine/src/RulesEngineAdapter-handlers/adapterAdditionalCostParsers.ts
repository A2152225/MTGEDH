// Origin parent: rules-engine/src/RulesEngineAdapter.ts
// Cluster moved: additional-cost eligibility + description parsers
// (discard/sacrifice/exile/tap/counter filters and parse*FromDescription).
// Public entry symbols: normalizeGraveyardAdditionalCostFilter, cardMatchesAdditionalCostFilter,
// getEligibleDiscardCards, getEligibleSacrificePermanents, getEligibleGraveyardExileCards,
// getEligibleCounterRemovalPermanents, totalRemovableCountersOnPermanent,
// removeCountersFromEligiblePermanents, parseLifeAmountFromCostDescription, parseCountToken,
// parseTapCostFromDescription, parseDiscardCostFromDescription, parseSacrificeCostFromDescription,
// parseCounterRemovalFromCostDescription, parseExileCostFromDescription.
// Class methods become thin wrappers that call these via .call(this, ...).
// Leaf must not import RulesEngineAdapter.ts or RulesEngineAdapter-handlers/index.ts.

import type { GameState } from '../../../shared/src';

/** Adapter instance passed as `this` from RulesEngineAdapter thin wrappers. */
export type AdapterAdditionalCostParserHost = any;

export function normalizeGraveyardAdditionalCostFilter(filterText?: string): string[] {
    const normalized = String(filterText || '')
      .toLowerCase()
      .replace(/\bcards?\b/g, '')
      .replace(/\bpermanents?\b/g, '')
      .replace(/\byou control\b/g, '')
      .replace(/\bcontrol\b/g, '')
      .replace(/\bfrom among\b/g, '')
      .replace(/\bother\b/g, '')
      .replace(/\band\/or\b/g, ' or ')
      .replace(/,/g, ' or ')
      .replace(/\bcreatures\b/g, 'creature')
      .replace(/\bartifacts\b/g, 'artifact')
      .replace(/\benchantments\b/g, 'enchantment')
      .replace(/\bplaneswalkers\b/g, 'planeswalker')
      .replace(/\blands\b/g, 'land')
      .replace(/\binstants\b/g, 'instant')
      .replace(/\bsorceries\b/g, 'sorcery')
      .replace(/\bbattles\b/g, 'battle')
      .replace(/\s+/g, ' ')
      .trim();
    if (!normalized) return [];
    return normalized
      .split(/\bor\b/g)
      .map(part => part.replace(/^(?:a|an)\s+/i, '').trim())
      .filter(Boolean);
  }

export function cardMatchesAdditionalCostFilter(cardLike: any, filterText?: string): boolean {
    const terms = this.normalizeGraveyardAdditionalCostFilter(filterText);
    if (terms.length === 0) return true;

    const typeLine = String(cardLike?.type_line || cardLike?.card?.type_line || '').toLowerCase();
    const isToken = Boolean(cardLike?.isToken || cardLike?.card?.isToken || typeLine.includes('token'));

    return terms.some(term => {
      if (term === 'card') return true;
      if (term === 'token') return isToken;
      return typeLine.includes(term);
    });
  }

export function getEligibleDiscardCards(state: GameState, playerId: string, filterText?: string): any[] {
    const player = state.players.find(p => p.id === playerId) as any;
    if (!player) return [];
    const hand = Array.isArray(player.hand) ? player.hand : [];
    return hand.filter((card: any) => this.cardMatchesAdditionalCostFilter(card, filterText));
  }

export function getEligibleSacrificePermanents(state: GameState, playerId: string, filterText?: string): any[] {
    const battlefield = Array.isArray((state as any).battlefield) ? ((state as any).battlefield as any[]) : [];
    return battlefield.filter(
      (perm: any) =>
        String(perm?.controller || '').trim() === playerId &&
        this.cardMatchesAdditionalCostFilter(perm, filterText)
    );
  }

export function getEligibleGraveyardExileCards(state: GameState, playerId: string): any[] {
    const player = state.players.find(p => p.id === playerId) as any;
    if (!player) return [];
    return Array.isArray(player.graveyard) ? [...player.graveyard] : [];
  }

export function getEligibleCounterRemovalPermanents(
    state: GameState,
    playerId: string,
    filterText?: string,
    counter?: string
  ): any[] {
    const battlefield = Array.isArray((state as any).battlefield) ? ((state as any).battlefield as any[]) : [];
    return battlefield.filter((perm: any) => {
      if (String(perm?.controller || '').trim() !== playerId) return false;
      if (!this.cardMatchesAdditionalCostFilter(perm, filterText)) return false;

      const counters = (perm?.counters || {}) as Record<string, number>;
      if (counter) {
        return Number(counters[counter] ?? 0) > 0;
      }

      return Object.values(counters).some((value) => Number(value) > 0);
    });
  }

export function totalRemovableCountersOnPermanent(perm: any, counter?: string): number {
    const counters = (perm?.counters || {}) as Record<string, number>;
    if (counter) {
      return Math.max(0, Number(counters[counter] ?? 0) || 0);
    }
    return Object.values(counters).reduce((total, value) => total + Math.max(0, Number(value) || 0), 0);
  }

export function removeCountersFromEligiblePermanents(
    state: GameState,
    playerId: string,
    amount: number,
    filterText?: string,
    counter?: string
  ): { success: boolean; state: GameState; log: string[] } {
    const totalAmount = Math.max(0, Number(amount) || 0);
    if (totalAmount <= 0) {
      return { success: true, state, log: [] };
    }

    const battlefield = Array.isArray((state as any).battlefield) ? ((state as any).battlefield as any[]) : [];
    const eligible = this.getEligibleCounterRemovalPermanents(state, playerId, filterText, counter);
    const totalAvailable = eligible.reduce((sum, perm) => sum + this.totalRemovableCountersOnPermanent(perm, counter), 0);
    if (totalAvailable < totalAmount) {
      return { success: false, state, log: [] };
    }

    let remaining = totalAmount;
    const eligibleIds = new Set(eligible.map((perm: any) => String(perm?.id || perm?.cardId || '').trim()).filter(Boolean));
    const nextBattlefield = battlefield.map((perm: any) => {
      if (remaining <= 0) return perm;
      if (String(perm?.controller || '').trim() !== playerId) return perm;
      const permanentId = String(perm?.id || perm?.cardId || '').trim();
      if (!eligibleIds.has(permanentId)) return perm;

      const currentCounters = { ...((perm?.counters || {}) as Record<string, number>) };
      const counterNames = counter ? [counter] : Object.keys(currentCounters).sort();
      let changed = false;

      for (const counterName of counterNames) {
        const currentValue = Math.max(0, Number(currentCounters[counterName] ?? 0) || 0);
        if (currentValue <= 0) continue;

        const removed = Math.min(currentValue, remaining);
        const nextValue = currentValue - removed;
        remaining -= removed;
        changed = true;

        if (nextValue > 0) {
          currentCounters[counterName] = nextValue;
        } else {
          delete currentCounters[counterName];
        }

        if (remaining <= 0) break;
      }

      return changed ? { ...perm, counters: currentCounters } : perm;
    });

    if (remaining > 0) {
      return { success: false, state, log: [] };
    }

    return {
      success: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: [counter ? `${playerId} removes ${totalAmount} ${counter} counter(s)` : `${playerId} removes ${totalAmount} counter(s)`],
    };
  }

export function parseLifeAmountFromCostDescription(description?: string): number {
    const match = String(description || '').match(/pay\s+(\d+)\s+life/i);
    return Math.max(0, Number(match?.[1] || 0) || 0);
  }

export function parseCountToken(token: unknown, defaultValue = 1): number {
    const text = String(token || '').trim().toLowerCase();
    if (!text) return defaultValue;
    if (text === 'a' || text === 'an') return 1;
    const wordCounts: Record<string, number> = {
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
    if (Object.prototype.hasOwnProperty.call(wordCounts, text)) {
      return wordCounts[text];
    }
    const numeric = Number(text);
    return Math.max(0, Number.isFinite(numeric) ? numeric : defaultValue);
  }

export function parseTapCostFromDescription(description?: string): { count: number; filterText?: string; selfOnly: boolean } {
    const normalized = String(description || '').trim();
    if (!normalized) return { count: 1, filterText: undefined, selfOnly: true };

    const selfMatch = normalized.match(/^tap\s+(this .+)$/i);
    if (selfMatch) {
      return {
        count: 1,
        filterText: String(selfMatch[1] || '').trim(),
        selfOnly: true,
      };
    }

    const countPattern = '(a|an|\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)';
    const match = normalized.match(new RegExp(`^tap\\s+${countPattern}\\s+(.+)$`, 'i'));
    if (!match) {
      return { count: 1, filterText: undefined, selfOnly: false };
    }

    const rawFilter = String(match[2] || '').trim();
    return {
      count: this.parseCountToken(match[1], 1),
      filterText: rawFilter
        .replace(/\buntapped\b/gi, '')
        .replace(/\byou control\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim() || undefined,
      selfOnly: false,
    };
  }

export function parseDiscardCostFromDescription(description?: string): { count: number; filterText?: string } {
    const match = String(description || '').match(/discard\s+(a|an|\d+)\s+(.+)/i);
    const rawFilter = String(match?.[2] || '').trim();
    return {
      count: this.parseCountToken(match?.[1], 1),
      filterText: rawFilter
        .replace(/card\(s\)/gi, '')
        .replace(/\bcards?\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim() || undefined,
    };
  }

export function parseSacrificeCostFromDescription(description?: string): { count: number; filterText?: string } {
    const match = String(description || '').match(/sacrifice\s+(a|an|\d+)\s+(.+)/i);
    if (match) {
      const rawFilter = String(match[2] || '').trim();
      return {
        count: this.parseCountToken(match[1], 1),
        filterText: rawFilter
          .replace(/permanent\(s\)/gi, '')
          .replace(/\bpermanents?\b/gi, '')
          .replace(/\s+/g, ' ')
          .trim() || undefined,
      };
    }

    const selfMatch = String(description || '').match(/sacrifice\s+(this .+)/i);
    return {
      count: 1,
      filterText: selfMatch ? String(selfMatch[1] || '').trim() : undefined,
    };
  }

export function parseCounterRemovalFromCostDescription(description?: string): { count: number; counter?: string; filterText?: string } {
    const match = String(description || '').match(/remove\s+(a|an|\d+)\s+(.+?)\s+counter\(s\)(?:\s+from\s+(.+))?/i);
    return {
      count: this.parseCountToken(match?.[1], 1),
      counter: String(match?.[2] || '').trim() || undefined,
      filterText: String(match?.[3] || '').trim() || undefined,
    };
  }

export function parseExileCostFromDescription(description?: string): { count: number; filterText?: string } {
    const match = String(description || '').match(/exile\s+(a|an|\d+)\s+(.+)/i);
    if (match) {
      return {
        count: this.parseCountToken(match?.[1], 1),
        filterText: String(match?.[2] || '').trim() || undefined,
      };
    }

    return { count: 1, filterText: undefined };
  }
