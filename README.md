# ClinQ

ClinQ is an AI-assisted health workspace for understanding diagnostic reports, tracking health signals, and preparing questions for a clinician. The current interface includes sample data and a local chat interaction; it is educational and does not provide medical diagnosis.
## Requirements

- Node.js LTS
- PostgreSQL 14 or newer

## Local setup

1. Create a PostgreSQL database named `clinq_db` in pgAdmin.
2. Copy `.env.example` to `.env`.
3. Replace `your_password` in `DATABASE_URL` with the password created during PostgreSQL installation.
4. Run the schema from pgAdmin's Query Tool using `database/schema.sql`.
5. Install dependencies with `npm install`.
6. Start the frontend and API in separate terminals:

```powershell
npm run dev
npm run server
```

The frontend runs at `http://localhost:5173` and the API runs at `http://localhost:3001`. Check the database connection at `http://localhost:3001/api/health`.

For both processes in one terminal, use `npm run dev:full`.

## Available API

- `GET /api/health` checks the PostgreSQL connection.
- `GET /api/reports` returns stored report records.
The next backend step is authenticated report upload and AI analysis processing. Do not use real patient data in this prototype until authentication, authorization, audit logging, encrypted storage, and clinical safety review are implemented.
# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
