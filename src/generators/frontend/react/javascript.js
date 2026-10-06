/**
 * Conservative TypeScript-to-JavaScript conversion for generator overlays.
 * Handles the patterns used in Flatron React templates.
 *
 * @param {string} source
 */
export function convertTypeScriptToJavaScript(source) {
  let out = source;

  out = out.replace(/^import type \{[\s\S]*?\} from ["'][^"']+["'];\r?\n/gm, '');
  out = out.replace(/^import type \* as \w+ from ["'][^"']+["'];\r?\n/gm, '');
  out = out.replace(/^import type [A-Za-z0-9_]+ from ["'][^"']+["'];\r?\n/gm, '');
  out = out.replace(/^export type \{[\s\S]*?\} from ["'][^"']+["'];\r?\n/gm, '');
  out = out.replace(/type\s+([A-Za-z0-9_]+)\s*,\s*/g, '');
  out = out.replace(/,\s*type\s+[A-Za-z0-9_]+/g, '');

  out = stripExportTypeOrInterface(out);

  out = out.replace(/ as const/g, '');
  out = out.replace(/ as [A-Za-z0-9_.<>,[\] |]+/g, '');
  out = out.replace(/ satisfies [A-Za-z0-9_.<>,[\] |]+/g, '');
  out = out.replace(/!\./g, '.');
  out = out.replace(/!\(/g, '(');

  out = out.replace(/<[A-Za-z0-9_.,\s[\]|&]+>\(/g, '(');
  out = out.replace(/<[A-Za-z0-9_.,\s[\]|&]+>\s*`/g, '`');

  out = out.replace(/:\s*Readonly<\{[\s\S]*?\}>/g, '');
  out = out.replace(/:\s*React\.[A-Za-z0-9_]+(<[^>]+>)?\s*=/g, ' =');
  out = out.replace(/:\s*ReactElement\s*=/g, ' =');
  
  // Destructured parameter type annotations with inline object types: ({ a, b }: { a: string }) =>
  out = out.replace(/(\}\s*):\s*\{[\s\S]*?\}\s*([=,)])/g, '$1$2');
  // Simple destructured parameter type annotations: ({ a, b }: Props) =>
  out = out.replace(/(\}\s*):\s*[A-Za-z0-9_.<>,[\] |&?]+(\s*[=,)])/g, '$1$2');
  // Parameter with inline object type: (options: { a: string }) =>
  out = out.replace(/(\(|,)\s*([A-Za-z0-9_]+\??)\s*:\s*\{[\s\S]*?\}\s*([=,)])/g, '$1 $2$3');
  // Simple parameter type annotations: (a: string, b: number) =>
  out = out.replace(/(\(|,)\s*([A-Za-z0-9_]+\??)\s*:\s*[A-Za-z0-9_.<>,[\] |&?]+(\s*[=,)])/g, '$1 $2$3');
  
  // Return type annotations
  out = out.replace(/\):\s*[A-Za-z0-9_.<>,[\] |&]+(\s*\{)/g, ')$1');
  out = out.replace(/\):\s*[A-Za-z0-9_.<>,[\] |&]+(\s*=>)/g, ')$1');

  // Variable type annotations
  out = out.replace(/\b(const|let|var)\s+([A-Za-z0-9_]+)\s*:\s*[A-Za-z0-9_.<>,[\] |&?]+(\s*=[^=])/g, '$1 $2$3');
  out = out.replace(/\b(const|let|var)\s+([A-Za-z0-9_]+)\s*:\s*[A-Za-z0-9_.<>,[\] |&?]+(\s*;)/g, '$1 $2$3');

  out = out.replace(/export function (\w+)\s*<[^>]+>\s*\(/g, 'export function $1(');
  out = out.replace(/function (\w+)\s*<[^>]+>\s*\(/g, 'function $1(');

  return out;
}

/**
 * @param {string} source
 */
function stripExportTypeOrInterface(source) {
  let out = source;
  const pattern = /^(export\s+)?(type|interface)\s+/gm;
  let match = pattern.exec(out);
  while (match) {
    const start = match.index;
    let end = start;
    const brace = out.indexOf('{', start);
    const semi = out.indexOf(';', start);
    if (brace !== -1 && (semi === -1 || brace < semi)) {
      let depth = 0;
      for (let index = brace; index < out.length; index += 1) {
        if (out[index] === '{') depth += 1;
        else if (out[index] === '}') {
          depth -= 1;
          if (depth === 0) {
            end = index + 1;
            break;
          }
        }
      }
    } else if (semi !== -1) {
      end = semi + 1;
    } else {
      break;
    }
    out = `${out.slice(0, start)}${out.slice(end)}`.replace(/\n{3,}/g, '\n\n');
    pattern.lastIndex = start;
    match = pattern.exec(out);
  }
  return out;
}

/**
 * @param {string} filePath
 */
export function toJavaScriptFileName(filePath) {
  if (filePath.endsWith('.tsx')) {
    return `${filePath.slice(0, -4)}.jsx`;
  }
  if (filePath.endsWith('.ts') && !filePath.endsWith('.d.ts')) {
    return `${filePath.slice(0, -3)}.js`;
  }
  return filePath;
}
