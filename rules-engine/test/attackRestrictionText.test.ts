import { describe, expect, it } from 'vitest';

import {
  getAttackProhibitionSourceForPlayer,
  getIllegalDefendingPlayerRestriction,
  hasBlanketCantAttack,
  parseSelfCombatRestrictions,
  permanentCannotBeSacrificed,
  permanentHasMustAttackRequirement,
} from '../src/attackRestrictionText';
import { canPermanentAttack, validateDeclareAttackers, type DeclareAttackersAction } from '../src/actions/combat';
import { validateSacrifice } from '../src/actions/sacrifice';
import type { GameState, BattlefieldPermanent } from '../../shared/src/types';
import { GameStep } from '../../shared/src/types';

const ALEXIOS_STYLE_ORACLE =
  "Trample\nThis creature attacks each combat if able, can't be sacrificed, and can't attack its owner.\nAt the beginning of each player's upkeep, that player gains control of this creature, untaps it, and puts a +1/+1 counter on it.";

const XANTCHA_STYLE_ORACLE =
  "This creature enters under the control of an opponent of your choice.\nThis creature attacks each combat if able and can't attack its owner or planeswalkers its owner controls.";

describe('attackRestrictionText', () => {
  it('classifies player-specific cannot-attack as not a blanket lock', () => {
    const parsed = parseSelfCombatRestrictions(ALEXIOS_STYLE_ORACLE);
    expect(parsed.hasBlanketCantAttack).toBe(false);
    expect(parsed.mustAttackEachCombat).toBe(true);
    expect(parsed.cantAttackOwner).toBe(true);
    expect(parsed.cantBeSacrificed).toBe(true);
    expect(hasBlanketCantAttack(ALEXIOS_STYLE_ORACLE)).toBe(false);
  });

  it('matches card-name must-attack subjects, not only "this creature"', () => {
    const parsed = parseSelfCombatRestrictions(
      "Alexios attacks each combat if able, can't be sacrificed, and can't attack its owner.",
    );
    expect(parsed.mustAttackEachCombat).toBe(true);
    expect(parsed.cantAttackOwner).toBe(true);
    expect(parsed.cantBeSacrificed).toBe(true);
  });

  it('does not treat goad reminder text on another card as a self must-attack', () => {
    const parsed = parseSelfCombatRestrictions(
      'Whenever this creature enters or attacks, goad target creature. (Until your next turn, that creature attacks each combat if able and attacks a player other than you if able.)',
    );
    expect(parsed.mustAttackEachCombat).toBe(false);
    expect(parsed.hasBlanketCantAttack).toBe(false);
  });

  it('does not treat pillowfort "creatures can\'t attack you unless" as a self owner lock', () => {
    const parsed = parseSelfCombatRestrictions(
      "Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you.",
    );
    expect(parsed.cantAttackOwner).toBe(false);
    expect(parsed.hasBlanketCantAttack).toBe(false);
  });

  it('still treats Pacifism-style text as a blanket attack lock', () => {
    expect(hasBlanketCantAttack("Enchanted creature can't attack or block.")).toBe(true);
    expect(hasBlanketCantAttack("can't attack")).toBe(true);
    expect(hasBlanketCantAttack("This creature can't attack.")).toBe(true);
  });

  it('does not treat "other creatures can\'t attack" as a self blanket', () => {
    expect(hasBlanketCantAttack("Other creatures can't attack this turn.")).toBe(false);
  });

  it('blocks attacking the owner but not other players', () => {
    expect(
      getIllegalDefendingPlayerRestriction({
        oracleText: ALEXIOS_STYLE_ORACLE,
        ownerId: 'owner',
        defendingPlayerId: 'owner',
      }).illegal,
    ).toBe(true);
    expect(
      getIllegalDefendingPlayerRestriction({
        oracleText: ALEXIOS_STYLE_ORACLE,
        ownerId: 'owner',
        defendingPlayerId: 'opponent',
      }).illegal,
    ).toBe(false);
    expect(
      getIllegalDefendingPlayerRestriction({
        oracleText: ALEXIOS_STYLE_ORACLE,
        ownerId: 'owner',
        defendingPlayerId: 'owner',
        targetIsOwnerPlaneswalker: true,
      }).illegal,
    ).toBe(false);
    expect(
      getIllegalDefendingPlayerRestriction({
        oracleText: XANTCHA_STYLE_ORACLE,
        ownerId: 'owner',
        defendingPlayerId: 'owner',
        targetIsOwnerPlaneswalker: true,
      }).illegal,
    ).toBe(true);
  });

  it('detects player-attack prohibitions without matching pillowfort unless', () => {
    const battlefield = [
      {
        id: 'archon',
        controller: 'p2',
        card: { name: 'Archon', oracle_text: "Flying\nCreatures can't attack you." },
      },
      {
        id: 'prison',
        controller: 'p3',
        card: {
          name: 'Prison',
          oracle_text:
            "Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you.",
        },
      },
    ];
    expect(getAttackProhibitionSourceForPlayer(battlefield, 'p2')).toBe('Archon');
    expect(getAttackProhibitionSourceForPlayer(battlefield, 'p3')).toBeNull();

    const annexBattlefield = [{
      id: 'annex',
      controller: 'p2',
      card: {
        name: 'White Gate',
        oracle_text:
          "({W/P} can be paid with either {W} or 2 life.)\nCreatures can't attack you or planeswalkers you control unless their controller pays {W/P} for each of those creatures.",
      },
    }];
    expect(getAttackProhibitionSourceForPlayer(annexBattlefield, 'p2')).toBeNull();

    const sanctuaryBattlefield = [{
      id: 'sanctuary',
      controller: 'p2',
      card: {
        name: 'Harbor Charm',
        oracle_text:
          "If you would draw a card during your draw step, instead you may skip that draw. If you do, until your next turn, you can't be attacked except by creatures with flying and/or islandwalk.",
      },
    }];
    expect(getAttackProhibitionSourceForPlayer(sanctuaryBattlefield, 'p2')).toBeNull();

    const grassBattlefield = [{
      id: 'grass',
      controller: 'p2',
      card: {
        name: 'Grass',
        oracle_text:
          "Cumulative upkeep {1}\nBlack creatures can't attack you.\nNonblack creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you.",
      },
    }];
    expect(getAttackProhibitionSourceForPlayer(grassBattlefield, 'p2')).toBeNull();
  });

  it('prevents sacrifice from self oracle and equipped-creature text', () => {
    const creature = {
      id: 'c1',
      controller: 'p2',
      owner: 'p1',
      card: { name: 'Sleeper', type_line: 'Creature', oracle_text: ALEXIOS_STYLE_ORACLE },
    };
    expect(permanentCannotBeSacrificed(creature, [creature])).toBe(true);

    const bear = {
      id: 'bear',
      controller: 'p1',
      owner: 'p1',
      attachments: ['suit'],
      card: { name: 'Bear', type_line: 'Creature — Bear', oracle_text: '' },
    };
    const suit = {
      id: 'suit',
      controller: 'p1',
      attachedTo: 'bear',
      card: {
        name: 'Suit',
        type_line: 'Artifact — Equipment',
        oracle_text: "Equipped creature gets +2/+2, has haste, can't be sacrificed, and can't attack you.",
      },
    };
    expect(permanentCannotBeSacrificed(bear, [bear, suit])).toBe(true);
    expect(permanentCannotBeSacrificed(bear, [bear])).toBe(false);
  });

  it('does not infer restrictions from an empty-oracle namesake', () => {
    const parsed = parseSelfCombatRestrictions('');
    expect(parsed.mustAttackEachCombat).toBe(false);
    expect(parsed.cantAttackOwner).toBe(false);
    expect(parsed.cantBeSacrificed).toBe(false);
    expect(parsed.hasBlanketCantAttack).toBe(false);
  });
});

describe('canPermanentAttack player-specific restrictions', () => {
  const creature = {
    id: 'c1',
    controller: 'p2',
    owner: 'p1',
    tapped: false,
    card: {
      type_line: 'Legendary Creature — Human Berserker',
      oracle_text: ALEXIOS_STYLE_ORACLE,
    },
  };

  it('allows attacking a player who is not the owner', () => {
    expect(canPermanentAttack(creature, 'p2', [creature], 'p3').canParticipate).toBe(true);
  });

  it('rejects attacking the owner without locking all attacks', () => {
    const vsOwner = canPermanentAttack(creature, 'p2', [creature], 'p1');
    expect(vsOwner.canParticipate).toBe(false);
    expect(vsOwner.reason).toMatch(/owner/i);
    expect(canPermanentAttack(creature, 'p2', [creature]).canParticipate).toBe(true);
  });

  it('still rejects Pacifism-style blanket text', () => {
    const pacified = {
      id: 'c2',
      tapped: false,
      card: { type_line: 'Creature — Bear', oracle_text: '' },
      temporaryEffects: [{ id: 'pacifism', description: "can't attack or block" }],
    };
    expect(canPermanentAttack(pacified).canParticipate).toBe(false);
  });
});

describe('must-attack and cannot-sacrifice enforcement', () => {
  it('requires a must-attack creature to attack when a legal defender exists', () => {
    const creature: BattlefieldPermanent = {
      id: 'c1',
      controller: 'p2',
      owner: 'p1',
      tapped: false,
      card: {
        id: 'c1',
        name: 'Sleeper',
        type_line: 'Creature',
        oracle_text: ALEXIOS_STYLE_ORACLE,
      },
    } as BattlefieldPermanent;

    const state = {
      turn: 3,
      step: GameStep.DECLARE_ATTACKERS,
      activePlayerIndex: 0,
      battlefield: [creature],
      players: [
        { id: 'p2', life: 40, battlefield: [] },
        { id: 'p1', life: 40, battlefield: [] },
        { id: 'p3', life: 40, battlefield: [] },
      ],
    } as GameState;

    const skipped: DeclareAttackersAction = {
      type: 'declareAttackers',
      playerId: 'p2',
      attackers: [],
    };
    const skipResult = validateDeclareAttackers(state, skipped);
    expect(skipResult.legal).toBe(false);
    expect(skipResult.reason).toMatch(/attacks each combat if able/i);

    const vsOwner: DeclareAttackersAction = {
      type: 'declareAttackers',
      playerId: 'p2',
      attackers: [{ creatureId: 'c1', defendingPlayerId: 'p1' }],
    };
    expect(validateDeclareAttackers(state, vsOwner).legal).toBe(false);

    const vsOther: DeclareAttackersAction = {
      type: 'declareAttackers',
      playerId: 'p2',
      attackers: [{ creatureId: 'c1', defendingPlayerId: 'p3' }],
    };
    expect(validateDeclareAttackers(state, vsOther).legal).toBe(true);
  });

  it('forces other creatures to attack under an all-creatures requirement', () => {
    const avatar = {
      id: 'avatar',
      controller: 'p1',
      owner: 'p1',
      tapped: false,
      card: {
        name: 'Avatar',
        type_line: 'Creature',
        oracle_text: 'All creatures attack each combat if able.',
      },
    };
    const bear = {
      id: 'bear',
      controller: 'p1',
      owner: 'p1',
      tapped: false,
      card: { name: 'Bear', type_line: 'Creature — Bear', oracle_text: '' },
    };
    expect(permanentHasMustAttackRequirement(bear, [avatar, bear])).toBe(true);
  });

  it('rejects sacrificing a creature whose oracle says it cannot be sacrificed', () => {
    const state = {
      battlefield: [
        {
          id: 'c1',
          controller: 'p2',
          owner: 'p1',
          card: { name: 'Sleeper', oracle_text: ALEXIOS_STYLE_ORACLE },
        },
      ],
      players: [{ id: 'p2' }],
    } as GameState;

    const result = validateSacrifice(state, { type: 'sacrifice', playerId: 'p2', permanentId: 'c1' });
    expect(result.legal).toBe(false);
    expect(result.reason).toMatch(/can't be sacrificed/i);
  });

  it('still parses Xantcha-style owner plus planeswalker restrictions', () => {
    const parsed = parseSelfCombatRestrictions(XANTCHA_STYLE_ORACLE);
    expect(parsed.mustAttackEachCombat).toBe(true);
    expect(parsed.cantAttackOwner).toBe(true);
    expect(parsed.cantAttackOwnerPlaneswalkers).toBe(true);
    expect(parsed.cantBeSacrificed).toBe(false);
  });
});
