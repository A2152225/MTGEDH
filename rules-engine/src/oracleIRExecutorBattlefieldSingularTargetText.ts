// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: isSingularBattlefieldTargetText.
// Public entry: isSingularBattlefieldTargetText.

export function isSingularBattlefieldTargetText(text: string): boolean {
  const normalized = String(text || '').trim();
  // "another target creature you control" is still a single targeted permanent (Jace, Multiverse Architect).
  if (!/^(?:another\s+)?target\b/i.test(normalized)) return false;
  if (/\b(?:two|three|four|five|six|seven|eight|nine|ten|any number of|up to)\b/i.test(normalized)) {
    return false;
  }
  return !/\btarget\b.*\b(?:creatures|artifacts|enchantments|planeswalkers|lands|battles|vehicles|tokens|permanents)\b/i.test(
    normalized
  );
}
