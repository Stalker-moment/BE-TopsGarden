import sendUps from "../functions/sendUps.js";
import { createLogger } from "../helper/logger.js";

const log = createLogger("SocketUps");

const handleDataUpsSocket = (ws, req) => {
    log.info("Client connected to UPS socket");

    const sendData = async () => {
        try {
            const data = await sendUps();
            if (ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify(data));
            }
        } catch (error) {
            log.error("Error sending UPS WS data", error);
        }
    };

    // Kirim data awal
    sendData();

    // Polling setiap 1 detik
    const interval = setInterval(sendData, 1000);

    ws.on("close", () => {
        clearInterval(interval);
        log.info("Client disconnected from UPS socket");
    });
    
    ws.on("error", (err) => {
        log.error("UPS Socket error", err.message);
    });
};

export default handleDataUpsSocket;
