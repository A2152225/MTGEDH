/**
 * Origin parent: oracleIRParserSimpleActionClauses.ts
 * Cluster moved: tryParseSimpleActionClause discard / vote / clash / monarch clauses
 * Public: tryParseSimpleActionDiscardVoteClauses
 */

import type { OracleEffectStep } from './oracleIR';
import { parseObjectSelector, parsePlayerSelector, parseQuantity } from './oracleIRParserUtils';
import { normalizeCounterName } from './oracleIRParserSacrificeHelpers';
import { PLAYER_SUBJECT_PREFIX, parseManaOptionGroupList } from './oracleIRParserSimpleActionHelpers';
import type { SimpleActionClauseParseArgs } from './oracleIRParserSimpleActionHelpers';

export function tryParseSimpleActionDiscardVoteClauses(args: SimpleActionClauseParseArgs): OracleEffectStep | null {
  const { clause, rawClause, withMeta } = args;

  {
    const revealThoseToHand = clause.match(/^reveal\s+those\s+cards,\s*put\s+them\s+into\s+your\s+hand$/i);
    if (revealThoseToHand) {
      return withMeta({
        kind: 'move_zone',
        what: parseObjectSelector('those cards'),
        to: 'hand',
        toRaw: 'your hand',
        raw: rawClause,
        });
    }
  }

  {
    const shuffleZones = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}shuffles?\\s+(?:your|their|his or her)\\s+hand\\s+and\\s+graveyard\\s+into\\s+(?:your|their|his or her)\\s+library$`, 'i')
    );
    if (shuffleZones) {
      return withMeta({
        kind: 'shuffle_zones_into_library',
        who: parsePlayerSelector(shuffleZones[1]),
        zones: ['hand', 'graveyard'],
        raw: rawClause,
        });
    }
  }

  {
    const discardAnyNumber = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:may\\s+)?discards?\\s+any\\s+number\\s+of\\s+cards$`, 'i'));
    if (discardAnyNumber) {
      return withMeta({
        kind: 'discard',
        who: parsePlayerSelector(discardAnyNumber[1]),
        amount: { kind: 'any_number' },
        optional: /\\bmay\\b/i.test(clause) || undefined,
        raw: rawClause,
        });
    }

    const discardOneOrMore = clause.match(/^(?:you\s+may\s+)?discard\s+one\s+or\s+more\s+(.+?\s+cards?)\b/i);
    if (discardOneOrMore) {
      return withMeta({
        kind: 'discard',
        who: { kind: 'you' },
        amount: { kind: 'any_number' },
        target: parseObjectSelector(String(discardOneOrMore[1] || '').trim()),
        optional: /\bmay\b/i.test(clause) || undefined,
        raw: rawClause,
      });
    }

    const discardAllMatching = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:may\\s+)?discards?\\s+all\\s+(.+)$`, 'i'),
    );
    if (discardAllMatching) {
      const filter = String(discardAllMatching[2] || '').trim();
      const isWholeHand =
        /^(?:the\s+)?cards?\s+(?:in|from)\s+(?:your|their)\s+hand$/i.test(filter) ||
        /^(?:your|their)\s+hand$/i.test(filter);
      if (filter && !isWholeHand) {
        return withMeta({
          kind: 'discard',
          who: parsePlayerSelector(discardAllMatching[1]),
          amount: { kind: 'all' },
          target: parseObjectSelector(filter),
          optional: /\bmay\b/i.test(clause) || undefined,
          raw: rawClause,
        });
      }
    }
  }

  {
    const moveSingleCounter = clause.match(/^(?:you\s+may\s+)?move\s+(?!(?:any)\b)(a|an|one|\d+|[a-z]+)\s+(.+?)\s+counters?\s+from\s+(.+?)\s+onto\s+(.+)$/i);
    if (moveSingleCounter) {
      return withMeta({
        kind: 'move_counters',
        from: parseObjectSelector(String(moveSingleCounter[3] || '').trim()),
        to: parseObjectSelector(String(moveSingleCounter[4] || '').trim()),
        counter: normalizeCounterName(String(moveSingleCounter[2] || '').trim()),
        amount: parseQuantity(String(moveSingleCounter[1] || '').trim()),
        optional: /\bmay\b/i.test(clause) || undefined,
        raw: rawClause,
        });
    }
  }

  {
    const moveAnyCounters = clause.match(/^move\s+any\s+number\s+of\s+(.+?)\s+counters?\s+from\s+(.+?)\s+onto\s+(.+)$/i);
    if (moveAnyCounters) {
      return withMeta({
        kind: 'move_counters',
        from: parseObjectSelector(String(moveAnyCounters[2] || '').trim()),
        to: parseObjectSelector(String(moveAnyCounters[3] || '').trim()),
        counter: normalizeCounterName(String(moveAnyCounters[1] || '').trim()),
        amount: { kind: 'any_number' },
        raw: rawClause,
        });
    }
  }

  {
    const moveCounters = clause.match(/^(?:you\s+may\s+)?put\s+its\s+(?:(\+1\/\+1)\s+)?counters\s+on\s+(.+)$/i);
    if (moveCounters) {
      return withMeta({
        kind: 'move_counters',
        from: parseObjectSelector('it'),
        to: parseObjectSelector(String(moveCounters[2] || '').trim()),
        ...(moveCounters[1] ? { counter: normalizeCounterName(String(moveCounters[1] || '').trim()) } : {}),
        amount: { kind: 'all' },
        optional: /\bmay\b/i.test(clause) || undefined,
        raw: rawClause,
        });
    }
  }

  {
    const forceBlock = clause.match(/^target\s+creature\s+blocks\s+this\s+creature\s+this\s+turn\s+if\s+able$/i);
    if (forceBlock) {
      return withMeta({
        kind: 'force_block',
        blocker: parseObjectSelector('target creature'),
        attacker: parseObjectSelector('this creature'),
        duration: 'end_of_turn',
        raw: rawClause,
        });
    }

    const forceBlockThisTurn = clause.match(/^((?:up\s+to\s+one\s+)?(?:another\s+)?target\s+.+?|they|it|those\s+creatures)\s+blocks?\s+this\s+(?:turn|combat)\s+if\s+able$/i);
    if (forceBlockThisTurn) {
      return withMeta({
        kind: 'force_block',
        blocker: parseObjectSelector(String(forceBlockThisTurn[1] || '').trim()),
        attacker: parseObjectSelector('a creature attacking its controller'),
        duration: 'end_of_turn',
        raw: rawClause,
        });
    }

    const contextualForceBlockThisTurn = clause.match(/^(.+?)\s+blocks?\s+(.+?)\s+this\s+(?:turn|combat)\s+if\s+able$/i);
    if (contextualForceBlockThisTurn && /^(?:(?:up\s+to\s+one\s+)?(?:another\s+)?target\s+.+|all\s+creatures\s+with\s+.+)$/i.test(String(contextualForceBlockThisTurn[1] || '').trim())) {
      return withMeta({
        kind: 'force_block',
        blocker: parseObjectSelector(String(contextualForceBlockThisTurn[1] || '').trim()),
        attacker: parseObjectSelector(String(contextualForceBlockThisTurn[2] || '').trim()),
        duration: 'end_of_turn',
        raw: rawClause,
        });
    }

    const mustBeBlockedThisTurn = clause.match(/^(.+?)\s+must\s+be\s+blocked\s+this\s+turn\s+if\s+able$/i);
    if (mustBeBlockedThisTurn) {
      return withMeta({
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(String(mustBeBlockedThisTurn[1] || '').trim()),
        duration: 'this_turn',
        effectText: ['must be blocked if able'],
        raw: rawClause,
      });
    }

    const attacksPlayerThisCombat = clause.match(/^(this\s+creature|that\s+creature|it)\s+attacks\s+that\s+player\s+this\s+combat\s+if\s+able$/i);
    if (attacksPlayerThisCombat) {
      return withMeta({
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(String(attacksPlayerThisCombat[1] || '').trim()),
        duration: 'this_turn',
        effectText: ['attacks that player this combat if able'],
        raw: rawClause,
      });
    }

    const attacksEachCombat = clause.match(/^(.+?)\s+attack\s+each\s+combat\s+if\s+able$/i);
    if (attacksEachCombat) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(attacksEachCombat[1] || '').trim()),
        effectText: ['attack each combat if able'],
        duration: 'static',
        raw: rawClause,
      });
    }
  }

  {
    const noPreventDamage = clause.match(/^damage\s+can't\s+be\s+prevented\s+this\s+turn$/i);
    if (noPreventDamage) {
      return withMeta({
        kind: 'damage_cant_be_prevented',
        duration: 'this_turn',
        raw: rawClause,
        });
    }
    if (/^the\s+damage\s+can't\s+be\s+prevented$/i.test(clause)) {
      return withMeta({
        kind: 'damage_cant_be_prevented',
        duration: 'this_turn',
        raw: rawClause,
      });
    }
  }

  {
    const doubleCounters = clause.match(
      /^for each kind of counter on (.+),\s+put another of that kind of counter on (?:that|the) permanent$/i
    );
    if (doubleCounters) {
      return withMeta({
        kind: 'double_counters',
        target: parseObjectSelector(String(doubleCounters[1] || '').trim()),
        raw: rawClause,
        });
    }
  }

  {
    const doublePlayerCounters = clause.match(new RegExp(`^(?:•\\s*)?double\\s+the\\s+number\\s+of\\s+each\\s+kind\\s+of\\s+counter\\s+${PLAYER_SUBJECT_PREFIX}have$`, 'i'));
    if (doublePlayerCounters) {
      return withMeta({
        kind: 'double_player_counters',
        who: parsePlayerSelector(doublePlayerCounters[1]),
        raw: rawClause,
        });
    }
  }

  {
    const doubleEachKindCounters = clause.match(/^double the number of each kind of counter on (.+)$/i);
    if (doubleEachKindCounters) {
      return withMeta({
        kind: 'double_counters',
        target: parseObjectSelector(String(doubleEachKindCounters[1] || '').trim()),
        raw: rawClause,
        });
    }
  }

  {
    const doubleSpecificCounters = clause.match(/^double the number of (.+?) counters on (.+)$/i);
    if (doubleSpecificCounters) {
      return withMeta({
        kind: 'double_counters',
        target: parseObjectSelector(String(doubleSpecificCounters[2] || '').trim()),
        counter: normalizeCounterName(String(doubleSpecificCounters[1] || '').trim()),
        raw: rawClause,
        });
    }
  }

  {
    const addVariableAnyColorMana = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+x\\s+mana\\s+of\\s+any\\s+one\\s+color(?:,\\s*where\\s+x\\s+is\\s+.+)?$`, 'i'));
    if (addVariableAnyColorMana) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addVariableAnyColorMana[1]),
        mana: '{X}',
        manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
        requiresChosenMana: true,
        raw: rawClause,
      });
    }

    const addProducedTypeMana = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+one\\s+mana\\s+of\\s+any\\s+type\\s+that\\s+.+?\\s+produced$`, 'i'));
    if (addProducedTypeMana) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addProducedTypeMana[1]),
        mana: '{C}',
        requiresChosenMana: true,
        raw: rawClause,
      });
    }

    const addManaChoice = clause.match(
      new RegExp(
        `^${PLAYER_SUBJECT_PREFIX}adds?\\s+((?:\\{[^}]+\\})+(?:(?:\\s*,\\s*|\\s+or\\s+|\\s*,\\s*or\\s*)(?:\\{[^}]+\\})+)+)\\s*$`,
        'i'
      )
    );
    if (addManaChoice) {
      const manaOptions = parseManaOptionGroupList(String(addManaChoice[2] || '').trim());
      if (manaOptions.length >= 2) {
        return withMeta({
          kind: 'add_mana',
          who: parsePlayerSelector(addManaChoice[1]),
          mana: manaOptions[0],
          manaOptions,
          raw: rawClause,
        });
      }
    }

    const addMana = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+(\\{[^}]+\\}(?:\\s*\\{[^}]+\\})*)\\s*$`, 'i'));
    if (addMana) {
      const mana = String(addMana[2] || '').trim();
      if (mana && !/\bor\b/i.test(clause)) {
        return withMeta({ kind: 'add_mana', who: parsePlayerSelector(addMana[1]), mana, raw: rawClause });
      }
    }
  }

  {
    const retainMana = clause.match(
      /^(?:until\s+end\s+of\s+(turn|combat),\s*)?(?:(you|that player|they)\s+)?(?:don't|do not)\s+lose\s+this\s+mana\s+as\s+steps\s+and\s+phases\s+end$/i
    );
    if (retainMana) {
      const duration = String(retainMana[1] || 'turn').toLowerCase() === 'combat'
        ? 'until_end_of_combat'
        : 'until_end_of_turn';
      return withMeta({
        kind: 'retain_mana',
        who: parsePlayerSelector(retainMana[2]),
        duration,
        raw: rawClause,
      });
    }

    const manaLasts = clause.match(/^this\s+mana\s+lasts\s+until\s+end\s+of\s+(turn|combat)$/i);
    if (manaLasts) {
      const duration = String(manaLasts[1] || 'turn').toLowerCase() === 'combat'
        ? 'until_end_of_combat'
        : 'until_end_of_turn';
      return withMeta({
        kind: 'retain_mana',
        who: { kind: 'you' },
        duration,
        raw: rawClause,
      });
    }
  }

  {
    const exertMatch = clause.match(/^exert(?:\s+(.+?))?(?:\s+as\s+it\s+attacks)?$/i);
    if (exertMatch) {
      return withMeta({
        kind: 'exert',
        target: parseObjectSelector(String(exertMatch[1] || 'this permanent').trim()),
        raw: rawClause,
        });
    }
  }

  {
    const earthbendWhereMatch = clause.match(/^(?:you\s+)?earthbend\s+x,\s+where\s+x\s+is\s+(.+)$/i);
    if (earthbendWhereMatch) {
      return withMeta({
        kind: 'earthbend',
        target: parseObjectSelector('target land you control'),
        amount: { kind: 'x' },
        whereX: { kind: 'where', raw: String(earthbendWhereMatch[1] || '').trim() },
        raw: rawClause,
      });
    }

    const earthbendMatch = clause.match(/^(?:you\s+)?earthbend\s+(a|an|\d+|x|[a-z]+)$/i);
    if (earthbendMatch) {
      return withMeta({
        kind: 'earthbend',
        target: parseObjectSelector('target land you control'),
        amount: parseQuantity(earthbendMatch[1]),
        raw: rawClause,
        });
    }
  }

  {
    const openAttractionMatch = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:open|opens)\\s+an\\s+attraction$`, 'i'));
    if (openAttractionMatch) {
      return withMeta({
        kind: 'open_attraction',
        who: parsePlayerSelector(openAttractionMatch[1]),
        raw: rawClause,
        });
    }
  }

  {
    const rollVisitMatch = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}roll(?:s)?\\s+to\\s+visit\\s+(?:your|their|his or her)\\s+attractions$`, 'i'));
    if (rollVisitMatch) {
      return withMeta({
        kind: 'roll_visit_attractions',
        who: parsePlayerSelector(rollVisitMatch[1]),
        raw: rawClause,
        });
    }
  }

  {
    const initiativeMatch = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}take(?:s)?\\s+the\\s+initiative$`, 'i'));
    if (initiativeMatch) {
      return withMeta({
        kind: 'take_initiative',
        who: parsePlayerSelector(initiativeMatch[1]),
        raw: rawClause,
        });
    }
  }

  {
    const monarchMatch = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}become(?:s)?\\s+the\\s+monarch$`, 'i'));
    if (monarchMatch) {
      return withMeta({
        kind: 'become_monarch',
        who: parsePlayerSelector(monarchMatch[1]),
        raw: rawClause,
        });
    }
  }

  {
    // Silver-border / playtest: "you become this permanent" (Abian, Luvion Usurper).
    const becomeThisPermanent = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}become(?:s)?\\s+this\\s+(?:permanent|planeswalker|creature)$`, 'i'),
    );
    if (becomeThisPermanent) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector('you'),
        effectText: [String(clause || '').trim()],
        duration: 'static',
        raw: rawClause,
      } as OracleEffectStep);
    }
  }

  {
    const ventureMatch = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}venture(?:s)?\\s+into\\s+(?:the\\s+dungeon|undercity)$`, 'i'));
    if (ventureMatch) {
      return withMeta({
        kind: 'venture_into_dungeon',
        who: parsePlayerSelector(ventureMatch[1]),
        raw: rawClause,
        });
    }
  }

  {
    const planeswalkMatch = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}planeswalk(?:s)?$`, 'i'));
    if (planeswalkMatch) {
      return withMeta({
        kind: 'planeswalk',
        who: parsePlayerSelector(planeswalkMatch[1]),
        raw: rawClause,
        });
    }
  }

  {
    const assembleMatch = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}assemble(?:s)?(?:\\s+a\\s+contraption)?$`, 'i'));
    if (assembleMatch) {
      return withMeta({
        kind: 'assemble',
        who: parsePlayerSelector(assembleMatch[1]),
        raw: rawClause,
        });
    }
  }

  {
    const regenerateMatch = clause.match(/^regenerate\s+(.+)$/i);
    if (regenerateMatch) {
      return withMeta({
        kind: 'regenerate',
        target: parseObjectSelector(regenerateMatch[1]),
        raw: rawClause,
        });
    }
  }

  {
    const abandonSchemeMatch = clause.match(/^abandon\s+(this|that)\s+scheme$/i);
    if (abandonSchemeMatch) {
      return withMeta({
        kind: 'abandon_scheme',
        target: { kind: 'raw', text: `${String(abandonSchemeMatch[1] || '').toLowerCase()} scheme` },
        raw: rawClause,
        });
    }
  }

  {
    const setInMotionMatch = clause.match(/^set\s+(this|that)\s+scheme\s+in\s+motion(?:\s+again)?$/i);
    if (setInMotionMatch) {
      return withMeta({
        kind: 'set_in_motion',
        target: { kind: 'raw', text: `${String(setInMotionMatch[1] || '').toLowerCase()} scheme` },
        raw: rawClause,
        });
    }
  }

  {
    const learnMatch = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:learn|learns)\\b$`, 'i'));
    if (learnMatch) {
      return withMeta({
        kind: 'learn',
        who: parsePlayerSelector(learnMatch[1]),
        raw: rawClause,
        });
    }
  }

  {
    const clash = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:clash|clashes)\\s+with\\s+an\\s+opponent\\b`, 'i'));
    if (clash) {
      return withMeta({
        kind: 'clash',
        who: parsePlayerSelector(clash[1]),
        opponent: { kind: 'target_opponent' },
        raw: rawClause,
        });
    }

    if (/^clash\s+with\s+defending\s+player\b/i.test(clause)) {
      return withMeta({
        kind: 'clash',
        who: parsePlayerSelector('you'),
        opponent: { kind: 'target_opponent' },
        raw: rawClause,
        });
    }
  }

  {
    const stripAbilityWord = (text: string): string =>
      String(text || '')
        .replace(/^(?:will\s+of\s+the\s+(?:council|planeswalkers)|secret\s+council|council'?s\s+dilemma)\s*[-—–]\s+/i, '')
        .trim();

    const parseVoteBallotTarget = (
      targetText: string
    ): {
      choices: string[];
      ballot: 'labels' | 'players' | 'permanents';
      ballotFilter?: string;
    } | null => {
      const target = String(targetText || '')
        .replace(/,?\s*then those votes are revealed\.?$/i, '')
        .trim();
      if (!target) return null;

      if (
        /\b(?:another\s+player|a\s+player|target\s+player|each\s+other\s+player)\b/i.test(target) &&
        !/\bor\b/i.test(target)
      ) {
        return { choices: [], ballot: 'players', ballotFilter: target };
      }
      if (
        /\b(?:creature|permanent|nonland\s+permanent)\b/i.test(target) &&
        !/\bor\b/i.test(target)
      ) {
        return { choices: [], ballot: 'permanents', ballotFilter: target };
      }

      const choices = target
        .split(/\s*,\s*|\s+or\s+/i)
        .map((choice) => choice.trim().replace(/^(?:an?|the)\s+/i, '').trim())
        .filter(Boolean);
      if (choices.length >= 2) {
        return { choices, ballot: 'labels' };
      }
      return null;
    };

    const willVote = clause.match(/^will\s+of\s+the\s+planeswalkers\s+-\s+starting\s+with\s+(.+?),\s*(each player)\s+votes?\s+for\s+(.+)$/i);
    if (willVote) {
      const ballot = parseVoteBallotTarget(String(willVote[3] || ''));
      if (ballot) {
        return withMeta({
          kind: 'vote',
          voters: parsePlayerSelector(willVote[2]),
          startingWith: parsePlayerSelector(willVote[1]),
          choices: ballot.choices,
          ballot: ballot.ballot,
          ...(ballot.ballotFilter ? { ballotFilter: ballot.ballotFilter } : {}),
          raw: rawClause,
        });
      }
    }

    const councilVote = stripAbilityWord(clause).match(
      /^(?:starting with\s+(.+?),\s*)?(each player)\s+(secretly\s+)?votes?\s+for\s+(.+)$/i
    );
    if (councilVote) {
      const ballot = parseVoteBallotTarget(String(councilVote[4] || ''));
      if (ballot) {
        return withMeta({
          kind: 'vote',
          voters: parsePlayerSelector(councilVote[2]),
          ...(councilVote[1] ? { startingWith: parsePlayerSelector(councilVote[1]) } : {}),
          choices: ballot.choices,
          ballot: ballot.ballot,
          ...(ballot.ballotFilter ? { ballotFilter: ballot.ballotFilter } : {}),
          ...(councilVote[3] || /^secret\s+council\b/i.test(clause) ? { secret: true } : {}),
          raw: rawClause,
        });
      }
    }

    const vote = clause.match(
      /^starting with\s+(.+?),\s*(each player)\s+votes?\s+for\s+(.+)$/i
    );
    if (vote) {
      const ballot = parseVoteBallotTarget(String(vote[3] || ''));
      if (ballot) {
        return withMeta({
          kind: 'vote',
          voters: parsePlayerSelector(vote[2]),
          startingWith: parsePlayerSelector(vote[1]),
          choices: ballot.choices,
          ballot: ballot.ballot,
          ...(ballot.ballotFilter ? { ballotFilter: ballot.ballotFilter } : {}),
          raw: rawClause,
        });
      }
    }
  }
  return null;
}
