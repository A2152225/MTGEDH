/**
 * commanderExileFollowup.ts
 *
 * Origin: oracleIrTransitionPipeline / movePermanentToExile commander replacement.
 * Cluster: stamp linked-exile / flicker metadata onto deferred commander-zone
 * choices so stay-in-exile still returns the card when the source leaves or
 * when the blink effect says to return immediately.
 *
 * Public: inferCommanderExileFollowup, type CommanderExileFollowup
 */
import { detectLinkedExileEffect } from './triggers/linked-exile.js';

export type CommanderExileFollowup = {
  readonly linkedExileData?: {
    readonly exilingPermanentId: string;
    readonly exilingPermanentName: string;
    readonly originalOwner: string;
    readonly originalController: string;
  };
  readonly flickerReturnData?: {
    readonly ownerId: string;
    readonly cardId: string;
    readonly returnAt: 'immediate' | 'next_end_step' | 'owners_next_end_step' | 'end_of_combat';
    readonly sourceName?: string;
  };
};

function textLooksLikeLinkedExile(text: string): boolean {
  return /exile\b[\s\S]*\buntil\b[\s\S]*\bleaves the battlefield/i.test(String(text || ''));
}

function textLooksLikeImmediateFlicker(text: string): boolean {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  return /exile\b.+\bthen return that (?:card|creature|permanent) to the battlefield/i.test(normalized);
}

function continuationLooksLikeImmediateFlicker(steps: readonly unknown[] | undefined): boolean {
  return (steps || []).some((step) => {
    const record = step as { kind?: string; to?: string; what?: { kind?: string; text?: string }; raw?: string };
    if (String(record?.kind || '') !== 'move_zone') return false;
    if (String(record?.to || '') !== 'battlefield') return false;
    const whatKind = String(record?.what?.kind || '').trim();
    if (whatKind === 'last_moved_card' || whatKind === 'that_card') return true;
    const whatText = String(record?.what?.text || record?.raw || '').toLowerCase();
    return /\b(?:that card|that creature|that permanent|it)\b/.test(whatText);
  });
}

function findLinkedExileSourcePermanent(state: any, sourceId?: string): any | null {
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const wantedId = String(sourceId || '').trim();
  if (!wantedId) return null;
  const exact = battlefield.find((permanent: any) => String(permanent?.id || '').trim() === wantedId);
  if (exact && detectLinkedExileEffect(exact?.card).hasLinkedExile) return exact;
  return null;
}

export function inferCommanderExileFollowup(params: {
  readonly state: any;
  readonly destPermanent: any;
  readonly sourceId?: string;
  readonly sourceName?: string;
  readonly sourceOracle?: string;
  readonly continuationSteps?: readonly unknown[];
}): CommanderExileFollowup {
  const dest = params.destPermanent;
  const ownerId = String(dest?.owner || dest?.controller || '').trim();
  const controllerId = String(dest?.controller || dest?.owner || ownerId).trim();
  const cardId = String(dest?.card?.id || dest?.id || '').trim();
  const sourceOracle = String(params.sourceOracle || '').trim();
  const sourceName = String(params.sourceName || '').trim();

  const flickerFromText = continuationLooksLikeImmediateFlicker(params.continuationSteps)
    || textLooksLikeImmediateFlicker(sourceOracle);
  if (flickerFromText && ownerId && cardId) {
    return {
      flickerReturnData: {
        ownerId,
        cardId,
        returnAt: 'immediate',
        sourceName: sourceName || undefined,
      },
    };
  }

  const linkedSource = findLinkedExileSourcePermanent(params.state, params.sourceId);
  const linkedFromText = textLooksLikeLinkedExile(sourceOracle)
    || detectLinkedExileEffect({
      name: sourceName,
      oracle_text: sourceOracle,
    }).hasLinkedExile;

  if (linkedSource || (linkedFromText && String(params.sourceId || '').trim())) {
    const source = linkedSource;
    const exilingPermanentId = String(source?.id || params.sourceId || '').trim();
    const exilingPermanentName = String(
      source?.card?.name || params.sourceName || 'Linked Exile Source',
    ).trim();
    if (exilingPermanentId) {
      return {
        linkedExileData: {
          exilingPermanentId,
          exilingPermanentName,
          originalOwner: ownerId,
          originalController: controllerId,
        },
      };
    }
  }

  return {};
}
