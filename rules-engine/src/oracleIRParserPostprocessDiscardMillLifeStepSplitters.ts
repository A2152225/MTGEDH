/**
 * Discard / mill / life and destroy compound step splitters for the oracle IR postprocess
 * pass.
 *
 * Origin parent: rules-engine/src/oracleIRParserPostprocess.ts (lines 12683-13144 of the
 * pre-split file).
 * Cluster moved: the second family of compound-step splitters - mill+draw+life,
 * discard+mill+life, sacrifice / move-zone / damage / add-mana paired with life, the
 * destroy-plus-restriction splits, and the trailing life and counter unknown re-parsers.
 * Public entry symbols: re-exported at the foot of this file; consumed by the postprocess
 * parent and by oracleIRParserPostprocessDynamicCounterRiders.
 */
import type { OracleEffectStep } from './oracleIR';
import { tryParseLifeAndCombatClause } from './oracleIRParserLifeAndCombatClauses';
import { tryParseTemporaryModifyPtClause } from './oracleIRParserModifyPtClauses';
import {
  parseLifeTailStep,
  parseSimpleCounterTailStep,
} from './oracleIRParserPostprocessBattlefieldEntryCounterAndDrawLife';
import { normalizeLeadingConditionalCondition } from './oracleIRParserSacrificeHelpers';
import { tryParseSimpleActionClause } from './oracleIRParserSimpleActionClauses';
import { tryParseRulesTextClause } from './oracleIRParserStaticAbilityClauses';
import {
  normalizeClauseForParse,
  normalizeOracleText,
  parseObjectSelector,
  parsePlayerSelector,
  parseQuantity,
} from './oracleIRParserUtils';
import { tryParseZoneAndRemovalClause } from './oracleIRParserZoneAndRemovalActions';

function parseDrawReplacementGainLifeUnknownStep(step: OracleEffectStep): OracleEffectStep | null {
  if (step.kind !== 'unknown') return null;
  const raw = normalizeOracleText(String(step.raw || '')).trim();
  const match = raw.match(/^the\s+next\s+time\s+you\s+would\s+draw\s+a\s+card\s+this\s+turn,\s+(.+?)\s+gains?\s+(that much|that many|\d+|x|[a-z]+)\s+life\s+instead$/i);
  if (!match) return null;
  return {
    kind: 'gain_life',
    who: parsePlayerSelector(String(match[1] || '').trim()),
    amount: parseQuantity(String(match[2] || '').trim()),
    replacementOf: 'draw_card',
    duration: 'end_of_turn',
    raw,
  } as unknown as OracleEffectStep;
}

function parseResultLifeUnknownStep(step: OracleEffectStep): OracleEffectStep | null {
  if (step.kind !== 'unknown') return null;
  const raw = normalizeOracleText(String(step.raw || '')).trim();
  const match = raw.match(/^\d+(?:\s*-\s*\d+|\+)?\s*\|\s+(.+)$/i);
  if (!match) return null;
  const lifeStep = parseLifeTailStep(String(match[1] || '').trim());
  return lifeStep && (lifeStep.kind === 'gain_life' || lifeStep.kind === 'lose_life') ? lifeStep : null;
}

function splitMillDrawLifeStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'draw') return null;
  const raw = normalizeOracleText(String(step.raw || '')).replace(/^�\s*/, '').trim();
  const match = raw.match(/^(.+?)\s+mills?\s+((?:a|an|\d+|x|[a-z]+)\s+cards?),\s+draws?\s+((?:a|an|\d+|x|[a-z]+)\s+cards?),\s+and\s+loses?\s+((?:that much|that many|\d+|x|[a-z]+)\s+life)$/i);
  if (!match) return null;

  const who = String(match[1] || '').trim();
  const millRaw = `${who} mills ${String(match[2] || '').trim()}`;
  const drawRaw = `${who} draws ${String(match[3] || '').trim()}`;
  const lifeRaw = `${who} loses ${String(match[4] || '').trim()}`;
  const millStep = tryParseSimpleActionClause({
    clause: normalizeClauseForParse(millRaw).clause,
    rawClause: millRaw,
    withMeta: <T extends OracleEffectStep>(value: T) => value,
  });
  const drawStep = tryParseSimpleActionClause({
    clause: normalizeClauseForParse(drawRaw).clause,
    rawClause: drawRaw,
    withMeta: <T extends OracleEffectStep>(value: T) => value,
  });
  const lifeStep = parseLifeTailStep(lifeRaw);
  if (!millStep || millStep.kind !== 'mill' || !drawStep || drawStep.kind !== 'draw' || !lifeStep || lifeStep.kind !== 'lose_life') return null;
  return [millStep, drawStep, lifeStep];
}

function splitDiscardAndLifeStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'discard') return null;
  const raw = normalizeOracleText(String(step.raw || '')).replace(/^�\s*/, '').trim();
  const match =
    raw.match(/^(.+?)\s+discards?\s+((?:a card|a|an|\d+|x|[a-z]+)\s+cards?),\s+loses?\s+((?:that much|that many|\d+|x|[a-z]+)\s+life)(?:,\s+and\s+.+)?$/i) ||
    raw.match(/^(.+?)\s+discards?\s+((?:a card|a|an|\d+|x|[a-z]+)\s+cards?)\s+and\s+loses?\s+((?:that much|that many|\d+|x|[a-z]+)\s+life)$/i);
  if (!match) return null;

  const who = String(match[1] || '').trim();
  const discardRaw = `${who} discards ${String(match[2] || '').trim()}`;
  const lifeRaw = `${who} loses ${String(match[3] || '').trim()}`;
  const lifeStep = parseLifeTailStep(lifeRaw);
  if (!lifeStep || lifeStep.kind !== 'lose_life') return null;
  return [{ ...step, raw: discardRaw }, lifeStep];
}

function splitDiscardMillLifeStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'discard') return null;
  const raw = normalizeOracleText(String(step.raw || '')).replace(/^�\s*/, '').trim();
  const cardQty = '(?:a card|(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\\d+|x|[a-z]+)\\s+cards?)';
  const lifeQty = '(?:that much|that many|\\d+|x|[a-z]+)\\s+life';
  const match = raw.match(
    new RegExp(`^(.+?)\\s+discards?\\s+(${cardQty}),\\s+mills?\\s+(${cardQty}),\\s+and\\s+loses?\\s+(${lifeQty})$`, 'i'),
  );
  if (!match) return null;

  const who = String(match[1] || '').trim();
  const discardRaw = `${who} discards ${String(match[2] || '').trim()}`;
  const millRaw = `${who} mills ${String(match[3] || '').trim()}`;
  const lifeRaw = `${who} loses ${String(match[4] || '').trim()}`;
  const millStep = tryParseSimpleActionClause({
    clause: normalizeClauseForParse(millRaw).clause,
    rawClause: millRaw,
    withMeta: <T extends OracleEffectStep>(value: T) => value,
  });
  const lifeStep = parseLifeTailStep(lifeRaw);
  if (!millStep || millStep.kind !== 'mill' || !lifeStep || lifeStep.kind !== 'lose_life') return null;
  return [{ ...step, raw: discardRaw }, millStep, lifeStep];
}

function splitDiscardMillLifeUnknownStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'unknown') return null;
  const raw = normalizeOracleText(String(step.raw || '')).replace(/^�\s*/, '').trim();
  const cardQty = '(?:a card|(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\\d+|x|[a-z]+)\\s+cards?)';
  const lifeQty = '(?:that much|that many|\\d+|x|[a-z]+)\\s+life';
  const match = raw.match(
    new RegExp(`^(.+?)\\s+discards?\\s+(${cardQty}),\\s+mills?\\s+(${cardQty}),\\s+and\\s+loses?\\s+(${lifeQty})$`, 'i'),
  );
  if (!match) return null;

  const who = String(match[1] || '').trim();
  const discardRaw = `${who} discards ${String(match[2] || '').trim()}`;
  const millRaw = `${who} mills ${String(match[3] || '').trim()}`;
  const lifeRaw = `${who} loses ${String(match[4] || '').trim()}`;
  const discardStep = tryParseSimpleActionClause({
    clause: normalizeClauseForParse(discardRaw).clause,
    rawClause: discardRaw,
    withMeta: <T extends OracleEffectStep>(value: T) => value,
  });
  const millStep = tryParseSimpleActionClause({
    clause: normalizeClauseForParse(millRaw).clause,
    rawClause: millRaw,
    withMeta: <T extends OracleEffectStep>(value: T) => value,
  });
  const lifeStep = parseLifeTailStep(lifeRaw);
  if (discardStep?.kind !== 'discard' || !millStep || millStep.kind !== 'mill' || !lifeStep || lifeStep.kind !== 'lose_life') {
    return null;
  }
  return [discardStep, millStep, lifeStep];
}

function splitDiscardMillLifeFromMalformedDiscardStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'discard') return null;
  const amountRaw =
    step.amount?.kind === 'unknown' || step.amount?.kind === 'reference_amount'
      ? normalizeOracleText(String(step.amount.raw || '')).trim()
      : '';
  if (!/,\s*mills?\b/i.test(amountRaw)) return null;
  const whoText = String((step.who as { kind?: string; raw?: string } | undefined)?.raw || step.who?.kind || 'target opponent');
  const playerWho =
    (step.who as { kind?: string })?.kind === 'target_opponent'
      ? 'target opponent'
      : (step.who as { kind?: string })?.kind === 'target_player'
        ? 'target player'
        : whoText;
  return splitDiscardMillLifeUnknownStep({
    kind: 'unknown',
    raw: `${playerWho} discards ${amountRaw.replace(/\s+life$/i, ' life')}`,
  });
}

function parseDiscardUnknownStep(step: OracleEffectStep): OracleEffectStep | null {
  if (step.kind !== 'unknown') return null;
  const raw = normalizeOracleText(String(step.raw || '')).replace(/^�\s*/, '').trim();
  const parsed = tryParseSimpleActionClause({
    clause: normalizeClauseForParse(raw).clause,
    rawClause: raw,
    withMeta: <T extends OracleEffectStep>(value: T) => value,
  });
  return parsed && parsed.kind === 'discard' ? parsed : null;
}

function parseClauseUnknownStep(step: OracleEffectStep): OracleEffectStep | null {
  if (step.kind !== 'unknown') return null;
  const raw = normalizeOracleText(String(step.raw || '')).replace(/^�\s*/, '').trim();
  const clause = normalizeClauseForParse(raw).clause;
  const withMeta = <T extends OracleEffectStep>(value: T) => value;
  const parsed =
    tryParseTemporaryModifyPtClause({ clause, rawClause: raw, withMeta }) ??
    tryParseRulesTextClause({ clause, rawClause: raw, withMeta }) ??
    parseLifeTailStep(raw) ??
    null;
  return parsed && parsed.kind !== 'unknown' ? parsed : null;
}

function splitSacrificeFollowOnInstructionsStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'sacrifice') return null;
  const whatText = String((step as { what?: { text?: string } }).what?.text || '').trim();
  const followOn = whatText.match(
    /^(it|this (?:creature|enchantment|artifact|permanent|land|aura|equipment))\s*,\s+(.+)$/i,
  );
  if (!followOn) return null;
  const remainder = String(followOn[2] || '')
    .replace(/[,\s]+$/g, '')
    .trim();
  if (!remainder) return null;
  if (!/^(draw|put|gain|lose|create|exile|return|search|look|mill|scry|surveil|discard)\b/i.test(remainder)) {
    return null;
  }

  const objectText = String(followOn[1] || '').trim();
  const sacrificeStep = {
    ...step,
    what: parseObjectSelector(objectText),
    raw: String(step.raw || '')
      .replace(/,\s+[\s\S]+$/, '')
      .trim() || `sacrifice ${objectText}`,
  } as OracleEffectStep;

  const remainderClauses = remainder
    .split(/\s*,\s*(?:and\s+)?/i)
    .map((clause) => clause.replace(/^and\s+/i, '').trim())
    .filter(Boolean);
  if (remainderClauses.length === 0) return [sacrificeStep];

  const extra: OracleEffectStep[] = [];
  for (const clause of remainderClauses) {
    const clauseNormalized = normalizeClauseForParse(clause);
    let parsed = tryParseSimpleActionClause({
      clause: clauseNormalized.clause,
      rawClause: clause,
      withMeta: <T extends OracleEffectStep>(value: T) => value,
    });
    if (!parsed || parsed.kind === 'unknown') {
      parsed = tryParseZoneAndRemovalClause({
        clause: clauseNormalized.clause,
        rawClause: clause,
        withMeta: <T extends OracleEffectStep>(value: T) => value,
      });
    }
    if (!parsed || parsed.kind === 'unknown') return null;
    extra.push({ ...parsed, sequence: 'then' } as OracleEffectStep);
  }
  return [sacrificeStep, ...extra];
}

function splitSacrificeAndLifeStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'sacrifice') return null;
  const raw = normalizeOracleText(String(step.raw || '')).replace(/^�\s*/, '').trim();
  const match = raw.match(/^(.+?)\s+sacrifices?\s+(.+?)(?:,\s+discards?\s+((?:a|an|\d+|x|[a-z]+)\s+cards?))?,?\s+and\s+loses?\s+((?:that much|that many|\d+|x|[a-z]+)\s+life)$/i);
  if (!match) return null;

  const who = String(match[1] || '').trim();
  const sacrificeWhat = String(match[2] || '').trim();
  const lifeStep = parseLifeTailStep(`${who} loses ${String(match[4] || '').trim()}`);
  if (!lifeStep || lifeStep.kind !== 'lose_life') return null;
  const steps: OracleEffectStep[] = [
    {
      ...step,
      what: parseObjectSelector(sacrificeWhat),
      raw: `${who} sacrifices ${sacrificeWhat}`,
    },
  ];
  const discardAmount = String(match[3] || '').trim();
  if (discardAmount) {
    const discardRaw = `${who} discards ${discardAmount}`;
    const discardStep = tryParseSimpleActionClause({
      clause: normalizeClauseForParse(discardRaw).clause,
      rawClause: discardRaw,
      withMeta: <T extends OracleEffectStep>(value: T) => value,
    });
    if (discardStep?.kind === 'discard') steps.push(discardStep);
  }
  steps.push(lifeStep);
  return steps;
}

function splitMoveZoneAndLifeUnknownStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'unknown') return null;
  const raw = normalizeOracleText(String(step.raw || ''))
    .replace(/^otherwise,?\s*/i, '')
    .trim();
  const match = raw.match(/^(.+?)\s+and\s+((?:you|each player|each opponent|target player|target opponent|that player|that opponent)\s+gains?\s+.+?\s+life)$/i);
  if (!match) return null;

  const moveClause = normalizeClauseForParse(String(match[1] || '').trim()).clause;
  const moveStep = tryParseZoneAndRemovalClause({
    clause: moveClause,
    rawClause: String(match[1] || '').trim(),
    withMeta: <T extends OracleEffectStep>(value: T) => value,
  });
  const lifeStep = parseLifeTailStep(String(match[2] || '').trim());
  if (!moveStep || moveStep.kind === 'unknown' || !lifeStep || lifeStep.kind !== 'gain_life') return null;
  return [moveStep, lifeStep];
}

function splitDamageAndLifeUnknownStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'unknown') return null;
  const raw = normalizeOracleText(String(step.raw || '')).trim();
  const match = raw.match(/^(.+?)\s+and\s+((?:you|each player|each opponent|target player|target opponent|that player|that opponent)\s+gains?\s+.+?\s+life(?:\s+for\s+each\s+.+)?)$/i);
  if (!match) return null;

  const damageClause = normalizeClauseForParse(String(match[1] || '').trim()).clause;
  const damageStep = tryParseLifeAndCombatClause({
    clause: damageClause,
    rawClause: String(match[1] || '').trim(),
    withMeta: <T extends OracleEffectStep>(value: T) => value,
  });
  const lifeStep = parseLifeTailStep(String(match[2] || '').trim());
  if (!damageStep || damageStep.kind !== 'deal_damage' || !lifeStep || lifeStep.kind !== 'gain_life') return null;
  return [damageStep, lifeStep];
}

function splitAddManaAndLoseLifeUnknownStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'unknown') return null;
  const raw = normalizeOracleText(String(step.raw || ''))
    .replace(/^otherwise,?\s*/i, '')
    .replace(/[."]+$/g, '')
    .trim();
  const match = raw.match(/^add\s+x\s+(\{[^}]+\})\s+and\s+(.+?)\s+lose(?:s)?\s+x\s+life,\s+where\s+x\s+is\s+(.+)$/i);
  if (!match) return null;

  const manaSymbol = String(match[1] || '').trim();
  const lifeWho = String(match[2] || '').trim();
  const whereText = String(match[3] || '').trim();
  if (!manaSymbol || !lifeWho || !whereText) return null;

  const addManaRaw = `Add an amount of ${manaSymbol} equal to ${whereText}`;
  const addManaStep = tryParseSimpleActionClause({
    clause: normalizeClauseForParse(addManaRaw).clause,
    rawClause: addManaRaw,
    withMeta: <T extends OracleEffectStep>(value: T) => value,
  });
  const lifeStep = parseLifeTailStep(`${lifeWho} loses life equal to ${whereText}`);
  if (!addManaStep || addManaStep.kind !== 'add_mana' || !lifeStep || lifeStep.kind !== 'lose_life') return null;
  return [addManaStep, lifeStep];
}

function splitDestroyAndCantBlockStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'cant_block' || (step.target as any)?.kind !== 'raw') return null;
  const targetText = normalizeOracleText(String((step.target as any).text || '')).trim();
  const match = targetText.match(/^(destroy\s+target\s+.+?),\s+and\s+(.+)$/i);
  if (!match) return null;
  const destroyClause = String(match[1] || '').trim();
  const destroyStep = tryParseZoneAndRemovalClause({
    clause: normalizeClauseForParse(destroyClause).clause,
    rawClause: destroyClause,
    withMeta: <T extends OracleEffectStep>(value: T) => value,
  });
  if (!destroyStep || destroyStep.kind !== 'destroy') return null;
  return [
    destroyStep,
    {
      ...step,
      target: parseObjectSelector(String(match[2] || '').trim()),
      raw: `${String(match[2] || '').trim()} can't block this turn`,
    },
  ];
}

function splitDestroyAndNoCombatDamageStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'assign_no_combat_damage' || (step.target as any)?.kind !== 'raw') return null;
  const targetText = normalizeOracleText(String((step.target as any).text || '')).trim();
  const match = targetText.match(/^(destroy\s+target\s+.+?)\s+and\s+(.+)$/i);
  if (!match) return null;
  const destroyClause = String(match[1] || '').trim();
  const destroyStep = tryParseZoneAndRemovalClause({
    clause: normalizeClauseForParse(destroyClause).clause,
    rawClause: destroyClause,
    withMeta: <T extends OracleEffectStep>(value: T) => value,
  });
  if (!destroyStep || destroyStep.kind !== 'destroy') return null;
  return [
    destroyStep,
    {
      ...step,
      target: parseObjectSelector(String(match[2] || '').trim()),
      raw: `${String(match[2] || '').trim()} assigns no combat damage this turn`,
    },
  ];
}

function splitDestroyUnlessDamageStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'deal_damage' || ((step as any).source as any)?.kind !== 'raw') return null;
  const sourceText = normalizeOracleText(String(((step as any).source as any).text || '')).trim();
  const match = sourceText.match(/^(destroy\s+target\s+.+?)\s+unless\s+.+?\s+has\s+this\s+permanent$/i);
  if (!match) return null;
  const destroyClause = String(match[1] || '').trim();
  const destroyStep = tryParseZoneAndRemovalClause({
    clause: normalizeClauseForParse(destroyClause).clause,
    rawClause: destroyClause,
    withMeta: <T extends OracleEffectStep>(value: T) => value,
  });
  if (!destroyStep || destroyStep.kind !== 'destroy') return null;
  return [destroyStep, { ...step, source: parseObjectSelector('this permanent') }];
}

function splitMillAndLifeUnknownStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'unknown') return null;
  const raw = normalizeOracleText(String(step.raw || '')).trim();
  const match = raw.match(/^(.+?)\s+each\s+mill(?:s)?\s+((?:a|an|\d+|x|[a-z]+)\s+cards?)\s+and\s+lose\s+((?:that much|that many|\d+|x|[a-z]+)\s+life)$/i);
  if (!match) return null;

  const who = String(match[1] || '').trim();
  const millClause = normalizeClauseForParse(`${who} mill ${String(match[2] || '').trim()}`).clause;
  const lifeClause = normalizeClauseForParse(`${who} each lose ${String(match[3] || '').trim()}`).clause;
  const millStep = tryParseSimpleActionClause({
    clause: millClause,
    rawClause: `${who} each mill ${String(match[2] || '').trim()}`,
    withMeta: <T extends OracleEffectStep>(value: T) => value,
  });
  const lifeStep = parseLifeTailStep(lifeClause);
  if (!millStep || millStep.kind !== 'mill' || !lifeStep || lifeStep.kind !== 'lose_life') return null;
  return [millStep, lifeStep];
}

function splitTapAndCounterStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'tap_or_untap' || (step.target as any)?.kind !== 'raw') return null;
  const raw = normalizeOracleText(String(step.raw || '')).trim();
  const match = raw.match(/^(tap|untap)\s+(.+?)\s+and\s+(put\s+.+?\s+counters?\s+on\s+.+)$/i);
  if (!match) return null;

  const counterStep = parseSimpleCounterTailStep(String(match[3] || '').trim());
  if (!counterStep || counterStep.kind !== 'add_counter') return null;
  return [
    {
      ...step,
      target: parseObjectSelector(String(match[2] || '').trim()),
      raw: `${String(match[1] || '').trim()} ${String(match[2] || '').trim()}`,
    },
    counterStep,
  ];
}

function parseChooseAndPutCounterUnknownStep(step: OracleEffectStep): OracleEffectStep | null {
  if (step.kind !== 'unknown') return null;
  const normalized = normalizeOracleText(String(step.raw || '')).trim();
  const match = normalized.match(/^(?:you\s+may\s+)?choose\s+.+?\s+and\s+(put\s+.+?\s+counters?\s+on\s+.+)$/i);
  if (!match) return null;
  return parseSimpleCounterTailStep(String(match[1] || '').trim());
}

function parseTriggeredIfCounterUnknownStep(step: OracleEffectStep): OracleEffectStep | null {
  if (step.kind !== 'unknown') return null;
  const normalized = normalizeOracleText(String(step.raw || '')).trim();
  const match = normalized.match(/^(?:(?:flying|first strike|double strike|deathtouch|haste|hexproof|indestructible|lifelink|menace|reach|trample|vigilance)\s+)?when\s+.+?\s+enters,\s*if\s+(.+?),\s*(put\s+.+?\s+counters?\s+on\s+.+)$/i);
  if (!match) return null;
  const counterStep = parseSimpleCounterTailStep(String(match[2] || '').trim());
  if (!counterStep || counterStep.kind !== 'add_counter') return null;
  return {
    kind: 'conditional',
    condition: { kind: 'if', raw: normalizeLeadingConditionalCondition(String(match[1] || '').trim()) },
    steps: [counterStep],
    ...(step.sequence ? { sequence: step.sequence } : {}),
    raw: normalized,
  };
}

function parseTriggeredLifeUnknownStep(step: OracleEffectStep): OracleEffectStep | null {
  if (step.kind !== 'unknown') return null;
  const normalized = normalizeOracleText(String(step.raw || '')).trim();
  const match = normalized.match(/^(?:(?:when|whenever)\b.+?|at the beginning of\b.+?),\s+(.+)$/i);
  if (!match) return null;
  const lifeStep = parseLifeTailStep(String(match[1] || '').trim());
  return lifeStep && (lifeStep.kind === 'gain_life' || lifeStep.kind === 'lose_life') ? lifeStep : null;
}

function parseLifeUnknownStep(step: OracleEffectStep): OracleEffectStep | null {
  if (step.kind !== 'unknown') return null;
  const lifeStep = parseLifeTailStep(String(step.raw || '').trim());
  return lifeStep && (lifeStep.kind === 'gain_life' || lifeStep.kind === 'lose_life') ? lifeStep : null;
}

function parseTrailingCommaLifeUnknownStep(step: OracleEffectStep): OracleEffectStep | null {
  if (step.kind !== 'unknown') return null;
  const raw = normalizeOracleText(String(step.raw || '')).trim();
  if (/^if\b/i.test(raw)) return null;
  const match = raw.match(/,\s+((?:you|each player|each other player|each opponent|target player|target opponent|that player|that opponent)\s+(?:gains?|loses?)\s+.+?\s+life)$/i);
  if (!match) return null;
  const lifeStep = parseLifeTailStep(String(match[1] || '').trim());
  return lifeStep && (lifeStep.kind === 'gain_life' || lifeStep.kind === 'lose_life') ? lifeStep : null;
}

function parseConditionalLifeUnknownStep(step: OracleEffectStep): OracleEffectStep | null {
  if (step.kind !== 'unknown') return null;
  const normalized = normalizeOracleText(String(step.raw || '')).trim();
  const match = normalized.match(/^if\s+(.+),\s+(.+)$/i);
  if (!match) return null;
  const lifeStep = parseLifeTailStep(String(match[2] || '').trim());
  if (!lifeStep || (lifeStep.kind !== 'gain_life' && lifeStep.kind !== 'lose_life')) return null;
  return {
    kind: 'conditional',
    condition: { kind: 'if', raw: normalizeLeadingConditionalCondition(String(match[1] || '').trim()) },
    steps: [lifeStep],
    ...(step.sequence ? { sequence: step.sequence } : {}),
    raw: normalized,
  };
}

function parseQualifiedLifeUnknownStep(step: OracleEffectStep): OracleEffectStep | null {
  if (step.kind !== 'unknown') return null;
  const normalized = normalizeOracleText(String(step.raw || '')).trim();
  const match = normalized.match(/^(each opponent)\s+who\s+(.+?)\s+loses?\s+(that much|that many|\d+|x|[a-z]+)\s+life\b/i);
  if (!match) return null;
  const lifeStep = parseLifeTailStep(`${String(match[1] || '').trim()} loses ${String(match[3] || '').trim()} life`);
  if (!lifeStep || lifeStep.kind !== 'lose_life') return null;
  return {
    kind: 'conditional',
    condition: { kind: 'if', raw: `${String(match[1] || '').trim()} who ${String(match[2] || '').trim()}` },
    steps: [lifeStep],
    ...(step.sequence ? { sequence: step.sequence } : {}),
    raw: normalized,
  };
}

function parsePrefixedTapCounterUnknownStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'unknown') return null;
  const normalized = normalizeOracleText(String(step.raw || '')).trim();
  const body = normalized.replace(/^(?:[A-Za-z][A-Za-z0-9 ',\-]+\s+-\s*)?(?:\{[^}]+\}\s*)+:\s*/i, '');
  const tapCounterMatch = body.match(/^(tap|untap)\s+(.+?)\s+and\s+(put\s+.+?\s+counters?\s+on\s+.+)$/i);
  if (tapCounterMatch) {
    const counterStep = parseSimpleCounterTailStep(String(tapCounterMatch[3] || '').trim());
    if (counterStep?.kind === 'add_counter') {
      return [
        {
          kind: 'tap_or_untap',
          target: parseObjectSelector(String(tapCounterMatch[2] || '').trim()),
          mode: String(tapCounterMatch[1] || '').trim().toLowerCase() === 'untap' ? 'untap' : 'tap',
          raw: `${String(tapCounterMatch[1] || '').trim()} ${String(tapCounterMatch[2] || '').trim()}`,
        },
        counterStep,
      ];
    }
  }
  if (body === normalized) return null;
  const tapStep = tryParseSimpleActionClause({
    clause: normalizeClauseForParse(body).clause,
    rawClause: body,
    withMeta: <T extends OracleEffectStep>(value: T) => value,
  });
  if (!tapStep || tapStep.kind === 'unknown') return null;
  return splitTapAndCounterStep(tapStep) || [tapStep];
}

export {
  parseChooseAndPutCounterUnknownStep,
  parseClauseUnknownStep,
  parseConditionalLifeUnknownStep,
  parseDiscardUnknownStep,
  parseDrawReplacementGainLifeUnknownStep,
  parseLifeUnknownStep,
  parsePrefixedTapCounterUnknownStep,
  parseQualifiedLifeUnknownStep,
  parseResultLifeUnknownStep,
  parseTrailingCommaLifeUnknownStep,
  parseTriggeredIfCounterUnknownStep,
  parseTriggeredLifeUnknownStep,
  splitAddManaAndLoseLifeUnknownStep,
  splitDamageAndLifeUnknownStep,
  splitDestroyAndCantBlockStep,
  splitDestroyAndNoCombatDamageStep,
  splitDestroyUnlessDamageStep,
  splitDiscardAndLifeStep,
  splitDiscardMillLifeFromMalformedDiscardStep,
  splitDiscardMillLifeStep,
  splitDiscardMillLifeUnknownStep,
  splitMillAndLifeUnknownStep,
  splitMillDrawLifeStep,
  splitMoveZoneAndLifeUnknownStep,
  splitSacrificeAndLifeStep,
  splitSacrificeFollowOnInstructionsStep,
  splitTapAndCounterStep,
};
