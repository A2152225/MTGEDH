import { describe, expect, it } from 'vitest';
import { getUpkeepTriggersForPlayer } from '../src/state/modules/upkeep-triggers.js';
import {
  getDrawStepTriggers,
  getEndStepTriggers,
  getPostcombatMainTriggers,
  getPrecombatMainTriggers,
} from '../src/state/modules/triggers/turn-phases.js';
import { getBeginningOfCombatTriggers } from '../src/state/modules/triggers/combat.js';
import { getEndOfCombatTriggers } from '../src/state/modules/triggers/end-combat.js';

function makeCtx(battlefield: any[], extraState: Record<string, unknown> = {}) {
  const state = {
    seq: 1,
    stack: [],
    battlefield,
    players: [{ id: 'p1' }, { id: 'p2' }],
    commandZone: {},
    ...extraState,
  };
  return {
    state,
    gameId: 'phase_emitter_parity',
    bumpSeq() {
      state.seq = Number(state.seq || 0) + 1;
    },
    isReplaying: false,
  } as any;
}

function perm(id: string, controller: string, card: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    counters: {},
    card: { id: `${id}_card`, ...card },
    ...extra,
  };
}

function names(triggers: Array<{ cardName?: string; permanentId?: string }>): string[] {
  return triggers.map((trigger) => String(trigger.permanentId || trigger.cardName || ''));
}

describe('phase emitter — whose-turn filters', () => {
  describe('upkeep', () => {
    it('queues your-upkeep only on the controller\'s turn', () => {
      const source = perm('your_upkeep_1', 'p1', {
        name: 'Your Upkeep',
        type_line: 'Enchantment',
        oracle_text: 'At the beginning of your upkeep, draw a card.',
      });
      const ctx = makeCtx([source]);
      expect(getUpkeepTriggersForPlayer(ctx, 'p1').some((t) => t.permanentId === source.id)).toBe(true);
      expect(getUpkeepTriggersForPlayer(ctx, 'p2').some((t) => t.permanentId === source.id)).toBe(false);
    });

    it('queues each-player upkeep on every turn', () => {
      const source = perm('each_upkeep_1', 'p1', {
        name: 'Each Upkeep',
        type_line: 'Enchantment',
        oracle_text: "At the beginning of each player's upkeep, that player draws a card.",
      });
      const ctx = makeCtx([source]);
      expect(getUpkeepTriggersForPlayer(ctx, 'p1').some((t) => t.permanentId === source.id)).toBe(true);
      expect(getUpkeepTriggersForPlayer(ctx, 'p2').some((t) => t.permanentId === source.id)).toBe(true);
    });

    it('queues Dreamborn Muse mill on every upkeep', () => {
      const source = perm('dreamborn_1', 'p1', {
        name: 'Dreamborn Muse',
        type_line: 'Creature — Spirit',
        oracle_text:
          "At the beginning of each player's upkeep, that player mills X cards, where X is the number of cards in their hand.",
      });
      const ctx = makeCtx([source]);
      expect(getUpkeepTriggersForPlayer(ctx, 'p1').some((t) => t.permanentId === source.id)).toBe(true);
      expect(getUpkeepTriggersForPlayer(ctx, 'p2').some((t) => t.permanentId === source.id)).toBe(true);
    });

    it('queues Cemetery Tampering optional mill on your upkeep only', () => {
      const source = perm('tampering_1', 'p1', {
        name: 'Cemetery Tampering',
        type_line: 'Enchantment',
        oracle_text: 'At the beginning of your upkeep, you may mill three cards.',
      });
      const ctx = makeCtx([source]);
      expect(getUpkeepTriggersForPlayer(ctx, 'p1').some((t) => t.permanentId === source.id)).toBe(true);
      expect(getUpkeepTriggersForPlayer(ctx, 'p2').some((t) => t.permanentId === source.id)).toBe(false);
    });

    it('queues opponent upkeep only on an opponent\'s turn', () => {
      const source = perm('opp_upkeep_1', 'p1', {
        name: 'Opponent Upkeep',
        type_line: 'Enchantment',
        oracle_text: "At the beginning of each opponent's upkeep, you draw a card.",
      });
      const ctx = makeCtx([source]);
      expect(getUpkeepTriggersForPlayer(ctx, 'p1').some((t) => t.permanentId === source.id)).toBe(false);
      expect(getUpkeepTriggersForPlayer(ctx, 'p2').some((t) => t.permanentId === source.id)).toBe(true);
    });

    it('does not queue each-other-player upkeep on the controller\'s upkeep', () => {
      const source = perm('other_upkeep_1', 'p1', {
        name: 'Other Upkeep',
        type_line: 'Enchantment',
        oracle_text: "At the beginning of each other player's upkeep, you draw a card.",
      });
      const ctx = makeCtx([source]);
      expect(getUpkeepTriggersForPlayer(ctx, 'p1').some((t) => t.permanentId === source.id)).toBe(false);
      expect(getUpkeepTriggersForPlayer(ctx, 'p2').some((t) => t.permanentId === source.id)).toBe(true);
    });

    it('queues enchanted-player upkeep only when attachedTo is the active player', () => {
      const source = perm('curse_upkeep_1', 'p1', {
        name: 'Enchanted Upkeep',
        type_line: 'Enchantment — Aura Curse',
        oracle_text: "Enchant player\nAt the beginning of enchanted player's upkeep, that player loses 1 life.",
      }, { attachedTo: 'p2' });
      const ctx = makeCtx([source]);
      expect(getUpkeepTriggersForPlayer(ctx, 'p1').some((t) => t.permanentId === source.id)).toBe(false);
      expect(getUpkeepTriggersForPlayer(ctx, 'p2').some((t) => t.permanentId === source.id)).toBe(true);
    });

    it('queues chosen-player upkeep only for the chosen player', () => {
      const source = perm('chosen_upkeep_1', 'p1', {
        name: 'Chosen Upkeep',
        type_line: 'Enchantment',
        oracle_text: "At the beginning of the chosen player's upkeep, you draw a card.",
      }, { chosenPlayer: 'p2' });
      const ctx = makeCtx([source]);
      expect(getUpkeepTriggersForPlayer(ctx, 'p1').some((t) => t.permanentId === source.id)).toBe(false);
      expect(getUpkeepTriggersForPlayer(ctx, 'p2').some((t) => t.permanentId === source.id)).toBe(true);
    });
  });

  describe('end step', () => {
    it('queues your-end-step only on the controller\'s turn', () => {
      const source = perm('your_end_1', 'p1', {
        name: 'Your End Step',
        type_line: 'Enchantment',
        oracle_text: 'At the beginning of your end step, draw a card.',
      });
      const ctx = makeCtx([source]);
      expect(getEndStepTriggers(ctx, 'p1').some((t) => t.permanentId === source.id)).toBe(true);
      expect(getEndStepTriggers(ctx, 'p2').some((t) => t.permanentId === source.id)).toBe(false);
    });

    it('queues Hope Estheim mill on your end step, not an opponent\'s', () => {
      const source = perm('hope_end_1', 'p1', {
        name: 'Hope Estheim',
        type_line: 'Legendary Creature — Human Wizard',
        oracle_text:
          'Lifelink\nAt the beginning of your end step, each opponent mills X cards, where X is the amount of life you gained this turn.',
      });
      const ctx = makeCtx([source]);
      expect(getEndStepTriggers(ctx, 'p1').some((t) => t.permanentId === source.id)).toBe(true);
      expect(getEndStepTriggers(ctx, 'p2').some((t) => t.permanentId === source.id)).toBe(false);
    });

    it("queues each player's end step on an opponent's turn", () => {
      const source = perm('each_end_1', 'p1', {
        name: 'Each Player End Step',
        type_line: 'Enchantment',
        oracle_text: "At the beginning of each player's end step, that player draws a card.",
      });
      const ctx = makeCtx([source]);
      expect(getEndStepTriggers(ctx, 'p1').some((t) => t.permanentId === source.id)).toBe(true);
      expect(getEndStepTriggers(ctx, 'p2').some((t) => t.permanentId === source.id)).toBe(true);
    });

    it('queues each end step on every turn', () => {
      const source = perm('each_end_plain_1', 'p1', {
        name: 'Each End Step',
        type_line: 'Enchantment',
        oracle_text: 'At the beginning of each end step, you draw a card.',
      });
      const ctx = makeCtx([source]);
      expect(getEndStepTriggers(ctx, 'p2').some((t) => t.permanentId === source.id)).toBe(true);
    });

    it('queues Wound Reflection on every end step', () => {
      const source = perm('wound_end_1', 'p1', {
        name: 'Wound Reflection',
        type_line: 'Enchantment',
        oracle_text:
          'At the beginning of each end step, each opponent loses life equal to the life they lost this turn.',
      });
      const ctx = makeCtx([source]);
      expect(getEndStepTriggers(ctx, 'p1').some((t) => t.permanentId === source.id)).toBe(true);
      expect(getEndStepTriggers(ctx, 'p2').some((t) => t.permanentId === source.id)).toBe(true);
    });

    it('queues Fraying Sanity on every end step', () => {
      const source = perm('fraying_end_1', 'p1', {
        name: 'Fraying Sanity',
        type_line: 'Enchantment — Aura Curse',
        oracle_text:
          'Enchant player\nAt the beginning of each end step, enchanted player mills X cards, where X is the number of cards put into their graveyard from anywhere this turn.',
      }, { attachedTo: 'p2' });
      const ctx = makeCtx([source]);
      expect(getEndStepTriggers(ctx, 'p1').some((t) => t.permanentId === source.id)).toBe(true);
      expect(getEndStepTriggers(ctx, 'p2').some((t) => t.permanentId === source.id)).toBe(true);
    });

    it('queues Ashcoat optional mill on your end step only', () => {
      const source = perm('ashcoat_end_1', 'p1', {
        name: 'Ashcoat of the Shadow Swarm',
        type_line: 'Legendary Creature — Rat Warlock',
        oracle_text: 'At the beginning of your end step, you may mill four cards.',
      });
      const ctx = makeCtx([source]);
      expect(getEndStepTriggers(ctx, 'p1').some((t) => t.permanentId === source.id)).toBe(true);
      expect(getEndStepTriggers(ctx, 'p2').some((t) => t.permanentId === source.id)).toBe(false);
    });

    it('queues Conjurer\'s Closet on your end step only', () => {
      const source = perm('closet_end_1', 'p1', {
        name: "Conjurer's Closet",
        type_line: 'Artifact',
        oracle_text:
          'At the beginning of your end step, you may exile target creature you control, then return that card to the battlefield under your control.',
      });
      const ctx = makeCtx([source]);
      expect(getEndStepTriggers(ctx, 'p1').some((t) => t.permanentId === source.id)).toBe(true);
      expect(getEndStepTriggers(ctx, 'p2').some((t) => t.permanentId === source.id)).toBe(false);
    });

    it('queues opponent end step only on an opponent\'s turn', () => {
      const source = perm('opp_end_1', 'p1', {
        name: 'Opponent End Step',
        type_line: 'Creature',
        oracle_text: "At the beginning of each opponent's end step, create a 1/1 white Soldier creature token.",
      });
      const ctx = makeCtx([source]);
      expect(getEndStepTriggers(ctx, 'p1').some((t) => t.permanentId === source.id)).toBe(false);
      expect(getEndStepTriggers(ctx, 'p2').some((t) => t.permanentId === source.id)).toBe(true);
    });

    it('queues enchanted-player end step only when attachedTo is the active player', () => {
      const source = perm('curse_end_1', 'p1', {
        name: 'Enchanted End Step',
        type_line: 'Enchantment — Aura Curse',
        oracle_text: "Enchant player\nAt the beginning of enchanted player's end step, that player discards a card.",
      }, { attachedTo: 'p2' });
      const ctx = makeCtx([source]);
      expect(getEndStepTriggers(ctx, 'p1').some((t) => t.permanentId === source.id)).toBe(false);
      expect(getEndStepTriggers(ctx, 'p2').some((t) => t.permanentId === source.id)).toBe(true);
    });

    it('queues monarch end step only when state.monarch is the active player', () => {
      const source = perm('monarch_end_1', 'p1', {
        name: 'Monarch End Step',
        type_line: 'Enchantment',
        oracle_text: "At the beginning of the monarch's end step, that player draws a card.",
      });
      expect(getEndStepTriggers(makeCtx([source], { monarch: 'p2' }), 'p1').some((t) => t.permanentId === source.id)).toBe(false);
      expect(getEndStepTriggers(makeCtx([source], { monarch: 'p2' }), 'p2').some((t) => t.permanentId === source.id)).toBe(true);
    });
  });

  describe('draw step', () => {
    it('queues your-draw-step only on the controller\'s turn', () => {
      const source = perm('your_draw_1', 'p1', {
        name: 'Your Draw Step',
        type_line: 'Enchantment',
        oracle_text: 'At the beginning of your draw step, discard a card.',
      });
      const ctx = makeCtx([source]);
      expect(getDrawStepTriggers(ctx, 'p1').some((t) => t.permanentId === source.id)).toBe(true);
      expect(getDrawStepTriggers(ctx, 'p2').some((t) => t.permanentId === source.id)).toBe(false);
    });

    it("queues each player's draw step on every turn", () => {
      const source = perm('each_draw_1', 'p1', {
        name: 'Each Draw Step',
        type_line: 'Artifact',
        oracle_text: "At the beginning of each player's draw step, that player mills two cards.",
      });
      const ctx = makeCtx([source]);
      expect(getDrawStepTriggers(ctx, 'p1').some((t) => t.permanentId === source.id)).toBe(true);
      expect(getDrawStepTriggers(ctx, 'p2').some((t) => t.permanentId === source.id)).toBe(true);
    });

    it('queues opponent draw step only on an opponent\'s turn', () => {
      const source = perm('opp_draw_1', 'p1', {
        name: 'Opponent Draw Step',
        type_line: 'Enchantment',
        oracle_text: "At the beginning of each opponent's draw step, you draw a card.",
      });
      const ctx = makeCtx([source]);
      expect(getDrawStepTriggers(ctx, 'p1').some((t) => t.permanentId === source.id)).toBe(false);
      expect(getDrawStepTriggers(ctx, 'p2').some((t) => t.permanentId === source.id)).toBe(true);
    });

    it('queues enchanted-player draw step only when attachedTo is the active player', () => {
      const source = perm('curse_draw_1', 'p1', {
        name: 'Enchanted Draw Step',
        type_line: 'Enchantment — Aura Curse',
        oracle_text: "Enchant player\nAt the beginning of enchanted player's draw step, that player discards a card.",
      }, { attachedTo: 'p2' });
      const ctx = makeCtx([source]);
      expect(getDrawStepTriggers(ctx, 'p1').some((t) => t.permanentId === source.id)).toBe(false);
      expect(getDrawStepTriggers(ctx, 'p2').some((t) => t.permanentId === source.id)).toBe(true);
    });
  });

  describe('beginning of combat', () => {
    it('queues on-your-turn combat only for the controller', () => {
      const source = perm('your_combat_1', 'p1', {
        name: 'Your Combat',
        type_line: 'Creature',
        oracle_text: 'At the beginning of combat on your turn, create a 1/1 white Soldier creature token.',
      });
      const ctx = makeCtx([source]);
      expect(getBeginningOfCombatTriggers(ctx, 'p1').some((t) => t.permanentId === source.id)).toBe(true);
      expect(getBeginningOfCombatTriggers(ctx, 'p2').some((t) => t.permanentId === source.id)).toBe(false);
    });

    it('queues each-combat on every turn', () => {
      const source = perm('each_combat_1', 'p1', {
        name: 'Each Combat',
        type_line: 'Enchantment',
        oracle_text: 'At the beginning of each combat, creatures you control get +1/+1 until end of turn.',
      });
      const ctx = makeCtx([source]);
      expect(getBeginningOfCombatTriggers(ctx, 'p1').some((t) => t.permanentId === source.id)).toBe(true);
      expect(getBeginningOfCombatTriggers(ctx, 'p2').some((t) => t.permanentId === source.id)).toBe(true);
    });

    it('queues opponent beginning-of-combat on an opponent\'s turn', () => {
      const source = perm('opp_combat_1', 'p1', {
        name: 'Opponent Combat',
        type_line: 'Enchantment',
        oracle_text: "At the beginning of combat on each opponent's turn, create a 1/1 red Goblin creature token.",
      });
      const ctx = makeCtx([source]);
      expect(getBeginningOfCombatTriggers(ctx, 'p1').some((t) => t.permanentId === source.id)).toBe(false);
      expect(getBeginningOfCombatTriggers(ctx, 'p2').some((t) => t.permanentId === source.id)).toBe(true);
    });

    it('does not treat effect-text "each player" as every-turn combat', () => {
      const source = perm('your_combat_each_player_1', 'p1', {
        name: 'Your Combat Each Player',
        type_line: 'Enchantment',
        oracle_text: 'At the beginning of combat on your turn, each player draws a card.',
      });
      const ctx = makeCtx([source]);
      expect(getBeginningOfCombatTriggers(ctx, 'p1').some((t) => t.permanentId === source.id)).toBe(true);
      expect(getBeginningOfCombatTriggers(ctx, 'p2').some((t) => t.permanentId === source.id)).toBe(false);
    });

    it('queues Terra combat mill on your combat only', () => {
      const source = perm('terra_combat_1', 'p1', {
        name: 'Terra, Herald of Hope',
        type_line: 'Legendary Creature — Human Wizard Warrior',
        oracle_text: 'Trance — At the beginning of combat on your turn, mill two cards.',
      });
      const ctx = makeCtx([source]);
      expect(getBeginningOfCombatTriggers(ctx, 'p1').some((t) => t.permanentId === source.id)).toBe(true);
      expect(getBeginningOfCombatTriggers(ctx, 'p2').some((t) => t.permanentId === source.id)).toBe(false);
    });

    it('queues Mindwrack Harpy mill on your combat only', () => {
      const source = perm('harpy_combat_1', 'p1', {
        name: 'Mindwrack Harpy',
        type_line: 'Enchantment Creature — Harpy',
        oracle_text: 'At the beginning of combat on your turn, each player mills three cards.',
      });
      const ctx = makeCtx([source]);
      expect(getBeginningOfCombatTriggers(ctx, 'p1').some((t) => t.permanentId === source.id)).toBe(true);
      expect(getBeginningOfCombatTriggers(ctx, 'p2').some((t) => t.permanentId === source.id)).toBe(false);
    });
  });

  describe('end of combat', () => {
    it('queues your-turn end of combat only for the controller', () => {
      const source = perm('your_eoc_1', 'p1', {
        name: 'Your End Combat',
        type_line: 'Enchantment',
        oracle_text: 'At the end of combat on your turn, draw a card.',
      });
      const ctx = makeCtx([source]);
      expect(getEndOfCombatTriggers(ctx, 'p1').some((t) => t.permanentId === source.id)).toBe(true);
      expect(getEndOfCombatTriggers(ctx, 'p2').some((t) => t.permanentId === source.id)).toBe(false);
    });

    it('queues each-combat end on every turn', () => {
      const source = perm('each_eoc_1', 'p1', {
        name: 'Each End Combat',
        type_line: 'Enchantment',
        oracle_text: 'At the end of each combat, you gain 1 life.',
      });
      const ctx = makeCtx([source]);
      expect(getEndOfCombatTriggers(ctx, 'p1').some((t) => t.permanentId === source.id)).toBe(true);
      expect(getEndOfCombatTriggers(ctx, 'p2').some((t) => t.permanentId === source.id)).toBe(true);
    });

    it('queues opponent end of combat only on an opponent\'s turn', () => {
      const source = perm('opp_eoc_1', 'p1', {
        name: 'Opponent End Combat',
        type_line: 'Enchantment',
        oracle_text: "At the end of combat on each opponent's turn, you draw a card.",
      });
      const ctx = makeCtx([source]);
      expect(getEndOfCombatTriggers(ctx, 'p1').some((t) => t.permanentId === source.id)).toBe(false);
      expect(getEndOfCombatTriggers(ctx, 'p2').some((t) => t.permanentId === source.id)).toBe(true);
    });
  });

  describe('main phases', () => {
    it('queues your first main only on the controller\'s turn', () => {
      const source = perm('your_main_1', 'p1', {
        name: 'Your First Main',
        type_line: 'Artifact',
        oracle_text: 'At the beginning of your first main phase, create a Treasure token.',
      });
      const ctx = makeCtx([source]);
      expect(getPrecombatMainTriggers(ctx, 'p1').some((t) => t.permanentId === source.id)).toBe(true);
      expect(getPrecombatMainTriggers(ctx, 'p2').some((t) => t.permanentId === source.id)).toBe(false);
    });

    it("queues each player's first main on every turn", () => {
      const source = perm('each_main_1', 'p1', {
        name: 'Each First Main',
        type_line: 'Enchantment',
        oracle_text: "At the beginning of each player's first main phase, that player creates a Treasure token.",
      });
      const ctx = makeCtx([source]);
      expect(getPrecombatMainTriggers(ctx, 'p1').some((t) => t.permanentId === source.id)).toBe(true);
      expect(getPrecombatMainTriggers(ctx, 'p2').some((t) => t.permanentId === source.id)).toBe(true);
    });

    it('does not treat effect-text "each player" as every-turn main', () => {
      const source = perm('your_main_each_1', 'p1', {
        name: 'Your Main Each Player',
        type_line: 'Enchantment',
        oracle_text: 'At the beginning of your first main phase, each player draws a card.',
      });
      const ctx = makeCtx([source]);
      expect(getPrecombatMainTriggers(ctx, 'p1').some((t) => t.permanentId === source.id)).toBe(true);
      expect(getPrecombatMainTriggers(ctx, 'p2').some((t) => t.permanentId === source.id)).toBe(false);
    });

    it('queues your second main phase on the controller\'s MAIN2, not MAIN1', () => {
      const source = perm('estinien_1', 'p1', {
        name: 'Estinien Varlineau',
        type_line: 'Legendary Creature — Human Knight',
        oracle_text:
          'At the beginning of your second main phase, you draw X cards and lose X life, where X is the number of your opponents who were dealt combat damage by Estinien Varlineau or a Dragon this turn.',
      });
      const ctx = makeCtx([source]);
      expect(getPrecombatMainTriggers(ctx, 'p1').some((t) => t.permanentId === source.id)).toBe(false);
      expect(getPostcombatMainTriggers(ctx, 'p1').some((t) => t.permanentId === source.id)).toBe(true);
      expect(getPostcombatMainTriggers(ctx, 'p2').some((t) => t.permanentId === source.id)).toBe(false);
    });

    it('does not queue optional combat-damage pay-life when X is 0', () => {
      const source = perm('tymna_zero_1', 'p1', {
        name: 'Tymna the Weaver',
        type_line: 'Legendary Creature — Human Cleric',
        oracle_text:
          'At the beginning of each of your postcombat main phases, you may pay X life, where X is the number of opponents that were dealt combat damage this turn. If you do, draw X cards.',
      });
      const ctx = makeCtx([source], { creaturesThatDealtDamageToPlayer: {} });
      expect(getPostcombatMainTriggers(ctx, 'p1').some((t) => t.permanentId === source.id)).toBe(false);
    });

    it('queues Florian look-at-top X on your postcombat main only', () => {
      const source = perm('florian_1', 'p1', {
        name: 'Florian, Voldaren Scion',
        type_line: 'Legendary Creature — Vampire Noble',
        oracle_text:
          'At the beginning of each of your postcombat main phases, look at the top X cards of your library, where X is the total amount of life your opponents lost this turn.',
      });
      const ctx = makeCtx([source]);
      expect(getPrecombatMainTriggers(ctx, 'p1').some((t) => t.permanentId === source.id)).toBe(false);
      expect(getPostcombatMainTriggers(ctx, 'p1').some((t) => t.permanentId === source.id)).toBe(true);
      expect(getPostcombatMainTriggers(ctx, 'p2').some((t) => t.permanentId === source.id)).toBe(false);
    });

    it('queues each of your postcombat mains on the controller\'s MAIN2, not MAIN1', () => {
      const source = perm('tymna_1', 'p1', {
        name: 'Tymna the Weaver',
        type_line: 'Legendary Creature — Human Cleric',
        oracle_text:
          'At the beginning of each of your postcombat main phases, you may pay X life, where X is the number of opponents that were dealt combat damage this turn. If you do, draw X cards.',
      });
      const ctx = makeCtx([source], {
        creaturesThatDealtDamageToPlayer: {
          p2: { atk: { creatureName: 'Attacker', totalDamage: 1 } },
        },
      });
      expect(getPrecombatMainTriggers(ctx, 'p1').some((t) => t.permanentId === source.id)).toBe(false);
      expect(getPostcombatMainTriggers(ctx, 'p1').some((t) => t.permanentId === source.id)).toBe(true);
      expect(getPostcombatMainTriggers(ctx, 'p2').some((t) => t.permanentId === source.id)).toBe(false);
    });

    it('does not queue enchanted-player postcombat on the aura controller\'s turn', () => {
      const source = perm('curse_post_1', 'p1', {
        name: 'Enchanted Postcombat',
        type_line: 'Enchantment — Aura Curse',
        oracle_text: "Enchant player\nAt the beginning of each of enchanted player's postcombat main phases, each player draws a card.",
      }, { attachedTo: 'p2' });
      const ctx = makeCtx([source]);
      expect(getPostcombatMainTriggers(ctx, 'p1').some((t) => t.permanentId === source.id)).toBe(false);
      expect(getPostcombatMainTriggers(ctx, 'p2').some((t) => t.permanentId === source.id)).toBe(true);
    });
  });
});

describe('phase emitter — detector coverage', () => {
  it('does not drop queued ids when both players are scanned', () => {
    const yourUpkeep = perm('scan_your_1', 'p1', {
      name: 'Scan Your',
      type_line: 'Enchantment',
      oracle_text: 'At the beginning of your upkeep, scry 1.',
    });
    const eachEnd = perm('scan_each_1', 'p1', {
      name: 'Scan Each',
      type_line: 'Enchantment',
      oracle_text: "At the beginning of each player's end step, scry 1.",
    });
    const ctx = makeCtx([yourUpkeep, eachEnd]);
    expect(names(getUpkeepTriggersForPlayer(ctx, 'p1'))).toContain(yourUpkeep.id);
    expect(names(getEndStepTriggers(ctx, 'p2'))).toContain(eachEnd.id);
  });
});
