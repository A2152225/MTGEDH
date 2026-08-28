// Extracted from rules-engine/src/oracleIRParserPostprocess.ts (chat B 40KB split campaign).
//
// Cluster: runs of guards lifted out of parseCurrentResidualUnknownStep's residual chain covering
// perpetual gains, tap riders, delay-counter payments and secret-choice fragments.
//
// Every helper keeps its guards in their original order and returns null when none matched, so the
// caller resumes the chain exactly where the run used to sit. staticMetadata / temporaryMetadata are
// verbatim copies of the chain prologue.

import type { OracleEffectStep } from './oracleIR';
import { parseObjectSelector } from './oracleIRParserUtils';

export function parseResidualPerpetualAndSecretChoiceGuardsOne(
  raw: string, sequence: { sequence?: 'then' }, step: OracleEffectStep
): readonly OracleEffectStep[] | null {
  const staticMetadata = (target: string, effectText: string): readonly OracleEffectStep[] => [{
    kind: 'grant_static_ability',
    target: parseObjectSelector(target),
    effectText: [effectText],
    duration: 'static',
    raw,
    ...sequence,
  } as unknown as OracleEffectStep];

  const temporaryMetadata = (target: string, effectText: string, duration: 'this_turn' | 'end_of_turn' | 'until_next_turn' = 'this_turn'): readonly OracleEffectStep[] => [{
    kind: 'grant_temporary_ability',
    target: parseObjectSelector(target),
    effectText: [effectText],
    duration,
    raw,
    ...sequence,
  } as unknown as OracleEffectStep];

  if (/^it perpetually gains this ability$/i.test(raw)) {
    return staticMetadata('it', raw);
  }

  if (/^the game is a draw$/i.test(raw)) {
    return staticMetadata('the game', raw);
  }

  if (/^then if that creature's power is greater than this permanent's power, put another \+1\/\+1 counter on this permanent$/i.test(raw)) {
    return staticMetadata('this permanent', raw.replace(/^then\s+/i, ''));
  }

  if (/^x can't be greater than the greatest toughness among creatures you control$/i.test(raw)) {
    return staticMetadata('x', raw);
  }

  if (/^awaken \d+-/i.test(raw)) {
    return staticMetadata('lands you control', raw);
  }

  if (/^then that player copies each instant or sorcery card exiled with this enchantment$/i.test(raw)) {
    return staticMetadata('that player', raw.replace(/^then\s+/i, ''));
  }

  if (/^two target players each reveal the top card of their library$/i.test(raw)) {
    return staticMetadata('two target players', raw);
  }

  if (/^then repeats this process for an artifact, an enchantment, and a land$/i.test(raw)) {
    return staticMetadata('this process', raw.replace(/^then\s+/i, ''));
  }

  if (/^then if it has three or more \+1\/\+1 counters on it, transform it$/i.test(raw)) {
    return staticMetadata('it', raw.replace(/^then\s+/i, ''));
  }

  if (/^you may pay that much life again$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^that creature can't become untapped for as long as you control this permanent$/i.test(raw)) {
    return staticMetadata('that creature', raw);
  }

  if (/^you may choose new targets for any number of other spells and\/or abilities$/i.test(raw)) {
    return staticMetadata('other spells and abilities', raw);
  }

  if (/^perpetually exchange target creature's base power with another target creature's base power$/i.test(raw)) {
    return staticMetadata('target creatures', raw);
  }

  if (/^the power of target creature you control$/i.test(raw)) {
    return staticMetadata('target creature you control', raw);
  }

  if (/^then you may pay \{x\}, where x is the number of \+1\/\+1 counters on it$/i.test(raw)) {
    return staticMetadata('it', raw.replace(/^then\s+/i, ''));
  }

  if (/^this permanent gets \+1\/\+1 for each lesson card in your graveyard$/i.test(raw)) {
    return staticMetadata('this permanent', raw);
  }

  if (/^it perpetually gains double team$/i.test(raw)) {
    return staticMetadata('it', raw);
  }

  if (/^you may choose a creature card from among them$/i.test(raw)) {
    return staticMetadata('them', raw);
  }

  if (/^until end of turn, this creature has base power and toughness \d+\/\d+, gains trample, and isn't a human$/i.test(raw)) {
    return staticMetadata('this creature', raw);
  }

  if (/^you have no maximum hand size and don't lose the game for having \d+ or less life$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^then if you have no cards in hand, you lose the game$/i.test(raw)) {
    return staticMetadata('you', raw.replace(/^then\s+/i, ''));
  }

  if (/^then they each put the card they revealed into their hand$/i.test(raw)) {
    return staticMetadata('they', raw.replace(/^then\s+/i, ''));
  }

  if (/^horror of zhava is untapped, any opponent may sacrifice a nontoken creature$/i.test(raw)) {
    return staticMetadata('any opponent', raw);
  }

  if (/^then seek a land card and put it onto the battlefield tapped$/i.test(raw)) {
    return staticMetadata('you', raw.replace(/^then\s+/i, ''));
  }

  if (/^that player puts a flood counter on target non-island land they control of their choice$/i.test(raw)) {
    return staticMetadata('that player', raw);
  }

  if (/^that land is an island for as long as it has a flood counter on it$/i.test(raw)) {
    return staticMetadata('that land', raw);
  }

  if (/^then up to that many target lands you control become \d+\/\d+ wolf creatures with haste that are still lands$/i.test(raw)) {
    return staticMetadata('target lands you control', raw.replace(/^then\s+/i, ''));
  }

  if (/^you may have its controller create a \d+\/\d+ white warrior creature token that's tapped and attacking$/i.test(raw)) {
    return staticMetadata('its controller', raw);
  }

  if (/^until end of turn, whenever you tap a land for mana, add one mana of any type that land produced$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^target creature that crewed it this turn perpetually gains your choice of menace, deathtouch, or lifelink$/i.test(raw)) {
    return staticMetadata('target creature that crewed it this turn', raw);
  }

  if (/^you may have defending player activate a mana ability of each land they control and lose all unspent mana$/i.test(raw)) {
    return staticMetadata('defending player', raw);
  }

  if (/^those creatures are now attacking that player$/i.test(raw)) {
    return staticMetadata('those creatures', raw);
  }

  if (/^you may pay \{2\} and sacrifice a token$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^until end of turn, that creature's controller may play that card and they may spend mana as though it were mana of any color to cast spells this way$/i.test(raw)) {
    return staticMetadata("that creature's controller", raw);
  }

  if (/^target player reveals all nonland cards in their hand$/i.test(raw)) {
    return staticMetadata('target player', raw);
  }

  if (/^you may choose one of those cards$/i.test(raw)) {
    return staticMetadata('those cards', raw);
  }

  if (/^you may cast a spell with mana value x or less from among cards revealed this way without paying its mana cost$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^the player gets another poison counter at the beginning of their next upkeep unless they pay \{2\} before that (?:upkeep|step)$/i.test(raw)) {
    return staticMetadata('the player', raw);
  }

  if (/^you may have target player other than its controller create a token that's a copy of it$/i.test(raw)) {
    return staticMetadata('target player', raw);
  }

  if (/^then you may pay one or more \{e\}$/i.test(raw)) {
    return staticMetadata('you', raw.replace(/^then\s+/i, ''));
  }

  if (/^rewards$/i.test(raw)) {
    return staticMetadata('rewards', raw);
  }

  if (/^(?:then\s+)?planeswalk away from this phenomenon\.\)?$/i.test(raw)) {
    return staticMetadata('this phenomenon', raw.replace(/^then\s+/i, ''));
  }

  if (/^the first instant or sorcery spell you cast each turn costs (?:\{[^}]+\})+ \(or \{[^}]+\}\) less to cast for each land you control$/i.test(raw)) {
    return staticMetadata('instant or sorcery spells you cast', raw);
  }

  if (/^you may cast a spell with mana value x or less from among cards revealed this way without paying its mana cost\. put the rest on the bottom of your library in a random order$/i.test(raw)) {
    return [
      {
        kind: 'grant_cast_permission',
        who: { kind: 'you' },
        filter: 'spell with mana value x or less from among cards revealed this way',
        withoutPayingManaCost: true,
        raw: 'you may cast a spell with mana value x or less from among cards revealed this way without paying its mana cost',
        ...sequence,
      } as unknown as OracleEffectStep,
      {
        kind: 'put_on_bottom',
        who: { kind: 'you' },
        what: { kind: 'raw', text: 'the rest' },
        order: 'random',
        raw: 'put the rest on the bottom of your library in a random order',
        sequence: 'then',
      } as unknown as OracleEffectStep,
    ];
  }

  if (/^zero is even\.?\)?$/i.test(raw)) {
    return staticMetadata('reminder text', raw);
  }

  if (/^\.\.+$/i.test(raw)) {
    return staticMetadata('ellipsis marker', raw);
  }

  if (/^\([^)]+\)\.?$/i.test(raw) || /^\([^)]*$/i.test(raw)) {
    return staticMetadata('reminder text', raw);
  }

  if (/^you may cast the (?:artifact|enchantment) later from exile\.\)?$/i.test(raw)) {
    return staticMetadata('exiled card', raw);
  }

  if (/^to win:$/i.test(raw)) {
    return staticMetadata('to win', raw);
  }

  if (/^you get \{[a-z0-9]+\} \(an energy counter\) for each .+ you control$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^that much life plus 1 instead$/i.test(raw)) {
    return staticMetadata('life amount', raw);
  }

  if (/^then the owner of each permanent chosen this way shuffles$/i.test(raw)) {
    return staticMetadata('each permanent chosen this way', raw.replace(/^then\s+/i, ''));
  }

  if (/^that player puts the rest on the bottom of their library in a random order$/i.test(raw)) {
    return staticMetadata('that player', raw);
  }

  if (/^unicorn, or horse creature spell, copy it$/i.test(raw)) {
    return staticMetadata('creature spell', raw);
  }

  if (/^when the last is removed, you may cast it without paying its mana cost$/i.test(raw)) {
    return staticMetadata('it', raw);
  }

  if (/^transform this equipment$/i.test(raw)) {
    return staticMetadata('this equipment', raw);
  }

  if (/^you can't lose the game$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^the exiled card's owner seeks a nonland card with lesser mana value than the exiled card$/i.test(raw)) {
    return staticMetadata("the exiled card's owner", raw);
  }

  if (/^you choose one of those cards and exile it$/i.test(raw)) {
    return staticMetadata('those cards', raw);
  }

  if (/^up to one hundred target creatures each get \+0\/\+x until end of turn, where x is the number of cards in your hand$/i.test(raw)) {
    return staticMetadata('target creatures', raw);
  }

  if (/^then each opponent who didn't sacrifice a creature discards two cards$/i.test(raw)) {
    return staticMetadata('each opponent', raw.replace(/^then\s+/i, ''));
  }

  if (/^then if there are three or more ribbon counters on this creature, remove those counters and untap it$/i.test(raw)) {
    return staticMetadata('this creature', raw.replace(/^then\s+/i, ''));
  }

  if (/^until your next turn, whenever a player taps a land for mana, that player adds one mana of any type that land produced$/i.test(raw)) {
    return staticMetadata('players', raw);
  }

  if (/^until end of turn, that creature's controller may play that card and they may spend mana as though it were mana of any color to cast (?:that spell|spells this way)$/i.test(raw)) {
    return staticMetadata("that creature's controller", raw);
  }

  if (/^the horde sacrifices two minotaurs$/i.test(raw)) {
    return staticMetadata('the horde', raw);
  }

  if (/^select target player at random$/i.test(raw)) {
    return staticMetadata('target player', raw);
  }

  if (/^that player returns a creature they control to its owner's hand$/i.test(raw)) {
    return staticMetadata('that player', raw);
  }

  if (/^then both of them perpetually lose double team\.\)?$/i.test(raw)) {
    return staticMetadata('both of them', raw.replace(/^then\s+/i, ''));
  }

  if (/^the life that player lost this turn$/i.test(raw)) {
    return staticMetadata('life amount', raw);
  }

  if (/^where x is this creature's power$/i.test(raw)) {
    return staticMetadata('this creature', raw);
  }

  if (/^this permanent's power$/i.test(raw)) {
    return staticMetadata('this permanent', raw);
  }

  if (/^until end of turn, that player can't cast spells, you may look at the top card of their library any time, you may play the top card of their library, and you may spend mana as though it were mana of any color to cast spells this way$/i.test(raw)) {
    return temporaryMetadata('that player', raw, 'end_of_turn');
  }
  return null;
}

export function parseResidualPerpetualAndSecretChoiceGuardsTwo(
  raw: string, sequence: { sequence?: 'then' }
): readonly OracleEffectStep[] | null {
  const staticMetadata = (target: string, effectText: string): readonly OracleEffectStep[] => [{
    kind: 'grant_static_ability',
    target: parseObjectSelector(target),
    effectText: [effectText],
    duration: 'static',
    raw,
    ...sequence,
  } as unknown as OracleEffectStep];

  const temporaryMetadata = (target: string, effectText: string, duration: 'this_turn' | 'end_of_turn' | 'until_next_turn' = 'this_turn'): readonly OracleEffectStep[] => [{
    kind: 'grant_temporary_ability',
    target: parseObjectSelector(target),
    effectText: [effectText],
    duration,
    raw,
    ...sequence,
  } as unknown as OracleEffectStep];

  if (/^then tap any number of creatures you control$/i.test(raw)) {
    return staticMetadata('you', raw.replace(/^then\s+/i, ''));
  }

  if (/^then you may attach an equipment you control to this permanent$/i.test(raw)) {
    return staticMetadata('you', raw.replace(/^then\s+/i, ''));
  }

  if (/^trample$/i.test(raw)) {
    return staticMetadata('this creature', 'gains trample');
  }

  if (/^unattach enchanted equipment$/i.test(raw)) {
    return staticMetadata('enchanted equipment', raw);
  }

  if (/^untap a creature you control$/i.test(raw)) {
    return staticMetadata('creature you control', raw);
  }

  if (/^up to x target creatures gain flying until end of turn, where x is the number of times this creature was kicked$/i.test(raw)) {
    return staticMetadata('target creatures', raw);
  }

  if (/^vigilance, haste as long as this creature is on the battlefield, it's a land in addition to its other types$/i.test(raw)) {
    return staticMetadata('this creature', raw);
  }

  if (/^vigilance, reach each legendary spell you cast that's one or more colors has web-slinging \{g\}\{w\}\{u\}$/i.test(raw)) {
    return staticMetadata('legendary spells you cast', raw);
  }

  if (/^warp \{1\}\{b\}$/i.test(raw)) {
    return staticMetadata('this spell', raw);
  }

  if (/^where x is that saga's mana value$/i.test(raw)) {
    return staticMetadata('x', raw);
  }

  if (/^x can't be greater than the amount of life you lost this turn$/i.test(raw)) {
    return staticMetadata('x', raw);
  }

  if (/^x can't be greater than the amount of life you gained this turn$/i.test(raw)) {
    return staticMetadata('x', raw);
  }

  if (/^add an additional one mana of any type that land produced for each other land you control with the same name as it$/i.test(raw)) {
    return staticMetadata('lands you control', raw);
  }

  if (/^add x \{g\} or x \{w\}, where x is the number of other creatures you control$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^aftermath create a treasure token for each creature you controlled that dealt combat damage to a player this turn$/i.test(raw)) {
    return staticMetadata('you', raw.replace(/^aftermath\s+/i, ''));
  }

  if (/^dog, or hero spell, create a food token$/i.test(raw)) {
    return staticMetadata('spell', raw);
  }

  if (/^horde, exile them$/i.test(raw)) {
    return staticMetadata('the horde', raw.replace(/^horde,?\s*/i, ''));
  }

  if (/^increase your speed by 1$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^level 2 equip abilities you activate cost \{2\} less to activate$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^level 3 you may look at the top card of your library any time$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^level 3 creature cards in your graveyard have sneak \{3\}\{b\}$/i.test(raw)) {
    return staticMetadata('creature cards in your graveyard', raw);
  }

  if (/^life and discards cards equal to the number of permanents they control but don't own$/i.test(raw)) {
    return staticMetadata('they', raw);
  }

  if (/^prowess if a noncreature source you control would deal damage to a creature, battle, or opponent, it deals that much damage plus 2 instead$/i.test(raw)) {
    return staticMetadata('noncreature sources you control', raw);
  }

  if (/^rimebound and at the beginning of your first main phase, add two mana of any one color$/i.test(raw)) {
    return staticMetadata('you', raw.replace(/^rimebound,?\s*/i, ''));
  }

  if (/^scry 1(?:\.\)|\.")?$/i.test(raw)) {
    return staticMetadata('you', 'scry 1');
  }

  if (/^sorcery, or villain spell each turn, exile it$/i.test(raw)) {
    return staticMetadata('spell', raw);
  }

  if (/^that creature's owner can't cast spells with the same name as that creature until your next turn$/i.test(raw)) {
    return staticMetadata("that creature's owner", raw);
  }

  if (/^that many cards and each other player loses that much$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^that many cards minus one$/i.test(raw)) {
    return staticMetadata('cards', raw);
  }

  if (/^that many cards and add that much \{r\}$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^that player adds two mana of any one color they choose$/i.test(raw)) {
    return staticMetadata('that player', raw);
  }

  if (/^that player simultaneously untaps each tapped artifact, creature, and land they control and taps each untapped artifact, creature, and land they control$/i.test(raw)) {
    return staticMetadata('that player', raw);
  }

  if (/^that source's controller exiles a card from their hand at random$/i.test(raw)) {
    return staticMetadata("that source's controller", raw);
  }

  if (/^that spell gains rebound$/i.test(raw)) {
    return staticMetadata('that spell', raw);
  }

  if (/^the blocking creature gets \+1\/\+1 until end of turn$/i.test(raw)) {
    return temporaryMetadata('the blocking creature', raw, 'end_of_turn');
  }

  if (/^the blocking creature gets -1\/-1 until end of turn$/i.test(raw)) {
    return temporaryMetadata('the blocking creature', raw, 'end_of_turn');
  }

  if (/^the copy targets (?:ivy|the chosen creature|the chosen permanent)$/i.test(raw)) {
    return staticMetadata('the copy', raw);
  }

  if (/^the exiled card's owner creates an x\/x blue illusion creature token, where x is the mana value of the exiled card$/i.test(raw)) {
    return staticMetadata("the exiled card's owner", raw);
  }

  if (/^the exiled card's owner manifests dread$/i.test(raw)) {
    return staticMetadata("the exiled card's owner", raw);
  }

  if (/^the fading light, exile them$/i.test(raw)) {
    return staticMetadata('them', raw.replace(/^the fading light,?\s*/i, ''));
  }

  if (/^the greatest mana value among creatures sacrificed this way$/i.test(raw)) {
    return staticMetadata('creatures sacrificed this way', raw);
  }

  if (/^the greatest power among creatures you control$/i.test(raw)) {
    return staticMetadata('creatures you control', raw);
  }

  if (/^the monarch controls enchanted creature$/i.test(raw)) {
    return staticMetadata('the monarch', raw);
  }

  if (/^a third of their life, rounded up$/i.test(raw)) {
    return staticMetadata('life amount', raw);
  }

  if (/^humans you control gain indestructible until your next turn$/i.test(raw)) {
    return temporaryMetadata('humans you control', raw, 'until_next_turn');
  }

  if (/^fuse$/i.test(raw)) {
    return staticMetadata('fuse', raw);
  }

  if (/^target opponent discards a card for each (?:shrine you control|time it was kicked)$/i.test(raw)) {
    return staticMetadata('target opponent', raw);
  }

  if (/^target player discards a card for each (?:charge counter on this artifact|creature it devoured)$/i.test(raw)) {
    return staticMetadata('target player', raw);
  }

  if (/^that creature must be blocked this combat if able$/i.test(raw)) {
    return staticMetadata('that creature', raw);
  }

  if (/^that creature's controller may have target creature of their choice get -3\/-3 until end of turn$/i.test(raw)) {
    return staticMetadata("that creature's controller", raw);
  }

  if (/^that creature's controller returns this aura from its owner's graveyard to the battlefield$/i.test(raw)) {
    return staticMetadata("that creature's controller", raw);
  }

  if (/^that much life and attacking player loses that much$/i.test(raw)) {
    return staticMetadata('life amount', raw);
  }

  if (/^that opponent may pay \{x\}, where x is the number of cards in their hand$/i.test(raw)) {
    return staticMetadata('that opponent', raw);
  }

  if (/^target instant or sorcery card in your graveyard gains flashback \{2\}\{r\}\{g\} until end of turn$/i.test(raw)) {
    return temporaryMetadata('target instant or sorcery card in your graveyard', raw, 'end_of_turn');
  }

  if (/^draw a card\.\)"\) \{2\}, sacrifice another creature or a blood token: each opponent$/i.test(raw)) {
    return staticMetadata('each opponent', raw);
  }

  if (/^foods you control have "\{T\}: Add \{G\}\." \{5\}\{g\}\{g\}, sacrifice this enchantment: creatures you control get \+x\/\+x until end of turn, where x is the number of foods you control$/i.test(raw)) {
    return staticMetadata('foods you control', raw);
  }

  if (/^damage equal to the number of charge counters on it to target player and that much$/i.test(raw)) {
    return staticMetadata('this artifact', raw);
  }

  if (/^damage equal to the number of quest counters on it to up to one target creature unless that creature's controller has this permanent deal that much$/i.test(raw)) {
    return staticMetadata('this permanent', raw);
  }

  if (/^that creature's mana value$/i.test(raw)) {
    return staticMetadata('that creature', raw);
  }
  return null;
}

export function parseResidualPerpetualAndSecretChoiceGuardsThree(
  raw: string, sequence: { sequence?: 'then' }
): readonly OracleEffectStep[] | null {
  const staticMetadata = (target: string, effectText: string): readonly OracleEffectStep[] => [{
    kind: 'grant_static_ability',
    target: parseObjectSelector(target),
    effectText: [effectText],
    duration: 'static',
    raw,
    ...sequence,
  } as unknown as OracleEffectStep];

  if (/^for each delay counter removed this way, you lose 1 life unless you/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^they /i.test(raw)) {
    return staticMetadata('they', raw);
  }

  if (/^vanishing$/i.test(raw)) {
    return staticMetadata('this permanent', raw);
  }

  if (/^transform (?:him|it|all incubator tokens you control)$/i.test(raw)) {
    return staticMetadata('this permanent', raw);
  }

  if (/^unattach this permanent$/i.test(raw)) {
    return staticMetadata('this permanent', raw);
  }

  if (/^unlock a locked door of up to one target room you control$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^the ring tempts you$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^the emerge cost is equal to its mana value$/i.test(raw)) {
    return staticMetadata('emerge cost', raw);
  }

  if (/^the mayhem cost is equal to its mana cost$/i.test(raw)) {
    return staticMetadata('mayhem cost', raw);
  }

  if (/^level 3 you may play cards exiled with this class/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^toughness, or mana value 4, choose one that hasn't been chosen this turn$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^a card and proliferate$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^voice of gaea and a land named argoth, sanctum of nature, exile them$/i.test(raw)) {
    return staticMetadata('you', raw.replace(/^voice of gaea and\s*/i, ''));
  }

  if (/^you control (?:enchanted equipment|target opponent during their next turn)$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^you win the game if /i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^you do the same with /i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^you manifest /i.test(raw)) {
    return staticMetadata('you', raw);
  }
  return null;
}

export function parseResidualPerpetualAndSecretChoiceGuardsFour(
  raw: string, sequence: { sequence?: 'then' }, step: OracleEffectStep
): readonly OracleEffectStep[] | null {
  const staticMetadata = (target: string, effectText: string): readonly OracleEffectStep[] => [{
    kind: 'grant_static_ability',
    target: parseObjectSelector(target),
    effectText: [effectText],
    duration: 'static',
    raw,
    ...sequence,
  } as unknown as OracleEffectStep];

  const temporaryMetadata = (target: string, effectText: string, duration: 'this_turn' | 'end_of_turn' | 'until_next_turn' = 'this_turn'): readonly OracleEffectStep[] => [{
    kind: 'grant_temporary_ability',
    target: parseObjectSelector(target),
    effectText: [effectText],
    duration,
    raw,
    ...sequence,
  } as unknown as OracleEffectStep];

  if (/^you and target opponent each secretly choose /i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^you and each opponent who voted /i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^you gain 3 life for each /i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^this permanent(?:'s)? owner shuffles this permanent into their library$/i.test(raw)) {
    return staticMetadata("this permanent's owner", raw);
  }

  if (/^this permanent's power and toughness are each equal to /i.test(raw)) {
    return staticMetadata('this permanent', raw);
  }

  if (/^this turn, that player can't cast spells or activate abilities and plays with their hand revealed$/i.test(raw)) {
    return staticMetadata('that player', raw);
  }

  if (/^the (?:first player|number they guessed|total mana value of those cards|same number|greatest power among|greatest mana value among|mayhem cost|emerge cost|mana value of the exiled)/i.test(raw)) {
    return staticMetadata('trigger effect', raw);
  }

  if (/^the copy targets /i.test(raw)) {
    return staticMetadata('the copy', raw);
  }

  if (/^that (?:player's life total|token attacks|vehicle gets|many cards)/i.test(raw)) {
    return staticMetadata('trigger effect', raw);
  }

  if (/^otherwise, you$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^crew 3 you\b/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^body thief\s*[-�]\s*you\b/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^you and target opponent each reveal the top card of your library$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^you each put the card you revealed into your hand$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^the creature is an? ([a-z]+) in addition to its other types$/i.test(raw)) {
    return staticMetadata('that creature', raw);
  }

  if (/^enchanted creature has protection from creatures$/i.test(raw)) {
    return staticMetadata('enchanted creature', raw);
  }

  if (/^turn that creature face up or put a \+1\/\+1 counter on it$/i.test(raw)) {
    return staticMetadata('that creature', raw);
  }

  if (/^untap (?:it and all samurai you control|one or two target attacking creatures)$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^then, for each attacking creature you control/i.test(raw)) {
    return staticMetadata('you', raw.replace(/^then,?\s*/i, ''));
  }

  if (/^scry 1(?:\.\)|\.")?$/i.test(raw)) {
    return staticMetadata('you', 'scry 1');
  }

  if (/^this ability triggers only if this permanent is on the battlefield or if this permanent is in your graveyard and you control a giant$/i.test(raw)) {
    return staticMetadata('this permanent', raw);
  }

  if (/^that permanent phases in$/i.test(raw)) {
    return staticMetadata('that permanent', raw);
  }

  if (/^scry 1(?:\.\)|\.")?$/i.test(raw)) {
    return staticMetadata('you', 'scry 1');
  }

  if (/^draw a card\.\)"\) \{2\}, sacrifice another creature or a blood token: each opponent$/i.test(raw)) {
    return staticMetadata('each opponent', raw);
  }

  if (/^(?:wanderbrine shield|rekindled|callous cultivator|penitent culler|clachan's heart|horde|rimebound|fuse|body thief),?\s+/i.test(raw)) {
    const stripped = raw.replace(/^(?:wanderbrine shield|rekindled|callous cultivator|penitent culler|clachan's heart|horde|rimebound|fuse|body thief),?\s+/i, '').trim();
    return staticMetadata('you', stripped || raw);
  }

  if (/^then /i.test(raw)) {
    return staticMetadata('you', raw.replace(/^then\s+/i, ''));
  }

  if (/^that player /i.test(raw)) {
    return staticMetadata('that player', raw);
  }

  if (/^that opponent /i.test(raw)) {
    return staticMetadata('that opponent', raw);
  }

  if (/^until (?:end of turn|your next turn|the end of (?:your|defending player(?:'s)?) next turn|that player(?:'s)? next end step|they|you|a player)/i.test(raw)) {
    const duration = /until (?:your next turn|the end of your next turn)/i.test(raw) ? 'until_next_turn' : 'end_of_turn';
    return temporaryMetadata('you', raw, duration);
  }

  if (/^you may /i.test(raw) && raw.length >= 12) {
    return staticMetadata('you', raw);
  }

  if (/^you (?:can't|choose|get|have) /i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^your (?:opponents|life|team) /i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^this (?:ability|cost|creature|permanent|spacecraft|enchantment|artifact|equipment|vehicle|saga) /i.test(raw)) {
    return staticMetadata('this permanent', raw);
  }

  if (/^those /i.test(raw)) {
    return staticMetadata('those permanents', raw);
  }

  if (/^the (?:active player|amount|difference|exiled|life|next|other|player|token) /i.test(raw)) {
    return staticMetadata('trigger effect', raw);
  }

  if (/^up to /i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^for each /i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^when you next cast /i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^x is /i.test(raw)) {
    return staticMetadata('x', raw);
  }

  if (/^ward /i.test(raw)) {
    return staticMetadata('those creatures', raw);
  }
  return null;
}

