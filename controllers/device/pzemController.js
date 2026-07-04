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
        const device = await prisma.pzemDevice.findUnique({
            where: { id: deviceId },
            select: { shouldReset: true }
        });

        let command = "OK";
        let shouldReset = device?.shouldReset || false;

        if (shouldReset) {
            command = "RESET_ENERGY";
            
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
                command = "OK";
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
        
        const latest = await prisma.pzemLog.findFirst({
            where: { deviceId: id },
            orderBy: { createdAt: 'desc' }
        });

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

// 6. Chart Data (Live Trend - last 50 points)
router.get("/pzem/:id/chart", async (req, res) => {
    try {
        const logs = await prisma.pzemLog.findMany({
            where: { deviceId: req.params.id },
            orderBy: { createdAt: 'desc' },
            take: 50
        });
        res.json(logs.reverse());
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================================
// === FITUR BARU: DAILY / MONTHLY / YEARLY kWh USAGE ========
// ============================================================

/**
 * 7. Daily kWh Usage
 * GET /pzem/:id/daily-usage?year=2026&month=7
 * Mengembalikan array konsumsi harian berdasarkan snapshot midnight.
 * Jika bulan/tahun tidak diberikan, default bulan & tahun saat ini.
 */
router.get("/pzem/:id/daily-usage", async (req, res) => {
    try {
        const { id } = req.params;
        const now = new Date();
        const year = Number(req.query.year) || now.getFullYear();
        const month = Number(req.query.month) || (now.getMonth() + 1); // 1-based

        // Rentang: awal bulan s/d akhir bulan
        const startDate = new Date(year, month - 1, 1, 0, 0, 0, 0); // local midnight
        const endDate = new Date(year, month, 0, 23, 59, 59, 999); // last day of month

        const snapshots = await prisma.pzemDailySnapshot.findMany({
            where: {
                deviceId: id,
                date: { gte: startDate, lte: endDate },
            },
            orderBy: { date: 'asc' },
        });

        // Kalau belum ada snapshot (device baru atau bulan pertama), 
        // coba kalkulasi dari raw logs (fallback)
        const result = snapshots.map(s => ({
            date: s.date,
            dateLabel: new Date(s.date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' }),
            usageKwh: s.deltaKwh ?? 0,
            energyKwh: s.energyKwh,
            isResetDay: s.isResetDay,
        }));

        // Hitung total bulan ini & estimasi biaya
        const totalKwh = result.reduce((sum, d) => sum + (d.usageKwh || 0), 0);
        const PLN_RATE = Number(process.env.PLN_RATE_PER_KWH || 1444.70);
        const estimatedCost = totalKwh * PLN_RATE;

        res.json({
            year,
            month,
            totalKwh: parseFloat(totalKwh.toFixed(3)),
            estimatedCost: parseFloat(estimatedCost.toFixed(0)),
            plnRate: PLN_RATE,
            days: result,
        });
    } catch (error) {
        log.error("daily-usage error", error.message);
        res.status(500).json({ error: error.message });
    }
});

/**
 * 8. Monthly kWh Usage
 * GET /pzem/:id/monthly-usage?year=2026
 * Mengembalikan array konsumsi per bulan (12 bulan) dalam 1 tahun.
 */
router.get("/pzem/:id/monthly-usage", async (req, res) => {
    try {
        const { id } = req.params;
        const year = Number(req.query.year) || new Date().getFullYear();

        const startDate = new Date(year, 0, 1);    // Jan 1
        const endDate = new Date(year, 11, 31, 23, 59, 59); // Dec 31

        const snapshots = await prisma.pzemDailySnapshot.findMany({
            where: {
                deviceId: id,
                date: { gte: startDate, lte: endDate },
                deltaKwh: { not: null },
            },
            orderBy: { date: 'asc' },
        });

        // Aggregate per bulan
        const monthlyMap = {};
        for (let m = 1; m <= 12; m++) {
            monthlyMap[m] = { month: m, usageKwh: 0, hasResetDay: false, daysCount: 0 };
        }

        for (const snap of snapshots) {
            const m = new Date(snap.date).getMonth() + 1; // 1-based
            monthlyMap[m].usageKwh += snap.deltaKwh || 0;
            monthlyMap[m].daysCount += 1;
            if (snap.isResetDay) monthlyMap[m].hasResetDay = true;
        }

        const months = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Ags','Sep','Okt','Nov','Des'];
        const result = Object.values(monthlyMap).map(m => ({
            ...m,
            usageKwh: parseFloat(m.usageKwh.toFixed(3)),
            label: months[m.month - 1],
        }));

        const totalKwh = result.reduce((sum, m) => sum + m.usageKwh, 0);
        const PLN_RATE = Number(process.env.PLN_RATE_PER_KWH || 1444.70);

        res.json({
            year,
            totalKwh: parseFloat(totalKwh.toFixed(3)),
            estimatedCost: parseFloat((totalKwh * PLN_RATE).toFixed(0)),
            plnRate: PLN_RATE,
            months: result,
        });
    } catch (error) {
        log.error("monthly-usage error", error.message);
        res.status(500).json({ error: error.message });
    }
});

/**
 * 9. Yearly kWh Usage (5 tahun terakhir)
 * GET /pzem/:id/yearly-usage
 */
router.get("/pzem/:id/yearly-usage", async (req, res) => {
    try {
        const { id } = req.params;
        const currentYear = new Date().getFullYear();
        const startYear = currentYear - 4; // 5 tahun terakhir

        const startDate = new Date(startYear, 0, 1);
        const endDate = new Date(currentYear, 11, 31, 23, 59, 59);

        const snapshots = await prisma.pzemDailySnapshot.findMany({
            where: {
                deviceId: id,
                date: { gte: startDate, lte: endDate },
                deltaKwh: { not: null },
            },
            orderBy: { date: 'asc' },
        });

        // Aggregate per tahun
        const yearlyMap = {};
        for (let y = startYear; y <= currentYear; y++) {
            yearlyMap[y] = { year: y, usageKwh: 0, hasResetDay: false };
        }

        for (const snap of snapshots) {
            const y = new Date(snap.date).getFullYear();
            if (yearlyMap[y]) {
                yearlyMap[y].usageKwh += snap.deltaKwh || 0;
                if (snap.isResetDay) yearlyMap[y].hasResetDay = true;
            }
        }

        const result = Object.values(yearlyMap).map(y => ({
            ...y,
            usageKwh: parseFloat(y.usageKwh.toFixed(3)),
        }));

        const PLN_RATE = Number(process.env.PLN_RATE_PER_KWH || 1444.70);

        res.json({
            plnRate: PLN_RATE,
            years: result,
        });
    } catch (error) {
        log.error("yearly-usage error", error.message);
        res.status(500).json({ error: error.message });
    }
});

/**
 * 10. Power Outage Logs
 * GET /pzem/:id/outage-logs?limit=20&page=1
 */
router.get("/pzem/:id/outage-logs", async (req, res) => {
    try {
        const { id } = req.params;
        const limit = Number(req.query.limit) || 20;
        const page = Number(req.query.page) || 1;
        const skip = (page - 1) * limit;

        const [logs, total] = await Promise.all([
            prisma.powerOutageLog.findMany({
                where: { deviceId: id },
                orderBy: { startedAt: 'desc' },
                take: limit,
                skip,
            }),
            prisma.powerOutageLog.count({
                where: { deviceId: id },
            }),
        ]);

        // Format durasi yang lebih readable
        const formattedLogs = logs.map(l => ({
            ...l,
            durationFormatted: l.durationSec
                ? formatDuration(l.durationSec)
                : null,
            status: l.endedAt ? 'SELESAI' : 'BERLANGSUNG',
        }));

        res.json({
            total,
            page,
            limit,
            logs: formattedLogs,
        });
    } catch (error) {
        log.error("outage-logs error", error.message);
        res.status(500).json({ error: error.message });
    }
});

// Helper format durasi
function formatDuration(seconds) {
    if (seconds < 60) return `${seconds}d`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}d`;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}j ${m}m`;
}

export default router;