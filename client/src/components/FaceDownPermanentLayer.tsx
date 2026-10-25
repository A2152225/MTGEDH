// client/src/components/FaceDownPermanentLayer.tsx
// Face-down permanents (morph / megamorph / disguise / manifest): a card back with the 2/2
// stub for everyone; the controller also gets a Peek (hover preview of the real card via the
// shared CardPreviewLayer) and a "Turn face up (cost)" button, plus the reveal-card picker
// when the server asks which card to reveal.
// Public entry symbols: FaceDownPermanentLayer, FaceDownRevealPicker.

import React, { useEffect, useState } from 'react';
import { showCardPreview, hideCardPreview } from './CardPreviewLayer';
import {
  answerCostPrompt,
  clearRevealPrompt,
  describeTurnFaceUpCostLabel,
  getPendingRevealPrompt,
  isFaceDownPermanent,
  lookupKnownCard,
  requestTurnFaceUp,
  subscribeRevealPrompt,
  type TurnFaceUpRevealPrompt,
} from '../utils/faceDownUi';

const KIND_LABEL: Record<string, string> = { morph: 'Morph', megamorph: 'Megamorph', disguise: 'Disguise', manifest: 'Manifest', cloak: 'Cloak' };

export function FaceDownPermanentLayer({ perm, viewerId, scale = 1, compact = false }: { perm: any; viewerId?: string; scale?: number; compact?: boolean }) {
  if (!isFaceDownPermanent(perm) || perm.revealedAtGameEnd) return null;
  const isController = !!viewerId && String(perm.controller || '') === String(viewerId);
  const real = isController ? perm.faceUpCard : undefined;
  const kind = String(perm.faceDownType || '');
  const disguise = kind === 'disguise' || /ward/i.test(String(perm.card?.oracle_text || ''));
  const costLabel = describeTurnFaceUpCostLabel(perm.turnFaceUpCost);
  const fs = Math.max(compact ? 6 : 9, Math.round(11 * scale));
  return (
    <>
      <div
        data-testid="face-down-back"
        style={{
          position: 'absolute', inset: 0, borderRadius: 5, overflow: 'hidden', pointerEvents: 'none',
          background: 'repeating-linear-gradient(45deg, #3b2a1a 0 6px, #4a3522 6px 12px)',
          boxShadow: 'inset 0 0 0 3px #1f150c', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', color: '#f5e6c8', textAlign: 'center',
        }}
      >
        {!compact && <div style={{ fontSize: fs, fontWeight: 700, textShadow: '0 1px 2px #000' }}>
          {real?.name ? real.name : (perm.card?.displayName || 'Face-down Creature')}
        </div>}
        <div style={{ fontSize: Math.max(8, fs - 2), opacity: 0.85 }}>
          {KIND_LABEL[kind] || 'Face down'}{disguise ? ' \u00b7 Ward {2}' : ''}
        </div>
        {!real && <div style={{ fontSize: fs + 4, fontWeight: 800, marginTop: 4 }}>2/2</div>}
      </div>
      {isController && !compact && (
        <div style={{ position: 'absolute', left: 4, right: 4, bottom: Math.round(26 * scale), display: 'flex', flexDirection: 'column', gap: 3, zIndex: 6 }}>
          {real && (
            <span
              title="Only you can see this card"
              onMouseEnter={(e) => showCardPreview(e.currentTarget as HTMLElement, real, { prefer: 'above', anchorPadding: 0 })}
              onMouseLeave={(e) => hideCardPreview(e.currentTarget as HTMLElement)}
              style={{ alignSelf: 'flex-start', fontSize: Math.max(8, fs - 2), padding: '1px 6px', borderRadius: 4, background: 'rgba(15,23,42,0.85)', color: '#e2e8f0', border: '1px solid #475569', cursor: 'help' }}
            >
              Peek
            </span>
          )}
          {perm.canTurnFaceUp && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); requestTurnFaceUp(String(perm.id)); }}
              onPointerDown={(e) => e.stopPropagation()}
              style={{ fontSize: Math.max(8, fs - 1), padding: '2px 4px', borderRadius: 4, border: '1px solid #3b82f6', background: 'rgba(30,64,175,0.92)', color: '#fff', cursor: 'pointer' }}
            >
              Turn face up{costLabel ? ` (${costLabel})` : ''}
            </button>
          )}
        </div>
      )}
      {isController && !compact && <FaceDownRevealPicker permanentId={String(perm.id)} />}
    </>
  );
}

/** Shown when the server asks which card to reveal for this permanent's turn-face-up cost. */
export function FaceDownRevealPicker({ permanentId }: { permanentId: string }) {
  const [prompt, setPrompt] = useState<TurnFaceUpRevealPrompt | null>(() => getPendingRevealPrompt());
  const [picked, setPicked] = useState<string[]>([]);
  useEffect(() => subscribeRevealPrompt((p) => { setPrompt(p); setPicked([]); }), []);
  if (!prompt || prompt.permanentId !== permanentId) return null;
  const need = Math.max(1, prompt.count || 1);
  const single = need === 1;
  const toggle = (id: string) => {
    if (single) { answerCostPrompt([id]); return; }
    setPicked((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : (cur.length < need ? [...cur, id] : cur));
  };
  return (
    <div
      role="dialog"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div style={{ background: '#1a1a2e', border: '1px solid #3b82f6', borderRadius: 8, padding: 16, minWidth: 320, maxWidth: 560, color: '#fff' }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Turn face up</div>
        <div style={{ fontSize: 13, color: '#cbd5e1', marginBottom: 10 }}>
          {prompt.description || `Reveal a ${prompt.colorWord || 'matching'} card from your hand to turn this permanent face up.`}
          {!single && ` (choose ${need}; ${picked.length} selected)`}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {prompt.candidateCardIds.map((id) => {
            const card = lookupKnownCard(id);
            const img = card?.image_uris?.small || card?.image_uris?.normal;
            return (
              <button
                key={id}
                type="button"
                onClick={() => toggle(id)}
                onMouseEnter={(e) => card && showCardPreview(e.currentTarget as HTMLElement, card, { prefer: 'above', anchorPadding: 4 })}
                onMouseLeave={(e) => hideCardPreview(e.currentTarget as HTMLElement)}
                style={{ width: 96, padding: 4, borderRadius: 6, border: picked.includes(id) ? '2px solid #22c55e' : '1px solid #475569', background: '#0f172a', color: '#e2e8f0', cursor: 'pointer', fontSize: 11 }}
              >
                {img ? <img src={img} alt={card?.name || id} style={{ width: '100%', borderRadius: 4 }} /> : null}
                <div>{card?.name || (card?.isPermanent ? 'Permanent' : 'Card')}</div>
              </button>
            );
          })}
        </div>
        <div style={{ textAlign: 'right', marginTop: 12, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {!single && (
            <button type="button" disabled={picked.length !== need} onClick={() => answerCostPrompt(picked)} style={{ padding: '4px 12px', borderRadius: 4, border: '1px solid #3b82f6', background: picked.length === need ? '#1d4ed8' : '#334155', color: '#fff', cursor: picked.length === need ? 'pointer' : 'not-allowed' }}>
              Confirm
            </button>
          )}
          <button type="button" onClick={() => clearRevealPrompt()} style={{ padding: '4px 12px', borderRadius: 4, border: '1px solid #475569', background: 'transparent', color: '#cbd5e1', cursor: 'pointer' }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
