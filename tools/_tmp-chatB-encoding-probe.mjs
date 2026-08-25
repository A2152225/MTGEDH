// Temporary probe for the postprocess/parser split campaign.
import fs from 'node:fs';

const file = process.argv[2];
const buf = fs.readFileSync(file);
const text = buf.toString('utf8');
const roundTrip = Buffer.from(text, 'utf8');

console.log('bytes           :', buf.length);
console.log('utf8 round trip :', roundTrip.equals(buf) ? 'IDENTICAL (valid utf8)' : 'DIFFERS (not valid utf8)');
console.log('has BOM         :', buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf);

let crlf = 0;
let lfOnly = 0;
for (let i = 0; i < buf.length; i += 1) {
  if (buf[i] === 0x0a) {
    if (i > 0 && buf[i - 1] === 0x0d) crlf += 1;
    else lfOnly += 1;
  }
}
console.log('CRLF lines      :', crlf);
console.log('bare LF lines   :', lfOnly);

const fffd = (text.match(/\uFFFD/g) || []).length;
console.log('U+FFFD chars    :', fffd);
