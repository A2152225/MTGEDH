/**
 * Tests for library search restriction effects
 */
import { describe, it, expect } from 'vitest';
import {
  KNOWN_SEARCH_RESTRICTIONS,
  detectSearchRestrictions,
  getActiveSearchRestrictions,
  checkSearchRestrictions,
  getSearchableCards,
  createSearchRestrictionMessage,
  type LibrarySearchRestriction,
} from '../src/librarySearchEffects';

describe('Library Search Effects', () => {
  describe('KNOWN_SEARCH_RESTRICTIONS', () => {
    it('includes Aven Mindcensor with top 4 limit', () => {
      const restriction = KNOWN_SEARCH_RESTRICTIONS['aven mindcensor'];
      expect(restriction).toBeDefined();
      expect(restriction.type).toBe('limited_search');
      expect(restriction.limitedSearchCount).toBe(4);
      expect(restriction.affectsOpponents).toBe(true);
      expect(restriction.affectsSelf).toBe(false);
    });

    it('includes Leonin Arbiter with pay to search', () => {
      const restriction = KNOWN_SEARCH_RESTRICTIONS['leonin arbiter'];
      expect(restriction).toBeDefined();
      expect(restriction.type).toBe('pay_to_search');
      expect(restriction.paymentToIgnore).toBe('{2}');
      expect(restriction.affectsOpponents).toBe(true);
      expect(restriction.affectsSelf).toBe(true);
    });

    it('includes Stranglehold preventing opponent searches', () => {
      const restriction = KNOWN_SEARCH_RESTRICTIONS['stranglehold'];
      expect(restriction).toBeDefined();
      expect(restriction.type).toBe('cannot_search');
      expect(restriction.affectsOpponents).toBe(true);
      expect(restriction.affectsSelf).toBe(false);
    });

    it('includes Ob Nixilis, Unshackled with trigger effect', () => {
      const restriction = KNOWN_SEARCH_RESTRICTIONS['ob nixilis, unshackled'];
      expect(restriction).toBeDefined();
      expect(restriction.type).toBe('search_triggers_effect');
      expect(restriction.triggerEffect).toContain('Sacrifice');
    });

    it('includes Opposition Agent with opponent control', () => {
      const restriction = KNOWN_SEARCH_RESTRICTIONS['opposition agent'];
      expect(restriction).toBeDefined();
      expect(restriction.type).toBe('opponent_controls');
    });
  });

  describe('detectSearchRestrictions', () => {
    it('detects Aven Mindcensor', () => {
      const card = {
        name: 'Aven Mindcensor',
        oracle_text: 'Flash\nFlying\nIf an opponent would search a library, that player searches the top four cards of that library instead.',
      };

      const restrictions = detectSearchRestrictions(card, 'perm1', 'player1');
      
      expect(restrictions.length).toBe(1);
      expect(restrictions[0].type).toBe('limited_search');
      expect(restrictions[0].limitedSearchCount).toBe(4);
    });

    it('detects Stranglehold', () => {
      const card = {
        name: 'Stranglehold',
        oracle_text: 'Your opponents can\'t search libraries.\nIf an opponent would begin an extra turn, that player skips that turn instead.',
      };

      const restrictions = detectSearchRestrictions(card, 'perm1', 'player1');
      
      expect(restrictions.length).toBe(1);
      expect(restrictions[0].type).toBe('cannot_search');
      expect(restrictions[0].affectsOpponents).toBe(true);
      expect(restrictions[0].affectsSelf).toBe(false);
    });

    it('detects generic "can\'t search" effects', () => {
      const card = {
        name: 'Custom Anti-Search Card',
        oracle_text: 'Players can\'t search libraries.',
      };

      const restrictions = detectSearchRestrictions(card, 'perm1', 'player1');
      
      expect(restrictions.length).toBe(1);
      expect(restrictions[0].type).toBe('cannot_search');
    });

    it('detects generic "search top N" effects', () => {
      const card = {
        name: 'Custom Limited Search',
        oracle_text: 'If an opponent would search a library, that player searches the top five cards instead.',
      };

      const restrictions = detectSearchRestrictions(card, 'perm1', 'player1');
      
      expect(restrictions.length).toBe(1);
      expect(restrictions[0].type).toBe('limited_search');
      expect(restrictions[0].limitedSearchCount).toBe(5);
    });

    it('detects search trigger effects', () => {
      const card = {
        name: 'Search Punisher',
        oracle_text: 'Whenever an opponent searches their library, that player loses 3 life.',
      };

      const restrictions = detectSearchRestrictions(card, 'perm1', 'player1');
      
      expect(restrictions.some(r => r.type === 'search_triggers_effect')).toBe(true);
    });
  });

  describe('getActiveSearchRestrictions', () => {
    it('collects all restrictions from battlefield', () => {
      const battlefield = [
        {
          id: 'perm1',
          controller: 'player1',
          card: {
            name: 'Aven Mindcensor',
            oracle_text: 'If an opponent would search a library, that player searches the top four cards instead.',
          },
        },
        {
          id: 'perm2',
          controller: 'player2',
          card: {
            name: 'Stranglehold',
            oracle_text: 'Your opponents can\'t search libraries.',
          },
        },
      ];

      const restrictions = getActiveSearchRestrictions(battlefield);
      
      expect(restrictions.length).toBe(2);
    });

    it('ignores permanents without cards', () => {
      const battlefield = [
        { id: 'perm1', controller: 'player1' }, // No card property
      ];

      const restrictions = getActiveSearchRestrictions(battlefield);
      expect(restrictions.length).toBe(0);
    });
  });

  describe('checkSearchRestrictions', () => {
    it('allows search when no restrictions', () => {
      const result = checkSearchRestrictions('player1', 'player1', [], 'player1');
      
      expect(result.canSearch).toBe(true);
      expect(result.restrictions.length).toBe(0);
    });

    it('prevents search with Stranglehold for opponent', () => {
      const restrictions: LibrarySearchRestriction[] = [{
        id: 'r1',
        sourceId: 'perm1',
        sourceName: 'Stranglehold',
        controllerId: 'player1',
        type: 'cannot_search',
        affectsOpponents: true,
        affectsSelf: false,
        duration: 'permanent',
      }];

      const result = checkSearchRestrictions('player2', 'player2', restrictions, 'player1');
      
      expect(result.canSearch).toBe(false);
      expect(result.reason).toContain('Stranglehold');
    });

    it('does not affect controller with Stranglehold', () => {
      const restrictions: LibrarySearchRestriction[] = [{
        id: 'r1',
        sourceId: 'perm1',
        sourceName: 'Stranglehold',
        controllerId: 'player1',
        type: 'cannot_search',
        affectsOpponents: true,
        affectsSelf: false,
        duration: 'permanent',
      }];

      const result = checkSearchRestrictions('player1', 'player1', restrictions, 'player1');
      
      expect(result.canSearch).toBe(true);
    });

    it('limits search with Aven Mindcensor for opponent', () => {
      const restrictions: LibrarySearchRestriction[] = [{
        id: 'r1',
        sourceId: 'perm1',
        sourceName: 'Aven Mindcensor',
        controllerId: 'player1',
        type: 'limited_search',
        affectsOpponents: true,
        affectsSelf: false,
        limitedSearchCount: 4,
        duration: 'permanent',
      }];

      const result = checkSearchRestrictions('player2', 'player2', restrictions, 'player1');
      
      expect(result.canSearch).toBe(true);
      expect(result.limitedToTopN).toBe(4);
    });

    it('requires payment with Leonin Arbiter', () => {
      const restrictions: LibrarySearchRestriction[] = [{
        id: 'r1',
        sourceId: 'perm1',
        sourceName: 'Leonin Arbiter',
        controllerId: 'player1',
        type: 'pay_to_search',
        affectsOpponents: true,
        affectsSelf: true,
        paymentToIgnore: '{2}',
        duration: 'permanent',
      }];

      const result = checkSearchRestrictions('player2', 'player2', restrictions, 'player1');
      
      expect(result.canSearch).toBe(true);
      expect(result.paymentRequired).toBe('{2}');
    });

    it('collects trigger effects with Ob Nixilis', () => {
      const restrictions: LibrarySearchRestriction[] = [{
        id: 'r1',
        sourceId: 'perm1',
        sourceName: 'Ob Nixilis, Unshackled',
        controllerId: 'player1',
        type: 'search_triggers_effect',
        affectsOpponents: true,
        affectsSelf: false,
        triggerEffect: 'Sacrifice a creature and lose 10 life',
        duration: 'permanent',
      }];

      const result = checkSearchRestrictions('player2', 'player2', restrictions, 'player1');
      
      expect(result.canSearch).toBe(true);
      expect(result.triggerEffects.length).toBe(1);
      expect(result.triggerEffects[0].triggerEffect).toContain('Sacrifice');
    });

    it('uses smallest limit when multiple limited search effects', () => {
      const restrictions: LibrarySearchRestriction[] = [
        {
          id: 'r1',
          sourceId: 'perm1',
          sourceName: 'Aven Mindcensor',
          controllerId: 'player1',
          type: 'limited_search',
          affectsOpponents: true,
          affectsSelf: false,
          limitedSearchCount: 4,
          duration: 'permanent',
        },
        {
          id: 'r2',
          sourceId: 'perm2',
          sourceName: 'Custom Mindcensor',
          controllerId: 'player1',
          type: 'limited_search',
          affectsOpponents: true,
          affectsSelf: false,
          limitedSearchCount: 2,
          duration: 'permanent',
        },
      ];

      const result = checkSearchRestrictions('player2', 'player2', restrictions, 'player1');
      
      expect(result.limitedToTopN).toBe(2);
    });
  });

  describe('getSearchableCards', () => {
    const library = ['card1', 'card2', 'card3', 'card4', 'card5', 'card6', 'card7', 'card8'];

    it('returns empty array when search not allowed', () => {
      const result: any = { canSearch: false, restrictions: [], triggerEffects: [] };
      const cards = getSearchableCards(library, result);
      expect(cards.length).toBe(0);
    });

    it('returns full library when no limit', () => {
      const result: any = { canSearch: true, restrictions: [], triggerEffects: [] };
      const cards = getSearchableCards(library, result);
      expect(cards.length).toBe(8);
    });

    it('returns top N cards when limited', () => {
      const result: any = { canSearch: true, restrictions: [], limitedToTopN: 4, triggerEffects: [] };
      const cards = getSearchableCards(library, result);
      expect(cards.length).toBe(4);
      expect(cards).toEqual(['card1', 'card2', 'card3', 'card4']);
    });
  });

  describe('createSearchRestrictionMessage', () => {
    it('shows cannot search message', () => {
      const result: any = { canSearch: false, reason: 'Stranglehold prevents searching', restrictions: [], triggerEffects: [] };
      const message = createSearchRestrictionMessage(result);
      expect(message).toContain('Stranglehold');
    });

    it('shows limited search message', () => {
      const result: any = { canSearch: true, limitedToTopN: 4, restrictions: [], triggerEffects: [] };
      const message = createSearchRestrictionMessage(result);
      expect(message).toContain('top 4 cards');
    });

    it('shows payment required message', () => {
      const result: any = { canSearch: true, paymentRequired: '{2}', restrictions: [], triggerEffects: [] };
      const message = createSearchRestrictionMessage(result);
      expect(message).toContain('{2}');
    });

    it('shows trigger effects', () => {
      const result: any = { 
        canSearch: true, 
        restrictions: [], 
        triggerEffects: [{
          sourceName: 'Ob Nixilis',
          triggerEffect: 'Sacrifice a creature and lose 10 life',
        }],
      };
      const message = createSearchRestrictionMessage(result);
      expect(message).toContain('Ob Nixilis');
      expect(message).toContain('Sacrifice');
    });
  });
});
