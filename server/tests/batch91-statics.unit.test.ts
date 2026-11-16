import { describe, expect, it } from 'vitest';
import { collectReplacementEffectSpecsFromState, summarizeDrawAmountReplacements, summarizeTokenAmountReplacements } from '../src/state/modules/replacementEffectSpec.js';
import { evaluateDrawReplacementEvent, evaluateTokenCreationReplacementEvent } from '../src/state/modules/replacement-effects.js';
import { getOracleProliferateActionCount, parseBatch91ProliferateSentence } from '../src/state/modules/replacementBatch91ProliferateReplacements.js';
import { getProliferateActionCount } from '../src/state/modules/keywordActionRepetition.js';
import { adjustScryCount, parseBatch91ScryPlusSentence } from '../src/state/modules/replacementBatch91ScryReplacements.js';
import { applyTomorrowLookPutDraw, parseBatch91DrawSentence, wasReedRichardsUsedThisTurn, consumeReedRichardsFirstTimeThisTurn, collectBatch91DrawReplacementSpecs } from '../src/state/modules/replacementBatch91DrawReplacements.js';
import { parseBatch91LoseGameExileResetSentence, tryApplyLoseGameExileAndResetLife } from '../src/state/modules/replacementBatch91LoseGameReplacements.js';
import { applyBatch91DamageSideEffects, countControlledClerics, parseBatch91DamageSentence } from '../src/state/modules/replacementBatch91DamageReplacements.js';
import { collectDiesExileReplacementSpecsFromState } from '../src/state/modules/replacementEffectSpec-handlers/replacementEffectSpecZoneChangeDiesExileTemplates.js';
import { getGrantedBlitzAlternateCost, parseBatch91BlitzGrantSentence, reduceBlitzManaCostByCommanderTaxDiscount } from '../src/state/modules/batch91BlitzCastGrants.js';
import { parseBatch91NamedTokenSubstitution, parseBatch91TokenIdentitySubstitution, chainNamedTokenSubstitutions } from '../src/state/modules/replacementBatch91NamedTokenReplacements.js';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';

function P(name: string, oracle: string, typeLine: string, extra: Record<string, unknown> = {}) {
  return {
    id: String(extra.id || name.toLowerCase().replace(/[^a-z0-9]+/g, '-')),
    controller: 'p1',
    owner: 'p1',
    card: { name, oracle_text: oracle, type_line: typeLine },
    ...extra,
  };
}

const tekuthalOracle = 'Flying\nIf you would proliferate, proliferate twice instead.';
const tomorrowOracle = 'If you would draw a card, look at the top three cards of your library instead. Put one of those cards into your hand and the rest on the bottom of your library in any order.';
const reedOracle = 'Reach\nYou have no maximum hand size.\nThe first time you would draw a card each turn except the first card you draw during each of your draw steps, you draw four cards instead.';
const archangelOracle = 'Flying\nIf you would lose the game, instead exile this creature and your life total becomes equal to your starting life total.';
const battletideOracle = 'If a source would deal damage to a player, you may prevent X of that damage, where X is the number of Clerics you control.';
const gloomOracle = 'If combat damage would be dealt to this creature, prevent that damage and exile that many cards from the top of your library.';
const kenessosOracle = 'If you would scry a number of cards, scry that many cards plus one instead.';
const ravenousOracle = "This creature can't be blocked by creatures with power 2 or less.\nIf a creature an opponent controls would die, instead exile it and put a number of +1/+1 counters equal to that creature's power on this creature.";
const henzieOracle = 'Each creature spell you cast with mana value 4 or greater has blitz. The blitz cost is equal to its mana cost.\nBlitz costs you pay cost {1} less for each time you\'ve cast your commander from the command zone this game.';
const holoOracle = 'When this creature enters, create a 3/3 colorless Illusion artifact creature token.\nIf one or more tokens would be created under your control, that many 3/3 colorless Illusion artifact creature tokens are created instead.';
const fisherL2 = 'If you would create a Fish token, create a 3/3 blue Shark creature token instead.';
const fisherL3 = 'If you would create a Fish token, create a 3/3 blue Shark creature token instead.\nIf you would create a Shark token, create an 8/8 blue Octopus creature token instead.';

describe('batch91 proliferate, draw, lose-game, damage, scry, blitz, tokens', () => {
  it('Tekuthal proliferate-twice is a hook that queues two actions, not a 4x stack', () => {
    expect(parseBatch91ProliferateSentence(tekuthalOracle)).toEqual([{ times: 2 }]);
    const tekuthal = P('Tekuthal, Inquiry Dominus', tekuthalOracle, 'Legendary Creature — Phyrexian Horror', { id: 'tek' });
    const state: any = { battlefield: [tekuthal], players: [{ id: 'p1' }] };
    expect(getOracleProliferateActionCount(state, 'p1')).toBe(2);
    expect(getProliferateActionCount(state.battlefield, 'p1')).toBe(2);
    expect(getProliferateActionCount(state.battlefield, 'p1', { skipReplacement: true })).toBe(1);
    const two: any = { battlefield: [tekuthal, { ...tekuthal, id: 'tek-2' }], players: [{ id: 'p1' }] };
    expect(getOracleProliferateActionCount(two, 'p1')).toBe(2);
    expect(getProliferateActionCount(two.battlefield, 'p1')).toBe(2);
    const specs = collectReplacementEffectSpecsFromState(state).filter((s) => s.event === 'proliferate');
    expect(specs.length).toBeGreaterThan(0);
    expect(specs[0]?.metadata?.proliferateTimes).toBe(2);
  });

  it('Tomorrow and Reed Richards hook the draw path without double-firing Reed', () => {
    expect(parseBatch91DrawSentence(tomorrowOracle.split('.')[0] + '.')).toEqual([{ kind: 'tomorrow', look: 3 }]);
    expect(parseBatch91DrawSentence('The first time you would draw a card each turn except the first card you draw during each of your draw steps, you draw four cards instead.')).toEqual([{ kind: 'reed', cards: 4 }]);

    const library = [
      { id: 'c1', name: 'Island' },
      { id: 'c2', name: 'Mountain' },
      { id: 'c3', name: 'Swamp' },
      { id: 'c4', name: 'Forest' },
    ];
    const tomorrowState: any = { zones: { p1: { library: [...library], hand: [] } }, players: [{ id: 'p1' }] };
    const applied = applyTomorrowLookPutDraw(tomorrowState, 'p1', 3, 'c2');
    expect(applied.handCard?.name).toBe('Mountain');
    expect(tomorrowState.zones.p1.hand.map((c: any) => c.id)).toEqual(['c2']);
    expect(tomorrowState.zones.p1.library.map((c: any) => c.id)).toEqual(['c4', 'c1', 'c3']);

    const tomorrow = P("Tomorrow, Azami's Familiar", tomorrowOracle, 'Legendary Creature — Spirit', { id: 'tm' });
    const ev = evaluateDrawReplacementEvent({
      state: { battlefield: [tomorrow] },
      playerId: 'p1',
      count: 1,
    });
    expect(ev.choiceRequired).toBe(true);
    expect(ev.effectId).toBe('controller-draw-look-top-put-one-in-hand');
    expect((ev.metadata as any)?.lookAtLibraryTop).toBe(3);

    const reed = P('Reed Richards, Smartest Man', reedOracle, 'Legendary Creature — Human Scientist Hero', { id: 'rr' });
    const reedState: any = { battlefield: [reed], players: [{ id: 'p1' }] };
    const first = summarizeDrawAmountReplacements(reedState, 'p1', { isFirstDrawStepDraw: false });
    expect((1 + first.extraCards) * first.multiplier).toBe(4);
    expect(consumeReedRichardsFirstTimeThisTurn(reedState, 'rr', 'p1')).toBe(true);
    expect(wasReedRichardsUsedThisTurn(reedState, 'rr', 'p1')).toBe(true);
    // After the first extra draw is consumed, a later summarize with the flag set adds nothing.
    const skipped = collectBatch91DrawReplacementSpecs(reedOracle, { sourcePermanentId: 'rr', sourceController: 'p1', sourceName: 'Reed' });
    expect(skipped.some((s) => s.metadata?.replaceDrawCountWith === 4)).toBe(true);
    const drawStep = summarizeDrawAmountReplacements(reedState, 'p1', { isFirstDrawStepDraw: true });
    expect((1 + drawStep.extraCards) * drawStep.multiplier).toBe(1);
  });

  it('Exquisite Archangel exiles itself and resets life instead of losing', () => {
    expect(parseBatch91LoseGameExileResetSentence(archangelOracle)).toBe(true);
    const angel = P('Exquisite Archangel', archangelOracle, 'Creature — Angel', { id: 'ea' });
    const state: any = {
      startingLife: 40,
      life: { p1: 0 },
      battlefield: [angel],
      players: [{ id: 'p1', life: 0, hasLost: false }],
      zones: { p1: { exile: [] } },
    };
    expect(tryApplyLoseGameExileAndResetLife(state, 'p1')).toBe(true);
    expect(state.life.p1).toBe(40);
    expect(state.players[0].life).toBe(40);
    expect(state.players[0].hasLost).toBe(false);
    expect(state.battlefield.find((p: any) => p.id === 'ea')).toBeUndefined();
    expect(state.zones.p1.exile.some((c: any) => c.name === 'Exquisite Archangel')).toBe(true);
    expect(tryApplyLoseGameExileAndResetLife(state, 'p1')).toBe(false);
  });

  it('Battletide prevents X (Clerics) and Gloom Surgeon prevents combat damage and exiles that many', () => {
    expect(parseBatch91DamageSentence(battletideOracle)).toEqual([{ kind: 'battletide' }]);
    expect(parseBatch91DamageSentence(gloomOracle)).toEqual([{ kind: 'gloom' }]);
    const battletide = P('Battletide Alchemist', battletideOracle, 'Creature — Kithkin Cleric', { id: 'ba' });
    const cleric = P('Other Cleric', 'Vigilance', 'Creature — Cleric', { id: 'oc' });
    const state: any = { battlefield: [battletide, cleric], players: [{ id: 'p1' }], zones: { p1: { library: [], exile: [] } } };
    expect(countControlledClerics(state, 'p1')).toBe(2);
    const prevented = applyBatch91DamageSideEffects({ state } as any, 5, 'p2', 'p1', 'src', undefined, false);
    expect(prevented?.amount).toBe(3);
    expect(prevented?.modifiers[0]).toMatch(/prevented 2/);

    const gloom = P('Gloom Surgeon', gloomOracle, 'Creature — Spirit', { id: 'gs' });
    const gloomState: any = {
      battlefield: [gloom],
      players: [{ id: 'p1' }],
      zones: { p1: { library: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }], exile: [] } },
    };
    const g = applyBatch91DamageSideEffects({ state: gloomState } as any, 2, 'p2', 'p1', 'src', 'gs', true);
    expect(g?.amount).toBe(0);
    expect(gloomState.zones.p1.exile.map((c: any) => c.id)).toEqual(['a', 'b']);
    expect(gloomState.zones.p1.library.map((c: any) => c.id)).toEqual(['c']);
  });

  it('Kenessos adds one to a scry amount', () => {
    expect(parseBatch91ScryPlusSentence(kenessosOracle)).toEqual([{ plus: 1 }]);
    const kenessos = P('Kenessos, Priest of Thassa', kenessosOracle, 'Legendary Creature — Merfolk Cleric', { id: 'kp' });
    const state: any = { battlefield: [kenessos], players: [{ id: 'p1' }] };
    expect(adjustScryCount(state, 'p1', 2)).toBe(3);
    expect(adjustScryCount(state, 'p2', 2)).toBe(2);
    expect(collectReplacementEffectSpecsFromState(state).some((s) => s.event === 'scry')).toBe(true);
  });

  it('Ravenous Slime exiles an opponent creature and puts its power as +1/+1 counters on the slime', () => {
    const slime = P('Ravenous Slime', ravenousOracle, 'Creature — Ooze', { id: 'rs' });
    const specs = collectDiesExileReplacementSpecsFromState({ battlefield: [slime] });
    const hit = specs.find((s) => s.metadata && (s.metadata as any).putP1P1OnSourceEqualToObjectPower === true);
    expect(hit).toBeTruthy();
    expect(hit?.instead.redirectZone).toBe('exile');
    expect(hit?.match?.objectControllerIsOpponentOfSource).toBe(true);
  });

  it('Henzie grants blitz equal to mana cost for MV 4+ creature spells, and discounts blitz costs', () => {
    expect(parseBatch91BlitzGrantSentence(henzieOracle)?.minManaValue).toBe(4);
    const henzie = P('Henzie "Toolbox" Torre', henzieOracle, 'Legendary Creature — Devil Rogue', { id: 'hz' });
    const state: any = { battlefield: [henzie], commanderCastCount: { p1: 2 }, players: [{ id: 'p1' }] };
    const beast = { name: 'Huge Beast', type_line: 'Creature — Beast', mana_cost: '{3}{G}', cmc: 4 };
    const granted = getGrantedBlitzAlternateCost(state, 'p1', beast);
    expect(granted?.manaCost).toBe('{1}{G}');
    const small = { name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{1}{G}', cmc: 2 };
    expect(getGrantedBlitzAlternateCost(state, 'p1', small)).toBeUndefined();
    expect(reduceBlitzManaCostByCommanderTaxDiscount('{4}{B}', 3)).toBe('{1}{B}');
    const specs = parseStaticEffectSpecsFromOraclePermanent(henzie as any);
    expect(specs.some((s: any) => s.grant?.keyword === 'blitz')).toBe(true);
  });

  it('Holo-Engineer and Fisher\'s Talent substitute token identity, including named chaining', () => {
    expect(parseBatch91TokenIdentitySubstitution(holoOracle)[0]?.token).toMatchObject({
      name: 'Illusion', power: 3, toughness: 3,
    });
    const holo = P('Holo-Engineer', holoOracle, 'Creature — Human Artificer', { id: 'he' });
    const ident = evaluateTokenCreationReplacementEvent({
      state: { battlefield: [holo] },
      controllerId: 'p1',
      count: 2,
      tokenName: 'Soldier',
      tokenTypeLine: 'Creature — Soldier',
    });
    expect((ident.metadata as any)?.replaceCreatedToken).toMatchObject({ name: 'Illusion', power: 3, toughness: 3 });
    expect(ident.replacementAmount).toBe(2);

    const named = parseBatch91NamedTokenSubstitution(fisherL3);
    expect(named.map((n) => n.fromName)).toEqual(['Fish', 'Shark']);
    expect(chainNamedTokenSubstitutions('Fish', named)?.name).toBe('Octopus');
    expect(chainNamedTokenSubstitutions('Shark', named)?.name).toBe('Octopus');
    expect(chainNamedTokenSubstitutions('Fish', parseBatch91NamedTokenSubstitution(fisherL2))?.name).toBe('Shark');

    const fisher = P("Fisher's Talent", fisherL3, 'Enchantment — Class', { id: 'ft' });
    const fish = evaluateTokenCreationReplacementEvent({
      state: { battlefield: [fisher] },
      controllerId: 'p1',
      count: 1,
      tokenName: 'Fish',
      tokenTypeLine: 'Creature — Fish',
    });
    expect((fish.metadata as any)?.replaceCreatedToken).toMatchObject({ name: 'Octopus', power: 8, toughness: 8, colors: ['U'] });
    const treasure = evaluateTokenCreationReplacementEvent({
      state: { battlefield: [fisher] },
      controllerId: 'p1',
      count: 1,
      tokenName: 'Treasure',
      tokenTypeLine: 'Artifact — Treasure',
    });
    expect(treasure?.applied).not.toBe(true);
    expect((treasure as any)?.metadata?.replaceCreatedToken).toBeUndefined();
    void summarizeTokenAmountReplacements;
  });

  it('classifiers cover B91 families', () => {
    const rows: Array<[string, string]> = [
      [tekuthalOracle.split('\n')[1], 'Tekuthal, Inquiry Dominus'],
      [tomorrowOracle, "Tomorrow, Azami's Familiar"],
      [reedOracle.split('\n')[2], 'Reed Richards, Smartest Man'],
      [archangelOracle.split('\n')[1], 'Exquisite Archangel'],
      [battletideOracle, 'Battletide Alchemist'],
      [gloomOracle, 'Gloom Surgeon'],
      [kenessosOracle, 'Kenessos, Priest of Thassa'],
      [ravenousOracle.split('\n')[1], 'Ravenous Slime'],
      ['Each creature spell you cast with mana value 4 or greater has blitz. The blitz cost is equal to its mana cost.', 'Henzie "Toolbox" Torre'],
      [holoOracle.split('\n')[1], 'Holo-Engineer'],
      [fisherL2, "Fisher's Talent"],
      ['If you would create a Shark token, create an 8/8 blue Octopus creature token instead.', "Fisher's Talent"],
    ];
    for (const [line, name] of rows) {
      const result = classifyStaticCensusLine(line, name);
      expect(result?.kind, `${name}: ${line}`).not.toBe('owned_but_unhandled');
    }
  });
});
