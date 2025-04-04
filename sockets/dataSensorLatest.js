import pkg from 'jsonwebtoken';
const { verify } = pkg;
import dotenv from "dotenv";
import sendSensorLatest from "../functions/sendSensorLatest.js";

dotenv.config();

async function handleDataSensorLatest(ws, req) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get("token");

    if (!token) {
        ws.send(JSON.stringify({ error: "Token is required" }));
        ws.close();
        return;
    }

    // Verify the token
    try {
        const decoded = verify(token, process.env.JWT_SECRET);

        if (decoded.expiredAt < Date.now()) {
            ws.send(JSON.stringify({ error: "Invalid or expired token" }));
            ws.close();
            return;
        }

        if (decoded.role !== "ADMIN") {
            ws.send(JSON.stringify({ error: "Unauthorized" }));
            ws.close();
            return;
        }
    } catch (err) {
        ws.send(JSON.stringify({ error: "Invalid or expired token" }));
        ws.close();
        return;
    }

    // Send the initial data
    let data = null;

    const sendUpdatedData = async () => {
        let newData = await sendSensorLatest();

        if (JSON.stringify(newData) !== data) {
            data = JSON.stringify(newData);
            ws.send(data);
        }
    };

    sendUpdatedData();
    const interval = setInterval(sendUpdatedData, 1000);

    ws.on("close", () => {
        clearInterval(interval);
    });
}

export default handleDataSensorLatest;