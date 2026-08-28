import { describe, expect, it } from 'vitest';
import { evaluateLiveSeams } from '../scripts/oracle-ir-live-seam-audit.ts';

// mtg_data.db (is_token = 0): Genesis / Bridge are GY-zone triggers, not continuous statics.
const GENESIS =
  'At the beginning of your upkeep, if this creature is in your graveyard, you may pay {2}{G}. If you do, return target creature card from your graveyard to your hand.';
const BRIDGE_FROM_BELOW =
  "Whenever a nontoken creature is put into your graveyard from the battlefield, if this card is in your graveyard, create a 2/2 black Zombie creature token.\nWhen a creature is put into an opponent's graveyard from the battlefield, if this card is in your graveyard, exile this card.";
const ANGER =
  'Haste\nAs long as this card is in your graveyard and you control a Mountain, creatures you control have haste.';
const ALWAYS_WATCHING =
  'Nontoken creatures you control get +1/+1 and have vigilance.';

describe('gy_static_missing live-seam filter', () => {
  it('does not flag Genesis or Bridge from Below as missing GY statics', () => {
    expect(evaluateLiveSeams({
      name: 'Genesis',
      type_line: 'Creature — Incarnation',
      oracle_text: GENESIS,
    }, { exileEmission: true }).some((gap) => gap.seam === 'gy_static_missing')).toBe(false);

    expect(evaluateLiveSeams({
      name: 'Bridge from Below',
      type_line: 'Enchantment',
      oracle_text: BRIDGE_FROM_BELOW,
    }, { exileEmission: true }).some((gap) => gap.seam === 'gy_static_missing')).toBe(false);
  });

  it('still treats Anger as a parsed GY continuous static', () => {
    expect(evaluateLiveSeams({
      name: 'Anger',
      type_line: 'Creature — Incarnation',
      oracle_text: ANGER,
    }, { exileEmission: true }).some((gap) => gap.seam === 'gy_static_missing')).toBe(false);
  });

  it('keeps battlefield lords out of the graveyard', () => {
    expect(evaluateLiveSeams({
      name: 'Always Watching',
      type_line: 'Enchantment',
      oracle_text: ALWAYS_WATCHING,
    }, { exileEmission: true }).some((gap) => gap.seam === 'static_gy_leak')).toBe(false);
  });

  it('does not flag GY replacement effects as missing continuous statics', () => {
    expect(evaluateLiveSeams({
      name: 'Retriever Phoenix',
      type_line: 'Creature — Phoenix',
      oracle_text: 'As long as this card is in your graveyard, if you would learn, you may instead return this card to the battlefield.',
    }, { exileEmission: true }).some((gap) => gap.seam === 'gy_static_missing')).toBe(false);
  });
});
