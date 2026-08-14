import { describe, expect, it } from 'vitest';

import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';

const PANTLAZA_EFFECT =
  "Whenever Pantlaza or another Dinosaur you control enters, you may discover X, where X is that creature's toughness.";

describe('Discover X where X is that creature\'s toughness', () => {
  it('uses toughness as the mana-value threshold, not as cards-to-exile', () => {
    const ir = parseOracleTextToIR(PANTLAZA_EFFECT, 'Pantlaza, Sun-Favored');
    const steps = ir.abilities.find((ability) =>
      ability.steps.some((step) => step.kind === 'impulse_exile_top'),
    )?.steps ?? [];
    expect(steps.some((step) => step.kind === 'impulse_exile_top')).toBe(true);

    const start = {
      players: [
        {
          id: 'p1',
          seat: 0,
          library: [
            { id: 'forest-1', name: 'Forest', type_line: 'Basic Land — Forest', cmc: 0 },
            { id: 'ghalta-1', name: 'Ghalta, Primal Hunger', type_line: 'Legendary Creature — Elder Dinosaur', cmc: 12, mana_value: 12 },
            { id: 'bolt-1', name: 'Lightning Bolt', type_line: 'Instant', cmc: 1, mana_value: 1 },
            { id: 'island-1', name: 'Island', type_line: 'Basic Land — Island', cmc: 0 },
          ],
          graveyard: [],
          exile: [],
        },
      ],
      battlefield: [
        {
          id: 'dino_1',
          controller: 'p1',
          card: {
            name: 'Pantlaza, Sun-Favored',
            type_line: 'Legendary Creature — Dinosaur',
            power: '4',
            toughness: '4',
          },
        },
      ],
    } as any;

    const result = applyOracleIRStepsToGameState(
      start,
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1',
        sourceName: 'Pantlaza, Sun-Favored',
        xValue: 4,
        targetPermanentId: 'dino_1',
        chosenObjectIds: ['dino_1'],
        selectorContext: { chosenObjectIds: ['dino_1'], targetPermanentId: 'dino_1' },
      }),
      { allowOptional: true },
    );

    expect(result.appliedSteps.map((step) => step.kind)).toContain('impulse_exile_top');
    const player = result.state.players.find((entry: any) => entry.id === 'p1');
    const exileNames = (player?.exile || []).map((card: any) => String(card?.name || ''));
    // Forest (land, keep looking) + Ghalta (MV 12 > 4) + Bolt (MV 1 <= 4, stop).
    // Remaining cards go to the bottom; only the hit stays exiled.
    expect(exileNames).toContain('Lightning Bolt');
    expect(exileNames).not.toContain('Ghalta, Primal Hunger');
    expect(exileNames).not.toContain('Island');
    expect(player?.library?.some((card: any) => card?.name === 'Island')).toBe(true);
  });
});
