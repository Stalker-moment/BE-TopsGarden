import { prisma } from "../prisma/client.js";
import { createLogger } from "../helper/logger.js";

const buffer = [];
let flushing = false;

const MAX_BATCH = Number(process.env.PZEM_BATCH_MAX || 50);
const FLUSH_INTERVAL_MS = Number(process.env.PZEM_BATCH_INTERVAL_MS || 2000);
const log = createLogger("PzemBuffer");

export function addPzemLog(row) {
  buffer.push(row);
  if (buffer.length >= MAX_BATCH) {
    void flush();
  }
}

async function flush() {
  if (flushing || buffer.length === 0) return;
  flushing = true;
  const batch = buffer.splice(0, buffer.length);
  try {
    // pzemLog match the model name in schema (camelCase usually)
    // Actually the model name is PzemLog, prisma client uses lowerCamelCase: pzemLog
    await prisma.pzemLog.createMany({ data: batch });
    log.debug("Batch PZEM logs flushed", { size: batch.length });
  } catch (e) {
    log.error("Batch PZEM insert failed, fallback to individual", e.message);
    // Fallback: insert one by one
    for (const item of batch) {
      try { 
        await prisma.pzemLog.create({ data: item }); 
      } catch (inner) {
        log.error("Single PZEM insert failed", inner.message);
      }
    }
  } finally {
    flushing = false;
  }
}

setInterval(() => {
  void flush();
}, FLUSH_INTERVAL_MS);

// Ensure flush on exit
process.on('beforeExit', async () => { await flush(); });
process.on('SIGTERM', async () => { await flush(); });