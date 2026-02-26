import jwt from "jsonwebtoken";
import dotenv from "dotenv";
dotenv.config();

import sendDataSessionId from "../functions/sendDataSessionId.js";
import sessionWatcher from "../functions/sessionWatcher.js";
import encryptData from "../helper/encyptJson.js";

async function handleDataSessionId(ws, req) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get("token");

  if (!token) {
    return closeConnection(ws, "Token is required");
  }

  let sessionId;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.expiredAt < Date.now()) {
      return closeConnection(ws, "Invalid or expired token");
    }
    sessionId = decoded.sessionId;
    sessionWatcher(sessionId);
  } catch (err) {
    return closeConnection(ws, "Invalid or expired token");
  }

  let data = null;

  const sendUpdatedData = async () => {
    const newData = await sendDataSessionId(sessionId);
    const newDataString = JSON.stringify(newData);

    if (newDataString !== data) {
      data = newDataString;
      const encryptedPayload = encryptData(newData);
      ws.send(JSON.stringify(encryptedPayload));
    }
  };

  sendUpdatedData();
  const interval = setInterval(sendUpdatedData, 1000);

  ws.on("close", () => clearInterval(interval));
}

function closeConnection(ws, message) {
  ws.send(JSON.stringify({ error: message }));
  ws.close();
}

export default handleDataSessionId;
