// server/src/state/modules/castRestrictionTailFamilies.ts
// B47: long-tail casting restrictions not covered by canCastSpell or staticCastingRestrictionsOracleExtras:
// self "you can't cast ~ if you've played a land this turn" (Rock Jockey) / "unless an opponent lost life
// this turn" (Rakdos, Lord of Riots); battlefield Cornered Market (same name as a nontoken permanent),
// Angelic Arbiter (opponents who attacked this turn), Wardscale Dragon (defending player while attacking),
// Experimental Frenzy (you can't cast spells from your hand).
// Public entry symbols: castRestrictionTailViolation.

function norm(s: unknown): string {
  return String(s || '').toLowerCase().replace(/[\u2018\u2019]/g, "'");
}

function oracleOf(perm: any): string {
  const card = perm?.card || {};
  const faces = Array.isArray(card.card_faces) ? card.card_faces.map((f: any) => f?.oracle_text || '') : [];
  return norm([card.oracle_text || '', ...faces].join('\n'));
}

function keyedCount(map: any, pid: string): number {
  const v = map?.[pid];
  return Number.isFinite(Number(v)) ? Number(v) : 0;
}

function spellName(spell: any): string {
  return String(spell?.name ?? spell?.card?.name ?? '').trim();
}

function selfOracle(spell: any): string {
  return norm(spell?.oracle_text ?? spell?.card?.oracle_text ?? '');
}

function isDefendingAgainst(perm: any, pid: string, battlefield: any[]): boolean {
  const target = perm?.attacking;
  if (!target) return false;
  const t = String(target);
  if (t === pid) return true;
  const attacked = battlefield.find((p: any) => p && String(p.id) === t);
  return !!attacked && String(attacked.controller || '') === pid;
}

function spellManaValue(spell: any): number {
  const raw = spell?.cmc ?? spell?.mana_value ?? spell?.manaValue ?? spell?.card?.cmc ?? spell?.card?.mana_value ?? spell?.card?.manaValue;
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

function isCreatureSpell(spell: any): boolean {
  return /\bcreature\b/i.test(String(spell?.type_line ?? spell?.card?.type_line ?? ''));
}

export function castRestrictionTailViolation(state: any, playerId: string, spell: any, castingZone?: string): string | null {
  const pid = String(playerId || '');
  if (!pid || !state) return null;
  const battlefield: any[] = Array.isArray(state.battlefield) ? state.battlefield : [];
  const own = selfOracle(spell);
  if (/you can't cast [^.\n]+? if you've played a land this turn/.test(own) && keyedCount(state.landsPlayedThisTurn, pid) > 0) {
    return 'You can\'t cast this spell after playing a land this turn.';
  }
  if (/you can't cast [^.\n]+? unless an opponent lost life this turn/.test(own)) {
    const lost = state.lifeLostThisTurn || {};
    const any = Object.keys(lost).some((k) => k !== pid && keyedCount(lost, k) > 0);
    if (!any) return 'You can\'t cast this spell unless an opponent lost life this turn.';
  }
  const name = spellName(spell).toLowerCase();
  const turnPlayer = String(state?.turnPlayer ?? state?.activePlayer ?? '');
  const zone = String(castingZone || 'hand').toLowerCase();
  for (const perm of battlefield) {
    if (!perm || perm.phasedOut) continue;
    const oracle = oracleOf(perm);
    if (!oracle.includes('cast')) continue;
    const src = String(perm?.card?.name || 'A permanent');
    const controller = String(perm.controller || '');
    const isOpponent = controller !== pid;
    if (name && /players can't cast spells with the same name as a nontoken permanent/.test(oracle)) {
      const clash = battlefield.some((p: any) => p && !p.isToken && !p.card?.isToken && String(p.card?.name || '').toLowerCase() === name);
      if (clash) return src + ' prevents casting spells with the same name as a nontoken permanent.';
    }
    if (isOpponent && /each opponent who attacked with a creature this turn can't cast spells/.test(oracle)
      && keyedCount(state.creaturesAttackedThisTurn, pid) > 0) {
      return src + ' prevents opponents who attacked this turn from casting spells.';
    }
    if (isOpponent && /as long as [^.\n]+? is attacking, defending player can't cast spells/.test(oracle)
      && isDefendingAgainst(perm, pid, battlefield)) {
      return src + ' prevents the defending player from casting spells.';
    }
    if (!isOpponent && zone === 'hand'
      && /you can't play lands or cast spells from your hand|you can't cast spells from your hand/.test(oracle)) {
      return src + ' prevents casting spells from your hand.';
    }
    // B82: Dosan — players can cast spells only during their own turns
    if (/players can cast spells only during their own turns/.test(oracle) && turnPlayer && turnPlayer !== pid) {
      return src + ' allows casting spells only during your own turn.';
    }
    // B82: Void Winnower — opponents can't cast even-MV spells
    if (isOpponent && /your opponents can(?:not|'t) cast spells with even mana values/.test(oracle)) {
      const mv = spellManaValue(spell);
      if (Number.isFinite(mv) && mv % 2 === 0) {
        return src + ' prevents opponents from casting spells with even mana values.';
      }
    }
    // B82: Soulless Jailer — no noncreature casts from graveyard/exile
    if (/players can(?:not|'t) cast noncreature spells from graveyards or exile/.test(oracle)
      && (zone === 'graveyard' || zone === 'exile')
      && !isCreatureSpell(spell)) {
      return src + ' prevents casting noncreature spells from graveyards or exile.';
    }
    // B84: Sanctum Prelate — noncreature spells with MV equal to the chosen number
    if (/noncreature spells with mana value equal to the chosen number can(?:not|'t) be cast/.test(oracle)
      && !isCreatureSpell(spell)) {
      const chosen = Number((perm as any)?.chosenNumber ?? (perm as any)?.card?.chosenNumber);
      const mv = spellManaValue(spell);
      if (Number.isFinite(chosen) && Number.isFinite(mv) && mv === chosen) {
        return src + ' prevents casting noncreature spells with mana value equal to the chosen number.';
      }
    }
    // B84: Lavinia — each opponent can't cast noncreature spells with MV > lands they control
    if (isOpponent
      && /each opponent can(?:not|'t) cast noncreature spells with mana value greater than the number of lands that player controls/.test(oracle)
      && !isCreatureSpell(spell)) {
      const lands = (Array.isArray(state?.battlefield) ? state.battlefield : []).filter((p: any) =>
        String(p?.controller || '') === pid && /\bland\b/i.test(String(p?.card?.type_line || '')),
      ).length;
      const mv = spellManaValue(spell);
      if (Number.isFinite(mv) && mv > lands) {
        return src + ' prevents opponents from casting noncreature spells with mana value greater than lands they control.';
      }
    }
  }
  return null;
}
