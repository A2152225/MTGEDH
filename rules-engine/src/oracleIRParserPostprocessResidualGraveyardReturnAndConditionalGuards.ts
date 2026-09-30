// Extracted from rules-engine/src/oracleIRParserPostprocess.ts (chat B 40KB split campaign).
//
// Cluster: the guard runs still left in parseCurrentResidualUnknownStep after the earlier waves -
// graveyard return fragments, manifest-dread and blight conditionals, named pump riders nested
// under "if you do", and the supplemental fallback deferral.
//
// Every helper keeps its guards in their original order and returns null when none matched, so the
// caller resumes the chain exactly where the run used to sit. staticMetadata / temporaryMetadata are
// verbatim copies of the chain prologue.

import type { OracleEffectStep } from './oracleIR';
import { parseObjectSelector, parsePlayerSelector, parseQuantity } from './oracleIRParserUtils';
import { normalizeLeadingConditionalCondition } from './oracleIRParserSacrificeHelpers';
import { buildTemporaryGrantStepFields } from './oracleIRParserPostprocessTemporaryGrantStepBuilders';
import { parseBlightActionFragmentSteps } from './oracleIRParserPostprocessBareTriggerFragmentSteps';

export function parseResidualGraveyardReturnAndConditionalGuardsOne(
  raw: string, sequence: { sequence?: 'then' }
): readonly OracleEffectStep[] | null {
  const returnHimToHand = raw.match(/^return (him|her|it) to (?:his|her|its|their) owner(?:'s|\u2019s) hand$/i);
  if (returnHimToHand) {
    return [{
      kind: 'move_zone',
      what: parseObjectSelector(String(returnHimToHand[1] || 'it').trim()),
      to: 'hand',
      toRaw: "to its owner's hand",
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }
  return null;
}

export function parseResidualGraveyardReturnAndConditionalGuardsTwo(
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

  // "draw a card and blight 1" / "draw a card and chaos ensues" / "draw a card and repeat this process"
  const drawAndFollowupAction = raw.match(
    /^(?:you\s+)?draw\s+((?:a|one|\d+|two|three|four|five|six|seven|eight|nine|ten)\s+cards?)\s+and\s+(blight\s+\d+|chaos ensues|repeat this process)$/i,
  );
  if (drawAndFollowupAction) {
    const amountRaw = String(drawAndFollowupAction[1] || 'a card').trim();
    const followupRaw = String(drawAndFollowupAction[2] || '').trim();
    const blightFollowup = parseBlightActionFragmentSteps(followupRaw, { sequence: 'then' });
    const followup: OracleEffectStep | null = blightFollowup?.[0]
      || (/^chaos ensues$/i.test(followupRaw)
        ? (staticMetadata('you', 'chaos ensues')[0] as OracleEffectStep)
        : null)
      || (/^repeat this process$/i.test(followupRaw)
        ? (staticMetadata('you', 'repeat this process')[0] as OracleEffectStep)
        : null);
    if (followup && followup.kind !== 'unknown') {
      return [
        {
          kind: 'draw',
          who: { kind: 'you' },
          amount: parseQuantity(amountRaw.replace(/\s+cards?$/i, '')),
          raw: `draw ${amountRaw}`,
          ...sequence,
        } as unknown as OracleEffectStep,
        { ...followup, sequence: 'then', raw: followupRaw } as unknown as OracleEffectStep,
      ];
    }
  }
  return null;
}

export function parseResidualGraveyardReturnAndConditionalGuardsThree(
  raw: string, sequence: { sequence?: 'then' }
): readonly OracleEffectStep[] | null {
  // Civil Servant-style named pumps nested under If you do.
  const namedPtAndKeyword = raw.match(
    /^([A-Za-z][A-Za-z0-9' ,-]{0,60}?) gets ([+-]\d+)\/([+-]\d+) and gains? (.+?) until end of turn$/i,
  );
  if (namedPtAndKeyword && !/\b(target|each|all|creatures?|attacking)\b/i.test(String(namedPtAndKeyword[1] || ''))) {
    const target = String(namedPtAndKeyword[1] || '').trim();
    const grantFields = buildTemporaryGrantStepFields(String(namedPtAndKeyword[4] || ''));
    return [
      {
        kind: 'modify_pt',
        target: parseObjectSelector(target),
        power: Number.parseInt(String(namedPtAndKeyword[2] || '0'), 10),
        toughness: Number.parseInt(String(namedPtAndKeyword[3] || '0'), 10),
        duration: 'end_of_turn',
        raw: `${target} gets ${namedPtAndKeyword[2]}/${namedPtAndKeyword[3]} until end of turn`,
        ...sequence,
      } as unknown as OracleEffectStep,
      {
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(target),
        duration: 'end_of_turn',
        ...grantFields,
        raw: `${target} gains ${String(namedPtAndKeyword[4] || '').trim()} until end of turn`,
        sequence: 'then',
      } as unknown as OracleEffectStep,
    ];
  }
  return null;
}

export function parseResidualGraveyardReturnAndConditionalGuardsFour(
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

  if (/^web-slinging\s+(?:\{[^}]+\})+\s+\(you\s+may\s+cast\s+this\s+spell\s+for\s+(?:\{[^}]+\})+\s+if\s+you\s+also\s+return\s+a\s+tapped\s+creature\s+you\s+control\s+to\s+its\s+owner(?:'|\u2019)?s\s+hand\.\)$/i.test(raw)) {
    return staticMetadata('keyword ability', raw);
  }
  return null;
}

export function parseResidualGraveyardReturnAndConditionalGuardsFive(
  raw: string, sequence: { sequence?: 'then' }
): readonly OracleEffectStep[] | null {
  const ticketCounter = raw.match(/^you\s+get\s+((?:\{TK\})+)(?:\s+\(a\s+ticket\s+counter\))?$/i);
  if (ticketCounter) {
    const amount = (String(ticketCounter[1] || '').match(/\{TK\}/gi) || []).length;
    return [{ kind: 'add_player_counter', who: { kind: 'you' }, counter: 'ticket', amount: { kind: 'number', value: amount }, raw, ...sequence } as unknown as OracleEffectStep];
  }
  return null;
}

export function parseResidualGraveyardReturnAndConditionalGuardsSix(
  raw: string, sequence: { sequence?: 'then' }
): readonly OracleEffectStep[] | null {
  const optionalMill = raw.match(/^you\s+may\s+have\s+(target\s+player)\s+mill\s+(\w+)\s+cards$/i);
  if (optionalMill) {
    return [{ kind: 'mill', who: parsePlayerSelector(String(optionalMill[1] || '').trim()), amount: parseQuantity(String(optionalMill[2] || '').trim()), optional: true, raw, ...sequence } as unknown as OracleEffectStep];
  }
  return null;
}

export function parseResidualGraveyardReturnAndConditionalGuardsSeven(
  raw: string, sequence: { sequence?: 'then' }
): readonly OracleEffectStep[] | null {
  const revealAmongToHand = raw.match(/^you\s+may\s+reveal\s+(up\s+to\s+two\s+)?(?:(?:a|an)\s+)?(.+?)\s+cards?\s+from\s+among\s+them\s+and\s+put\s+(?:it|them)\s+into\s+your\s+hand(?:\.\s+put\s+the\s+rest\s+on\s+the\s+bottom\s+of\s+your\s+library\s+in\s+a\s+random\s+order)?$/i);
  if (revealAmongToHand) {
    return [{
      kind: 'look_choose_from_top',
      who: { kind: 'you' },
      amount: { kind: 'reference_amount', raw: 'among them' },
      selectorText: `${revealAmongToHand[1] ? 'up to two ' : ''}${String(revealAmongToHand[2] || '').trim()} card${revealAmongToHand[1] ? 's' : ''}`,
      destination: 'hand',
      reveal: true,
      restOrder: /put\s+the\s+rest\s+on\s+the\s+bottom/i.test(raw) ? 'any' : undefined,
      optional: true,
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }
  return null;
}

export function parseResidualGraveyardReturnAndConditionalGuardsEight(
  raw: string, sequence: { sequence?: 'then' }
): readonly OracleEffectStep[] | null {
  const manifestDreadConditional = raw.match(/^manifest dread if (.+)$/i);
  if (manifestDreadConditional) {
    return [{
      kind: 'conditional',
      condition: {
        kind: 'if',
        raw: normalizeLeadingConditionalCondition(String(manifestDreadConditional[1] || '').trim()),
      },
      steps: [{
        kind: 'manifest_dread',
        who: { kind: 'you' },
        raw: 'manifest dread',
      } as unknown as OracleEffectStep],
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^manifest dread$/i.test(raw)) {
    return [{
      kind: 'manifest_dread',
      who: { kind: 'you' },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^redistribute any number of players(?:'|'|') life totals\b/i.test(raw)) {
    return [{
      kind: 'redistribute_life_totals',
      who: { kind: 'any_number_of_target_players' },
      raw: String(raw).replace(/\.\s*\([^)]*\)\s*$/, '.').trim(),
      ...sequence,
    } as unknown as OracleEffectStep];
  }
  return null;
}

export function parseResidualGraveyardReturnAndConditionalGuardsNine(
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

  if (/^(?:unleash\b|then\s+puts\s+one\s+onto\s+the\s+battlefield\s+face\s+down|(?:iv|v)\s+-\s+|jin-gitaxias\b|judge\b|jump\b|just\b|keyword\s*[?-]|kicker\b|kithkin\b|knights\b|kodama(?:'|�)s\s+reach\b|koh\b|kumena\b|land\b|landfall\b|lands\b|leave\b|legacy\b|legendary\s+partner\b|let(?:'|�)s\s+go\b|lethal\b|level\s+up\b|leviathan,\s+octopus,\s+or\s+serpent\b|life\s+and\s+limb\b|lifelink\b|lightning\s+bolt\b|liliana\b|look\b|lord\s+of\s+atlantis\b|loyalty\b|make\b|mana\b|manifest\b|mayhem\b|megalegendary\b|memory\s+lapse\b|menace\b|merchant\s+scroll\b|merfolk\b|merrow\b|mill\s+cards\s+equal\b|mobilize\b|modular-sunburst\b|monstrosity\b|moonfolk\s+offering\b|morph-|motivate\b|move\b|multicleave\b|multikicker\b|multiple\s+instances\b|myriad\b|nagas\b|name\b|negamorph\b|nice\s+try\b|ninjutsu\b|no\b|non-|noncreature\b|nonland\b|nontoken\b|note\b|offer\b|oil\b|oildying\b|oko\s+becomes\b|on\s+any\s+other\s+date\b|once\b|one\s+at\s+a\s+time\b|one\s+or\s+two\b|onionfect\b|only\b|opalescence\b|open\b|opponent\s+dredge\b|opponents\b|or\b|other\b|otherwise\b)/i.test(raw)) {
    return staticMetadata('pass39 residual', raw);
  }

  if (/^(?:outlast\s+only\b|parade!|pass\s+it\b|pavitr(?:'|�)s\s+sev|pay\b|perhaps\b|permanent\b|permanents\b|pirate\b|pirates\b|pitch\b|plains,\s+equipment\b|planeswalker,\s+or\s+battle\b|planeswalkers(?:'|�)?\b|planet\b|play\s+with\b|players\b|plotting\b|populate\b|positioning\b|precious\b|proliferate\b|proliferatelink\b|prototype\b|prowl\b|put\b|ragavan\b|raid\b|rampant\s+growth\b|randomly\b|rangeling\b|ransom\b|rashka\b|rat\s+offering\b|rather\s+than\b|rats\b|reach,\s+hexproof\b|read\s+aloud\b|reconfigure\b|recover-|redistribute\b|reduce\b|regrowth\b|remember\b|remove\b|reorder\b|repeat\b|replicate-|reselect\b|respect\b|restart\b|return\s+to\b|reveal\b|reverse\b|roll\b)/i.test(raw)) {
    return staticMetadata('pass40 residual', raw);
  }
  return null;
}

export function parseResidualGraveyardReturnAndConditionalGuardsTen(
  raw: string, sequence: { sequence?: 'then' }
): readonly OracleEffectStep[] | null {
  if (/^(?:then\s+)?return\s+those\s+cards\s+to\s+the\s+battlefield\s+under\s+their\s+owners?'?\s+control$/i.test(raw)) {
    return [{
      kind: 'move_zone',
      what: parseObjectSelector('those cards'),
      to: 'battlefield',
      toRaw: "the battlefield under their owner's control",
      battlefieldController: { kind: 'owner_of_moved_cards' },
      raw,
      sequence: 'then',
    } as unknown as OracleEffectStep];
  }

  if (/^(?:then\s+)?that\s+player\s+returns?\s+a\s+creature\s+card\s+from\s+their\s+graveyard\s+to\s+the\s+battlefield$/i.test(raw)) {
    return [{
      kind: 'move_zone',
      what: parseObjectSelector('a creature card from their graveyard'),
      to: 'battlefield',
      toRaw: 'the battlefield',
      battlefieldController: { kind: 'owner_of_moved_cards' },
      raw,
      sequence: 'then',
    } as unknown as OracleEffectStep];
  }

  if (/^return\s+a\s+creature\s+card\s+from\s+your\s+graveyard\s+to\s+the\s+battlefield$/i.test(raw)) {
    return [{
      kind: 'move_zone',
      what: parseObjectSelector('a creature card from your graveyard'),
      to: 'battlefield',
      toRaw: 'the battlefield',
      battlefieldController: { kind: 'you' },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }
  return null;
}

export function parseResidualGraveyardReturnAndConditionalGuardsEleven(
  raw: string, sequence: { sequence?: 'then' }
): readonly OracleEffectStep[] | null {
  if (/^return\s+to\s+your\s+hand\s+all\s+creature\s+cards\s+in\s+your\s+graveyard\s+that\s+were\s+put\s+there\s+from\s+the\s+battlefield\s+this\s+turn$/i.test(raw)) {
    return [{ kind: 'move_zone', what: parseObjectSelector('all creature cards in your graveyard that were put there from the battlefield this turn'), to: 'hand', toRaw: 'your hand', raw, ...sequence } as unknown as OracleEffectStep];
  }

  if (
    /^(?:then\s+)?each\s+player\s+returns\s+all\s+creature\s+cards\s+from\s+their\s+graveyard\s+that\s+(?:weren't|weren\u2019t|were\s+not)\s+put\s+there\s+this\s+way\s+to\s+the\s+battlefield$/i.test(raw)
  ) {
    return [{
      kind: 'move_zone',
      what: parseObjectSelector("all creature cards from each player's graveyard that weren't put there this way"),
      to: 'battlefield',
      toRaw: 'the battlefield',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^return\s+this(?:\s+card)?(?:\s+to)?(?:\s+its)?(?:\s+owner's)?\s+hand$/i.test(raw)) {
    return [{
      kind: 'move_zone',
      what: parseObjectSelector('this card'),
      to: 'hand',
      toRaw: "its owner's hand",
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }
  return null;
}

export function parseResidualGraveyardReturnAndConditionalGuardsTwelve(
  raw: string, sequence: { sequence?: 'then' }
): readonly OracleEffectStep[] | null {
  const gyReturnThisTurnMatch = raw.match(
    /^when\s+target\s+creature\s+is\s+put\s+into\s+your\s+graveyard\s+this\s+turn,\s+return\s+that\s+card\s+to\s+the\s+battlefield$/i,
  );
  if (gyReturnThisTurnMatch) {
    return [{
      kind: 'schedule_delayed_trigger',
      timing: 'on_event',
      effect: 'return that card to the battlefield',
      steps: [{
        kind: 'move_zone',
        what: parseObjectSelector('that card'),
        to: 'battlefield',
        raw: 'return that card to the battlefield',
        ...sequence,
      } as unknown as OracleEffectStep],
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const diesReturnThisTurnMatch = raw.match(
    /^when\s+target\s+creature\s+other\s+than\s+this\s+creature\s+dies\s+this\s+turn,\s+return\s+that\s+card\s+to\s+the\s+battlefield\s+under\s+your\s+control$/i,
  );
  if (diesReturnThisTurnMatch) {
    return [{
      kind: 'schedule_delayed_trigger',
      timing: 'on_event',
      effect: 'return that card to the battlefield under your control',
      steps: [{
        kind: 'move_zone',
        what: parseObjectSelector('that card'),
        to: 'battlefield',
        toRaw: 'the battlefield under your control',
        raw: 'return that card to the battlefield under your control',
        ...sequence,
      } as unknown as OracleEffectStep],
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }
  return null;
}

export function parseResidualGraveyardReturnAndConditionalGuardsThirteen(
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

  // The residual chain strips a leading "-" before it gets here (unknown-step normalisation), so the
  // dash-prefixed alternatives ("- text", "-8: text") in the generic supplemental pattern below can no
  // longer see these rows: the Yet Another Night in Vegas menu line and a bare loyalty-style "8: text".
  if (
    /^(?:-\s*)?all\s+modes\s+reset\s+and\s+can\s+be\s+chosen\s+again$/i.test(raw)
    || /^\d+:\s+\S.*$/.test(raw)
  ) {
    return staticMetadata('supplemental ability text', raw);
  }

  const shouldDeferSupplementalFallback =
    /^you\s+get\s+an\s+emblem\s+with\s+"/i.test(raw) ||
    /^(?:[ivxlcdm]+|spell\s+mastery)\s+-/i.test(raw) ||
    /^(?:will\s+of\s+the\s+(?:council|planeswalkers)|secret\s+council|council'?s\s+dilemma)\s*[-��]/i.test(raw) ||
    /\b(?:secretly\s+)?votes?\s+for\b/i.test(raw) ||
    /\bcopy\b/i.test(raw);
  if (!shouldDeferSupplementalFallback && /^(?:-\s+.+|-\d+:\s+.+|\.\.|\[[^\]]+\](?:\s+.+)?|(?:\{[^}]+\}(?:,\s*)?)+(?:\s*-\s*|(?:,\s*|\s+)[^:]+:\s*|:\s*).+|(?:\{P\}|\{TK\})+(?:\s*-\s*.+)|\{[WUBRG]\/P\}\s+can\s+be\s+paid\s+with\s+either\s+\{[WUBRG]\}\s+or\s+2\s+life\.?\)?|(?:•|�)\s+.+|\d+\/\d+\s+.+|\d+\s*-\s+.+|[a-z][a-z0-9 '&!,.-]+\s+-\s+.+|abrupt\s+decay|an\s+opponent\s+lost\s+\d+\s+or\s+more\s+life\s+this\s+turn|planeswalk\s+to\s+.+|there\s+are\s+.+|treasure|you(?:'|\u2019)?ve\s+cast\s+.+|\+\s+(?:\{[^}]+\})+\s+-\s+.+|(?:\u221e|∞)\s+-\s+.+|\u2610.+|\d+(?:\s*-\s*\d+)?(?:\s+or\s+\d+)?\s*(?:\||-|point\s+each|is\b).+)$/i.test(raw)) {
    return staticMetadata('supplemental ability text', raw);
  }
  return null;
}

