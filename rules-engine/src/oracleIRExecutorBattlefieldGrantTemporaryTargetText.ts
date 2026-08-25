// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: inferGrantTemporaryAbilityTargetFromRaw, normalizeGrantTemporaryAbilityTargetText.
// Public entries: those two helpers (imported by the parent and other battlefield steps).

import { normalizeBattlefieldTargetReferenceText } from './oracleIRExecutorBattlefieldTargetReferenceText';

export function inferGrantTemporaryAbilityTargetFromRaw(raw: string): string {
  const normalized = String(raw || '')
    .replace(/\u2019/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/^tiered\s+/i, '')
    .replace(/^when you do,\s*/i, '')
    .replace(/^-\s*/i, '')
    .replace(/^(?:\{[^}]+\}\s*)+-\s*/i, '')
    .replace(/^(?:until end of turn,\s*|until your next turn,\s*|until the end of\b[^,]+,\s*)?/i, '')
    .replace(/^(?:whenever this creature attacks,\s*|whenever a creature enters under your control,\s*)?/i, '')
    .replace(/^(?:[ivxlcdm]+|\d+\s*-\s*\d+)\s*[-|]\s*/i, '')
    .replace(/^(?:bull rush|standoff|daybound)\s*-?\s*/i, '')
    .replace(/\s+(?:also\s+)?(?:get|gain)\s+.+$/i, '')
    .replace(/\s+gets?\s+.+$/i, '')
    .replace(/\s+can't be blocked.*$/i, '')
    .replace(/\s+assigns combat damage.*$/i, '')
    .trim();
  const whenDiscardMatch = normalized.match(
    /when you discard a creature card this way,\s*(target creature you control)\b/i
  );
  if (whenDiscardMatch) return String(whenDiscardMatch[1] || '').trim();
  const tieredTargetMatch = normalized.match(/\b(target creature you control)\b/i);
  if (tieredTargetMatch) return String(tieredTargetMatch[1] || '').trim();
  if (!normalized) return '';
  if (/creatures of the creature type of your choice/i.test(normalized)) {
    return 'creatures of the chosen creature type you control';
  }
  if (/^this (?:creature|permanent)\b/i.test(normalized)) return 'this creature';
  if (/^(?:it|he)\b/i.test(normalized)) return 'it';
  if (/^that artifact\b/i.test(normalized)) return 'that artifact';
  if (/^enchanted creature\b/i.test(normalized)) return 'enchanted creature';
  if (/^you\b/i.test(normalized)) return 'you';
  if (/^each opponent\b/i.test(normalized)) return 'each opponent';
  if (/^the next\b/i.test(normalized)) {
    const nextSpellMatch = normalized.match(/^(the next (?:.+?\s+)?spell you cast(?: this turn)?)/i);
    return nextSpellMatch ? String(nextSpellMatch[1] || '').trim() : 'the next spell you cast';
  }
  if (/^the creature dealt damage\b/i.test(normalized)) return 'that creature';
  if (/^all damage\b/i.test(normalized)) return 'enchanted creature';
  if (/^face-down spells\b/i.test(normalized)) return 'you';
  if (/^creature cards in your graveyard\b/i.test(normalized)) return 'creature cards in your graveyard';
  if (/^creatures named this permanent\b/i.test(normalized)) return 'creatures named this permanent';
  if (/^all creatures banded with it\b/i.test(normalized)) return 'all creatures banded with it';
  const equippedMatch = normalized.match(/(?:during your turn,\s*)?(equipped creature)\s+(?:gets?|gains?|has)\b/i);
  if (equippedMatch) return String(equippedMatch[1] || '').trim();
  const attackingYouControl = normalized.match(/^(attacking creatures you control)\b/i);
  if (attackingYouControl) return String(attackingYouControl[1] || '').trim();
  const attackingMassMatch = normalized.match(/^(attacking creatures)\s+(?:get|gain)\b/i);
  if (attackingMassMatch) return String(attackingMassMatch[1] || '').trim();
  const otherAttackingMatch = normalized.match(/^(other(?: red)? attacking creatures(?: you control)?)\b/i);
  if (otherAttackingMatch) return String(otherAttackingMatch[1] || '').trim();
  const withQualifierMass = normalized.match(/^(creatures you control with [^,]+?)(?:\s+(?:get|gain)\b|$)/i);
  if (withQualifierMass) return String(withQualifierMass[1] || '').trim();
  const multiSubtypeMatch = normalized.match(
    /^each ([a-z][a-z -]+(?:,\s*[a-z][a-z -]+)*(?:,?\s+and\s+[a-z][a-z -]+)?) you control$/i
  );
  if (multiSubtypeMatch) return `each ${String(multiSubtypeMatch[1] || '').trim()} you control`;
  const eachWithQualifier = normalized.match(/^each (creatures you control with [^,]+)$/i);
  if (eachWithQualifier) return String(eachWithQualifier[1] || '').trim();
  const eachSingularWithQualifier = normalized.match(
    /^each creature you control with ([^,]+?)(?:\s+(?:assigns?|gain|get)\b|$)/i
  );
  if (eachSingularWithQualifier) {
    return `creatures you control with ${String(eachSingularWithQualifier[1] || '').trim()}`;
  }
  const subtypeMassMatch = normalized.match(/^([a-z][a-z -]+) creatures you control(?: also)?$/i);
  if (subtypeMassMatch) return `${String(subtypeMassMatch[1] || '').trim()} creatures you control`;
  if (/^target creature$/i.test(normalized)) return 'target creature';
  if (/^target permanent$/i.test(normalized)) return 'target permanent';
  if (/^target planeswalker$/i.test(normalized)) return 'target planeswalker';
  const subtypeYouControlMatch = normalized.match(/^([a-z][a-z -]+) you control(?: also)?$/i);
  if (subtypeYouControlMatch && !/creatures?$/i.test(String(subtypeYouControlMatch[1] || ''))) {
    return `${String(subtypeYouControlMatch[1] || '').trim()} you control`;
  }
  const globalSubtypeMatch = normalized.match(/^([a-z][a-z -]+) creatures\s+(?:gain|get)\b/i);
  if (globalSubtypeMatch) return `${String(globalSubtypeMatch[1] || '').trim()} creatures`;
  const tokenMassMatch = normalized.match(/^(creature tokens you control)\s+gain\b/i);
  if (tokenMassMatch) return String(tokenMassMatch[1] || '').trim();
  const compoundMassMatch = normalized.match(/^(gorgons and snakes you control)\b/i);
  if (compoundMassMatch) return String(compoundMassMatch[1] || '').trim();
  const upToAttackingMatch = normalized.match(/^(up to x target attacking creatures)\b/i);
  if (upToAttackingMatch) return String(upToAttackingMatch[1] || '').trim();
  const xTargetCreaturesMatch = normalized.match(/^(x target creatures)\b/i);
  if (xTargetCreaturesMatch) return String(xTargetCreaturesMatch[1] || '').trim();
  const spellCostReductionMatch = normalized.match(
    /^((?:artifact,? )?(?:instant,? )?(?:and )?sorcery )?spells? you cast(?: this turn)? cost\b/i
  );
  if (spellCostReductionMatch) return 'you';
  const massYouControl = normalized.match(/^(creatures you control(?:\s+other\s+than\s+this\s+creature)?)\s+(?:get|gain)\b/i);
  if (massYouControl) return String(massYouControl[1] || '').trim();
  const otherMass = normalized.match(/^(other creatures you control)\s+(?:get|gain)\b/i);
  if (otherMass) return String(otherMass[1] || '').trim();
  const faceUpMass = normalized.match(/^(face-up nontoken creatures you control)\b/i);
  if (faceUpMass) return String(faceUpMass[1] || '').trim();
  return '';
}


export function normalizeGrantTemporaryAbilityTargetText(value: string, stepRaw = ''): string {
  const trimmed = normalizeBattlefieldTargetReferenceText(value)
    .replace(/^tiered\s+/i, '')
    .replace(/^when you do,\s*/i, '')
    .replace(/\s+and\s*$/i, '')
    .replace(/^-\s*/i, '')
    .replace(/^whenever this creature attacks,\s*/i, '')
    .replace(/^activate only as a sorcery\.?\s*["']?\s*(?:\{[^}]+\}(?:,\s*[^:]{0,120})?:\s*)+/i, '')
    .replace(/^choose one at random\s*-\s*•\s*/i, '')
    .replace(/^you may have\s+/i, '')
    .replace(/^have\s+/i, '')
    .replace(/^until end of turn,\s*/i, '')
    .replace(/^until the end of your next turn,\s*/i, '')
    .replace(/^until your next turn,\s*/i, '')
    .replace(/^during your turn,\s*/i, '')
    .replace(/^(?:[ivxlcdm]+|\d+\s*-\s*\d+)\s*[-|]\s*/i, '')
    .replace(/^(?:bull rush|standoff|daybound)\s*-\s*/i, '')
    .replace(/\s+each\s+get\s+[+-]?\d+\s*\/\s*[+-]?\d(?:\s+and)?\s*$/i, '')
    .replace(/\s+gets?\s+[+-]?\d+\s*\/\s*[+-]?\d(?:\s+and)?\s*$/i, '')
    .replace(
      /\s+assigns\s+combat\s+damage\s+equal\s+to\s+its\s+toughness\s+rather\s+than\s+its\s+power(?:\s+and)?\s*$/i,
      ''
    )
    .replace(/\s+and$/i, '')
    .trim();
  const whenDiscardMatch = trimmed.match(
    /when you discard a creature card this way,\s*(target creature you control)\b/i
  );
  if (whenDiscardMatch) return String(whenDiscardMatch[1] || '').trim();
  const embeddedTargetMatch = trimmed.match(/\b(target creature you control)\b/i);
  if (embeddedTargetMatch && /^tiered\b/i.test(value)) {
    return String(embeddedTargetMatch[1] || '').trim();
  }
  if (/^each creature you control with defender$/i.test(trimmed)) {
    return 'creatures you control with defender';
  }
  if (/^this creature(?:'s base power)?$/i.test(trimmed)) return 'this creature';
  const selfBecome = trimmed.match(/^(this (?:enchantment|permanent|creature))(?:\s+becomes|\s+become)\b/i);
  if (selfBecome) return String(selfBecome[1] || '').trim();
  const itBecome = trimmed.match(/^(it)\s+become\b/i);
  if (itBecome) return String(itBecome[1] || '').trim();
  const mass = trimmed.match(/^(creatures you control(?:\s+other\s+than\s+this\s+creature)?)\s+get\b/i);
  if (mass) return String(mass[1] || '').trim();
  const otherMass = trimmed.match(/^(other .+ you control)(?: with .+)?\s+(?:get|gain)\b/i);
  if (otherMass) return String(otherMass[1] || '').trim();
  const self = trimmed.match(/^(this creature)\s+(?:gets?|has\s+base\s+power)\b/i);
  if (self) return String(self[1] || '').trim();
  const enchanted = trimmed.match(/^(enchanted creature)\s+(?:gets?|gains?)\b/i);
  if (enchanted) return String(enchanted[1] || '').trim();
  const contextual = trimmed.match(
    /^(that creature|that permanent|that card|that vehicle|that planeswalker|they)\s+(?:gets?|gains?)\b/i
  );
  if (contextual) return String(contextual[1] || '').trim();
  const pronounOnly = trimmed.match(/^(they)\s+(?:gets?|gains?)\b/i);
  if (pronounOnly) return String(pronounOnly[1] || '').trim();
  const counterMass = trimmed.match(/^(each creature you control with a counter on it)\s+gains?\b/i);
  if (counterMass) return String(counterMass[1] || '').trim();
  const compoundMass = trimmed.match(/^(it and zombies you control)\s+gain\b/i);
  if (compoundMass) return String(compoundMass[1] || '').trim();
  const playerSpell = trimmed.match(/^(the next (?:.+?\s+)?spell you cast)(?: this turn)?\s+costs?\b/i);
  if (playerSpell) return String(playerSpell[1] || '').trim();
  if (/^the creature dealt damage\b/i.test(trimmed)) return 'that creature';
  const haveMass = trimmed.match(/^have (treasures you control)\b/i);
  if (haveMass) return String(haveMass[1] || '').trim();
  const graveyardCards = trimmed.match(/^(creature cards in your graveyard)\s+gain\b/i);
  if (graveyardCards) return String(graveyardCards[1] || '').trim();
  const otherResult = trimmed.match(/^for each other result, (it)\b/i);
  if (otherResult) return 'it';
  const attackingHuman = trimmed.match(/^(each attacking human)(?:\s+(?:gets?|gains?|gain))\b/i);
  if (attackingHuman) return String(attackingHuman[1] || '').trim();
  const chosenTypeMass = trimmed.match(/^creatures of the creature type of your choice\s+(?:get|gain)\b/i);
  if (chosenTypeMass) return 'creatures of the chosen creature type you control';
  if (/^other clues you control$/i.test(trimmed)) return 'other clues you control';
  const otherClues = trimmed.match(/^(other clues you control)\s+become\b/i);
  if (otherClues) return String(otherClues[1] || '').trim();
  const targetCreatureBuff = trimmed.match(/^(target creature you control)\s+get\b/i);
  if (targetCreatureBuff) return String(targetCreatureBuff[1] || '').trim();
  if (/^the chosen creature$/i.test(trimmed)) return 'the chosen creature';
  if (/^the creature that attacked$/i.test(trimmed)) return 'the creature that attacked';
  if (/^that mount or vehicle$/i.test(trimmed)) return 'that mount or vehicle';
  if (/^creature tokens you control$/i.test(trimmed)) return 'creature tokens you control';
  if (/^attacking creatures$/i.test(trimmed)) return 'attacking creatures';
  const subtypeCreatures = trimmed.match(/^([a-z][a-z -]+) creatures you control$/i);
  if (subtypeCreatures) return `${String(subtypeCreatures[1] || '').trim()} creatures you control`;
  if (/^gorgons and snakes you control$/i.test(trimmed)) return 'gorgons and snakes you control';
  if (/^that player$/i.test(trimmed)) return 'that player';
  if (/^that attacking creature$/i.test(trimmed)) return 'that attacking creature';
  const otherThanSelfMass = trimmed.match(
    /^([a-z][a-z -]+) you control other than this creature(?:\s+(?:get|gain)\b.*)?$/i
  );
  if (otherThanSelfMass) return `${String(otherThanSelfMass[1] || '').trim()} you control other than this creature`;
  const withQualifierMass = trimmed.match(/^(creatures you control with [^,]+?)(?:\s+(?:get|gain)\b.*)?$/i);
  if (withQualifierMass) return String(withQualifierMass[1] || '').trim();
  const subtypeYouControl = trimmed.match(/^([a-z][a-z -]+) you control$/i);
  if (subtypeYouControl && !/creatures?$/i.test(String(subtypeYouControl[1] || ''))) {
    return `${String(subtypeYouControl[1] || '').trim()} you control`;
  }
  const upToAttackingOnly = trimmed.match(/^(up to x target attacking creatures)/i);
  if (upToAttackingOnly) return String(upToAttackingOnly[1] || '').trim();
  const globalSubtype = trimmed.match(/^([a-z][a-z -]+) creatures$/i);
  if (globalSubtype && !/^up to\b/i.test(trimmed)) return `${String(globalSubtype[1] || '').trim()} creatures`;
  if (/^attacking creatures you control$/i.test(trimmed)) return 'attacking creatures you control';
  if (/^other red attacking creatures you control$/i.test(trimmed)) return 'other red attacking creatures you control';
  if (/^other attacking creatures(?: gain)?$/i.test(trimmed)) return 'other attacking creatures';
  if (/^face-up nontoken creatures you control$/i.test(trimmed)) return 'face-up nontoken creatures you control';
  if (/^each opponent$/i.test(trimmed)) return 'each opponent';
  if (/^he$/i.test(trimmed)) return 'it';
  if (/^that artifact$/i.test(trimmed)) return 'that artifact';
  const cleaned = trimmed
    .replace(/\s+get\s+[+-]?\d+\s*\/\s*[+-]?\d.*$/i, '')
    .replace(/\s+gain\s+.+$/i, '')
    .trim();
  if (!cleaned || /whenever|attacks,/i.test(cleaned)) {
    const inferred = inferGrantTemporaryAbilityTargetFromRaw(stepRaw || value);
    if (inferred) return inferred;
  }
  return cleaned;
}

