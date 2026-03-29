# Seal

Informal contract creation and execution.

## Overview

Seal is a TypeScript microservices backend for artisan-client jobs with escrow-backed payments, dispute handling, reputation scoring, notifications, and USSD support.

Services:

- `gateway` (API entry + auth)
- `user-service`
- `job-service`
- `payment-service`
- `escrow-service`
- `dispute-service`
- `reputation-service`
- `scheduler-service`
- `notification-service`
- `ussd-service`

Shared packages:

- `@seal/config`
- `@seal/contracts`
- `@seal/db`
- `@seal/events`
- `@seal/auth`
- `@seal/shared`

## Prerequisites

- Node.js 20+
- npm 10+
- Docker (for Postgres + Redis)

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Start infrastructure:

```bash
docker compose up -d
```

3. Ensure local environment file exists (already included by default in this workspace):

```bash
cp .env.example .env
```

4. Generate Prisma client and apply schema:

```bash
npm run prisma:generate
npm run prisma:push
```

5. Start all services:

```bash
npm run start:all
```

## Useful Commands

```bash
npm run check           # Type check
npm run build           # Compile TypeScript
npm run prisma:validate # Validate schema via: npx prisma validate
```

Run one service in watch mode:

```bash
npm run dev:gateway
```

Health check example:

```bash
curl http://localhost:3000/health
```

## Data Model

Core database schema lives in `prisma/schema.prisma` and includes:

- Users and roles
- Jobs and milestones
- Escrow ledger
- Payments
- Disputes
- Reputation snapshots
- Notifications

## Notes

- `payment-service` currently simulates M-Pesa flows for development.
- JWT keys are generated in-memory if not supplied through environment variables.
- Event-driven communication is backed by Redis streams.
