// Import audit: resolves every named import used by index.js and src/store.js
// against the SillyTavern reference clone (.st-src next to this workspace's
// extension folders). A mismatch here = silent module kill in the browser
// (named-import mismatches have caused real bugs before).
// Run: `npm run audit`.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const stPublic = resolve(here, '../../.st-src/public'); // tests → extension root → workspace root

const extDir = resolve(stPublic, 'scripts/extensions/third-party/ModelQuickSwitch');
const sources = [
    { label: 'index.js', path: resolve(here, '../index.js') },
    { label: 'src/store.js', path: resolve(here, '../src/store.js') },
];

const importRegex = /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;

function getExports(source) {
    const names = new Set();
    const patterns = [
        /export\s+async\s+function\s+(\w+)/g,
        /export\s+function\s+(\w+)/g,
        /export\s+const\s+(\w+)/g,
        /export\s+let\s+(\w+)/g,
        /export\s+var\s+(\w+)/g,
        /export\s+class\s+(\w+)/g,
    ];
    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(source)) !== null) {
            names.add(match[1]);
        }
    }
    const brace = /export\s*\{([^}]+)\}/g;
    let braceMatch;
    while ((braceMatch = brace.exec(source)) !== null) {
        for (const part of braceMatch[1].split(',')) {
            const name = part.trim().split(/\s+as\s+/)[0].trim();
            if (name) {
                names.add(name);
            }
        }
    }
    return names;
}

let failures = 0;
let totalImports = 0;

for (const source of sources) {
    const code = readFileSync(source.path, 'utf8');
    const imports = [];
    let match;
    while ((match = importRegex.exec(code)) !== null) {
        const names = match[1].split(',').map(s => s.trim()).filter(Boolean);
        imports.push({ names, path: resolve(extDir, match[2]), raw: match[2] });
    }
    console.log(`Auditing ${source.label}: ${imports.length} import statements`);
    for (const imp of imports) {
        if (imp.raw.startsWith('./')) {
            // Extension-own module — resolved/verified by `npm test`, which
            // imports the real file. Nothing to check against the clone.
            console.log(`SKIP  ${imp.raw}  (own module, covered by npm test)`);
            continue;
        }
        totalImports++;
        let moduleSource;
        try {
            moduleSource = readFileSync(imp.path, 'utf8');
        } catch {
            console.log(`FAIL  module not found: ${imp.raw}`);
            failures++;
            continue;
        }
        const exports = getExports(moduleSource);
        for (const name of imp.names) {
            if (exports.has(name)) {
                console.log(`PASS  ${name}  <-  ${imp.raw}`);
            } else {
                console.log(`FAIL  ${name}  <-  ${imp.raw}  (not exported)`);
                failures++;
            }
        }
    }
}

console.log(`\n${totalImports} imports checked`);
console.log(failures === 0 ? 'AUDIT CLEAN' : `AUDIT FAILURES: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
