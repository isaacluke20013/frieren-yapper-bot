import fs from 'node:fs';

const botUrl = new URL('./bot.js', import.meta.url);
const runtimeUrl = new URL('./bot.runtime.js', import.meta.url);

let source = fs.readFileSync(botUrl, 'utf8');

if (source.trimEnd().endsWith('err.message')) {
  source += `\n    );\n\n    process.exit(\n      1\n    );\n  }\n);\n`;
}

fs.writeFileSync(runtimeUrl, source, 'utf8');

await import('./bot.runtime.js');
