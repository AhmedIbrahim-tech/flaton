# Flatron

Flatron is a developer CLI for scaffolding production-ready **ASP.NET Core Clean Architecture** backends and modern frontends (**React with Next.js or Vite**, or **Angular**).

---

## Quick Start

Scaffold a new project in seconds:

```bash
npx flatron MyApp
```

Or install globally:

```bash
npm install -g flatron

flatron MyApp
```

---

## Project Modes

Flatron supports three project modes:

- **Full Stack**: Isolated backend (`Backend/`) and frontend (`Frontend/`) with a shared configuration manifest.
- **Backend Only**: ASP.NET Core Clean Architecture API directly at the project root.
- **Frontend Only**: Modern SPA / SSR application directly at the project root.

---

## What's Included

### Backend (.NET 10)
- **Clean Architecture**: Domain, Application, Infrastructure, and Presentation layers
- **Patterns**: CQRS + MediatR or Application Services
- **Data Access**: Entity Framework Core, Dapper, or Hybrid
- **Databases**: SQL Server, PostgreSQL, or SQLite
- **Security & Auth**: ASP.NET Core Identity with JWT or Cookies
- **Production Foundations**: FluentValidation, Serilog, Swagger, Health Checks, SignalR, Hangfire

### Frontend
- **Frameworks**: React (Next.js App Router / Vite SPA) or Angular
- **Languages**: TypeScript or JavaScript
- **Styling**: Tailwind CSS or Bootstrap
- **State**: Redux Toolkit, Zustand, or NgRx
- **UI Libraries**: shadcn/ui, MUI, Ant Design, or Angular Material
- **Tooling**: React Hook Form + Zod, Axios / Fetch API client, internationalization (i18n)

---

## Non-Interactive & CLI Flags

Skip prompts using `--yes` along with configuration flags:

```bash
# Full Stack (Recommended defaults)
npx flatron my-app --type fullstack --yes

# Backend Only with PostgreSQL
npx flatron my-api --type backend --db postgresql --auth jwt --yes

# Frontend Only (React + Vite + Tailwind)
npx flatron my-ui --type frontend --frontend react --frontend-tooling vite --styling tailwind --yes
```

### Common Flags

| Flag | Values / Options | Description |
| :--- | :--- | :--- |
| `--type` | `fullstack` \| `backend` \| `frontend` | Project creation mode |
| `--architecture` | `cqrs` \| `services` | Backend architecture pattern |
| `--orm` | `efcore` \| `dapper` \| `hybrid` | Data access / ORM |
| `--db` | `sqlserver` \| `postgresql` \| `sqlite` | Database provider |
| `--auth` | `jwt` \| `cookies` \| `none` | Authentication model |
| `--frontend` | `react` \| `angular` | Frontend framework |
| `--frontend-tooling` | `vite` \| `next` \| `angular-cli` | Frontend tooling |
| `-y, --yes` | _boolean_ | Non-interactive mode (uses defaults) |
| `-h, --help` | _boolean_ | Show help and options |

---

## Feature & Module Generators

Inside any generated project, use companion generators to scaffold features and modules:

```bash
# Generate end-to-end CRUD features
create-fullstack-feature Product --yes --field "Name:string:required" --field "Price:decimal:required"

# Add production modules (Auth, Users, Permissions, Audit, etc.)
create-fullstack-module auth --yes
create-fullstack-module users --yes
```

---

## Requirements

- **Node.js** ≥ 20
- **.NET SDK** ≥ 10.0 (for .NET backends)
- **Database Engine** (SQL Server, PostgreSQL, or SQLite)

---

## License

MIT © [Ahmed Ibrahim](https://github.com/AhmedIbrahim-tech)
