import express from "express";
import dotenv from "dotenv";
import { addSensor } from "../../ingestion/sensorBuffer.js";
import { createLogger } from "../../helper/logger.js";

dotenv.config();

const router = express.Router();
const log = createLogger("DeviceSensorController");

router.get("/sensor/:voltage/:ph/:temp/:humi/:ldr", async (req, res) => {
    // Gunakan let karena akan normalisasi jika NaN
    let voltage = parseFloat(req.params.voltage);
    let ph = parseFloat(req.params.ph);
    let temp = parseFloat(req.params.temp);
    let humi = parseFloat(req.params.humi);
    let ldr = parseInt(req.params.ldr);
    
    try {
        if (isNaN(voltage)) voltage = 0;
        if (isNaN(ph)) ph = 0;
        if (isNaN(temp)) temp = 0;
        if (isNaN(humi)) humi = 0;
        if (isNaN(ldr)) ldr = 0;

        // convert ldr to boolean (if 0 then true else false)
        const ldrBool = (ldr === 0);

        // Masukkan ke buffer (akan di-flush batch)
        addSensor({
            voltage,
            ph,
            temperature: temp,
            humidity: humi,
            ldr: ldrBool,
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        log.debug("Sensor buffered", { voltage, ph, temperature: temp, humidity: humi, ldr: ldrBool });
    
        res.status(200).json({ message: "Sensor data received successfully", data: { voltage, ph, temp, humi, ldr: ldrBool } });
    } catch (error) {
        log.error("Sensor ingestion error", error.message);
        res.status(500).json({ message: "Internal Server Error" });
    }
});

export default router;