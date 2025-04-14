import jwt from "jsonwebtoken";
import dotenv from "dotenv";
dotenv.config();

import sendSensor from "../functions/sendSensor.js";
import encryptData from "../helper/encyptJson.js";

async function handleDataSensorSocket(ws, req) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get("token");

  if (!token) {
    return closeConnection(ws, "Token is required");
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.expiredAt < Date.now()) {
      return closeConnection(ws, "Invalid or expired token");
    }

  } catch (err) {
    return closeConnection(ws, "Invalid or expired token");
  }

  let data = null;

  const sendUpdatedData = async () => {
    const newData = await sendSensor();

    if (JSON.stringify(newData) !== data) {
      data = JSON.stringify(newData);
      //console.log("Data updated:", newData);
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

export default handleDataSensorSocket;