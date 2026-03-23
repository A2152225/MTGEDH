import { normalizeOracleText } from './oracleIRParserUtils';

export type ImpulsePermissionCondition =
  | { readonly kind: 'color'; readonly color: 'W' | 'U' | 'B' | 'R' | 'G' }
  | { readonly kind: 'type'; readonly type: 'land' | 'nonland' }
  | { readonly kind: 'attacked_with'; readonly raw: string };

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

function stripWithoutPayingManaCost(clause: string): string {
  return clause
    .replace(
      /,?\s+without paying (?:its|their|that spell(?:'s)?|those spells(?:')?) mana costs?\b/gi,
      ''
    )
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeImpulsePermissionClause(
  clause: string,
  options?: {
    normalizeExplicitSubject?: boolean;
    stripThirdPersonSpendManaRider?: boolean;
  }
): string {
  let clauseToParse = normalizeOracleText(clause).trim();

  if (options?.normalizeExplicitSubject) {
    const explicitSubjectRef =
      "(?:they|that player|that opponent|defending player|the defending player|he or she|its controller|its owner|that [a-z0-9][a-z0-9 -]*'s (?:controller|owner))";

    clauseToParse = clauseToParse
      .replace(new RegExp(`^${explicitSubjectRef} may\\b`, 'i'), 'You may')
      .replace(new RegExp(`^((?:until|through)\\b[^,]*,),\\s*${explicitSubjectRef} may\\b`, 'i'), '$1 you may')
      .replace(new RegExp(`^(during your next turn,?)\\s*${explicitSubjectRef} may\\b`, 'i'), '$1 you may')
      .replace(new RegExp(`^((?:for as long as|as long as)\\b[^,]*,),\\s*${explicitSubjectRef} may\\b`, 'i'), '$1 you may');
  }

  clauseToParse = clauseToParse.replace(/^you may look at and (play|cast)\b/i, 'You may $1');

  clauseToParse = clauseToParse
    .replace(
      /^(for as long as .*? remain(?:s)? exiled),\s*you may look at (?:that card|those cards|them|it|the exiled card|the exiled cards),\s*/i,
      '$1, '
    )
    .replace(
      /^(as long as .*? remain(?:s)? exiled),\s*you may look at (?:that card|those cards|them|it|the exiled card|the exiled cards),\s*/i,
      '$1, '
    );

  clauseToParse = stripWithoutPayingManaCost(clauseToParse);
  clauseToParse = clauseToParse.replace(/\b(?:their|his or her)\s+next\s+turn\b/gi, 'your next turn');

  clauseToParse = clauseToParse
    .replace(/,?\s+and\s+mana of any type can be spent to cast (?:that|those|the exiled) spells?\s*$/i, '')
    .replace(/,?\s+and\s+mana of any type can be spent to cast (?:it|them)\s*$/i, '')
    .replace(/,?\s+and\s+mana of any type can be spent to cast that spell\s*$/i, '')
    .replace(/,?\s*mana of any type can be spent to cast (?:that|those|the exiled) spells?\s*$/i, '')
    .replace(/,?\s*mana of any type can be spent to cast (?:it|them)\s*$/i, '')
    .replace(/,?\s*mana of any type can be spent to cast that spell\s*$/i, '')
    .replace(
      /,?\s+and\s+you may spend mana as though it were mana of any (?:color|type) to cast (?:it|them|that spell|those spells)\s*$/i,
      ''
    )
    .replace(
      options?.stripThirdPersonSpendManaRider
        ? /,?\s+and\s+they may spend mana as though it were mana of any (?:color|type) to cast (?:it|them|that spell|those spells)\s*$/i
        : /$^/,
      ''
    )
    .replace(
      /,?\s+without paying (?:its|their|that spell(?:'s)?|those spells(?:')?) mana costs?\.?\s*$/i,
      ''
    )
    .trim();

  clauseToParse = clauseToParse.replace(
    /\bcast\s+any\s+number\s+of\s+spells\s+from\s+among\b/i,
    'cast spells from among'
  );
  clauseToParse = clauseToParse.replace(/\bcast\s+any\s+number\s+of\s+/i, 'cast ');
  clauseToParse = clauseToParse.replace(/\bcast\s+up\s+to\s+(?:a|an|\d+|x|[a-z]+)\s+/i, 'cast ');
  clauseToParse = clauseToParse.replace(/\b(spells?)\s+with\s+mana\s+value\s+[^.]*?\s+from\s+among\b/gi, '$1 from among');
  clauseToParse = clauseToParse.replace(/^during your turn,?\s*if\b[^,]+,\s*(you may\b)/i, 'During your turn, $1');
  clauseToParse = clauseToParse.replace(/,?\s+if\b.*$/i, '').trim();
  clauseToParse = stripWithoutPayingManaCost(clauseToParse);

  clauseToParse = clauseToParse
    .replace(
      /,?\s+by paying\b.*\s+rather than paying (?:its|their|that spell(?:'s)?|those spells(?:')?) mana costs?\.?\s*$/i,
      ''
    )
    .trim();

  clauseToParse = clauseToParse
    .replace(/,?\s+and\s+they\s+can(?:not|'t)\s+play\s+cards?\s+from\s+their\s+hands?\s*$/i, '')
    .trim();

  return clauseToParse;
}

export function parseLeadingImpulsePermissionCondition(clause: string): {
  clause: string;
  condition?: ImpulsePermissionCondition;
} {
  const match = clause.match(
    /^if\s+(?:it|they|that card|those cards|the exiled card|the exiled cards|that spell|those spells|the exiled spell|the exiled spells|the card they exiled this way|the cards they exiled this way)(?:\s+is|\s+are|'s|'re)\s+(?:a|an)?\s*([^,]+),\s*(.*)$/i
  );

  if (!match) return { clause };

  const predicate = String(match[1] || '').trim().toLowerCase();
  const rest = String(match[2] || '').trim();
  let condition: ImpulsePermissionCondition | undefined;

  if (predicate.includes('nonland')) {
    condition = { kind: 'type', type: 'nonland' };
  } else if (predicate.includes('land')) {
    condition = { kind: 'type', type: 'land' };
  } else {
    const colorMap: Record<string, 'W' | 'U' | 'B' | 'R' | 'G'> = {
      white: 'W',
      blue: 'U',
      black: 'B',
      red: 'R',
      green: 'G',
    };
    const colorWord = predicate.replace(/\bcard\b/g, '').trim();
    const color = colorMap[colorWord];
    if (color) condition = { kind: 'color', color };
  }

  return { clause: rest, condition };
}
