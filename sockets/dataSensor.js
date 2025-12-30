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
const HISTORY_EVENTS = Object.freeze({
  REQUEST: "historyRequest",
  RESPONSE: "historyResponse",
  ERROR: "historyError",
});
const HISTORY_MAX_RANGE_DAYS = Number(process.env.SENSOR_HISTORY_MAX_RANGE_DAYS || 30);
const HISTORY_MAX_LIMIT = Number(process.env.SENSOR_HISTORY_MAX_LIMIT || 2000);

const sendEncrypted = (ws, payload) => {
  if (ws.readyState !== 1) return;
  ws.send(JSON.stringify(encryptData(payload)));
};

const parseDateInput = (value, label) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${label} tidak valid`);
  }
  return date;
};

const sanitizeHistoryPayload = (payload) => {
  if (!payload || typeof payload !== "object") {
    throw new Error("Payload history tidak valid");
  }

  const { startDate, endDate, date } = payload;
  let start = null;
  let end = null;

  if (date && !startDate && !endDate) {
    const target = parseDateInput(date, "date");
    start = new Date(target);
    start.setHours(0, 0, 0, 0);
    end = new Date(target);
    end.setHours(23, 59, 59, 999);
  } else {
    start = parseDateInput(startDate, "startDate");
    end = parseDateInput(endDate, "endDate");
  }

  if (!start || !end) {
    throw new Error("startDate & endDate wajib diisi atau gunakan parameter date");
  }

  if (start > end) {
    throw new Error("startDate harus lebih kecil dari endDate");
  }

  const diffDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
  if (diffDays > HISTORY_MAX_RANGE_DAYS) {
    throw new Error(`Rentang maksimal ${HISTORY_MAX_RANGE_DAYS} hari`);
  }

  let limit = null;
  if (payload.limit !== undefined && payload.limit !== null) {
    const requestedLimit = Number(payload.limit);
    if (!Number.isFinite(requestedLimit) || requestedLimit <= 0) {
      throw new Error("limit harus berupa angka positif");
    }
    limit = Math.min(Math.floor(requestedLimit), HISTORY_MAX_LIMIT);
  }

  return { start, end, limit };
};

const handleHistoryRequest = async (ws, payload) => {
  const requestId = payload.requestId ?? null;
  try {
    const { start, end, limit } = sanitizeHistoryPayload(payload);
    log.info("History sensor diminta", {
      requestId,
      start: start.toISOString(),
      end: end.toISOString(),
      limit,
    });
    const result = await sendSensor({
      startDate: start,
      endDate: end,
      limit,
      forceFullTimestamp: true,
    });

    sendEncrypted(ws, {
      type: HISTORY_EVENTS.RESPONSE,
      requestId,
      range: {
        start: start.toISOString(),
        end: end.toISOString(),
      },
      limit,
      total: result.history.temperature.value.length,
      history: result.history,
      latest: result.latest,
    });
  } catch (error) {
    log.warn("History sensor gagal", { requestId, error: error.message });
    sendEncrypted(ws, {
      type: HISTORY_EVENTS.ERROR,
      requestId,
      message: error.message,
    });
  }
};

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

  ws.on("message", (raw) => {
    let parsed;
    try {
      parsed = JSON.parse(raw.toString());
    } catch (e) {
      log.warn("Pesan websocket invalid", e.message);
      return sendEncrypted(ws, {
        type: HISTORY_EVENTS.ERROR,
        message: "Format pesan harus JSON",
      });
    }

    if (parsed?.type !== HISTORY_EVENTS.REQUEST) {
      return;
    }

    void handleHistoryRequest(ws, parsed);
  });

  if (!isLoopRunning) broadcastLoop();
}

export default handleDataSensorSocket;