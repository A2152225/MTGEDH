import type { OracleEffectStep } from './oracleIR';
import { normalizeOracleText, parseObjectSelector } from './oracleIRParserUtils';

import type { WithMeta } from './oracleIRParserStaticAbilityClauses-handlers/oracleIRParserStaticAbilityGrantParseUtils';
import {
  STATIC_KEYWORD_ABILITIES,
  normalizeGraveyardGrantSelector,
  parseGraveyardKeywordAbilityCost,
  parseKeywordAbilityList,
  extractQuotedAbilityText,
  parseSignedInt,
  isEphemeralGrantedAbilityTarget,
} from './oracleIRParserStaticAbilityClauses-handlers/oracleIRParserStaticAbilityGrantParseUtils';
import { tryParseStaticAbilityGrantEarlyClauses } from './oracleIRParserStaticAbilityClauses-handlers/oracleIRParserStaticAbilityGrantEarlyClauses';

export function tryParseStaticAbilityGrantClause(args: {
  clause: string;
  rawClause: string;
  withMeta: WithMeta;
}): OracleEffectStep | null {
  const { clause, rawClause, withMeta } = args;
  const normalized = normalizeOracleText(clause).replace(/^[\u2022â€¢]\s+/, '').replace(/[.]+$/g, '').trim();
  if (!normalized) return null;
  if (/\buntil\s+end\s+of\s+turn\b/i.test(normalized) && !/"[^"]*\buntil\s+end\s+of\s+turn\b[^"]*"/i.test(normalized)) return null;
  if (/^during your turn,\s+/i.test(normalized) && !/^during your turn,\s+you may\s+(?:cast|play)\b/i.test(normalized)) return null;
  if (/^(?:plainswalk|islandwalk|swampwalk|mountainwalk|forestwalk)\s*\(/i.test(normalized)) return null;

  {
    const early = tryParseStaticAbilityGrantEarlyClauses({ normalized, rawClause, withMeta });
    if (early !== undefined) return early;
  }


  // Frogify / Kasmina's Transmutation: "Enchanted creature loses all abilities and is a blue Frog
  // creature with base power and toughness 1/1." A layer-shifting grant with no duration word, so it
  // lasts as long as the Aura stays attached.
  const losesAllAbilitiesMatch = normalized.match(
    /^((?:enchanted|equipped)\s+\w+)\s+loses?\s+all\s+abilities(?:\s+and\s+(?:is|becomes?|has)\s+(.+?))?$/i
  );
  if (losesAllAbilitiesMatch && !/\buntil\b/i.test(normalized)) {
    const targetText = String(losesAllAbilitiesMatch[1] || '').trim();
    const becomesText = String(losesAllAbilitiesMatch[2] || '').trim();
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(targetText),
      effectText: ['loses all abilities', ...(becomesText ? [becomesText] : [])],
      duration: /^(?:equipped|enchanted)\b/i.test(targetText) ? 'while_attached' : 'static',
      raw: rawClause,
    });
  }

  const equippedGrantMatch = normalized.match(
    /^(equipped creature|enchanted creature|equipped land|this creature|this saga)\s+(?:(?:gets\s+([+-]?\d+)\s*\/\s*([+-]?\d+)\s+and\s+)?(?:has|have|gains?|gain)\s+(.+))$/i
  );
  if (equippedGrantMatch) {
    const targetText = String(equippedGrantMatch[1] || '').trim();
    const tail = String(equippedGrantMatch[4] || '').trim();
    const conditionalTail = tail.match(/^(.+?)\s+as\s+long\s+as\s+(.+)$/i);
    const keywordTail = conditionalTail ? String(conditionalTail[1] || '').trim() : tail;
    const effectText = extractQuotedAbilityText(tail);
    if (conditionalTail) effectText.push(`as long as ${String(conditionalTail[2] || '').trim()}`);
    const abilities = parseKeywordAbilityList(keywordTail);
    const wardCostMatch = tail.match(/\bward\s+\{[^}]+\}/i);
    const power = parseSignedInt(equippedGrantMatch[2]);
    const toughness = parseSignedInt(equippedGrantMatch[3]);
    if (!effectText.length && !abilities.length && !wardCostMatch && power === undefined && toughness === undefined) return null;

    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(targetText),
      ...(abilities.length > 0 ? { abilities } : {}),
      ...(effectText.length > 0
        ? { effectText }
        : wardCostMatch && !abilities.some((ability) => ability.startsWith('ward'))
          ? { effectText: [tail] }
          : {}),
      ...(power !== undefined ? { power } : {}),
      ...(toughness !== undefined ? { toughness } : {}),
      duration: /^(?:equipped|enchanted)\b/i.test(targetText) ? 'while_attached' : 'static',
      raw: rawClause,
    });
  }

  const attachedPtOnlyGrantMatch = normalized.match(
    /^(equipped creature|enchanted creature|equipped land|enchanted land|enchanted permanent|this creature)\s+gets\s+([+-]?\d+)\s*\/\s*([+-]?\d+)(?:\s+(.+))?$/i
  );
  if (attachedPtOnlyGrantMatch) {
    const targetText = String(attachedPtOnlyGrantMatch[1] || '').trim();
    const power = parseSignedInt(attachedPtOnlyGrantMatch[2]);
    const toughness = parseSignedInt(attachedPtOnlyGrantMatch[3]);
    const tail = String(attachedPtOnlyGrantMatch[4] || '').trim();
    if (power === undefined || toughness === undefined) return null;

    const dynamicTail = /^(?:for\s+each|where\b|as\s+long\s+as\b)/i.test(tail);
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(targetText),
      ...(dynamicTail
        ? { effectText: [`gets ${String(attachedPtOnlyGrantMatch[2] || '').trim()}/${String(attachedPtOnlyGrantMatch[3] || '').trim()} ${tail}`.trim()] }
        : { power, toughness }),
      duration: /^(?:equipped|enchanted)\b/i.test(targetText) ? 'while_attached' : 'static',
      raw: rawClause,
    });
  }

  const staticTeamPtMatch = normalized.match(
    /^((?:(?:all|other)\s+)?(?:non[- ]?[a-z]+\s+)?(?:[a-z]+\s+)?creatures\s+(?:you\s+control|your\s+opponents\s+control)(?:\s+that\s+are\s+[a-z ]+)?(?:\s+with\s+[a-z ]+)?(?:\s+of\s+the\s+chosen\s+(?:type|color))?|all\s+creatures(?:\s+of\s+(?:that|the\s+chosen)\s+type)?|all\s+[a-z][a-z -]+\s+creatures|all\s+[a-z][a-z -]+s|(?:each\s+creature|creatures|[a-z]+\s+creatures|other\s+[a-z]+\s+creatures)(?:\s+with\s+[a-z ]+)?|creatures\s+of\s+the\s+chosen\s+color)\s+get\s+([+-]?(?:\d+|x))\s*\/\s*([+-]?(?:\d+|x))(?:\s*,?\s*(.+))?$/i
  );
  if (staticTeamPtMatch) {
    const targetText = String(staticTeamPtMatch[1] || '').trim();
    const power = parseSignedInt(staticTeamPtMatch[2]);
    const toughness = parseSignedInt(staticTeamPtMatch[3]);
    const tail = String(staticTeamPtMatch[4] || '').trim();
    const dynamicTail = /^(?:for\s+each|where\b|as\s+long\s+as\b)/i.test(tail);
    if ((power === undefined || toughness === undefined) && !dynamicTail) return null;

    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(targetText),
      ...(dynamicTail || power === undefined || toughness === undefined
        ? { effectText: [`gets ${String(staticTeamPtMatch[2] || '').trim()}/${String(staticTeamPtMatch[3] || '').trim()} ${tail}`.trim()] }
        : { power, toughness }),
      duration: 'static',
      raw: rawClause,
    });
  }

  if (/^this\s+creature\s+can't\s+attack\s+unless\s+defending\s+player\s+controls\s+(?:a|an)\s+(?:plains|island|swamp|mountain|forest)$/i.test(normalized)) {
    return null;
  }

  const staticCombatRestrictionMatch = normalized.match(
    /^(.+?)\s+can't\s+attack\s+(.+?)\s+unless\s+(.+)$/i
  );
  if (staticCombatRestrictionMatch) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(staticCombatRestrictionMatch[1] || '').trim()),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  const staticCombatRestrictionDurationMatch = normalized.match(
    /^(.+?)\s+can't\s+attack\s+(.+?)(?:\s+for\s+as\s+long\s+as\s+.+|\s+that\s+combat)$/i
  );
  if (staticCombatRestrictionDurationMatch) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(staticCombatRestrictionDurationMatch[1] || '').trim()),
      effectText: [normalized.replace(/^.+?\s+can't\s+attack/i, "can't attack")],
      duration: 'static',
      raw: rawClause,
    });
  }

  const staticCombatRestrictionGenericMatch = normalized.match(/^(.+?)\s+can't\s+attack(?:\s+(.+))?$/i);
  if (
    staticCombatRestrictionGenericMatch &&
    !/\bor\s+block\b/i.test(normalized) &&
    !/\battacks\s+each\s+combat\s+if\s+able\b/i.test(normalized)
  ) {
    const restrictionTail = String(staticCombatRestrictionGenericMatch[2] || '').trim();
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(staticCombatRestrictionGenericMatch[1] || '').trim()),
      effectText: [`can't attack${restrictionTail ? ` ${restrictionTail}` : ''}`],
      duration: 'static',
      raw: rawClause,
    });
  }

  const staticAttackOrBlockRestrictionMatch = normalized.match(/^(.+?)\s+can't\s+(attack\s+or\s+block|block\s+or\s+attack)(?:\s+.+)?$/i);
  if (staticAttackOrBlockRestrictionMatch) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(staticAttackOrBlockRestrictionMatch[1] || '').trim()),
      effectText: [normalized.replace(/^.+?\s+can't\s+/i, "can't ")],
      duration: 'static',
      raw: rawClause,
    });
  }

  const staticBlockOnlyMatch = normalized.match(/^(.+?)\s+can\s+block\s+only\s+(.+)$/i);
  if (staticBlockOnlyMatch) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(staticBlockOnlyMatch[1] || '').trim()),
      effectText: [`can block only ${String(staticBlockOnlyMatch[2] || '').trim()}`],
      duration: 'static',
      raw: rawClause,
    });
  }

  const staticBlockAdditionalMatch = normalized.match(/^(.+?)\s+can\s+block\s+(.+)$/i);
  if (staticBlockAdditionalMatch && /\b(?:any number of creatures|creatures with flying)\b/i.test(String(staticBlockAdditionalMatch[2] || ''))) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(staticBlockAdditionalMatch[1] || '').trim()),
      effectText: [`can block ${String(staticBlockAdditionalMatch[2] || '').trim()}`],
      duration: 'static',
      raw: rawClause,
    });
  }

  const staticAttackAsThoughMatch = normalized.match(/^(.+?)\s+can\s+attack\s+as\s+though\s+it\s+did(?:n't| not)\s+have\s+defender$/i);
  if (staticAttackAsThoughMatch) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(staticAttackAsThoughMatch[1] || '').trim()),
      effectText: ["can attack as though it didn't have defender"],
      duration: 'static',
      raw: rawClause,
    });
  }

  const staticBlockRestrictionMatch = normalized.match(/^(.+?)\s+can't\s+block\s+with\s+(.+)$/i);
  if (staticBlockRestrictionMatch) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(staticBlockRestrictionMatch[1] || '').trim()),
      effectText: [normalized.replace(/^.+?\s+can't\s+block/i, "can't block")],
      duration: 'static',
      raw: rawClause,
    });
  }

  const staticUnblockableMatch = normalized.match(/^(.+?)\s+can't\s+be\s+blocked(?:\s+(?:by|except\s+by)\s+.+?)?(?:\s+as\s+long\s+as\s+.+)?$/i);
  if (staticUnblockableMatch) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(staticUnblockableMatch[1] || '').trim()),
      effectText: [normalized.replace(/^.+?\s+can't\s+be\s+blocked/i, "can't be blocked")],
      duration: 'static',
      raw: rawClause,
    });
  }

  const staticCharacteristicMatch = normalized.match(/^(.+?)\s+are\s+(black|legendary|colorless(?:\s+sources\s+of\s+damage)?|no\s+longer\s+snow)$/i);
  if (staticCharacteristicMatch) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(staticCharacteristicMatch[1] || '').trim()),
      effectText: [`are ${String(staticCharacteristicMatch[2] || '').trim()}`],
      duration: 'static',
      raw: rawClause,
    });
  }

  const staticTypeRenameMatch = normalized.match(/^(all\s+[a-z][a-z -]+s)\s+are\s+([a-z][a-z -]+s)$/i);
  if (staticTypeRenameMatch) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(staticTypeRenameMatch[1] || '').trim()),
      effectText: [`are ${String(staticTypeRenameMatch[2] || '').trim()}`],
      duration: 'static',
      raw: rawClause,
    });
  }

  const staticKeywordGrantMatch = normalized.match(/^(.+?)\s+(?:has|have)\s+(.+)$/i);
  if (staticKeywordGrantMatch && !/"/.test(normalized)) {
    const targetText = String(staticKeywordGrantMatch[1] || '').trim();
    const abilityText = String(staticKeywordGrantMatch[2] || '').trim();
    const graveyardKeywordGrant = normalized.match(
      /^(until end of turn,\s+)?((?:(?:each|all|target|up to one target)\s+)?[a-z0-9][^"]*?)\s+in\s+your\s+graveyard((?:\s+that(?:'s| is)\s+.+?)?)\s+(?:has|have|gain|gains)\s+(unearth|embalm|eternalize)(?:\s+((?:(?:\{[^}]+\}\s*)+|pay\s+.+?)))?(?:\s+(until end of turn|this turn))?$/i
    );
    if (graveyardKeywordGrant) {
      const leadingDuration = Boolean(graveyardKeywordGrant[1]);
      const trailingDuration = String(graveyardKeywordGrant[6] || '').trim().toLowerCase();
      const keyword = String(graveyardKeywordGrant[4] || '').trim().toLowerCase();
      const costRaw = parseGraveyardKeywordAbilityCost(graveyardKeywordGrant[5]);
      return withMeta({
        kind: 'grant_graveyard_keyword_ability',
        who: { kind: 'you' },
        what: {
          kind: 'raw',
          text: normalizeGraveyardGrantSelector(
            String(graveyardKeywordGrant[2] || ''),
            String(graveyardKeywordGrant[3] || '')
          ),
        },
        keyword: keyword as 'unearth' | 'embalm' | 'eternalize',
        ...(costRaw ? { costRaw } : {}),
        duration: leadingDuration || trailingDuration === 'until end of turn' || trailingDuration === 'this turn' ? 'this_turn' : 'during_resolution',
        optional: true,
        raw: rawClause,
      });
    }

    const abilities = parseKeywordAbilityList(abilityText);
    const looksLikeGlobalGrant = /^(?:all|each|artifact|creature|sliver|auras?|basic\s+lands?|commanders?|commander\s+creatures?|[a-z][a-z -]+\s+spells?|[a-z][a-z -]+\s+creatures?)/i.test(targetText);
    if (abilities.length > 0 || looksLikeGlobalGrant) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(targetText),
        ...(abilities.length > 0 ? { abilities } : { effectText: [abilityText] }),
        duration: 'static',
        raw: rawClause,
      });
    }
  }

  const staticProtectionMatch = normalized.match(/^(.+?)\s+have\s+(protection\s+from\s+.+)$/i);
  if (staticProtectionMatch) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(staticProtectionMatch[1] || '').trim()),
      effectText: [String(staticProtectionMatch[2] || '').trim()],
      duration: 'static',
      raw: rawClause,
    });
  }

  const staticAsThoughSourceHadMatch = normalized.match(/^(.+?)\s+is\s+dealt\s+as\s+though\s+its\s+source\s+had\s+(.+)$/i);
  if (staticAsThoughSourceHadMatch) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(staticAsThoughSourceHadMatch[1] || '').trim()),
      effectText: [`is dealt as though its source had ${String(staticAsThoughSourceHadMatch[2] || '').trim()}`],
      duration: 'static',
      raw: rawClause,
    });
  }

  const staticAllAbleBlockMatch = normalized.match(
    /^all\s+creatures(?:\s+with\s+(.+?))?\s+able\s+to\s+block\s+(this\s+creature|this\s+permanent|~|equipped\s+creature|enchanted\s+creature|this\s+creature\s+or\s+enchanted\s+creature)\s+do\s+so$/i
  );
  if (staticAllAbleBlockMatch) {
    const qualifier = String(staticAllAbleBlockMatch[1] || '').trim();
    const effectText = [
      'all creatures',
      qualifier ? `with ${qualifier}` : '',
      'able to block it do so',
    ]
      .filter(Boolean)
      .join(' ');
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(staticAllAbleBlockMatch[2] || '').trim()),
      effectText: [effectText],
      duration: 'static',
      raw: rawClause,
    });
  }

  const staticLoseKeywordMatch = normalized.match(/^(.+?)\s+lose\s+(.+)$/i);
  if (staticLoseKeywordMatch) {
    const lossText = String(staticLoseKeywordMatch[2] || '').trim();
    const lostKeywords = parseKeywordAbilityList(lossText);
    if (lostKeywords.length > 0) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(staticLoseKeywordMatch[1] || '').trim()),
        effectText: [`lose ${lossText}`],
        duration: 'static',
        raw: rawClause,
      });
    }
  }

  const attacksEachCombatMatch = normalized.match(/^(.+?)\s+attacks\s+each\s+combat\s+if\s+able$/i);
  if (attacksEachCombatMatch) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(attacksEachCombatMatch[1] || '').trim()),
      effectText: ['attacks each combat if able'],
      duration: 'static',
      raw: rawClause,
    });
  }

  const attacksWithAllMatch = normalized.match(/^(.+?)\s+attacks?\s+with\s+all\s+creatures\s+(?:they|that player)\s+control\s+if\s+able$/i);
  if (attacksWithAllMatch) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(`creatures ${String(attacksWithAllMatch[1] || '').trim()} control`),
      effectText: ['attack each combat if able'],
      duration: 'static',
      raw: rawClause,
    });
  }

  const staticKeywordConditionalMatch = normalized.match(/^(.+?)\s+(?:has|have|gains?)\s+(.+?)\s+as\s+long\s+as\s+(.+)$/i);
  if (staticKeywordConditionalMatch) {
    const abilityText = String(staticKeywordConditionalMatch[2] || '').trim();
    const abilities = parseKeywordAbilityList(abilityText);
    if (abilities.length === 0 && STATIC_KEYWORD_ABILITIES.has(abilityText.toLowerCase())) abilities.push(abilityText.toLowerCase());
    if (abilities.length > 0) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(staticKeywordConditionalMatch[1] || '').trim()),
        abilities,
        effectText: [`as long as ${String(staticKeywordConditionalMatch[3] || '').trim()}`],
        duration: 'static',
        raw: rawClause,
      });
    }
  }

  const loseKeywordCantGainMatch = normalized.match(/^(.+?)\s+lose\s+(.+?)\s+and\s+can't\s+have\s+or\s+gain\s+(.+)$/i);
  if (loseKeywordCantGainMatch) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(loseKeywordCantGainMatch[1] || '').trim()),
      effectText: [
        `lose ${String(loseKeywordCantGainMatch[2] || '').trim()}`,
        `can't have or gain ${String(loseKeywordCantGainMatch[3] || '').trim()}`,
      ],
      duration: 'static',
      raw: rawClause,
    });
  }

  const staticPtKeywordAttackMatch = normalized.match(
    /^(.+?)\s+gets\s+([+-]?\d+)\s*\/\s*([+-]?\d+),\s+has\s+(.+?),\s+and\s+attacks\s+each\s+combat\s+if\s+able$/i
  );
  if (staticPtKeywordAttackMatch) {
    const power = parseSignedInt(staticPtKeywordAttackMatch[2]);
    const toughness = parseSignedInt(staticPtKeywordAttackMatch[3]);
    if (power === undefined || toughness === undefined) return null;
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(staticPtKeywordAttackMatch[1] || '').trim()),
      power,
      toughness,
      abilities: parseKeywordAbilityList(String(staticPtKeywordAttackMatch[4] || '').trim()),
      effectText: ['attacks each combat if able'],
      duration: 'static',
      raw: rawClause,
    });
  }

  const staticPtKeywordCantAttackMatch = normalized.match(
    /^(.+?)\s+gets\s+([+-]?\d+)\s*\/\s*([+-]?\d+),\s+has\s+(.+?),\s+and\s+can't\s+attack\s+(.+)$/i
  );
  if (staticPtKeywordCantAttackMatch) {
    const power = parseSignedInt(staticPtKeywordCantAttackMatch[2]);
    const toughness = parseSignedInt(staticPtKeywordCantAttackMatch[3]);
    if (power === undefined || toughness === undefined) return null;
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(staticPtKeywordCantAttackMatch[1] || '').trim()),
      power,
      toughness,
      abilities: parseKeywordAbilityList(String(staticPtKeywordCantAttackMatch[4] || '').trim()),
      effectText: [`can't attack ${String(staticPtKeywordCantAttackMatch[5] || '').trim()}`],
      duration: 'static',
      raw: rawClause,
    });
  }

  const staticPtQuotedHasAndIsMatch = normalized.match(
    /^(.+?)\s+gets\s+([+-]?\d+)\s*\/\s*([+-]?\d+),\s+has\s+"([^"]+)",\s+and\s+is\s+(.+)$/i,
  );
  if (staticPtQuotedHasAndIsMatch) {
    const power = parseSignedInt(staticPtQuotedHasAndIsMatch[2]);
    const toughness = parseSignedInt(staticPtQuotedHasAndIsMatch[3]);
    if (power === undefined || toughness === undefined) return null;
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(staticPtQuotedHasAndIsMatch[1] || '').trim()),
      power,
      toughness,
      effectText: [
        String(staticPtQuotedHasAndIsMatch[4] || '').trim(),
        `is ${String(staticPtQuotedHasAndIsMatch[5] || '').trim()}`,
      ],
      duration: /^(?:equipped|enchanted)\b/i.test(String(staticPtQuotedHasAndIsMatch[1] || '').trim()) ? 'while_attached' : 'static',
      raw: rawClause,
    });
  }

  const enchantedPermanentTypeRewriteMatch = normalized.match(
    /^enchanted permanent is (?:a|an) (.+?) with "([^"]+)" and loses all other abilities\.?$/i,
  );
  if (enchantedPermanentTypeRewriteMatch) {
    const typeLine = String(enchantedPermanentTypeRewriteMatch[1] || '').trim();
    const grantedAbility = String(enchantedPermanentTypeRewriteMatch[2] || '').trim();
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('enchanted permanent'),
      effectText: [`is ${typeLine} with "${grantedAbility}" and loses all other abilities`],
      duration: 'static',
      raw: rawClause,
    });
  }

  const staticPtKeywordStateMatch = normalized.match(
    /^(.+?)\s+gets\s+([+-]?\d+)\s*\/\s*([+-]?\d+),\s+has\s+(.+?),\s+and\s+(?:is|becomes)\s+(.+)$/i
  );
  if (staticPtKeywordStateMatch) {
    const power = parseSignedInt(staticPtKeywordStateMatch[2]);
    const toughness = parseSignedInt(staticPtKeywordStateMatch[3]);
    if (power === undefined || toughness === undefined) return null;
    const abilities = parseKeywordAbilityList(String(staticPtKeywordStateMatch[4] || '').trim());
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(staticPtKeywordStateMatch[1] || '').trim()),
      power,
      toughness,
      ...(abilities.length > 0 ? { abilities } : {}),
      effectText: [
        ...(abilities.length > 0 ? [] : [String(staticPtKeywordStateMatch[4] || '').trim()]),
        `is ${String(staticPtKeywordStateMatch[5] || '').trim()}`,
      ],
      duration: 'static',
      raw: rawClause,
    });
  }

  const staticAttacksCantAttackMatch = normalized.match(
    /^(.+?)\s+attacks\s+each\s+combat\s+if\s+able(?:,\s*((?:(?!\band\s+can't\s+attack\b).)+?))?\s+and\s+can't\s+attack\s+(.+)$/i
  );
  if (staticAttacksCantAttackMatch) {
    const middleText = String(staticAttacksCantAttackMatch[2] || '')
      .replace(/,+\s*$/g, '')
      .trim();
    const middleEffects = middleText
      ? middleText.split(/\s*,\s*/).map((part) => part.trim()).filter(Boolean)
      : [];
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(staticAttacksCantAttackMatch[1] || '').trim()),
      effectText: [
        'attacks each combat if able',
        ...middleEffects,
        `can't attack ${String(staticAttacksCantAttackMatch[3] || '').trim()}`,
      ],
      duration: 'static',
      raw: rawClause,
    });
  }

  const staticCantBeSacrificedMatch = normalized.match(/^(.+?)\s+can't be sacrificed$/i);
  if (staticCantBeSacrificedMatch) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(staticCantBeSacrificedMatch[1] || '').trim()),
      effectText: ["can't be sacrificed"],
      duration: 'static',
      raw: rawClause,
    });
  }

  const staticHasKeywordCantBlockedMatch = normalized.match(/^(.+?)\s+has\s+(.+?)\s+and\s+can't\s+be\s+blocked\s+by\s+(.+)$/i);
  if (staticHasKeywordCantBlockedMatch) {
    const abilityText = String(staticHasKeywordCantBlockedMatch[2] || '').trim();
    const abilities = parseKeywordAbilityList(abilityText);
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(staticHasKeywordCantBlockedMatch[1] || '').trim()),
      ...(abilities.length > 0 ? { abilities } : {}),
      effectText: [
        ...(abilities.length > 0 ? [] : [abilityText]),
        `can't be blocked by ${String(staticHasKeywordCantBlockedMatch[3] || '').trim()}`,
      ],
      duration: 'static',
      raw: rawClause,
    });
  }

  const losesAbilitiesBasePtMatch = normalized.match(/^(.+?)\s+lose(?:s)?\s+all\s+abilities\s+and\s+(?:is|becomes?)\s+(.+?)\s+with\s+base\s+power\s+and\s+toughness\s+(\d+)\s*\/\s*(\d+)(?:\s+.+)?$/i);
  if (losesAbilitiesBasePtMatch) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(losesAbilitiesBasePtMatch[1] || '').trim()),
      effectText: [normalized.replace(/^.+?\s+lose(?:s)?\s+all\s+abilities/i, 'lose all abilities')],
      duration: 'static',
      raw: rawClause,
    });
  }

  const loseKeywordAbilityWordMatch = normalized.match(
    /^(all\s+cards\s+in\s+all\s+zones)\s+lose\s+that\s+keyword\s+ability\s+or\s+ability\s+word\s+and\s+all\s+text\s+tied\s+to\s+that\s+ability$/i
  );
  if (loseKeywordAbilityWordMatch) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(loseKeywordAbilityWordMatch[1] || '').trim()),
      effectText: ['lose that keyword ability or ability word and all text tied to that ability'],
      duration: 'static',
      raw: rawClause,
    });
  }

  const staticBasePtTextMatch = normalized.match(/^(.+?)\s+(?:has|have)\s+base\s+power\s+and\s+toughness\s+(.+)$/i);
  if (staticBasePtTextMatch) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(staticBasePtTextMatch[1] || '').trim()),
      effectText: [`has base power and toughness ${String(staticBasePtTextMatch[2] || '').trim()}`],
      duration: 'static',
      raw: rawClause,
    });
  }

  const staticEqualPtMatch = normalized.match(/^(.+?)(?:'s|’s)\s+power\s+and\s+toughness\s+are\s+each\s+equal\s+to\s+(.+)$/i);
  if (staticEqualPtMatch) {
    if (/^(?:the\s+)?number\s+of\s+(?:lands\s+you\s+control|cards\s+in\s+your\s+hand|creatures\s+you\s+control)$/i.test(String(staticEqualPtMatch[2] || '').trim())) return null;
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(staticEqualPtMatch[1] || '').trim()),
      effectText: [`power and toughness are each equal to ${String(staticEqualPtMatch[2] || '').trim()}`],
      duration: 'static',
      raw: rawClause,
    });
  }

  const staticSeparateEqualPtMatch = normalized.match(/^(.+?)(?:'s|’s)\s+power\s+is\s+equal\s+to\s+(.+?)\s+and\s+(?:its|their)\s+toughness\s+is\s+equal\s+to\s+(.+)$/i);
  if (staticSeparateEqualPtMatch) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(staticSeparateEqualPtMatch[1] || '').trim()),
      effectText: [`power is equal to ${String(staticSeparateEqualPtMatch[2] || '').trim()}`, `toughness is equal to ${String(staticSeparateEqualPtMatch[3] || '').trim()}`],
      duration: 'static',
      raw: rawClause,
    });
  }

  const staticPowerEqualMatch = normalized.match(/^(.+?)(?:'s|’s)\s+power\s+is\s+equal\s+to\s+(.+)$/i);
  if (staticPowerEqualMatch) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(staticPowerEqualMatch[1] || '').trim()),
      effectText: [`power is equal to ${String(staticPowerEqualMatch[2] || '').trim()}`],
      duration: 'static',
      raw: rawClause,
    });
  }

  const staticNoCombatDamageMatch = normalized.match(/^(.+?)\s+assigns?\s+no\s+combat\s+damage$/i);
  if (staticNoCombatDamageMatch) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(staticNoCombatDamageMatch[1] || '').trim()),
      effectText: ['assigns no combat damage'],
      duration: 'static',
      raw: rawClause,
    });
  }

  const staticHasAllAbilitiesMatch = normalized.match(/^(.+?)\s+(?:has|have)\s+all\s+activated\s+abilities\s+of\s+(.+)$/i);
  if (staticHasAllAbilitiesMatch) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(staticHasAllAbilitiesMatch[1] || '').trim()),
      effectText: [`has all activated abilities of ${String(staticHasAllAbilitiesMatch[2] || '').trim()}`],
      duration: 'static',
      raw: rawClause,
    });
  }

  const basePtHasLosesMatch = normalized.match(/^(.+?)\s+is\s+(.+?)\s+with\s+base\s+power\s+and\s+toughness\s+(\d+)\s*\/\s*(\d+)\s+and\s+has\s+(.+?),\s+and\s+it\s+loses\s+(.+)$/i);
  if (basePtHasLosesMatch) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(basePtHasLosesMatch[1] || '').trim()),
      effectText: [normalized.replace(/^.+?\s+is\s+/i, 'is ')],
      duration: 'static',
      raw: rawClause,
    });
  }

  const cantActivateNonManaMatch = normalized.match(/^(.+?)\s+activated\s+abilities\s+can't\s+be\s+activated\s+unless\s+they're\s+mana\s+abilities$/i);
  if (cantActivateNonManaMatch) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(cantActivateNonManaMatch[1] || '').trim()),
      effectText: ["activated abilities can't be activated unless they're mana abilities"],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (/^lands\s+you\s+control\s+are\s+every\s+basic\s+land\s+type\s+in\s+addition\s+to\s+their\s+other\s+types$/i.test(normalized)) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('lands you control'),
      effectText: ['are every basic land type in addition to their other types'],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (/^lands\s+you\s+control\s+enter\s+untapped$/i.test(normalized)) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('lands you control'),
      effectText: ['enter untapped'],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (/^players\s+play\s+with\s+the\s+top\s+card\s+of\s+their\s+libraries\s+revealed$/i.test(normalized)) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('players'),
      effectText: ['play with the top card of their libraries revealed'],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (/^players\s+play\s+with\s+their\s+hands\s+revealed$/i.test(normalized)) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('players'),
      effectText: ['play with their hands revealed'],
      duration: 'static',
      raw: rawClause,
    });
  }

  const temporaryLoseKeywordMatch = normalized.match(/^(.+?)\s+lose\s+([a-z, ]+)\s+until\s+end\s+of\s+turn$/i);
  if (temporaryLoseKeywordMatch) {
    return withMeta({
      kind: 'grant_temporary_ability',
      target: parseObjectSelector(String(temporaryLoseKeywordMatch[1] || '').trim()),
      effectText: [`lose ${String(temporaryLoseKeywordMatch[2] || '').trim()}`],
      duration: 'end_of_turn',
      raw: rawClause,
    });
  }

  const basePtLosesMatch = normalized.match(/^(.+?)\s+is\s+(.+?)\s+with\s+base\s+power\s+and\s+toughness\s+(\d+)\s*\/\s*(\d+)\s+and\s+loses\s+(.+)$/i);
  if (basePtLosesMatch) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(basePtLosesMatch[1] || '').trim()),
      effectText: [normalized.replace(/^.+?\s+is\s+/i, 'is ')],
      duration: 'static',
      raw: rawClause,
    });
  }

  const genericGrantMatch = normalized.match(/^(.+?)\s+(?:has|have|gains?|gain)\s+(.+)$/i);
  if (!genericGrantMatch) return null;

  const targetText = String(genericGrantMatch[1] || '').trim();
  const tail = String(genericGrantMatch[2] || '').trim();
  if (/\bgraveyard\b/i.test(targetText) || /^until\s+end\s+of\s+turn,?\s+/i.test(normalized)) return null;
  if (isEphemeralGrantedAbilityTarget(targetText)) return null;
  if (/^(?:it|they)$/i.test(targetText) && /^"?sacrifice this token:\s*add\s+\{c\}/i.test(tail)) return null;
  const effectText = extractQuotedAbilityText(tail);
  const abilities = parseKeywordAbilityList(tail);
  const wardCostMatch = tail.match(/\bward\s+\{[^}]+\}/i);
  if (!effectText.length && !abilities.length && !wardCostMatch) return null;

  return withMeta({
    kind: 'grant_static_ability',
    target: parseObjectSelector(targetText),
    ...(abilities.length > 0 ? { abilities } : {}),
    ...(effectText.length > 0 ? { effectText } : {}),
    duration: 'static',
    raw: rawClause,
  });
}

export { tryParseRulesTextClause } from './oracleIRParserStaticAbilityClauses-handlers/oracleIRParserStaticAbilityRulesTextClause';
