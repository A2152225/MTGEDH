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
    // B88: Ashes of the Abhorrent — no casts from graveyards
    if (/players can(?:not|'t) cast spells from graveyards/.test(oracle) && zone === 'graveyard') {
      return src + ' prevents casting spells from graveyards.';
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
    // B85: Brand of Ill Omen — enchanted creature's controller can't cast creature spells
    if (/enchanted creature'?s controller can(?:not|'t) cast creature spells/.test(oracle) && isCreatureSpell(spell)) {
      const hostId = String((perm as any)?.attachedTo || '').trim();
      const host = hostId ? battlefield.find((p: any) => p && String(p.id) === hostId) : undefined;
      if (host && String(host.controller || '') === pid) {
        return src + " prevents enchanted creature's controller from casting creature spells.";
      }
    }
    // B86: Gaddock Teeg — noncreature spells with MV >= N / with {X} in mana cost
    if (/noncreature spells with mana value (\d+) or greater can(?:not|'t) be cast/.test(oracle) && !isCreatureSpell(spell)) {
      const m = oracle.match(/noncreature spells with mana value (\d+) or greater can(?:not|'t) be cast/);
      const threshold = Number(m?.[1]);
      const mv = spellManaValue(spell);
      if (Number.isFinite(threshold) && Number.isFinite(mv) && mv >= threshold) {
        return src + ' prevents casting noncreature spells with mana value ' + threshold + ' or greater.';
      }
    }
    if (/noncreature spells with \{x\} in their mana costs can(?:not|'t) be cast/.test(oracle) && !isCreatureSpell(spell)) {
      const cost = String(spell?.mana_cost ?? spell?.card?.mana_cost ?? '').toUpperCase();
      if (/\{X\}/.test(cost)) {
        return src + ' prevents casting noncreature spells with {X} in their mana costs.';
      }
    }
  }
  // B87: Proft — threshold cast lock on the spell itself
  if (/you can(?:not|'t) cast this spell unless there are (\w+) or more cards in your graveyard/.test(own)) {
    const m = own.match(/you can(?:not|'t) cast this spell unless there are (\w+) or more cards in your graveyard/);
    const WORDS: Record<string, number> = {
      one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    };
    const raw = String(m?.[1] || '');
    const need = /^\d+$/.test(raw) ? Number(raw) : WORDS[raw];
    const gy = state?.zones?.[pid]?.graveyard;
    const n = Array.isArray(gy) ? gy.length : 0;
    if (need !== undefined && n < need) {
      return 'You can\'t cast this spell unless there are ' + need + ' or more cards in your graveyard.';
    }
  }
  return null;
}
