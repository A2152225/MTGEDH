// Extracted from rules-engine/src/oracleIRParserPostprocess.ts (chat B 40KB split campaign).
//
// Cluster: contiguous runs of guards from parseCurrentResidualUnknownStep's residual chain that
// lower a fully matched oracle fragment straight into a grant_static_ability / grant_temporary_ability
// (or a small literal step) without consulting any other chain state.
//
// Each helper holds one run in its original order and returns null when no guard matched, so the
// caller resumes the chain at exactly the point the run used to occupy. The staticMetadata /
// temporaryMetadata closures are copies of the chain prologue.

import type { OracleEffectStep } from './oracleIR';
import { parseObjectSelector } from './oracleIRParserUtils';

export function parseResidualStaticGrantGuardsPrimary(
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

  if (/^vehicles you control have crew 1$/i.test(raw)) {
    return staticMetadata('vehicles you control', raw);
  }

  if (/^you may move all counters from this permanent onto target creature$/i.test(raw)) {
    return staticMetadata('this permanent', raw);
  }

  if (/^you may draw x cards, where x is the number of shrines you control$/i.test(raw)) {
    return [{
      kind: 'draw',
      who: { kind: 'you' },
      amount: { kind: 'x' },
      whereX: { kind: 'where', raw: 'the number of shrines you control' },
      optional: true,
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^this creature isn't a creature until end of turn$/i.test(raw)) {
    return temporaryMetadata('this creature', raw, 'end_of_turn');
  }

  if (/^you may have that opponent gain control of this permanent until end of combat$/i.test(raw)) {
    return staticMetadata('that opponent', raw);
  }

  if (/^then conjure two cards named mishra's foundry onto the battlefield tapped$/i.test(raw)) {
    return staticMetadata('you', raw.replace(/^then\s+/i, ''));
  }

  if (/^you may copy it, except the copy is a 1\/1 spirit in addition to its other types$/i.test(raw)) {
    return staticMetadata('it', raw);
  }

  if (/^you may reveal a (?:permanent|creature) card(?: with mana value \d+ or less)? from among them and put it into your hand\. put the rest on the bottom of your library(?: in a random order| in any order)?$/i.test(raw)) {
    return [
      {
        kind: 'grant_static_ability',
        target: parseObjectSelector('them'),
        effectText: ['reveal a permanent card from among them and put it into your hand'],
        duration: 'static',
        raw: 'you may reveal a permanent card from among them and put it into your hand',
        optional: step.optional,
        ...sequence,
      } as unknown as OracleEffectStep,
      {
        kind: 'put_on_bottom',
        who: { kind: 'you' },
        what: { kind: 'raw', text: 'the rest' },
        order: /in any order$/i.test(raw) ? 'any' : undefined,
        raw: 'put the rest on the bottom of your library',
        sequence: 'then',
      } as unknown as OracleEffectStep,
    ];
  }

  if (/^they're an artifact$/i.test(raw)) {
    return staticMetadata('they', raw);
  }

  if (/^you may have this permanent enter as a copy of a doctor card in your graveyard that was put there from your library this turn$/i.test(raw)) {
    return staticMetadata('this permanent', raw);
  }

  if (/^the next time you would set a scheme in motion, set three schemes in motion instead$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^seek two creature cards with mana value less than or equal to the number of study counters removed this way$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^you may copy this permanent and may choose a new target for the copy$/i.test(raw)) {
    return staticMetadata('this permanent', raw);
  }

  if (/^until end of turn, whenever one or more gorgons and\/or snakes you control deal combat damage to a player, you gain 2 life$/i.test(raw)) {
    return temporaryMetadata('gorgons and snakes you control', raw, 'end_of_turn');
  }

  if (/^this permanent is attacking that player or planeswalker$/i.test(raw)) {
    return staticMetadata('this permanent', raw);
  }

  if (/^then if you control six or more lands, repeat this process once$/i.test(raw)) {
    return [{
      kind: 'conditional',
      condition: { kind: 'if', raw: 'you control six or more lands' },
      steps: [staticMetadata('process', 'repeat this process once')[0]],
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^this creature gains landwalk of the chosen type until the end of that turn$/i.test(raw)) {
    return temporaryMetadata('this creature', raw, 'end_of_turn');
  }

  if (/^you may cast shattered seraph for as long as it remains exiled$/i.test(raw)) {
    return staticMetadata('shattered seraph', raw);
  }

  if (/^you get that many additional upkeep steps after this phase$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^this creature crews vehicles as though its power were 2 greater$/i.test(raw)) {
    return staticMetadata('this creature', raw);
  }

  if (/^until end of turn, whenever one or more gorgons and\/or snakes you control deal combat damage to a player, that player loses half their life, rounded up$/i.test(raw)) {
    return temporaryMetadata('gorgons and snakes you control', raw, 'end_of_turn');
  }

  if (/^then draw half x cards, rounded down$/i.test(raw)) {
    return [{
      kind: 'draw',
      who: { kind: 'you' },
      amount: { kind: 'reference_amount', raw: 'half x cards, rounded down' },
      raw: raw.replace(/^then\s+/i, ''),
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^hand, and library, seek two creature cards with mana value 3 or less$/i.test(raw)) {
    return staticMetadata('you', 'seek two creature cards with mana value 3 or less');
  }

  if (/^that player attaches this aura to a land of their choice$/i.test(raw)) {
    return staticMetadata('that player', raw);
  }

  if (/^then copy it if you control an enchantment\. you may choose new targets for the copies$/i.test(raw)) {
    return staticMetadata('it', raw.replace(/^then\s+/i, ''));
  }

  if (/^you skip your next two turns$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^this effect can't reduce their speed below 1$/i.test(raw)) {
    return staticMetadata('this effect', raw);
  }

  if (/^then amass orcs x, where x is the number of equipment attached to this permanent$/i.test(raw)) {
    return staticMetadata('this permanent', raw.replace(/^then\s+/i, ''));
  }

  if (/^target player can't cast spells until a player planeswalks$/i.test(raw)) {
    return staticMetadata('target player', raw);
  }

  if (/^that player reveals the chosen card, puts it on the bottom of their library$/i.test(raw)) {
    return staticMetadata('that player', raw);
  }

  if (/^radha's firebrand gets \+2\/\+2 until end of turn$/i.test(raw)) {
    return temporaryMetadata("radha's firebrand", raw, 'end_of_turn');
  }

  if (/^you may have your life total become the total toughness of creatures you control$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^then if this enchantment has three or more invitation counters on it, transform it$/i.test(raw)) {
    return staticMetadata('this enchantment', raw.replace(/^then\s+/i, ''));
  }

  if (/^your maximum hand size is equal to the number of hour counters on this enchantment$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^you may pay \{1\} rather than pay the mana cost for rune spells you cast$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^this creature can block an additional creature each combat as long as you're the monarch$/i.test(raw)) {
    return staticMetadata('this creature', raw);
  }

  if (/^until a player planeswalks, you can't lose the game and your opponents can't win the game$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^the player who controls the most creatures gains control of this creature$/i.test(raw)) {
    return staticMetadata('the player who controls the most creatures', raw);
  }

  if (/^until end of turn, this creature gets \+2\/\+2 and gains lifelink$/i.test(raw)) {
    return temporaryMetadata('this creature', raw, 'end_of_turn');
  }

  if (/^then you may pay \{1\} and 3 life$/i.test(raw)) {
    return staticMetadata('you', raw.replace(/^then\s+/i, ''));
  }

  if (/^that player chooses target player who has more life than they do and is their opponent$/i.test(raw)) {
    return staticMetadata('that player', raw);
  }

  if (/^then if it has eight or more night counters on it, remove all of them$/i.test(raw)) {
    return staticMetadata('it', raw.replace(/^then\s+/i, ''));
  }

  if (/^until end of turn, this enchantment becomes a legendary 6\/6 nightmare god creature with menace and deathtouch$/i.test(raw)) {
    return temporaryMetadata('this enchantment', raw, 'end_of_turn');
  }

  if (/^you may search your graveyard, hand and\/or library for a card named magnifying glass and\/or a card named thinking cap and put them onto the battlefield$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^you may reveal a land card or a card with \{x\} in its mana cost from among them and put it into your hand(?:\. put the rest on the bottom of your library in a random order)?$/i.test(raw)) {
    return staticMetadata('them', raw);
  }

  if (/^you may reveal that card if it has three or more colored mana symbols in its mana cost$/i.test(raw)) {
    return staticMetadata('that card', raw);
  }

  if (/^then meld them into this permanent, lost to phyrexia$/i.test(raw)) {
    return staticMetadata('this permanent', raw.replace(/^then\s+/i, ''));
  }

  if (/^you may reveal a creature card with mana value 3 or less from among them and put it into your hand\. put the rest on the bottom of your library$/i.test(raw)) {
    return staticMetadata('them', raw);
  }

  if (/^they can't phase in for as long as this permanent remains face up$/i.test(raw)) {
    return staticMetadata('they', raw);
  }

  if (/^those permanents phase in$/i.test(raw)) {
    return staticMetadata('those permanents', raw);
  }

  if (/^unless you pay \{b\}\{b\}\{b\}, tap this creature and sacrifice a land of an opponent's choice$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^then you may put that card on the bottom of your library\.\)$/i.test(raw)) {
    return staticMetadata('you', raw.replace(/^then\s+/i, '').replace(/\.\)$/, ''));
  }

  if (/^twice that much$/i.test(raw)) {
    return staticMetadata('that much', raw);
  }

  if (/^the excess damage dealt this way$/i.test(raw)) {
    return staticMetadata('damage amount', raw);
  }

  if (/^another card$/i.test(raw)) {
    return staticMetadata('another card', raw);
  }

  if (/^then secretly choose human, merfolk, or goblin$/i.test(raw)) {
    return staticMetadata('you', raw.replace(/^then\s+/i, ''));
  }

  if (/^you may activate the lesser production ability of any building of prestige 5 or lower you control$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^this permanent enters under the control of an opponent of your choice$/i.test(raw)) {
    return staticMetadata('this permanent', raw);
  }

  if (/^up to one other target creature loses all abilities$/i.test(raw)) {
    return staticMetadata('target creature', raw);
  }

  if (/^you may search your hand and\/or library for a card with a name noted as you drafted cards named this permanent$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^you get an amount of \{e\} equal to the amount of mana spent to cast that spell$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^you get six \{e\}$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^you get that many \{e\}\.?\"?$/i.test(raw)) {
    return staticMetadata('you', raw.replace(/\.\"?$/, ''));
  }

  if (/^you may move a counter from this artifact onto that creature$/i.test(raw)) {
    return staticMetadata('this artifact', raw);
  }

  if (/^you may unattach an equipment from a creature you control$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^until end of turn, that permanent becomes saddled if it's a mount and becomes an artifact creature if it's a vehicle$/i.test(raw)) {
    return temporaryMetadata('that permanent', raw, 'end_of_turn');
  }

  if (/^you lose the game\.\] exile this permanent$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^your team may pass the ball$/i.test(raw)) {
    return staticMetadata('your team', raw);
  }

  if (/^this creature and another target creature each get \+1\/\+0 until end of turn$/i.test(raw)) {
    return temporaryMetadata('target creatures', raw, 'end_of_turn');
  }

  if (/^two cards unless (?:you|they) discard an? .+ card$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^then put this creature's counters on that token$/i.test(raw)) {
    return staticMetadata('this creature', raw.replace(/^then\s+/i, ''));
  }

  if (/^until your next turn, this creature's base power becomes twice that card's power and its base toughness becomes twice that card's toughness$/i.test(raw)) {
    return temporaryMetadata('this creature', raw, 'until_next_turn');
  }

  if (/^then up to one other target attacking creature gets \+x\/\+0 until end of turn, where x is this permanent's power$/i.test(raw)) {
    return temporaryMetadata('target creature', raw.replace(/^then\s+/i, ''), 'end_of_turn');
  }

  if (/^this permanent endures \d+$/i.test(raw)) {
    return staticMetadata('this permanent', raw);
  }

  if (/^this permanent must be blocked each combat this turn if able$/i.test(raw)) {
    return staticMetadata('this permanent', raw);
  }

  if (/^that player chooses up to two creatures they control$/i.test(raw)) {
    return staticMetadata('that player', raw);
  }

  if (/^then if it has no oil counters on it, you lose the game$/i.test(raw)) {
    return staticMetadata('it', raw.replace(/^then\s+/i, ''));
  }

  if (/^you gain 2 life for each .+$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^a card or$/i.test(raw)) {
    return staticMetadata('you', 'a card or pay mana');
  }

  if (/^then for each nontoken permanent attached to it, create a token that's a copy of that permanent attached to that creature$/i.test(raw)) {
    return staticMetadata('it', raw.replace(/^then\s+/i, ''));
  }

  if (/^target opponent discards a card for each zubera that died this turn$/i.test(raw)) {
    return staticMetadata('target opponent', raw);
  }

  if (/^rekindled, you may discard a card$/i.test(raw)) {
    return staticMetadata('you', raw.replace(/^rekindled,?\s*/i, ''));
  }

  if (/^transform up to one target incubator token you control$/i.test(raw)) {
    return staticMetadata('target incubator token', raw);
  }

  if (/^until end of turn, that creature gets \+2\/\+0, gains trample if it's red, and gains vigilance if it's white$/i.test(raw)) {
    return temporaryMetadata('that creature', raw, 'end_of_turn');
  }

  if (/^then put the rest of the revealed cards on the bottom of your library in a random order$/i.test(raw)) {
    return staticMetadata('you', raw.replace(/^then\s+/i, ''));
  }

  if (/^until you exile x permanent cards, where x is the number of times this creature has mutated$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^then if you've done all four this turn, transform this permanent$/i.test(raw)) {
    return staticMetadata('this permanent', raw.replace(/^then\s+/i, ''));
  }

  if (/^then each player who discarded a card this way draws a card$/i.test(raw)) {
    return staticMetadata('each player', raw.replace(/^then\s+/i, ''));
  }

  if (/^then they exile a nonland card from their graveyard$/i.test(raw)) {
    return staticMetadata('they', raw.replace(/^then\s+/i, ''));
  }

  if (/^then you get an experience counter for each player who discarded a card this turn$/i.test(raw)) {
    return staticMetadata('you', raw.replace(/^then\s+/i, ''));
  }

  if (/^a card or pay \{2\}$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^a card and blight 1$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^a card and chaos ensues$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^a card and choose an opponent at random$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^a card and repeat this process$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^a card or sacrifice a permanent of their choice$/i.test(raw)) {
    return staticMetadata('they', raw);
  }

  if (/^a card" for as long as you control this creature$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^a creature card$/i.test(raw)) {
    return staticMetadata('creature card', raw);
  }

  if (/^a land card$/i.test(raw)) {
    return staticMetadata('land card', raw);
  }

  if (/^bushido 2$/i.test(raw)) {
    return staticMetadata('keyword action', raw);
  }

  if (/^convert it at end of combat$/i.test(raw)) {
    return staticMetadata('it', raw);
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

  if (/^the creature is a vampire in addition to its other types$/i.test(raw)) {
    return staticMetadata('that creature', raw);
  }

  if (/^all creatures that opponent controls attack if able$/i.test(raw)) {
    return staticMetadata('that opponent', raw);
  }

  if (/^all but 1$/i.test(raw)) {
    return staticMetadata('all but 1', raw);
  }

  if (/^any number of creature cards$/i.test(raw)) {
    return staticMetadata('creature cards', raw);
  }

  if (/^body thief - you$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^callous cultivator, mill three cards$/i.test(raw)) {
    return staticMetadata('you', raw.replace(/^callous cultivator,?\s*/i, ''));
  }

  if (/^penitent culler, mill three cards$/i.test(raw)) {
    return staticMetadata('you', raw.replace(/^penitent culler,?\s*/i, ''));
  }

  if (/^cards equal to its power$/i.test(raw)) {
    return staticMetadata('cards', raw);
  }

  if (/^clachan's heart, create a 1\/1 green and white kithkin creature token$/i.test(raw)) {
    return staticMetadata('you', raw.replace(/^clachan's heart,?\s*/i, ''));
  }

  if (/^damage to a permanent or player, it deals double that$/i.test(raw)) {
    return staticMetadata('it', 'deals double damage to a permanent or player');
  }

  if (/^damage to a permanent or player this turn, it deals double that$/i.test(raw)) {
    return staticMetadata('it', raw);
  }

  if (/^draw x cards, where x is the number of page counters on this artifact$/i.test(raw)) {
    return [{
      kind: 'draw',
      who: { kind: 'you' },
      amount: { kind: 'x' },
      whereX: { kind: 'where', raw: 'the number of page counters on this artifact' },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^draw x cards, where x is the number of creatures that died under your control this turn$/i.test(raw)) {
    return [{
      kind: 'draw',
      who: { kind: 'you' },
      amount: { kind: 'x' },
      whereX: { kind: 'where', raw: 'the number of creatures that died under your control this turn' },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^draw a card unless that player pays \{x\}, where x is this creature's power$/i.test(raw)) {
    return staticMetadata('that player', raw);
  }

  if (/^enchant creature or planeswalker an opponent controls$/i.test(raw)) {
    return staticMetadata('enchantment', raw);
  }

  if (/^enchant creature you control enchanted creature$/i.test(raw)) {
    return staticMetadata('enchantment', raw);
  }

  if (/^enchanted creature has protection from creatures$/i.test(raw)) {
    return staticMetadata('enchanted creature', raw);
  }

  if (/^eternalize-\{2\}\{w\}\{w\}, discard a card$/i.test(raw)) {
    return staticMetadata('this creature', raw);
  }

  if (/^flash double strike prevent all damage that would be dealt to this permanent$/i.test(raw)) {
    return staticMetadata('this permanent', raw);
  }

  if (/^for each opponent, you$/i.test(raw)) {
    return staticMetadata('each opponent', raw);
  }

  if (/^fuse create four 1\/1 white bird creature tokens with flying$/i.test(raw)) {
    return staticMetadata('you', raw.replace(/^fuse\s+/i, ''));
  }

  if (/^intimidate$/i.test(raw)) {
    return staticMetadata('this creature', 'gains intimidate');
  }

  if (/^life rather than lose life from radiation$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^otherwise, you$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^that damage$/i.test(raw)) {
    return staticMetadata('damage', raw);
  }

  if (/^that much life and distribute that many \+1\/\+1 counters among any number of creatures you control$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^that player's life total as the turn began$/i.test(raw)) {
    return staticMetadata('that player', raw);
  }

  if (/^the card's mana value$/i.test(raw)) {
    return staticMetadata('card', raw);
  }

  if (/^the exiled$/i.test(raw)) {
    return staticMetadata('exiled card', raw);
  }

  if (/^the greatest power among creature cards in your graveyard$/i.test(raw)) {
    return staticMetadata('creature cards in your graveyard', raw);
  }

  if (/^the life you lost when it entered$/i.test(raw)) {
    return staticMetadata('life amount', raw);
  }

  if (/^the player who controls the most creatures gains control of this creature$/i.test(raw)) {
    return staticMetadata('the player who controls the most creatures', raw);
  }

  if (/^the player who has the most cards in hand gains control of this creature$/i.test(raw)) {
    return staticMetadata('the player who has the most cards in hand', raw);
  }

  if (/^the player who controls the most wizards gains control of this creature$/i.test(raw)) {
    return staticMetadata('the player who controls the most wizards', raw);
  }

  if (/^the player with the lowest life total$/i.test(raw)) {
    return staticMetadata('the player with the lowest life total', raw);
  }

  if (/^the total mana value of those cards$/i.test(raw)) {
    return staticMetadata('those cards', raw);
  }

  if (/^then amass orcs x, where x is the number of instant and sorcery cards in that player's graveyard$/i.test(raw)) {
    return staticMetadata('you', raw.replace(/^then\s+/i, ''));
  }

  if (/^then attach it to a creature you control$/i.test(raw)) {
    return staticMetadata('you', raw.replace(/^then\s+/i, ''));
  }

  if (/^then if it's the first end step of the turn, there is an additional end step after this step$/i.test(raw)) {
    return staticMetadata('you', raw.replace(/^then\s+/i, ''));
  }

  if (/^then investigate four times$/i.test(raw)) {
    return staticMetadata('you', raw.replace(/^then\s+/i, ''));
  }

  if (/^then proliferate again$/i.test(raw)) {
    return [{
      kind: 'proliferate',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }
  return null;
}

