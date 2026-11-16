// server/src/state/modules/staticEffectSpec-handlers/batch92LongTailStatics.ts
// B92 long-tail statics: quoted-ability grants (Kosei, Endless Whispers,
// Aetherspark), Galactus attacks-unless-named + most-life defender, Elvish
// Refueler exhaust reuse, Myr Superion creature-mana restriction, Aetherspark
// "can't be attacked" while attached, hand-revealed (Enduring Renewal),
// Serum Powder opening-hand action flag.
// Public: pushBatch92LongTailStaticSpecs, parseBatch92QuotedAbilityGrant,
// parseBatch92AttacksMostLifeUnlessNamed.

import type { StaticEffectSpec, StaticEffectCondition } from '../staticEffectSpecTypes.js';
import { buildSpec, type StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';
import { normalizeOraclePatternText } from '../replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';

export function parseBatch92QuotedAbilityGrant(oracle: string): Array<{
  filterKind: string;
  quoted: string;
  conditionKind?: string;
  attachedOnly?: boolean;
}> {
  const text = String(oracle || '').replace(/\u2019/g, "'");
  const out: Array<{ filterKind: string; quoted: string; conditionKind?: string; attachedOnly?: boolean }> = [];
  const selfAsLong = text.match(
    /as long as ([^,]+), ([^.]+?) has "([^"]+)"/i,
  );
  if (selfAsLong) {
    out.push({
      filterKind: 'self',
      quoted: String(selfAsLong[3] || '').trim(),
      conditionKind: String(selfAsLong[1] || '').trim(),
    });
  }
  const eachHas = text.match(
    /each creature has "([^"]+)"/i,
  );
  if (eachHas) {
    out.push({ filterKind: 'each_creature', quoted: String(eachHas[1] || '').trim() });
  }
  const attachedHas = text.match(
    /as long as [^,]+ is attached to a creature, [^.]+ can't be attacked and has "([^"]+)"/i,
  );
  if (attachedHas) {
    out.push({
      filterKind: 'self',
      quoted: String(attachedHas[1] || '').trim(),
      attachedOnly: true,
    });
  }
  return out;
}

export function parseBatch92AttacksMostLifeUnlessNamed(oracle: string): { named: string; mostLife: boolean } | null {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /(?:this creature|~|[a-z0-9' ,.-]+?)\s+attacks(?: an opponent with the most life among your opponents)? each combat if able unless you control an? creatures? named ([a-z0-9' ,.-]+)/i,
  );
  if (!m) return null;
  const named = String(m[1] || '').trim().replace(/\.$/, '');
  if (!named) return null;
  const mostLife = /attacks an opponent with the most life among your opponents each combat if able/i.test(text);
  return { named, mostLife };
}

function pushQuotedGrants(specs: StaticEffectSpec[], source: StaticEffectSpecSource, oracle: string): void {
  for (const grant of parseBatch92QuotedAbilityGrant(oracle)) {
    if (!grant.quoted) continue;
    const scope: { kind: 'all_creatures' } | { kind: 'self' } = grant.filterKind === 'each_creature'
      ? { kind: 'all_creatures' }
      : { kind: 'self' };
    const condition = grant.attachedOnly
      ? ({ kind: 'source_is_attached_to_creature' } as unknown as StaticEffectCondition)
      : grant.conditionKind
        ? ({ kind: 'source_meets_clause', option: grant.conditionKind } as unknown as StaticEffectCondition)
        : undefined;
    const effectId = grant.filterKind === 'each_creature'
      ? 'each-creature-quoted-ability'
      : grant.attachedOnly
        ? 'attached-quoted-ability'
        : 'self-conditional-quoted-ability';
    specs.push(buildSpec(source, effectId, scope, { abilities: [grant.quoted] }, condition));
  }
}

function pushAttacksMostLifeUnlessNamed(specs: StaticEffectSpec[], source: StaticEffectSpecSource, oracle: string): void {
  const parsed = parseBatch92AttacksMostLifeUnlessNamed(oracle);
  if (!parsed) return;
  // Avoid double-emitting the batch88 "attacks each combat if able unless named"
  // form when the wording has no most-life clause.
  if (!parsed.mostLife) return;
  const spec = buildSpec(
    source,
    `attacks-most-life-unless-named:${parsed.named}`,
    { kind: 'self' },
    { abilities: ['attacks each combat if able', 'attacks_player_with_most_life'] },
    { kind: 'controller_controls_named_at_least', count: 1, option: parsed.named } as unknown as StaticEffectCondition,
  );
  (spec as any).conditionNegated = true;
  specs.push(spec);
}

function pushCantBeAttackedWhileAttached(specs: StaticEffectSpec[], source: StaticEffectSpecSource, oracle: string): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  if (!/as long as .+ is attached to a creature, .+ can't be attacked/.test(text)) return;
  specs.push(buildSpec(
    source,
    'cant-be-attacked-while-attached',
    { kind: 'self' },
    { abilities: ["can't be attacked"] },
    { kind: 'source_is_attached_to_creature' } as unknown as StaticEffectCondition,
  ));
}

function pushHandRevealed(specs: StaticEffectSpec[], source: StaticEffectSpecSource, oracle: string): void {
  const text = normalizeOraclePatternText(String(oracle || '')).toLowerCase();
  if (!/play with your hand revealed/.test(text)) return;
  specs.push(buildSpec(source, 'play-with-hand-revealed', { kind: 'player_you' }, { abilities: ['play with your hand revealed'] }));
}

function pushExhaustReuse(specs: StaticEffectSpec[], source: StaticEffectSpecSource, oracle: string): void {
  const text = normalizeOraclePatternText(String(oracle || '')).toLowerCase().replace(/\u2019/g, "'");
  if (!/you may activate exhaust abilities as though they haven't been activated/.test(text)) return;
  specs.push(buildSpec(
    source,
    'exhaust-reuse-during-your-turn',
    { kind: 'player_you' },
    { abilities: ['activate_exhaust_as_though_not_activated'] },
    { kind: 'is_controllers_turn_and_no_exhaust_activated_this_turn' } as unknown as StaticEffectCondition,
  ));
}

function pushCreatureManaOnly(specs: StaticEffectSpec[], source: StaticEffectSpecSource, oracle: string): void {
  const text = normalizeOraclePatternText(String(oracle || '')).toLowerCase();
  if (!/spend only mana produced by creatures to cast this spell/.test(text)) return;
  specs.push(buildSpec(
    source,
    'spend-only-creature-produced-mana',
    { kind: 'self' },
    { abilities: ['spend_only_mana_produced_by_creatures'] },
  ));
}

function pushRulebreaker(specs: StaticEffectSpec[], source: StaticEffectSpecSource, oracle: string): void {
  const text = String(oracle || '');
  if (!/rulebreaker/i.test(text) && !/a deck with this commander can have/i.test(text)) return;
  const kinds: string[] = [];
  if (/can have any land cards/i.test(text)) kinds.push('any-land-cards');
  if (/creature cards with mana value \d+ or greater of any color identity/i.test(text)) kinds.push('creatures-mv-any-color-identity');
  if (/any basic land cards/i.test(text)) kinds.push('any-basic-land-cards');
  if (!kinds.length) return;
  specs.push(buildSpec(source, 'commander-deck-construction-exception', { kind: 'self' }, { abilities: kinds.map((k) => `deck_exception:${k}`) }));
}

function pushSerumPowderAction(specs: StaticEffectSpec[], source: StaticEffectSpecSource, oracle: string): void {
  const text = normalizeOraclePatternText(String(oracle || '')).toLowerCase();
  if (!/any time you could mulligan and this card is in your hand/.test(text)) return;
  specs.push(buildSpec(source, 'serum-powder-mulligan-action', { kind: 'self' }, { abilities: ['opening_hand_exile_and_redraw'] }));
}

export function pushBatch92LongTailStaticSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  _perm: unknown,
  oracle: string,
): void {
  pushQuotedGrants(specs, source, oracle);
  pushAttacksMostLifeUnlessNamed(specs, source, oracle);
  pushCantBeAttackedWhileAttached(specs, source, oracle);
  pushHandRevealed(specs, source, oracle);
  pushExhaustReuse(specs, source, oracle);
  pushCreatureManaOnly(specs, source, oracle);
  pushRulebreaker(specs, source, oracle);
  pushSerumPowderAction(specs, source, oracle);
}
