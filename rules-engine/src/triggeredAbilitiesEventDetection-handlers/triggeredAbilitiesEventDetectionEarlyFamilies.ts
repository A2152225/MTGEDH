/**
 * Origin parent: triggeredAbilitiesEventDetection.ts
 * Cluster moved: detectTriggeredAbilityEvent early return families
 *   (spell countered / beginning-of-main / first-spell / spell-cast)
 * Public: tryParseTriggeredAbilityEventEarlyFamilies
 */

export function tryParseTriggeredAbilityEventEarlyFamilies<T extends string>(
  text: string,
  triggerEventValues: Record<string, T>
): { event: T; filter?: string } | undefined {
  if (
    /\bspell\b.*\b(?:is|was)\s+countered\b/.test(text) ||
    /\b(?:is|was)\s+countered\b.*\bspell\b/.test(text) ||
    /\bcounters a spell\b/.test(text) ||
    /\byou counter a spell\b/.test(text)
  ) {
    return { event: triggerEventValues.SPELL_COUNTERED, filter: text };
  }

  if (
    text.includes('second main phase') ||
    text.includes('postcombat main phase') ||
    text.includes('post-combat main phase')
  ) {
    return { event: triggerEventValues.BEGINNING_OF_POSTCOMBAT_MAIN, filter: text };
  }

  if (
    /\bthe beginning of your next(?: first)? main phase\b/.test(text) ||
    /\bthe beginning of the next main phase\b/.test(text)
  ) {
    return { event: triggerEventValues.BEGINNING_OF_PRECOMBAT_MAIN, filter: text };
  }

  if (
    /\b(?:the )?first noncreature spell of a turn is cast\b/.test(text) ||
    /\b(?:the )?first spell of a turn is cast\b/.test(text)
  ) {
    return { event: triggerEventValues.NONCREATURE_SPELL_CAST, filter: text };
  }

  if (/^this creature or another [a-z]+ you control(?: with [a-z]+)? enters\b/.test(text)) {
    return { event: triggerEventValues.ENTERS_BATTLEFIELD, filter: text };
  }

  if (
    /\b(?:you|an opponent|opponent|a player|each opponent|enchanted player|the chosen player)\s+casts?\b/.test(text) ||
    /\byou next cast\b/.test(text) ||
    /\bcast(?:s)?\s+(?:their\s+first\s+)?(?:a\s+)?(?:noncreature\s+spell|creature\s+spell|instant or sorcery spell|spell)\b/.test(text) ||
    /\bcast(?:s)?\s+a\s+spell\s+with\s+the\s+chosen\s+name\b/.test(text) ||
    /\byou\s+cast\s+(?:a\s+)?(?:blue|green|red|white|black|cat|dog|kraken|pegasus|aura|lesson)\b/.test(text) ||
    /\bwhen you cast\b/.test(text)
  ) {
    if (text.includes('noncreature spell')) {
      return { event: triggerEventValues.NONCREATURE_SPELL_CAST, filter: text };
    }
    if (text.includes('creature spell')) {
      return { event: triggerEventValues.CREATURE_SPELL_CAST, filter: text };
    }
    if (text.includes('instant or sorcery spell') || /\binstant, sorcery\b/.test(text)) {
      return { event: triggerEventValues.INSTANT_OR_SORCERY_CAST, filter: text };
    }
    return { event: triggerEventValues.SPELL_CAST, filter: text };
  }
  return undefined;
}
