export interface GiftInfo {
  hasGift: boolean;
  giftType?: string;
}

function normalizeWhitespace(value: string): string {
  return String(value || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function extractGiftInfo(oracleText: string): GiftInfo {
  const text = String(oracleText || '').replace(/\r/g, '').trim();
  if (!text) return { hasGift: false };

  const firstLine = text.split('\n')[0] || '';
  const match = firstLine.match(/^Gift\s+(.+?)(?:\s*\(|$)/i);
  if (!match) return { hasGift: false };

  const giftType = String(match[1] || '').trim();
  return {
    hasGift: giftType.length > 0,
    giftType: giftType || undefined,
  };
}

export function stripGiftLine(oracleText: string): string {
  const text = String(oracleText || '').replace(/\r/g, '').trim();
  if (!text) return '';

  const lines = text.split('\n');
  if (/^Gift\s+.+/i.test(String(lines[0] || '').trim())) {
    return normalizeWhitespace(lines.slice(1).join('\n'));
  }

  return normalizeWhitespace(text);
}

export function resolveGiftAwareOracleText(oracleText: string, giftPromised?: boolean): string {
  let text = stripGiftLine(oracleText).replace(/\u2019/g, "'");
  if (!text) return '';
  if (giftPromised == null) return text;

  if (giftPromised) {
    text = text.replace(/[^.]+\.\s*If the gift was promised, instead ([^.]+\.)/gi, '$1');
    text = text.replace(/\bIf the gift was promised, instead ([^.]+\.)/gi, '$1');
    text = text.replace(/\bIf the gift was promised, ([^.]+\.)/gi, '$1');
    text = text.replace(/\bThen if the gift was promised and\b/gi, 'Then if ');
    text = text.replace(/\bif the gift was promised and\b/gi, 'if ');
    text = text.replace(/\bIf the gift wasn't promised, [^.]+\./gi, '');
  } else {
    text = text.replace(/([^.]+\.)\s*If the gift was promised, instead [^.]+\./gi, '$1');
    text = text.replace(/\bIf the gift was promised, instead [^.]+\./gi, '');
    text = text.replace(/\bIf the gift was promised, [^.]+\./gi, '');
    text = text.replace(/\bThen if the gift was promised and [^.]+\./gi, '');
    text = text.replace(/\bIf the gift wasn't promised, ([^.]+\.)/gi, '$1');
    text = text.replace(/\bThen if the gift wasn't promised and\b/gi, 'Then if ');
    text = text.replace(/\bif the gift wasn't promised and\b/gi, 'if ');
  }

  return normalizeWhitespace(text);
}