import { describe, expect, it } from 'vitest';
import {
  assemble,
  assemblesContraption,
  CAN_CHOOSE_ILLEGAL_OPTION,
  completeAssemble,
  completeVillainousChoice,
  createAssembleResult,
  createTimeTravelActionResult,
  createVillainousChoiceResult,
  faceVillainousChoice,
  getTimeTravelCounterResult,
  hasChosenVillainousOption,
  isValidTimeTravelSelection,
  processInAPNAPOrder,
  timeTravel,
} from '../src/keywordActions';

describe('Rule 701: Keyword Actions - Part 11 (remaining light action summaries)', () => {
  describe('Rule 701.45: Assemble', () => {
    it('should distinguish an incomplete assemble action from one that chose a Contraption', () => {
      expect(assemblesContraption(assemble('p1'))).toBe(false);
      expect(assemblesContraption(completeAssemble('p1', 'contraption-1'))).toBe(true);
    });

    it('should summarize whether assemble completed and whether a Contraption was available', () => {
      expect(createAssembleResult(completeAssemble('p1', 'contraption-1'), ['contraption-1'])).toEqual({
        playerId: 'p1',
        contraptionId: 'contraption-1',
        assembled: true,
        requiresAvailableContraption: true,
        unsetMechanic: true,
      });
    });
  });

  describe('Rule 701.55: Face a Villainous Choice', () => {
    it('should recognize when a villainous branch has been chosen', () => {
      expect(hasChosenVillainousOption(faceVillainousChoice('p2', 'Draw a card.', 'Lose 3 life.'))).toBe(false);
      expect(hasChosenVillainousOption(completeVillainousChoice('p2', 'Draw a card.', 'Lose 3 life.', 'B'))).toBe(true);
    });

    it('should summarize the chosen branch while preserving the rule allowance for illegal choices', () => {
      expect(createVillainousChoiceResult(completeVillainousChoice('p2', 'Draw a card.', 'Lose 3 life.', 'B'))).toEqual({
        playerId: 'p2',
        chosenOption: 'B',
        chosenText: 'Lose 3 life.',
        branchCount: 2,
        canChooseIllegalOption: true,
      });
      expect(processInAPNAPOrder(['p3', 'p1'], ['p1', 'p2', 'p3'])).toEqual(['p1', 'p3']);
      expect(CAN_CHOOSE_ILLEGAL_OPTION).toBe(true);
    });
  });

  describe('Rule 701.56: Time Travel', () => {
    it('should summarize valid mixed selections across permanents and suspended cards', () => {
      const action = timeTravel('p1', [
        { objectId: 'perm-1', addCounter: false },
        { objectId: 'suspend-1', addCounter: true },
      ]);

      expect(createTimeTravelActionResult(action, ['perm-1', 'suspend-1'], [
        { objectId: 'perm-1', addCounter: false, isPermanent: true },
        { objectId: 'suspend-1', addCounter: true, isSuspended: true },
      ])).toEqual({
        playerId: 'p1',
        choiceCount: 2,
        validSelection: true,
        netCounterChange: 0,
        affectsPermanents: true,
        affectsSuspendedCards: true,
      });
    });

    it('should keep counter removal clamped and reject duplicate selections', () => {
      expect(getTimeTravelCounterResult(0, false)).toBe(0);
      expect(isValidTimeTravelSelection([
        { objectId: 'perm-1', addCounter: true },
        { objectId: 'perm-1', addCounter: false },
      ], ['perm-1'])).toBe(false);
    });
  });
});