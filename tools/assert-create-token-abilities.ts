/**
 * Asserts for extractCreateTokenGrantedAbilities + createToken ability wiring.
 * Run: npx tsx tools/assert-create-token-abilities.ts
 */
import {
  extractCreateTokenGrantedAbilities,
  stripCreateTokenGrantedAbilities,
  deriveCreateTokenSourceFragment,
} from '../rules-engine/src/oracleReminderText.ts';
import { createTokenCard, getCommonToken } from '../server/src/services/tokens.ts';
import { parseTokenCreationFromText, createTokenPermanent } from '../rules-engine/src/tokenCreation.ts';
import { parseSpellLegacyTokenCreation } from '../server/src/state/modules/oracleIrSpellLegacyTokenUtils.ts';

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  } else {
    console.log('PASS:', msg);
  }
}

function lowerSet(values: readonly string[]): Set<string> {
  return new Set(values.map((v) => String(v || '').toLowerCase()));
}

const withFlyLife = extractCreateTokenGrantedAbilities(
  'Create a 1/1 white Soldier creature token with flying and lifelink.',
);
assert(lowerSet(withFlyLife).has('flying'), 'extractor: with flying and lifelink includes flying');
assert(lowerSet(withFlyLife).has('lifelink'), 'extractor: with flying and lifelink includes lifelink');

const followUp = extractCreateTokenGrantedAbilities('It has flying.');
assert(lowerSet(followUp).has('flying'), 'extractor: follow-up It has flying → flying');

const theyAre = extractCreateTokenGrantedAbilities(
  'Create two 2/2 black Zombie creature tokens. They are indestructible.',
);
assert(lowerSet(theyAre).has('indestructible'), 'extractor: They are indestructible');

const thatToken = extractCreateTokenGrantedAbilities(
  'Create a Germ creature token. That token has lifelink.',
);
assert(lowerSet(thatToken).has('lifelink'), 'extractor: That token has lifelink');

const itsIndestructible = extractCreateTokenGrantedAbilities("It's indestructible.");
assert(lowerSet(itsIndestructible).has('indestructible'), "extractor: It's indestructible");

const vibranium = extractCreateTokenGrantedAbilities(
  'create a tapped Vibranium token. (It\'s an artifact with indestructible and "{T}: Add {C}. This mana can\'t be spent to cast a nonartifact spell.")',
);
assert(lowerSet(vibranium).has('indestructible'), 'extractor: Vibranium-style reminder → indestructible');
assert(
  vibranium.some((a) => /\{T\}:\s*Add \{C\}/i.test(a)),
  'extractor: Vibranium-style reminder includes mana ability text',
);

const controlWithFlying = extractCreateTokenGrantedAbilities(
  'Creatures you control with flying get +1/+1.',
);
assert(controlWithFlying.length === 0, 'extractor: creatures you control with flying alone → empty');

const copyCreate = extractCreateTokenGrantedAbilities(
  "Create a token that's a copy of target creature with flying.",
);
assert(copyCreate.length === 0, 'extractor: copy-token create does not invent keywords from with');

// Strip path still removes grants from creator text (no regression).
assert(
  !/flying/i.test(stripCreateTokenGrantedAbilities('Create a 1/1 Soldier token with flying and lifelink.')),
  'strip still removes same-sentence with flying',
);

// parseTokenCreationFromText uses extractor
const parsed = parseTokenCreationFromText(
  'Create a 1/1 white Soldier creature token with flying and lifelink.',
);
assert(!!parsed, 'parseTokenCreationFromText returns characteristics');
assert(
  lowerSet(parsed!.characteristics.abilities).has('flying')
    && lowerSet(parsed!.characteristics.abilities).has('lifelink'),
  'parseTokenCreationFromText abilities include flying+lifelink',
);

const tokenPerm = createTokenPermanent(parsed!.characteristics, 'player1' as any);
assert(
  lowerSet((tokenPerm.card as any).keywords || []).has('flying'),
  'createTokenPermanent keywords include flying',
);

// createTokenCard choke point with sourceText + catalog merge (Vibranium)
const vibCard = createTokenCard({
  id: 'tok-vib',
  name: 'Vibranium',
  type_line: 'Token Artifact — Vibranium',
  power: 0,
  toughness: 0,
  sourceText:
    'create a tapped Vibranium token. (It\'s an artifact with indestructible and "{T}: Add {C}. This mana can\'t be spent to cast a nonartifact spell.")',
});
const vibKw = lowerSet(vibCard.keywords || []);
assert(vibKw.has('indestructible'), 'createTokenCard Vibranium keywords include indestructible');
assert(
  String(vibCard.oracle_text || '').toLowerCase().includes('add {c}')
    || (vibCard.keywords || []).some((k: string) => /add \{c\}/i.test(k)),
  'createTokenCard Vibranium retains mana ability (catalog/extractor)',
);

const catalog = getCommonToken('vibranium');
assert(
  (catalog?.abilities || []).some((a) => /indestructible/i.test(a)),
  'catalog Vibranium still has Indestructible',
);

// Soldier with sourceText via createTokenCard
const soldier = createTokenCard({
  id: 'tok-soldier',
  name: 'Soldier',
  type_line: 'Token Creature — Soldier',
  power: 1,
  toughness: 1,
  colors: ['W'],
  sourceText: 'Create a 1/1 white Soldier creature token with flying and lifelink.',
});
assert(
  lowerSet(soldier.keywords || []).has('flying') && lowerSet(soldier.keywords || []).has('lifelink'),
  'createTokenCard Soldier sourceText grants flying+lifelink',
);
assert(
  /flying/i.test(String(soldier.oracle_text || '')) && /lifelink/i.test(String(soldier.oracle_text || '')),
  'createTokenCard Soldier oracle_text includes granted abilities',
);

// sourceOracleText fallback via createTokenCard (resolveCreateTokenAbilities choke-point parity)
const soldierFromOracle = createTokenCard({
  id: 'tok-soldier-oracle',
  name: 'Soldier',
  type_line: 'Token Creature — Soldier',
  power: 1,
  toughness: 1,
  colors: ['W'],
  sourceOracleText: 'Create a 1/1 white Soldier creature token with flying.',
});
assert(
  lowerSet(soldierFromOracle.keywords || []).has('flying'),
  'createTokenCard Soldier sourceOracleText grants flying',
);

const multiCreateOracle =
  'Create a 1/1 Soldier token with flying. Create a 2/2 Zombie token with menace.';
const soldierMulti = createTokenCard({
  id: 'tok-soldier-multi',
  name: 'Soldier',
  type_line: 'Token Creature — Soldier',
  power: 1,
  toughness: 1,
  colors: ['W'],
  sourceOracleText: multiCreateOracle,
});
assert(
  lowerSet(soldierMulti.keywords || []).has('flying'),
  'multi-create sourceOracleText Soldier gets flying',
);
assert(
  !lowerSet(soldierMulti.keywords || []).has('menace'),
  'multi-create sourceOracleText Soldier does not get Zombie menace',
);

const zombieMulti = createTokenCard({
  id: 'tok-zombie-multi',
  name: 'Zombie',
  type_line: 'Token Creature — Zombie',
  power: 2,
  toughness: 2,
  colors: ['B'],
  sourceOracleText: multiCreateOracle,
});
assert(
  lowerSet(zombieMulti.keywords || []).has('menace'),
  'multi-create sourceOracleText Zombie gets menace',
);
assert(
  !lowerSet(zombieMulti.keywords || []).has('flying'),
  'multi-create sourceOracleText Zombie does not get Soldier flying',
);

// Direct fragment helper (same matching used by resolveCreateTokenAbilities / createTokenCard)
const derivedSoldier = deriveCreateTokenSourceFragment(
  'Soldier',
  'Create a 1/1 Soldier token with flying. Create a 2/2 Zombie token with menace.',
);
assert(/flying/i.test(derivedSoldier) && !/menace/i.test(derivedSoldier), 'deriveCreateTokenSourceFragment Soldier fragment is flying-only');

// Legacy parse captures with-lifelink span + follow-up It has
const legacyRaw = 'Create a 1/1 white Soldier creature token with lifelink. It has flying.';
const legacySpec = parseSpellLegacyTokenCreation(
  'Test Spell',
  legacyRaw.toLowerCase(),
  'player1' as any,
  {},
  undefined,
  legacyRaw,
);
assert(!!legacySpec, 'parseSpellLegacyTokenCreation returns spec for with-lifelink create');
assert(
  !!legacySpec?.sourceText && /lifelink/i.test(legacySpec.sourceText),
  'legacy parse sourceText includes lifelink',
);
assert(
  !!legacySpec?.sourceText && /flying/i.test(legacySpec.sourceText),
  'legacy parse sourceText includes follow-up It has flying',
);
assert(
  lowerSet(legacySpec?.abilities || []).has('lifelink')
    && lowerSet(legacySpec?.abilities || []).has('flying'),
  'legacy parse abilities include lifelink+flying',
);

if (process.exitCode) {
  console.error('\nSome asserts failed.');
} else {
  console.log('\nAll asserts passed.');
}
