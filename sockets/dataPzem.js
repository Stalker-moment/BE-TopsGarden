import sendPzem from "../functions/sendPzem.js";
import { createLogger } from "../helper/logger.js";

const log = createLogger("SocketPzem");

const handleDataPzemSocket = (ws, req) => {
    // Auth logic here if needed (check token query param)
    
    log.info("Client connected to PZEM socket");

    const sendData = async () => {
        try {
            const data = await sendPzem();
            if (ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify(data));
            }
        } catch (error) {
            log.error("Error sending data", error);
        }
    };

    // Kirim data awal
    sendData();

    // Polling setiap 1 detik (sesuaikan interval jika perlu)
    const interval = setInterval(sendData, 1000);

    ws.on("close", () => {
        clearInterval(interval);
        log.info("Client disconnected from PZEM socket");
    });
    
    ws.on("error", (err) => {
        log.error("Socket error", err.message);
    });
};

export default handleDataPzemSocket;
