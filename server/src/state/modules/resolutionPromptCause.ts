/**
 * Origin parent: stackResolveTriggeredAbilitySpecialPromptUtils.ts /
 * sanitizeStepForClient.ts
 * Cluster: presentation fields for the object that caused a trigger prompt
 * (cast spell, etc.), distinct from the watching source (Judith vs Reckless Blaze).
 * Public: resolveResolutionPromptCause
 */

export type ResolutionPromptCause = {
  readonly causeName: string;
  readonly causeImage?: string;
  readonly causeLabel: string;
};

function readImageUrl(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const entry = raw as Record<string, any>;
  const url = String(
    entry.imageUrl
    || entry.image_uris?.small
    || entry.image_uris?.normal
    || entry.card?.image_uris?.small
    || entry.card?.image_uris?.normal
    || entry.card?.imageUrl
    || '',
  ).trim();
  return url || undefined;
}

function readNamedObject(raw: unknown): { name: string; imageUrl?: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const entry = raw as Record<string, any>;
  const name = String(entry.name || entry.card?.name || '').trim();
  if (!name) return null;
  return { name, imageUrl: readImageUrl(entry) };
}

function namesMatch(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

export function resolveResolutionPromptCause(step: any, state?: any): ResolutionPromptCause | null {
  const triggerData = step?.triggerData;
  const explicitName = String(step?.causeName || '').trim();
  const spell =
    readNamedObject(step?.triggeringSpell)
    || readNamedObject(triggerData?.triggeringSpell)
    || readNamedObject(triggerData?.effectData?.triggeringSpell);
  const causeName = explicitName || spell?.name || '';
  if (!causeName) return null;

  const sourceName = String(step?.sourceName || '').trim();
  if (sourceName && namesMatch(causeName, sourceName)) return null;

  let causeImage = String(step?.causeImage || '').trim() || spell?.imageUrl;
  const stackId = String(
    step?.triggeringStackItemId
    || triggerData?.triggeringStackItemId
    || triggerData?.effectData?.triggeringStackItemId
    || '',
  ).trim();
  if (!causeImage && stackId && Array.isArray(state?.stack)) {
    const stackItem = (state.stack as any[]).find((entry) => String(entry?.id || '').trim() === stackId);
    causeImage = readImageUrl(stackItem);
  }

  const explicitLabel = String(step?.causeLabel || '').trim();
  const triggerType = String(triggerData?.triggerType || step?.triggerType || '');
  const looksLikeCast = Boolean(spell) || /cast/i.test(triggerType);
  const causeLabel = explicitLabel || (looksLikeCast ? 'You cast' : 'Triggered by');

  return {
    causeName,
    ...(causeImage ? { causeImage } : {}),
    causeLabel,
  };
}
