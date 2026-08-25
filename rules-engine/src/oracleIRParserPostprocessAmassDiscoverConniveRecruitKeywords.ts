// Extracted from rules-engine/src/oracleIRParserPostprocess.ts (chat B 40KB split campaign).
//
// Extracted from oracleIRParserPostprocess.ts: keyword lowering and reminder pruning for amass, discover, connive, and recruit.
//
// Public entry points:
//   lowerAmassReminderAbilities
//   pruneRedundantAmassSubtypeReminderUnknownAbilities
//   lowerDiscoverKeywordAbilities
//   pruneRedundantDiscoverReminderUnknownAbilities
//   lowerConniveKeywordAbilities
//   lowerRecruitKeywordAbilities

import type { OracleEffectStep, OracleIRAbility, OracleQuantity } from './oracleIR';
import { normalizeReminderStepRaw } from './oracleIRParserPostprocessKeywordReminderPrunes';
import { isUnknownOnlyAbility } from './oracleIRParserPostprocessUnknownAbilityPredicates';
import { normalizeOracleText, parseQuantity } from './oracleIRParserUtils';

function tryLowerAmassAbilitySteps(steps: readonly OracleEffectStep[]): readonly OracleEffectStep[] | null {
  const singularizeAmassSubtype = (rawSubtype: string): string => {
    const normalizedSubtype = String(rawSubtype || '').trim().replace(/\s+/g, ' ');
    if (!normalizedSubtype) return 'Zombie';
    return /s$/i.test(normalizedSubtype) ? normalizedSubtype.slice(0, -1) : normalizedSubtype;
  };

  const getTypeArticle = (typeName: string): 'a' | 'an' => (/^[aeiou]/i.test(typeName) ? 'an' : 'a');

  const parseAmassLead = (
    step: OracleEffectStep
  ): { amountText: string; amount: OracleQuantity; subtype: string } | null => {
    if (!step || step.kind !== 'unknown') return null;

    const match = normalizeReminderStepRaw(step).match(/^amass(?:\s+([a-z][a-z' -]*?))?\s+(\d+|x)$/i);
    if (!match) return null;

    const rawSubtype = String(match[1] || '').trim();
    const amountText = String(match[2] || '').trim().toUpperCase();
    return {
      amountText,
      amount: parseQuantity(String(match[2] || '').trim()),
      subtype: singularizeAmassSubtype(rawSubtype || 'Zombie'),
    };
  };

  const buildAmassSteps = (
    amassLead: { amountText: string; amount: OracleQuantity; subtype: string },
    sequence?: 'then'
  ): OracleEffectStep[] => [
    {
      kind: 'conditional',
      condition: { kind: 'if', raw: "you don't control an Army creature" },
      steps: [
        {
          kind: 'create_token',
          who: { kind: 'you' },
          amount: { kind: 'number', value: 1 },
          token: `0/0 black ${amassLead.subtype} Army`,
          raw: `create a 0/0 black ${amassLead.subtype} Army creature token`,
        },
      ],
      ...(sequence ? { sequence } : {}),
      raw: `If you don't control an Army creature, create a 0/0 black ${amassLead.subtype} Army creature token`,
    } as unknown as OracleEffectStep,
    {
      kind: 'add_counter',
      amount: amassLead.amount,
      counter: '+1/+1',
      target: { kind: 'raw', text: 'Army creature you control' },
      raw: `Put ${amassLead.amountText} +1/+1 counter${amassLead.amountText === '1' ? '' : 's'} on an Army creature you control`,
    } as unknown as OracleEffectStep,
    {
      kind: 'add_types',
      target: { kind: 'raw', text: 'Army creature you control' },
      addTypes: [amassLead.subtype],
      raw:
        `If it isn't ${getTypeArticle(amassLead.subtype)} ${amassLead.subtype}, ` +
        `it becomes ${getTypeArticle(amassLead.subtype)} ${amassLead.subtype} in addition to its other types`,
    } as unknown as OracleEffectStep,
  ];

  const isSplitAmassCounterReminder = (step: OracleEffectStep): boolean => {
    if (!step || step.kind !== 'unknown') return false;

    return /^put (?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x) \+1\/\+1 counters? on an army you control$/i.test(
      normalizeReminderStepRaw(step)
    );
  };

  const parseSplitAmassSubtypeReminder = (step: OracleEffectStep | undefined): string | null => {
    if (!step || step.kind !== 'unknown') return null;

    const match = normalizeReminderStepRaw(step).match(/^it(?:'|’)?s also (?:a|an)\s+([a-z][a-z' -]*)$/i);
    if (!match) return null;

    return singularizeAmassSubtype(String(match[1] || '').trim());
  };

  const normalizeSplitAmassCreateConditional = (
    step: OracleEffectStep
  ): Extract<OracleEffectStep, { kind: 'conditional' }> | null => {
    if (!step || step.kind !== 'conditional') return null;

    const normalizedCondition = normalizeOracleText(String(step.condition?.raw || '')).toLowerCase();
    if (normalizedCondition !== "you don't control an army") return null;
    if (step.steps.length !== 1 || step.steps[0]?.kind !== 'create_token' || !/\barmy\b/i.test(String(step.steps[0]?.token || ''))) {
      return null;
    }

    const createStep = step.steps[0];
    const normalizedToken = String(createStep.token || '').trim();
    if (!normalizedToken) return null;

    return {
      ...step,
      condition: { kind: 'if', raw: "you don't control an Army creature" },
      steps: [
        {
          ...createStep,
          raw: `create a ${normalizedToken} creature token`,
        },
      ],
      raw: `If you don't control an Army creature, create a ${normalizedToken} creature token`,
    };
  };

  const parseAmassSubtypeConditional = (step: OracleEffectStep | undefined): string | null => {
    if (!step || step.kind !== 'conditional') return null;

    const conditionMatch = normalizeOracleText(String(step.condition?.raw || '')).match(
      /^it isn't (?:a|an) ([a-z][a-z' -]*)$/i
    );
    if (!conditionMatch || step.steps.length !== 1 || step.steps[0]?.kind !== 'grant_static_ability') return null;

    const subtype = singularizeAmassSubtype(String(conditionMatch[1] || '').trim());
    const effectText = (step.steps[0].effectText || [])
      .map((entry) => normalizeOracleText(String(entry || '')).replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join(' ');
    const subtypePattern = subtype.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(`^becomes (?:a|an) ${subtypePattern} in addition to its other types$`, 'i').test(effectText)) {
      return null;
    }

    return subtype;
  };

  let changed = false;
  const nextSteps: OracleEffectStep[] = [];

  for (let index = 0; index < steps.length; index += 1) {
    const current = steps[index];
    const chooseStep = steps[index + 1];
    const addCounterStep = steps[index + 2];
    const addTypeUnknownStep = steps[index + 3];

    const isAmassCreateConditional =
      current?.kind === 'conditional' &&
      normalizeOracleText(String(current.condition?.raw || '')).toLowerCase() === "you don't control an army creature" &&
      current.steps.length === 1 &&
      current.steps[0]?.kind === 'create_token' &&
      /\barmy\b/i.test(String(current.steps[0]?.token || ''));
    const isChooseArmyUnknown =
      chooseStep?.kind === 'unknown' &&
      normalizeOracleText(String(chooseStep.raw || '')).toLowerCase() === 'choose an army creature you control';
    const isContextualArmyCounter =
      addCounterStep?.kind === 'add_counter' &&
      addCounterStep.target.kind === 'raw' &&
      normalizeOracleText(String(addCounterStep.target.text || '')).toLowerCase() === 'that creature';

    const amassLead = parseAmassLead(current);
    const splitAmassSubtype = parseSplitAmassSubtypeReminder(addCounterStep);
    const splitAmassCreateConditional = normalizeSplitAmassCreateConditional(addTypeUnknownStep);
    const parsedSubtypeConditional = parseAmassSubtypeConditional(addCounterStep);

    if (
      isAmassCreateConditional &&
      chooseStep?.kind === 'add_counter' &&
      chooseStep.target.kind === 'raw' &&
      normalizeOracleText(String(chooseStep.target.text || '')).toLowerCase() === 'army creature you control' &&
      parsedSubtypeConditional
    ) {
      changed = true;
      nextSteps.push(current);
      nextSteps.push(chooseStep);
      nextSteps.push({
        kind: 'add_types',
        target: { kind: 'raw', text: 'Army creature you control' },
        addTypes: [parsedSubtypeConditional],
        ...(addCounterStep.sequence ? { sequence: addCounterStep.sequence } : {}),
        raw: addCounterStep.raw,
      });
      index += 2;
      continue;
    }

    if (amassLead && isSplitAmassCounterReminder(chooseStep) && splitAmassSubtype && splitAmassCreateConditional) {
      changed = true;
      index += 3;
      nextSteps.push(...buildAmassSteps({ ...amassLead, subtype: splitAmassSubtype }, current.sequence));
      continue;
    }

    if (amassLead) {
      changed = true;
      nextSteps.push(...buildAmassSteps(amassLead, current.sequence));
      continue;
    }

    if (!isAmassCreateConditional || !isChooseArmyUnknown || !isContextualArmyCounter) {
      nextSteps.push(current);
      continue;
    }

    changed = true;
    nextSteps.push(current);
    nextSteps.push({
      ...addCounterStep,
      target: { kind: 'raw', text: 'Army creature you control' },
      raw: String(addCounterStep.raw || '').replace(/\bthat creature\b/i, 'an Army creature you control'),
    });

    if (addTypeUnknownStep?.kind === 'unknown') {
      const typeUpgradeMatch = normalizeOracleText(String(addTypeUnknownStep.raw || '')).match(
        /^if it isn't (?:a|an) ([a-z][a-z' -]*), it becomes (?:a|an) \1 in addition to its other types$/i
      );
      if (typeUpgradeMatch) {
        index += 3;
        nextSteps.push({
          kind: 'add_types',
          target: { kind: 'raw', text: 'Army creature you control' },
          addTypes: [String(typeUpgradeMatch[1] || '').trim()],
          ...(addTypeUnknownStep.sequence ? { sequence: addTypeUnknownStep.sequence } : {}),
          raw: addTypeUnknownStep.raw,
        });
        continue;
      }
    }

    index += 2;
  }

  return changed ? nextSteps : null;
}

export function lowerAmassReminderAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const lowered = tryLowerAmassAbilitySteps(ability.steps);
    return lowered ? { ...ability, steps: lowered } : ability;
  });
}

function isRedundantAmassSubtypeReminderUnknownStep(
  step: OracleEffectStep,
  ability: OracleIRAbility
): boolean {
  const normalizedAbilityText = normalizeOracleText(String(ability.text || ability.effectText || ''))
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  const hasLoweredAmass = ability.steps.some(
    (candidate) => candidate.kind === 'add_counter' && /army creature you control/i.test(String((candidate.target as any)?.text || ''))
  );

  if (step.kind === 'conditional') {
    const normalizedCondition = normalizeOracleText(String(step.condition?.raw || '')).trim().toLowerCase();
    return hasLoweredAmass && normalizedCondition === "you don't control an army";
  }

  if (
    step.kind === 'add_counter' &&
    hasLoweredAmass &&
    /^\s*\(/.test(String(step.raw || '')) &&
    /\barmy you control\b/i.test(String(step.raw || ''))
  ) {
    return true;
  }

  if (step.kind !== 'unknown') return false;

  const normalizedStep = normalizeReminderStepRaw(step);
  if (/^(?:to\s+)?amass(?:\s+[a-z][a-z' -]*)?\s+(?:\d+|x),\s*put\s+(?:\d+|x|one|two|three|four|five|six|seven|eight|nine|ten)\s+\+1\/\+1\s+counters?\s+on\s+an\s+army\s+you\s+control$/i.test(normalizedStep)) {
    return hasLoweredAmass || normalizedAbilityText.includes('amass');
  }
  if (!/^it(?:'|�)?s also (?:a|an) [a-z][a-z' -]*$/i.test(normalizedStep)) {
    return false;
  }
  if (normalizedAbilityText.includes('amass')) {
    return true;
  }

  const hasAmassLead = ability.steps.some(
    (candidate) =>
      candidate.kind === 'unknown' &&
      /^amass(?:\s+[a-z][a-z' -]*?)?\s+(?:\d+|x)(?:,|$)/i.test(normalizeReminderStepRaw(candidate))
  );
  const hasArmyCounterReminder = ability.steps.some(
    (candidate) =>
      candidate.kind === 'unknown' &&
      /^put (?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x) \+1\/\+1 counters? on an army you control$/i.test(
        normalizeReminderStepRaw(candidate)
      )
  );
  const hasArmyCreateConditional = ability.steps.some(
    (candidate) =>
      candidate.kind === 'conditional' &&
      /you don't control an army/i.test(normalizeOracleText(String(candidate.condition?.raw || ''))) &&
      candidate.steps.some(
        (nested) => nested.kind === 'create_token' && /\barmy\b/i.test(String(nested.token || ''))
      )
  );

  return hasAmassLead || hasArmyCounterReminder || hasArmyCreateConditional;
}

export function pruneRedundantAmassSubtypeReminderUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const nextSteps = ability.steps.filter(
      (step) => !isRedundantAmassSubtypeReminderUnknownStep(step, ability)
    );
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

function buildDiscoverKeywordSteps(amountText: string, sequence?: 'then'): readonly OracleEffectStep[] {
  const normalizedAmountText = String(amountText || '').trim();
  const displayAmountText = /^x$/i.test(normalizedAmountText) ? 'X' : normalizedAmountText;
  const quantityText = /^that spell(?:'|�)?s mana value$/i.test(normalizedAmountText)
    ? "that spell's mana value"
    : /^that creature(?:'|�)?s (?:power|toughness)$/i.test(normalizedAmountText)
      ? normalizedAmountText.replace(/�/g, "'")
      : displayAmountText;

  return [
    {
      kind: 'impulse_exile_top',
      who: { kind: 'you' },
      amount: parseQuantity(`until you exile a nonland card with mana value ${quantityText} or less`),
      duration: 'during_resolution',
      permission: 'cast',
      ...(sequence ? { sequence } : {}),
      raw:
        `Exile cards from the top of your library until you exile a nonland card with mana value ${displayAmountText} or less. ` +
        'You may cast that card without paying its mana cost. Put the remaining exiled cards on the bottom of your library in a random order.',
    },
    {
      kind: 'modify_exile_permissions',
      scope: 'last_exiled_cards',
      withoutPayingManaCost: true,
      raw: 'You may cast that card without paying its mana cost.',
    },
  ] as const;
}

function getDiscoverKeywordAmountFromUnknownStep(step: OracleEffectStep): string | null {
    if (!step || step.kind !== 'unknown') return null;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  const match = normalized.match(/^(?:you\s+may\s+)?(?:you\s+)?discover\s+(\d+|x)(?:,\s*where\s+x\s+is\s+(.+))?$/i);
  if (!match) return null;
  const where = String(match[2] || '').trim().replace(/[.)]+$/g, '');
  if (where) {
    if (/^that spell(?:'|�)?s mana value$/i.test(where)) return "that spell's mana value";
    if (/^that creature(?:'|�)?s power$/i.test(where)) return "that creature's power";
    if (/^that creature(?:'|�)?s toughness$/i.test(where)) return "that creature's toughness";
    return null;
  }
  return /where\s+x\s+is\s+that\s+spell/i.test(normalized)
    ? "that spell's mana value"
    : String(match[1] || '').trim();
}

function isDiscoverReminderTailUnknownStep(step: OracleEffectStep): boolean {
  if (!step) return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .replace(/^[()\s]+/, '')
    .replace(/[.)\s]+$/g, '')
    .trim();
  if (!normalized) return false;

  return (
    /^exile cards from the top of your library until you exile a nonland card (?:with mana value (\d+|x) or less|with that mana value or less|whose mana value is less than this spell(?:'|’)s mana value)$/i.test(normalized) ||
    /^cast it without paying its mana cost or put it into your hand$/i.test(normalized) ||
    /^put the rest on the bottom(?: of your library)? in a random order$/i.test(normalized)
  );
}

function tryLowerDiscoverKeywordSteps(steps: readonly OracleEffectStep[]): readonly OracleEffectStep[] | null {
  let changed = false;
  const nextSteps: OracleEffectStep[] = [];

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    if (step.kind !== 'unknown') {
      nextSteps.push(step);
      continue;
    }

    const discoverAmount = getDiscoverKeywordAmountFromUnknownStep(step);
    if (!discoverAmount) {
      nextSteps.push(step);
      continue;
    }

    changed = true;
    nextSteps.push(...buildDiscoverKeywordSteps(discoverAmount, step.sequence));

    while (index + 1 < steps.length && isDiscoverReminderTailUnknownStep(steps[index + 1])) {
      index += 1;
    }
  }

  return changed ? nextSteps : null;
}

export function lowerDiscoverKeywordAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/\s+/g, ' ')
      .trim();
    const isUnknownOnlyAbility = ability.steps.length > 0 && ability.steps.every((step) => step.kind === 'unknown' || isDiscoverReminderTailUnknownStep(step));
    const fullReminderMatch = normalizedText.match(/^(?:you\s+may\s+)?discover\s+(\d+|x)\s*\(/i);

    if (isUnknownOnlyAbility && fullReminderMatch) {
      return {
        ...ability,
        steps: [...buildDiscoverKeywordSteps(String(fullReminderMatch[1] || '').trim())],
      };
    }

    const lowered = tryLowerDiscoverKeywordSteps(ability.steps);
    return lowered ? { ...ability, steps: lowered } : ability;
  });
}

export function pruneRedundantDiscoverReminderUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    if (!normalizedText.includes('discover')) return ability;

    const nextSteps = ability.steps.filter((step) => !isDiscoverReminderTailUnknownStep(step));
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

function tryLowerConniveKeywordSteps(steps: readonly OracleEffectStep[]): readonly OracleEffectStep[] | null {
  let changed = false;
  const nextSteps: OracleEffectStep[] = [];

  for (const step of steps) {
    if (step.kind !== 'unknown') {
      nextSteps.push(step);
      continue;
    }

    const normalized = normalizeOracleText(String(step.raw || ''))
      .replace(/^then\b\s*/i, '')
      .trim();
    const conniveMatch = normalized.match(/^connive(?:\s+(\d+))?$/i);
    if (!conniveMatch) {
      nextSteps.push(step);
      continue;
    }

    changed = true;
    const amount = Number.parseInt(String(conniveMatch[1] || '1'), 10);
    const quantityText = amount === 1 ? 'a card' : `${amount} cards`;
    nextSteps.push({
      kind: 'draw',
      who: { kind: 'you' },
      amount: { kind: 'number', value: amount },
      raw: `Draw ${quantityText}.`,
    });
    nextSteps.push({
      kind: 'discard',
      who: { kind: 'you' },
      amount: { kind: 'number', value: amount },
      sequence: 'then',
      raw: `Discard ${quantityText}.`,
    });
    nextSteps.push({
      kind: 'conditional',
      condition: { kind: 'if', raw: 'a nonland card was discarded this way' },
      steps: [
        {
          kind: 'add_counter',
          target: { kind: 'raw', text: 'this creature' },
          counter: '+1/+1',
          amount: { kind: 'x' },
          raw: 'Put X +1/+1 counters on this creature, where X is the number of nonland cards discarded this way.',
        },
      ],
      raw:
        'If a nonland card was discarded this way, put X +1/+1 counters on this creature, where X is the number of nonland cards discarded this way.',
    });
  }

  return changed ? nextSteps : null;
}

export function lowerConniveKeywordAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const lowered = tryLowerConniveKeywordSteps(ability.steps);
    return lowered ? { ...ability, steps: lowered } : ability;
  });
}

function tryLowerRecruitKeywordSteps(steps: readonly OracleEffectStep[]): readonly OracleEffectStep[] | null {
  let changed = false;
  const nextSteps: OracleEffectStep[] = [];

  for (const step of steps) {
    if (step.kind !== 'unknown') {
      nextSteps.push(step);
      continue;
    }

    const normalized = normalizeOracleText(String(step.raw || ''))
      .replace(/^then\b\s*/i, '')
      .trim();
    if (!/^(?:you\s+)?recruit$/i.test(normalized)) {
      nextSteps.push(step);
      continue;
    }

    changed = true;
    nextSteps.push(
      {
        kind: 'draw',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 1 },
        raw: 'Draw a card.',
      },
      {
        kind: 'discard',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 1 },
        sequence: 'then',
        raw: 'Discard a card.',
      },
      {
        kind: 'conditional',
        condition: { kind: 'if', raw: 'a nonland card was discarded this way' },
        steps: [
          {
            kind: 'create_token',
            who: { kind: 'you' },
            amount: { kind: 'number', value: 1 },
            token: '1/1 white Human Soldier creature token',
            raw: 'Create a 1/1 white Human Soldier creature token.',
          },
        ],
        raw: 'If you discarded a nonland card this way, create a 1/1 white Human Soldier creature token.',
      },
    );
  }

  if (!changed) return null;

  // Reminder text is parsed as the same three steps after the keyword line.
  // Keep the keyword expansion and discard the immediately repeated reminder.
  const dedupedSteps: OracleEffectStep[] = [];
  for (let index = 0; index < nextSteps.length; index += 1) {
    const first = nextSteps[index];
    const second = nextSteps[index + 1];
    const third = nextSteps[index + 2];
    const repeatFirst = nextSteps[index + 3];
    const repeatSecond = nextSteps[index + 4];
    const repeatThird = nextSteps[index + 5];
    if (
      first?.kind === 'draw' &&
      second?.kind === 'discard' &&
      third?.kind === 'conditional' &&
      repeatFirst?.kind === 'draw' &&
      repeatSecond?.kind === 'discard' &&
      repeatThird?.kind === 'conditional'
    ) {
      dedupedSteps.push(first, second, third);
      index += 5;
      continue;
    }
    dedupedSteps.push(first);
  }

  return dedupedSteps;
}

export function lowerRecruitKeywordAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const lowered = tryLowerRecruitKeywordSteps(ability.steps);
    return lowered ? { ...ability, steps: lowered } : ability;
  });
}

