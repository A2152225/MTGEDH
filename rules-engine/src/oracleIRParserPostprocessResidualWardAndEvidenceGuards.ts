// Extracted from rules-engine/src/oracleIRParserPostprocess.ts (chat B 40KB split campaign).
//
// Cluster: runs of guards lifted out of parseCurrentResidualUnknownStep's residual chain covering
// ward-discard costs and collect-evidence fragments.
//
// Every helper keeps its guards in their original order and returns null when none matched, so the
// caller resumes the chain exactly where the run used to sit. staticMetadata / temporaryMetadata are
// verbatim copies of the chain prologue.

import type { OracleEffectStep } from './oracleIR';
import { parseObjectSelector } from './oracleIRParserUtils';

export function parseResidualWardAndEvidenceGuardsOne(
  raw: string, sequence: { sequence?: 'then' }
): readonly OracleEffectStep[] | null {
  const wardDiscardMatch = raw.match(/^ward[-�]discard a card or pay (\{[^}]+\})$/i);
  if (wardDiscardMatch) {
    const cost = String(wardDiscardMatch[1] || '').trim();
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector('this permanent'),
      effectText: [`ward�Discard a card or pay ${cost}`],
      duration: 'static',
      raw: `Ward�Discard a card or pay ${cost}`,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^while\s+voting,\s+you\s+may\s+vote\s+an\s+additional\s+time$/i.test(raw)) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector('you'),
      effectText: ['may vote an additional time'],
      duration: 'static',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^x\s+is\s+the\s+mana\s+value\s+of\s+that\s+card$/i.test(raw)) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector('X'),
      effectText: ['is the mana value of that card'],
      duration: 'static',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const chooseFromIt = raw.match(/^you\s+choose\s+(.+?)\s+from\s+it$/i);
  if (chooseFromIt) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector('it'),
      effectText: [`choose ${String(chooseFromIt[1] || '').trim()}`],
      duration: 'static',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^you\s+choose\s+one\s+of\s+them$/i.test(raw)) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector('them'),
      effectText: ['choose one'],
      duration: 'static',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^you\s+control\s+target\s+player\s+during\s+that\s+player(?:'|�)?s\s+next\s+turn$/i.test(raw)) {
    return [{
      kind: 'grant_temporary_ability',
      target: parseObjectSelector('target player'),
      duration: 'until_next_turn',
      effectText: ['you control that player during their next turn'],
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const unspentManaMatch = raw.match(/^you\s+don(?:'|�)?t\s+lose\s+unspent\s+(.+?)\s+mana\s+as\s+steps\s+and\s+phases\s+end$/i);
  if (unspentManaMatch) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector('you'),
      effectText: [`don't lose unspent ${String(unspentManaMatch[1] || '').trim()} mana as steps and phases end`],
      duration: 'static',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }
  return null;
}

export function parseResidualWardAndEvidenceGuardsTwo(
  raw: string, sequence: { sequence?: 'then' }
): readonly OracleEffectStep[] | null {
  const staticMetadata = (target: string, effectText: string): readonly OracleEffectStep[] => [{
    kind: 'grant_static_ability',
    target: parseObjectSelector(target),
    effectText: [effectText],
    duration: 'static',
    raw,
    ...sequence,
  } as unknown as OracleEffectStep];

  const collectEvidenceMatch = raw.match(/^you\s+may\s+collect\s+evidence\s+(\d+)$/i);
  if (collectEvidenceMatch) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector('you'),
      effectText: [`may collect evidence ${String(collectEvidenceMatch[1] || '').trim()}`],
      duration: 'static',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const payToEndMatch = raw.match(/^you\s+may\s+pay\s+((?:\{[^}]+\})+)\s+to\s+end\s+this\s+effect$/i);
  if (payToEndMatch) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector('this effect'),
      effectText: [`may pay ${String(payToEndMatch[1] || '').trim()} to end this effect`],
      duration: 'static',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^you\s+may\s+pay\s+\{W\}\{U\}\{B\}\{R\}\{G\}\s+rather\s+than\s+pay\s+the\s+mana\s+cost\s+for\s+spells\s+you\s+cast$/i.test(raw)) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector('spells you cast'),
      effectText: ['you may pay {W}{U}{B}{R}{G} rather than pay the mana cost'],
      duration: 'static',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^enchanted\s+land\s+has\s+.*sacrifice\s+a\s+creature:\s+you$/i.test(raw)) {
    return staticMetadata('granted activated ability text', raw);
  }

  if (/^(?:gain\s+life\s+equal\s+to\s+)?the\s+sacrificed\s+creature(?:'|\u2019)s\s+toughness\.?"?$/i.test(raw)) {
    return staticMetadata('reference life amount', raw);
  }
  return null;
}

