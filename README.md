# generate-fullstack-app

<p align="center">
  <img src="hero.png" alt="generate-fullstack-app hero: generate production-ready full stack, backend-only, or frontend-only apps" width="100%" />
</p>

A flexible, production-grade project, feature, and application module generator for **ASP.NET Core Clean Architecture** backends and modern frontends (**React with Next.js or Vite**, or **Angular**).

Supports:
- **Full Stack** projects (`Backend/` + `Frontend/`)
- **Backend Only** projects (Clean Architecture at project root)
- **Frontend Only** projects (Modern SPA / SSR at project root)
- **Recommended Defaults** for instant zero-friction scaffolding
- **Custom Architecture decisions** for advanced developers
- **V4 Application Modules** (Auth, Users, Permissions, Audit, Notifications, Localization, Rich Text, Dashboard)
- **Feature Generator** with rich type models, relationships, and automatic UI/API generation

Current version: **4.0.0**

---

## Requirements

- **Node.js** ≥ 20
- **.NET SDK** ≥ 9.0 (for ASP.NET Core backends)
- **Database Engine** (SQL Server, PostgreSQL, or SQLite)
- Optional: `dotnet ef` tools (`dotnet tool install -g dotnet-ef`)

---

## CLI Commands

| Command | Purpose |
| :--- | :--- |
| `generate-fullstack-app [ProjectName]` | Interactive CLI wizard to scaffold Full Stack, Backend Only, or Frontend Only apps |
| `create-fullstack-feature [FeatureName]` | Generate end-to-end CRUD features (Domain, Application, API, Frontend) |
| `create-fullstack-module [ModuleName]` | Opt into production infrastructure modules (Auth, Users, Permissions, etc.) |

---

## Getting Started

### Run with `npx` (No installation needed)

```bash
npx generate-fullstack-app MyApp
```

### Install globally

```bash
npm install -g generate-fullstack-app

generate-fullstack-app MyApp
```

---

## Project Creation Modes

Configure the stack visually, then generate with the CLI. The interactive builder enforces compatible choices across .NET, frontend frameworks, state libraries, and UI systems:

<p align="center">
  <img src="Builder.png" alt="Interactive stack builder: project mode, architecture preview, and .fullstack-app.json output" width="100%" />
</p>

When running `generate-fullstack-app`, the CLI asks:

> **What do you want to create?**
> 1. Full Stack (Backend + Frontend)
> 2. Backend Only (.NET Web API)
> 3. Frontend Only (React / Next.js / Vite / Angular)

The generator only prompts for options relevant to the chosen mode.

### 1. Full Stack Mode
Generates an isolated backend and frontend structure:

```text
<ProjectName>/
├── .fullstack-app.json
├── README.md
├── Backend/
│   ├── API/
│   ├── Application/
│   ├── Domain/
│   ├── Infrastructure/
│   └── <ProjectName>.slnx
└── Frontend/
    ├── package.json
    ├── src/
    └── ...
```

### 2. Backend Only Mode
Generates the Clean Architecture solution directly at the project root:

```text
<ProjectName>/
├── .fullstack-app.json
├── README.md
├── API/
├── Application/
├── Domain/
├── Infrastructure/
└── <ProjectName>.slnx
```

### 3. Frontend Only Mode
Generates the frontend application directly at the project root:

```text
<ProjectName>/
├── .fullstack-app.json
├── README.md
├── package.json
├── src/
└── ...
```

---

## CLI Execution Modes

The generator supports three execution modes:

### 1. Interactive Mode
Run the generator with just a project name to walk through the interactive wizard:
```bash
npx generate-fullstack-app my-app
```

### 2. Hybrid Mode
Provide partial configuration flags; the generator will use the supplied flags and prompt only for missing applicable options:
```bash
npx generate-fullstack-app my-app \
  --type backend \
  --orm efcore \
  --db postgresql
```

### 3. Non-Interactive Mode (`--yes`)
Provide full or partial flags with `--yes` to scaffold immediately with zero prompts, using recommended defaults for any omitted optional settings:

#### Non-Interactive Backend Only
```bash
npx generate-fullstack-app my-app \
  --type backend \
  --backend-type controllers \
  --architecture cqrs \
  --dotnet 10 \
  --mapping manual \
  --orm efcore \
  --db postgresql \
  --auth jwt \
  --signalr \
  --hangfire \
  --yes
```

#### Non-Interactive Frontend Only
```bash
npx generate-fullstack-app my-ui \
  --type frontend \
  --frontend react \
  --frontend-tooling vite \
  --language typescript \
  --styling tailwind \
  --state zustand \
  --http axios \
  --forms rhf-zod \
  --ui shadcn \
  --yes
```

#### Non-Interactive Full Stack
```bash
npx generate-fullstack-app my-app \
  --type fullstack \
  --architecture services \
  --dotnet 10 \
  --mapping manual \
  --orm efcore \
  --db postgresql \
  --auth jwt \
  --signalr \
  --hangfire \
  --frontend react \
  --frontend-tooling vite \
  --language typescript \
  --styling tailwind \
  --state zustand \
  --http axios \
  --forms rhf-zod \
  --ui shadcn \
  --yes
```

---

## Canonical CLI Flags

### Project & Backend Options
| Flag | Values | Description |
| :--- | :--- | :--- |
| `--type` | `fullstack` \| `backend` \| `frontend` | Project mode |
| `--backend-type` | `controllers` \| `minimal-api` \| `mvc` \| `razor-pages` | Presentation layer (Backend Only) |
| `--dotnet` | `10` \| `9` \| `8` | Target .NET version |
| `--architecture` | `cqrs` \| `services` | Application architecture |
| `--mapping` | `manual` \| `automapper` | Object mapping strategy |
| `--orm` | `efcore` \| `dapper` \| `hybrid` | Data access / ORM |
| `--db` | `sqlserver` \| `postgresql` \| `sqlite` | Database engine |
| `--auth` | `jwt` \| `cookies` \| `none` | Authentication model |
| `--logging` | `serilog` \| `builtin` | Logging provider |
| `--signalr` / `--no-signalr` | _boolean_ | Enable / disable SignalR |
| `--hangfire` / `--no-hangfire` | _boolean_ | Enable / disable Hangfire |

### Frontend Options
| Flag | Values | Description |
| :--- | :--- | :--- |
| `--frontend` | `react` \| `angular` | Frontend framework |
| `--frontend-tooling` | `vite` \| `next` \| `angular-cli` | Build tooling / framework |
| `--language` | `typescript` \| `javascript` | Frontend language |
| `--styling` | `tailwind` \| `bootstrap` | Styling system |
| `--state` | `redux` \| `zustand` \| `ngrx` \| `none` | State management |
| `--http` | `axios` \| `fetch` \| `angular-http` | HTTP client |
| `--forms` | `rhf-zod` \| `angular-reactive` \| `none` | Form handling |
| `--ui` | `shadcn` \| `mui` \| `antd` \| `angular-material` \| `antd-angular` \| `none` | Component library |
| `--localization` / `--no-localization` | _boolean_ | Enable / disable localization |

### General Options
| Flag | Values | Description |
| :--- | :--- | :--- |
| `-y`, `--yes` | _boolean_ | Non-interactive mode (skips prompts and uses defaults) |
| `--verbose` | _boolean_ | Stream full stdout/stderr from internal commands |
| `-o`, `--output` | `<dir>` | Target output directory (default: current working directory) |
| `-p`, `--package-manager` | `npm` \| `yarn` \| `pnpm` | Preferred frontend package manager |
| `-h`, `--help` | _boolean_ | Display CLI help |
| `-v`, `--version` | _boolean_ | Display version |

---


## Running Generated Projects

### Full Stack
```bash
# Terminal 1: Backend API
cd MyApp/Backend
dotnet restore
dotnet run --project API

# Terminal 2: Frontend App
cd MyApp/Frontend
npm install
npm run dev
```

### Backend Only
```bash
cd MyApi
dotnet restore
dotnet run --project API
```

### Frontend Only
```bash
cd MyUi
npm install
npm run dev
```

Default Dev URLs:
- **Next.js**: `http://localhost:3000`
- **Vite**: `http://localhost:5173`
- **Angular**: `http://localhost:4200`
- **ASP.NET Core API**: `http://localhost:5000` (Swagger at `/swagger`, Health check at `/health`)

---

## Manifest (`.fullstack-app.json`)

The manifest is the single source of truth for all generators, storing exact folder paths and configuration:

```json
{
  "projectName": "MyApp",
  "paths": {
    "backend": "Backend",
    "frontend": "Frontend"
  },
  "backend": {
    "enabled": true,
    "architecture": "cqrs-mediatr",
    "orm": "efcore",
    "database": "postgresql",
    "authentication": "identity-jwt"
  },
  "frontend": {
    "enabled": true,
    "library": "react",
    "framework": "next",
    "language": "typescript",
    "styling": "tailwind",
    "state": "redux"
  },
  "modules": {
    "auth": { "enabled": true, "version": "4.0.0" }
  }
}
```

---

## V4 Production Application Modules

Opt-in modules add production-grade features without coupling:

| Module | Depends on | What it generates |
| :--- | :--- | :--- |
| `auth` | — | Identity + JWT access tokens (memory only) + HttpOnly refresh cookies (SHA-256 hash & rotation) |
| `users` | auth | Admin user search, create, update, role assignments |
| `permissions` | auth | `Feature.Action` granular permissions & dynamic authorization policies |
| `audit` | — | Audit trail with automatic sensitive-field redaction |
| `notifications` | auth | In-app notification center with recipient validation |
| `localization` | — | Database-driven domain content languages (`Language`, Accept-Language header) |
| `rich-text` | — | Structured TipTap JSON documents + safe renderer |
| `dashboard` | — | Admin layout, navigation registry, and dashboard widgets |

### Module CLI Commands
```bash
# List available modules
create-fullstack-module --list

# Check enabled modules in current project
create-fullstack-module --status

# Install module (interactive or with --yes)
create-fullstack-module auth --yes
create-fullstack-module users --yes

# Create EF migration for module
create-fullstack-module auth --migration
```

---

## Feature Generator

Generate complete end-to-end CRUD features adhering to Clean Architecture and your chosen frontend stack.

### Field Types & Modifiers

| Field Kind | Syntax Example | Notes |
| :--- | :--- | :--- |
| **Scalar** | `Name:string:required:max=200`<br>`Price:decimal:required:min=0` | string, int, long, decimal, double, boolean, Guid, DateTime, DateTimeOffset |
| **Enum** | `Status:enum:name=ProductStatus:values=Draft\|Active\|Archived:required` | Strongly-typed C# enum + TypeScript union |
| **Relationship** | `Category:relationship:target=Category:type=many-to-one:required:display=Name`<br>`Tags:relationship:target=Tag:type=many-to-many:display=Name` | Creates Foreign Keys, Navigation Properties, EF configurations, and UI Select dropdowns |
| **File / Image** | `Avatar:image:required`<br>`Document:file` | Multipart file upload integration via `IFileStorageService` |
| **Rich Text** | `Content:richText:required` | TipTap structured JSON editor and renderer |

### Feature Generation Example

```bash
# 1. Create related features
create-fullstack-feature Category --yes --field "Name:string:required:max=150"
create-fullstack-feature Tag --yes --field "Name:string:required:max=100"

# 2. Create main feature with relationships
create-fullstack-feature Product --yes --surface both \
  --field "Name:string:required:max=200" \
  --field "Price:decimal:required:min=0" \
  --field "Category:relationship:target=Category:type=many-to-one:required:display=Name" \
  --field "Tags:relationship:target=Tag:type=many-to-many:display=Name" \
  --field "Status:enum:name=ProductStatus:values=Draft|Active|Archived:required" \
  --field "Image:image" \
  --field "Description:richText"
```

---

## Development & Testing

```bash
# Run unit & integration test suites
npm test

# Run syntax linter
npm run lint

# Run end-to-end smoke tests
npm run smoke
```

---

## License

MIT © [Ahmed Ibrahim](https://github.com/AhmedIbrahim-tech)
