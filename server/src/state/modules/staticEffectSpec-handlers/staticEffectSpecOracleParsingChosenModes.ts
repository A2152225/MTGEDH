// server/src/state/modules/staticEffectSpec-handlers/staticEffectSpecOracleParsingChosenModes.ts
// Phase 5: chosen-mode statics. "As this enters, choose Jeskai or Temur. \u2022 Temur \u2014 Creatures you
// control get +1/+0 and have trample and haste." (Siege cycle) and "choose two abilities for it to
// gain \u2014 \u2022 Equipped creatures you control get +1/+1." (Ano'thr). Each bullet's static text is parsed
// by the full oracle parser and gated on source_chose_option. Triggered modal bullets are not touched.
// Public entry symbols: pushChosenModeSpecs.

import type { BattlefieldPermanent } from '../../../../../shared/src/index.js';
import type { StaticEffectCondition, StaticEffectSpec } from '../staticEffectSpec.js';

const AS_ENTERS_CHOOSE_RE = /\bas [^.\n]*?enters(?: the battlefield)?,\s*choose\b/;
const NON_STATIC_BODY_RE = /until end of turn|\bwhenever\b|\bwhen\b|\bat the beginning\b|^[^"]*:/;

export function pushChosenModeSpecs(
  specs: StaticEffectSpec[],
  perm: BattlefieldPermanent,
  oracle: string,
  parse: (perm: BattlefieldPermanent) => StaticEffectSpec[],
): void {
  if (!AS_ENTERS_CHOOSE_RE.test(oracle)) return;
  const lines = oracle.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('\u2022'));
  lines.forEach((line, index) => {
    const bullet = line.replace(/^\u2022\s*/, '');
    const labelled = bullet.match(/^([a-z' ]{2,30}?)\s*\u2014\s*(.+)$/);
    const label = labelled ? labelled[1].trim() : bullet;
    const body = labelled ? labelled[2].trim() : bullet;
    if (!body || NON_STATIC_BODY_RE.test(body.replace(/"[^"]*"/g, '""'))) return;
    const card = { ...((perm as any).card || {}), oracle_text: body.charAt(0).toUpperCase() + body.slice(1) };
    const inner = parse({ ...(perm as any), card, chosenOption: undefined, chosenOptions: undefined } as any);
    const gate: StaticEffectCondition = { kind: 'source_chose_option', option: label } as StaticEffectCondition;
    for (const spec of inner) {
      specs.push({ ...spec, id: `${spec.id}:chosen-mode:${index}`, conditions: [...(spec.conditions || []), gate] });
    }
  });
}