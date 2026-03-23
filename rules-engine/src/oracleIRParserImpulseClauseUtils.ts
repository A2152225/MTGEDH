import { normalizeOracleText } from './oracleIRParserUtils';

export function cleanImpulseClause(raw: string, options?: { stripBulletPrefix?: boolean }): string {
  let cleaned = normalizeOracleText(String(raw || '')).trim();

  if (options?.stripBulletPrefix) {
    cleaned = cleaned.replace(/^[\u2022â€¢]\s+/g, '');
  }

  return cleaned
    .replace(/^(?:the\s+)?defending player\s+may\b/i, 'that opponent may')
    .replace(/^then\b\s*/i, '')
    .replace(/^if you do,\s*/i, '')
    .replace(/^if you don[â€™']t,\s*/i, '')
    .replace(/^otherwise,?\s*/i, '')
    .replace(/^if you don[â€™']t cast (?:it|that card|the exiled card) this way,\s*/i, '')
    .replace(/,+\s*$/g, '')
    .trim();
}

export function isIgnorableImpulseReminderClause(clause: string): boolean {
  let t = normalizeOracleText(String(clause || '')).trim();
  if (!t) return false;

  t = t.replace(/^then\b\s*/i, '').trim();
  t = t.replace(/^[\(\[]\s*/g, '').trim();
  t = t.replace(/[.!]+\s*$/g, '').trim();
  t = t.replace(/\s*[\)\]]\s*$/g, '').trim();
  t = t.replace(/[.!]+\s*$/g, '').trim();
  t = t.toLowerCase();

  const lookAtPattern =
    /^you may look at (?:that card|those cards|them|it|the exiled card|the exiled cards)(?: for as long as (?:it|they) remain(?:s)? exiled| at any time| any time)?\s*$/i;
  if (lookAtPattern.test(t)) return true;

  const spendManaPattern =
    /^you may spend mana as though it were mana of any (?:color|type)(?: to cast (?:it|them|that spell|those spells))?\s*$/i;
  if (spendManaPattern.test(t)) return true;

  const chooseOnePattern =
    /^choose one(?: of (?:them|those cards|the exiled cards|the cards exiled this way|the cards they exiled this way))?(?: at random)?\s*$/i;
  if (chooseOnePattern.test(t)) return true;

  const chooseCardExiledThisWayPattern = /^choose (?:a|an|one) (?:card|spell) exiled this way\s*$/i;
  if (chooseCardExiledThisWayPattern.test(t)) return true;

  return false;
}
