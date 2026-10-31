// client/src/utils/identicalTriggerTargetReuse.ts
// "Use this target for the remaining identical triggers" (Warstorm Surge with many creatures
// entering at once). The rule covers only the identical triggers already on the stack when the
// player opted in, and stops as soon as the chosen target is no longer legal so the player is
// asked again.
// Public entry symbols: identicalTriggerKeyForStep, countIdenticalTriggersWaiting,
//   rememberTargetForIdenticalTriggers, takeReusableTriggerTargets, clearIdenticalTriggerTargetReuse.

type ReuseRule = {
  gameId: string;
  key: string;
  targetIds: string[];
  remaining: number;
};

let rule: ReuseRule | null = null;

function normalize(text: unknown): string {
  return String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Same source name and same prompt text means the same ability; undefined when not a targeted trigger. */
export function identicalTriggerKeyForStep(step: any): string | undefined {
  if (!step || step.type !== 'target_selection' || step.targetedTriggeredAbility !== true) return undefined;
  const sourceName = normalize(step.sourceName);
  if (!sourceName) return undefined;
  return `${sourceName}|${normalize(step.description)}|${normalize(step.targetDescription)}`;
}

/**
 * Identical triggers still waiting on the stack. The server usually pops the resolving trigger
 * before prompting; `resolvingItemId` excludes it when it is still listed.
 */
export function countIdenticalTriggersWaiting(
  stack: readonly any[] | undefined,
  sourceName: string | undefined,
  controllerId: string | undefined,
  resolvingItemId?: string,
): number {
  const name = normalize(sourceName);
  if (!name || !Array.isArray(stack)) return 0;
  return stack.filter((item: any) => {
    if (!item) return false;
    if (resolvingItemId && String(item.id) === String(resolvingItemId)) return false;
    const itemName = normalize(item.sourceName || item.name || item.card?.name);
    if (itemName !== name) return false;
    if (controllerId && item.controller && String(item.controller) !== String(controllerId)) return false;
    const type = String(item.type || '');
    return type === '' || type === 'triggered_ability' || type === 'ability';
  }).length;
}

export function rememberTargetForIdenticalTriggers(gameId: string, key: string, targetIds: string[], remaining: number): void {
  rule = remaining > 0 && targetIds.length > 0 ? { gameId, key, targetIds: [...targetIds], remaining } : null;
}

/**
 * Returns the remembered targets when this step is one of the covered identical triggers and every
 * remembered target is still offered; otherwise clears the rule (for a matching step) and returns null.
 */
export function takeReusableTriggerTargets(gameId: string, step: any, validTargetIds: readonly string[]): string[] | null {
  if (!rule) return null;
  const key = identicalTriggerKeyForStep(step);
  if (!key || rule.gameId !== gameId || rule.key !== key) return null;
  const valid = new Set(validTargetIds.map(String));
  if (!rule.targetIds.every((id) => valid.has(id))) {
    rule = null;
    return null;
  }
  const targetIds = rule.targetIds;
  rule.remaining -= 1;
  if (rule.remaining <= 0) rule = null;
  return targetIds;
}

export function clearIdenticalTriggerTargetReuse(): void {
  rule = null;
}
