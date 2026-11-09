import { describe, expect, it } from 'vitest';
import { isCardDrawProhibited, getCardDrawCapRemaining } from '../src/state/modules/playersCantDrawCards.js';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import { collectStaticEffectSpecsFromState, resolveSetBasePTFromStaticSpecs } from '../src/state/modules/staticEffectSpec.js';
import { detectUntapStepEffects } from '../src/state/modules/triggers/turn-phases-handlers/turnPhaseUntapStepEffects.js';
import { normalizeCreatureTypeWord } from '../../shared/src/creatureTypes.js';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';

describe('batch56 long-tail statics and replacements', () => {
  it('normalizes Pegasi to pegasus for subtype-list lords', () => {
    expect(normalizeCreatureTypeWord('Pegasi')).toBe('pegasus');
    expect(normalizeCreatureTypeWord('pegasi')).toBe('pegasus');
  });

  it('Thurid multi-subtype lord grants +1/+1 to Pegasi/Unicorns/Horses', () => {
    const thurid = {
      id: 'th', controller: 'p1',
      card: {
        name: 'Thurid, Mare of Destiny',
        type_line: 'Legendary Creature \u2014 Pegasus',
        oracle_text: 'Flying, lifelink\nWhenever you cast a Pegasus, Unicorn, or Horse creature spell, copy it. (The copy becomes a token.)\nOther Pegasi, Unicorns, and Horses you control get +1/+1.',
      },
    };
    const specs = parseStaticEffectSpecsFromOraclePermanent(thurid as any);
    const lords = specs.filter((s) => Number(s.grant?.power || 0) === 1 && Number(s.grant?.toughness || 0) === 1);
    expect(lords.length).toBeGreaterThanOrEqual(1);
    const types = new Set(lords.map((s) => String(s.scope?.creatureType || '').toLowerCase()).filter(Boolean));
    expect(types.has('pegasus')).toBe(true);
    expect(types.has('unicorn')).toBe(true);
    expect(types.has('horse')).toBe(true);
  });

  it('Spirit / Narset / Leovold enforce draw-per-turn caps', () => {
    const spirit = {
      id: 'sol', controller: 'p1',
      card: { name: 'Spirit of the Labyrinth', oracle_text: "Each player can't draw more than one card each turn." },
    };
    const narset = {
      id: 'nar', controller: 'p1',
      card: { name: 'Narset, Parter of Veils', oracle_text: "Each opponent can't draw more than one card each turn.\n-2: Look at the top four cards of your library." },
    };
    const state: any = { battlefield: [spirit], cardsDrawnThisTurn: { p1: 1, p2: 0 } };
    expect(getCardDrawCapRemaining(state, 'p1')).toBe(0);
    expect(isCardDrawProhibited(state, 'p1')).toBe(true);
    expect(getCardDrawCapRemaining(state, 'p2')).toBe(1);
    expect(isCardDrawProhibited({ battlefield: [spirit], cardsDrawnThisTurn: {} }, 'p2')).toBe(false);

    const oppState: any = { battlefield: [narset], cardsDrawnThisTurn: { p2: 1 } };
    expect(isCardDrawProhibited(oppState, 'p2')).toBe(true);
    expect(isCardDrawProhibited(oppState, 'p1')).toBe(false);
  });

  it('Maha sets base toughness 1 on opponent creatures only', () => {
    const maha = {
      id: 'maha', controller: 'p1',
      card: {
        name: 'Maha, Its Feathers Night',
        type_line: 'Legendary Creature \u2014 Elemental Bird',
        oracle_text: "Flying, trample\nWard\u2014Discard a card.\nCreatures your opponents control have base toughness 1.",
      },
    };
    const enemy = {
      id: 'bear', controller: 'p2',
      card: { name: 'Grizzly Bears', type_line: 'Creature \u2014 Bear', oracle_text: '', power: '2', toughness: '2' },
      basePower: 2, baseToughness: 2,
    };
    const ally = {
      id: 'ally', controller: 'p1',
      card: { name: 'Ally Bear', type_line: 'Creature \u2014 Bear', oracle_text: '', power: '2', toughness: '2' },
      basePower: 2, baseToughness: 2,
    };
    const state: any = { battlefield: [maha, enemy, ally], players: [{ id: 'p1' }, { id: 'p2' }] };
    collectStaticEffectSpecsFromState(state);
    const enemyBase = resolveSetBasePTFromStaticSpecs(enemy, state);
    expect(enemyBase).toEqual(expect.objectContaining({ toughness: 1 }));
    // Ally should not receive the opponents-only base toughness setter.
    const specs = parseStaticEffectSpecsFromOraclePermanent(maha as any);
    expect(specs.some((s) => s.scope?.kind === 'opponent_creatures' && s.grant?.setToughness === 1)).toBe(true);
    const allyBase = resolveSetBasePTFromStaticSpecs(ally, state);
    expect(allyBase == null || allyBase.toughness === undefined).toBe(true);
  });

  it('Ivorytusk Fortress still detected as group untap-on-others effect', () => {
    const ivory = {
      id: 'iv', controller: 'p1',
      card: {
        name: 'Ivorytusk Fortress',
        oracle_text: "Untap each creature you control with a +1/+1 counter on it during each other player's untap step.",
      },
    };
    const effects = detectUntapStepEffects(ivory.card, ivory);
    expect(effects.length).toBe(1);
    expect(effects[0].filter?.requirePlusOnePlusOne).toBe(true);
  });

  it("Detective of the Month grants Detectives unblockable with city's blessing", () => {
    const det = {
      id: 'dom', controller: 'p1',
      card: {
        name: 'Detective of the Month',
        type_line: 'Creature \u2014 Human Detective',
        oracle_text: "Ascend (If you control ten or more permanents, you get the city's blessing for the rest of the game.)\nAs long as you have the city's blessing, Detectives you control can't be blocked.\nWhenever you draw your second card each turn, create a 2/2 white and blue Detective creature token.",
      },
    };
    const specs = parseStaticEffectSpecsFromOraclePermanent(det as any);
    const hit = specs.find((s) => (s.grant?.abilities || []).some((a) => /can't be blocked/i.test(String(a))));
    expect(hit).toBeTruthy();
    expect(String(hit?.scope?.creatureType || '').toLowerCase()).toBe('detective');
    expect(hit?.condition?.kind === 'source_controller_has_citys_blessing' || (hit?.conditions || []).some((c: any) => c.kind === 'source_controller_has_citys_blessing')).toBe(true);
  });

  it('classifier marks until-EOT visit anthem and draw caps as other subsystems', () => {
    const eot = classifyStaticCensusLine('Visit \u2014 Creatures you control get +2/+0 until end of turn.', 'Roller Coaster');
    expect(eot?.system).toMatch(/until-EOT|visit/i);
    const draw = classifyStaticCensusLine("Each player can't draw more than one card each turn.", 'Spirit of the Labyrinth');
    expect(draw?.system).toMatch(/draw-per-turn|playersCantDraw/i);
    const ivory = classifyStaticCensusLine("Untap each creature you control with a +1/+1 counter on it during each other player's untap step.", 'Ivorytusk Fortress');
    expect(ivory?.system).toMatch(/untap|turnPhaseUntap/i);
  });
});
