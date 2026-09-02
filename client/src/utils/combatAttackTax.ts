/**
 * Client preview of pillowfort / this-turn / attacker-self attack tax.
 * Oracle-driven; no card-name routing. Server StaticEffectSpec + lastingEffects
 * remain the live source of truth at declare.
 */

import type { BattlefieldPermanent } from '../../../shared/src';
import { collectAttackerSelfAttackTax, countCountersOnPermanent } from '../../../shared/src/combatAttackerSelfTax';

export interface AttackYouTaxPhyrexianPreview {
  symbol: string;
  life: number;
}

export interface AttackYouTaxPreview {
  generic: number;
  phyrexian: AttackYouTaxPhyrexianPreview[];
  /** Nils: add this creature's counter count as generic mana. */
  countersOnAttacker: boolean;
}

const BASIC_LAND_TYPES = ['plains', 'island', 'swamp', 'mountain', 'forest'] as const;

const THIS_TURN_RE = /\b(?:this turn|this combat|until end of turn|until your next turn)\b/i;

const ATTACK_YOU_TAX_RE =
  /creatures?\s+can't\s+attack\s+you(?:\s+or\s+(?:a\s+)?planeswalkers?\s+you\s+control)?\s+unless\s+(?:their\s+controller\s+)?pays?\s+\{([^}]+)\}/i;

const NILS_TAX_RE =
  /each creature with one or more counters on it\s+can't\s+attack\s+you(?:\s+or\s+(?:a\s+)?planeswalkers?\s+you\s+control)?\s+unless\s+its\s+controller\s+pays\s+\{([^}]+)\}/i;

const UNTAPPED_GATE_RE = /as long as this (?:creature|permanent) is untapped/i;

function stripReminderText(text: string): string {
  return String(text || '').replace(/\([^)]*\)/g, ' ');
}

function splitOracleSentences(text: string): string[] {
  return stripReminderText(text)
    .split(/(?:\n+|[.!;]+)/)
    .map((sentence) => sentence.replace(/^[\s—–-]+/, '').trim())
    .filter((sentence) => sentence.length > 0);
}

function typeLineOf(permanent: BattlefieldPermanent): string {
  return String((permanent as any)?.card?.type_line || (permanent as any)?.type_line || '').toLowerCase();
}

function oracleOf(permanent: BattlefieldPermanent): string {
  return String((permanent as any)?.card?.oracle_text || (permanent as any)?.oracle_text || '');
}

function countEnchantmentsYouControl(
  battlefield: readonly BattlefieldPermanent[],
  controller: string,
): number {
  return battlefield.filter((perm) => {
    if (String(perm.controller || '') !== controller) return false;
    return typeLineOf(perm).includes('enchantment');
  }).length;
}

function countBasicLandTypesYouControl(
  battlefield: readonly BattlefieldPermanent[],
  controller: string,
): number {
  const types = new Set<string>();
  for (const perm of battlefield) {
    if (String(perm.controller || '') !== controller) continue;
    const typeLine = typeLineOf(perm);
    if (!typeLine.includes('land')) continue;
    for (const landType of BASIC_LAND_TYPES) {
      if (new RegExp(`\\b${landType}\\b`).test(typeLine)) types.add(landType);
    }
  }
  return types.size;
}

function parsePhyrexianToken(token: string): AttackYouTaxPhyrexianPreview | null {
  const match = String(token || '').trim().match(/^([WUBRG])\/P$/i);
  if (!match) return null;
  return { symbol: String(match[1] || '').toUpperCase(), life: 2 };
}

function resolveGenericAmount(
  token: string,
  sentence: string,
  battlefield: readonly BattlefieldPermanent[],
  defenderId: string,
): number {
  const trimmed = String(token || '').trim();
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  if (!/^x$/i.test(trimmed)) return 0;
  const lower = sentence.toLowerCase();
  if (/number of enchantments you control/i.test(lower)) {
    return countEnchantmentsYouControl(battlefield, defenderId);
  }
  if (/number of basic land types among lands you control/i.test(lower)) {
    return countBasicLandTypesYouControl(battlefield, defenderId);
  }
  return 0;
}

function emptyTax(): AttackYouTaxPreview {
  return { generic: 0, phyrexian: [], countersOnAttacker: false };
}

export function hasAttackYouTax(tax: AttackYouTaxPreview | null | undefined): boolean {
  if (!tax) return false;
  return tax.generic > 0 || tax.phyrexian.length > 0 || tax.countersOnAttacker;
}

export function defenderInfoToAttackYouTax(info: {
  attackTaxPerCreature?: number;
  attackTaxPhyrexianPerCreature?: AttackYouTaxPhyrexianPreview[];
  attackTaxCountersOnAttacker?: boolean;
} | null | undefined): AttackYouTaxPreview {
  return {
    generic: Math.max(0, Math.floor(Number(info?.attackTaxPerCreature || 0))),
    phyrexian: Array.isArray(info?.attackTaxPhyrexianPerCreature)
      ? info.attackTaxPhyrexianPerCreature
      : [],
    countersOnAttacker: Boolean(info?.attackTaxCountersOnAttacker),
  };
}

export function collectThisTurnAttackTaxPreview(
  lastingEffects: readonly unknown[] | null | undefined,
  defenderId: string,
): number {
  const effects = Array.isArray(lastingEffects) ? lastingEffects : [];
  const defender = String(defenderId || '').trim();
  let cost = 0;
  for (const entry of effects) {
    const stamp = entry as { type?: string; amount?: unknown; global?: boolean; defenderId?: string };
    if (String(stamp?.type || '') !== 'attackTaxGeneric') continue;
    const amount = Number(stamp.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    if (stamp.global === true) {
      cost += amount;
      continue;
    }
    if (defender && String(stamp.defenderId || '').trim() === defender) cost += amount;
  }
  return cost;
}

/**
 * Summed per-creature tax to attack `defenderId`, from oracle on that player's
 * permanents plus this-turn lastingEffects (War Tax).
 */
export function collectAttackYouTaxPreviewForDefender(
  battlefield: readonly BattlefieldPermanent[],
  defenderId: string,
  lastingEffects?: readonly unknown[] | null,
): AttackYouTaxPreview {
  const controller = String(defenderId || '').trim();
  if (!controller) return emptyTax();

  let generic = collectThisTurnAttackTaxPreview(lastingEffects, controller);
  const phyrexian: AttackYouTaxPhyrexianPreview[] = [];
  let countersOnAttacker = false;
  for (const perm of battlefield) {
    if (String(perm.controller || '') !== controller) continue;
    const oracle = oracleOf(perm);
    if (!oracle) continue;
    if (UNTAPPED_GATE_RE.test(oracle) && Boolean(perm.tapped)) continue;
    for (const sentence of splitOracleSentences(oracle)) {
      if (THIS_TURN_RE.test(sentence)) continue;
      const nilsMatch = sentence.match(NILS_TAX_RE);
      if (nilsMatch) {
        const token = String(nilsMatch[1] || '');
        if (/^x$/i.test(token) && /number of counters on that creature/i.test(sentence)) {
          countersOnAttacker = true;
        }
        continue;
      }
      const match = sentence.match(ATTACK_YOU_TAX_RE);
      if (!match) continue;
      const token = String(match[1] || '');
      const phy = parsePhyrexianToken(token);
      if (phy) {
        phyrexian.push(phy);
        continue;
      }
      const amount = resolveGenericAmount(token, sentence, battlefield, controller);
      if (amount > 0) generic += amount;
    }
  }
  return { generic, phyrexian, countersOnAttacker };
}

export function formatAttackYouTaxPerCreature(tax: AttackYouTaxPreview): string | null {
  const parts: string[] = [];
  if (tax.generic > 0) parts.push(`{${tax.generic}}`);
  for (const item of tax.phyrexian) {
    parts.push(`{${item.symbol}/P}`);
  }
  if (tax.countersOnAttacker) parts.push('{X} (counters)');
  if (parts.length === 0) return null;
  return `${parts.join(' + ')}/attacker`;
}

export function formatAttackYouTaxForCount(tax: AttackYouTaxPreview, count: number): string | null {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (n <= 0) return null;
  const parts: string[] = [];
  if (tax.generic > 0) parts.push(`{${tax.generic * n}}`);
  const phyBySymbol = new Map<string, number>();
  for (const item of tax.phyrexian) {
    const symbol = String(item.symbol || '').toUpperCase();
    if (!symbol) continue;
    phyBySymbol.set(symbol, (phyBySymbol.get(symbol) || 0) + n);
  }
  for (const [symbol, qty] of phyBySymbol) {
    parts.push(qty === 1 ? `{${symbol}/P}` : `${qty}×{${symbol}/P}`);
  }
  if (parts.length === 0) return null;
  return parts.join(' + ');
}

export function formatAttackYouTaxLifeHint(tax: AttackYouTaxPreview): string | null {
  const first = tax.phyrexian[0];
  if (!first) return null;
  const symbol = String(first.symbol || 'W').toUpperCase();
  const life = Number(first.life) || 2;
  return `{${symbol}} or ${life} life each`;
}

function mergeFormattedParts(left: string | null, extraGeneric: number): string | null {
  const extra = extraGeneric > 0 ? `{${extraGeneric}}` : null;
  if (left && extra) return `${left} + ${extra}`;
  return left || extra;
}

export function formatSelectedAttackersTax(
  selectedAttackers: Iterable<[string, string | undefined]>,
  defenderInfoMap: Record<string, {
    attackTaxPerCreature?: number;
    attackTaxPhyrexianPerCreature?: AttackYouTaxPhyrexianPreview[];
    attackTaxCountersOnAttacker?: boolean;
  }> | undefined,
  options?: {
    defenderNameById?: ReadonlyMap<string, string>;
    battlefield?: readonly BattlefieldPermanent[];
    players?: ReadonlyArray<{ id?: string; hand?: readonly unknown[]; handCount?: number }>;
    lastingEffects?: readonly unknown[];
  },
): string | null {
  if (!defenderInfoMap) return null;
  const battlefield = options?.battlefield || [];
  const byId = new Map(battlefield.map((perm) => [String(perm.id || ''), perm]));

  const groups = new Map<string, { count: number; extraGeneric: number }>();
  for (const [creatureId, target] of selectedAttackers) {
    const id = String(target || '').trim();
    if (!id) continue;
    const creature = byId.get(String(creatureId || ''));
    const tax = defenderInfoToAttackYouTax(defenderInfoMap[id]);
    let extra = 0;
    if (tax.countersOnAttacker) extra += countCountersOnPermanent(creature);
    extra += collectAttackerSelfAttackTax(creature, battlefield, { players: options?.players }).cost;
    const existing = groups.get(id) || { count: 0, extraGeneric: 0 };
    existing.count += 1;
    existing.extraGeneric += extra;
    groups.set(id, existing);
  }

  const chunks: { id: string; label: string }[] = [];
  let phyrexianHintTax: AttackYouTaxPreview | null = null;
  for (const [id, group] of groups) {
    const tax = defenderInfoToAttackYouTax(defenderInfoMap[id]);
    const uniform = formatAttackYouTaxForCount(tax, group.count);
    const label = mergeFormattedParts(uniform, group.extraGeneric);
    if (!label) continue;
    if (!phyrexianHintTax && tax.phyrexian.length > 0) phyrexianHintTax = tax;
    chunks.push({ id, label });
  }
  if (chunks.length === 0) return null;
  const defenderNameById = options?.defenderNameById;
  const useNames = chunks.length > 1 && Boolean(defenderNameById);
  const body = chunks
    .map((chunk) => {
      const name = useNames ? defenderNameById?.get(chunk.id) : undefined;
      return name ? `${name} ${chunk.label}` : chunk.label;
    })
    .join(' · ');
  const hint = phyrexianHintTax ? formatAttackYouTaxLifeHint(phyrexianHintTax) : null;
  return hint ? `${body} (${hint})` : body;
}
