import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import sendSensor from "../functions/sendSensor.js";
import encryptData from "../helper/encyptJson.js";
import { createLogger } from "../helper/logger.js";

dotenv.config();

// Set berisi semua koneksi aktif untuk channel sensor
const subscribers = new Set();
let isLoopRunning = false;
let lastPayloadString = null; // cache payload terenkripsi (string)
const log = createLogger("SensorSocket");

async function broadcastLoop() {
  if (isLoopRunning) return;
  isLoopRunning = true;
  const INTERVAL = Number(process.env.SENSOR_PUSH_INTERVAL_MS || 2000);
  while (subscribers.size > 0) {
    try {
      const raw = await sendSensor();
      const rawString = JSON.stringify(raw);
      if (rawString !== lastPayloadString) {
        const encrypted = encryptData(raw);
        const out = JSON.stringify(encrypted);
        lastPayloadString = rawString; // simpan versi asli untuk diff sederhana
        for (const ws of [...subscribers]) {
          if (ws.readyState === 1) {
            ws.send(out);
          } else {
            subscribers.delete(ws);
          }
        }
        log.debug("Broadcast sensor data", { subscribers: subscribers.size });
      }
    } catch (e) {
      log.error("Broadcast loop error", e.message);
    }
    await new Promise(r => setTimeout(r, INTERVAL));
  }
  isLoopRunning = false;
}

async function handleDataSensorSocket(ws, req) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get("token");
  if (!token) {
    log.warn("Client tanpa token mencoba terhubung");
    ws.send(JSON.stringify({ error: "Token is required" }));
    return ws.close();
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.expiredAt < Date.now()) {
      log.warn("Token kedaluwarsa", { accountId: decoded.accountId });
      ws.send(JSON.stringify({ error: "Invalid or expired token" }));
      return ws.close();
    }
  } catch (e) {
    log.warn("Token tidak valid", e.message);
    ws.send(JSON.stringify({ error: "Invalid or expired token" }));
    return ws.close();
  }

  subscribers.add(ws);
  log.info("Client terhubung", { totalSubscribers: subscribers.size });

  // Kirim snapshot awal jika sudah cache terenkripsi tersedia
  if (lastPayloadString) {
    try {
      const raw = JSON.parse(lastPayloadString);
      const encrypted = encryptData(raw);
      ws.send(JSON.stringify(encrypted));
    } catch (e) {
      log.warn("Gagal parsing cache awal", e.message);
    }
  } else {
    // Fetch sekali untuk klien baru jika belum ada cache (tidak menunggu interval)
    try {
      const raw = await sendSensor();
      lastPayloadString = JSON.stringify(raw);
      const encrypted = encryptData(raw);
      ws.send(JSON.stringify(encrypted));
    } catch (e) {
      log.error("Initial fetch error", e.message);
    }
  }

  ws.on("close", () => {
    subscribers.delete(ws);
    log.info("Client terputus", { totalSubscribers: subscribers.size });
  });

  if (!isLoopRunning) broadcastLoop();
}

export default handleDataSensorSocket;