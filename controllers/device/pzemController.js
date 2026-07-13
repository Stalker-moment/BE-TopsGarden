import express from "express";
import { prisma } from "../../prisma/client.js";
import { createLogger } from "../../helper/logger.js";
import { addPzemLog } from "../../ingestion/pzemBuffer.js";

const router = express.Router();
const log = createLogger("PzemController");

// === DATA INGESTION (from ESP32) ===
// Payload: { deviceId, voltage, current, power, energy, frequency, pf, relayState, overcurrentThreshold, overcurrentDelay, autoReconnect, reconnectDelay }
router.post("/pzem/data", async (req, res) => {
    try {
        const { 
            deviceId, voltage, current, power, energy, frequency, pf, relayState, 
            overcurrentThreshold, overcurrentDelay, autoReconnect, reconnectDelay 
        } = req.body;

        // 1. Basic Validation
        if (!deviceId) return res.status(400).json({ error: "Device ID required" });

        let safeV = Number(voltage) || 0;
        let safeA = Number(current) || 0;
        let safeP = Number(power) || 0;
        let safeE = Number(energy) || 0;
        let safeF = Number(frequency) || 0;
        let safePf = Number(pf) || 0;

        if (isNaN(safeV) || safeV < 0 || safeV > 350) safeV = 0;
        if (isNaN(safeA) || safeA < 0 || safeA > 120) safeA = 0;
        if (isNaN(safeP) || safeP < 0 || safeP > 25000) safeP = 0;
        if (isNaN(safeE) || safeE < 0 || safeE > 100000) safeE = 0;

        // 2. Insert Log to Buffer (async)
        addPzemLog({
            deviceId,
            voltage: safeV,
            current: safeA,
            power: safeP,
            energy: safeE,
            frequency: safeF,
            pf: safePf,
            createdAt: new Date()
        });

        // 3. Fetch Device State (including Relay Configuration)
        const device = await prisma.pzemDevice.findUnique({
            where: { id: deviceId },
            select: { 
                shouldReset: true,
                hasRelay: true,
                relayState: true,
                overcurrentThreshold: true,
                overcurrentDelay: true,
                autoReconnect: true,
                reconnectDelay: true
            }
        });

        if (device) {
            if (relayState !== undefined && typeof relayState === "boolean" && device.relayState !== relayState) {
                // Update database to reflect local state (e.g. ESP32 local trip)
                await prisma.pzemDevice.update({
                    where: { id: deviceId },
                    data: { relayState }
                });
                device.relayState = relayState;
                log.info(`Synced physical relay state from device ${deviceId} to: ${relayState}`);
            }

            if (overcurrentThreshold !== undefined && !isNaN(Number(overcurrentThreshold))) {
                const numThreshold = Number(overcurrentThreshold);
                if (device.overcurrentThreshold !== numThreshold) {
                    await prisma.pzemDevice.update({
                        where: { id: deviceId },
                        data: { overcurrentThreshold: numThreshold }
                    });
                    device.overcurrentThreshold = numThreshold;
                    log.info(`Synced overcurrentThreshold from device ${deviceId} to: ${numThreshold} A`);
                }
            }

            if (overcurrentDelay !== undefined && !isNaN(Number(overcurrentDelay))) {
                const numDelay = Number(overcurrentDelay);
                if (device.overcurrentDelay !== numDelay) {
                    await prisma.pzemDevice.update({
                        where: { id: deviceId },
                        data: { overcurrentDelay: numDelay }
                    });
                    device.overcurrentDelay = numDelay;
                    log.info(`Synced overcurrentDelay from device ${deviceId} to: ${numDelay} s`);
                }
            }

            if (autoReconnect !== undefined) {
                const boolVal = autoReconnect === true || autoReconnect === "true";
                if (device.autoReconnect !== boolVal) {
                    await prisma.pzemDevice.update({
                        where: { id: deviceId },
                        data: { autoReconnect: boolVal }
                    });
                    device.autoReconnect = boolVal;
                    log.info(`Synced autoReconnect from device ${deviceId} to: ${boolVal}`);
                }
            }

            if (reconnectDelay !== undefined && !isNaN(Number(reconnectDelay))) {
                const numRecDelay = Number(reconnectDelay);
                if (device.reconnectDelay !== numRecDelay) {
                    await prisma.pzemDevice.update({
                        where: { id: deviceId },
                        data: { reconnectDelay: numRecDelay }
                    });
                    device.reconnectDelay = numRecDelay;
                    log.info(`Synced reconnectDelay from device ${deviceId} to: ${numRecDelay} s`);
                }
            }
        }

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

        // 4. Return Response (Command & Relay settings to ESP32)
        res.json({
            status: "success",
            command: command,
            relayState: device ? device.relayState : true,
            overcurrentThreshold: device ? device.overcurrentThreshold : 10.0,
            overcurrentDelay: device ? device.overcurrentDelay : 0,
            autoReconnect: device ? device.autoReconnect : false,
            reconnectDelay: device ? device.reconnectDelay : 30
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

// 2b. Update Device (Edit name/location/relay settings)
router.put("/pzem/:id", async (req, res) => {
    try {
        const { 
            name, location, isActive, hasRelay, relayState, 
            overcurrentThreshold, overcurrentDelay, autoReconnect, reconnectDelay 
        } = req.body;
        const updatedDevice = await prisma.pzemDevice.update({
            where: { id: req.params.id },
            data: { 
                name, 
                location, 
                isActive,
                ...(hasRelay !== undefined && { hasRelay: Boolean(hasRelay) }),
                ...(relayState !== undefined && { relayState: Boolean(relayState) }),
                ...(overcurrentThreshold !== undefined && { overcurrentThreshold: Number(overcurrentThreshold) }),
                ...(overcurrentDelay !== undefined && { overcurrentDelay: Number(overcurrentDelay) }),
                ...(autoReconnect !== undefined && { autoReconnect: Boolean(autoReconnect) }),
                ...(reconnectDelay !== undefined && { reconnectDelay: Number(reconnectDelay) })
            }
        });
        res.json(updatedDevice);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// 2b-2. Direct Toggle Relay (Manual Control from UI)
router.post("/pzem/:id/relay", async (req, res) => {
    try {
        const { id } = req.params;
        const { relayState } = req.body; // boolean
        if (relayState === undefined) return res.status(400).json({ error: "relayState is required" });
        
        const updatedDevice = await prisma.pzemDevice.update({
            where: { id },
            data: { relayState: Boolean(relayState) }
        });
        
        log.info(`User manual-toggled relay to ${relayState} for device ${id}`);
        res.json({ message: "Relay state updated", relayState: updatedDevice.relayState });
    } catch (error) {
        res.status(500).json({ error: error.message });
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

// Helper kalkulasi penggunaan, rata-rata tegangan, dan rata-rata arus dari raw logs (Hyper Fast < 5ms)
async function calculateDailyMetricsFast(deviceId, startDate, endDate) {
    try {
        const [firstLog, lastLog, agg] = await Promise.all([
            prisma.pzemLog.findFirst({
                where: { deviceId, createdAt: { gte: startDate, lte: endDate }, energy: { gt: 0, lt: 100000 } },
                orderBy: { createdAt: 'asc' },
                select: { energy: true, createdAt: true }
            }),
            prisma.pzemLog.findFirst({
                where: { deviceId, createdAt: { gte: startDate, lte: endDate }, energy: { gt: 0, lt: 100000 } },
                orderBy: { createdAt: 'desc' },
                select: { energy: true, createdAt: true }
            }),
            prisma.pzemLog.aggregate({
                where: { deviceId, createdAt: { gte: startDate, lte: endDate }, power: { gte: 0, lte: 25000 } },
                _avg: { power: true, voltage: true, current: true },
                _count: true,
            })
        ]);

        let usageKwh = 0;
        if (firstLog && lastLog && lastLog.energy >= firstLog.energy) {
            const delta = lastLog.energy - firstLog.energy;
            if (delta >= 0 && delta < 50000) {
                usageKwh = parseFloat(delta.toFixed(3));
            }
        }

        if (usageKwh <= 0 && agg._count > 0 && agg._avg.power > 0) {
            let durationHours = 1;
            if (firstLog && lastLog) {
                durationHours = Math.max(0.05, (new Date(lastLog.createdAt) - new Date(firstLog.createdAt)) / 3600000);
            } else {
                durationHours = Math.max(0.05, (agg._count * 3) / 3600);
            }
            usageKwh = parseFloat(((agg._avg.power / 1000) * durationHours).toFixed(3));
        }

        const avgVoltage = agg._avg?.voltage ? parseFloat(agg._avg.voltage.toFixed(1)) : 0;
        const avgCurrent = agg._avg?.current ? parseFloat(agg._avg.current.toFixed(2)) : 0;

        return { usageKwh, avgVoltage, avgCurrent };
    } catch (err) {
        log.error("calculateDailyMetricsFast error", err.message);
        return { usageKwh: 0, avgVoltage: 0, avgCurrent: 0 };
    }
}

// Helper to calculate total consumption from raw logs for days that missed midnight snapshots
async function getMissingUsageForMonth(deviceId, year, month, snapshotDaysSet) {
    const today = new Date();
    const isCurrentMonth = (year === today.getFullYear() && month === (today.getMonth() + 1));
    
    const daysInMonth = new Date(year, month, 0).getDate();
    const endDay = isCurrentMonth ? (today.getDate() - 1) : daysInMonth;
    
    if (endDay <= 0) return 0;
    
    // Find contiguous blocks of missing days
    const missingBlocks = [];
    let currentBlock = null;
    
    for (let d = 1; d <= endDay; d++) {
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const hasSnapshot = snapshotDaysSet.has(dateStr);
        
        if (!hasSnapshot) {
            if (!currentBlock) {
                currentBlock = { start: d, end: d };
            } else {
                currentBlock.end = d;
            }
        } else {
            if (currentBlock) {
                missingBlocks.push(currentBlock);
                currentBlock = null;
            }
        }
    }
    if (currentBlock) {
        missingBlocks.push(currentBlock);
    }
    
    if (missingBlocks.length === 0) return 0;
    
    // Fetch usage for each block in parallel
    const blockResults = await Promise.all(
        missingBlocks.map(async block => {
            const start = new Date(year, month - 1, block.start, 0, 0, 0);
            const end = new Date(year, month - 1, block.end, 23, 59, 59);
            const metrics = await calculateDailyMetricsFast(deviceId, start, end);
            return metrics.usageKwh;
        })
    );
    
    return blockResults.reduce((sum, val) => sum + val, 0);
}

async function getMissingUsageForYear(deviceId, year, snapshotDaysSet) {
    const months = Array.from({ length: 12 }, (_, i) => i + 1);
    const results = await Promise.all(
        months.map(m => getMissingUsageForMonth(deviceId, year, m, snapshotDaysSet))
    );
    return results.reduce((sum, val) => sum + val, 0);
}

/**
 * 7. Daily kWh Usage
 * GET /pzem/:id/daily-usage?year=2026&month=7
 */
// Convert UTC date to 'YYYY-MM-DD' in Asia/Jakarta timezone
const formatDateWIB = (date) => {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date(date));
};

router.get("/pzem/:id/daily-usage", async (req, res) => {
    try {
        const { id } = req.params;
        const now = new Date();
        const year = Number(req.query.year) || now.getFullYear();
        const month = Number(req.query.month) || (now.getMonth() + 1); // 1-based

        const startDate = new Date(year, month - 1, 1, 0, 0, 0, 0);
        // Load up to the 1st of the next month to get the next day's snapshot for the last day of this month
        const endDate = new Date(year, month, 1, 23, 59, 59, 999);

        const snapshots = await prisma.pzemDailySnapshot.findMany({
            where: {
                deviceId: id,
                date: { gte: startDate, lte: endDate },
            },
            orderBy: { date: 'asc' },
        });

        const dayMap = {};
        for (const s of snapshots) {
            const dateStr = formatDateWIB(s.date);
            const [y, m, d] = dateStr.split('-').map(Number);
            
            // The snapshot on date D (start of day D) contains the delta for day D-1
            const targetDate = new Date(y, m - 1, d);
            targetDate.setDate(targetDate.getDate() - 1);
            
            if (targetDate.getFullYear() === year && (targetDate.getMonth() + 1) === month) {
                const targetDayNum = targetDate.getDate();
                dayMap[targetDayNum] = s;
            }
        }

        const daysInMonth = new Date(year, month, 0).getDate();
        const allDays = Array.from({ length: daysInMonth }, (_, i) => i + 1);

        const fallbackResults = await Promise.all(
            allDays.map(d => {
                const dStart = new Date(year, month - 1, d, 0, 0, 0);
                const dEnd = new Date(year, month - 1, d, 23, 59, 59);
                return calculateDailyMetricsFast(id, dStart, dEnd);
            })
        );

        const result = [];
        for (let d = 1; d <= daysInMonth; d++) {
            const dDate = new Date(year, month - 1, d);
            const dateLabel = dDate.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
            const s = dayMap[d];
            const fb = fallbackResults[d - 1] || { usageKwh: 0, avgVoltage: 0, avgCurrent: 0 };

            result.push({
                date: s ? s.date : dDate,
                dateLabel,
                usageKwh: s?.deltaKwh ?? fb.usageKwh,
                avgVoltage: fb.avgVoltage,
                avgCurrent: fb.avgCurrent,
                energyKwh: s?.energyKwh ?? 0,
                isResetDay: s?.isResetDay ?? false,
            });
        }

        const totalKwh = result.reduce((sum, d) => sum + (d.usageKwh || 0), 0);
        const PLN_RATE = Number(process.env.PLN_RATE_PER_KWH || 1444.70);

        res.json({
            year,
            month,
            totalKwh: parseFloat(totalKwh.toFixed(3)),
            estimatedCost: parseFloat((totalKwh * PLN_RATE).toFixed(0)),
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
 */
router.get("/pzem/:id/monthly-usage", async (req, res) => {
    try {
        const { id } = req.params;
        const year = Number(req.query.year) || new Date().getFullYear();

        const startDate = new Date(year, 0, 1);
        // Extend to Jan 1st of the next year
        const endDate = new Date(year + 1, 0, 1, 23, 59, 59);

        const snapshots = await prisma.pzemDailySnapshot.findMany({
            where: {
                deviceId: id,
                date: { gte: startDate, lte: endDate },
                deltaKwh: { not: null },
            },
            orderBy: { date: 'asc' },
        });

        const snapshotDaysSet = new Set();
        const monthlyMap = {};
        for (let m = 1; m <= 12; m++) {
            monthlyMap[m] = { month: m, usageKwh: 0, hasResetDay: false, daysCount: 0 };
        }

        for (const snap of snapshots) {
            const dateStr = formatDateWIB(snap.date);
            const [y, m, d] = dateStr.split('-').map(Number);
            const targetDate = new Date(y, m - 1, d);
            targetDate.setDate(targetDate.getDate() - 1);
            
            if (targetDate.getFullYear() === year) {
                const targetMonthNum = targetDate.getMonth() + 1;
                monthlyMap[targetMonthNum].usageKwh += snap.deltaKwh || 0;
                monthlyMap[targetMonthNum].daysCount += 1;
                if (snap.isResetDay) monthlyMap[targetMonthNum].hasResetDay = true;
                
                snapshotDaysSet.add(formatDateWIB(targetDate));
            }
        }

        const allMonths = Array.from({ length: 12 }, (_, i) => i + 1);
        const [monthlyMetrics, missingUsages] = await Promise.all([
            Promise.all(
                allMonths.map(async m => {
                    const mStart = new Date(year, m - 1, 1, 0, 0, 0);
                    const mEnd = new Date(year, m, 0, 23, 59, 59);
                    return calculateDailyMetricsFast(id, mStart, mEnd);
                })
            ),
            Promise.all(
                allMonths.map(m => getMissingUsageForMonth(id, year, m, snapshotDaysSet))
            )
        ]);

        for (let m = 1; m <= 12; m++) {
            monthlyMap[m].usageKwh += missingUsages[m - 1];
        }

        const months = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Ags','Sep','Okt','Nov','Des'];
        const result = Object.values(monthlyMap).map(m => {
            const metrics = monthlyMetrics[m.month - 1] || { avgVoltage: 0, avgCurrent: 0 };
            return {
                ...m,
                usageKwh: parseFloat(m.usageKwh.toFixed(3)),
                label: months[m.month - 1],
                avgVoltage: metrics.avgVoltage,
                avgCurrent: metrics.avgCurrent,
            };
        });

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
        // Extend to Jan 1st of the next year of currentYear
        const endDate = new Date(currentYear + 1, 0, 1, 23, 59, 59);

        const snapshots = await prisma.pzemDailySnapshot.findMany({
            where: {
                deviceId: id,
                date: { gte: startDate, lte: endDate },
                deltaKwh: { not: null },
            },
            orderBy: { date: 'asc' },
        });

        const snapshotDaysSet = new Set();
        const yearlyMap = {};
        for (let y = startYear; y <= currentYear; y++) {
            yearlyMap[y] = { year: y, usageKwh: 0, hasResetDay: false };
        }

        for (const snap of snapshots) {
            const dateStr = formatDateWIB(snap.date);
            const [y, m, d] = dateStr.split('-').map(Number);
            const targetDate = new Date(y, m - 1, d);
            targetDate.setDate(targetDate.getDate() - 1);
            
            const targetYear = targetDate.getFullYear();
            if (yearlyMap[targetYear]) {
                yearlyMap[targetYear].usageKwh += snap.deltaKwh || 0;
                if (snap.isResetDay) yearlyMap[targetYear].hasResetDay = true;
                
                snapshotDaysSet.add(formatDateWIB(targetDate));
            }
        }

        const yearsArray = Array.from({ length: currentYear - startYear + 1 }, (_, i) => startYear + i);
        const [yearlyMetrics, missingYearlyUsages] = await Promise.all([
            Promise.all(
                yearsArray.map(async y => {
                    const yStart = new Date(y, 0, 1, 0, 0, 0);
                    const yEnd = new Date(y, 11, 31, 23, 59, 59);
                    return calculateDailyMetricsFast(id, yStart, yEnd);
                })
            ),
            Promise.all(
                yearsArray.map(y => getMissingUsageForYear(id, y, snapshotDaysSet))
            )
        ]);

        const result = Object.values(yearlyMap).map((y, idx) => {
            const metrics = yearlyMetrics[idx] || { avgVoltage: 0, avgCurrent: 0 };
            const totalUsage = y.usageKwh + missingYearlyUsages[idx];
            return {
                ...y,
                usageKwh: parseFloat(totalUsage.toFixed(3)),
                avgVoltage: metrics.avgVoltage,
                avgCurrent: metrics.avgCurrent,
            };
        });

        const totalKwh = result.reduce((sum, y) => sum + y.usageKwh, 0);
        const PLN_RATE = Number(process.env.PLN_RATE_PER_KWH || 1444.70);

        res.json({
            totalKwh: parseFloat(totalKwh.toFixed(3)),
            estimatedCost: parseFloat((totalKwh * PLN_RATE).toFixed(0)),
            plnRate: PLN_RATE,
            years: result,
        });
    } catch (error) {
        log.error("yearly-usage error", error.message);
        res.status(500).json({ error: error.message });
    }
});



/**
 * 9b. Hourly kWh & Power Usage (24 Jam - Data Per-Jam di Hari Itu)
 * GET /pzem/:id/hourly-usage?date=2026-07-04
 */
router.get("/pzem/:id/hourly-usage", async (req, res) => {
    try {

        const { id } = req.params;
        const targetDateStr = req.query.date ? String(req.query.date) : new Date().toISOString().slice(0, 10);
        
        const [yearStr, monthStr, dayStr] = targetDateStr.split('-').map(Number);
        const startDate = new Date(yearStr, monthStr - 1, dayStr, 0, 0, 0, 0);
        const endDate = new Date(yearStr, monthStr - 1, dayStr, 23, 59, 59, 999);

        const logs = await prisma.pzemLog.findMany({
            where: {
                deviceId: id,
                createdAt: { gte: startDate, lte: endDate },
            },
            orderBy: { createdAt: 'asc' },
        });

        // Group by hour 0..23
        const hourMap = {};
        for (let h = 0; h < 24; h++) {
            const label = `${String(h).padStart(2, '0')}:00`;
            hourMap[h] = {
                hour: h,
                label,
                avgPower: 0,
                maxPower: 0,
                avgVoltage: 0,
                usageKwh: 0,
                count: 0,
                _powerSum: 0,
                _voltageSum: 0,
                _minEnergy: null,
                _maxEnergy: null,
            };
        }

        for (const logItem of logs) {
            let p = logItem.power;
            let v = logItem.voltage;
            let e = logItem.energy;

            // Filter out garbage / noise readings (> 25000 W, > 350 V, < 0)
            if (isNaN(p) || p < 0 || p > 25000) p = 0;
            if (isNaN(v) || v < 0 || v > 350) v = 0;
            if (isNaN(e) || e < 0 || e > 100000) e = 0;

            const h = new Date(logItem.createdAt).getHours();
            if (hourMap[h]) {
                const item = hourMap[h];
                item.count += 1;
                item._powerSum += p;
                item._voltageSum += v;
                if (p > item.maxPower) item.maxPower = p;

                if (e > 0) {
                    if (item._minEnergy === null || e < item._minEnergy) item._minEnergy = e;
                    if (item._maxEnergy === null || e > item._maxEnergy) item._maxEnergy = e;
                }
            }
        }


        let totalKwh = 0;
        const hours = Object.values(hourMap).map(h => {
            const avgPower = h.count > 0 ? parseFloat((h._powerSum / h.count).toFixed(1)) : 0;
            const avgVoltage = h.count > 0 ? parseFloat((h._voltageSum / h.count).toFixed(1)) : 0;
            let usageKwh = 0;

            // Coba kalkulasi delta kWh jika min & max energy valid dan selisihnya masuk akal (< 10 kWh dalam 1 jam)
            if (h._minEnergy !== null && h._maxEnergy !== null && h._minEnergy > 0) {
                const delta = h._maxEnergy - h._minEnergy;
                if (delta >= 0 && delta < 10) {
                    usageKwh = delta;
                }
            }

            // Jika delta energy tidak valid (0 / minEnergy=0 / lonjakan anomali > 10 kWh),
            // kalkulasi dari integrasi daya rata-rata (Power in Watts):
            // usageKwh = (avgPower / 1000) * durationInHours
            if (usageKwh <= 0 && avgPower > 0) {
                const activeDurationHours = Math.min(1.0, (h.count * 3) / 3600);
                usageKwh = (avgPower / 1000) * (activeDurationHours > 0.05 ? activeDurationHours : 1.0);
            }

            usageKwh = parseFloat(usageKwh.toFixed(4));
            totalKwh += usageKwh;

            return {
                hour: h.hour,
                label: h.label,
                avgPower,
                maxPower: parseFloat(h.maxPower.toFixed(1)),
                avgVoltage,
                usageKwh,
                count: h.count,
            };
        });


        const PLN_RATE = Number(process.env.PLN_RATE_PER_KWH || 1444.70);
        res.json({
            date: targetDateStr,
            totalKwh: parseFloat(totalKwh.toFixed(3)),
            estimatedCost: parseFloat((totalKwh * PLN_RATE).toFixed(0)),
            plnRate: PLN_RATE,
            hours,
        });
    } catch (error) {
        log.error("hourly-usage error", error.message);
        res.status(500).json({ error: error.message });
    }
});

/**
 * 9c. Minutely kWh & Power Usage (1 Jam - Data Per-Menit di Jam Itu)
 * GET /pzem/:id/minutely-usage?date=2026-07-04&hour=14
 */
router.get("/pzem/:id/minutely-usage", async (req, res) => {
    try {
        const { id } = req.params;
        const now = new Date();
        const targetDateStr = req.query.date ? String(req.query.date) : now.toISOString().slice(0, 10);
        const targetHour = req.query.hour !== undefined ? Number(req.query.hour) : now.getHours();

        const [yearStr, monthStr, dayStr] = targetDateStr.split('-').map(Number);
        const startDate = new Date(yearStr, monthStr - 1, dayStr, targetHour, 0, 0, 0);
        const endDate = new Date(yearStr, monthStr - 1, dayStr, targetHour, 59, 59, 999);

        const logs = await prisma.pzemLog.findMany({
            where: {
                deviceId: id,
                createdAt: { gte: startDate, lte: endDate },
            },
            orderBy: { createdAt: 'asc' },
        });

        // Group by minute 0..59
        const minuteMap = {};
        for (let m = 0; m < 60; m++) {
            const label = `${String(targetHour).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
            minuteMap[m] = {
                minute: m,
                label,
                avgPower: 0,
                avgVoltage: 0,
                avgCurrent: 0,
                usageKwh: 0,
                count: 0,
                _powerSum: 0,
                _voltageSum: 0,
                _currentSum: 0,
            };
        }

        for (const logItem of logs) {
            let p = logItem.power;
            let v = logItem.voltage;
            let a = logItem.current;

            // Filter data sampah / noise dari sensor (> 25000 W, > 350 V, > 120 A, < 0)
            if (isNaN(p) || p < 0 || p > 25000) p = 0;
            if (isNaN(v) || v < 0 || v > 350) v = 0;
            if (isNaN(a) || a < 0 || a > 120) a = 0;

            const m = new Date(logItem.createdAt).getMinutes();
            if (minuteMap[m]) {
                const item = minuteMap[m];
                item.count += 1;
                item._powerSum += p;
                item._voltageSum += v;
                item._currentSum += a;
            }
        }


        let totalKwh = 0;
        const minutes = Object.values(minuteMap).map(m => {
            const avgPower = m.count > 0 ? parseFloat((m._powerSum / m.count).toFixed(1)) : 0;
            const avgVoltage = m.count > 0 ? parseFloat((m._voltageSum / m.count).toFixed(1)) : 0;
            const avgCurrent = m.count > 0 ? parseFloat((m._currentSum / m.count).toFixed(2)) : 0;
            const usageKwh = parseFloat(((avgPower / 1000) / 60).toFixed(5)); // Wh / 60 menit

            totalKwh += usageKwh;

            return {
                minute: m.minute,
                label: m.label,
                avgPower,
                avgVoltage,
                avgCurrent,
                usageKwh,
                count: m.count,
            };
        });

        const PLN_RATE = Number(process.env.PLN_RATE_PER_KWH || 1444.70);
        res.json({
            date: targetDateStr,
            hour: targetHour,
            totalKwh: parseFloat(totalKwh.toFixed(4)),
            estimatedCost: parseFloat((totalKwh * PLN_RATE).toFixed(0)),
            plnRate: PLN_RATE,
            minutes,
        });
    } catch (error) {
        log.error("minutely-usage error", error.message);
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