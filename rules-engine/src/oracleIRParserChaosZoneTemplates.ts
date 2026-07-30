/**
 * Generic chaos-zone templates: Warp World / Glimpse of Tomorrow / Morphic Tide
 * owned-permanent shuffle+reveal waves, and Thieves' Auction style repeated drafts.
 * No card-name routing — matches oracle phrasing only.
 */
import type { OracleEffectStep, OracleIRAbility, OracleObjectSelector, OraclePlayerSelector } from './oracleIR';
import { normalizeOracleText } from './oracleIRParserUtils';

function parseObjectSelector(text: string): OracleObjectSelector {
  return { kind: 'raw', text: String(text || '').trim() };
}

function stripReminderAndPhenomena(text: string): string {
  return normalizeOracleText(String(text || ''))
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const WARP_STYLE_PATTERN =
  /^(?:when you encounter [^,]+,\s*)?(?:each player shuffles all permanents they own into their library|shuffle all permanents you own into your library),\s*then reveals? that many cards from the top of (?:their|your) library\.\s*(?:each player puts|put) all (.+?) cards revealed this way onto the battlefield,\s*then (?:does|do) the same for (.+?) cards?,\s*then puts? (?:all cards revealed this way that weren'?t put onto the battlefield|the rest) on the bottom of (?:their|your) library(?: in (?:a random|any) order)?\.?$/i;

function buildTypedRevealedMove(
  typeText: string,
  options: {
    sequence?: 'then';
    thisWayAntecedentStepIndex: number;
    raw: string;
    battlefieldController?: OraclePlayerSelector;
  },
): OracleEffectStep {
  return {
    kind: 'move_zone',
    what: parseObjectSelector(`all ${String(typeText || '').trim()} cards revealed this way`),
    to: 'battlefield',
    toRaw: 'the battlefield',
    ...(options.battlefieldController ? { battlefieldController: options.battlefieldController } : {}),
    thisWayAntecedentStepIndex: options.thisWayAntecedentStepIndex,
    thisWayAntecedentStepKind: 'reveal_top',
    ...(options.sequence ? { sequence: options.sequence } : {}),
    raw: options.raw,
  } as OracleEffectStep;
}

/**
 * Parse Warp World / Glimpse / Morphic Tide style shuffle→reveal→typed waves→remainder.
 */
export function tryParseOwnedPermanentsShuffleRevealTemplate(rawText: string): OracleEffectStep[] | null {
  const normalized = stripReminderAndPhenomena(rawText).replace(/\s+/g, ' ').trim();
  if (!normalized) return null;

  const match = normalized.match(WARP_STYLE_PATTERN);
  if (!match) return null;

  const eachPlayer = /^each player shuffles all permanents they own/i.test(normalized);
  const who: OraclePlayerSelector = eachPlayer ? { kind: 'each_player' } : { kind: 'you' };
  const ownedWhat = eachPlayer ? 'all permanents they own' : 'all permanents you own';
  const libraryOwnerRaw = eachPlayer ? 'their library' : 'your library';
  const firstTypes = String(match[1] || '').trim();
  const secondTypes = String(match[2] || '').trim();
  const randomRemainder = /\bin a random order\b/i.test(normalized);
  const battlefieldController: OraclePlayerSelector | undefined = eachPlayer
    ? { kind: 'owner_of_moved_cards' }
    : undefined;

  const steps: OracleEffectStep[] = [
    {
      kind: 'move_zone',
      what: parseObjectSelector(ownedWhat),
      to: 'library',
      toRaw: libraryOwnerRaw,
      ...(eachPlayer ? { who } : {}),
      raw: eachPlayer
        ? 'Each player shuffles all permanents they own into their library'
        : 'Shuffle all permanents you own into your library',
    } as OracleEffectStep,
    {
      kind: 'reveal_top',
      who,
      amount: { kind: 'reference_amount', raw: 'that many' },
      sequence: 'then',
      raw: eachPlayer
        ? 'then reveals that many cards from the top of their library'
        : 'then reveal that many cards from the top of your library',
    } as OracleEffectStep,
    buildTypedRevealedMove(firstTypes, {
      thisWayAntecedentStepIndex: 1,
      raw: eachPlayer
        ? `Each player puts all ${firstTypes} cards revealed this way onto the battlefield`
        : `Put all ${firstTypes} cards revealed this way onto the battlefield`,
      battlefieldController,
    }),
    buildTypedRevealedMove(secondTypes, {
      sequence: 'then',
      thisWayAntecedentStepIndex: 1,
      raw: eachPlayer
        ? `then does the same for ${secondTypes} cards`
        : `then do the same for ${secondTypes} cards`,
      battlefieldController,
    }),
    {
      kind: 'move_zone',
      what: parseObjectSelector(
        randomRemainder
          ? 'the rest'
          : "all cards revealed this way that weren't put onto the battlefield",
      ),
      to: 'library',
      toRaw: libraryOwnerRaw,
      libraryPlacement: 'bottom',
      ...(randomRemainder ? { order: 'random' } : { order: 'any' }),
      sequence: 'then',
      thisWayAntecedentStepIndex: 1,
      thisWayAntecedentStepKind: 'reveal_top',
      raw: eachPlayer
        ? "then puts all cards revealed this way that weren't put onto the battlefield on the bottom of their library"
        : randomRemainder
          ? 'then put the rest on the bottom of your library in a random order'
          : "then puts all cards revealed this way that weren't put onto the battlefield on the bottom of their library",
    } as OracleEffectStep,
  ];

  return steps;
}

const AUCTION_PATTERN =
  /^exile all nontoken permanents\.\s*starting with you,\s*each player chooses one of the exiled cards and puts it onto the battlefield tapped under their control\.\s*repeat this process until all cards exiled this way have been chosen\.?$/i;

/**
 * Parse Thieves' Auction style: mass nontoken exile + repeated rotating zone draft.
 */
export function tryParseRepeatedZoneDraftAuctionTemplate(rawText: string): OracleEffectStep[] | null {
  const normalized = stripReminderAndPhenomena(rawText).replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  if (!AUCTION_PATTERN.test(normalized)) return null;

  return [
    {
      kind: 'exile',
      target: parseObjectSelector('all nontoken permanents'),
      raw: 'Exile all nontoken permanents',
    } as OracleEffectStep,
    {
      kind: 'repeated_zone_draft',
      pool: parseObjectSelector('cards exiled this way'),
      whoStarts: { kind: 'you' },
      chooserOrder: 'turn_order',
      destination: 'battlefield',
      entersTapped: true,
      battlefieldController: { kind: 'chooser' },
      thisWayAntecedentStepIndex: 0,
      thisWayAntecedentStepKind: 'exile',
      sequence: 'then',
      raw:
        'Starting with you, each player chooses one of the exiled cards and puts it onto the battlefield tapped under their control. Repeat this process until all cards exiled this way have been chosen.',
    } as OracleEffectStep,
  ];
}

function abilityEffectText(ability: OracleIRAbility): string {
  return String(
    (ability as any).effectText
      || (ability as any).text
      || (ability.steps || []).map((step: any) => step.raw || '').join(' ')
      || '',
  ).trim();
}

/**
 * Replace misparsed residual static grants / split abilities with executable chaos templates.
 */
export function expandChaosZoneTemplateAbilities(
  abilities: readonly OracleIRAbility[],
): OracleIRAbility[] {
  if (!Array.isArray(abilities) || abilities.length === 0) return abilities as OracleIRAbility[];

  // Merge consecutive spell/static fragments that together form auction text.
  const mergedTexts: { start: number; end: number; text: string; ability: OracleIRAbility }[] = [];
  for (let i = 0; i < abilities.length; i++) {
    const ability = abilities[i];
    const text = abilityEffectText(ability);
    mergedTexts.push({ start: i, end: i, text, ability });
  }

  // Whole-ability warp/glimpse replacement.
  let changed = false;
  const next: OracleIRAbility[] = abilities.map((ability) => {
    const text = abilityEffectText(ability);
    const warpSteps = tryParseOwnedPermanentsShuffleRevealTemplate(text);
    if (warpSteps) {
      changed = true;
      return {
        ...ability,
        type: 'spell',
        steps: warpSteps,
        effectText: text,
      } as OracleIRAbility;
    }

    const auctionSteps = tryParseRepeatedZoneDraftAuctionTemplate(text);
    if (auctionSteps) {
      changed = true;
      return {
        ...ability,
        type: 'spell',
        steps: auctionSteps,
        effectText: text,
      } as OracleIRAbility;
    }

    return ability;
  });

  // Multi-ability auction: first ability is exile, following are residual drafts.
  if (abilities.length >= 2) {
    const combined = abilities.map(abilityEffectText).filter(Boolean).join(' ');
    const auctionSteps = tryParseRepeatedZoneDraftAuctionTemplate(combined);
    if (auctionSteps) {
      return [
        {
          ...abilities[0],
          type: 'spell',
          text: combined,
          effectText: combined,
          steps: auctionSteps,
        } as OracleIRAbility,
      ];
    }
  }

  return changed ? next : (abilities as OracleIRAbility[]);
}
