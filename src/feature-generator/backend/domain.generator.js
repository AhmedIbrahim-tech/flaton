import {
  toCSharpType,
  csharpDefaultInitializer,
  groupFields,
} from '../fields/field-mappers.js';
import { planEnumFiles } from './enum.generator.js';
import { getBackendFilePath } from '../../utils/project-paths.js';

/**
 * @param {object} config
 * @returns {{ relativePath: string, contents: string, writeMode?: string, conflict?: object }[]}
 */
export function planDomainFiles(config) {
  const { singularName } = config.feature;
  const groups = groupFields(config.fields);

  /** @type {{ relativePath: string, contents: string, writeMode?: string, conflict?: object }[]} */
  const files = [
    {
      relativePath: getBackendFilePath(config, 'Domain', 'Entities', `${singularName}.cs`),
      contents: renderEntity(config, groups),
    },
  ];

  // Enum types live under Domain/Enums and are only written when missing.
  files.push(...planEnumFiles(config));

  return files;
}

/**
 * Scalar, enum, FK, and navigation properties live on the entity.
 *
 * @param {object} config
 * @param {ReturnType<typeof groupFields>} groups
 */
function renderEntity(config, groups) {
  const { singularName } = config.feature;
  const ns = config.projectName;

  /** @type {string[]} */
  const lines = [];

  for (const field of groups.scalar) {
    lines.push(scalarProperty(field));
  }

  for (const field of groups.enums) {
    lines.push(scalarProperty(field));
  }

  for (const field of groups.toOne) {
    lines.push(foreignKeyProperty(field.foreignKeyName, field.nullable));
  }

  for (const field of groups.mediaSingle) {
    const nullable = !(field.required && !field.nullable);
    lines.push(foreignKeyProperty(field.foreignKeyName, nullable));
  }

  for (const field of groups.toOne) {
    lines.push(`    public ${field.target}? ${field.name} { get; set; }`);
  }

  for (const field of groups.toMany) {
    lines.push(
      `    public ICollection<${field.target}> ${field.collectionName} { get; set; } = new List<${field.target}>();`,
    );
  }

  for (const field of groups.mediaSingle) {
    lines.push(`    public StoredFile? ${field.name} { get; set; }`);
  }

  for (const field of groups.mediaMultiple) {
    lines.push(
      `    public ICollection<StoredFile> ${field.collectionName} { get; set; } = new List<StoredFile>();`,
    );
  }

  const enumUsing = groups.enums.length > 0 ? `using ${ns}.Domain.Enums;\n` : '';

  const body = lines.join('\n\n');

  return `using ${ns}.Domain.Common;
${enumUsing}
namespace ${ns}.Domain.Entities;

public sealed class ${singularName} : BaseEntity
{
${body}
}
`;
}

/**
 * @param {object} field
 */
function scalarProperty(field) {
  const type = toCSharpType(field);
  const init = csharpDefaultInitializer(field);
  return `    public ${type} ${field.name} { get; set; }${init}`;
}

/**
 * @param {string} name
 * @param {boolean} nullable
 */
function foreignKeyProperty(name, nullable) {
  const type = nullable ? 'Guid?' : 'Guid';
  return `    public ${type} ${name} { get; set; }`;
}
