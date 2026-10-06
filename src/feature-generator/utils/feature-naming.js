import { toPascalCase } from '../../utils/naming.js';

const IRREGULAR_PLURALS = new Map([
  ['person', 'people'],
  ['man', 'men'],
  ['woman', 'women'],
  ['child', 'children'],
  ['mouse', 'mice'],
  ['goose', 'geese'],
  ['tooth', 'teeth'],
  ['foot', 'feet'],
  ['ox', 'oxen'],
  ['leaf', 'leaves'],
  ['life', 'lives'],
  ['knife', 'knives'],
  ['wife', 'wives'],
  ['half', 'halves'],
  ['self', 'selves'],
  ['elf', 'elves'],
  ['loaf', 'loaves'],
  ['potato', 'potatoes'],
  ['tomato', 'tomatoes'],
  ['hero', 'heroes'],
  ['echo', 'echoes'],
  ['analysis', 'analyses'],
  ['basis', 'bases'],
  ['crisis', 'crises'],
  ['diagnosis', 'diagnoses'],
  ['thesis', 'theses'],
  ['index', 'indices'],
  ['matrix', 'matrices'],
  ['vertex', 'vertices'],
  ['axis', 'axes'],
  ['quiz', 'quizzes'],
]);

const UNCOUNTABLE = new Set([
  'equipment',
  'information',
  'rice',
  'money',
  'species',
  'series',
  'fish',
  'sheep',
  'deer',
  'news',
  'audio',
  'data',
]);

/**
 * @param {string} word
 */
export function pluralizeWord(word) {
  const lower = word.toLowerCase();
  if (UNCOUNTABLE.has(lower)) {
    return word;
  }

  if (IRREGULAR_PLURALS.has(lower)) {
    return matchCase(word, IRREGULAR_PLURALS.get(lower));
  }

  if (/(?:s|ss|sh|ch|x|z)$/i.test(word)) {
    return `${word}es`;
  }

  if (/[^aeiou]y$/i.test(word)) {
    return `${word.slice(0, -1)}ies`;
  }

  if (/fe?$/i.test(word) && !/ff$/i.test(word)) {
    return `${word.replace(/fe?$/i, '')}ves`;
  }

  if (/o$/i.test(word) && !/[aeiou]o$/i.test(word)) {
    return `${word}es`;
  }

  return `${word}s`;
}

/**
 * @param {string} source
 * @param {string} target
 */
function matchCase(source, target) {
  if (source === source.toUpperCase()) {
    return target.toUpperCase();
  }

  if (source[0] === source[0].toUpperCase()) {
    return target.charAt(0).toUpperCase() + target.slice(1);
  }

  return target;
}

/**
 * @param {string} pascalName
 */
export function toCamelCase(pascalName) {
  if (!pascalName) {
    return '';
  }

  return pascalName.charAt(0).toLowerCase() + pascalName.slice(1);
}

/**
 * @param {string} pascalName
 */
export function toKebabCase(pascalName) {
  return pascalName
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

/**
 * Pluralize a PascalCase identifier by pluralizing the final word segment.
 * @param {string} pascalName
 */
export function pluralizePascal(pascalName) {
  const parts = pascalName.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(' ').filter(Boolean);
  if (parts.length === 0) {
    return pascalName;
  }

  const last = parts[parts.length - 1];
  parts[parts.length - 1] = pluralizeWord(last);
  return parts.join('');
}

/**
 * @param {string} singularInput
 * @param {string} [pluralOverride]
 */
export function deriveFeatureNames(singularInput, pluralOverride) {
  const singularName = toPascalCase(singularInput);
  const pluralName = pluralOverride
    ? toPascalCase(pluralOverride)
    : pluralizePascal(singularName);

  return {
    singularName,
    pluralName,
    camelName: toCamelCase(singularName),
    camelPlural: toCamelCase(pluralName),
    camelPluralName: toCamelCase(pluralName),
    kebabName: toKebabCase(singularName),
    kebabPlural: toKebabCase(pluralName),
    kebabPluralName: toKebabCase(pluralName),
    route: toKebabCase(pluralName),
  };
}
