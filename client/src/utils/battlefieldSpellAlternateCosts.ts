export type BattlefieldSpellAlternateCost = {
  id: string;
  label: string;
  description: string;
  manaCost: string;
};

export type SpellPaymentContextForBattlefieldAlts = {
  fromZone?: string;
  activatingPermanentId?: string;
};

/**
 * Fist of Suns / Omniscience client fallbacks apply only when casting a spell from hand.
 * Activated abilities (e.g. Three Tree City {2}{T}), ward, and extort omit fromZone and
 * must never pick up spell alternate costs from the battlefield.
 */
export function shouldApplyBattlefieldSpellAlternateCosts(
  spellToCast: SpellPaymentContextForBattlefieldAlts | null | undefined,
): boolean {
  if (!spellToCast) return false;
  if (spellToCast.activatingPermanentId) return false;
  return spellToCast.fromZone === 'hand';
}

function grantsFreeHandCasts(text: string): boolean {
  const oracleText = String(text || '').toLowerCase();
  if (!oracleText.includes('without paying')) return false;
  if (!oracleText.includes('from your hand')) return false;
  if (!oracleText.includes('you may cast')) return false;
  return oracleText.includes('cast spells from your hand')
    || oracleText.includes('cast nonland cards from your hand')
    || oracleText.includes('cast cards from your hand');
}

function grantsExternalWubrgAlternateCost(text: string): boolean {
  const oracleText = String(text || '').toLowerCase();
  return oracleText.includes('{w}{u}{b}{r}{g}')
    && oracleText.includes('rather than pay')
    && !oracleText.includes('this spell');
}

export function buildBattlefieldSpellAlternateCosts(options: {
  spellToCast: SpellPaymentContextForBattlefieldAlts | null | undefined;
  controllerId: string | null | undefined;
  battlefield: Array<{
    controller?: string;
    card?: { name?: string; oracle_text?: string } | null;
  }> | null | undefined;
  emblems?: Array<{
    controller?: string;
    sourceName?: string;
    name?: string;
    effect?: string;
    text?: string;
    oracle_text?: string;
  }> | null;
}): BattlefieldSpellAlternateCost[] {
  const { spellToCast, controllerId, battlefield, emblems } = options;
  if (!shouldApplyBattlefieldSpellAlternateCosts(spellToCast) || !controllerId) {
    return [];
  }

  const extraCosts: BattlefieldSpellAlternateCost[] = [];

  const addExternalWubrgOption = (sourceName: string) => {
    if (extraCosts.some((cost) => cost.id === 'wubrg_external')) return;
    extraCosts.push({
      id: 'wubrg_external',
      label: `WUBRG Alternative (${sourceName})`,
      description: `Pay {W}{U}{B}{R}{G} via ${sourceName}`,
      manaCost: '{W}{U}{B}{R}{G}',
    });
  };

  const addFreeCastOption = (sourceName: string) => {
    if (extraCosts.some((cost) => cost.id === 'free')) return;
    extraCosts.push({
      id: 'free',
      label: `Free Cast (${sourceName})`,
      description: `Cast from hand without paying mana costs via ${sourceName}`,
      manaCost: '',
    });
  };

  for (const permanent of battlefield || []) {
    if (!permanent || permanent.controller !== controllerId) continue;

    const sourceName = String(permanent.card?.name || '').trim();
    const oracleText = String(permanent.card?.oracle_text || '').toLowerCase();
    if (!sourceName || !oracleText) continue;

    if (grantsExternalWubrgAlternateCost(oracleText)) {
      addExternalWubrgOption(sourceName);
    }

    if (grantsFreeHandCasts(oracleText)) {
      addFreeCastOption(sourceName);
    }
  }

  for (const emblem of emblems || []) {
    if (!emblem || String(emblem.controller || '') !== String(controllerId)) continue;

    const sourceName = String(emblem.sourceName || emblem.name || 'Emblem').trim();
    const emblemText = String(emblem.effect || emblem.text || emblem.oracle_text || '');
    if (!sourceName) continue;

    if (grantsExternalWubrgAlternateCost(emblemText)) {
      addExternalWubrgOption(sourceName);
    }

    if (grantsFreeHandCasts(emblemText)) {
      addFreeCastOption(sourceName);
    }
  }

  return extraCosts;
}
