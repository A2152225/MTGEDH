import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { applyOracleIRStepsToGameState } from '../../rules-engine/src/oracleIRExecutor.js';
import { queueRevealedLibraryCastPromptsFromOracleIRResult } from '../src/state/modules/oracleIrServerZoneSync-handlers/oracleIrServerRevealedLibraryCastPrompts.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

// Quoted from local cards DB (Descendants' Path, Avacyn Restored).
const DESCENDANTS_PATH_ORACLE =
  "At the beginning of your upkeep, reveal the top card of your library. If it's a creature card that shares a creature type with a creature you control, you may cast it without paying its mana cost. If you don't cast it, put it on the bottom of your library.";

describe("Descendants' Path revealed-library free-cast prompt", () => {
  it('offers the matching library-top creature, not a battlefield put', () => {
    const gameId = 'descendants_path_revealed_cast';
    ResolutionQueueManager.clearAllSteps(gameId);

    const ir = parseOracleTextToIR(DESCENDANTS_PATH_ORACLE, "Descendants' Path");
    const steps = ir.abilities.find((entry) => (entry.steps || []).some((step) => step.kind === 'reveal_top'))?.steps
      ?? ir.abilities[0]?.steps
      ?? [];
    const result = applyOracleIRStepsToGameState(
      {
        id: gameId,
        format: 'commander',
        players: [
          {
            id: 'p1',
            name: 'P1',
            seat: 0,
            life: 40,
            library: [
              { id: 'piper_1', name: 'Elvish Piper', type_line: 'Creature — Elf Shaman' },
              { id: 'forest_1', name: 'Forest', type_line: 'Basic Land — Forest' },
            ],
            hand: [],
            graveyard: [],
            exile: [],
          } as any,
        ],
        battlefield: [
          {
            id: 'bugenhagen_1',
            name: 'Bugenhagen, Wise Elder',
            controller: 'p1',
            type_line: 'Legendary Creature — Human Shaman',
          },
        ],
        stack: [],
        turnPlayer: 'p1',
        priority: 'p1',
        active: true,
      } as any,
      steps,
      {
        controllerId: 'p1',
        sourceId: 'path_1',
        sourceName: "Descendants' Path",
        sourceObjectType: 'ability',
      },
    );

    const state: any = result.state;
    const ctx = { gameId, state, isReplaying: false } as any;
    queueRevealedLibraryCastPromptsFromOracleIRResult(ctx, state, result, {
      controller: 'p1' as any,
      sourceName: "Descendants' Path",
      sourceId: 'path_1',
    });

    const prompt = ResolutionQueueManager.getQueue(gameId).steps.find(
      (step: any) => step?.castRevealedFromLibraryChoice === true,
    ) as any;
    const p1 = state.players.find((player: any) => player.id === 'p1');

    expect(prompt).toBeTruthy();
    expect(prompt.playerId).toBe('p1');
    expect(prompt.castRevealedFromLibraryCard?.id).toBe('piper_1');
    expect(p1.library[0]?.id).toBe('piper_1');
    expect((state.battlefield || []).some((perm: any) => perm?.id === 'piper_1')).toBe(false);
    ResolutionQueueManager.clearAllSteps(gameId);
  });
});
