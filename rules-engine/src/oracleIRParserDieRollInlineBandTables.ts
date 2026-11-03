/**
 * Inline d20 result-band tables ("Roll a d20.\n1-9 | effect\n10-20 | effect") that the
 * clause parser folded into the rolling ability's own text. Without this pass every band's
 * effect became a flat sequential step, so all branches ran regardless of the roll.
 *
 * Generic rewrite: keep the steps up to and including the d20 roll_die step, then append a
 * single die_roll_results step whose bands are parsed from the "<range> | effect" lines.
 * The executor's existing die_roll_results handler picks the band from lastDieRoll.
 */
import type { OracleEffectStep, OracleIRAbility } from './oracleIR';
import { parseEffectClauseToStep } from './oracleIRParserEffectClauseToStep';
import { parseTokenCreationMetadataStep } from './oracleIRParserPostprocessTokenCreationMetadata';
import { parseObjectSelector, parseQuantity } from './oracleIRParserUtils';
import { parseOracleTextToIR } from './oracleIRParserParseOracleTextToIR';

const BAND_LINE = /^\s*(\d+)(?:\s*[-\u2013\u2014]\s*(\d+))?\s*\|\s*(.+?)\s*$/;

let sourceNameHint = '';

type Band = { min: number; max: number; raw: string; steps: OracleEffectStep[]; rollAgain?: 'optional' | 'mandatory' };

const ROLL_AGAIN_TAIL = /(?:^|\s+)(you may )?roll again\.?$/i;

function stripBandLabel(text: string): string {
  // "Trapped! - You lose 3 life." / "Siege Monster - ..." style flavor labels.
  return text.replace(/^[A-Z][^|.!?]{0,40}[!?]?\s*[-\u2013\u2014]\s+(?=[A-Z])/, '').trim();
}

const ATTACH_SELF_TO_IT = /^(?:then\s+)?attach (this equipment|this aura|this permanent|it) to (it|that creature|that token)$/i;

function parseClauseStep(clause: string): OracleEffectStep {
  const attach = clause.trim().match(ATTACH_SELF_TO_IT);
  if (attach) {
    // B51: "..., then attach this Equipment to it" (Goblin Morningstar).
    return { kind: 'attach', attachment: parseObjectSelector(attach[1]), to: parseObjectSelector(attach[2]), sequence: 'then', raw: clause.trim() } as OracleEffectStep;
  }
  return parseTokenCreationMetadataStep(clause) || parseEffectClauseToStep(clause);
}

function parseSentence(sentence: string): OracleEffectStep[] {
  const s = sentence.trim().replace(/\.$/, '').trim();
  if (!s) return [];
  // B51: ", then <clause>" chains split before whole-clause parsing so the tail isn't swallowed.
  const thenParts = s.split(/,\s+then\s+/i);
  if (thenParts.length > 1) {
    const steps = thenParts.map(parseClauseStep);
    if (steps.every(st => st.kind !== 'unknown')) return steps;
  }
  // B51: "You gain 3 life and draw three cards" -- whole-clause parse keeps only one verb.
  if (/\s+and\s+/i.test(s)) {
    const split = splitAndClauses(s);
    if (split && split.length > 1) return split;
  }
  const token = parseTokenCreationMetadataStep(s);
  if (token) return [token];
  const whole = parseEffectClauseToStep(s);
  if (whole.kind !== 'unknown') return [whole];
  const split = splitAndClauses(s);
  if (split && split.length > 1) return split;
  return [whole];
}

function splitAndClauses(s: string): OracleEffectStep[] | null {
  const parts = s.split(/,?\s+(?:and|then)\s+/i).map(p => p.trim()).filter(Boolean);
  if (parts.length > 1) {
    const subject = parts[0].match(/^(you|each player|each opponent|target player)\s+/i)?.[1];
    const steps = parts.map((p, idx) => {
      const clause = idx > 0 && subject && !/^(you|each|target|create|search|put|exile|return|draw|destroy|attach)\b/i.test(p)
        ? `${subject} ${p}` : p;
      return parseClauseStep(clause);
    });
    if (steps.every(st => st.kind !== 'unknown')) return steps;
  }
  return null;
}

function parseBandEffect(effect: string, previous: Band | undefined): OracleEffectStep[] {
  const text = stripBandLabel(effect);
  const those = text.match(/^Create (\w+) of those tokens\.?$/i);
  if (those && previous) {
    const prior = previous.steps.find(st => st.kind === 'create_token') as any;
    if (prior) return [{ ...prior, amount: parseQuantity(those[1]), raw: text } as OracleEffectStep];
  }
  const sentences = text.split(/(?<=\.)\s+(?=[A-Z])/);
  const steps = sentences.flatMap(parseSentence);
  if (steps.some(st => st.kind === 'unknown') && sentences.length > 1) {
    // B51: multi-sentence bands (Treasure Chest 20 tutor) -- reuse the full parser's post-passes.
    try {
      const ir: any = parseOracleTextToIR(text, sourceNameHint);
      const full: OracleEffectStep[] = ir?.abilities?.length === 1 ? ir.abilities[0].steps || [] : [];
      const unknowns = (xs: OracleEffectStep[]) => xs.filter(st => st.kind === 'unknown').length;
      // grant_static_ability here means the full parser misread a one-shot band sentence (Delina's "You may roll again").
      if (full.length > 0 && unknowns(full) < unknowns(steps) && !full.some(st => st.kind === 'grant_static_ability')) return full;
    } catch { /* keep sentence parse */ }
  }
  return steps;
}

export function splitInlineDieRollBandTable(ability: OracleIRAbility): OracleIRAbility {
  const steps = Array.isArray(ability?.steps) ? ability.steps : [];
  if (steps.some(st => st.kind === 'die_roll_results')) return ability;
  const rollIdx = steps.findIndex(st => st.kind === 'roll_die' && (st as any).sides === 20);
  if (rollIdx < 0) return ability;
  const lines = String(ability.text || '').split(/\n/);
  const firstBand = lines.findIndex(l => BAND_LINE.test(l));
  if (firstBand < 1) return ability;
  const bands: Band[] = [];
  for (const line of lines.slice(firstBand)) {
    const m = line.match(BAND_LINE);
    if (!m) return ability;
    const min = Number(m[1]);
    const max = m[2] ? Number(m[2]) : min;
    // B52: generic "(You may) roll again" band tail (Delina, Wild Mage) becomes a band flag.
    const again = m[3].match(ROLL_AGAIN_TAIL);
    const effect = again ? m[3].slice(0, again.index).trim() : m[3];
    const band: Band = { min, max, raw: line.trim(), steps: effect ? parseBandEffect(effect, bands[bands.length - 1]) : [] };
    if (again) band.rollAgain = again[1] ? 'optional' : 'mandatory';
    bands.push(band);
  }
  if (bands.length === 0) return ability;
  return {
    ...ability,
    steps: [
      ...steps.slice(0, rollIdx + 1),
      {
        kind: 'die_roll_results',
        who: { kind: 'you' },
        sides: 20,
        results: bands,
        raw: bands.map(b => b.raw).join('\n'),
      } as unknown as OracleEffectStep,
    ],
  };
}

export function splitInlineDieRollBandTables(abilities: readonly OracleIRAbility[], cardName?: string): OracleIRAbility[] {
  sourceNameHint = cardName || '';
  return abilities.map(splitInlineDieRollBandTable);
}
