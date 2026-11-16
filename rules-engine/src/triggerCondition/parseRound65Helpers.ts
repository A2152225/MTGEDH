/** Helpers for parseRound65Events.ts. Public: withFields65, stampSubject65, combineDual65, splitOrList65, norm65, emptySubject65. */
import type { TriggerConditionIR } from './types.js';

export type Parsed65 = { condition: TriggerConditionIR; effect: string };

export const emptySubject65 = {
  anyObject: true,
  typeGroups: [] as readonly (readonly string[])[],
  subtypeGroups: [] as readonly (readonly string[])[],
  groups: [] as readonly { types: readonly string[]; subtypes: readonly string[] }[],
  excludedWords: [] as readonly string[],
  supertypes: [] as readonly string[],
  keywordsWith: [] as readonly string[],
  keywordsWithout: [] as readonly string[],
  token: 'any' as const,
};

export function compose65(event: string, effect: string, fields: Record<string, unknown> = {}, subjectFields: Record<string, unknown> = {}): Parsed65 {
  const quantity = (fields.quantity as Parsed65['condition']['quantity']) || 'one';
  const controller = (fields.controller as any) || 'you';
  const source = (fields.source as any) || 'any';
  const rest = { ...fields };
  delete rest.quantity;
  delete rest.controller;
  delete rest.source;
  return {
    condition: {
      event: event as TriggerConditionIR['event'],
      quantity,
      alternatives: [{
        controller,
        source,
        subject: { ...emptySubject65, ...subjectFields },
      }],
      ...rest,
    } as TriggerConditionIR,
    effect,
  };
}

export function withFields65(base: Parsed65 | null, fields: Record<string, unknown>): Parsed65 | null {
  return base ? { ...base, condition: { ...base.condition, ...fields } as TriggerConditionIR } : null;
}

export function stampSubject65(base: Parsed65 | null, fields: Record<string, unknown>): Parsed65 | null {
  if (!base) return null;
  const alts = (base.condition.alternatives || []).map((a) => ({
    ...a,
    subject: { ...a.subject, ...fields },
  }));
  return { ...base, condition: { ...base.condition, alternatives: alts } as TriggerConditionIR };
}

export function combineDual65(left: Parsed65 | null, right: Parsed65 | null): Parsed65 | null {
  if (!left || !right) return null;
  if (left.condition.event === right.condition.event) {
    return withFields65(left, {
      alternatives: [...(left.condition.alternatives || []), ...(right.condition.alternatives || [])],
    });
  }
  return withFields65(left, {
    pairedEvent: right.condition.event,
    pairedCondition: right.condition,
  } as any);
}

export function norm65(s: string): string {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

export function splitOrList65(raw: string): string[] {
  return String(raw || '')
    .replace(/\s+or\s+/g, ', ')
    .split(/\s*,\s*/)
    .map((p) => p.replace(/^an?\s+/, '').trim())
    .filter(Boolean);
}

export function parseDelayed65(text: string, reparse: (s: string) => Parsed65 | null): Parsed65 | null {
  const delayedThisTurn = /^(when|whenever) (.+?)(?: under your control)? this turn,\s*(.+)$/.exec(text);
  if (delayedThisTurn && !/during (?:your|their) turn/.test(text)) {
    const mid = delayedThisTurn[2];
    if (/\b(?:dies|is put into (?:a |your )?graveyard|leaves the battlefield|is dealt damage|deals combat damage|become attached|you lose control|attacks and isn't blocked)\b/.test(mid)
      || /^(it|that creature|this artifact|this creature|enchanted creature)\b/.test(mid)) {
      const rewritten = mid
        .replace(/^it dies(?: under your control)?$/, 'this creature dies')
        .replace(/^it's put into a graveyard$/, 'this creature is put into a graveyard')
        .replace(/^that creature is dealt damage(?: by an attacking creature)?$/, 'this creature is dealt damage')
        .replace(/^that creature deals combat damage to a player or planeswalker$/, 'this creature deals combat damage to a player or planeswalker')
        .replace(/^the targeted creature leaves the battlefield$/, 'this creature leaves the battlefield')
        .replace(/^you lose control of that equipment$/, 'you lose control of this equipment');
      return withFields65(reparse(delayedThisTurn[1] + ' ' + rewritten + ', ' + delayedThisTurn[3]), {
        delayedRider: true,
        thisTurn: true,
      } as any);
    }
  }
  const delayedThisWay = /^(when|whenever) (.+?) this way,\s*(.+)$/.exec(text);
  if (delayedThisWay) {
    return withFields65(reparse(delayedThisWay[1] + ' ' + delayedThisWay[2] + ', ' + delayedThisWay[3]), {
      delayedRider: true,
      thisWay: true,
    } as any);
  }
  return null;
}
