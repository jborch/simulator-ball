// Usage: node tools/scripts/dm-png.mjs "<GS1 text with (AI) parentheses>" <out.png>
// Renders a GS1 DataMatrix as a laser-mark style PNG (dark modules on body white) for Blender previews.
import bwipjs from 'bwip-js/node';
import { writeFileSync } from 'node:fs';

const [text, out] = process.argv.slice(2);
const print = {
  bcid: 'gs1datamatrix',
  text,
  scale: 16,
  padding: 1,
  barcolor: '13191b',
  backgroundcolor: 'f2f2eb',
};
let png;
try {
  png = await bwipjs.toBuffer({ ...print, format: 'rectangle', rotate: 'R' });
} catch {
  png = await bwipjs.toBuffer(print);
}
writeFileSync(out, png);
console.log('wrote', out);
