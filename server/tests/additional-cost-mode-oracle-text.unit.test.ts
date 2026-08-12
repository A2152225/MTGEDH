import { describe, expect, it } from 'vitest';
import {
  extractAdditionalCostModesFromOracleText,
  getSelectedAdditionalCostOracleText,
} from '../src/state/modules/additionalCostModeOracleText.js';

const FINAL_SHOWDOWN = `Spree (Choose one or more additional costs.)
+ {1} — All creatures lose all abilities until end of turn.
+ {1} — Choose a creature you control. It gains indestructible until end of turn.
+ {3}{W}{W} — Destroy all creatures.`;

describe('additionalCostModeOracleText', () => {
  it('extracts Spree modes with stable ids', () => {
    const info = extractAdditionalCostModesFromOracleText(FINAL_SHOWDOWN);
    expect(info?.purpose).toBe('spree');
    expect(info?.options.map((o) => o.id)).toEqual(['spree_0', 'spree_1', 'spree_2']);
    expect(info?.options[2]?.effect).toMatch(/Destroy all creatures/i);
  });

  it('scopes oracle text to selected Spree mode only', () => {
    const scoped = getSelectedAdditionalCostOracleText(FINAL_SHOWDOWN, ['spree_2']);
    expect(scoped).toContain('Destroy all creatures');
    expect(scoped).not.toMatch(/lose all abilities/i);
    expect(scoped).not.toMatch(/indestructible/i);
    expect(scoped).not.toMatch(/^Spree\b/im);
  });

  it('returns original text when no modes selected', () => {
    expect(getSelectedAdditionalCostOracleText(FINAL_SHOWDOWN, [])).toBe(FINAL_SHOWDOWN);
  });
});
