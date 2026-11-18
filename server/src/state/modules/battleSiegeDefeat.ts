/**
 * Battle / Siege defeat (CR 310.10 / 704.5q):
 * When a battle has no defense counters, it is defeated.
 * Non-Siege battles are put into their owner's graveyard as an SBA.
 * Sieges: exile, then cast transformed without paying mana cost.
 *
 * Public: readBattleDefense, isBattleDefeated, processBattleDefeatSBAs,
 * buildSiegeTransformedExileCard.
 */

import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { movePermanentToExile, movePermanentToGraveyard } from './counters_tokens.js';
import { queueCastFromExileResolutionPrompt } from './triggerCastFromExileUtils.js';
import { isBattleCard, isSiegeCard } from './battleSiegeEntry.js';

export function readBattleDefense(permanent: any): number {
  const fromCounters = Number(permanent?.counters?.defense);
  if (Number.isFinite(fromCounters)) return Math.max(0, Math.floor(fromCounters));
  const fromField = Number(permanent?.defense);
  if (Number.isFinite(fromField)) return Math.max(0, Math.floor(fromField));
  return 0;
}

export function isBattleDefeated(permanent: any): boolean {
  if (!permanent || !isBattleCard(permanent.card || permanent)) return false;
  return readBattleDefense(permanent) <= 0;
}

/**
 * Stamp an exile-zone card so cast-from-exile may cast the transform back face
 * without paying its mana cost (Siege defeat).
 */
export function buildSiegeTransformedExileCard(sourceCard: any, exileShell: any): any {
  const faces = Array.isArray(sourceCard?.card_faces) ? sourceCard.card_faces : [];
  const back = faces[1] || null;
  const base = {
    ...(typeof sourceCard === 'object' && sourceCard ? sourceCard : {}),
    ...(typeof exileShell === 'object' && exileShell ? exileShell : {}),
  };
  const id = String(exileShell?.id || sourceCard?.id || base.id || '').trim();
  return {
    ...base,
    id,
    layout: sourceCard?.layout || base.layout || 'transform',
    card_faces: faces.length > 0 ? faces : base.card_faces,
    faceIndex: 1,
    transformed: true,
    castAsTransformed: true,
    castWithAbility: 'siege-defeat',
    castWithoutPayingManaCost: true,
    ...(back
      ? {
          name: back.name || base.name,
          type_line: back.type_line || back.typeLine || base.type_line,
          oracle_text: back.oracle_text || back.oracleText || base.oracle_text,
          mana_cost: back.mana_cost ?? back.manaCost ?? '',
          manaCost: back.mana_cost ?? back.manaCost ?? '',
          power: back.power ?? base.power,
          toughness: back.toughness ?? base.toughness,
          colors: Array.isArray(back.colors) ? back.colors : base.colors,
          image_uris: back.image_uris || base.image_uris,
        }
      : {}),
    zone: 'exile',
  };
}

function findExileCard(state: any, ownerId: string, cardId: string): any | null {
  const exile = state?.zones?.[ownerId]?.exile;
  if (!Array.isArray(exile)) return null;
  return exile.find((entry: any) => String(entry?.id || '') === String(cardId || '')) || null;
}

/**
 * Process battles with 0 defense. Sieges are exiled then offered as a mandatory
 * cast-transformed; other battles go to the graveyard. Returns true if any
 * battle left the battlefield.
 */
export function processBattleDefeatSBAs(ctx: GameContext): boolean {
  const state = (ctx as any)?.state;
  if (!state || !Array.isArray(state.battlefield)) return false;

  const defeated = state.battlefield.filter((perm: any) => isBattleDefeated(perm));
  if (defeated.length === 0) return false;

  let changed = false;
  const gameId = String((ctx as any).gameId || '');

  for (const perm of [...defeated]) {
    const permanentId = String(perm?.id || '').trim();
    if (!permanentId) continue;
    // Re-check — a prior defeat in this pass may have mutated the battlefield.
    if (!state.battlefield.some((entry: any) => String(entry?.id || '') === permanentId)) continue;
    if (!isBattleDefeated(perm)) continue;

    const card = perm.card || {};
    const controller = String(perm.controller || perm.owner || '') as PlayerID;
    const owner = String(perm.owner || perm.controller || '') as PlayerID;
    const name = String(card?.name || permanentId);

    if (isSiegeCard(card)) {
      const cardSnapshot = typeof card === 'object' ? { ...card } : card;
      const cardId = String(card?.id || permanentId);
      try {
        movePermanentToExile(ctx, permanentId);
      } catch (err) {
        debugWarn(1, `[processBattleDefeatSBAs] exile failed for ${name}:`, err);
        continue;
      }

      const exileOwner = owner || controller;
      const exileCard = findExileCard(state, exileOwner, cardId);
      if (!exileCard) {
        debugWarn(1, `[processBattleDefeatSBAs] ${name} not found in exile after defeat`);
        changed = true;
        continue;
      }

      const stamped = buildSiegeTransformedExileCard(cardSnapshot, exileCard);
      Object.assign(exileCard, stamped);

      const backName = String(stamped?.name || name);
      if (gameId && controller && !(ctx as any).isReplaying) {
        queueCastFromExileResolutionPrompt(
          ctx,
          gameId,
          controller,
          name,
          permanentId,
          card?.image_uris?.small || card?.image_uris?.normal,
          exileCard,
          {
            mandatory: true,
            castAsTransformed: true,
            castWithoutPayingManaCost: true,
            omitDecline: true,
            castLabel: `Cast ${backName} transformed`,
            description: `${name} was defeated. Cast ${backName} transformed without paying its mana cost.`,
            declineDestination: 'exile',
          },
        );
      }

      debug(1, `[processBattleDefeatSBAs] Siege ${name} defeated → exile, cast transformed`);
      changed = true;
      continue;
    }

    if (movePermanentToGraveyard(ctx, permanentId, true)) {
      debug(1, `[processBattleDefeatSBAs] Battle ${name} defeated → graveyard`);
      changed = true;
    }
  }

  return changed;
}
