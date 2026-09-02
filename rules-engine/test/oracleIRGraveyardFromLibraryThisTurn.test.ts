import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { parseMoveZoneSingleCardFromEachPlayersGraveyard } from '../src/oracleIRExecutorZoneOps';
import { isShadowCombatLegal } from '../src/keywordAbilities/shadow';

const WEAVER_KING_ORACLE =
  'Shadow (This creature can block or be blocked by only creatures with shadow.)\n\nWhenever The Weaver King deals combat damage to a player, they mill that many cards. Then for each opponent, put a creature card from that player\'s graveyard that was put there from their library this turn onto the battlefield under your control.';

describe('graveyard cards put there from a library this turn', () => {
  it('parses Weaver King mill-that-many plus per-opponent steal from library-this-turn creatures', () => {
    const ir = parseOracleTextToIR(WEAVER_KING_ORACLE, 'The Weaver King');
    const steps = ir.abilities.flatMap((ability) => ability.steps || []);
    expect(steps.some((step) => step.kind === 'mill')).toBe(true);
    const mill = steps.find((step) => step.kind === 'mill') as Extract<(typeof steps)[number], { kind: 'mill' }>;
    expect(mill.who.kind).toBe('target_player');
    expect(mill.amount).toMatchObject({ kind: 'reference_amount' });
    const move = steps.find((step) => step.kind === 'move_zone') as
      | Extract<(typeof steps)[number], { kind: 'move_zone' }>
      | undefined;
    expect(move?.to).toBe('battlefield');
    expect(String((move as any)?.battlefieldController?.kind || '')).toBe('you');
    expect(
      parseMoveZoneSingleCardFromEachPlayersGraveyard(move?.what as any),
    ).toMatchObject({
      cardType: 'creature',
      graveyardOwner: 'opponent',
      putIntoGraveyardFromLibraryThisTurn: true,
    });
  });

  it('mills the damaged player that many, then steals one library-this-turn creature from each opponent', () => {
    const ir = parseOracleTextToIR(WEAVER_KING_ORACLE, 'The Weaver King');
    const steps = ir.abilities.flatMap((ability) => ability.steps || []);
    const you = 'p_you' as PlayerID;
    const opp1 = 'p_opp1' as PlayerID;
    const opp2 = 'p_opp2' as PlayerID;
    const state = {
      turn: 3,
      turnNumber: 3,
      players: [
        { id: you, library: [], hand: [], graveyard: [], exile: [] },
        {
          id: opp1,
          library: [
            { id: 'milled-bear', name: 'Bear', type_line: 'Creature — Bear' },
            { id: 'milled-plains', name: 'Plains', type_line: 'Basic Land — Plains' },
          ],
          hand: [],
          graveyard: [],
          exile: [],
        },
        {
          id: opp2,
          library: [],
          hand: [],
          graveyard: [
            {
              id: 'earlier-mill-zombie',
              name: 'Zombie',
              type_line: 'Creature — Zombie',
              putIntoGraveyardTurn: 3,
              putIntoGraveyardFrom: 'library',
              milledTurn: 3,
            },
            {
              id: 'discarded-elf',
              name: 'Elf',
              type_line: 'Creature — Elf',
              putIntoGraveyardTurn: 3,
              putIntoGraveyardFrom: 'hand',
            },
          ],
          exile: [],
        },
      ],
      battlefield: [],
    } as unknown as GameState;
    const ctx = buildOracleIRExecutionContext({
      controllerId: you,
      sourceName: 'The Weaver King',
      targetPlayerId: opp1,
      referenceAmount: 2,
      selectorContext: { targetPlayerId: opp1 },
    });
    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    expect(result.appliedSteps.map((step) => step.kind)).toEqual(expect.arrayContaining(['mill', 'move_zone']));
    const opp1Player = result.state.players.find((player) => player.id === opp1) as any;
    expect((opp1Player?.graveyard || []).map((card: any) => card.id)).toEqual(['milled-plains']);
    const opp2Player = result.state.players.find((player) => player.id === opp2) as any;
    expect((opp2Player?.graveyard || []).map((card: any) => card.id)).toEqual(['discarded-elf']);
    const stolenNames = (result.state.battlefield || []).map((perm: any) =>
      String(perm?.card?.name || perm?.name || ''),
    );
    expect(stolenNames).toEqual(expect.arrayContaining(['Bear', 'Zombie']));
    expect(stolenNames).not.toContain('Elf');
    expect(
      (result.state.battlefield || []).every((perm: any) => String(perm?.controller || '') === you),
    ).toBe(true);
  });

  it('keeps Shadow as an evasion keyword (block only shadow)', () => {
    expect(isShadowCombatLegal(true, true)).toBe(true);
    expect(isShadowCombatLegal(true, false)).toBe(false);
    expect(isShadowCombatLegal(false, true)).toBe(false);
  });
});
