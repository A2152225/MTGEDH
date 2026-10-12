import { describe, expect, it } from 'vitest';
import { canBlockAttacker } from '../src/utils/combatBlocking';

const mk = (id: string, controller: string, oracle: string, extra: any = {}, card: any = {}) => ({
  id, controller, owner: controller, tapped: false, counters: {}, ...extra,
  card: { id: `${id}_c`, name: id, type_line: 'Creature - Human', oracle_text: oracle, ...card },
}) as any;

describe('client combat modal uses accurate keywords', () => {
  it('a "with flying" reference is not flying; real flyers and grants are', () => {
    const bear = mk('bear', 'p1', '');
    const archer = mk('archer', 'p2', '{T}: This creature deals 1 damage to target creature with flying.', { attacking: 'p1' });
    const angel = mk('angel', 'p2', 'Flying', { attacking: 'p1' }, { keywords: ['Flying'] });
    expect(canBlockAttacker(bear, archer, [bear, archer]).canBlock).toBe(true);
    expect(canBlockAttacker(bear, angel, [bear, angel]).canBlock).toBe(false);
    const wings = mk('wings', 'p2', 'Equipped creature has flying.\nEquip {1}', { attachedTo: 'archer' }, { type_line: 'Artifact - Equipment' });
    expect(canBlockAttacker(bear, archer, [bear, archer, wings]).canBlock).toBe(false);
    const sphere = mk('sphere', 'p1', 'All creatures lose flying.', {}, { type_line: 'Enchantment' });
    expect(canBlockAttacker(bear, angel, [bear, angel, sphere]).canBlock).toBe(true);
  });
});
