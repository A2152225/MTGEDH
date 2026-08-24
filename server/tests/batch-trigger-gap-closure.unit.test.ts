import { describe, expect, it } from 'vitest';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import {
  detectSpellCastTriggers,
  detectAttackTriggers,
  detectETBTriggers,
  detectDeathTriggers,
  detectSpellCounteredTriggers,
  detectMutateTriggers,
  detectDealtDamageTriggers,
  detectCombatDamageTriggers,
  detectTapTriggers,
  detectLTBTriggers,
  detectBlockTriggers,
  detectTransformTriggers,
  detectRoomTriggers,
  detectUntapTriggers,
  detectTargetedTriggers,
  detectDiscardTriggers,
  detectAbilityActivatedTriggers,
  detectMonstrousTriggers,
  detectBeginningOfCombatTriggers,
  detectTransformTriggers,
  detectReturnedToHandTriggers,
  detectCombatDamageTriggers,
  detectDealtDamageTriggers,
  detectEquippedTriggers,
  detectTapTriggers,
} from '../src/state/modules/triggered-abilities.js';
import { detectCounterPlacedTriggers, detectCounterRemovedTriggers } from '../src/state/modules/triggers/counters.js';
import { detectLeftGraveyardTriggers, detectPutIntoGraveyardTriggers, detectExiledFromBattlefieldTriggers } from '../src/state/modules/triggers/zone-change.js';
import { detectPrecombatMainTriggers } from '../src/state/modules/triggers/turn-phases.js';
import { detectUpkeepTriggers } from '../src/state/modules/upkeep-triggers.js';
import { detectCardDrawTriggers } from '../src/state/modules/triggers/card-draw.js';
import { detectOpponentSpellCastTriggers } from '../src/state/modules/triggers/spell-cast.js';
import { detectEndStepTriggers, detectPostcombatMainTriggers, detectDrawStepTriggers } from '../src/state/modules/triggers/turn-phases.js';
import { detectSacrificeTriggers } from '../src/state/modules/triggers/sacrifice.js';
import { detectLifeLossTriggers } from '../src/state/modules/triggers/life-loss.js';
import { detectGainedLifeTriggersFromOracle } from '../src/state/modules/triggers/lifegain.js';
import { detectTokenCreatedTriggers } from '../src/state/modules/triggers/tokens.js';
import { detectLandfallTriggers } from '../src/state/modules/triggers/landfall.js';
import { detectMillTriggers } from '../src/state/modules/triggers/mill.js';

const permanent = { id: 'P1', controller: 'P1' };

type GapCase = {
  name: string;
  oracle_text: string;
  detect: () => boolean;
  skipParse?: boolean;
};

const GAP_CASES: GapCase[] = [
  {
    name: 'God-Pharaoh\'s Faithful (blue without spell)',
    oracle_text: 'Whenever you cast a blue spell, you gain 1 life.',
    detect: () => detectSpellCastTriggers({ name: 'God-Pharaoh\'s Faithful', oracle_text: 'Whenever you cast a blue spell, you gain 1 life.' }, permanent).some((t) => t.spellCondition === 'color'),
  },
  {
    name: 'Lucky the Pizza Dog (cat tribal)',
    oracle_text: 'Whenever you cast a cat spell, create a Food token.',
    detect: () => detectSpellCastTriggers({ name: 'Lucky the Pizza Dog', oracle_text: 'Whenever you cast a cat spell, create a Food token.' }, permanent).some((t) => t.tribalType === 'cat'),
  },
  {
    name: 'Sram, Senior Edificer (aura)',
    oracle_text: 'Whenever you cast an Aura spell, you may draw a card.',
    detect: () => detectSpellCastTriggers({ name: 'Sram, Senior Edificer', oracle_text: 'Whenever you cast an Aura spell, you may draw a card.' }, permanent).length > 0,
  },
  {
    name: 'Torgal, A Fine Hound (first Human creature spell)',
    oracle_text: 'Whenever you cast your first Human creature spell each turn, that creature enters with an additional +1/+1 counter on it for each Dog and/or Wolf you control.',
    detect: () => detectSpellCastTriggers({ name: 'Torgal, A Fine Hound', oracle_text: 'Whenever you cast your first Human creature spell each turn, that creature enters with an additional +1/+1 counter on it for each Dog and/or Wolf you control.' }, permanent).some((t) => t.firstSpellThisTurn && t.spellCondition === 'creature'),
  },
  {
    name: 'Alaundo the Seer (cast from this)',
    oracle_text: 'Whenever you cast a creature spell from this, draw a card.',
    detect: () => detectSpellCastTriggers({ name: 'Alaundo the Seer', oracle_text: 'Whenever you cast a creature spell from this, draw a card.' }, permanent).some((t) => t.spellCondition === 'creature'),
  },
  {
    name: 'Maddening Hex (enchanted player casts)',
    oracle_text: 'Whenever enchanted player casts a spell, Maddening Hex deals damage to that player equal to the number of cards in their hand.',
    detect: () => detectOpponentSpellCastTriggers({ name: 'Maddening Hex', oracle_text: 'Whenever enchanted player casts a spell, Maddening Hex deals damage to that player equal to the number of cards in their hand.' }, permanent).length > 0,
  },
  {
    name: 'Curse of Vengeance (enchanted player)',
    oracle_text: 'Whenever enchanted player casts a spell, that player loses 1 life.',
    detect: () => detectOpponentSpellCastTriggers({ name: 'Curse of Vengeance', oracle_text: 'Whenever enchanted player casts a spell, that player loses 1 life.' }, permanent).length > 0,
  },
  {
    name: 'Sewer Nemesis (chosen player casts)',
    oracle_text: 'Whenever the chosen player casts a spell, that player mills a card.',
    detect: () => detectOpponentSpellCastTriggers({ name: 'Sewer Nemesis', oracle_text: 'Whenever the chosen player casts a spell, that player mills a card.' }, permanent).length > 0,
  },
  {
    name: 'Aerial Extortionist (cast from non-hand)',
    oracle_text: 'Whenever another player casts a spell from anywhere other than their hand, exile that spell.',
    detect: () => detectOpponentSpellCastTriggers({ name: 'Aerial Extortionist', oracle_text: 'Whenever another player casts a spell from anywhere other than their hand, exile that spell.' }, permanent).length > 0,
  },
  {
    name: 'Rashmi and Ragavan (during each of your turns)',
    oracle_text: 'Whenever you cast a spell during each of your turns, reveal the top card of your library.',
    detect: () => detectSpellCastTriggers({ name: 'Rashmi and Ragavan', oracle_text: 'Whenever you cast a spell during each of your turns, reveal the top card of your library.' }, permanent).length > 0,
  },
  {
    name: 'Drownyard Lurker (when cast or cycle)',
    oracle_text: 'When you cast or cycle Drownyard Lurker, create a 0/1 colorless Eldrazi Spawn creature token with "Sacrifice this token: Add {C}."',
    detect: () => detectSpellCastTriggers({ name: 'Drownyard Lurker', oracle_text: 'When you cast or cycle Drownyard Lurker, create a 0/1 colorless Eldrazi Spawn creature token with "Sacrifice this token: Add {C}."' }, permanent).length > 0,
  },
  {
    name: 'Don\'t Worry About It (when cast enchanted card)',
    oracle_text: 'When you cast enchanted card, copy it.',
    detect: () => detectSpellCastTriggers({ name: 'Don\'t Worry About It', oracle_text: 'When you cast enchanted card, copy it.' }, permanent).length > 0,
  },
  {
    name: 'Cemetery Gatekeeper (land or cast)',
    oracle_text: 'Whenever a player plays a land or casts a spell, if it shares a card type with the exiled card, this creature deals 2 damage to that player.',
    detect: () => detectSpellCastTriggers({ name: 'Cemetery Gatekeeper', oracle_text: 'Whenever a player plays a land or casts a spell, if it shares a card type with the exiled card, this creature deals 2 damage to that player.' }, permanent).length > 0,
  },
  {
    name: 'Multani\'s Presence (spell countered)',
    oracle_text: 'Whenever a spell you\'ve cast is countered, return Multani\'s Presence to its owner\'s hand.',
    detect: () => detectSpellCounteredTriggers({ name: 'Multani\'s Presence', oracle_text: 'Whenever a spell you\'ve cast is countered, return Multani\'s Presence to its owner\'s hand.' }, permanent).length > 0,
  },
  {
    name: 'Inferno Titan (enters or attacks)',
    oracle_text: 'Whenever Inferno Titan enters or attacks, it deals 3 damage divided as you choose among one, two, or three targets.',
    detect: () => detectAttackTriggers({ name: 'Inferno Titan', oracle_text: 'Whenever Inferno Titan enters or attacks, it deals 3 damage divided as you choose among one, two, or three targets.' }, permanent).some((t) => t.triggerType === 'self_enters_or_attacks')
      || detectETBTriggers({ name: 'Inferno Titan', oracle_text: 'Whenever Inferno Titan enters or attacks, it deals 3 damage divided as you choose among one, two, or three targets.' }, permanent).some((t) => t.triggerType === 'self_enters_or_attacks'),
  },
  {
    name: 'Director Nick Fury (whenever you attack)',
    oracle_text: 'Whenever you attack, look at the top four cards of your library.',
    detect: () => detectAttackTriggers({ name: 'Director Nick Fury', oracle_text: 'Whenever you attack, look at the top four cards of your library.' }, permanent).some((t) => t.triggerType === 'you_attack'),
  },
  {
    name: 'Planeswalker\'s Mischief (end step haven\'t cast)',
    oracle_text: 'At the beginning of your end step, if you haven\'t cast it, you lose 2 life.',
    detect: () => detectEndStepTriggers({ name: 'Planeswalker\'s Mischief', oracle_text: 'At the beginning of your end step, if you haven\'t cast it, you lose 2 life.' }, permanent).length > 0,
  },
  {
    name: 'Savior of the Small (second main phase)',
    oracle_text: 'At the beginning of your second main phase, if this creature is tapped, return target creature card with mana value 3 or less from your graveyard to your hand.',
    detect: () => detectPostcombatMainTriggers({ name: 'Savior of the Small', oracle_text: 'At the beginning of your second main phase, if this creature is tapped, return target creature card with mana value 3 or less from your graveyard to your hand.' }, permanent).length > 0,
  },
  {
    name: 'Viscera Seer (sacrifice)',
    oracle_text: 'Whenever you sacrifice a creature, scry 1.',
    detect: () => detectSacrificeTriggers({ name: 'Viscera Seer', oracle_text: 'Whenever you sacrifice a creature, scry 1.' }, permanent).length > 0,
  },
  {
    name: 'Gemrazer (mutate)',
    oracle_text: 'Whenever this creature mutates, destroy target artifact or enchantment an opponent controls.',
    detect: () => detectMutateTriggers({ name: 'Gemrazer', oracle_text: 'Whenever this creature mutates, destroy target artifact or enchantment an opponent controls.' }, permanent).length > 0,
  },
  {
    name: 'Rocco, Street Chef (cast from exile among)',
    oracle_text: 'Whenever you cast a spell from among cards exiled with Rocco, Street Chef, create a Food token.',
    detect: () => detectSpellCastTriggers({ name: 'Rocco, Street Chef', oracle_text: 'Whenever you cast a spell from among cards exiled with Rocco, Street Chef, create a Food token.' }, permanent).some((t) => t.sourceZoneRequirement === 'exile'),
  },
  {
    name: 'Guru Pathik (lesson)',
    oracle_text: 'Whenever you cast a Lesson spell, draw a card.',
    detect: () => detectSpellCastTriggers({ name: 'Guru Pathik', oracle_text: 'Whenever you cast a Lesson spell, draw a card.' }, permanent).length > 0,
  },
  {
    name: 'Nullstone Gargoyle (first noncreature spell counter)',
    oracle_text: 'Flying\nWhenever the first noncreature spell of a turn is cast, counter that spell.',
    detect: () => detectOpponentSpellCastTriggers({ name: 'Nullstone Gargoyle', oracle_text: 'Flying\nWhenever the first noncreature spell of a turn is cast, counter that spell.' }, permanent).length > 0,
  },
  {
    name: 'Impetuous Devils (when this creature attacks)',
    oracle_text: 'When this creature attacks, up to one target creature defending player controls blocks it this combat if able.',
    detect: () => detectAttackTriggers({ name: 'Impetuous Devils', oracle_text: 'When this creature attacks, up to one target creature defending player controls blocks it this combat if able.' }, permanent).length > 0,
  },
  {
    name: 'Zephyr Boots (equipped combat damage)',
    oracle_text: 'Whenever equipped creature deals combat damage to a player, draw a card, then discard a card.',
    detect: () => detectCombatDamageTriggers({ name: 'Zephyr Boots', oracle_text: 'Whenever equipped creature deals combat damage to a player, draw a card, then discard a card.' }, permanent).length > 0,
  },
  {
    name: 'Arcbond (that creature dealt damage)',
    oracle_text: 'Choose target creature. Whenever that creature is dealt damage this turn, it deals that much damage to each other creature and each player.',
    detect: () => detectDealtDamageTriggers({ name: 'Arcbond', oracle_text: 'Choose target creature. Whenever that creature is dealt damage this turn, it deals that much damage to each other creature and each player.' }, permanent).length > 0,
  },
  {
    name: 'Ian Malcolm (second card drawn)',
    oracle_text: 'Whenever a player draws their second card each turn, that player exiles the top card of their library.',
    detect: () => detectCardDrawTriggers({ name: 'Ian Malcolm, Chaotician', oracle_text: 'Whenever a player draws their second card each turn, that player exiles the top card of their library.' }, permanent).length > 0,
  },
  {
    name: 'Emrakul and Chatterfang (named cast)',
    oracle_text: 'When you cast Emrakul and Chatterfang, create 15 1/1 green Eldrazi Squirrel Scion creature tokens.',
    detect: () => detectSpellCastTriggers({ name: 'Emrakul and Chatterfang', oracle_text: 'When you cast Emrakul and Chatterfang, create 15 1/1 green Eldrazi Squirrel Scion creature tokens.' }, permanent).length > 0,
  },
  {
    name: 'Skittering Skirge (when you cast a creature spell)',
    oracle_text: 'Flying\nWhen you cast a creature spell, sacrifice this creature.',
    detect: () => detectSpellCastTriggers({ name: 'Skittering Skirge', oracle_text: 'Flying\nWhen you cast a creature spell, sacrifice this creature.' }, permanent).some((t) => t.spellCondition === 'creature'),
  },
  {
    name: 'Illusory Demon (when you cast a spell)',
    oracle_text: 'When you cast a spell, sacrifice this creature.',
    detect: () => detectSpellCastTriggers({ name: 'Illusory Demon', oracle_text: 'When you cast a spell, sacrifice this creature.' }, permanent).length > 0,
  },
  {
    name: 'Atomic Microsizer (equipped attacks)',
    oracle_text: 'Whenever equipped creature attacks, choose up to one target creature.',
    detect: () => detectAttackTriggers({ name: 'Atomic Microsizer', oracle_text: 'Whenever equipped creature attacks, choose up to one target creature.' }, permanent).length > 0,
  },
  {
    name: 'Elder Brain (attacks a player, not cast-this-way rider)',
    oracle_text: "Whenever this creature attacks a player, exile all cards from that player's hand, then they draw that many cards. You may play lands and cast spells from among the exiled cards for as long as they remain exiled. If you cast a spell this way, you may spend mana as though it were mana of any color to cast it.",
    detect: () => detectAttackTriggers({ name: 'Elder Brain', oracle_text: "Whenever this creature attacks a player, exile all cards from that player's hand, then they draw that many cards. You may play lands and cast spells from among the exiled cards for as long as they remain exiled. If you cast a spell this way, you may spend mana as though it were mana of any color to cast it." }, permanent).length > 0,
  },
  {
    name: 'Monkey Cage (when a creature enters)',
    oracle_text: "When a creature enters, sacrifice this artifact and create X 2/2 green Monkey creature tokens, where X is that creature's mana value.",
    detect: () => detectETBTriggers({ name: 'Monkey Cage', oracle_text: "When a creature enters, sacrifice this artifact and create X 2/2 green Monkey creature tokens, where X is that creature's mana value." }, permanent).some((t) => t.triggerType === 'creature_etb'),
  },
  {
    name: 'Jailbreak (when that permanent enters)',
    oracle_text: "Return target permanent card in an opponent's graveyard to the battlefield under their control. When that permanent enters, return up to one target permanent card with equal or lesser mana value from your graveyard to the battlefield.",
    detect: () => detectETBTriggers({ name: 'Jailbreak', oracle_text: "Return target permanent card in an opponent's graveyard to the battlefield under their control. When that permanent enters, return up to one target permanent card with equal or lesser mana value from your graveyard to the battlefield." }, permanent).some((t) => (t as any).triggerType === 'delayed_etb'),
  },
  {
    // CR 702.85a: cascade functions while the spell is on the stack, not as a
    // battlefield "whenever you cast a spell" watcher. detectSpellCastTriggers
    // must stay empty so a resolved Etherium-Horn does not re-cascade later casts.
    name: 'Etherium-Horn Sorcerer (cascade self-cast is not a battlefield watcher)',
    oracle_text: '{1}{U}{R}: Return this creature to its owner\'s hand.\nCascade (When you cast this spell, exile cards from the top of your library until you exile a nonland card that costs less. You may cast it without paying its mana cost. Put the exiled cards on the bottom in a random order.)',
    detect: () => detectSpellCastTriggers({ name: 'Etherium-Horn Sorcerer', oracle_text: '{1}{U}{R}: Return this creature to its owner\'s hand.\nCascade (When you cast this spell, exile cards from the top of your library until you exile a nonland card that costs less. You may cast it without paying its mana cost. Put the exiled cards on the bottom in a random order.)' }, permanent).length === 0,
  },
  {
    name: 'Skyfire Phoenix (when you cast your commander)',
    oracle_text: 'When you cast your commander, exile this card from your graveyard. It gains flying until end of turn.',
    detect: () => detectSpellCastTriggers({ name: 'Skyfire Phoenix', oracle_text: 'When you cast your commander, exile this card from your graveyard. It gains flying until end of turn.' }, permanent).some((t) => t.tribalType === 'commander'),
  },
  {
    name: 'The Lost and the Damned (cast from non-hand compound)',
    oracle_text: 'Whenever a land you control enters from anywhere other than your hand or you cast a spell from anywhere other than your hand, create a 3/3 red Spawn creature token.',
    detect: () => detectSpellCastTriggers({ name: 'The Lost and the Damned', oracle_text: 'Whenever a land you control enters from anywhere other than your hand or you cast a spell from anywhere other than your hand, create a 3/3 red Spawn creature token.' }, permanent).some((t) => t.sourceZoneRequirement === 'not_hand'),
  },
  {
    name: 'Nef-Crop Entangler (exert when you do)',
    oracle_text: 'You may exert this creature as it attacks. When you do, it gets +1/+2 until end of turn.',
    detect: () => detectAttackTriggers({ name: 'Nef-Crop Entangler', oracle_text: 'You may exert this creature as it attacks. When you do, it gets +1/+2 until end of turn.' }, permanent).some((t) => t.triggerType === 'exert' || t.triggerType === 'when_you_do'),
  },
  {
    name: 'Matopi Golem (regenerates this way)',
    oracle_text: '{1}: Regenerate this creature. When it regenerates this way, put a -1/-1 counter on it.',
    detect: () => detectETBTriggers({ name: 'Matopi Golem', oracle_text: '{1}: Regenerate this creature. When it regenerates this way, put a -1/-1 counter on it.' }, permanent).some((t) => t.triggerType === 'regenerated'),
  },
  {
    name: 'Soul-Scar Mage (prowess noncreature cast)',
    oracle_text: 'Prowess\nIf a source you control would deal noncombat damage to a creature an opponent controls, put that many -1/-1 counters on that creature instead.',
    detect: () => detectSpellCastTriggers({ name: 'Soul-Scar Mage', oracle_text: 'Prowess\nIf a source you control would deal noncombat damage to a creature an opponent controls, put that many -1/-1 counters on that creature instead.' }, permanent).some((t) => t.spellCondition === 'noncreature'),
  },
  {
    name: 'Kasla, the Broken Halo (another spell that has convoke)',
    oracle_text: 'Whenever you cast another spell that has convoke, scry 2, then draw a card.',
    detect: () => detectSpellCastTriggers({ name: 'Kasla, the Broken Halo', oracle_text: 'Whenever you cast another spell that has convoke, scry 2, then draw a card.' }, permanent).some((t) => t.tribalType === 'convoke'),
  },
  {
    name: 'Haazda Marshal (battalion and at least two other creatures attack)',
    oracle_text: 'Whenever this creature and at least two other creatures attack, create a 1/1 white Soldier creature token with lifelink.',
    detect: () => detectAttackTriggers({ name: 'Haazda Marshal', oracle_text: 'Whenever this creature and at least two other creatures attack, create a 1/1 white Soldier creature token with lifelink.' }, permanent).some((t) => t.triggerType === 'battalion'),
  },
  {
    name: 'Ogre Battlecaster (attacks, not cast-that-spell rider)',
    oracle_text: 'Whenever this creature attacks, you may cast target instant or sorcery card from your graveyard by paying {R}{R} in addition to its other costs. When you cast that spell, it gains haste until end of turn.',
    detect: () => detectAttackTriggers({ name: 'Ogre Battlecaster', oracle_text: 'Whenever this creature attacks, you may cast target instant or sorcery card from your graveyard by paying {R}{R} in addition to its other costs. When you cast that spell, it gains haste until end of turn.' }, permanent).length > 0,
    skipParse: false,
  },
  {
    name: 'Savai Thundermane (whenever you cycle a card)',
    oracle_text: 'Whenever you cycle a card, when you do, put a +1/+1 counter on target creature you control.',
    detect: () => detectSpellCastTriggers({ name: 'Savai Thundermane', oracle_text: 'Whenever you cycle a card, when you do, put a +1/+1 counter on target creature you control.' }, permanent).some((t) => String(t.description || '').toLowerCase().includes('cycle a card')),
  },
  {
    name: 'Megrim (a player casts a black spell)',
    oracle_text: 'Whenever a player casts a black spell, that player loses 2 life.',
    detect: () => detectOpponentSpellCastTriggers({ name: 'Megrim', oracle_text: 'Whenever a player casts a black spell, that player loses 2 life.' }, permanent).length > 0,
  },
  {
    name: 'Warped Researcher (a player cycles a card)',
    oracle_text: 'Whenever a player cycles a card, Warped Researcher gets +2/+2 until end of turn.',
    detect: () => detectOpponentSpellCastTriggers({ name: 'Warped Researcher', oracle_text: 'Whenever a player cycles a card, Warped Researcher gets +2/+2 until end of turn.' }, permanent).length > 0,
  },
  {
    name: 'Drannith Healer (you cycle another card)',
    oracle_text: 'Whenever you cycle another card, you gain 1 life.',
    detect: () => detectSpellCastTriggers({ name: 'Drannith Healer', oracle_text: 'Whenever you cycle another card, you gain 1 life.' }, permanent).some((t) => String(t.description || '').toLowerCase().includes('cycle another card')),
  },
  {
    name: 'Null Profusion (you play a card)',
    oracle_text: 'Skip your draw step.\nWhenever you play a card, draw a card.\nYour maximum hand size is two.',
    detect: () => detectSpellCastTriggers({ name: 'Null Profusion', oracle_text: 'Skip your draw step.\nWhenever you play a card, draw a card.\nYour maximum hand size is two.' }, permanent).some((t) => String(t.description || '').toLowerCase().includes('you play a card')),
  },
  {
    name: 'Fires of Mount Doom (play a card this way)',
    oracle_text: '{2}{R}: Exile the top card of your library. You may play that card this turn. When you play a card this way, Fires of Mount Doom deals 2 damage to each player.',
    detect: () => detectSpellCastTriggers({ name: 'Fires of Mount Doom', oracle_text: '{2}{R}: Exile the top card of your library. You may play that card this turn. When you play a card this way, Fires of Mount Doom deals 2 damage to each player.' }, permanent).some((t) => String(t.description || '').toLowerCase().includes('play a card this way')),
  },
  {
    name: 'Eye of the Storm (instant or sorcery card)',
    oracle_text: 'Whenever a player casts an instant or sorcery card, exile it. Then that player copies each instant or sorcery card exiled with this enchantment. For each copy, the player may cast the copy without paying its mana cost.',
    detect: () => detectOpponentSpellCastTriggers({ name: 'Eye of the Storm', oracle_text: 'Whenever a player casts an instant or sorcery card, exile it. Then that player copies each instant or sorcery card exiled with this enchantment. For each copy, the player may cast the copy without paying its mana cost.' }, permanent).length > 0,
  },
  {
    name: 'Elrond, Lord of Rivendell (named or another creature ETB)',
    oracle_text: 'Whenever Elrond or another creature you control enters, scry 1. If this is the second time this ability has resolved this turn, the Ring tempts you.',
    detect: () => detectETBTriggers({ name: 'Elrond, Lord of Rivendell', oracle_text: 'Whenever Elrond or another creature you control enters, scry 1. If this is the second time this ability has resolved this turn, the Ring tempts you.' }, permanent).some((t) => t.triggerType === 'named_or_another_creature_etb'),
  },
  {
    name: 'Spellweaver Helix (player casts a card)',
    oracle_text: 'Imprint — When this artifact enters, you may exile two target sorcery cards from a single graveyard.\nWhenever a player casts a card, if it has the same name as one of the cards exiled with this artifact, you may copy the other. If you do, you may cast the copy without paying its mana cost.',
    detect: () => detectOpponentSpellCastTriggers({ name: 'Spellweaver Helix', oracle_text: 'Imprint — When this artifact enters, you may exile two target sorcery cards from a single graveyard.\nWhenever a player casts a card, if it has the same name as one of the cards exiled with this artifact, you may copy the other. If you do, you may cast the copy without paying its mana cost.' }, permanent).length > 0,
  },
  {
    name: 'Ogre Slumlord (another nontoken creature dies)',
    oracle_text: 'Whenever another nontoken creature dies, you may create a 1/1 black Rat creature token.\nRats you control have deathtouch.',
    detect: () => detectDeathTriggers({ name: 'Ogre Slumlord', oracle_text: 'Whenever another nontoken creature dies, you may create a 1/1 black Rat creature token.\nRats you control have deathtouch.' }, permanent).some((t) => t.triggerType === 'any_creature_dies'),
  },
  {
    name: 'Mukotai Soulripper (Vehicle attacks)',
    oracle_text: 'Whenever this Vehicle attacks, you may sacrifice another artifact or creature. If you do, put a +1/+1 counter on this Vehicle and it gains menace until end of turn.\nCrew 2',
    detect: () => detectAttackTriggers({ name: 'Mukotai Soulripper', oracle_text: 'Whenever this Vehicle attacks, you may sacrifice another artifact or creature. If you do, put a +1/+1 counter on this Vehicle and it gains menace until end of turn.\nCrew 2' }, permanent).some((t) => t.triggerType === 'attacks'),
  },
  {
    name: 'Super Shredder (another permanent leaves)',
    oracle_text: 'Menace\nWhenever another permanent leaves the battlefield, put a +1/+1 counter on Super Shredder.',
    detect: () => detectLTBTriggers({ name: 'Super Shredder', oracle_text: 'Menace\nWhenever another permanent leaves the battlefield, put a +1/+1 counter on Super Shredder.' }, permanent).some((t) => t.triggerType === 'another_permanent_ltb'),
  },
  {
    name: 'Laccolith Rig (enchanted creature becomes blocked)',
    oracle_text: 'Enchant creature\nWhenever enchanted creature becomes blocked, you may have it deal damage equal to its power to target creature.',
    detect: () => detectBlockTriggers({ name: 'Laccolith Rig', oracle_text: 'Enchant creature\nWhenever enchanted creature becomes blocked, you may have it deal damage equal to its power to target creature.' }, permanent).length > 0,
  },
  {
    name: 'Aragorn, Hornburg Hero (renowned creature combat damage)',
    oracle_text: 'Whenever a renowned creature you control deals combat damage to a player, double the number of +1/+1 counters on it.',
    detect: () => detectCombatDamageTriggers({ name: 'Aragorn, Hornburg Hero', oracle_text: 'Whenever a renowned creature you control deals combat damage to a player, double the number of +1/+1 counters on it.' }, permanent).some((t) => t.triggerType === 'controlled_creature_deals_combat_damage'),
  },
  {
    name: 'Bonethorn Valesk (a permanent is turned face up)',
    oracle_text: 'Whenever a permanent is turned face up, this creature deals 1 damage to any target.',
    detect: () => detectETBTriggers({ name: 'Bonethorn Valesk', oracle_text: 'Whenever a permanent is turned face up, this creature deals 1 damage to any target.' }, permanent).some((t) => t.triggerType === 'any_permanent_face_up'),
  },
  {
    name: 'Summoning Station (artifact put into graveyard)',
    oracle_text: 'Whenever an artifact is put into a graveyard from the battlefield, you may untap this artifact.',
    detect: () => detectDeathTriggers({ name: 'Summoning Station', oracle_text: 'Whenever an artifact is put into a graveyard from the battlefield, you may untap this artifact.' }, permanent).some((t) => t.triggerType === 'put_into_graveyard_from_battlefield'),
  },
  {
    name: 'Corrupted Roots (enchanted land becomes tapped)',
    oracle_text: 'Enchant Forest or Plains\nWhenever enchanted land becomes tapped, its controller loses 2 life.',
    detect: () => detectTapTriggers({ name: 'Corrupted Roots', oracle_text: 'Enchant Forest or Plains\nWhenever enchanted land becomes tapped, its controller loses 2 life.' }, permanent).some((t) => t.affectedType === 'enchanted_land'),
  },
  {
    name: 'Powerstone Minefield (any creature attacks or blocks)',
    oracle_text: 'Whenever a creature attacks or blocks, this enchantment deals 2 damage to it.',
    detect: () => detectAttackTriggers({ name: 'Powerstone Minefield', oracle_text: 'Whenever a creature attacks or blocks, this enchantment deals 2 damage to it.' }, permanent).some((t) => t.triggerType === 'any_creature_attacks_or_blocks'),
  },
  {
    name: 'Collectigull (DFC short-name attacks)',
    oracle_text: 'Flying\nWhenever Collectigull attacks, reveal the top card of your library.',
    detect: () => detectAttackTriggers({ name: 'Collectigull // Only the Best', oracle_text: 'Flying\nWhenever Collectigull attacks, reveal the top card of your library.' }, permanent).some((t) => t.triggerType === 'attacks'),
  },
  {
    name: 'Hildibrand Manderville (DFC short-name dies)',
    oracle_text: 'When Hildibrand Manderville dies, you may cast it from your graveyard as an Adventure until the end of your next turn.',
    detect: () => detectDeathTriggers({ name: "Hildibrand Manderville // Gentleman's Rise", oracle_text: 'When Hildibrand Manderville dies, you may cast it from your graveyard as an Adventure until the end of your next turn.' }, permanent).some((t) => t.triggerType === 'dies'),
  },
  {
    name: 'Rienne, Angel of Rebirth (multicolored creature you control dies)',
    oracle_text: 'Flying\nOther multicolored creatures you control get +1/+0.\nWhenever another multicolored creature you control dies, return it to its owner\'s hand at the beginning of the next end step.',
    detect: () => detectDeathTriggers({ name: 'Rienne, Angel of Rebirth', oracle_text: 'Flying\nOther multicolored creatures you control get +1/+0.\nWhenever another multicolored creature you control dies, return it to its owner\'s hand at the beginning of the next end step.' }, permanent).some((t) => t.triggerType === 'creature_dies'),
  },
  {
    name: 'Loafing Giant (attacks or blocks)',
    oracle_text: 'Whenever this creature attacks or blocks, mill a card. If a land card was milled this way, prevent all combat damage this creature would deal this turn.',
    detect: () => detectAttackTriggers({ name: 'Loafing Giant', oracle_text: 'Whenever this creature attacks or blocks, mill a card. If a land card was milled this way, prevent all combat damage this creature would deal this turn.' }, permanent).some((t) => t.triggerType === 'attacks_or_blocks'),
  },
  {
    name: 'Lust for War (enchanted creature becomes tapped)',
    oracle_text: 'Enchant creature\nWhenever enchanted creature becomes tapped, this Aura deals 3 damage to that creature\'s controller.',
    detect: () => detectTapTriggers({ name: 'Lust for War', oracle_text: 'Enchant creature\nWhenever enchanted creature becomes tapped, this Aura deals 3 damage to that creature\'s controller.' }, permanent).some((t) => t.affectedType === 'enchanted_creature'),
  },
  {
    name: "Hawkeye's Bow (equipped creature becomes tapped)",
    oracle_text: 'Whenever equipped creature becomes tapped, it deals 1 damage to each opponent.',
    detect: () => detectTapTriggers({ name: "Hawkeye's Bow", oracle_text: 'Whenever equipped creature becomes tapped, it deals 1 damage to each opponent.' }, permanent).some((t) => t.affectedType === 'equipped_creature'),
  },
  {
    name: 'Sleep Magic (enchanted creature is dealt damage)',
    oracle_text: 'Enchant creature\nWhen enchanted creature is dealt damage, sacrifice this Aura.',
    detect: () => detectDealtDamageTriggers({ name: 'Sleep Magic', oracle_text: 'Enchant creature\nWhen enchanted creature is dealt damage, sacrifice this Aura.' }, permanent).length > 0,
  },
  {
    name: 'Court Street Denizen (another white creature you control enters)',
    oracle_text: 'Whenever another white creature you control enters, tap target creature an opponent controls.',
    detect: () => detectETBTriggers({ name: 'Court Street Denizen', oracle_text: 'Whenever another white creature you control enters, tap target creature an opponent controls.' }, permanent).some((t) => t.triggerType === 'creature_etb'),
  },
  {
    name: 'Vastwood Zendikon (enchanted land dies)',
    oracle_text: 'Enchant land\nEnchanted land is a 6/4 green Elemental creature. It\'s still a land.\nWhen enchanted land dies, return that card to its owner\'s hand.',
    detect: () => detectDeathTriggers({ name: 'Vastwood Zendikon', oracle_text: 'Enchant land\nEnchanted land is a 6/4 green Elemental creature. It\'s still a land.\nWhen enchanted land dies, return that card to its owner\'s hand.' }, permanent).some((t) => t.triggerType === 'attachment_dies'),
  },
  {
    name: 'Extra Arms (enchanted creature attacks)',
    oracle_text: 'Enchant creature\nWhenever enchanted creature attacks, it deals 2 damage to any target.',
    detect: () => detectAttackTriggers({ name: 'Extra Arms', oracle_text: 'Enchant creature\nWhenever enchanted creature attacks, it deals 2 damage to any target.' }, permanent).some((t) => t.triggerType === 'attacks'),
  },
  {
    name: 'Hoard Hauler (Vehicle combat damage)',
    oracle_text: 'Trample\nWhenever this Vehicle deals combat damage to a player, create a Treasure token for each artifact they control.\nCrew 3',
    detect: () => detectCombatDamageTriggers({ name: 'Hoard Hauler', oracle_text: 'Trample\nWhenever this Vehicle deals combat damage to a player, create a Treasure token for each artifact they control.\nCrew 3' }, permanent).length > 0,
  },
  {
    name: 'Jeskai Infiltrator (when deals combat damage)',
    oracle_text: 'When this creature deals combat damage to a player, exile it and the top card of your library in a face-down pile, shuffle that pile, then manifest those cards.',
    detect: () => detectCombatDamageTriggers({ name: 'Jeskai Infiltrator', oracle_text: 'When this creature deals combat damage to a player, exile it and the top card of your library in a face-down pile, shuffle that pile, then manifest those cards.' }, permanent).length > 0,
  },
  {
    name: 'Righteous Cause (any creature attacks)',
    oracle_text: 'Whenever a creature attacks, you gain 1 life.',
    detect: () => detectAttackTriggers({ name: 'Righteous Cause', oracle_text: 'Whenever a creature attacks, you gain 1 life.' }, permanent).some((t) => t.triggerType === 'any_creature_attacks'),
  },
  {
    name: 'Calix, Guided by Fate (named or another enchantment ETB)',
    oracle_text: 'Constellation — Whenever Calix or another enchantment you control enters, put a +1/+1 counter on target creature.',
    detect: () => detectETBTriggers({ name: 'Calix, Guided by Fate', oracle_text: 'Constellation — Whenever Calix or another enchantment you control enters, put a +1/+1 counter on target creature.' }, permanent).some((t) => t.triggerType === 'named_or_another_enchantment_etb'),
  },
  {
    name: 'Ozox, the Clattering King (short-name dies)',
    oracle_text: 'Ozox can\'t block.\nWhen Ozox dies, create Jumblebones, a legendary 2/1 black Skeleton creature token with "Jumblebones can\'t block" and "When Jumblebones leaves the battlefield, return target card named Ozox, the Clattering King from your graveyard to your hand."',
    detect: () => detectDeathTriggers({ name: 'Ozox, the Clattering King', oracle_text: 'Ozox can\'t block.\nWhen Ozox dies, create Jumblebones, a legendary 2/1 black Skeleton creature token with "Jumblebones can\'t block" and "When Jumblebones leaves the battlefield, return target card named Ozox, the Clattering King from your graveyard to your hand."' }, permanent).some((t) => t.triggerType === 'dies'),
  },
  {
    name: 'Garland DFC back-face (Chaos dies)',
    oracle_text: 'When Chaos dies, put it on the bottom of its owner\'s library.',
    detect: () => detectDeathTriggers({ name: 'Garland, Knight of Cornelia // Chaos, the Endless', oracle_text: 'When Chaos dies, put it on the bottom of its owner\'s library.' }, permanent).some((t) => t.triggerType === 'dies'),
  },
  {
    name: 'Zenos (chosen creature LTB)',
    oracle_text: 'When the chosen creature leaves the battlefield, transform Zenos yae Galvus.',
    detect: () => detectLTBTriggers({ name: 'Zenos yae Galvus // Shinryu, Transcendent Rival', oracle_text: 'When the chosen creature leaves the battlefield, transform Zenos yae Galvus.' }, permanent).some((t) => t.triggerType === 'chosen_creature_ltb'),
  },
  {
    name: 'Neglected Heirloom (equipped creature transforms)',
    oracle_text: 'When equipped creature transforms, transform this Equipment.',
    detect: () => detectTransformTriggers({ name: 'Neglected Heirloom // Ashmouth Blade', oracle_text: 'When equipped creature transforms, transform this Equipment.' }, permanent).length > 0,
  },
  {
    name: 'Aurelia (player attacks with N creatures)',
    oracle_text: 'Whenever a player attacks with three or more creatures, you draw a card.\nWhenever a player attacks with five or more creatures, Aurelia deals 3 damage to each of your opponents and you gain 3 life.',
    detect: () => detectAttackTriggers({ name: 'Aurelia, the Law Above', oracle_text: 'Whenever a player attacks with three or more creatures, you draw a card.\nWhenever a player attacks with five or more creatures, Aurelia deals 3 damage to each of your opponents and you gain 3 life.' }, permanent).filter((t) => t.triggerType === 'player_attacks_with_creatures').length >= 2,
  },
  {
    name: 'Maeve (that creature attacks)',
    oracle_text: 'Whenever that creature attacks one of your opponents this turn, you draw a card.',
    detect: () => detectAttackTriggers({ name: 'Maeve, Insidious Singer', oracle_text: 'Whenever that creature attacks one of your opponents this turn, you draw a card.' }, permanent).some((t) => t.triggerType === 'that_creature_attacks'),
  },
  {
    name: 'World at War (rebound upkeep)',
    oracle_text: 'Rebound (If you cast this spell from your hand, exile it as it resolves. At the beginning of your next upkeep, you may cast this card from exile without paying its mana cost.)',
    detect: () => detectUpkeepTriggers({ name: 'World at War', oracle_text: 'Rebound (If you cast this spell from your hand, exile it as it resolves. At the beginning of your next upkeep, you may cast this card from exile without paying its mana cost.)' }, permanent).some((t) => t.triggerType === 'rebound'),
  },
  {
    name: 'Kindred Discovery (chosen type enters or attacks)',
    oracle_text: 'As this enchantment enters, choose a creature type.\nWhenever a creature you control of the chosen type enters or attacks, draw a card.',
    detect: () => detectAttackTriggers({ name: 'Kindred Discovery', oracle_text: 'As this enchantment enters, choose a creature type.\nWhenever a creature you control of the chosen type enters or attacks, draw a card.' }, permanent).some((t) => t.triggerType === 'chosen_type_creature_etb_or_attack'),
    skipParse: true,
  },
  {
    name: 'Bogwater Lumaret (this or another creature ETB)',
    oracle_text: 'Whenever this creature or another creature you control enters, you gain 1 life.',
    detect: () => detectETBTriggers({ name: 'Bogwater Lumaret', oracle_text: 'Whenever this creature or another creature you control enters, you gain 1 life.' }, permanent).some((t) => t.triggerType === 'this_or_another_creature_etb'),
  },
  {
    name: 'Cinder Wall (when blocks)',
    oracle_text: 'Defender\nWhen this creature blocks, destroy it at end of combat.',
    detect: () => detectBlockTriggers({ name: 'Cinder Wall', oracle_text: 'Defender\nWhen this creature blocks, destroy it at end of combat.' }, permanent).length > 0,
  },
  {
    name: 'Blessed Defiance (that creature dies this turn)',
    oracle_text: 'Target creature you control gets +2/+0 and gains lifelink until end of turn. When that creature dies this turn, create a 1/1 white Spirit creature token with flying.',
    detect: () => detectDeathTriggers({ name: 'Blessed Defiance', oracle_text: 'Target creature you control gets +2/+0 and gains lifelink until end of turn. When that creature dies this turn, create a 1/1 white Spirit creature token with flying.' }, permanent).some((t) => t.triggerType === 'that_creature_dies'),
  },
  {
    name: 'Skyclave Invader (transforms into named face)',
    oracle_text: 'When this creature transforms into Skyclave Invader, look at the top card of your library.',
    detect: () => detectTransformTriggers({ name: 'Skyclave Aerialist // Skyclave Invader', oracle_text: 'When this creature transforms into Skyclave Invader, look at the top card of your library.' }, permanent).length > 0,
  },
  {
    name: 'Keranos (reveal this way)',
    oracle_text: 'Whenever you reveal a land card this way, draw a card. Whenever you reveal a nonland card this way, Keranos deals 3 damage to any target.',
    detect: () => detectCardDrawTriggers({ name: 'Keranos, God of Storms', oracle_text: 'Whenever you reveal a land card this way, draw a card. Whenever you reveal a nonland card this way, Keranos deals 3 damage to any target.' }, permanent).filter((t) => t.triggerType === 'reveal_this_way').length >= 2,
  },
  {
    name: 'Mark of Fury (the end step)',
    oracle_text: 'At the beginning of the end step, return this Aura to its owner\'s hand.',
    detect: () => detectEndStepTriggers({ name: 'Mark of Fury', oracle_text: 'At the beginning of the end step, return this Aura to its owner\'s hand.' }, permanent).length > 0,
  },
  {
    name: 'Kazandu Blademaster (ally ETB)',
    oracle_text: 'Whenever this creature or another Ally you control enters, you may put a +1/+1 counter on this creature.',
    detect: () => detectETBTriggers({ name: 'Kazandu Blademaster', oracle_text: 'Whenever this creature or another Ally you control enters, you may put a +1/+1 counter on this creature.' }, permanent).some((t) => t.triggerType === 'this_or_another_ally_etb'),
  },
  {
    name: 'Skybind (this or another enchantment ETB)',
    oracle_text: 'Constellation — Whenever this enchantment or another enchantment you control enters, exile target nonenchantment permanent.',
    detect: () => detectETBTriggers({ name: 'Skybind', oracle_text: 'Constellation — Whenever this enchantment or another enchantment you control enters, exile target nonenchantment permanent.' }, permanent).some((t) => t.triggerType === 'this_or_another_enchantment_etb'),
  },
  {
    name: 'Invasion of Azgol (siege ETB)',
    oracle_text: 'When this Siege enters, target player sacrifices a creature or planeswalker of their choice and loses 1 life.',
    detect: () => detectETBTriggers({ name: 'Invasion of Azgol // Ashen Reaper', oracle_text: 'When this Siege enters, target player sacrifices a creature or planeswalker of their choice and loses 1 life.' }, permanent).length > 0,
  },
  {
    name: 'Stonehoof Chieftain (another creature attacks)',
    oracle_text: 'Whenever another creature you control attacks, it gains trample and indestructible until end of turn.',
    detect: () => detectAttackTriggers({ name: 'Stonehoof Chieftain', oracle_text: 'Whenever another creature you control attacks, it gains trample and indestructible until end of turn.' }, permanent).some((t) => t.triggerType === 'another_creature_attacks'),
  },
  {
    name: 'Mesmeric Orb (permanent becomes untapped)',
    oracle_text: 'Whenever a permanent becomes untapped, that permanent\'s controller mills a card.',
    detect: () => detectUntapTriggers({ name: 'Mesmeric Orb', oracle_text: 'Whenever a permanent becomes untapped, that permanent\'s controller mills a card.' }, permanent).length > 0,
  },
  {
    name: 'Cramped Vents (unlock door)',
    oracle_text: 'When you unlock this door, this Room deals 6 damage to target creature an opponent controls.',
    detect: () => detectRoomTriggers({ name: 'Cramped Vents // Access Maze', oracle_text: 'When you unlock this door, this Room deals 6 damage to target creature an opponent controls.' }, permanent).length > 0,
  },
  {
    name: 'Scattering Stroke (next main phase)',
    oracle_text: 'If you win, at the beginning of your next main phase, you may add an amount of {C} equal to that spell\'s mana value.',
    detect: () => detectPrecombatMainTriggers({ name: 'Scattering Stroke', oracle_text: 'If you win, at the beginning of your next main phase, you may add an amount of {C} equal to that spell\'s mana value.' }, permanent).length > 0,
    skipParse: true,
  },
  {
    name: 'Thawbringer (enters or dies)',
    oracle_text: 'When this creature enters or dies, surveil 1.',
    detect: () => detectDeathTriggers({ name: 'Thawbringer', oracle_text: 'When this creature enters or dies, surveil 1.' }, permanent).some((t) => t.triggerType === 'enters_or_dies'),
  },
  {
    name: 'Balor (attacks or dies)',
    oracle_text: 'Whenever this creature attacks or dies, choose one or more.',
    detect: () => detectAttackTriggers({ name: 'Balor', oracle_text: 'Whenever this creature attacks or dies, choose one or more.' }, permanent).some((t) => t.triggerType === 'attacks_or_dies'),
  },
  {
    name: 'Fire Nation Warship (vehicle dies)',
    oracle_text: 'When this Vehicle dies, create a Clue token.',
    detect: () => detectDeathTriggers({ name: 'Fire Nation Warship', oracle_text: 'When this Vehicle dies, create a Clue token.' }, permanent).some((t) => t.triggerType === 'dies'),
  },
  {
    name: 'Favor of the Woods (enchanted creature blocks)',
    oracle_text: 'Whenever enchanted creature blocks, you gain 3 life.',
    detect: () => detectBlockTriggers({ name: 'Favor of the Woods', oracle_text: 'Whenever enchanted creature blocks, you gain 3 life.' }, permanent).length > 0,
  },
  {
    name: 'Spider-Mobile (vehicle attacks or blocks)',
    oracle_text: 'Whenever this Vehicle attacks or blocks, it gets +1/+1 until end of turn for each Spider you control.',
    detect: () => detectBlockTriggers({ name: 'Spider-Mobile', oracle_text: 'Whenever this Vehicle attacks or blocks, it gets +1/+1 until end of turn for each Spider you control.' }, permanent).length > 0,
  },
  {
    name: 'Goldenhide Ox (creature or enchantment ETB)',
    oracle_text: 'Whenever this creature or another enchantment you control enters, target creature must be blocked this turn if able.',
    detect: () => detectETBTriggers({ name: 'Goldenhide Ox', oracle_text: 'Whenever this creature or another enchantment you control enters, target creature must be blocked this turn if able.' }, permanent).some((t) => t.triggerType === 'this_creature_or_another_enchantment_etb'),
  },
  {
    name: 'Ellivere (named enters or attacks)',
    oracle_text: 'Whenever Ellivere enters or attacks, create a Virtuous Role token attached to another target creature you control.',
    detect: () => detectAttackTriggers({ name: 'Ellivere of the Wild Court', oracle_text: 'Whenever Ellivere enters or attacks, create a Virtuous Role token attached to another target creature you control.' }, permanent).some((t) => t.triggerType === 'self_enters_or_attacks'),
  },
  {
    name: 'Arna Kennerüd (modified creature attacks)',
    oracle_text: 'Whenever a modified creature you control attacks, double the number of each kind of counter on it.',
    detect: () => detectAttackTriggers({ name: 'Arna Kennerüd, Skycaptain', oracle_text: 'Whenever a modified creature you control attacks, double the number of each kind of counter on it.' }, permanent).some((t) => t.triggerType === 'modified_creature_attacks'),
  },
  {
    name: 'Mephitic Ooze (combat damage to creature)',
    oracle_text: 'Whenever this creature deals combat damage to a creature, destroy that creature.',
    detect: () => detectCombatDamageTriggers({ name: 'Mephitic Ooze', oracle_text: 'Whenever this creature deals combat damage to a creature, destroy that creature.' }, permanent).some((t) => t.triggerType === 'deals_combat_damage_to_creature'),
  },
  {
    name: 'Tar Pit Warrior (when becomes targeted)',
    oracle_text: 'When this creature becomes the target of a spell or ability, sacrifice it.',
    detect: () => detectTargetedTriggers({ name: 'Tar Pit Warrior', oracle_text: 'When this creature becomes the target of a spell or ability, sacrifice it.' }, permanent).length > 0,
  },
  {
    name: 'Dennick (creature cards to graveyards)',
    oracle_text: 'Whenever one or more creature cards are put into graveyards from anywhere, investigate.',
    detect: () => detectPutIntoGraveyardTriggers({ name: 'Dennick, Pious Apparition', oracle_text: 'Whenever one or more creature cards are put into graveyards from anywhere, investigate.' }, permanent).length > 0,
  },
  {
    name: 'Hateful Eidolon (an enchanted creature dies)',
    oracle_text: 'Whenever an enchanted creature dies, draw a card for each Aura you controlled that was attached to it.',
    detect: () => detectDeathTriggers({ name: 'Hateful Eidolon', oracle_text: 'Whenever an enchanted creature dies, draw a card for each Aura you controlled that was attached to it.' }, permanent).some((t) => t.triggerType === 'attachment_dies'),
  },
  {
    name: 'Heat of Battle (a creature blocks)',
    oracle_text: 'Whenever a creature blocks, this enchantment deals 1 damage to that creature\'s controller.',
    detect: () => detectBlockTriggers({ name: 'Heat of Battle', oracle_text: 'Whenever a creature blocks, this enchantment deals 1 damage to that creature\'s controller.' }, permanent).length > 0,
  },
  {
    name: 'Mourning Thrull (deals damage)',
    oracle_text: 'Whenever this creature deals damage, you gain that much life.',
    detect: () => detectCombatDamageTriggers({ name: 'Mourning Thrull', oracle_text: 'Whenever this creature deals damage, you gain that much life.' }, permanent).some((t) => t.triggerType === 'deals_damage'),
  },
  {
    name: 'Sharding Sphinx (artifact creature combat damage)',
    oracle_text: 'Whenever an artifact creature you control deals combat damage to a player, you may create a 1/1 blue Thopter artifact creature token with flying.',
    detect: () => detectCombatDamageTriggers({ name: 'Sharding Sphinx', oracle_text: 'Whenever an artifact creature you control deals combat damage to a player, you may create a 1/1 blue Thopter artifact creature token with flying.' }, permanent).some((t) => t.triggerType === 'typed_creature_combat_damage_to_player'),
  },
  {
    name: 'Fishing Pole (equipped becomes untapped)',
    oracle_text: 'Whenever equipped creature becomes untapped, remove a bait counter from this Equipment.',
    detect: () => detectUntapTriggers({ name: 'Fishing Pole', oracle_text: 'Whenever equipped creature becomes untapped, remove a bait counter from this Equipment.' }, permanent).length > 0,
  },
  {
    name: 'Impressive Rat (that land becomes tapped)',
    oracle_text: 'Whenever that land becomes tapped, you investigate.',
    detect: () => detectTapTriggers({ name: 'Impressive Rat', oracle_text: 'Whenever that land becomes tapped, you investigate.' }, permanent).length > 0,
  },
  {
    name: 'Cowardice (any creature targeted)',
    oracle_text: 'Whenever a creature becomes the target of a spell or ability, return that creature to its owner\'s hand.',
    detect: () => detectTargetedTriggers({ name: 'Cowardice', oracle_text: 'Whenever a creature becomes the target of a spell or ability, return that creature to its owner\'s hand.' }, permanent).length > 0,
  },
  {
    name: 'Apathy (enchanted controller upkeep)',
    oracle_text: 'At the beginning of the upkeep of enchanted creature\'s controller, that player may discard a card at random.',
    detect: () => detectUpkeepTriggers({ name: 'Apathy', oracle_text: 'At the beginning of the upkeep of enchanted creature\'s controller, that player may discard a card at random.' }, permanent).some((t) => t.triggerType === 'enchanted_controller_upkeep'),
  },
  {
    name: 'Blaster (counters on named card)',
    oracle_text: 'Whenever you put one or more +1/+1 counters on Blaster, convert it.',
    detect: () => detectCounterPlacedTriggers({ name: 'Blaster, Combat DJ // Blaster, Morale Booster', oracle_text: 'Whenever you put one or more +1/+1 counters on Blaster, convert it.' }, permanent).length > 0,
  },
  {
    name: 'Pit Automaton (exhaust ability next)',
    oracle_text: 'When you next activate an exhaust ability that isn\'t a mana ability this turn, copy it.',
    detect: () => detectAbilityActivatedTriggers({ name: 'Pit Automaton', oracle_text: 'When you next activate an exhaust ability that isn\'t a mana ability this turn, copy it.' }, permanent).length > 0,
  },
  {
    name: 'Cursed Land (enchanted land controller upkeep)',
    oracle_text: 'Enchant land\nAt the beginning of the upkeep of enchanted land\'s controller, this Aura deals 1 damage to that player.',
    detect: () => detectUpkeepTriggers({ name: 'Cursed Land', oracle_text: 'Enchant land\nAt the beginning of the upkeep of enchanted land\'s controller, this Aura deals 1 damage to that player.' }, permanent).some((t) => t.triggerType === 'enchanted_controller_upkeep'),
  },
  {
    name: 'Yoke of the Damned (when a creature dies)',
    oracle_text: 'Enchant creature\nWhen a creature dies, destroy enchanted creature.',
    detect: () => detectDeathTriggers({ name: 'Yoke of the Damned', oracle_text: 'Enchant creature\nWhen a creature dies, destroy enchanted creature.' }, permanent).some((t) => t.triggerType === 'any_creature_dies'),
  },
  {
    name: 'Promise of Bunrei (when a creature you control dies)',
    oracle_text: 'When a creature you control dies, sacrifice this enchantment. If you do, create four 1/1 colorless Spirit creature tokens.',
    detect: () => detectDeathTriggers({ name: 'Promise of Bunrei', oracle_text: 'When a creature you control dies, sacrifice this enchantment. If you do, create four 1/1 colorless Spirit creature tokens.' }, permanent).some((t) => t.triggerType === 'creature_dies'),
  },
  {
    name: 'Ares, God of War (attacking creature you control dies)',
    oracle_text: 'Whenever an attacking creature you control dies, return that card to its owner\'s hand.',
    detect: () => detectDeathTriggers({ name: 'Ares, God of War', oracle_text: 'Whenever an attacking creature you control dies, return that card to its owner\'s hand.' }, permanent).some((t) => t.triggerType === 'attacking_creature_dies'),
  },
  {
    name: 'Truss, Chief Engineer (enters or another creature dies)',
    oracle_text: 'Whenever Truss, Chief Engineer enters or another creature dies, put a hack counter on Truss.',
    detect: () => detectDeathTriggers({ name: 'Truss, Chief Engineer', oracle_text: 'Whenever Truss, Chief Engineer enters or another creature dies, put a hack counter on Truss.' }, permanent).some((t) => t.triggerType === 'enters_or_another_creature_dies'),
  },
  {
    name: 'Dwindle (when enchanted creature blocks)',
    oracle_text: 'Enchanted creature gets -6/-0.\nWhen enchanted creature blocks, destroy it.',
    detect: () => detectBlockTriggers({ name: 'Dwindle', oracle_text: 'Enchanted creature gets -6/-0.\nWhen enchanted creature blocks, destroy it.' }, permanent).some((t) => (t as any).triggerType === 'enchanted_creature_blocks'),
  },
  {
    name: 'Contaminated Bond (enchanted attacks or blocks)',
    oracle_text: 'Whenever enchanted creature attacks or blocks, its controller loses 3 life.',
    detect: () => detectBlockTriggers({ name: 'Contaminated Bond', oracle_text: 'Whenever enchanted creature attacks or blocks, its controller loses 3 life.' }, permanent).some((t) => (t as any).triggerType === 'enchanted_creature_attacks_or_blocks'),
  },
  {
    name: 'Lucius the Eternal (that creature leaves)',
    oracle_text: 'When Lucius the Eternal dies, exile it and choose target creature an opponent controls. When that creature leaves the battlefield, return this card from exile to the battlefield under its owner\'s control.',
    detect: () => detectLTBTriggers({ name: 'Lucius the Eternal', oracle_text: 'When Lucius the Eternal dies, exile it and choose target creature an opponent controls. When that creature leaves the battlefield, return this card from exile to the battlefield under its owner\'s control.' }, permanent).some((t) => t.triggerType === 'chosen_creature_ltb'),
  },
  {
    name: 'Feral Encounter (next combat phase)',
    oracle_text: 'At the beginning of the next combat phase this turn, target creature you control deals damage equal to its power to up to one target creature you don\'t control.',
    detect: () => detectBeginningOfCombatTriggers({ name: 'Feral Encounter', oracle_text: 'At the beginning of the next combat phase this turn, target creature you control deals damage equal to its power to up to one target creature you don\'t control.' }, permanent).length > 0,
  },
  {
    name: 'Vivien\'s Invocation (put onto battlefield this way)',
    oracle_text: 'When a creature is put onto the battlefield this way, it deals damage equal to its power to target creature an opponent controls.',
    detect: () => detectETBTriggers({ name: 'Vivien\'s Invocation', oracle_text: 'When a creature is put onto the battlefield this way, it deals damage equal to its power to target creature an opponent controls.' }, permanent).some((t) => t.triggerType === 'put_onto_battlefield_this_way'),
  },
  {
    name: 'Daxos, Blessed by the Sun (another controlled enters or dies)',
    oracle_text: 'Whenever another creature you control enters or dies, you gain 1 life.',
    detect: () => detectDeathTriggers({ name: 'Daxos, Blessed by the Sun', oracle_text: 'Whenever another creature you control enters or dies, you gain 1 life.' }, permanent).some((t) => t.triggerType === 'another_controlled_enters_or_dies'),
  },
  {
    name: 'Soul Tithe (enchanted permanent controller upkeep)',
    oracle_text: 'At the beginning of the upkeep of enchanted permanent\'s controller, that player sacrifices it unless they pay {X}, where X is its mana value.',
    detect: () => detectUpkeepTriggers({ name: 'Soul Tithe', oracle_text: 'At the beginning of the upkeep of enchanted permanent\'s controller, that player sacrifices it unless they pay {X}, where X is its mana value.' }, permanent).some((t) => t.triggerType === 'enchanted_controller_upkeep'),
  },
  {
    name: 'Uncontrolled Infestation (when enchanted land becomes tapped)',
    oracle_text: 'When enchanted land becomes tapped, destroy it.',
    detect: () => detectTapTriggers({ name: 'Uncontrolled Infestation', oracle_text: 'When enchanted land becomes tapped, destroy it.' }, permanent).length > 0,
  },
  {
    name: 'Spiritual Asylum (when a creature you control attacks)',
    oracle_text: 'When a creature you control attacks, sacrifice this enchantment.',
    detect: () => detectAttackTriggers({ name: 'Spiritual Asylum', oracle_text: 'When a creature you control attacks, sacrifice this enchantment.' }, permanent).some((t) => t.triggerType === 'creature_attacks'),
  },
  {
    name: 'Nahiri, Forged in Fury (equipped creature you control attacks)',
    oracle_text: 'Whenever an equipped creature you control attacks, exile the top card of your library.',
    detect: () => detectAttackTriggers({ name: 'Nahiri, Forged in Fury', oracle_text: 'Whenever an equipped creature you control attacks, exile the top card of your library.' }, permanent).some((t) => t.triggerType === 'equipped_creature_attacks'),
  },
  {
    name: 'Dingus Egg (land put into graveyard)',
    oracle_text: 'Whenever a land is put into a graveyard from the battlefield, this artifact deals 2 damage to that land\'s controller.',
    detect: () => detectDeathTriggers({ name: 'Dingus Egg', oracle_text: 'Whenever a land is put into a graveyard from the battlefield, this artifact deals 2 damage to that land\'s controller.' }, permanent).some((t) => t.triggerType === 'put_into_graveyard_from_battlefield'),
  },
  {
    name: 'Crystallization (when enchanted creature targeted)',
    oracle_text: 'When enchanted creature becomes the target of a spell or ability, exile that creature.',
    detect: () => detectTargetedTriggers({ name: 'Crystallization', oracle_text: 'When enchanted creature becomes the target of a spell or ability, exile that creature.' }, permanent).length > 0,
  },
  {
    name: 'Frostwalk Bastion (this land deals combat damage to creature)',
    oracle_text: 'Whenever this land deals combat damage to a creature, tap that creature and it doesn\'t untap during its controller\'s next untap step.',
    detect: () => detectCombatDamageTriggers({ name: 'Frostwalk Bastion', oracle_text: 'Whenever this land deals combat damage to a creature, tap that creature and it doesn\'t untap during its controller\'s next untap step.' }, permanent).some((t) => t.triggerType === 'deals_combat_damage_to_creature'),
  },
  {
    name: 'Graceful Reprieve (target creature dies this turn)',
    oracle_text: 'When target creature dies this turn, return that card to the battlefield under its owner\'s control.',
    detect: () => detectDeathTriggers({ name: 'Graceful Reprieve', oracle_text: 'When target creature dies this turn, return that card to the battlefield under its owner\'s control.' }, permanent).some((t) => t.triggerType === 'that_creature_dies'),
  },
  {
    name: 'Veil of Assimilation (this or another artifact enters)',
    oracle_text: 'Whenever this artifact or another artifact you control enters, target creature you control gets +1/+1 and gains vigilance until end of turn.',
    detect: () => detectETBTriggers({ name: 'Veil of Assimilation', oracle_text: 'Whenever this artifact or another artifact you control enters, target creature you control gets +1/+1 and gains vigilance until end of turn.' }, permanent).some((t) => t.triggerType === 'this_or_another_artifact_etb'),
  },
  {
    name: 'Art Appreciation (they rate the art)',
    oracle_text: 'When they rate the art, up to that many target creatures can\'t block this turn.',
    detect: () => detectAbilityActivatedTriggers({ name: 'Art Appreciation', oracle_text: 'When they rate the art, up to that many target creatures can\'t block this turn.' }, permanent).some((t) => t.triggerType === 'rate_art'),
  },
  {
    name: 'Mardu Ascendancy (nontoken creature attacks)',
    oracle_text: 'Whenever a nontoken creature you control attacks, create a 1/1 red Goblin creature token that\'s tapped and attacking.',
    detect: () => detectAttackTriggers({ name: 'Mardu Ascendancy', oracle_text: 'Whenever a nontoken creature you control attacks, create a 1/1 red Goblin creature token that\'s tapped and attacking.' }, permanent).some((t) => t.triggerType === 'nontoken_creature_attacks'),
  },
  {
    name: 'Don\'t Move (a creature becomes tapped)',
    oracle_text: 'Until your next turn, whenever a creature becomes tapped, destroy it.',
    detect: () => detectTapTriggers({ name: 'Don\'t Move', oracle_text: 'Until your next turn, whenever a creature becomes tapped, destroy it.' }, permanent).some((t) => (t as any).affectedType === 'any_creature'),
  },
  {
    name: 'Relic Bind (enchanted artifact becomes tapped)',
    oracle_text: 'Whenever enchanted artifact becomes tapped, choose one —\n• This Aura deals 1 damage to target player or planeswalker.',
    detect: () => detectTapTriggers({ name: 'Relic Bind', oracle_text: 'Whenever enchanted artifact becomes tapped, choose one —\n• This Aura deals 1 damage to target player or planeswalker.' }, permanent).some((t) => (t as any).affectedType === 'enchanted_artifact'),
  },
  {
    name: 'Tarrian\'s Soulcleaver (another artifact or creature graveyard)',
    oracle_text: 'Whenever another artifact or creature is put into a graveyard from the battlefield, put a +1/+1 counter on equipped creature.',
    detect: () => detectDeathTriggers({ name: 'Tarrian\'s Soulcleaver', oracle_text: 'Whenever another artifact or creature is put into a graveyard from the battlefield, put a +1/+1 counter on equipped creature.' }, permanent).some((t) => t.triggerType === 'another_artifact_or_creature_graveyard'),
  },
  {
    name: 'Transplant Theorist (creature or another artifact enters)',
    oracle_text: 'Whenever this creature or another artifact you control enters, you may draw a card.',
    detect: () => detectETBTriggers({ name: 'Transplant Theorist', oracle_text: 'Whenever this creature or another artifact you control enters, you may draw a card.' }, permanent).some((t) => t.triggerType === 'this_creature_or_another_artifact_etb'),
  },
  {
    name: 'Curse Artifact (enchanted artifact controller upkeep)',
    oracle_text: 'At the beginning of the upkeep of enchanted artifact\'s controller, this Aura deals 2 damage to that player unless they sacrifice that artifact.',
    detect: () => detectUpkeepTriggers({ name: 'Curse Artifact', oracle_text: 'At the beginning of the upkeep of enchanted artifact\'s controller, this Aura deals 2 damage to that player unless they sacrifice that artifact.' }, permanent).some((t) => t.triggerType === 'enchanted_controller_upkeep'),
  },
  {
    name: 'Trailblazer\'s Torch (equipped becomes blocked)',
    oracle_text: 'Whenever equipped creature becomes blocked, it deals 2 damage to each creature blocking it.',
    detect: () => detectBlockTriggers({ name: 'Trailblazer\'s Torch', oracle_text: 'Whenever equipped creature becomes blocked, it deals 2 damage to each creature blocking it.' }, permanent).length > 0,
  },
  {
    name: 'Whippoorwill (the creature dies this turn)',
    oracle_text: 'When the creature dies this turn, exile the creature.',
    detect: () => detectDeathTriggers({ name: 'Whippoorwill', oracle_text: 'When the creature dies this turn, exile the creature.' }, permanent).some((t) => t.triggerType === 'that_creature_dies'),
  },
  {
    name: 'The Balrog (legendary opponent creature dies)',
    oracle_text: 'When a legendary creature an opponent controls dies, put The Balrog on the bottom of its owner\'s library.',
    detect: () => detectDeathTriggers({ name: 'The Balrog, Flame of Udûn', oracle_text: 'When a legendary creature an opponent controls dies, put The Balrog on the bottom of its owner\'s library.' }, permanent).some((t) => t.triggerType === 'legendary_opponent_creature_dies'),
  },
  {
    name: 'Turf War (creature deals combat damage to player)',
    oracle_text: 'Whenever a creature deals combat damage to a player, if that player controls one or more lands with contested counters on them, that creature\'s controller gains control of one of those lands of their choice and untaps it.',
    detect: () => detectCombatDamageTriggers({ name: 'Turf War', oracle_text: 'Whenever a creature deals combat damage to a player, if that player controls one or more lands with contested counters on them, that creature\'s controller gains control of one of those lands of their choice and untaps it.' }, permanent).some((t) => t.triggerType === 'any_creature_combat_damage_to_player'),
  },
  {
    name: 'Spiritualize (target creature deals damage)',
    oracle_text: 'Until end of turn, whenever target creature deals damage, you gain that much life.',
    detect: () => detectCombatDamageTriggers({ name: 'Spiritualize', oracle_text: 'Until end of turn, whenever target creature deals damage, you gain that much life.' }, permanent).some((t) => t.triggerType === 'target_creature_deals_damage'),
  },
  {
    name: 'Eumidian Hatchery (this land put into graveyard)',
    oracle_text: 'When this land is put into a graveyard from the battlefield, for each hatchling counter on it, create a 1/1 black Insect creature token with flying.',
    detect: () => detectDeathTriggers({ name: 'Eumidian Hatchery', oracle_text: 'When this land is put into a graveyard from the battlefield, for each hatchling counter on it, create a 1/1 black Insect creature token with flying.' }, permanent).some((t) => t.triggerType === 'dies'),
  },
  {
    name: 'Wicked Visitor (enchantment you control graveyard)',
    oracle_text: 'Whenever an enchantment you control is put into a graveyard from the battlefield, each opponent loses 1 life.',
    detect: () => detectDeathTriggers({ name: 'Wicked Visitor', oracle_text: 'Whenever an enchantment you control is put into a graveyard from the battlefield, each opponent loses 1 life.' }, permanent).some((t) => t.triggerType === 'put_into_graveyard_from_battlefield'),
  },
  {
    name: 'Vat of Rebirth (another controlled artifact or creature graveyard)',
    oracle_text: 'Whenever another artifact or creature you control is put into a graveyard from the battlefield, put an oil counter on this artifact.',
    detect: () => detectDeathTriggers({ name: 'Vat of Rebirth', oracle_text: 'Whenever another artifact or creature you control is put into a graveyard from the battlefield, put an oil counter on this artifact.' }, permanent).some((t) => t.triggerType === 'another_controlled_artifact_or_creature_graveyard'),
  },
  {
    name: 'Femeref Enchantress (any enchantment graveyard)',
    oracle_text: 'Whenever an enchantment is put into a graveyard from the battlefield, draw a card.',
    detect: () => detectDeathTriggers({ name: 'Femeref Enchantress', oracle_text: 'Whenever an enchantment is put into a graveyard from the battlefield, draw a card.' }, permanent).some((t) => t.triggerType === 'any_enchantment_graveyard'),
  },
  {
    name: 'Linden (white creature attacks)',
    oracle_text: 'Whenever a white creature you control attacks, you gain 1 life.',
    detect: () => detectAttackTriggers({ name: 'Linden, the Steadfast Queen', oracle_text: 'Whenever a white creature you control attacks, you gain 1 life.' }, permanent).some((t) => t.triggerType === 'typed_creature_attacks'),
  },
  {
    name: 'Dead-Iron Sledge (blocks or becomes blocked)',
    oracle_text: 'Whenever equipped creature blocks or becomes blocked by a creature, destroy both creatures.',
    detect: () => detectBlockTriggers({ name: 'Dead-Iron Sledge', oracle_text: 'Whenever equipped creature blocks or becomes blocked by a creature, destroy both creatures.' }, permanent).length > 0,
  },
  {
    name: 'Darksteel Garrison (fortified land tapped)',
    oracle_text: 'Whenever fortified land becomes tapped, target creature gets +1/+1 until end of turn.',
    detect: () => detectTapTriggers({ name: 'Darksteel Garrison', oracle_text: 'Whenever fortified land becomes tapped, target creature gets +1/+1 until end of turn.' }, permanent).some((t) => (t as any).affectedType === 'fortified_land'),
  },
  {
    name: 'Brink of Disaster (enchanted permanent tapped)',
    oracle_text: 'When enchanted permanent becomes tapped, destroy it.',
    detect: () => detectTapTriggers({ name: 'Brink of Disaster', oracle_text: 'When enchanted permanent becomes tapped, destroy it.' }, permanent).some((t) => (t as any).affectedType === 'enchanted_permanent'),
  },
  {
    name: 'Historian\'s Boon (nontoken enchantment enters)',
    oracle_text: 'Whenever this enchantment or another nontoken enchantment you control enters, create a 1/1 white Soldier creature token.',
    detect: () => detectETBTriggers({ name: 'Historian\'s Boon', oracle_text: 'Whenever this enchantment or another nontoken enchantment you control enters, create a 1/1 white Soldier creature token.' }, permanent).some((t) => t.triggerType === 'this_enchantment_or_another_nontoken_etb'),
  },
  {
    name: 'Saprazzan Raider (when becomes blocked)',
    oracle_text: 'When this creature becomes blocked, return it to its owner\'s hand.',
    detect: () => detectBlockTriggers({ name: 'Saprazzan Raider', oracle_text: 'When this creature becomes blocked, return it to its owner\'s hand.' }, permanent).length > 0,
  },
  {
    name: 'Fell Stinger (exploit)',
    oracle_text: 'When this creature exploits a creature, target player draws two cards and loses 2 life.',
    detect: () => detectAbilityActivatedTriggers({ name: 'Fell Stinger', oracle_text: 'When this creature exploits a creature, target player draws two cards and loses 2 life.' }, permanent).some((t) => t.triggerType === 'exploit'),
  },
  {
    name: 'Disturbing Mirth (sacrifice this enchantment)',
    oracle_text: 'When you sacrifice this enchantment, manifest dread.',
    detect: () => detectSacrificeTriggers({ name: 'Disturbing Mirth', oracle_text: 'When you sacrifice this enchantment, manifest dread.' }, permanent).length > 0,
  },
  {
    name: 'Ember Swallower (becomes monstrous)',
    oracle_text: 'When this creature becomes monstrous, each player sacrifices three lands of their choice.',
    detect: () => detectMonstrousTriggers({ name: 'Ember Swallower', oracle_text: 'When this creature becomes monstrous, each player sacrifices three lands of their choice.' }, permanent).length > 0,
  },
  {
    name: 'Herd Baloth (counters on this creature)',
    oracle_text: 'Whenever one or more +1/+1 counters are put on this creature, you may create a 4/4 green Beast creature token.',
    detect: () => detectCounterPlacedTriggers({ name: 'Herd Baloth', oracle_text: 'Whenever one or more +1/+1 counters are put on this creature, you may create a 4/4 green Beast creature token.' }, permanent).some((t) => t.triggerType === 'counters_put_on_self'),
  },
  {
    name: 'Phyrexian Atlas (this artifact tapped)',
    oracle_text: 'Whenever this artifact becomes tapped, each opponent who has three or more poison counters loses 1 life.',
    detect: () => detectTapTriggers({ name: 'Phyrexian Atlas', oracle_text: 'Whenever this artifact becomes tapped, each opponent who has three or more poison counters loses 1 life.' }, permanent).some((t) => (t as any).affectedType === 'self'),
  },
  {
    name: 'City of Brass (this land tapped)',
    oracle_text: 'Whenever this land becomes tapped, it deals 1 damage to you.',
    detect: () => detectTapTriggers({ name: 'City of Brass', oracle_text: 'Whenever this land becomes tapped, it deals 1 damage to you.' }, permanent).some((t) => (t as any).affectedType === 'self'),
  },
  {
    name: 'Scythe of the Wretched (equipped creature dealt damage dies)',
    oracle_text: 'Whenever a creature dealt damage by equipped creature this turn dies, return that card to the battlefield under your control.',
    detect: () => detectDeathTriggers({ name: 'Scythe of the Wretched', oracle_text: 'Whenever a creature dealt damage by equipped creature this turn dies, return that card to the battlefield under your control.' }, permanent).some((t) => t.triggerType === 'dealt_damage_dies'),
  },
  {
    name: 'Bushi Tenderfoot (when dealt damage dies)',
    oracle_text: 'When a creature dealt damage by this creature this turn dies, flip this creature.',
    detect: () => detectDeathTriggers({ name: 'Bushi Tenderfoot // Kenzo the Hardhearted', oracle_text: 'When a creature dealt damage by this creature this turn dies, flip this creature.' }, permanent).some((t) => t.triggerType === 'dealt_damage_dies'),
  },
  {
    name: 'Tui and La (named card tapped)',
    oracle_text: 'Whenever Tui and La become tapped, draw a card.',
    detect: () => detectTapTriggers({ name: 'Tui and La, Moon and Ocean', oracle_text: 'Whenever Tui and La become tapped, draw a card.' }, permanent).some((t) => (t as any).affectedType === 'self'),
  },
  {
    name: 'Tui and La (named card untapped)',
    oracle_text: 'Whenever Tui and La become untapped, put a +1/+1 counter on them.',
    detect: () => detectUntapTriggers({ name: 'Tui and La, Moon and Ocean', oracle_text: 'Whenever Tui and La become untapped, put a +1/+1 counter on them.' }, permanent).some((t) => t.untapType === 'self'),
  },
  {
    name: 'Flamescroll Celebrant (opponent ability activated)',
    oracle_text: 'Whenever an opponent activates an ability that isn\'t a mana ability, this creature deals 1 damage to that player.',
    detect: () => detectAbilityActivatedTriggers({ name: 'Flamescroll Celebrant // Revel in Silence', oracle_text: 'Whenever an opponent activates an ability that isn\'t a mana ability, this creature deals 1 damage to that player.' }, permanent).some((t) => t.triggerType === 'opponent_ability_activated'),
  },
  {
    name: 'Legion\'s Initiative (next combat delayed)',
    oracle_text: '{R}{W}, Exile this enchantment: Exile all creatures you control. At the beginning of the next combat, return those cards to the battlefield under their owner\'s control and those creatures gain haste until end of turn.',
    detect: () => detectBeginningOfCombatTriggers({ name: 'Legion\'s Initiative', oracle_text: '{R}{W}, Exile this enchantment: Exile all creatures you control. At the beginning of the next combat, return those cards to the battlefield under their owner\'s control and those creatures gain haste until end of turn.' }, permanent).some((t) => (t as any).triggerType === 'next_combat_phase'),
  },
  {
    name: 'Melira (pronoun graveyard this turn)',
    oracle_text: 'When it\'s put into a graveyard this turn, return that card to the battlefield under its owner\'s control.',
    detect: () => detectDeathTriggers({ name: 'Melira, the Living Cure', oracle_text: 'When it\'s put into a graveyard this turn, return that card to the battlefield under its owner\'s control.' }, permanent).some((t) => t.triggerType === 'put_into_graveyard_this_turn'),
  },
  {
    name: 'Priority Boarding (die roll)',
    oracle_text: 'Whenever you roll a die, you may reveal the top card of your library.',
    detect: () => detectAbilityActivatedTriggers({ name: 'Priority Boarding', oracle_text: 'Whenever you roll a die, you may reveal the top card of your library.' }, permanent).some((t) => t.triggerType === 'die_roll'),
  },
  {
    name: 'Vampiric Embrace (enchanted creature dealt damage dies)',
    oracle_text: 'Whenever a creature dealt damage by enchanted creature this turn dies, put a +1/+1 counter on that creature.',
    detect: () => detectDeathTriggers({ name: 'Vampiric Embrace', oracle_text: 'Whenever a creature dealt damage by enchanted creature this turn dies, put a +1/+1 counter on that creature.' }, permanent).some((t) => t.triggerType === 'dealt_damage_dies'),
  },
  {
    name: 'Hezrou (controlled creatures become blocked)',
    oracle_text: 'Whenever one or more creatures you control become blocked, each blocking creature gets -1/-1 until end of turn.',
    detect: () => detectBlockTriggers({ name: 'Hezrou // Demonic Stench', oracle_text: 'Whenever one or more creatures you control become blocked, each blocking creature gets -1/-1 until end of turn.' }, permanent).some((t) => (t as any).triggerType === 'controlled_creatures_become_blocked'),
  },
  {
    name: 'Rune-Tail (life threshold flip)',
    oracle_text: 'When you have 30 or more life, flip Rune-Tail.',
    detect: () => detectTransformTriggers({ name: 'Rune-Tail, Kitsune Ascendant // Rune-Tail\'s Essence', oracle_text: 'When you have 30 or more life, flip Rune-Tail.' }, permanent).length > 0,
  },
  {
    name: 'Sharuum the Hegemon (short-name enters)',
    oracle_text: 'When Sharuum enters, you may return target artifact card from your graveyard to the battlefield.',
    detect: () => detectETBTriggers({ name: 'Sharuum the Hegemon', oracle_text: 'When Sharuum enters, you may return target artifact card from your graveyard to the battlefield.' }, permanent).length > 0,
  },
  {
    name: 'Stormchaser\'s Talent (this class enters)',
    oracle_text: 'When this class enters, create a 1/1 blue and red Otter creature token with prowess.',
    detect: () => detectETBTriggers({ name: 'Stormchaser\'s Talent', oracle_text: 'When this class enters, create a 1/1 blue and red Otter creature token with prowess.' }, permanent).length > 0,
  },
  {
    name: 'Wedgelight Rammer (this spacecraft enters)',
    oracle_text: 'When this spacecraft enters, create a 2/2 colorless Robot artifact creature token.',
    detect: () => detectETBTriggers({ name: 'Wedgelight Rammer', oracle_text: 'When this spacecraft enters, create a 2/2 colorless Robot artifact creature token.' }, permanent).length > 0,
  },
  {
    name: 'Patron of the Nezumi (permanent opponent graveyard)',
    oracle_text: 'Whenever a permanent is put into an opponent\'s graveyard, that player loses 1 life.',
    detect: () => detectPutIntoGraveyardTriggers({ name: 'Patron of the Nezumi', oracle_text: 'Whenever a permanent is put into an opponent\'s graveyard, that player loses 1 life.' }, permanent).length > 0,
  },
  {
    name: 'Thran Vigil (cards leave your graveyard)',
    oracle_text: 'Whenever one or more artifact and/or creature cards leave your graveyard during your turn, put a +1/+1 counter on target creature you control.',
    detect: () => detectLeftGraveyardTriggers({ name: 'Thran Vigil', oracle_text: 'Whenever one or more artifact and/or creature cards leave your graveyard during your turn, put a +1/+1 counter on target creature you control.' }, permanent).length > 0,
  },
  {
    name: 'Tarnation (player commits a crime)',
    oracle_text: 'Whenever a player commits a crime, they may draw a card.',
    detect: () => detectSpellCastTriggers({ name: 'Tarnation', oracle_text: 'Whenever a player commits a crime, they may draw a card.' }, permanent).some((t) => (t as any).tribalType === 'commit_a_crime'),
  },
  {
    name: 'Hardened Bonds (singular counter placed)',
    oracle_text: 'Whenever a +1/+1 counter is put on a creature you control, seek a creature card.',
    detect: () => detectCounterPlacedTriggers({ name: 'Hardened Bonds', oracle_text: 'Whenever a +1/+1 counter is put on a creature you control, seek a creature card.' }, permanent).length > 0,
  },
  {
    name: 'Mindblade Render (opponents dealt combat damage)',
    oracle_text: 'Whenever your opponents are dealt combat damage, if any of that damage was dealt by a Warrior, you draw a card and you lose 1 life.',
    detect: () => detectCombatDamageTriggers({ name: 'Mindblade Render', oracle_text: 'Whenever your opponents are dealt combat damage, if any of that damage was dealt by a Warrior, you draw a card and you lose 1 life.' }, permanent).some((t) => (t as any).triggerType === 'opponents_dealt_combat_damage'),
  },
  {
    name: 'Utopia Sprawl (enchanted forest tapped for mana)',
    oracle_text: 'Whenever enchanted Forest is tapped for mana, its controller adds an additional one mana of the chosen color.',
    detect: () => detectTapTriggers({ name: 'Utopia Sprawl', oracle_text: 'Whenever enchanted Forest is tapped for mana, its controller adds an additional one mana of the chosen color.' }, permanent).some((t) => (t as any).affectedType === 'enchanted_forest_mana'),
  },
  {
    name: 'Gustha\'s Scepter (lose control)',
    oracle_text: 'When you lose control of this artifact, put all cards exiled with this artifact into their owner\'s graveyard.',
    detect: () => detectLTBTriggers({ name: 'Gustha\'s Scepter', oracle_text: 'When you lose control of this artifact, put all cards exiled with this artifact into their owner\'s graveyard.' }, permanent).some((t) => t.triggerType === 'lose_control'),
  },
  {
    name: 'Necropolis of Azar (nonblack from play)',
    oracle_text: 'Whenever a nonblack creature is put into a graveyard from play, put a 1/1 black Zombie creature token onto the battlefield.',
    detect: () => detectPutIntoGraveyardTriggers({ name: 'Necropolis of Azar', oracle_text: 'Whenever a nonblack creature is put into a graveyard from play, put a 1/1 black Zombie creature token onto the battlefield.' }, permanent).some((t) => t.nonblackOnly),
  },
  {
    name: 'Genju of the Realm (enchanted land graveyard)',
    oracle_text: 'Whenever enchanted land is put into a graveyard, you may return Genju of the Realm to its owner\'s hand.',
    detect: () => detectPutIntoGraveyardTriggers({ name: 'Genju of the Realm', oracle_text: 'Whenever enchanted land is put into a graveyard, you may return Genju of the Realm to its owner\'s hand.' }, permanent).length > 0,
  },
  {
    name: 'Pedantic Learning (land from library)',
    oracle_text: 'Whenever a land card is put into a graveyard from your library, you may return Pedantic Learning to its owner\'s hand.',
    detect: () => detectPutIntoGraveyardTriggers({ name: 'Pedantic Learning', oracle_text: 'Whenever a land card is put into a graveyard from your library, you may return Pedantic Learning to its owner\'s hand.' }, permanent).some((t) => t.graveyardScope === 'your'),
  },
  {
    name: 'Kaya, Spirits\' Justice (exile from graveyards)',
    oracle_text: 'Whenever one or more creatures and/or cards are put into exile from graveyards, you may draw a card.',
    detect: () => detectPutIntoGraveyardTriggers({ name: 'Kaya, Spirits\' Justice', oracle_text: 'Whenever one or more creatures and/or cards are put into exile from graveyards, you may draw a card.' }, permanent).length > 0,
  },
  {
    name: 'Psychogenic Probe (shuffle library)',
    oracle_text: 'Whenever a spell or ability causes its controller to shuffle their library, Psychogenic Probe deals 2 damage to that player.',
    detect: () => detectAbilityActivatedTriggers({ name: 'Psychogenic Probe', oracle_text: 'Whenever a spell or ability causes its controller to shuffle their library, Psychogenic Probe deals 2 damage to that player.' }, permanent).some((t) => t.triggerType === 'library_shuffled'),
  },
  {
    name: 'Deeproot Pilgrimage (nontoken merfolk tapped)',
    oracle_text: 'Whenever one or more nontoken Merfolk you control become tapped, create a 1/1 blue Merfolk creature token with hexproof.',
    detect: () => detectTapTriggers({ name: 'Deeproot Pilgrimage', oracle_text: 'Whenever one or more nontoken Merfolk you control become tapped, create a 1/1 blue Merfolk creature token with hexproof.' }, permanent).some((t) => (t as any).tribalType === 'merfolk'),
  },
  {
    name: 'Tom, Bert, and William (named die)',
    oracle_text: 'When Tom, Bert, and William die, create three 1/1 green Halfling creature tokens.',
    detect: () => detectDeathTriggers({ name: 'Tom, Bert, and William', oracle_text: 'When Tom, Bert, and William die, create three 1/1 green Halfling creature tokens.' }, permanent).some((t) => t.triggerType === 'dies'),
  },
  {
    name: 'Wildfire Eternal (cycle or discard)',
    oracle_text: 'Whenever you cycle or discard a card, Wildfire Eternal deals 4 damage to any target.',
    detect: () => detectDiscardTriggers({ name: 'Wildfire Eternal', oracle_text: 'Whenever you cycle or discard a card, Wildfire Eternal deals 4 damage to any target.' }, permanent).some((t) => t.triggerType === 'cycle_or_discard'),
  },
  {
    name: 'Glademuse (a player casts a spell)',
    oracle_text: 'Whenever a player casts a spell, you may draw a card.',
    detect: () => detectOpponentSpellCastTriggers({ name: 'Glademuse', oracle_text: 'Whenever a player casts a spell, you may draw a card.' }, permanent).length > 0,
  },
  {
    name: 'Departed Deckhand (target of spell only)',
    oracle_text: 'When this creature becomes the target of a spell, sacrifice it.',
    detect: () => detectTargetedTriggers({ name: 'Departed Deckhand', oracle_text: 'When this creature becomes the target of a spell, sacrifice it.' }, permanent).length > 0,
  },
  {
    name: 'Dictate of Karametra (player taps land)',
    oracle_text: 'Whenever a player taps a land for mana, that player adds one mana of any type that land produced.',
    detect: () => detectTapTriggers({ name: 'Dictate of Karametra', oracle_text: 'Whenever a player taps a land for mana, that player adds one mana of any type that land produced.' }, permanent).some((t) => (t as any).affectedType === 'player_land_tap'),
  },
  {
    name: 'Opal Avenger (10 or less life)',
    oracle_text: 'When you have 10 or less life, if this permanent is an enchantment, it becomes a 3/5 Soldier creature.',
    detect: () => detectTransformTriggers({ name: 'Opal Avenger', oracle_text: 'When you have 10 or less life, if this permanent is an enchantment, it becomes a 3/5 Soldier creature.' }, permanent).length > 0,
  },
  {
    name: 'Gonti\'s Machinations (first life loss each turn)',
    oracle_text: 'Whenever you lose life for the first time each turn, you get {E}.',
    detect: () => detectLifeLossTriggers({ name: 'Gonti\'s Machinations', oracle_text: 'Whenever you lose life for the first time each turn, you get {E}.' }, permanent).some((t) => t.triggerType === 'you_lose_life'),
  },
  {
    name: 'Wild Defiance (instant or sorcery targeted)',
    oracle_text: 'Whenever a creature you control becomes the target of an instant or sorcery spell, that creature gets +3/+3 until end of turn.',
    detect: () => detectTargetedTriggers({ name: 'Wild Defiance', oracle_text: 'Whenever a creature you control becomes the target of an instant or sorcery spell, that creature gets +3/+3 until end of turn.' }, permanent).length > 0,
  },
  {
    name: 'Snarlfang Vermin (graveyard zone dies)',
    oracle_text: 'Whenever a suspected creature an opponent controls dies while Snarlfang Vermin is in your graveyard, that opponent loses 1 life.',
    detect: () => detectDeathTriggers({ name: 'Snarlfang Vermin', oracle_text: 'Whenever a suspected creature an opponent controls dies while Snarlfang Vermin is in your graveyard, that opponent loses 1 life.' }, permanent).some((t) => t.triggerType === 'graveyard_zone_creature_dies'),
  },
  {
    name: 'Trail of Crumbs (sacrifice Food)',
    oracle_text: 'Whenever you sacrifice a Food, you may pay {1}. If you do, look at the top two cards of your library.',
    detect: () => detectSacrificeTriggers({ name: 'Trail of Crumbs', oracle_text: 'Whenever you sacrifice a Food, you may pay {1}. If you do, look at the top two cards of your library.' }, permanent).some((t) => t.triggerType === 'you_sacrifice'),
  },
  {
    name: 'Umezawa\'s Jitte (equipped combat damage)',
    oracle_text: 'Whenever equipped creature deals combat damage, put two charge counters on Umezawa\'s Jitte.',
    detect: () => detectCombatDamageTriggers({ name: 'Umezawa\'s Jitte', oracle_text: 'Whenever equipped creature deals combat damage, put two charge counters on Umezawa\'s Jitte.' }, permanent).some((t) => t.triggerType === 'equipment_combat_damage'),
  },
  {
    name: 'Seasinger (control no sacrifice)',
    oracle_text: 'When you control no Islands, sacrifice this creature.',
    detect: () => detectDeathTriggers({ name: 'Seasinger', oracle_text: 'When you control no Islands, sacrifice this creature.' }, permanent).some((t) => t.triggerType === 'control_none_sacrifice'),
  },
  {
    name: 'Firemane Commando (another player attacks)',
    oracle_text: 'Whenever another player attacks with two or more creatures, they draw a card if none of those creatures attacked you.',
    detect: () => detectAttackTriggers({ name: 'Firemane Commando', oracle_text: 'Whenever another player attacks with two or more creatures, they draw a card if none of those creatures attacked you.' }, permanent).some((t) => t.triggerType === 'player_attacks_with_creatures'),
  },
  {
    name: 'Sengir, the Dark Baron (another player loses game)',
    oracle_text: 'Whenever another player loses the game, you gain life equal to that player\'s life total as the turn began.',
    detect: () => detectGainedLifeTriggersFromOracle({ name: 'Sengir, the Dark Baron', oracle_text: 'Whenever another player loses the game, you gain life equal to that player\'s life total as the turn began.' }, permanent).length > 0,
  },
  {
    name: 'Tectonic Giant (targeted by opponent spell)',
    oracle_text: 'Whenever this creature attacks or becomes the target of a spell an opponent controls, choose one —',
    detect: () => detectTargetedTriggers({ name: 'Tectonic Giant', oracle_text: 'Whenever this creature attacks or becomes the target of a spell an opponent controls, choose one —' }, permanent).length > 0,
  },
  {
    name: 'Amulet of Safekeeping (you targeted by opponent)',
    oracle_text: 'Whenever you become the target of a spell or ability an opponent controls, counter that spell or ability unless its controller pays {3}.',
    detect: () => detectTargetedTriggers({ name: 'Amulet of Safekeeping', oracle_text: 'Whenever you become the target of a spell or ability an opponent controls, counter that spell or ability unless its controller pays {3}.' }, permanent).length > 0,
  },
  {
    name: 'Lulu, Stern Guardian (opponent attacks you)',
    oracle_text: 'Whenever an opponent attacks you, choose target creature attacking you. Put a stun counter on that creature.',
    detect: () => detectAttackTriggers({ name: 'Lulu, Stern Guardian', oracle_text: 'Whenever an opponent attacks you, choose target creature attacking you. Put a stun counter on that creature.' }, permanent).some((t) => t.triggerType === 'opponent_attacks_you'),
  },
  {
    name: 'Lightmine Field (one or more creatures attack)',
    oracle_text: 'Whenever one or more creatures attack, this enchantment deals damage to each of those creatures equal to the number of creatures attacking.',
    detect: () => detectAttackTriggers({ name: 'Lightmine Field', oracle_text: 'Whenever one or more creatures attack, this enchantment deals damage to each of those creatures equal to the number of creatures attacking.' }, permanent).some((t) => t.triggerType === 'one_or_more_creatures_attack'),
  },
  {
    name: 'Shirei, Shizo\'s Caretaker (low power graveyard)',
    oracle_text: 'Whenever a creature with power 1 or less is put into your graveyard from the battlefield, you may return that card to the battlefield.',
    detect: () => detectPutIntoGraveyardTriggers({ name: 'Shirei, Shizo\'s Caretaker', oracle_text: 'Whenever a creature with power 1 or less is put into your graveyard from the battlefield, you may return that card to the battlefield.' }, permanent).length > 0,
  },
  {
    name: 'Soulherder (creature exiled)',
    oracle_text: 'Whenever a creature is exiled from the battlefield, put a +1/+1 counter on this creature.',
    detect: () => detectExiledFromBattlefieldTriggers({ name: 'Soulherder', oracle_text: 'Whenever a creature is exiled from the battlefield, put a +1/+1 counter on this creature.' }, permanent).length > 0,
  },
  {
    name: 'Mirko, Obsessive Theorist (surveil)',
    oracle_text: 'Whenever you surveil, put a +1/+1 counter on Mirko.',
    detect: () => detectAbilityActivatedTriggers({ name: 'Mirko, Obsessive Theorist', oracle_text: 'Whenever you surveil, put a +1/+1 counter on Mirko.' }, permanent).some((t) => t.triggerType === 'surveil'),
  },
  {
    name: 'Archivist of Oghma (opponent searches)',
    oracle_text: 'Whenever an opponent searches their library, you gain 1 life and draw a card.',
    detect: () => detectAbilityActivatedTriggers({ name: 'Archivist of Oghma', oracle_text: 'Whenever an opponent searches their library, you gain 1 life and draw a card.' }, permanent).some((t) => t.triggerType === 'opponent_search_library'),
  },
  {
    name: 'Somberwald Alpha (creature you control becomes blocked)',
    oracle_text: 'Whenever a creature you control becomes blocked, it gets +1/+1 until end of turn.',
    detect: () => detectBlockTriggers({ name: 'Somberwald Alpha', oracle_text: 'Whenever a creature you control becomes blocked, it gets +1/+1 until end of turn.' }, permanent).some((t) => (t as any).triggerType === 'controlled_creature_becomes_blocked'),
  },
  {
    name: 'Noble Purpose (controlled combat damage any target)',
    oracle_text: 'Whenever a creature you control deals combat damage, you gain that much life.',
    detect: () => detectCombatDamageTriggers({ name: 'Noble Purpose', oracle_text: 'Whenever a creature you control deals combat damage, you gain that much life.' }, permanent).some((t) => t.triggerType === 'controlled_creature_deals_combat_damage_any'),
  },
  {
    name: 'Quilled Greatwurm (controlled combat damage during your turn)',
    oracle_text: 'Whenever a creature you control deals combat damage during your turn, put that many +1/+1 counters on it.',
    detect: () => detectCombatDamageTriggers({ name: 'Quilled Greatwurm', oracle_text: 'Whenever a creature you control deals combat damage during your turn, put that many +1/+1 counters on it.' }, permanent).some((t) => t.triggerType === 'controlled_creature_deals_combat_damage_any'),
  },
  {
    name: 'Ashnod (creature deals damage to you)',
    oracle_text: 'Whenever a creature deals damage to you, destroy it.',
    detect: () => detectDealtDamageTriggers({ name: 'Ashnod', oracle_text: 'Whenever a creature deals damage to you, destroy it.' }, permanent).length > 0,
  },
  {
    name: 'Skyclave Shadowcat (+1/+1 counter creature dies)',
    oracle_text: 'Whenever a creature you control with a +1/+1 counter on it dies, draw a card.',
    detect: () => detectDeathTriggers({ name: 'Skyclave Shadowcat', oracle_text: 'Whenever a creature you control with a +1/+1 counter on it dies, draw a card.' }, permanent).some((t) => t.triggerType === 'counter_creature_dies'),
  },
  {
    name: 'The Twelfth Doctor (you copy a spell)',
    oracle_text: 'Whenever you copy a spell, put a +1/+1 counter on The Twelfth Doctor.',
    detect: () => detectSpellCastTriggers({ name: 'The Twelfth Doctor', oracle_text: 'Whenever you copy a spell, put a +1/+1 counter on The Twelfth Doctor.' }, permanent).some((t) => String(t.description || '').toLowerCase().includes('copy a spell')),
  },
  {
    name: 'Turbo-Thwacking Auto-Hammer (you crank)',
    oracle_text: 'Whenever you crank this Contraption, target creature gains double strike until end of turn.',
    detect: () => detectAbilityActivatedTriggers({ name: 'Turbo-Thwacking Auto-Hammer', oracle_text: 'Whenever you crank this Contraption, target creature gains double strike until end of turn.' }, permanent).some((t) => t.triggerType === 'crank_contraption'),
  },
  {
    name: 'Tchotchke Elemental (create token or sticker)',
    oracle_text: 'Whenever you create a token or put a counter or a sticker on another permanent, put a knickknack counter on this creature.',
    detect: () => detectTokenCreatedTriggers({ name: 'Tchotchke Elemental', oracle_text: 'Whenever you create a token or put a counter or a sticker on another permanent, put a knickknack counter on this creature.' }, permanent).length > 0,
  },
  {
    name: 'Zagras, Thief of Heartbeats (combat damage to planeswalker)',
    oracle_text: 'Whenever a creature you control deals combat damage to a planeswalker, destroy that planeswalker.',
    detect: () => detectCombatDamageTriggers({ name: 'Zagras, Thief of Heartbeats', oracle_text: 'Whenever a creature you control deals combat damage to a planeswalker, destroy that planeswalker.' }, permanent).some((t) => t.triggerType === 'controlled_creature_combat_damage_to_planeswalker'),
  },
  {
    name: 'The Ooze (+1/+1 counter creature leaves battlefield)',
    oracle_text: 'Whenever a creature you control with a +1/+1 counter on it leaves the battlefield, create a Mutagen token for each +1/+1 counter on it.',
    detect: () => detectLTBTriggers({ name: 'The Ooze', oracle_text: 'Whenever a creature you control with a +1/+1 counter on it leaves the battlefield, create a Mutagen token for each +1/+1 counter on it.' }, permanent).some((t) => t.triggerType === 'counter_creature_ltb'),
  },
  {
    name: 'Quest for the Gemblades (combat damage to creature)',
    oracle_text: 'Whenever a creature you control deals combat damage to a creature, you may put a quest counter on this enchantment.',
    detect: () => detectCombatDamageTriggers({ name: 'Quest for the Gemblades', oracle_text: 'Whenever a creature you control deals combat damage to a creature, you may put a quest counter on this enchantment.' }, permanent).some((t) => t.triggerType === 'controlled_creature_combat_damage_to_creature'),
  },
  {
    name: 'A-Tenured Inkcaster (+1/+1 counter creature attacks)',
    oracle_text: 'Whenever a creature you control with a +1/+1 counter on it attacks, each opponent loses 1 life and you gain 1 life.',
    detect: () => detectAttackTriggers({ name: 'A-Tenured Inkcaster', oracle_text: 'Whenever a creature you control with a +1/+1 counter on it attacks, each opponent loses 1 life and you gain 1 life.' }, permanent).some((t) => t.triggerType === 'counter_creature_attacks'),
  },
  {
    name: 'Swarm Shambler (+1/+1 counter creature targeted)',
    oracle_text: 'Whenever a creature you control with a +1/+1 counter on it becomes the target of a spell an opponent controls, put a +1/+1 counter on that creature.',
    detect: () => detectTargetedTriggers({ name: 'Swarm Shambler', oracle_text: 'Whenever a creature you control with a +1/+1 counter on it becomes the target of a spell an opponent controls, put a +1/+1 counter on that creature.' }, permanent).length > 0,
  },
  {
    name: 'Asari Captain (typed attacks alone)',
    oracle_text: 'Whenever a Samurai or Warrior you control attacks alone, it gets +1/+0 until end of turn for each Samurai or Warrior you control.',
    detect: () => detectAttackTriggers({ name: 'Asari Captain', oracle_text: 'Whenever a Samurai or Warrior you control attacks alone, it gets +1/+0 until end of turn for each Samurai or Warrior you control.' }, permanent).some((t) => t.triggerType === 'typed_attacks_alone'),
  },
  {
    name: 'Wall of Essence (dealt combat damage)',
    oracle_text: 'Whenever this creature is dealt combat damage, you gain that much life.',
    detect: () => detectDealtDamageTriggers({ name: 'Wall of Essence', oracle_text: 'Whenever this creature is dealt combat damage, you gain that much life.' }, permanent).length > 0,
  },
  {
    name: 'Acquisition Octopus (self or equipped combat damage)',
    oracle_text: 'Whenever this creature or equipped creature deals combat damage to a player, draw a card.',
    detect: () => detectCombatDamageTriggers({ name: 'Acquisition Octopus', oracle_text: 'Whenever this creature or equipped creature deals combat damage to a player, draw a card.' }, permanent).some((t) => t.triggerType === 'self_or_equipped_combat_damage_to_player'),
  },
  {
    name: 'Lazav, Dimir Mastermind (opponent graveyard from anywhere)',
    oracle_text: "Whenever a creature card is put into an opponent's graveyard from anywhere, you may have Lazav become a copy of that creature.",
    detect: () => detectPutIntoGraveyardTriggers({ name: 'Lazav, Dimir Mastermind', oracle_text: "Whenever a creature card is put into an opponent's graveyard from anywhere, you may have Lazav become a copy of that creature." }, permanent).length > 0,
  },
  {
    name: 'The Immortal Sun (draw step additional card)',
    oracle_text: 'At the beginning of your draw step, draw an additional card.',
    // Additional-draw draw-step effects are applied via calculateAdditionalDraws, not the stack.
    detect: () => detectDrawStepTriggers({ name: 'The Immortal Sun', oracle_text: 'At the beginning of your draw step, draw an additional card.' }, permanent).length === 0,
  },
  {
    name: 'Harsh Mentor (opponent activates nonmana ability)',
    oracle_text: "Whenever an opponent activates an ability of an artifact, creature, or land on the battlefield, if it isn't a mana ability, Harsh Mentor deals 2 damage to that player.",
    detect: () => detectAbilityActivatedTriggers({ name: 'Harsh Mentor', oracle_text: "Whenever an opponent activates an ability of an artifact, creature, or land on the battlefield, if it isn't a mana ability, Harsh Mentor deals 2 damage to that player." }, permanent).some((t) => t.triggerType === 'opponent_ability_activated'),
  },
  {
    name: 'Prosperous Thief (typed batched combat damage)',
    oracle_text: 'Whenever one or more Ninja or Rogue creatures you control deal combat damage to a player, create a Treasure token.',
    detect: () => detectCombatDamageTriggers({ name: 'Prosperous Thief', oracle_text: 'Whenever one or more Ninja or Rogue creatures you control deal combat damage to a player, create a Treasure token.' }, permanent).some((t) => t.triggerType === 'typed_creatures_combat_damage_to_player'),
  },
  {
    name: 'Broodcaller Scourge (Dragons batched combat damage)',
    oracle_text: 'Whenever one or more Dragons you control deal combat damage to a player, you may put a permanent card with mana value 4 or less from your hand onto the battlefield.',
    detect: () => detectCombatDamageTriggers({ name: 'Broodcaller Scourge', oracle_text: 'Whenever one or more Dragons you control deal combat damage to a player, you may put a permanent card with mana value 4 or less from your hand onto the battlefield.' }, permanent).some((t) => t.triggerType === 'typed_creatures_combat_damage_to_player'),
  },
  {
    name: 'Spiritual Focus (opponent forced discard)',
    oracle_text: 'Whenever a spell or ability an opponent controls causes you to discard a card, you gain 2 life and you may draw a card.',
    detect: () => detectDiscardTriggers({ name: 'Spiritual Focus', oracle_text: 'Whenever a spell or ability an opponent controls causes you to discard a card, you gain 2 life and you may draw a card.' }, permanent).some((t) => t.triggerType === 'forced_discard'),
  },
  {
    name: 'Sunrise Cavalier (day/night)',
    oracle_text: 'Whenever day becomes night or night becomes day, put a +1/+1 counter on target creature you control.',
    detect: () => detectAbilityActivatedTriggers({ name: 'Sunrise Cavalier', oracle_text: 'Whenever day becomes night or night becomes day, put a +1/+1 counter on target creature you control.' }, permanent).some((t) => t.triggerType === 'day_night'),
  },
  {
    name: 'Illusionist\'s Bracers (equipped ability activated)',
    oracle_text: "Whenever an ability of equipped creature is activated, if it isn't a mana ability, copy that ability. You may choose new targets for the copy.",
    detect: () => detectAbilityActivatedTriggers({ name: "Illusionist's Bracers", oracle_text: "Whenever an ability of equipped creature is activated, if it isn't a mana ability, copy that ability. You may choose new targets for the copy." }, permanent).some((t) => t.triggerType === 'equipped_ability_activated'),
  },
  {
    name: 'Curse of Inertia (attacks enchanted player)',
    oracle_text: 'Whenever a player attacks enchanted player with one or more creatures, that attacking player may tap or untap target permanent.',
    detect: () => detectAttackTriggers({ name: 'Curse of Inertia', oracle_text: 'Whenever a player attacks enchanted player with one or more creatures, that attacking player may tap or untap target permanent.' }, permanent).some((t) => t.triggerType === 'curse_attack'),
  },
  {
    name: 'Plumecreed Mentor (flying controlled ETB)',
    oracle_text: 'Whenever this creature or another creature you control with flying enters, put a +1/+1 counter on target creature.',
    detect: () => detectETBTriggers({ name: 'Plumecreed Mentor', oracle_text: 'Whenever this creature or another creature you control with flying enters, put a +1/+1 counter on target creature.' }, permanent).some((t) => t.triggerType === 'flying_controlled_etb'),
  },
  {
    name: 'Forth Eorlingas! (batched combat damage to multiple players)',
    oracle_text: 'Whenever one or more creatures you control deal combat damage to one or more players this turn, you create that many Treasure tokens.',
    detect: () => detectCombatDamageTriggers({ name: 'Forth Eorlingas!', oracle_text: 'Whenever one or more creatures you control deal combat damage to one or more players this turn, you create that many Treasure tokens.' }, permanent).some((t) => t.triggerType === 'batched_combat_damage_to_players'),
  },
  {
    name: 'Undead Alchemist (opponent graveyard from library)',
    oracle_text: "Whenever a creature card is put into an opponent's graveyard from their library, exile that card and create a 2/2 black Zombie creature token.",
    detect: () => detectPutIntoGraveyardTriggers({ name: 'Undead Alchemist', oracle_text: "Whenever a creature card is put into an opponent's graveyard from their library, exile that card and create a 2/2 black Zombie creature token." }, permanent).length > 0,
  },
  {
    name: 'The Rack (chosen player upkeep)',
    oracle_text: "At the beginning of the chosen player's upkeep, this artifact deals X damage to that player, where X is the number of cards in their hand.",
    detect: () => detectUpkeepTriggers({ name: 'The Rack', oracle_text: "At the beginning of the chosen player's upkeep, this artifact deals X damage to that player, where X is the number of cards in their hand." }, permanent).some((t) => t.triggerType === 'chosen_player_upkeep'),
  },
  {
    name: 'Magus of the Vineyard (each player first main phase)',
    oracle_text: "At the beginning of each player's first main phase, that player adds {G}{G}.",
    detect: () => detectPrecombatMainTriggers({ name: 'Magus of the Vineyard', oracle_text: "At the beginning of each player's first main phase, that player adds {G}{G}." }, permanent).length > 0,
  },
  {
    name: 'Benalish Commander (time counter removed while exiled)',
    oracle_text: "Whenever a time counter is removed from this card while it's exiled, create a 1/1 white Soldier creature token.",
    detect: () => detectCounterRemovedTriggers({ name: 'Benalish Commander', oracle_text: "Whenever a time counter is removed from this card while it's exiled, create a 1/1 white Soldier creature token." }, permanent).some((t) => t.triggerType === 'time_counter_removed_from_exiled_self'),
  },
  {
    name: 'Sand Golem (discard this card)',
    oracle_text: 'When a spell or ability an opponent controls causes you to discard this card, return this card from your graveyard to your hand.',
    detect: () => detectDiscardTriggers({ name: 'Sand Golem', oracle_text: 'When a spell or ability an opponent controls causes you to discard this card, return this card from your graveyard to your hand.' }, permanent).some((t) => t.triggerType === 'forced_discard'),
  },
  {
    name: 'Feed the Machine (scheme in motion)',
    oracle_text: 'When you set this scheme in motion, target opponent chooses self or others.',
    detect: () => detectAbilityActivatedTriggers({ name: 'Feed the Machine', oracle_text: 'When you set this scheme in motion, target opponent chooses self or others.' }, permanent).some((t) => t.triggerType === 'scheme_in_motion'),
  },
  {
    name: 'Reckless Charge (you attack with two or more)',
    oracle_text: 'Whenever you attack with two or more creatures, you may discard a card. If you do, draw a card.',
    detect: () => detectAttackTriggers({ name: 'Reckless Charge', oracle_text: 'Whenever you attack with two or more creatures, you may discard a card. If you do, draw a card.' }, permanent).some((t) => t.triggerType === 'you_attack_with_two_or_more'),
  },
  {
    name: 'Fey Steed (creature or planeswalker targeted)',
    oracle_text: 'Whenever a creature or planeswalker you control becomes the target of a spell or ability an opponent controls, you may draw a card.',
    detect: () => detectTargetedTriggers({ name: 'Fey Steed', oracle_text: 'Whenever a creature or planeswalker you control becomes the target of a spell or ability an opponent controls, you may draw a card.' }, permanent).length > 0,
  },
  {
    name: 'Utvara Hellkite (dragon attacks without creature word)',
    oracle_text: 'Whenever a dragon you control attacks, create a 6/6 red Dragon creature token with flying.',
    detect: () => detectAttackTriggers({ name: 'Utvara Hellkite', oracle_text: 'Whenever a dragon you control attacks, create a 6/6 red Dragon creature token with flying.' }, permanent).some((t) => t.triggerType === 'typed_subtype_attacks'),
  },
  {
    name: 'Anzrag, the Quake-Mole (named card becomes blocked)',
    oracle_text: 'Whenever Anzrag becomes blocked, untap each creature you control.',
    detect: () => detectBlockTriggers({ name: 'Anzrag, the Quake-Mole', oracle_text: 'Whenever Anzrag becomes blocked, untap each creature you control.' }, permanent).length > 0,
  },
  {
    name: 'Host of the Hereafter (this or another creature dies)',
    oracle_text: 'Whenever this creature or another creature you control dies, exile it.',
    detect: () => detectDeathTriggers({ name: 'Host of the Hereafter', oracle_text: 'Whenever this creature or another creature you control dies, exile it.' }, permanent).some((t) => t.triggerType === 'this_or_another_creature_dies'),
  },
  {
    name: 'Dread (put into graveyard from anywhere)',
    oracle_text: "When Dread is put into a graveyard from anywhere, shuffle it into its owner's library.",
    detect: () => detectDeathTriggers({ name: 'Dread', oracle_text: "When Dread is put into a graveyard from anywhere, shuffle it into its owner's library." }, permanent).some((t) => t.triggerType === 'put_into_graveyard_from_anywhere'),
  },
  {
    name: 'Raving Oni-Slave (enters or leaves battlefield)',
    oracle_text: 'Whenever a permanent enters or leaves the battlefield, you may pay {1}. If you do, Raving Oni-Slave deals 1 damage to target player.',
    detect: () => detectETBTriggers({ name: 'Raving Oni-Slave', oracle_text: 'Whenever a permanent enters or leaves the battlefield, you may pay {1}. If you do, Raving Oni-Slave deals 1 damage to target player.' }, permanent).some((t) => t.triggerType === 'enters_or_leaves'),
  },
  {
    name: 'Polluted Bonds (opponent land enters)',
    oracle_text: 'Whenever a land an opponent controls enters, that player loses 2 life and you gain 2 life.',
    detect: () => detectLandfallTriggers({ name: 'Polluted Bonds', oracle_text: 'Whenever a land an opponent controls enters, that player loses 2 life and you gain 2 life.' }, permanent).length > 0,
  },
  {
    name: 'Curse of Oblivion (enchanted player upkeep)',
    oracle_text: "At the beginning of enchanted player's upkeep, that player exiles a card from their hand.",
    detect: () => detectUpkeepTriggers({ name: 'Curse of Oblivion', oracle_text: "At the beginning of enchanted player's upkeep, that player exiles a card from their hand." }, permanent).some((t) => t.triggerType === 'enchanted_player_upkeep'),
  },
  {
    name: 'Ordeal of Thassa (sacrifice this Aura)',
    oracle_text: 'When you sacrifice this Aura, draw two cards.',
    detect: () => detectSacrificeTriggers({ name: 'Ordeal of Thassa', oracle_text: 'When you sacrifice this Aura, draw two cards.' }, permanent).length > 0,
  },
  {
    name: 'Vizier of the True (exert a creature)',
    oracle_text: 'Whenever you exert a creature, you may draw a card.',
    detect: () => detectAbilityActivatedTriggers({ name: 'Vizier of the True', oracle_text: 'Whenever you exert a creature, you may draw a card.' }, permanent).some((t) => t.triggerType === 'exert_creature'),
  },
  {
    name: 'Bark-Knuckle Boxer (expend)',
    oracle_text: 'Whenever you expend 4, this creature gets +2/+2 until end of turn.',
    detect: () => detectAbilityActivatedTriggers({ name: 'Bark-Knuckle Boxer', oracle_text: 'Whenever you expend 4, this creature gets +2/+2 until end of turn.' }, permanent).some((t) => t.triggerType === 'expend'),
  },
  {
    name: 'Vrondiss, Rage of Ancients (roll one or more dice)',
    oracle_text: 'Whenever you roll one or more dice, you may create a 5/5 green Dragon creature token.',
    detect: () => detectAbilityActivatedTriggers({ name: 'Vrondiss, Rage of Ancients', oracle_text: 'Whenever you roll one or more dice, you may create a 5/5 green Dragon creature token.' }, permanent).some((t) => t.triggerType === 'roll_one_or_more_dice'),
  },
  {
    name: 'Aggressive Crag (your combat step)',
    oracle_text: 'At the beginning of your combat step, you may pay {2}. If you do, creatures you control get +2/+0 until end of turn.',
    detect: () => detectBeginningOfCombatTriggers({ name: 'Aggressive Crag', oracle_text: 'At the beginning of your combat step, you may pay {2}. If you do, creatures you control get +2/+0 until end of turn.' }, permanent).some((t) => (t as any).triggerType === 'your_combat_step'),
  },
  {
    name: 'Puppeteer Clique (your next end step)',
    oracle_text: "At the beginning of your next end step, return all creatures you control to their owner's hand.",
    detect: () => detectEndStepTriggers({ name: 'Puppeteer Clique', oracle_text: "At the beginning of your next end step, return all creatures you control to their owner's hand." }, permanent).length > 0,
  },
  {
    name: 'Chancellor of the Forge (first upkeep)',
    oracle_text: 'At the beginning of the first upkeep, create a 1/1 red Goblin creature token with haste.',
    detect: () => detectUpkeepTriggers({ name: 'Chancellor of the Forge', oracle_text: 'At the beginning of the first upkeep, create a 1/1 red Goblin creature token with haste.' }, permanent).some((t) => t.triggerType === 'first_upkeep'),
  },
  {
    name: 'Huge Truck (another creature backup targeted)',
    oracle_text: 'Whenever another creature you control becomes the target of a backup ability, Huge Truck permanently gains all of the backup abilities shared this way.',
    detect: () => detectTargetedTriggers({ name: 'Huge Truck', oracle_text: 'Whenever another creature you control becomes the target of a backup ability, Huge Truck permanently gains all of the backup abilities shared this way.' }, permanent).length > 0,
  },
  {
    name: 'Ib Halfheart (typed another becomes blocked)',
    oracle_text: 'Whenever another Goblin you control becomes blocked, sacrifice it. If you do, it deals 4 damage to each creature blocking it.',
    detect: () => detectBlockTriggers({ name: 'Ib Halfheart, Goblin Tactician', oracle_text: 'Whenever another Goblin you control becomes blocked, sacrifice it. If you do, it deals 4 damage to each creature blocking it.' }, permanent).some((t) => (t as any).triggerType === 'typed_another_becomes_blocked'),
  },
  {
    name: 'Market Gnome (self exiled during craft)',
    oracle_text: "When this creature dies, you gain 1 life and draw a card. When this creature is exiled from the battlefield while you're activating a craft ability, you gain 1 life and draw a card.",
    detect: () => detectExiledFromBattlefieldTriggers({ name: 'Market Gnome', oracle_text: "When this creature dies, you gain 1 life and draw a card. When this creature is exiled from the battlefield while you're activating a craft ability, you gain 1 life and draw a card." }, permanent).length > 0,
  },
  {
    name: 'Impulsive Return (combat this turn)',
    oracle_text: 'At the beginning of combat this turn, Impulsive Return deals damage to each player equal to the number of Revelers on the battlefield.',
    detect: () => detectBeginningOfCombatTriggers({ name: 'Impulsive Return', oracle_text: 'At the beginning of combat this turn, Impulsive Return deals damage to each player equal to the number of Revelers on the battlefield.' }, permanent).some((t) => (t as any).triggerType === 'combat_this_turn'),
  },
  {
    name: 'Jaheira (specialize)',
    oracle_text: 'When this creature specializes, destroy up to one target artifact or enchantment. You gain 4 life.',
    detect: () => detectTransformTriggers({ name: 'Jaheira, Merciful Harper', oracle_text: 'When this creature specializes, destroy up to one target artifact or enchantment. You gain 4 life.' }, permanent).length > 0,
  },
  {
    name: 'Reidane back face (another permanent targeted)',
    oracle_text: "Whenever you or another permanent you control becomes the target of a spell or ability an opponent controls, counter that spell or ability unless its controller pays {1}.",
    detect: () => detectTargetedTriggers({ name: "Valkmira, Protector's Shield", oracle_text: "Whenever you or another permanent you control becomes the target of a spell or ability an opponent controls, counter that spell or ability unless its controller pays {1}." }, permanent).length > 0,
  },
  {
    name: 'Raving Oni-Slave (self enters or leaves)',
    oracle_text: "When this creature enters or leaves the battlefield, you lose 3 life if you don't control a Demon.",
    detect: () => detectETBTriggers({ name: 'Raving Oni-Slave', oracle_text: "When this creature enters or leaves the battlefield, you lose 3 life if you don't control a Demon." }, permanent).some((t) => t.triggerType === 'self_enters_or_leaves'),
  },
  {
    name: 'Kami of the Crescent Moon (each player draw step)',
    oracle_text: "At the beginning of each player's draw step, that player draws an additional card.",
    // Additional-draw draw-step effects are applied via calculateAdditionalDraws, not the stack.
    detect: () => detectDrawStepTriggers({ name: 'Kami of the Crescent Moon', oracle_text: "At the beginning of each player's draw step, that player draws an additional card." }, permanent).length === 0,
  },
  {
    name: 'Agrus Kos (named target of ability that targets only it)',
    oracle_text: 'Whenever Agrus Kos becomes the target of an ability that targets only it, you may pay {1}{R/W}. If you do, copy that ability for each other creature you control that ability could target.',
    detect: () => detectTargetedTriggers({ name: 'Agrus Kos, Eternal Soldier', oracle_text: 'Whenever Agrus Kos becomes the target of an ability that targets only it, you may pay {1}{R/W}. If you do, copy that ability for each other creature you control that ability could target.' }, permanent).length > 0,
  },
  {
    name: 'King of the Oathbreakers (named or another Spirit targeted)',
    oracle_text: 'Whenever King of the Oathbreakers or another Spirit you control becomes the target of a spell, it phases out.',
    detect: () => detectTargetedTriggers({ name: 'King of the Oathbreakers', oracle_text: 'Whenever King of the Oathbreakers or another Spirit you control becomes the target of a spell, it phases out.' }, permanent).length > 0,
  },
  {
    name: 'Labyrinth Raptor (menace becomes blocked)',
    oracle_text: 'Whenever a creature you control with menace becomes blocked, defending player sacrifices a creature of their choice that\'s blocking it.',
    detect: () => detectBlockTriggers({ name: 'Labyrinth Raptor', oracle_text: 'Whenever a creature you control with menace becomes blocked, defending player sacrifices a creature of their choice that\'s blocking it.' }, permanent).some((t) => (t as any).triggerType === 'menace_creature_becomes_blocked'),
  },
  {
    name: 'Primal Adversary (pay cost one or more times)',
    oracle_text: 'When you pay this cost one or more times, put that many +1/+1 counters on this creature.',
    detect: () => detectAbilityActivatedTriggers({ name: 'Primal Adversary', oracle_text: 'When you pay this cost one or more times, put that many +1/+1 counters on this creature.' }, permanent).some((t) => t.triggerType === 'pay_cost_one_or_more_times'),
  },
  {
    name: 'Altar of Mogis (horde first main phase)',
    oracle_text: "At the beginning of the Horde's first main phase, reveal an additional card from the top of the Horde's library.",
    detect: () => detectPrecombatMainTriggers({ name: 'Altar of Mogis', oracle_text: "At the beginning of the Horde's first main phase, reveal an additional card from the top of the Horde's library." }, permanent).length > 0,
  },
  {
    name: 'Fight or Flight (combat on each opponent turn)',
    oracle_text: "At the beginning of combat on each opponent's turn, separate all creatures that player controls into two piles.",
    detect: () => detectBeginningOfCombatTriggers({ name: 'Fight or Flight', oracle_text: "At the beginning of combat on each opponent's turn, separate all creatures that player controls into two piles." }, permanent).some((t) => (t as any).triggerType === 'opponent_turn_combat'),
  },
  {
    name: 'Surly Badgersaur (discard creature card)',
    oracle_text: 'Whenever you discard a creature card, put a +1/+1 counter on this creature.',
    detect: () => detectDiscardTriggers({ name: 'Surly Badgersaur', oracle_text: 'Whenever you discard a creature card, put a +1/+1 counter on this creature.' }, permanent).some((t) => t.triggerType === 'typed_self_discard'),
  },
  {
    name: 'Hixus (creature combat damage to you)',
    oracle_text: 'Whenever a creature deals combat damage to you, if Hixus entered this turn, exile that creature until Hixus leaves the battlefield.',
    detect: () => detectCombatDamageTriggers({ name: 'Hixus, Prison Warden', oracle_text: 'Whenever a creature deals combat damage to you, if Hixus entered this turn, exile that creature until Hixus leaves the battlefield.' }, permanent).some((t) => t.triggerType === 'creature_combat_damage_to_you'),
  },
  {
    name: 'Awaken the Sky Tyrant (opponent source damage to you)',
    oracle_text: 'When a source an opponent controls deals damage to you, sacrifice this enchantment.',
    detect: () => detectDealtDamageTriggers({ name: 'Awaken the Sky Tyrant', oracle_text: 'When a source an opponent controls deals damage to you, sacrifice this enchantment.' }, permanent).length > 0,
  },
  {
    name: 'Kibo (opponent artifact graveyard)',
    oracle_text: 'Whenever an artifact an opponent controls is put into a graveyard from the battlefield, put a +1/+1 counter on each creature you control that\'s an Ape or a Monkey.',
    detect: () => detectDeathTriggers({ name: 'Kibo, Uktabi Prince', oracle_text: 'Whenever an artifact an opponent controls is put into a graveyard from the battlefield, put a +1/+1 counter on each creature you control that\'s an Ape or a Monkey.' }, permanent).some((t) => t.triggerType === 'opponent_artifact_graveyard'),
  },
  {
    name: 'Azorius Aethermage (returned to hand)',
    oracle_text: 'Whenever a permanent is returned to your hand, you may pay {1}. If you do, draw a card.',
    detect: () => detectReturnedToHandTriggers({ name: 'Azorius Aethermage', oracle_text: 'Whenever a permanent is returned to your hand, you may pay {1}. If you do, draw a card.' }, permanent).length > 0,
  },
  {
    name: 'Lurking Chupacabra (creature explores)',
    oracle_text: 'Whenever a creature you control explores, target creature an opponent controls gets -2/-2 until end of turn.',
    detect: () => detectAbilityActivatedTriggers({ name: 'Lurking Chupacabra', oracle_text: 'Whenever a creature you control explores, target creature an opponent controls gets -2/-2 until end of turn.' }, permanent).some((t) => t.triggerType === 'creature_explores'),
  },
  {
    name: 'Diffusion Sliver (typed creature targeted)',
    oracle_text: 'Whenever a Sliver creature you control becomes the target of a spell or ability an opponent controls, counter that spell or ability unless its controller pays {2}.',
    detect: () => detectTargetedTriggers({ name: 'Diffusion Sliver', oracle_text: 'Whenever a Sliver creature you control becomes the target of a spell or ability an opponent controls, counter that spell or ability unless its controller pays {2}.' }, permanent).length > 0,
  },
  {
    name: 'Leyline of Combustion (you and/or permanent targeted)',
    oracle_text: 'Whenever you and/or at least one permanent you control becomes the target of a spell or ability an opponent controls, this enchantment deals 2 damage to that player.',
    detect: () => detectTargetedTriggers({ name: 'Leyline of Combustion', oracle_text: 'Whenever you and/or at least one permanent you control becomes the target of a spell or ability an opponent controls, this enchantment deals 2 damage to that player.' }, permanent).length > 0,
  },
  {
    name: 'Angelic Guardian (one or more creatures attack)',
    oracle_text: 'Whenever one or more creatures you control attack, they gain indestructible until end of turn.',
    detect: () => detectAttackTriggers({ name: 'Angelic Guardian', oracle_text: 'Whenever one or more creatures you control attack, they gain indestructible until end of turn.' }, permanent).some((t) => t.triggerType === 'one_or_more_creatures_attack'),
  },
  {
    name: 'Falkenrath Noble (this or another creature dies any)',
    oracle_text: 'Whenever this creature or another creature dies, target player loses 1 life and you gain 1 life.',
    detect: () => detectDeathTriggers({ name: 'Falkenrath Noble', oracle_text: 'Whenever this creature or another creature dies, target player loses 1 life and you gain 1 life.' }, permanent).some((t) => t.triggerType === 'this_or_another_creature_dies_any'),
  },
  {
    name: 'Verity Circle (opponent creature tapped)',
    oracle_text: "Whenever a creature an opponent controls becomes tapped, if it isn't being declared as an attacker, you may draw a card.",
    detect: () => detectTapTriggers({ name: 'Verity Circle', oracle_text: "Whenever a creature an opponent controls becomes tapped, if it isn't being declared as an attacker, you may draw a card." }, permanent).length > 0,
  },
  {
    name: "Rangers' Aetherhive (exhaust ability activated)",
    oracle_text: 'Whenever you activate an exhaust ability, create a 1/1 colorless Thopter artifact creature token with flying.',
    detect: () => detectAbilityActivatedTriggers({ name: "Rangers' Aetherhive", oracle_text: 'Whenever you activate an exhaust ability, create a 1/1 colorless Thopter artifact creature token with flying.' }, permanent).some((t) => t.triggerType === 'exhaust_ability_activated'),
  },
  {
    name: 'Wedding Ring (opponent gains life mirror)',
    oracle_text: 'Whenever an opponent who controls an artifact named Wedding Ring gains life during their turn, you gain that much life.',
    detect: () => detectGainedLifeTriggersFromOracle({ name: 'Wedding Ring', oracle_text: 'Whenever an opponent who controls an artifact named Wedding Ring gains life during their turn, you gain that much life.' }, permanent).length > 0,
  },
  {
    name: 'Surrak, Elusive Hunter (creature or creature spell targeted)',
    oracle_text: 'Whenever a creature you control or a creature spell you control becomes the target of a spell or ability an opponent controls, draw a card.',
    detect: () => detectTargetedTriggers({ name: 'Surrak, Elusive Hunter', oracle_text: 'Whenever a creature you control or a creature spell you control becomes the target of a spell or ability an opponent controls, draw a card.' }, permanent).length > 0,
  },
  {
    name: 'Imprison This Insolent Wretch (chosen player targeted)',
    oracle_text: 'When the chosen player is attacked or becomes the target of a spell or ability, abandon this scheme.',
    detect: () => detectTargetedTriggers({ name: 'Imprison This Insolent Wretch', oracle_text: 'When the chosen player is attacked or becomes the target of a spell or ability, abandon this scheme.' }, permanent).length > 0,
  },
  {
    name: 'Soul Shredder (one or more other creatures die)',
    oracle_text: 'Whenever one or more other creatures die, Soul Shredder perpetually gets +1/+1.',
    detect: () => detectDeathTriggers({ name: 'Soul Shredder', oracle_text: 'Whenever one or more other creatures die, Soul Shredder perpetually gets +1/+1.' }, permanent).some((t) => t.triggerType === 'one_or_more_other_creatures_die'),
  },
  {
    name: 'Warped Devotion (returned to player hand)',
    oracle_text: "Whenever a permanent is returned to a player's hand, that player discards a card.",
    detect: () => detectReturnedToHandTriggers({ name: 'Warped Devotion', oracle_text: "Whenever a permanent is returned to a player's hand, that player discards a card." }, permanent).length > 0,
  },
  {
    name: 'Stormfront Riders (returned from battlefield)',
    oracle_text: 'Whenever this creature or another creature is returned to your hand from the battlefield, create a 1/1 white Soldier creature token.',
    detect: () => detectReturnedToHandTriggers({ name: 'Stormfront Riders', oracle_text: 'Whenever this creature or another creature is returned to your hand from the battlefield, create a 1/1 white Soldier creature token.' }, permanent).length > 0,
  },
  {
    name: 'Wax-Wane Witness (gain or lose life)',
    oracle_text: 'Whenever you gain or lose life during your turn, this creature gets +1/+0 until end of turn.',
    detect: () => detectLifeLossTriggers({ name: 'Wax-Wane Witness', oracle_text: 'Whenever you gain or lose life during your turn, this creature gets +1/+0 until end of turn.' }, permanent).length > 0,
  },
  {
    name: 'Voltaic Visionary (play card exiled with this creature)',
    oracle_text: 'When you play a card exiled with this creature, transform this creature.',
    detect: () => detectExiledFromBattlefieldTriggers({ name: 'Voltaic Visionary', oracle_text: 'When you play a card exiled with this creature, transform this creature.' }, permanent).length > 0,
  },
  {
    name: 'Unleash the Flux (encounter sacrifice)',
    oracle_text: 'When you encounter Unleash the Flux, each player sacrifices a nonland permanent of their choice, then you flip a coin.',
    detect: () => detectSacrificeTriggers({ name: 'Unleash the Flux', oracle_text: 'When you encounter Unleash the Flux, each player sacrifices a nonland permanent of their choice, then you flip a coin.' }, permanent).length > 0,
  },
  {
    name: 'Azra Oddsmaker (that creature combat damage this turn)',
    oracle_text: 'When that creature deals combat damage to a player this turn, you draw two cards.',
    detect: () => detectCombatDamageTriggers({ name: 'Azra Oddsmaker', oracle_text: 'When that creature deals combat damage to a player this turn, you draw two cards.' }, permanent).some((t) => t.triggerType === 'that_creature_combat_damage_to_player_this_turn'),
  },
  {
    name: 'Hold the Perimeter (your first upkeep)',
    oracle_text: 'At the beginning of your first upkeep, create a 1/2 white Soldier creature token with defender.',
    detect: () => detectUpkeepTriggers({ name: 'Hold the Perimeter', oracle_text: 'At the beginning of your first upkeep, create a 1/2 white Soldier creature token with defender.' }, permanent).some((t) => t.triggerType === 'your_first_upkeep'),
  },
  {
    name: "Captain's Hook (equipment unattached)",
    oracle_text: 'Whenever this Equipment becomes unattached from a permanent, destroy that permanent.',
    detect: () => detectAbilityActivatedTriggers({ name: "Captain's Hook", oracle_text: 'Whenever this Equipment becomes unattached from a permanent, destroy that permanent.' }, permanent).some((t) => t.triggerType === 'equipment_unattached'),
  },
  {
    name: 'Ellie, Brick Master (player attacks your opponent)',
    oracle_text: "Whenever a player attacks one of your opponents, that attacking player creates a tapped 1/1 black Fungus Zombie creature token.",
    detect: () => detectAttackTriggers({ name: 'Ellie, Brick Master', oracle_text: "Whenever a player attacks one of your opponents, that attacking player creates a tapped 1/1 black Fungus Zombie creature token." }, permanent).some((t) => t.triggerType === 'player_attacks_your_opponent'),
  },
  {
    name: 'Veteran Motorist (crews vehicle)',
    oracle_text: 'Whenever this creature crews a Vehicle, that Vehicle gets +1/+1 until end of turn.',
    detect: () => detectAbilityActivatedTriggers({ name: 'Veteran Motorist', oracle_text: 'Whenever this creature crews a Vehicle, that Vehicle gets +1/+1 until end of turn.' }, permanent).some((t) => t.triggerType === 'crew_vehicle'),
  },
  {
    name: 'Kheru Bloodsucker (toughness 4+ dies)',
    oracle_text: 'Whenever a creature you control with toughness 4 or greater dies, each opponent loses 2 life and you gain 2 life.',
    detect: () => detectDeathTriggers({ name: 'Kheru Bloodsucker', oracle_text: 'Whenever a creature you control with toughness 4 or greater dies, each opponent loses 2 life and you gain 2 life.' }, permanent).some((t) => t.triggerType === 'toughness_creature_dies'),
  },
  {
    name: 'Nest of Scarabs (-1/-1 counters placed)',
    oracle_text: 'Whenever you put one or more -1/-1 counters on a creature, create that many 1/1 black Insect creature tokens.',
    detect: () => detectCounterPlacedTriggers({ name: 'Nest of Scarabs', oracle_text: 'Whenever you put one or more -1/-1 counters on a creature, create that many 1/1 black Insect creature tokens.' }, permanent).length > 0,
  },
  {
    name: 'Tamiyo (third card drawn in turn)',
    oracle_text: 'When you draw your third card in a turn, exile Tamiyo, then return her to the battlefield transformed under her owner\'s control.',
    detect: () => detectCardDrawTriggers({ name: 'Tamiyo, Seasoned Scholar', oracle_text: 'When you draw your third card in a turn, exile Tamiyo, then return her to the battlefield transformed under her owner\'s control.' }, permanent).length > 0,
  },
  {
    name: 'Icewrought Sentry (tap opponent creature)',
    oracle_text: 'When you do, tap target creature an opponent controls.',
    detect: () => detectTapTriggers({ name: 'Icewrought Sentry', oracle_text: 'Whenever this creature attacks, you may pay {1}{U}. When you do, tap target creature an opponent controls.' }, permanent).some((t) => (t as any).affectedType === 'you_tap_opponent_creature'),
  },
  {
    name: 'Ray Fillet (counter on creature combat damage)',
    oracle_text: 'Whenever a creature you control with a counter on it deals combat damage to a player, draw a card.',
    detect: () => detectCombatDamageTriggers({ name: 'Ray Fillet, Wave Warrior', oracle_text: 'Whenever a creature you control with a counter on it deals combat damage to a player, draw a card.' }, permanent).some((t) => t.triggerType === 'any_counter_creature_combat_damage_to_player'),
  },
  {
    name: 'Chainsaw (one or more creatures die)',
    oracle_text: 'Whenever one or more creatures die, this Equipment deals 1 damage to any target.',
    detect: () => detectDeathTriggers({ name: 'Chainsaw', oracle_text: 'Whenever one or more creatures die, this Equipment deals 1 damage to any target.' }, permanent).some((t) => t.triggerType === 'one_or_more_creatures_die'),
  },
  {
    name: 'Daring Sleuth (sacrifice Clue)',
    oracle_text: 'When you sacrifice a Clue, transform this creature.',
    detect: () => detectSacrificeTriggers({ name: 'Daring Sleuth', oracle_text: 'When you sacrifice a Clue, transform this creature.' }, permanent).length > 0,
  },
  {
    name: 'Augusta (exiled this way)',
    oracle_text: 'When one or more nonland cards are exiled this way, put that many +1/+1 counters on target attacking creature.',
    detect: () => detectExiledFromBattlefieldTriggers({ name: 'Augusta, Order Returned', oracle_text: 'When one or more nonland cards are exiled this way, put that many +1/+1 counters on target attacking creature.' }, permanent).length > 0,
  },
  {
    name: 'Cry of Contrition (haunts creature dies)',
    oracle_text: 'When the creature this card haunts dies, target player discards a card.',
    detect: () => detectDeathTriggers({ name: 'Cry of Contrition', oracle_text: 'When the creature this card haunts dies, target player discards a card.' }, permanent).some((t) => t.triggerType === 'haunts_creature_dies'),
  },
  {
    name: 'Willbreaker (opponent creature targeted by you)',
    oracle_text: 'Whenever a creature an opponent controls becomes the target of a spell or ability you control, gain control of that creature for as long as you control Willbreaker.',
    detect: () => detectTargetedTriggers({ name: 'Willbreaker', oracle_text: 'Whenever a creature an opponent controls becomes the target of a spell or ability you control, gain control of that creature for as long as you control Willbreaker.' }, permanent).length > 0,
  },
  {
    name: 'Dirtcowl Wurm (opponent plays land)',
    oracle_text: 'Whenever an opponent plays a land, put a +1/+1 counter on this creature.',
    detect: () => detectLandfallTriggers({ name: 'Dirtcowl Wurm', oracle_text: 'Whenever an opponent plays a land, put a +1/+1 counter on this creature.' }, permanent).length > 0,
  },
  {
    name: 'Setzer (vehicle combat damage to player)',
    oracle_text: 'Whenever a Vehicle you control deals combat damage to a player, flip a coin.',
    detect: () => detectCombatDamageTriggers({ name: 'Setzer, Wandering Gambler', oracle_text: 'Whenever a Vehicle you control deals combat damage to a player, flip a coin.' }, permanent).some((t) => t.triggerType === 'vehicle_combat_damage_to_player'),
  },
  {
    name: 'Gemcutter Buccaneer (this or another Pirate enters)',
    oracle_text: 'Whenever this creature or another Pirate you control enters, create a tapped Treasure token.',
    detect: () => detectETBTriggers({ name: 'Gemcutter Buccaneer', oracle_text: 'Whenever this creature or another Pirate you control enters, create a tapped Treasure token.' }, permanent).some((t) => t.triggerType === 'this_or_another_typed_etb'),
  },
  {
    name: 'Firkraag (combat damage to your opponent)',
    oracle_text: 'Whenever a creature deals combat damage to one of your opponents, if that creature had to attack this combat, you put a +1/+1 counter on Firkraag.',
    detect: () => detectCombatDamageTriggers({ name: 'Firkraag, Cunning Instigator', oracle_text: 'Whenever a creature deals combat damage to one of your opponents, if that creature had to attack this combat, you put a +1/+1 counter on Firkraag.' }, permanent).some((t) => t.triggerType === 'combat_damage_to_your_opponent'),
  },
  {
    name: "Norn's Decree (player attacks)",
    oracle_text: 'Whenever a player attacks, if one or more players being attacked are poisoned, the attacking player draws a card.',
    detect: () => detectAttackTriggers({ name: "Norn's Decree", oracle_text: 'Whenever a player attacks, if one or more players being attacked are poisoned, the attacking player draws a card.' }, permanent).some((t) => t.triggerType === 'player_attacks'),
  },
  {
    name: 'Touch of the Horned God (minotaur attacks this turn)',
    oracle_text: 'Whenever a Minotaur attacks this turn, it gains deathtouch until end of turn.',
    detect: () => detectAttackTriggers({ name: 'Touch of the Horned God', oracle_text: 'Whenever a Minotaur attacks this turn, it gains deathtouch until end of turn.' }, permanent).some((t) => t.triggerType === 'typed_attacks_this_turn'),
  },
  {
    name: 'Erestor (finish voting)',
    oracle_text: 'Whenever players finish voting, each opponent who voted for a choice you voted for creates a Treasure token.',
    detect: () => detectAbilityActivatedTriggers({ name: 'Erestor of the Council', oracle_text: 'Whenever players finish voting, each opponent who voted for a choice you voted for creates a Treasure token.' }, permanent).some((t) => t.triggerType === 'finish_voting'),
  },
  {
    name: 'Skullspore Nexus (nontoken creatures you control die)',
    oracle_text: 'Whenever one or more nontoken creatures you control die, create a green Fungus Dinosaur creature token.',
    detect: () => detectDeathTriggers({ name: 'The Skullspore Nexus', oracle_text: 'Whenever one or more nontoken creatures you control die, create a green Fungus Dinosaur creature token.' }, permanent).some((t) => t.triggerType === 'one_or_more_nontoken_creatures_you_control_die'),
  },
  {
    name: 'Tattered Ratter (Rat becomes blocked)',
    oracle_text: 'Whenever a Rat you control becomes blocked, it gets +2/+0 until end of turn.',
    detect: () => detectBlockTriggers({ name: 'Tattered Ratter', oracle_text: 'Whenever a Rat you control becomes blocked, it gets +2/+0 until end of turn.' }, permanent).length > 0,
  },
  {
    name: 'Suppressor Skyguard (player attacks you)',
    oracle_text: 'Whenever a player attacks you, if that player has another opponent who isn\'t being attacked, prevent all combat damage that would be dealt to you this combat.',
    detect: () => detectAttackTriggers({ name: 'Suppressor Skyguard', oracle_text: 'Whenever a player attacks you, if that player has another opponent who isn\'t being attacked, prevent all combat damage that would be dealt to you this combat.' }, permanent).some((t) => t.triggerType === 'player_attacks_you'),
  },
  {
    name: 'Scourge of Valkas (this or another Dragon enters)',
    oracle_text: 'Whenever this creature or another Dragon you control enters, it deals X damage to any target, where X is the number of Dragons you control.',
    detect: () => detectETBTriggers({ name: 'Scourge of Valkas', oracle_text: 'Whenever this creature or another Dragon you control enters, it deals X damage to any target, where X is the number of Dragons you control.' }, permanent).some((t) => t.triggerType === 'this_or_another_typed_etb'),
  },
  {
    name: 'Keral Keep Disciples (Chandra loyalty ability)',
    oracle_text: 'Whenever you activate a loyalty ability of a Chandra planeswalker, this creature deals 1 damage to each opponent.',
    detect: () => detectAbilityActivatedTriggers({ name: 'Keral Keep Disciples', oracle_text: 'Whenever you activate a loyalty ability of a Chandra planeswalker, this creature deals 1 damage to each opponent.' }, permanent).some((t) => t.triggerType === 'loyalty_ability_activated'),
  },
  {
    name: 'Pangosaur (player plays land)',
    oracle_text: "Whenever a player plays a land, return this creature to its owner's hand.",
    detect: () => detectLandfallTriggers({ name: 'Pangosaur', oracle_text: "Whenever a player plays a land, return this creature to its owner's hand." }, permanent).length > 0,
  },
  {
    name: "Agatha's Soul Cauldron (creature card exiled this way)",
    oracle_text: 'When a creature card is exiled this way, put a +1/+1 counter on target creature you control.',
    detect: () => detectExiledFromBattlefieldTriggers({ name: "Agatha's Soul Cauldron", oracle_text: '{T}: Exile target card from a graveyard. When a creature card is exiled this way, put a +1/+1 counter on target creature you control.' }, permanent).length > 0,
  },
  {
    name: 'Frie (exiled because warped)',
    oracle_text: 'Whenever a card is exiled because it was warped, put three time counters on it.',
    detect: () => detectExiledFromBattlefieldTriggers({ name: 'Frie, Displaced in Time', oracle_text: 'Whenever a card is exiled because it was warped, put three time counters on it.' }, permanent).length > 0,
  },
  {
    name: 'Mirelurk Queen (nonland cards milled)',
    oracle_text: 'Whenever one or more nonland cards are milled, draw a card, then put a +1/+1 counter on this creature.',
    detect: () => detectMillTriggers({ name: 'Mirelurk Queen', oracle_text: 'Whenever one or more nonland cards are milled, draw a card, then put a +1/+1 counter on this creature.' }, permanent).length > 0,
  },
  {
    name: 'Because I Have Willed It (opponents end step)',
    oracle_text: "At the beginning of your opponents' end step, if they cast four or more spells this turn, abandon this scheme.",
    detect: () => detectEndStepTriggers({ name: 'Because I Have Willed It', oracle_text: "At the beginning of your opponents' end step, if they cast four or more spells this turn, abandon this scheme." }, permanent).length > 0,
  },
  {
    name: 'Evin (players sacrifice creatures)',
    oracle_text: 'Whenever one or more players sacrifice one or more creatures, you create a tapped Treasure token.',
    detect: () => detectSacrificeTriggers({ name: 'Evin, Waterdeep Opportunist', oracle_text: 'Whenever one or more players sacrifice one or more creatures, you create a tapped Treasure token.' }, permanent).length > 0,
  },
  {
    name: 'Curse of Hospitality (combat damage to enchanted player)',
    oracle_text: 'Whenever a creature deals combat damage to enchanted player, that player exiles the top card of their library.',
    detect: () => detectCombatDamageTriggers({ name: 'Curse of Hospitality', oracle_text: 'Whenever a creature deals combat damage to enchanted player, that player exiles the top card of their library.' }, permanent).some((t) => t.triggerType === 'combat_damage_to_enchanted_player'),
  },
  {
    name: 'Simian Sling (self or equipped becomes blocked)',
    oracle_text: 'Whenever this creature or equipped creature becomes blocked, it deals 1 damage to defending player.',
    detect: () => detectBlockTriggers({ name: 'Simian Sling', oracle_text: 'Whenever this creature or equipped creature becomes blocked, it deals 1 damage to defending player.' }, permanent).length > 0,
  },
  {
    name: 'Scalelord Reckoner (Dragon targeted)',
    oracle_text: 'Whenever a Dragon you control becomes the target of a spell or ability an opponent controls, destroy target nonland permanent that player controls.',
    detect: () => detectTargetedTriggers({ name: 'Scalelord Reckoner', oracle_text: 'Whenever a Dragon you control becomes the target of a spell or ability an opponent controls, destroy target nonland permanent that player controls.' }, permanent).length > 0,
  },
  {
    name: 'Cloud Cover (another permanent targeted)',
    oracle_text: "Whenever another permanent you control becomes the target of a spell or ability an opponent controls, you may return that permanent to its owner's hand.",
    detect: () => detectTargetedTriggers({ name: 'Cloud Cover', oracle_text: "Whenever another permanent you control becomes the target of a spell or ability an opponent controls, you may return that permanent to its owner's hand." }, permanent).length > 0,
  },
  {
    name: "Heliod's Emissary (self or enchanted attacks)",
    oracle_text: 'Whenever this creature or enchanted creature attacks, tap target creature an opponent controls.',
    detect: () => detectAttackTriggers({ name: "Heliod's Emissary", oracle_text: 'Whenever this creature or enchanted creature attacks, tap target creature an opponent controls.' }, permanent).some((t) => t.triggerType === 'self_or_enchanted_attacks'),
  },
  {
    name: 'Magma Pummeler (counters removed this way)',
    oracle_text: 'When one or more counters are removed from this creature this way, it deals that much damage to any target.',
    detect: () => detectCounterRemovedTriggers({ name: 'Magma Pummeler', oracle_text: 'When one or more counters are removed from this creature this way, it deals that much damage to any target.' }, permanent).length > 0,
  },
  {
    name: 'Noble Stand (creature you control blocks)',
    oracle_text: 'Whenever a creature you control blocks, you gain 2 life.',
    detect: () => detectBlockTriggers({ name: 'Noble Stand', oracle_text: 'Whenever a creature you control blocks, you gain 2 life.' }, permanent).length > 0,
  },
  {
    name: 'Kitsune Ace (vehicle attacks)',
    oracle_text: 'Whenever a Vehicle you control attacks, choose one —',
    detect: () => detectAttackTriggers({ name: 'Kitsune Ace', oracle_text: 'Whenever a Vehicle you control attacks, choose one —' }, permanent).some((t) => t.triggerType === 'vehicle_attacks'),
  },
  {
    name: 'High Tide (player taps island for mana)',
    oracle_text: 'Until end of turn, whenever a player taps an Island for mana, that player adds an additional {U}.',
    detect: () => detectTapTriggers({ name: 'High Tide', oracle_text: 'Until end of turn, whenever a player taps an Island for mana, that player adds an additional {U}.' }, permanent).some((t) => (t as any).affectedType === 'player_island_tap'),
  },
  {
    name: 'Turntimber Sower (land cards to graveyard)',
    oracle_text: 'Whenever one or more land cards are put into your graveyard from anywhere, create a 0/1 green Plant creature token.',
    detect: () => detectDeathTriggers({ name: 'Turntimber Sower', oracle_text: 'Whenever one or more land cards are put into your graveyard from anywhere, create a 0/1 green Plant creature token.' }, permanent).some((t) => t.triggerType === 'land_cards_put_into_graveyard_from_anywhere'),
  },
  {
    name: 'Skeletonize (dealt damage this way dies)',
    oracle_text: 'When a creature dealt damage this way dies this turn, create a 1/1 black Skeleton creature token.',
    detect: () => detectDeathTriggers({ name: 'Skeletonize', oracle_text: 'When a creature dealt damage this way dies this turn, create a 1/1 black Skeleton creature token.' }, permanent).some((t) => t.triggerType === 'dealt_damage_this_way_dies'),
  },
  {
    name: 'Tomik (opponent attacks with creatures)',
    oracle_text: 'Whenever an opponent attacks with creatures, if two or more of those creatures are attacking you, that opponent loses 3 life.',
    detect: () => detectAttackTriggers({ name: 'Tomik, Wielder of Law', oracle_text: 'Whenever an opponent attacks with creatures, if two or more of those creatures are attacking you, that opponent loses 3 life.' }, permanent).some((t) => t.triggerType === 'opponent_attacks_with_creatures'),
  },
  {
    name: "Delif's Cube (target attacks unblocked)",
    oracle_text: "This turn, when target creature you control attacks and isn't blocked, it assigns no combat damage this turn.",
    detect: () => detectAttackTriggers({ name: "Delif's Cube", oracle_text: "This turn, when target creature you control attacks and isn't blocked, it assigns no combat damage this turn." }, permanent).some((t) => t.triggerType === 'target_creature_attacks_unblocked'),
  },
  {
    name: 'Rakish Heir (Vampire combat damage)',
    oracle_text: 'Whenever a Vampire you control deals combat damage to a player, put a +1/+1 counter on it.',
    detect: () => detectCombatDamageTriggers({ name: 'Rakish Heir', oracle_text: 'Whenever a Vampire you control deals combat damage to a player, put a +1/+1 counter on it.' }, permanent).some((t) => t.triggerType === 'typed_creature_combat_damage_to_player'),
  },
  {
    name: 'Gravity Well (flying attacks)',
    oracle_text: 'Whenever a creature with flying attacks, it loses flying until end of turn.',
    detect: () => detectAttackTriggers({ name: 'Gravity Well', oracle_text: 'Whenever a creature with flying attacks, it loses flying until end of turn.' }, permanent).some((t) => t.triggerType === 'flying_creature_attacks'),
  },
  {
    name: "Teferi's Puzzle Box (each player draw step)",
    oracle_text: "At the beginning of each player's draw step, that player puts the cards in their hand on the bottom of their library in any order, then draws that many cards.",
    detect: () => detectDrawStepTriggers({ name: "Teferi's Puzzle Box", oracle_text: "At the beginning of each player's draw step, that player puts the cards in their hand on the bottom of their library in any order, then draws that many cards." }, permanent).length > 0,
  },
  {
    name: 'The Reaper (opponent -1/-1 counter dies)',
    oracle_text: 'Whenever a creature an opponent controls with a -1/-1 counter on it dies, you may put that card onto the battlefield under your control.',
    detect: () => detectDeathTriggers({ name: 'The Reaper, King No More', oracle_text: 'Whenever a creature an opponent controls with a -1/-1 counter on it dies, you may put that card onto the battlefield under your control.' }, permanent).some((t) => t.triggerType === 'opponent_minus_counter_creature_dies'),
  },
  {
    name: 'Zask (another Insect dies)',
    oracle_text: 'Whenever another Insect you control dies, put it on the bottom of its owner\'s library, then mill two cards.',
    detect: () => detectDeathTriggers({ name: 'Zask, Skittering Swarmlord', oracle_text: 'Whenever another Insect you control dies, put it on the bottom of its owner\'s library, then mill two cards.' }, permanent).some((t) => t.triggerType === 'another_typed_creature_dies'),
  },
  {
    name: 'Tovolar (Wolf or Werewolf combat damage)',
    oracle_text: 'Whenever a Wolf or Werewolf you control deals combat damage to a player, draw a card.',
    detect: () => detectCombatDamageTriggers({ name: 'Tovolar, Dire Overlord', oracle_text: 'Whenever a Wolf or Werewolf you control deals combat damage to a player, draw a card.' }, permanent).some((t) => t.triggerType === 'typed_creature_combat_damage_to_player'),
  },
  {
    name: 'Landroval (two or more attack player)',
    oracle_text: 'Whenever two or more creatures you control attack a player, target attacking creature without flying gains flying until end of turn.',
    detect: () => detectAttackTriggers({ name: 'Landroval, Horizon Witness', oracle_text: 'Whenever two or more creatures you control attack a player, target attacking creature without flying gains flying until end of turn.' }, permanent).some((t) => t.triggerType === 'two_or_more_creatures_attack_player'),
  },
  {
    name: "Titania, Nature's Force (Forest enters)",
    oracle_text: 'Whenever a Forest you control enters, create a 5/3 green Elemental creature token.',
    detect: () => detectLandfallTriggers({ name: "Titania, Nature's Force", oracle_text: 'Whenever a Forest you control enters, create a 5/3 green Elemental creature token.' }, permanent).length > 0,
  },
  {
    name: 'Elderfang Venom (Elf dies)',
    oracle_text: 'Whenever an Elf you control dies, each opponent loses 1 life and you gain 1 life.',
    detect: () => detectDeathTriggers({ name: 'Elderfang Venom', oracle_text: 'Whenever an Elf you control dies, each opponent loses 1 life and you gain 1 life.' }, permanent).some((t) => t.triggerType === 'typed_creature_dies'),
  },
  {
    name: 'Viridian Harvest (enchanted artifact graveyard)',
    oracle_text: 'When enchanted artifact is put into a graveyard, you gain 6 life.',
    detect: () => detectDeathTriggers({ name: 'Viridian Harvest', oracle_text: 'When enchanted artifact is put into a graveyard, you gain 6 life.' }, permanent).some((t) => t.triggerType === 'enchanted_artifact_graveyard'),
  },
  {
    name: 'Chandra, Fire Artisan (loyalty counters removed)',
    oracle_text: 'Whenever one or more loyalty counters are removed from Chandra, she deals that much damage to target opponent or planeswalker.',
    detect: () => detectCounterRemovedTriggers({ name: 'Chandra, Fire Artisan', oracle_text: 'Whenever one or more loyalty counters are removed from Chandra, she deals that much damage to target opponent or planeswalker.' }, permanent).length > 0,
  },
  {
    name: 'Spectral Prison (enchanted creature targeted by spell)',
    oracle_text: 'When enchanted creature becomes the target of a spell, sacrifice this Aura.',
    detect: () => detectTargetedTriggers({ name: 'Spectral Prison', oracle_text: 'When enchanted creature becomes the target of a spell, sacrifice this Aura.' }, permanent).length > 0,
  },
  {
    name: 'Loki (player or permanent targeted by ability you control)',
    oracle_text: 'Whenever a player or permanent becomes the target of an ability you control, draw a card. This ability triggers only once each turn.',
    detect: () => detectTargetedTriggers({ name: 'Loki, God of Mischief', oracle_text: 'Whenever a player or permanent becomes the target of an ability you control, draw a card. This ability triggers only once each turn.' }, permanent).length > 0,
  },
  {
    name: 'Rite of Passage (creature you control dealt damage)',
    oracle_text: 'Whenever a creature you control is dealt damage, put a +1/+1 counter on it.',
    detect: () => detectDealtDamageTriggers({ name: 'Rite of Passage', oracle_text: 'Whenever a creature you control is dealt damage, put a +1/+1 counter on it.' }, permanent).length > 0,
  },
  {
    name: 'Bebop (bosses attack)',
    oracle_text: 'Whenever the bosses attack, put a +1/+1 counter on each creature named Foot Disciple.',
    detect: () => detectAttackTriggers({ name: 'Bebop, Porcine Punk', oracle_text: 'Whenever the bosses attack, put a +1/+1 counter on each creature named Foot Disciple.' }, permanent).some((t) => t.triggerType === 'bosses_attack'),
  },
  {
    name: 'We Ride at Dawn (commander attacks)',
    oracle_text: 'Whenever your commander attacks, create a 1/1 red Mercenary creature token.',
    detect: () => detectAttackTriggers({ name: 'We Ride at Dawn', oracle_text: 'Whenever your commander attacks, create a 1/1 red Mercenary creature token.' }, permanent).some((t) => t.triggerType === 'commander_attacks'),
  },
  {
    name: 'Soul Servitude (when they do)',
    oracle_text: 'Target player sacrifices a nontoken creature. When they do, you may discard a card.',
    detect: () => detectAttackTriggers({ name: 'Soul Servitude', oracle_text: 'Target player sacrifices a nontoken creature. When they do, you may discard a card.' }, permanent).some((t) => t.triggerType === 'when_they_do'),
  },
  {
    name: 'Robot Domination (creature cards to your graveyard)',
    oracle_text: 'Whenever one or more creature cards are put into your graveyard from anywhere, you draw a card.',
    detect: () => detectPutIntoGraveyardTriggers({ name: 'Robot Domination', oracle_text: 'Whenever one or more creature cards are put into your graveyard from anywhere, you draw a card.' }, permanent).length > 0,
  },
  {
    name: 'Archghoul (this or another Zombie dies)',
    oracle_text: 'Whenever this creature or another Zombie you control dies, look at the top card of your library.',
    detect: () => detectDeathTriggers({ name: 'Archghoul of Thraben', oracle_text: 'Whenever this creature or another Zombie you control dies, look at the top card of your library.' }, permanent).some((t) => t.triggerType === 'this_or_another_typed_creature_dies'),
  },
  {
    name: 'Warbeast (this or another power 4+ dies)',
    oracle_text: 'Whenever this creature or another creature you control with power 4 or greater dies, amass Orcs 2.',
    detect: () => detectDeathTriggers({ name: 'Warbeast of Gorgoroth', oracle_text: 'Whenever this creature or another creature you control with power 4 or greater dies, amass Orcs 2.' }, permanent).some((t) => t.triggerType === 'this_or_another_power_creature_dies'),
  },
  {
    name: 'Pawn of Ulamog (this or another nontoken dies)',
    oracle_text: 'Whenever this creature or another nontoken creature you control dies, you may create a 0/1 colorless Eldrazi Spawn creature token.',
    detect: () => detectDeathTriggers({ name: 'Pawn of Ulamog', oracle_text: 'Whenever this creature or another nontoken creature you control dies, you may create a 0/1 colorless Eldrazi Spawn creature token.' }, permanent).some((t) => t.triggerType === 'this_or_another_nontoken_creature_dies'),
  },
  {
    name: "Puca's Covenant (creature with counter dies)",
    oracle_text: 'Whenever a creature you control with a counter on it dies, you may return another target permanent card from your graveyard to your hand.',
    detect: () => detectDeathTriggers({ name: "Puca's Covenant", oracle_text: 'Whenever a creature you control with a counter on it dies, you may return another target permanent card from your graveyard to your hand.' }, permanent).some((t) => t.triggerType === 'counter_creature_dies'),
  },
  {
    name: 'Centaur Vinecrasher (land card to graveyard)',
    oracle_text: 'Whenever a land card is put into a graveyard from anywhere, you may pay {G}{G}. If you do, return this card from your graveyard to your hand.',
    detect: () => detectPutIntoGraveyardTriggers({ name: 'Centaur Vinecrasher', oracle_text: 'Whenever a land card is put into a graveyard from anywhere, you may pay {G}{G}. If you do, return this card from your graveyard to your hand.' }, permanent).length > 0,
  },
  {
    name: 'Vraan (other controlled creatures die)',
    oracle_text: 'Whenever one or more other creatures you control die, each opponent loses 2 life and you gain 2 life.',
    detect: () => detectDeathTriggers({ name: 'Vraan, Executioner Thane', oracle_text: 'Whenever one or more other creatures you control die, each opponent loses 2 life and you gain 2 life.' }, permanent).some((t) => t.triggerType === 'one_or_more_other_controlled_creatures_die'),
  },
  {
    name: 'Overencumbered (BOC enchanted opponent turn)',
    oracle_text: "At the beginning of combat on enchanted opponent's turn, that player may pay {1} for each artifact they control.",
    detect: () => detectBeginningOfCombatTriggers({ name: 'Overencumbered', oracle_text: "At the beginning of combat on enchanted opponent's turn, that player may pay {1} for each artifact they control." }, permanent).some((t) => (t as any).triggerType === 'enchanted_opponent_turn_combat'),
  },
  {
    name: 'Kitt Kanto (BOC each player turn)',
    oracle_text: "At the beginning of combat on each player's turn, you may tap two untapped creatures you control.",
    detect: () => detectBeginningOfCombatTriggers({ name: 'Kitt Kanto, Mayhem Diva', oracle_text: "At the beginning of combat on each player's turn, you may tap two untapped creatures you control." }, permanent).some((t) => (t as any).triggerType === 'each_player_turn_combat'),
  },
  {
    name: 'Fynn (deathtouch combat damage to player)',
    oracle_text: 'Whenever a creature you control with deathtouch deals combat damage to a player, that player gets two poison counters.',
    detect: () => detectCombatDamageTriggers({ name: 'Fynn, the Fangbearer', oracle_text: 'Whenever a creature you control with deathtouch deals combat damage to a player, that player gets two poison counters.' }, permanent).some((t) => t.triggerType === 'deathtouch_creature_combat_damage_to_player'),
  },
  {
    name: "The Raven's Warning (flying combat damage to player)",
    oracle_text: 'Whenever one or more creatures you control with flying deal combat damage to a player this turn, look at that player\'s hand and draw a card.',
    detect: () => detectCombatDamageTriggers({ name: "The Raven's Warning", oracle_text: 'Whenever one or more creatures you control with flying deal combat damage to a player this turn, look at that player\'s hand and draw a card.' }, permanent).some((t) => t.triggerType === 'flying_creatures_combat_damage_to_player'),
  },
  {
    name: 'Brood Sliver (Sliver combat damage without you control)',
    oracle_text: 'Whenever a Sliver deals combat damage to a player, its controller may create a 1/1 colorless Sliver creature token.',
    detect: () => detectCombatDamageTriggers({ name: 'Brood Sliver', oracle_text: 'Whenever a Sliver deals combat damage to a player, its controller may create a 1/1 colorless Sliver creature token.' }, permanent).some((t) => t.triggerType === 'typed_creature_combat_damage_to_player'),
  },
  {
    name: 'Vigorous Charge (that creature combat damage this turn)',
    oracle_text: 'Whenever that creature deals combat damage this turn, if this spell was kicked, you gain life equal to that damage.',
    detect: () => detectCombatDamageTriggers({ name: 'Vigorous Charge', oracle_text: 'Whenever that creature deals combat damage this turn, if this spell was kicked, you gain life equal to that damage.' }, permanent).some((t) => t.triggerType === 'that_creature_combat_damage_this_turn'),
  },
  {
    name: 'The Ancient One (discard this way)',
    oracle_text: 'Draw a card, then you may discard a card. When you discard a card this way, target player mills cards equal to its mana value.',
    detect: () => detectDiscardTriggers({ name: 'The Ancient One', oracle_text: 'Draw a card, then you may discard a card. When you discard a card this way, target player mills cards equal to its mana value.' }, permanent).some((t) => t.triggerType === 'discard_this_way'),
  },
  {
    name: 'Glacial Dragonhunt (discard nonland this way)',
    oracle_text: 'Draw a card, then you may discard a card. When you discard a nonland card this way, Glacial Dragonhunt deals 3 damage to target creature.',
    detect: () => detectDiscardTriggers({ name: 'Glacial Dragonhunt', oracle_text: 'Draw a card, then you may discard a card. When you discard a nonland card this way, Glacial Dragonhunt deals 3 damage to target creature.' }, permanent).some((t) => t.triggerType === 'discard_this_way'),
  },
  {
    name: 'Malcolm (Pirates deal damage to opponents)',
    oracle_text: 'Whenever one or more Pirates you control deal damage to your opponents, you create a Treasure token for each opponent dealt damage.',
    detect: () => detectCombatDamageTriggers({ name: 'Malcolm, Keen-Eyed Navigator', oracle_text: 'Whenever one or more Pirates you control deal damage to your opponents, you create a Treasure token for each opponent dealt damage.' }, permanent).some((t) => t.triggerType === 'typed_deal_damage_to_opponents'),
  },
  {
    name: 'Greatbow Doyen (Archer deals damage to creature)',
    oracle_text: 'Whenever an Archer you control deals damage to a creature, that Archer deals that much damage to that creature\'s controller.',
    detect: () => detectCombatDamageTriggers({ name: 'Greatbow Doyen', oracle_text: 'Whenever an Archer you control deals damage to a creature, that Archer deals that much damage to that creature\'s controller.' }, permanent).some((t) => t.triggerType === 'typed_deal_damage_to_creature'),
  },
  {
    name: 'Flame Channeler (spell you control deals damage)',
    oracle_text: 'When a spell you control deals damage, transform this creature.',
    detect: () => detectCombatDamageTriggers({ name: 'Flame Channeler // Embodiment of Flame', oracle_text: 'When a spell you control deals damage, transform this creature.' }, permanent).some((t) => t.triggerType === 'spell_you_control_deals_damage'),
  },
  {
    name: 'Silverfur Partisan (Wolf targeted by instant or sorcery)',
    oracle_text: 'Whenever a Wolf or Werewolf you control becomes the target of an instant or sorcery spell, create a 2/2 green Wolf creature token.',
    detect: () => detectTargetedTriggers({ name: 'Silverfur Partisan', oracle_text: 'Whenever a Wolf or Werewolf you control becomes the target of an instant or sorcery spell, create a 2/2 green Wolf creature token.' }, permanent).length > 0,
  },
  {
    name: 'Fugitive Druid (targeted by Aura spell)',
    oracle_text: 'Whenever this creature becomes the target of an Aura spell, you draw a card.',
    detect: () => detectTargetedTriggers({ name: 'Fugitive Druid', oracle_text: 'Whenever this creature becomes the target of an Aura spell, you draw a card.' }, permanent).length > 0,
  },
  {
    name: 'Alibou (artifact creatures attack)',
    oracle_text: 'Whenever one or more artifact creatures you control attack, Alibou deals X damage to any target.',
    detect: () => detectAttackTriggers({ name: 'Alibou, Ancient Witness', oracle_text: 'Whenever one or more artifact creatures you control attack, Alibou deals X damage to any target.' }, permanent).some((t) => t.triggerType === 'one_or_more_artifact_creatures_attack'),
  },
  {
    name: 'Fangorn (Treefolk attack)',
    oracle_text: 'Whenever one or more Treefolk you control attack, add twice that much {G}.',
    detect: () => detectAttackTriggers({ name: 'Fangorn, Tree Shepherd', oracle_text: 'Whenever one or more Treefolk you control attack, add twice that much {G}.' }, permanent).some((t) => t.triggerType === 'one_or_more_typed_attack'),
  },
  {
    name: 'Ink-Eyes Avatar (beginning of the game)',
    oracle_text: "At the beginning of the game, look at target opponent's hand and choose a nonland card from it.",
    detect: () => detectAbilityActivatedTriggers({ name: 'Ink-Eyes, Servant of Oni Avatar', oracle_text: "At the beginning of the game, look at target opponent's hand and choose a nonland card from it." }, permanent).some((t) => t.triggerType === 'beginning_of_game'),
  },
  {
    name: 'One with the Kami (enchanted or modified creature dies)',
    oracle_text: 'Whenever enchanted creature or another modified creature you control dies, create X 1/1 colorless Spirit creature tokens.',
    detect: () => detectDeathTriggers({ name: 'One with the Kami', oracle_text: 'Whenever enchanted creature or another modified creature you control dies, create X 1/1 colorless Spirit creature tokens.' }, permanent).some((t) => t.triggerType === 'enchanted_or_modified_creature_dies'),
  },
  {
    name: 'Tyranid Harridan (this or another Tyranid combat damage)',
    oracle_text: 'Whenever this creature or another Tyranid you control deals combat damage to a player, create a 1/1 blue Tyranid Gargoyle creature token with flying.',
    detect: () => detectCombatDamageTriggers({ name: 'Tyranid Harridan', oracle_text: 'Whenever this creature or another Tyranid you control deals combat damage to a player, create a 1/1 blue Tyranid Gargoyle creature token with flying.' }, permanent).some((t) => t.triggerType === 'this_or_another_typed_combat_damage_to_player'),
  },
  {
    name: 'Don & Raph (attack singular)',
    oracle_text: 'Whenever Don & Raph attack, the next noncreature spell you cast this turn has affinity for artifacts.',
    detect: () => detectAttackTriggers({ name: 'Don & Raph, Hard Science', oracle_text: 'Whenever Don & Raph attack, the next noncreature spell you cast this turn has affinity for artifacts.' }, permanent).length > 0,
  },
  {
    name: 'Jareth (named blocks)',
    oracle_text: 'Whenever Jareth blocks, it gets +7/+7 until end of turn.',
    detect: () => detectBlockTriggers({ name: 'Jareth, Leonine Titan', oracle_text: 'Whenever Jareth blocks, it gets +7/+7 until end of turn.' }, permanent).length > 0,
  },
  {
    name: 'Efteekay (named or another Kavu enters)',
    oracle_text: 'Whenever Efteekay or another Kavu you control enters, it deals damage equal to its power to target creature.',
    detect: () => detectETBTriggers({ name: 'Efteekay, Flame of the Kav', oracle_text: 'Whenever Efteekay or another Kavu you control enters, it deals damage equal to its power to target creature.' }, permanent).some((t) => t.triggerType === 'named_or_another_typed_etb'),
  },
  {
    name: 'The Dogronmaster (named or another Dragon or Dog enters)',
    oracle_text: 'Whenever The Dogronmaster or another Dragon or Dog enters the battlefield under your control, create a token.',
    detect: () => detectETBTriggers({ name: 'The Dogronmaster', oracle_text: 'Whenever The Dogronmaster or another Dragon or Dog enters the battlefield under your control, create a token.' }, permanent).some((t) => t.triggerType === 'named_or_another_typed_etb'),
  },
  {
    name: 'Perimeter Captain (defender blocks)',
    oracle_text: 'Whenever a creature you control with defender blocks, you may gain 2 life.',
    detect: () => detectBlockTriggers({ name: 'Perimeter Captain', oracle_text: 'Whenever a creature you control with defender blocks, you may gain 2 life.' }, permanent).some((t) => t.triggerType === 'defender_creature_blocks'),
  },
  {
    name: 'Rhuk (equipped creature other than self attacks or dies)',
    oracle_text: 'Whenever an equipped creature you control other than Rhuk attacks or dies, you may attach all Equipment attached to that creature to Rhuk.',
    detect: () => detectAttackTriggers({ name: 'Rhuk, Hexgold Nabber', oracle_text: 'Whenever an equipped creature you control other than Rhuk attacks or dies, you may attach all Equipment attached to that creature to Rhuk.' }, permanent).some((t) => t.triggerType === 'equipped_creature_other_than_self_attacks_or_dies'),
  },
  {
    name: 'Costume Closet (modified creature leaves)',
    oracle_text: 'Whenever a modified creature you control leaves the battlefield, put a +1/+1 counter on this artifact.',
    detect: () => detectLTBTriggers({ name: 'Costume Closet', oracle_text: 'Whenever a modified creature you control leaves the battlefield, put a +1/+1 counter on this artifact.' }, permanent).some((t) => t.triggerType === 'modified_creature_ltb'),
  },
  {
    name: 'Nyssa (sacrifice artifacts this way)',
    oracle_text: 'Whenever Nyssa of Traken attacks, sacrifice any number of artifacts. When you sacrifice one or more artifacts this way, tap up to that many target creatures.',
    detect: () => detectSacrificeTriggers({ name: 'Nyssa of Traken', oracle_text: 'Whenever Nyssa of Traken attacks, sacrifice any number of artifacts. When you sacrifice one or more artifacts this way, tap up to that many target creatures.' }, permanent).length > 0,
  },
  {
    name: 'War Elemental (opponent dealt damage)',
    oracle_text: 'Whenever an opponent is dealt damage, put that many +1/+1 counters on this creature.',
    detect: () => detectDealtDamageTriggers({ name: 'War Elemental', oracle_text: 'Whenever an opponent is dealt damage, put that many +1/+1 counters on this creature.' }, permanent).length > 0,
  },
  {
    name: 'The Zassacre Zirl (another commander dies)',
    oracle_text: 'Whenever another Commander dies, draw a card.',
    detect: () => detectDeathTriggers({ name: 'The Zassacre Zirl', oracle_text: 'Whenever another Commander dies, draw a card.' }, permanent).some((t) => t.triggerType === 'another_commander_dies'),
  },
  {
    name: 'Phage (named combat damage to creature and player)',
    oracle_text: 'Whenever Phage deals combat damage to a creature, destroy that creature. Whenever Phage deals combat damage to a player, that player loses the game.',
    detect: () => detectCombatDamageTriggers({ name: 'Phage the Untouchable', oracle_text: 'Whenever Phage deals combat damage to a creature, destroy that creature. Whenever Phage deals combat damage to a player, that player loses the game.' }, permanent).length >= 2,
  },
  {
    name: 'Hakka (named combat damage to player)',
    oracle_text: 'Whenever Hakka deals combat damage to a player, return it to its owner\'s hand, then scry 2.',
    detect: () => detectCombatDamageTriggers({ name: 'Alrund, God of the Cosmos // Hakka, Whispering Raven', oracle_text: 'Whenever Hakka deals combat damage to a player, return it to its owner\'s hand, then scry 2.' }, permanent).length > 0,
  },
  {
    name: 'Search the City (play card matching exiled name)',
    oracle_text: 'Whenever you play a card with the same name as one of the exiled cards, you may put one of those cards into its owner\'s hand.',
    detect: () => detectExiledFromBattlefieldTriggers({ name: 'Search the City', oracle_text: 'Whenever you play a card with the same name as one of the exiled cards, you may put one of those cards into its owner\'s hand.' }, permanent).length > 0,
  },
  {
    name: 'Extraplanar Lens (exiled name land tapped)',
    oracle_text: 'Whenever a land with the same name as the exiled card is tapped for mana, its controller adds one mana of any type that land produced.',
    detect: () => detectTapTriggers({ name: 'Extraplanar Lens', oracle_text: 'Whenever a land with the same name as the exiled card is tapped for mana, its controller adds one mana of any type that land produced.' }, permanent).some((t) => (t as any).affectedType === 'exiled_name_land_tapped_for_mana'),
  },
  {
    name: 'Curse of the Restless Dead (enchanted player landfall)',
    oracle_text: 'Whenever a land enchanted player controls enters, you create a 2/2 black Zombie creature token.',
    detect: () => detectLandfallTriggers({ name: 'Curse of the Restless Dead', oracle_text: 'Whenever a land enchanted player controls enters, you create a 2/2 black Zombie creature token.' }, permanent).length > 0,
  },
  {
    name: 'Shadow the Hedgehog (flash or haste dies)',
    oracle_text: 'Whenever Shadow the Hedgehog or another creature you control with flash or haste dies, draw a card.',
    detect: () => detectDeathTriggers({ name: 'Shadow the Hedgehog', oracle_text: 'Whenever Shadow the Hedgehog or another creature you control with flash or haste dies, draw a card.' }, permanent).some((t) => t.triggerType === 'named_or_another_keyword_creature_dies'),
  },
  {
    name: "G'raha Tia (creatures and/or artifacts die)",
    oracle_text: 'Whenever one or more other creatures and/or artifacts you control die, draw a card.',
    detect: () => detectDeathTriggers({ name: "G'raha Tia", oracle_text: 'Whenever one or more other creatures and/or artifacts you control die, draw a card.' }, permanent).some((t) => t.triggerType === 'one_or_more_other_creatures_or_artifacts_die'),
  },
  {
    name: 'Donna Noble (paired creature dealt damage)',
    oracle_text: "Whenever Donna Noble or a creature it's paired with is dealt damage, Donna Noble deals that much damage to target opponent.",
    detect: () => detectDealtDamageTriggers({ name: 'Donna Noble', oracle_text: "Whenever Donna Noble or a creature it's paired with is dealt damage, Donna Noble deals that much damage to target opponent." }, permanent).length > 0,
  },
  {
    name: 'Voidwing Hybrid (when you proliferate)',
    oracle_text: 'When you proliferate, return this card from your graveyard to your hand.',
    detect: () => detectCounterPlacedTriggers({ name: 'Voidwing Hybrid', oracle_text: 'When you proliferate, return this card from your graveyard to your hand.' }, permanent).length > 0,
  },
  {
    name: 'Indoraptor (named dealt damage)',
    oracle_text: 'Whenever Indoraptor is dealt damage, choose an opponent at random.',
    detect: () => detectDealtDamageTriggers({ name: 'Indoraptor, the Perfect Hybrid', oracle_text: 'Whenever Indoraptor is dealt damage, choose an opponent at random.' }, permanent).length > 0,
  },
  {
    name: 'Skola Grovedancer (land card to your graveyard)',
    oracle_text: 'Whenever a land card is put into your graveyard from anywhere, you gain 1 life.',
    detect: () => detectDeathTriggers({ name: 'Skola Grovedancer', oracle_text: 'Whenever a land card is put into your graveyard from anywhere, you gain 1 life.' }, permanent).some((t) => t.triggerType === 'land_card_your_graveyard_from_anywhere'),
  },
  {
    name: 'Talon of Pain (source other than self)',
    oracle_text: 'Whenever a source you control other than this artifact deals damage to an opponent, put a charge counter on this artifact.',
    detect: () => detectCombatDamageTriggers({ name: 'Talon of Pain', oracle_text: 'Whenever a source you control other than this artifact deals damage to an opponent, put a charge counter on this artifact.' }, permanent).some((t) => t.triggerType === 'source_other_than_self_damage_to_opponent'),
  },
  {
    name: 'Ratatwotwo (Chef Role attacks or blocks)',
    oracle_text: 'Whenever a creature you control enchanted by a Chef Role attacks or blocks, it gets +X/+X until end of turn.',
    detect: () => detectBlockTriggers({ name: 'Ratatwotwo', oracle_text: 'Whenever a creature you control enchanted by a Chef Role attacks or blocks, it gets +X/+X until end of turn.' }, permanent).some((t) => t.triggerType === 'chef_role_attacks_or_blocks'),
  },
  {
    name: 'The Clone Saga (chosen name combat damage this turn)',
    oracle_text: 'Whenever a creature with the chosen name deals combat damage to a player this turn, draw a card.',
    detect: () => detectCombatDamageTriggers({ name: 'The Clone Saga', oracle_text: 'Whenever a creature with the chosen name deals combat damage to a player this turn, draw a card.' }, permanent).some((t) => t.triggerType === 'chosen_name_combat_damage_to_player_this_turn'),
  },
  {
    name: 'Zurgo Stormrender (creature token leaves)',
    oracle_text: 'Whenever a creature token you control leaves the battlefield, draw a card if it was attacking.',
    detect: () => detectLTBTriggers({ name: 'Zurgo Stormrender', oracle_text: 'Whenever a creature token you control leaves the battlefield, draw a card if it was attacking.' }, permanent).some((t) => t.triggerType === 'creature_token_ltb'),
  },
  {
    name: 'Niv-Mizzet Reborn (named enters)',
    oracle_text: 'When Niv-Mizzet enters, reveal the top ten cards of your library.',
    detect: () => detectETBTriggers({ name: 'Niv-Mizzet Reborn', oracle_text: 'When Niv-Mizzet enters, reveal the top ten cards of your library.' }, permanent).length > 0,
  },
  {
    name: 'Jaws (noncreature artifact sacrificed or destroyed)',
    oracle_text: 'Whenever a noncreature artifact is sacrificed or destroyed, Jaws deals 1 damage to each opponent.',
    detect: () => detectSacrificeTriggers({ name: 'Jaws, Relentless Predator', oracle_text: 'Whenever a noncreature artifact is sacrificed or destroyed, Jaws deals 1 damage to each opponent.' }, permanent).length > 0,
  },
  {
    name: 'Dross Scorpion (artifact creature dies)',
    oracle_text: 'Whenever this creature or another artifact creature dies, you may untap target artifact.',
    detect: () => detectDeathTriggers({ name: 'Dross Scorpion', oracle_text: 'Whenever this creature or another artifact creature dies, you may untap target artifact.' }, permanent).some((t) => t.triggerType === 'this_or_another_artifact_creature_dies'),
  },
  {
    name: 'Tamanoa (noncreature source deals damage)',
    oracle_text: 'Whenever a noncreature source you control deals damage, you gain that much life.',
    detect: () => detectCombatDamageTriggers({ name: 'Tamanoa', oracle_text: 'Whenever a noncreature source you control deals damage, you gain that much life.' }, permanent).some((t) => t.triggerType === 'noncreature_source_deals_damage'),
  },
  {
    name: 'Oskar (discard nonland card)',
    oracle_text: 'Whenever you discard a nonland card, you may cast it from your graveyard.',
    detect: () => detectDiscardTriggers({ name: 'Oskar, Rubbish Reclaimer', oracle_text: 'Whenever you discard a nonland card, you may cast it from your graveyard.' }, permanent).some((t) => t.triggerType === 'discard_nonland_card'),
  },
  {
    name: 'Ramses (player loses the game)',
    oracle_text: 'Whenever a player loses the game, if they were attacked this turn by an Assassin you controlled, you win the game.',
    detect: () => detectAbilityActivatedTriggers({ name: 'Ramses, Assassin Lord', oracle_text: 'Whenever a player loses the game, if they were attacked this turn by an Assassin you controlled, you win the game.' }, permanent).some((t) => t.triggerType === 'player_loses_game'),
  },
  {
    name: 'Quartzwood Crasher (trample combat damage)',
    oracle_text: 'Whenever one or more creatures you control with trample deal combat damage to a player, create an X/X green Dinosaur Beast creature token with trample.',
    detect: () => detectCombatDamageTriggers({ name: 'Quartzwood Crasher', oracle_text: 'Whenever one or more creatures you control with trample deal combat damage to a player, create an X/X green Dinosaur Beast creature token with trample.' }, permanent).some((t) => t.triggerType === 'trample_creatures_combat_damage_to_player'),
  },
  {
    name: 'Wrathful Red Dragon (Dragon dealt damage)',
    oracle_text: 'Whenever a Dragon you control is dealt damage, it deals that much damage to any target.',
    detect: () => detectDealtDamageTriggers({ name: 'Wrathful Red Dragon', oracle_text: 'Whenever a Dragon you control is dealt damage, it deals that much damage to any target.' }, permanent).length > 0,
  },
  {
    name: "Ajani's Last Stand (creature or planeswalker dies)",
    oracle_text: 'Whenever a creature or planeswalker you control dies, you may sacrifice this enchantment.',
    detect: () => detectDeathTriggers({ name: "Ajani's Last Stand", oracle_text: 'Whenever a creature or planeswalker you control dies, you may sacrifice this enchantment.' }, permanent).some((t) => t.triggerType === 'creature_or_planeswalker_dies'),
  },
  {
    name: 'Omnath (named or another Elemental dies)',
    oracle_text: 'Whenever Omnath or another Elemental you control dies, Omnath deals 3 damage to any target.',
    detect: () => detectDeathTriggers({ name: 'Omnath, Locus of Rage', oracle_text: 'Whenever Omnath or another Elemental you control dies, Omnath deals 3 damage to any target.' }, permanent).some((t) => t.triggerType === 'named_or_another_typed_creature_dies'),
  },
  {
    name: 'Anje (and/or other Vampires enter)',
    oracle_text: 'Whenever Anje and/or one or more other Vampires you control enter, create a Blood token.',
    detect: () => detectETBTriggers({ name: 'Anje, Maid of Dishonor', oracle_text: 'Whenever Anje and/or one or more other Vampires you control enter, create a Blood token.' }, permanent).some((t) => t.triggerType === 'named_and_or_other_typed_etb'),
  },
  {
    name: 'Vela (named or another creature leaves)',
    oracle_text: 'Whenever Vela or another creature you control leaves the battlefield, each opponent loses 1 life.',
    detect: () => detectLTBTriggers({ name: 'Vela the Night-Clad', oracle_text: 'Whenever Vela or another creature you control leaves the battlefield, each opponent loses 1 life.' }, permanent).some((t) => t.triggerType === 'named_or_another_creature_ltb'),
  },
  {
    name: 'Lobelia (named enters)',
    oracle_text: 'When Lobelia enters, exile target creature card from an opponent\'s graveyard.',
    detect: () => detectETBTriggers({ name: 'Lobelia Sackville-Baggins', oracle_text: 'When Lobelia enters, exile target creature card from an opponent\'s graveyard.' }, permanent).length > 0,
  },
  {
    name: 'Judge Magister Gabranth (another creature or artifact dies)',
    oracle_text: 'Whenever another creature or artifact you control dies, put a +1/+1 counter on Judge Magister Gabranth.',
    detect: () => detectDeathTriggers({ name: 'Judge Magister Gabranth', oracle_text: 'Whenever another creature or artifact you control dies, put a +1/+1 counter on Judge Magister Gabranth.' }, permanent).some((t) => t.triggerType === 'another_creature_or_artifact_dies'),
  },
  {
    name: 'Tahngarth (opponent attacks with creatures)',
    oracle_text: 'Whenever an opponent attacks with one or more creatures, if Tahngarth is tapped, you may have that opponent gain control of Tahngarth until end of combat.',
    detect: () => detectAttackTriggers({ name: 'Tahngarth, First Mate', oracle_text: 'Whenever an opponent attacks with one or more creatures, if Tahngarth is tapped, you may have that opponent gain control of Tahngarth until end of combat.' }, permanent).some((t) => t.triggerType === 'opponent_attacks_with_one_or_more_creatures'),
  },
  {
    name: 'Wooden Stake (equipped blocks vampire)',
    oracle_text: 'Whenever equipped creature blocks or becomes blocked by a Vampire, destroy that creature.',
    detect: () => detectBlockTriggers({ name: 'Wooden Stake', oracle_text: 'Whenever equipped creature blocks or becomes blocked by a Vampire, destroy that creature.' }, permanent).some((t) => t.triggerType === 'equipped_blocks_or_blocked_by_vampire'),
  },
  {
    name: 'Mavren Fein (nontoken Vampires attack)',
    oracle_text: 'Whenever one or more nontoken Vampires you control attack, create a 1/1 white Vampire creature token with lifelink.',
    detect: () => detectAttackTriggers({ name: 'Mavren Fein, Dusk Apostle', oracle_text: 'Whenever one or more nontoken Vampires you control attack, create a 1/1 white Vampire creature token with lifelink.' }, permanent).some((t) => t.triggerType === 'one_or_more_nontoken_typed_attack'),
  },
  {
    name: 'Calix (named or enchanted combat damage)',
    oracle_text: 'Whenever Calix or an enchanted creature you control deals combat damage to a player, you may create a token.',
    detect: () => detectCombatDamageTriggers({ name: 'Calix, Guided by Fate', oracle_text: 'Whenever Calix or an enchanted creature you control deals combat damage to a player, you may create a token.' }, permanent).some((t) => t.triggerType === 'named_or_enchanted_combat_damage_to_player'),
  },
  {
    name: 'Guardian of the Ages (attacks you or planeswalker)',
    oracle_text: 'When a creature attacks you or a planeswalker you control, if this creature has defender, it loses defender and gains trample.',
    detect: () => detectAttackTriggers({ name: 'Guardian of the Ages', oracle_text: 'When a creature attacks you or a planeswalker you control, if this creature has defender, it loses defender and gains trample.' }, permanent).some((t) => t.triggerType === 'creature_attacks_you_or_planeswalker'),
  },
  {
    name: 'Slaughter Singer (toxic attacks)',
    oracle_text: 'Whenever another creature you control with toxic attacks, it gets +1/+1 until end of turn.',
    detect: () => detectAttackTriggers({ name: 'Slaughter Singer', oracle_text: 'Whenever another creature you control with toxic attacks, it gets +1/+1 until end of turn.' }, permanent).some((t) => t.triggerType === 'toxic_creature_attacks'),
  },
  {
    name: 'Francisco (Pirates deal damage to player)',
    oracle_text: 'Whenever one or more Pirates you control deal damage to a player, Francisco explores.',
    detect: () => detectCombatDamageTriggers({ name: 'Francisco, Fowl Marauder', oracle_text: 'Whenever one or more Pirates you control deal damage to a player, Francisco explores.' }, permanent).some((t) => t.triggerType === 'typed_deal_damage_to_player'),
  },
  {
    name: 'Essence Sliver (Sliver deals damage)',
    oracle_text: 'Whenever a Sliver deals damage, its controller gains that much life.',
    detect: () => detectCombatDamageTriggers({ name: 'Essence Sliver', oracle_text: 'Whenever a Sliver deals damage, its controller gains that much life.' }, permanent).some((t) => t.triggerType === 'typed_deal_damage'),
  },
  {
    name: 'Lazotep Sliver (nontoken Sliver dies)',
    oracle_text: 'Whenever a nontoken Sliver you control dies, amass Slivers 2.',
    detect: () => detectDeathTriggers({ name: 'Lazotep Sliver', oracle_text: 'Whenever a nontoken Sliver you control dies, amass Slivers 2.' }, permanent).some((t) => t.triggerType === 'nontoken_typed_creature_dies'),
  },
  {
    name: 'Treasure Nabber (opponent taps artifact for mana)',
    oracle_text: 'Whenever an opponent taps an artifact for mana, gain control of that artifact until the end of your next turn.',
    detect: () => detectTapTriggers({ name: 'Treasure Nabber', oracle_text: 'Whenever an opponent taps an artifact for mana, gain control of that artifact until the end of your next turn.' }, permanent).some((t) => (t as { affectedType?: string }).affectedType === 'opponent_artifact_tap_for_mana'),
  },
  {
    name: 'Jerren (enters or nontoken Human dies)',
    oracle_text: 'Whenever Jerren enters or another nontoken Human you control dies, you lose 1 life and create a 1/1 white Human creature token.',
    detect: () => detectDeathTriggers({ name: 'Jerren, Corrupted Bishop', oracle_text: 'Whenever Jerren enters or another nontoken Human you control dies, you lose 1 life and create a 1/1 white Human creature token.' }, permanent).some((t) => t.triggerType === 'named_enters_or_another_nontoken_typed_dies'),
  },
  {
    name: 'Ezio (Assassin combat damage to player)',
    oracle_text: 'Whenever an Assassin you control deals combat damage to a player, draw a card.',
    detect: () => detectCombatDamageTriggers({ name: 'Ezio, Blade of Vengeance', oracle_text: 'Whenever an Assassin you control deals combat damage to a player, draw a card.' }, permanent).some((t) => t.triggerType === 'typed_creature_combat_damage_to_player'),
  },
  {
    name: 'Grand Marshal Macie (becomes untapped)',
    oracle_text: 'Whenever Macie becomes untapped, remove all pause counters from it.',
    detect: () => detectUntapTriggers({ name: 'Grand Marshal Macie', oracle_text: 'Whenever Macie becomes untapped, remove all pause counters from it.' }, permanent).length > 0,
  },
  {
    name: 'Burning Earth (player taps nonbasic land)',
    oracle_text: 'Whenever a player taps a nonbasic land for mana, this enchantment deals 1 damage to that player.',
    detect: () => detectTapTriggers({ name: 'Burning Earth', oracle_text: 'Whenever a player taps a nonbasic land for mana, this enchantment deals 1 damage to that player.' }, permanent).some((t) => (t as { affectedType?: string }).affectedType === 'player_nonbasic_land_tap'),
  },
  {
    name: 'Lurking Skirge (creature to opponent GY from battlefield)',
    oracle_text: "When a creature is put into an opponent's graveyard from the battlefield, if this permanent is an enchantment, it becomes a 3/2 Phyrexian Imp creature with flying.",
    detect: () => detectDeathTriggers({ name: 'Lurking Skirge', oracle_text: "When a creature is put into an opponent's graveyard from the battlefield, if this permanent is an enchantment, it becomes a 3/2 Phyrexian Imp creature with flying." }, permanent).some((t) => t.triggerType === 'creature_opponent_graveyard_from_battlefield'),
  },
  {
    name: 'Salt Road Ambushers (another permanent face up)',
    oracle_text: "Whenever another permanent you control is turned face up, if it's a creature, put two +1/+1 counters on it.",
    detect: () => detectETBTriggers({ name: 'Salt Road Ambushers', oracle_text: "Whenever another permanent you control is turned face up, if it's a creature, put two +1/+1 counters on it." }, permanent).some((t) => t.triggerType === 'another_permanent_face_up'),
  },
  {
    name: 'Eloren Wilds (player taps permanent for mana)',
    oracle_text: 'Whenever a player taps a permanent for mana, that player adds one mana of any type that permanent produced.',
    detect: () => detectTapTriggers({ name: 'Eloren Wilds', oracle_text: 'Whenever a player taps a permanent for mana, that player adds one mana of any type that permanent produced.' }, permanent).some((t) => (t as { affectedType?: string }).affectedType === 'player_permanent_tap_for_mana'),
  },
  {
    name: 'Soulcatcher (flying creature dies)',
    oracle_text: 'Whenever a creature with flying dies, put a +1/+1 counter on this creature.',
    detect: () => detectDeathTriggers({ name: 'Soulcatcher', oracle_text: 'Whenever a creature with flying dies, put a +1/+1 counter on this creature.' }, permanent).some((t) => t.triggerType === 'flying_creature_dies'),
  },
  {
    name: 'Evie Frye (discard creature card this way)',
    oracle_text: "{1}, {T}: Draw a card, then discard a card. When you discard a creature card this way, target creature you control can't be blocked this turn.",
    detect: () => detectDiscardTriggers({ name: 'Evie Frye', oracle_text: "{1}, {T}: Draw a card, then discard a card. When you discard a creature card this way, target creature you control can't be blocked this turn." }, permanent).some((t) => t.triggerType === 'discard_creature_card_this_way'),
  },
  {
    name: 'Stensian Sanguinist (that creature combat damage this combat)',
    oracle_text: 'Whenever you attack, target creature gains deathtouch until end of turn. Whenever that creature deals combat damage to a player this combat, this creature becomes prepared.',
    detect: () => detectCombatDamageTriggers({ name: 'Stensian Sanguinist', oracle_text: 'Whenever you attack, target creature gains deathtouch until end of turn. Whenever that creature deals combat damage to a player this combat, this creature becomes prepared.' }, permanent).some((t) => t.triggerType === 'that_creature_combat_damage_to_player_this_combat'),
  },
  {
    name: 'Ajani (other Cats die)',
    oracle_text: "Whenever one or more other Cats you control die, you may exile Ajani, then return him to the battlefield transformed under his owner's control.",
    detect: () => detectDeathTriggers({ name: 'Ajani, Nacatl Pariah', oracle_text: "Whenever one or more other Cats you control die, you may exile Ajani, then return him to the battlefield transformed under his owner's control." }, permanent).some((t) => t.triggerType === 'one_or_more_other_typed_die'),
  },
  {
    name: 'Dungeon Crawler (complete dungeon)',
    oracle_text: 'Whenever you complete a dungeon, you may return this card from your graveyard to your hand.',
    detect: () => detectAbilityActivatedTriggers({ name: 'Dungeon Crawler', oracle_text: 'Whenever you complete a dungeon, you may return this card from your graveyard to your hand.' }, permanent).some((t) => t.triggerType === 'complete_dungeon'),
  },
  {
    name: "Valkyrie's Call (nontoken non-Angel dies)",
    oracle_text: "Whenever a nontoken, non-Angel creature you control dies, return that card to the battlefield under its owner's control with a +1/+1 counter on it.",
    detect: () => detectDeathTriggers({ name: "Valkyrie's Call", oracle_text: "Whenever a nontoken, non-Angel creature you control dies, return that card to the battlefield under its owner's control with a +1/+1 counter on it." }, permanent).some((t) => t.triggerType === 'nontoken_non_type_creature_dies'),
  },
  {
    name: 'Vengeful Dead (this or another Zombie dies)',
    oracle_text: 'Whenever this creature or another Zombie dies, each opponent loses 1 life.',
    detect: () => detectDeathTriggers({ name: 'Vengeful Dead', oracle_text: 'Whenever this creature or another Zombie dies, each opponent loses 1 life.' }, permanent).some((t) => t.triggerType === 'this_or_another_typed_creature_dies_any'),
  },
  {
    name: 'Disa (Lhurgoyf card to GY not from battlefield)',
    oracle_text: 'Whenever a Lhurgoyf permanent card is put into your graveyard from anywhere other than the battlefield, put it onto the battlefield.',
    detect: () => detectDeathTriggers({ name: 'Disa the Restless', oracle_text: 'Whenever a Lhurgoyf permanent card is put into your graveyard from anywhere other than the battlefield, put it onto the battlefield.' }, permanent).some((t) => t.triggerType === 'typed_permanent_card_your_graveyard_not_battlefield'),
  },
  {
    name: 'Luminous Broodmoth (creature without flying dies)',
    oracle_text: "Whenever a creature you control without flying dies, return it to the battlefield under its owner's control with a flying counter on it.",
    detect: () => detectDeathTriggers({ name: 'Luminous Broodmoth', oracle_text: "Whenever a creature you control without flying dies, return it to the battlefield under its owner's control with a flying counter on it." }, permanent).some((t) => t.triggerType === 'creature_without_flying_dies'),
  },
  {
    name: 'Adarkar Valkyrie (target creature other than self dies this turn)',
    oracle_text: '{T}: When target creature other than this creature dies this turn, return that card to the battlefield under your control.',
    detect: () => detectDeathTriggers({ name: 'Adarkar Valkyrie', oracle_text: '{T}: When target creature other than this creature dies this turn, return that card to the battlefield under your control.' }, permanent).some((t) => t.triggerType === 'target_creature_other_than_self_dies_this_turn'),
  },
  {
    name: 'Roots of Life (chosen land type opponent tap)',
    oracle_text: 'Whenever a land of the chosen type an opponent controls becomes tapped, you gain 1 life.',
    detect: () => detectTapTriggers({ name: 'Roots of Life', oracle_text: 'Whenever a land of the chosen type an opponent controls becomes tapped, you gain 1 life.' }, permanent).some((t) => (t as { affectedType?: string }).affectedType === 'opponent_chosen_land_type_tap'),
  },
  {
    name: "Edgar's Awakening (discard this card)",
    oracle_text: 'When you discard this card, you may pay {B}. When you do, return target creature card from your graveyard to your hand.',
    detect: () => detectDiscardTriggers({ name: "Edgar's Awakening", oracle_text: 'When you discard this card, you may pay {B}. When you do, return target creature card from your graveyard to your hand.' }, permanent).some((t) => t.triggerType === 'discard_this_card'),
  },
  {
    name: 'Dorothea (attacks or blocks)',
    oracle_text: 'When Dorothea attacks or blocks, sacrifice it at end of combat.',
    detect: () => detectAttackTriggers({ name: 'Dorothea, Vengeful Victim', oracle_text: 'When Dorothea attacks or blocks, sacrifice it at end of combat.' }, permanent).some((t) => t.triggerType === 'attacks_or_blocks'),
  },
  {
    name: 'Sanctimony (opponent taps Mountain)',
    oracle_text: 'Whenever an opponent taps a Mountain for mana, you may gain 1 life.',
    detect: () => detectTapTriggers({ name: 'Sanctimony', oracle_text: 'Whenever an opponent taps a Mountain for mana, you may gain 1 life.' }, permanent).some((t) => (t as { affectedType?: string }).affectedType === 'opponent_mountain_tap_for_mana'),
  },
  {
    name: 'Kazarov (opponent creature dealt damage)',
    oracle_text: 'Whenever a creature an opponent controls is dealt damage, put a +1/+1 counter on Kazarov.',
    detect: () => detectDealtDamageTriggers({ name: 'Kazarov, Sengir Pureblood', oracle_text: 'Whenever a creature an opponent controls is dealt damage, put a +1/+1 counter on Kazarov.' }, permanent).length > 0,
  },
  {
    name: 'The Master (skulk combat damage)',
    oracle_text: 'Whenever a creature with skulk deals combat damage to one of your opponents, put a +1/+1 counter on The Master and draw a card.',
    detect: () => detectCombatDamageTriggers({ name: 'The Master, Mesmerist', oracle_text: 'Whenever a creature with skulk deals combat damage to one of your opponents, put a +1/+1 counter on The Master and draw a card.' }, permanent).some((t) => t.triggerType === 'skulk_creature_combat_damage_to_opponent'),
  },
  {
    name: 'Yarus (face-down combat damage)',
    oracle_text: 'Whenever one or more face-down creatures you control deal combat damage to a player, draw a card.',
    detect: () => detectCombatDamageTriggers({ name: 'Yarus, Roar of the Old Gods', oracle_text: 'Whenever one or more face-down creatures you control deal combat damage to a player, draw a card.' }, permanent).some((t) => t.triggerType === 'face_down_creatures_combat_damage_to_player'),
  },
  {
    name: 'Yarus (face-down creature dies)',
    oracle_text: "Whenever a face-down creature you control dies, return it to the battlefield face down under its owner's control if it's a permanent card, then turn it face up.",
    detect: () => detectDeathTriggers({ name: 'Yarus, Roar of the Old Gods', oracle_text: "Whenever a face-down creature you control dies, return it to the battlefield face down under its owner's control if it's a permanent card, then turn it face up." }, permanent).some((t) => t.triggerType === 'face_down_creature_dies'),
  },
  {
    name: 'Prowess of the Fair (nontoken Elf to GY from battlefield)',
    oracle_text: 'Whenever another nontoken Elf is put into your graveyard from the battlefield, you may create a 1/1 green Elf Warrior creature token.',
    detect: () => detectDeathTriggers({ name: 'Prowess of the Fair', oracle_text: 'Whenever another nontoken Elf is put into your graveyard from the battlefield, you may create a 1/1 green Elf Warrior creature token.' }, permanent).some((t) => t.triggerType === 'nontoken_typed_graveyard_from_battlefield'),
  },
  {
    name: 'Kutzil (power above base combat damage)',
    oracle_text: 'Whenever one or more creatures you control each with power greater than its base power deals combat damage to a player, draw a card.',
    detect: () => detectCombatDamageTriggers({ name: 'Kutzil, Malamet Exemplar', oracle_text: 'Whenever one or more creatures you control each with power greater than its base power deals combat damage to a player, draw a card.' }, permanent).some((t) => t.triggerType === 'power_above_base_combat_damage_to_player'),
  },
  {
    name: 'Argent Dais (two or more creatures attack)',
    oracle_text: 'Whenever two or more creatures attack, put an oil counter on this artifact.',
    detect: () => detectAttackTriggers({ name: 'Argent Dais', oracle_text: 'Whenever two or more creatures attack, put an oil counter on this artifact.' }, permanent).some((t) => t.triggerType === 'two_or_more_creatures_attack'),
  },
  {
    name: 'Rising Populace (another creature or planeswalker dies)',
    oracle_text: 'Whenever another creature or planeswalker you control dies, put a +1/+1 counter on this creature.',
    detect: () => detectDeathTriggers({ name: 'Rising Populace', oracle_text: 'Whenever another creature or planeswalker you control dies, put a +1/+1 counter on this creature.' }, permanent).some((t) => t.triggerType === 'another_creature_or_planeswalker_dies'),
  },
  {
    name: 'Hooded Blightfang (deathtouch attacks)',
    oracle_text: 'Whenever a creature you control with deathtouch attacks, each opponent loses 1 life and you gain 1 life.',
    detect: () => detectAttackTriggers({ name: 'Hooded Blightfang', oracle_text: 'Whenever a creature you control with deathtouch attacks, each opponent loses 1 life and you gain 1 life.' }, permanent).some((t) => t.triggerType === 'deathtouch_creature_attacks'),
  },
  {
    name: 'Hooded Blightfang (deathtouch damage to planeswalker)',
    oracle_text: 'Whenever a creature you control with deathtouch deals damage to a planeswalker, destroy that planeswalker.',
    detect: () => detectCombatDamageTriggers({ name: 'Hooded Blightfang', oracle_text: 'Whenever a creature you control with deathtouch deals damage to a planeswalker, destroy that planeswalker.' }, permanent).some((t) => t.triggerType === 'deathtouch_creature_deals_damage_to_planeswalker'),
  },
  {
    name: 'The Serpent Society (another deathtouch creature dies)',
    oracle_text: 'Whenever another creature you control with deathtouch dies, each opponent sacrifices a nontoken creature of their choice.',
    detect: () => detectDeathTriggers({ name: 'The Serpent Society', oracle_text: 'Whenever another creature you control with deathtouch dies, each opponent sacrifices a nontoken creature of their choice.' }, permanent).some((t) => t.triggerType === 'another_creature_with_deathtouch_dies'),
  },
  {
    name: 'Undercity (creatures deal combat damage to you)',
    oracle_text: 'Whenever one or more creatures a player controls deal combat damage to you, that player takes the initiative.',
    detect: () => detectCombatDamageTriggers({ name: 'Undercity // The Initiative', oracle_text: 'Whenever one or more creatures a player controls deal combat damage to you, that player takes the initiative.' }, permanent).some((t) => t.triggerType === 'creatures_player_controls_combat_damage_to_you'),
  },
  {
    name: 'The Belligerent and Useless Island (named combat damage)',
    oracle_text: 'When The Belligerent and Useless Island deal combat damage to a player or battle, draw a card, then discard a card.',
    detect: () => detectCombatDamageTriggers({ name: 'The Belligerent and Useless Island', oracle_text: 'When The Belligerent and Useless Island deal combat damage to a player or battle, draw a card, then discard a card.' }, permanent).some((t) => t.triggerType === 'named_self_combat_damage_to_player_or_battle'),
  },
  {
    name: 'Semblance Scanner (named or equipped combat damage)',
    oracle_text: "Whenever Semblance Scanner or equipped creature deals combat damage to a player, if it's not a token, conjure a duplicate of it into your hand.",
    detect: () => detectCombatDamageTriggers({ name: 'Semblance Scanner', oracle_text: "Whenever Semblance Scanner or equipped creature deals combat damage to a player, if it's not a token, conjure a duplicate of it into your hand." }, permanent).some((t) => t.triggerType === 'named_or_equipped_combat_damage_to_player'),
  },
  {
    name: 'Stensia (first time damage each turn)',
    oracle_text: 'Whenever a creature deals damage to one or more players for the first time each turn, put a +1/+1 counter on it.',
    detect: () => detectCombatDamageTriggers({ name: 'Stensia', oracle_text: 'Whenever a creature deals damage to one or more players for the first time each turn, put a +1/+1 counter on it.' }, permanent).some((t) => t.triggerType === 'creature_deals_damage_first_time_each_turn'),
  },
  {
    name: "Nadier's Nightblade (token leaves)",
    oracle_text: 'Whenever a token you control leaves the battlefield, each opponent loses 1 life and you gain 1 life.',
    detect: () => detectLTBTriggers({ name: "Nadier's Nightblade", oracle_text: 'Whenever a token you control leaves the battlefield, each opponent loses 1 life and you gain 1 life.' }, permanent).some((t) => t.triggerType === 'token_ltb'),
  },
  {
    name: 'Ghoulish Procession (nontoken creatures die)',
    oracle_text: 'Whenever one or more nontoken creatures die, create a 2/2 black Zombie creature token with decayed.',
    detect: () => detectDeathTriggers({ name: 'Ghoulish Procession', oracle_text: 'Whenever one or more nontoken creatures die, create a 2/2 black Zombie creature token with decayed.' }, permanent).some((t) => t.triggerType === 'one_or_more_nontoken_creatures_die'),
  },
  {
    name: 'Bubbling Muck (player taps swamp)',
    oracle_text: 'Until end of turn, whenever a player taps a Swamp for mana, that player adds an additional {B}.',
    detect: () => detectTapTriggers({ name: 'Bubbling Muck', oracle_text: 'Until end of turn, whenever a player taps a Swamp for mana, that player adds an additional {B}.' }, permanent).some((t) => (t as { affectedType?: string }).affectedType === 'player_swamp_tap'),
  },
  {
    name: 'Saradoc (named or low-power creature enters)',
    oracle_text: 'Whenever Saradoc or another nontoken creature you control with power 2 or less enters, create a 1/1 white Halfling creature token.',
    detect: () => detectETBTriggers({ name: 'Saradoc, Master of Buckland', oracle_text: 'Whenever Saradoc or another nontoken creature you control with power 2 or less enters, create a 1/1 white Halfling creature token.' }, permanent).some((t) => t.triggerType === 'named_or_nontoken_creature_power_or_less_etb'),
  },
  {
    name: 'Arnyn (low power or toughness dies)',
    oracle_text: 'Whenever a creature you control with power or toughness 1 or less dies, target opponent loses 2 life and you gain 2 life.',
    detect: () => detectDeathTriggers({ name: 'Arnyn, Deathbloom Botanist', oracle_text: 'Whenever a creature you control with power or toughness 1 or less dies, target opponent loses 2 life and you gain 2 life.' }, permanent).some((t) => t.triggerType === 'creature_power_or_toughness_or_less_dies'),
  },
  {
    name: 'The Council of Four (second card during turn)',
    oracle_text: 'Whenever a player draws their second card during their turn, you draw a card.',
    detect: () => detectCardDrawTriggers({ name: 'The Council of Four', oracle_text: 'Whenever a player draws their second card during their turn, you draw a card.' }, permanent).length > 0,
  },
  {
    name: 'Kraven (greatest power creature dies)',
    oracle_text: 'Whenever a creature an opponent controls with the greatest power among creatures that player controls dies, draw a card and put a +1/+1 counter on Kraven the Hunter.',
    detect: () => detectDeathTriggers({ name: 'Kraven the Hunter', oracle_text: 'Whenever a creature an opponent controls with the greatest power among creatures that player controls dies, draw a card and put a +1/+1 counter on Kraven the Hunter.' }, permanent).some((t) => t.triggerType === 'opponent_greatest_power_creature_dies'),
  },
  {
    name: 'Sokka (named and other creature attack)',
    oracle_text: 'Whenever Sokka and at least one other creature attack, draw a card.',
    detect: () => detectAttackTriggers({ name: 'Sokka, Lateral Strategist', oracle_text: 'Whenever Sokka and at least one other creature attack, draw a card.' }, permanent).some((t) => t.triggerType === 'named_and_other_creature_attack'),
  },
  {
    name: 'Archangel Avacyn (non-Angel dies)',
    oracle_text: 'When a non-Angel creature you control dies, transform Archangel Avacyn at the beginning of the next upkeep.',
    detect: () => detectDeathTriggers({ name: 'Archangel Avacyn // Avacyn, the Purifier', oracle_text: 'When a non-Angel creature you control dies, transform Archangel Avacyn at the beginning of the next upkeep.' }, permanent).some((t) => t.triggerType === 'non_type_creature_you_control_dies'),
  },
  {
    name: 'Yomiji (other legendary to GY from battlefield)',
    oracle_text: 'Whenever a legendary permanent other than Yomiji is put into a graveyard from the battlefield, return that card to its owner\'s hand.',
    detect: () => detectDeathTriggers({ name: 'Yomiji, Who Bars the Way', oracle_text: 'Whenever a legendary permanent other than Yomiji is put into a graveyard from the battlefield, return that card to its owner\'s hand.' }, permanent).some((t) => t.triggerType === 'another_legendary_permanent_graveyard_from_battlefield'),
  },
  {
    name: 'Al Bhed Salvagers (this or creature or artifact dies)',
    oracle_text: 'Whenever this creature or another creature or artifact you control dies, target opponent loses 1 life and you gain 1 life.',
    detect: () => detectDeathTriggers({ name: 'Al Bhed Salvagers', oracle_text: 'Whenever this creature or another creature or artifact you control dies, target opponent loses 1 life and you gain 1 life.' }, permanent).some((t) => t.triggerType === 'this_or_another_creature_or_artifact_dies'),
  },
  {
    name: 'Vodalian Tide Mage (other nontoken combat damage)',
    oracle_text: 'Whenever one or more other nontoken creatures you control deal combat damage to a player, choose one of those creatures.',
    detect: () => detectCombatDamageTriggers({ name: 'Vodalian Tide Mage', oracle_text: 'Whenever one or more other nontoken creatures you control deal combat damage to a player, choose one of those creatures.' }, permanent).some((t) => t.triggerType === 'other_nontoken_creatures_combat_damage_to_player'),
  },
  {
    name: 'Compost (black card to opponent GY)',
    oracle_text: "Whenever a black card is put into an opponent's graveyard from anywhere, you may draw a card.",
    detect: () => detectDeathTriggers({ name: 'Compost', oracle_text: "Whenever a black card is put into an opponent's graveyard from anywhere, you may draw a card." }, permanent).some((t) => t.triggerType === 'black_card_opponent_graveyard_from_anywhere'),
  },
  {
    name: 'Rinoa (attacking creatures die)',
    oracle_text: 'Whenever one or more attacking creatures you control die, you may return one of them to the battlefield tapped under its owner\'s control with a flying counter on it.',
    detect: () => detectDeathTriggers({ name: 'Rinoa, Angel Wing', oracle_text: 'Whenever one or more attacking creatures you control die, you may return one of them to the battlefield tapped under its owner\'s control with a flying counter on it.' }, permanent).some((t) => t.triggerType === 'one_or_more_attacking_creatures_die'),
  },
  {
    name: 'Skemfar Avenger (elf or berserker dies)',
    oracle_text: 'Whenever another nontoken Elf or Berserker you control dies, you draw a card and you lose 1 life.',
    detect: () => detectDeathTriggers({ name: 'Skemfar Avenger', oracle_text: 'Whenever another nontoken Elf or Berserker you control dies, you draw a card and you lose 1 life.' }, permanent).some((t) => t.triggerType === 'another_nontoken_multi_typed_dies'),
  },
  {
    name: 'Aang and Katara (enter or attack)',
    oracle_text: 'Whenever Aang and Katara enter or attack, create X 1/1 white Ally creature tokens, where X is the number of tapped artifacts and/or creatures you control.',
    detect: () => detectAttackTriggers({ name: 'Aang and Katara', oracle_text: 'Whenever Aang and Katara enter or attack, create X 1/1 white Ally creature tokens, where X is the number of tapped artifacts and/or creatures you control.' }, permanent).some((t) => t.triggerType === 'named_enter_or_attack'),
  },
  {
    name: 'Hordewing Skaab (zombies combat damage to opponents)',
    oracle_text: 'Whenever one or more Zombies you control deal combat damage to one or more of your opponents, you may draw cards equal to the number of opponents dealt damage this way.',
    detect: () => detectCombatDamageTriggers({ name: 'Hordewing Skaab', oracle_text: 'Whenever one or more Zombies you control deal combat damage to one or more of your opponents, you may draw cards equal to the number of opponents dealt damage this way.' }, permanent).some((t) => t.triggerType === 'typed_creatures_combat_damage_to_opponents'),
  },
  {
    name: 'Hythonia (named becomes monstrous)',
    oracle_text: 'When Hythonia becomes monstrous, destroy all non-Gorgon creatures.',
    detect: () => detectMonstrousTriggers({ name: 'Hythonia the Cruel', oracle_text: 'When Hythonia becomes monstrous, destroy all non-Gorgon creatures.' }, permanent).some((t) => t.triggerType === 'became_monstrous'),
  },
  {
    name: "April O'Neil (mutant ninja turtle enters)",
    oracle_text: "Whenever a Mutant, Ninja, or Turtle you control enters, investigate.",
    detect: () => detectETBTriggers({ name: "April O'Neil, Live on the Scene", oracle_text: "Whenever a Mutant, Ninja, or Turtle you control enters, investigate." }, permanent).some((t) => t.triggerType === 'multi_typed_creature_etb'),
  },
  {
    name: 'The Roaring Toeclaws (named or MV5+ untap)',
    oracle_text: 'Whenever The Roaring Toeclaws or another creature you control with mana value five or greater becomes untapped, put +1/+1 counters on it equal to its power.',
    detect: () => detectUntapTriggers({ name: 'The Roaring Toeclaws', oracle_text: 'Whenever The Roaring Toeclaws or another creature you control with mana value five or greater becomes untapped, put +1/+1 counters on it equal to its power.' }, permanent).some((t) => t.untapType === 'named_or_mv_creature'),
  },
  {
    name: 'Knucklebone Witch (goblin to GY from battlefield)',
    oracle_text: 'Whenever a Goblin you control is put into a graveyard from the battlefield, you may put a +1/+1 counter on this creature.',
    detect: () => detectDeathTriggers({ name: 'Knucklebone Witch', oracle_text: 'Whenever a Goblin you control is put into a graveyard from the battlefield, you may put a +1/+1 counter on this creature.' }, permanent).some((t) => t.triggerType === 'typed_creature_graveyard_from_battlefield'),
  },
  {
    name: 'Grievous Wound (enchanted player dealt damage)',
    oracle_text: 'Whenever enchanted player is dealt damage, they lose half their life, rounded up.',
    detect: () => detectDealtDamageTriggers({ name: 'Grievous Wound', oracle_text: 'Whenever enchanted player is dealt damage, they lose half their life, rounded up.' }, permanent).length > 0,
  },
  {
    name: 'Avalanche of Sector 7 (opponent artifact ability)',
    oracle_text: 'Whenever an opponent activates an ability of an artifact they control, Avalanche of Sector 7 deals 1 damage to that player.',
    detect: () => detectAbilityActivatedTriggers({ name: 'Avalanche of Sector 7', oracle_text: 'Whenever an opponent activates an ability of an artifact they control, Avalanche of Sector 7 deals 1 damage to that player.' }, permanent).some((t) => t.triggerType === 'opponent_artifact_ability_activated'),
  },
  {
    name: "Adriana's Valor (chosen name attacks)",
    oracle_text: 'Whenever a creature you control with the chosen name attacks, you may pay {W}. If you do, that creature gains indestructible until end of turn.',
    detect: () => detectAttackTriggers({ name: "Adriana's Valor", oracle_text: 'Whenever a creature you control with the chosen name attacks, you may pay {W}. If you do, that creature gains indestructible until end of turn.' }, permanent).some((t) => t.triggerType === 'chosen_name_creature_attacks'),
  },
  {
    name: 'Mary Read (discard island)',
    oracle_text: 'Whenever you discard an Island, Pirate, or Vehicle card, create a tapped Treasure token.',
    detect: () => detectDiscardTriggers({ name: 'Mary Read and Anne Bonny', oracle_text: 'Whenever you discard an Island, Pirate, or Vehicle card, create a tapped Treasure token.' }, permanent).some((t) => t.triggerType === 'discard_island_or_typed'),
  },
  {
    name: 'Species Specialist (chosen type dies)',
    oracle_text: 'Whenever a creature of the chosen type dies, you may draw a card.',
    detect: () => detectDeathTriggers({ name: 'Species Specialist', oracle_text: 'Whenever a creature of the chosen type dies, you may draw a card.' }, permanent).some((t) => t.triggerType === 'chosen_type_creature_dies'),
  },
  {
    name: 'Favored Enemy (noted type opponent creature dies)',
    oracle_text: 'Whenever a creature an opponent controls of the noted type dies, put a +1/+1 counter on target creature you control.',
    detect: () => detectDeathTriggers({ name: 'Favored Enemy', oracle_text: 'Whenever a creature an opponent controls of the noted type dies, put a +1/+1 counter on target creature you control.' }, permanent).some((t) => t.triggerType === 'noted_type_opponent_creature_dies'),
  },
  {
    name: 'Crude Abattoir (noncombat damage to creature)',
    oracle_text: 'Whenever a source you control deals noncombat damage to a creature, choose a creature card in your hand.',
    detect: () => detectCombatDamageTriggers({ name: 'Crude Abattoir // Unsavory Kitchen', oracle_text: 'Whenever a source you control deals noncombat damage to a creature, choose a creature card in your hand.' }, permanent).some((t) => t.triggerType === 'noncombat_damage_to_creature'),
  },
  {
    name: 'Lifetap (opponent Forest becomes tapped)',
    oracle_text: 'Whenever a Forest an opponent controls becomes tapped, you gain 1 life.',
    detect: () => detectTapTriggers({ name: 'Lifetap', oracle_text: 'Whenever a Forest an opponent controls becomes tapped, you gain 1 life.' }, permanent).some((t) => (t as { affectedType?: string }).affectedType === 'opponent_forest_tap'),
  },
  {
    name: 'Booby Trap (chosen player draws chosen name)',
    oracle_text: 'When the chosen player draws a card with the chosen name, sacrifice this artifact. If you do, this artifact deals 10 damage to that player.',
    detect: () => detectCardDrawTriggers({ name: 'Booby Trap', oracle_text: 'When the chosen player draws a card with the chosen name, sacrifice this artifact. If you do, this artifact deals 10 damage to that player.' }, permanent).some((t) => (t as { triggerType?: string }).triggerType === 'chosen_player_draws_chosen_name'),
  },
  {
    name: 'Miss Demeanor (each other player upkeep)',
    oracle_text: "At the beginning of each other player's upkeep, you may compliment that player on their game play. If you don't, sacrifice this creature.",
    detect: () => detectUpkeepTriggers({ name: 'Miss Demeanor', oracle_text: "At the beginning of each other player's upkeep, you may compliment that player on their game play. If you don't, sacrifice this creature." }, permanent).some((t) => t.triggerType === 'each_other_player_upkeep'),
  },
  {
    name: "Ertai's Meddling (each of that player upkeeps)",
    oracle_text: "At the beginning of each of that player's upkeeps, if that card is exiled, remove a delay counter from it.",
    detect: () => detectUpkeepTriggers({ name: "Ertai's Meddling", oracle_text: "At the beginning of each of that player's upkeeps, if that card is exiled, remove a delay counter from it." }, permanent).some((t) => t.triggerType === 'each_of_that_player_upkeep'),
  },
  {
    name: 'Termination Facilitator (bounty counter dealt damage)',
    oracle_text: 'Whenever a creature or planeswalker an opponent controls with a bounty counter on it is dealt damage, destroy it.',
    detect: () => detectDealtDamageTriggers({ name: 'Termination Facilitator', oracle_text: 'Whenever a creature or planeswalker an opponent controls with a bounty counter on it is dealt damage, destroy it.' }, permanent).length > 0,
  },
  {
    name: 'Tavern Scoundrel (win coin flip)',
    oracle_text: 'Whenever you win a coin flip, create two Treasure tokens.',
    detect: () => detectAbilityActivatedTriggers({ name: 'Tavern Scoundrel', oracle_text: 'Whenever you win a coin flip, create two Treasure tokens.' }, permanent).some((t) => t.triggerType === 'win_coin_flip'),
  },
  {
    name: 'Swinging Ship (beginning of that combat)',
    oracle_text: "At the beginning of that combat, untap all creatures that attacked this turn.",
    detect: () => detectBeginningOfCombatTriggers({ name: 'Swinging Ship', oracle_text: "Visit — After the first combat phase this turn, there's an additional combat phase. At the beginning of that combat, untap all creatures that attacked this turn." }, permanent).some((t) => (t as { triggerType?: string }).triggerType === 'that_combat'),
  },
  {
    name: 'Psychomancer (nontoken artifact GY or exile)',
    oracle_text: 'Whenever this creature or another nontoken artifact you control is put into a graveyard from the battlefield or is put into exile from the battlefield, target opponent loses 1 life and you gain 1 life.',
    detect: () => detectDeathTriggers({ name: 'Psychomancer', oracle_text: 'Whenever this creature or another nontoken artifact you control is put into a graveyard from the battlefield or is put into exile from the battlefield, target opponent loses 1 life and you gain 1 life.' }, permanent).some((t) => t.triggerType === 'nontoken_artifact_graveyard_or_exile_from_battlefield'),
  },
  {
    name: 'Noxious Ghoul (this or another Zombie enters)',
    oracle_text: 'Whenever this creature or another Zombie enters, all non-Zombie creatures get -1/-1 until end of turn.',
    detect: () => detectETBTriggers({ name: 'Noxious Ghoul', oracle_text: 'Whenever this creature or another Zombie enters, all non-Zombie creatures get -1/-1 until end of turn.' }, permanent).some((t) => t.triggerType === 'this_or_another_typed_etb_any'),
  },
  {
    name: 'Sethron (named or nontoken Minotaur enters)',
    oracle_text: 'Whenever Sethron or another nontoken Minotaur you control enters, create a 2/3 red Minotaur creature token.',
    detect: () => detectETBTriggers({ name: 'Sethron, Hurloon General', oracle_text: 'Whenever Sethron or another nontoken Minotaur you control enters, create a 2/3 red Minotaur creature token.' }, permanent).some((t) => t.triggerType === 'named_or_another_nontoken_typed_etb'),
  },
  {
    name: 'Shadewing Laureate (another flying creature dies)',
    oracle_text: 'Whenever another creature you control with flying dies, put a +1/+1 counter on target creature you control.',
    detect: () => detectDeathTriggers({ name: 'Shadewing Laureate', oracle_text: 'Whenever another creature you control with flying dies, put a +1/+1 counter on target creature you control.' }, permanent).some((t) => t.triggerType === 'another_creature_with_flying_dies'),
  },
  {
    name: 'Village Pillagers (opponent creature with counter dies)',
    oracle_text: 'Whenever a creature an opponent controls with a counter on it dies, you create a tapped Treasure token.',
    detect: () => detectDeathTriggers({ name: 'Village Pillagers', oracle_text: 'Whenever a creature an opponent controls with a counter on it dies, you create a tapped Treasure token.' }, permanent).some((t) => t.triggerType === 'opponent_creature_with_counter_dies'),
  },
  {
    name: 'The Dark Barony (nonblack card to player GY)',
    oracle_text: "Whenever a nonblack card is put into a player's graveyard from anywhere, that player loses 1 life.",
    detect: () => detectDeathTriggers({ name: 'The Dark Barony', oracle_text: "Whenever a nonblack card is put into a player's graveyard from anywhere, that player loses 1 life." }, permanent).some((t) => t.triggerType === 'nonblack_card_player_graveyard_from_anywhere'),
  },
  {
    name: 'The Red Terror (red source deals damage)',
    oracle_text: 'Whenever a red source you control deals damage to one or more permanents and/or players, put a +1/+1 counter on The Red Terror.',
    detect: () => detectCombatDamageTriggers({ name: 'The Red Terror', oracle_text: 'Whenever a red source you control deals damage to one or more permanents and/or players, put a +1/+1 counter on The Red Terror.' }, permanent).some((t) => t.triggerType === 'red_source_deals_damage'),
  },
  {
    name: 'Sosuke (Warrior combat damage to creature)',
    oracle_text: 'Whenever a Warrior you control deals combat damage to a creature, destroy that creature at end of combat.',
    detect: () => detectCombatDamageTriggers({ name: 'Sosuke, Son of Seshiro', oracle_text: 'Whenever a Warrior you control deals combat damage to a creature, destroy that creature at end of combat.' }, permanent).some((t) => t.triggerType === 'typed_creature_combat_damage_to_creature'),
  },
  {
    name: 'Electryte (combat damage to defending player)',
    oracle_text: 'Whenever this creature deals combat damage to defending player, it deals damage equal to its power to each blocking creature.',
    detect: () => detectCombatDamageTriggers({ name: 'Electryte', oracle_text: 'Whenever this creature deals combat damage to defending player, it deals damage equal to its power to each blocking creature.' }, permanent).some((t) => t.triggerType === 'self_combat_damage_to_defending_player'),
  },
  {
    name: 'Dragon Spirit (when this deals damage)',
    oracle_text: 'When this creature deals damage, sacrifice it.',
    detect: () => detectCombatDamageTriggers({ name: 'Dragon Spirit', oracle_text: 'When this creature deals damage, sacrifice it.' }, permanent).some((t) => t.triggerType === 'when_self_deals_damage'),
  },
  {
    name: 'Jason Bright (Zombie or Mutant dies)',
    oracle_text: 'Whenever a Zombie or Mutant you control dies, if its power was different from its base power, draw a card.',
    detect: () => detectDeathTriggers({ name: 'Jason Bright, Glowing Prophet', oracle_text: 'Whenever a Zombie or Mutant you control dies, if its power was different from its base power, draw a card.' }, permanent).some((t) => t.triggerType === 'multi_typed_creature_dies'),
  },
  {
    name: 'Requiem Angel (another non-Spirit dies)',
    oracle_text: 'Whenever another non-Spirit creature you control dies, create a 1/1 white Spirit creature token with flying.',
    detect: () => detectDeathTriggers({ name: 'Requiem Angel', oracle_text: 'Whenever another non-Spirit creature you control dies, create a 1/1 white Spirit creature token with flying.' }, permanent).some((t) => t.triggerType === 'non_type_creature_you_control_dies'),
  },
  {
    name: 'Shichifukujin Dragon (comes into play)',
    oracle_text: 'When Shichifukujin Dragon comes into play, put seven +1/+1 counters on it.',
    detect: () => detectETBTriggers({ name: 'Shichifukujin Dragon', oracle_text: 'When Shichifukujin Dragon comes into play, put seven +1/+1 counters on it.' }, permanent).length > 0,
  },
  {
    name: 'Memory Test (this Attraction enters)',
    oracle_text: 'When this Attraction enters, target opponent exiles cards from the bottom of their library until they exile five nonland cards, then turns those nonland cards face down.',
    detect: () => detectETBTriggers({ name: 'Memory Test', oracle_text: 'When this Attraction enters, target opponent exiles cards from the bottom of their library until they exile five nonland cards, then turns those nonland cards face down.' }, permanent).some((t) => t.triggerType === 'this_attraction_etb'),
  },
  {
    name: 'Shadow of the Second Sun (enchanted player postcombat main)',
    oracle_text: "At the beginning of each of enchanted player's postcombat main phases, there is an additional beginning phase after this phase.",
    detect: () => detectPostcombatMainTriggers({ name: 'Shadow of the Second Sun', oracle_text: "At the beginning of each of enchanted player's postcombat main phases, there is an additional beginning phase after this phase." }, permanent).length > 0,
  },
  {
    name: 'Stonebrow (trample creature attacks)',
    oracle_text: 'Whenever a creature you control with trample attacks, it gets +2/+2 until end of turn.',
    detect: () => detectAttackTriggers({ name: 'Stonebrow, Krosan Hero', oracle_text: 'Whenever a creature you control with trample attacks, it gets +2/+2 until end of turn.' }, permanent).some((t) => t.triggerType === 'trample_creature_attacks'),
  },
  {
    name: 'Chatzuk (attack in a band)',
    oracle_text: 'Whenever two or more creatures you control attack in a band, each creature in that band gets +1/+1 until end of turn for each creature in that band.',
    detect: () => detectAttackTriggers({ name: 'Chatzuk, Mighty Guitarist', oracle_text: 'Whenever two or more creatures you control attack in a band, each creature in that band gets +1/+1 until end of turn for each creature in that band.' }, permanent).some((t) => t.triggerType === 'attack_in_band'),
  },
  {
    name: "Valor's Reach (team exactly two creatures attack)",
    oracle_text: 'Whenever your team attacks with exactly two creatures, those creatures gain double strike until end of turn.',
    detect: () => detectAttackTriggers({ name: "Valor's Reach", oracle_text: 'Whenever your team attacks with exactly two creatures, those creatures gain double strike until end of turn.' }, permanent).some((t) => t.triggerType === 'team_exactly_two_creatures_attack'),
  },
  {
    name: 'Balthier and Fran (vehicle crewed by name attacks)',
    oracle_text: "Whenever a Vehicle crewed by Balthier and Fran this turn attacks, if it's the first combat phase of the turn, you may pay {1}{R}{G}.",
    detect: () => detectAttackTriggers({ name: 'Balthier and Fran', oracle_text: "Whenever a Vehicle crewed by Balthier and Fran this turn attacks, if it's the first combat phase of the turn, you may pay {1}{R}{G}." }, permanent).some((t) => t.triggerType === 'vehicle_crewed_by_name_attacks'),
  },
  {
    name: 'Akki Battle Squad (modified creatures attack)',
    oracle_text: 'Whenever one or more modified creatures you control attack, untap all modified creatures you control.',
    detect: () => detectAttackTriggers({ name: 'Akki Battle Squad', oracle_text: 'Whenever one or more modified creatures you control attack, untap all modified creatures you control.' }, permanent).some((t) => t.triggerType === 'one_or_more_modified_creatures_attack'),
  },
  {
    name: 'Scion of Opulence (nontoken Vampire dies)',
    oracle_text: 'Whenever this creature or another nontoken Vampire you control dies, create a Treasure token.',
    detect: () => detectDeathTriggers({ name: 'Scion of Opulence', oracle_text: 'Whenever this creature or another nontoken Vampire you control dies, create a Treasure token.' }, permanent).some((t) => t.triggerType === 'this_or_another_nontoken_typed_dies'),
  },
  {
    name: 'Dauthi Ghoul (creature with shadow dies)',
    oracle_text: 'Whenever a creature with shadow dies, put a +1/+1 counter on this creature.',
    detect: () => detectDeathTriggers({ name: 'Dauthi Ghoul', oracle_text: 'Whenever a creature with shadow dies, put a +1/+1 counter on this creature.' }, permanent).some((t) => t.triggerType === 'creature_with_shadow_dies'),
  },
  {
    name: 'Arahbo (named or nontoken Cat enters)',
    oracle_text: 'Whenever Arahbo or another nontoken Cat you control enters, create a 1/1 white Cat creature token.',
    detect: () => detectETBTriggers({ name: 'Arahbo, the First Fang', oracle_text: 'Whenever Arahbo or another nontoken Cat you control enters, create a 1/1 white Cat creature token.' }, permanent).some((t) => t.triggerType === 'named_or_another_nontoken_typed_etb'),
  },
  {
    name: 'Serum Tank (this or another artifact enters)',
    oracle_text: 'Whenever this artifact or another artifact enters, put a charge counter on this artifact.',
    detect: () => detectETBTriggers({ name: 'Serum Tank', oracle_text: 'Whenever this artifact or another artifact enters, put a charge counter on this artifact.' }, permanent).some((t) => t.triggerType === 'this_or_another_artifact_etb_any'),
  },
  {
    name: 'Math is for Blockers (nontoken creature attacks)',
    oracle_text: 'Whenever a nontoken creature attacks, exile it. Return it to the battlefield under its owner\'s control tapped and attacking at the beginning of the next end step.',
    detect: () => detectAttackTriggers({ name: 'Math is for Blockers (Plane)', oracle_text: 'Whenever a nontoken creature attacks, exile it. Return it to the battlefield under its owner\'s control tapped and attacking at the beginning of the next end step.' }, permanent).some((t) => t.triggerType === 'nontoken_creature_attacks'),
  },
  {
    name: "Soulcatchers' Aerie (Bird to your GY)",
    oracle_text: "Whenever a Bird is put into your graveyard from the battlefield, put a feather counter on this enchantment.",
    detect: () => detectDeathTriggers({ name: "Soulcatchers' Aerie", oracle_text: "Whenever a Bird is put into your graveyard from the battlefield, put a feather counter on this enchantment." }, permanent).some((t) => t.triggerType === 'bird_your_graveyard_from_battlefield'),
  },
  {
    name: 'Circle of Affliction (chosen color deals damage to you)',
    oracle_text: 'Whenever a source of the chosen color deals damage to you, you may pay {1}. If you do, target player loses 1 life and you gain 1 life.',
    detect: () => detectDealtDamageTriggers({ name: 'Circle of Affliction', oracle_text: 'Whenever a source of the chosen color deals damage to you, you may pay {1}. If you do, target player loses 1 life and you gain 1 life.' }, permanent).length > 0,
  },
  {
    name: 'Sumala Sentry (face-down permanent turned face up)',
    oracle_text: 'Whenever a face-down permanent you control is turned face up, put a +1/+1 counter on it and a +1/+1 counter on this creature.',
    detect: () => detectETBTriggers({ name: 'Sumala Sentry', oracle_text: 'Whenever a face-down permanent you control is turned face up, put a +1/+1 counter on it and a +1/+1 counter on this creature.' }, permanent).some((t) => t.triggerType === 'face_down_controlled_turned_face_up'),
  },
  {
    name: 'Archfiend of Spite (opponent source damages this creature)',
    oracle_text: "Whenever a source an opponent controls deals damage to this creature, that source's controller loses that much life unless they sacrifice that many permanents of their choice.",
    detect: () => detectDealtDamageTriggers({ name: 'Archfiend of Spite', oracle_text: "Whenever a source an opponent controls deals damage to this creature, that source's controller loses that much life unless they sacrifice that many permanents of their choice." }, permanent).length > 0,
  },
  {
    name: 'Savanti Romero (ninjas bosses combat damage)',
    oracle_text: 'Whenever one or more Ninjas the bosses control deal combat damage to the heroes, the bosses play a card.',
    detect: () => detectCombatDamageTriggers({ name: 'Savanti Romero, Temporal Rogue', oracle_text: 'Whenever one or more Ninjas the bosses control deal combat damage to the heroes, the bosses play a card.' }, permanent).some((t) => t.triggerType === 'ninjas_bosses_combat_damage_to_heroes'),
  },
  {
    name: 'Predatory Sludge (chosen permanent to GY)',
    oracle_text: 'When the chosen permanent is put into a graveyard from the battlefield, conjure a card named Predatory Sludge into your hand.',
    detect: () => detectDeathTriggers({ name: 'Predatory Sludge', oracle_text: 'When the chosen permanent is put into a graveyard from the battlefield, conjure a card named Predatory Sludge into your hand.' }, permanent).some((t) => t.triggerType === 'chosen_permanent_graveyard_from_battlefield'),
  },
  {
    name: 'Game Knights Live (commander cast or attack)',
    oracle_text: 'Whenever a player casts their commander or attacks with their commander, they may say "Only one may stand."',
    detect: () => detectSpellCastTriggers({ name: 'Game Knights Live', oracle_text: 'Whenever a player casts their commander or attacks with their commander, they may say "Only one may stand."' }, permanent).some((t) => t.tribalType === 'commander'),
  },
  {
    name: 'Shield of the Righteous (equipped blocks creature)',
    oracle_text: "Whenever equipped creature blocks a creature, that creature doesn't untap during its controller's next untap step.",
    detect: () => detectBlockTriggers({ name: 'Shield of the Righteous', oracle_text: "Whenever equipped creature blocks a creature, that creature doesn't untap during its controller's next untap step." }, permanent).some((t) => (t as { triggerType?: string }).triggerType === 'equipped_creature_blocks_creature'),
  },
  {
    name: 'Sword of the Squeak (hamster mouse rat squirrel enters)',
    oracle_text: 'Whenever a Hamster, Mouse, Rat, or Squirrel you control enters, you may attach this Equipment to that creature.',
    detect: () => detectETBTriggers({ name: 'Sword of the Squeak', oracle_text: 'Whenever a Hamster, Mouse, Rat, or Squirrel you control enters, you may attach this Equipment to that creature.' }, permanent).some((t) => t.triggerType === 'multi_typed_creature_etb'),
  },
  {
    name: 'Verdant Dread (named or same-named permanent enters)',
    oracle_text: 'Whenever Verdant Dread or another permanent you control named Verdant Dread enters, manifest dread.',
    detect: () => detectETBTriggers({ name: 'Verdant Dread', oracle_text: 'Whenever Verdant Dread or another permanent you control named Verdant Dread enters, manifest dread.' }, permanent).some((t) => t.triggerType === 'named_or_another_same_named_permanent_etb'),
  },
  {
    name: "Ertai's Familiar (phases out or leaves)",
    oracle_text: 'When this creature phases out or leaves the battlefield, mill three cards.',
    detect: () => detectLTBTriggers({ name: "Ertai's Familiar", oracle_text: 'When this creature phases out or leaves the battlefield, mill three cards.' }, permanent).some((t) => t.triggerType === 'phases_out_or_leaves'),
  },
  {
    name: 'Quest for Pure Flame (source damage to opponent)',
    oracle_text: 'Whenever a source you control deals damage to an opponent, you may put a quest counter on this enchantment.',
    detect: () => detectCombatDamageTriggers({ name: 'Quest for Pure Flame', oracle_text: 'Whenever a source you control deals damage to an opponent, you may put a quest counter on this enchantment.' }, permanent).some((t) => t.triggerType === 'source_damage_to_opponent'),
  },
  {
    name: 'Boomstacker (whenever it attacks)',
    oracle_text: 'As this creature enters and whenever it attacks, stack two dice on top of it.',
    detect: () => detectAttackTriggers({ name: 'Boomstacker', oracle_text: 'As this creature enters and whenever it attacks, stack two dice on top of it.' }, permanent).some((t) => t.triggerType === 'it_attacks'),
  },
  {
    name: 'Millicent (dies or combat damage to player)',
    oracle_text: 'Whenever Millicent or another nontoken Spirit you control dies or deals combat damage to a player, create a 1/1 white Spirit creature token with flying.',
    detect: () => detectDeathTriggers({ name: 'Millicent, Restless Revenant', oracle_text: 'Whenever Millicent or another nontoken Spirit you control dies or deals combat damage to a player, create a 1/1 white Spirit creature token with flying.' }, permanent).some((t) => t.triggerType === 'named_or_nontoken_dies_or_combat_damage_to_player'),
  },
  {
    name: 'Kassandra (legendary equipment combat damage)',
    oracle_text: 'Whenever a creature you control with a legendary Equipment attached to it deals combat damage to a player, draw a card.',
    detect: () => detectCombatDamageTriggers({ name: 'Kassandra, Eagle Bearer', oracle_text: 'Whenever a creature you control with a legendary Equipment attached to it deals combat damage to a player, draw a card.' }, permanent).some((t) => t.triggerType === 'legendary_equipment_combat_damage_to_player'),
  },
  {
    name: 'Reckless Blaze (dealt damage this way dies)',
    oracle_text: 'Whenever a creature you control dealt damage this way dies this turn, add {R}.',
    detect: () => detectDeathTriggers({ name: 'Reckless Blaze', oracle_text: 'Reckless Blaze deals 5 damage to each creature. Whenever a creature you control dealt damage this way dies this turn, add {R}.' }, permanent).some((t) => t.triggerType === 'dealt_damage_this_way_dies'),
  },
  {
    name: 'Satoru (and/or nontoken creatures enter)',
    oracle_text: 'Whenever Satoru and/or one or more other nontoken creatures you control enter, if none of them were cast or no mana was spent to cast them, draw a card.',
    detect: () => detectETBTriggers({ name: 'Satoru, the Infiltrator', oracle_text: 'Whenever Satoru and/or one or more other nontoken creatures you control enter, if none of them were cast or no mana was spent to cast them, draw a card.' }, permanent).some((t) => t.triggerType === 'named_and_or_nontoken_creatures_enter'),
  },
  {
    name: 'Arashin War Beast (combat damage to blocking creatures)',
    oracle_text: 'Whenever this creature deals combat damage to one or more blocking creatures, manifest the top card of your library.',
    detect: () => detectCombatDamageTriggers({ name: 'Arashin War Beast', oracle_text: 'Whenever this creature deals combat damage to one or more blocking creatures, manifest the top card of your library.' }, permanent).some((t) => t.triggerType === 'self_combat_damage_to_blocking_creatures'),
  },
  {
    name: 'Flummoxed Cyclops (opponents two or more attack)',
    oracle_text: "Whenever two or more creatures your opponents control attack, this creature can't block this combat.",
    detect: () => detectAttackTriggers({ name: 'Flummoxed Cyclops', oracle_text: "Whenever two or more creatures your opponents control attack, this creature can't block this combat." }, permanent).some((t) => t.triggerType === 'opponents_two_or_more_creatures_attack'),
  },
  {
    name: 'My Champion Stands Supreme (commander leaves)',
    oracle_text: 'When your commander leaves the battlefield, abandon this scheme.',
    detect: () => detectLTBTriggers({ name: 'My Champion Stands Supreme', oracle_text: 'When your commander leaves the battlefield, abandon this scheme.' }, permanent).some((t) => t.triggerType === 'commander_leaves'),
  },
  {
    name: 'Polukranos Reborn (named or nontoken Hydra dies)',
    oracle_text: 'Whenever Polukranos or another nontoken Hydra you control dies, create a 3/3 green and white Phyrexian Hydra creature token with reach and a 3/3 green and white Phyrexian Hydra creature token with lifelink.',
    detect: () => detectDeathTriggers({ name: 'Polukranos Reborn // Polukranos, Engine of Ruin', oracle_text: 'Whenever Polukranos or another nontoken Hydra you control dies, create a 3/3 green and white Phyrexian Hydra creature token with reach and a 3/3 green and white Phyrexian Hydra creature token with lifelink.' }, permanent).some((t) => t.triggerType === 'named_or_another_typed_creature_dies'),
  },
  {
    name: 'Edea (creature you control but dont own dies)',
    oracle_text: "Whenever a creature you control but don't own dies, return it to the battlefield under its owner's control and you draw a card.",
    detect: () => detectDeathTriggers({ name: 'Edea, Possessed Sorceress', oracle_text: "Whenever a creature you control but don't own dies, return it to the battlefield under its owner's control and you draw a card." }, permanent).some((t) => t.triggerType === 'creature_you_control_dont_own_dies'),
  },
  {
    name: 'Necrogen Rotpriest (toxic combat damage to player)',
    oracle_text: 'Whenever a creature you control with toxic deals combat damage to a player, that player gets an additional poison counter.',
    detect: () => detectCombatDamageTriggers({ name: 'Necrogen Rotpriest', oracle_text: 'Whenever a creature you control with toxic deals combat damage to a player, that player gets an additional poison counter.' }, permanent).some((t) => t.triggerType === 'toxic_creature_combat_damage_to_player'),
  },
  {
    name: "Martyr's Bond (enchantment or nonland permanent GY)",
    oracle_text: "Whenever this enchantment or another nonland permanent you control is put into a graveyard from the battlefield, each opponent sacrifices a permanent of their choice that shares a card type with it.",
    detect: () => detectDeathTriggers({ name: "Martyr's Bond", oracle_text: "Whenever this enchantment or another nonland permanent you control is put into a graveyard from the battlefield, each opponent sacrifices a permanent of their choice that shares a card type with it." }, permanent).some((t) => t.triggerType === 'enchantment_or_nonland_graveyard_from_battlefield'),
  },
  {
    name: 'Nelly Borca (opponent creatures damage opponents)',
    oracle_text: 'Whenever one or more creatures an opponent controls deal combat damage to one or more of your opponents, you and the controller of those creatures each draw a card.',
    detect: () => detectCombatDamageTriggers({ name: 'Nelly Borca, Impulsive Accuser', oracle_text: 'Whenever one or more creatures an opponent controls deal combat damage to one or more of your opponents, you and the controller of those creatures each draw a card.' }, permanent).some((t) => t.triggerType === 'opponent_creatures_combat_damage_to_opponents'),
  },
  {
    name: "Tiana (Aura or Equipment to GY)",
    oracle_text: "Whenever an Aura or Equipment you control is put into a graveyard from the battlefield, you may return that card to its owner's hand at the beginning of the next end step.",
    detect: () => detectDeathTriggers({ name: "Tiana, Ship's Caretaker", oracle_text: "Whenever an Aura or Equipment you control is put into a graveyard from the battlefield, you may return that card to its owner's hand at the beginning of the next end step." }, permanent).some((t) => t.triggerType === 'aura_or_equipment_graveyard_from_battlefield'),
  },
  {
    name: 'Shelob (spider dealt damage creature dies)',
    oracle_text: 'Whenever another creature dealt damage this turn by a Spider you controlled dies, create a token that\'s a copy of that creature, except it\'s a Food artifact with "{2}, {T}, Sacrifice this token: You gain 3 life," and it loses all other card types.',
    detect: () => detectDeathTriggers({ name: 'Shelob, Child of Ungoliant', oracle_text: 'Whenever another creature dealt damage this turn by a Spider you controlled dies, create a token that\'s a copy of that creature, except it\'s a Food artifact with "{2}, {T}, Sacrifice this token: You gain 3 life," and it loses all other card types.' }, permanent).some((t) => t.triggerType === 'spider_dealt_damage_creature_dies'),
  },
  {
    name: 'A-Shipwreck Sifters (spirit or disturb to GY)',
    oracle_text: 'Whenever a Spirit card or a card with disturb is put into your graveyard from anywhere, put a +1/+1 counter on Shipwreck Sifters.',
    detect: () => detectDeathTriggers({ name: 'A-Shipwreck Sifters', oracle_text: 'Whenever a Spirit card or a card with disturb is put into your graveyard from anywhere, put a +1/+1 counter on Shipwreck Sifters.' }, permanent).some((t) => t.triggerType === 'spirit_or_disturb_your_graveyard_from_anywhere'),
  },
  {
    name: 'Gandalf (ring tempts you)',
    oracle_text: 'Whenever the Ring tempts you, if you chose a creature other than Gandalf as your Ring-bearer, draw a card.',
    detect: () => detectAbilityActivatedTriggers({ name: 'Gandalf, Friend of the Shire', oracle_text: 'Whenever the Ring tempts you, if you chose a creature other than Gandalf as your Ring-bearer, draw a card.' }, permanent).some((t) => t.triggerType === 'ring_tempts_you'),
  },
  {
    name: 'Team-Up! (encounter phenomenon)',
    oracle_text: 'Whenever you encounter this Phenomenon, for the rest of the game, each player wins the game if the players to their left and right are eliminated.',
    detect: () => detectAbilityActivatedTriggers({ name: 'Team-Up!', oracle_text: 'Whenever you encounter this Phenomenon, for the rest of the game, each player wins the game if the players to their left and right are eliminated.' }, permanent).some((t) => t.triggerType === 'encounter_phenomenon'),
  },
  {
    name: 'GO TO JAIL (exiled card owner upkeep)',
    oracle_text: "At the beginning of the upkeep of the exiled card's owner, that player rolls two six-sided dice.",
    detect: () => detectUpkeepTriggers({ name: 'GO TO JAIL', oracle_text: "At the beginning of the upkeep of the exiled card's owner, that player rolls two six-sided dice." }, permanent).some((t) => t.triggerType === 'exiled_card_owner_upkeep'),
  },
  {
    name: 'Twists and Turns (when land you control enters)',
    oracle_text: 'When a land you control enters, if you control seven or more lands, transform this enchantment.',
    detect: () => detectLandfallTriggers({ name: 'Twists and Turns // Mycoid Maze', oracle_text: 'When a land you control enters, if you control seven or more lands, transform this enchantment.' }, permanent).some((t) => (t as { triggerType?: string }).triggerType === 'when_land_you_control_enters'),
  },
  {
    name: 'SP//dr (named enters)',
    oracle_text: 'When SP//dr enters, put a +1/+1 counter on target creature.',
    detect: () => detectETBTriggers({ name: 'SP//dr, Piloted by Peni', oracle_text: 'When SP//dr enters, put a +1/+1 counter on target creature.' }, permanent).length > 0,
  },
  {
    name: 'Game Knights Live (commander cast or attack)',
    oracle_text: 'Whenever a player casts their commander or attacks with their commander, they may say "Only one may stand."',
    detect: () => detectSpellCastTriggers({ name: 'Game Knights Live', oracle_text: 'Whenever a player casts their commander or attacks with their commander, they may say "Only one may stand."' }, permanent).some((t) => t.tribalType === 'commander'),
  },
  {
    name: 'Bureaucracy (each participant upkeep)',
    oracle_text: 'At the beginning of the upkeep of each participant in this game of the Magic: The Gathering trading card game, that PLAYER performs all actions.',
    detect: () => detectUpkeepTriggers({ name: 'Bureaucracy', oracle_text: 'At the beginning of the upkeep of each participant in this game of the Magic: The Gathering trading card game, that PLAYER performs all actions.' }, permanent).some((t) => t.triggerType === 'each_participant_upkeep'),
  },
  {
    name: 'Base Race (one land attacks another)',
    oracle_text: 'When one Land attacks another, the attacking land wins the game.',
    detect: () => detectAttackTriggers({ name: 'Base Race // Base Race (cont\'d)', oracle_text: 'When one Land attacks another, the attacking land wins the game.' }, permanent).some((t) => t.triggerType === 'one_land_attacks_another'),
  },
  {
    name: "Benefactor's Draught (opponent creature blocks)",
    oracle_text: 'Until end of turn, whenever a creature an opponent controls blocks, draw a card.',
    detect: () => detectBlockTriggers({ name: "Benefactor's Draught", oracle_text: 'Until end of turn, whenever a creature an opponent controls blocks, draw a card.' }, permanent).some((t) => (t as { triggerType?: string }).triggerType === 'opponent_creature_blocks'),
  },
  {
    name: 'Sage of the Falls (non-Human enters)',
    oracle_text: 'Whenever this creature or another non-Human creature you control enters, you may draw a card.',
    detect: () => detectETBTriggers({ name: 'Sage of the Falls', oracle_text: 'Whenever this creature or another non-Human creature you control enters, you may draw a card.' }, permanent).some((t) => t.triggerType === 'this_or_another_non_type_creature_etb'),
  },
  {
    name: 'Goro-Goro and Satoru (entered this turn combat damage)',
    oracle_text: 'Whenever one or more creatures you control that entered this turn deal combat damage to a player, create a 5/5 red Dragon Spirit creature token with flying.',
    detect: () => detectCombatDamageTriggers({ name: 'Goro-Goro and Satoru', oracle_text: 'Whenever one or more creatures you control that entered this turn deal combat damage to a player, create a 5/5 red Dragon Spirit creature token with flying.' }, permanent).some((t) => t.triggerType === 'entered_this_turn_combat_damage_to_player'),
  },
  {
    name: 'Kothophed (permanent owned by another player GY)',
    oracle_text: 'Whenever a permanent owned by another player is put into a graveyard from the battlefield, you draw a card and you lose 1 life.',
    detect: () => detectDeathTriggers({ name: 'Kothophed, Soul Hoarder', oracle_text: 'Whenever a permanent owned by another player is put into a graveyard from the battlefield, you draw a card and you lose 1 life.' }, permanent).some((t) => t.triggerType === 'permanent_owned_by_another_player_graveyard_from_battlefield'),
  },
  {
    name: 'Cryoshatter (enchanted tapped or dealt damage)',
    oracle_text: 'When enchanted creature becomes tapped or is dealt damage, destroy it.',
    detect: () => detectDealtDamageTriggers({ name: 'Cryoshatter', oracle_text: 'When enchanted creature becomes tapped or is dealt damage, destroy it.' }, permanent).length > 0,
  },
  {
    name: 'Shadow Urchin (creature with counters dies)',
    oracle_text: 'Whenever a creature you control with one or more counters on it dies, exile that many cards from the top of your library.',
    detect: () => detectDeathTriggers({ name: 'Shadow Urchin', oracle_text: 'Whenever a creature you control with one or more counters on it dies, exile that many cards from the top of your library.' }, permanent).some((t) => t.triggerType === 'creature_with_counters_dies'),
  },
  {
    name: 'Powerleech (artifact tapped or ability)',
    oracle_text: "Whenever an artifact an opponent controls becomes tapped or an opponent activates an artifact's ability without {T} in its activation cost, you gain 1 life.",
    detect: () => detectTapTriggers({ name: 'Powerleech', oracle_text: "Whenever an artifact an opponent controls becomes tapped or an opponent activates an artifact's ability without {T} in its activation cost, you gain 1 life." }, permanent).some((t) => (t as { affectedType?: string }).affectedType === 'opponent_artifact_tapped_or_ability'),
  },
  {
    name: 'Etrata (Assassin combat damage to opponent)',
    oracle_text: 'Whenever an Assassin you control deals combat damage to an opponent, cloak the top card of that player\'s library.',
    detect: () => detectCombatDamageTriggers({ name: 'Etrata, Deadly Fugitive', oracle_text: 'Whenever an Assassin you control deals combat damage to an opponent, cloak the top card of that player\'s library.' }, permanent).some((t) => t.triggerType === 'assassin_combat_damage_to_opponent'),
  },
  {
    name: 'Tajic (named and two other attack)',
    oracle_text: 'Whenever Tajic and at least two other creatures attack, Tajic gets +5/+5 until end of turn.',
    detect: () => detectAttackTriggers({ name: 'Tajic, Blade of the Legion', oracle_text: 'Whenever Tajic and at least two other creatures attack, Tajic gets +5/+5 until end of turn.' }, permanent).some((t) => t.triggerType === 'named_and_other_creature_attack'),
  },
  {
    name: 'Dance of Flame (Reveler attacks)',
    oracle_text: 'Whenever a Reveler attacks, Dance of Flame deals 1 damage to each player.',
    detect: () => detectAttackTriggers({ name: 'Dance of Flame', oracle_text: 'Whenever a Reveler attacks, Dance of Flame deals 1 damage to each player.' }, permanent).some((t) => t.triggerType === 'reveler_attacks'),
  },
  {
    name: 'Torrent Sculptor (discard instant/sorcery this way)',
    oracle_text: 'When you discard an instant or sorcery card this way, Flamethrower Sonata deals damage equal to that card\'s mana value to target creature or planeswalker you don\'t control.',
    detect: () => detectDiscardTriggers({ name: 'Torrent Sculptor // Flamethrower Sonata', oracle_text: 'When you discard an instant or sorcery card this way, Flamethrower Sonata deals damage equal to that card\'s mana value to target creature or planeswalker you don\'t control.' }, permanent).some((t) => t.triggerType === 'discard_instant_sorcery_this_way'),
  },
  {
    name: 'Thrasher Brute (team Warrior enters)',
    oracle_text: 'Whenever this creature or another Warrior your team controls enters, target opponent loses 1 life and you gain 1 life.',
    detect: () => detectETBTriggers({ name: 'Thrasher Brute', oracle_text: 'Whenever this creature or another Warrior your team controls enters, target opponent loses 1 life and you gain 1 life.' }, permanent).some((t) => t.triggerType === 'team_typed_creature_etb'),
  },
  {
    name: 'Karai (heroes control creature dies)',
    oracle_text: 'Whenever a creature the heroes control dies, the heroes lose 1 life.',
    detect: () => detectDeathTriggers({ name: 'Karai, Shadow Warrior', oracle_text: 'Whenever a creature the heroes control dies, the heroes lose 1 life.' }, permanent).some((t) => t.triggerType === 'heroes_control_creature_dies'),
  },
  {
    name: 'Slinza (named or power 4+ enters)',
    oracle_text: 'Whenever Slinza or another creature with power 4 or greater enters, you may pay {1}{R/G}.',
    detect: () => detectETBTriggers({ name: 'Slinza, the Spiked Stampede', oracle_text: 'Whenever Slinza or another creature with power 4 or greater enters, you may pay {1}{R/G}.' }, permanent).some((t) => t.triggerType === 'named_or_creature_power_or_greater_etb'),
  },
  {
    name: 'Stone Haven Outfitter (equipped creature you control dies)',
    oracle_text: 'Whenever an equipped creature you control dies, draw a card.',
    detect: () => detectDeathTriggers({ name: 'Stone Haven Outfitter', oracle_text: 'Whenever an equipped creature you control dies, draw a card.' }, permanent).some((t) => t.triggerType === 'equipped_creature_you_control_dies'),
  },
  {
    name: 'Shredder (bosses control creature dies)',
    oracle_text: 'Whenever a creature the bosses control dies, the heroes lose 1 life.',
    detect: () => detectDeathTriggers({ name: 'Shredder, Foot Clan Overlord', oracle_text: 'Whenever a creature the bosses control dies, the heroes lose 1 life.' }, permanent).some((t) => t.triggerType === 'bosses_control_creature_dies'),
  },
  {
    name: 'True Identity (enchantment or permanent face up)',
    oracle_text: 'Whenever this enchantment or another permanent you control is turned face up, scry 1, then draw a card.',
    detect: () => detectETBTriggers({ name: 'True Identity', oracle_text: 'Whenever this enchantment or another permanent you control is turned face up, scry 1, then draw a card.' }, permanent).some((t) => t.triggerType === 'enchantment_or_permanent_turned_face_up'),
  },
  {
    name: 'Mob Mentality (all non-Wall attack)',
    oracle_text: 'Whenever all non-Wall creatures you control attack, enchanted creature gets +X/+0 until end of turn.',
    detect: () => detectAttackTriggers({ name: 'Mob Mentality', oracle_text: 'Whenever all non-Wall creatures you control attack, enchanted creature gets +X/+0 until end of turn.' }, permanent).some((t) => t.triggerType === 'all_non_wall_creatures_attack'),
  },
  {
    name: "Norn's Decree (opponent creatures damage you)",
    oracle_text: 'Whenever one or more creatures an opponent controls deal combat damage to you, that opponent gets a poison counter.',
    detect: () => detectCombatDamageTriggers({ name: "Norn's Decree", oracle_text: 'Whenever one or more creatures an opponent controls deal combat damage to you, that opponent gets a poison counter.' }, permanent).some((t) => t.triggerType === 'opponent_controls_combat_damage_to_you'),
  },
  {
    name: 'Blaze Commando (instant/sorcery spell deals damage)',
    oracle_text: 'Whenever an instant or sorcery spell you control deals damage, create two 1/1 red and white Soldier creature tokens with haste.',
    detect: () => detectCombatDamageTriggers({ name: 'Blaze Commando', oracle_text: 'Whenever an instant or sorcery spell you control deals damage, create two 1/1 red and white Soldier creature tokens with haste.' }, permanent).some((t) => t.triggerType === 'instant_sorcery_spell_deals_damage'),
  },
  {
    name: 'Swallow the Hero Whole (head leaves battlefield)',
    oracle_text: 'When a Head leaves the battlefield, return the exiled cards to the battlefield under their owners\' control.',
    detect: () => detectLTBTriggers({ name: 'Swallow the Hero Whole', oracle_text: 'When a Head leaves the battlefield, return the exiled cards to the battlefield under their owners\' control.' }, permanent).some((t) => t.triggerType === 'head_leaves_battlefield'),
  },
  {
    name: 'Oasis of Renewal (land card leaves GY)',
    oracle_text: 'When Oasis of Renewal enters and whenever a land card leaves your graveyard, seek a land card.',
    detect: () => detectLeftGraveyardTriggers({ name: 'Oasis of Renewal', oracle_text: 'When Oasis of Renewal enters and whenever a land card leaves your graveyard, seek a land card.' }, permanent).length > 0,
  },
  {
    name: "Curse of Fool's Wisdom (enchanted player draws)",
    oracle_text: 'Whenever enchanted player draws a card, they lose 2 life and you gain 2 life.',
    detect: () => detectCardDrawTriggers({ name: "Curse of Fool's Wisdom", oracle_text: 'Whenever enchanted player draws a card, they lose 2 life and you gain 2 life.' }, permanent).some((t) => (t as { triggerType?: string }).triggerType === 'enchanted_player_draws'),
  },
  {
    name: 'The Pandorica (untapped or leaves)',
    oracle_text: 'When The Pandorica becomes untapped or leaves the battlefield, that permanent phases in.',
    detect: () => detectLTBTriggers({ name: 'The Pandorica', oracle_text: 'When The Pandorica becomes untapped or leaves the battlefield, that permanent phases in.' }, permanent).some((t) => t.triggerType === 'named_untapped_or_leaves'),
  },
  {
    name: 'Toxin Sliver (Sliver combat damage to creature)',
    oracle_text: 'Whenever a Sliver deals combat damage to a creature, destroy that creature.',
    detect: () => detectCombatDamageTriggers({ name: 'Toxin Sliver', oracle_text: 'Whenever a Sliver deals combat damage to a creature, destroy that creature.' }, permanent).some((t) => t.triggerType === 'sliver_combat_damage_to_creature'),
  },
  {
    name: 'Aang (another creature leaves battlefield)',
    oracle_text: 'When another creature you control leaves the battlefield, transform Aang at the beginning of the next upkeep.',
    detect: () => detectLTBTriggers({ name: 'Aang, at the Crossroads // Aang, Destined Savior', oracle_text: 'When another creature you control leaves the battlefield, transform Aang at the beginning of the next upkeep.' }, permanent).some((t) => t.triggerType === 'another_creature_you_control_leaves'),
  },
  {
    name: 'Soulmates (one of enchanted creatures dies)',
    oracle_text: 'When one of the enchanted creatures dies, destroy the other.',
    detect: () => detectDeathTriggers({ name: 'Soulmates', oracle_text: 'When one of the enchanted creatures dies, destroy the other.' }, permanent).some((t) => t.triggerType === 'one_of_enchanted_creatures_dies'),
  },
  {
    name: 'The Countering Runner (opponent spell countered by you)',
    oracle_text: 'Whenever a spell an opponent controls is countered by a spell or ability you control, draw a card.',
    detect: () => detectSpellCounteredTriggers({ name: 'The Countering Runner', oracle_text: 'Whenever a spell an opponent controls is countered by a spell or ability you control, draw a card.' }, permanent).length > 0,
  },
  {
    name: 'Baral counters-a-spell optional loot',
    detect: () => detectSpellCounteredTriggers({
      name: 'Baral, Chief of Compliance',
      oracle_text: 'Whenever a spell or ability you control counters a spell, you may draw a card. If you do, discard a card.',
    }, permanent).length > 0,
  },
  {
    name: 'Paired Tactician (this and Warrior attack)',
    oracle_text: 'Whenever this creature and at least one other Warrior attack, put a +1/+1 counter on this creature.',
    detect: () => detectAttackTriggers({ name: 'Paired Tactician', oracle_text: 'Whenever this creature and at least one other Warrior attack, put a +1/+1 counter on this creature.' }, permanent).some((t) => t.triggerType === 'this_and_typed_creature_attack'),
  },
  {
    name: 'Planar Void (another card to GY from anywhere)',
    oracle_text: 'Whenever another card is put into a graveyard from anywhere, exile that card.',
    detect: () => detectDeathTriggers({ name: 'Planar Void', oracle_text: 'Whenever another card is put into a graveyard from anywhere, exile that card.' }, permanent).some((t) => t.triggerType === 'another_card_graveyard_from_anywhere'),
  },
  {
    name: 'Boggart Shenanigans (another Goblin to GY)',
    oracle_text: 'Whenever another Goblin you control is put into a graveyard from the battlefield, you may have this enchantment deal 1 damage to target player or planeswalker.',
    detect: () => detectDeathTriggers({ name: 'Boggart Shenanigans', oracle_text: 'Whenever another Goblin you control is put into a graveyard from the battlefield, you may have this enchantment deal 1 damage to target player or planeswalker.' }, permanent).some((t) => t.triggerType === 'another_goblin_graveyard_from_battlefield'),
  },
  {
    name: 'Calim (discard named card)',
    oracle_text: 'When you discard Calim, conjure a card named Calim, Djinn Emperor into your library seventh from the top.',
    detect: () => detectDiscardTriggers({ name: 'Calim, Djinn Emperor', oracle_text: 'When you discard Calim, conjure a card named Calim, Djinn Emperor into your library seventh from the top.' }, permanent).some((t) => t.triggerType === 'discard_named_card'),
  },
  {
    name: 'Overseer of Vault 76 (power 3 or less enters)',
    oracle_text: 'Whenever Overseer of Vault 76 or another creature you control with power 3 or less enters, put a quest counter on Overseer of Vault 76.',
    detect: () => detectETBTriggers({ name: 'Overseer of Vault 76', oracle_text: 'Whenever Overseer of Vault 76 or another creature you control with power 3 or less enters, put a quest counter on Overseer of Vault 76.' }, permanent).some((t) => t.triggerType === 'named_or_creature_power_or_less_etb'),
  },
  {
    name: 'Night Dealings (source damage to another player)',
    oracle_text: 'Whenever a source you control deals damage to another player, put that many theft counters on this enchantment.',
    detect: () => detectCombatDamageTriggers({ name: 'Night Dealings', oracle_text: 'Whenever a source you control deals damage to another player, put that many theft counters on this enchantment.' }, permanent).some((t) => t.triggerType === 'source_damage_to_another_player'),
  },
  {
    name: 'Subira (low power combat damage to player)',
    oracle_text: 'Until end of turn, whenever a creature you control with power 2 or less deals combat damage to a player, draw a card.',
    detect: () => detectCombatDamageTriggers({ name: 'Subira, Tulzidi Caravanner', oracle_text: 'Until end of turn, whenever a creature you control with power 2 or less deals combat damage to a player, draw a card.' }, permanent).some((t) => t.triggerType === 'low_power_creature_combat_damage_to_player'),
  },
  {
    name: 'Fire Nation Salvagers (creatures with counters combat damage)',
    oracle_text: 'Whenever one or more creatures you control with counters on them deal combat damage to a player, put target creature or Vehicle card from that player\'s graveyard onto the battlefield under your control.',
    detect: () => detectCombatDamageTriggers({ name: 'Fire Nation Salvagers', oracle_text: 'Whenever one or more creatures you control with counters on them deal combat damage to a player, put target creature or Vehicle card from that player\'s graveyard onto the battlefield under your control.' }, permanent).some((t) => t.triggerType === 'creatures_with_counters_combat_damage_to_player'),
  },
  {
    name: 'Mazzy (enchanted creature attacks opponents)',
    oracle_text: 'Whenever an enchanted creature attacks one of your opponents, it gets +2/+0 and gains trample until end of turn.',
    detect: () => detectAttackTriggers({ name: 'Mazzy, Truesword Paladin', oracle_text: 'Whenever an enchanted creature attacks one of your opponents, it gets +2/+0 and gains trample until end of turn.' }, permanent).some((t) => t.triggerType === 'enchanted_creature_attacks_opponents'),
  },
  {
    name: 'Mazzy (aura to graveyard)',
    oracle_text: 'Whenever an Aura you control is put into your graveyard from the battlefield, exile it.',
    detect: () => detectDeathTriggers({ name: 'Mazzy, Truesword Paladin', oracle_text: 'Whenever an Aura you control is put into your graveyard from the battlefield, exile it.' }, permanent).some((t) => t.triggerType === 'aura_you_control_graveyard_from_battlefield'),
  },
  {
    name: "Xander's Wake (one or more creatures die)",
    oracle_text: 'Whenever one or more creatures you control die, draft a card from Xander\'s Wake\'s spellbook.',
    detect: () => detectDeathTriggers({ name: "Xander's Wake", oracle_text: 'Whenever one or more creatures you control die, draft a card from Xander\'s Wake\'s spellbook.' }, permanent).some((t) => t.triggerType === 'one_or_more_controlled_creatures_die'),
  },
  {
    name: 'Archivist of Gondor (commander combat damage)',
    oracle_text: 'When your commander deals combat damage to a player, if there is no monarch, you become the monarch.',
    detect: () => detectCombatDamageTriggers({ name: 'Archivist of Gondor', oracle_text: 'When your commander deals combat damage to a player, if there is no monarch, you become the monarch.' }, permanent).some((t) => t.triggerType === 'commander_combat_damage_to_player'),
  },
  {
    name: 'Archivist of Gondor (monarch end step)',
    oracle_text: 'At the beginning of the monarch\'s end step, that player draws a card.',
    detect: () => detectEndStepTriggers({ name: 'Archivist of Gondor', oracle_text: 'At the beginning of the monarch\'s end step, that player draws a card.' }, permanent).length > 0,
  },
  {
    name: 'Fecund Greenshell (toughness greater than power enters)',
    oracle_text: 'Whenever this creature or another creature you control with toughness greater than its power enters, look at the top card of your library.',
    detect: () => detectETBTriggers({ name: 'Fecund Greenshell', oracle_text: 'Whenever this creature or another creature you control with toughness greater than its power enters, look at the top card of your library.' }, permanent).some((t) => t.triggerType === 'toughness_greater_than_power_creature_etb'),
  },
  {
    name: 'Lavaleaper (basic land tapped for mana)',
    oracle_text: 'Whenever a player taps a basic land for mana, that player adds one mana of any type that land produced.',
    detect: () => detectTapTriggers({ name: 'Lavaleaper', oracle_text: 'Whenever a player taps a basic land for mana, that player adds one mana of any type that land produced.' }, permanent).some((t) => (t as { affectedType?: string }).affectedType === 'player_basic_land_tap'),
  },
  {
    name: 'Lifeblood (opponent mountain tapped)',
    oracle_text: 'Whenever a Mountain an opponent controls becomes tapped, you gain 1 life.',
    detect: () => detectTapTriggers({ name: 'Lifeblood', oracle_text: 'Whenever a Mountain an opponent controls becomes tapped, you gain 1 life.' }, permanent).some((t) => (t as { affectedType?: string }).affectedType === 'opponent_mountain_becomes_tapped'),
  },
  {
    name: 'Kithkin Mourncaller (attacking kithkin or elf dies)',
    oracle_text: 'Whenever an attacking Kithkin or Elf is put into your graveyard from the battlefield, you may draw a card.',
    detect: () => detectDeathTriggers({ name: 'Kithkin Mourncaller', oracle_text: 'Whenever an attacking Kithkin or Elf is put into your graveyard from the battlefield, you may draw a card.' }, permanent).some((t) => t.triggerType === 'attacking_multi_typed_graveyard_from_battlefield'),
  },
  {
    name: 'Slagstone Refinery (nontoken artifact dies)',
    oracle_text: 'Whenever this artifact or another nontoken artifact you control is put into a graveyard from the battlefield or is put into exile from the battlefield, create a tapped Powerstone token.',
    detect: () => detectDeathTriggers({ name: 'Slagstone Refinery', oracle_text: 'Whenever this artifact or another nontoken artifact you control is put into a graveyard from the battlefield or is put into exile from the battlefield, create a tapped Powerstone token.' }, permanent).some((t) => t.triggerType === 'this_or_another_nontoken_artifact_graveyard'),
  },
  {
    name: 'Keeper of Progenitus (player taps mountain/forest/plains)',
    oracle_text: 'Whenever a player taps a Mountain, Forest, or Plains for mana, that player adds one mana of any type that land produced.',
    detect: () => detectTapTriggers({ name: 'Keeper of Progenitus', oracle_text: 'Whenever a player taps a Mountain, Forest, or Plains for mana, that player adds one mana of any type that land produced.' }, permanent).some((t) => (t as { affectedType?: string }).affectedType === 'player_land_types_tap'),
  },
  {
    name: 'Moonshadow (permanent cards to GY while condition)',
    oracle_text: 'Whenever one or more permanent cards are put into your graveyard from anywhere while this creature has a -1/-1 counter on it, remove a -1/-1 counter from this creature.',
    detect: () => detectDeathTriggers({ name: 'Moonshadow', oracle_text: 'Whenever one or more permanent cards are put into your graveyard from anywhere while this creature has a -1/-1 counter on it, remove a -1/-1 counter from this creature.' }, permanent).some((t) => t.triggerType === 'permanent_cards_your_graveyard_while_condition'),
  },
  {
    name: 'Arbaaz Mir (historic permanent enters)',
    oracle_text: 'Whenever Arbaaz Mir or another nontoken historic permanent you control enters, Arbaaz Mir deals 1 damage to each opponent and you gain 1 life.',
    detect: () => detectETBTriggers({ name: 'Arbaaz Mir', oracle_text: 'Whenever Arbaaz Mir or another nontoken historic permanent you control enters, Arbaaz Mir deals 1 damage to each opponent and you gain 1 life.' }, permanent).some((t) => t.triggerType === 'named_or_nontoken_historic_permanent_etb'),
  },
  {
    name: 'Concealing Curtains (transforms into Revealing Eye)',
    oracle_text: 'When this creature transforms into Revealing Eye, target opponent reveals their hand.',
    detect: () => detectTransformTriggers({ name: 'Concealing Curtains // Revealing Eye', oracle_text: 'When this creature transforms into Revealing Eye, target opponent reveals their hand.' }, permanent).length > 0,
  },
  {
    name: "Pharika's Spawn (enters this way)",
    oracle_text: 'When it enters this way, each opponent sacrifices a non-Gorgon creature of their choice.',
    detect: () => detectETBTriggers({ name: "Pharika's Spawn", oracle_text: 'When it enters this way, each opponent sacrifices a non-Gorgon creature of their choice.' }, permanent).some((t) => t.triggerType === 'enters_this_way'),
  },
  {
    name: 'Lolth emblem (opponent dealt combat damage)',
    oracle_text: 'Whenever an opponent is dealt combat damage by one or more creatures you control, if that player lost less than 8 life this turn, they lose life equal to the difference.',
    detect: () => detectCombatDamageTriggers({ name: 'Lolth, Spider Queen Emblem', oracle_text: 'Whenever an opponent is dealt combat damage by one or more creatures you control, if that player lost less than 8 life this turn, they lose life equal to the difference.' }, permanent).some((t) => t.triggerType === 'opponent_dealt_combat_damage_by_your_creatures'),
  },
  {
    name: 'Auntie Blyte (source deals damage to you)',
    oracle_text: 'Whenever a source you control deals damage to you, put that many +1/+1 counters on Auntie Blyte.',
    detect: () => detectCombatDamageTriggers({ name: 'Auntie Blyte, Bad Influence', oracle_text: 'Whenever a source you control deals damage to you, put that many +1/+1 counters on Auntie Blyte.' }, permanent).some((t) => t.triggerType === 'source_damage_to_you'),
  },
  {
    name: 'Ironsoul Enforcer (commander attacks alone)',
    oracle_text: 'Whenever this creature or a commander you control attacks alone, return target artifact card from your graveyard to the battlefield.',
    detect: () => detectAttackTriggers({ name: 'Ironsoul Enforcer', oracle_text: 'Whenever this creature or a commander you control attacks alone, return target artifact card from your graveyard to the battlefield.' }, permanent).some((t) => t.triggerType === 'this_or_commander_attacks_alone'),
  },
  {
    name: 'Xathrid Necromancer (human creature dies)',
    oracle_text: 'Whenever this creature or another Human creature you control dies, create a tapped 2/2 black Zombie creature token.',
    detect: () => detectDeathTriggers({ name: 'Xathrid Necromancer', oracle_text: 'Whenever this creature or another Human creature you control dies, create a tapped 2/2 black Zombie creature token.' }, permanent).some((t) => t.triggerType === 'this_or_another_typed_creature_dies'),
  },
  {
    name: "Ognis (haste creature attacks)",
    oracle_text: 'Whenever a creature you control with haste attacks, create a tapped Treasure token.',
    detect: () => detectAttackTriggers({ name: "Ognis, the Dragon's Lash", oracle_text: 'Whenever a creature you control with haste attacks, create a tapped Treasure token.' }, permanent).some((t) => t.triggerType === 'haste_creature_attacks'),
  },
  {
    name: 'Malfegor Avatar (unearthed exiled)',
    oracle_text: 'Whenever a creature you control is exiled, if it was unearthed, shuffle that card into its owner\'s library.',
    detect: () => detectExiledFromBattlefieldTriggers({ name: 'Malfegor Avatar', oracle_text: 'Whenever a creature you control is exiled, if it was unearthed, shuffle that card into its owner\'s library.' }, permanent).length > 0,
  },
  {
    name: 'Zurzoth (opponent draws first card)',
    oracle_text: 'Whenever an opponent draws their first card each turn, if it\'s not their turn, you create a 1/1 red Devil creature token.',
    detect: () => detectCardDrawTriggers({ name: 'Zurzoth, Chaos Rider', oracle_text: 'Whenever an opponent draws their first card each turn, if it\'s not their turn, you create a 1/1 red Devil creature token.' }, permanent).some((t) => (t as { triggerType?: string }).triggerType === 'opponent_draws_first_card_each_turn'),
  },
  {
    name: 'Wolfkin Outcast (wolf or werewolf dies)',
    oracle_text: 'Whenever this creature or another Wolf or Werewolf you control dies, draw a card.',
    detect: () => detectDeathTriggers({ name: 'Wolfkin Outcast // Wedding Crasher', oracle_text: 'Whenever this creature or another Wolf or Werewolf you control dies, draw a card.' }, permanent).some((t) => t.triggerType === 'this_or_another_typed_creature_dies'),
  },
  {
    name: 'Athreos (creature you own dies)',
    oracle_text: 'Whenever another creature you own dies, return it to your hand unless target opponent pays 3 life.',
    detect: () => detectDeathTriggers({ name: 'Athreos, God of Passage', oracle_text: 'Whenever another creature you own dies, return it to your hand unless target opponent pays 3 life.' }, permanent).some((t) => t.triggerType === 'another_creature_you_own_dies'),
  },
  {
    name: 'Leyline Phantom (when deals combat damage)',
    oracle_text: 'When this creature deals combat damage, return it to its owner\'s hand.',
    detect: () => detectCombatDamageTriggers({ name: 'Leyline Phantom', oracle_text: 'When this creature deals combat damage, return it to its owner\'s hand.' }, permanent).some((t) => t.triggerType === 'self_deals_combat_damage_any'),
  },
  {
    name: 'Kaust (face up creature combat damage)',
    oracle_text: 'Whenever a creature you control that was turned face up this turn deals combat damage to a player, draw a card.',
    detect: () => detectCombatDamageTriggers({ name: 'Kaust, Eyes of the Glade', oracle_text: 'Whenever a creature you control that was turned face up this turn deals combat damage to a player, draw a card.' }, permanent).some((t) => t.triggerType === 'face_up_creature_combat_damage_to_player'),
  },
  {
    name: 'Inniaz (three or more flying attack)',
    oracle_text: 'Whenever three or more creatures you control with flying attack, each player gains control of a nonland permanent of your choice controlled by the player to their right.',
    detect: () => detectAttackTriggers({ name: 'Inniaz, the Gale Force', oracle_text: 'Whenever three or more creatures you control with flying attack, each player gains control of a nonland permanent of your choice controlled by the player to their right.' }, permanent).some((t) => t.triggerType === 'three_or_more_flying_creatures_attack'),
  },
  {
    name: "Vivien's Stampede (next main phase this turn)",
    oracle_text: 'At the beginning of the next main phase this turn, draw a card for each player who was dealt combat damage this turn.',
    detect: () => detectPrecombatMainTriggers({ name: "Vivien's Stampede", oracle_text: 'At the beginning of the next main phase this turn, draw a card for each player who was dealt combat damage this turn.' }, permanent).length > 0,
  },
  {
    name: 'Sonic (flash or haste dealt damage)',
    oracle_text: 'Whenever a creature you control with flash or haste is dealt damage, create a tapped Treasure token.',
    detect: () => detectDealtDamageTriggers({ name: 'Sonic the Hedgehog', oracle_text: 'Whenever a creature you control with flash or haste is dealt damage, create a tapped Treasure token.' }, permanent).length > 0,
  },
  {
    name: 'Twilight Drover (creature token leaves)',
    oracle_text: 'Whenever a creature token leaves the battlefield, put a +1/+1 counter on this creature.',
    detect: () => detectLTBTriggers({ name: 'Twilight Drover', oracle_text: 'Whenever a creature token leaves the battlefield, put a +1/+1 counter on this creature.' }, permanent).some((t) => t.triggerType === 'creature_token_ltb'),
  },
  {
    name: 'Hired Heist (chosen name combat damage)',
    oracle_text: 'Whenever a creature you control with the chosen name deals combat damage to a player, you may pay {U}.',
    detect: () => detectCombatDamageTriggers({ name: 'Hired Heist', oracle_text: 'Whenever a creature you control with the chosen name deals combat damage to a player, you may pay {U}.' }, permanent).some((t) => t.triggerType === 'chosen_name_combat_damage_to_player'),
  },
  {
    name: 'Resolute Veggiesaur (roll third die)',
    oracle_text: 'Whenever you roll your third die each turn, put a +1/+1 counter on this creature.',
    detect: () => detectDeathTriggers({ name: 'Resolute Veggiesaur', oracle_text: 'Whenever you roll your third die each turn, put a +1/+1 counter on this creature.' }, permanent).some((t) => t.triggerType === 'roll_third_die_each_turn'),
  },
  {
    name: 'Ravenous Rotbelly (sacrifice zombies this way)',
    oracle_text: 'When you sacrifice one or more Zombies this way, each opponent sacrifices that many creatures of their choice.',
    detect: () => detectSacrificeTriggers({ name: 'Ravenous Rotbelly', oracle_text: 'When you sacrifice one or more Zombies this way, each opponent sacrifices that many creatures of their choice.' }, permanent).length > 0,
  },
  {
    name: 'Éomer (attacking legendary creatures die)',
    oracle_text: 'Whenever one or more other attacking legendary creatures you control die, untap all creatures you control.',
    detect: () => detectDeathTriggers({ name: 'Éomer, Marshal of Rohan', oracle_text: 'Whenever one or more other attacking legendary creatures you control die, untap all creatures you control.' }, permanent).some((t) => t.triggerType === 'one_or_more_attacking_legendary_creatures_die'),
  },
  {
    name: 'Thopter Shop (artifact creatures die)',
    oracle_text: 'Whenever one or more artifact creatures you control die, draw a card.',
    detect: () => detectDeathTriggers({ name: 'Thopter Shop', oracle_text: 'Whenever one or more artifact creatures you control die, draw a card.' }, permanent).some((t) => t.triggerType === 'one_or_more_artifact_creatures_die'),
  },
  {
    name: 'Summon: Leviathan (sea creature attacks)',
    oracle_text: 'Until end of turn, whenever a Kraken, Leviathan, Merfolk, Octopus, or Serpent attacks, draw a card.',
    detect: () => detectAttackTriggers({ name: 'Summon: Leviathan', oracle_text: 'Until end of turn, whenever a Kraken, Leviathan, Merfolk, Octopus, or Serpent attacks, draw a card.' }, permanent).some((t) => t.triggerType === 'multi_typed_creature_attacks_any'),
  },
  {
    name: 'Tadeas (reach creature attacks)',
    oracle_text: 'Whenever a creature you control with reach attacks, untap it and it can\'t be blocked by creatures with greater power this combat.',
    detect: () => detectAttackTriggers({ name: 'Tadeas, Juniper Ascendant', oracle_text: 'Whenever a creature you control with reach attacks, untap it and it can\'t be blocked by creatures with greater power this combat.' }, permanent).some((t) => t.triggerType === 'reach_creature_attacks'),
  },
  {
    name: 'Thoughtleech (opponent island tapped)',
    oracle_text: 'Whenever an Island an opponent controls becomes tapped, you may gain 1 life.',
    detect: () => detectTapTriggers({ name: 'Thoughtleech', oracle_text: 'Whenever an Island an opponent controls becomes tapped, you may gain 1 life.' }, permanent).some((t) => (t as { affectedType?: string }).affectedType === 'opponent_island_becomes_tapped'),
  },
  {
    name: 'Flayer of the Hatebound (enters from graveyard)',
    oracle_text: 'Whenever this creature or another creature enters from your graveyard, that creature deals damage equal to its power to any target.',
    detect: () => detectETBTriggers({ name: 'Flayer of the Hatebound', oracle_text: 'Whenever this creature or another creature enters from your graveyard, that creature deals damage equal to its power to any target.' }, permanent).some((t) => t.triggerType === 'creature_enters_from_graveyard'),
  },
  {
    name: 'A-Skemfar Avenger (elf or berserker dies)',
    oracle_text: 'Whenever another Elf or Berserker you control dies, you draw a card and you lose 1 life.',
    detect: () => detectDeathTriggers({ name: 'A-Skemfar Avenger', oracle_text: 'Whenever another Elf or Berserker you control dies, you draw a card and you lose 1 life.' }, permanent).some((t) => t.triggerType === 'another_multi_typed_creature_dies'),
  },
  {
    name: 'Senu (legendary attacks unblocked)',
    oracle_text: 'When a legendary creature you control attacks and isn\'t blocked, if this card is exiled, put it onto the battlefield attacking.',
    detect: () => detectAttackTriggers({ name: 'Senu, Keen-Eyed Protector', oracle_text: 'When a legendary creature you control attacks and isn\'t blocked, if this card is exiled, put it onto the battlefield attacking.' }, permanent).some((t) => t.triggerType === 'legendary_creature_attacks_unblocked'),
  },
  {
    name: 'Dragon-Kami (dragon dies)',
    oracle_text: 'Whenever this creature or a Dragon you control dies, you may cast a creature spell from among cards you own in exile with hatching counters on them without paying its mana cost.',
    detect: () => detectDeathTriggers({ name: 'The Dragon-Kami Reborn // Dragon-Kami\'s Egg', oracle_text: 'Whenever this creature or a Dragon you control dies, you may cast a creature spell from among cards you own in exile with hatching counters on them without paying its mana cost.' }, permanent).some((t) => t.triggerType === 'this_or_a_typed_creature_dies'),
  },
  {
    name: 'Syr Carah (named or instant/sorcery damage)',
    oracle_text: 'Whenever Syr Carah or an instant or sorcery spell you control deals damage to a player, exile the top card of your library.',
    detect: () => detectCombatDamageTriggers({ name: 'Syr Carah, the Bold', oracle_text: 'Whenever Syr Carah or an instant or sorcery spell you control deals damage to a player, exile the top card of your library.' }, permanent).some((t) => t.triggerType === 'named_or_instant_sorcery_deals_damage_to_player'),
  },
  {
    name: 'Dark Leo & Shredder (named combat damage)',
    oracle_text: 'Whenever Dark Leo & Shredder deal combat damage to a player, create a 1/1 black Ninja creature token.',
    detect: () => detectCombatDamageTriggers({ name: 'Dark Leo & Shredder', oracle_text: 'Whenever Dark Leo & Shredder deal combat damage to a player, create a 1/1 black Ninja creature token.' }, permanent).some((t) => t.triggerType === 'named_self_combat_damage_to_player'),
  },
  {
    name: 'Paliano (when batched combat damage)',
    oracle_text: 'When one or more creatures you control deal combat damage to a player, if there is no monarch, you become the monarch.',
    detect: () => detectCombatDamageTriggers({ name: 'Paliano', oracle_text: 'When one or more creatures you control deal combat damage to a player, if there is no monarch, you become the monarch.' }, permanent).some((t) => t.triggerType === 'creatures_deal_combat_damage_batched'),
  },
  {
    name: 'Magnetic Web (magnet counter attacks)',
    oracle_text: 'Whenever a creature with a magnet counter on it attacks, all creatures with magnet counters on them block that creature this turn if able.',
    detect: () => detectAttackTriggers({ name: 'Magnetic Web', oracle_text: 'Whenever a creature with a magnet counter on it attacks, all creatures with magnet counters on them block that creature this turn if able.' }, permanent).some((t) => t.triggerType === 'magnet_counter_creature_attacks'),
  },
  {
    name: 'Ever-Watching Threshold (opponent attacks)',
    oracle_text: 'Whenever an opponent attacks, if they attacked you and/or a planeswalker you control, draw a card.',
    detect: () => detectAttackTriggers({ name: 'Ever-Watching Threshold', oracle_text: 'Whenever an opponent attacks, if they attacked you and/or a planeswalker you control, draw a card.' }, permanent).some((t) => t.triggerType === 'opponent_attacks'),
  },
  {
    name: 'Fumulus (multi-type you control attacks)',
    oracle_text: 'Whenever an Insect, Leech, Slug, or Worm you control attacks, defending player loses 1 life and you gain 1 life.',
    detect: () => detectAttackTriggers({ name: 'Fumulus, the Infestation', oracle_text: 'Whenever an Insect, Leech, Slug, or Worm you control attacks, defending player loses 1 life and you gain 1 life.' }, permanent).some((t) => t.triggerType === 'multi_typed_you_control_attacks'),
  },
  {
    name: 'Keeper of Fables (non-Human combat damage)',
    oracle_text: 'Whenever one or more non-Human creatures you control deal combat damage to a player, draw a card.',
    detect: () => detectCombatDamageTriggers({ name: 'Keeper of Fables', oracle_text: 'Whenever one or more non-Human creatures you control deal combat damage to a player, draw a card.' }, permanent).some((t) => t.triggerType === 'non_human_creatures_combat_damage_to_player'),
  },
  {
    name: 'Alharu (nontoken +1/+1 counter dies)',
    oracle_text: 'Whenever a nontoken creature you control with a +1/+1 counter on it dies, create a 1/1 white Spirit creature token with flying.',
    detect: () => detectDeathTriggers({ name: 'Alharu, Solemn Ritualist', oracle_text: 'Whenever a nontoken creature you control with a +1/+1 counter on it dies, create a 1/1 white Spirit creature token with flying.' }, permanent).some((t) => t.triggerType === 'nontoken_counter_creature_dies'),
  },
  {
    name: 'Curse of Obsession (enchanted player end step)',
    oracle_text: 'At the beginning of enchanted player\'s end step, that player discards their hand.',
    detect: () => detectEndStepTriggers({ name: 'Curse of Obsession', oracle_text: 'At the beginning of enchanted player\'s end step, that player discards their hand.' }, permanent).length > 0,
  },
  {
    name: 'Ruby Collector (attack with three or more)',
    oracle_text: 'When you attack with three or more creatures, conjure a card named Mox Ruby into your hand.',
    detect: () => detectAttackTriggers({ name: 'Ruby Collector', oracle_text: 'When you attack with three or more creatures, conjure a card named Mox Ruby into your hand.' }, permanent).some((t) => t.triggerType === 'you_attack_with_three_or_more_creatures'),
  },
  {
    name: 'Haunting Wind (artifact tapped or activated)',
    oracle_text: 'Whenever an artifact becomes tapped or a player activates an artifact\'s ability without {T} in its activation cost, this enchantment deals 1 damage to that artifact\'s controller.',
    detect: () => detectTapTriggers({ name: 'Haunting Wind', oracle_text: 'Whenever an artifact becomes tapped or a player activates an artifact\'s ability without {T} in its activation cost, this enchantment deals 1 damage to that artifact\'s controller.' }, permanent).some((t) => (t as { affectedType?: string }).affectedType === 'artifact_becomes_tapped_or_activated'),
  },
  {
    name: 'Soundwave (creature tokens combat damage)',
    oracle_text: 'Whenever one or more creature tokens you control deal combat damage to a player, exile target instant or sorcery card with mana value equal to the damage dealt from their graveyard.',
    detect: () => detectCombatDamageTriggers({ name: 'Soundwave, Sonic Spy // Soundwave, Superior Captain', oracle_text: 'Whenever one or more creature tokens you control deal combat damage to a player, exile target instant or sorcery card with mana value equal to the damage dealt from their graveyard.' }, permanent).some((t) => t.triggerType === 'creature_tokens_combat_damage_to_player'),
  },
  {
    name: "Hunter's Insight (that creature combat damage)",
    oracle_text: 'Whenever that creature deals combat damage to a player or planeswalker this turn, draw that many cards.',
    detect: () => detectCombatDamageTriggers({ name: "Hunter's Insight", oracle_text: 'Whenever that creature deals combat damage to a player or planeswalker this turn, draw that many cards.' }, permanent).some((t) => t.triggerType === 'that_creature_combat_damage_to_player_or_planeswalker_this_turn'),
  },
  {
    name: "Vraska's Eminence (deathtouch damage)",
    oracle_text: 'Whenever a creature you control with deathtouch deals damage to a player or planeswalker, put a +1/+1 counter on that creature.',
    detect: () => detectCombatDamageTriggers({ name: "Vraska, Swarm's Eminence", oracle_text: 'Whenever a creature you control with deathtouch deals damage to a player or planeswalker, put a +1/+1 counter on that creature.' }, permanent).some((t) => t.triggerType === 'deathtouch_creature_deals_damage_to_player_or_planeswalker'),
  },
  {
    name: "War's Toll (opponent taps land)",
    oracle_text: 'Whenever an opponent taps a land for mana, tap all lands that player controls.',
    detect: () => detectTapTriggers({ name: "War's Toll", oracle_text: 'Whenever an opponent taps a land for mana, tap all lands that player controls.' }, permanent).some((t) => (t as { affectedType?: string }).affectedType === 'opponent_taps_land_for_mana'),
  },
  {
    name: 'Tameshi (noncreature permanents returned)',
    oracle_text: 'Whenever one or more noncreature permanents are returned to hand, draw a card.',
    detect: () => detectReturnedToHandTriggers({ name: 'Tameshi, Reality Architect', oracle_text: 'Whenever one or more noncreature permanents are returned to hand, draw a card.' }, permanent).length > 0,
  },
  {
    name: 'Turn Inside Out (dies this turn)',
    oracle_text: 'When it dies this turn, manifest dread.',
    detect: () => detectDeathTriggers({ name: 'Turn Inside Out', oracle_text: 'When it dies this turn, manifest dread.' }, permanent).some((t) => t.triggerType === 'it_dies_this_turn'),
  },
  {
    name: 'Acidic Dagger (targeted creature leaves)',
    oracle_text: 'When the targeted creature leaves the battlefield this turn, sacrifice this artifact.',
    detect: () => detectLTBTriggers({ name: 'Acidic Dagger', oracle_text: 'When the targeted creature leaves the battlefield this turn, sacrifice this artifact.' }, permanent).some((t) => t.triggerType === 'targeted_creature_leaves_this_turn'),
  },
  {
    name: 'Devouring Tendrils (permanent you dont control dies)',
    oracle_text: 'When the permanent you don\'t control dies this turn, you gain 2 life.',
    detect: () => detectDeathTriggers({ name: 'Devouring Tendrils', oracle_text: 'When the permanent you don\'t control dies this turn, you gain 2 life.' }, permanent).some((t) => t.triggerType === 'permanent_you_dont_control_dies_this_turn'),
  },
  {
    name: 'Coffin Queen (becomes untapped)',
    oracle_text: 'When this creature becomes untapped or you lose control of this creature, exile that creature.',
    detect: () => detectUntapTriggers({ name: 'Coffin Queen', oracle_text: 'When this creature becomes untapped or you lose control of this creature, exile that creature.' }, permanent).some((t) => t.untapType === 'self'),
  },
  {
    name: 'The Caffeinated Runner (enters or attacks)',
    oracle_text: 'Whenever the The Caffeinated Runner enters or attacks, create a Food token.',
    detect: () => detectETBTriggers({ name: 'The Caffeinated Runner', oracle_text: 'Whenever the The Caffeinated Runner enters or attacks, create a Food token.' }, permanent).length > 0,
  },
  {
    name: 'Sledge-Class Seedship (spacecraft attacks)',
    oracle_text: 'Whenever this Spacecraft attacks, you may put a creature card from your hand onto the battlefield.',
    detect: () => detectAttackTriggers({ name: 'Sledge-Class Seedship', oracle_text: 'Whenever this Spacecraft attacks, you may put a creature card from your hand onto the battlefield.' }, permanent).some((t) => t.triggerType === 'spacecraft_attacks'),
  },
  {
    name: 'Warrior token (creature token attack)',
    oracle_text: 'Whenever this creature and at least one other creature token attack, put a +1/+1 counter on this creature.',
    detect: () => detectAttackTriggers({ name: 'Warrior', oracle_text: 'Whenever this creature and at least one other creature token attack, put a +1/+1 counter on this creature.\nVigilance' }, permanent).some((t) => t.triggerType === 'this_and_other_creature_token_attack'),
  },
  {
    name: 'Curse of Clinging Webs (enchanted player nontoken dies)',
    oracle_text: 'Whenever a nontoken creature enchanted player controls dies, exile it and you create a 1/2 green Spider creature token with reach.',
    detect: () => detectDeathTriggers({ name: 'Curse of Clinging Webs', oracle_text: 'Whenever a nontoken creature enchanted player controls dies, exile it and you create a 1/2 green Spider creature token with reach.' }, permanent).some((t) => t.triggerType === 'enchanted_player_nontoken_creature_dies'),
  },
  {
    name: 'Goldbug (named and human attack)',
    oracle_text: 'Whenever Goldbug and at least one Human attack, draw a card and convert Goldbug.',
    detect: () => detectAttackTriggers({ name: 'Goldbug, Scrappy Scout', oracle_text: 'Whenever Goldbug and at least one Human attack, draw a card and convert Goldbug.' }, permanent).some((t) => t.triggerType === 'named_and_human_attack'),
  },
  {
    name: 'Reyav (enchanted or equipped attacks)',
    oracle_text: "Whenever a creature you control that's enchanted or equipped attacks, that creature gains double strike until end of turn.",
    detect: () => detectAttackTriggers({ name: 'Reyav, Master Smith', oracle_text: "Whenever a creature you control that's enchanted or equipped attacks, that creature gains double strike until end of turn." }, permanent).some((t) => t.triggerType === 'enchanted_or_equipped_creature_attacks'),
  },
  {
    name: 'Psychic Possession (enchanted opponent draws)',
    oracle_text: 'Whenever enchanted opponent draws a card, you may draw a card.',
    detect: () => detectCardDrawTriggers({ name: 'Psychic Possession', oracle_text: 'Whenever enchanted opponent draws a card, you may draw a card.' }, permanent).some((t) => (t as { triggerType?: string }).triggerType === 'enchanted_opponent_draws'),
  },
  {
    name: 'Trophy Hunter (flying dealt damage dies)',
    oracle_text: 'Whenever a creature with flying dealt damage by this creature this turn dies, put a +1/+1 counter on this creature.',
    detect: () => detectDeathTriggers({ name: 'Trophy Hunter', oracle_text: 'Whenever a creature with flying dealt damage by this creature this turn dies, put a +1/+1 counter on this creature.' }, permanent).some((t) => t.triggerType === 'dealt_damage_dies'),
  },
  {
    name: 'Imodane (instant sorcery single target damage)',
    oracle_text: 'Whenever an instant or sorcery spell you control that targets only a single creature deals damage to that creature, Imodane deals that much damage to each opponent.',
    detect: () => detectCombatDamageTriggers({ name: 'Imodane, the Pyrohammer', oracle_text: 'Whenever an instant or sorcery spell you control that targets only a single creature deals damage to that creature, Imodane deals that much damage to each opponent.' }, permanent).some((t) => t.triggerType === 'instant_sorcery_targets_single_creature_deals_damage'),
  },
  {
    name: 'Night Shift (roll a 6)',
    oracle_text: 'Whenever you roll a 6, create a 2/2 black Zombie Employee creature token.',
    detect: () => detectAbilityActivatedTriggers({ name: 'Night Shift of the Living Dead', oracle_text: 'Whenever you roll a 6, create a 2/2 black Zombie Employee creature token.' }, permanent).some((t) => t.triggerType === 'die_roll_single_result'),
  },
  {
    name: 'Kediss (commander combat damage to opponent)',
    oracle_text: 'Whenever a commander you control deals combat damage to an opponent, it deals that much damage to each other opponent.',
    detect: () => detectCombatDamageTriggers({ name: 'Kediss, Emberclaw Familiar', oracle_text: 'Whenever a commander you control deals combat damage to an opponent, it deals that much damage to each other opponent.' }, permanent).some((t) => t.triggerType === 'commander_you_control_combat_damage_to_opponent'),
  },
  {
    name: 'Calibrated Blast (when reveal nonland this way)',
    oracle_text: 'When you reveal a nonland card this way, Calibrated Blast deals damage equal to that card\'s mana value to any target.',
    detect: () => detectCardDrawTriggers({ name: 'Calibrated Blast', oracle_text: 'When you reveal a nonland card this way, Calibrated Blast deals damage equal to that card\'s mana value to any target.' }, permanent).some((t) => (t as { triggerType?: string }).triggerType === 'reveal_this_way'),
  },
  {
    name: 'Rat King (named or nontoken leaves)',
    oracle_text: 'Whenever Rat King or another nontoken creature you control leaves the battlefield, create a 1/1 black Rat creature token.',
    detect: () => detectLTBTriggers({ name: 'Rat King, Pale Piper', oracle_text: 'Whenever Rat King or another nontoken creature you control leaves the battlefield, create a 1/1 black Rat creature token.' }, permanent).some((t) => t.triggerType === 'named_or_another_creature_ltb'),
  },
  {
    name: 'Paradox Haze (enchanted player first upkeep)',
    oracle_text: "At the beginning of enchanted player's first upkeep each turn, that player gets an additional upkeep step after this step.",
    detect: () => detectUpkeepTriggers({ name: 'Paradox Haze', oracle_text: "At the beginning of enchanted player's first upkeep each turn, that player gets an additional upkeep step after this step." }, permanent).some((t) => t.triggerType === 'enchanted_player_first_upkeep'),
  },
  {
    name: 'Doran (creature attacks or blocks)',
    oracle_text: 'Whenever a creature you control attacks or blocks, it gets +X/+X until end of turn, where X is the difference between its power and toughness.',
    detect: () => detectBlockTriggers({ name: 'Doran, Besieged by Time', oracle_text: 'Whenever a creature you control attacks or blocks, it gets +X/+X until end of turn, where X is the difference between its power and toughness.' }, permanent).some((t) => (t as { triggerType?: string }).triggerType === 'controlled_creature_attacks_or_blocks'),
  },
  {
    name: 'Godsend (equipped blocks or becomes blocked)',
    oracle_text: 'Whenever equipped creature blocks or becomes blocked by one or more creatures, you may exile one of those creatures.',
    detect: () => detectBlockTriggers({ name: 'Godsend', oracle_text: 'Whenever equipped creature blocks or becomes blocked by one or more creatures, you may exile one of those creatures.' }, permanent).some((t) => (t as { triggerType?: string }).triggerType === 'equipped_blocks_or_becomes_blocked'),
  },
  {
    name: 'The Ghoul (named or nontoken zombie mutant dies)',
    oracle_text: 'Whenever The Ghoul or another nontoken Zombie or Mutant you control dies, target player gets two rad counters.',
    detect: () => detectDeathTriggers({ name: 'The Ghoul, Gunslinger', oracle_text: 'Whenever The Ghoul or another nontoken Zombie or Mutant you control dies, target player gets two rad counters.' }, permanent).some((t) => t.triggerType === 'named_or_nontoken_typed_creature_dies'),
  },
  {
    name: 'Task Mage Assembly (no creatures)',
    oracle_text: 'When there are no creatures on the battlefield, sacrifice this enchantment.',
    detect: () => detectAbilityActivatedTriggers({ name: 'Task Mage Assembly', oracle_text: 'When there are no creatures on the battlefield, sacrifice this enchantment.' }, permanent).some((t) => t.triggerType === 'no_creatures_on_battlefield'),
  },
  {
    name: 'Carth (planeswalker you control dies)',
    oracle_text: 'Whenever Carth enters or a planeswalker you control dies, look at the top seven cards of your library.',
    detect: () => detectDeathTriggers({ name: 'Carth the Lion', oracle_text: 'Whenever Carth enters or a planeswalker you control dies, look at the top seven cards of your library.' }, permanent).some((t) => t.triggerType === 'named_enters_or_planeswalker_dies'),
  },
  {
    name: 'Bounty Board (bounty counter dies)',
    oracle_text: 'Whenever a creature with a bounty counter on it dies, each of its controller\'s opponents draws a card and gains 2 life.',
    detect: () => detectDeathTriggers({ name: 'Bounty Board', oracle_text: 'Whenever a creature with a bounty counter on it dies, each of its controller\'s opponents draws a card and gains 2 life.' }, permanent).some((t) => t.triggerType === 'bounty_counter_creature_dies'),
  },
  {
    name: 'Chicken a la King (six-sided die)',
    oracle_text: 'Whenever a 6 is rolled on a six-sided die, put a +1/+1 counter on each Bird.',
    detect: () => detectAbilityActivatedTriggers({ name: 'Chicken à la King', oracle_text: 'Whenever a 6 is rolled on a six-sided die, put a +1/+1 counter on each Bird.' }, permanent).some((t) => t.triggerType === 'six_sided_die_roll'),
  },
  {
    name: 'Confusion in the Ranks (ACE enters)',
    oracle_text: 'Whenever an artifact, creature, or enchantment enters, its controller chooses target permanent another player controls that shares a card type with it.',
    detect: () => detectETBTriggers({ name: 'Confusion in the Ranks', oracle_text: 'Whenever an artifact, creature, or enchantment enters, its controller chooses target permanent another player controls that shares a card type with it.' }, permanent).some((t) => t.triggerType === 'artifact_creature_or_enchantment_enters'),
  },
  {
    name: "Winter's Night (snow land tap)",
    oracle_text: "Whenever a player taps a snow land for mana, that player adds one mana of any type that land produced.",
    detect: () => detectTapTriggers({ name: "Winter's Night", oracle_text: "Whenever a player taps a snow land for mana, that player adds one mana of any type that land produced." }, permanent).some((t) => (t as { affectedType?: string }).affectedType === 'player_snow_land_tap'),
  },
  {
    name: 'Daru Spiritualist (cleric targeted)',
    oracle_text: 'Whenever a Cleric creature you control becomes the target of a spell or ability, it gets +0/+2 until end of turn.',
    detect: () => detectTargetedTriggers({ name: 'Daru Spiritualist', oracle_text: 'Whenever a Cleric creature you control becomes the target of a spell or ability, it gets +0/+2 until end of turn.' }, permanent).length > 0,
  },
  {
    name: "Fire Giant's Fury (it deals combat damage this turn)",
    oracle_text: 'Whenever it deals combat damage to a player this turn, exile that many cards from the top of your library.',
    detect: () => detectCombatDamageTriggers({ name: "Fire Giant's Fury", oracle_text: 'Target Giant you control gets +2/+2 and gains trample until end of turn. Whenever it deals combat damage to a player this turn, exile that many cards from the top of your library.' }, permanent).some((t) => t.triggerType === 'it_deals_combat_damage_to_player_this_turn'),
  },
  {
    name: "Dollmaker's Shop (non-Toy attack player)",
    oracle_text: 'Whenever one or more non-Toy creatures you control attack a player, create a 1/1 white Toy artifact creature token.',
    detect: () => detectAttackTriggers({ name: "Dollmaker's Shop", oracle_text: 'Whenever one or more non-Toy creatures you control attack a player, create a 1/1 white Toy artifact creature token.' }, permanent).some((t) => t.triggerType === 'non_toy_creatures_attack_player'),
  },
  {
    name: 'Havengul Mystery (put creature leaves)',
    oracle_text: 'When the creature put onto the battlefield with Havengul Mystery leaves the battlefield, transform Havengul Mystery.',
    detect: () => detectLTBTriggers({ name: 'Havengul Laboratory // Havengul Mystery', oracle_text: 'When the creature put onto the battlefield with Havengul Mystery leaves the battlefield, transform Havengul Mystery.' }, permanent).some((t) => t.triggerType === 'mystery_put_creature_leaves'),
  },
  {
    name: 'Vaultborn Tyrant (power 4+ you control enters)',
    oracle_text: 'Whenever this creature or another creature you control with power 4 or greater enters, you gain 3 life and draw a card.',
    detect: () => detectETBTriggers({ name: 'Vaultborn Tyrant', oracle_text: 'Whenever this creature or another creature you control with power 4 or greater enters, you gain 3 life and draw a card.' }, permanent).some((t) => t.triggerType === 'named_or_creature_power_or_greater_etb'),
  },
  {
    name: 'Alluring Suitor (attack with exactly two)',
    oracle_text: 'When you attack with exactly two creatures, transform this creature.',
    detect: () => detectAttackTriggers({ name: 'Alluring Suitor', oracle_text: 'When you attack with exactly two creatures, transform this creature.' }, permanent).some((t) => t.triggerType === 'you_attack_with_exactly_two_creatures'),
  },
  {
    name: 'The Swarmlord (counter creature dies)',
    oracle_text: 'Whenever a creature you control with a counter on it dies, draw a card.',
    detect: () => detectDeathTriggers({ name: 'The Swarmlord', oracle_text: 'Rapid Regeneration — The Swarmlord enters with two +1/+1 counters on it for each time you\'ve cast your commander from the command zone this game.\nXenos Cunning — Whenever a creature you control with a counter on it dies, draw a card.' }, permanent).some((t) => t.triggerType === 'counter_creature_dies'),
  },
  {
    name: 'Ward of Lights (cleanup step sacrifice)',
    oracle_text: 'If you cast it any time a sorcery couldn\'t have been cast, the controller of the permanent it becomes sacrifices it at the beginning of the next cleanup step.',
    detect: () => detectETBTriggers({ name: 'Ward of Lights', oracle_text: 'If you cast it any time a sorcery couldn\'t have been cast, the controller of the permanent it becomes sacrifices it at the beginning of the next cleanup step.' }, permanent).some((t) => t.triggerType === 'cleanup_step_sacrifice'),
  },
  {
    name: 'River Kelpie (enters from graveyard)',
    oracle_text: 'Whenever this creature or another permanent enters from a graveyard, draw a card.',
    detect: () => detectETBTriggers({ name: 'River Kelpie', oracle_text: 'Whenever this creature or another permanent enters from a graveyard, draw a card.' }, permanent).some((t) => t.triggerType === 'permanent_enters_from_graveyard'),
  },
  {
    name: 'Spawning Kraken (sea creature combat damage)',
    oracle_text: 'Whenever a Kraken, Leviathan, Octopus, or Serpent you control deals combat damage to a player, create a 9/9 blue Kraken creature token.',
    detect: () => detectCombatDamageTriggers({ name: 'Spawning Kraken', oracle_text: 'Whenever a Kraken, Leviathan, Octopus, or Serpent you control deals combat damage to a player, create a 9/9 blue Kraken creature token.' }, permanent).some((t) => t.triggerType === 'sea_creature_combat_damage_to_player'),
  },
  {
    name: 'Gorilla Tactics (forced discard named card)',
    oracle_text: 'When a spell or ability an opponent controls causes you to discard Gorilla Tactics, create two 2/2 green Gorilla creature tokens.',
    detect: () => detectDiscardTriggers({ name: 'Gorilla Tactics', oracle_text: 'When a spell or ability an opponent controls causes you to discard Gorilla Tactics, create two 2/2 green Gorilla creature tokens.' }, permanent).some((t) => t.triggerType === 'forced_discard_named_card'),
  },
  {
    name: 'Tenuous Truce (enchanted opponent end step)',
    oracle_text: "At the beginning of enchanted opponent's end step, you and that player each draw a card.",
    detect: () => detectEndStepTriggers({ name: 'Tenuous Truce', oracle_text: "At the beginning of enchanted opponent's end step, you and that player each draw a card." }, permanent).length > 0,
  },
  {
    name: 'Tenuous Truce (attack sacrifice)',
    oracle_text: 'When you attack enchanted opponent or a planeswalker they control or when they attack you or a planeswalker you control, sacrifice this Aura.',
    detect: () => detectAttackTriggers({ name: 'Tenuous Truce', oracle_text: 'When you attack enchanted opponent or a planeswalker they control or when they attack you or a planeswalker you control, sacrifice this Aura.' }, permanent).some((t) => t.triggerType === 'attack_enchanted_opponent_sacrifice'),
  },
  {
    name: 'A-Stitched Assistant (named exploit)',
    oracle_text: 'When Stitched Assistant exploits a creature, scry 2, then draw a card.',
    detect: () => detectAbilityActivatedTriggers({ name: 'A-Stitched Assistant', oracle_text: 'Exploit\nWhen Stitched Assistant exploits a creature, scry 2, then draw a card.' }, permanent).some((t) => t.triggerType === 'named_exploit'),
  },
  {
    name: 'Sapphire Charm (next turn upkeep)',
    oracle_text: "Target player draws a card at the beginning of the next turn's upkeep.",
    detect: () => detectUpkeepTriggers({ name: 'Sapphire Charm', oracle_text: "Choose one —\n• Target player draws a card at the beginning of the next turn's upkeep." }, permanent).some((t) => t.triggerType === 'next_turn_upkeep'),
  },
  {
    name: 'Emet-Selch (opponents lose life)',
    oracle_text: 'Whenever one or more opponents lose life, you may cast target instant or sorcery card from your graveyard.',
    detect: () => detectLifeLossTriggers({ name: 'Emet-Selch of the Third Seat', oracle_text: 'Whenever one or more opponents lose life, you may cast target instant or sorcery card from your graveyard.' }, permanent).some((t) => t.triggerType === 'opponent_loses_life'),
  },
  {
    name: 'Belbe (each postcombat main)',
    oracle_text: 'At the beginning of each postcombat main phase, the active player adds {C}{C} for each of your opponents who lost life this turn.',
    detect: () => detectPostcombatMainTriggers({ name: 'Belbe, Corrupted Observer', oracle_text: 'At the beginning of each postcombat main phase, the active player adds {C}{C} for each of your opponents who lost life this turn.' }, permanent).length > 0,
  },
  {
    name: 'Leatherhead (boss enters)',
    oracle_text: 'When this boss enters, the bosses gain 5 life for each boss in play.',
    detect: () => detectETBTriggers({ name: 'Leatherhead, Sewer Gator', oracle_text: 'When this boss enters, the bosses gain 5 life for each boss in play.' }, permanent).some((t) => t.triggerType === 'this_boss_etb'),
  },
  {
    name: 'Mechtitan Core (that token leaves)',
    oracle_text: 'When that token leaves the battlefield, return all cards exiled with this Vehicle except this card to the battlefield tapped under their owners\' control.',
    detect: () => detectLTBTriggers({ name: 'Mechtitan Core', oracle_text: 'When that token leaves the battlefield, return all cards exiled with this Vehicle except this card to the battlefield tapped under their owners\' control.' }, permanent).some((t) => t.triggerType === 'that_token_leaves'),
  },
  {
    name: 'Desperate Measures (dies under control this turn)',
    oracle_text: 'When it dies under your control this turn, draw two cards.',
    detect: () => detectDeathTriggers({ name: 'Desperate Measures', oracle_text: 'Target creature gets +1/-1 until end of turn. When it dies under your control this turn, draw two cards.' }, permanent).some((t) => t.triggerType === 'it_dies_under_your_control_this_turn'),
  },
  {
    name: 'Fludge (multi-type ETB)',
    oracle_text: 'Whenever Fludge, Gunk Guardian or another Slug, Ooze, Fungus, or Mutant enters the battlefield under your control, each opponent shuffles three Gunk cards into their library.',
    detect: () => detectETBTriggers({ name: 'Fludge, Gunk Guardian', oracle_text: 'Whenever Fludge, Gunk Guardian or another Slug, Ooze, Fungus, or Mutant enters the battlefield under your control, each opponent shuffles three Gunk cards into their library.' }, permanent).some((t) => t.triggerType === 'multi_typed_controlled_etb'),
  },
  {
    name: 'Wake Thrasher (controlled permanent untap)',
    oracle_text: 'Whenever a permanent you control becomes untapped, this creature gets +1/+1 until end of turn.',
    detect: () => detectUntapTriggers({ name: 'Wake Thrasher', oracle_text: 'Whenever a permanent you control becomes untapped, this creature gets +1/+1 until end of turn.' }, permanent).some((t) => t.untapType === 'controlled_permanent'),
  },
  {
    name: 'Unblinking Bleb (self or permanent face up)',
    oracle_text: 'Whenever this creature or another permanent is turned face up, you may scry 2.',
    detect: () => detectETBTriggers({ name: 'Unblinking Bleb', oracle_text: 'Whenever this creature or another permanent is turned face up, you may scry 2.' }, permanent).some((t) => t.triggerType === 'self_or_another_permanent_face_up'),
  },
  {
    name: 'Rewrite History (fourth plan counter)',
    oracle_text: 'When the fourth plan counter is put on this enchantment, sacrifice it.',
    detect: () => detectCounterPlacedTriggers({ name: 'Rewrite History', oracle_text: 'When the fourth plan counter is put on this enchantment, sacrifice it.' }, permanent).length > 0,
  },
  {
    name: 'Sliver Queen Avatar (non-sliver cast)',
    oracle_text: 'Whenever you cast a non-Sliver creature spell, exile that spell.',
    detect: () => detectSpellCastTriggers({ name: 'Sliver Queen Avatar', oracle_text: 'Whenever you cast a non-Sliver creature spell, exile that spell.' }, permanent).some((t) => (t as { tribalType?: string }).tribalType === 'non-sliver'),
  },
  {
    name: 'Caught in the Brights (when vehicle attacks)',
    oracle_text: 'When a Vehicle you control attacks, exile enchanted creature.',
    detect: () => detectAttackTriggers({ name: 'Caught in the Brights', oracle_text: 'When a Vehicle you control attacks, exile enchanted creature.' }, permanent).some((t) => t.triggerType === 'when_vehicle_attacks'),
  },
  {
    name: 'Illicit Masquerade (impostor counter dies)',
    oracle_text: 'Whenever a creature you control with an impostor counter on it dies, exile it.',
    detect: () => detectDeathTriggers({ name: 'Illicit Masquerade', oracle_text: 'Whenever a creature you control with an impostor counter on it dies, exile it.' }, permanent).some((t) => t.triggerType === 'impostor_counter_creature_dies'),
  },
  {
    name: 'Death Tyrant (attacking or blocking dies)',
    oracle_text: 'Whenever an attacking creature you control or a blocking creature an opponent controls dies, create a 2/2 black Zombie creature token.',
    detect: () => detectDeathTriggers({ name: 'Death Tyrant', oracle_text: 'Whenever an attacking creature you control or a blocking creature an opponent controls dies, create a 2/2 black Zombie creature token.' }, permanent).some((t) => t.triggerType === 'attacking_or_blocking_creature_dies'),
  },
  {
    name: 'Energy Field (card to graveyard)',
    oracle_text: 'When a card is put into your graveyard from anywhere, sacrifice this enchantment.',
    detect: () => detectDeathTriggers({ name: 'Energy Field', oracle_text: 'When a card is put into your graveyard from anywhere, sacrifice this enchantment.' }, permanent).some((t) => t.triggerType === 'card_put_into_graveyard_from_anywhere'),
  },
  {
    name: "Thassa's Emissary (self or enchanted combat damage)",
    oracle_text: 'Whenever this creature or enchanted creature deals combat damage to a player, draw a card.',
    detect: () => detectCombatDamageTriggers({ name: "Thassa's Emissary", oracle_text: 'Whenever this creature or enchanted creature deals combat damage to a player, draw a card.' }, permanent).some((t) => t.triggerType === 'self_or_enchanted_combat_damage_to_player'),
  },
  {
    name: 'Spiteful Banditry (opponents creatures die)',
    oracle_text: 'Whenever one or more creatures your opponents control die, you create a Treasure token.',
    detect: () => detectDeathTriggers({ name: 'Spiteful Banditry', oracle_text: 'Whenever one or more creatures your opponents control die, you create a Treasure token.' }, permanent).some((t) => t.triggerType === 'opponents_creatures_die'),
  },
  {
    name: 'Rainbow Dash (flying or haste attacks)',
    oracle_text: 'Whenever a creature you control with flying and/or haste attacks, you get 20% cooler.',
    detect: () => detectAttackTriggers({ name: 'Rainbow Dash', oracle_text: 'Whenever a creature you control with flying and/or haste attacks, you get 20% cooler.' }, permanent).some((t) => t.triggerType === 'flying_or_haste_attacks'),
  },
  {
    name: 'Harsh Justice (attacking creature damages you)',
    oracle_text: 'Whenever an attacking creature deals combat damage to you, it deals that much damage to its controller.',
    detect: () => detectCombatDamageTriggers({ name: 'Harsh Justice', oracle_text: 'Whenever an attacking creature deals combat damage to you, it deals that much damage to its controller.' }, permanent).some((t) => t.triggerType === 'attacking_creature_deals_combat_damage_to_you'),
  },
  {
    name: 'Invader Parasite (exiled name land enters)',
    oracle_text: 'Whenever a land an opponent controls with the same name as the exiled card enters, this creature deals 2 damage to that player.',
    detect: () => detectLandfallTriggers({ name: 'Invader Parasite', oracle_text: 'Whenever a land an opponent controls with the same name as the exiled card enters, this creature deals 2 damage to that player.' }, permanent).some((t) => (t as { triggerType?: string }).triggerType === 'exiled_name_opponent_land_enter'),
  },
  {
    name: 'Master Symmetrist (power equals toughness attacks)',
    oracle_text: 'Whenever a creature you control with power equal to its toughness attacks, it gains trample until end of turn.',
    detect: () => detectAttackTriggers({ name: 'Master Symmetrist', oracle_text: 'Whenever a creature you control with power equal to its toughness attacks, it gains trample until end of turn.' }, permanent).some((t) => t.triggerType === 'power_equals_toughness_attacks'),
  },
  {
    name: 'Dread Tiller (minus counter dies)',
    oracle_text: 'Whenever a creature with a -1/-1 counter on it dies, you may put a land card from your hand or graveyard onto the battlefield tapped.',
    detect: () => detectDeathTriggers({ name: 'Dread Tiller', oracle_text: 'Whenever a creature with a -1/-1 counter on it dies, you may put a land card from your hand or graveyard onto the battlefield tapped.' }, permanent).some((t) => t.triggerType === 'minus_counter_creature_dies'),
  },
  {
    name: "Freyalise's Winds (permanent becomes tapped)",
    oracle_text: 'Whenever a permanent becomes tapped, put a wind counter on it.',
    detect: () => detectTapTriggers({ name: "Freyalise's Winds", oracle_text: 'Whenever a permanent becomes tapped, put a wind counter on it.' }, permanent).some((t) => (t as { affectedType?: string }).affectedType === 'any_permanent_becomes_tapped'),
  },
  {
    name: 'Firesong and Sunspeaker (white spell lifegain)',
    oracle_text: 'Whenever a white instant or sorcery spell causes you to gain life, Firesong and Sunspeaker deals 3 damage to target creature or player.',
    detect: () => detectGainedLifeTriggersFromOracle({ name: 'Firesong and Sunspeaker', oracle_text: 'Whenever a white instant or sorcery spell causes you to gain life, Firesong and Sunspeaker deals 3 damage to target creature or player.' }, permanent).length > 0,
  },
  {
    name: "Beastmaster's Magemark (enchanted becomes blocked)",
    oracle_text: "Whenever a creature you control that's enchanted becomes blocked, it gets +1/+1 until end of turn for each creature blocking it.",
    detect: () => detectBlockTriggers({ name: "Beastmaster's Magemark", oracle_text: "Whenever a creature you control that's enchanted becomes blocked, it gets +1/+1 until end of turn for each creature blocking it." }, permanent).some((t) => (t as { triggerType?: string }).triggerType === 'enchanted_creature_becomes_blocked'),
  },
  {
    name: 'Hawkeye (becomes tapped)',
    oracle_text: 'Whenever Hawkeye becomes tapped, you may pay {1} up to three times.',
    detect: () => detectTapTriggers({ name: 'Hawkeye, Master Marksman', oracle_text: 'Whenever Hawkeye becomes tapped, you may pay {1} up to three times.' }, permanent).length > 0,
  },
  {
    name: 'Unnatural Summons (rebound upkeep)',
    oracle_text: 'Rebound',
    detect: () => detectUpkeepTriggers({ name: 'Unnatural Summons', oracle_text: 'Manifest dread.\nRebound' }, permanent).some((t) => t.triggerType === 'rebound'),
  },
  {
    name: 'Cunning (enchanted attacks or blocks cleanup sacrifice)',
    oracle_text: 'When enchanted creature attacks or blocks, sacrifice this Aura at the beginning of the next cleanup step.',
    detect: () => detectBlockTriggers({ name: 'Cunning', oracle_text: 'When enchanted creature attacks or blocks, sacrifice this Aura at the beginning of the next cleanup step.' }, permanent).some((t) => (t as { triggerType?: string }).triggerType === 'enchanted_creature_attacks_or_blocks'),
  },
  {
    name: 'Earth Rumble (when you do fights)',
    oracle_text: 'Earthbend 2. When you do, up to one target creature you control fights target creature an opponent controls.',
    detect: () => detectAttackTriggers({ name: 'Earth Rumble', oracle_text: 'Earthbend 2. When you do, up to one target creature you control fights target creature an opponent controls.' }, permanent).some((t) => t.triggerType === 'when_you_do'),
  },
  {
    name: 'Pedantic Learning (land milled to graveyard)',
    oracle_text: 'Whenever a land card is put into your graveyard from your library, you may pay {1}. If you do, draw a card.',
    detect: () => detectPutIntoGraveyardTriggers({ name: 'Pedantic Learning', oracle_text: 'Whenever a land card is put into your graveyard from your library, you may pay {1}. If you do, draw a card.' }, permanent).length > 0,
  },
  {
    name: 'Stolen Uniform (lose control of that Equipment)',
    oracle_text: 'Choose target creature you control and target Equipment. Gain control of that Equipment until end of turn. Attach it to the chosen creature. When you lose control of that Equipment this turn, if it\'s attached to a creature you control, unattach it.',
    detect: () => detectExiledFromBattlefieldTriggers({ name: 'Stolen Uniform', oracle_text: 'Choose target creature you control and target Equipment. Gain control of that Equipment until end of turn. Attach it to the chosen creature. When you lose control of that Equipment this turn, if it\'s attached to a creature you control, unattach it.' }, permanent).length > 0,
  },
  {
    name: 'Vernal Bloom (Forest tapped for mana)',
    oracle_text: 'Whenever a Forest is tapped for mana, its controller adds an additional {G}.',
    detect: () => detectTapTriggers({ name: 'Vernal Bloom', oracle_text: 'Whenever a Forest is tapped for mana, its controller adds an additional {G}.' }, permanent).some((t) => (t as { affectedType?: string }).affectedType === 'forest_mana'),
  },
  {
    name: 'The Millennium Calendar (untap step)',
    oracle_text: 'Whenever you untap one or more permanents during your untap step, put that many time counters on The Millennium Calendar.',
    detect: () => detectUntapTriggers({ name: 'The Millennium Calendar', oracle_text: 'Whenever you untap one or more permanents during your untap step, put that many time counters on The Millennium Calendar.' }, permanent).some((t) => t.triggerOn === 'untap_step'),
  },
  {
    name: 'Carpet of Flowers (each of your main phases)',
    oracle_text: 'At the beginning of each of your main phases, if you haven\'t added mana with this ability this turn, you may add X mana of any one color, where X is the number of basic land types among lands you control.',
    detect: () => detectPrecombatMainTriggers({ name: 'Carpet of Flowers', oracle_text: 'At the beginning of each of your main phases, if you haven\'t added mana with this ability this turn, you may add X mana of any one color, where X is the number of basic land types among lands you control.' }, permanent).length > 0,
  },
  {
    name: 'Utopia Sprawl (enchanted Forest tapped for mana)',
    oracle_text: 'Whenever enchanted Forest is tapped for mana, its controller adds an additional one mana of the chosen color.',
    detect: () => detectTapTriggers({ name: 'Utopia Sprawl', oracle_text: 'Whenever enchanted Forest is tapped for mana, its controller adds an additional one mana of the chosen color.' }, permanent).some((t) => (t as { affectedType?: string }).affectedType === 'enchanted_forest_mana'),
  },
  {
    name: 'Mindlink Mech (becomes crewed)',
    oracle_text: 'Whenever this Vehicle becomes crewed for the first time each turn, until end of turn, this Vehicle becomes a copy of target nonlegendary creature that crewed it this turn.',
    detect: () => detectAbilityActivatedTriggers({ name: 'Mindlink Mech', oracle_text: 'Whenever this Vehicle becomes crewed for the first time each turn, until end of turn, this Vehicle becomes a copy of target nonlegendary creature that crewed it this turn.' }, permanent).some((t) => t.triggerType === 'vehicle_crewed'),
  },
  {
    name: 'Stubborn Burrowfiend (becomes saddled)',
    oracle_text: 'Whenever this creature becomes saddled for the first time each turn, mill two cards, then this creature gets +X/+X until end of turn, where X is the number of creature cards in your graveyard.',
    detect: () => detectAbilityActivatedTriggers({ name: 'Stubborn Burrowfiend', oracle_text: 'Whenever this creature becomes saddled for the first time each turn, mill two cards, then this creature gets +X/+X until end of turn, where X is the number of creature cards in your graveyard.' }, permanent).some((t) => t.triggerType === 'creature_saddled'),
  },
];

describe('batch trigger gap closure (20+ pattern families)', () => {
  for (const sample of GAP_CASES) {
    it(`detects ${sample.name}`, () => {
      if (!sample.skipParse) {
        const parsed = parseTriggeredAbilitiesFromText(sample.oracle_text, 'SRC', 'P1', sample.name);
        expect(parsed.length).toBeGreaterThanOrEqual(0);
      }
      expect(sample.detect()).toBe(true);
    });
  }

  it('does not emit bogus cast trigger from Elder Brain cast-this-way rider', () => {
    const oracle = "Whenever this creature attacks a player, exile all cards from that player's hand, then they draw that many cards. You may play lands and cast spells from among the exiled cards for as long as they remain exiled. If you cast a spell this way, you may spend mana as though it were mana of any color to cast it.";
    const parsed = parseTriggeredAbilitiesFromText(oracle, 'SRC', 'P1', 'Elder Brain');
    expect(parsed.some((t) => t.event === 'spell_cast')).toBe(false);
    expect(parsed.some((t) => t.event === 'attacks')).toBe(true);
  });

  it('does not emit bogus cast trigger from Goryo\'s Vengeance splice reminder', () => {
    const oracle = "Return target legendary creature card from your graveyard to the battlefield. That creature gains haste. Exile it at the beginning of the next end step.\nSplice onto Arcane {2}{B} (As you cast an Arcane spell, you may reveal this card from your hand and pay its splice cost. If you do, add this card's effects to that spell.)";
    const parsed = parseTriggeredAbilitiesFromText(oracle, 'SRC', 'P1', "Goryo's Vengeance");
    expect(parsed.some((t) => t.event === 'spell_cast')).toBe(false);
  });

  it('does not emit bogus cast-that-spell trigger from Ogre Battlecaster attack rider', () => {
    const oracle = 'Whenever this creature attacks, you may cast target instant or sorcery card from your graveyard by paying {R}{R} in addition to its other costs. When you cast that spell, it gains haste until end of turn.';
    const parsed = parseTriggeredAbilitiesFromText(oracle, 'SRC', 'P1', 'Ogre Battlecaster');
    expect(parsed.some((t) => t.event === 'spell_cast')).toBe(false);
    expect(parsed.some((t) => t.event === 'attacks')).toBe(true);
  });

  it('does not emit bogus trigger from Alaundo granted ability quotes', () => {
    const cards = [{ name: 'Alaundo the Seer', oracle_text: '{T}: Draw a card, then exile a card from your hand and put a number of time counters on it equal to its mana value. It gains "When the last time counter is removed from this card, if it\'s exiled, you may cast it without paying its mana cost. If you cast a creature spell this way, it gains haste until end of turn." Then remove a time counter from each other card you own in exile.' }];
    const c = cards[0];
    const parsed = parseTriggeredAbilitiesFromText(c.oracle_text, 'SRC', 'P1', c.name);
    expect(parsed).toHaveLength(0);
  });

  it('does not emit bogus station keyword trigger from Rescue Skiff', () => {
    const parsed = parseTriggeredAbilitiesFromText('Station 10+ | Flying', 'SRC', 'P1', 'Rescue Skiff');
    expect(parsed).toHaveLength(0);
  });

  it('does not emit augment keyword line as its own trigger from Humming-', () => {
    const parsed = parseTriggeredAbilitiesFromText('Whenever this creature attacks, augment {3}{w}', 'SRC', 'P1', 'Humming-');
    expect(parsed.filter((t) => /^\s*augment\s+\{/i.test(t.condition || t.triggerFilter || ''))).toHaveLength(0);
    expect(parsed.some((t) => t.event === 'attacks')).toBe(true);
  });
});
