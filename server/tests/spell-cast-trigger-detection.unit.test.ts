import { describe, expect, it } from 'vitest';
import { detectSpellCastTriggers } from '../src/state/modules/triggered-abilities.js';
import { detectOpponentSpellCastTriggers } from '../src/state/modules/triggers/spell-cast.js';
import { isModalChooseModesEffectText } from '../src/state/modules/inferTriggeredAbilityTargetMetadata.js';

const permanent = { id: 'P1', controller: 'P1' };

describe('spell cast trigger detection gaps', () => {
  it('detects Rhystic Study once (known type, not duplicated by generic unless-pay)', () => {
    const triggers = detectOpponentSpellCastTriggers({
      name: 'Rhystic Study',
      oracle_text: 'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.',
    }, permanent);
    expect(triggers).toHaveLength(1);
    expect(triggers[0]?.triggerType).toBe('rhystic_study');
    expect(triggers[0]?.paymentCost).toBe('{1}');
    expect(triggers[0]?.benefitIfNotPaid).toBe('draw a card');
  });

  it('detects opponent cast triggers without unless payment', () => {
    const triggers = detectOpponentSpellCastTriggers({
      name: 'Counterbalance',
      oracle_text: 'Whenever an opponent casts a spell, you may reveal the top card of your library. If you do, counter that spell if it has the same mana value as the revealed card.',
    }, permanent);
    expect(triggers.length).toBeGreaterThan(0);
    expect(triggers[0]?.casterScope).toBe('opponent');
  });

  it('detects any-player instant or sorcery copy triggers (Hive Mind)', () => {
    const triggers = detectOpponentSpellCastTriggers({
      name: 'Hive Mind',
      oracle_text:
        'Whenever a player casts an instant or sorcery spell, each other player copies that spell. Each of those players may choose new targets for their copy.',
    }, permanent);
    expect(triggers.some((t) => t.casterScope === 'any_player' && t.spellCondition === 'instant_sorcery')).toBe(true);
    expect(triggers.some((t) => /each other player copies that spell/i.test(String(t.benefitIfNotPaid || '')))).toBe(true);
  });

  it('detects any-player cast triggers', () => {
    const triggers = detectOpponentSpellCastTriggers({
      name: 'Blind Creeper',
      oracle_text: 'Whenever a player casts a spell, this creature gets -1/-1 until end of turn.',
    }, permanent);
    expect(triggers.length).toBeGreaterThan(0);
    expect(triggers[0]?.casterScope).toBe('any_player');
  });

  it('detects opponent creature spell triggers (Opal cycle)', () => {
    const triggers = detectOpponentSpellCastTriggers({
      name: 'Opal Champion',
      oracle_text: 'When an opponent casts a creature spell, if this permanent is an enchantment, it becomes a 3/3 Knight creature with first strike.',
    }, permanent);
    expect(triggers.some((t) => t.spellCondition === 'creature')).toBe(true);
  });

  it('detects first spell during each opponent turn', () => {
    const triggers = detectSpellCastTriggers({
      name: "Nymris, Oona's Trickster",
      oracle_text: "Whenever you cast your first spell during each opponent's turn, look at the top two cards of your library. Put one of those cards into your hand and the other into your graveyard.",
    }, permanent);
    expect(triggers.some((t) => t.firstSpellDuringOpponentTurn === true)).toBe(true);
  });

  it('detects first spell each turn (Rashmi)', () => {
    const triggers = detectSpellCastTriggers({
      name: 'Rashmi, Eternities Crafter',
      oracle_text: "Whenever you cast your first spell each turn, reveal the top card of your library. You may cast it without paying its mana cost if it's a spell with lesser mana value. If you don't cast it, put it into your hand.",
    }, permanent);
    expect(triggers.some((t) => t.firstSpellThisTurn === true && t.spellCondition === 'any')).toBe(true);
  });

  it('detects instant/sorcery/wizard spell pattern', () => {
    const triggers = detectSpellCastTriggers({
      name: 'Windrider Wizard',
      oracle_text: 'Whenever you cast an instant, sorcery, or Wizard spell, you may draw a card. If you do, discard a card.',
    }, permanent);
    expect(triggers.length).toBeGreaterThan(0);
  });

  it('detects multiword creature spell filters', () => {
    const triggers = detectSpellCastTriggers({
      name: 'Donal, Herald of Wings',
      oracle_text: 'Whenever you cast a nonlegendary creature spell with flying, you may copy it, except the copy is a 1/1 Spirit in addition to its other types. Do this only once each turn.',
    }, permanent);
    expect(triggers.some((t) => t.spellCondition === 'creature')).toBe(true);
  });

  it('detects colored spell cast triggers', () => {
    const triggers = detectSpellCastTriggers({
      name: 'Staff of the Wild Magus',
      oracle_text: 'Whenever you cast a green spell or a Forest you control enters, you gain 1 life.',
    }, permanent);
    expect(triggers.some((t) => t.spellCondition === 'color' && t.tribalType === 'green')).toBe(true);
  });

  it('detects {X} mana cost first-spell-each-turn triggers', () => {
    const triggers = detectSpellCastTriggers({
      name: 'Owlin Spiralmancer',
      oracle_text: 'Whenever you cast your first spell with {X} in its mana cost each turn, you may copy it.',
    }, permanent);
    expect(triggers.length).toBeGreaterThan(0);
  });

  it('detects play land or cast spell triggers', () => {
    const triggers = detectSpellCastTriggers({
      name: 'Flubs, the Fool',
      oracle_text: 'Whenever you play a land or cast a spell, draw a card if you have no cards in hand.',
    }, permanent);
    expect(triggers.length).toBeGreaterThan(0);
  });

  it('detects Deeproot Waters token details without baking color into the name', () => {
    const triggers = detectSpellCastTriggers({
      name: 'Deeproot Waters',
      oracle_text:
        "Whenever you cast a Merfolk spell, create a 1/1 blue Merfolk creature token with hexproof.",
    }, permanent);
    const tokenTrigger = triggers.find((t) => t.createsToken && t.tokenDetails);
    expect(tokenTrigger?.tokenDetails).toMatchObject({
      name: 'Merfolk',
      power: 1,
      toughness: 1,
      colors: ['blue'],
      types: 'Creature — Merfolk',
    });
    expect(String(tokenTrigger?.tokenDetails?.name || '')).not.toMatch(/blue/i);
  });

  it('detects cast from exile triggers', () => {
    const triggers = detectSpellCastTriggers({
      name: 'Pia Nalaar, Consul of Revival',
      oracle_text: 'Whenever you play a land from exile or cast a spell from exile, create a 1/1 colorless Thopter artifact creature token with flying.',
    }, permanent);
    expect(triggers.some((t) => t.sourceZoneRequirement === 'exile')).toBe(true);
  });

  it('detects untyped heroic spell cast triggers', () => {
    const triggers = detectSpellCastTriggers({
      name: 'Akroan Line Breaker',
      oracle_text: 'Whenever you cast a spell that targets this creature, it gets +2/+0 and gains intimidate until end of turn.',
    }, permanent);
    expect(triggers.some((t) => t.spellCondition === 'any')).toBe(true);
  });

  it('detects two-or-more-spells cast triggers', () => {
    const triggers = detectSpellCastTriggers({
      name: 'Arcbound Tracker',
      oracle_text: 'Whenever you cast two or more spells in a single turn, put a +1/+1 counter on this creature.',
    }, permanent);
    expect(triggers.length).toBeGreaterThan(0);
  });

  it('detects any-player cast-from-hand triggers (Possibility Storm)', () => {
    const triggers = detectOpponentSpellCastTriggers({
      name: 'Possibility Storm',
      oracle_text: 'Whenever a player casts a spell from their hand, that player exiles it, then exiles cards from the top of their library until they exile a card that shares a card type with it. That player may cast that card without paying its mana cost. Then they put all cards exiled with Possibility Storm on the bottom of their library in a random order.',
    }, permanent);
    expect(triggers.some((t) => t.casterScope === 'any_player')).toBe(true);
    expect(triggers.some((t) => t.sourceZoneRequirement === 'hand')).toBe(true);
    expect(triggers.some((t) => /^that player exiles it/i.test(String(t.benefitIfNotPaid || '')))).toBe(true);
  });

  it('detects any-player cast triggers (Jin-Gitaxias)', () => {
    const triggers = detectOpponentSpellCastTriggers({
      name: 'Jin-Gitaxias, Progress Tyrant',
      oracle_text: 'Whenever a player casts a spell, counter it unless that player pays {3}.',
    }, permanent);
    expect(triggers.some((t) => t.casterScope === 'any_player')).toBe(true);
    expect(triggers.every((t) => t.sourceZoneRequirement === undefined)).toBe(true);
  });

  it('detects cast-from-hand triggers', () => {
    const triggers = detectSpellCastTriggers({
      name: 'Labyrinth Adversary',
      oracle_text: 'Whenever you cast a spell from your hand, exile target instant or sorcery card with mana value less than that spell\'s mana value from your graveyard. Copy the exiled card. You may cast the copy without paying its mana cost.',
    }, permanent);
    expect(triggers.some((t) => t.sourceZoneRequirement === 'hand')).toBe(true);
  });

  it('detects artifact/instant/sorcery cast triggers (Jin-Gitaxias)', () => {
    const selfTriggers = detectSpellCastTriggers({
      name: 'Jin-Gitaxias, Progress Tyrant',
      oracle_text: 'Whenever you cast an artifact, instant, or sorcery spell, copy that spell. You may choose new targets for the copy.',
    }, permanent);
    const oppTriggers = detectOpponentSpellCastTriggers({
      name: 'Jin-Gitaxias, Progress Tyrant',
      oracle_text: 'Whenever an opponent casts an artifact, instant, or sorcery spell, counter that spell.',
    }, permanent);
    expect(selfTriggers.some((t) => t.spellCondition === 'instant_sorcery')).toBe(true);
    expect(oppTriggers.length).toBeGreaterThan(0);
  });

  it('detects spell-of-that-type cast triggers', () => {
    const triggers = detectSpellCastTriggers({
      name: 'Long List of the Ents',
      oracle_text: 'Whenever you cast a spell of that type this turn, draw a card.',
    }, permanent);
    expect(triggers.length).toBeGreaterThan(0);
  });

  it('detects graveyard tribal cast triggers', () => {
    const triggers = detectSpellCastTriggers({
      name: 'Rivaz of the Claw',
      oracle_text: 'Whenever you cast a Dragon spell from your graveyard, exile it instead of putting it into your graveyard as it resolves.',
    }, permanent);
    expect(triggers.some((t) => t.sourceZoneRequirement === 'graveyard' && t.tribalType === 'dragon')).toBe(true);
  });

  it('detects Judith modal instant/sorcery choose-one without a token shortcut', () => {
    const triggers = detectSpellCastTriggers({
      name: 'Judith, Carnage Connoisseur',
      oracle_text:
        'Whenever you cast an instant or sorcery spell, choose one —\n' +
        '\u2022 That spell gains deathtouch and lifelink.\n' +
        '\u2022 Create a 2/2 red Imp creature token with "When this token dies, it deals 2 damage to each opponent."',
    }, permanent);
    expect(triggers).toHaveLength(1);
    expect(triggers[0]?.spellCondition).toBe('instant_sorcery');
    expect(triggers[0]?.createsToken).toBeFalsy();
    expect(triggers[0]?.tokenDetails).toBeUndefined();
    expect(String(triggers[0]?.effect || '')).toMatch(/choose one/i);
    expect(String(triggers[0]?.effect || '')).toMatch(/deathtouch and lifelink/i);
    expect(String(triggers[0]?.effect || '')).toMatch(/create a 2\/2 red imp/i);
    expect(isModalChooseModesEffectText(String(triggers[0]?.effect || ''))).toBe(true);
  });
});
