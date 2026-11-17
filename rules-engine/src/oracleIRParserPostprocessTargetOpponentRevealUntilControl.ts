/**
 * oracleIRParserPostprocessTargetOpponentRevealUntilControl.ts
 *
 * Origin parent: oracleIRParserPostprocessLookChooseFromTop.ts (mergeLookChooseFromTopAbilities).
 * Cluster: "target opponent reveals cards from the top of their library until they reveal
 * a <selector> card. You put that card onto the battlefield under your control [and lose life
 * equal to that permanent's mana value]. That player puts the rest ... on the bottom of their
 * library in a random order." collapsed into one look_choose_from_top step.
 *
 * Public entry: parseTargetOpponentRevealUntilControlSequence.
 * Do not import the parent barrel from here.
 */

import type { OracleEffectStep } from './oracleIR';

const APOS = "['\u2019]";

const REVEAL_UNTIL_RE = new RegExp(
  '^(target\\s+opponent|that\\s+player)\\s+reveals\\s+cards\\s+from\\s+the\\s+top\\s+of\\s+their\\s+library\\s+until\\s+they\\s+reveal\\s+an?\\s+(.+?)\\s+card[.]?$',
  'i',
);

const PUT_UNDER_YOUR_CONTROL_RE = new RegExp(
  '^you\\s+put\\s+that\\s+card\\s+onto\\s+the\\s+battlefield\\s+under\\s+your\\s+control(?:\\s+and\\s+lose\\s+life\\s+equal\\s+to\\s+that\\s+(?:permanent|card)' +
    APOS +
    '?s\\s+mana\\s+value)?[.]?$',
  'i',
);

const LOSE_LIFE_MV_RE = new RegExp(
  '\\blose\\s+life\\s+equal\\s+to\\s+that\\s+(?:permanent|card)' + APOS + '?s\\s+mana\\s+value\\b',
  'i',
);

const REST_ON_BOTTOM_RE =
  /^that\s+player\s+puts\s+the\s+rest\s+of\s+the\s+revealed\s+cards\s+on\s+the\s+bottom\s+of\s+their\s+library\s+in\s+a\s+random\s+order[.]?$/i;

function stepRaw(step: OracleEffectStep | undefined): string {
  return String((step as { raw?: unknown } | undefined)?.raw || '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseTargetOpponentRevealUntilControlSequence(
  current: OracleEffectStep,
  next: OracleEffectStep | undefined,
  after: OracleEffectStep | undefined,
): { readonly step: OracleEffectStep; readonly consumed: number } | null {
  if (!next) return null;
  const reveal = stepRaw(current).match(REVEAL_UNTIL_RE);
  if (!reveal) return null;
  const nextRaw = stepRaw(next);
  if (!PUT_UNDER_YOUR_CONTROL_RE.test(nextRaw)) return null;

  const selectorText = String(reveal[2] || '').trim();
  if (!selectorText) return null;
  const whoRaw = String(reveal[1] || '').toLowerCase();
  const consumeRest = Boolean(after) && REST_ON_BOTTOM_RE.test(stepRaw(after));
  const sequence = (current as { sequence?: 'then' }).sequence;

  return {
    consumed: consumeRest ? 3 : 2,
    step: {
      kind: 'look_choose_from_top',
      who: /^target/.test(whoRaw) ? { kind: 'target_opponent' } : { kind: 'target_player' },
      amount: { kind: 'reference_amount', raw: `until they reveal a ${selectorText} card` },
      selectorText,
      destination: 'battlefield',
      reveal: true,
      putUnderYourControl: true,
      ...(LOSE_LIFE_MV_RE.test(nextRaw) ? { loseLifeEqualToManaValue: true } : {}),
      ...(sequence ? { sequence } : {}),
      raw: [stepRaw(current), nextRaw, consumeRest ? stepRaw(after) : ''].filter(Boolean).join('. '),
    } as unknown as OracleEffectStep,
  };
}
