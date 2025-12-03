/**
 * triggers/win-conditions.ts
 * 
 * Win condition detection and processing.
 * Includes alternate win conditions and game-ending triggers.
 */

import type { GameContext } from "../../context.js";

export interface WinCondition {
  type: 'life_zero' | 'poison' | 'commander_damage' | 'card_effect' | 'empty_library_draw';
  playerId: string;
  winnerId?: string;
  loserId?: string;
  reason: string;
}

/**
 * Check for game-ending conditions
 * Rule 104.3: A player loses the game if:
 * - Their life total is 0 or less
 * - They have 10+ poison counters
 * - They've been dealt 21+ combat damage by a single commander
 * - They attempt to draw from an empty library
 * - A card effect says they lose
 */
export function checkWinConditions(ctx: GameContext): WinCondition[] {
  const conditions: WinCondition[] = [];
  const players = ctx.state?.players || [];
  const life = (ctx as any).life || {};
  const poison = (ctx as any).poison || {};
  const commanderDamage = (ctx.state as any)?.commanderDamage || {};
  
  for (const player of players) {
    if (!player || (player as any).spectator || (player as any).isSpectator) continue;
    const playerId = player.id;
    
    // Check life total (Rule 104.3b)
    const playerLife = life[playerId] ?? 40;
    if (playerLife <= 0) {
      conditions.push({
        type: 'life_zero',
        playerId,
        loserId: playerId,
        reason: `${player.name || playerId} has 0 or less life (${playerLife})`,
      });
    }
    
    // Check poison counters (Rule 104.3d) - 10 in regular, but Commander uses 10 as well
    const playerPoison = poison[playerId] ?? 0;
    if (playerPoison >= 10) {
      conditions.push({
        type: 'poison',
        playerId,
        loserId: playerId,
        reason: `${player.name || playerId} has ${playerPoison} poison counters`,
      });
    }
    
    // Check commander damage (21+ from a single commander)
    const playerCmdrDamage = commanderDamage[playerId] || {};
    for (const [commanderId, damage] of Object.entries(playerCmdrDamage)) {
      if (typeof damage === 'number' && damage >= 21) {
        conditions.push({
          type: 'commander_damage',
          playerId,
          loserId: playerId,
          reason: `${player.name || playerId} has taken ${damage} commander damage from a single commander`,
        });
        break; // Only need to report once per player
      }
    }
  }
  
  // Check for card-based win conditions on the battlefield
  const battlefield = ctx.state?.battlefield || [];
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    
    const cardName = (permanent.card.name || "").toLowerCase();
    const oracleText = (permanent.card.oracle_text || "").toLowerCase();
    const controllerId = permanent.controller;
    const controller = players.find((p: any) => p.id === controllerId);
    
    // Felidar Sovereign: "At the beginning of your upkeep, if you have 40 or more life, you win the game."
    if (cardName.includes('felidar sovereign') && (life[controllerId] ?? 40) >= 40) {
      conditions.push({
        type: 'card_effect',
        playerId: controllerId,
        winnerId: controllerId,
        reason: `${controller?.name || controllerId} wins with Felidar Sovereign (40+ life at upkeep)`,
      });
    }
    
    // Test of Endurance: "At the beginning of your upkeep, if you have 50 or more life, you win the game."
    if (cardName.includes('test of endurance') && (life[controllerId] ?? 40) >= 50) {
      conditions.push({
        type: 'card_effect',
        playerId: controllerId,
        winnerId: controllerId,
        reason: `${controller?.name || controllerId} wins with Test of Endurance (50+ life at upkeep)`,
      });
    }
    
    // Thassa's Oracle: Win condition is checked on ETB/resolution
    // Jace, Wielder of Mysteries: Similar to Lab Man
    // Laboratory Maniac: Replacement effect for drawing from empty library
    // These are handled in the draw logic
  }
  
  return conditions;
}

/**
 * Check for alternate win condition triggers at upkeep
 */
export function checkUpkeepWinConditions(
  ctx: GameContext,
  activePlayerId: string
): WinCondition | null {
  const life = (ctx as any).life || {};
  const playerLife = life[activePlayerId] ?? 40;
  const battlefield = ctx.state?.battlefield || [];
  const players = ctx.state?.players || [];
  const player = players.find((p: any) => p.id === activePlayerId);
  
  for (const permanent of battlefield) {
    if (!permanent || permanent.controller !== activePlayerId) continue;
    
    const cardName = (permanent.card?.name || "").toLowerCase();
    
    // Felidar Sovereign
    if (cardName.includes('felidar sovereign') && playerLife >= 40) {
      return {
        type: 'card_effect',
        playerId: activePlayerId,
        winnerId: activePlayerId,
        reason: `${player?.name || activePlayerId} wins with Felidar Sovereign (40+ life at upkeep)`,
      };
    }
    
    // Test of Endurance
    if (cardName.includes('test of endurance') && playerLife >= 50) {
      return {
        type: 'card_effect',
        playerId: activePlayerId,
        winnerId: activePlayerId,
        reason: `${player?.name || activePlayerId} wins with Test of Endurance (50+ life at upkeep)`,
      };
    }
    
    // Chance Encounter (with 10+ luck counters)
    if (cardName.includes('chance encounter')) {
      const counters = permanent.counters || {};
      if ((counters.luck || 0) >= 10) {
        return {
          type: 'card_effect',
          playerId: activePlayerId,
          winnerId: activePlayerId,
          reason: `${player?.name || activePlayerId} wins with Chance Encounter (10+ luck counters)`,
        };
      }
    }
    
    // Helix Pinnacle (with 100+ tower counters)
    if (cardName.includes('helix pinnacle')) {
      const counters = permanent.counters || {};
      if ((counters.tower || 0) >= 100) {
        return {
          type: 'card_effect',
          playerId: activePlayerId,
          winnerId: activePlayerId,
          reason: `${player?.name || activePlayerId} wins with Helix Pinnacle (100+ tower counters)`,
        };
      }
    }
    
    // Epic Struggle (20+ creatures at upkeep)
    if (cardName.includes('epic struggle')) {
      const creatureCount = battlefield.filter((p: any) => 
        p.controller === activePlayerId && 
        (p.card?.type_line || '').toLowerCase().includes('creature')
      ).length;
      
      if (creatureCount >= 20) {
        return {
          type: 'card_effect',
          playerId: activePlayerId,
          winnerId: activePlayerId,
          reason: `${player?.name || activePlayerId} wins with Epic Struggle (20+ creatures)`,
        };
      }
    }
    
    // Mortal Combat (20+ creatures in graveyard)
    if (cardName.includes('mortal combat')) {
      const zones = ctx.state?.zones?.[activePlayerId];
      const graveyard = zones?.graveyard || [];
      const creatureCount = graveyard.filter((c: any) => 
        (c.type_line || '').toLowerCase().includes('creature')
      ).length;
      
      if (creatureCount >= 20) {
        return {
          type: 'card_effect',
          playerId: activePlayerId,
          winnerId: activePlayerId,
          reason: `${player?.name || activePlayerId} wins with Mortal Combat (20+ creatures in graveyard)`,
        };
      }
    }
  }
  
  return null;
}
