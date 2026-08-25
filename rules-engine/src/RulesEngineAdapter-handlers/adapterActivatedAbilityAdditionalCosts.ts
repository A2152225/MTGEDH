// Origin parent: rules-engine/src/RulesEngineAdapter.ts
// Cluster moved: activated-ability additional-cost family
// (resolve/pay discard, tap, sacrifice, counter, exile, reveal + graveyard extras).
// Public entry symbols: resolveActivatedAbilityDiscardCards, getEligibleTapPermanents,
// resolveActivatedAbilityTapPermanents, resolveActivatedAbilitySacrificePermanents,
// resolveActivatedAbilityCounterRemovals, applyActivatedAbilityCounterRemovals,
// resolveActivatedAbilityExileSelection, applyActivatedAbilityExileSelection,
// canPayActivatedAbilityAdditionalCosts, payActivatedAbilityAdditionalCosts,
// resolveActivatedAbilityRevealCards, canPayGraveyardAdditionalCost,
// payGraveyardAdditionalCost.
// Class methods become thin wrappers that call these via .call(this, ...).
// Leaf must not import RulesEngineAdapter.ts or RulesEngineAdapter-handlers/index.ts.

import type { GameState } from '../../../shared/src';
import { buildZoneObjectWithRetainedCounters } from '../../../shared/src/zoneRetainedCounters';
import { CostType } from '../types/costs';
import type { ActivatedAbility } from '../activatedAbilities';
import { movePermanentToGraveyard } from '../rulesEngineAdapterStateSupport';

/** Adapter instance passed as `this` from RulesEngineAdapter thin wrappers. */
export type AdapterActivatedAbilityAdditionalCostsHost = any;

export function resolveActivatedAbilityDiscardCards(
    this: AdapterActivatedAbilityAdditionalCostsHost,
    state: GameState,
    playerId: string,
    action: any,
    count: number,
    filterText?: string
  ): any[] {
    const player = state.players.find(p => p.id === playerId) as any;
    const hand = Array.isArray(player?.hand) ? player.hand : [];
    const eligible = hand.filter((card: any) => this.cardMatchesAdditionalCostFilter(card, filterText));
    const explicitIds = Array.isArray(action?.additionalCostCardIds)
      ? action.additionalCostCardIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
      : [];

    if (explicitIds.length > 0) {
      const selected = eligible.filter((card: any) => explicitIds.includes(String(card?.id || card?.cardId || '').trim()));
      return selected.length === count ? selected : [];
    }

    if (eligible.length === count) return eligible.slice(0, count);
    if (count === 1 && eligible.length === 1) return eligible.slice(0, 1);
    return [];
  }

export function getEligibleTapPermanents(this: AdapterActivatedAbilityAdditionalCostsHost, state: GameState, playerId: string, filterText?: string): any[] {
    const battlefield = Array.isArray((state as any).battlefield) ? ((state as any).battlefield as any[]) : [];
    return battlefield.filter(
      (perm: any) =>
        String(perm?.controller || '').trim() === playerId &&
        !Boolean(perm?.tapped) &&
        this.cardMatchesAdditionalCostFilter(perm, filterText)
    );
  }

export function resolveActivatedAbilityTapPermanents(
    this: AdapterActivatedAbilityAdditionalCostsHost,
    state: GameState,
    playerId: string,
    ability: ActivatedAbility,
    action: any,
    description?: string
  ): any[] {
    const battlefield = Array.isArray((state as any).battlefield) ? ((state as any).battlefield as any[]) : [];
    const sourceId = String(ability.sourceId || '').trim();
    const sourcePermanent = battlefield.find((perm: any) => String(perm?.id || '').trim() === sourceId);
    const parsed = this.parseTapCostFromDescription(description);
    const explicitIds = Array.isArray(action?.additionalCostPermanentIds)
      ? action.additionalCostPermanentIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
      : [];
    const eligible = this.getEligibleTapPermanents(state, playerId, parsed.filterText);

    if (parsed.selfOnly) {
      if (
        sourcePermanent &&
        !Boolean(sourcePermanent?.tapped) &&
        String(sourcePermanent?.controller || '').trim() === playerId
      ) {
        return [sourcePermanent];
      }
      return [];
    }

    if (explicitIds.length > 0) {
      const explicitSet = new Set(explicitIds);
      if (explicitSet.size !== parsed.count) return [];
      const selected = eligible.filter((perm: any) => explicitSet.has(String(perm?.id || perm?.cardId || '').trim()));
      return selected.length === parsed.count ? selected : [];
    }

    if (
      parsed.count === 1 &&
      sourcePermanent &&
      !Boolean(sourcePermanent?.tapped) &&
      String(sourcePermanent?.controller || '').trim() === playerId &&
      this.cardMatchesAdditionalCostFilter(sourcePermanent, parsed.filterText)
    ) {
      return [sourcePermanent];
    }

    return eligible.length === parsed.count ? eligible.slice(0, parsed.count) : [];
  }

export function resolveActivatedAbilitySacrificePermanents(
    this: AdapterActivatedAbilityAdditionalCostsHost,
    state: GameState,
    playerId: string,
    ability: ActivatedAbility,
    action: any,
    count: number,
    description?: string
  ): any[] {
    const battlefield = Array.isArray((state as any).battlefield) ? ((state as any).battlefield as any[]) : [];
    const sourceId = String(ability.sourceId || '').trim();
    const explicitIds = Array.isArray(action?.additionalCostPermanentIds)
      ? action.additionalCostPermanentIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
      : [];

    const descriptionText = String(description || '').trim().toLowerCase();
    const sourcePermanent = battlefield.find((perm: any) => String(perm?.id || '').trim() === sourceId);
    const parsed = this.parseSacrificeCostFromDescription(description);
    const filterText = parsed.filterText;
    const eligible = this.getEligibleSacrificePermanents(state, playerId, filterText);

    if (explicitIds.length > 0) {
      const explicitSet = new Set(explicitIds);
      const selected = eligible.filter((perm: any) => explicitSet.has(String(perm?.id || perm?.cardId || '').trim()));
      return selected.length === count ? selected : [];
    }

    if (descriptionText.includes('this permanent') || descriptionText.includes('this creature') || descriptionText.includes('this artifact')) {
      return count === 1 && sourcePermanent ? [sourcePermanent] : [];
    }

    if (count === 1 && sourcePermanent && eligible.length === 1) {
      return [sourcePermanent];
    }

    return eligible.length === count ? eligible.slice(0, count) : [];
  }

export function resolveActivatedAbilityCounterRemovals(
    this: AdapterActivatedAbilityAdditionalCostsHost,
    state: GameState,
    playerId: string,
    ability: ActivatedAbility,
    action: any,
    count: number,
    counter?: string,
    filterText?: string
  ): Array<{ permanentId: string; count: number }> {
    const sourceId = String(ability.sourceId || '').trim();
    const battlefield = Array.isArray((state as any).battlefield) ? ((state as any).battlefield as any[]) : [];
    const explicitIds = Array.isArray(action?.additionalCostPermanentIds)
      ? action.additionalCostPermanentIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
      : [];

    if (explicitIds.length > 0) {
      const requested = new Map<string, number>();
      for (const id of explicitIds) {
        requested.set(id, (requested.get(id) || 0) + 1);
      }

      const totalRequested = Array.from(requested.values()).reduce((sum, value) => sum + value, 0);
      if (totalRequested !== count) return [];

      const removals: Array<{ permanentId: string; count: number }> = [];
      for (const [permanentId, requestedCount] of requested.entries()) {
        const perm = battlefield.find((entry: any) => String(entry?.id || entry?.cardId || '').trim() === permanentId);
        if (!perm || String(perm?.controller || '').trim() !== playerId) return [];
        if (!this.cardMatchesAdditionalCostFilter(perm, filterText)) return [];
        if (this.totalRemovableCountersOnPermanent(perm, counter) < requestedCount) return [];
        removals.push({ permanentId, count: requestedCount });
      }
      return removals;
    }

    const sourcePermanent = battlefield.find((perm: any) => String(perm?.id || '').trim() === sourceId);
    if (sourcePermanent && String(sourcePermanent?.controller || '').trim() === playerId) {
      if (!this.cardMatchesAdditionalCostFilter(sourcePermanent, filterText)) {
        return [];
      }
      const sourceAvailable = this.totalRemovableCountersOnPermanent(sourcePermanent, counter);
      if (sourceAvailable >= count) {
        return [{ permanentId: sourceId, count }];
      }
    }

    const eligible = this.getEligibleCounterRemovalPermanents(state, playerId, filterText, counter);
    const totalAvailable = eligible.reduce((sum, perm) => sum + this.totalRemovableCountersOnPermanent(perm, counter), 0);
    if (totalAvailable < count) return [];
    if (eligible.length !== 1 && totalAvailable !== count) return [];

    let remaining = count;
    const removals: Array<{ permanentId: string; count: number }> = [];
    for (const perm of eligible) {
      if (remaining <= 0) break;
      const available = this.totalRemovableCountersOnPermanent(perm, counter);
      if (available <= 0) continue;
      const removed = Math.min(available, remaining);
      removals.push({ permanentId: String(perm?.id || perm?.cardId || '').trim(), count: removed });
      remaining -= removed;
    }

    return remaining === 0 ? removals : [];
  }

export function applyActivatedAbilityCounterRemovals(
    this: AdapterActivatedAbilityAdditionalCostsHost,
    state: GameState,
    removals: Array<{ permanentId: string; count: number }>,
    counter?: string
  ): GameState {
    const removalCounts = new Map<string, number>();
    for (const removal of removals) {
      removalCounts.set(removal.permanentId, (removalCounts.get(removal.permanentId) || 0) + removal.count);
    }

    const nextBattlefield = (Array.isArray((state as any).battlefield) ? ((state as any).battlefield as any[]) : []).map((perm: any) => {
      const permanentId = String(perm?.id || perm?.cardId || '').trim();
      const requested = removalCounts.get(permanentId) || 0;
      if (requested <= 0) return perm;

      const currentCounters = { ...((perm?.counters || {}) as Record<string, number>) };
      const counterNames = counter ? [counter] : Object.keys(currentCounters).sort();
      let remaining = requested;

      for (const counterName of counterNames) {
        if (remaining <= 0) break;
        const currentValue = Math.max(0, Number(currentCounters[counterName] ?? 0) || 0);
        if (currentValue <= 0) continue;
        const removed = Math.min(currentValue, remaining);
        const nextValue = currentValue - removed;
        remaining -= removed;
        if (nextValue > 0) {
          currentCounters[counterName] = nextValue;
        } else {
          delete currentCounters[counterName];
        }
      }

      return { ...perm, counters: currentCounters };
    });

    return { ...(state as any), battlefield: nextBattlefield } as GameState;
  }

export function resolveActivatedAbilityExileSelection(
    this: AdapterActivatedAbilityAdditionalCostsHost,
    state: GameState,
    playerId: string,
    ability: ActivatedAbility,
    action: any,
    count: number,
    description?: string
  ): { permanentIds: string[]; handIds: string[]; graveyardIds: string[] } {
    const player = state.players.find(p => p.id === playerId) as any;
    if (!player) {
      return { permanentIds: [], handIds: [], graveyardIds: [] };
    }

    const battlefield = Array.isArray((state as any).battlefield) ? ((state as any).battlefield as any[]) : [];
    const sourceId = String(ability.sourceId || '').trim();
    const sourcePermanent = battlefield.find((perm: any) => String(perm?.id || '').trim() === sourceId);
    const descriptionText = String(description || '').trim().toLowerCase();

    const explicitPermanentIds = Array.isArray(action?.additionalCostPermanentIds)
      ? action.additionalCostPermanentIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
      : [];
    const explicitCardIds = Array.isArray(action?.additionalCostCardIds)
      ? action.additionalCostCardIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
      : [];

    if (explicitPermanentIds.length > 0 || explicitCardIds.length > 0) {
      const controlledBattlefieldIds = new Set(
        battlefield
          .filter((perm: any) => String(perm?.controller || '').trim() === playerId)
          .map((perm: any) => String(perm?.id || perm?.cardId || '').trim())
          .filter(Boolean)
      );
      const handIds = new Set((Array.isArray(player.hand) ? player.hand : []).map((card: any) => String(card?.id || card?.cardId || '').trim()).filter(Boolean));
      const graveyardIds = new Set((Array.isArray(player.graveyard) ? player.graveyard : []).map((card: any) => String(card?.id || card?.cardId || '').trim()).filter(Boolean));

      const selectedPermanentIds = explicitPermanentIds.filter(id => controlledBattlefieldIds.has(id));
      const selectedHandIds = explicitCardIds.filter(id => handIds.has(id));
      const selectedGraveyardIds = explicitCardIds.filter(id => graveyardIds.has(id));
      const totalSelected = selectedPermanentIds.length + selectedHandIds.length + selectedGraveyardIds.length;
      if (totalSelected !== count) {
        return { permanentIds: [], handIds: [], graveyardIds: [] };
      }

      return {
        permanentIds: selectedPermanentIds,
        handIds: selectedHandIds,
        graveyardIds: selectedGraveyardIds,
      };
    }

    if ((descriptionText.includes('this permanent') || descriptionText.includes('this creature') || descriptionText.includes('this artifact')) && count === 1) {
      if (sourcePermanent && String(sourcePermanent?.controller || '').trim() === playerId) {
        return { permanentIds: [sourceId], handIds: [], graveyardIds: [] };
      }
    }

    if (descriptionText.includes('this card') && count === 1) {
      const sourceZone = String(ability.sourceZone || '').trim().toLowerCase();
      if (sourceZone === 'hand') {
        const sourceCard = (Array.isArray(player.hand) ? player.hand : []).find(
          (card: any) => String(card?.id || card?.cardId || '').trim() === sourceId
        );
        if (sourceCard) {
          return { permanentIds: [], handIds: [sourceId], graveyardIds: [] };
        }
      }

      if (sourceZone === 'graveyard') {
        const sourceCard = (Array.isArray(player.graveyard) ? player.graveyard : []).find(
          (card: any) => String(card?.id || card?.cardId || '').trim() === sourceId
        );
        if (sourceCard) {
          return { permanentIds: [], handIds: [], graveyardIds: [sourceId] };
        }
      }
    }

    const zoneCards =
      descriptionText.includes('graveyard')
        ? (Array.isArray(player.graveyard) ? player.graveyard : [])
        : descriptionText.includes('hand')
          ? (Array.isArray(player.hand) ? player.hand : [])
          : [];
    if (zoneCards.length === count) {
      const ids = zoneCards.map((card: any) => String(card?.id || card?.cardId || '').trim()).filter(Boolean);
      return descriptionText.includes('graveyard')
        ? { permanentIds: [], handIds: [], graveyardIds: ids }
        : { permanentIds: [], handIds: ids, graveyardIds: [] };
    }

    return { permanentIds: [], handIds: [], graveyardIds: [] };
  }

export function applyActivatedAbilityExileSelection(
    this: AdapterActivatedAbilityAdditionalCostsHost,
    state: GameState,
    playerId: string,
    selection: { permanentIds: string[]; handIds: string[]; graveyardIds: string[] }
  ): GameState {
    const permanentIdSet = new Set(selection.permanentIds);
    const handIdSet = new Set(selection.handIds);
    const graveyardIdSet = new Set(selection.graveyardIds);
    const battlefield = Array.isArray((state as any).battlefield) ? ((state as any).battlefield as any[]) : [];

    const exiledPermanents = battlefield.filter((perm: any) => permanentIdSet.has(String(perm?.id || perm?.cardId || '').trim()));
    const nextBattlefield = battlefield.filter((perm: any) => !permanentIdSet.has(String(perm?.id || perm?.cardId || '').trim()));

    const nextPlayers = state.players.map((player: any) => {
      const ownedExiledPermanents = exiledPermanents
        .filter((perm: any) => String(perm?.controller || perm?.owner || '').trim() === String(player.id || '').trim())
        .map((perm: any) => buildZoneObjectWithRetainedCounters(perm.card || perm, perm, 'exile'));

      if (player.id !== playerId) {
        return ownedExiledPermanents.length > 0
          ? { ...player, exile: [...(Array.isArray(player.exile) ? player.exile : []), ...ownedExiledPermanents] }
          : player;
      }

      const hand = Array.isArray(player.hand) ? player.hand : [];
      const graveyard = Array.isArray(player.graveyard) ? player.graveyard : [];
      const exiledHandCards = hand
        .filter((card: any) => handIdSet.has(String(card?.id || card?.cardId || '').trim()))
        .map((card: any) => this.sanitizeSpellCardAfterStackExit(card));
      const exiledGraveyardCards = graveyard
        .filter((card: any) => graveyardIdSet.has(String(card?.id || card?.cardId || '').trim()))
        .map((card: any) => this.sanitizeSpellCardAfterStackExit(card));

      return {
        ...player,
        hand: hand.filter((card: any) => !handIdSet.has(String(card?.id || card?.cardId || '').trim())),
        graveyard: graveyard.filter((card: any) => !graveyardIdSet.has(String(card?.id || card?.cardId || '').trim())),
        exile: [
          ...(Array.isArray(player.exile) ? player.exile : []),
          ...exiledHandCards,
          ...exiledGraveyardCards,
          ...ownedExiledPermanents,
        ],
      };
    });

    return { ...(state as any), battlefield: nextBattlefield, players: nextPlayers } as GameState;
  }

export function canPayActivatedAbilityAdditionalCosts(this: AdapterActivatedAbilityAdditionalCostsHost, state: GameState, playerId: string, ability: ActivatedAbility, action?: any): boolean {
    const additionalCosts = Array.isArray(ability.additionalCosts) ? ability.additionalCosts : [];
    if (additionalCosts.length === 0) return true;

    const battlefield = Array.isArray((state as any).battlefield) ? ((state as any).battlefield as any[]) : [];
    const sourcePermanent = battlefield.find((perm: any) => String(perm?.id || '').trim() === String(ability.sourceId || '').trim());
    const player = state.players.find(p => p.id === playerId) as any;

    for (const cost of additionalCosts) {
      if (!cost || typeof cost !== 'object') continue;

      if (cost.type === CostType.TAP) {
        if (this.resolveActivatedAbilityTapPermanents(state, playerId, ability, action, cost.description).length <= 0) return false;
        continue;
      }

      if (cost.type === CostType.UNTAP) {
        if (!sourcePermanent || !Boolean(sourcePermanent?.tapped)) return false;
        continue;
      }

      if (cost.type === CostType.LIFE) {
        const amount = this.parseLifeAmountFromCostDescription(cost.description);
        if (!player || Number(player.life || 0) <= amount) return false;
        continue;
      }

      if (cost.type === CostType.DISCARD) {
        const parsed = this.parseDiscardCostFromDescription(cost.description);
        const count = Math.max(1, Number((cost as any).count || 0) || parsed.count);
        const filterText = String((cost as any).filterText || parsed.filterText || '').trim() || undefined;
        if (this.resolveActivatedAbilityDiscardCards(state, playerId, action, count, filterText).length !== count) return false;
        continue;
      }

      if (cost.type === CostType.SACRIFICE) {
        const parsed = this.parseSacrificeCostFromDescription(cost.description);
        const count = Math.max(1, Number((cost as any).count || 0) || parsed.count);
        if (this.resolveActivatedAbilitySacrificePermanents(state, playerId, ability, action, count, cost.description).length !== count) return false;
        continue;
      }

      if (cost.type === CostType.REMOVE_COUNTER) {
        const parsed = this.parseCounterRemovalFromCostDescription(cost.description);
        const count = Math.max(1, Number((cost as any).count || 0) || parsed.count);
        const counter = String((cost as any).counterType || parsed.counter || '').trim() || undefined;
        const filterText = String((cost as any).filterText || parsed.filterText || '').trim() || undefined;
        const removals = this.resolveActivatedAbilityCounterRemovals(state, playerId, ability, action, count, counter, filterText);
        if (removals.reduce((sum, removal) => sum + removal.count, 0) !== count) return false;
        continue;
      }

      if (cost.type === CostType.EXILE) {
        const parsed = this.parseExileCostFromDescription(cost.description);
        const count = Math.max(1, Number((cost as any).count || 0) || parsed.count);
        const selection = this.resolveActivatedAbilityExileSelection(state, playerId, ability, action, count, cost.description);
        if (selection.permanentIds.length + selection.handIds.length + selection.graveyardIds.length !== count) return false;
        continue;
      }

      if (cost.type === CostType.REVEAL) {
        const revealCards = this.resolveActivatedAbilityRevealCards(state, playerId, ability, action, cost.description);
        if (revealCards.length <= 0) return false;
      }
    }

    return true;
  }

export function payActivatedAbilityAdditionalCosts(
    this: AdapterActivatedAbilityAdditionalCostsHost,
    state: GameState,
    playerId: string,
    ability: ActivatedAbility,
    action?: any
  ): { success: boolean; state: GameState; log: string[]; tappedSource?: boolean } {
    const additionalCosts = Array.isArray(ability.additionalCosts) ? ability.additionalCosts : [];
    if (additionalCosts.length === 0) return { success: true, state, log: [] };

    let nextState = state;
    const log: string[] = [];
    let tappedSource = false;

    for (const cost of additionalCosts) {
      if (!cost || typeof cost !== 'object') continue;

      if (cost.type === CostType.TAP) {
        const tappedPermanents = this.resolveActivatedAbilityTapPermanents(nextState, playerId, ability, action, cost.description);
        if (tappedPermanents.length <= 0) {
          return { success: false, state, log: [] };
        }

        const sourceId = String(ability.sourceId || '').trim();
        const tappedIds = new Set(
          tappedPermanents.map((perm: any) => String(perm?.id || perm?.cardId || '').trim()).filter(Boolean)
        );
        const battlefield = Array.isArray((nextState as any).battlefield) ? ((nextState as any).battlefield as any[]) : [];
        const updatedBattlefield = battlefield.map((perm: any) =>
          tappedIds.has(String(perm?.id || '').trim()) ? { ...perm, tapped: true } : perm
        );
        nextState = { ...(nextState as any), battlefield: updatedBattlefield } as GameState;
        if (tappedIds.has(sourceId)) tappedSource = true;
        log.push(`${playerId} tapped ${tappedIds.size} permanent(s) to activate ${ability.sourceName}`);
        continue;
      }

      if (cost.type === CostType.UNTAP) {
        const sourceId = String(ability.sourceId || '').trim();
        const battlefield = Array.isArray((nextState as any).battlefield) ? ((nextState as any).battlefield as any[]) : [];
        const sourcePermanent = battlefield.find((perm: any) => String(perm?.id || '').trim() === sourceId);
        if (!sourcePermanent || !Boolean(sourcePermanent?.tapped)) {
          return { success: false, state, log: [] };
        }

        const updatedBattlefield = battlefield.map((perm: any) =>
          String(perm?.id || '').trim() === sourceId ? { ...perm, tapped: false } : perm
        );
        nextState = { ...(nextState as any), battlefield: updatedBattlefield } as GameState;
        log.push(`${ability.sourceName} was untapped to activate its ability`);
        continue;
      }

      if (cost.type === CostType.LIFE) {
        const amount = this.parseLifeAmountFromCostDescription(cost.description);
        if (amount <= 0) continue;
        const player = nextState.players.find(entry => entry.id === playerId) as any;
        if (!player || Number(player.life || 0) <= amount) {
          return { success: false, state, log: [] };
        }

        nextState = {
          ...(nextState as any),
          players: nextState.players.map((entry: any) =>
            entry.id === playerId
              ? { ...entry, life: Number(entry.life || 0) - amount }
              : entry
          ),
        } as GameState;
        log.push(`${playerId} paid ${amount} life`);
        continue;
      }

      if (cost.type === CostType.DISCARD) {
        const parsed = this.parseDiscardCostFromDescription(cost.description);
        const count = Math.max(1, Number((cost as any).count || 0) || parsed.count);
        const filterText = String((cost as any).filterText || parsed.filterText || '').trim() || undefined;
        const cards = this.resolveActivatedAbilityDiscardCards(nextState, playerId, action, count, filterText);
        if (cards.length !== count) {
          return { success: false, state, log: [] };
        }

        const discardIds = new Set(cards.map((card: any) => String(card?.id || card?.cardId || '').trim()).filter(Boolean));
        nextState = {
          ...(nextState as any),
          players: nextState.players.map((entry: any) => {
            if (entry.id !== playerId) return entry;
            const hand = Array.isArray(entry.hand) ? entry.hand : [];
            const keptHand = hand.filter((card: any) => !discardIds.has(String(card?.id || card?.cardId || '').trim()));
            const discarded = hand.filter((card: any) => discardIds.has(String(card?.id || card?.cardId || '').trim()));
            return {
              ...entry,
              hand: keptHand,
              graveyard: [...(Array.isArray(entry.graveyard) ? entry.graveyard : []), ...discarded],
            };
          }),
        } as GameState;
        log.push(`${playerId} discarded ${count} card(s)`);
        continue;
      }

      if (cost.type === CostType.SACRIFICE) {
        const parsed = this.parseSacrificeCostFromDescription(cost.description);
        const count = Math.max(1, Number((cost as any).count || 0) || parsed.count);
        const permanents = this.resolveActivatedAbilitySacrificePermanents(nextState, playerId, ability, action, count, cost.description);
        if (permanents.length !== count) {
          return { success: false, state, log: [] };
        }

        for (const permanent of permanents) {
          nextState = movePermanentToGraveyard(nextState, permanent);
        }
        log.push(`${playerId} sacrificed ${count} permanent(s)`);
        continue;
      }

      if (cost.type === CostType.REMOVE_COUNTER) {
        const parsed = this.parseCounterRemovalFromCostDescription(cost.description);
        const count = Math.max(1, Number((cost as any).count || 0) || parsed.count);
        const counter = String((cost as any).counterType || parsed.counter || '').trim() || undefined;
        const filterText = String((cost as any).filterText || parsed.filterText || '').trim() || undefined;
        const removals = this.resolveActivatedAbilityCounterRemovals(nextState, playerId, ability, action, count, counter, filterText);
        if (removals.reduce((sum, removal) => sum + removal.count, 0) !== count) {
          return { success: false, state, log: [] };
        }

        nextState = this.applyActivatedAbilityCounterRemovals(nextState, removals, counter);
        log.push(counter ? `${playerId} removed ${count} ${counter} counter(s)` : `${playerId} removed ${count} counter(s)`);
        continue;
      }

      if (cost.type === CostType.EXILE) {
        const parsed = this.parseExileCostFromDescription(cost.description);
        const count = Math.max(1, Number((cost as any).count || 0) || parsed.count);
        const selection = this.resolveActivatedAbilityExileSelection(nextState, playerId, ability, action, count, cost.description);
        if (selection.permanentIds.length + selection.handIds.length + selection.graveyardIds.length !== count) {
          return { success: false, state, log: [] };
        }

        nextState = this.applyActivatedAbilityExileSelection(nextState, playerId, selection);
        log.push(`${playerId} exiled ${count} object(s)`);
        continue;
      }

      if (cost.type === CostType.REVEAL) {
        const revealCards = this.resolveActivatedAbilityRevealCards(nextState, playerId, ability, action, cost.description);
        if (revealCards.length <= 0) {
          return { success: false, state, log: [] };
        }

        log.push(`${playerId} revealed ${revealCards.length} card(s)`);
      }
    }

    return { success: true, state: nextState, log, tappedSource };
  }

export function resolveActivatedAbilityRevealCards(
    this: AdapterActivatedAbilityAdditionalCostsHost,
    state: GameState,
    playerId: string,
    ability: ActivatedAbility,
    action: any,
    description: string
  ): any[] {
    const player = state.players.find(p => p.id === playerId) as any;
    if (!player) return [];

    const hand = Array.isArray(player.hand) ? player.hand : [];
    const descriptionText = String(description || '').trim().toLowerCase();
    const explicitCardIds = Array.isArray(action?.additionalCostCardIds)
      ? action.additionalCostCardIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
      : [];
    if (explicitCardIds.length > 0) {
      const revealable = hand.filter((card: any) =>
        explicitCardIds.includes(String(card?.id || card?.cardId || '').trim())
      );
      return revealable.length === explicitCardIds.length ? revealable : [];
    }

    if (
      descriptionText.includes('this card') &&
      String(ability.sourceZone || '').trim().toLowerCase() === 'hand'
    ) {
      const sourceId = String(ability.sourceId || '').trim();
      const sourceCard = hand.find((card: any) => String(card?.id || card?.cardId || '').trim() === sourceId);
      return sourceCard ? [sourceCard] : [];
    }

    return [];
  }

export function canPayGraveyardAdditionalCost(this: AdapterActivatedAbilityAdditionalCostsHost, state: GameState, playerId: string, cost: any): boolean {
    if (!cost || typeof cost !== 'object') return true;
    if (cost.kind === 'discard') {
      return this.getEligibleDiscardCards(state, playerId, cost.filterText).length >= Number(cost.count || 0);
    }
    if (cost.kind === 'sacrifice') {
      return this.getEligibleSacrificePermanents(state, playerId, cost.filterText).length >= Number(cost.count || 0);
    }
    if (cost.kind === 'exile_from_graveyard') {
      return this.getEligibleGraveyardExileCards(state, playerId).length >= Number(cost.count || 0);
    }
    if (cost.kind === 'remove_counter') {
      if (cost.count === 'any') return true;
      return (
        this.getEligibleCounterRemovalPermanents(state, playerId, cost.filterText, cost.counter).reduce(
          (sum, perm) => sum + this.totalRemovableCountersOnPermanent(perm, cost.counter),
          0
        ) >= Number(cost.count || 0)
      );
    }
    return false;
  }

export function payGraveyardAdditionalCost(
    this: AdapterActivatedAbilityAdditionalCostsHost,
    state: GameState,
    playerId: string,
    cost: any
  ): { success: boolean; state: GameState; log: string[] } {
    if (!cost || typeof cost !== 'object') return { success: true, state, log: [] };

    if (cost.kind === 'discard') {
      const amount = Math.max(0, Number(cost.count) || 0);
      const cards = this.getEligibleDiscardCards(state, playerId, cost.filterText).slice(0, amount);
      if (cards.length < amount) return { success: false, state, log: [] };

      const discardIds = new Set(cards.map((card: any) => String(card?.id || card?.cardId || '').trim()).filter(Boolean));
      const updatedPlayers = state.players.map((player: any) => {
        if (player.id !== playerId) return player;
        const hand = Array.isArray(player.hand) ? player.hand : [];
        const keptHand = hand.filter((card: any) => !discardIds.has(String(card?.id || card?.cardId || '').trim()));
        const discarded = hand.filter((card: any) => discardIds.has(String(card?.id || card?.cardId || '').trim()));
        return {
          ...player,
          hand: keptHand,
          graveyard: [...(Array.isArray(player.graveyard) ? player.graveyard : []), ...discarded],
        };
      });

      return {
        success: true,
        state: { ...(state as any), players: updatedPlayers as any } as any,
        log: [`${playerId} discards ${amount} card(s)`],
      };
    }

    if (cost.kind === 'sacrifice') {
      const amount = Math.max(0, Number(cost.count) || 0);
      const permanents = this.getEligibleSacrificePermanents(state, playerId, cost.filterText).slice(0, amount);
      if (permanents.length < amount) return { success: false, state, log: [] };

      let nextState = state;
      for (const permanent of permanents) {
        nextState = movePermanentToGraveyard(nextState, permanent);
      }

      return {
        success: true,
        state: nextState,
        log: [`${playerId} sacrifices ${amount} permanent(s)`],
      };
    }

    if (cost.kind === 'exile_from_graveyard') {
      const amount = Math.max(0, Number(cost.count) || 0);
      const cards = this.getEligibleGraveyardExileCards(state, playerId).slice(0, amount);
      if (cards.length < amount) return { success: false, state, log: [] };

      const exileIds = new Set(cards.map((card: any) => String(card?.id || card?.cardId || '').trim()).filter(Boolean));
      const updatedPlayers = state.players.map((player: any) => {
        if (player.id !== playerId) return player;
        const graveyard = Array.isArray(player.graveyard) ? player.graveyard : [];
        const keptGraveyard = graveyard.filter((card: any) => !exileIds.has(String(card?.id || card?.cardId || '').trim()));
        const exiledCards = graveyard
          .filter((card: any) => exileIds.has(String(card?.id || card?.cardId || '').trim()))
          .map((card: any) => this.sanitizeSpellCardAfterStackExit(card));
        return {
          ...player,
          graveyard: keptGraveyard,
          exile: [...(Array.isArray(player.exile) ? player.exile : []), ...exiledCards],
        };
      });

      return {
        success: true,
        state: { ...(state as any), players: updatedPlayers as any } as any,
        log: [`${playerId} exiles ${amount} card(s) from their graveyard`],
      };
    }

    if (cost.kind === 'remove_counter') {
      if (cost.count === 'any') {
        return { success: true, state, log: [`${playerId} may remove any number of counters`].filter(Boolean) };
      }

      return this.removeCountersFromEligiblePermanents(
        state,
        playerId,
        Math.max(0, Number(cost.count) || 0),
        cost.filterText,
        cost.counter
      );
    }

    return { success: false, state, log: [] };
  }
  
