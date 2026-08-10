import { PrismaClient } from '@prisma/client';

/**
 * Prisma singleton. Next.js dev mode re-evaluates modules on every hot reload,
 * which without this would open a new connection pool each time until Postgres
 * refuses connections.
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db;
}
