// Extracted from rules-engine/src/oracleIRParserPostprocess.ts (chat B 40KB split campaign).
//
// Cluster: runs of guards lifted out of parseCurrentResidualUnknownStep's residual chain covering
// combat requirements, energy and counter riders, and repeatable "you may pay" fragments.
//
// Every helper keeps its guards in their original order and returns null when none matched, so the
// caller resumes the chain exactly where the run used to sit. staticMetadata / temporaryMetadata are
// verbatim copies of the chain prologue.

import type { OracleEffectStep } from './oracleIR';
import { parseObjectSelector, parseQuantity } from './oracleIRParserUtils';

export function parseResidualCombatCounterAndPaymentGuardsOne(
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

  if (/^this\s+creature\s+blocks\s+each\s+combat\s+if\s+able$/i.test(raw)) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector('this creature'),
      effectText: ['blocks each combat if able'],
      duration: 'static',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^this\s+creature\s+can\s+block\s+an\s+additional\s+creature\s+this\s+turn$/i.test(raw)) {
    return [{
      kind: 'grant_temporary_ability',
      target: parseObjectSelector('this creature'),
      duration: 'this_turn',
      effectText: ['can block an additional creature'],
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^this\s+creature\s+saddles\s+mounts\s+and\s+crews\s+vehicles\s+as\s+though\s+its\s+power\s+were\s+2\s+greater$/i.test(raw)) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector('this creature'),
      effectText: ['saddles Mounts and crews Vehicles as though its power were 2 greater'],
      duration: 'static',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^those\s+creatures\s+don(?:'|�)?t\s+untap\s+during\s+their\s+controllers(?:'|�)?\s+next\s+untap\s+steps$/i.test(raw)) {
    return [{
      kind: 'skip_next_untap',
      target: parseObjectSelector('those creatures'),
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^twice\s+that\s+many\s+\+1\/\+1\s+counters\s+are\s+put\s+on\s+that\s+creature$/i.test(raw)) {
    return [{
      kind: 'add_counter',
      target: parseObjectSelector('that creature'),
      counter: '+1/+1',
      amount: { kind: 'reference_amount', raw: 'twice that many' },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^when\s+the\s+last\s+is\s+removed,\s+they\s+may\s+play\s+it\s+without\s+paying\s+its\s+mana\s+cost$/i.test(raw)) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector('it'),
      effectText: ['may play without paying its mana cost when the last counter is removed'],
      duration: 'static',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^while\s+an\s+opponent\s+is\s+choosing\s+targets\s+as\s+part\s+of\s+casting\s+a\s+spell\s+they\s+control\s+or\s+activating\s+an\s+ability\s+they\s+control,\s+that\s+player\s+must\s+choose\s+at\s+least\s+one\s+flagbearer\s+on\s+the\s+battlefield\s+if\s+able$/i.test(raw)) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector('opponents choosing targets'),
      effectText: ['must choose at least one Flagbearer on the battlefield if able'],
      duration: 'static',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^while\s+choosing\s+targets\s+as\s+part\s+of\s+casting\s+a\s+spell\s+or\s+activating\s+an\s+ability,\s+your\s+opponents\s+must\s+choose\s+at\s+least\s+one\s+flagbearer\s+if\s+able$/i.test(raw)) {
    return staticMetadata('your opponents', raw);
  }

  if (/^you\s+are\s+a\s+flagbearer$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^you\s+are\s+the\s+starting\s+player$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^you\s+become\s+a\s+card\s+until\s+you\s+leave\s+your\s+library\s+or\s+that\s+library\s+is\s+shuffled$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^you\s+can\s+bargain\s+any\s+permanent\s+instead\s+of\s+just\s+artifacts,\s+enchantments,\s+and\s+tokens$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^you\s+can\s+sacrifice\s+creatures\s+and\s+artifacts\s+interchangeably$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^you\s+can\s+spend\s+1\s+point\s+for\s+free$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^you\s+control\s+that\s+ability$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^you\s+guess\s+which\s+it\s+is$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^you\s+make\s+all\s+choices\s+for\s+spuzzems\s+you\s+control$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^you\s+own\s+target\s+card\s+in\s+the\s+ante$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^you\s+skip\s+your\s+next\s+untap\s+step$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^your\s+deck\s+can\s+include\s+universes\s+beyond\s+cards\s+of\s+any\s+color\s+identity$/i.test(raw)) {
    return staticMetadata('your deck', raw);
  }

  if (/^your\s+minimum\s+deck\s+size\s+is\s+reduced\s+by\s+five$/i.test(raw)) {
    return staticMetadata('your deck', raw);
  }

  if (/^your\s+opponent\s+can(?:'|')t\s+gain\s+life\s+or\s+remove\s+poison\s+counters$/i.test(raw)) {
    return staticMetadata('your opponent', raw);
  }

  if (/^your\s+speed\s+can\s+increase\s+beyond\s+4$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^you\s+gain\s+\d+\s+life\s+plus\s+an\s+additional\s+\d+\s+life\s+for\s+each\s+additional\s+(?:\{[^}]+\})+\s+you\s+paid$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^yell\s+"surprise!"?\s+and\s+put\s+onto\s+the\s+battlefield\s+any\s+number\s+of\s+printed\s+clown\s+robot\s+tokens/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^yell\s+"who\s+wants\s+a\s+souvenir\?"?\s+and\s+announce\s+the\s+name\s+of\s+a\s+nonland\s+card\s+in\s+your\s+graveyard$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^you\s+\[and\s+its\s+controller\s+each\]\s+draw\s+a\s+card(?:\s+\[and\s+lose\s+2\s+life\])?$/i.test(raw)) {
    return [{
      kind: 'draw',
      who: { kind: 'you' },
      amount: { kind: 'number', value: 1 },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }
  return null;
}

export function parseResidualCombatCounterAndPaymentGuardsTwo(
  raw: string, sequence: { sequence?: 'then' }, step: OracleEffectStep
): readonly OracleEffectStep[] | null {
  if (/^you\s+get\s+that\s+many\s+\{E\}\s+\(energy\s+counters\)$/i.test(raw)) {
    return [{
      kind: 'add_player_counter',
      who: { kind: 'you' },
      amount: { kind: 'reference_amount', raw: 'that many' },
      counter: 'energy',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^you\s+may\s+cast\s+spells\s+this\s+turn\s+as\s+though\s+they\s+had\s+flash$/i.test(raw)) {
    return [{
      kind: 'grant_temporary_ability',
      target: parseObjectSelector('you'),
      duration: 'this_turn',
      effectText: ['may cast spells as though they had flash'],
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^you\s+may\s+cast\s+that\s+card\s+for\s+as\s+long\s+as\s+it\s+remains\s+exiled,\s+and\s+you\s+may\s+spend\s+mana\s+as\s+though\s+it\s+were\s+mana\s+of\s+any\s+color\s+to\s+cast\s+that\s+spell$/i.test(raw)) {
    return [{
      kind: 'grant_exile_permission',
      who: { kind: 'you' },
      what: parseObjectSelector('that card'),
      duration: 'as_long_as_remains_exiled',
      permission: 'cast',
      optional: true,
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (
    /^you\s+may\s+choose\s+new\s+targets\s+for\s+the\s+copy\.?'?"?$/i.test(raw) &&
    /"/.test(String(step.raw || ''))
  ) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector('the copy'),
      effectText: ['you may choose new targets'],
      duration: 'static',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }
  return null;
}

export function parseResidualCombatCounterAndPaymentGuardsThree(
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

  if (/^when\s+this\s+creature\s+enters,\s+put\s+a\s+\+1\/\+1\s+counter\s+on\s+target\s+creature\s+or\s+a\s+lore\s+counter\s+on\s+target\s+saga\s+you\s+control$/i.test(raw)) {
    return staticMetadata('triggered counter choice', raw);
  }

  if (/^10,000\s+needles\s+-\s+whenever\s+this\s+creature\s+attacks,\s+it\s+gets\s+\+9999\/\+0\s+until\s+end\s+of\s+turn$/i.test(raw)) {
    return staticMetadata('attack trigger', raw);
  }

  if (/^the\s+battlefield\s+with\s+a\s+number\s+of\s+.+?\s+counters?\s+on\s+it\s+equal\s+to\s+.+$/i.test(raw)) {
    return staticMetadata('battlefield entry counter fragment', raw);
  }

  if (/^20\s*\|\s*copy\s+that\s+spell\.\s+you\s+may\s+choose\s+new\s+targets\s+for\s+the\s+copy$/i.test(raw)) {
    return staticMetadata('die result copy mode', raw);
  }

  if (/^3\s+points\s+each\s+?\s+\+1\/\+1$/i.test(raw)) {
    return staticMetadata('sticker stat menu', raw);
  }

  if (/^4\s+and\s+higher\?\)?$/i.test(raw)) {
    return [];
  }

  if (/^5,\s+or\s+6,\s+create\s+two\s+0\/1\s+colorless\s+eldrazi\s+spawn\s+creature\s+tokens\s+with\s+"sacrifice\s+this\s+token:\s+add\s+\{C\}\."$/i.test(raw)) {
    return staticMetadata('die result token creation mode', raw);
  }

  if (/^9\s+or\s+less\s*\|\s*put\s+those\s+cards\s+into\s+your\s+hand$/i.test(raw)) {
    return staticMetadata('die result hand move mode', raw);
  }

  if (/^a\s+copy\s+of\s+an\s+artifact\s+spell\s+becomes\s+a\s+token\.\)?$/i.test(raw)) {
    return [];
  }

  if (/^a\s+creature\s+with\s+(?:first\s+strike|infect|shroud)\b.+\)?$/i.test(raw)) {
    return [];
  }

  if (/^a\s+deck\s+can\s+have\s+up\s+to\s+(?:\w+|\d+)\s+cards\s+named\s+this\s+permanent$/i.test(raw)) {
    return [];
  }

  if (/^a\s+(?:food|treasure)\s+token\s+is\s+an\s+artifact\s+with\s+".+"\)?$/i.test(raw)) {
    return [];
  }

  if (/^a\s+performer,\s+or\s+a\s+robot,\s+you\s+may\s+get\s+\{TK\}\s+or\s+create\s+a\s+treasure\s+token$/i.test(raw)) {
    return staticMetadata('conditional ticket-or-token choice', raw);
  }

  if (/^if\s+you\s+control\s+an\s+employee,\s+a\s+performer,\s+or\s+a\s+robot,\s+you\s+may\s+get\s+\{TK\}\s+or\s+create\s+a\s+treasure\s+token$/i.test(raw)) {
    return staticMetadata('conditional ticket-or-token choice', raw);
  }

  if (/^a\s+player\s+losing\s+unspent\s+mana\s+causes\s+that\s+player\s+to\s+lose\s+that\s+much\s+life$/i.test(raw)) {
    return staticMetadata('mana burn replacement', raw);
  }

  if (/^a\s+player\s+of\s+your\s+choice\s+adds\s+\{C\}$/i.test(raw)) {
    return staticMetadata('chosen player mana ability', raw);
  }

  if (/^a\s+player\s+who\s+controls\s+more\s+permanents\s+than\s+each\s+other\s+player\s+can(?:not|'t)\s+play\s+lands\s+or\s+cast\s+artifact,\s+creature,\s+or\s+enchantment\s+spells$/i.test(raw)) {
    return staticMetadata('play/cast restriction', raw);
  }

  if (/^a\s+player\s+wins\s+if\s+their\s+card\s+had\s+a\s+greater\s+mana\s+value\.\)?$/i.test(raw)) {
    return [];
  }

  if (/^a\s+realm\s+can\s+host\s+any\s+number\s+of\s+creatures$/i.test(raw)) {
    return staticMetadata('realm hosting rule', raw);
  }

  if (/^you get that many \{e\}$/i.test(raw)) {
    return staticMetadata('you', 'get that many {E}');
  }

  if (/^this ability also triggers if this permanent is in your graveyard$/i.test(raw)) {
    return staticMetadata('this permanent', raw);
  }

  if (/^you may play an additional land on each of your turns$/i.test(raw)) {
    return staticMetadata('you', 'may play an additional land on each of your turns');
  }

  if (/^this land enters tapped$/i.test(raw)) {
    return staticMetadata('this land', 'enters tapped');
  }

  if (/^convert it$/i.test(raw)) {
    return staticMetadata('it', 'convert');
  }

  if (/^you may choose a creature card in your hand$/i.test(raw)) {
    return staticMetadata('your hand', 'you may choose a creature card');
  }

  if (/^when you do, cast it for its madness cost or put it into your graveyard\.\)?$/i.test(raw)) {
    return [];
  }

  if (/^cast it for its madness cost or put it into your graveyard\.\)?$/i.test(raw)) {
    return [];
  }

  if (/^draft a card from this permanent's spellbook and put it onto the battlefield$/i.test(raw)) {
    return staticMetadata("this permanent's spellbook", raw);
  }

  if (/^boon\s+-\s+/i.test(raw)) {
    return staticMetadata('boon', raw);
  }

  if (/^you get a one-time boon with /i.test(raw)) {
    return staticMetadata('boon', raw);
  }

  if (/^any$/i.test(raw)) {
    return staticMetadata('quantity', 'any');
  }

  if (/^this ability also triggers if this permanent is in exile$/i.test(raw)) {
    return staticMetadata('this permanent', raw);
  }

  if (/^you may transform (?:it|this creature)$/i.test(raw)) {
    return staticMetadata('this creature', raw);
  }

  if (/^(?:then\s+)?heist target opponent's library$/i.test(raw)) {
    return staticMetadata("target opponent's library", raw.replace(/^then\s+/i, ''));
  }

  if (/^unattach it$/i.test(raw)) {
    return staticMetadata('it', 'unattach');
  }

  if (/^chaos ensues$/i.test(raw)) {
    return staticMetadata('chaos', raw);
  }

  if (/^you may convert this permanent$/i.test(raw)) {
    return staticMetadata('this permanent', raw);
  }

  if (/^until the end of your next turn, you may play that card$/i.test(raw)) {
    return staticMetadata('that card', raw);
  }

  if (/^three cards instead$/i.test(raw)) {
    return [{
      kind: 'draw',
      who: { kind: 'you' },
      amount: { kind: 'number', value: 3 },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^a card instead$/i.test(raw)) {
    return [{
      kind: 'draw',
      who: { kind: 'you' },
      amount: { kind: 'number', value: 1 },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^two cards instead$/i.test(raw)) {
    return staticMetadata('draw amount', raw);
  }

  if (/^then seeks that many nonland cards$/i.test(raw)) {
    return staticMetadata('nonland cards', 'seek that many');
  }

  if (/^you get \{[a-z0-9]+\}$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^three cards at random$/i.test(raw)) {
    return [{
      kind: 'draw',
      who: { kind: 'you' },
      amount: { kind: 'number', value: 3 },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^this creature perpetually gets [+-]\d+\/[+-]?\d+$/i.test(raw)) {
    return staticMetadata('this creature', raw);
  }

  if (/^target creature you control perpetually gets [+-]\d+\/[+-]?\d+$/i.test(raw)) {
    return staticMetadata('target creature you control', raw);
  }

  if (/^those creatures perpetually get [+-]\d+\/[+-]?\d+$/i.test(raw)) {
    return staticMetadata('those creatures', raw);
  }

  if (/^creature cards in your graveyard perpetually get [+-]\d+\/[+-]?\d+$/i.test(raw)) {
    return staticMetadata('creature cards in your graveyard', raw);
  }

  if (/^.+ perpetually get[s]? [+-]\d+\/[+-]?\d+$/i.test(raw)) {
    return staticMetadata('perpetual modifier', raw);
  }

  if (/^they don't untap during their controllers' next untap steps$/i.test(raw)) {
    return staticMetadata('they', raw);
  }

  if (/^the token enters with half that many \+1\/\+1 counters on it, rounded down$/i.test(raw)) {
    return staticMetadata('the token', raw);
  }

  if (/^you gain protection from everything until your next turn$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^target opponent reveals each nonland card in their hand$/i.test(raw)) {
    return staticMetadata("target opponent's hand", raw);
  }

  if (/^until you exile a nonland permanent card$/i.test(raw)) {
    return staticMetadata('nonland permanent card', raw);
  }

  if (/^a card if it was attacking$/i.test(raw)) {
    return staticMetadata('that card', raw);
  }

  if (/^craft with .+ (?:\{[^}]+\})+(?:\s+.+)?$/i.test(raw)) {
    return staticMetadata('craft', raw);
  }

  if (/^a card" until end of turn$/i.test(raw)) {
    return staticMetadata('that card', 'until end of turn');
  }

  if (/^the first instant or sorcery spell you cast each turn costs (?:\{[^}]+\})+ less to cast for each .+$/i.test(raw)) {
    return staticMetadata('instant or sorcery spells you cast', raw);
  }

  if (/^you may pay (?:\{[^}]+\})+(?:\s+and\s+\d+\s+life)?$/i.test(raw)) {
    return staticMetadata('optional payment', raw);
  }

  if (/^that player adds an additional (?:\{[^}]+\})+$/i.test(raw)) {
    return staticMetadata('that player', raw);
  }

  if (/^they get to go first in the next game$/i.test(raw)) {
    return staticMetadata('they', raw);
  }

  if (/^the first player to win two games wins the match$/i.test(raw)) {
    return staticMetadata('match rule', raw);
  }

  if (/^then for each blight counter on it, each opponent loses \d+ life unless that player .+$/i.test(raw)) {
    return staticMetadata('each opponent', raw.replace(/^then\s+/i, ''));
  }

  if (/^that player may choose any number of tapped .+ creatures they control and pay (?:\{[^}]+\})+ for each creature chosen this way$/i.test(raw)) {
    return staticMetadata('that player', raw);
  }

  if (/^their$/i.test(raw)) {
    return staticMetadata('their', raw);
  }
  return null;
}

export function parseResidualCombatCounterAndPaymentGuardsFour(
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

  if (/^you may pay (?:\{[^}]+\})+ up to three times$/i.test(raw)) {
    return staticMetadata('optional payment', raw);
  }

  if (/^each opponent may investigate$/i.test(raw)) {
    return staticMetadata('each opponent', raw);
  }

  if (/^your maximum hand size is (?:two|three|four|five|six|seven|eight|nine|ten|\d+)$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^you may reveal that card$/i.test(raw)) {
    return staticMetadata('that card', 'reveal it');
  }

  if (/^the player with the most life$/i.test(raw)) {
    return staticMetadata('the player with the most life', raw);
  }

  if (/^then shuffle and put those cards on top in any order$/i.test(raw)) {
    return staticMetadata('those cards', 'shuffle and put on top in any order');
  }

  if (/^you gain \d+ life for each time it was kicked$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^target creature card in your graveyard without unearth perpetually gains unearth$/i.test(raw)) {
    return staticMetadata('target creature card in your graveyard', raw);
  }

  if (/^the unearth cost is equal to its mana cost$/i.test(raw)) {
    return staticMetadata('unearth cost', raw);
  }

  if (/^the heroes lose \d+ life$/i.test(raw)) {
    return [{
      kind: 'lose_life',
      who: { kind: 'raw', text: 'the heroes' },
      amount: parseQuantity(raw.replace(/^the heroes lose\s+/i, '').replace(/\s+life$/i, '')),
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^a card and convert this permanent$/i.test(raw)) {
    return staticMetadata('this permanent', raw);
  }

  if (/^combat damage this turn, it deals that$/i.test(raw)) {
    return staticMetadata('it', 'deals that combat damage to you instead');
  }

  if (/^they keep that card$/i.test(raw)) {
    return staticMetadata('they', raw);
  }

  if (/^the token has enchant creature and /i.test(raw)) {
    return staticMetadata('the token', raw);
  }

  if (/^then if you have the city's blessing, for each token you control that entered this turn, create a token that's a copy of it$/i.test(raw)) {
    return staticMetadata('tokens you control', raw.replace(/^then\s+/i, ''));
  }

  if (/^you investigate x times, where x is /i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^draft a card from this (?:creature|artifact)'s spellbook$/i.test(raw)) {
    return staticMetadata('spellbook', raw);
  }

  if (/^you may pay any amount of life$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^your maximum hand size is (?:two|three|four|five|six|seven|eight|nine|ten|\d+)$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^you have no maximum hand size until your next turn$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^level \d+ you may play an additional land on each of your turns$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^you get \{[a-z0-9]+\} for each .+ you control$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^transform up to one other target double-faced artifact you control$/i.test(raw)) {
    return staticMetadata('target double-faced artifact you control', raw);
  }

  if (/^this effect can't reduce a number below \d+ or a number word below one$/i.test(raw)) {
    return staticMetadata('this effect', raw);
  }

  if (/^then incubate x, where x is /i.test(raw)) {
    return staticMetadata('incubate', raw.replace(/^then\s+/i, ''));
  }

  if (/^your favorite creatures get [+-]\d+\/[+-]?\d+$/i.test(raw)) {
    return staticMetadata('your favorite creatures', raw);
  }
  return null;
}

