import { EventEmitter } from "events";

const LEVELS = {
  INFO: { label: "INFO", color: "\x1b[32m" },
  WARN: { label: "WARN", color: "\x1b[33m" },
  ERROR: { label: "ERROR", color: "\x1b[31m" },
  DEBUG: { label: "DEBUG", color: "\x1b[36m" },
};

const RESET = "\x1b[0m";
const RECENT_LOG_LIMIT = Number(process.env.LOG_STREAM_LIMIT || 200);
const logEmitter = new EventEmitter();
const recentLogs = [];

function formatTimestamp(date = new Date()) {
  return date.toISOString();
}

function stringifyMeta(meta) {
  if (!meta) return "";
  try {
    return typeof meta === "string" ? meta : JSON.stringify(meta);
  } catch {
    return String(meta);
  }
}

export function log(level, scope, message, meta) {
  const { label, color } = LEVELS[level] || LEVELS.INFO;
  const timestamp = formatTimestamp();
  const metaString = stringifyMeta(meta);
  const formatted = metaString ? `${message} | ${metaString}` : message;
  console.log(`${color}[${timestamp}] [${label}] [${scope}]${RESET} ${formatted}`);

  const entry = { timestamp, level: label, scope, message, meta };
  recentLogs.push(entry);
  if (recentLogs.length > RECENT_LOG_LIMIT) {
    recentLogs.shift();
  }
  logEmitter.emit("log", entry);
}

export function createLogger(scope = "APP") {
  return {
    info: (message, meta) => log("INFO", scope, message, meta),
    warn: (message, meta) => log("WARN", scope, message, meta),
    error: (message, meta) => log("ERROR", scope, message, meta),
    debug: (message, meta) => log("DEBUG", scope, message, meta),
  };
}

export const logger = createLogger();

export function getRecentLogs() {
  return [...recentLogs];
}

export { logEmitter };
