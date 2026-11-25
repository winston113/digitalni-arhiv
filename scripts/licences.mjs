// Ustvari THIRD-PARTY-LICENSES.md iz nameščenih odvisnosti, ki so del vsebnika.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = JSON.parse(readFileSync('package.json', 'utf8'));
// Odvisnosti vmesnika, ki jih Vite vključi v objavljeno kodo.
const bundled = ['react', 'react-dom', 'react-router', 'lucide-react', 'pdfjs-dist', 'docx-preview', '@fontsource/ibm-plex-sans'];
const seen = new Map();

function visit(name) {
  if (seen.has(name)) return;
  const dir = join('node_modules', name);
  if (!existsSync(join(dir, 'package.json'))) return;
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const file = readdirSync(dir).find((f) => /^(licen[sc]e|copying)/i.test(f));
  seen.set(name, { version: pkg.version, licence: pkg.license ?? 'ni navedena', text: file ? readFileSync(join(dir, file), 'utf8').trim() : null });
  for (const dep of Object.keys(pkg.dependencies ?? {})) visit(dep);
}
[...Object.keys(root.dependencies), ...bundled].forEach(visit);

const items = [...seen].sort(([a], [b]) => a.localeCompare(b));
const out = ['# Third-party licences', '', 'Generated with `npm run licences`. These packages are part of the published container image.', ''];
for (const [name, { version, licence, text }] of items) {
  out.push(`## ${name} ${version}`, '', `Licence: ${licence}`, '');
  if (text) out.push('```', text.replace(/```/g, "'''"), '```', '');
}
writeFileSync('THIRD-PARTY-LICENSES.md', out.join('\n'));
console.log(items.map(([n, i]) => i.licence).reduce((m, l) => ({ ...m, [l]: (m[l] ?? 0) + 1 }), {}));
