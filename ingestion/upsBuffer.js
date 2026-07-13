import { prisma } from "../prisma/client.js";
import { createLogger } from "../helper/logger.js";

const buffer = [];
let flushing = false;

const MAX_BATCH = Number(process.env.UPS_BATCH_MAX || 50);
const FLUSH_INTERVAL_MS = Number(process.env.UPS_BATCH_INTERVAL_MS || 2000);
const log = createLogger("UpsBuffer");

export function addUpsLog(row) {
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
    await prisma.upsLog.createMany({ data: batch });
    log.debug("Batch UPS logs flushed", { size: batch.length });
  } catch (e) {
    log.error("Batch UPS insert failed, fallback to individual", e.message);
    // Fallback: insert one by one
    for (const item of batch) {
      try { 
        await prisma.upsLog.create({ data: item }); 
      } catch (inner) {
        log.error("Single UPS insert failed", inner.message);
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
