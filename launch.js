import fs from 'node:fs';

const botUrl = new URL('./bot.js', import.meta.url);
const runtimeUrl = new URL('./bot.runtime.js', import.meta.url);

let source = fs.readFileSync(botUrl, 'utf8');

if (source.trimEnd().endsWith('err.message')) {
  source += `\n    );\n\n    process.exit(\n      1\n    );\n  }\n);\n`;
}

// Repair UTF-8 characters that were accidentally saved as mojibake.
const mojibakeFixes = new Map([
  ['\u00e2\u0080\u0094', '—'],
  ['\u00e2\u0080\u0093', '–'],
  ['\u00e2\u0080\u0099', '’'],
  ['\u00e2\u0080\u00a2', '•'],
  ['\u00e2\u009c\u0093', '✓'],
  ['\u00e2\u009c\u0085', '✅'],
  ['\u00e2\u009d\u008c', '❌'],
  ['\u00e2\u0086\u0090', '←'],
  ['\u00e2\u0086\u0092', '→'],
  ['\u00e2\u009a\u00a0\u00ef\u00b8\u008f', '⚠️']
]);

for (const [broken, fixed] of mojibakeFixes) {
  source = source.split(broken).join(fixed);
}

const helpHeader = '**Frieren commands**\n\n';
if (source.includes(helpHeader)) {
  source = source.replace(
    helpHeader,
    helpHeader + "\\`/socialalerts\\` — configure Twitch, YouTube, and TikTok creator notifications\n"
  );
}

fs.writeFileSync(runtimeUrl, source, 'utf8');

await import('./bot.runtime.js');
