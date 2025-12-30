import dotenv from "dotenv";
import { prisma } from "../prisma/client.js";
import { createLogger } from "../helper/logger.js";

dotenv.config();

const log = createLogger("SendSensor");
const DEFAULT_RECENT_LIMIT = Number(process.env.SENSOR_RECENT_LIMIT || 10);
const HISTORY_DEFAULT_LIMIT = Number(process.env.SENSOR_HISTORY_DEFAULT_LIMIT || 288);
const HISTORY_MAX_LIMIT = Number(process.env.SENSOR_HISTORY_MAX_LIMIT || 2000);

const emptyHistory = () => ({
  voltage: { value: [], timestamp: [] },
  ph: { value: [], timestamp: [] },
  temperature: { value: [], timestamp: [] },
  humidity: { value: [], timestamp: [] },
  ldr: { value: [], timestamp: [] },
});

const formatClock = (date) =>
  date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

const formatIso = (date) => date.toISOString();

const normalizeDate = (value, label) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${label} is invalid`);
  }
  return date;
};

function enforceHistoryLimit(requested, hasRange) {
  if (!hasRange) {
    return DEFAULT_RECENT_LIMIT;
  }

  if (requested && requested > 0) {
    return Math.min(Math.floor(requested), HISTORY_MAX_LIMIT);
  }

  return HISTORY_DEFAULT_LIMIT;
}

function buildHistory(rows, formatter) {
  if (rows.length === 0) {
    return emptyHistory();
  }

  return {
    voltage: {
      value: rows.map((s) => s.voltage),
      timestamp: rows.map((s) => formatter(s.updatedAt)),
    },
    ph: {
      value: rows.map((s) => s.ph),
      timestamp: rows.map((s) => formatter(s.updatedAt)),
    },
    temperature: {
      value: rows.map((s) => s.temperature),
      timestamp: rows.map((s) => formatter(s.updatedAt)),
    },
    humidity: {
      value: rows.map((s) => s.humidity),
      timestamp: rows.map((s) => formatter(s.updatedAt)),
    },
    ldr: {
      value: rows.map((s) => s.ldr),
      timestamp: rows.map((s) => formatter(s.updatedAt)),
    },
  };
}

function formatLatest(row) {
  if (!row) return null;
  return {
    voltage: row.voltage,
    ph: row.ph,
    temperature: row.temperature,
    humidity: row.humidity,
    ldr: row.ldr,
    updatedAt: formatClock(row.updatedAt),
  };
}

async function sendSensor(options = {}) {
  try {
    const { startDate, endDate, limit, forceFullTimestamp = false } = options;
    const start = normalizeDate(startDate, "startDate");
    const end = normalizeDate(endDate, "endDate");
    const hasRange = Boolean(start || end);

    const where = start || end ? { createdAt: {} } : undefined;
    if (where) {
      if (start) where.createdAt.gte = start;
      if (end) where.createdAt.lte = end;
    }

    const take = enforceHistoryLimit(limit, hasRange);
    const shouldCountAll = hasRange && !limit;

    if (shouldCountAll) {
      const total = await prisma.sensor.count({ where });
      if (total > HISTORY_MAX_LIMIT) {
        throw new Error(
          `Rentang data terlalu besar (${total}). Batas maksimum ${HISTORY_MAX_LIMIT} data. Tambahkan limit atau persempit rentang.`
        );
      }
    }

    const orderDirection = hasRange && !limit ? "asc" : "desc";
    const query = {
      orderBy: { createdAt: orderDirection },
    };

    if (where) {
      query.where = where;
    }

    if (!shouldCountAll || !hasRange) {
      query.take = take;
    }

    const sensors = await prisma.sensor.findMany(query);

    if (sensors.length === 0) {
      return { latest: null, history: emptyHistory() };
    }

    const timeline = orderDirection === "desc" ? [...sensors].reverse() : sensors;
    const latestRow = timeline[timeline.length - 1];
    const timestampFormatter = forceFullTimestamp || hasRange ? formatIso : formatClock;

    return {
      latest: formatLatest(latestRow),
      history: buildHistory(timeline, timestampFormatter),
    };
  } catch (error) {
    log.error("Error fetching sensors", error.message);
    throw error;
  }
}

export default sendSensor;