// Origin parent: rules-engine/src/RulesEngineAdapter.ts
// Cluster moved: getCardTypes, canPlayTopLibraryLand, canCastTopLibrarySpell, findSourceZoneCard.
// Public entry symbols: getCardTypes, canPlayTopLibraryLand, canCastTopLibrarySpell, findSourceZoneCard.
// Class methods become thin wrappers that call these via .call(this, ...).
// Leaf must not import RulesEngineAdapter.ts or RulesEngineAdapter-handlers/index.ts.

import type { GameState } from '../../../shared/src';

/** Adapter instance passed as `this` from RulesEngineAdapter thin wrappers. */
export type AdapterLibrarySourceHelpersHost = any;

  /**
   * Extract card types from a card object
   */
export function getCardTypes(card: any): string[] {
    if (!card) return [];
    
    const typeLine = card.type_line || card.typeLine || '';
    const types: string[] = [];
    
    // Parse type line (e.g., "Creature — Human Wizard" or "Instant")
    const mainTypes = typeLine.split('—')[0].toLowerCase();
    
    if (mainTypes.includes('creature')) types.push('creature');
    if (mainTypes.includes('instant')) types.push('instant');
    if (mainTypes.includes('sorcery')) types.push('sorcery');
    if (mainTypes.includes('artifact')) types.push('artifact');
    if (mainTypes.includes('enchantment')) types.push('enchantment');
    if (mainTypes.includes('planeswalker')) types.push('planeswalker');
    if (mainTypes.includes('land')) types.push('land');
    if (mainTypes.includes('battle')) types.push('battle');
    
    // Check for flash keyword
    const oracleText = (card.oracle_text || '').toLowerCase();
    if (oracleText.includes('flash')) {
      types.push('flash');
    }
    
    return types;
  }

export function canPlayTopLibraryLand(state: GameState, playerId: string): boolean {
    const stateAny: any = state as any;
    if (stateAny.topOfLibraryEffects?.[playerId]?.canPlayLands === true) {
      return true;
    }

    const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
    return battlefield.some((perm: any) => {
      if (perm?.controller !== playerId) return false;
      const oracleText = String(perm?.card?.oracle_text || perm?.oracle_text || '').toLowerCase();
      return oracleText.includes('play lands from the top of your library')
        || oracleText.includes('you may play the top card of your library');
    });
  }

export function canCastTopLibrarySpell(state: GameState, playerId: string, card?: any): boolean {
    const stateAny: any = state as any;
    if (!card && stateAny.topOfLibraryEffects?.[playerId]?.canCast === true) {
      return true;
    }

    const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
    const typeLine = String(card?.type_line || card?.typeLine || '').toLowerCase();
    const colors = Array.isArray(card?.colors)
      ? card.colors
      : (Array.isArray(card?.color_identity) ? card.color_identity : []);
    const isColorlessNonland = Boolean(card) && !typeLine.includes('land') && colors.length === 0;

    return battlefield.some((perm: any) => {
      if (perm?.controller !== playerId) return false;
      const name = String(perm?.card?.name || perm?.name || '').toLowerCase();
      const oracleText = String(perm?.card?.oracle_text || perm?.oracle_text || '').toLowerCase();

      if (!card) {
        return oracleText.includes('you may cast the top card of your library')
          || oracleText.includes('you may cast spells from the top of your library')
          || oracleText.includes('you may play the top card of your library');
      }

      if (name.includes('mystic forge')) {
        return typeLine.includes('artifact') || isColorlessNonland;
      }
      if (name.includes('elsha of the infinite')) {
        return !typeLine.includes('creature') && !typeLine.includes('land');
      }
      if (name.includes('melek, izzet paragon')) {
        return typeLine.includes('instant') || typeLine.includes('sorcery');
      }
      if (name.includes('augur of autumn')) {
        return typeLine.includes('creature') && !typeLine.includes('land');
      }
      if (name.includes('conspicuous snoop')) {
        return typeLine.includes('creature') && typeLine.includes('goblin');
      }
      if (name.includes('eladamri, korvecdal') || name.includes('vizier of the menagerie') || name.includes("garruk's horde")) {
        return typeLine.includes('creature') && !typeLine.includes('land');
      }

      return oracleText.includes('you may cast the top card of your library')
        || oracleText.includes('you may cast spells from the top of your library')
        || oracleText.includes('you may play the top card of your library');
    });
  }

export function findSourceZoneCard(state: GameState, playerId: string, cardId: string, fromZone: string): any | null {
    if (!cardId) return null;

    const player: any = state.players.find(p => p.id === playerId);
    if (!player) return null;

    const sourceZoneCards = (() => {
      if (fromZone === 'exile') return Array.isArray(player.exile) ? player.exile : [];
      if (fromZone === 'graveyard') return Array.isArray(player.graveyard) ? player.graveyard : [];
      if (fromZone === 'library') return Array.isArray(player.library) ? player.library : [];
      return Array.isArray(player.hand) ? player.hand : [];
    })();

    return sourceZoneCards.find((card: any) => String(card?.id || card?.cardId || '') === cardId) || null;
  }
