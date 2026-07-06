import {
  getEquippedAttackRevealPumpPowerPerCard,
  isEquippedAttackRevealUntilLandPump,
} from '../utils.js';

export interface EquippedAttackRevealPumpResult {
  attachment: any;
  defendingPlayerId: string;
  equipmentName: string;
  revealedCount: number;
  totalPump: number;
  landHitName?: string;
}

type DeclareAttackerRef = {
  creatureId: string;
  targetPlayerId?: string;
  defendingPlayerId?: string;
};

type MillUntilLandFn = (
  game: any,
  targetPlayerId: string,
) => { milled: any[]; landHit?: { name?: string } };

export function processEquippedAttackRevealUntilLandPumps(
  game: any,
  attackers: DeclareAttackerRef[],
  battlefield: any[],
  millUntilLand: MillUntilLandFn,
): EquippedAttackRevealPumpResult[] {
  const results: EquippedAttackRevealPumpResult[] = [];

  for (const attacker of attackers) {
    const defendingPlayerId = String(attacker.targetPlayerId || attacker.defendingPlayerId || '').trim();
    if (!defendingPlayerId) continue;

    const creature = battlefield.find((perm: any) => perm?.id === attacker.creatureId);
    if (!creature) continue;

    for (const attachment of battlefield) {
      const typeLine = String(attachment?.card?.type_line || '').toLowerCase();
      if (!typeLine.includes('equipment')) continue;
      if (attachment.attachedTo !== attacker.creatureId) continue;

      const attachOracleText = String(attachment.card?.oracle_text || '');
      if (!isEquippedAttackRevealUntilLandPump(attachOracleText)) continue;

      const millResult = millUntilLand(game, defendingPlayerId);
      const revealedCount = millResult.milled.length;
      const powerPerCard = getEquippedAttackRevealPumpPowerPerCard(attachOracleText);
      const totalPump = revealedCount * powerPerCard;
      attachment.trepanationBonus = totalPump;
      attachment.lastTrepanationBonus = totalPump;

      results.push({
        attachment,
        defendingPlayerId,
        equipmentName: String(attachment.card?.name || 'Equipment'),
        revealedCount,
        totalPump,
        landHitName: millResult.landHit?.name,
      });
    }
  }

  return results;
}

export function formatEquippedAttackRevealPumpChatMessage(
  result: EquippedAttackRevealPumpResult,
  defendingPlayerName: string,
): string {
  return `${result.equipmentName}: ${defendingPlayerName} mills ${result.revealedCount} card(s)${result.landHitName ? ` (stopped at ${result.landHitName})` : ''}. Equipped creature gets +${result.totalPump}/+0 until end of turn.`;
}

export function emitEquippedAttackRevealPumpMessages(
  io: { to: (room: string) => { emit: (event: string, payload: unknown) => void } },
  gameId: string,
  results: EquippedAttackRevealPumpResult[],
  formatPlayerName: (playerId: string) => string,
): void {
  for (const result of results) {
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: formatEquippedAttackRevealPumpChatMessage(result, formatPlayerName(result.defendingPlayerId)),
      ts: Date.now(),
    });
  }
}
