import { prisma } from "../prisma/client.js";

const buffer = [];
let flushing = false;

const MAX_BATCH = Number(process.env.SENSOR_BATCH_MAX || 100);
const FLUSH_INTERVAL_MS = Number(process.env.SENSOR_BATCH_INTERVAL_MS || 1000);

export function addSensor(row) {
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
    await prisma.sensor.createMany({ data: batch });
  } catch (e) {
    console.error("[SensorBuffer] Batch insert failed, fallback to individual", e.message);
    // Fallback optional: coba insert satu per satu agar data tidak hilang
    for (const item of batch) {
      try { await prisma.sensor.create({ data: item }); } catch (inner) { console.error("[SensorBuffer] Single insert failed", inner.message); }
    }
  } finally {
    flushing = false;
  }
}

setInterval(() => {
  void flush();
}, FLUSH_INTERVAL_MS);

process.on('beforeExit', async () => { await flush(); });
process.on('SIGTERM', async () => { await flush(); });
