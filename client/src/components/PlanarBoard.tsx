import React from 'react';

import { getCardPreviewHandlers, getCardThumbnailUrl } from './CardPreviewLayer';
import { LandscapeCardImage } from './LandscapeCardImage';
import { isSidewaysVariantTypeLine } from '../utils/variantCardCatalogApi';
import { socket } from '../socket';

type VariantFace = {
  name?: string;
  type_line?: string;
  typeLine?: string;
  oracle_text?: string;
  image_uris?: { small?: string; normal?: string; large?: string };
  card_faces?: Array<{ image_uris?: { small?: string; normal?: string; large?: string } }>;
};

function faceImage(card: VariantFace | null | undefined): string | undefined {
  if (!card) return undefined;
  return (
    card.image_uris?.normal
    || card.image_uris?.large
    || card.image_uris?.small
    || card.card_faces?.[0]?.image_uris?.normal
    || card.card_faces?.[0]?.image_uris?.small
    || getCardThumbnailUrl(card as any)
  );
}

function typeLineOf(card: VariantFace | null | undefined): string {
  return String(card?.type_line || card?.typeLine || '');
}

function isMainPhase(step: unknown): boolean {
  const value = String(step || '').toUpperCase();
  return value === 'MAIN1' || value === 'MAIN2';
}

function rollOffer(view: any, you: string | undefined): { enabled: boolean; reason: string; cost: number } {
  const plane = view?.currentPlane || view?.activePlane;
  const deckCount = Number(view?.planarDeckCount || 0);
  if (!plane && deckCount <= 0) {
    return { enabled: false, reason: 'Import a deck that includes planes first.', cost: 0 };
  }
  if (!you || String(view?.turnPlayer || '') !== you) {
    return { enabled: false, reason: 'Only the active player rolls the planar die.', cost: 0 };
  }
  if (!isMainPhase(view?.step)) {
    return { enabled: false, reason: 'Roll the planar die during a main phase.', cost: 0 };
  }
  if (Array.isArray(view?.stack) && view.stack.length > 0) {
    return { enabled: false, reason: 'The stack must be empty.', cost: 0 };
  }
  const priority = view?.priorityPlayerId ?? view?.priority;
  if (priority != null && String(priority) !== you) {
    return { enabled: false, reason: 'You need priority to roll.', cost: 0 };
  }
  const taken = Math.max(0, Math.floor(Number(view?.planarDieSpecialActionsThisTurn?.[you]) || 0));
  return { enabled: true, reason: taken > 0 ? `Costs {${taken}} from your mana pool.` : 'The first roll each turn is free.', cost: taken };
}

function FaceCard({
  card,
  emptyLabel,
  height,
}: {
  card: VariantFace | null | undefined;
  emptyLabel: string;
  height: number;
}) {
  const image = faceImage(card);
  const sideways = isSidewaysVariantTypeLine(typeLineOf(card)) || !card;
  const name = String(card?.name || emptyLabel);
  return (
    <div
      {...(card ? getCardPreviewHandlers(card as any, { prefer: 'below' }) : {})}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, maxWidth: sideways ? 220 : 120 }}
    >
      {image && sideways ? (
        <LandscapeCardImage src={image} alt={name} height={height} />
      ) : image ? (
        <img src={image} alt={name} style={{ height, width: 'auto', borderRadius: 4, display: 'block' }} />
      ) : (
        <div
          style={{
            width: Math.round(height * (5 / 3.5)),
            height,
            borderRadius: 4,
            border: '1px dashed rgba(226, 232, 240, 0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 8,
            textAlign: 'center',
            color: '#cbd5e1',
            fontSize: 11,
            lineHeight: 1.3,
          }}
        >
          {emptyLabel}
        </div>
      )}
      {card?.name && (
        <div style={{ fontSize: 11, color: '#e2e8f0', textAlign: 'center', lineHeight: 1.25, maxWidth: 200 }}>
          {card.name}
        </div>
      )}
    </div>
  );
}

/**
 * Face-up plane (and scheme, when Archenemy is on) plus the planar die.
 * Hidden decks stay as counts; the cards themselves are not on the client.
 */
export function PlanarBoard({
  view,
  you,
  gameId,
}: {
  view?: any;
  you?: string;
  gameId?: string;
}) {
  const rules = view?.houseRules || {};
  const planechase = rules.enablePlanechase === true;
  const archenemy = rules.enableArchenemy === true;
  if (!view || (!planechase && !archenemy)) return null;

  const plane = (view.currentPlane || view.activePlane) as VariantFace | null | undefined;
  const deckCount = Number(view.planarDeckCount || 0);
  const schemes = Array.isArray(view.ongoingSchemes) && view.ongoingSchemes.length > 0
    ? view.ongoingSchemes
    : Array.isArray(view.activeSchemes) ? view.activeSchemes : [];
  const schemeCount = Number(view.schemeDeckCount || 0);
  const contributed = you && view.planarContributionCounts ? Number(view.planarContributionCounts[you] || 0) : 0;
  const offer = planechase ? rollOffer(view, you) : null;
  const lastRoll = view.lastPlanarDieRoll;

  return (
    <div
      style={{
        position: 'absolute',
        top: 8,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 30,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: '8px 10px',
        borderRadius: 10,
        background: 'rgba(2, 6, 23, 0.82)',
        border: '1px solid rgba(148, 163, 184, 0.35)',
        color: '#e2e8f0',
        pointerEvents: 'auto',
        maxWidth: 'calc(100% - 16px)',
      }}
    >
      {planechase && (
        <>
          <FaceCard
            card={plane}
            emptyLabel={deckCount > 0 ? 'Plane' : 'No planar deck'}
            height={96}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 148, fontSize: 12, lineHeight: 1.35 }}>
            <div style={{ fontWeight: 700, letterSpacing: 0.2 }}>Planar deck</div>
            <div style={{ color: '#cbd5e1' }}>
              {plane?.name
                ? `${plane.name} is face up. ${deckCount} card${deckCount === 1 ? '' : 's'} left in the deck.`
                : deckCount > 0
                  ? `${deckCount} card${deckCount === 1 ? '' : 's'} in the planar deck. No plane is face up yet.`
                  : 'Import a Doctor Who precon, or add planes in the deck builder. They are not part of the 100-card library.'}
            </div>
            {contributed > 0 && (
              <div style={{ color: '#94a3b8' }}>You contributed {contributed}.</div>
            )}
            {typeLineOf(plane) && (
              <div style={{ color: '#94a3b8' }}>{typeLineOf(plane)}</div>
            )}
            {lastRoll?.face && (
              <div style={{ color: '#fde68a' }}>Last roll: {String(lastRoll.face)}</div>
            )}
            <button
              type="button"
              disabled={!offer?.enabled || !gameId}
              title={offer?.reason || ''}
              onClick={() => {
                if (gameId) socket.emit('rollPlanarDie', { gameId });
              }}
              style={{
                alignSelf: 'flex-start',
                fontSize: 12,
                padding: '4px 8px',
                borderRadius: 6,
                border: '1px solid #38bdf8',
                background: offer?.enabled ? '#0369a1' : 'transparent',
                color: offer?.enabled ? '#f0f9ff' : '#94a3b8',
                cursor: offer?.enabled ? 'pointer' : 'not-allowed',
              }}
            >
              {offer && offer.cost > 0 ? `Roll planar die {${offer.cost}}` : 'Roll planar die'}
            </button>
          </div>
        </>
      )}
      {archenemy && (
        <FaceCard
          card={schemes[0]}
          emptyLabel={schemeCount > 0 ? `${schemeCount} in scheme deck` : 'No scheme deck'}
          height={120}
        />
      )}
    </div>
  );
}
