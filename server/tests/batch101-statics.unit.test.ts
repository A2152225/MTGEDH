// server/tests/batch101-statics.unit.test.ts
import { describe, expect, it } from 'vitest';
import {
  parseEssenceEnterAsCopy,
  parseEsixFirstTokensCopy,
  parseLandEquilibrium,
  parseRecoverCost,
  parseDarkbladeSurveilGrants,
  parsePickAxeAsAttachesChoice,
  parseEquippedIsCopyOfLastChosen,
  parseStunCountersCantBeRemovedFromOpponents,
  parseShieldPreventXCreatures,
  parseDinosaurGraveyardHasEscape,
  parseCairnWandererGyKeywords,
  parseOpponentVentureOncePerTurn,
  parseCasualtyX,
  parseSolvedIsCreaturePTKeywords,
  parseBludgeonBrawl,
  parseChosenPlayerHandPT,
  parseNonlandGraveyardMayhem,
  halfLifeRoundedUp,
} from '../src/state/modules/batch101Parsers.js';
import { parseBatch101LongTailStaticKind } from '../src/state/modules/staticEffectSpec-handlers/batch101LongTailStatics.js';
import { collectBatch101ReplacementSpecs, collectBatch101ReplacementSpecsFromState } from '../src/state/modules/replacementBatch101Collect.js';
import { applyEssenceEnterAsCopy, listEsixFirstTokenSources, maybeQueueEsixFirstTokensChoice } from '../src/state/modules/batch101EnterCopyAndTokens.js';
import {
  landEquilibriumWouldApply,
  notePlayerSurveilledThisTurn,
  playerSurveilledThisTurn,
  clearSurveilledThisTurn,
  noteCreatureCardToGraveyardThisTurn,
  creatureCardsPutIntoGraveyardsThisTurn,
  listRecoverCardsInGraveyard,
  applyRecoverDecision,
} from '../src/state/modules/batch101LandRecoverSurveil.js';
import {
  opponentStunCountersLocked,
  applyShieldOfTheAvatarPrevention,
  dinosaurHasGrantedEscape,
  grantedEscapeCostForDinosaur,
  nonlandHasGrantedMayhem,
  keywordsGrantedFromGraveyardCreatures,
  darkbladeGrantsDeathtouch,
  opponentVentureBlockedThisTurn,
  notePlayerVenturedThisTurn,
  maybeSolveCaseGorgonsKiss,
  applySolvedCaseCreatureTypes,
  applyBludgeonBrawlToArtifacts,
  calculateChosenPlayerHandPT,
  applyPickAxeChosenCraftCard,
} from '../src/state/modules/batch101LongTailApply.js';
import { canTargetPermanent } from '../../rules-engine/src/permanentTargeting.js';

const ESSENCE = 'Creatures you control enter as a copy of this creature.';
const ESIX = 'The first time you would create one or more tokens during each of your turns, you may instead choose a creature other than Esix, Fractal Bloom and create that many tokens that are copies of that creature.';
const LAND_EQ = 'If an opponent who controls at least as many lands as you do would put a land onto the battlefield, that player instead puts that land onto the battlefield then sacrifices a land of their choice.';
const GARZA = 'Recover—Pay half your life, rounded up. (When another creature is put into your graveyard from the battlefield, you may pay half your life, rounded up. If you do, return this card from your graveyard to your hand. Otherwise, exile this card.)';
const KROVIKAN = 'Recover {1}{B}{B} (When a creature is put into your graveyard from the battlefield, you may pay {1}{B}{B}. If you do, return this card from your graveyard to your hand. Otherwise, exile this card.)';
const DARKBLADE = "As long as you've surveilled this turn, this creature has deathtouch and \"Whenever this creature deals combat damage to a player, you may draw that many cards.\"";
const PICKAXE = 'As this Equipment becomes attached to a creature, choose an exiled creature card used to craft this Equipment. Equipped creature is a copy of the last chosen card.';
const FEAR = "Stun counters can't be removed from permanents your opponents control.";
const SHIELD = 'If a source would deal damage to equipped creature, prevent X of that damage, where X is the number of creatures you control.';
const JURASSIC = "Each Dinosaur card in your graveyard has escape. The escape cost is equal to the card's mana cost plus exile three other cards from your graveyard.";
const CAIRN = 'As long as a creature card with flying is in a graveyard, Cairn Wanderer has flying. The same is true for fear, first strike, double strike, deathtouch, haste, landwalk, lifelink, protection, reach, trample, shroud, and vigilance.';
const SENTRY = "You have hexproof.\nEach opponent can't venture into the dungeon more than once each turn.";
const NIXILIS = 'Casualty X. The copy isn\'t legendary and has starting loyalty X.';
const GORGON = 'To solve — Three or more creature cards were put into graveyards from anywhere this turn.\nSolved — This Case is a 4/4 Gorgon creature with deathtouch and lifelink in addition to its other types.';
const BLUDGEON = 'Each noncreature, non-Equipment artifact is an Equipment with equip {X} and "Equipped creature gets +X/+0," where X is that artifact\'s mana value.';
const ENTROPIC = "As Entropic Specter enters, choose an opponent.\nEntropic Specter's power and toughness are each equal to the number of cards in the chosen player's hand.";
const GOBLIN = 'Each nonland card in your graveyard has mayhem. The mayhem cost is equal to its mana cost.';
const TOMIK = "Lands on the battlefield and land cards in graveyards can't be the targets of spells or abilities your opponents control.\nYour opponents can't play land cards from graveyards.";

function perm(id: string, controller: string, name: string, oracle: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    controller,
    card: { id: `${id}-card`, name, oracle_text: oracle, type_line: (extra.type_line as string) || 'Creature', ...(extra.card as object || {}) },
    ...extra,
  };
}

describe('B101 parsers', () => {
  it('parses Essence, Esix, Land Equilibrium, recover, and Darkblade', () => {
    expect(parseEssenceEnterAsCopy(ESSENCE)).toBe(true);
    expect(parseEsixFirstTokensCopy(ESIX)).toBe(true);
    expect(parseLandEquilibrium(LAND_EQ)).toBe(true);
    expect(parseRecoverCost(GARZA)).toEqual({ kind: 'pay_half_life_rounded_up' });
    expect(parseRecoverCost(KROVIKAN)).toEqual({ kind: 'mana', cost: '{1}{B}{B}' });
    expect(parseDarkbladeSurveilGrants(DARKBLADE)).toBe(true);
    expect(halfLifeRoundedUp(19)).toBe(10);
    expect(halfLifeRoundedUp(20)).toBe(10);
  });

  it('parses Pick-Axe, Fear, Shield, Jurassic, Cairn, Sentry, casualty X, Case, Bludgeon, Entropic, mayhem', () => {
    expect(parsePickAxeAsAttachesChoice(PICKAXE)).toBe(true);
    expect(parseEquippedIsCopyOfLastChosen(PICKAXE)).toBe(true);
    expect(parseStunCountersCantBeRemovedFromOpponents(FEAR)).toBe(true);
    expect(parseShieldPreventXCreatures(SHIELD)).toBe(true);
    expect(parseDinosaurGraveyardHasEscape(JURASSIC)).toBe(true);
    const kws = parseCairnWandererGyKeywords(CAIRN);
    expect(kws).toContain('flying');
    expect(kws).toContain('deathtouch');
    expect(kws).toContain('vigilance');
    expect(kws).toContain('landwalk');
    expect(parseOpponentVentureOncePerTurn(SENTRY)).toBe(true);
    expect(parseCasualtyX(NIXILIS)).toBe(true);
    const solved = parseSolvedIsCreaturePTKeywords(GORGON);
    expect(solved).toMatchObject({ power: 4, toughness: 4, keywords: ['deathtouch', 'lifelink'] });
    expect(solved?.types).toEqual(expect.arrayContaining(['Creature', 'Gorgon']));
    expect(parseBludgeonBrawl(BLUDGEON)).toBe(true);
    expect(parseChosenPlayerHandPT(ENTROPIC)).toBe(true);
    expect(parseNonlandGraveyardMayhem(GOBLIN)).toBe(true);
  });

  it('emits static kinds and replacement specs for the wired B101 oracles', () => {
    const kinds = [
      ...parseBatch101LongTailStaticKind(ESSENCE),
      ...parseBatch101LongTailStaticKind(ESIX),
      ...parseBatch101LongTailStaticKind(LAND_EQ),
      ...parseBatch101LongTailStaticKind(DARKBLADE),
      ...parseBatch101LongTailStaticKind(FEAR),
      ...parseBatch101LongTailStaticKind(SHIELD),
      ...parseBatch101LongTailStaticKind(JURASSIC),
      ...parseBatch101LongTailStaticKind(CAIRN),
      ...parseBatch101LongTailStaticKind(SENTRY),
      ...parseBatch101LongTailStaticKind(GORGON),
      ...parseBatch101LongTailStaticKind(BLUDGEON),
      ...parseBatch101LongTailStaticKind(ENTROPIC),
      ...parseBatch101LongTailStaticKind(GOBLIN),
      ...parseBatch101LongTailStaticKind(PICKAXE),
    ];
    expect(kinds.length).toBeGreaterThanOrEqual(14);
    const specs = collectBatch101ReplacementSpecs(ESSENCE + '\n' + ESIX + '\n' + LAND_EQ + '\n' + FEAR + '\n' + SHIELD, {
      sourcePermanentId: 's1',
      sourceController: 'p1',
      sourceName: 'Bundle',
    });
    expect(specs.map((s) => s.reason)).toEqual(expect.arrayContaining([
      'essence_enter_as_copy',
      'esix_first_tokens_copy',
      'land_equilibrium_sacrifice',
      'opponent_stun_counters_locked',
      'prevent_x_damage_to_equipped_creatures_you_control',
    ]));
  });
});

describe('B101 Tomik canTarget gate', () => {
  it('blocks opponent targeting of battlefield lands when Tomik is out', () => {
    const state: any = {
      battlefield: [
        perm('tomik', 'p1', 'Tomik, Distinguished Advokist', TOMIK, { type_line: 'Legendary Creature — Human Advisor' }),
        perm('land', 'p2', 'Forest', '', { type_line: 'Basic Land — Forest' }),
      ],
    };
    const blocked = canTargetPermanent(state.battlefield[1], { controllerId: 'p2', objectType: 'spell', colors: [] }, state);
    expect(blocked.canTarget).toBe(false);
    const own = canTargetPermanent(state.battlefield[1], { controllerId: 'p1', objectType: 'spell', colors: [] }, state);
    expect(own.canTarget).toBe(true);
  });
});

describe('B101 Essence and Esix', () => {
  it('makes a controlled creature enter as a copy of Essence, not Essence itself', () => {
    const essence = perm('e1', 'p1', 'Essence of the Wild', ESSENCE, { type_line: 'Creature — Avatar', card: { name: 'Essence of the Wild', oracle_text: ESSENCE, type_line: 'Creature — Avatar', power: 6, toughness: 6 } });
    const incoming = perm('c1', 'p1', 'Grizzly Bears', '', { type_line: 'Creature — Bear', card: { name: 'Grizzly Bears', oracle_text: '', type_line: 'Creature — Bear', power: 2, toughness: 2 } });
    const state = { battlefield: [essence] };
    const result = applyEssenceEnterAsCopy(state, incoming);
    expect(result.applied).toBe(true);
    expect(incoming.copyOf).toBe('Essence of the Wild');
    const self = applyEssenceEnterAsCopy({ battlefield: [essence] }, essence);
    expect(self.applied).toBe(false);
  });

  it('lists Esix as a first-tokens source only on the controller\'s unused turn', () => {
    const esix = perm('esix', 'p1', 'Esix, Fractal Bloom', ESIX);
    const state: any = { battlefield: [esix], turnPlayer: 'p1' };
    expect(listEsixFirstTokenSources(state, 'p1').map((p) => p.id)).toEqual(['esix']);
    state.esixFirstTokensUsedThisTurn = { esix: true, p1: true };
    expect(listEsixFirstTokenSources(state, 'p1')).toEqual([]);
  });
});

describe('B101 Land Equilibrium, recover, surveil', () => {
  it('applies Land Equilibrium when the opponent already has at least as many lands', () => {
    const state: any = {
      battlefield: [
        perm('le', 'p1', 'Land Equilibrium', LAND_EQ, { type_line: 'Enchantment' }),
        perm('l1', 'p1', 'Island', '', { type_line: 'Basic Land — Island' }),
        perm('l2', 'p2', 'Forest', '', { type_line: 'Basic Land — Forest' }),
        perm('l3', 'p2', 'Mountain', '', { type_line: 'Basic Land — Mountain' }),
      ],
    };
    expect(landEquilibriumWouldApply(state, 'p2', 1)?.source.id).toBe('le');
    expect(landEquilibriumWouldApply(state, 'p2', 0)).toBeNull();
  });

  it('returns a recover card to hand after paying half life, otherwise exiles it', () => {
    const card = { id: 'g1', name: "Garza's Assassin", oracle_text: GARZA, type_line: 'Creature — Human Assassin' };
    const state: any = { life: { p1: 19 }, zones: { p1: { graveyard: [card], hand: [], exile: [] } } };
    expect(listRecoverCardsInGraveyard(state, 'p1').map((e) => e.cost.kind)).toEqual(['pay_half_life_rounded_up']);
    const paid = applyRecoverDecision(state, 'p1', 'g1', true, 19);
    expect(paid).toMatchObject({ applied: true, destination: 'hand', lifePaid: 10 });
    expect(state.life.p1).toBe(9);
    expect(state.zones.p1.hand[0].id).toBe('g1');
    const card2 = { id: 'g2', name: 'Krovikan Rot', oracle_text: KROVIKAN, type_line: 'Instant' };
    const state2: any = { zones: { p1: { graveyard: [card2], hand: [], exile: [] } } };
    const exiled = applyRecoverDecision(state2, 'p1', 'g2', false);
    expect(exiled.destination).toBe('exile');
    expect(state2.zones.p1.exile[0].id).toBe('g2');
  });

  it('tracks surveil-this-turn and grants Darkblade deathtouch only then', () => {
    const state: any = { battlefield: [perm('db', 'p1', 'Darkblade Agent', DARKBLADE)] };
    expect(playerSurveilledThisTurn(state, 'p1')).toBe(false);
    expect(darkbladeGrantsDeathtouch(state, state.battlefield[0])).toBe(false);
    notePlayerSurveilledThisTurn(state, 'p1');
    expect(playerSurveilledThisTurn(state, 'p1')).toBe(true);
    expect(darkbladeGrantsDeathtouch(state, state.battlefield[0])).toBe(true);
    clearSurveilledThisTurn(state);
    expect(darkbladeGrantsDeathtouch(state, state.battlefield[0])).toBe(false);
  });
});

describe('B101 long tail applies', () => {
  it('locks opponent stun-counter removal and prevents X Shield damage', () => {
    const state: any = {
      battlefield: [
        perm('fear', 'p1', 'Fear of Sleep Paralysis', FEAR, { type_line: 'Enchantment Creature — Nightmare' }),
        perm('opp', 'p2', 'Bear', '', { type_line: 'Creature — Bear', counters: { stun: 1 } }),
        perm('eq', 'p1', 'Shield of the Avatar', SHIELD, { type_line: 'Artifact — Equipment', attachedToId: 'hero' }),
        perm('hero', 'p1', 'Soldier', '', { type_line: 'Creature — Human Soldier' }),
        perm('c2', 'p1', 'Cleric', '', { type_line: 'Creature — Human Cleric' }),
      ],
    };
    expect(opponentStunCountersLocked(state, state.battlefield[1])).toBe(true);
    const prevented = applyShieldOfTheAvatarPrevention(state, 5, 'hero');
    expect(prevented?.amount).toBe(2);
  });

  it('grants Jurassic escape and Green Goblin mayhem, and copies Cairn keywords from graveyards', () => {
    const state: any = {
      battlefield: [
        perm('jp', 'p1', 'Jurassic Park', JURASSIC, { type_line: 'Legendary Land' }),
        perm('gg', 'p1', 'Green Goblin', GOBLIN, { type_line: 'Legendary Creature — Goblin Villain' }),
        perm('cw', 'p1', 'Cairn Wanderer', CAIRN, { type_line: 'Creature — Shapeshifter' }),
      ],
      zones: {
        p1: {
          graveyard: [
            { id: 'd1', name: 'Altered Beast', type_line: 'Creature — Dinosaur', mana_cost: '{2}{G}', oracle_text: 'Trample' },
            { id: 's1', name: 'Shock', type_line: 'Instant', mana_cost: '{R}', oracle_text: '' },
          ],
        },
        p2: {
          graveyard: [
            { id: 'f1', name: 'Sengir Vampire', type_line: 'Creature — Vampire', oracle_text: 'Flying, lifelink' },
          ],
        },
      },
    };
    expect(dinosaurHasGrantedEscape(state, state.zones.p1.graveyard[0], 'p1')).toBe(true);
    expect(grantedEscapeCostForDinosaur(state.zones.p1.graveyard[0])).toContain('{2}{G}');
    expect(nonlandHasGrantedMayhem(state, state.zones.p1.graveyard[1], 'p1')).toBe(true);
    expect(keywordsGrantedFromGraveyardCreatures(state, state.battlefield[2])).toEqual(expect.arrayContaining(['flying', 'trample', 'lifelink']));
  });

  it('blocks a second opponent venture, solves Case of the Gorgon\'s Kiss, stamps Bludgeon Brawl, and sets Entropic P/T', () => {
    const state: any = {
      battlefield: [
        perm('ks', 'p1', 'Keen-Eared Sentry', SENTRY, { type_line: 'Creature — Human Soldier' }),
        perm('case', 'p1', "Case of the Gorgon's Kiss", GORGON, { type_line: 'Enchantment — Case' }),
        perm('bb', 'p1', 'Bludgeon Brawl', BLUDGEON, { type_line: 'Enchantment' }),
        perm('sol', 'p2', 'Sol Ring', '', { type_line: 'Artifact', card: { name: 'Sol Ring', type_line: 'Artifact', cmc: 1, oracle_text: '' } }),
      ],
      zones: { p2: { hand: [{ id: 'h1' }, { id: 'h2' }, { id: 'h3' }], handCount: 3 } },
    };
    expect(opponentVentureBlockedThisTurn(state, 'p2')).toBe(false);
    notePlayerVenturedThisTurn(state, 'p2');
    expect(opponentVentureBlockedThisTurn(state, 'p2')).toBe(true);
    noteCreatureCardToGraveyardThisTurn(state);
    noteCreatureCardToGraveyardThisTurn(state);
    expect(maybeSolveCaseGorgonsKiss(state)).toBe(0);
    noteCreatureCardToGraveyardThisTurn(state);
    expect(creatureCardsPutIntoGraveyardsThisTurn(state)).toBe(3);
    expect(maybeSolveCaseGorgonsKiss(state)).toBe(1);
    const casePerm = state.battlefield[1];
    expect(casePerm.solved).toBe(true);
    const applied = applySolvedCaseCreatureTypes(casePerm);
    expect(applied.applied).toBe(true);
    expect(casePerm.power).toBe(4);
    expect(casePerm.keywords).toEqual(expect.arrayContaining(['deathtouch', 'lifelink']));
    expect(applyBludgeonBrawlToArtifacts(state)).toBe(1);
    expect(String(state.battlefield[3].card.type_line)).toMatch(/Equipment/);
    expect(state.battlefield[3].equippedCreaturePump).toEqual({ power: 1, toughness: 0 });
    const specter = { id: 'es', chosenPlayer: 'p2', oracle_text: ENTROPIC, name: 'Entropic Specter' };
    expect(calculateChosenPlayerHandPT(specter, state)).toEqual({ power: 3, toughness: 3 });
  });

  it('copies the equipped creature from the last chosen craft card', () => {
    const dino = { id: 'ex1', name: 'Hunting Velociraptor', type_line: 'Creature — Dinosaur', oracle_text: 'First strike' };
    const equipment = perm('axe', 'p1', "Dinosaur Headdress", PICKAXE, { type_line: 'Artifact — Equipment', craftedFromCards: [dino], attachedToId: 'bear' });
    const bear = perm('bear', 'p1', 'Grizzly Bears', '', { type_line: 'Creature — Bear' });
    const state: any = { battlefield: [equipment, bear] };
    expect(applyPickAxeChosenCraftCard(state, 'axe', 'ex1', 'bear')).toBe(true);
    expect(bear.copyOf).toBe('Hunting Velociraptor');
  });

  it('collects B101 replacement specs from a live battlefield', () => {
    const state = {
      battlefield: [
        perm('e1', 'p1', 'Essence of the Wild', ESSENCE),
        perm('sh', 'p1', 'Shield of the Avatar', SHIELD, { type_line: 'Artifact — Equipment' }),
      ],
    };
    const specs = collectBatch101ReplacementSpecsFromState(state);
    expect(specs.length).toBeGreaterThanOrEqual(2);
  });
});
