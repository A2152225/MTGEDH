// PermanentRulesStatusBadges.tsx
// Small status chips on a battlefield tile, styled like the ability badges in FreeFieldPermanentOverlays.
// Reads server-computed `rulesStatus` (view.ts -> viewPermanentRulesStatus.ts) plus plain permanent
// flags: abilities removed (Humility / Turn to Frog), Arrest-style activation locks, stolen control and
// its duration, Opalescence-style added types, Solved Cases, soulbond pairs and saddled Mounts.
// Public entry symbols: PermanentRulesStatusBadges, getPermanentRulesStatusChips, isActivationFullyLocked.

import React from 'react';

export interface PermanentRulesStatusView {
  abilitiesLost?: boolean;
  activationLocked?: { sourceName?: string; manaAbilitiesAllowed: boolean };
  tapAbilitiesLocked?: boolean;
  control?: { owner: string; controller: string; duration: 'end_of_turn' | 'indefinite' };
  addedTypes?: string[];
  typeOverride?: { typeLine: string; colorless: boolean; isCreature: boolean; sourceName?: string };
  animatedByAttachment?: boolean;
  conditionalPtBonuses?: Array<{ sourceName: string; power: number; toughness: number; active: boolean; condition?: string; otherwise?: boolean }>;
  /** Server P/T provenance lines (Otherwise halves, counter-scaled bonuses, devotion / graveyard bases). */
  ptBreakdown?: Array<{ kind: string; text: string; active?: boolean }>;
  copyOf?: { name: string; typeLine: string; power?: string; toughness?: string; originalName?: string; additions?: string[] };
  effectiveLandTypeLine?: string;
  conditionalStatics?: Array<{ sourceName: string; text: string; active: boolean }>;
  grantedCrew?: { value: number; sourceName: string };
}

const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

const VARIABLE_KINDS = new Set(['devotion', 'graveyard']);

/** P/T tooltip "Variable:" lines: devotion and graveyard-count bases (Renata, the goyfs). */
export function variablePtLines(perm: any): string[] {
  const list = (perm?.rulesStatus as PermanentRulesStatusView | undefined)?.ptBreakdown;
  return (Array.isArray(list) ? list : []).filter((l) => VARIABLE_KINDS.has(String(l?.kind))).map((l) => String(l?.text || '')).filter(Boolean);
}

/** P/T tooltip lines for conditional attached bonuses (Black Scarab, Twisted Embrace). */
export function conditionalPtBonusLines(perm: any): string[] {
  const rs = perm?.rulesStatus as PermanentRulesStatusView | undefined;
  const extra = (Array.isArray(rs?.ptBreakdown) ? rs!.ptBreakdown : []).filter((l) => !VARIABLE_KINDS.has(String(l?.kind))).map((l) => String(l?.text || '')).filter(Boolean);
  const list = rs?.conditionalPtBonuses;
  if (!Array.isArray(list)) return extra;
  return [...list.map((b) => {
    const cond = b.condition ? (b.otherwise ? ` otherwise (unless ${b.condition})` : ` while ${b.condition}`) : (b.otherwise ? ' otherwise' : '');
    return `${b.sourceName}: ${signed(b.power)}/${signed(b.toughness)}${cond} ${b.active ? '(active)' : '(inactive)'}`;
  }), ...extra];
}

/** Printed ability lines struck through (U+0336) for a host that lost them (tooltip text). */
export function struckAbilityLines(perm: any): string[] {
  const text = String(perm?.card?.oracle_text || '').trim();
  if (!text) return [];
  return text.split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l) => Array.from(l).map((ch) => ch + '\u0336').join(''));
}

/** Displayed type line: a type-setting override (Imprisoned in the Moon) replaces the printed one. */
export function displayTypeLine(perm: any, printed?: string): string {
  const o = (perm?.rulesStatus as PermanentRulesStatusView | undefined)?.typeOverride;
  const rs = perm?.rulesStatus as PermanentRulesStatusView | undefined;
  return o?.typeLine || rs?.effectiveLandTypeLine || rs?.copyOf?.typeLine || String(printed ?? perm?.card?.type_line ?? '');
}

export interface RulesStatusChip { key: string; label: string; title: string; background: string }

type Named = { id: string; name?: string };

function nameOf(players: readonly Named[] | undefined, id: string): string {
  return players?.find((p) => p?.id === id)?.name || id;
}

/** True when no activated ability on this permanent may be activated (lock without a mana exception). */
/** Locked except for mana abilities: only mana ability buttons should show. */
export function isActivationManaOnly(perm: any): boolean {
  const lock = (perm?.rulesStatus as PermanentRulesStatusView | undefined)?.activationLocked;
  return !!lock && !!lock.manaAbilitiesAllowed;
}

export function isActivationFullyLocked(perm: any): boolean {
  const lock = (perm?.rulesStatus as PermanentRulesStatusView | undefined)?.activationLocked;
  return !!lock && !lock.manaAbilitiesAllowed;
}

/** A temporary effect lets it attack as though it didn't have defender. */
export function hasAttackDespiteDefender(perm: any): boolean {
  const temps = Array.isArray(perm?.temporaryEffects) ? perm.temporaryEffects : [];
  return temps.some((e: any) => /didn['\u2019]t have defender/i.test(String(e?.description || e?.effect || '')));
}

export function getPermanentRulesStatusChips(perm: any, players?: readonly Named[], allPerms?: readonly any[]): RulesStatusChip[] {
  const chips: RulesStatusChip[] = [];
  if (!perm) return chips;
  const rs = (perm.rulesStatus || {}) as PermanentRulesStatusView;
  if (rs.abilitiesLost) {
    chips.push({ key: 'lost', label: '\u2205 No abilities', title: 'This permanent has lost all abilities (e.g. Humility). Abilities granted to it later still work.', background: 'rgba(107,114,128,0.95)' });
  }
  if (rs.activationLocked) {
    const src = rs.activationLocked.sourceName ? ` by ${rs.activationLocked.sourceName}` : '';
    const tail = rs.activationLocked.manaAbilitiesAllowed ? ' Mana abilities can still be activated.' : '';
    chips.push({ key: 'lock', label: '\u{1F512} Locked', title: `Activated abilities can't be activated (locked${src}).${tail}`, background: 'rgba(185,28,28,0.95)' });
  } else if (rs.tapAbilitiesLocked) {
    chips.push({ key: 'taplock', label: '\u{1F512} {T}', title: "Abilities with {T} in their cost can't be activated.", background: 'rgba(185,28,28,0.95)' });
  }
  if (rs.control) {
    const until = rs.control.duration === 'end_of_turn' ? 'until end of turn' : 'indefinitely';
    chips.push({
      key: 'control',
      label: rs.control.duration === 'end_of_turn' ? '\u21C4 Stolen (EOT)' : '\u21C4 Stolen',
      title: `Controlled by ${nameOf(players, rs.control.controller)} ${until}. Owner: ${nameOf(players, rs.control.owner)}.`,
      background: 'rgba(147,51,234,0.95)',
    });
  }
  if (rs.addedTypes && rs.addedTypes.length > 0) {
    const types = rs.addedTypes.join(' ');
    chips.push({ key: 'types', label: `+${types}`, title: `Also a ${types} (added by a type-changing effect such as Opalescence).`, background: 'rgba(37,99,235,0.95)' });
  }
  if (rs.typeOverride) {
    const src = rs.typeOverride.sourceName ? ` by ${rs.typeOverride.sourceName}` : '';
    const o = rs.typeOverride;
    const col = o.colorless ? ', colorless' : '';
    const pt = o.isCreature && typeof perm.effectivePower === 'number' && typeof perm.effectiveToughness === 'number' ? ` ${perm.effectivePower}/${perm.effectiveToughness}` : '';
    const struck = rs.abilitiesLost ? struckAbilityLines(perm) : [];
    const lost = struck.length ? `\nAbilities removed:\n${struck.join('\n')}` : '';
    chips.push({ key: 'typeset', label: `\u21BB ${o.typeLine}${pt}${o.colorless ? ' \u25C7' : ''}`, title: `Type set${src}: it is now ${o.typeLine}${pt}${col}${o.isCreature ? '' : ' (not a creature; no power/toughness)'}.${lost}`, background: 'rgba(71,85,105,0.95)' });
  }
  if (rs.copyOf) {
    const c = rs.copyOf;
    const pt = c.power !== undefined && c.toughness !== undefined ? ` ${c.power}/${c.toughness}` : '';
    const was = c.originalName ? ` (${c.originalName})` : '';
    const ex = c.additions?.length ? ` Except: ${c.additions.join(', ')}.` : '';
    chips.push({ key: 'copy', label: `\u29C9 ${c.name}`, title: `Copy of ${c.name}${was}: ${c.typeLine}${pt}.${ex}`, background: 'rgba(8,145,178,0.95)' });
  }
  if (rs.effectiveLandTypeLine) {
    const sub = rs.effectiveLandTypeLine.split(/\s+\u2014\s+/)[1] || rs.effectiveLandTypeLine;
    chips.push({ key: 'landtypes', label: `\u26F0 ${sub}`, title: `Land types changed by an effect (e.g. Evil Presence, Blood Moon): it is now ${rs.effectiveLandTypeLine}.`, background: 'rgba(101,163,13,0.95)' });
  }
  (rs.conditionalStatics || []).forEach((s, i) => {
    const short = s.text.split(' for ')[0];
    chips.push({ key: `cstatic${i}`, label: `${s.active ? '\u25CF' : '\u25CB'} ${short}`, title: `${s.sourceName}: ${s.text} \u2014 ${s.active ? 'ON' : 'OFF'}`, background: s.active ? 'rgba(22,163,74,0.95)' : 'rgba(107,114,128,0.85)' });
  });
  if (rs.grantedCrew) {
    chips.push({ key: 'grantedcrew', label: `\u2699 Crew ${rs.grantedCrew.value}`, title: `Crew ${rs.grantedCrew.value} granted by ${rs.grantedCrew.sourceName} (tap creatures with total power ${rs.grantedCrew.value}+ to crew).`, background: 'rgba(120,53,15,0.95)' });
  }
  if (rs.animatedByAttachment) {
    chips.push({ key: 'animated', label: '\u2726 Creature', title: 'An attached Aura makes this a creature in addition to its other types (e.g. Ensoul Artifact).', background: 'rgba(37,99,235,0.95)' });
  }
  if (perm.solved === true) {
    chips.push({ key: 'solved', label: '\u2714 Solved', title: 'This Case is solved; its "Solved" ability is active.', background: 'rgba(22,163,74,0.95)' });
  }
  if (perm.pairedWith) {
    const partner = allPerms?.find((p) => p?.id === perm.pairedWith);
    const partnerName = partner?.card?.name || 'another creature';
    chips.push({ key: 'paired', label: '\u{1F517} Paired', title: `Soulbond: paired with ${partnerName}.`, background: 'rgba(14,116,144,0.95)' });
  }
  if (perm.evoked === true) {
    chips.push({ key: 'evoked', label: 'Evoked', title: 'Cast for its evoke cost: it will be sacrificed when it enters.', background: 'rgba(124,58,237,0.95)' });
  }
  if (perm.regeneratedThisTurn === true) {
    chips.push({ key: 'regen', label: '\u267B Regenerated', title: 'Regenerated this turn (it was tapped and removed from combat instead of being destroyed).', background: 'rgba(5,150,105,0.95)' });
  }
  if (hasAttackDespiteDefender(perm)) {
    chips.push({ key: 'nodefender', label: '\u2694 Can attack', title: "Can attack this turn as though it didn't have defender.", background: 'rgba(234,88,12,0.95)' });
  }
  if (perm.saddled === true) {
    chips.push({ key: 'saddled', label: 'Saddled', title: 'This Mount is saddled until end of turn.', background: 'rgba(161,98,7,0.95)' });
  }
  return chips;
}

export function PermanentRulesStatusBadges(props: { perm: any; scale: number; players?: readonly Named[]; allPerms?: readonly any[] }) {
  const { perm, scale, players, allPerms } = props;
  const chips = getPermanentRulesStatusChips(perm, players, allPerms);
  if (chips.length === 0) return null;
  return (
    <div
      data-testid="permanent-rules-status"
      style={{
        position: 'absolute',
        bottom: Math.round(22 * scale),
        left: Math.round(4 * scale),
        right: Math.round(4 * scale),
        display: 'flex',
        flexWrap: 'wrap',
        gap: Math.round(2 * scale),
        zIndex: 14,
        pointerEvents: 'auto',
      }}
    >
      {chips.map((c) => (
        <span
          key={c.key}
          title={c.title}
          aria-label={c.title}
          style={{
            background: c.background,
            color: '#fff',
            borderRadius: Math.round(3 * scale),
            fontSize: Math.round(7 * scale),
            fontWeight: 600,
            padding: `${Math.round(1 * scale)}px ${Math.round(3 * scale)}px`,
            boxShadow: '0 1px 2px rgba(0,0,0,0.5)',
            textShadow: '0 1px 1px rgba(0,0,0,0.4)',
            cursor: 'help',
            whiteSpace: 'nowrap',
          }}
        >
          {c.label}
        </span>
      ))}
    </div>
  );
}

export default PermanentRulesStatusBadges;
