/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: leftover detectSpellCastTriggers inner condition/metadata helpers
 * Public: getSpellCastConditionData, getSpellCastEffectMetadata
 */

import type { SpellCastTrigger } from "./spell-cast-trigger-type.js";
export function getSpellCastConditionData(spellType: string): Pick<SpellCastTrigger, 'spellCondition' | 'tribalType'> {
    let spellCondition: SpellCastTrigger['spellCondition'] = 'any';
    let tribalType: string | undefined;

    const normalizedType = spellType.replace(/\s+/g, ' ').trim();
    if (normalizedType === 'creature' || (normalizedType.includes('creature') && !normalizedType.includes('noncreature'))) {
      spellCondition = 'creature';
    } else if (normalizedType === 'noncreature' || normalizedType.includes('noncreature')) {
      spellCondition = 'noncreature';
    } else if (normalizedType === 'colorless') {
      spellCondition = 'colorless';
    } else if (normalizedType === 'historic') {
      spellCondition = 'historic';
    } else if (
      normalizedType === 'instant' ||
      normalizedType === 'sorcery' ||
      normalizedType === 'instant or sorcery' ||
      /^instant,?\s*sorcery(?:,?\s*or\s+[\w\s]+)?$/i.test(normalizedType)
    ) {
      spellCondition = 'instant_sorcery';
      const wizardMatch = normalizedType.match(/or\s+(\w+)\s*$/i);
      if (wizardMatch && !['spell', 'sorcery', 'instant'].includes(wizardMatch[1].toLowerCase())) {
        spellCondition = 'tribal_type';
        tribalType = wizardMatch[1].toLowerCase();
      }
    } else if (['green', 'blue', 'red', 'white', 'black'].includes(normalizedType)) {
      spellCondition = 'color';
      tribalType = normalizedType;
    } else if (!['a', 'an', 'spell', ''].includes(normalizedType)) {
      spellCondition = 'tribal_type';
      tribalType = normalizedType;
    }

    return { spellCondition, tribalType };
}

export function getSpellCastEffectMetadata(lowerOracle: string, effectText: string, tribalType?: string) {
    const copiesSpell = effectText.toLowerCase().includes('copy that spell') || effectText.toLowerCase().includes('copy it');
    const isTapUntap = lowerOracle.includes('tap or untap') ||
      lowerOracle.includes('untap target') ||
      lowerOracle.includes('tap target');
    const tokenMatch = effectText.match(/create (?:a |an )?(\d+)\/(\d+)[^.]*token/i);
    let createsToken = false;
    let tokenDetails: SpellCastTrigger['tokenDetails'];

    if (tokenMatch || lowerOracle.includes('create a') && lowerOracle.includes('token')) {
      createsToken = true;
      const tokenPowerMatch = effectText.match(/(\d+)\/(\d+)/);
      if (tokenPowerMatch) {
        const typeMatch = effectText.match(/(\d+\/\d+)\s+(white|blue|black|red|green|colorless)?\s*((?:\w+\s+)*\w+)\s+(?:artifact\s+)?creature\s+token/i);
        const tokenColor = String(typeMatch?.[2] || '').trim().toLowerCase();
        const rawTokenType = String(typeMatch?.[3] || tribalType || 'Token').trim();
        const tokenTypeDisplay = rawTokenType
          .split(/\s+/)
          .filter(Boolean)
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
          .join(' ') || 'Token';
        const abilityMatch = effectText.match(/token\s+with\s+([^.]+)/i);
        const abilities = abilityMatch
          ? abilityMatch[1]
              .split(/\s+and\s+|,\s*/i)
              .map((ability) => ability.trim().toLowerCase().replace(/^"+|"+$/g, '').replace(/\.$/, ''))
              .filter(Boolean)
          : undefined;
        const isArtifact = effectText.toLowerCase().includes('artifact creature token');

        tokenDetails = {
          // Color belongs on `colors`, not the display name ("Blue Merfolk" → "Merfolk").
          name: tokenTypeDisplay,
          power: parseInt(tokenPowerMatch[1]),
          toughness: parseInt(tokenPowerMatch[2]),
          types: `${isArtifact ? 'Artifact ' : ''}Creature — ${tokenTypeDisplay}`,
          ...(tokenColor ? { colors: [tokenColor] } : {}),
          abilities,
        };
      }
    }

    return {
      copiesSpell,
      isTapUntap,
      createsToken,
      tokenDetails,
      isOptional: effectText.toLowerCase().includes('you may'),
    };
}
