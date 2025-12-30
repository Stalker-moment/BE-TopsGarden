import express from "express";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import sendSensor from "../../functions/sendSensor.js";
import { createLogger } from "../../helper/logger.js";

dotenv.config();

const router = express.Router();
const log = createLogger("SensorHistoryAPI");
const HISTORY_MAX_RANGE_DAYS = Number(process.env.SENSOR_HISTORY_MAX_RANGE_DAYS || 30);

const parseDate = (value, label) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${label} tidak valid`);
  }
  return date;
};

const parseLimit = (value) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const limit = Number(value);
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error("limit harus berupa angka positif");
  }
  return limit;
};

const buildRange = (query) => {
  const { startDate, endDate, date } = query;
  let start;
  let end;

  if (date && !startDate && !endDate) {
    const target = parseDate(date, "date");
    start = new Date(target);
    start.setHours(0, 0, 0, 0);
    end = new Date(target);
    end.setHours(23, 59, 59, 999);
  } else {
    start = parseDate(startDate, "startDate");
    end = parseDate(endDate, "endDate");
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

  const limit = parseLimit(query.limit);

  return { start, end, limit };
};

router.use((req, res, next) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: "Token is required" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.expiredAt) {
      const expiry = typeof decoded.expiredAt === "number"
        ? decoded.expiredAt
        : new Date(decoded.expiredAt).getTime();
      if (Number.isFinite(expiry) && expiry < Date.now()) {
        return res.status(401).json({ message: "Invalid or expired token" });
      }
    }
    req.user = decoded;
    return next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
});

router.get("/history", async (req, res) => {
  let range;
  try {
    range = buildRange(req.query);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }

  try {
    const result = await sendSensor({
      startDate: range.start,
      endDate: range.end,
      limit: range.limit,
      forceFullTimestamp: true,
    });

    return res.status(200).json({
      message: "Sensor history fetched",
      range: {
        start: range.start.toISOString(),
        end: range.end.toISOString(),
      },
      limit: range.limit ?? null,
      total: result.history.temperature.value.length,
      data: result.history,
      latest: result.latest,
    });
  } catch (error) {
    const isValidationError = /invalid|Rentang/i.test(error.message ?? "");
    const status = isValidationError ? 400 : 500;
    const logMethod = status === 500 ? "error" : "warn";
    log[logMethod]("Gagal mengambil history sensor", error.message);
    return res.status(status).json({
      message: error.message || "Terjadi kesalahan server",
    });
  }
});

export default router;
