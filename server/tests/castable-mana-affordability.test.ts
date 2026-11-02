import { describe, expect, it } from 'vitest';
import { getPlayableCardIds } from '../src/socket/util-handlers/getPlayableCardIds';

// Hand highlight (playableCards) must only list spells the floating pool plus untapped,
// usable battlefield sources can actually pay for. Reported: 2 mana left, Roaming Throne
// ({4}) still shown as castable.
const emptyPool = () => ({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });
const perm = (id: string, name: string, typeLine: string, oracle: string, extra: Record<string, unknown> = {}) => ({
  id, controller: 'p1', owner: 'p1', tapped: false, card: { id: `${id}_card`, name, type_line: typeLine, oracle_text: oracle }, ...extra,
});
const forest = (id: string, tapped = false) => perm(id, 'Forest', 'Basic Land — Forest', '({T}: Add {G}.)', { tapped });
const island = (id: string) => perm(id, 'Island', 'Basic Land — Island', '({T}: Add {U}.)');
const throne = { id: 'throne', name: 'Roaming Throne', mana_cost: '{4}', cmc: 4, type_line: 'Artifact Creature — Golem', oracle_text: 'Ward {2}', power: '4', toughness: '4' };
const twoGreen = { id: 'gg', name: 'Leatherback Baloth', mana_cost: '{G}{G}{G}', cmc: 3, type_line: 'Creature — Beast', oracle_text: '', power: '4', toughness: '5' };
const bears = { id: 'bears', name: 'Grizzly Bears', mana_cost: '{1}{G}', cmc: 2, type_line: 'Creature — Bear', oracle_text: '', power: '2', toughness: '2' };

function makeGame(hand: any[], battlefield: any[], pool: Record<string, number> = emptyPool()) {
  const state: any = {
    players: [{ id: 'p1', name: 'P1', life: 40 }, { id: 'p2', name: 'P2', life: 40 }],
    phase: 'precombatMain', step: 'MAIN1', turnPlayer: 'p1', priority: 'p1', stack: [], turn: 3,
    zones: { p1: { hand, graveyard: [], exile: [] }, p2: { hand: [], graveyard: [], exile: [] } },
    battlefield, manaPool: { p1: pool, p2: emptyPool() }, landsPlayedThisTurn: { p1: 1 },
  };
  return { state } as any;
}
const playable = (game: any) => getPlayableCardIds(game, 'p1' as any);

describe('castable highlight respects available mana', () => {
  it('2 available mana with Roaming Throne in hand: not castable', () => {
    expect(playable(makeGame([throne], [forest('f1'), forest('f2'), forest('f3', true), forest('f4', true)]))).not.toContain('throne');
    expect(playable(makeGame([throne], [forest('f1', true)], { ...emptyPool(), green: 2 }))).not.toContain('throne');
    expect(playable(makeGame([throne], [forest('f1'), forest('f2'), forest('f3'), forest('f4')]))).toContain('throne');
  });

  it('cards update to not castable after lands are tapped down or floating mana is spent', () => {
    const game = makeGame([throne, bears], [forest('f1'), forest('f2'), forest('f3'), forest('f4')]);
    expect(playable(game)).toEqual(expect.arrayContaining(['throne', 'bears']));
    game.state.battlefield[0].tapped = true;
    game.state.battlefield[1].tapped = true;
    const afterTap = playable(game);
    expect(afterTap).toContain('bears');
    expect(afterTap).not.toContain('throne');
    // Floating mana that was spent no longer counts.
    game.state.manaPool.p1 = { ...emptyPool(), green: 2 };
    expect(playable(game)).toContain('throne');
    game.state.manaPool.p1 = emptyPool();
    expect(playable(game)).not.toContain('throne');
  });

  it('colored requirements must be met by matching sources', () => {
    expect(playable(makeGame([twoGreen], [island('i1'), island('i2'), forest('f1')]))).not.toContain('gg');
    expect(playable(makeGame([twoGreen], [forest('f1'), island('i1')], { ...emptyPool(), blue: 2 }))).not.toContain('gg');
    expect(playable(makeGame([twoGreen], [forest('f1'), forest('f2'), forest('f3')]))).toContain('gg');
  });

  it('tapped sources and summoning-sick mana creatures are not counted', () => {
    const solRing = (tapped: boolean) => perm('sol', 'Sol Ring', 'Artifact', '{T}: Add {C}{C}.', { tapped });
    const elf = (extra: Record<string, unknown>) => perm('elf', 'Llanowar Elves', 'Creature — Elf Druid', '{T}: Add {G}.', extra);
    expect(playable(makeGame([throne], [forest('f1'), forest('f2'), solRing(true)]))).not.toContain('throne');
    expect(playable(makeGame([throne], [forest('f1'), forest('f2'), solRing(false)]))).toContain('throne');
    expect(playable(makeGame([throne], [forest('f1'), forest('f2'), forest('f3'), elf({ summoningSickness: true })]))).not.toContain('throne');
    expect(playable(makeGame([throne], [forest('f1'), forest('f2'), forest('f3'), elf({ tapped: true })]))).not.toContain('throne');
    expect(playable(makeGame([throne], [forest('f1'), forest('f2'), forest('f3'), elf({})]))).toContain('throne');
  });

  it('a hand card object missing its cost field is not treated as free', () => {
    const stub = { id: 'stub', name: 'Roaming Throne', cmc: 4, type_line: 'Artifact Creature — Golem', oracle_text: '' };
    expect(playable(makeGame([stub], [forest('f1'), forest('f2')]))).not.toContain('stub');
    expect(playable(makeGame([stub], [forest('f1'), forest('f2'), forest('f3'), forest('f4')]))).toContain('stub');
  });
});