import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { logEmitter, getRecentLogs, createLogger } from "../helper/logger.js";

dotenv.config();

const log = createLogger("LogSocket");

function authenticate(ws, req) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get("token");

  if (!token) {
    ws.send(JSON.stringify({ error: "Token is required" }));
    ws.close();
    return null;
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.expiredAt < Date.now()) {
      ws.send(JSON.stringify({ error: "Invalid or expired token" }));
      ws.close();
      return null;
    }
    return decoded;
  } catch (error) {
    log.warn("Token log socket tidak valid", error.message);
    ws.send(JSON.stringify({ error: "Invalid or expired token" }));
    ws.close();
    return null;
  }
}

function sendSnapshot(ws) {
  const logs = getRecentLogs();
  ws.send(JSON.stringify({ type: "snapshot", logs }));
}

function handleDataLogsSocket(ws, req) {
  const decoded = authenticate(ws, req);
  if (!decoded) return;

  log.info("Client log terhubung", { accountId: decoded.accountId });
  sendSnapshot(ws);

  const listener = (entry) => {
    try {
      ws.send(JSON.stringify({ type: "log", data: entry }));
    } catch (error) {
      log.warn("Gagal mengirim log ke client", error.message);
    }
  };

  logEmitter.on("log", listener);

  ws.on("close", () => {
    logEmitter.off("log", listener);
    log.info("Client log terputus", { accountId: decoded.accountId });
  });
}

export default handleDataLogsSocket;
