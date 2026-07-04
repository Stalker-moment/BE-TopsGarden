import express from "express";
import si from "systeminformation";
import { createLogger } from "../../helper/logger.js";

const router = express.Router();
const log = createLogger("ServerBattery");

/**
 * GET /api/device/server-battery
 * Mengembalikan status baterai laptop server menggunakan systeminformation.
 * Hanya bekerja jika server berjalan di laptop dengan baterai.
 */
router.get("/server-battery", async (req, res) => {
    try {
        const batteryInfo = await si.battery();

        if (!batteryInfo.hasBattery) {
            return res.json({
                hasBattery: false,
                message: "Server tidak memiliki baterai (mungkin berjalan di PC/Server tanpa baterai)",
            });
        }

        // Ambil juga info sistem dasar
        const [cpuTemp, mem] = await Promise.all([
            si.cpuTemperature().catch(() => null),
            si.mem().catch(() => null),
        ]);

        const memUsedPercent = mem
            ? parseFloat(((mem.active / mem.total) * 100).toFixed(1))
            : null;

        const cpuTempMax = cpuTemp
            ? (cpuTemp.max || cpuTemp.main || null)
            : null;

        return res.json({
            hasBattery: true,
            percent: batteryInfo.percent ?? null,
            isCharging: batteryInfo.isCharging ?? false,
            acConnected: batteryInfo.acConnected ?? false,
            timeRemaining: batteryInfo.timeRemaining ?? null, // menit
            voltage: batteryInfo.voltage ?? null,
            capacityUnit: batteryInfo.capacityUnit ?? null,
            type: batteryInfo.type ?? "Li-Ion",
            manufacturer: batteryInfo.manufacturer ?? null,
            model: batteryInfo.model ?? null,
            // Extra server health info
            cpuTempMax,
            memUsedPercent,
            fetchedAt: new Date().toISOString(),
        });

    } catch (error) {
        log.error("Server battery fetch error", error.message);
        res.status(500).json({ error: "Gagal membaca info baterai server", detail: error.message });
    }
});

export default router;
