import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { uid, parsePT } from '../utils.js';
import { debug } from '../../utils/debug.js';
import { movePermanentToLibrary } from './zones.js';
import { enqueueLibrarySearchStep } from './triggerLibrarySearchUtils.js';
import { skipRetiredSpellLegacyHandler } from './oracleIrSpellLegacyRouting.js';

export function isJaheirasRespiteSpell(cardName: string, oracleTextLower: string): boolean {
  const normalizedName = String(cardName || '').toLowerCase();
  return (
    normalizedName.includes("jaheira's respite") ||
    (oracleTextLower.includes('search your library') &&
      oracleTextLower.includes('number of creatures attacking you') &&
      oracleTextLower.includes('basic land'))
  );
}

export function applyJaheirasRespiteLibrarySearch(
  ctx: GameContext,
  controller: PlayerID,
  cardName?: string,
): void {
  const state = (ctx as any).state;
  if (!state) return;

  const attackers = (state as any).combat?.attackers || [];
  const attackingController = attackers.filter((atk: any) => atk.defendingPlayer === controller).length;

  enqueueLibrarySearchStep(ctx, controller, {
    searchFor: 'basic land cards',
    description: `${cardName || "Jaheira's Respite"}: Search for up to ${attackingController} basic lands`,
    destination: 'battlefield',
    entersTapped: true,
    optional: true,
    source: cardName || "Jaheira's Respite",
    shuffleAfter: true,
    maxSelections: attackingController,
    filter: { types: ['land'], supertypes: ['basic'] },
    minSelections: 0,
  });
  debug(
    2,
    `[applyJaheirasRespiteLibrarySearch] ${controller} may search for up to ${attackingController} basic lands (creatures attacking)`,
  );
}

export function isChaosWarpSpell(cardName: string, oracleTextLower: string): boolean {
  const normalizedName = String(cardName || '').toLowerCase();
  return (
    normalizedName.includes('chaos warp') ||
    (oracleTextLower.includes('shuffles it into their library') &&
      oracleTextLower.includes('reveals the top card') &&
      oracleTextLower.includes('permanent'))
  );
}

function revealAndMaybePutTopPermanentOntoBattlefield(
  ctx: GameContext,
  owner: PlayerID,
  battlefield: any[],
  useSimplePermanentShape: boolean,
): void {
  const lib = ctx.libraries?.get(owner) || [];
  if (lib.length === 0) return;

  const topCard = lib[0];
  const state = (ctx as any).state;
  const viewers = new Set<any>([owner as any, 'spectator:judge' as const]);
  for (const player of (state?.players || []) as any[]) {
    if (player?.id) viewers.add(player.id);
  }
  ctx.revealedLibraryTopByOwner?.set(owner, {
    cardId: String(topCard?.id || ''),
    viewers,
  });

  const topTypeLine = (topCard?.type_line || '').toLowerCase();
  const isPermanent =
    topTypeLine.includes('creature') ||
    topTypeLine.includes('artifact') ||
    topTypeLine.includes('enchantment') ||
    topTypeLine.includes('land') ||
    topTypeLine.includes('planeswalker') ||
    topTypeLine.includes('battle');

  if (!isPermanent) {
    debug(
      2,
      `[applyChaosWarpEffect] ${owner} revealed ${topCard?.name || 'card'} (${topTypeLine}) - not a permanent, stays on top`,
    );
    return;
  }

  lib.shift();
  ctx.libraries?.set(owner, lib);
  ctx.revealedLibraryTopByOwner?.delete(owner);

  if (useSimplePermanentShape) {
    battlefield.push({
      id: `perm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      card: topCard,
      controller: owner,
      owner,
      tapped: false,
      counters: {},
    });
    debug(2, `[applyChaosWarpEffect] Revealed and put ${topCard.name} onto battlefield for ${owner}`);
    return;
  }

  const isCreature = topTypeLine.includes('creature');
  const isPlaneswalker = topTypeLine.includes('planeswalker');
  const newPermanent = {
    id: uid('perm'),
    controller: owner,
    owner,
    tapped: false,
    counters: {},
    basePower: isCreature ? parsePT((topCard as any).power) : undefined,
    baseToughness: isCreature ? parsePT((topCard as any).toughness) : undefined,
    summoningSickness: isCreature,
    card: { ...topCard, zone: 'battlefield' },
  } as any;

  if (isPlaneswalker && (topCard as any).loyalty) {
    const loyaltyValue = parseInt((topCard as any).loyalty, 10);
    newPermanent.counters = { loyalty: loyaltyValue };
    newPermanent.loyalty = loyaltyValue;
    newPermanent.baseLoyalty = loyaltyValue;
  }

  battlefield.push(newPermanent);
  debug(2, `[applyChaosWarpEffect] ${owner} revealed ${topCard?.name || 'card'} (permanent) - put onto battlefield`);
}

export function applyChaosWarpEffect(
  ctx: GameContext,
  options: {
    cardName?: string;
    oracleTextLower: string;
    targets?: any[];
  },
): { shouldEarlyReturn: boolean } {
  const cardName = String(options?.cardName || '');
  const oracleTextLower = String(options?.oracleTextLower || '').toLowerCase();
  const targets = Array.isArray(options?.targets) ? options.targets : [];

  if (!isChaosWarpSpell(cardName, oracleTextLower) || targets.length === 0) {
    return { shouldEarlyReturn: false };
  }

  const state = (ctx as any).state;
  if (!state) return { shouldEarlyReturn: false };

  const targetPermId = targets[0]?.id || targets[0];
  const battlefield = state.battlefield || [];
  const targetPerm = battlefield.find((permanent: any) => permanent.id === targetPermId);
  if (!targetPerm) return { shouldEarlyReturn: false };

  const owner = targetPerm.owner as PlayerID;
  const targetCard = targetPerm.card;
  const commandZone = ctx.commandZone || {};
  const commanderInfo = commandZone[owner];
  const commanderIds = commanderInfo?.commanderIds || [];
  const isCommander =
    (targetCard?.id && commanderIds.includes(targetCard.id)) || targetPerm.isCommander === true;

  const moved = movePermanentToLibrary(ctx, targetPermId, 'shuffle');
  if (!moved) {
    return { shouldEarlyReturn: true };
  }

  if (isCommander && targetCard) {
    debug(
      2,
      `[applyChaosWarpEffect] Commander ${targetCard.name} would go to library - queued commander zone choice step`,
    );
    revealAndMaybePutTopPermanentOntoBattlefield(ctx, owner, battlefield, true);
    ctx.bumpSeq();
    return { shouldEarlyReturn: true };
  }

  revealAndMaybePutTopPermanentOntoBattlefield(ctx, owner, battlefield, false);

  const lib = ctx.libraries?.get(owner) || [];
  const zones = state.zones || {};
  const z = zones[owner];
  if (z) {
    z.libraryCount = lib.length;
  }

  return { shouldEarlyReturn: false };
}

export function applySpellLegacySpecialSpellRiders(
  ctx: GameContext,
  options: {
    cardName?: string;
    oracleTextLower: string;
    spellController: PlayerID;
    targets?: any[];
  },
): { shouldEarlyReturn: boolean } {
  const cardName = String(options?.cardName || '');
  const oracleTextLower = String(options?.oracleTextLower || '').toLowerCase();
  const spellController = options.spellController;

  if (skipRetiredSpellLegacyHandler(oracleTextLower, cardName)) {
    return { shouldEarlyReturn: false };
  }

  if (isJaheirasRespiteSpell(cardName, oracleTextLower)) {
    applyJaheirasRespiteLibrarySearch(ctx, spellController, cardName);
  }

  return applyChaosWarpEffect(ctx, {
    cardName,
    oracleTextLower,
    targets: options?.targets,
  });
}
