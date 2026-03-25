import type { GameState, PlayerID } from '../../shared/src';
import {
  countControlledByClass,
  getProcessedBattlefield,
  normalizeControlledClassKey,
} from './oracleIRExecutorCreatureStepUtils';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';
import { normalizeOracleText } from './oracleIRExecutorPlayerUtils';

function parseSmallNumberWord(raw: string): number | null {
  const text = String(raw || '').trim().toLowerCase();
  if (!text) return null;
  if (/^\d+$/.test(text)) return parseInt(text, 10);

  const lookup: Record<string, number> = {
    zero: 0,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
  };
  return Number.isFinite(lookup[text]) ? lookup[text] : null;
}

function matchesGraveyardCardClass(card: any, classText: string): boolean {
  const normalized = String(classText || '')
    .toLowerCase()
    .replace(/\band\/or\b/g, 'or')
    .replace(/\s+/g, ' ')
    .trim();
  const typeLine = String(card?.type_line || '').toLowerCase();

  if (!normalized || !typeLine) return false;
  if (normalized === 'instant or sorcery') return typeLine.includes('instant') || typeLine.includes('sorcery');
  if (normalized === 'instant') return typeLine.includes('instant');
  if (normalized === 'sorcery') return typeLine.includes('sorcery');
  if (normalized === 'creature') return typeLine.includes('creature');
  if (normalized === 'artifact') return typeLine.includes('artifact');
  if (normalized === 'enchantment') return typeLine.includes('enchantment');
  if (normalized === 'land') return typeLine.includes('land');
  if (normalized === 'planeswalker') return typeLine.includes('planeswalker');
  return false;
}

export function evaluateModifyPtCondition(
  state: GameState,
  controllerId: PlayerID,
  conditionRaw: string
): boolean | null {
  const raw = normalizeOracleText(conditionRaw);
  if (!raw) return null;

  const battlefield = getProcessedBattlefield(state);
  const controlled = battlefield.filter(permanent => String((permanent as any)?.controller || '').trim() === controllerId);

  const typeLineLower = (permanent: any): string => getExecutorTypeLineLower(permanent);

  const normalizeClass = (text: string): string | null => normalizeControlledClassKey(text);
  const countByClass = (klass: string): number => countControlledByClass(controlled, klass, typeLineLower);

  const mCount = raw.match(/^you control (\d+) or more (.+)$/i);
  if (mCount) {
    const threshold = parseInt(String(mCount[1] || '0'), 10) || 0;
    const klass = normalizeClass(String(mCount[2] || ''));
    if (!klass) return null;
    return countByClass(klass) >= threshold;
  }

  const mAny = raw.match(/^you control (?:(?:a|an)\s+)?(.+)$/i);
  if (mAny) {
    const klass = normalizeClass(String(mAny[1] || ''));
    if (!klass) return null;
    return countByClass(klass) > 0;
  }

  const mGraveyardCount = raw.match(/^there are ([a-z0-9]+) or more (.+) cards? in your graveyard$/i);
  if (mGraveyardCount) {
    const threshold = parseSmallNumberWord(String(mGraveyardCount[1] || ''));
    if (threshold === null) return null;

    const controller = (state.players || []).find((player: any) => String(player?.id || '').trim() === controllerId) as any;
    if (!controller) return null;

    const graveyard = Array.isArray(controller.graveyard) ? controller.graveyard : [];
    const classText = String(mGraveyardCount[2] || '').trim();
    return graveyard.filter(card => matchesGraveyardCardClass(card, classText)).length >= threshold;
  }

  return null;
}
