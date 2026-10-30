import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import { buildDurablePlayableFromExilePermission, upsertDurablePermission } from './durable-permissions.js';

function firstImageUrl(source: any): string | undefined {
  if (!source || typeof source !== 'object') return undefined;
  const direct = source.image_uris?.normal
    || source.image_uris?.large
    || source.image_uris?.small
    || source.image_uris?.png
    || source.imageUrl
    || source.image_url;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const faces = Array.isArray(source.card_faces) ? source.card_faces : [];
  for (const face of faces) {
    const faceUrl = face?.image_uris?.normal || face?.image_uris?.large || face?.image_uris?.small || face?.image_uris?.png;
    if (typeof faceUrl === 'string' && faceUrl.trim()) return faceUrl.trim();
  }
  return undefined;
}

function previewSource(card: any): any {
  const nested = card?.card;
  if (nested && typeof nested === 'object' && (nested.image_uris || nested.card_faces || nested.name)) return nested;
  return card;
}

/** Cast option for a may-cast-from-exile prompt, including a hoverable card image. */
export function buildCastFromExilePromptOptions(
  exiledCard: any,
  extras?: { castLabel?: string; declineLabel?: string },
): Array<Record<string, unknown>> {
  const source = previewSource(exiledCard);
  const cardName = String(source?.name || exiledCard?.name || 'that card');
  const typeLine = String(source?.type_line || source?.typeLine || exiledCard?.type_line || exiledCard?.typeLine || '').trim();
  const imageUrl = firstImageUrl(source) || firstImageUrl(exiledCard);
  const faces = Array.isArray(source?.card_faces)
    ? source.card_faces
      .filter((face: any) => face && (face.image_uris || face.name))
      .map((face: any) => ({
        name: face.name,
        type_line: face.type_line || face.typeLine,
        image_uris: face.image_uris,
      }))
    : undefined;
  const previewCard = (imageUrl || source?.image_uris || (faces && faces.length > 0))
    ? {
        name: cardName,
        ...(typeLine ? { type_line: typeLine } : {}),
        ...(source?.layout ? { layout: source.layout } : {}),
        ...(source?.image_uris
          ? { image_uris: source.image_uris }
          : imageUrl
            ? { image_uris: { normal: imageUrl, small: imageUrl } }
            : {}),
        ...(faces && faces.length > 0 ? { card_faces: faces } : {}),
      }
    : undefined;

  return [
    {
      id: 'cast',
      label: extras?.castLabel || `Cast ${cardName}`,
      cardName,
      ...(typeLine ? { description: typeLine } : {}),
      ...(imageUrl ? { imageUrl } : {}),
      ...(previewCard ? { previewCard } : {}),
    },
    { id: 'decline', label: extras?.declineLabel || 'Decline' },
  ];
}

export function queueCastFromExileResolutionPrompt(
  ctx: GameContext,
  gameId: string,
  playerId: PlayerID,
  sourceName: string,
  sourceId: string | undefined,
  sourceImage: string | undefined,
  exiledCard: any,
  extras?: {
    declineDestination?: string;
    declineLabel?: string;
    castLabel?: string;
    description?: string;
    mandatory?: boolean;
  },
): void {
  const stateAny = (ctx as any)?.state as any;
  const exiledCardId = String(exiledCard?.id || '').trim();
  const cardName = String(exiledCard?.name || 'that card');
  const declineDestination = String(
    extras?.declineDestination
    || (exiledCard as any)?.castFromExileDeclineDestination
    || 'library_bottom_random',
  );
  if (stateAny && exiledCardId) {
    upsertDurablePermission(stateAny, buildDurablePlayableFromExilePermission({
      playerId,
      cardIds: [exiledCardId],
      action: 'cast',
      duration: 'one_shot',
      turnApplied: Number(stateAny.turnNumber ?? 0),
      expiresAtTurn: Number(stateAny.turnNumber ?? 0),
      sourceId,
      sourceName,
      costMode: 'without_paying_mana_cost',
      grantsFlash: true,
      timingOverride: { ignoreTiming: true },
      usageLimit: { type: 'one_shot', maxUses: 1 },
    }));
  }

  ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: playerId as any,
    description: extras?.description || `${sourceName}: You may cast ${cardName} from exile without paying its mana cost.`,
    mandatory: extras?.mandatory === true,
    sourceName,
    sourceId,
    sourceImage,
    options: buildCastFromExilePromptOptions(exiledCard, {
      castLabel: extras?.castLabel,
      declineLabel: extras?.declineLabel,
    }),
    minSelections: 1,
    maxSelections: 1,
    castFromExileCardId: exiledCard?.id,
    castFromExileCard: exiledCard,
    castFromExileDeclineDestination: declineDestination,
    castFromExileIgnoreTimingRestrictions: true,
  } as any);
}
