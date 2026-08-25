// Extracted from oracleIRExecutorPlayerUtils.ts.
// Cluster: normalizeOracleText and getCardTypeLineLower (card-text inspect).
// Public entries: normalizeOracleText, getCardTypeLineLower.

export function normalizeOracleText(value: string): string {
  return String(value || '')
    .replace(/â€™|â€˜|[\u2018\u2019]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.;:,]+$/g, '')
    .trim();
}

export function getCardTypeLineLower(card: any): string {
  return String(card?.cardType || card?.type_line || card?.card?.type_line || '')
    .toLowerCase()
    .trim();
}
