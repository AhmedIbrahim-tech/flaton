import { describeFrontend } from '../models/frontend.js';
import { describeBackend } from '../models/backend.js';
import { logger } from '../utils/logger.js';

/**
 * @param {object} options
 */
export function printGenerationSummary(options) {
  const lines = [
    '',
    '═══════════════════════════════════════════════════════════',
    '                 GENERATION SUMMARY                        ',
    '═══════════════════════════════════════════════════════════',
    `Project: ${options.folderName}`,
  ];

  if (options.backend?.enabled || options.backend === true) {
    const backend = typeof options.backend === 'object' ? options.backend : options;
    const presentation = backend.presentation ?? 'controllers';
    let presentationTitle = 'ASP.NET Core Web API';
    if (presentation === 'minimal-api') presentationTitle = 'ASP.NET Core Minimal API';
    else if (presentation === 'mvc') presentationTitle = 'ASP.NET Core MVC';
    else if (presentation === 'razor-pages') presentationTitle = 'ASP.NET Core Razor Pages';

    lines.push(
      '',
      `Backend (${presentationTitle}):`,
      `  • .NET:             ${backend.dotnet ?? '10'}`,
      `  • Architecture:     Clean Architecture (${backend.architecture === 'services' ? 'Application Services' : 'CQRS + MediatR'})`,
      `  • Data Access:      ${backend.orm === 'dapper' ? 'Dapper' : backend.orm === 'efcore-dapper' ? 'EF Core + Dapper' : 'Entity Framework Core'}`,
      `  • Database:         ${backend.database === 'postgresql' ? 'PostgreSQL' : backend.database === 'sqlite' ? 'SQLite' : 'SQL Server'}`,
      `  • Mapping:          ${backend.mapping === 'automapper' ? 'AutoMapper' : 'Manual Mapping'}`,
      `  • Authentication:   ${backend.authentication === 'none' ? 'None' : backend.authentication === 'identity' || backend.authentication === 'identity-cookie' ? 'Identity + Cookies' : 'Identity + JWT'}`,
      `  • Logging:          ${backend.logging === 'ilogger' ? 'Built-in ILogger' : 'Serilog'}`,
      `  • Background Jobs:  ${backend.backgroundJobs === 'hangfire' ? 'Hangfire' : 'None'}`,
      `  • Real Time:        ${backend.realtime === 'signalr' ? 'SignalR Hubs' : 'None'}`,
      `  • Seeding:          ${backend.authentication !== 'none' ? 'Identity Foundation Enabled' : 'None'}`,
      `  • Conventions:      FluentValidation, GlobalUsings, Swagger, Health Checks, Result Pattern`,
    );
  } else {
    lines.push('', 'Backend: None');
  }

  const frontend = options.frontend;
  if (frontend?.enabled) {
    lines.push(
      '',
      `Frontend (${describeFrontend(frontend)}):`,
      `  • Language:         ${frontend.language === 'javascript' ? 'JavaScript' : 'TypeScript'}`,
      `  • Styling:          ${frontend.styling === 'bootstrap' ? 'Bootstrap' : 'Tailwind CSS'}`,
      `  • State:            ${frontend.state === 'zustand' ? 'Zustand' : frontend.state === 'none' ? 'None' : frontend.library === 'angular' ? 'NgRx' : 'Redux Toolkit'}`,
      `  • HTTP Client:      ${frontend.httpClient === 'fetch' ? 'Fetch API' : frontend.library === 'angular' ? 'Angular HttpClient' : 'Axios'}`,
      `  • Forms:            ${frontend.forms === 'none' ? 'None' : frontend.library === 'angular' ? 'Angular Reactive Forms' : 'React Hook Form + Zod'}`,
      `  • Components:       ${frontend.componentSystem === 'shadcn' ? 'shadcn/ui' : frontend.componentSystem === 'mui' ? 'Material UI' : frontend.componentSystem === 'antd' ? 'Ant Design' : 'None'}`,
      `  • Localization:     ${frontend.localization ? (frontend.framework === 'next' ? 'next-intl' : frontend.framework === 'vite' ? 'react-i18next' : 'Cookie-based I18nService') : 'Disabled'}`,
      `  • Layouts:          Auth Layout, Dashboard Layout, Website Layout`,
      `  • Real Time:        ${frontend.realtime === 'signalr' ? 'SignalR Client & Connection Service' : 'None'}`,
    );
  } else {
    lines.push('', 'Frontend: None');
  }

  if (options.packageManager && frontend?.enabled) {
    lines.push('', `Package Manager: ${options.packageManager}`);
  }

  lines.push('═══════════════════════════════════════════════════════════', '');

  process.stdout.write(`${lines.join('\n')}\n`);
}

/**
 * Prints the transparent breakdown of the recommended defaults.
 * @param {'fullstack'|'backend-only'|'frontend-only'} mode
 * @param {object} [frontend]
 */
export function printRecommendedDefaultsSummary(mode, frontend) {
  const lines = [
    '',
    '┌─────────────────────────────────────────────────────────┐',
    '│               RECOMMENDED DEFAULT STACK                 │',
    '└─────────────────────────────────────────────────────────┘',
  ];

  if (mode === 'fullstack' || mode === 'backend-only') {
    lines.push(
      '',
      'Recommended ASP.NET Core Backend Stack:',
      '  • Architecture:     Clean Architecture',
      '  • Application Flow: CQRS + MediatR',
      '  • Validation:       FluentValidation',
      '  • Mapping:          Manual Mapping',
      '  • ORM:              Entity Framework Core',
      '  • Database:         SQL Server',
      '  • Logging:          Serilog',
      '  • Global Usings:    Enabled',
      '  • Swagger:          Enabled',
      '  • Health Checks:    Enabled',
      '  • Authentication:   ASP.NET Core Identity + JWT',
      '  • Seeder:           Identity foundation enabled',
    );
  }

  if (mode === 'fullstack' || mode === 'frontend-only') {
    const isVite = frontend?.framework === 'vite';
    const isAngular = frontend?.library === 'angular';

    if (isAngular) {
      lines.push(
        '',
        'Recommended Angular Stack:',
        '  • Framework:        Angular (Standalone Components)',
        '  • Language:         TypeScript',
        '  • Styling:          Tailwind CSS',
        '  • State:            NgRx',
        '  • HTTP:             Angular HttpClient',
        '  • Forms:            Angular Reactive Forms',
        '  • Localization:     Cookie-based I18nService (en/ar)',
        '  • Layouts:          Auth, Dashboard, Website',
      );
    } else if (isVite) {
      lines.push(
        '',
        'Recommended React + Vite Stack:',
        '  • Framework:        Vite SPA',
        '  • Language:         TypeScript',
        '  • Styling:          Tailwind CSS',
        '  • State:            Redux Toolkit + React Redux',
        '  • Routing:          React Router',
        '  • HTTP:             Axios',
        '  • Forms:            React Hook Form + Zod',
        '  • Localization:     react-i18next',
        '  • Icons:            Lucide React',
        '  • Notifications:    Sonner',
        '  • Architecture:     Feature-based modules',
        '  • Layouts:          Auth, Dashboard, Website',
      );
    } else {
      lines.push(
        '',
        'Recommended React + Next.js Stack:',
        '  • Framework:        Next.js (App Router)',
        '  • Language:         TypeScript',
        '  • Styling:          Tailwind CSS',
        '  • State:            Redux Toolkit + React Redux',
        '  • HTTP:             Axios + Server API Client',
        '  • Forms:            React Hook Form + Zod',
        '  • Localization:     next-intl',
        '  • Icons:            Lucide React',
        '  • Notifications:    Sonner',
        '  • Architecture:     Feature-based modules',
        '  • Layouts:          Auth, Dashboard, Website',
      );
    }
  }

  lines.push('───────────────────────────────────────────────────────────', '');

  process.stdout.write(`${lines.join('\n')}\n`);
}

/**
 * @param {object} options
 */
export function logSelection(options) {
  if (options.backend?.enabled) {
    logger.info(`Backend: ${describeBackend(options.backend)}`);
  }
  if (options.frontend?.enabled) {
    logger.info(`Frontend: ${describeFrontend(options.frontend)}`);
  }
}
