// server/src/socket/combat-handlers/combatBatch28ConditionalUnblockable.ts
// Origin parent: combatLegalityGates.ts (canBlockAttacker).
// Batch 28: self "can't be blocked as long as <condition>" statics (CR 509.1b):
//   "~ can't be blocked as long as you've drawn two or more cards this turn" (June, Bounty Hunter; Tome Anima)
// Uses state.cardsDrawnThisTurn (maintained by zonesDrawCards.ts).
// Batch 29: attached grants "enchanted/equipped creature (gets +N/+N and) can't be blocked" (Aqueous Form,
//   Aether Tunnel, Cloak of Mists, Whispersilk Cloak).
// Public entry symbols: conditionalUnblockableReason.

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const DRAWN_RE = /(?:^|[\n.]\s*)(?:this creature|it|~)\s+can't be blocked as long as you've drawn (\d+|[a-z]+) or more cards this turn/i;

function selfText(perm: any): string {
  const name = String(perm?.card?.name || perm?.name || '').split('//')[0].trim().toLowerCase();
  let t = String(perm?.card?.oracle_text || perm?.oracle_text || '').replace(/\u2019/g, "'").replace(/\([^)]*\)/g, ' ').toLowerCase();
  if (name) {
    t = t.split(name).join('~');
    const short = name.split(',')[0].trim();
    if (short && short !== name) t = t.split(short).join('~');
  }
  return t;
}

function toNum(raw: string): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : (WORDS[String(raw).toLowerCase()] ?? NaN);
}

const ATTACHED_RE = /(?:^|[\n.]\s*)(?:enchanted|equipped) creature (?:gets [+-]\d+\/[+-]\d+ and |has [a-z ,]+? and )?can't be blocked(?: this turn)?\s*(?:\.|$)/m;

function attachedUnblockableSource(attacker: any, battlefield: readonly any[]): string | null {
  const id = String(attacker?.id || '');
  if (!id) return null;
  const attachmentIds = new Set((Array.isArray(attacker?.attachments) ? attacker.attachments : []).map((a: any) => String(a?.id || a || '')));
  for (const perm of battlefield || []) {
    if (!perm || perm === attacker) continue;
    if (String(perm.attachedTo || '') !== id && !attachmentIds.has(String(perm.id || ''))) continue;
    const text = String(perm?.card?.oracle_text || perm?.oracle_text || '').replace(/\u2019/g, "'").replace(/\([^)]*\)/g, ' ').toLowerCase();
    if (ATTACHED_RE.test(text)) return String(perm?.card?.name || perm?.name || 'an attachment');
  }
  return null;
}

export function conditionalUnblockableReason(attacker: any, gameState: unknown, battlefield: readonly any[] = []): string | null {
  const bf = battlefield.length ? battlefield : (Array.isArray((gameState as any)?.battlefield) ? (gameState as any).battlefield : []);
  const attachedSource = attachedUnblockableSource(attacker, bf);
  if (attachedSource) return "Attacker can't be blocked (" + attachedSource + ')';
  const m = selfText(attacker).match(DRAWN_RE);
  if (!m) return null;
  const need = toNum(m[1]);
  if (!Number.isFinite(need)) return null;
  const controller = String(attacker?.controller || '');
  const drawn = Number((gameState as any)?.cardsDrawnThisTurn?.[controller] || 0);
  return drawn >= need ? "Attacker can't be blocked (controller drew " + need + '+ cards this turn)' : null;
}
