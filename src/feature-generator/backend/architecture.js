/**
 * Resolves the backend application architecture from feature input or the
 * project manifest. Defaults to CQRS + MediatR.
 *
 * @param {{ architecture?: string, manifest?: { backend?: { architecture?: string } } }} [input]
 * @returns {'cqrs-mediatr' | 'services'}
 */
export function resolveBackendArchitecture(input = {}) {
  const value =
    input.architecture
    ?? input.manifest?.backend?.architecture
    ?? 'cqrs-mediatr';
  return value === 'services' ? 'services' : 'cqrs-mediatr';
}

/**
 * @param {string} [architecture]
 */
export function isServicesArchitecture(architecture) {
  return architecture === 'services';
}

/**
 * @param {{ presentation?: string, manifest?: { backend?: { presentation?: string } } }} [input]
 * @returns {'controllers' | 'minimal-api' | 'mvc' | 'razor-pages'}
 */
export function resolveBackendPresentation(input = {}) {
  const value =
    input.presentation
    ?? input.manifest?.backend?.presentation
    ?? 'controllers';
  if (['controllers', 'minimal-api', 'mvc', 'razor-pages'].includes(value)) {
    return value;
  }
  return 'controllers';
}

export function isControllers(presentation) {
  return presentation === 'controllers' || !presentation;
}

export function isMinimalApi(presentation) {
  return presentation === 'minimal-api';
}

export function isMvc(presentation) {
  return presentation === 'mvc';
}

export function isRazorPages(presentation) {
  return presentation === 'razor-pages';
}

/**
 * @param {{ orm?: string, manifest?: { backend?: { orm?: string } } }} [input]
 * @returns {'efcore' | 'dapper' | 'efcore-dapper'}
 */
export function resolveBackendOrm(input = {}) {
  const value = input.orm ?? input.manifest?.backend?.orm ?? 'efcore';
  if (value === 'dapper' || value === 'efcore-dapper') {
    return value;
  }
  return 'efcore';
}

/**
 * @param {{ database?: string, manifest?: { backend?: { database?: string } } }} [input]
 * @returns {'sqlserver' | 'postgresql' | 'sqlite'}
 */
export function resolveBackendDatabase(input = {}) {
  const value = input.database ?? input.manifest?.backend?.database ?? 'sqlserver';
  if (value === 'postgresql' || value === 'sqlite') {
    return value;
  }
  return 'sqlserver';
}

/**
 * @param {string} [orm]
 */
export function isDapperOnly(orm) {
  return orm === 'dapper';
}

/**
 * @param {string} [orm]
 */
export function usesEfCore(orm) {
  return orm === 'efcore' || orm === 'efcore-dapper';
}

/**
 * @param {string} [orm]
 */
export function usesDapper(orm) {
  return orm === 'dapper' || orm === 'efcore-dapper';
}

/**
 * Repository abstraction used by Dapper read handlers.
 * Dapper-only features use the full CRUD repository; hybrid features use a
 * query-only repository alongside EF Core writes.
 * @param {object} config
 */
export function dapperReadRepositoryName(config) {
  const plural = config.feature.pluralName;
  return isDapperOnly(config.orm) ? `I${plural}Repository` : `I${plural}QueryRepository`;
}

/**
 * @param {object} config
 */
export function dapperReadRepositoryClassName(config) {
  const plural = config.feature.pluralName;
  return isDapperOnly(config.orm) ? `${plural}Repository` : `${plural}QueryRepository`;
}

/**
 * Strip MediatR imports and IRequest implementations from a C# source string.
 * Handles nested generics such as `IRequest<Result<PaginationResult<T>>>`
 * and comma-separated bases such as `: SearchRequest, IRequest<T>`.
 * @param {string} source
 */
export function stripMediatRFromType(source) {
  let out = source.replace(/^using MediatR;\r?\n/gm, '');
  const token = 'IRequest';
  let index = 0;
  let result = '';

  while (index < out.length) {
    const found = out.indexOf(token, index);
    if (found < 0) {
      result += out.slice(index);
      break;
    }

    const afterToken = found + token.length;
    const nextChar = out[afterToken];
    if (nextChar && /[A-Za-z0-9_]/.test(nextChar)) {
      result += out.slice(index, afterToken);
      index = afterToken;
      continue;
    }

    let start = found;
    while (start > 0 && /\s/.test(out[start - 1])) {
      start -= 1;
    }
    if (start > 0 && (out[start - 1] === ',' || out[start - 1] === ':')) {
      start -= 1;
      while (start > 0 && /\s/.test(out[start - 1])) {
        start -= 1;
      }
    } else {
      result += out.slice(index, afterToken);
      index = afterToken;
      continue;
    }

    let end = afterToken;
    if (out[end] === '<') {
      let depth = 0;
      for (let cursor = end; cursor < out.length; cursor += 1) {
        if (out[cursor] === '<') depth += 1;
        else if (out[cursor] === '>') {
          depth -= 1;
          if (depth === 0) {
            end = cursor + 1;
            break;
          }
        }
      }
    }

    result += out.slice(index, start);
    index = end;
  }

  return result;
}

/**
 * Extract a C# instance method whose signature matches `pattern` and rename
 * the method identifier `Handle` to `newName`.
 *
 * @param {string} source
 * @param {string} newName
 */
export function extractHandleAsMethod(source, newName) {
  const match = source.match(/public async Task[\s\S]*? Handle\(/);
  if (!match || match.index == null) {
    throw new Error('Could not extract Handle method from generated handler.');
  }

  const start = match.index;
  const braceStart = source.indexOf('{', start);
  if (braceStart < 0) {
    throw new Error('Could not find Handle method body.');
  }

  let depth = 0;
  let end = -1;
  for (let index = braceStart; index < source.length; index += 1) {
    const ch = source[index];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end = index;
        break;
      }
    }
  }

  if (end < 0) {
    throw new Error('Unbalanced braces while extracting Handle method.');
  }

  const method = source.slice(start, end + 1);
  return method.replace(/ Handle\(/, ` ${newName}(`);
}

/**
 * Collect unique using directives, excluding MediatR.
 * @param {...string} sources
 */
export function collectUsings(...sources) {
  const set = new Set();
  for (const source of sources) {
    if (!source) continue;
    for (const match of source.matchAll(/^using .+;$/gm)) {
      if (match[0].includes('MediatR')) continue;
      set.add(match[0]);
    }
  }
  return [...set].sort().join('\n');
}
