<p align="center">
  <img src="hero.png" alt="Flatron" width="220" />
</p>

<h1 align="center">Flatron</h1>

<p align="center">
  Build full-stack, backend, and frontend applications from one CLI.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/flatron"><img src="https://img.shields.io/npm/v/flatron.svg?style=flat&color=7c3aed" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/flatron"><img src="https://img.shields.io/npm/dm/flatron.svg?style=flat&color=7c3aed" alt="npm downloads" /></a>
  <a href="https://github.com/AhmedIbrahim-tech/flatron/stargazers"><img src="https://img.shields.io/github/stars/AhmedIbrahim-tech/flatron?style=flat&color=7c3aed" alt="GitHub stars" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-7c3aed.svg?style=flat" alt="license" /></a>
</p>

---

## Quick Start

Create a new project instantly with the interactive wizard:

```bash
npx flatron MyApp
```

Or install globally:

```bash
npm install -g flatron
flatron MyApp
```

---

## Features

- **Clean Architecture by Default**: Modular domain, application, infrastructure, and presentation layers.
- **Full Stack Flexibility**: Scaffold full-stack apps, standalone APIs, or modern frontend clients.
- **Modern Ecosystem**: ASP.NET Core, React (Next.js / Vite), Angular, Tailwind CSS, EF Core, and more.
- **Fast & Interactive**: Guided interactive prompts with support for one-line non-interactive flags (`--yes`).

---

## What Can Flatron Create?

| Mode | Description | Key Technologies |
| :--- | :--- | :--- |
| **Full Stack** | Unified solution with separated `Backend/` and `Frontend/` workspaces | .NET 10 + React / Angular |
| **Backend Only** | ASP.NET Core Clean Architecture API with CQRS or Service patterns | EF Core, Dapper, SQL Server, PostgreSQL, SQLite, JWT Auth |
| **Frontend Only** | Modern SPA or SSR web application ready for production | Next.js, Vite (React), Angular, Tailwind CSS, shadcn/ui |

---

## CLI Usage

Run the generator with custom options or skip prompts entirely:

```bash
# Interactive mode
npx flatron my-app

# Non-interactive with recommended defaults
npx flatron my-app --yes

# Backend-only API with PostgreSQL and JWT auth
npx flatron my-api --type backend --db postgresql --auth jwt --yes

# Frontend-only app with React, Vite, and Tailwind
npx flatron my-ui --type frontend --frontend react --frontend-tooling vite --styling tailwind --yes
```

To see all available flags and options:

```bash
npx flatron --help
```

---

## Requirements

- **Node.js** ≥ 20
- **.NET SDK** ≥ 10.0 *(for .NET backend projects)*

---

## License

[MIT](LICENSE) © [Ahmed Ibrahim](https://github.com/AhmedIbrahim-tech)
