import type { OracleEffectStep } from './oracleIR';
import { parseBattlefieldObjectCondition, splitSacrificeObjectAndCondition } from './oracleIRParserSacrificeHelpers';
import { parseObjectSelector, parsePlayerSelector } from './oracleIRParserUtils';

type DelayedBattlefieldTiming =
  | 'next_end_step'
  | 'your_next_end_step'
  | 'next_upkeep'
  | 'your_next_upkeep'
  | 'end_of_combat'
  | 'next_cleanup_step'
  | 'when_control_lost'
  | 'when_leaves_battlefield';

type WithMeta = <T extends OracleEffectStep>(step: T) => T;

const SACRIFICE_SUBJECT_RE =
  /^(?:(you|each player|each opponent|each of those opponents|target player|target opponent|that player|that opponent|defending player|the defending player|he or she|they|its controller|its owner|that [a-z0-9][a-z0-9 -]*['ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¾ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢]s (?:controller|owner))\s+)?sacrifices?\s+(.+)$/i;

const TIMING_SPECS: readonly {
  readonly timing: Exclude<DelayedBattlefieldTiming, 'when_control_lost' | 'when_leaves_battlefield'>;
  readonly leading: RegExp;
  readonly leadingConditional: RegExp;
  readonly trailing: RegExp;
  readonly trailingConditional: RegExp;
}[] = [
  {
    timing: 'next_end_step',
    leading: /^at\s+the\s+beginning\s+of\s+(?:the\s+)?next\s+end\s+step,\s*(.+)$/i,
    leadingConditional: /^at\s+the\s+beginning\s+of\s+(?:the\s+)?next\s+end\s+step,\s*(.+?)\s+if\s+(.+)$/i,
    trailing: /^(.+?)\s+at\s+the\s+beginning\s+of\s+(?:the\s+)?next\s+end\s+step\s*$/i,
    trailingConditional: /^(.+?)\s+at\s+the\s+beginning\s+of\s+(?:the\s+)?next\s+end\s+step\s+if\s+(.+)$/i,
  },
  {
    timing: 'your_next_end_step',
    leading: /^at\s+the\s+beginning\s+of\s+your\s+next\s+end\s+step,\s*(.+)$/i,
    leadingConditional: /^at\s+the\s+beginning\s+of\s+your\s+next\s+end\s+step,\s*(.+?)\s+if\s+(.+)$/i,
    trailing: /^(.+?)\s+at\s+the\s+beginning\s+of\s+your\s+next\s+end\s+step\s*$/i,
    trailingConditional: /^(.+?)\s+at\s+the\s+beginning\s+of\s+your\s+next\s+end\s+step\s+if\s+(.+)$/i,
  },
  {
    timing: 'next_end_step',
    leading: /^at\s+(?:the\s+)?end\s+of\s+turn(?:,|\s+)\s*(.+)$/i,
    leadingConditional: /^at\s+(?:the\s+)?end\s+of\s+turn(?:,|\s+)\s*(.+?)\s+if\s+(.+)$/i,
    trailing: /^(.+?)\s+at\s+(?:the\s+)?end\s+of\s+turn\s*$/i,
    trailingConditional: /^(.+?)\s+at\s+(?:the\s+)?end\s+of\s+turn\s+if\s+(.+)$/i,
  },
  {
    timing: 'end_of_combat',
    leading: /^at\s+(?:the\s+)?end\s+of\s+combat,\s*(.+)$/i,
    leadingConditional: /^at\s+(?:the\s+)?end\s+of\s+combat,\s*(.+?)\s+if\s+(.+)$/i,
    trailing: /^(.+?)\s+at\s+(?:the\s+)?end\s+of\s+combat\s*$/i,
    trailingConditional: /^(.+?)\s+at\s+(?:the\s+)?end\s+of\s+combat\s+if\s+(.+)$/i,
  },
  {
    timing: 'next_cleanup_step',
    leading: /^at\s+the\s+beginning\s+of\s+(?:the\s+)?next\s+cleanup\s+step,\s*(.+)$/i,
    leadingConditional: /^at\s+the\s+beginning\s+of\s+(?:the\s+)?next\s+cleanup\s+step,\s*(.+?)\s+if\s+(.+)$/i,
    trailing: /^(.+?)\s+at\s+the\s+beginning\s+of\s+(?:the\s+)?next\s+cleanup\s+step\s*$/i,
    trailingConditional: /^(.+?)\s+at\s+the\s+beginning\s+of\s+(?:the\s+)?next\s+cleanup\s+step\s+if\s+(.+)$/i,
  },
  {
    timing: 'next_upkeep',
    leading: /^at\s+the\s+beginning\s+of\s+(?:the\s+)?next\s+upkeep,\s*(.+)$/i,
    leadingConditional: /^at\s+the\s+beginning\s+of\s+(?:the\s+)?next\s+upkeep,\s*(.+?)\s+if\s+(.+)$/i,
    trailing: /^(.+?)\s+at\s+the\s+beginning\s+of\s+(?:the\s+)?next\s+upkeep\s*$/i,
    trailingConditional: /^(.+?)\s+at\s+the\s+beginning\s+of\s+(?:the\s+)?next\s+upkeep\s+if\s+(.+)$/i,
  },
  {
    timing: 'your_next_upkeep',
    leading: /^at\s+the\s+beginning\s+of\s+your\s+next\s+upkeep,\s*(.+)$/i,
    leadingConditional: /^at\s+the\s+beginning\s+of\s+your\s+next\s+upkeep,\s*(.+?)\s+if\s+(.+)$/i,
    trailing: /^(.+?)\s+at\s+the\s+beginning\s+of\s+your\s+next\s+upkeep\s*$/i,
    trailingConditional: /^(.+?)\s+at\s+the\s+beginning\s+of\s+your\s+next\s+upkeep\s+if\s+(.+)$/i,
  },
];

function tryParseDelayedBattlefieldAction(args: {
  actionText: string;
  timing: DelayedBattlefieldTiming;
  rawClause: string;
  withMeta: WithMeta;
  watchText?: string;
  conditionText?: string;
}): OracleEffectStep | null {
  const { actionText, timing, rawClause, withMeta, watchText, conditionText } = args;

  const mSacSubject = actionText.match(SACRIFICE_SUBJECT_RE);
  if (mSacSubject) {
    const parsedObject = splitSacrificeObjectAndCondition(String(mSacSubject[2] || '').trim());
    const condition = conditionText ? parseBattlefieldObjectCondition(`if ${conditionText}`) : parsedObject.condition;
    return withMeta({
      kind: 'schedule_delayed_battlefield_action',
      timing,
      action: 'sacrifice',
      who: parsePlayerSelector(mSacSubject[1]),
      object: parseObjectSelector(parsedObject.objectText),
      ...(condition ? { condition } : {}),
      ...(watchText ? { watch: parseObjectSelector(watchText) } : {}),
      raw: rawClause,
    });
  }

  const mSac = actionText.match(/^sacrifice\s+(.+)$/i);
  if (mSac) {
    const parsedObject = splitSacrificeObjectAndCondition(String(mSac[1] || '').trim());
    const condition = conditionText ? parseBattlefieldObjectCondition(`if ${conditionText}`) : parsedObject.condition;
    return withMeta({
      kind: 'schedule_delayed_battlefield_action',
      timing,
      action: 'sacrifice',
      who: { kind: 'you' },
      object: parseObjectSelector(parsedObject.objectText),
      ...(condition ? { condition } : {}),
      ...(watchText ? { watch: parseObjectSelector(watchText) } : {}),
      raw: rawClause,
    });
  }

  const mExile = actionText.match(/^exile\s+(.+)$/i);
  if (mExile) {
    return withMeta({
      kind: 'schedule_delayed_battlefield_action',
      timing,
      action: 'exile',
      object: parseObjectSelector(mExile[1]),
      ...(watchText ? { watch: parseObjectSelector(watchText) } : {}),
      raw: rawClause,
    });
  }

  return null;
}

export function tryParseDelayedBattlefieldActionClause(args: {
  clause: string;
  rawClause: string;
  withMeta: WithMeta;
}): OracleEffectStep | null {
  const { clause, rawClause, withMeta } = args;

  for (const spec of TIMING_SPECS) {
    const leadingConditional = clause.match(spec.leadingConditional);
    if (leadingConditional) {
      const parsed = tryParseDelayedBattlefieldAction({
        actionText: String(leadingConditional[1] || '').trim(),
        timing: spec.timing,
        rawClause,
        withMeta,
        conditionText: String(leadingConditional[2] || '').trim(),
      });
      if (parsed) return parsed;
    }

    const leading = clause.match(spec.leading);
    if (leading) {
      const parsed = tryParseDelayedBattlefieldAction({
        actionText: String(leading[1] || '').trim(),
        timing: spec.timing,
        rawClause,
        withMeta,
      });
      if (parsed) return parsed;
    }

    const trailingConditional = clause.match(spec.trailingConditional);
    if (trailingConditional) {
      const parsed = tryParseDelayedBattlefieldAction({
        actionText: String(trailingConditional[1] || '').trim(),
        timing: spec.timing,
        rawClause,
        withMeta,
        conditionText: String(trailingConditional[2] || '').trim(),
      });
      if (parsed) return parsed;
    }

    const trailing = clause.match(spec.trailing);
    if (trailing) {
      const parsed = tryParseDelayedBattlefieldAction({
        actionText: String(trailing[1] || '').trim(),
        timing: spec.timing,
        rawClause,
        withMeta,
      });
      if (parsed) return parsed;
    }
  }

  const trailingLoseControl = clause.match(/^(.+?)\s+when\s+you\s+lose\s+control\s+of\s+(.+?)\s*$/i);
  if (trailingLoseControl) {
    const parsed = tryParseDelayedBattlefieldAction({
      actionText: String(trailingLoseControl[1] || '').trim(),
      timing: 'when_control_lost',
      rawClause,
      withMeta,
      watchText: String(trailingLoseControl[2] || '').trim(),
    });
    if (parsed) return parsed;
  }

  const trailingWhenLeaves = clause.match(/^(.+?)\s+when\s+(.+?)\s+leaves\s+the\s+battlefield\s*$/i);
  if (trailingWhenLeaves) {
    const parsed = tryParseDelayedBattlefieldAction({
      actionText: String(trailingWhenLeaves[1] || '').trim(),
      timing: 'when_leaves_battlefield',
      rawClause,
      withMeta,
      watchText: String(trailingWhenLeaves[2] || '').trim(),
    });
    if (parsed) return parsed;
  }

  return null;
}
