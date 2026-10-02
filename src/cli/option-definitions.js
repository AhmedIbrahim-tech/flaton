/**
 * Canonical CLI option definitions, supported values, and aliases.
 */

export const OPTION_DEFINITIONS = {
  type: {
    flag: '--type',
    supported: ['fullstack', 'backend', 'frontend'],
    aliases: {
      'backend-only': 'backend',
      'frontend-only': 'frontend',
      'full-stack': 'fullstack',
    },
    description: 'Project type (fullstack | backend | frontend)',
  },
  backendType: {
    flag: '--backend-type',
    supported: ['controllers', 'minimal-api', 'mvc', 'razor-pages'],
    aliases: {},
    description: 'Backend presentation type (controllers | minimal-api | mvc | razor-pages)',
  },
  dotnet: {
    flag: '--dotnet',
    supported: ['10', '9', '8'],
    aliases: {
      'net10.0': '10',
      'net9.0': '9',
      'net8.0': '8',
    },
    description: '.NET version (10 | 9 | 8)',
  },
  architecture: {
    flag: '--architecture',
    supported: ['cqrs', 'services'],
    aliases: {
      'cqrs-mediatr': 'cqrs',
    },
    description: 'Application Architecture (cqrs | services)',
  },
  mapping: {
    flag: '--mapping',
    supported: ['manual', 'automapper'],
    aliases: {},
    description: 'Object mapping strategy (manual | automapper)',
  },
  orm: {
    flag: '--orm',
    supported: ['efcore', 'dapper', 'hybrid'],
    aliases: {
      'efcore-dapper': 'hybrid',
    },
    description: 'Data Access ORM (efcore | dapper | hybrid)',
  },
  db: {
    flag: '--db',
    supported: ['sqlserver', 'postgresql', 'sqlite'],
    aliases: {},
    description: 'Database engine (sqlserver | postgresql | sqlite)',
  },
  auth: {
    flag: '--auth',
    supported: ['jwt', 'cookies', 'none'],
    aliases: {
      'identity-jwt': 'jwt',
      'identity': 'cookies',
      'identity-cookie': 'cookies',
      'identity-cookies': 'cookies',
    },
    description: 'Authentication mode (jwt | cookies | none)',
  },
  logging: {
    flag: '--logging',
    supported: ['serilog', 'builtin'],
    aliases: {
      'ilogger': 'builtin',
    },
    description: 'Logging provider (serilog | builtin)',
  },
  frontend: {
    flag: '--frontend',
    supported: ['react', 'angular'],
    aliases: {},
    description: 'Frontend framework (react | angular)',
  },
  frontendTooling: {
    flag: '--frontend-tooling',
    supported: ['vite', 'next', 'angular-cli'],
    aliases: {},
    description: 'Frontend build tooling (vite | next | angular-cli)',
  },
  language: {
    flag: '--language',
    supported: ['typescript', 'javascript'],
    aliases: {
      'ts': 'typescript',
      'js': 'javascript',
    },
    description: 'Language (typescript | javascript)',
  },
  styling: {
    flag: '--styling',
    supported: ['tailwind', 'bootstrap'],
    aliases: {},
    description: 'Styling system (tailwind | bootstrap)',
  },
  state: {
    flag: '--state',
    supported: ['redux', 'zustand', 'ngrx', 'none'],
    aliases: {},
    description: 'State management (redux | zustand | ngrx | none)',
  },
  http: {
    flag: '--http',
    supported: ['axios', 'fetch', 'angular-http'],
    aliases: {
      'httpclient': 'angular-http',
    },
    description: 'HTTP client (axios | fetch | angular-http)',
  },
  forms: {
    flag: '--forms',
    supported: ['rhf-zod', 'angular-reactive', 'none'],
    aliases: {
      'react-hook-form-zod': 'rhf-zod',
      'reactive-forms': 'angular-reactive',
    },
    description: 'Form handling (rhf-zod | angular-reactive | none)',
  },
  ui: {
    flag: '--ui',
    supported: ['shadcn', 'mui', 'antd', 'angular-material', 'antd-angular', 'none'],
    aliases: {
      'material': 'angular-material',
    },
    description: 'UI component library (shadcn | mui | antd | angular-material | antd-angular | none)',
  },
};
