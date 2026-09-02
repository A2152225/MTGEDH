// Extracted from rules-engine/src/oracleIRParserPostprocess.ts (chat B 40KB split campaign).
//
// Cluster: the tail half of parseCurrentResidualUnknownStep's chain, from the simple-action clause
// reparse through the clause fallbacks that close the chain.
//
// The head keeps its guards and then calls this helper in the tail's original position, so the
// first-match order of the whole chain is unchanged. staticMetadata is a verbatim copy of the
// chain prologue.

import type { OracleEffectStep } from './oracleIR';
import { normalizeClauseForParse, parseObjectSelector, parsePlayerSelector, parseQuantity } from './oracleIRParserUtils';
import { parseResidualGraveyardReturnAndConditionalGuardsThirteen } from './oracleIRParserPostprocessResidualGraveyardReturnAndConditionalGuards';
import { parseLifeTailStep } from './oracleIRParserPostprocessBattlefieldEntryCounterAndDrawLife';
import { tryParseSimpleCreateTokenClause } from './oracleIRParserTokenSimpleClauses';
import { tryParseRulesTextClause } from './oracleIRParserStaticAbilityClauses';
import { parseResidualReflexiveFragmentGuardsOne, parseResidualReflexiveFragmentGuardsThree, parseResidualReflexiveFragmentGuardsTwo } from './oracleIRParserPostprocessResidualReflexiveFragmentGuards';
import { tryParseZoneAndRemovalClause } from './oracleIRParserZoneAndRemovalActions';
import { parseResidualStaticGrantGuardsPrimary } from './oracleIRParserPostprocessResidualStaticGrantGuards';
import { parseResidualPerpetualAndSecretChoiceGuardsFour, parseResidualPerpetualAndSecretChoiceGuardsOne, parseResidualPerpetualAndSecretChoiceGuardsThree, parseResidualPerpetualAndSecretChoiceGuardsTwo } from './oracleIRParserPostprocessResidualPerpetualAndSecretChoiceGuards';
import {
  parseResidualCombatCounterAndPaymentGuardsFour,
  parseResidualCombatCounterAndPaymentGuardsThree,
} from './oracleIRParserPostprocessResidualCombatCounterAndPaymentGuards';
import { tryParseSimpleActionClause } from './oracleIRParserSimpleActionClauses';
import { normalizeCreatureTypeWord } from '../../shared/src/creatureTypes';

export function parseCurrentResidualUnknownStepTail(
  raw: string, sequence: { sequence?: 'then' }, clauseBody: string, step: OracleEffectStep
): readonly OracleEffectStep[] | null {
  const staticMetadata = (target: string, effectText: string): readonly OracleEffectStep[] => [{
    kind: 'grant_static_ability',
    target: parseObjectSelector(target),
    effectText: [effectText],
    duration: 'static',
    raw,
    ...sequence,
  } as unknown as OracleEffectStep];

  const reparsedSimple = tryParseSimpleActionClause({
    clause: normalizeClauseForParse(raw).clause,
    rawClause: raw,
    withMeta: <T extends OracleEffectStep>(value: T) => value,
  });
  if (reparsedSimple && reparsedSimple.kind !== 'unknown') {
    return [reparsedSimple];
  }

  if (/^at\s+the\s+beginning\s+of\s+your\s+upkeep,\s+surveil\s+\d+$/i.test(raw)) {
    return staticMetadata('triggered surveil ability', raw);
  }

  if (/^banana\s+with\s+"\{T\},\s+sacrifice\s+this\s+token:\s+add\s+\{[RG]\}\s+or\s+\{[RG]\}$/i.test(raw)) {
    return staticMetadata('token option', raw);
  }

  if (/^elesh\s+norn,\s+mother\s+of\s+machines$/i.test(raw)) {
    return staticMetadata('named card option', raw);
  }

  if (/^it\s+becomes\s+(?:day|night)$/i.test(raw)) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector('the game'),
      effectText: [raw],
      duration: 'static',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^for\s+each\s+player,\s+you\s+choose\s+a\s+creature\s+that\s+player\s+controls$/i.test(raw)) {
    return [{ kind: 'player_choice', choice: 'generic', raw, ...sequence } as unknown as OracleEffectStep];
  }

  if (/^(?:then\s+)?each\s+player\s+sacrifices\s+all\s+other\s+creatures\s+they\s+control\s+that\s+don(?:'|’)?t\s+share\s+a\s+creature\s+type\s+with\s+the\s+chosen\s+creature(?:\s+they\s+control)?$/i.test(raw)) {
    return [{
      kind: 'sacrifice',
      who: parsePlayerSelector('each player'),
      what: parseObjectSelector("all other creatures they control that don't share a creature type with the chosen creature they control"),
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const winnowChooseThenSacrifice = raw.match(
    /^for\s+each\s+player,\s+you\s+choose\s+a\s+creature\s+that\s+player\s+controls\.?\s+(?:then\s+)?each\s+player\s+sacrifices\s+all\s+other\s+creatures\s+they\s+control\s+that\s+don(?:'|’)?t\s+share\s+a\s+creature\s+type\s+with\s+the\s+chosen\s+creature(?:\s+they\s+control)?$/i,
  );
  if (winnowChooseThenSacrifice) {
    return [
      { kind: 'player_choice', choice: 'generic', raw, ...sequence } as unknown as OracleEffectStep,
      {
        kind: 'sacrifice',
        who: parsePlayerSelector('each player'),
        what: parseObjectSelector("all other creatures they control that don't share a creature type with the chosen creature they control"),
        sequence: 'then',
        raw,
      } as unknown as OracleEffectStep,
    ];
  }

  if (/^each\s+opponent\s+chooses\s+a\s+creature\s+they\s+control\.?\s+you\s+gain\s+control\s+of\s+those\s+creatures$/i.test(raw)) {
    return [
      { kind: 'player_choice', choice: 'generic', raw, ...sequence } as unknown as OracleEffectStep,
      {
        kind: 'gain_control',
        what: parseObjectSelector('those creatures'),
        newController: { kind: 'you' },
        duration: 'indefinite',
        raw,
        ...sequence,
      } as unknown as OracleEffectStep,
    ];
  }

  if (/^each\s+opponent\s+chooses\s+a\s+creature\s+they\s+control$/i.test(raw)) {
    return [{ kind: 'player_choice', choice: 'generic', raw, ...sequence } as unknown as OracleEffectStep];
  }

  if (/^for\s+each\s+opponent,\s+exile\s+cards\s+from\s+the\s+top\s+of\s+their\s+library\s+until\s+you\s+exile\s+a\s+nonland\s+card$/i.test(raw)) {
    return staticMetadata('opponent library exile mode', raw);
  }

  if (/^if\s+the\s+result\s+is\s+a\s+natural\s+20,\s+for\s+each\s+nonlegendary\s+creature\s+you\s+control,\s+create\s+a\s+token\s+that(?:'|\u2019)?s\s+a\s+copy\s+of\s+that\s+creature$/i.test(raw)) {
    return staticMetadata('die result token-copy mode', raw);
  }

  const targetCreatureBecomesSubtype = raw.match(/^target\s+creature\s+becomes\s+a\s+([a-z][a-z -]+?)\s+until\s+end\s+of\s+turn$/i);
  if (targetCreatureBecomesSubtype) {
    return [{
      kind: 'animate_permanent',
      target: parseObjectSelector('target creature'),
      addTypes: [String(targetCreatureBecomesSubtype[1] || '').trim()],
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^target\s+player\s+chooses\s+a\s+creature\s+they\s+control\s+and\s+puts\s+two\s+\+1\/\+1\s+counters\s+on\s+it$/i.test(raw)) {
    return [{
      kind: 'add_counter',
      target: parseObjectSelector('a creature target player controls'),
      counter: '+1/+1',
      amount: { kind: 'number', value: 2 },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^target\s+player\s+puts\s+a\s+\+1\/\+1\s+counter\s+on\s+each\s+creature\s+they\s+control$/i.test(raw)) {
    return [{
      kind: 'add_counter',
      target: parseObjectSelector('each creature target player controls'),
      counter: '+1/+1',
      amount: { kind: 'number', value: 1 },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const targetPlayerReturns = raw.match(/^target\s+player\s+returns\s+(.+?)\s+from\s+their\s+graveyard\s+to\s+their\s+hand$/i);
  if (targetPlayerReturns) {
    return [{
      kind: 'move_zone',
      what: parseObjectSelector(`${String(targetPlayerReturns[1] || '').trim()} from target player's graveyard`),
      to: 'hand',
      toRaw: 'their hand',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^that\s+creature(?:'|\u2019)s\s+controller\s+mills\s+cards\s+equal\s+to\s+its\s+power$/i.test(raw)) {
    return [{
      kind: 'mill',
      who: parsePlayerSelector("that creature's controller"),
      amount: { kind: 'reference_amount', raw: 'cards equal to its power' },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const selfCreatureAnimation = raw.match(/^until\s+end\s+of\s+turn,\s+(this\s+creature|target\s+creature)\s+becomes\s+a\s+([a-z][a-z -]+?)\s+with\s+base\s+power\s+and\s+toughness\s+(\d+)\/(\d+)(?:\s+and\s+gains\s+(.+))?$/i);
  if (selfCreatureAnimation) {
    const typeText = String(selfCreatureAnimation[2] || '').trim();
    const abilityText = String(selfCreatureAnimation[5] || '').trim();
    return [{
      kind: 'animate_permanent',
      target: parseObjectSelector(String(selfCreatureAnimation[1] || 'this creature').trim()),
      addTypes: typeText ? [typeText] : ['creature'],
      power: Number.parseInt(String(selfCreatureAnimation[3] || '0'), 10),
      toughness: Number.parseInt(String(selfCreatureAnimation[4] || '0'), 10),
      ...(abilityText ? { abilities: [abilityText.toLowerCase()] } : {}),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const ptKeywordAndQuoted = raw.match(
    /^(?:until\s+end\s+of\s+turn,\s+)?(target\s+creature(?:\s+you\s+control)?)\s+gets\s+([+-]\d+)\/([+-]\d+)\s+and\s+gains?\s+(flying|trample|vigilance|lifelink|deathtouch|reach|menace|haste|first strike|double strike)\s+and\s+"([^"]+)"?$/i,
  );
  if (ptKeywordAndQuoted) {
    const target = parseObjectSelector(String(ptKeywordAndQuoted[1] || '').trim());
    return [
      {
        kind: 'modify_pt',
        target,
        power: Number.parseInt(String(ptKeywordAndQuoted[2] || '0'), 10),
        toughness: Number.parseInt(String(ptKeywordAndQuoted[3] || '0'), 10),
        duration: 'end_of_turn',
        raw,
        ...sequence,
      } as unknown as OracleEffectStep,
      {
        kind: 'grant_temporary_ability',
        target,
        duration: 'end_of_turn',
        abilities: [String(ptKeywordAndQuoted[4] || '').trim().toLowerCase()],
        effectText: [String(ptKeywordAndQuoted[5] || '').trim()],
        raw,
        sequence: 'then',
      } as unknown as OracleEffectStep,
    ];
  }

  const hoistedResidualCombatCounterAndPaymentGuardsThree = parseResidualCombatCounterAndPaymentGuardsThree(raw, sequence);
  if (hoistedResidualCombatCounterAndPaymentGuardsThree) return hoistedResidualCombatCounterAndPaymentGuardsThree;

  const drawReplacementResidual = raw.match(
    /^until end of turn, if you would draw a card, draw (.+?) instead\.?["']?$/i
  );
  if (drawReplacementResidual) {
    return [{
      kind: 'draw',
      who: { kind: 'you' },
      amount: parseQuantity(String(drawReplacementResidual[1] || '').trim()),
      replacementOf: 'draw_card',
      duration: 'end_of_turn',
      raw: raw.replace(/[".]+$/g, ''),
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^a card if /i.test(raw)) {
    return staticMetadata('draw condition', raw);
  }

  {
    const drawAndLose = raw.match(
      /^(.+?)\s+draws?\s+((?:a card|a|an|\d+|x|two|three|four|five|six|seven|eight|nine|ten|[a-z]+)\s+cards?)\s+and\s+loses?\s+(\d+|x|two|three|four|five|six|seven|eight|nine|ten|[a-z]+)\s+life$/i
    );
    if (drawAndLose) {
      const who = parsePlayerSelector(String(drawAndLose[1] || '').trim());
      const drawAmount = parseQuantity(String(drawAndLose[2] || '').trim());
      const lifeAmount = parseQuantity(String(drawAndLose[3] || '').trim());
      return [
        {
          kind: 'draw',
          who,
          amount: drawAmount,
          raw: `${String(drawAndLose[1] || '').trim()} draws ${String(drawAndLose[2] || '').trim()}`,
          ...sequence,
        } as unknown as OracleEffectStep,
        {
          kind: 'lose_life',
          who,
          amount: lifeAmount,
          raw: `${String(drawAndLose[1] || '').trim()} loses ${String(drawAndLose[3] || '').trim()} life`,
          sequence: 'then',
        } as unknown as OracleEffectStep,
      ];
    }

    const drawCommaLose = raw.match(
      /^(.+?)\s+draws?\s+((?:a card|a|an|\d+|x|two|three|four|five|six|seven|eight|nine|ten|[a-z]+)\s+cards?),\s+loses?\s+(\d+|x|two|three|four|five|six|seven|eight|nine|ten|[a-z]+)\s+life$/i
    );
    if (drawCommaLose) {
      const who = parsePlayerSelector(String(drawCommaLose[1] || '').trim());
      const drawAmount = parseQuantity(String(drawCommaLose[2] || '').trim());
      const lifeAmount = parseQuantity(String(drawCommaLose[3] || '').trim());
      return [
        {
          kind: 'draw',
          who,
          amount: drawAmount,
          raw: `${String(drawCommaLose[1] || '').trim()} draws ${String(drawCommaLose[2] || '').trim()}`,
          ...sequence,
        } as unknown as OracleEffectStep,
        {
          kind: 'lose_life',
          who,
          amount: lifeAmount,
          raw: `${String(drawCommaLose[1] || '').trim()} loses ${String(drawCommaLose[3] || '').trim()} life`,
          sequence: 'then',
        } as unknown as OracleEffectStep,
      ];
    }
  }

  if (/^teamwork \d+\s*\(/i.test(raw)) {
    return staticMetadata('teamwork', raw);
  }

  if (/^while each one is exiled, its owner may cast it for \{2\} rather than its mana cost\.\)?$/i.test(raw)) {
    return staticMetadata('exiled cards', raw);
  }

  const gainLifePerTapped = raw.match(/^you gain (\d+) life for each creature tapped this way$/i);
  if (gainLifePerTapped) {
    return [{
      kind: 'gain_life',
      who: { kind: 'you' },
      amount: {
        kind: 'reference_amount',
        raw: `${String(gainLifePerTapped[1] || '').trim()} for each creature tapped this way`,
      },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const hoistedResidualCombatCounterAndPaymentGuardsFour = parseResidualCombatCounterAndPaymentGuardsFour(raw, sequence);
  if (hoistedResidualCombatCounterAndPaymentGuardsFour) return hoistedResidualCombatCounterAndPaymentGuardsFour;

  {
    const discardLoseSacrifice = raw.match(
      /^(.+?)\s+discards?\s+((?:a card|a|an|\d+|[a-z]+)\s+cards?),\s+loses?\s+(\d+)\s+life,\s+and\s+sacrifices?\s+(.+)$/i
    );
    if (discardLoseSacrifice) {
      const who = String(discardLoseSacrifice[1] || '').trim();
      const discardVerb = /^you$/i.test(who) ? 'discard' : 'discards';
      const loseVerb = /^you$/i.test(who) ? 'lose' : 'loses';
      const sacrificeVerb = /^you$/i.test(who) ? 'sacrifice' : 'sacrifices';
      return [
        {
          kind: 'discard',
          who: parsePlayerSelector(who),
          amount: parseQuantity(String(discardLoseSacrifice[2] || '').trim()),
          raw: `${who} ${discardVerb} ${String(discardLoseSacrifice[2] || '').trim()}`,
          ...sequence,
        } as unknown as OracleEffectStep,
        {
          kind: 'lose_life',
          who: parsePlayerSelector(who),
          amount: parseQuantity(String(discardLoseSacrifice[3] || '').trim()),
          raw: `${who} ${loseVerb} ${String(discardLoseSacrifice[3] || '').trim()} life`,
          sequence: 'then',
        } as unknown as OracleEffectStep,
        {
          kind: 'sacrifice',
          who: parsePlayerSelector(who),
          what: parseObjectSelector(String(discardLoseSacrifice[4] || '').trim()),
          raw: `${who} ${sacrificeVerb} ${String(discardLoseSacrifice[4] || '').trim()}`,
          sequence: 'then',
        } as unknown as OracleEffectStep,
      ];
    }
  }

  const hoistedResidualPerpetualAndSecretChoiceGuardsOne = parseResidualPerpetualAndSecretChoiceGuardsOne(raw, sequence, step);
  if (hoistedResidualPerpetualAndSecretChoiceGuardsOne) return hoistedResidualPerpetualAndSecretChoiceGuardsOne;

  {
    const gyTypeReturn = raw.match(
      /^(?:[^,]+,\s*)?return up to one target ([a-z]+) card from your graveyard to your hand$/i,
    );
    const gyType = gyTypeReturn ? normalizeCreatureTypeWord(String(gyTypeReturn[1] || '')) : null;
    if (gyType) {
      return staticMetadata(
        `target ${gyType} card in your graveyard`,
        raw.replace(/^[^,]+,\s*/i, ''),
      );
    }
  }

  if (/^bert, and william die, if they were a creature, return them to the battlefield$/i.test(raw)) {
    return staticMetadata('tom, bert, and william', raw);
  }

  const hoistedResidualStaticGrantGuardsPrimary = parseResidualStaticGrantGuardsPrimary(raw, sequence, step);
  if (hoistedResidualStaticGrantGuardsPrimary) return hoistedResidualStaticGrantGuardsPrimary;

  // Double-cascade ("Then do it again") must remain visible as an unknown step.
  // Contagion Engine / proliferate leftovers are dropped later by
  // pruneRedundantProliferateReminderUnknownAbilities when the ability is proliferate-scoped.
  if (/^then do it again$/i.test(raw)) {
    return [{ kind: 'unknown', raw: 'Then do it again', ...sequence } as OracleEffectStep];
  }

  if (/^if you do,\s*proliferate(?:\s+(twice|two\s+times|2\s+times))?$/i.test(raw)) {
    const twice = /\b(?:twice|two\s+times|2\s+times)\b/i.test(raw);
    const proliferateStep = {
      kind: 'proliferate',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep;
    return twice ? [proliferateStep, { ...proliferateStep }] : [proliferateStep];
  }

  const hoistedResidualPerpetualAndSecretChoiceGuardsTwo = parseResidualPerpetualAndSecretChoiceGuardsTwo(raw, sequence);
  if (hoistedResidualPerpetualAndSecretChoiceGuardsTwo) return hoistedResidualPerpetualAndSecretChoiceGuardsTwo;

  {
    const cardAndSacrifice = raw.match(/^(a card|\d+ cards?|two cards?|three cards?|x cards?)\s+and\s+sacrifices?\s+(.+)$/i);
    if (cardAndSacrifice) {
      return [
        {
          kind: 'draw',
          who: { kind: 'you' },
          amount: parseQuantity(String(cardAndSacrifice[1] || '').trim()),
          raw: `draw ${String(cardAndSacrifice[1] || '').trim()}`,
          ...sequence,
        } as unknown as OracleEffectStep,
        {
          kind: 'sacrifice',
          who: { kind: 'you' },
          what: parseObjectSelector(String(cardAndSacrifice[2] || '').trim()),
          raw: `sacrifice ${String(cardAndSacrifice[2] || '').trim()}`,
          sequence: 'then',
        } as unknown as OracleEffectStep,
      ];
    }
  }

  {
    const cardAndReveal = raw.match(/^(a card|\d+ cards?|two cards?|three cards?|x cards?)\s+and\s+reveal(?:s)?\s+it$/i);
    if (cardAndReveal) {
      return [
        {
          kind: 'draw',
          who: { kind: 'you' },
          amount: parseQuantity(String(cardAndReveal[1] || '').trim()),
          raw: `draw ${String(cardAndReveal[1] || '').trim()}`,
          ...sequence,
        } as unknown as OracleEffectStep,
        {
          kind: 'grant_static_ability',
          target: parseObjectSelector('it'),
          effectText: ['reveal it'],
          duration: 'static',
          raw: 'reveal it',
          sequence: 'then',
        } as unknown as OracleEffectStep,
      ];
    }
  }

  {
    const cardAndConvert = raw.match(/^(a card|\d+ cards?|two cards?|three cards?|x cards?)\s+and\s+convert(?:s)?\s+(.+)$/i);
    if (cardAndConvert) {
      return [
        {
          kind: 'draw',
          who: { kind: 'you' },
          amount: parseQuantity(String(cardAndConvert[1] || '').trim()),
          raw: `draw ${String(cardAndConvert[1] || '').trim()}`,
          ...sequence,
        } as unknown as OracleEffectStep,
        {
          kind: 'grant_static_ability',
          target: parseObjectSelector(String(cardAndConvert[2] || '').trim()),
          effectText: ['convert'],
          duration: 'static',
          raw: `convert ${String(cardAndConvert[2] || '').trim()}`,
          sequence: 'then',
        } as unknown as OracleEffectStep,
      ];
    }
  }

  {
    const cardAndGain = raw.match(/^(a card|\d+ cards?|two cards?|three cards?|x cards?)\s+and\s+gains?\s+(\d+|x)(?:\s+life)?$/i);
    if (cardAndGain) {
      return [
        {
          kind: 'draw',
          who: { kind: 'you' },
          amount: parseQuantity(String(cardAndGain[1] || '').trim()),
          raw: `draw ${String(cardAndGain[1] || '').trim()}`,
          ...sequence,
        } as unknown as OracleEffectStep,
        {
          kind: 'gain_life',
          who: { kind: 'you' },
          amount: parseQuantity(String(cardAndGain[2] || '').trim()),
          raw: `gain ${String(cardAndGain[2] || '').trim()} life`,
          sequence: 'then',
        } as unknown as OracleEffectStep,
      ];
    }
  }

  {
    const cardAndLose = raw.match(/^(a card|\d+ cards?|two cards?|three cards?|x cards?)\s+and\s+loses?\s+(\d+|x)(?:\s+life)?$/i);
    if (cardAndLose) {
      return [
        {
          kind: 'draw',
          who: { kind: 'you' },
          amount: parseQuantity(String(cardAndLose[1] || '').trim()),
          raw: `draw ${String(cardAndLose[1] || '').trim()}`,
          ...sequence,
        } as unknown as OracleEffectStep,
        {
          kind: 'lose_life',
          who: { kind: 'you' },
          amount: parseQuantity(String(cardAndLose[2] || '').trim()),
          raw: `lose ${String(cardAndLose[2] || '').trim()} life`,
          sequence: 'then',
        } as unknown as OracleEffectStep,
      ];
    }
  }

  const hoistedResidualPerpetualAndSecretChoiceGuardsThree = parseResidualPerpetualAndSecretChoiceGuardsThree(raw, sequence);
  if (hoistedResidualPerpetualAndSecretChoiceGuardsThree) return hoistedResidualPerpetualAndSecretChoiceGuardsThree;

  if (/^you return that card to the battlefield /i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^you draw that many cards, create that many tapped treasure tokens$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^you draw a card, lose 1 life, and put a plan counter on this enchantment$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  if (/^you put that card on the bottom of your library and return the other to the battlefield tapped$/i.test(raw)) {
    return staticMetadata('you', raw);
  }

  const hoistedResidualPerpetualAndSecretChoiceGuardsFour = parseResidualPerpetualAndSecretChoiceGuardsFour(raw, sequence, step);
  if (hoistedResidualPerpetualAndSecretChoiceGuardsFour) return hoistedResidualPerpetualAndSecretChoiceGuardsFour;

  const whenYouDoFollowup = raw.match(/^when you do(?: so)?,?\s*(.+)$/i);
  if (whenYouDoFollowup) {
    const followup = String(whenYouDoFollowup[1] || '').trim();
    const nestedClause = normalizeClauseForParse(followup);
    const nested =
      tryParseZoneAndRemovalClause({
        clause: nestedClause.clause,
        rawClause: followup,
        withMeta: <T extends OracleEffectStep>(value: T) => value,
      })
      ?? tryParseSimpleActionClause({
        clause: nestedClause.clause,
        rawClause: followup,
        withMeta: <T extends OracleEffectStep>(value: T) => value,
      });
    const nestedSteps = nested && nested.kind !== 'unknown' ? [nested] : undefined;
    return [{
      kind: 'schedule_delayed_trigger',
      timing: 'on_event',
      effect: followup,
      ...(nestedSteps ? { steps: nestedSteps } : {}),
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const hoistedResidualReflexiveFragmentGuardsOne = parseResidualReflexiveFragmentGuardsOne(raw, sequence);
  if (hoistedResidualReflexiveFragmentGuardsOne) return hoistedResidualReflexiveFragmentGuardsOne;

  if (/^you return a creature or planeswalker card from your graveyard to your hand$/i.test(raw)) {
    return [{ kind: 'move_zone', what: parseObjectSelector('a creature or planeswalker card from your graveyard'), to: 'hand', toRaw: 'your hand', raw, ...sequence } as unknown as OracleEffectStep];
  }

  const hoistedResidualReflexiveFragmentGuardsTwo = parseResidualReflexiveFragmentGuardsTwo(raw, sequence);
  if (hoistedResidualReflexiveFragmentGuardsTwo) return hoistedResidualReflexiveFragmentGuardsTwo;

  if (
    /^if you have more poison counters than that player, return this permanent to its owner's hand$/i.test(
      clauseBody,
    )
  ) {
    return [{
      kind: 'conditional',
      condition: { kind: 'if', raw: 'you have more poison counters than that player' },
      steps: [{
        kind: 'move_zone',
        what: parseObjectSelector('this permanent'),
        to: 'hand',
        toRaw: "its owner's hand",
        raw: "return this permanent to its owner's hand",
      } as unknown as OracleEffectStep],
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const hoistedResidualReflexiveFragmentGuardsThree = parseResidualReflexiveFragmentGuardsThree(raw, sequence, clauseBody);
  if (hoistedResidualReflexiveFragmentGuardsThree) return hoistedResidualReflexiveFragmentGuardsThree;

  const withMeta = <T extends OracleEffectStep>(value: T) => value;
  const clauseFallback =
    tryParseRulesTextClause({ clause: clauseBody, rawClause: raw, withMeta }) ??
    tryParseSimpleCreateTokenClause({ clause: clauseBody, rawClause: raw, withMeta }) ??
    parseLifeTailStep(raw);
  if (clauseFallback) return [clauseFallback];

  const hoistedResidualGraveyardReturnAndConditionalGuardsThirteen = parseResidualGraveyardReturnAndConditionalGuardsThirteen(raw, sequence);
  if (hoistedResidualGraveyardReturnAndConditionalGuardsThirteen) return hoistedResidualGraveyardReturnAndConditionalGuardsThirteen;
  return null;
}

