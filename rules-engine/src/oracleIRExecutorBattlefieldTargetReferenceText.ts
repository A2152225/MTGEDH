// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: normalizeBattlefieldTargetReferenceText.
// Public entry: normalizeBattlefieldTargetReferenceText.

export function normalizeBattlefieldTargetReferenceText(value: string): string {
  return String(value || '')
    .replace(/\u2019/g, "'")
    .trim()
    .replace(/^when you do,\s*/i, '')
    .replace(/\s+at the beginning of the next end step.*$/i, '')
    .replace(/\s+or if it would leave the battlefield.*$/i, '')
    .replace(/\s+instead$/i, '')
    .replace(/\s+at end of combat$/i, '')
    .replace(/\s+this turn$/i, '')
    .replace(/\s+doesn['']t untap during its controller(?:'s)? next untap step$/i, '')
    // Banisher Priest / Palace Jailer / Oblivion Ring style linked-exile duration.
    .replace(/\s+until (?:this (?:permanent|creature|artifact|enchantment|aura|vehicle)|it|[^.]+?) leaves the battlefield\b.*$/i, '')
    .replace(/\s+until an opponent becomes the monarch\b.*$/i, '')
    .replace(/^x target /i, 'up to x target ')
    .replace(/[.\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
