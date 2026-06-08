import { normalizeOracleText } from '../../rules-engine/src/oracleIRParserUtils.ts';

const raw = 'You may reveal a Hero card from among them and put that card into your hand. Put the rest on the bottom of your library in a random order';
const normalized = normalizeOracleText(raw).replace(/[.]+$/g, '').trim();
console.log('normalized:', normalized);
const re = /^you may reveal (.+?) card from among them and put (?:it|that card) into your hand\.\s*put the rest on the bottom of your library in (?:a random|any) order$/i;
console.log('match:', normalized.match(re));
