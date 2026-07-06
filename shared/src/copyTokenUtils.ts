/** Remove the Legendary supertype from a type line (Helm of the Host, etc.). */
export function stripLegendaryFromTypeLine(typeLine: string): string {
  return String(typeLine || '')
    .replace(/\bLegendary\s+/gi, '')
    .replace(/\s+Legendary\b/gi, '')
    .trim();
}

export function applyNonLegendaryCopyTypeLine(
  card: { type_line?: string } | null | undefined,
  permanent?: { type_line?: string; cardType?: string } | null,
): void {
  if (card && typeof card === 'object') {
    if (card.type_line) {
      card.type_line = stripLegendaryFromTypeLine(card.type_line);
    }
  }
  if (permanent && typeof permanent === 'object') {
    if (permanent.type_line) {
      permanent.type_line = stripLegendaryFromTypeLine(permanent.type_line);
    }
    if (permanent.cardType) {
      permanent.cardType = stripLegendaryFromTypeLine(permanent.cardType);
    }
  }
}
