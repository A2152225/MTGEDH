import sys
from pathlib import Path
sys.path.insert(0, r'D:\Git\MTGEDH\_agent_scratch')
from safe_write import patch_once

patch_once(
    Path(r'D:\Git\MTGEDH\client\src\components\HandGallery.tsx'),
    """  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const galleryRef = useRef<HTMLDivElement>(null);
  const isTouch = useIsTouch();""",
    """  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [focusedCardId, setFocusedCardId] = useState<string | null>(null);
  const galleryRef = useRef<HTMLDivElement>(null);
  const isTouch = useIsTouch();""",
)

# Add onClick handler on card for touch focus + cast, and action bar under gallery
patch_once(
    Path(r'D:\Git\MTGEDH\client\src\components\HandGallery.tsx'),
    """            title={name}
            onDoubleClick={() => {
              if (!kc) return;
              if (onPlayLand && isLand(tl) && !cantPlayLand) {
                onPlayLand(kc.id);
              } else if (onCast && !isLand(tl)) {
                // Allow cast attempt for non-land cards
                // Server will validate priority and return appropriate error if needed
                onCast(kc.id);
              }
            }}
          >""",
    """            title={name}
            onClick={() => {
              if (!isTouch || !kc) return;
              setFocusedCardId(kc.id);
            }}
            onDoubleClick={() => {
              if (!kc) return;
              if (onPlayLand && isLand(tl) && !cantPlayLand) {
                onPlayLand(kc.id);
              } else if (onCast && !isLand(tl)) {
                // Allow cast attempt for non-land cards
                // Server will validate priority and return appropriate error if needed
                onCast(kc.id);
              }
            }}
          >""",
)

# Add focus ring on focused card via boxShadow merge - patch the style boxShadow section
patch_once(
    Path(r'D:\Git\MTGEDH\client\src\components\HandGallery.tsx'),
            """              boxShadow:
                dragIdx === i
                  ? '0 0 0 2px #2b6cb0'
                  : dragOver === i
                  ? '0 0 0 2px #38a169'
                  : isPlayable
                  ? getPlayableCardHighlight(appearanceSettings)
                  : 'none',
            }}""",
            """              boxShadow:
                dragIdx === i
                  ? '0 0 0 2px #2b6cb0'
                  : dragOver === i
                  ? '0 0 0 2px #38a169'
                  : focusedCardId && kc && focusedCardId === kc.id
                  ? '0 0 0 3px #fbbf24'
                  : isPlayable
                  ? getPlayableCardHighlight(appearanceSettings)
                  : 'none',
            }}""",
)

# Add touch action bar before closing gallery div
patch_once(
    Path(r'D:\Git\MTGEDH\client\src\components\HandGallery.tsx'),
    """      {visibleCards.length === 0 && !hidden && (
        <div style={{ color: '#777', fontSize: 12 }}>Empty hand</div>
      )}
    </div>
  );
}""",
    """      {visibleCards.length === 0 && !hidden && (
        <div style={{ color: '#777', fontSize: 12 }}>Empty hand</div>
      )}

      {isTouch && focusedCardId && (() => {
        const focused = visibleCards.find((c) => (c as any)?.id === focusedCardId) as KnownCardRef | undefined;
        if (!focused || (focused as any).faceDown) return null;
        const tl = getTypeLine(focused);
        const land = isLand(tl);
        const cantPlayLand = land && reasonCannotPlayLand ? reasonCannotPlayLand(focused) : null;
        const cantCast = !land && reasonCannotCast ? reasonCannotCast(focused) : null;
        const canPlayLand = land && !!onPlayLand && !cantPlayLand;
        const canCast = !land && !!onCast && !cantCast;
        if (!canPlayLand && !canCast && !cantPlayLand && !cantCast) return null;
        return (
          <div
            style={{
              flex: '1 0 100%',
              width: '100%',
              marginTop: 10,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ fontSize: 12, color: '#d1d5db', fontWeight: 600 }}>
              {focused.name || 'Selected card'}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {land ? (
                <button
                  type="button"
                  disabled={!canPlayLand}
                  onClick={() => canPlayLand && onPlayLand?.(focused.id)}
                  style={{
                    flex: '1 1 140px',
                    minHeight: 44,
                    borderRadius: 8,
                    border: '1px solid rgba(52,211,153,0.45)',
                    background: canPlayLand ? 'rgba(16,185,129,0.25)' : 'rgba(75,85,99,0.35)',
                    color: canPlayLand ? '#ecfdf5' : '#9ca3af',
                    fontWeight: 700,
                    cursor: canPlayLand ? 'pointer' : 'not-allowed',
                  }}
                  title={cantPlayLand || 'Play land'}
                >
                  {cantPlayLand ? `Play Land — ${cantPlayLand}` : 'Play Land'}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!canCast}
                  onClick={() => canCast && onCast?.(focused.id)}
                  style={{
                    flex: '1 1 140px',
                    minHeight: 44,
                    borderRadius: 8,
                    border: '1px solid rgba(96,165,250,0.5)',
                    background: canCast ? 'rgba(37,99,235,0.35)' : 'rgba(75,85,99,0.35)',
                    color: canCast ? '#eff6ff' : '#9ca3af',
                    fontWeight: 700,
                    cursor: canCast ? 'pointer' : 'not-allowed',
                  }}
                  title={cantCast || 'Cast spell'}
                >
                  {cantCast ? `Cast — ${cantCast}` : 'Cast'}
                </button>
              )}
              <button
                type="button"
                onClick={() => setFocusedCardId(null)}
                style={{
                  minHeight: 44,
                  minWidth: 72,
                  borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.16)',
                  background: 'rgba(255,255,255,0.06)',
                  color: '#e5e7eb',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Clear
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}""",
)

print('handgallery ok')