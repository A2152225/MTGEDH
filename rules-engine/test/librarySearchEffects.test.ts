/**
 * Tests for library search restriction effects
 */
import { describe, it, expect } from 'vitest';
import {
  detectSearchRestrictions,
  getActiveSearchRestrictions,
  checkSearchRestrictions,
  getSearchableCards,
  createSearchRestrictionMessage,
  type LibrarySearchRestriction,
} from '../src/librarySearchEffects';

describe('Library Search Effects', () => {
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
      expect(restrictions[0].affectsOpponents).toBe(true);
      expect(restrictions[0].affectsSelf).toBe(false);
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
      expect(restrictions[0].affectsOpponents).toBe(true);
      expect(restrictions[0].affectsSelf).toBe(true);
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

    it('detects pay-to-search from ignore-this-effect oracle', () => {
      const restrictions = detectSearchRestrictions({
        name: 'Leonin Arbiter',
        oracle_text: "Players can't search libraries. Any player may pay {2} for that player to ignore this effect until end of turn.",
      }, 'perm1', 'player1');

      expect(restrictions).toHaveLength(1);
      expect(restrictions[0].type).toBe('pay_to_search');
      expect(restrictions[0].paymentToIgnore).toBe('{2}');
      expect(restrictions[0].affectsOpponents).toBe(true);
      expect(restrictions[0].affectsSelf).toBe(true);
    });

    it('detects opponent-controlled searches from while-searching oracle', () => {
      const restrictions = detectSearchRestrictions({
        name: 'Opposition Agent',
        oracle_text: "Flash\nYou control your opponents while they're searching their libraries.\nWhile an opponent is searching their library, they exile each card they find. You may play those cards for as long as they remain exiled, and you may spend mana as though it were mana of any color to cast them.",
      }, 'perm1', 'player1');

      expect(restrictions.some((r) => r.type === 'opponent_controls')).toBe(true);
      const control = restrictions.find((r) => r.type === 'opponent_controls');
      expect(control?.affectsOpponents).toBe(true);
      expect(control?.affectsSelf).toBe(false);
    });

    it("detects can't-cause-to-search as opponent cannot_search", () => {
      const restrictions = detectSearchRestrictions({
        name: 'Ashiok, Dream Render',
        oracle_text: "Spells and abilities your opponents control can't cause their controller to search their library.\n[−1]: Target player mills four cards. Then exile each opponent's graveyard.",
      }, 'perm1', 'player1');

      expect(restrictions.some((r) => r.type === 'cannot_search')).toBe(true);
      const prevent = restrictions.find((r) => r.type === 'cannot_search');
      expect(prevent?.affectsOpponents).toBe(true);
      expect(prevent?.affectsSelf).toBe(false);
    });

    it("detects this-turn players-can't-search duration", () => {
      const restrictions = detectSearchRestrictions({
        name: 'Shadow of Doubt',
        oracle_text: "({U/B} can be paid with either {U} or {B}.)\nPlayers can't search libraries this turn.\nDraw a card.",
      }, 'perm1', 'player1');

      expect(restrictions).toHaveLength(1);
      expect(restrictions[0].type).toBe('cannot_search');
      expect(restrictions[0].duration).toBe('until_end_of_turn');
      expect(restrictions[0].affectsOpponents).toBe(true);
      expect(restrictions[0].affectsSelf).toBe(true);
    });

    it('detects whenever-search sacrifice trigger without a name table', () => {
      const restrictions = detectSearchRestrictions({
        name: 'Ob Nixilis, Unshackled',
        oracle_text: 'Flying, trample\nWhenever an opponent searches their library, that player sacrifices a creature of their choice and loses 10 life.\nWhenever another creature dies, put a +1/+1 counter on Ob Nixilis.',
      }, 'perm1', 'player1');

      const trigger = restrictions.find((r) => r.type === 'search_triggers_effect');
      expect(trigger).toBeDefined();
      expect(String(trigger?.triggerEffect || '')).toMatch(/sacrifices a creature/i);
      expect(trigger?.affectsOpponents).toBe(true);
      expect(trigger?.affectsSelf).toBe(false);
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
