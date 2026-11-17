import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  applyOracleIRStepsToGameState,
  buildOracleIRExecutionContext,
} from '../src/oracleIRExecutor';
import {
  parseMoveZoneAllTypedCardsExiledThisWay,
  parseMoveZoneEachTypedCardYouOwnExiledWithIt,
} from '../src/oracleIRExecutorZoneOpsExiledTypedCardParsers';

function card(id: string, type_line: string, extra: Record<string, unknown> = {}) {
  return { id, name: id, type_line, ...extra };
}

function state(players: Record<string, Record<string, any[]>>, battlefield: any[] = []) {
  return {
    id: 'exiled-typed',
    format: 'commander',
    players: Object.entries(players).map(([id, zones], seat) => ({
      id,
      name: id,
      seat,
      life: 40,
      library: [],
      hand: [],
      graveyard: [],
      exile: [],
      ...zones,
    })),
    startingLife: 40,
    life: { p1: 40, p2: 40 },
    turnPlayer: 'p1',
    priority: 'p1',
    stack: [],
    battlefield,
    commandZone: {},
    phase: 'combat',
    active: true,
  } as any;
}

function stepsOf(text: string, name: string) {
  return (parseOracleTextToIR(text, name).abilities || []).flatMap((a) => a.steps || []);
}

const onBattlefield = (game: any, id: string) =>
  (game.battlefield as any[]).some((p) => p.id === id || p.card?.id === id);

describe('typed "exiled this way" / "exiled with it" selectors', () => {
  it('parses typed plurals without matching the untyped forms', () => {
    expect(parseMoveZoneAllTypedCardsExiledThisWay({ kind: 'raw', text: 'all permanent cards exiled this way' })).toEqual({
      cardType: 'permanent',
    });
    expect(parseMoveZoneAllTypedCardsExiledThisWay({ kind: 'raw', text: 'all cards exiled this way' })).toBeNull();
    expect(
      parseMoveZoneEachTypedCardYouOwnExiledWithIt({ kind: 'raw', text: 'each creature card you own exiled with it' }),
    ).toEqual({ cardType: 'creature', ownedByController: true });
    expect(parseMoveZoneEachTypedCardYouOwnExiledWithIt({ kind: 'raw', text: 'each creature card exiled with it' })).toBeNull();
  });

  it('puts all permanent cards exiled this way onto the battlefield and leaves nonpermanents exiled', () => {
    const game = state({
      p1: {
        library: [
          card('forest', 'Basic Land — Forest'),
          card('bolt', 'Instant'),
          card('bear', 'Creature — Bear'),
          card('relic', 'Artifact'),
          card('deep', 'Sorcery'),
        ],
      },
      p2: {},
    });
    const steps = stepsOf(
      'When Deep Space 9 enters and at the beginning of your upkeep, exile the top four cards of your library. Put all permanent cards exiled this way onto the battlefield.',
      'Deep Space 9',
    ).filter((s) => s.kind === 'exile_top' || s.kind === 'move_zone');
    const result = applyOracleIRStepsToGameState(
      game,
      steps,
      buildOracleIRExecutionContext({ controllerId: 'p1', sourceId: 'ds9', sourceName: 'Deep Space 9' }),
    );
    expect(result.appliedSteps.map((s) => s.kind)).toEqual(['exile_top', 'move_zone']);
    expect(onBattlefield(result.state, 'forest')).toBe(true);
    expect(onBattlefield(result.state, 'bear')).toBe(true);
    expect(onBattlefield(result.state, 'relic')).toBe(true);
    expect(onBattlefield(result.state, 'bolt')).toBe(false);
    const p1: any = (result.state.players as any[]).find((p) => p.id === 'p1');
    expect(p1.exile.map((c: any) => c.id)).toEqual(['bolt']);
    expect(p1.library.map((c: any) => c.id)).toEqual(['deep']);
  });

  it('returns only creature cards you own exiled with it', () => {
    const game = state(
      {
        p1: {
          exile: [
            card('mine-creature', 'Creature — Human', { exiledWithSourceId: 'bay' }),
            card('mine-land', 'Land', { exiledWithSourceId: 'bay' }),
            card('mine-other-source', 'Creature — Elf', { exiledWithSourceId: 'other' }),
          ],
        },
        p2: { exile: [card('theirs-creature', 'Creature — Goblin', { exiledWithSourceId: 'bay' })] },
      },
      [{ id: 'bay', controller: 'p1', owner: 'p1', type_line: 'Artifact — Spacecraft', card: { name: 'S.S. Botany Bay' } }],
    );
    const steps = stepsOf(
      'Whenever S.S. Botany Bay deals combat damage to a player, return each creature card you own exiled with it to the battlefield.',
      'S.S. Botany Bay',
    );
    const result = applyOracleIRStepsToGameState(
      game,
      steps,
      buildOracleIRExecutionContext({ controllerId: 'p1', sourceId: 'bay', sourceName: 'S.S. Botany Bay' }),
    );
    expect(result.appliedSteps.map((s) => s.kind)).toEqual(['move_zone']);
    expect(onBattlefield(result.state, 'mine-creature')).toBe(true);
    expect(onBattlefield(result.state, 'mine-land')).toBe(false);
    expect(onBattlefield(result.state, 'mine-other-source')).toBe(false);
    expect(onBattlefield(result.state, 'theirs-creature')).toBe(false);
    const p2: any = (result.state.players as any[]).find((p) => p.id === 'p2');
    expect(p2.exile.map((c: any) => c.id)).toEqual(['theirs-creature']);
  });
});
