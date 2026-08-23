/**
 * oracleIRParserPostprocessBattlefieldEntryCounterAndDrawLife.ts
 *
 * Early postprocess cluster for battlefield-entry counter followups and
 * draw/life compound-step splitters. Extracted from oracleIRParserPostprocess.ts
 * (immediately after the among-them / mana-restriction cluster); re-exported
 * from that barrel.
 */

import type {
  OracleClauseCondition,
  OracleEffectStep,
  OracleQuantity,
} from './oracleIR';
import { normalizeCounterName } from './oracleIRParserSacrificeHelpers';
import { tryParseLifeAndCombatClause } from './oracleIRParserLifeAndCombatClauses';
import { tryParseSimpleActionClause } from './oracleIRParserSimpleActionClauses';
import {
  normalizeClauseForParse,
  normalizeOracleText,
  parseObjectSelector,
  parsePlayerSelector,
  parseQuantity,
} from './oracleIRParserUtils';

function parseConditionalBattlefieldEntryCounters(rawClause: string): {
  readonly condition: OracleClauseCondition;
  readonly withCounters: Record<string, number>;
} | null {
  const normalized = normalizeOracleText(rawClause)
    .replace(/^spell mastery\s*[^a-z0-9]+\s*/i, '')
    .trim();
  if (!normalized) return null;

  const match = normalized.match(
    /^if\s+(.+?),\s+that creature enters with\s+(a|an|\d+|x|[a-z]+)\s+additional\s+(.+?)\s+counters?\s+on\s+it$/i
  );
  if (!match) return null;
  const amount = parseQuantity(String(match[2] || '').trim());
  if (amount.kind !== 'number' || amount.value <= 0) return null;

  const counter = normalizeCounterName(String(match[3] || '').trim());
  if (!counter) return null;

  return {
    condition: { kind: 'if', raw: String(match[1] || '').trim() },
    withCounters: { [counter]: Math.max(0, amount.value | 0) },
  };
}

export function counterRecordFromAddCounterStep(step: OracleEffectStep | undefined): Record<string, number> | null {
  if (!step || step.kind !== 'add_counter') return null;
  if (step.amount.kind !== 'number' || step.amount.value <= 0) return null;
  const counter = normalizeCounterName(String(step.counter || '').trim());
  if (!counter) return null;
  return { [counter]: Math.max(0, step.amount.value | 0) };
}

export function parseBattlefieldEntryCounterFollowupStep(step: OracleEffectStep | undefined): {
  readonly condition?: OracleClauseCondition;
  readonly withCounters: Record<string, number>;
  readonly raw: string;
} | null {
  if (!step) return null;

  if (step.kind === 'unknown' || step.kind === 'add_counter') {
    const parsed = parseConditionalBattlefieldEntryCounters(String(step.raw || ''));
    if (parsed) return { ...parsed, raw: String(step.raw || '').trim() };
  }

  if (step.kind === 'conditional' && step.steps.length === 1) {
    const withCounters = counterRecordFromAddCounterStep(step.steps[0]);
    if (withCounters) {
      return {
        condition: step.condition,
        withCounters,
        raw: String(step.raw || '').trim(),
      };
    }
  }

  return null;
}

function parseCounterQuantityForMetadata(amountText: string, scalingText = ''): OracleQuantity {
  const amount = normalizeOracleText(amountText)
    .replace(/^up to\s+/i, '')
    .replace(/\s+of$/i, '')
    .trim();
  const scaling = normalizeOracleText(scalingText).trim();
  if (!amount) return { kind: 'unknown' };
  if (/^(?:a\s+number|number)$/i.test(amount)) {
    if (scaling) {
      const parsed = parseQuantity(`${amount} ${scaling}`.trim());
      if (parsed.kind !== 'unknown') return parsed;
    }
    return { kind: 'unknown', raw: scaling ? `${amount} ${scaling}`.trim() : amount };
  }
  if (scaling) {
    const parsed = parseQuantity(`${amount} ${scaling}`.trim());
    if (parsed.kind !== 'unknown') return parsed;
    return { kind: 'unknown', raw: `${amount} ${scaling}`.trim() };
  }
  return parseQuantity(amount);
}

export function parseDynamicCounterRider(rawText: string, targetText: string): OracleEffectStep | null {
  const normalized = normalizeOracleText(rawText)
    .replace(/[.)]+$/g, '')
    .trim();
  if (!normalized || !/\bcounters?\b/i.test(normalized)) return null;

  const match = normalized.match(
    /\b(?:with|put(?:s)?)\s+((?:a\s+number\s+of|number\s+of|that\s+many|x|a|an|\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve))\s+(?:additional\s+)?(.+?)\s+counters?\s+on\s+(?:it|them|that creature|those creatures|each of those creatures|each of them)(?:\s+(for\s+each|equal\s+to)\s+(.+?))?$/i
  );
  if (!match) return null;

  const counter = normalizeCounterName(String(match[2] || '').trim());
  if (!counter) return null;

  const scalingText = [match[3], match[4]].filter(Boolean).join(' ').trim();
  const amount = parseCounterQuantityForMetadata(String(match[1] || '').trim(), scalingText);
  if (amount.kind === 'number') return null;

  return {
    kind: 'add_counter',
    amount,
    counter,
    target: parseObjectSelector(targetText),
    raw: normalized,
  };
}

export function stripMalformedDynamicWithCounters(step: OracleEffectStep): OracleEffectStep {
  if (step.kind !== 'move_zone') return step;
  const counters = (step as any).withCounters;
  if (!counters || typeof counters !== 'object') return step;
  const entries = Object.entries(counters);
  if (!entries.some(([counter]) => /\bnumber\s+of\b/i.test(counter))) return step;

  const { withCounters: _withCounters, ...rest } = step as any;
  return rest as unknown as OracleEffectStep;
}

export function parseSimpleCounterTailStep(rawTail: string): OracleEffectStep | null {
  const normalized = normalizeClauseForParse(rawTail.replace(/[.]+$/g, '').trim());
  if (!normalized.clause) return null;
  const parsed = tryParseSimpleActionClause({
    clause: normalized.clause,
    rawClause: rawTail,
    withMeta: <T extends OracleEffectStep>(value: T) => value,
  });
  return parsed && parsed.kind !== 'unknown' ? parsed : null;
}

export function parseLifeTailStep(rawTail: string): OracleEffectStep | null {
  const normalized = normalizeClauseForParse(rawTail.replace(/[.]+$/g, '').trim());
  if (!normalized.clause) return null;
  const parsed = tryParseLifeAndCombatClause({
    clause: normalized.clause,
    rawClause: rawTail,
    withMeta: <T extends OracleEffectStep>(value: T) => value,
  });
  return parsed && parsed.kind !== 'unknown' ? parsed : null;
}

export function splitExileAndCounterRiderStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'exile' || (step.target as any)?.kind !== 'raw') return null;
  const targetText = normalizeOracleText(String((step.target as any).text || '')).trim();
  const match = targetText.match(/^(it|that creature|that permanent|that card)\s+and\s+(put\s+.+?\s+counters?\s+.+)$/i);
  if (!match) return null;

  const counterStep = parseSimpleCounterTailStep(String(match[2] || '').trim());
  if (!counterStep || counterStep.kind !== 'add_counter') return null;

  return [
    {
      ...step,
      target: parseObjectSelector(String(match[1] || '').trim()),
      raw: `exile ${String(match[1] || '').trim()}`,
    },
    counterStep,
  ];
}

export function splitCounterAndDrawStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'draw') return null;
  const raw = normalizeOracleText(String(step.raw || '')).trim();
  const match = raw.match(/\b(put\s+.+?\s+counters?\s+on\s+.+?)\s+and\s+(draw\s+.+)$/i);
  if (!match) return null;

  const counterStep = parseSimpleCounterTailStep(String(match[1] || '').trim());
  if (!counterStep || counterStep.kind !== 'add_counter') return null;
  return [counterStep, { ...step, raw: String(match[2] || '').trim() }];
}

export function splitLifeAndDrawStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'draw') return null;
  const raw = normalizeOracleText(String(step.raw || '')).replace(/^�\s*/, '').trim();
  const match = raw.match(/\b((?:you|each player|each opponent|target player|target opponent|that player|that opponent)\s+loses?\s+.+?\s+life)\s+and\s+(draws?\s+.+)$/i);
  if (!match) return null;

  const lifeStep = parseLifeTailStep(String(match[1] || '').trim());
  if (!lifeStep || lifeStep.kind !== 'lose_life') return null;
  const drawRaw = String(match[2] || '').trim();
  const drawStep: OracleEffectStep = { ...step, raw: drawRaw.replace(/^draws\b/i, 'draw').trim() };
  if (/^draws\b/i.test(drawRaw)) (drawStep as any).who = (lifeStep as any).who;
  return [lifeStep, drawStep];
}

export function splitGainLifeAndDrawStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'gain_life') return null;
  const raw = normalizeOracleText(String(step.raw || '')).replace(/^�\s*/, '').replace(/^then\s+/i, '').trim();
  const match = raw.match(
    /^(.+?)\s+gains?\s+((?:that much|that many|\d+|x|[a-z]+)\s+life)\s+and\s+draws?\s+((?:a|an|\d+|x|[a-z]+)\s+cards?)(?:,\s+where\s+x\s+is\s+(.+))?$/i
  );
  if (!match) return null;

  const who = parsePlayerSelector(String(match[1] || '').trim());
  const whereX = match[4] ? ({ kind: 'where', raw: String(match[4] || '').trim() } as OracleClauseCondition) : undefined;
  const drawAmountRaw = String(match[3] || '').trim().replace(/\s+cards?$/i, '');
  const lifeStep: OracleEffectStep = {
    kind: 'gain_life',
    who,
    amount: parseQuantity(String(match[2] || '').trim().replace(/\s+life$/i, '')),
    ...(whereX ? { whereX } : {}),
    raw: `${String(match[1] || '').trim()} gains ${String(match[2] || '').trim()}`,
  };
  const drawStep: OracleEffectStep = {
    kind: 'draw',
    who,
    amount: parseQuantity(drawAmountRaw),
    ...(whereX ? { whereX } : {}),
    raw: `${String(match[1] || '').trim()} draws ${String(match[3] || '').trim()}`,
  };
  return [lifeStep, drawStep];
}

export function splitDrawAndLifeStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'draw') return null;
  const raw = normalizeOracleText(String(step.raw || '')).replace(/^�\s*/, '').replace(/^then\s+/i, '').trim();

  const drawLose = raw.match(/^(.+?)\s+draws?\s+((?:a card|a|an|\d+|x|[a-z]+)\s+cards?)\s+and\s+(?:(.+?)\s+)?loses?\s+((?:that much|that many|\d+|x|[a-z]+)\s+life)$/i);
  if (drawLose) {
    const who = String(drawLose[1] || '').trim();
    const drawRaw = `${who} ${/^you$/i.test(who) ? 'draw' : 'draws'} ${String(drawLose[2] || '').trim()}`;
    const lifeWho = String(drawLose[3] || '').trim() || who;
    const lifeRaw = `${lifeWho} ${/^you$/i.test(lifeWho) ? 'lose' : 'loses'} ${String(drawLose[4] || '').trim()}`;
    const drawStep = tryParseSimpleActionClause({
      clause: normalizeClauseForParse(drawRaw).clause,
      rawClause: drawRaw,
      withMeta: <T extends OracleEffectStep>(value: T) => value,
    });
    const lifeStep = parseLifeTailStep(lifeRaw);
    if (drawStep?.kind === 'draw' && lifeStep?.kind === 'lose_life') return [drawStep, lifeStep];
  }

  const drawCommaLose = raw.match(/^(.+?)\s+draws?\s+((?:a card|a|an|\d+|x|[a-z]+)\s+cards?),\s+loses?\s+((?:that much|that many|\d+|x|[a-z]+)\s+life)(?:,\s+and\s+.+)?,?\s*$/i);
  if (drawCommaLose) {
    const who = String(drawCommaLose[1] || '').trim();
    const drawRaw = `${who} ${/^you$/i.test(who) ? 'draw' : 'draws'} ${String(drawCommaLose[2] || '').trim()}`;
    const lifeRaw = `${who} ${/^you$/i.test(who) ? 'lose' : 'loses'} ${String(drawCommaLose[3] || '').trim()}`;
    const drawStep = tryParseSimpleActionClause({
      clause: normalizeClauseForParse(drawRaw).clause,
      rawClause: drawRaw,
      withMeta: <T extends OracleEffectStep>(value: T) => value,
    });
    const lifeStep = parseLifeTailStep(lifeRaw);
    if (drawStep?.kind === 'draw' && lifeStep?.kind === 'lose_life') return [drawStep, lifeStep];
  }

  const gainDraw = raw.match(/^(.+?)\s+gains?\s+((?:that much|that many|\d+|x|[a-z]+)\s+life)\s+and\s+draws?\s+((?:a|an|\d+|x|[a-z]+)\s+cards?)$/i);
  if (gainDraw) {
    const who = String(gainDraw[1] || '').trim();
    const gainVerb = /^you$/i.test(who) ? 'gain' : 'gains';
    const drawVerb = /^you$/i.test(who) ? 'draw' : 'draws';
    const lifeStep = parseLifeTailStep(`${who} ${gainVerb} ${String(gainDraw[2] || '').trim()}`);
    const drawStep = tryParseSimpleActionClause({
      clause: normalizeClauseForParse(`${who} ${drawVerb} ${String(gainDraw[3] || '').trim()}`).clause,
      rawClause: `${who} ${drawVerb} ${String(gainDraw[3] || '').trim()}`,
      withMeta: <T extends OracleEffectStep>(value: T) => value,
    });
    if (lifeStep?.kind === 'gain_life' && drawStep?.kind === 'draw') return [lifeStep, drawStep];
  }

  const loseEqualDraw = raw.match(/^(.+?)\s+loses?\s+life\s+equal\s+to\s+(.+?)\s+and\s+draws?\s+((?:a|an|\d+|x|[a-z]+)\s+cards?)$/i);
  if (loseEqualDraw) {
    const who = String(loseEqualDraw[1] || '').trim();
    const lifeStep = parseLifeTailStep(`${who} loses life equal to ${String(loseEqualDraw[2] || '').trim()}`);
    const drawAmount = String(loseEqualDraw[3] || '').trim().replace(/\s+cards?$/i, '');
    const drawStep: OracleEffectStep = {
      kind: 'draw',
      who: parsePlayerSelector(who),
      amount: parseQuantity(drawAmount),
      raw: `${who} draws ${String(loseEqualDraw[3] || '').trim()}`,
    };
    if (lifeStep?.kind === 'lose_life') return [lifeStep, drawStep];
  }

  const drawReveal = raw.match(/^(.+?)\s+draws?\s+((?:a card|a|an|\d+|x|[a-z]+)\s+cards?)\s+and\s+reveal(?:s)?\s+it$/i);
  if (drawReveal) {
    const who = String(drawReveal[1] || '').trim();
    const drawRaw = `${who} ${/^you$/i.test(who) ? 'draw' : 'draws'} ${String(drawReveal[2] || '').trim()}`;
    const drawStep = tryParseSimpleActionClause({
      clause: normalizeClauseForParse(drawRaw).clause,
      rawClause: drawRaw,
      withMeta: <T extends OracleEffectStep>(value: T) => value,
    });
    if (drawStep?.kind === 'draw') {
      return [
        drawStep,
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

  const drawSacrificeBare = raw.match(/^draw\s+((?:a card|a|an|\d+|x|[a-z]+)\s+cards?)\s+and\s+sacrifices?\s+(.+)$/i);
  if (drawSacrificeBare) {
    const drawRaw = `draw ${String(drawSacrificeBare[1] || '').trim()}`;
    const drawStep = tryParseSimpleActionClause({
      clause: normalizeClauseForParse(drawRaw).clause,
      rawClause: drawRaw,
      withMeta: <T extends OracleEffectStep>(value: T) => value,
    });
    const sacrificeRaw = `sacrifice ${String(drawSacrificeBare[2] || '').trim()}`;
    const sacrificeStep = tryParseSimpleActionClause({
      clause: normalizeClauseForParse(sacrificeRaw).clause,
      rawClause: sacrificeRaw,
      withMeta: <T extends OracleEffectStep>(value: T) => value,
    });
    if (drawStep?.kind === 'draw' && sacrificeStep?.kind === 'sacrifice') {
      return [drawStep, sacrificeStep];
    }
  }

  const drawSacrifice = raw.match(/^(.+?)\s+draws?\s+((?:a card|a|an|\d+|x|[a-z]+)\s+cards?)\s+and\s+sacrifices?\s+(.+)$/i);
  if (drawSacrifice) {
    const who = String(drawSacrifice[1] || '').trim();
    const drawRaw = `${who} ${/^you$/i.test(who) ? 'draw' : 'draws'} ${String(drawSacrifice[2] || '').trim()}`;
    const drawStep = tryParseSimpleActionClause({
      clause: normalizeClauseForParse(drawRaw).clause,
      rawClause: drawRaw,
      withMeta: <T extends OracleEffectStep>(value: T) => value,
    });
    const sacrificeRaw = `${who} ${/^you$/i.test(who) ? 'sacrifice' : 'sacrifices'} ${String(drawSacrifice[3] || '').trim()}`;
    const sacrificeStep = tryParseSimpleActionClause({
      clause: normalizeClauseForParse(sacrificeRaw).clause,
      rawClause: sacrificeRaw,
      withMeta: <T extends OracleEffectStep>(value: T) => value,
    });
    if (drawStep?.kind === 'draw' && sacrificeStep?.kind === 'sacrifice') {
      return [drawStep, sacrificeStep];
    }
  }

  const drawConvert = raw.match(/^(.+?)\s+draws?\s+((?:a card|a|an|\d+|x|[a-z]+)\s+cards?)\s+and\s+convert(?:s)?\s+(.+)$/i);
  if (drawConvert) {
    const who = String(drawConvert[1] || '').trim();
    const drawRaw = `${who} ${/^you$/i.test(who) ? 'draw' : 'draws'} ${String(drawConvert[2] || '').trim()}`;
    const drawStep = tryParseSimpleActionClause({
      clause: normalizeClauseForParse(drawRaw).clause,
      rawClause: drawRaw,
      withMeta: <T extends OracleEffectStep>(value: T) => value,
    });
    if (drawStep?.kind === 'draw') {
      return [
        drawStep,
        {
          kind: 'grant_static_ability',
          target: parseObjectSelector(String(drawConvert[3] || '').trim()),
          effectText: ['convert'],
          duration: 'static',
          raw: `convert ${String(drawConvert[3] || '').trim()}`,
          sequence: 'then',
        } as unknown as OracleEffectStep,
      ];
    }
  }

  if (step.amount?.kind === 'unknown') {
    const amountRaw = normalizeOracleText(String(step.amount.raw || '')).trim();
    const amountCommaLose = amountRaw.match(/^((?:a card|a|an|\d+|x|[a-z]+)(?:\s+cards?)?),\s*lose\s+((?:that much|that many|\d+|x|[a-z]+)\s+life),?\s*$/i);
    if (amountCommaLose) {
      const whoRaw = step.who?.kind === 'you'
        ? 'you'
        : String((step.who as { raw?: string; text?: string } | undefined)?.raw
          || (step.who as { text?: string } | undefined)?.text
          || 'you').trim();
      const drawRaw = `${whoRaw} ${/^you$/i.test(whoRaw) ? 'draw' : 'draws'} ${String(amountCommaLose[1] || '').trim()}`;
      const lifeRaw = `${whoRaw} ${/^you$/i.test(whoRaw) ? 'lose' : 'loses'} ${String(amountCommaLose[2] || '').trim()}`;
      const drawStep = tryParseSimpleActionClause({
        clause: normalizeClauseForParse(drawRaw).clause,
        rawClause: drawRaw,
        withMeta: <T extends OracleEffectStep>(value: T) => value,
      });
      const lifeStep = parseLifeTailStep(lifeRaw);
      if (drawStep?.kind === 'draw' && lifeStep?.kind === 'lose_life') return [drawStep, lifeStep];
    }
  }

  return null;
}

