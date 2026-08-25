// Extracted from rules-engine/src/oracleIRParserPostprocess.ts (chat B 40KB split campaign).
//
// Cluster: runs of guards lifted out of parseCurrentResidualUnknownStep's residual chain covering
// text-changing effects, colour changes, multi-zone searches and the large alphabetical catalogues of
// keyword fragments that lower to a plain static grant.
//
// Every helper keeps its guards in their original order and returns null when none matched, so the
// caller resumes the chain exactly where the run used to sit. staticMetadata / temporaryMetadata are
// verbatim copies of the chain prologue.

import type { OracleEffectStep } from './oracleIR';
import { parseObjectSelector, parsePlayerSelector } from './oracleIRParserUtils';

export function parseResidualTextChangeAndCatalogGuardsOne(
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

  if (/^(?:forbidden\b|forest,\s+or\s+plains\b|forests\s+you\s+control\s+are\b|foretelling\s+cards\b|forget\s*\(|fossilize\b|four-faced\b|fox\s+offering\b|freerunning-|fumiko\s+has\b|gates\s+you\s+control\s+enter\b|gen\s+gets\b|get\s+rid\s+of\s+the\s+monarchy\b|giant\s+growth\b|give\s+that\s+permanent\s+or\s+player\b|go\s+for\s+the\s+goal!|goblin\s+offering\b|goblin,\s+or\s+orc\b|gooooaaaalll!|gorm\s+must\s+be\s+blocked\b|graft\b|grazing\s+type\b|grek\s+gets\b)/i.test(raw)) {
    return staticMetadata('pass34 residual', raw);
  }

  if (/^(?:grenades!|grotag\s+thrasher\b|haktos\s+has\b|hand\s+backup\b|harness\s+this\s+permanent\b|haste,\s+toxic\b|he\s+gets\b|he(?:'|�)s\b|head\s+to\s+askurza\.com\b|hexproof\s+from\b|hideaway\b|hordeling\s+outburst\b|host\b|humans\s+you\s+control\s+have\b|humility\b|i\b|i\s+-\s+|i(?:'|�)m\b|i(?:'|�)ve\b)/i.test(raw)) {
    return staticMetadata('pass35 residual', raw);
  }

  if (
    /^if x is \d+ or more, instead put the chosen cards onto the battlefield or into your hand and the rest on the bottom of your library in a random order\.?$/i.test(
      raw,
    )
  ) {
    return [];
  }

  if (/^(?:then\s+put\s+the\s+rest\s+on\s+the\s+bottom\s+in\s+a\s+random\s+order|idyllic\s+tutor\b|revoke\s+existence\b|reprisal\b|it\s+can(?:'|�)t\s+be\s+regenerated|if\b)/i.test(raw)) {
    return staticMetadata('pass36 residual', raw);
  }

  if (/^(?:(?:dash|evoke|overload|cleave|impending|interplanar|infect)\b|splice\s+onto\b|i{2,4}\s+-\s+|ignore\b|immediately\s+after\s+the\s+draft\b|in\s+any\s+other\s+commander\s+game\b|increase\s+or\s+decrease\b|incubate\b|incubator\s+tokens\b|instant,\s+or\s+sorcery\s+spell\b|instead\b|investigate\b|it\s+(?:also|assembles|assigns)\b)/i.test(raw)) {
    return staticMetadata('pass37 residual', raw);
  }

  if (/^(?:it(?:'|�)s\b|it\s+(?:becomes|can\b|can(?:'|�)t\b|connives|deals|doesn(?:'|�)t\b|endures|enters|escapes|explores|gains|gets|has|just\b|loses|phases|puts|replaces|still\b|stops|triggers)\b|its\b)/i.test(raw)) {
    return staticMetadata('pass38 residual', raw);
  }

  if (/^put the rest on the bottom of your library in a random order\.?$/i.test(raw)) {
    return [];
  }

  if (/^put the rest on the bottom of your library in any order\.?$/i.test(raw)) {
    return [];
  }

  if (/^manifest dread twice$/i.test(raw)) {
    const dreadStep = {
      kind: 'manifest_dread',
      who: { kind: 'you' },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep;
    return [dreadStep, { ...dreadStep }];
  }
  return null;
}

export function parseResidualTextChangeAndCatalogGuardsTwo(
  raw: string, sequence: { sequence?: 'then' }
): readonly OracleEffectStep[] | null {
  if (/^search\s+(?:its\s+(?:controller|owner)|that\s+player)(?:'|�)?s\s+graveyard,\s+hand,\s+and\s+library\s+for\s+(?:all\s+|any\s+number\s+of\s+)?cards?\s+with\s+the\s+same\s+name\s+as\s+.+?\s+and\s+exile\s+them$/i.test(raw)) {
    const referencedZoneExile = raw.match(
      /^search\s+its\s+(controller|owner)(?:'|�)?s\s+graveyard,\s+hand,\s+and\s+library\s+for\s+(all\s+|any\s+number\s+of\s+)?cards?\s+with\s+the\s+same\s+name\s+as\s+(that\s+spell|that\s+card)\s+and\s+exile\s+them$/i
    );
    if (referencedZoneExile) {
      const role = String(referencedZoneExile[1] || '').trim().toLowerCase();
      const limitText = String(referencedZoneExile[2] || '').trim();
      return [{
        kind: 'exile_named_cards_from_zones',
        who:
          role === 'owner'
            ? { kind: 'owner_of_referenced_object' }
            : { kind: 'controller_of_referenced_object' },
        zones: ['graveyard', 'hand', 'library'],
        nameSource: /that\s+spell/i.test(String(referencedZoneExile[3] || ''))
          ? 'target_spell_name'
          : 'referenced_card_name',
        maxResults: /^(?:all|any\s+number\s+of)\s*$/i.test(limitText) ? 'any_number' : undefined,
        raw,
        ...sequence,
      } as unknown as OracleEffectStep];
    }
  }

  if (/^search\s+you\s+library\s+for\s+a\s+basic\s+land\s+card,\s+put\s+it\s+onto\s+the\s+battlefield\s+tapped$/i.test(raw)) {
    return [{
      kind: 'search_library',
      who: { kind: 'you' },
      criteria: { kind: 'raw', text: 'basic land card' },
      destination: 'battlefield',
      entersTapped: true,
      maxResults: 1,
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }
  return null;
}

export function parseResidualTextChangeAndCatalogGuardsThree(
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

  if (/^target\s+instant\s+or\s+sorcery\s+spell\s+becomes\s+the\s+color\s+of\s+your\s+choice$/i.test(raw)) {
    return staticMetadata('target instant or sorcery spell', raw);
  }

  if (/^target\s+(?:snow\s+land\s+is\s+no\s+longer\s+snow|snow\s+permanent\s+isn(?:'|�)t\s+snow\s+until\s+end\s+of\s+turn)$/i.test(raw)) {
    return staticMetadata('target snow permanent', raw);
  }

  if (/^(?:sorry,\s+.+\)|targeting\s+opponents,\s+anything\s+they\s+control,\s+and\/or\s+cards\s+in\s+their\s+graveyards\s+is\s+a\s+crime\.\))$/i.test(raw)) {
    return staticMetadata('reminder text residual', raw);
  }

  if (/^target\s+permanent$/i.test(raw)) {
    return staticMetadata('target permanent', raw);
  }

  if (/^target\s+player\s+searches\s+their\s+library\s+and\/or\s+graveyard\s+for\s+a\s+card\s+named\s+.+?,\s+reveals\s+it,\s+and\s+puts\s+it\s+into\s+their\s+hand$/i.test(raw)) {
    return staticMetadata('target player library/graveyard search', raw);
  }

  if (/^(?:tarmogoyf|tasty\s+\(this\s+creature\s+can\s+be\s+attacked\s+directly|teach\s+(?:\{[^}]+\})+\s+\(|tell\s+them\s+the\s+name\s+of\s+that\s+card|that\s+ability\s+triggers\s+an\s+additional\s+time\s+for\s+each\s+fish\s+tapped\s+this\s+way|that\s+card\s+is\s+now\s+on\s+an\s+adventure\s+for\s+you)$/i.test(raw)) {
    return staticMetadata('pass44 residual', raw);
  }

  if (/^that\s+artifact\s+gains\s+haste$/i.test(raw)) {
    return [{ kind: 'grant_static_ability', target: parseObjectSelector('that artifact'), abilities: ['haste'], raw, ...sequence } as unknown as OracleEffectStep];
  }
  return null;
}

export function parseResidualTextChangeAndCatalogGuardsFour(
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

  if (/^change\s+the\s+text\s+of\s+.+?\s+by\s+replacing\s+all\s+instances\s+of\s+.+/i.test(raw)) {
    const target = raw.match(/^change\s+the\s+text\s+of\s+(.+?)\s+by\s+replacing/i)?.[1] || 'target spell or permanent';
    if (/\buntil\s+end\s+of\s+turn\b/i.test(raw)) return temporaryMetadata(String(target).trim(), raw, 'end_of_turn');
    return staticMetadata(String(target).trim(), raw);
  }

  if (/^change\s+(?:this\s+creature(?:'|�)s|the)\s+base\s+(?:power|toughness|power\s+and\s+toughness)\b/i.test(raw)) {
    if (/\buntil\s+end\s+of\s+turn\b/i.test(raw)) return temporaryMetadata('this creature', raw, 'end_of_turn');
    return staticMetadata('this creature', raw);
  }

  if (/^change\s+the\s+base\s+power\s+and\s+toughness\s+of\s+.+/i.test(raw)) {
    if (/\buntil\s+end\s+of\s+turn\b/i.test(raw)) return temporaryMetadata('affected creatures', raw, 'end_of_turn');
    return staticMetadata('affected creatures', raw);
  }

  if (/^changing\s+targets\s+this\s+way\s+doesn(?:'|�)t\s+trigger\s+abilities\s+of\s+permanents\s+named\s+this\s+permanent$/i.test(raw)) {
    return staticMetadata('target-changing effect', raw);
  }

  if (/^choose (?:an opponent|target opponent)(?:\s+at\s+random|\s+who\s+.+)?\.?$/i.test(raw)) {
    return [{
      kind: 'choose_opponent',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^choose\b/i.test(raw)) {
    const choice = /\bcolor\b/i.test(raw)
      ? 'generic'
      : /\bcard\s+name\b/i.test(raw)
        ? 'generic'
        : /\bcreature\s+type\b/i.test(raw)
          ? 'generic'
          : 'generic';
    return [{ kind: 'player_choice', choice, raw, ...sequence } as unknown as OracleEffectStep];
  }

  if (/^at\s+(?:the\s+)?(?:beginning\s+of|end\s+of|this\s+turn's\s+next)\s+.+/i.test(raw)) {
    return staticMetadata('delayed trigger', raw);
  }
  return null;
}

export function parseResidualTextChangeAndCatalogGuardsFive(
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

  if (/^(?:ascend\s+magiccon|ask\s+(?:a\s+)?(?:person|player)\s+outside\s+the\s+game|assign\s+each\s+pile|assist\s+kicker|backup\b|bank\b|battlebond\b|bedtime\s+story\b|before\b|bestow-|blight\b|blitz\b|bolster\b|buyback-|buddy\s+list\b|call\s+someone\b|cast\s+(?:a\s+)?(?:any\s+number|copy|it\s+any\s+time|random|the\s+copies)\b|cards\s+exiled\s+this\s+way\b|cards\s+in\s+graveyards\b|cards\s+that\s+can\s+tax\b|cascade\b|casualty\s+x\b|compleated\b|conjure\b|copies\s+become\s+tokens\b|copy\b|coststorm\b)/i.test(raw)) {
    return staticMetadata('pass21 residual', raw);
  }

  if (/^(?:aura\s+and\s+equipment\s+spells|auras\s+and\s+equipment\s+you\s+control|avalanche!$|aven\s+mindcensor,|bats,\s+birds,\s+and\/or\s+mice\s+you\s+control\s+enter|because\s+let|basic\s+lands\s+of\s+the\s+first\s+chosen\s+type|black\s+and\/or\s+red\s+permanents\s+and\s+spells|blightning$|blood\s+moon$|bloodbraid\s+elf$|blitz\s+costs|blue,\s+black,\s+or\s+red,\s+put\s+a\s+\+1\/\+1\s+counter|boast\s+abilities\s+you\s+activate|bog-strider\s+ash$|braulios(?:'|�)?s\s+power|bring\s+(?:it\s+down|out\s+another)|by,\s+like|c\s+is\s+the\s+hypotenuse|calculate\s+the\s+hypotenuse|cast\s+a\s+sorcery\s+spell,\s+or\s+activate\s+a\s+loyalty\s+ability|charix,|check\s+it\s+off$|chicago\s+\(|control\s+a\s+blood,|count\s+the\s+|counter\s+(?:all|hits|on|that|up)|counters?\s+(?:and\s+stickers|can(?:not|'|�)t|remain|to\s+"0")|coven\s+-)/i.test(raw)) {
    return staticMetadata('pass21 residual', raw);
  }
  return null;
}

export function parseResidualTextChangeAndCatalogGuardsSix(
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

  if (/^the\s+owner\s+of\s+target\s+permanent\s+shuffles\s+it\s+into\s+their\s+library$/i.test(raw)) {
    return [{ kind: 'move_zone', what: parseObjectSelector('target permanent'), to: 'library', toRaw: 'their library', raw, ...sequence } as unknown as OracleEffectStep];
  }

  if (/^the\s+player\s+puts\s+that\s+card\s+onto\s+the\s+battlefield$/i.test(raw)) {
    return [{ kind: 'move_zone', what: parseObjectSelector('that card'), to: 'battlefield', toRaw: 'the battlefield', raw, ...sequence } as unknown as OracleEffectStep];
  }

  if (/^(?:the\s+player\s+to\s+your\s+right\s+chooses\s+a\s+color,\s+you\s+choose\s+another\s+color|the\s+player\s+to\s+your\s+right\s+gains\s+control\s+of\s+this\s+artifact|the\s+token\s+enters\s+tapped\s+and\s+attacking|the\s+tokens\s+are\s+goaded\s+for\s+the\s+rest\s+of\s+the\s+game)$/i.test(raw)) {
    return staticMetadata('static ability', raw);
  }

  if (/^the\s+token\s+gets\s+\+1\/\+1\s+until\s+end\s+of\s+turn\.?\)?$/i.test(raw)) {
    return [{ kind: 'modify_pt', target: parseObjectSelector('the token'), power: 1, toughness: 1, duration: 'end_of_turn', raw, ...sequence } as unknown as OracleEffectStep];
  }

  if (/^(?:enchanted\s+creature\s+has\s+".+"|the\s+same\s+is\s+true\s+for\s+.+|if\s+an\s+opponent\s+would\s+put\s+one\s+or\s+more\s+counters\s+on\s+a\s+permanent\s+or\s+player,\s+they\s+put\s+half\s+that\s+many\s+of\s+each\s+of\s+those\s+kinds\s+of\s+counters\s+on\s+that\s+permanent\s+or\s+player\s+instead,\s+rounded\s+down|for\s+each\s+kind\s+of\s+counter\s+on\s+target\s+permanent(?:\s+or\s+player)?,\s+(?:give\s+that\s+permanent\s+or\s+player\s+another\s+counter\s+of\s+that\s+kind|put\s+another\s+counter\s+of\s+that\s+kind\s+on\s+it\s+or\s+remove\s+one\s+from\s+it)|if\s+you\s+would\s+roll\s+one\s+or\s+more\s+dice,\s+instead\s+roll\s+that\s+many\s+dice\s+plus\s+one\s+and\s+ignore\s+the\s+lowest\s+roll|its\s+controller\s+adds\s+an\s+additional\s+two\s+mana\s+in\s+any\s+combination\s+of\s+colors|jump\s+-\s+during\s+your\s+turn,\s+this\s+permanent\s+has\s+flying|lock\s+or\s+unlock\s+a\s+door\s+of\s+target\s+room\s+you\s+control|look\s+at\s+target\s+face-down\s+creature|otherwise,\s+suspect\s+it|players\s+discard\s+cards\s+and\s+sacrifice\s+creatures\s+the\s+same\s+way|reveal\s+the\s+first\s+card\s+you\s+draw\s+each\s+turn|flip\s+five\s+coins|that\s+source\s+deals\s+double\s+that\s+damage\s+to\s+that\s+player\s+or\s+permanent|it\s+has\s+trample,\s+haste,\s+and\s+"at\s+the\s+beginning\s+of\s+the\s+end\s+step,\s+sacrifice\s+this\s+token\."|it(?:'|�)?s\s+a\s+2\/2\s+cyberman\s+artifact\s+creature|if\s+it\s+isn(?:'|�)?t\s+a\s+creature,\s+it\s+becomes\s+a\s+0\/0\s+robot\s+creature\s+in\s+addition\s+to\s+its\s+other\s+types|if\s+that\s+spell\s+would\s+be\s+put\s+into\s+a\s+graveyard,\s+put\s+it\s+on\s+the\s+bottom\s+of\s+its\s+owner(?:'|�)?s\s+library\s+instead|if\s+you\s+do,\s+increase\s+or\s+decrease\s+the\s+result\s+by\s+1|i+\s+-\s+you\s+may\s+sacrifice\s+a\s+creature|iii\s+-\s+choose\s+target\s+opponent)$/i.test(raw)) {
    return staticMetadata('static ability', raw);
  }

  if (/^parley\s+-\s+each\s+player\s+reveals\s+the\s+top\s+card\s+of\s+their\s+library$/i.test(raw)) {
    return [{ kind: 'reveal_top', who: { kind: 'each_player' }, amount: { kind: 'number', value: 1 }, raw, ...sequence } as unknown as OracleEffectStep];
  }

  if (/^if\s+it(?:'|�)?s\s+a\s+land\s+card,\s+the\s+player\s+puts\s+it\s+onto\s+the\s+battlefield$/i.test(raw)) {
    return [{ kind: 'move_zone', what: parseObjectSelector('it'), to: 'battlefield', toRaw: 'the battlefield', raw, ...sequence } as unknown as OracleEffectStep];
  }

  if (/^if\s+it(?:'|�)?s\s+a\s+permanent\s+card,\s+they\s+put\s+it\s+onto\s+the\s+battlefield$/i.test(raw)) {
    return [{
      kind: 'conditional',
      condition: { kind: 'if', raw: "it's a permanent card" },
      steps: [{
        kind: 'move_zone',
        what: parseObjectSelector('it'),
        to: 'battlefield',
        toRaw: 'the battlefield',
        raw: 'they put it onto the battlefield',
        ...sequence,
      } as unknown as OracleEffectStep],
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^otherwise,\s+you\s+may\s+put\s+it\s+into\s+your\s+graveyard$/i.test(raw)) {
    return [{ kind: 'move_zone', what: parseObjectSelector('it'), to: 'graveyard', toRaw: 'your graveyard', optional: true, raw, ...sequence } as unknown as OracleEffectStep];
  }

  if (/^otherwise,\s+put\s+it\s+into\s+your\s+graveyard$/i.test(raw)) {
    return [{ kind: 'move_zone', what: parseObjectSelector('it'), to: 'graveyard', toRaw: 'your graveyard', raw, ...sequence } as unknown as OracleEffectStep];
  }

  if (/^(?:then\s+)?puts?\s+those\s+cards\s+into\s+their\s+graveyard$/i.test(raw)) {
    return [{
      kind: 'move_zone',
      what: parseObjectSelector('those cards'),
      to: 'graveyard',
      toRaw: 'their graveyard',
      raw,
      sequence: 'then',
    } as unknown as OracleEffectStep];
  }
  return null;
}

export function parseResidualTextChangeAndCatalogGuardsSeven(
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

  if (
    /^put\s+one\s+of\s+the\s+chosen\s+cards\s+onto\s+the\s+battlefield,\s*the\s+other\s+chosen\s+cards\s+into\s+your\s+hand,\s*and\s+the\s+rest\s+into\s+your\s+graveyard\.?$/i.test(
      raw
    )
  ) {
    return [
      {
        kind: 'move_zone',
        what: parseObjectSelector('one of the chosen cards'),
        to: 'battlefield',
        toRaw: 'the battlefield',
        battlefieldController: { kind: 'you' },
        raw: 'Put one of the chosen cards onto the battlefield',
        ...sequence,
      } as unknown as OracleEffectStep,
      {
        kind: 'move_zone',
        what: parseObjectSelector('the other chosen cards'),
        to: 'hand',
        toRaw: 'your hand',
        raw: 'Put the other chosen cards into your hand',
        sequence: 'then',
      } as unknown as OracleEffectStep,
      {
        kind: 'move_zone',
        what: parseObjectSelector('the rest'),
        to: 'graveyard',
        toRaw: 'your graveyard',
        raw: 'Put the rest into your graveyard',
        sequence: 'then',
      } as unknown as OracleEffectStep,
    ];
  }

  if (/^if\s+you\s+don(?:'|�)?t,\s+it\s+enters\s+tapped$/i.test(raw)) {
    return staticMetadata('it', 'enters tapped');
  }

  if (/^put\s+the\s+cards\s+in\s+(?:your|their)\s+hand\s+on\s+the\s+bottom\s+of\s+(?:your|their)\s+library\s+in\s+any\s+order$/i.test(raw)) {
    const possessive = /\bin their hand\b/i.test(raw) ? 'their' : 'your';
    return [{
      kind: 'move_zone',
      what: parseObjectSelector(`the cards in ${possessive} hand`),
      to: 'library',
      toRaw: `bottom of ${possessive} library`,
      libraryPlacement: 'bottom',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^put\s+those\s+counters\s+on\s+up\s+to\s+one\s+target\s+creature$/i.test(raw)) {
    return [{ kind: 'add_counter', target: parseObjectSelector('up to one target creature'), counter: 'those counters', amount: { kind: 'reference_amount', raw: 'those counters' }, optional: true, raw, ...sequence } as unknown as OracleEffectStep];
  }

  if (/^put\s+onto\s+the\s+battlefield\s+under\s+your\s+control\s+all\s+creature\s+cards\s+in\s+all\s+graveyards\s+that\s+were\s+put\s+there\s+from\s+anywhere\s+this\s+turn$/i.test(raw)) {
    return [{ kind: 'move_zone', what: parseObjectSelector('all creature cards in all graveyards that were put there from anywhere this turn'), to: 'battlefield', toRaw: 'the battlefield under your control', raw, ...sequence } as unknown as OracleEffectStep];
  }
  return null;
}

export function parseResidualTextChangeAndCatalogGuardsEight(
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

  if (/^its\s+controller\s+manifests\s+dread$/i.test(raw)) {
    return [{
      kind: 'manifest_dread',
      who: { kind: 'target_player' },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^it\s+gains\s+haste\s+until\s+your\s+next\s+turn$/i.test(raw)) {
    return [{
      kind: 'grant_temporary_ability',
      target: parseObjectSelector('it'),
      abilities: ['haste'],
      duration: 'until_next_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^it\s+gains\s+suspend$/i.test(raw)) {
    return staticMetadata('it', 'gains suspend');
  }

  if (/^it\s+becomes\s+(?:night|foretold)$/i.test(raw)) {
    return staticMetadata('it', raw.replace(/^it\s+/i, ''));
  }

  if (/^it\s+enters\s+tapped\s+and\s+attacking$/i.test(raw)) {
    return staticMetadata('it', 'enters tapped and attacking');
  }

  if (/^it\s+enters\s+with\s+three\s+times\s+that\s+many\s+\+1\/\+1\s+counters\s+on\s+it\.?\)?$/i.test(raw)) {
    return [{
      kind: 'add_counter',
      target: parseObjectSelector('it'),
      counter: '+1/+1',
      amount: { kind: 'reference_amount', raw: 'three times that many' },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^that\s+many\s+plus\s+one\s+of\s+each\s+of\s+those\s+kinds\s+of\s+counters\s+are\s+put\s+on\s+that\s+permanent$/i.test(raw)) {
    return [{
      kind: 'add_counter',
      target: parseObjectSelector('that permanent'),
      counter: 'each of those kinds',
      amount: { kind: 'reference_amount', raw: 'that many plus one' },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^put\s+twice\s+that\s+many\s+of\s+each\s+of\s+those\s+kinds\s+of\s+counters\s+on\s+that\s+permanent\s+or\s+player$/i.test(raw)) {
    return [{
      kind: 'add_counter',
      target: parseObjectSelector('that permanent or player'),
      counter: 'each of those kinds',
      amount: { kind: 'reference_amount', raw: 'twice that many' },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^put\s+all\s+creatures\s+on\s+the\s+bottom\s+of\s+their\s+owners(?:'|�)?\s+libraries$/i.test(raw)) {
    return [{
      kind: 'move_zone',
      what: parseObjectSelector('all creatures'),
      to: 'library',
      toRaw: "bottom of their owners' libraries",
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^that\s+player\s+puts\s+that\s+card\s+onto\s+the\s+battlefield$/i.test(raw)) {
    return [{
      kind: 'move_zone',
      what: parseObjectSelector('that card'),
      to: 'battlefield',
      toRaw: 'the battlefield',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^that\s+player\s+returns\s+a\s+land\s+they\s+control\s+to\s+its\s+owner(?:'|�)?s\s+hand$/i.test(raw)) {
    return [{
      kind: 'move_zone',
      what: parseObjectSelector('a land they control'),
      to: 'hand',
      toRaw: "its owner's hand",
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }
  return null;
}

export function parseResidualTextChangeAndCatalogGuardsNine(
  raw: string, sequence: { sequence?: 'then' }
): readonly OracleEffectStep[] | null {
  if (/^target\s+unblocked\s+attacking\s+creature\s+becomes\s+blocked$/i.test(raw)) {
    return [{
      kind: 'grant_temporary_ability',
      target: parseObjectSelector('target unblocked attacking creature'),
      duration: 'this_turn',
      effectText: ['becomes blocked'],
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^that\s+player\s+exiles\s+it$/i.test(raw)) {
    return [{
      kind: 'move_zone',
      what: parseObjectSelector('it'),
      to: 'exile',
      toRaw: 'exile',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^that\s+player\s+reveals\s+the\s+top\s+card\s+of\s+their\s+library$/i.test(raw)) {
    return [{
      kind: 'reveal_top',
      who: parsePlayerSelector('that player'),
      amount: { kind: 'number', value: 1 },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^the\s+replicate\s+cost\s+is\s+equal\s+to\s+its\s+mana\s+cost$/i.test(raw)) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector('replicate cost'),
      effectText: ['is equal to its mana cost'],
      duration: 'static',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^(?:then\s+)?manifest\s+those\s+cards$/i.test(raw)) {
    return [{
      kind: 'move_zone',
      what: parseObjectSelector('those cards'),
      to: 'battlefield',
      toRaw: 'battlefield face down',
      entersFaceDown: true,
      raw,
      sequence: 'then',
    } as unknown as OracleEffectStep];
  }

  if (/^(?:then\s+)?puts\s+all\s+cards\s+they\s+exiled\s+this\s+way\s+onto\s+the\s+battlefield$/i.test(raw)) {
    return [{
      kind: 'move_zone',
      what: parseObjectSelector('all cards they exiled this way'),
      to: 'battlefield',
      toRaw: 'the battlefield',
      battlefieldController: { kind: 'owner_of_moved_cards' },
      raw,
      sequence: 'then',
    } as unknown as OracleEffectStep];
  }

  if (/^(?:then\s+)?shuffle\s+and\s+put\s+that\s+card\s+on\s+top$/i.test(raw)) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector('that card'),
      effectText: ['shuffle and put on top'],
      duration: 'static',
      raw,
      sequence: 'then',
    } as unknown as OracleEffectStep];
  }

  if (/^(?:then\s+)?those\s+choices\s+are\s+revealed$/i.test(raw)) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector('those choices'),
      effectText: ['are revealed'],
      duration: 'static',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }
  return null;
}

