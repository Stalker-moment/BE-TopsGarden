import express from "express";
import { prisma } from "../../prisma/client.js";
import { createLogger } from "../../helper/logger.js";
import { addUpsLog } from "../../ingestion/upsBuffer.js";

const router = express.Router();
const log = createLogger("UpsController");

// === DATA INGESTION (from ESP32 / Mock Client) ===
// Payload: { deviceId, cell1Voltage, cell2Voltage, cell3Voltage, totalVoltage, voltage12v, current12v, voltage5v, current5v, temperatures }
router.post("/ups/data", async (req, res) => {
    try {
        const { 
            deviceId, 
            cell1Voltage, 
            cell2Voltage, 
            cell3Voltage, 
            totalVoltage, 
            voltageIn,
            vIn,
            voltage12v, 
            current12v, 
            voltage5v, 
            current5v, 
            temperatures 
        } = req.body;

        // 1. Basic Validation
        if (!deviceId) return res.status(400).json({ error: "Device ID is required" });

        // Ensure the device exists (Plug-and-play auto registration)
        await prisma.upsDevice.upsert({
            where: { id: deviceId },
            update: {},
            create: {
                id: deviceId,
                name: `UPS Device (${deviceId.substring(0, 6).toUpperCase()})`,
                location: "Server Room"
            }
        });

        const safeC1 = parseFloat(cell1Voltage) || 0;
        const safeC2 = parseFloat(cell2Voltage) || 0;
        const safeC3 = parseFloat(cell3Voltage) || 0;
        const safeTotal = parseFloat(totalVoltage) || 0;
        const safeVIn = parseFloat(voltageIn !== undefined ? voltageIn : vIn) || 0;
        const safeV12 = parseFloat(voltage12v) || 0;
        const safeI12 = parseFloat(current12v) || 0;
        const safeV5 = parseFloat(voltage5v) || 0;
        const safeI5 = parseFloat(current5v) || 0;

        // Support detailed temperature map / structure
        let parsedTemps = {};
        if (temperatures && typeof temperatures === "object") {
            parsedTemps = temperatures;
        } else if (typeof temperatures === "number") {
            // Fallback if hardware sends only one temperature number
            parsedTemps = { system: temperatures };
        }

        // 2. Insert Log to Buffer (async batch insert)
        addUpsLog({
            deviceId,
            cell1Voltage: safeC1,
            cell2Voltage: safeC2,
            cell3Voltage: safeC3,
            totalVoltage: safeTotal,
            voltageIn: safeVIn,
            voltage12v: safeV12,
            current12v: safeI12,
            voltage5v: safeV5,
            current5v: safeI5,
            temperatures: parsedTemps,
            createdAt: new Date()
        });

        res.json({
            status: "success",
            message: "UPS telemetry log buffered successfully"
        });

    } catch (error) {
        log.error("UPS ingestion error", error.message);
        res.status(500).json({ error: "Internal Server Error", detail: error.message });
    }
});


// === DASHBOARD API ===

// 1. Get List Devices
router.get("/ups", async (req, res) => {
    try {
        const devices = await prisma.upsDevice.findMany({
            orderBy: { name: 'asc' }
        });
        res.json(devices);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 2. Register New Device
router.post("/ups", async (req, res) => {
    try {
        const { id, name, location, config } = req.body;
        if (!id) return res.status(400).json({ error: "Device ID is required" });
        
        const newDevice = await prisma.upsDevice.create({
            data: { 
                id,
                name: name || `UPS Device (${id.substring(0, 6).toUpperCase()})`, 
                location,
                ...(config && { config })
            }
        });
        res.json(newDevice);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// 3. Update Device
router.put("/ups/:id", async (req, res) => {
    try {
        const { name, location, isActive, config } = req.body;
        const updatedDevice = await prisma.upsDevice.update({
            where: { id: req.params.id },
            data: { 
                name, 
                location, 
                isActive,
                ...(config && { config })
            }
        });
        res.json(updatedDevice);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// 4. Delete Device
router.delete("/ups/:id", async (req, res) => {
    try {
        await prisma.upsDevice.delete({
            where: { id: req.params.id }
        });
        res.json({ message: "Device deleted successfully" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 5. Get Latest Data
router.get("/ups/:id/latest", async (req, res) => {
    try {
        const { id } = req.params;
        
        const latest = await prisma.upsLog.findFirst({
            where: { deviceId: id },
            orderBy: { createdAt: 'desc' }
        });

        let status = "OFFLINE";
        if (latest) {
            const timeDiff = (new Date().getTime() - new Date(latest.createdAt).getTime()) / 1000;
            if (timeDiff <= 15) { // Active in the last 15s
                status = "ONLINE";
            }
        }

        res.json({ 
            latest, 
            status 
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 6. Get Chart Data (last 50 logs, ordered oldest to newest)
router.get("/ups/:id/chart", async (req, res) => {
    try {
        const { id } = req.params;
        const logs = await prisma.upsLog.findMany({
            where: { deviceId: id },
            orderBy: { createdAt: 'desc' },
            take: 50
        });
        res.json(logs.reverse());
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 7. Get Recent Logs (last 20 logs)
router.get("/ups/:id/logs", async (req, res) => {
    try {
        const { id } = req.params;
        const logs = await prisma.upsLog.findMany({
            where: { deviceId: id },
            orderBy: { createdAt: 'desc' },
            take: 20
        });
        res.json(logs);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
