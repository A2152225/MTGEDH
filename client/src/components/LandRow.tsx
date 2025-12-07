import React, { useMemo, useState, useCallback } from 'react';
import type { BattlefieldPermanent, KnownCardRef } from '../../../shared/src';
import type { ImagePref } from './BattlefieldGrid';
import { showCardPreview, hideCardPreview } from './CardPreviewLayer';
import { CardContextMenu } from './CardContextMenu';
import { AbilitySelectionModal } from './AbilitySelectionModal';
import { parseActivatedAbilities, canActivateTapAbility, type ParsedActivatedAbility, type ActivationContext } from '../utils/activatedAbilityParser';

function canonicalLandKey(typeLine?: string, name?: string) {
  const tl = (typeLine || '').toLowerCase();
  if (/\bplains\b/.test(tl)) return 'plains';
  if (/\bisland\b/.test(tl)) return 'island';
  if (/\bswamp\b/.test(tl)) return 'swamp';
  if (/\bmountain\b/.test(tl)) return 'mountain';
  if (/\bforest\b/.test(tl)) return 'forest';
  if (/\bwastes\b/.test(tl)) return 'wastes';
  return (name || '').toLowerCase() || 'land';
}

/**
 * Parse numeric P/T from string like "2" or "*" -> number or undefined
 */
function parsePT(val?: string): number | undefined {
  if (!val) return undefined;
  const n = parseInt(val, 10);
  return isNaN(n) ? undefined : n;
}

/**
 * Get effective P/T for a permanent (base + counters + buffs)
 */
function getEffectivePT(perm: BattlefieldPermanent): {
  baseP?: number;
  baseT?: number;
  p?: number;
  t?: number;
} {
  const kc = perm.card as KnownCardRef;
  const baseP = typeof perm.basePower === 'number' ? perm.basePower : parsePT(kc?.power);
  const baseT = typeof perm.baseToughness === 'number' ? perm.baseToughness : parsePT(kc?.toughness);

  // If server provided effective stats (includes counters + continuous buffs), prefer them.
  const effP = (perm as any).effectivePower as number | undefined;
  const effT = (perm as any).effectiveToughness as number | undefined;

  if (typeof effP === 'number' && typeof effT === 'number') {
    return { baseP, baseT, p: effP, t: effT };
  }

  // Fallback: base + (+1/+1 -1/-1) counters only (client-side approximation).
  if (typeof baseP === 'number' && typeof baseT === 'number') {
    const plus = perm.counters?.['+1/+1'] ?? 0;
    const minus = perm.counters?.['-1/-1'] ?? 0;
    const delta = plus - minus;
    return { baseP, baseT, p: baseP + delta, t: baseT + delta };
  }

  return { baseP, baseT, p: undefined, t: undefined };
}

/**
 * Get badge colors based on P/T delta
 */
function ptBadgeColors(baseP?: number, baseT?: number, p?: number, t?: number): { bg: string; border: string } {
  if (typeof baseP === 'number' && typeof baseT === 'number' && typeof p === 'number' && typeof t === 'number') {
    const delta = (p - baseP) + (t - baseT);
    if (delta > 0) return { bg: 'rgba(56,161,105,0.85)', border: 'rgba(46,204,113,0.95)' }; // green
    if (delta < 0) return { bg: 'rgba(229,62,62,0.85)', border: 'rgba(245,101,101,0.95)' }; // red
  }
  return { bg: 'rgba(0,0,0,0.65)', border: 'rgba(255,255,255,0.25)' }; // neutral
}

export function LandRow(props: {
  lands: BattlefieldPermanent[];
  imagePref: ImagePref;
  tileWidth?: number;     // default 110
  overlapRatio?: number;  // consecutive same-type overlap (0..1), default 0.33 (33%)
  highlightTargets?: ReadonlySet<string>;
  selectedTargets?: ReadonlySet<string>;
  onCardClick?: (id: string) => void;
  onRemove?: (id: string) => void;
  onCounter?: (id: string, kind: string, delta: number) => void;
  // Context menu callbacks
  onTap?: (id: string) => void;
  onUntap?: (id: string) => void;
  onActivateAbility?: (permanentId: string, abilityId: string, ability?: ParsedActivatedAbility) => void;
  onSacrifice?: (id: string) => void;
  canActivate?: boolean;
  playerId?: string;
  // Game state for ability activation (for double-click feature)
  hasPriority?: boolean;
  isOwnTurn?: boolean;
  isMainPhase?: boolean;
  stackEmpty?: boolean;
}) {
  const {
    lands,
    imagePref,
    tileWidth = 110,
    overlapRatio = 0.33,
    highlightTargets,
    selectedTargets,
    onCardClick,
    onRemove,
    onCounter,
    onTap, onUntap, onActivateAbility, onSacrifice,
    canActivate = true, playerId,
    hasPriority = false,
    isOwnTurn = false,
    isMainPhase = false,
    stackEmpty = true,
  } = props;

  const items = useMemo(() => lands.map(p => {
    const kc = p.card as KnownCardRef;
    const { baseP, baseT, p: dispP, t: dispT } = getEffectivePT(p);
    const isCreature = (kc?.type_line || '').toLowerCase().includes('creature');
    const colors = ptBadgeColors(baseP, baseT, dispP, dispT);
    return {
      id: p.id,
      name: kc?.name || p.id,
      typeLine: kc?.type_line || '',
      img: kc?.image_uris?.[imagePref] || kc?.image_uris?.normal || kc?.image_uris?.small,
      tapped: !!p.tapped,
      counters: p.counters || {},
      key: canonicalLandKey(kc?.type_line, kc?.name),
      perm: p,
      isCreature,
      baseP,
      baseT,
      dispP,
      dispT,
      colors,
    };
  }), [lands, imagePref]);

  const [hovered, setHovered] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ permanent: BattlefieldPermanent; x: number; y: number } | null>(null);
  
  // State for ability selection modal (shown on double-click when multiple abilities exist)
  const [abilitySelectionModal, setAbilitySelectionModal] = useState<{
    permanent: BattlefieldPermanent;
    abilities: { ability: ParsedActivatedAbility; canActivate: boolean; reason?: string }[];
  } | null>(null);

  // Handle double-click on a land
  const handleDoubleClick = useCallback((perm: BattlefieldPermanent) => {
    if (!canActivate || !onActivateAbility || perm.controller !== playerId) return;

    const kc = perm.card as KnownCardRef;
    if (!kc) return;

    // Parse abilities from the card
    const abilities = parseActivatedAbilities(kc);
    if (abilities.length === 0) return;

    // Build activation context
    const context: ActivationContext = {
      isTapped: !!perm.tapped,
      hasSummoningSickness: false, // Lands don't have summoning sickness
      hasHaste: false,
      hasThousandYearElixirEffect: false,
      loyaltyCounters: undefined,
      controllerHasPriority: hasPriority,
      isMainPhase,
      isOwnTurn,
      stackEmpty,
    };

    // Annotate abilities with activation status
    const annotatedAbilities = abilities.map(ability => {
      const tapCheck = canActivateTapAbility(ability.requiresTap, context, ability.isManaAbility);
      let canActivateAbility = tapCheck.canActivate;
      let reason = tapCheck.reason;

      // Check sorcery timing restriction
      if (ability.timingRestriction === 'sorcery') {
        if (!context.isMainPhase || !context.isOwnTurn || !context.stackEmpty) {
          canActivateAbility = false;
          reason = 'Sorcery timing required';
        }
      }

      // Need priority for non-mana abilities
      if (!ability.isManaAbility && !context.controllerHasPriority) {
        canActivateAbility = false;
        reason = 'No priority';
      }

      return { ability, canActivate: canActivateAbility, reason };
    });

    // Filter to only activatable abilities for direct activation
    const activatableAbilities = annotatedAbilities.filter(a => a.canActivate);

    // If only one ability and it can be activated, activate it directly
    if (abilities.length === 1) {
      if (activatableAbilities.length === 1) {
        onActivateAbility(perm.id, activatableAbilities[0].ability.id, activatableAbilities[0].ability);
      }
      return;
    }

    // If multiple abilities, show the selection modal
    setAbilitySelectionModal({ permanent: perm, abilities: annotatedAbilities });
  }, [canActivate, onActivateAbility, playerId, hasPriority, isMainPhase, isOwnTurn, stackEmpty]);

  // Handle ability selection from modal
  const handleAbilitySelect = useCallback((ability: ParsedActivatedAbility) => {
    if (abilitySelectionModal && onActivateAbility) {
      onActivateAbility(abilitySelectionModal.permanent.id, ability.id, ability);
    }
    setAbilitySelectionModal(null);
  }, [abilitySelectionModal, onActivateAbility]);

  return (
    <>
    <div
      style={{ display: 'flex', alignItems: 'flex-start', gap: 8, overflowX: 'auto', paddingBottom: 4, overscrollBehavior: 'contain' as any }}
      data-no-zoom
      onWheel={(e) => e.stopPropagation()}
    >
      {items.map((it, idx) => {
        const prev = items[idx - 1];
        const sameTypeAsPrev = prev && prev.key === it.key;
        const overlapPx = sameTypeAsPrev ? Math.floor(tileWidth * overlapRatio) : 0;

        const isHighlight = highlightTargets?.has(it.id) ?? false;
        const isSelected = selectedTargets?.has(it.id) ?? false;
        const isHovered = hovered === it.id;

        const baseBorder = isSelected ? '#2b6cb0' : isHighlight ? '#38a169' : '#2b2b2b';
        const borderColor = isHovered && isHighlight && !isSelected ? '#2ecc71' : baseBorder;
        const boxShadow = isSelected
          ? '0 0 0 2px rgba(43,108,176,0.6)'
          : isHighlight
            ? '0 0 0 2px rgba(56,161,105,0.45)'
            : 'none';

        return (
          <div
            key={it.id}
            onMouseEnter={(e) => { setHovered(it.id); showCardPreview(e.currentTarget as HTMLElement, (lands[idx].card as any), { prefer: 'above', anchorPadding: 0 }); }}
            onMouseLeave={(e) => { setHovered(prev => prev === it.id ? null : prev); hideCardPreview(e.currentTarget as HTMLElement); }}
            onClick={onCardClick ? () => onCardClick(it.id) : undefined}
            onDoubleClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleDoubleClick(it.perm);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setContextMenu({ permanent: it.perm, x: e.clientX, y: e.clientY });
            }}
            style={{
              position: 'relative',
              width: tileWidth,
              aspectRatio: '0.72',
              overflow: 'hidden',
              border: `2px solid ${borderColor}`,
              borderRadius: 6,
              background: '#0f0f0f',
              transform: it.tapped ? 'rotate(14deg)' : 'none',
              marginLeft: overlapPx ? -overlapPx : undefined,
              boxShadow,
              cursor: onCardClick ? 'pointer' : 'default'
            }}
            title={it.name + (it.tapped ? ' (tapped)' : '')}
          >
            {it.img ? (
              <img src={it.img} alt={it.name} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#eee', fontSize: 12, padding: 8 }}>
                {it.name}
              </div>
            )}
            <div style={{
              position: 'absolute', left: 0, right: 0, bottom: 0,
              background: 'linear-gradient(transparent, rgba(0,0,0,0.6))',
              color: '#fff', fontSize: 12, padding: '6px 8px',
              borderBottomLeftRadius: 6, borderBottomRightRadius: 6
            }}>
              <div title={it.name} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.name}</div>
            </div>

            {/* Tapped badge */}
            {it.tapped && (
              <div style={{
                position: 'absolute',
                top: 6,
                left: 6,
                background: 'rgba(0,0,0,0.6)',
                color: '#fff',
                fontSize: 10,
                padding: '2px 6px',
                borderRadius: 4
              }}>
                Tapped
              </div>
            )}

            {/* P/T overlay for creatures with color-coded delta vs base */}
            {it.isCreature && typeof it.dispP === 'number' && typeof it.dispT === 'number' && (
              <div style={{
                position: 'absolute',
                right: 6,
                bottom: 26,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
                gap: 2
              }}>
                <div style={{
                  padding: '2px 6px',
                  fontSize: 12,
                  fontWeight: 700,
                  color: '#fff',
                  background: it.colors.bg,
                  border: `1px solid ${it.colors.border}`,
                  borderRadius: 6
                }}>
                  {it.dispP}/{it.dispT}
                </div>
                {(typeof it.baseP === 'number' && typeof it.baseT === 'number') && (
                  <div style={{ fontSize: 10, color: '#ddd', opacity: 0.9 }}>
                    base {it.baseP}/{it.baseT}
                  </div>
                )}
              </div>
            )}

            {/* Controls only when hovered */}
            {isHovered && (onCounter || onRemove) && (
              <div style={{ position: 'absolute', top: 6, right: 6, display: 'flex', gap: 4 }}>
                {onCounter && (<>
                  <button onClick={(e) => { e.stopPropagation(); onCounter!(it.id, '+1/+1', +1); }} title="+1/+1 +1">+1</button>
                  <button onClick={(e) => { e.stopPropagation(); onCounter!(it.id, '+1/+1', -1); }} title="+1/+1 -1">-1</button>
                </>)}
                {onRemove && <button onClick={(e) => { e.stopPropagation(); onRemove!(it.id); }} title="Remove">✕</button>}
              </div>
            )}
          </div>
        );
      })}
    </div>
    
    {/* Context Menu */}
    {contextMenu && (
      <CardContextMenu
        permanent={contextMenu.permanent}
        x={contextMenu.x}
        y={contextMenu.y}
        onClose={() => setContextMenu(null)}
        onTap={onTap}
        onUntap={onUntap}
        onActivateAbility={onActivateAbility}
        onAddCounter={onCounter}
        onSacrifice={onSacrifice}
        onRemove={onRemove}
        canActivate={canActivate}
        playerId={playerId}
      />
    )}

    {/* Ability Selection Modal (for double-click with multiple abilities) */}
    {abilitySelectionModal && (
      <AbilitySelectionModal
        open={true}
        cardName={(abilitySelectionModal.permanent.card as KnownCardRef)?.name || 'Unknown'}
        cardImageUrl={(abilitySelectionModal.permanent.card as KnownCardRef)?.image_uris?.normal || 
                     (abilitySelectionModal.permanent.card as KnownCardRef)?.image_uris?.small}
        abilities={abilitySelectionModal.abilities}
        onSelect={handleAbilitySelect}
        onCancel={() => setAbilitySelectionModal(null)}
      />
    )}
    </>
  );
}