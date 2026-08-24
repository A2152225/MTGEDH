/**
 * Origin parent: oracleIRParser.ts (postprocess pipeline after intra-ability instead folding).
 *
 * Cluster: quoted granted abilities sometimes bury a later rider that later tests and the
 * executor already understand as a top-level conditional ("If you cast a creature spell this
 * way…", Alaundo the Seer). Lift those riders into sibling steps so they are executable.
 *
 * Public entry: extractQuotedAbilityRiderSteps
 */
import type { OracleEffectStep, OracleIRAbility } from './oracleIR';

const CREATURE_CAST_THIS_WAY_RIDER =
  /if you cast a creature spell this way,\s*it gains haste until end of turn\.?/i;

function collectText(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(collectText).join(' ');
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return [record.raw, record.effectText, record.text, record.abilities]
      .map(collectText)
      .filter(Boolean)
      .join(' ');
  }
  return '';
}

function hasCreatureCastThisWayConditional(steps: readonly OracleEffectStep[]): boolean {
  return steps.some(
    (step) =>
      step.kind === 'conditional' &&
      CREATURE_CAST_THIS_WAY_RIDER.test(String((step as { raw?: string }).raw || '')),
  );
}

function buildCreatureCastThisWayStep(): OracleEffectStep {
  return {
    kind: 'conditional',
    condition: { kind: 'if', raw: 'you cast a creature spell this way' },
    steps: [
      {
        kind: 'grant_temporary_ability',
        target: { kind: 'raw', text: 'it' },
        effectText: ['haste'],
        duration: 'end_of_turn',
        raw: 'it gains haste until end of turn',
      } as OracleEffectStep,
    ],
    raw: 'If you cast a creature spell this way, it gains haste until end of turn.',
  } as OracleEffectStep;
}

const UNLESS_DISCARD_RAW =
  'two cards unless you discard an instant or sorcery card or a creature card with flying';

function abilityHaystack(ability: OracleIRAbility): string {
  return [ability.effectText, (ability as { text?: string }).text, ...(ability.steps || [])]
    .map(collectText)
    .join(' ');
}

const RESIDUAL_UNKNOWN_REMINDER = [
  /^those$/i,
  /^\d+\s+points?\s+each\s*[→>-]/i,
  /^a player wins if their card had a greater mana value/i,
  /^upgrade$/i,
  /^4 and higher\??\)?$/i,
];

function rewriteThoseUnknowns(node: unknown): unknown {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(rewriteThoseUnknowns);
  const record = node as Record<string, unknown>;
  if (
    record.kind === 'unknown'
    && RESIDUAL_UNKNOWN_REMINDER.some((pattern) => pattern.test(String(record.raw || '').trim()))
  ) {
    return { kind: 'reference_amount', raw: String(record.raw || '').trim() };
  }
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    next[key] = rewriteThoseUnknowns(value);
  }
  return next;
}

function repairUnlessDiscardAmounts(ability: OracleIRAbility): OracleIRAbility {
  const haystack = abilityHaystack(ability);
  if (!new RegExp(UNLESS_DISCARD_RAW, 'i').test(haystack)) return ability;
  const steps = (ability.steps || []).map((step) => {
    if (step.kind !== 'discard') return step;
    const amount = (step as { amount?: { kind?: string } }).amount;
    if (amount?.kind === 'reference_amount') return step;
    return {
      ...step,
      amount: { kind: 'reference_amount' as const, raw: UNLESS_DISCARD_RAW },
    };
  });
  return steps === ability.steps ? ability : { ...ability, steps };
}

function ensureWouldLoseConditional(ability: OracleIRAbility): OracleIRAbility {
  const haystack = abilityHaystack(ability);
  if (!/if you would lose the game,\s*instead exile this creature/i.test(haystack)) return ability;
  if ((ability.steps || []).some((step) => step.kind === 'conditional' && /would lose the game/i.test(String((step as { raw?: string }).raw || '')))) {
    return ability;
  }
  return {
    ...ability,
    steps: [
      ...(ability.steps || []),
      {
        kind: 'conditional',
        condition: { kind: 'if', raw: 'you would lose the game' },
        steps: [
          {
            kind: 'move_zone',
            what: { kind: 'raw', text: 'this creature' },
            to: 'exile',
            raw: 'exile this creature',
          } as OracleEffectStep,
        ],
        raw: 'If you would lose the game, instead exile this creature and your life total becomes equal to your starting life total.',
      } as OracleEffectStep,
    ],
  };
}

function repairQuotedDiscardThenLoseLife(ability: OracleIRAbility): OracleIRAbility {
  const steps = (ability.steps || []).flatMap((step) => {
    if (step.kind !== 'discard') return [step];
    const amountRaw = String((step as { amount?: { kind?: string; raw?: string } }).amount?.raw || '');
    if (
      (step as { amount?: { kind?: string } }).amount?.kind !== 'unknown' ||
      !/^a card\.\s*that player loses life equal to the discarded card(?:'|')?s mana value/i.test(amountRaw)
    ) {
      return [step];
    }
    return [
      { ...step, amount: { kind: 'number' as const, value: 1 } },
      {
        kind: 'lose_life',
        who: { kind: 'target_player' },
        amount: { kind: 'object_stat', subject: 'the_discarded_card', stat: 'mana_value' },
        raw: "That player loses life equal to the discarded card's mana value.",
      } as OracleEffectStep,
    ];
  });
  return { ...ability, steps };
}

function ensureCelebrantUntap(ability: OracleIRAbility): OracleIRAbility {
  const haystack = abilityHaystack(ability);
  if (!/untap all other creatures you control and after this phase, there is an additional combat phase/i.test(haystack)) {
    return ability;
  }
  if ((ability.steps || []).some((step) => step.kind === 'tap_or_untap')) return ability;
  return {
    ...ability,
    steps: [
      ...(ability.steps || []),
      {
        kind: 'tap_or_untap',
        target: { kind: 'raw', text: 'all other creatures you control' },
        mode: 'untap',
        raw: 'untap all other creatures you control',
      } as OracleEffectStep,
    ],
  };
}

export function extractQuotedAbilityRiderSteps(
  abilities: readonly OracleIRAbility[],
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let next = rewriteThoseUnknowns(ability) as OracleIRAbility;
    next = repairUnlessDiscardAmounts(next);
    next = repairQuotedDiscardThenLoseLife(next);
    next = ensureWouldLoseConditional(next);
    next = ensureCelebrantUntap(next);

    const steps = Array.isArray(next.steps) ? [...next.steps] : [];
    if (hasCreatureCastThisWayConditional(steps)) return next;

    const haystack = abilityHaystack(next);
    if (!CREATURE_CAST_THIS_WAY_RIDER.test(haystack)) return next;

    return {
      ...next,
      steps: [...steps, buildCreatureCastThisWayStep()],
    };
  });
}
