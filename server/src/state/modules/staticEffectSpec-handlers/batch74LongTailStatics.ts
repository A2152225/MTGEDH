// server/src/state/modules/staticEffectSpec-handlers/batch74LongTailStatics.ts
// B74 static long-tail:
//   Song of Serenity — enchanted creatures can't attack or block
//   Nut Collector — All Squirrels get ±N/±N while threshold
//   Light from Within — +1/+1 per COLOR mana symbol in its mana cost
//   Eidolon of Countless Battles — self + enchanted each get for creatures and for Auras
//   Twins of Discord — other colorless creatures have bloodthirst N
//   Invasion of Zendikar (Awakened Skyclave) — is a land in addition while on the battlefield
//   Daxos — can't be blocked by creatures with power N or greater (explicit self)
// Public: pushBatch74LongTailStaticSpecs.
// Sibling extensions: graveyard keyword classifiers (Sedris/Deeproot/Niv), Seeker attack lock,
//   Phyrexian Censor cast cap, Forge Anew equip timing, Lurker targeting classifiers.

import type { BattlefieldPermanent } from '../../../../../shared/src/index.js';
import type { StaticEffectCondition, StaticEffectSpec } from '../staticEffectSpecTypes.js';
import {
  buildSpec,
  parseBuffSegment,
  parseCardCountWord,
  type StaticEffectSpecSource,
} from './staticEffectSpecOracleParseHelpers.js';

const NUM: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function readCount(raw: string): number | null {
  const s = String(raw || '').trim().toLowerCase();
  if (/^\d+$/.test(s)) return Number(s);
  if (NUM[s] != null) return NUM[s];
  try {
    const n = parseCardCountWord(s);
    return n && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function pushEnchantedCantAttackBlock(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  if (!/creatures that are enchanted can(?:not|'t) attack or block/.test(text)) return;
  specs.push(buildSpec(
    source,
    'enchanted-cant-attack-block',
    { kind: 'all_creatures' },
    { abilities: ["can't attack", "can't block"] },
    { kind: 'target_is_enchanted' } as StaticEffectCondition,
  ));
}

function pushThresholdTypeAnthem(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const m = String(oracle || '').toLowerCase().replace(/\u2019/g, "'").match(
    /(?:^|[.\n;])\s*(?:threshold\s*[—–-]\s*)?all ([a-z]+)s get ([+-]\d+\s*\/\s*[+-]\d+) as long as there are (?:\w+ or more|seven or more) cards in your graveyard/,
  );
  if (!m) return;
  const creatureType = String(m[1] || '').trim();
  const buff = parseBuffSegment(m[2] || '');
  if (!creatureType || !buff) return;
  specs.push(buildSpec(
    source,
    `threshold-type-anthem:${creatureType}`,
    { kind: 'all_creatures_of_type', creatureType },
    { power: buff.power, toughness: buff.toughness },
    { kind: 'source_controller_has_threshold' } as StaticEffectCondition,
  ));
}

function pushChromaManaSymbolAnthem(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const m = String(oracle || '').toLowerCase().replace(/\u2019/g, "'").match(
    /(?:^|[.\n;])\s*(?:chroma\s*[—–-]\s*)?each creature you control gets ([+-]\d+\s*\/\s*[+-]\d+) for each (white|blue|black|red|green) mana symbol in its mana cost/,
  );
  if (!m) return;
  const buff = parseBuffSegment(m[1] || '');
  const color = String(m[2] || '').trim();
  if (!buff || !color) return;
  specs.push(buildSpec(
    source,
    `chroma-mana-symbol-anthem:${color}`,
    { kind: 'creatures_you_control' },
    {
      power: buff.power,
      toughness: buff.toughness,
      countBasis: 'recipient_mana_symbols',
      countColor: color,
    } as any,
  ));
}

function pushSelfAndEnchantedDualCount(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  const m = String(oracle || '').toLowerCase().replace(/\u2019/g, "'").match(
    /(?:this creature|~) and enchanted creature each get ([+-]\d+\s*\/\s*[+-]\d+) for each creature you control and ([+-]\d+\s*\/\s*[+-]\d+) for each aura you control/,
  );
  if (!m) return;
  const creatureBuff = parseBuffSegment(m[1] || '');
  const auraBuff = parseBuffSegment(m[2] || '');
  if (!creatureBuff || !auraBuff) return;
  const pushPair = (idPrefix: string, sourcePermanentId: string, effectSourceId?: string) => {
    const base = (id: string, grant: Record<string, unknown>) => {
      const spec = {
        ...buildSpec(source, id, { kind: 'self' }, grant as any),
        sourcePermanentId,
        ...(effectSourceId ? { effectSourcePermanentId: effectSourceId } : {}),
        scope: { kind: 'self' as const },
      };
      specs.push(spec);
    };
    base(`${idPrefix}-creatures`, {
      power: creatureBuff.power,
      toughness: creatureBuff.toughness,
      countBasis: 'controller_permanents_of_type',
      countCardType: 'creature',
    });
    base(`${idPrefix}-auras`, {
      power: auraBuff.power,
      toughness: auraBuff.toughness,
      countBasis: 'controller_permanents_of_type',
      countCardType: 'aura',
    });
  };
  pushPair('self-and-enchanted-self', source.sourcePermanentId);
  const hostId = String((perm as any)?.attachedTo || '').trim();
  if (hostId) pushPair('self-and-enchanted-host', hostId, source.sourcePermanentId);
}

function pushOtherColorlessBloodthirst(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const m = String(oracle || '').toLowerCase().replace(/\u2019/g, "'").match(
    /(?:^|[.\n;])\s*each other colorless creature you control has bloodthirst (\d+)/,
  );
  if (!m) return;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 1) return;
  specs.push(buildSpec(
    source,
    'other-colorless-bloodthirst',
    { kind: 'other_creatures_you_control' },
    { abilities: [`bloodthirst ${n}`] },
    { kind: 'target_is_colorless' } as StaticEffectCondition,
  ));
}

function pushOnBattlefieldAlsoLand(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  if (!/as long as (?:this permanent|~|it) is on the battlefield, it'?s a land in addition to its other types/.test(text)) {
    return;
  }
  specs.push({
    ...buildSpec(source, 'on-battlefield-also-land', { kind: 'self' }, { typeAdditions: ['Land'] }),
    layer: 4,
  });
}

function pushSelfPowerBlockEvasion(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const subject = String(source.sourceName || '').toLowerCase();
  const short = subject.split(',')[0].trim();
  const first = short.split(/\s+/)[0];
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const alts = ['this creature', '~'];
  for (const a of [subject, short, first]) {
    if (a && a.length >= 3) alts.push(a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  }
  const re = new RegExp(`(?:${alts.join('|')}) can(?:not|'t) be blocked by creatures with power (\\d+|\\w+) or greater`);
  const m = text.match(re);
  if (!m) return;
  const n = readCount(m[1] || '');
  if (n == null) return;
  if (specs.some((s) => (s.grant.abilities || []).some((a) => /can't be blocked by creatures with power/.test(String(a))))) {
    return;
  }
  specs.push(buildSpec(
    source,
    'self-power-block-evasion',
    { kind: 'self' },
    { abilities: [`can't be blocked by creatures with power ${n} or greater`] },
  ));
}

export function pushBatch74LongTailStaticSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  pushEnchantedCantAttackBlock(specs, source, oracle);
  pushThresholdTypeAnthem(specs, source, oracle);
  pushChromaManaSymbolAnthem(specs, source, oracle);
  pushSelfAndEnchantedDualCount(specs, source, perm, oracle);
  pushOtherColorlessBloodthirst(specs, source, oracle);
  pushOnBattlefieldAlsoLand(specs, source, oracle);
  pushSelfPowerBlockEvasion(specs, source, oracle);
}
