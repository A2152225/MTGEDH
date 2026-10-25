/**
 * Subject filter for "whenever you put one or more [+1/+1] counters on <subject>, ..."
 * (counters_put_on_target). The subject is either the watcher itself (Aragorn, Blaster,
 * "this creature"), "another <type>" (Omarthis, Captain Marvel), or a type list
 * (The Great Goblin: "a Goblin, Orc, or Army you control"; Invisible Woman: "other Heroes").
 */

function singular(word: string): string {
  if (/ies$/.test(word)) return word.slice(0, -3) + 'y';
  if (/(?:ches|shes|xes|sses)$/.test(word)) return word.slice(0, -2);
  if (/s$/.test(word) && !/ss$/.test(word)) return word.slice(0, -1);
  return word;
}

/** Returns true when the subject phrase names the watcher itself. */
export function counterSubjectIsSelf(subject: string, cardName: string): boolean {
  const s = subject.trim().toLowerCase();
  if (s === '~' || /^this (?:creature|permanent|artifact|enchantment|planeswalker)$/.test(s)) return true;
  const name = String(cardName || '').split('//')[0].trim().toLowerCase();
  if (!name) return false;
  return s === name || s === name.split(',')[0].trim() || s === name.split(' ')[0].trim();
}

export function extractCounterTargetSubject(oracleClause: string): string {
  const m = /counters on (.+?),/i.exec(String(oracleClause || ''));
  return m ? m[1].trim() : '';
}

/** Whether counters placed on targetPermanent satisfy the trigger's subject (watcher = source permanent). */
export function counterTargetSubjectMatches(oracleClause: string, watcher: any, target: any): boolean {
  const subject = extractCounterTargetSubject(oracleClause);
  if (!subject) return true;
  const watcherId = String(watcher?.id || '');
  const targetId = String(target?.id || '');
  if (counterSubjectIsSelf(subject, String(watcher?.card?.name || ''))) return watcherId === targetId;
  let s = subject.toLowerCase();
  if (/^(?:another|other|one or more other)\b/.test(s) && watcherId === targetId) return false;
  s = s.replace(/^(?:one or more |a |an )?(?:another |other )?/, '').replace(/\s+you control$/, '').trim();
  const typeLine = String(target?.card?.type_line || '').toLowerCase();
  const colors: unknown[] = Array.isArray(target?.card?.colors) ? target.card.colors : [];
  const options = s.split(/\s*,\s*(?:or\s+)?|\s+or\s+/).map((o) => o.replace(/^(?:a|an)\s+/, '').trim()).filter(Boolean);
  if (options.length === 0) return true;
  return options.some((option) => option.split(/\s+/).every((word) => {
    if (word === 'permanent' || word === 'player') return true;
    if (word === 'colorless') return colors.length === 0;
    return typeLine.includes(singular(word));
  }));
}
