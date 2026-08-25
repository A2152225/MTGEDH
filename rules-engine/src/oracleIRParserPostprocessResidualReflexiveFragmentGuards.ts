// Extracted from rules-engine/src/oracleIRParserPostprocess.ts (chat B 40KB split campaign).
//
// Cluster: runs of guards lifted out of parseCurrentResidualUnknownStep's residual chain covering
// reflexive "when ..." fragments and graveyard shuffle-back fragments.
//
// Every helper keeps its guards in their original order and returns null when none matched, so the
// caller resumes the chain exactly where the run used to sit. staticMetadata / temporaryMetadata are
// verbatim copies of the chain prologue.

import type { OracleEffectStep } from './oracleIR';
import { parseObjectSelector } from './oracleIRParserUtils';
import { parseCreateEmblemUnknownStep } from './oracleIRParserPostprocessVoteRestrictionAndEmblemExpansions';

export function parseResidualReflexiveFragmentGuardsOne(
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

  if (/^when (?:you|that|this|it|the|one|each|a |an |the targeted|it connives|it enters|it regenerates|that creature|that permanent|that token|that equipment|this creature|this aura|this enchantment|the creature|you discard|you remove|you lose|you pay|you put|you sacrifice|you spend|one or more)/i.test(raw)) {
    return [{
      kind: 'schedule_delayed_trigger',
      timing: 'on_event',
      effect: raw,
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^whenever /i.test(raw)) {
    return [{
      kind: 'schedule_delayed_trigger',
      timing: 'on_event',
      effect: raw,
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^(?:combat|noncombat) damage /i.test(raw)) {
    return staticMetadata('damage replacement', raw);
  }

  if (/^(?:the high bidder|you start the bidding|the high bid)/i.test(raw)) {
    return staticMetadata('auction', raw);
  }

  if (/^\d+(?:-\d+)?\s*\|/i.test(raw)) {
    return staticMetadata('dice table', raw);
  }

  if (/^tiered �/i.test(raw) || /^� (?:defense|fight)!?$/i.test(raw)) {
    return staticMetadata('tiered mode', raw);
  }

  if (/^unless (?:you|any player|they|that player|target player)/i.test(raw)) {
    return staticMetadata('unless pay', raw);
  }

  if (/^they(?:'|')?re (?:artifacts|black)/i.test(raw) || /^they get an additional/i.test(raw)) {
    return staticMetadata('type rider', raw);
  }

  if (/^this effect reduces only the amount of /i.test(raw) || /^this effect can(?:not|'t) reduce the mana/i.test(raw)) {
    return staticMetadata('cost reduction rider', raw);
  }

  if (/^this card(?:'|')?s mana value is \d+\.?\)?$/i.test(raw)) {
    return staticMetadata('hybrid mana reminder', raw);
  }

  if (/^the controller of /i.test(raw) || /^the owners of those cards /i.test(raw) || /^their controller chooses/i.test(raw)) {
    return staticMetadata('controller action', raw);
  }

  if (/^they exile cards from|^they shuffle another/i.test(raw)) {
    return staticMetadata('opponent action', raw);
  }

  if (/^each player who controls the most /i.test(raw)) {
    return staticMetadata('tiebreak action', raw);
  }

  if (/^for each (?:spirit|creature, its controller|spell and ability)/i.test(raw)) {
    return staticMetadata('for each rider', raw);
  }

  if (/^flanking$/i.test(raw) || /^cards$/i.test(raw) || /^you may$/i.test(raw)) {
    return staticMetadata('fragment', raw);
  }

  if (/^draw three cards, untap/i.test(raw) || /^draw a card, mill a card$/i.test(raw)) {
    return staticMetadata('compound effect', raw);
  }

  if (/^while attached, this isn(?:'|')t a creature/i.test(raw)) {
    return staticMetadata('vehicle rider', raw);
  }

  if (/^would you like a/i.test(raw)) {
    return staticMetadata('attraction', raw);
  }

  if (/^it costs \{4\} less to cast this way/i.test(raw)) {
    return staticMetadata('cost reduction', raw);
  }

  if (/^that creature is black and is a nightmare/i.test(raw)) {
    return staticMetadata('type rider', raw);
  }

  if (/^that creature(?:'|')?s controller may sacrifice/i.test(raw)) {
    return staticMetadata('sacrifice choice', raw);
  }

  if (/^this creature can(?:not|'t) block creatures with power \d+ or greater unless you/i.test(raw)) {
    return staticMetadata('this creature', raw);
  }

  if (/^this mana can(?:not|'t) be spent/i.test(raw)) {
    return staticMetadata('this mana', raw);
  }

  if (/^this permanent(?:'|')?s controller$/i.test(raw)) {
    return staticMetadata('this permanent controller', raw);
  }

  if (/^you can cast only one more spell this turn$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^you control target opponent during their next combat phase$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^you copy that spell once plus an additional time/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^you exile the top ten cards of your library$/i.test(raw)) {
    return [{ kind: 'mill', who: { kind: 'you' }, amount: { kind: 'number', value: 10 }, raw, ...sequence } as unknown as OracleEffectStep];
  }

  if (/^you look at the top four cards of your library$/i.test(raw)) {
    return [{ kind: 'look_top', who: { kind: 'you' }, amount: { kind: 'number', value: 4 }, raw, ...sequence } as unknown as OracleEffectStep];
  }

  if (/^you lose this permanent equal to its mana value$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^you put the chosen cards into your hand$/i.test(raw)) {
    return [{ kind: 'draw', who: { kind: 'you' }, amount: { kind: 'reference_amount', raw: 'the chosen cards' }, raw, ...sequence } as unknown as OracleEffectStep];
  }
  return null;
}

export function parseResidualReflexiveFragmentGuardsTwo(
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

  if (/^you shuffle up to four cards from your graveyard into your library$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^you take the initiative, gain 3 life, draw a card,/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^you and target opponent each flip a coin$/i.test(raw) || /^you and defending player each discard/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^target player draws three cards and gains \d+ life$/i.test(raw)) {
    return staticMetadata('target player', raw);
  }

  if (/^target player reveals two cards at random from their hand$/i.test(raw)) {
    return staticMetadata('target player', raw);
  }

  if (/^target player discards a card for each swamp returned this way$/i.test(raw)) {
    return staticMetadata('target player', raw);
  }

  if (/^all nonland cards with the same name as another card in their hand$/i.test(raw)) {
    return staticMetadata('that player', raw);
  }

  if (/^all other nonland cards$/i.test(raw)) {
    return staticMetadata('all other nonland cards', raw);
  }

  if (/^each card with the same name as a card spliced onto that spell$/i.test(raw)) {
    return staticMetadata('each card', raw);
  }

  if (/^each nonland card revealed this way$/i.test(raw)) {
    return staticMetadata('each nonland card revealed this way', raw);
  }

  if (/^add one mana of that color unless any player$/i.test(raw)) {
    return staticMetadata('mana ability', raw);
  }

  if (/^until the beginning of your next upkeep, you may play that card$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^this turn, when target creature you control attacks and isn(?:'|')t blocked, you may/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^this card any time you could cast an instant$/i.test(raw)) {
    return staticMetadata('this card', raw);
  }

  if (/^this aura(?:'|')?s controller sacrifices it$/i.test(raw) || /^this artifact(?:'|')?s owner draws a card$/i.test(raw)) {
    return staticMetadata('this permanent', raw);
  }

  if (/^this creature(?:'|')?s controller and that player each draw half that many cards, rounded down/i.test(raw)) {
    return staticMetadata('this creature controller', raw);
  }

  if (/^their activated abilities with \{t\} in their costs can(?:'|')t be activated$/i.test(raw)) {
    return staticMetadata('those permanents', raw);
  }

  if (/^two cards, draws two cards, and loses 2$/i.test(raw)) {
    return staticMetadata('target player', raw);
  }

  if (/^when you do, you$/i.test(raw)) {
    return staticMetadata('when you do', raw);
  }

  if (/^they shuffle another creature they own into their library$/i.test(raw)) {
    return [{
      kind: 'move_zone',
      what: parseObjectSelector('another creature they own'),
      to: 'library',
      toRaw: 'their library',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^\{tk\}\{tk\}\{tk\}\{tk\}\{tk\} - you/i.test(raw)) {
    return staticMetadata('unglade cost', raw);
  }

  if (/^unless target player pays/i.test(raw) || /\bunless (?:any player|that player|its controller|they|you)$/i.test(raw)) {
    return staticMetadata('unless pay', raw);
  }

  if (/^for each (?:spirit|creature, its controller|spell and ability)/i.test(raw) && /\bunless\b/i.test(raw)) {
    return staticMetadata('for each unless', raw);
  }

  if (/^if you do, when each opponent casts their first spell/i.test(raw)) {
    return staticMetadata('chancellor rider', raw);
  }

  if (/^this turn, when target creature you control attacks and isn(?:'|')t blocked, you may/i.test(raw)) {
    return staticMetadata('combat trigger', raw);
  }

  if (/^you can divide that creature(?:'|')?s combat damage as you choose/i.test(raw)) {
    return staticMetadata('combat assignment', raw);
  }

  if (/^all other nonland cards$/i.test(raw)) {
    return staticMetadata('discard filter', raw);
  }

  if (/^you may cast a spell from your hand without paying its mana cost$/i.test(raw)) {
    return staticMetadata('cast permission', raw);
  }

  if (/^this card any time you could cast an instant$/i.test(raw)) {
    return staticMetadata('this card', raw);
  }

  if (/^x target attacking creatures become blocked$/i.test(raw)) {
    return staticMetadata('target creatures', raw);
  }

  if (/^target player draws x cards and loses x life, where x is the number of creatures they control of the chosen type$/i.test(raw)) {
    return staticMetadata('target player', raw);
  }

  if (/^you get an emblem with "/i.test(raw)) {
    const emblem = parseCreateEmblemUnknownStep(raw);
    if (emblem) return [emblem];
  }
  return null;
}

export function parseResidualReflexiveFragmentGuardsThree(
  raw: string, sequence: { sequence?: 'then' }, clauseBody: string
): readonly OracleEffectStep[] | null {
  const staticMetadata = (target: string, effectText: string): readonly OracleEffectStep[] => [{
    kind: 'grant_static_ability',
    target: parseObjectSelector(target),
    effectText: [effectText],
    duration: 'static',
    raw,
    ...sequence,
  } as unknown as OracleEffectStep];

  if (
    /^toughness, or loyalty equal to the chosen number, target artifact or creature becomes an artifact creature with base power and toughness x\/x until end of turn, where x is the chosen number$/i.test(
      clauseBody,
    )
  ) {
    return [{
      kind: 'animate_permanent',
      target: parseObjectSelector('target artifact or creature'),
      addTypes: ['artifact', 'creature'],
      power: 0,
      toughness: 0,
      powerUsesX: true,
      toughnessUsesX: true,
      duration: 'end_of_turn',
      condition: { kind: 'where', raw: 'X is the chosen number' },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^untap and goad that creature$/i.test(clauseBody)) {
    return [
      {
        kind: 'tap_or_untap',
        target: parseObjectSelector('that creature'),
        mode: 'untap',
        raw,
        ...sequence,
      } as unknown as OracleEffectStep,
      {
        kind: 'goad',
        target: parseObjectSelector('that creature'),
        raw,
        ...sequence,
      } as unknown as OracleEffectStep,
    ];
  }

  if (
    /^[A-Z][A-Za-z0-9', -]+,\s+[A-Za-z0-9', -]+$/i.test(raw) &&
    !/\b(?:target|when|each|you|draw|tap|untap|create|choose|put|if)\b/i.test(raw)
  ) {
    return staticMetadata('named card option', raw);
  }
  return null;
}

