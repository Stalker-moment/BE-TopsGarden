import jwt from "jsonwebtoken";
import dotenv from "dotenv";
dotenv.config();

import sendSession from "../functions/sendSession.js";
import sessionWatcher from "../functions/sessionWatcher.js";
import encryptData from "../helper/encyptJson.js";

async function handleDataSessionAccount(ws, req) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get("token");

  if (!token) {
    ws.send(JSON.stringify({ error: "Token is required" }));
    ws.close();
    return;
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.expiredAt < Date.now()) {
      throw new Error("Invalid or expired token");
    }

    const { sessionId, id: userId } = decoded;
    sessionWatcher(sessionId);

    let data = null;

    const sendUpdatedData = async () => {
      const newData = await sendSession(userId, sessionId);

      if (JSON.stringify(newData) !== data) {
        data = JSON.stringify(newData);
        const encryptedPayload = encryptData(newData);
        ws.send(JSON.stringify(encryptedPayload));
      }
    };

    sendUpdatedData();
    const interval = setInterval(sendUpdatedData, 1000);

    ws.on("close", () => clearInterval(interval));
  } catch (err) {
    ws.send(JSON.stringify({ error: err.message }));
    ws.close();
  }
}

export default handleDataSessionAccount;