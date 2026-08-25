// Origin parent: rules-engine/src/AIEngine.ts
// Cluster moved: AIEngine.analyzeLibraryForPlanning.
// Public entry symbols: analyzeLibraryForPlanning.
// Class methods become thin wrappers that call these via .call(this, ...).
// Leaf must not import AIEngine.ts or AIEngine-handlers/index.ts.

import type { KnownCardRef, BattlefieldPermanent, PlayerID } from '../../../shared/src';
import {
  cardAnalyzer,
  CardCategory,
  ThreatLevel,
} from '../CardAnalyzer';

/** AIEngine instance passed as `this` from AIEngine thin wrappers. */
export type AIEngineHost = any;

/**
 * Analyze library to identify remaining win conditions and key pieces
 * Uses only known information (not hidden)
 */
export function analyzeLibraryForPlanning(
  this: AIEngineHost,
  library: readonly KnownCardRef[],
  battlefield: readonly BattlefieldPermanent[],
  playerId: PlayerID
): {
  winConditions: KnownCardRef[];
  comboPieces: KnownCardRef[];
  answers: KnownCardRef[];
  ramp: KnownCardRef[];
  cardDraw: KnownCardRef[];
  tutorTargetPriority: { card: KnownCardRef; priority: number; reason: string }[];
} {
    const winConditions: KnownCardRef[] = [];
    const comboPieces: KnownCardRef[] = [];
    const answers: KnownCardRef[] = [];
    const ramp: KnownCardRef[] = [];
    const cardDraw: KnownCardRef[] = [];
    const tutorTargets: { card: KnownCardRef; priority: number; reason: string }[] = [];
    
    for (const card of library) {
      const analysis = cardAnalyzer.analyzeCard(card);
      
      // Categorize cards
      if (analysis.categories.includes(CardCategory.FINISHER) || 
          analysis.threatLevel >= ThreatLevel.GAME_WINNING) {
        winConditions.push(card);
        tutorTargets.push({ card, priority: 10, reason: 'Win condition' });
      }
      
      if (analysis.comboPotential >= 7) {
        comboPieces.push(card);
        // Check if we already have combo partners on battlefield
        const battlefieldSynergy = cardAnalyzer.findSynergyCards([card], battlefield, playerId);
        if (battlefieldSynergy.length > 0 && battlefieldSynergy[0].synergyScore >= 8) {
          tutorTargets.push({ card, priority: 9, reason: 'Completes combo on board' });
        } else {
          tutorTargets.push({ card, priority: 6, reason: 'Combo piece' });
        }
      }
      
      if (analysis.categories.includes(CardCategory.REMOVAL) ||
          analysis.categories.includes(CardCategory.BOARD_WIPE) ||
          analysis.categories.includes(CardCategory.COUNTERSPELL)) {
        answers.push(card);
        tutorTargets.push({ card, priority: 5, reason: 'Answer/interaction' });
      }
      
      if (analysis.categories.includes(CardCategory.RAMP)) {
        ramp.push(card);
        tutorTargets.push({ card, priority: 4, reason: 'Mana acceleration' });
      }
      
      if (analysis.categories.includes(CardCategory.DRAW) ||
          analysis.categories.includes(CardCategory.TUTOR)) {
        cardDraw.push(card);
        tutorTargets.push({ card, priority: 7, reason: 'Card advantage' });
      }
    }
    
    // Sort tutor targets by priority
    tutorTargets.sort((a, b) => b.priority - a.priority);
    
    return {
      winConditions,
      comboPieces,
      answers,
      ramp,
      cardDraw,
      tutorTargetPriority: tutorTargets,
    };
}
