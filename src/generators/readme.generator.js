import path from 'node:path';
import { writeFile } from '../utils/filesystem.js';
import { describeFrontend } from '../models/frontend.js';
import { describeBackend } from '../models/backend.js';
import { readPackageMeta } from '../cli/arguments.js';
import { resolveProjectPaths } from '../utils/project-paths.js';

/**
 * @param {object} options
 */
export async function writeGeneratedReadme(options) {
  const pm = options.packageManager ?? 'npm';
  const installCmd = pm === 'yarn' ? 'yarn' : `${pm} install`;
  const devCmd = pm === 'yarn' ? 'yarn dev' : `${pm} run dev`;
  const frontend = options.frontend ?? { enabled: false };
  const backend = options.backend?.enabled || options.backend === true
    ? (typeof options.backend === 'object' ? options.backend : { enabled: true })
    : { enabled: false };

  const paths = options.paths ?? resolveProjectPaths({
    backend,
    frontend,
  });

  const sections = [];

  sections.push(`# ${options.displayName}`, '', `Generated with Flatron.`, '');

  sections.push('## Project Architecture', '');
  if (backend.enabled) {
    const isBackendNested = paths.backend === 'Backend';
    const prefix = isBackendNested ? 'Backend/' : '';
    sections.push(
      '### Backend (ASP.NET Core Web API)',
      `- **Architecture**: Clean Architecture (${backend.architecture === 'services' ? 'Application Services' : 'CQRS + MediatR'})`,
      `- **Data Access**: ${backend.orm === 'dapper' ? 'Dapper' : backend.orm === 'efcore-dapper' ? 'EF Core + Dapper' : 'Entity Framework Core'}`,
      `- **Database**: ${backend.database === 'postgresql' ? 'PostgreSQL' : backend.database === 'sqlite' ? 'SQLite' : 'SQL Server'}`,
      `- **Logging**: ${backend.logging === 'ilogger' ? 'Built-in ILogger' : 'Serilog'}`,
      `- **Authentication**: ${backend.authentication === 'none' ? 'None' : backend.authentication === 'identity' ? 'ASP.NET Core Identity' : 'ASP.NET Core Identity + JWT'}`,
      backend.realtime === 'signalr' ? '- **Real Time**: SignalR Hubs (`/hubs/app`)' : '',
      backend.backgroundJobs === 'hangfire' ? '- **Background Jobs**: Hangfire Dashboard (`/hangfire`)' : '',
      '',
      'Folder structure:',
      `- \`${prefix}API/\` — controllers, \`Contracts/Router.cs\`, middleware, filters, hubs, layer DI`,
      `- \`${prefix}Application/\` — feature use cases (\`Features/{Name}/Commands|Queries|DTOs\`), abstractions, layer DI`,
      `- \`${prefix}Domain/\` — entities, value objects, domain events, specifications, exceptions`,
      `- \`${prefix}Infrastructure/\` — persistence, identity, authentication implementations, seeders, layer DI`,
      `- \`${prefix}${options.pascalName}.slnx\` — solution file`,
      '',
    );
  }

  if (frontend.enabled) {
    const isFrontendNested = paths.frontend === 'Frontend';
    const prefix = isFrontendNested ? 'Frontend/' : '';
    sections.push(
      `### Frontend (${describeFrontend(frontend)})`,
      `- **Language**: ${frontend.language === 'javascript' ? 'JavaScript' : 'TypeScript'}`,
      `- **Styling**: ${frontend.styling === 'bootstrap' ? 'Bootstrap' : 'Tailwind CSS'}`,
      `- **State**: ${frontend.state === 'zustand' ? 'Zustand' : frontend.state === 'none' ? 'None' : frontend.library === 'angular' ? 'NgRx' : 'Redux Toolkit'}`,
      `- **HTTP Client**: ${frontend.httpClient === 'fetch' ? 'Fetch API' : frontend.library === 'angular' ? 'Angular HttpClient' : 'Axios'}`,
      `- **Forms**: ${frontend.forms === 'none' ? 'None' : frontend.library === 'angular' ? 'Angular Reactive Forms' : 'React Hook Form + Zod'}`,
      `- **Component System**: ${frontend.componentSystem === 'shadcn' ? 'shadcn/ui' : frontend.componentSystem === 'mui' ? 'Material UI' : frontend.componentSystem === 'antd' ? 'Ant Design' : 'None'}`,
      `- **Layout Foundations**: Auth Layout (\`/login\`, \`/register\`, \`/forgot-password\`), Dashboard Layout (\`/dashboard\`), Website Layout (\`/\`)`,
      frontend.realtime === 'signalr' ? '- **Real Time**: SignalR Client Connection Hook / Service' : '',
      '',
      isFrontendNested ? `- \`${prefix}\` — Frontend application root` : `- Frontend files live at the project root`,
      '',
    );
  }

  sections.push('## Requirements', '', '- Node.js 20+');
  if (backend.enabled) {
    sections.push(
      '- .NET SDK 9.0+',
      backend.database === 'postgresql'
        ? '- PostgreSQL Server'
        : backend.database === 'sqlite'
          ? '- SQLite (embedded)'
          : '- SQL Server (LocalDB, SQL Server Express, or Docker)',
    );
  }
  sections.push('');

  if (backend.enabled) {
    const isBackendNested = paths.backend === 'Backend';
    sections.push(
      '## Run the Backend API',
      '',
      '```bash',
      isBackendNested ? 'cd Backend' : '',
      'dotnet restore',
      'dotnet build',
      'dotnet run --project API',
      '```',
      '',
      'The API listens on `http://localhost:5000` (Swagger docs available at `http://localhost:5000/swagger` in Development).',
      'Health check endpoint is at `http://localhost:5000/health`.',
      '',
    );
  }

  if (frontend.enabled) {
    const isFrontendNested = paths.frontend === 'Frontend';
    sections.push(
      '## Run the Frontend Client',
      '',
      '```bash',
      isFrontendNested ? 'cd Frontend' : '',
      installCmd,
      devCmd,
      '```',
      '',
    );
  }

  const pkg = readPackageMeta();
  sections.push('---', `Generated with Flatron v${pkg.version}`, '');

  await writeFile(
    path.join(options.targetDirectory, 'README.md'),
    sections.filter((line) => line !== undefined && line !== '').join('\n') + '\n',
  );
}
