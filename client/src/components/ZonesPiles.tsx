import React from "react";
import type { PlayerZones, CommanderInfo, KnownCardRef } from "../../../shared/src";
import { showCardPreview, hideCardPreview } from "./CardPreviewLayer";

/**
 * ZonesPiles: shows library/graveyard/exile and command zone slots.
 * Preserve original behavior but guard missing/undefined fields.
 */

const SAFE_DEFAULT_ZONES: PlayerZones = {
  hand: [],
  handCount: 0,
  library: [],
  libraryCount: 0,
  graveyard: [],
  graveyardCount: 0,
  exile: [],
};

export function ZonesPiles(props: {
  zones?: PlayerZones | null;
  commander?: CommanderInfo;
  isCommanderFormat?: boolean;
  showHandCount?: number;
  hideHandDetails?: boolean;
  canCastCommander?: boolean;
  onCastCommander?: (commanderId: string, commanderName: string, manaCost?: string, tax?: number) => void;
  onViewGraveyard?: () => void;
  onViewExile?: () => void;
}) {
  const { zones = SAFE_DEFAULT_ZONES, commander, isCommanderFormat, showHandCount = 0, hideHandDetails, canCastCommander, onCastCommander, onViewGraveyard, onViewExile } = props;

  // Defensive local arrays
  const libArr = Array.isArray((zones as any).library) ? ((zones as any).library as KnownCardRef[]) : [];
  const grArr = Array.isArray(zones.graveyard) ? (zones.graveyard as KnownCardRef[]) : [];
  const exArr = Array.isArray((zones as any).exile) ? ((zones as any).exile as KnownCardRef[]) : [];

  const cmdNames = (isCommanderFormat ? (commander as any)?.commanderNames : undefined) as string[] | undefined;
  const cmdCards = (isCommanderFormat ? (commander as any)?.commanderCards : undefined) as Array<KnownCardRef & { mana_cost?: string }> | undefined;
  const cmdIds = (isCommanderFormat ? (commander as any)?.commanderIds : undefined) as string[] | undefined;
  const cmdTaxById = (isCommanderFormat ? (commander as any)?.taxById : undefined) as Record<string, number> | undefined;
  // Which commanders are currently in the command zone (not on stack/battlefield)
  const inCommandZone = (isCommanderFormat ? (commander as any)?.inCommandZone : undefined) as string[] | undefined;

  function renderPile(label: string, count: number, topCard?: KnownCardRef, hideTopCard?: boolean, onClick?: () => void, onDoubleClick?: () => void) {
    const name = topCard?.name || "";
    // prefer art_crop -> normal -> small
    const img = topCard?.image_uris?.art_crop || topCard?.image_uris?.normal || topCard?.image_uris?.small || null;
    
    // For library, don't show the card image/name - keep it hidden
    const showCardPreviewOnHover = !hideTopCard && topCard;
    const displayImage = !hideTopCard && img;
    const displayName = !hideTopCard && name;
    const isClickable = (!!onClick || !!onDoubleClick) && count > 0;
    
    const body = (
      <div
        style={{
          position: "relative",
          width: 72,
          height: 100,
          borderRadius: 6,
          overflow: "hidden",
          border: isClickable ? "1px solid rgba(59, 130, 246, 0.5)" : "1px solid rgba(255,255,255,0.12)",
          background: "#0f0f0f",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#ddd",
          fontSize: 11,
          padding: 4,
          textAlign: "center",
          cursor: isClickable ? "pointer" : "default",
          transition: "border-color 0.15s",
        }}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
      >
        {displayImage && img ? (
          <img
            src={img}
            alt={name}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.78 }}
          />
        ) : null}
        <span style={{ position: "relative", zIndex: 1 }}>{displayName || label}</span>
        {isClickable && (
          <div
            style={{
              position: "absolute",
              bottom: 4,
              right: 4,
              backgroundColor: "rgba(59, 130, 246, 0.9)",
              color: "#fff",
              fontSize: 9,
              padding: "2px 4px",
              borderRadius: 3,
            }}
            aria-label={onDoubleClick ? 'Double-click to view' : 'Click to view'}
          >
            {onDoubleClick ? 'Dbl-Click' : 'Click'}
          </div>
        )}
      </div>
    );

    return (
      <div
        key={label}
        title={isClickable ? `${onDoubleClick ? 'Double-click' : 'Click'} to view ${label}` : (topCard && !hideTopCard ? topCard.name : `${label} (${count})`)}
        style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 92 }}
        onMouseEnter={(e) => {
          if (showCardPreviewOnHover) showCardPreview(e.currentTarget as HTMLElement, topCard, { prefer: "above", anchorPadding: 0 });
        }}
        onMouseLeave={(e) => {
          if (showCardPreviewOnHover) hideCardPreview(e.currentTarget as HTMLElement);
        }}
      >
        {body}
        <div style={{ fontSize: 11, color: "#ddd" }}>
          {label}: {count}
        </div>
      </div>
    );
  }

  const CommandSlots = () => {
    const slotsCount = Math.max(1, Math.min(2, (cmdNames?.length || cmdIds?.length || 0) || 2));
    const slots = Array.from({ length: slotsCount }).map((_, i) => {
      const id = cmdIds?.[i];
      const card = cmdCards?.[i];
      return {
        name: cmdNames?.[i] || "Commander",
        card,
        id,
        manaCost: card?.mana_cost,
        tax: id ? (cmdTaxById?.[id] ?? 0) : 0,
        // Check if commander is in command zone (can be cast)
        isInCZ: id ? (inCommandZone ? inCommandZone.includes(id) : true) : false,
      };
    });

    return (
      <div title="Command Zone" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 92 }}>
        <div style={{ display: "flex", gap: 8 }}>
          {slots.map((slot, i) => {
            const name = slot.name || "Commander";
            const previewCard = slot.card || cmdCards?.[i];
            const hasCard = !!previewCard || !!slot.id || !!name;
            const commanderId = slot.id || previewCard?.id || name;
            // prefer art_crop -> normal -> small for commander tile too
            const img = previewCard?.image_uris?.art_crop || previewCard?.image_uris?.normal || previewCard?.image_uris?.small || null;
            const canCast = canCastCommander && hasCard && slot.isInCZ && onCastCommander;

            return (
              <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                <div
                  style={{
                    width: 72,
                    height: 100,
                    borderRadius: 6,
                    border: hasCard ? (slot.isInCZ ? "2px solid rgba(255,255,255,0.45)" : "2px solid rgba(100,100,100,0.4)") : "2px dashed rgba(255,255,255,0.25)",
                    background: "#000",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    position: "relative",
                    color: "#ddd",
                    fontSize: 12,
                    padding: 4,
                    textAlign: "center",
                    cursor: previewCard ? "pointer" : "default",
                    overflow: "hidden",
                    opacity: slot.isInCZ ? 1 : 0.5,
                  }}
                  onMouseEnter={(e) => {
                    if (previewCard) showCardPreview(e.currentTarget as HTMLElement, previewCard, { prefer: "above", anchorPadding: 0 });
                  }}
                  onMouseLeave={(e) => {
                    if (previewCard) hideCardPreview(e.currentTarget as HTMLElement);
                  }}
                >
                  {img ? (
                    <img
                      src={img}
                      alt={previewCard?.name || name}
                      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.82 }}
                    />
                  ) : null}
                  <span style={{ position: "relative", zIndex: 1, padding: "0 4px", textAlign: "center", fontSize: 11 }}>
                    {name}
                    {!slot.isInCZ && <div style={{ fontSize: 9, opacity: 0.7 }}>(not in CZ)</div>}
                  </span>
                </div>

                {/* Show tax and mana cost info */}
                {slot.tax > 0 && (
                  <div style={{ fontSize: 10, color: '#f59e0b' }}>Tax: {slot.tax}</div>
                )}
                
                {canCast ? (
                  <div style={{ display: "inline-flex", gap: 6 }}>
                    <button 
                      onClick={() => onCastCommander(commanderId, name, slot.manaCost, slot.tax)} 
                      title={`Cast ${name}${slot.manaCost ? ` (${slot.manaCost})` : ''}${slot.tax > 0 ? ` +${slot.tax} tax` : ''}`}
                    >
                      Cast
                    </button>
                  </div>
                ) : canCastCommander && hasCard && !slot.isInCZ ? (
                  <div style={{ fontSize: 10, color: '#999' }}>Not in CZ</div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // top-of-library to show in pile
  const libraryTop = libArr.length > 0 ? (libArr[0] as KnownCardRef) : undefined;
  const graveTop = grArr.length > 0 ? (grArr[grArr.length - 1] as KnownCardRef) : undefined;
  const exileTop = exArr.length > 0 ? (exArr[exArr.length - 1] as KnownCardRef) : undefined;

  return (
    <div style={{ display: "flex", flexDirection: "row", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
      {/* Command zone now rendered before Library for expected layout */}
      {isCommanderFormat && commander ? <CommandSlots /> : null}
      {renderPile("Library", (zones.libraryCount ?? libArr.length ?? 0), libraryTop, true /* hideTopCard */)}
      {/* Graveyard supports both click and double-click - double-click opens the full graveyard modal */}
      {renderPile("Graveyard", (zones.graveyardCount ?? grArr.length ?? 0), graveTop, false, undefined, onViewGraveyard)}
      {renderPile("Exile", ((zones as any).exile?.length ?? exArr.length ?? 0), exileTop, false, undefined, onViewExile)}
    </div>
  );
}

export default ZonesPiles;