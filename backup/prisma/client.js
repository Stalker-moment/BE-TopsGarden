import { PrismaClient } from "@prisma/client";

// Gunakan global agar di development hot-reload tidak membuat banyak instance
const globalForPrisma = globalThis;

export const prisma = globalForPrisma.prisma || new PrismaClient({
  // log: ['query','error','warn'] // aktifkan saat debugging
});

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
