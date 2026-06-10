import { getEffectivePower } from '../../socket/util.js';

export type TeamworkAdditionalCost = {
  readonly type: 'teamwork';
  readonly amount: number;
  readonly teamworkMinPower: number;
  readonly teamworkIsOptional: true;
};

export function detectTeamworkAdditionalCost(oracleText: string): TeamworkAdditionalCost | null {
  const match = String(oracleText || '').match(
    /\bTeamwork\s+(\d+)\s*\(\s*As an additional cost to cast this spell,\s*you may tap any number of creatures you control with total power (\d+) or more\.?\s*\)/i
  );
  if (!match) return null;
  const minPower = Number.parseInt(String(match[1] || match[2] || '0'), 10);
  if (!Number.isFinite(minPower) || minPower <= 0) return null;
  return {
    type: 'teamwork',
    amount: minPower,
    teamworkMinPower: minPower,
    teamworkIsOptional: true,
  };
}

export function spellOracleUsesTeamworkChooseBoth(oracleText: string): boolean {
  return /\bif this spell was cast using teamwork,\s*choose both instead\b/i.test(String(oracleText || ''));
}

export function sumSelectedCreaturesPower(
  battlefield: readonly any[],
  creatureIds: readonly string[],
): number {
  let total = 0;
  for (const id of creatureIds) {
    const permanent = battlefield.find((entry) => entry && String(entry.id || '') === String(id));
    if (!permanent) continue;
    total += getEffectivePower(permanent);
  }
  return total;
}

export type PowerUpAbilityInfo = {
  readonly isPowerUp: true;
  readonly manaCost: string;
  readonly effectText: string;
};

export function parsePowerUpActivatedAbility(text: string): PowerUpAbilityInfo | null {
  const normalized = String(text || '').trim();
  const match = normalized.match(/^Power-up\s*[—-]\s*((?:\{[^}]+\})+)\s*:\s*(.+)$/i);
  if (!match) return null;
  return {
    isPowerUp: true,
    manaCost: String(match[1] || '').replace(/\s+/g, '').trim(),
    effectText: String(match[2] || '').trim(),
  };
}

export function isPowerUpAbilityLine(text: string): boolean {
  return /^Power-up\s*[—-]/i.test(String(text || '').trim());
}

export function applyPowerUpEnteredThisTurnDiscount(
  manaCost: string,
  permanent: any,
): string {
  if (!(permanent as any)?.enteredThisTurn) return manaCost;
  const card = (permanent as any)?.card || permanent;
  const manaValue = Number.parseInt(String(card?.cmc ?? card?.mana_value ?? ''), 10);
  if (!Number.isFinite(manaValue) || manaValue <= 0) return manaCost;

  const symbols = String(manaCost || '').match(/\{[^}]+\}/g) || [];
  if (symbols.length <= manaValue) return '';
  return symbols.slice(manaValue).join('');
}

export function stripPowerUpReminderParenthetical(text: string): string {
  return String(text || '')
    .replace(/\s*\(\s*Activate each power-up ability only once\.[^)]*\)\s*\.?\s*$/i, '')
    .trim();
}
