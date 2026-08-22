/**
 * Sanity asserts for stripCreateTokenGrantedAbilities / detectKeywords wiring.
 * Run: node --import tsx/esm tools/assert-strip-create-token-abilities.ts
 */
import { stripCreateTokenGrantedAbilities } from '../rules-engine/src/oracleReminderText.ts';
import { detectKeywords } from '../server/src/state/modules/keyword-detection.ts';
import { permanentHasIndestructible } from '../server/src/rules-engine/index.ts';

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  } else {
    console.log('PASS:', msg);
  }
}

function kwNames(oracle: string, name = 'Test'): string[] {
  return detectKeywords(oracle, name).keywords.map((k) => k.keyword).sort();
}

function nativeIndestructible(oracle: string): boolean {
  const state = { battlefield: [] } as any;
  const perm = {
    id: 'p1',
    controller: 'player1',
    card: {
      name: 'Test',
      oracle_text: oracle,
      keywords: [],
      type_line: 'Legendary Creature — Human Warrior',
    },
    grantedAbilities: [],
    counters: {},
  } as any;
  return permanentHasIndestructible(state, perm);
}

const TCHALLA =
  "Whenever T'Challa enters or attacks, create a tapped Vibranium token. (It's an artifact with indestructible and \"{T}: Add {C}. This mana can't be spent to cast a nonartifact spell.\")\n" +
  "Whenever you cast an artifact spell with mana value 4 or greater, put two +1/+1 counters on T'Challa.";

const CREATE_FLY_LIFE = 'Create a 1/1 white Soldier creature token with flying and lifelink.';
const CREATE_DECAYED = 'Create two 2/2 black Zombie creature tokens with decayed.';
const CREATE_FOOD = 'Create a Food token.';
const FLYING_PLUS_CREATE =
  'Flying\nCreate a 1/1 Soldier token with lifelink.';
const INDESTRUCTIBLE_ONLY = 'Indestructible';
const BAST_STYLE =
  'Indestructible\nWhenever Bast attacks, create a Food token.';
const HAS_INDESTRUCTIBLE = "CARDNAME has indestructible.";
const IS_INDESTRUCTIBLE = '~ is indestructible.';
const CONTROL_WITH_FLYING = 'Creatures you control with flying get +1/+1.';
const CREATE_THEN_IT_HAS = 'Create a 1/1 white Soldier creature token. It has flying and lifelink.';
const CREATE_THEN_THEY_ARE = 'Create two 2/2 black Zombie creature tokens. They are indestructible.';
const CREATE_THEN_THAT_TOKEN = 'Create a Germ creature token. That token has lifelink.';
const WHENEVER_CREATE_IT_HAS = 'Whenever you create a creature token, it has haste until end of turn.';


console.log('--- strip samples ---');
for (const [label, sample] of [
  ['tchalla', TCHALLA],
  ['fly+life', CREATE_FLY_LIFE],
  ['decayed', CREATE_DECAYED],
  ['food', CREATE_FOOD],
  ['flying+create', FLYING_PLUS_CREATE],
  ['control with flying', CONTROL_WITH_FLYING],
  ['create then it has', CREATE_THEN_IT_HAS],
  ['create then they are', CREATE_THEN_THEY_ARE],
  ['create then that token', CREATE_THEN_THAT_TOKEN],
  ['whenever create it has', WHENEVER_CREATE_IT_HAS],
] as const) {
  console.log(label, '=>', JSON.stringify(stripCreateTokenGrantedAbilities(sample)));
}

assert(!kwNames(TCHALLA, "T'Challa").includes('indestructible'), "T'Challa detectKeywords has no indestructible");
assert(!nativeIndestructible(TCHALLA), "T'Challa oracleTextGrantsNativeIndestructible/permanentHasIndestructible false");

const createOnly = kwNames(CREATE_FLY_LIFE);
assert(!createOnly.includes('flying'), 'create-only line has no flying');
assert(!createOnly.includes('lifelink'), 'create-only line has no lifelink');

const decayed = kwNames(CREATE_DECAYED);
assert(!decayed.includes('decayed'), 'create decayed tokens does not grant decayed to creator');

assert(!kwNames(CREATE_FOOD).includes('indestructible'), 'Food token create stays clean');

const flyCreate = kwNames(FLYING_PLUS_CREATE);
assert(flyCreate.includes('flying'), 'Flying keyword line still detected');
assert(!flyCreate.includes('lifelink'), 'lifelink from create tail not detected');

assert(kwNames(INDESTRUCTIBLE_ONLY).includes('indestructible'), 'Indestructible alone still detected');
assert(nativeIndestructible(INDESTRUCTIBLE_ONLY), 'Indestructible alone grants native');

assert(kwNames(BAST_STYLE).includes('indestructible'), 'Bast-style keyword line Indestructible kept');
assert(nativeIndestructible(BAST_STYLE), 'Bast-style grants native indestructible');

assert(nativeIndestructible(HAS_INDESTRUCTIBLE), 'CARDNAME has indestructible grants native');
assert(nativeIndestructible(IS_INDESTRUCTIBLE), '~ is indestructible grants native');

const strippedControl = stripCreateTokenGrantedAbilities(CONTROL_WITH_FLYING);
assert(
  /with flying/i.test(strippedControl),
  'unrelated "creatures you control with flying" not stripped',
);

const strippedCopy = stripCreateTokenGrantedAbilities(
  "Create a token that's a copy of target creature.",
);
assert(/copy of target creature/i.test(strippedCopy), "create token that's a copy stem preserved");


const itHas = kwNames(CREATE_THEN_IT_HAS);
assert(!itHas.includes('flying'), 'Create... It has flying does not bleed flying');
assert(!itHas.includes('lifelink'), 'Create... It has lifelink does not bleed lifelink');
assert(
  !stripCreateTokenGrantedAbilities(CREATE_THEN_IT_HAS).toLowerCase().includes('flying'),
  'strip removes follow-up It has flying',
);

const theyAre = kwNames(CREATE_THEN_THEY_ARE);
assert(!theyAre.includes('indestructible'), 'Create... They are indestructible does not bleed');
assert(!nativeIndestructible(CREATE_THEN_THEY_ARE), 'follow-up They are indestructible is not native');

const thatTok = kwNames(CREATE_THEN_THAT_TOKEN);
assert(!thatTok.includes('lifelink'), 'Create... That token has lifelink does not bleed');

// Same-sentence temporary grant should remain (not a defining follow-up after period).
assert(
  stripCreateTokenGrantedAbilities(WHENEVER_CREATE_IT_HAS).toLowerCase().includes('haste'),
  'Whenever you create a token, it has haste is preserved',
);

if (process.exitCode) {
  console.error('\nSome asserts failed.');
} else {
  console.log('\nAll asserts passed.');
}
