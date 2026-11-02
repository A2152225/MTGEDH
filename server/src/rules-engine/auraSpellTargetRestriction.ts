// server/src/rules-engine/auraSpellTargetRestriction.ts
// "~ can't be the target of Aura spells." (Bartel Runeaxe, Tetsuo Umezawa) - a targeting restriction
// that applies only when the targeting spell is an Aura (CR 303.4a: an Aura spell targets the object it enchants).
// Public entry symbols: permanentRejectsAuraSpellTargets.

export function permanentRejectsAuraSpellTargets(permanent: any): boolean {
  const card = permanent?.card;
  if (!card || card.isFaceDownStub === true) return false;
  const text = String(card.oracle_text || '').toLowerCase().replace(/\u2019/g, "'").replace(/\([^)]*\)/g, '');
  if (!/can't be the target of [^.\n]*\baura spells/.test(text)) return false;
  const name = String(card.name || '').split(' // ')[0].trim().toLowerCase();
  const short = name.split(',')[0].trim();
  const subjects = ['~', 'this creature', 'this permanent', name, short].filter(Boolean);
  return text.split(/\n+|(?<=\.)\s+/).some((line) => {
    const m = /^(.+?) can't be the target of (?:[a-z ,]+? or )?aura spells/.exec(line.trim());
    return !!m && subjects.includes(m[1].trim());
  });
}
