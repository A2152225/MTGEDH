import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import type { GameState } from '../../shared/src/index.js';

// Quoted from local cards DB (Descendants' Path, Avacyn Restored).
const DESCENDANTS_PATH_ORACLE =
  "At the beginning of your upkeep, reveal the top card of your library. If it's a creature card that shares a creature type with a creature you control, you may cast it without paying its mana cost. If you don't cast it, put it on the bottom of your library.";

function makeState(overrides: Record<string, unknown> = {}): GameState {
  return {
    id: 'descendants-path',
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
        card: {
          name: 'Bugenhagen, Wise Elder',
          type_line: 'Legendary Creature — Human Shaman',
        },
      },
    ],
    stack: [],
    turnPlayer: 'p1',
    priority: 'p1',
    active: true,
    ...overrides,
  } as GameState;
}

function triggerSteps() {
  const ir = parseOracleTextToIR(DESCENDANTS_PATH_ORACLE, "Descendants' Path");
  const ability = ir.abilities.find((entry) => (entry.steps || []).some((step) => step.kind === 'reveal_top'))
    ?? ir.abilities[0];
  return ability?.steps ?? [];
}

describe("Descendants' Path IR (reveal top, share a type with a creature you control, may-cast)", () => {
  it('parses reveal_top plus share-type may-cast with library-bottom else', () => {
    const steps = triggerSteps();
    expect(steps.map((step) => step.kind)).toEqual(['reveal_top', 'conditional']);
    expect(steps[0]).toMatchObject({ kind: 'reveal_top' });
    expect(steps[1]).toMatchObject({
      kind: 'conditional',
      condition: {
        raw: "it's a creature card that shares a creature type with a creature you control",
      },
    });
    const thenSteps = (steps[1] as any)?.steps || [];
    const elseSteps = (steps[1] as any)?.elseSteps || [];
    expect(thenSteps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'grant_exile_permission',
          duration: 'during_resolution',
          permission: 'cast',
          withoutPayingManaCost: true,
          optional: true,
        }),
      ]),
    );
    expect(elseSteps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'move_zone',
          to: 'library',
          libraryPlacement: 'bottom',
        }),
      ]),
    );
  });

  it('keeps a matching creature on top and pending may-cast (Elf Shaman vs Human Shaman)', () => {
    const result = applyOracleIRStepsToGameState(makeState(), triggerSteps(), {
      controllerId: 'p1',
      sourceId: 'path_1',
      sourceName: "Descendants' Path",
      sourceObjectType: 'ability',
    });

    const p1 = result.state.players.find((player) => player.id === 'p1') as any;
    expect(p1.library[0]?.id).toBe('piper_1');
    expect(result.appliedSteps.some((step) => step.kind === 'reveal_top')).toBe(true);
    expect(result.pendingOptionalSteps.some((step) => step.kind === 'grant_exile_permission')).toBe(true);
    expect((p1.library || []).filter((card: any) => card.id === 'piper_1')).toHaveLength(1);
  });

  it('bottoms a creature that shares no type with a controlled creature', () => {
    const result = applyOracleIRStepsToGameState(
      makeState({
        players: [
          {
            id: 'p1',
            name: 'P1',
            seat: 0,
            life: 40,
            library: [
              { id: 'goblin_1', name: 'Goblin Guide', type_line: 'Creature — Goblin Warrior' },
              { id: 'forest_1', name: 'Forest', type_line: 'Basic Land — Forest' },
            ],
            hand: [],
            graveyard: [],
            exile: [],
          } as any,
        ],
      }),
      triggerSteps(),
      {
        controllerId: 'p1',
        sourceId: 'path_1',
        sourceName: "Descendants' Path",
        sourceObjectType: 'ability',
      },
    );

    const p1 = result.state.players.find((player) => player.id === 'p1') as any;
    expect(p1.library[0]?.id).toBe('forest_1');
    expect(p1.library[p1.library.length - 1]?.id).toBe('goblin_1');
    expect(result.pendingOptionalSteps.some((step) => step.kind === 'grant_exile_permission')).toBe(false);
  });
});
