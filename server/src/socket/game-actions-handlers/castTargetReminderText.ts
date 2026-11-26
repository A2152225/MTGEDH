/**
 * socket/game-actions-handlers/castTargetReminderText.ts
 *
 * Outcome-sweep family #13: reminder text treated as cast targets (NO_VALID_TARGETS).
 * - Reminder text without "target" never changes what a spell targets, but it leaked into target
 *   filters (Shape the Sands: "(It can block creatures with flying.)").
 * - Reminder text that names a target belongs to an optional or later event: awaken's
 *   "(If you cast this spell for {4}{W}, also put ... on target land you control ...)" (Ondu Rising,
 *   Ruinous Path, Clutch of Currents) or a keyword action inside a delayed trigger (Fatal Fissure:
 *   "When that creature dies this turn, you earthbend 4. (Target land you control ...)").
 * A targeted reminder after a top-level keyword action ("Earthbend 3. (Target land ...)") is kept.
 * Hexproof / shroud reminders ("It can't be the target of spells") never add a target.
 * A line ending without punctuation ("Ripple 4" once its reminder is gone) is closed with a period
 * so its number cannot run into the next line's "target player" as a target count.
 *
 * Public entry symbols: stripCastTargetReminderText.
 */

const OPTIONAL_REMINDER_RE = /^\(\s*if you cast this spell for\b/i;
const DELAYED_CONTEXT_RE = /\b(?:when|whenever|at the beginning|at the end|if)\b/i;

function closeUnpunctuatedLines(text: string): string {
  return text.replace(/([a-z0-9])[ \t]*(\r?\n)/gi, '$1.$2');
}

export function stripCastTargetReminderText(oracleText: string): string {
  const text = String(oracleText || '');
  if (!text.includes('(')) return text;
  return closeUnpunctuatedLines(text.replace(/\s*\([^()]*\)/g, (group: string, offset: number) => {
    const reminder = group.trim();
    if (!/\btargets?\b/i.test(reminder)) return '';
    if (/\b(?:the target of|be the target)\b/i.test(reminder)) return '';
    if (OPTIONAL_REMINDER_RE.test(reminder)) return '';
    // Sentence the reminder explains: text since the previous line break / sentence before it.
    const before = text.slice(0, offset);
    const lineStart = before.lastIndexOf('\n') + 1;
    const line = before.slice(lineStart);
    const sentences = line.split(/(?<=[.!?])\s+/).filter((part) => part.trim().length > 0);
    const explained = sentences.length > 0 ? sentences[sentences.length - 1] : line;
    return DELAYED_CONTEXT_RE.test(explained) ? '' : group;
  }));
}
