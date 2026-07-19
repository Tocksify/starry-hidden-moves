# fog.chess

A hidden-piece chess variant where players set up their army in secret before the game begins. Built with React 19, TanStack Start (SSR), Supabase for auth/realtime, and shadcn/ui components. Originally developed on Lovable.dev.

## Running the app

```bash
bun run dev
```

The dev server runs on port 5000. The workflow "Start application" handles this automatically.

## Stack

- **Framework**: React 19 + TanStack Start (SSR/routing)
- **Build**: Vite 8 via `@lovable.dev/vite-tanstack-config`
- **Styling**: Tailwind CSS v4 + shadcn/ui (Radix UI)
- **Auth/DB**: Supabase (credentials in `.env`)
- **Chess logic**: chess.js
- **Package manager**: Bun

## Key directories

- `src/routes/` — file-based routes (TanStack Router)
- `src/components/` — ChessBoard and shadcn/ui components
- `src/lib/` — chess engine, AI, piece definitions, sounds
- `src/integrations/supabase/` — Supabase client, auth middleware
- `supabase/migrations/` — database schema

## Environment

Supabase credentials are stored in `.env` and are already configured for the project's Supabase instance.

## User preferences

_None recorded yet._
