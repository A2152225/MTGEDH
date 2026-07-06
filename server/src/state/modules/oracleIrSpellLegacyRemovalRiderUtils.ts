import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { triggerLifeGainEffects } from '../utils.js';
import { debug } from '../../utils/debug.js';
import { enqueueLibrarySearchStep } from './triggerLibrarySearchUtils.js';
import { createCommonArtifactTokenFromText } from './oracleIrSpellLegacyArtifactTokenUtils.js';
import { skipRetiredSpellLegacyHandler } from './oracleIrSpellLegacyRouting.js';

export function isPathToExileRemovalRider(cardName: string, oracleTextLower: string): boolean {
  const normalizedName = String(cardName || '').toLowerCase();
  return (
    normalizedName.includes('path to exile') ||
    (oracleTextLower.includes('exile target creature') &&
      oracleTextLower.includes('search') &&
      oracleTextLower.includes('basic land'))
  );
}

export function isSwordsToPlowsharesRemovalRider(cardName: string, oracleTextLower: string): boolean {
  const normalizedName = String(cardName || '').toLowerCase();
  return (
    normalizedName.includes('swords to plowshares') ||
    (oracleTextLower.includes('exile target creature') &&
      oracleTextLower.includes('gains life equal to'))
  );
}

export function isFatefulAbsenceRemovalRider(cardName: string, oracleTextLower: string): boolean {
  const normalizedName = String(cardName || '').toLowerCase();
  return (
    normalizedName.includes('fateful absence') ||
    (oracleTextLower.includes('destroy target creature') && oracleTextLower.includes('investigates'))
  );
}

export function isGetLostRemovalRider(cardName: string, oracleTextLower: string): boolean {
  const normalizedName = String(cardName || '').toLowerCase();
  return (
    normalizedName.includes('get lost') ||
    (oracleTextLower.includes('destroy target creature') && oracleTextLower.includes('map token'))
  );
}

export function isNaturesClaimRemovalRider(cardName: string, oracleTextLower: string): boolean {
  const normalizedName = String(cardName || '').toLowerCase();
  return (
    normalizedName.includes("nature's claim") ||
    normalizedName.includes('natures claim') ||
    ((oracleTextLower.includes('destroy target artifact') ||
      oracleTextLower.includes('destroy target enchantment')) &&
      oracleTextLower.includes('its controller gains 4 life'))
  );
}

export function isNaturesClaimTargetCaptureEffect(cardName: string, oracleTextLower: string): boolean {
  const normalizedName = String(cardName || '').toLowerCase();
  return (
    normalizedName.includes("nature's claim") ||
    normalizedName.includes('natures claim') ||
    ((oracleTextLower.includes('destroy target artifact') ||
      oracleTextLower.includes('destroy target enchantment')) &&
      oracleTextLower.includes('its controller gains'))
  );
}

export function shouldCaptureRemovalTargetControllerMetadata(
  cardName: string,
  oracleTextLower: string,
): boolean {
  return (
    isPathToExileRemovalRider(cardName, oracleTextLower) ||
    isSwordsToPlowsharesRemovalRider(cardName, oracleTextLower) ||
    isFatefulAbsenceRemovalRider(cardName, oracleTextLower) ||
    isGetLostRemovalRider(cardName, oracleTextLower) ||
    isNaturesClaimTargetCaptureEffect(cardName, oracleTextLower)
  );
}

export function shouldCaptureRemovalTargetPower(cardName: string, oracleTextLower: string): boolean {
  return isSwordsToPlowsharesRemovalRider(cardName, oracleTextLower);
}

export function computeRemovalTargetPowerBeforeRemoval(targetPerm: any): number {
  let targetPowerBeforeRemoval = 0;
  if (typeof targetPerm?.effectivePower === 'number') {
    targetPowerBeforeRemoval = targetPerm.effectivePower;
  } else if (typeof targetPerm?.basePower === 'number') {
    targetPowerBeforeRemoval = targetPerm.basePower;
  } else if (targetPerm?.card?.power) {
    const parsed = parseInt(String(targetPerm.card.power), 10);
    if (!Number.isNaN(parsed)) {
      targetPowerBeforeRemoval = parsed;
    }
  }

  if (targetPerm?.counters) {
    const plusCounters = targetPerm.counters['+1/+1'] || 0;
    const minusCounters = targetPerm.counters['-1/-1'] || 0;
    targetPowerBeforeRemoval += plusCounters - minusCounters;
  }

  return Math.max(0, targetPowerBeforeRemoval);
}

function applyLifeGainToPlayer(
  ctx: GameContext,
  targetController: PlayerID,
  amount: number,
  logLabel: string,
): void {
  if (!targetController || amount <= 0) return;

  const state = (ctx as any).state;
  if (!state) return;

  const players = Array.isArray(state.players) ? state.players : [];
  const player = players.find((entry: any) => entry?.id === targetController);
  const startingLife = Number(state.startingLife || 40);
  state.life = state.life || {};
  const currentLife = Number(state.life[targetController] ?? player?.life ?? startingLife);
  const nextLife = currentLife + amount;
  state.life[targetController] = nextLife;

  if (player) {
    player.life = nextLife;
    debug(2, `[${logLabel}] ${targetController} gains ${amount} life (${currentLife} -> ${nextLife})`);
  }

  triggerLifeGainEffects(state, targetController, amount);
}

export function applyPathToExileBasicLandSearch(
  ctx: GameContext,
  targetController: PlayerID,
  cardName?: string,
): void {
  if (!targetController) return;

  enqueueLibrarySearchStep(ctx, targetController, {
    searchFor: 'basic land',
    description: `${cardName || 'Path to Exile'}: Search for a basic land`,
    destination: 'battlefield',
    entersTapped: true,
    optional: true,
    source: cardName || 'Path to Exile',
    shuffleAfter: true,
    maxSelections: 1,
    minSelections: 0,
    filter: { types: ['land'], supertypes: ['basic'] },
  });
  debug(2, `[applyPathToExileBasicLandSearch] ${targetController} may search for a basic land (tapped)`);
}

export function applySwordsToPlowsharesLifeRider(
  ctx: GameContext,
  targetController: PlayerID,
  targetPowerBeforeRemoval: number,
): void {
  applyLifeGainToPlayer(ctx, targetController, targetPowerBeforeRemoval, 'applySwordsToPlowsharesLifeRider');
}

export function applyFatefulAbsenceInvestigateClue(ctx: GameContext, controller: PlayerID): boolean {
  const created = createCommonArtifactTokenFromText(ctx, controller, 'clue');
  if (created) {
    debug(2, `[applyFatefulAbsenceInvestigateClue] Created Clue token for ${controller}`);
  }
  return created;
}

export function applyGetLostMapTokens(ctx: GameContext, controller: PlayerID): boolean {
  const created = createCommonArtifactTokenFromText(ctx, controller, 'map', 2);
  if (created) {
    debug(1, `[applyGetLostMapTokens] Created 2 Map tokens for ${controller}`);
  }
  return created;
}

export function applyNaturesClaimLifeRider(
  ctx: GameContext,
  targetController: PlayerID,
  amount = 4,
): void {
  applyLifeGainToPlayer(ctx, targetController, amount, 'applyNaturesClaimLifeRider');
}


export function applySpellLegacyRemovalRiders(
  ctx: GameContext,
  options: {
    cardName?: string;
    oracleTextLower: string;
    targetController?: PlayerID;
    targetPowerBeforeRemoval?: number;
    spellController?: PlayerID;
    stackItemId?: string;
    targets?: any[];
    sourceImage?: string;
  },
): void {
  const cardName = String(options?.cardName || '');
  const oracleTextLower = String(options?.oracleTextLower || '').toLowerCase();
  if (skipRetiredSpellLegacyHandler(oracleTextLower, cardName)) {
    return;
  }
  const targetController = options?.targetController;

  if (targetController) {
    if (isPathToExileRemovalRider(cardName, oracleTextLower)) {
      applyPathToExileBasicLandSearch(ctx, targetController, cardName);
    }

    if (isSwordsToPlowsharesRemovalRider(cardName, oracleTextLower)) {
      applySwordsToPlowsharesLifeRider(ctx, targetController, Number(options?.targetPowerBeforeRemoval || 0));
    }

    if (isFatefulAbsenceRemovalRider(cardName, oracleTextLower)) {
      applyFatefulAbsenceInvestigateClue(ctx, targetController);
    }

    if (isGetLostRemovalRider(cardName, oracleTextLower)) {
      applyGetLostMapTokens(ctx, targetController);
    }

    if (isNaturesClaimRemovalRider(cardName, oracleTextLower)) {
      applyNaturesClaimLifeRider(ctx, targetController);
    }
  }
}

export function applySpellLegacyRemovalArtifactRiders(
  ctx: GameContext,
  options: {
    cardName?: string;
    oracleTextLower: string;
    targetController?: PlayerID;
  },
): void {
  applySpellLegacyRemovalRiders(ctx, options);
}
