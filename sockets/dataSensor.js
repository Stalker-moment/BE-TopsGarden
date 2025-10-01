import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import sendSensor from "../functions/sendSensor.js";
import encryptData from "../helper/encyptJson.js";

dotenv.config();

// Set berisi semua koneksi aktif untuk channel sensor
const subscribers = new Set();
let isLoopRunning = false;
let lastPayloadString = null; // cache payload terenkripsi (string)

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
      }
    } catch (e) {
      console.error("[SensorWS] broadcast error:", e.message);
    }
    await new Promise(r => setTimeout(r, INTERVAL));
  }
  isLoopRunning = false;
}

async function handleDataSensorSocket(ws, req) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get("token");
  if (!token) {
    ws.send(JSON.stringify({ error: "Token is required" }));
    return ws.close();
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.expiredAt < Date.now()) {
      ws.send(JSON.stringify({ error: "Invalid or expired token" }));
      return ws.close();
    }
  } catch {
    ws.send(JSON.stringify({ error: "Invalid or expired token" }));
    return ws.close();
  }

  subscribers.add(ws);

  // Kirim snapshot awal jika sudah cache terenkripsi tersedia
  if (lastPayloadString) {
    try {
      const raw = JSON.parse(lastPayloadString);
      const encrypted = encryptData(raw);
      ws.send(JSON.stringify(encrypted));
    } catch {}
  } else {
    // Fetch sekali untuk klien baru jika belum ada cache (tidak menunggu interval)
    try {
      const raw = await sendSensor();
      lastPayloadString = JSON.stringify(raw);
      const encrypted = encryptData(raw);
      ws.send(JSON.stringify(encrypted));
    } catch (e) {
      console.error("[SensorWS] initial fetch error:", e.message);
    }
  }

  ws.on("close", () => {
    subscribers.delete(ws);
  });

  if (!isLoopRunning) broadcastLoop();
}

export default handleDataSensorSocket;