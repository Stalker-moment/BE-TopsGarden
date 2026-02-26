import pkg from 'jsonwebtoken';
const { verify } = pkg;
import dotenv from "dotenv";
dotenv.config();

import sendSystemLatest from '../functions/sendSystemLatest.js';

async function handleDataSystemLatest(ws, req) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get("token");

    if(!token) {
        ws.send(JSON.stringify({ error: "Token is required" }));
        ws.close();
        return;
    }

    // Verify the token
    try {
        const decoded = verify(token, process.env.JWT_SECRET);
        //console.log(decoded);

        if(decoded.expiredAt < Date.now()) {
            ws.send(JSON.stringify({ error: "Invalid or expired token" }));
            ws.close();
            return;
        }

        var sessionId = decoded.sessionId;
        var userId = decoded.id;

        const session = sendSystemLatest();

    } catch(err) {
        ws.send(JSON.stringify({ error: "Invalid or expired token" }));
        console.log(err);
        ws.close();
        return;
    }

    let data = null;

    const sendUpdatedData = async () => {
        let newData = await sendSystemLatest();

        if(JSON.stringify(newData) !== data) {
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

export default handleDataSystemLatest;