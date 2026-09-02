const fs = require('fs');
const path = require('path');

function detectEol(buf) {
  return buf.includes(0x0d) ? '\r\n' : '\n';
}

function toEol(text, eol) {
  return String(text).replace(/\r\n/g, '\n').replace(/\n/g, eol);
}

function writeUtf8(filePath, content, eol) {
  const abs = path.resolve(filePath);
  let useEol = eol;
  if (!useEol) {
    try {
      const existing = fs.readFileSync(abs);
      useEol = detectEol(existing);
    } catch {
      useEol = '\r\n';
    }
  }
  const text = toEol(content, useEol);
  fs.writeFileSync(abs, text, { encoding: 'utf8' });
  const verify = fs.readFileSync(abs);
  if (verify[0] === 0xEF && verify[1] === 0xBB && verify[2] === 0xBF) {
    throw new Error('BOM written: ' + abs);
  }
  return { bytes: verify.length, eol: useEol === '\r\n' ? 'CRLF' : 'LF' };
}

function patchUtf8(filePath, replacements) {
  const abs = path.resolve(filePath);
  const buf = fs.readFileSync(abs);
  const eol = detectEol(buf);
  let s = buf.toString('utf8').replace(/\r\n/g, '\n');
  for (const item of replacements) {
    const from = item[0];
    const to = item[1];
    const mode = item[2];
    const fromN = String(from).replace(/\r\n/g, '\n');
    const toN = String(to).replace(/\r\n/g, '\n');
    if (mode === 'all') {
      if (!s.includes(fromN)) throw new Error('not found in ' + abs + ': ' + fromN.slice(0, 120));
      s = s.split(fromN).join(toN);
    } else {
      const idx = s.indexOf(fromN);
      if (idx < 0) throw new Error('not found in ' + abs + ': ' + fromN.slice(0, 120));
      s = s.slice(0, idx) + toN + s.slice(idx + fromN.length);
    }
  }
  fs.writeFileSync(abs, toEol(s, eol), { encoding: 'utf8' });
  return { bytes: fs.statSync(abs).size, eol: eol === '\r\n' ? 'CRLF' : 'LF' };
}

module.exports = { writeUtf8, patchUtf8, detectEol, toEol };
