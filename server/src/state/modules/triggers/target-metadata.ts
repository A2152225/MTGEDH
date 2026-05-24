export interface GenericTriggeredAbilityTargetMetadata {
  requiresTarget?: boolean;
  needsTargetSelection?: boolean;
  targetType?: string;
  targetConstraint?: 'opponent' | 'you';
  targetDescription?: string;
  minTargets?: number;
  maxTargets?: number;
}

function normalizeEffectText(effectText: string): string {
  return String(effectText || '').replace(/[’]/g, "'").replace(/\s+/g, ' ').trim();
}

export function inferGenericTriggeredAbilityTargetMetadata(effectText: string): GenericTriggeredAbilityTargetMetadata {
  const normalized = normalizeEffectText(effectText);
  const lower = normalized.toLowerCase();
  if (!/\btarget\b/.test(lower)) {
    return {};
  }

  let targetType: string | undefined;
  if (lower.includes('target creature or planeswalker')) targetType = 'creature or planeswalker';
  else if (lower.includes('target artifact or enchantment')) targetType = 'artifact or enchantment';
  else if (lower.includes('target noncreature artifact')) targetType = 'noncreature artifact';
  else if (/target\s+non-[a-z0-9'-]+(?:\s+[a-z0-9'-]+)*\s+creature\b/.test(lower)) targetType = 'creature';
  else if (lower.includes('target creature')) targetType = 'creature';
  else if (lower.includes('target player') || lower.includes('target opponent')) targetType = 'player';
  else if (lower.includes('target permanent')) targetType = 'permanent';
  else if (lower.includes('target land')) targetType = 'land';
  else if (lower.includes('target artifact')) targetType = 'artifact';
  else if (lower.includes('target enchantment')) targetType = 'enchantment';
  else if (lower.includes('target planeswalker')) targetType = 'planeswalker';
  else if (lower.includes('target battle')) targetType = 'battle';
  else if (lower.includes('target nonland')) targetType = 'nonland permanent';
  else if (lower.includes('target noncreature')) targetType = 'noncreature permanent';
  else if (lower.includes('any target')) targetType = 'any';

  if (!targetType) {
    return { requiresTarget: true, needsTargetSelection: true };
  }

  let targetConstraint: 'opponent' | 'you' | undefined;
  if (lower.includes('target opponent')) {
    targetConstraint = 'opponent';
  } else if (lower.includes('you control') || lower.includes('your graveyard')) {
    targetConstraint = 'you';
  }

  const upToMatch = lower.match(/up to (one|two|three|four|five|six|seven|eight|nine|ten|\d+) target/);
  const countWords: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  };
  let minTargets: number | undefined;
  let maxTargets: number | undefined;
  if (upToMatch) {
    const raw = String(upToMatch[1] || '').trim();
    const parsed = Number.parseInt(raw, 10);
    minTargets = 0;
    maxTargets = countWords[raw] ?? (Number.isNaN(parsed) ? 1 : parsed);
  }

  return {
    requiresTarget: true,
    needsTargetSelection: true,
    targetType,
    ...(targetConstraint ? { targetConstraint } : null),
    targetDescription: targetType === 'any' ? 'any target' : `target ${targetType}`,
    ...(typeof minTargets === 'number' ? { minTargets } : null),
    ...(typeof maxTargets === 'number' ? { maxTargets } : null),
  };
}

export function hasUnsupportedTargetRequirement(metadata: GenericTriggeredAbilityTargetMetadata): boolean {
  return metadata.requiresTarget === true && !metadata.targetType;
}
