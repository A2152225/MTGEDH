// Origin parent: rules-engine/src/CardAnalyzer.ts
// Cluster moved: CardAnalyzer.analyzeDeck.
// Public entry symbols: analyzeDeck.
// Class methods become thin wrappers that call these via .call(this, ...).
// Leaf must not import CardAnalyzer.ts or CardAnalyzer-handlers/index.ts.

import type { KnownCardRef } from '../../../shared/src';
import { PATTERNS } from './cardAnalyzerPatterns';
import { KNOWN_COMBOS } from './cardAnalyzerKnownCombos';
import { CardCategory, SynergyArchetype } from './cardAnalyzerTypes';
import type { DeckArchetypeProfile } from './cardAnalyzerTypes';

/** CardAnalyzer instance passed as `this` from CardAnalyzer thin wrappers. */
export type CardAnalyzerHost = any;

/**
 * Analyze a deck or visible card pool and summarize its main themes.
 */
export function analyzeDeck(this: CardAnalyzerHost, cards: readonly KnownCardRef[]): DeckArchetypeProfile {
    const categoryCounts: Record<string, number> = {};
    const synergyTagCounts: Record<string, number> = {};
    const archetypeScores: Record<string, number> = {};
    const comboPairs: string[] = [];
    const comboPairKeys = new Set<string>();
    const keyCards: string[] = [];
    const nameToCard = new Map<string, KnownCardRef>();
    const subtypeCounts: Record<string, number> = {};

    let landCount = 0;
    let cmcTotal = 0;
    let nonLandCount = 0;
    let lowCurve = 0;
    let midCurve = 0;
    let highCurve = 0;
    let instantSorceryCount = 0;
    let artifactCount = 0;
    let enchantmentCount = 0;
    let auraEquipmentCount = 0;
    let groupHugCount = 0;
    let politicsScore = 0;
    let goadPoliticsCount = 0;
    let tribalEngineScore = 0;
    let comboPotentialCount = 0;

    for (const card of cards) {
      const analysis = this.analyzeCard(card);
      const cardData = this.extractCardData(card);
      const typeLine = cardData.typeLine.toLowerCase();
      const oracleText = cardData.oracleText.toLowerCase();
      const lowerName = cardData.name.toLowerCase();
      const searchableText = `${lowerName} ${oracleText}`;

      nameToCard.set(lowerName, card);

      if (typeLine.includes('land')) {
        landCount += 1;
      } else {
        nonLandCount += 1;
        cmcTotal += Math.max(0, Number(cardData.cmc) || 0);
        if (cardData.cmc <= 2) {
          lowCurve += 1;
        } else if (cardData.cmc <= 4) {
          midCurve += 1;
        } else {
          highCurve += 1;
        }
      }

      if (typeLine.includes('instant') || typeLine.includes('sorcery')) instantSorceryCount += 1;
      if (typeLine.includes('artifact')) artifactCount += 1;
      if (typeLine.includes('enchantment')) enchantmentCount += 1;
      const isGoadPoliticsAuraEquip =
        PATTERNS.POLITICS_GOAD_EQUIPMENT.test(searchableText)
        || (PATTERNS.GOAD.test(oracleText) && (typeLine.includes('aura') || typeLine.includes('equipment')))
        || (PATTERNS.POLITICS_ATTACH_OPPONENT.test(oracleText) && (typeLine.includes('aura') || typeLine.includes('equipment')));
      if ((typeLine.includes('aura') || typeLine.includes('equipment')) && !isGoadPoliticsAuraEquip) {
        auraEquipmentCount += 1;
      }
      if (isGoadPoliticsAuraEquip) {
        goadPoliticsCount += 1;
        politicsScore += 5;
      }
      if (PATTERNS.POLITICS_SYMMETRIC.test(oracleText)) groupHugCount += 1;
      if (PATTERNS.GOAD.test(oracleText)) {
        politicsScore += 4;
        if (typeLine.includes('creature') || typeLine.includes('planeswalker')) goadPoliticsCount += 1;
      }
      if (PATTERNS.POLITICS_FIELD_SWAP.test(oracleText)) politicsScore += 5;
      if (PATTERNS.POLITICS_LIFE_SWAP.test(oracleText)) politicsScore += 5;
      if (PATTERNS.POLITICS_PILLOW_FORT.test(oracleText)) politicsScore += 3;
      if (PATTERNS.POLITICS_DEFection.test(oracleText)) politicsScore += 4;
      if (PATTERNS.POLITICS_PUNISHMENT.test(searchableText)) {
        politicsScore += 3;
        goadPoliticsCount += 1;
      }
      if (typeLine.includes('creature') && PATTERNS.POLITICS_GOAD_COMMANDER.test(oracleText)) {
        politicsScore += 6;
        goadPoliticsCount += 2;
      }
      if (/\bmonarch\b|\bvote\b|become the monarch/i.test(oracleText)) politicsScore += 2;
      if (typeLine.includes('land') && /can't be blocked|double strike|unblockable/i.test(oracleText)) {
        politicsScore += 2;
      }
      if (PATTERNS.TRIBAL_KINDRED.test(searchableText)) tribalEngineScore += 3;
      if (PATTERNS.TRIBAL_ANTHEM.test(oracleText)) tribalEngineScore += 2;
      if (PATTERNS.TRIBAL_TOKEN_PAYOFF.test(oracleText)) tribalEngineScore += 3;
      if (PATTERNS.TRIBAL_COUNTER_LOCK.test(oracleText)) tribalEngineScore += 6;
      if (PATTERNS.TRIBAL_MILL_ENGINE.test(oracleText)) tribalEngineScore += 4;
      if (PATTERNS.TRIBAL_MANA_ENGINE.test(oracleText)) tribalEngineScore += 4;

      if (analysis.comboPotential >= 7) {
        comboPotentialCount += 1;
        keyCards.push(cardData.name);
      }
      if (analysis.categories.includes(CardCategory.FINISHER) ||
          analysis.categories.includes(CardCategory.TUTOR) ||
          analysis.categories.includes(CardCategory.COMMANDER)) {
        keyCards.push(cardData.name);
      }

      for (const category of analysis.categories) {
        categoryCounts[category] = (categoryCounts[category] || 0) + 1;
      }
      for (const tag of analysis.synergyTags) {
        synergyTagCounts[tag] = (synergyTagCounts[tag] || 0) + 1;
      }

      if (typeLine.includes('creature') && typeLine.includes('—')) {
        const subtypePart = typeLine.split('—')[1] || '';
        for (const subtype of subtypePart.split(/\s+/).map((value) => value.trim()).filter(Boolean)) {
          subtypeCounts[subtype] = (subtypeCounts[subtype] || 0) + 1;
        }
      }

      const partners = KNOWN_COMBOS[lowerName] || [];
      for (const partnerName of partners) {
        const matchedPartner = Array.from(nameToCard.keys()).find(
          (candidate) => candidate.includes(partnerName) || partnerName.includes(candidate)
        );
        if (!matchedPartner) continue;
        const pairNames = [lowerName, matchedPartner].sort();
        const comboKey = pairNames.join('|');
        if (comboPairKeys.has(comboKey)) continue;
        comboPairKeys.add(comboKey);
        comboPairs.push(`${cardData.name} + ${(nameToCard.get(matchedPartner) as KnownCardRef).name}`);
      }
    }

    const getCategoryCount = (category: CardCategory) => categoryCounts[category] || 0;
    const getTagCount = (tag: string) => synergyTagCounts[tag] || 0;

    const dominantSubtypeEntry = Object.entries(subtypeCounts).sort((left, right) => right[1] - left[1])[0];
    const dominantSubtypeCount = dominantSubtypeEntry?.[1] ?? 0;

    archetypeScores[SynergyArchetype.TRIBAL] =
      (dominantSubtypeCount >= 5 ? dominantSubtypeCount : 0)
      + tribalEngineScore
      + (dominantSubtypeCount >= 12 ? 8 : dominantSubtypeCount >= 8 ? 4 : 0);
    if (tribalEngineScore > 0) {
      synergyTagCounts.tribal_engine = tribalEngineScore;
    }
    if (dominantSubtypeEntry?.[0]) {
      synergyTagCounts[`tribe_${dominantSubtypeEntry[0]}`] = dominantSubtypeCount;
    }

    if (goadPoliticsCount > 0) {
      synergyTagCounts.goad_politics = goadPoliticsCount;
    }

    archetypeScores[SynergyArchetype.ARISTOCRATS] =
      getCategoryCount(CardCategory.SACRIFICE_OUTLET) * 3 +
      getCategoryCount(CardCategory.ARISTOCRAT) * 3 +
      getCategoryCount(CardCategory.DEATH_TRIGGER) * 2 +
      getTagCount('aristocrats') * 2;

    archetypeScores[SynergyArchetype.TOKENS] =
      getCategoryCount(CardCategory.TOKEN_GENERATOR) * 3 +
      getTagCount('tokens') * 2 +
      Math.min(getCategoryCount(CardCategory.TOKEN_GENERATOR), getCategoryCount(CardCategory.ARISTOCRAT) + getCategoryCount(CardCategory.SACRIFICE_OUTLET));

    archetypeScores[SynergyArchetype.GRAVEYARD] =
      getCategoryCount(CardCategory.REANIMATOR) * 3 +
      getTagCount('graveyard') * 3 +
      getCategoryCount(CardCategory.DEATH_TRIGGER);

    archetypeScores[SynergyArchetype.LANDFALL] =
      getCategoryCount(CardCategory.LANDFALL) * 4 +
      getCategoryCount(CardCategory.RAMP) * 2 +
      getTagCount('landfall') * 2;

    archetypeScores[SynergyArchetype.SPELLSLINGER] = getTagCount('spellslinger') * 3 + Math.floor(instantSorceryCount / 3);
    archetypeScores[SynergyArchetype.COUNTERS] = getTagCount('counters') * 3;
    archetypeScores[SynergyArchetype.ARTIFACTS] = getTagCount('artifacts') * 2 + Math.floor(artifactCount / 3);
    archetypeScores[SynergyArchetype.ENCHANTMENTS] = getTagCount('enchantments') * 2 + Math.floor(enchantmentCount / 3);
    archetypeScores[SynergyArchetype.VOLTRON] = Math.max(
      0,
      getTagCount('voltron') * 3 + Math.floor(auraEquipmentCount / 2) - goadPoliticsCount * 4,
    );
    archetypeScores[SynergyArchetype.COMBO] = comboPairs.length * 4 + comboPotentialCount * 2;
    archetypeScores[SynergyArchetype.STAX] = getTagCount('stax') * 3;
    archetypeScores[SynergyArchetype.GROUP_HUG] = groupHugCount * 3;
    archetypeScores[SynergyArchetype.POLITICS] = politicsScore;

    const primaryArchetypes = Object.entries(archetypeScores)
      .filter(([, score]) => score >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([archetype]) => archetype as SynergyArchetype);

    return {
      totalCards: cards.length,
      landCount,
      averageCmc: nonLandCount > 0 ? Number((cmcTotal / nonLandCount).toFixed(2)) : 0,
      curve: {
        low: lowCurve,
        mid: midCurve,
        high: highCurve,
      },
      categoryCounts,
      synergyTagCounts,
      archetypeScores,
      primaryArchetypes,
      comboPairs,
      keyCards: Array.from(new Set(keyCards)).slice(0, 10),
    };
  }
