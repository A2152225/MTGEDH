// server/src/socket/ai-handlers/aiAuraPolarity.ts
// Is an Aura (or Equipment-style attachment) good for the permanent it's attached to?
// Beneficial auras (buffs, keyword/ability grants, untap-on-attack, umbra/totem armor) belong
// on the AI's own permanents; harmful ones (Pacifism, -N/-N, control-steal, can't attack/block,
// doesn't untap, damage/life loss to its controller) on opponents'. Reminder text and the
// umbra/totem armor replacement ("would be destroyed, instead ...") are not removal.
// Public entry symbols: classifyAuraPolarity, isAuraLikeSourceText.

export type AuraPolarity = 'beneficial' | 'harmful';

/** True when the oracle has an "Enchant <x>" line (Aura spell or permanent). */
export function isAuraLikeSourceText(oracleText: unknown, typeLine?: unknown): boolean {
  if (/\baura\b/i.test(String(typeLine || ''))) return true;
  return /(?:^|\n)\s*enchant\s+\w/i.test(String(oracleText || ''));
}

function clean(oracleText: string): string {
  return String(oracleText || '')
    .toLowerCase()
    .replace(/\u2019/g, "'")
    .replace(/\([^)]*\)/g, ' ')
    // Umbra / totem armor replacement is protection for the enchanted creature.
    .replace(/if enchanted (?:creature|permanent) would be destroyed, instead[^.]*\./g, ' umbra-armor. ')
    .replace(/\b(?:umbra|totem) armor\b/g, ' umbra-armor ');
}

/** Polarity for the enchanted/equipped object, or null when the text gives no signal. */
export function classifyAuraPolarity(oracleText: unknown): AuraPolarity | null {
  const text = clean(String(oracleText || ''));
  if (!text.trim()) return null;
  // Text granted in quotes is an ability the enchanted creature HAS; judge it as a grant.
  const quoted = [...text.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
  const outside = text.replace(/"[^"]*"/g, ' "granted" ');
  let good = 0;
  let bad = 0;
  const subject = String.raw`(?:enchanted|equipped) (?:creature|permanent|land|artifact|planeswalker)`;

  if (/umbra-armor/.test(outside)) good += 3;
  if (new RegExp(String.raw`${subject}[^.]*\bgets? \+\d+\/\+\d+`).test(outside)) good += 3;
  if (new RegExp(String.raw`${subject}[^.]*\bgets? \+\d+\/[+-]0\b|${subject}[^.]*\bgets? \+[x\d]+\/\+[x\d]+`).test(outside)) good += 1;
  if (new RegExp(String.raw`${subject}[^.]*\b(?:has|have|gains?)\b`).test(outside)) good += 2;

  if (quoted.some((q) => /\b(?:untap|draw|create|gain|add \{|put a \+1\/\+1|deals? \d+ damage to (?:any target|target|each opponent))\b/.test(q))) good += 2;
  if (/\bwhen enchanted creature dies, return\b/.test(outside)) good += 2;
  if (new RegExp(String.raw`${subject}[^.]*\bhas (?:flying|first strike|double strike|trample|lifelink|vigilance|hexproof|indestructible|deathtouch|haste|menace|protection|shroud|ward)`).test(outside)) good += 2;

  if (new RegExp(String.raw`${subject}[^.]*\bgets? -\d+\/-\d+|${subject}[^.]*\bgets? [+-]?\d+\/-\d+|${subject}[^.]*\bgets? -\d+\/[+-]?\d+`).test(outside)) bad += 4;
  if (new RegExp(String.raw`${subject}[^.]*\bcan't (?:attack|block|be cast|activate)|${subject}[^.]*\babilities can't be activated`).test(outside)) bad += 4;
  if (new RegExp(String.raw`${subject}[^.]*\bdoesn't untap|${subject}[^.]*\bloses all abilities|${subject}[^.]*\bhas defender|${subject}[^.]*\bis (?:a|an) [^.]*with base power`).test(outside)) bad += 4;
  if (/\byou control enchanted\b/.test(outside)) bad += 5; // control-steal: target opponents' stuff
  if (/\benchanted (?:creature|permanent|land)'s controller (?:loses|sacrifices|discards|is dealt|mills)|deals? \d+ damage to (?:that creature's|enchanted (?:creature|permanent)'s) controller|deals? \d+ damage to enchanted creature\b/.test(outside)) bad += 4;
  if (/\b(?:destroy|exile) enchanted (?:creature|permanent|land|artifact)\b/.test(outside)) bad += 3;
  if (new RegExp(String.raw`${subject}[^.]*\bis goaded|goad enchanted`).test(outside)) bad += 3;
  if (new RegExp(String.raw`${subject}[^.]*\b(?:attacks each combat if able|must be blocked)`).test(outside)) bad += 1;
  if (/\benchanted land\b[^.]*\b(?:is a|doesn't untap|deals)\b/.test(outside)) bad += 2;

  if (good === 0 && bad === 0) return null;
  return bad > good ? 'harmful' : 'beneficial';
}
