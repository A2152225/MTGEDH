/**
 * Tests for Part 6 Batch 3 Keyword Abilities (Rules 702.106-702.111)
 * Conspiracy through Dragons of Tarkir era mechanics
 */

import { describe, it, expect } from 'vitest';
import {
  hiddenAgenda, revealHiddenAgenda, type HiddenAgendaAbility,
  outlast, activateOutlast, type OutlastAbility,
  prowess, triggerProwess, type ProwessAbility,
  dash, returnFromDash, type DashAbility,
  exploit, completeExploit, type ExploitAbility,
  menace, canBlockWithMenace, type MenaceAbility
} from '../src/keywordAbilities';

describe('Part 6 Batch 3: Keyword Abilities (Rules 702.106-702.111)', () => {
  describe('Hidden Agenda (702.106)', () => {
    it('should create Hidden Agenda ability with secret card name', () => {
      const ability = hiddenAgenda('card1', 'Lightning Bolt');
      
      expect(ability.type).toBe('hidden-agenda');
      expect(ability.source).toBe('card1');
      expect(ability.namedCard).toBe('Lightning Bolt');
      expect(ability.revealed).toBe(false);
    });

    it('should reveal hidden agenda', () => {
      const ability = hiddenAgenda('card1', 'Lightning Bolt');
      const revealed = revealHiddenAgenda(ability);
      
      expect(revealed.revealed).toBe(true);
      expect(revealed.namedCard).toBe('Lightning Bolt');
    });
  });

  describe('Outlast (702.107)', () => {
    it('should create Outlast ability', () => {
      const ability = outlast('creature1', '{1}{W}');
      
      expect(ability.type).toBe('outlast');
      expect(ability.source).toBe('creature1');
      expect(ability.cost).toBe('{1}{W}');
      expect(ability.tapped).toBe(false);
    });

    it('should activate outlast and tap creature', () => {
      const ability = outlast('creature1', '{1}{W}');
      const activated = activateOutlast(ability);
      
      expect(activated.tapped).toBe(true);
    });
  });

  describe('Prowess (702.108)', () => {
    it('should create Prowess ability', () => {
      const ability = prowess('creature1');
      
      expect(ability.type).toBe('prowess');
      expect(ability.source).toBe('creature1');
      expect(ability.triggered).toBe(false);
    });

    it('should trigger prowess when casting noncreature spell', () => {
      const ability = prowess('creature1');
      const triggered = triggerProwess(ability);
      
      expect(triggered.triggered).toBe(true);
    });
  });

  describe('Dash (702.109)', () => {
    it('should create Dash ability with alternative cost', () => {
      const ability = dash('creature1', '{1}{R}');
      
      expect(ability.type).toBe('dash');
      expect(ability.source).toBe('creature1');
      expect(ability.dashCost).toBe('{1}{R}');
      expect(ability.dashed).toBe(false);
    });

    it('should mark creature as dashed', () => {
      const ability = dash('creature1', '{1}{R}');
      const dashed = returnFromDash(ability);
      
      expect(dashed.dashed).toBe(true);
    });
  });

  describe('Exploit (702.110)', () => {
    it('should create Exploit ability', () => {
      const ability = exploit('creature1');
      
      expect(ability.type).toBe('exploit');
      expect(ability.source).toBe('creature1');
      expect(ability.exploited).toBe(false);
    });

    it('should complete exploit by sacrificing creature', () => {
      const ability = exploit('creature1');
      const exploited = completeExploit(ability, 'victim1');
      
      expect(exploited.exploited).toBe(true);
      expect(exploited.sacrificedCreature).toBe('victim1');
    });
  });

  describe('Menace (702.111)', () => {
    it('should create Menace ability', () => {
      const ability = menace('creature1');
      
      expect(ability.type).toBe('menace');
      expect(ability.source).toBe('creature1');
    });

    it('should require 2+ blockers', () => {
      const ability = menace('creature1');
      
      expect(canBlockWithMenace(ability, 0)).toBe(false);
      expect(canBlockWithMenace(ability, 1)).toBe(false);
      expect(canBlockWithMenace(ability, 2)).toBe(true);
      expect(canBlockWithMenace(ability, 3)).toBe(true);
    });
  });
});
