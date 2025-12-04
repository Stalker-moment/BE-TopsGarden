import { EventEmitter } from "events";

const LEVELS = {
  INFO: { label: "INFO", color: "\x1b[32m", hex: "#22c55e" },
  WARN: { label: "WARN", color: "\x1b[33m", hex: "#eab308" },
  ERROR: { label: "ERROR", color: "\x1b[31m", hex: "#ef4444" },
  DEBUG: { label: "DEBUG", color: "\x1b[36m", hex: "#06b6d4" },
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

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatMarkdownEntry({ timestamp, level, scope, message, meta }, hex) {
  const metaString = meta ? `\n\n<small><strong>meta:</strong> \`${escapeHtml(JSON.stringify(meta))}\`</small>` : "";
  const base = `**<span style=\"color:${hex}\">[${escapeHtml(level)}]</span>** \`${escapeHtml(timestamp)}\` **${escapeHtml(scope)}** - ${escapeHtml(message)}`;
  return `${base}${metaString}`;
}

export function log(level, scope, message, meta) {
  const { label, color, hex } = LEVELS[level] || LEVELS.INFO;
  const timestamp = formatTimestamp();
  const metaString = stringifyMeta(meta);
  const formatted = metaString ? `${message} | ${metaString}` : message;
  console.log(`${color}[${timestamp}] [${label}] [${scope}]${RESET} ${formatted}`);

  const entry = {
    timestamp,
    level: label,
    scope,
    message,
    meta,
    markdown: formatMarkdownEntry({ timestamp, level: label, scope, message, meta }, hex),
  };
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
