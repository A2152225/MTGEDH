import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { applyAttachStep } from '../src/oracleIRExecutorAttachStepHandlers';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  parseMoveZoneThatPile,
  parseMoveZoneTypedCardFromAmongThem,
} from '../src/oracleIRExecutorZoneOps';
import { evaluateConditionalWrapperCondition } from '../src/oracleIRExecutorConditionalStepSupport';

const controllerId = 'p1' as PlayerID;

describe('Oracle IR gap batch 299 — selector cluster fixes', () => {
  it('parses that pile selector', () => {
    expect(parseMoveZoneThatPile({ kind: 'raw', text: 'that pile' })).toBe(true);
  });

  it('parses Turntimber creature among-them BF/library-bottom split', () => {
    expect(
      parseMoveZoneTypedCardFromAmongThem(
        { kind: 'raw', text: 'a creature card from among them' },
        {
          to: 'battlefield',
          toRaw: 'the battlefield',
          raw: 'You may put a creature card from among them onto the battlefield. If that card has mana value 3 or less, it enters with three additional +1/+1 counters on it. Put the rest on the bottom of your library in a random order.',
        }
      )
    ).toEqual({ cardType: 'creature', maxCount: 1, bfLibraryBottomSplit: true, entersTappedFromWhat: false });
  });

  it('evaluates Turntimber conditional that-card mana value', () => {
    const state = {
      players: [
        {
          id: controllerId,
          library: [{ id: 'lib-turntimber-1', name: 'Bear', type_line: 'Creature — Bear', cmc: 2 }],
          hand: [],
          graveyard: [],
        },
      ],
      battlefield: [],
    } as GameState;
    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: 'that card has mana value 3 or less' },
        nextState: state,
        controllerId,
        ctx: {
          controllerId,
          selectorContext: { chosenObjectIds: ['lib-turntimber-1'] },
        },
      })
    ).toBe(true);
  });

  it('executes Abstract Performance that pile to graveyard', () => {
    const ir = parseOracleTextToIR(
      'Exile the top four cards of your library in a face-down pile, then exile the top four cards of your library in a face-up pile. An opponent chooses one of those piles. Put that pile into your graveyard. Look at the cards in the other pile. You may cast a spell from among them without paying its mana cost. Put the rest into your hand.',
      'Abstract Performance'
    );
    const step = ir.abilities
      .flatMap((ability) => ability.steps || [])
      .find((entry) => entry.kind === 'move_zone' && (entry as any).what?.text === 'that pile');
    expect(step).toBeDefined();
    const pileCards = [
      { id: 'exile-abstract-1', name: 'Bolt', type_line: 'Instant', cmc: 1 },
      { id: 'exile-abstract-2', name: 'Shock', type_line: 'Instant', cmc: 1 },
    ];
    const state = {
      players: [{ id: controllerId, library: [], hand: [], graveyard: [], exile: pileCards }],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step], {
      controllerId,
      sourceId: 'abstract',
      lastMovedCards: pileCards,
      selectorContext: { chosenObjectIds: ['exile-abstract-1', 'exile-abstract-2'] },
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.graveyard.length).toBe(2);
    expect(player.exile.length).toBe(0);
  });

  it('executes Turntimber Symbiosis optional creature with conditional counters', () => {
    const ir = parseOracleTextToIR(
      'Look at the top seven cards of your library. You may put a creature card from among them onto the battlefield. If that card has mana value 3 or less, it enters with three additional +1/+1 counters on it. Put the rest on the bottom of your library in a random order.',
      'Turntimber Symbiosis'
    );
    const step = ir.abilities[0]?.steps?.find(
      (entry) => entry.kind === 'move_zone' && (entry as any).to === 'battlefield'
    );
    const lookedAt = [
      { id: 'lib-turntimber-1', name: 'Bear', type_line: 'Creature — Bear', cmc: 2 },
      { id: 'lib-turntimber-2', name: 'Elf', type_line: 'Creature — Elf', cmc: 1 },
      { id: 'lib-turntimber-3', name: 'Bolt', type_line: 'Instant', cmc: 1 },
    ];
    const state = {
      players: [{ id: controllerId, library: [...lookedAt], hand: [], graveyard: [] }],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(
      state,
      [step],
      {
        controllerId,
        sourceId: 'turntimber',
        lastMovedCards: lookedAt,
        selectorContext: { chosenObjectIds: ['lib-turntimber-1'] },
      },
      { allowOptional: true }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect((result.state?.battlefield || []).length).toBe(1);
    const permanent = (result.state?.battlefield || [])[0] as any;
    expect(permanent?.counters?.['+1/+1']).toBe(3);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.library.length).toBe(2);
  });

  it('executes Aura Finesse reattach aura you control', () => {
    const ir = parseOracleTextToIR('Attach target Aura you control to target creature.', 'Aura Finesse');
    const step = ir.abilities[0]?.steps?.[0];
    const state = {
      players: [{ id: controllerId, library: [], hand: [], graveyard: [] }],
      battlefield: [
        {
          id: 'aura-finesse-1',
          controller: controllerId,
          owner: controllerId,
          card: { name: 'Pacifism', type_line: 'Enchantment — Aura', cmc: 2 },
          attachedTo: 'creature-old',
          attachments: [],
          counters: {},
          tapped: false,
        },
        {
          id: 'creature-old',
          controller: controllerId,
          owner: controllerId,
          card: { name: 'Soldier', type_line: 'Creature — Soldier', cmc: 2 },
          attachments: ['aura-finesse-1'],
          counters: {},
          tapped: false,
        },
        {
          id: 'creature-new',
          controller: controllerId,
          owner: controllerId,
          card: { name: 'Warrior', type_line: 'Creature — Warrior', cmc: 3 },
          attachments: [],
          counters: {},
          tapped: false,
        },
      ],
    } as GameState;

    const result = applyAttachStep(state, step as any, {
      controllerId,
      sourceId: 'aura-finesse',
      selectorContext: { chosenObjectIds: ['aura-finesse-1', 'creature-new'] },
      targetPermanentId: 'creature-new',
    }, []);
    expect(result.reason).not.toBe('unsupported_selector');
    const aura = (result.state?.battlefield || []).find((entry) => (entry as any).id === 'aura-finesse-1') as any;
    expect(aura?.attachedTo).toBe('creature-new');
  });
});
