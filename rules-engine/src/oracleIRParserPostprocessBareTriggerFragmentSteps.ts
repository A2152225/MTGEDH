// Extracted from rules-engine/src/oracleIRParserPostprocess.ts (chat B 40KB split campaign).
//
// Cluster: bare fragment parsers that recover a step from an isolated trigger effect clause -
// blight actions, conditional attach clauses, the general bare trigger-effect fragment walker,
// "counter from among" choices and bare energy gains.
//
// Public entry points:
//   parseBlightActionFragmentSteps
//   parseBareTriggerEffectFragmentSteps

import type { OracleEffectStep } from './oracleIR';
import { parseStructuredKeywordActionGrant } from './oracleIRParserPostprocessKeywordStaticGrantSteps';
import { parseStructuredTriggerResidualGrant } from './oracleIRParserPostprocessStructuredTriggerResidualChain';
import { normalizeLeadingConditionalCondition } from './oracleIRParserSacrificeHelpers';
import { normalizeOracleText, parseObjectSelector, parseQuantity, splitAttachClauseBody } from './oracleIRParserUtils';

function parseBlightActionFragmentSteps(
  raw: string,
  sequence: { sequence?: 'then' },
): readonly OracleEffectStep[] | null {
  const self = raw.match(/^blight\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x)$/i);
  if (self) {
    return [{
      kind: 'blight',
      who: { kind: 'you' },
      amount: parseQuantity(String(self[1] || '1').trim()),
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const eachOpponent = raw.match(/^each\s+opponent\s+blights?\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x)$/i);
  if (eachOpponent) {
    return [{
      kind: 'blight',
      who: { kind: 'each_opponent' },
      amount: parseQuantity(String(eachOpponent[1] || '1').trim()),
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const eachPlayer = raw.match(/^each\s+player\s+blights?\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x)$/i);
  if (eachPlayer) {
    return [{
      kind: 'blight',
      who: { kind: 'each_player' },
      amount: parseQuantity(String(eachPlayer[1] || '1').trim()),
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const targetOpponent = raw.match(/^target\s+opponent\s+blights?\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x)$/i);
  if (targetOpponent) {
    return [{
      kind: 'blight',
      who: { kind: 'target_opponent' },
      amount: parseQuantity(String(targetOpponent[1] || '1').trim()),
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const targetPlayer = raw.match(/^target\s+player\s+blights?\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x)$/i);
  if (targetPlayer) {
    return [{
      kind: 'blight',
      who: { kind: 'target_player' },
      amount: parseQuantity(String(targetPlayer[1] || '1').trim()),
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  return null;
}

function parseConditionalAttachFragmentSteps(
  normalized: string,
  sequence: { sequence?: 'then' },
): readonly OracleEffectStep[] | null {
  const match = normalized.match(
    /^if\s+(.+?),\s*(attach\s+(?:it|~|this(?:\s+(?:equipment|artifact|permanent))?)\s+to\s+.+?)(?:\.(?:\s|$)|$)/i,
  );
  if (!match) return null;

  const conditionRaw = normalizeLeadingConditionalCondition(String(match[1] || '').trim());
  const attachClause = String(match[2] || '').trim();
  const attachBody = attachClause.replace(/^attach\s+/i, '').trim();
  const attachSplit = splitAttachClauseBody(attachBody);
  if (!attachSplit) return null;

  return [{
    kind: 'conditional',
    condition: { kind: 'if', raw: conditionRaw },
    steps: [{
      kind: 'attach',
      attachment: parseObjectSelector(attachSplit.attachmentRaw),
      to: parseObjectSelector(attachSplit.toRaw),
      raw: attachClause,
    } as unknown as OracleEffectStep],
    raw: normalized,
    ...sequence,
  } as unknown as OracleEffectStep];
}

export function parseBareTriggerEffectFragmentSteps(raw: string): readonly OracleEffectStep[] | null {
  const normalized = normalizeOracleText(String(raw || ''))
    .replace(/^�\s*/, '')
    .replace(/[.)"]+$/g, '')
    .trim();
  if (!normalized) return null;

  const sequence = {} as { sequence?: 'then' };
  const energySteps = parseBareEnergyGainSteps(normalized, raw, sequence);
  if (energySteps) return energySteps;

  const counterFromAmongSteps = parseBareCounterFromAmongSteps(normalized, raw, sequence);
  if (counterFromAmongSteps) return counterFromAmongSteps;

  const blightAction = parseBlightActionFragmentSteps(normalized, sequence);
  if (blightAction) return blightAction;

  const conditionalAttach = parseConditionalAttachFragmentSteps(normalized, sequence);
  if (conditionalAttach) return conditionalAttach;

  const keywordGrant = parseStructuredKeywordActionGrant(normalized, sequence);
  if (keywordGrant) return keywordGrant;

  const direct = parseStructuredTriggerResidualGrant(normalized, sequence);
  if (direct) return direct;

  const eachPlayerSacrificeChoice = normalized.match(
    /^each\s+player\s+sacrifices\s+a\s+(.+?)(?:\s+of\s+their\s+choice)?\.?$/i
  );
  if (eachPlayerSacrificeChoice) {
    return [{
      kind: 'sacrifice',
      who: { kind: 'each_player' },
      what: parseObjectSelector(`a ${String(eachPlayerSacrificeChoice[1] || '').trim()}`),
      raw: normalized,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^destroy (?:it|them)\.?$/i.test(normalized)) {
    const pronoun = /^destroy them\.?$/i.test(normalized) ? 'them' : 'it';
    return [{
      kind: 'destroy',
      target: parseObjectSelector(pronoun),
      raw: normalized,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (
    /^(?:\{t\}:\s*)?(?:when you do, )?untap all other creatures you control and after this phase, there is an additional combat phase\.?$/i.test(
      normalized,
    )
  ) {
    return [
      {
        kind: 'tap_or_untap',
        target: parseObjectSelector('all other creatures you control'),
        mode: 'untap',
        raw: 'untap all other creatures you control',
        ...sequence,
      } as unknown as OracleEffectStep,
      {
        kind: 'add_extra_combat',
        raw: 'after this phase, there is an additional combat phase',
        sequence: 'then',
      } as unknown as OracleEffectStep,
    ];
  }

  const tapPumpMatch = normalized.match(
    /^you may tap any number of untapped creatures you control[.]?\s+this creature gets ([+-]?\d+)\/([+-]?\d+) until end of turn for each creature tapped this way[.]?$/i
  );
  if (tapPumpMatch) {
    const power = Number.parseInt(String(tapPumpMatch[1] || '0'), 10);
    const toughness = Number.parseInt(String(tapPumpMatch[2] || '0'), 10);
    return [
      {
        kind: 'tap_or_untap',
        target: parseObjectSelector('any number of untapped creatures you control'),
        mode: 'tap',
        optional: true,
        raw: 'you may tap any number of untapped creatures you control',
        ...sequence,
      } as unknown as OracleEffectStep,
      {
        kind: 'modify_pt',
        target: parseObjectSelector('this creature'),
        power,
        toughness,
        duration: 'end_of_turn',
        scaler: { kind: 'per_creature_tapped_this_way' },
        raw: `this creature gets ${String(tapPumpMatch[1] || '').trim()}/${String(tapPumpMatch[2] || '').trim()} until end of turn for each creature tapped this way`,
        sequence: 'then',
      } as unknown as OracleEffectStep,
    ];
  }

  const greasefangMatch = normalized.match(
    /^return target vehicle card from your graveyard to the battlefield\.\s*it gains haste\.\s*return it to its owner's hand at the beginning of your next end step\.?$/i
  );
  if (greasefangMatch) {
    return [
      {
        kind: 'move_zone',
        what: parseObjectSelector('target vehicle card from your graveyard'),
        to: 'battlefield',
        raw: 'return target vehicle card from your graveyard to the battlefield',
      } as unknown as OracleEffectStep,
      {
        kind: 'grant_temporary_ability',
        target: parseObjectSelector('it'),
        abilities: ['haste'],
        duration: 'this_turn',
        raw: 'it gains haste',
        sequence: 'then',
      } as unknown as OracleEffectStep,
      {
        kind: 'schedule_delayed_trigger',
        timing: 'your_next_end_step',
        effect: "return it to its owner's hand",
        steps: [{
          kind: 'move_zone',
          what: parseObjectSelector('it'),
          to: 'hand',
          toRaw: "its owner's hand",
          raw: "return it to its owner's hand",
        } as unknown as OracleEffectStep],
        raw: "return it to its owner's hand at the beginning of your next end step",
        sequence: 'then',
      } as unknown as OracleEffectStep,
    ];
  }

  return null;
}

function parseCounterFromAmongOptions(optionsText: string): string[] {
  return String(optionsText || '')
    .replace(/\u2019/g, "'")
    .replace(/,?\s*or\s+/gi, ', ')
    .replace(/,?\s*and\s+/gi, ', ')
    .split(/,\s*/)
    .map((opt) => opt.trim())
    .filter(Boolean);
}

function parseBareCounterFromAmongSteps(
  normalized: string,
  raw: string,
  sequence: { sequence?: 'then' },
): readonly OracleEffectStep[] | null {
  const compoundMatch = normalized.match(
    /^put a \+1\/\+1 counter and a counter from among (.+?) on it$/i,
  );
  if (compoundMatch) {
    const options = parseCounterFromAmongOptions(String(compoundMatch[1] || ''));
    if (options.length === 0) return null;
    return [
      {
        kind: 'add_counter',
        target: parseObjectSelector('it'),
        counter: '+1/+1',
        amount: { kind: 'number', value: 1 },
        raw,
        ...sequence,
      } as unknown as OracleEffectStep,
      {
        kind: 'player_choice',
        choice: 'generic',
        target: parseObjectSelector('it'),
        options,
        raw: `a counter from among ${String(compoundMatch[1] || '').trim()} on it`,
        sequence: 'then',
      } as unknown as OracleEffectStep,
    ];
  }

  const choiceMatch = normalized.match(
    /^put your choice of a counter from among (.+?) on (?:it|this permanent)$/i,
  );
  if (choiceMatch) {
    const options = parseCounterFromAmongOptions(String(choiceMatch[1] || ''));
    if (options.length === 0) return null;
    const targetText = /this permanent$/i.test(normalized) ? 'this permanent' : 'it';
    return [{
      kind: 'player_choice',
      choice: 'generic',
      target: parseObjectSelector(targetText),
      options,
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  return null;
}

function parseBareEnergyGainSteps(
  normalized: string,
  raw: string,
  sequence: { sequence?: 'then' },
): readonly OracleEffectStep[] | null {
  const ENERGY_WORD: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
  const parseEnergyAmount = (wordOrDigit: string | undefined, symbolGroup: string | undefined): number => {
    const symbolCount = (String(symbolGroup || '').match(/\{e\}/gi) || []).length;
    let amount = symbolCount > 0 ? symbolCount : 1;
    if (wordOrDigit) {
      const lower = String(wordOrDigit).toLowerCase();
      amount = ENERGY_WORD[lower] ?? (Number.parseInt(lower, 10) || amount);
    }
    return amount;
  };

  const lifeAndEnergyMatch = normalized.match(
    /^you gain (\d+) life and get (?:(one|two|three|four|five|\d+) )?((?:\{e\}\s*)+|energy)$/i,
  );
  if (lifeAndEnergyMatch) {
    const lifeAmount = Math.max(0, Number.parseInt(String(lifeAndEnergyMatch[1] || '0'), 10) || 0);
    const energyAmount = parseEnergyAmount(lifeAndEnergyMatch[2], lifeAndEnergyMatch[3]);
    return [
      {
        kind: 'gain_life',
        who: { kind: 'you' },
        amount: { kind: 'number', value: lifeAmount },
        raw,
        ...sequence,
      } as unknown as OracleEffectStep,
      {
        kind: 'add_player_counter',
        who: { kind: 'you' },
        amount: { kind: 'number', value: energyAmount },
        counter: 'energy',
        raw,
        sequence: 'then',
      } as unknown as OracleEffectStep,
    ];
  }

  const energyGetMatch = normalized.match(
    /^you get (?:(one|two|three|four|five|\d+) )?((?:\{e\}\s*)+|energy)$/i,
  );
  if (energyGetMatch) {
    const energyAmount = parseEnergyAmount(energyGetMatch[1], energyGetMatch[2]);
    return [{
      kind: 'add_player_counter',
      who: { kind: 'you' },
      amount: { kind: 'number', value: energyAmount },
      counter: 'energy',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  return null;
}


export { parseBlightActionFragmentSteps };
