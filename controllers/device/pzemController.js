import express from "express";
import { prisma } from "../../prisma/client.js";
import { createLogger } from "../../helper/logger.js";
import { addPzemLog } from "../../ingestion/pzemBuffer.js";

const router = express.Router();
const log = createLogger("PzemController");

// === DATA INGESTION (from ESP32) ===
// Payload: { deviceId, voltage, current, power, energy, frequency, pf }
router.post("/pzem/data", async (req, res) => {
    try {
        const { deviceId, voltage, current, power, energy, frequency, pf } = req.body;

        // 1. Basic Validation
        if (!deviceId) return res.status(400).json({ error: "Device ID required" });

        // 2. Insert Log to Buffer (async)
        addPzemLog({
            deviceId,
            voltage: Number(voltage),
            current: Number(current),
            power: Number(power),
            energy: Number(energy),
            frequency: Number(frequency),
            pf: Number(pf),
            createdAt: new Date()
        });

        // 3. Logic Reset Energy
        // Ambil status device saat ini
        const device = await prisma.pzemDevice.findUnique({
            where: { id: deviceId },
            select: { shouldReset: true }
        });

        let command = "OK";
        let shouldReset = device?.shouldReset || false;

        if (shouldReset) {
            command = "RESET_ENERGY";
            
            // Logika auto-clear flag:
            // Jika energi yang dikirim sensor sudah mendekati 0 (misal < 0.1 kWh), 
            // tandanya reset berhasil dilakukan di alat.
            if (Number(energy) < 0.1) {
                await prisma.pzemDevice.update({
                    where: { id: deviceId },
                    data: { 
                        shouldReset: false, 
                        lastResetAt: new Date() 
                    }
                });
                log.info(`Energy reset confirmed for device ${deviceId}`);
                command = "OK"; // Sudah beres, tidak perlu kirim perintah lagi
            }
        }

        // 4. Return Response (Command ke ESP32)
        res.json({
            status: "success",
            command: command // ESP32 baca ini: jika "RESET_ENERGY" -> eksekusi reset kwh
        });

    } catch (error) {
        log.error("PZEM ingestion error", error.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
});


// === DASHBOARD API ===

// 1. Get List Devices
router.get("/pzem", async (req, res) => {
    try {
        const devices = await prisma.pzemDevice.findMany({
            orderBy: { name: 'asc' }
        });
        res.json(devices);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 2. Register New Device
router.post("/pzem", async (req, res) => {
    try {
        const { name, location } = req.body;
        const newDevice = await prisma.pzemDevice.create({
            data: { name, location }
        });
        res.json(newDevice);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// 2b. Update Device (Edit name/location)
router.put("/pzem/:id", async (req, res) => {
    try {
        const { name, location, isActive } = req.body;
        const updatedDevice = await prisma.pzemDevice.update({
            where: { id: req.params.id },
            data: { name, location, isActive }
        });
        res.json(updatedDevice);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// 2c. Delete Device
router.delete("/pzem/:id", async (req, res) => {
    try {
        await prisma.pzemDevice.delete({
            where: { id: req.params.id }
        });
        res.json({ message: "Device deleted successfully" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 3. Get Latest Data & Stats (Card Dashboard)
router.get("/pzem/:id/latest", async (req, res) => {
    try {
        const { id } = req.params;
        
        // Ambil log terakhir
        const latest = await prisma.pzemLog.findFirst({
            where: { deviceId: id },
            orderBy: { createdAt: 'desc' }
        });

        // Hitung total energi bulan ini (opsional, jika energy di alat direset tiap bulan, 
        // nilai 'latest.energy' sudah merepresentasikan penggunaan bulan ini).
        // Tapi jika tidak reset, kita perlu query min/max.
        // Asumsi: Fitur reset bulanan aktif, jadi 'latest.energy' adalah Consumption Month-to-Date.

        res.json({ 
            latest, 
            status: latest ? "ONLINE" : "OFFLINE" 
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 4. Manual Reset Trigger (Tombol di UI)
router.post("/pzem/:id/reset-command", async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.pzemDevice.update({
            where: { id },
            data: { shouldReset: true }
        });
        
        log.info(`User requested energy reset for device ${id}`);
        res.json({ message: "Reset command queued. Device will reset on next connection." });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 5. Historical Logs (Table)
router.get("/pzem/:id/logs", async (req, res) => {
    try {
        const limit = Number(req.query.limit) || 20;
        const logs = await prisma.pzemLog.findMany({
            where: { deviceId: req.params.id },
            orderBy: { createdAt: 'desc' },
            take: limit
        });
        res.json(logs);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 6. Chart Data (Daily / Monthly)
router.get("/pzem/:id/chart", async (req, res) => {
    // Implementasi sederhana: ambil data raw terakhir dlm periode tertentu
    // Untuk visualisasi grafik "Live Load Trend"
    try {
        const logs = await prisma.pzemLog.findMany({
            where: { deviceId: req.params.id },
            orderBy: { createdAt: 'desc' },
            take: 50 // Ambil 50 data terakhir untuk grafik real-time
        });
        // Reverse agar urutan waktu dari kiri ke kanan (lama -> baru)
        res.json(logs.reverse());
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default router;