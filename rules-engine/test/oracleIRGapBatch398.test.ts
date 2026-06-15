import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser.ts';
import {
  buildMoveZoneSelectionOptions,
  buildPlayerChoiceAmongThemSelectionOptions,
} from '../src/oracleIRExecutorPlayerStepHandlers.ts';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor.ts';

describe('oracle IR gap batch398 — resolution queue bridge helpers', () => {
  it('builds among-them player choice options after reveal_top', () => {
    const ir = parseOracleTextToIR(
      "Reveal the top X plus one cards of your library. Choose a creature card and/or a land card from among them. Put those cards into your hand and the rest on the bottom of your library in a random order. If X is 5 or more, instead put the chosen cards onto the battlefield or into your hand and the rest on the bottom of your library in a random order.",
      "Green Sun's Twilight",
    );
    const steps = ir.abilities?.[0]?.steps || [];
    const revealStep = steps.find((step) => step.kind === 'reveal_top');
    const choiceStep = steps.find((step) => step.kind === 'player_choice');
    expect(revealStep).toBeTruthy();
    expect(choiceStep).toBeTruthy();

    const library = [
      { id: 'lib-1', name: 'Forest', type_line: 'Basic Land — Forest', zone: 'library' },
      { id: 'lib-2', name: 'Llanowar Elves', type_line: 'Creature — Elf Druid', zone: 'library' },
    ];
    const state = {
      players: [{ id: 'p1', library: [...library], hand: [], graveyard: [], exile: [] }],
      battlefield: [],
    } as any;

    const revealResult = applyOracleIRStepsToGameState(state, [revealStep!], {
      controllerId: 'p1',
      xValue: 1,
      interactivePlayerChoices: true,
    }, { haltOnPlayerChoiceRequired: true });

    const built = buildPlayerChoiceAmongThemSelectionOptions(
      revealResult.state as any,
      choiceStep as any,
      {
        controllerId: 'p1',
        lastMovedCards: library,
      },
    );

    expect(built?.availableCards.length).toBeGreaterThan(0);
    expect(built?.selectableCardIds).toContain('lib-2');
  });

  it('builds graveyard move_zone selection options for Grim Captain chain head', () => {
    const ir = parseOracleTextToIR(
      "Return a Pirate card from your graveyard to your hand, then do the same for Vampire, Dinosaur, and Merfolk.",
      "Grim Captain's Call",
    );
    const step = ir.abilities?.[0]?.steps?.find((entry) => entry.kind === 'move_zone');
    expect(step).toBeTruthy();

    const state = {
      players: [{
        id: 'p1',
        library: [],
        hand: [],
        graveyard: [{ id: 'gy-pirate', name: 'Captain', type_line: 'Creature — Pirate', zone: 'graveyard' }],
        exile: [],
      }],
      battlefield: [],
    } as any;

    const built = buildMoveZoneSelectionOptions(state, step as any, { controllerId: 'p1' });
    expect(built?.selectableCardIds).toEqual(['gy-pirate']);
    expect(built?.destination).toBe('hand');
  });
});
