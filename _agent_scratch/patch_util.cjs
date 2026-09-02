const fs = require('fs');

function readText(p) {
  const buf = fs.readFileSync(p);
  const bom = buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
  const raw = buf.slice(bom ? 3 : 0).toString('utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const text = raw.replace(/\r\n/g, '\n');
  return { text, eol };
}

function writeText(p, text, eol) {
  const normalized = String(text).replace(/\r\n/g, '\n').replace(/\n/g, eol);
  fs.writeFileSync(p, Buffer.from(normalized, 'utf8'));
}

function mustReplaceOnce(text, from, to, label) {
  const n = text.split(from).length - 1;
  if (n !== 1) {
    throw new Error('Expected 1 occurrence of snippet in ' + label + ', found ' + n + ':\n' + from.slice(0, 220));
  }
  return text.replace(from, to);
}

function mustReplace(text, from, to, label) {
  if (!text.includes(from)) {
    throw new Error('Missing snippet in ' + label + ':\n' + from.slice(0, 220));
  }
  return text.split(from).join(to);
}

const ROOT = 'D:\\Git\\MTGEDH';
module.exports = { readText, writeText, mustReplace, mustReplaceOnce, ROOT };
