export type GameLogTargetInfo = {
  id: string;
  type: 'permanent' | 'player';
  name?: string;
  controllerId?: string;
  controllerName?: string;
};

export function formatNameList(names: readonly string[]): string {
  const filtered = names.map((name) => String(name || '').trim()).filter(Boolean);
  if (filtered.length === 0) return 'no creatures';
  if (filtered.length === 1) return filtered[0];
  if (filtered.length === 2) return `${filtered[0]} and ${filtered[1]}`;
  return `${filtered.slice(0, -1).join(', ')}, and ${filtered[filtered.length - 1]}`;
}

export function formatStackTargets(
  targetDetails: readonly GameLogTargetInfo[] | undefined,
  resolveName: (id: string) => string,
): string {
  if (!targetDetails?.length) return '';
  const parts = targetDetails.map((target) => {
    if (target.type === 'player') {
      return String(target.name || resolveName(target.id)).trim() || resolveName(target.id);
    }
    const name = String(target.name || 'Permanent').trim() || 'Permanent';
    const controller = String(
      target.controllerName || (target.controllerId ? resolveName(target.controllerId) : ''),
    ).trim();
    if (controller && controller !== target.controllerId) {
      return `${name} (${controller}'s)`;
    }
    return name;
  });
  if (parts.length === 1) return ` targeting ${parts[0]}`;
  return ` targeting ${formatNameList(parts)}`;
}

export function formatCastSpellMessage(
  casterName: string,
  spellName: string,
  targetDetails?: readonly GameLogTargetInfo[],
  resolveName?: (id: string) => string,
  suffix?: string,
): string {
  const baseName = String(spellName || 'Spell').trim() || 'Spell';
  const targets = targetDetails && resolveName ? formatStackTargets(targetDetails, resolveName) : '';
  const message = `${casterName} casts ${baseName}${targets}`;
  return suffix ? `${message} ${suffix}`.trimEnd() : message;
}

export function formatDeclareAttackersMessage(
  attackerPlayerName: string,
  attackers: ReadonlyArray<{ creatureId: string; targetPlayerId?: string; targetPermanentId?: string }>,
  lookupCreatureName: (creatureId: string) => string,
  lookupDefenderLabel: (targetPlayerId?: string, targetPermanentId?: string) => string,
): string {
  if (attackers.length === 0) return `${attackerPlayerName} attacks with no creatures.`;

  const byDefender = new Map<string, string[]>();
  for (const attacker of attackers) {
    const defenderLabel = lookupDefenderLabel(attacker.targetPlayerId, attacker.targetPermanentId);
    const creatureName = lookupCreatureName(attacker.creatureId);
    const names = byDefender.get(defenderLabel) || [];
    names.push(creatureName);
    byDefender.set(defenderLabel, names);
  }

  const parts: string[] = [];
  for (const [defender, creatureNames] of byDefender) {
    parts.push(`${attackerPlayerName} attacks ${defender} with ${formatNameList(creatureNames)}`);
  }
  return parts.join('; ');
}

export function formatDeclareBlockersMessage(
  blockerPlayerName: string,
  blockers: ReadonlyArray<{ blockerId: string; attackerId: string }>,
  lookupName: (permanentId: string) => string,
): string {
  if (blockers.length === 0) return `${blockerPlayerName} blocks with no creatures.`;

  const assignments = blockers.map(
    (blocker) => `${lookupName(blocker.blockerId)} blocks ${lookupName(blocker.attackerId)}`,
  );
  return `${blockerPlayerName}: ${assignments.join('; ')}`;
}

export function formatLifeChangeMessage(
  playerName: string,
  before: number,
  after: number,
): string {
  const delta = after - before;
  if (delta === 0) return '';
  const amount = Math.abs(delta);
  const verb = delta > 0 ? 'gains' : 'loses';
  return `${playerName} ${verb} ${amount} life (${before} → ${after})`;
}
