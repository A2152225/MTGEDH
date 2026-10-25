// client/src/utils/batch24ChoicePresentation.ts
// Presentation helpers for Batch 24 prompts that reuse existing pickers: Magnetic Mountain paid untap
// (TARGET_SELECTION upkeepPaidUntapSelection), Amplify reveal (OPTION_CHOICE amplifyRevealChoice),
// Fasting (OPTION_CHOICE optionalDrawStepSkipChoice), amplify reveal toasts and the first-turns cast refusal.
// Public entry symbols: upkeepUntapCostSummary, decorateBatch24OptionChoice, describeAmplifyRevealed, describeFirstTurnsRefusal.

type Opt = { id: string; label: string; description?: string };

/** "Pay {2} per creature \u2014 total {4} for 2 creatures". */
export function upkeepUntapCostSummary(costPerCreature: number, selected: number): string {
  const cost = Math.max(0, Number(costPerCreature) || 0);
  const n = Math.max(0, Number(selected) || 0);
  return `Pay {${cost}} per creature \u2014 total {${cost * n}} for ${n} creature${n === 1 ? '' : 's'}`;
}

/** Adjusts description/options of amplify and Fasting OPTION_CHOICE steps; other steps unchanged. */
export function decorateBatch24OptionChoice<T extends Opt>(step: Record<string, unknown>, description: string, options: T[]): { description: string; options: T[] } {
  if (step.amplifyRevealChoice === true) {
    const n = Math.max(1, Number(step.amplifyValue) || 1);
    const per = `+${n} +1/+1 counter${n === 1 ? '' : 's'}`;
    return {
      description: `${description || 'Amplify'} \u2014 each card revealed gives ${per}. Reveal none to skip.`,
      options: options.map((o) => ({ ...o, description: o.description ? `${o.description} (${per})` : `Reveal: ${per}` })),
    };
  }
  if (step.optionalDrawStepSkipChoice === true) {
    const life = Math.max(0, Number(step.lifeGain ?? 2) || 0);
    return {
      description: `${String(step.sourceName || 'Fasting')}: skip your draw step to gain ${life} life?`,
      options: options.map((o) => (o.id === 'skip'
        ? { ...o, label: `Skip draw (gain ${life} life)` }
        : o.id === 'draw' ? { ...o, label: 'Draw normally' } : o)),
    };
  }
  return { description, options };
}

/** Toast text for a permanent's amplifyRevealed list, or null. */
export function describeAmplifyRevealed(perm: any): string | null {
  const names: string[] = Array.isArray(perm?.amplifyRevealed) ? perm.amplifyRevealed.map(String).filter(Boolean) : [];
  if (!names.length) return null;
  return `${perm?.card?.name || 'Creature'} amplified: revealed ${names.join(', ')}`;
}

/** Readable first-turns refusal ("can't cast during your first, second, or third turns"), else null. */
export function describeFirstTurnsRefusal(message: unknown): string | null {
  const m = /first, second, or third turns of the game(?: \(turn (\d+)\))?/i.exec(String(message || ''));
  if (!m) return null;
  return `Not during your first three turns${m[1] ? ` \u2014 this is your turn ${m[1]}` : ''}. You can cast it from your 4th turn on.`;
}
