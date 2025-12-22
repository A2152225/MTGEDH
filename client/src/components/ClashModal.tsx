import React from 'react';
import type { KnownCardRef } from '../../../shared/src';
import type { ImagePref } from './BattlefieldGrid';
import { showCardPreview, hideCardPreview } from './CardPreviewLayer';

export type ClashCard = Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris' | 'mana_cost' | 'cmc'>;

export function ClashModal(props: {
  revealedCard: ClashCard;
  imagePref: ImagePref;
  sourceName: string;
  opponentName?: string;
  onConfirm: (putOnBottom: boolean) => void;
}) {
  const { revealedCard, imagePref, sourceName, opponentName, onConfirm } = props;
  
  const img = revealedCard.image_uris?.[imagePref] || revealedCard.image_uris?.normal || revealedCard.image_uris?.small;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    }}>
      <div style={{ background: '#fff', borderRadius: 8, width: 500, maxWidth: '95vw', padding: 20 }}>
        <h3 style={{ margin: '0 0 12px 0' }}>
          Clash{opponentName ? ` with ${opponentName}` : ''} ({sourceName})
        </h3>
        
        <div style={{ marginBottom: 16 }}>
          <p style={{ margin: '0 0 12px 0', fontSize: 14 }}>
            You revealed: <strong>{revealedCard.name}</strong>
            {revealedCard.cmc !== undefined && (
              <span style={{ marginLeft: 8, color: '#666' }}>
                (MV: {revealedCard.cmc})
              </span>
            )}
          </p>
          
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
            <div
              onMouseEnter={(e) => showCardPreview(e.currentTarget as HTMLElement, revealedCard as any, { prefer: 'above', anchorPadding: 0 })}
              onMouseLeave={(e) => hideCardPreview(e.currentTarget as HTMLElement)}
              style={{ 
                width: 200, 
                height: 280, 
                border: '2px solid #333', 
                borderRadius: 8, 
                overflow: 'hidden',
                background: '#111'
              }}
            >
              {img ? (
                <img src={img} alt={revealedCard.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#eee', fontSize: 14, padding: 12, textAlign: 'center' }}>
                  {revealedCard.name}
                </div>
              )}
            </div>
          </div>
          
          <p style={{ margin: 0, fontSize: 13, color: '#666', textAlign: 'center' }}>
            Do you want to put this card on the bottom of your library?
          </p>
        </div>
        
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <button 
            onClick={() => onConfirm(false)}
            style={{ 
              padding: '10px 20px', 
              fontSize: 14, 
              background: '#4CAF50', 
              color: 'white', 
              border: 'none', 
              borderRadius: 6,
              cursor: 'pointer'
            }}
          >
            Keep on Top
          </button>
          <button 
            onClick={() => onConfirm(true)}
            style={{ 
              padding: '10px 20px', 
              fontSize: 14, 
              background: '#f44336', 
              color: 'white', 
              border: 'none', 
              borderRadius: 6,
              cursor: 'pointer'
            }}
          >
            Put on Bottom
          </button>
        </div>
      </div>
    </div>
  );
}

export default ClashModal;
