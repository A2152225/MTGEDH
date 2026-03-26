/**
 * Tests for oracle text parsing
 */
import { describe, it, expect } from 'vitest';
import {
  parseOracleText,
  parseActivatedAbility,
  parseTriggeredAbility,
  parseReplacementEffect,
  parseKeywordActions,
  parseKeywords,
  parseDelayedTrigger,
  hasTriggeredAbility,
  hasActivatedAbility,
  hasReplacementEffect,
  AbilityType,
} from '../src/oracleTextParser';

describe('Oracle Text Parser', () => {
  it('normalizes exact card name references without corrupting containing words', () => {
    const result = parseOracleText(
      'Target creature gets +X/+0 until end of turn where X is the greatest power among creatures you control.',
      'Test'
    );

    expect(result.abilities[0]?.effect).toContain('greatest power among creatures you control');
    expect(result.abilities[0]?.effect).not.toContain('greathis permanent');
  });

  describe('parseActivatedAbility', () => {
    it('should parse basic tap mana ability', () => {
      const result = parseActivatedAbility('{T}: Add {G}.');
      expect(result).not.toBeNull();
      expect(result?.type).toBe(AbilityType.ACTIVATED);
      expect(result?.cost).toBe('{T}');
      expect(result?.effect).toBe('Add {G}.');
      expect(result?.isManaAbility).toBe(true);
    });

    it('should parse activated ability with mana cost', () => {
      const result = parseActivatedAbility('{1}{R}, Sacrifice a goblin: It deals 2 damage to any target.');
      expect(result).not.toBeNull();
      expect(result?.cost).toBe('{1}{R}, Sacrifice a goblin');
      expect(result?.effect).toBe('It deals 2 damage to any target.');
      expect(result?.isManaAbility).toBe(false);
    });

    it('should parse planeswalker loyalty ability', () => {
      const result = parseActivatedAbility('+1: You gain 2 life.');
      expect(result).not.toBeNull();
      expect(result?.isLoyaltyAbility).toBe(true);
      expect(result?.cost).toBe('+1');
      expect(result?.effect).toBe('You gain 2 life.');
    });

    it('should parse negative loyalty ability', () => {
      const result = parseActivatedAbility('−3: Return target creature to its owner\'s hand.');
      expect(result).not.toBeNull();
      expect(result?.isLoyaltyAbility).toBe(true);
      expect(result?.cost).toBe('−3');
    });

    it('should parse keyword abilities with cost', () => {
      const result = parseActivatedAbility('Equip {2}');
      expect(result).not.toBeNull();
      expect(result?.type).toBe(AbilityType.KEYWORD);
      expect(result?.cost).toBe('{2}');
      expect(result?.effect).toBe('Attach this permanent to target creature you control. Activate only as a sorcery.');
    });

    it('should parse cycling ability', () => {
      const result = parseActivatedAbility('Cycling {1}');
      expect(result).not.toBeNull();
      expect(result?.type).toBe(AbilityType.KEYWORD);
      expect(result?.cost).toBe('{1}, Discard this card');
      expect(result?.effect).toBe('Draw a card.');
    });

    it('parses basic landcycling as a discard-plus-tutor activation', () => {
      const result = parseActivatedAbility('Basic landcycling {1}{B}');
      expect(result).not.toBeNull();
      expect(result?.type).toBe(AbilityType.KEYWORD);
      expect(result?.cost).toBe('{1}{B}, Discard this card');
      expect(result?.effect).toBe('Search your library for a basic land card, reveal it, put it into your hand, then shuffle.');
    });

    it('parses land-type cycling as a discard-plus-subtype-tutor activation', () => {
      const result = parseActivatedAbility('Plainscycling {2}');
      expect(result).not.toBeNull();
      expect(result?.type).toBe(AbilityType.KEYWORD);
      expect(result?.cost).toBe('{2}, Discard this card');
      expect(result?.effect).toBe('Search your library for a Plains card, reveal it, put it into your hand, then shuffle.');
    });

    it('parses subtypecycling as a discard-plus-typed-tutor activation', () => {
      const result = parseActivatedAbility('Wizardcycling {3}');
      expect(result).not.toBeNull();
      expect(result?.type).toBe(AbilityType.KEYWORD);
      expect(result?.cost).toBe('{3}, Discard this card');
      expect(result?.effect).toBe('Search your library for a Wizard card, reveal it, put it into your hand, then shuffle.');
    });

    it('parses buyback into an explicit additional-cost keyword line', () => {
      const result = parseActivatedAbility('Buyback {3}');
      expect(result).not.toBeNull();
      expect(result?.type).toBe(AbilityType.KEYWORD);
      expect(result?.cost).toBe('{3}');
      expect(result?.effect).toBe(
        'You may pay an additional buyback cost as you cast this spell. If the buyback cost was paid, put this spell into your hand instead of into your graveyard as it resolves.'
      );
    });

    it('does not treat non-activated keyword cost lines as activated abilities', () => {
      const result = parseActivatedAbility('Kicker {2}{U}');
      expect(result).toBeNull();
    });

    it('parses reinforce into an explicit discard activation', () => {
      const result = parseActivatedAbility('Reinforce 1—{1}{W} ({1}{W}, Discard this card: Put a +1/+1 counter on target creature.)');
      expect(result).not.toBeNull();
      expect(result?.type).toBe(AbilityType.KEYWORD);
      expect(result?.cost).toBe('{1}{W}, Discard this card');
      expect(result?.effect).toBe('Put 1 +1/+1 counter on target creature.');
      expect(result?.targets).toContain('creature');
    });

    it('parses reinforce X into an explicit discard activation', () => {
      const result = parseActivatedAbility('Reinforce X—{X}{W}{W} ({X}{W}{W}, Discard this card: Put X +1/+1 counters on target creature.)');
      expect(result).not.toBeNull();
      expect(result?.type).toBe(AbilityType.KEYWORD);
      expect(result?.cost).toBe('{X}{W}{W}, Discard this card');
      expect(result?.effect).toBe('Put X +1/+1 counters on target creature.');
      expect(result?.targets).toContain('creature');
    });

    it('parses scavenge into an explicit graveyard exile activation', () => {
      const result = parseActivatedAbility('Scavenge {4}{G}{G}');
      expect(result).not.toBeNull();
      expect(result?.type).toBe(AbilityType.KEYWORD);
      expect(result?.cost).toBe('{4}{G}{G}, Exile this card from your graveyard');
      expect(result?.effect).toBe("Put X +1/+1 counters on target creature, where X is this card's power. Activate only as a sorcery.");
      expect(result?.targets).toContain('creature');
    });

    it('parses embalm into an explicit graveyard exile token-copy activation', () => {
      const result = parseActivatedAbility('Embalm {3}{W}');
      expect(result).not.toBeNull();
      expect(result?.type).toBe(AbilityType.KEYWORD);
      expect(result?.cost).toBe('{3}{W}, Exile this card from your graveyard');
      expect(result?.effect).toBe(
        "Create a token that's a copy of it, except it's white, it has no mana cost, and it's a Zombie in addition to its other types. Activate only as a sorcery."
      );
    });

    it('parses eternalize into an explicit graveyard exile token-copy activation', () => {
      const result = parseActivatedAbility('Eternalize {2}{B}{B}');
      expect(result).not.toBeNull();
      expect(result?.type).toBe(AbilityType.KEYWORD);
      expect(result?.cost).toBe('{2}{B}{B}, Exile this card from your graveyard');
      expect(result?.effect).toBe(
        "Create a token that's a copy of it, except it's black, it's 4/4, it has no mana cost, and it's a Zombie in addition to its other types. Activate only as a sorcery."
      );
    });

    it('parses replicate into an explicit cast-copy keyword line', () => {
      const result = parseActivatedAbility('Replicate {1}{U}');
      expect(result).not.toBeNull();
      expect(result?.type).toBe(AbilityType.KEYWORD);
      expect(result?.cost).toBe('{1}{U}');
      expect(result?.effect).toBe(
        'As an additional cost to cast this spell, you may pay its replicate cost any number of times. When you cast this spell, copy it for each time you paid its replicate cost. You may choose new targets for the copies.'
      );
    });

    it('parses outlast into an explicit tap activation', () => {
      const result = parseActivatedAbility('Outlast {1}{W}');
      expect(result).not.toBeNull();
      expect(result?.type).toBe(AbilityType.KEYWORD);
      expect(result?.cost).toBe('{1}{W}, {T}');
      expect(result?.effect).toBe('Put a +1/+1 counter on this creature. Activate only as a sorcery.');
    });

    it('parses level up into an explicit activation', () => {
      const result = parseActivatedAbility('Level up {2}');
      expect(result).not.toBeNull();
      expect(result?.type).toBe(AbilityType.KEYWORD);
      expect(result?.cost).toBe('{2}');
      expect(result?.effect).toBe('Put a level counter on this permanent. Activate only as a sorcery.');
    });

    it('parses adapt into an explicit conditional counter activation', () => {
      const result = parseActivatedAbility('Adapt 2');
      expect(result).not.toBeNull();
      expect(result?.type).toBe(AbilityType.KEYWORD);
      expect(result?.cost).toBe('2');
      expect(result?.effect).toBe('If there are no +1/+1 counters on it, put 2 +1/+1 counters on this permanent. Activate only as a sorcery.');
    });

    it('parses unearth into an explicit graveyard-return activation', () => {
      const result = parseActivatedAbility('Unearth {2}{B}');
      expect(result).not.toBeNull();
      expect(result?.type).toBe(AbilityType.KEYWORD);
      expect(result?.cost).toBe('{2}{B}');
      expect(result?.effect).toBe(
        'Return this card from your graveyard to the battlefield. Exile it at the beginning of the next end step. If it would leave the battlefield, exile it instead of putting it anywhere else.'
      );
    });

    it('parses morph into a turn-face-up special action', () => {
      const result = parseActivatedAbility('Morph {3}{G}');
      expect(result).not.toBeNull();
      expect(result?.type).toBe(AbilityType.KEYWORD);
      expect(result?.cost).toBe('{3}{G}');
      expect(result?.effect).toBe('Turn this permanent face up.');
    });

    it('parses megamorph into a turn-face-up plus counter action', () => {
      const result = parseActivatedAbility('Megamorph {4}{G}');
      expect(result).not.toBeNull();
      expect(result?.type).toBe(AbilityType.KEYWORD);
      expect(result?.cost).toBe('{4}{G}');
      expect(result?.effect).toBe('Turn this permanent face up. Put a +1/+1 counter on it.');
    });

    it('parses channel as a keyword activation instead of a dead stub', () => {
      const result = parseActivatedAbility('Channel — {2}{R}, Discard this card: Draw two cards.');
      expect(result).not.toBeNull();
      expect(result?.type).toBe(AbilityType.KEYWORD);
      expect(result?.cost).toBe('{2}{R}, Discard this card');
      expect(result?.effect).toBe('Draw two cards.');
    });

    it('parses forecast as a keyword activation instead of a dead stub', () => {
      const result = parseActivatedAbility('Forecast — {2}{W}, Reveal this card from your hand: Create a 1/1 white Bird creature token with flying. Activate only during your upkeep and only once each turn.');
      expect(result).not.toBeNull();
      expect(result?.type).toBe(AbilityType.KEYWORD);
      expect(result?.cost).toBe('{2}{W}, Reveal this card from your hand');
      expect(result?.effect).toBe('Create a 1/1 white Bird creature token with flying. Activate only during your upkeep and only once each turn.');
    });

    it('parses transmute as a keyword activation instead of a dead stub', () => {
      const result = parseActivatedAbility('Transmute {1}{U}{U}');
      expect(result).not.toBeNull();
      expect(result?.type).toBe(AbilityType.KEYWORD);
      expect(result?.cost).toBe('{1}{U}{U}, Discard this card');
      expect(result?.effect).toBe(
        'Search your library for a card with the same mana value as this card, reveal it, put it into your hand, then shuffle. Activate only as a sorcery.'
      );
    });

    it('parses transfigure as a keyword activation instead of a dead stub', () => {
      const result = parseActivatedAbility('Transfigure {1}{B}{B}');
      expect(result).not.toBeNull();
      expect(result?.type).toBe(AbilityType.KEYWORD);
      expect(result?.cost).toBe('{1}{B}{B}, Sacrifice this permanent');
      expect(result?.effect).toBe(
        'Search your library for a creature card with the same mana value as this permanent, put it onto the battlefield, then shuffle. Activate only as a sorcery.'
      );
    });

    it('parses encore as a keyword activation instead of a dead stub', () => {
      const result = parseActivatedAbility('Encore {5}{U}{U}');
      expect(result).not.toBeNull();
      expect(result?.type).toBe(AbilityType.KEYWORD);
      expect(result?.cost).toBe('{5}{U}{U}, Exile this card from your graveyard');
      expect(result?.effect).toBe(
        "For each opponent, create a token that's a copy of it. Those tokens enter tapped and attacking. They gain haste. Sacrifice them at the beginning of the next end step. Activate only as a sorcery."
      );
    });

    it('parses myriad as a keyword-triggered ability instead of a static stub', () => {
      const result = parseOracleText('Myriad');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.TRIGGERED,
        triggerKeyword: 'whenever',
        triggerCondition: 'this creature attacks',
        effect:
          "For each opponent other than defending player, create a token that's a copy of it. Those tokens enter tapped and attacking. Exile them at end of combat.",
      });
    });

    it('parses annihilator as a keyword-triggered ability instead of a static stub', () => {
      const result = parseOracleText('Annihilator 2');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.TRIGGERED,
        triggerKeyword: 'whenever',
        triggerCondition: 'this creature attacks',
        effect: 'Defending player sacrifices 2 permanents.',
      });
    });

    it('parses afterlife as a keyword-triggered ability instead of a static stub', () => {
      const result = parseOracleText('Afterlife 2');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.TRIGGERED,
        triggerKeyword: 'when',
        triggerCondition: 'this permanent dies',
        effect: 'Create 2 1/1 white and black Spirit creature tokens with flying.',
      });
    });

    it('parses afflict as a keyword-triggered ability instead of a static stub', () => {
      const result = parseOracleText('Afflict 2');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.TRIGGERED,
        triggerKeyword: 'whenever',
        triggerCondition: 'this creature becomes blocked',
        effect: 'Defending player loses 2 life.',
      });
    });

    it('parses renown as a keyword-triggered ability instead of a static stub', () => {
      const result = parseOracleText('Renown 1');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.TRIGGERED,
        triggerKeyword: 'whenever',
        triggerCondition: 'this creature deals combat damage to a player',
        interveningIf: "this creature isn't renowned",
        effect: 'Put 1 +1/+1 counter on this creature. This creature becomes renowned.',
      });
    });

    it('parses monstrosity as a keyword action instead of a static stub', () => {
      const result = parseOracleText('Monstrosity 3');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.STATIC,
        effect: 'Monstrosity 3.',
      });
    });

    it('parses endure as a keyword action instead of a static stub', () => {
      const result = parseOracleText('Endure 2');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.STATIC,
        effect: 'Endure 2.',
      });
    });

    it('parses collect evidence as a keyword action instead of a static stub', () => {
      const result = parseOracleText('Collect evidence 4');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.STATIC,
        effect: 'Collect evidence 4.',
      });
    });

    it('parses ingest as a keyword-triggered ability instead of a static stub', () => {
      const result = parseOracleText('Ingest');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.TRIGGERED,
        triggerKeyword: 'whenever',
        triggerCondition: 'this creature deals combat damage to a player',
        effect: 'That player exiles the top card of their library.',
      });
    });

    it('parses poisonous as a keyword-triggered ability instead of a static stub', () => {
      const result = parseOracleText('Poisonous 3');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.TRIGGERED,
        triggerKeyword: 'whenever',
        triggerCondition: 'this creature deals combat damage to a player',
        effect: 'That player gets 3 poison counters.',
      });
    });

    it('parses fabricate as a keyword-triggered ability instead of a static stub', () => {
      const result = parseOracleText('Fabricate 2');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.TRIGGERED,
        triggerKeyword: 'when',
        triggerCondition: 'this permanent enters the battlefield',
        effect: "You may put 2 +1/+1 counters on it. If you don't, create 2 1/1 colorless Servo artifact creature tokens.",
      });
    });

    it('parses storm as a keyword-triggered ability instead of a static stub', () => {
      const result = parseOracleText('Storm');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.TRIGGERED,
        triggerKeyword: 'when',
        triggerCondition: 'you cast this spell',
        effect: 'Copy this spell for each spell cast before it this turn. You may choose new targets for the copies.',
      });
    });

    it('parses rebound as a keyword-triggered ability instead of a static stub', () => {
      const result = parseOracleText('Rebound');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.TRIGGERED,
        triggerKeyword: 'at',
        triggerCondition: 'the beginning of your next upkeep',
        effect: 'You may cast this card from exile without paying its mana cost.',
      });
    });

    it('parses cascade as a keyword-triggered ability instead of a static stub', () => {
      const result = parseOracleText('Cascade');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.TRIGGERED,
        triggerKeyword: 'when',
        triggerCondition: 'you cast this spell',
        effect:
          "Exile cards from the top of your library until you exile a nonland card whose mana value is less than this spell's mana value. You may cast it without paying its mana cost. Put the exiled cards on the bottom of your library in a random order.",
      });
    });

    it('parses living weapon as a keyword-triggered ability instead of a static stub', () => {
      const result = parseOracleText('Living weapon');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.TRIGGERED,
        triggerKeyword: 'when',
        triggerCondition: 'this equipment enters the battlefield',
        effect: 'Create a 0/0 black Phyrexian Germ creature token, then attach this Equipment to it.',
      });
    });

    it('parses For Mirrodin! as a keyword-triggered ability instead of a static stub', () => {
      const result = parseOracleText('For Mirrodin!');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.TRIGGERED,
        triggerKeyword: 'when',
        triggerCondition: 'this equipment enters the battlefield',
        effect: 'Create a 2/2 red Rebel creature token, then attach this Equipment to it.',
      });
    });

    it('parses job select as a keyword-triggered ability instead of a static stub', () => {
      const result = parseOracleText('Job select');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.TRIGGERED,
        triggerKeyword: 'when',
        triggerCondition: 'this equipment enters the battlefield',
        effect: 'Create a 1/1 colorless Hero creature token, then attach this Equipment to it.',
      });
    });

    it('parses training as a keyword-triggered ability instead of a static stub', () => {
      const result = parseOracleText('Training');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.TRIGGERED,
        triggerKeyword: 'whenever',
        triggerCondition: "this creature and at least one other creature with power greater than this creature's power attack",
        effect: 'Put a +1/+1 counter on this creature.',
      });
    });

    it('parses mentor as a keyword-triggered ability instead of a static stub', () => {
      const result = parseOracleText('Mentor');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.TRIGGERED,
        triggerKeyword: 'whenever',
        triggerCondition: 'this creature attacks',
        effect: "Put a +1/+1 counter on target attacking creature with power less than this creature's power.",
      });
    });

    it('parses battle cry as a keyword-triggered ability instead of a static stub', () => {
      const result = parseOracleText('Battle cry');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.TRIGGERED,
        triggerKeyword: 'whenever',
        triggerCondition: 'this creature attacks',
        effect: 'Each other attacking creature gets +1/+0 until end of turn.',
      });
    });

    it('parses support as a keyword action line instead of a static stub', () => {
      const result = parseOracleText('Support 2');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.STATIC,
        effect: 'Put a +1/+1 counter on each of up to 2 other target creatures.',
      });
    });

    it('parses bolster as a keyword action line instead of a static stub', () => {
      const result = parseOracleText('Bolster 2');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.STATIC,
        effect: 'Put 2 +1/+1 counters on target creature you control with the least toughness among creatures you control.',
      });
    });

    it('parses proliferate as a keyword action line instead of a static stub', () => {
      const result = parseOracleText('Proliferate');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.STATIC,
        effect: 'Proliferate.',
      });
    });

    it('parses investigate as a keyword action line instead of a static stub', () => {
      const result = parseOracleText('Investigate');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.STATIC,
        effect: 'Investigate.',
      });
    });

    it('parses populate as a keyword action line instead of a static stub', () => {
      const result = parseOracleText('Populate');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.STATIC,
        effect: 'Populate.',
      });
    });

    it('parses goad as a keyword action line instead of a static stub', () => {
      const result = parseOracleText('Goad target creature.');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.STATIC,
        effect: 'Goad target creature.',
      });
    });

    it('parses suspect as a keyword action line instead of a static stub', () => {
      const result = parseOracleText('Suspect target creature.');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.STATIC,
        effect: 'Suspect target creature.',
      });
    });

    it('parses incubate as a keyword action line instead of a static stub', () => {
      const result = parseOracleText('Incubate 2');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.STATIC,
        effect: 'Create an Incubator token with 2 +1/+1 counters on it.',
      });
    });

    it('parses amass as a keyword action line instead of a static stub', () => {
      const result = parseOracleText('Amass 2');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.STATIC,
        effect:
          "If you don't control an Army creature, create a 0/0 black Zombie Army creature token. Choose an Army creature you control. Put 2 +1/+1 counters on that creature.",
      });
    });

    it('parses amass orcs as a keyword action line instead of a static stub', () => {
      const result = parseOracleText('Amass Orcs 2');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.STATIC,
        effect:
          "If you don't control an Army creature, create a 0/0 black Orc Army creature token. Choose an Army creature you control. Put 2 +1/+1 counters on that creature. If it isn't an Orc, it becomes an Orc in addition to its other types.",
      });
    });

    it('parses scry as a keyword action line instead of a static stub', () => {
      const result = parseOracleText('Scry 2');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.STATIC,
        effect: 'Scry 2.',
      });
    });

    it('parses surveil as a keyword action line instead of a static stub', () => {
      const result = parseOracleText('Surveil 2');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.STATIC,
        effect: 'Surveil 2.',
      });
    });

    it('parses fateseal as a keyword action line instead of a static stub', () => {
      const result = parseOracleText('Fateseal 2');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.STATIC,
        effect: 'Fateseal 2.',
      });
    });

    it('parses time travel as a keyword action line instead of a static stub', () => {
      const result = parseOracleText('Time travel');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.STATIC,
        effect: 'Time travel.',
      });
    });

    it('parses repeated time travel as a keyword action line instead of a static stub', () => {
      const result = parseOracleText('Time travel three times');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.STATIC,
        effect: 'Time travel three times.',
      });
    });

    it('parses mill as a keyword action line instead of a static stub', () => {
      const result = parseOracleText('Mill 2');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.STATIC,
        effect: 'Mill 2 cards.',
      });
    });

    it('parses explore as a keyword action line instead of a static stub', () => {
      const result = parseOracleText('Explore');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.STATIC,
        effect: 'Explore.',
      });
    });

    it('parses connive as a keyword action line instead of a static stub', () => {
      const result = parseOracleText('Connive 2');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.STATIC,
        effect: 'Connive 2.',
      });
    });

    it('parses manifest as a keyword action line instead of a static stub', () => {
      const result = parseOracleText('Manifest the top card of your library.');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.STATIC,
        effect: 'Manifest the top card of your library.',
      });
    });

    it("parses manifest-from-that-player's-library as a keyword action line instead of a static stub", () => {
      const result = parseOracleText("Manifest the top card of that player's library.");
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.STATIC,
        effect: "Manifest the top card of that player's library.",
      });
    });

    it('parses learn as a keyword action line instead of a static stub', () => {
      const result = parseOracleText('Learn');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.STATIC,
        effect: 'Learn.',
      });
    });

    it('parses manifest dread as a keyword action line instead of a static stub', () => {
      const result = parseOracleText('Manifest dread');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.STATIC,
        effect: 'Manifest dread.',
      });
    });

    it('parses cloak-the-top-card lines as a keyword action line instead of a static stub', () => {
      const result = parseOracleText('Cloak the top card of your library');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.STATIC,
        effect: 'Cloak the top card of your library.',
      });
    });

    it("parses cloak-from-that-player's-library as a keyword action line instead of a static stub", () => {
      const result = parseOracleText("Cloak the top card of that player's library.");
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.STATIC,
        effect: "Cloak the top card of that player's library.",
      });
    });

    it('parses forage as a keyword action line instead of a static stub', () => {
      const result = parseOracleText('Forage');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.STATIC,
        effect: 'Forage.',
      });
    });

    it('parses exert as a keyword action line instead of a static stub', () => {
      const result = parseOracleText('Exert');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.STATIC,
        effect: 'Exert.',
      });
    });

    it('parses open an Attraction as a keyword action line instead of a static stub', () => {
      const result = parseOracleText('Open an Attraction');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.STATIC,
        effect: 'Open an Attraction.',
      });
    });

    it('parses roll to visit your Attractions as a keyword action line instead of a static stub', () => {
      const result = parseOracleText('Roll to visit your Attractions');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.STATIC,
        effect: 'Roll to visit your Attractions.',
      });
    });

    it('parses take the initiative as a keyword action line instead of a static stub', () => {
      const result = parseOracleText('Take the initiative');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.STATIC,
        effect: 'Take the initiative.',
      });
    });

    it('parses venture into the dungeon as a keyword action line instead of a static stub', () => {
      const result = parseOracleText('Venture into the dungeon');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.STATIC,
        effect: 'Venture into the dungeon.',
      });
    });

    it('parses abandon this scheme as a keyword action line instead of a static stub', () => {
      const result = parseOracleText('Abandon this scheme');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.STATIC,
        effect: 'Abandon this scheme.',
      });
    });

    it('parses set that scheme in motion again as a keyword action line instead of a static stub', () => {
      const result = parseOracleText('Set that scheme in motion again');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.STATIC,
        effect: 'Set that scheme in motion again.',
      });
    });

    it('parses clash-with-an-opponent as a keyword action line instead of a static stub', () => {
      const result = parseOracleText('Clash with an opponent');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.STATIC,
        effect: 'Clash with an opponent.',
      });
    });

    it('parses the Ring tempts you as a keyword action line instead of a static stub', () => {
      const result = parseOracleText('The Ring tempts you');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.STATIC,
        effect: 'The Ring tempts you.',
      });
    });

    it('parses evolve as a keyword-triggered ability instead of a static stub', () => {
      const result = parseOracleText('Evolve');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.TRIGGERED,
        triggerKeyword: 'whenever',
        triggerCondition: 'another creature enters the battlefield under your control',
        interveningIf: "that creature's power is greater than this creature's power or that creature's toughness is greater than this creature's toughness",
        effect: 'Put a +1/+1 counter on this creature.',
      });
    });

    it('parses exploit as a keyword-triggered ability instead of a static stub', () => {
      const result = parseOracleText('Exploit');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.TRIGGERED,
        triggerKeyword: 'when',
        triggerCondition: 'this permanent enters the battlefield',
        effect: 'You may sacrifice a creature.',
      });
    });

    it('parses undying as a keyword-triggered ability instead of a static stub', () => {
      const result = parseOracleText('Undying');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.TRIGGERED,
        triggerKeyword: 'when',
        triggerCondition: 'this permanent dies',
        interveningIf: 'it had no +1/+1 counters on it',
        effect: "Return this card to the battlefield under its owner's control with a +1/+1 counter on it.",
      });
    });

    it('parses persist as a keyword-triggered ability instead of a static stub', () => {
      const result = parseOracleText('Persist');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.TRIGGERED,
        triggerKeyword: 'when',
        triggerCondition: 'this permanent dies',
        interveningIf: 'it had no -1/-1 counters on it',
        effect: "Return this card to the battlefield under its owner's control with a -1/-1 counter on it.",
      });
    });

    it('parses mobilize as a keyword-triggered ability instead of a static stub', () => {
      const result = parseOracleText('Mobilize 3');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.TRIGGERED,
        triggerKeyword: 'whenever',
        triggerCondition: 'this creature attacks',
        effect:
          'Create 3 1/1 red Warrior creature tokens. Those tokens enter tapped and attacking. Sacrifice them at the beginning of the next end step.',
      });
    });

    it('parses melee as a keyword-triggered ability instead of a static stub', () => {
      const result = parseOracleText('Melee');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.TRIGGERED,
        triggerKeyword: 'whenever',
        triggerCondition: 'this creature attacks',
        effect: 'This creature gets +X/+X until end of turn where X is the number of players being attacked.',
      });
    });

    it('parses dethrone as a keyword-triggered ability instead of a static stub', () => {
      const result = parseOracleText('Dethrone');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.TRIGGERED,
        triggerKeyword: 'whenever',
        triggerCondition: 'this creature attacks',
        interveningIf: 'defending player has the most life or is tied for the most life',
        effect: 'Put a +1/+1 counter on this creature.',
      });
    });

    it('parses exalted as a keyword-triggered ability instead of a static stub', () => {
      const result = parseOracleText('Exalted');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.TRIGGERED,
        triggerKeyword: 'whenever',
        triggerCondition: 'a creature you control attacks alone',
        effect: 'That creature gets +1/+1 until end of turn.',
      });
    });

    it('parses prowess as a keyword-triggered ability instead of a static stub', () => {
      const result = parseOracleText('Prowess');
      expect(result.abilities).toHaveLength(1);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.TRIGGERED,
        triggerKeyword: 'whenever',
        triggerCondition: 'you cast a noncreature spell',
        effect: 'This creature gets +1/+1 until end of turn.',
      });
    });

    it('parses boast as a keyword activation instead of a dead stub', () => {
      const result = parseActivatedAbility('Boast — {1}{R}: Draw a card. Activate only if this creature attacked this turn and only once each turn.');
      expect(result).not.toBeNull();
      expect(result?.type).toBe(AbilityType.KEYWORD);
      expect(result?.cost).toBe('{1}{R}');
      expect(result?.effect).toBe('Draw a card. Activate only if this creature attacked this turn and only once each turn.');
    });

    it('parses exhaust as a keyword activation instead of a dead stub', () => {
      const result = parseActivatedAbility('Exhaust — {3}: Add {R}{R}{R}. Activate only once.');
      expect(result).not.toBeNull();
      expect(result?.type).toBe(AbilityType.KEYWORD);
      expect(result?.cost).toBe('{3}');
      expect(result?.effect).toBe('Add {R}{R}{R}. Activate only once.');
      expect(result?.isManaAbility).toBe(true);
    });

    it('should detect optional abilities with "you may"', () => {
      const result = parseActivatedAbility('{T}: You may draw a card.');
      expect(result).not.toBeNull();
      expect(result?.isOptional).toBe(true);
    });

    it("does not treat Shade's Form granted quoted ability as the card's activated ability", () => {
      const result = parseActivatedAbility(
        'Enchanted creature has "{B}: This creature gets +1/+1 until end of turn."'
      );
      expect(result).toBeNull();
    });

    it("does not treat Bronzehide Lion's quoted granted ability sentence as an activated ability", () => {
      const result = parseActivatedAbility(
        `Return it to the battlefield. It's an Aura enchantment with enchant creature you control and "{G}{W}: Return this card to its owner's hand." and it loses all other abilities.`
      );
      expect(result).toBeNull();
    });
  });

  describe('parseTriggeredAbility', () => {
    it('should parse "When enters" ETB trigger', () => {
      const result = parseTriggeredAbility('When this creature enters the battlefield, draw a card.');
      expect(result).not.toBeNull();
      expect(result?.type).toBe(AbilityType.TRIGGERED);
      expect(result?.triggerKeyword).toBe('when');
      expect(result?.triggerCondition).toBe('this creature enters the battlefield');
      expect(result?.effect).toBe('draw a card.');
    });

    it('should parse "Whenever" landfall trigger', () => {
      const result = parseTriggeredAbility('Whenever a land enters the battlefield under your control, you gain 1 life.');
      expect(result).not.toBeNull();
      expect(result?.triggerKeyword).toBe('whenever');
      expect(result?.triggerCondition).toBe('a land enters the battlefield under your control');
      expect(result?.effect).toBe('you gain 1 life.');
    });

    it('should parse "At the beginning" upkeep trigger', () => {
      const result = parseTriggeredAbility('At the beginning of your upkeep, sacrifice this creature.');
      expect(result).not.toBeNull();
      expect(result?.triggerKeyword).toBe('at');
      expect(result?.triggerCondition).toBe('the beginning of your upkeep');
    });

    it('should parse "At each" trigger', () => {
      const result = parseTriggeredAbility('At the beginning of each end step, return this to your hand.');
      expect(result).not.toBeNull();
      expect(result?.triggerKeyword).toBe('at');
      expect(result?.triggerCondition).toBe('the beginning of each end step');
    });

    it('should parse intervening-if clause', () => {
      const result = parseTriggeredAbility('When this permanent enters the battlefield, if you control three artifacts, draw a card.');
      expect(result).not.toBeNull();
      expect(result?.interveningIf).toBe('you control three artifacts');
      expect(result?.effect).toBe('draw a card.');
    });

    it('should detect optional "you may" triggers', () => {
      const result = parseTriggeredAbility('Whenever this creature attacks, you may draw a card.');
      expect(result).not.toBeNull();
      expect(result?.isOptional).toBe(true);
    });

    it('should parse targets in triggered abilities', () => {
      const result = parseTriggeredAbility('When this creature dies, target player loses 1 life.');
      expect(result).not.toBeNull();
      expect(result?.targets).toContain('player');
    });

    it('should preserve comma-qualified trigger conditions before the effect delimiter', () => {
      const result = parseTriggeredAbility(
        "Whenever a nontoken, non-Angel creature you control dies, return that card to the battlefield under its owner's control with a +1/+1 counter on it."
      );
      expect(result).not.toBeNull();
      expect(result?.triggerCondition).toBe('a nontoken, non-Angel creature you control dies');
      expect(result?.effect).toBe("return that card to the battlefield under its owner's control with a +1/+1 counter on it.");
    });
  });

  describe('parseReplacementEffect', () => {
    it('should parse "If would, instead" replacement', () => {
      const result = parseReplacementEffect('If you would draw a card, exile the top two cards of your library instead.');
      expect(result).not.toBeNull();
      expect(result?.type).toBe(AbilityType.REPLACEMENT);
      expect(result?.triggerCondition).toBe('you');
      expect(result?.effect).toBe('exile the top two cards of your library');
    });

    it('should parse "enters the battlefield tapped" replacement', () => {
      const result = parseReplacementEffect('This land enters the battlefield tapped.');
      expect(result).not.toBeNull();
      expect(result?.type).toBe(AbilityType.REPLACEMENT);
    });

    it('should parse "As enters the battlefield" clone effect', () => {
      const result = parseReplacementEffect('As Clone enters the battlefield, you may choose a creature on the battlefield.');
      expect(result).not.toBeNull();
      expect(result?.type).toBe(AbilityType.REPLACEMENT);
      expect(result?.isOptional).toBe(true);
    });
  });

  describe('parseKeywordActions', () => {
    it('should parse scry action', () => {
      const result = parseKeywordActions('Scry 2.');
      expect(result).toContainEqual(expect.objectContaining({
        action: 'scry',
        value: 2,
      }));
    });

    it('should parse mill action', () => {
      const result = parseKeywordActions('Target player mills 4 cards.');
      expect(result).toContainEqual(expect.objectContaining({
        action: 'mill',
        value: 4,
      }));
    });

    it('should parse token creation', () => {
      const result = parseKeywordActions('Create a 1/1 white Soldier creature token.');
      expect(result).toContainEqual(expect.objectContaining({
        action: 'create',
      }));
    });

    it('should parse power/toughness modification', () => {
      const result = parseKeywordActions('Target creature gets +2/+2 until end of turn.');
      expect(result).toContainEqual(expect.objectContaining({
        action: 'ptMod',
        value: '+2/+2',
      }));
    });

    it('should parse life gain', () => {
      const result = parseKeywordActions('You gain 3 life.');
      expect(result).toContainEqual(expect.objectContaining({
        action: 'gainLife',
        value: 3,
      }));
    });

    it('should parse damage dealing', () => {
      const result = parseKeywordActions('This creature deals 2 damage to any target.');
      expect(result).toContainEqual(expect.objectContaining({
        action: 'dealDamage',
        value: 2,
      }));
    });
  });

  describe('parseKeywords', () => {
    it('should detect flying', () => {
      expect(parseKeywords('Flying')).toContain('flying');
    });

    it('should detect multiple keywords', () => {
      const result = parseKeywords('Flying, vigilance, lifelink');
      expect(result).toContain('flying');
      expect(result).toContain('vigilance');
      expect(result).toContain('lifelink');
    });

    it('should detect deathtouch', () => {
      expect(parseKeywords('Deathtouch')).toContain('deathtouch');
    });

    it('should detect trample', () => {
      expect(parseKeywords('Trample')).toContain('trample');
    });

    it('should detect first strike and double strike', () => {
      expect(parseKeywords('First strike')).toContain('first strike');
      expect(parseKeywords('Double strike')).toContain('double strike');
    });

    it('should detect hexproof and shroud', () => {
      expect(parseKeywords('Hexproof')).toContain('hexproof');
      expect(parseKeywords('Shroud')).toContain('shroud');
    });

    it('should detect indestructible', () => {
      expect(parseKeywords('Indestructible')).toContain('indestructible');
    });

    it('should detect protection', () => {
      expect(parseKeywords('Protection from red')).toContain('protection');
    });

    it('should detect sneak keyword', () => {
      expect(parseKeywords('Sneak {2}{R}')).toContain('sneak');
    });

    it('should detect disappear ability word', () => {
      expect(parseKeywords('Disappear — Whenever a permanent leaves the battlefield under your control, draw a card.')).toContain('disappear');
    });
  });

  describe('parseDelayedTrigger', () => {
    it('should parse end step delayed trigger', () => {
      const result = parseDelayedTrigger('Exile it at the beginning of the next end step.');
      expect(result).not.toBeNull();
      expect(result?.effect).toBe('Exile it');
      expect(result?.timing).toBe('end step');
    });

    it('should parse upkeep delayed trigger', () => {
      const result = parseDelayedTrigger('Return this card to the battlefield at the beginning of the next upkeep.');
      expect(result).not.toBeNull();
      expect(result?.timing).toBe('upkeep');
    });
  });

  describe('parseOracleText (comprehensive)', () => {
    it('should parse a card with both triggered and activated abilities', () => {
      const text = 'When this creature enters the battlefield, draw a card.\n{T}: Add {G}.';
      const result = parseOracleText(text);
      
      expect(result.isTriggered).toBe(true);
      expect(result.isActivated).toBe(true);
      expect(result.abilities.length).toBeGreaterThanOrEqual(2);
    });

    it('should parse modal spell text', () => {
      const text = 'Choose one —\n• Counter target spell.\n• Draw two cards.';
      const result = parseOracleText(text);
      
      expect(result.hasModes).toBe(true);
    });

    it('should detect targeting in spells', () => {
      const text = 'Destroy target creature.';
      const result = parseOracleText(text);
      
      expect(result.hasTargets).toBe(true);
    });

    it('should parse complex planeswalker card', () => {
      const text = '+1: You gain 2 life.\n−2: Put a +1/+1 counter on each creature you control.\n−6: You get an emblem with "Whenever a creature dies, return it to the battlefield under your control."';
      const result = parseOracleText(text);
      
      expect(result.isActivated).toBe(true);
      expect(result.abilities.filter(a => a.isLoyaltyAbility).length).toBe(3);
    });

    it('should parse Mulldrifter-style ETB', () => {
      const text = 'When Mulldrifter enters the battlefield, draw two cards.';
      const result = parseOracleText(text, 'Mulldrifter');
      
      expect(result.isTriggered).toBe(true);
      expect(result.abilities.length).toBeGreaterThan(0);
    });
  });

  describe('Quick check functions', () => {
    describe('hasTriggeredAbility', () => {
      it('should detect "when" triggers', () => {
        expect(hasTriggeredAbility('When this creature dies, draw a card.')).toBe(true);
      });

      it('should detect "whenever" triggers', () => {
        expect(hasTriggeredAbility('Whenever a creature enters, put a counter on it.')).toBe(true);
      });

      it('should detect "at the beginning" triggers', () => {
        expect(hasTriggeredAbility('At the beginning of your upkeep, scry 1.')).toBe(true);
      });

      it('should detect keyword-triggered lines like Myriad', () => {
        expect(hasTriggeredAbility('Myriad')).toBe(true);
      });

      it('should detect keyword-triggered lines like Annihilator', () => {
        expect(hasTriggeredAbility('Annihilator 2')).toBe(true);
      });

      it('should detect keyword-triggered lines like Mobilize', () => {
        expect(hasTriggeredAbility('Mobilize 3')).toBe(true);
      });

      it('should detect keyword-triggered lines like Melee', () => {
        expect(hasTriggeredAbility('Melee')).toBe(true);
      });

      it('should detect keyword-triggered lines like Dethrone', () => {
        expect(hasTriggeredAbility('Dethrone')).toBe(true);
      });

      it('should detect keyword-triggered lines like Exalted', () => {
        expect(hasTriggeredAbility('Exalted')).toBe(true);
      });

      it('should detect keyword-triggered lines like Prowess', () => {
        expect(hasTriggeredAbility('Prowess')).toBe(true);
      });

      it('should return false for non-triggered text', () => {
        expect(hasTriggeredAbility('Flying, vigilance')).toBe(false);
      });
    });

    describe('hasActivatedAbility', () => {
      it('should detect activated ability with colon', () => {
        expect(hasActivatedAbility('{T}: Add {G}.')).toBe(true);
      });

      it('should not confuse triggered abilities', () => {
        expect(hasActivatedAbility('When this enters: draw a card.')).toBe(false);
      });

      it('should return false for simple keywords', () => {
        expect(hasActivatedAbility('Flying')).toBe(false);
      });

      it("ignores granted quoted activated abilities like Shade's Form", () => {
        expect(
          hasActivatedAbility(
            'Enchant creature\nEnchanted creature has "{B}: This creature gets +1/+1 until end of turn."\nWhen enchanted creature dies, return that card to the battlefield under your control.'
          )
        ).toBe(false);
      });
    });

    describe('hasReplacementEffect', () => {
      it('should detect "instead" replacement', () => {
        expect(hasReplacementEffect('If would die, exile it instead.')).toBe(true);
      });

      it('should detect "enters tapped" replacement', () => {
        expect(hasReplacementEffect('This land enters the battlefield tapped.')).toBe(true);
      });

      it('should detect "enters with" replacement', () => {
        expect(hasReplacementEffect('This creature enters the battlefield with two +1/+1 counters.')).toBe(true);
      });

      it('should detect "As enters" replacement', () => {
        expect(hasReplacementEffect('As Clone enters the battlefield, choose a creature.')).toBe(true);
      });
    });
  });

  describe('Continuation Sentence Merging', () => {
    it('should merge ". Spend" restriction sentences (Altar of the Lost)', () => {
      const text = '{T}: Add two mana in any combination of colors. Spend this mana only to cast spells with flashback from a graveyard.';
      const result = parseOracleText(text);
      
      // Should have one activated ability with the full effect including the restriction
      const activatedAbilities = result.abilities.filter(a => a.type === AbilityType.ACTIVATED);
      expect(activatedAbilities.length).toBeGreaterThanOrEqual(1);
      
      // The effect should include both the mana production and the spending restriction
      const manaAbility = activatedAbilities[0];
      expect(manaAbility.effect).toContain('Add two mana');
      expect(manaAbility.effect).toContain('Spend this mana only to cast spells with flashback');
    });

    it('should merge ". Then" continuation sentences', () => {
      const text = 'Draw two cards. Then discard a card.';
      const result = parseOracleText(text);
      
      // Should parse as a single static ability with the complete effect
      const staticAbilities = result.abilities.filter(a => a.type === AbilityType.STATIC);
      expect(staticAbilities.length).toBeGreaterThanOrEqual(1);
      expect(staticAbilities[0].text).toContain('Draw two cards');
      expect(staticAbilities[0].text).toContain('Then discard a card');
    });

    it('should merge ". You may" continuation sentences', () => {
      const text = 'Exile target creature. You may cast it until end of turn.';
      const result = parseOracleText(text);
      
      // Should be a single ability with both parts
      const staticAbilities = result.abilities.filter(a => a.type === AbilityType.STATIC);
      expect(staticAbilities.length).toBeGreaterThanOrEqual(1);
      expect(staticAbilities[0].text).toContain('Exile target creature');
      expect(staticAbilities[0].text).toContain('You may cast it');
    });

    it('should merge ". If you do" continuation sentences', () => {
      const text = 'Sacrifice a creature. If you do, draw two cards.';
      const result = parseOracleText(text);
      
      const staticAbilities = result.abilities.filter(a => a.type === AbilityType.STATIC);
      expect(staticAbilities.length).toBeGreaterThanOrEqual(1);
      expect(staticAbilities[0].text).toContain('Sacrifice a creature');
      expect(staticAbilities[0].text).toContain('If you do');
    });

    it('should merge ". It gains" continuation sentences', () => {
      const text = 'Target creature gets +2/+0 until end of turn. It gains first strike until end of turn.';
      const result = parseOracleText(text);
      
      const staticAbilities = result.abilities.filter(a => a.type === AbilityType.STATIC);
      expect(staticAbilities.length).toBeGreaterThanOrEqual(1);
      expect(staticAbilities[0].text).toContain('+2/+0');
      expect(staticAbilities[0].text).toContain('It gains first strike');
    });

    it('should merge ". Return" continuation sentences', () => {
      const text = 'Exile target creature. Return it to the battlefield under your control at the beginning of the next end step.';
      const result = parseOracleText(text);
      
      const staticAbilities = result.abilities.filter(a => a.type === AbilityType.STATIC);
      expect(staticAbilities.length).toBeGreaterThanOrEqual(1);
      expect(staticAbilities[0].text).toContain('Exile target creature');
      expect(staticAbilities[0].text).toContain('Return it to the battlefield');
    });

    it('should merge ". Until" duration sentences', () => {
      const text = 'Target creature gains vigilance. Until end of turn, it also gains lifelink.';
      const result = parseOracleText(text);
      
      const staticAbilities = result.abilities.filter(a => a.type === AbilityType.STATIC);
      expect(staticAbilities.length).toBeGreaterThanOrEqual(1);
      expect(staticAbilities[0].text).toContain('vigilance');
      expect(staticAbilities[0].text).toContain('Until end of turn');
    });

    it('should merge ". Through" duration sentences', () => {
      const text = 'Exile the top two cards of your library. Through the end of this turn, you may cast spells from among those cards.';
      const result = parseOracleText(text);

      const staticAbilities = result.abilities.filter(a => a.type === AbilityType.STATIC);
      expect(staticAbilities.length).toBeGreaterThanOrEqual(1);
      expect(staticAbilities[0].text).toContain('Exile the top two cards');
      expect(staticAbilities[0].text).toContain('Through the end of this turn');
      expect(staticAbilities[0].text).toContain('cast spells from among');
    });

    it('should merge ". As long as" condition sentences', () => {
      const text = 'Exile those cards. As long as those cards remain exiled, you may cast them.';
      const result = parseOracleText(text);

      const staticAbilities = result.abilities.filter(a => a.type === AbilityType.STATIC);
      expect(staticAbilities.length).toBeGreaterThanOrEqual(1);
      expect(staticAbilities[0].text).toContain('Exile those cards');
      expect(staticAbilities[0].text).toContain('As long as those cards remain exiled');
      expect(staticAbilities[0].text).toContain('you may cast them');
    });

    it('should merge ". During" timing window sentences', () => {
      const text = 'Exile the top card of your library. During your next turn, you may play that card.';
      const result = parseOracleText(text);

      const staticAbilities = result.abilities.filter(a => a.type === AbilityType.STATIC);
      expect(staticAbilities.length).toBeGreaterThanOrEqual(1);
      expect(staticAbilities[0].text).toContain('Exile the top card of your library');
      expect(staticAbilities[0].text).toContain('During your next turn');
      expect(staticAbilities[0].text).toContain('you may play that card');
    });

    it('should merge ". Create" token creation sentences', () => {
      const text = 'Draw a card. Create a 1/1 white Soldier creature token.';
      const result = parseOracleText(text);
      
      const staticAbilities = result.abilities.filter(a => a.type === AbilityType.STATIC);
      expect(staticAbilities.length).toBeGreaterThanOrEqual(1);
      expect(staticAbilities[0].text).toContain('Draw a card');
      expect(staticAbilities[0].text).toContain('Create a 1/1');
    });

    it('should merge ". That" reference sentences', () => {
      const text = 'Put a +1/+1 counter on target creature. That creature gains trample until end of turn.';
      const result = parseOracleText(text);
      
      const staticAbilities = result.abilities.filter(a => a.type === AbilityType.STATIC);
      expect(staticAbilities.length).toBeGreaterThanOrEqual(1);
      expect(staticAbilities[0].text).toContain('+1/+1 counter');
      expect(staticAbilities[0].text).toContain('That creature gains trample');
    });

    it('should merge ". Activate" restriction sentences', () => {
      const text = '{2}, {T}: Draw a card. Activate only as a sorcery.';
      const result = parseOracleText(text);
      
      const activatedAbilities = result.abilities.filter(a => a.type === AbilityType.ACTIVATED);
      expect(activatedAbilities.length).toBeGreaterThanOrEqual(1);
      expect(activatedAbilities[0].effect).toContain('Draw a card');
      expect(activatedAbilities[0].effect).toContain('Activate only as a sorcery');
    });

    it('should NOT merge triggered abilities starting with "When"', () => {
      const text = 'When this creature enters the battlefield, draw a card.\nWhen this creature dies, lose 1 life.';
      const result = parseOracleText(text);
      
      // Should have TWO separate triggered abilities
      const triggeredAbilities = result.abilities.filter(a => a.type === AbilityType.TRIGGERED);
      expect(triggeredAbilities.length).toBe(2);
    });

    it('should NOT merge triggered abilities starting with "Whenever"', () => {
      const text = 'Whenever a creature enters, scry 1.\nWhenever a creature dies, gain 1 life.';
      const result = parseOracleText(text);
      
      // Should have TWO separate triggered abilities
      const triggeredAbilities = result.abilities.filter(a => a.type === AbilityType.TRIGGERED);
      expect(triggeredAbilities.length).toBe(2);
    });

    it('should merge multiple continuation sentences in sequence', () => {
      const text = 'Destroy target creature. It can\'t be regenerated. Draw a card.';
      const result = parseOracleText(text);
      
      const staticAbilities = result.abilities.filter(a => a.type === AbilityType.STATIC);
      expect(staticAbilities.length).toBeGreaterThanOrEqual(1);
      expect(staticAbilities[0].text).toContain('Destroy target creature');
      expect(staticAbilities[0].text).toContain('can\'t be regenerated');
      expect(staticAbilities[0].text).toContain('Draw a card');
    });

    it('should handle complex card with multiple abilities', () => {
      const text = 'Flying\n{T}: Add {U}. Spend this mana only to cast instant or sorcery spells.\nWhenever you cast an instant or sorcery spell, scry 1.';
      const result = parseOracleText(text);
      
      // Should have:
      // 1. Flying keyword
      expect(result.keywords).toContain('flying');
      
      // 2. One activated ability with merged effect
      const activatedAbilities = result.abilities.filter(a => a.type === AbilityType.ACTIVATED);
      expect(activatedAbilities.length).toBeGreaterThanOrEqual(1);
      const manaAbility = activatedAbilities.find(a => a.effect?.includes('Add {U}'));
      expect(manaAbility).toBeDefined();
      expect(manaAbility?.effect).toContain('Spend this mana only to cast');
      
      // 3. One triggered ability (should NOT merge with activated ability)
      const triggeredAbilities = result.abilities.filter(a => a.type === AbilityType.TRIGGERED);
      expect(triggeredAbilities.length).toBeGreaterThanOrEqual(1);
    });

    it('should only merge when continuation appears after ". " (period space)', () => {
      // Test that "Spend" at the start of oracle text is NOT treated as continuation
      const spendAtStart = 'Spend this mana only to cast instant or sorcery spells.';
      const startResult = parseOracleText(spendAtStart);
      // Should parse as a static ability, not be ignored
      expect(startResult.abilities.length).toBeGreaterThanOrEqual(1);

      // Test that "Spend" after ". " IS treated as continuation
      const spendAfterPeriod = '{T}: Add {U}. Spend this mana only to cast instant or sorcery spells.';
      const afterResult = parseOracleText(spendAfterPeriod);
      const activatedAbilities = afterResult.abilities.filter(a => a.type === AbilityType.ACTIVATED);
      expect(activatedAbilities.length).toBe(1);
      expect(activatedAbilities[0].effect).toContain('Add {U}');
      expect(activatedAbilities[0].effect).toContain('Spend this mana');
    });

    it('should not merge when term appears after newline instead of period', () => {
      // Newlines separate abilities, so "Then" on a new line should NOT merge
      const textWithNewline = 'Draw a card.\nThen each opponent loses 1 life.';
      const result = parseOracleText(textWithNewline);
      
      // Should have TWO separate abilities (split by newline)
      const staticAbilities = result.abilities.filter(a => a.type === AbilityType.STATIC);
      expect(staticAbilities.length).toBeGreaterThanOrEqual(2);
    });

    it('splits standalone keyword sentences from following triggered abilities on the same line', () => {
      const text =
        'Flash. When this permanent enters, target instant or sorcery card in your graveyard gains flashback until end of turn.';
      const result = parseOracleText(text, 'Snapcaster Mage');

      expect(result.abilities).toHaveLength(2);
      expect(result.abilities[0]).toMatchObject({
        type: AbilityType.STATIC,
        text: 'Flash.',
      });
      expect(result.abilities[1]).toMatchObject({
        type: AbilityType.TRIGGERED,
        triggerKeyword: 'when',
        triggerCondition: 'this permanent enters',
        effect: 'target instant or sorcery card in your graveyard gains flashback until end of turn.',
      });
    });

    it('should merge ". When you do" reflexive triggers (Electro, Assaulting Battery)', () => {
      const text = 'When this creature leaves the battlefield, you may pay {X}. When you do, it deals X damage to target player.';
      const result = parseOracleText(text);
      
      // Should have ONE triggered ability with the reflexive trigger merged
      const triggeredAbilities = result.abilities.filter(a => a.type === AbilityType.TRIGGERED);
      expect(triggeredAbilities.length).toBe(1);
      expect(triggeredAbilities[0].text).toContain('you may pay {X}');
      expect(triggeredAbilities[0].text).toContain('When you do');
      expect(triggeredAbilities[0].text).toContain('deals X damage');
    });

    it('should merge ". Whenever you do" reflexive triggers', () => {
      const text = 'At the beginning of your upkeep, you may sacrifice a creature. Whenever you do, draw a card.';
      const result = parseOracleText(text);
      
      // Should have ONE triggered ability with the reflexive trigger merged
      const triggeredAbilities = result.abilities.filter(a => a.type === AbilityType.TRIGGERED);
      expect(triggeredAbilities.length).toBe(1);
      expect(triggeredAbilities[0].text).toContain('you may sacrifice');
      expect(triggeredAbilities[0].text).toContain('Whenever you do');
      expect(triggeredAbilities[0].text).toContain('draw a card');
    });

    it('splits repeated leading trigger keywords into separate triggered abilities', () => {
      const text =
        'When you cycle this card and when this creature dies, you may exile target card from a graveyard.';
      const result = parseOracleText(text, 'Grixis Sojourners');

      const triggeredAbilities = result.abilities.filter(a => a.type === AbilityType.TRIGGERED);
      expect(triggeredAbilities).toHaveLength(2);
      expect(triggeredAbilities.map(a => a.triggerCondition)).toEqual([
        'you cycle this card',
        'this creature dies',
      ]);
      expect(triggeredAbilities.every(a => a.effect === 'you may exile target card from a graveyard.')).toBe(true);
    });
  });
});
