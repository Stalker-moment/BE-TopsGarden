import { wibDate, wibWindow, wibParts, logQuery, addCurrent, averageCurrent } from "../../functions/pzemHistory.js";
import express from "express";
import { prisma } from "../../prisma/client.js";
import { createLogger } from "../../helper/logger.js";
import { addPzemLog } from "../../ingestion/pzemBuffer.js";
import { disaggregateTimeSeries, analyzeRealtimeLoad, KOS_APPLIANCES } from "../../functions/alinDisaggregation.js";

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
        
        if (id === "all") {
            const activeDevices = await prisma.pzemDevice.findMany({ where: { isActive: true } });
            const latestLogs = await Promise.all(
                activeDevices.map(d => prisma.pzemLog.findFirst({
                    where: { deviceId: d.id },
                    orderBy: { createdAt: 'desc' }
                }))
            );
            
            const validLogs = latestLogs.filter(Boolean);
            if (validLogs.length === 0) {
                return res.json({ latest: { voltage: 0, current: 0, power: 0, energy: 0, frequency: 0, pf: 0 }, status: "OFFLINE" });
            }

            const latest = {
                voltage: parseFloat((validLogs.reduce((sum, l) => sum + l.voltage, 0) / validLogs.length).toFixed(1)),
                current: parseFloat(validLogs.reduce((sum, l) => sum + l.current, 0).toFixed(2)),
                power: parseFloat(validLogs.reduce((sum, l) => sum + l.power, 0).toFixed(1)),
                energy: parseFloat(validLogs.reduce((sum, l) => sum + l.energy, 0).toFixed(3)),
                frequency: parseFloat((validLogs.reduce((sum, l) => sum + l.frequency, 0) / validLogs.length).toFixed(1)),
                pf: parseFloat((validLogs.reduce((sum, l) => sum + l.pf, 0) / validLogs.length).toFixed(2)),
                createdAt: new Date().toISOString()
            };

            return res.json({ latest, status: "ONLINE" });
        }
        
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

// 5. Historical Logs (Table / Time-window query)
router.get("/pzem/:id/logs", async (req, res) => {
    try {
        const { id } = req.params;
        const query = logQuery(req.query, id);

        if (id === "all") {
            const logs = await prisma.pzemLog.findMany({
                ...query,
                include: { device: true }
            });
            const formatted = logs.map(l => ({
                id: l.id,
                deviceId: l.deviceId,
                deviceName: l.device?.name || "All",
                location: l.device?.location || "",
                voltage: l.voltage,
                current: l.current,
                power: l.power,
                energy: l.energy,
                frequency: l.frequency,
                pf: l.pf,
                createdAt: l.createdAt
            }));
            return res.json(formatted);
        }

        const logs = await prisma.pzemLog.findMany({
            ...query
        });
        res.json(logs);
    } catch (error) {
        res.status(error.status || 500).json({ error: error.message });
    }
});

// Alias: /pzem/:id/raw-logs and /pzem/:id/detailed-logs
router.get(["/pzem/:id/raw-logs", "/pzem/:id/detailed-logs"], async (req, res, next) => {
    req.url = req.url.replace(/\/pzem\/([^/]+)\/(raw|detailed)-logs/, "/pzem/$1/logs");
    return router.handle(req, res, next);
});

// 6. Chart Data (Live Trend - last 50 points)
router.get("/pzem/:id/chart", async (req, res) => {
    try {
        const { id } = req.params;

        if (id === "all") {
            const logs = await prisma.pzemLog.findMany({
                orderBy: { createdAt: 'desc' },
                take: 100
            });
            
            const intervals = {};
            for (const l of logs) {
                const time = new Date(l.createdAt);
                time.setSeconds(Math.round(time.getSeconds() / 5) * 5, 0);
                const key = time.toISOString();
                
                if (!intervals[key]) {
                    intervals[key] = {
                        createdAt: key,
                        power: 0,
                        current: 0,
                        voltage: 0,
                        devicesCount: 0,
                        hasDevice: new Set()
                    };
                }
                
                if (!intervals[key].hasDevice.has(l.deviceId)) {
                    intervals[key].hasDevice.add(l.deviceId);
                    intervals[key].power += l.power;
                    intervals[key].current += l.current;
                    intervals[key].voltage += l.voltage;
                    intervals[key].devicesCount += 1;
                }
            }
            
            const chartData = Object.values(intervals).map((i) => ({
                id: i.createdAt,
                power: parseFloat(i.power.toFixed(1)),
                current: parseFloat(i.current.toFixed(2)),
                voltage: parseFloat((i.devicesCount > 0 ? i.voltage / i.devicesCount : 220).toFixed(1)),
                createdAt: i.createdAt
            })).slice(0, 50).reverse();
            
            return res.json(chartData);
        }

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

// In-memory cache for daily usage: key -> { data, expiresAt }
const dailyUsageCache = new Map();
const DAILY_CACHE_TTL_CURRENT = 30 * 1000; // 30s for current month
const DAILY_CACHE_TTL_PAST = 3600 * 1000; // 1h for past months

router.get("/pzem/:id/daily-usage", async (req, res) => {
    try {
        const { id } = req.params;
        const now = new Date();
        const year = Number(req.query.year) || now.getFullYear();
        const month = Number(req.query.month) || (now.getMonth() + 1); // 1-based

        const cacheKey = `${id}-${year}-${month}`;
        const cached = dailyUsageCache.get(cacheKey);
        if (cached && Date.now() < cached.expiresAt) {
            return res.json(cached.data);
        }

        const nowWIB = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }));
        const curYear = nowWIB.getFullYear();
        const curMonth = nowWIB.getMonth() + 1;
        const curDay = nowWIB.getDate();

        const isCurrentMonth = (year === curYear && month === curMonth);
        const isFutureMonth = (year > curYear || (year === curYear && month > curMonth));
        const daysInMonth = new Date(year, month, 0).getDate();
        const PLN_RATE = Number(process.env.PLN_RATE_PER_KWH || 1444.70);

        if (isFutureMonth) {
            const emptyDays = Array.from({ length: daysInMonth }, (_, i) => {
                const dayNum = i + 1;
                const dDate = new Date(year, month - 1, dayNum);
                return {
                    date: dDate,
                    dateLabel: dDate.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' }),
                    usageKwh: 0,
                    avgVoltage: 0,
                    avgCurrent: 0,
                    energyKwh: 0,
                    isResetDay: false
                };
            });
            const responseData = {
                year,
                month,
                totalKwh: 0,
                estimatedCost: 0,
                plnRate: PLN_RATE,
                days: emptyDays
            };
            dailyUsageCache.set(cacheKey, { data: responseData, expiresAt: Date.now() + DAILY_CACHE_TTL_PAST });
            return res.json(responseData);
        }

        if (id === "all") {
            const activeDevices = await prisma.pzemDevice.findMany({ where: { isActive: true } });
            if (activeDevices.length === 0) {
                return res.json({
                    year,
                    month,
                    totalKwh: 0,
                    estimatedCost: 0,
                    plnRate: PLN_RATE,
                    days: []
                });
            }

            const deviceIds = activeDevices.map(d => d.id);
            const startDate = new Date(year, month - 1, 1, 0, 0, 0, 0);
            const endDate = new Date(year, month, 1, 23, 59, 59, 999);

            // Fetch snapshots for all active devices in a single batch query
            const snapshots = await prisma.pzemDailySnapshot.findMany({
                where: { deviceId: { in: deviceIds }, date: { gte: startDate, lte: endDate } },
                orderBy: { date: 'asc' }
            });

            // Group snapshots by deviceId and targetDayNum
            const snapshotsByDevice = {};
            for (const devId of deviceIds) {
                snapshotsByDevice[devId] = {};
            }
            for (const s of snapshots) {
                const dateStr = formatDateWIB(s.date);
                const [sy, sm, sd] = dateStr.split('-').map(Number);
                const targetDate = new Date(sy, sm - 1, sd);
                targetDate.setDate(targetDate.getDate() - 1);
                if (targetDate.getFullYear() === year && (targetDate.getMonth() + 1) === month) {
                    if (snapshotsByDevice[s.deviceId]) {
                        snapshotsByDevice[s.deviceId][targetDate.getDate()] = s;
                    }
                }
            }

            // Calculate each device's daily list
            const devicesDaily = await Promise.all(
                activeDevices.map(async d => {
                    const devSnapMap = snapshotsByDevice[d.id] || {};
                    const list = [];

                    for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
                        const isFutureDay = isCurrentMonth && dayNum > curDay;
                        const isToday = isCurrentMonth && dayNum === curDay;
                        const s = devSnapMap[dayNum];

                        if (isFutureDay) {
                            list.push({
                                day: dayNum,
                                usageKwh: 0,
                                avgVoltage: 0,
                                avgCurrent: 0,
                                energyKwh: 0,
                                isResetDay: false
                            });
                        } else if (isToday) {
                            // Calculate live metrics for today only
                            const dStart = new Date(year, month - 1, dayNum, 0, 0, 0);
                            const dEnd = new Date(year, month - 1, dayNum, 23, 59, 59);
                            const live = await calculateDailyMetricsFast(d.id, dStart, dEnd);
                            list.push({
                                day: dayNum,
                                usageKwh: live.usageKwh,
                                avgVoltage: live.avgVoltage,
                                avgCurrent: live.avgCurrent,
                                energyKwh: 0,
                                isResetDay: false
                            });
                        } else if (s) {
                            // Snapshot exists for this past day — use it directly without heavy log querying
                            list.push({
                                day: dayNum,
                                usageKwh: s.deltaKwh ?? 0,
                                avgVoltage: (s.deltaKwh && s.deltaKwh > 0) ? 220 : 0,
                                avgCurrent: 0,
                                energyKwh: s.energyKwh ?? 0,
                                isResetDay: s.isResetDay ?? false
                            });
                        } else {
                            // Past day without snapshot (rare fallback)
                            const dStart = new Date(year, month - 1, dayNum, 0, 0, 0);
                            const dEnd = new Date(year, month - 1, dayNum, 23, 59, 59);
                            const fb = await calculateDailyMetricsFast(d.id, dStart, dEnd);
                            list.push({
                                day: dayNum,
                                usageKwh: fb.usageKwh,
                                avgVoltage: fb.avgVoltage,
                                avgCurrent: fb.avgCurrent,
                                energyKwh: 0,
                                isResetDay: false
                            });
                        }
                    }
                    return list;
                })
            );

            const aggregatedDays = [];
            for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
                const dDate = new Date(year, month - 1, dayNum);
                const dateLabel = dDate.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });

                let dayUsageKwh = 0;
                let sumVoltage = 0;
                let sumCurrent = 0;
                let activeCount = 0;

                for (const dDaily of devicesDaily) {
                    const item = dDaily[dayNum - 1];
                    if (item) {
                        dayUsageKwh += item.usageKwh;
                        sumVoltage += item.avgVoltage;
                        sumCurrent += item.avgCurrent;
                        if (item.avgVoltage > 0) activeCount += 1;
                    }
                }

                aggregatedDays.push({
                    date: dDate,
                    dateLabel,
                    usageKwh: parseFloat(dayUsageKwh.toFixed(3)),
                    avgVoltage: activeCount > 0 ? parseFloat((sumVoltage / activeCount).toFixed(1)) : 0,
                    avgCurrent: parseFloat(sumCurrent.toFixed(2)),
                    energyKwh: 0,
                    isResetDay: false
                });
            }

            const totalKwh = aggregatedDays.reduce((sum, d) => sum + d.usageKwh, 0);
            const responseData = {
                year,
                month,
                totalKwh: parseFloat(totalKwh.toFixed(3)),
                estimatedCost: parseFloat((totalKwh * PLN_RATE).toFixed(0)),
                plnRate: PLN_RATE,
                days: aggregatedDays,
                devices: activeDevices.map((d, idx) => ({
                    id: d.id,
                    name: d.name,
                    location: d.location,
                    totalKwh: parseFloat((devicesDaily[idx] || []).reduce((sum, item) => sum + item.usageKwh, 0).toFixed(3)),
                    days: devicesDaily[idx] || []
                }))
            };

            const ttl = isCurrentMonth ? DAILY_CACHE_TTL_CURRENT : DAILY_CACHE_TTL_PAST;
            dailyUsageCache.set(cacheKey, { data: responseData, expiresAt: Date.now() + ttl });

            return res.json(responseData);
        }

        // Single device query
        const startDate = new Date(year, month - 1, 1, 0, 0, 0, 0);
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
            const targetDate = new Date(y, m - 1, d);
            targetDate.setDate(targetDate.getDate() - 1);

            if (targetDate.getFullYear() === year && (targetDate.getMonth() + 1) === month) {
                dayMap[targetDate.getDate()] = s;
            }
        }

        const result = [];
        for (let d = 1; d <= daysInMonth; d++) {
            const dDate = new Date(year, month - 1, d);
            const dateLabel = dDate.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
            const isFutureDay = isCurrentMonth && d > curDay;
            const isToday = isCurrentMonth && d === curDay;
            const s = dayMap[d];

            if (isFutureDay) {
                result.push({
                    date: dDate,
                    dateLabel,
                    usageKwh: 0,
                    avgVoltage: 0,
                    avgCurrent: 0,
                    energyKwh: 0,
                    isResetDay: false,
                });
            } else if (isToday) {
                const dStart = new Date(year, month - 1, d, 0, 0, 0);
                const dEnd = new Date(year, month - 1, d, 23, 59, 59);
                const live = await calculateDailyMetricsFast(id, dStart, dEnd);
                result.push({
                    date: dDate,
                    dateLabel,
                    usageKwh: live.usageKwh,
                    avgVoltage: live.avgVoltage,
                    avgCurrent: live.avgCurrent,
                    energyKwh: 0,
                    isResetDay: false,
                });
            } else if (s) {
                result.push({
                    date: s.date || dDate,
                    dateLabel,
                    usageKwh: s.deltaKwh ?? 0,
                    avgVoltage: (s.deltaKwh && s.deltaKwh > 0) ? 220 : 0,
                    avgCurrent: 0,
                    energyKwh: s.energyKwh ?? 0,
                    isResetDay: s.isResetDay ?? false,
                });
            } else {
                const dStart = new Date(year, month - 1, d, 0, 0, 0);
                const dEnd = new Date(year, month - 1, d, 23, 59, 59);
                const fb = await calculateDailyMetricsFast(id, dStart, dEnd);
                result.push({
                    date: dDate,
                    dateLabel,
                    usageKwh: fb.usageKwh,
                    avgVoltage: fb.avgVoltage,
                    avgCurrent: fb.avgCurrent,
                    energyKwh: 0,
                    isResetDay: false,
                });
            }
        }

        const totalKwh = result.reduce((sum, d) => sum + (d.usageKwh || 0), 0);
        const responseData = {
            year,
            month,
            totalKwh: parseFloat(totalKwh.toFixed(3)),
            estimatedCost: parseFloat((totalKwh * PLN_RATE).toFixed(0)),
            plnRate: PLN_RATE,
            days: result,
        };

        const ttl = isCurrentMonth ? DAILY_CACHE_TTL_CURRENT : DAILY_CACHE_TTL_PAST;
        dailyUsageCache.set(cacheKey, { data: responseData, expiresAt: Date.now() + ttl });

        return res.json(responseData);
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

        if (id === "all") {
            const activeDevices = await prisma.pzemDevice.findMany({ where: { isActive: true } });
            
            const monthlyMap = {};
            for (let m = 1; m <= 12; m++) {
                monthlyMap[m] = { month: m, usageKwh: 0, avgVoltage: 0, avgCurrent: 0, activeCount: 0 };
            }
            
            for (const d of activeDevices) {
                const startDate = new Date(year, 0, 1);
                const endDate = new Date(year + 1, 0, 1, 23, 59, 59);
                const snapshots = await prisma.pzemDailySnapshot.findMany({
                    where: { deviceId: d.id, date: { gte: startDate, lte: endDate }, deltaKwh: { not: null } },
                    orderBy: { date: 'asc' }
                });
                
                const snapshotDaysSet = new Set();
                const deviceMonthly = {};
                for (let m = 1; m <= 12; m++) {
                    deviceMonthly[m] = { usageKwh: 0 };
                }
                
                for (const snap of snapshots) {
                    const dateStr = formatDateWIB(snap.date);
                    const [sy, sm, sd] = dateStr.split('-').map(Number);
                    const targetDate = new Date(sy, sm - 1, sd);
                    targetDate.setDate(targetDate.getDate() - 1);
                    if (targetDate.getFullYear() === year) {
                        const targetMonthNum = targetDate.getMonth() + 1;
                        deviceMonthly[targetMonthNum].usageKwh += snap.deltaKwh || 0;
                        snapshotDaysSet.add(formatDateWIB(targetDate));
                    }
                }
                
                const allMonths = Array.from({ length: 12 }, (_, i) => i + 1);
                const [monthlyMetrics, missingUsages] = await Promise.all([
                    Promise.all(
                        allMonths.map(async m => {
                            const mStart = new Date(year, m - 1, 1, 0, 0, 0);
                            const mEnd = new Date(year, m, 0, 23, 59, 59);
                            return calculateDailyMetricsFast(d.id, mStart, mEnd);
                        })
                    ),
                    Promise.all(
                        allMonths.map(m => getMissingUsageForMonth(d.id, year, m, snapshotDaysSet))
                    )
                ]);
                
                for (let m = 1; m <= 12; m++) {
                    const usage = deviceMonthly[m].usageKwh + missingUsages[m - 1];
                    monthlyMap[m].usageKwh += usage;
                    
                    const metrics = monthlyMetrics[m - 1];
                    if (metrics.avgVoltage > 0) {
                        monthlyMap[m].avgVoltage += metrics.avgVoltage;
                        monthlyMap[m].avgCurrent += metrics.avgCurrent;
                        monthlyMap[m].activeCount += 1;
                    }
                }
            }
            
            const months = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Ags','Sep','Okt','Nov','Des'];
            const result = Object.values(monthlyMap).map((m) => {
                return {
                    month: m.month,
                    usageKwh: parseFloat(m.usageKwh.toFixed(3)),
                    label: months[m.month - 1],
                    avgVoltage: m.activeCount > 0 ? parseFloat((m.avgVoltage / m.activeCount).toFixed(1)) : 0,
                    avgCurrent: parseFloat(m.avgCurrent.toFixed(2)),
                    hasResetDay: false,
                    daysCount: 30
                };
            });
            
            const totalKwh = result.reduce((sum, m) => sum + m.usageKwh, 0);
            const PLN_RATE = Number(process.env.PLN_RATE_PER_KWH || 1444.70);
            
            return res.json({
                year,
                totalKwh: parseFloat(totalKwh.toFixed(3)),
                estimatedCost: parseFloat((totalKwh * PLN_RATE).toFixed(0)),
                plnRate: PLN_RATE,
                months: result
            });
        }

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

        if (id === "all") {
            const activeDevices = await prisma.pzemDevice.findMany({ where: { isActive: true } });
            
            const yearlyMap = {};
            for (let y = startYear; y <= currentYear; y++) {
                yearlyMap[y] = { year: y, usageKwh: 0, avgVoltage: 0, avgCurrent: 0, activeCount: 0 };
            }
            
            for (const d of activeDevices) {
                const startDate = new Date(startYear, 0, 1);
                const endDate = new Date(currentYear + 1, 0, 1, 23, 59, 59);
                const snapshots = await prisma.pzemDailySnapshot.findMany({
                    where: { deviceId: d.id, date: { gte: startDate, lte: endDate }, deltaKwh: { not: null } },
                    orderBy: { date: 'asc' }
                });
                
                const snapshotDaysSet = new Set();
                const deviceYearly = {};
                for (let y = startYear; y <= currentYear; y++) {
                    deviceYearly[y] = { usageKwh: 0 };
                }
                
                for (const snap of snapshots) {
                    const dateStr = formatDateWIB(snap.date);
                    const [sy, sm, sd] = dateStr.split('-').map(Number);
                    const targetDate = new Date(sy, sm - 1, sd);
                    targetDate.setDate(targetDate.getDate() - 1);
                    const targetYear = targetDate.getFullYear();
                    if (deviceYearly[targetYear]) {
                        deviceYearly[targetYear].usageKwh += snap.deltaKwh || 0;
                        snapshotDaysSet.add(formatDateWIB(targetDate));
                    }
                }
                
                const yearsArray = Array.from({ length: currentYear - startYear + 1 }, (_, i) => startYear + i);
                const [yearlyMetrics, missingYearlyUsages] = await Promise.all([
                    Promise.all(
                        yearsArray.map(async y => {
                            const yStart = new Date(y, 0, 1, 0, 0, 0);
                            const yEnd = new Date(y, 11, 31, 23, 59, 59);
                            return calculateDailyMetricsFast(d.id, yStart, yEnd);
                        })
                    ),
                    Promise.all(
                        yearsArray.map(y => getMissingUsageForYear(d.id, y, snapshotDaysSet))
                    )
                ]);
                
                for (let idx = 0; idx < yearsArray.length; idx++) {
                    const y = yearsArray[idx];
                    const usage = deviceYearly[y].usageKwh + missingYearlyUsages[idx];
                    yearlyMap[y].usageKwh += usage;
                    
                    const metrics = yearlyMetrics[idx];
                    if (metrics.avgVoltage > 0) {
                        yearlyMap[y].avgVoltage += metrics.avgVoltage;
                        yearlyMap[y].avgCurrent += metrics.avgCurrent;
                        yearlyMap[y].activeCount += 1;
                    }
                }
            }
            
            const result = Object.values(yearlyMap).map((y) => {
                return {
                    year: y.year,
                    usageKwh: parseFloat(y.usageKwh.toFixed(3)),
                    avgVoltage: y.activeCount > 0 ? parseFloat((y.avgVoltage / y.activeCount).toFixed(1)) : 0,
                    avgCurrent: parseFloat(y.avgCurrent.toFixed(2)),
                    hasResetDay: false
                };
            });
            
            const totalKwh = result.reduce((sum, y) => sum + y.usageKwh, 0);
            const PLN_RATE = Number(process.env.PLN_RATE_PER_KWH || 1444.70);
            
            return res.json({
                totalKwh: parseFloat(totalKwh.toFixed(3)),
                estimatedCost: parseFloat((totalKwh * PLN_RATE).toFixed(0)),
                plnRate: PLN_RATE,
                years: result
            });
        }

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
        const targetDateStr = req.query.date ? String(req.query.date) : wibDate();

        wibWindow(targetDateStr);
        if (id === "all") {
            const activeDevices = await prisma.pzemDevice.findMany({ where: { isActive: true } });
            
            const hourMap = {};
            for (let h = 0; h < 24; h++) {
                const label = `${String(h).padStart(2, '0')}:00`;
                hourMap[h] = { hour: h, label, avgPower: 0, maxPower: 0, avgVoltage: 0, avgCurrent: 0, currentSampleCount: 0, usageKwh: 0, count: 0, activeCount: 0 };
            }
            
            for (const d of activeDevices) {
                const { start: startDate, end: endDate } = wibWindow(targetDateStr);
                
                const logs = await prisma.pzemLog.findMany({
                    where: { deviceId: d.id, createdAt: { gte: startDate, lte: endDate } },
                    orderBy: { createdAt: 'asc' }
                });
                
                const deviceHours = {};
                for (let h = 0; h < 24; h++) {
                    deviceHours[h] = { count: 0, _powerSum: 0, _voltageSum: 0, maxPower: 0, _minEnergy: null, _maxEnergy: null };
                }
                
                for (const logItem of logs) {
                    let p = logItem.power;
                    let v = logItem.voltage;
                    let e = logItem.energy;
                    
                    if (isNaN(p) || p < 0 || p > 25000) p = 0;
                    if (isNaN(v) || v < 0 || v > 350) v = 0;
                    if (isNaN(e) || e < 0 || e > 100000) e = 0;
                    
                    const h = wibParts(logItem.createdAt).hour;
                    if (deviceHours[h]) {
                        const dh = deviceHours[h];
                        dh.count += 1;
                        dh._powerSum += p;
                        dh._voltageSum += v;
                        addCurrent(dh, logItem.current);
                        if (p > dh.maxPower) dh.maxPower = p;
                        if (e > 0) {
                            if (dh._minEnergy === null || e < dh._minEnergy) dh._minEnergy = e;
                            if (dh._maxEnergy === null || e > dh._maxEnergy) dh._maxEnergy = e;
                        }
                    }
                }
                
                for (let h = 0; h < 24; h++) {
                    const dh = deviceHours[h];
                    const avgPower = dh.count > 0 ? dh._powerSum / dh.count : 0;
                    const avgVoltage = dh.count > 0 ? dh._voltageSum / dh.count : 0;
                    
                    let usageKwh = 0;
                    if (dh._minEnergy !== null && dh._maxEnergy !== null && dh._minEnergy > 0) {
                        const delta = dh._maxEnergy - dh._minEnergy;
                        if (delta >= 0 && delta < 10) usageKwh = delta;
                    }
                    if (usageKwh <= 0 && avgPower > 0) {
                        const activeDurationHours = Math.min(1.0, (dh.count * 3) / 3600);
                        usageKwh = (avgPower / 1000) * (activeDurationHours > 0.05 ? activeDurationHours : 1.0);
                    }
                    
                    hourMap[h].usageKwh += usageKwh;
                    hourMap[h].count += dh.count;
                    hourMap[h].currentSampleCount += dh._currentCount || 0;
                    hourMap[h].avgCurrent += averageCurrent(dh) ?? 0;
                    hourMap[h].avgPower += avgPower;
                    hourMap[h].maxPower += dh.maxPower;
                    if (avgVoltage > 0) {
                        hourMap[h].avgVoltage += avgVoltage;
                        hourMap[h].activeCount += 1;
                    }
                }
            }
            
            let totalKwh = 0;
            const hours = Object.values(hourMap).map((h) => {
                totalKwh += h.usageKwh;
                return {
                    hour: h.hour,
                    label: h.label,
                    avgPower: parseFloat(h.avgPower.toFixed(1)),
                    maxPower: parseFloat(h.maxPower.toFixed(1)),
                    avgVoltage: h.activeCount > 0 ? parseFloat((h.avgVoltage / h.activeCount).toFixed(1)) : 0,
                    usageKwh: parseFloat(h.usageKwh.toFixed(4)),
                    avgCurrent: h.currentSampleCount ? Number(h.avgCurrent.toFixed(3)) : null,
                    currentSampleCount: h.currentSampleCount,
                    count: h.count
                };
            });
            
            const PLN_RATE = Number(process.env.PLN_RATE_PER_KWH || 1444.70);
            return res.json({
                date: targetDateStr,
                totalKwh: parseFloat(totalKwh.toFixed(3)),
                estimatedCost: parseFloat((totalKwh * PLN_RATE).toFixed(0)),
                plnRate: PLN_RATE,
                hours
            });
        }
        
        const { start: startDate, end: endDate } = wibWindow(targetDateStr);

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

            const h = wibParts(logItem.createdAt).hour;
            if (hourMap[h]) {
                const item = hourMap[h];
                item.count += 1;
                item._powerSum += p;
                item._voltageSum += v;
                addCurrent(item, logItem.current);
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
                avgCurrent: averageCurrent(h),
                currentSampleCount: h._currentCount || 0,
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
        res.status(error.status || 500).json({ error: error.message });
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
        const targetDateStr = req.query.date ? String(req.query.date) : wibDate(now);
        const targetHour = req.query.hour !== undefined ? Number(req.query.hour) : wibParts(now).hour;

        wibWindow(targetDateStr, targetHour);
        if (id === "all") {
            const activeDevices = await prisma.pzemDevice.findMany({ where: { isActive: true } });
            
            const minuteMap = {};
            for (let m = 0; m < 60; m++) {
                const label = `${String(targetHour).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
                minuteMap[m] = { minute: m, label, avgPower: 0, avgVoltage: 0, avgCurrent: 0, currentSampleCount: 0, count: 0, usageKwh: 0, activeCount: 0 };
            }
            
            for (const d of activeDevices) {
                const { start: startDate, end: endDate } = wibWindow(targetDateStr, targetHour);
                
                const logs = await prisma.pzemLog.findMany({
                    where: { deviceId: d.id, createdAt: { gte: startDate, lte: endDate } },
                    orderBy: { createdAt: 'asc' }
                });
                
                const deviceMinutes = {};
                for (let m = 0; m < 60; m++) {
                    deviceMinutes[m] = { count: 0, _powerSum: 0, _voltageSum: 0, _currentSum: 0 };
                }
                
                for (const logItem of logs) {
                    let p = logItem.power;
                    let v = logItem.voltage;
                    
                    if (isNaN(p) || p < 0 || p > 25000) p = 0;
                    if (isNaN(v) || v < 0 || v > 350) v = 0;
                    
                    const m = wibParts(logItem.createdAt).minute;
                    if (deviceMinutes[m]) {
                        const dm = deviceMinutes[m];
                        dm.count += 1;
                        dm._powerSum += p;
                        dm._voltageSum += v;
                        addCurrent(dm, logItem.current);
                    }
                }
                
                for (let m = 0; m < 60; m++) {
                    const dm = deviceMinutes[m];
                    const avgPower = dm.count > 0 ? dm._powerSum / dm.count : 0;
                    const avgVoltage = dm.count > 0 ? dm._voltageSum / dm.count : 0;
                    const avgCurrent = averageCurrent(dm);
                    
                    const usageKwh = (avgPower / 1000) / 60;
                    
                    minuteMap[m].usageKwh += usageKwh;
                    minuteMap[m].avgPower += avgPower;
                    minuteMap[m].avgCurrent += avgCurrent ?? 0;
                    minuteMap[m].currentSampleCount += dm._currentCount || 0;
                    minuteMap[m].count += dm.count;
                    if (avgVoltage > 0) {
                        minuteMap[m].avgVoltage += avgVoltage;
                        minuteMap[m].activeCount += 1;
                    }
                }
            }
            
            let totalKwh = 0;
            const minutes = Object.values(minuteMap).map((m) => {
                totalKwh += m.usageKwh;
                return {
                    minute: m.minute,
                    label: m.label,
                    avgPower: parseFloat(m.avgPower.toFixed(1)),
                    avgCurrent: m.currentSampleCount ? Number(m.avgCurrent.toFixed(3)) : null,
                    currentSampleCount: m.currentSampleCount,
                    avgVoltage: m.activeCount > 0 ? parseFloat((m.avgVoltage / m.activeCount).toFixed(1)) : 0,
                    usageKwh: parseFloat(m.usageKwh.toFixed(5)),
                    count: m.count
                };
            });
            
            const PLN_RATE = Number(process.env.PLN_RATE_PER_KWH || 1444.70);
            return res.json({
                date: targetDateStr,
                hour: targetHour,
                totalKwh: parseFloat(totalKwh.toFixed(4)),
                estimatedCost: parseFloat((totalKwh * PLN_RATE).toFixed(0)),
                plnRate: PLN_RATE,
                minutes
            });
        }

        const { start: startDate, end: endDate } = wibWindow(targetDateStr, targetHour);

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

            // Filter data sampah / noise dari sensor (> 25000 W, > 350 V, > 120 A, < 0)
            if (isNaN(p) || p < 0 || p > 25000) p = 0;
            if (isNaN(v) || v < 0 || v > 350) v = 0;

            const m = wibParts(logItem.createdAt).minute;
            if (minuteMap[m]) {
                const item = minuteMap[m];
                item.count += 1;
                item._powerSum += p;
                item._voltageSum += v;
                addCurrent(item, logItem.current);
            }
        }


        let totalKwh = 0;
        const minutes = Object.values(minuteMap).map(m => {
            const avgPower = m.count > 0 ? parseFloat((m._powerSum / m.count).toFixed(1)) : 0;
            const avgVoltage = m.count > 0 ? parseFloat((m._voltageSum / m.count).toFixed(1)) : 0;
            const avgCurrent = averageCurrent(m);
            const usageKwh = parseFloat(((avgPower / 1000) / 60).toFixed(5)); // Wh / 60 menit

            totalKwh += usageKwh;

            return {
                minute: m.minute,
                label: m.label,
                avgPower,
                avgVoltage,
                avgCurrent,
                currentSampleCount: m._currentCount || 0,
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
        res.status(error.status || 500).json({ error: error.message });
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

        if (id === "all") {
            const [logs, total] = await Promise.all([
                prisma.powerOutageLog.findMany({
                    orderBy: { startedAt: 'desc' },
                    take: limit,
                    skip,
                    include: { device: true }
                }),
                prisma.powerOutageLog.count()
            ]);
            
            const formattedLogs = logs.map(l => ({
                ...l,
                deviceName: l.device?.name || "Unknown",
                location: l.device?.location || "",
                durationFormatted: l.durationSec ? formatDuration(l.durationSec) : null,
                status: l.endedAt ? 'SELESAI' : 'BERLANGSUNG'
            }));
            
            return res.json({ total, page, limit, logs: formattedLogs });
        }

        const [logs, total] = await Promise.all([
            prisma.powerOutageLog.findMany({
                where: { deviceId: id },
                orderBy: { startedAt: 'desc' },
                take: limit,
                skip,
                include: { device: true }
            }),
            prisma.powerOutageLog.count({
                where: { deviceId: id },
            }),
        ]);

        // Format durasi yang lebih readable
        const formattedLogs = logs.map(l => ({
            ...l,
            deviceName: l.device?.name || "Unknown",
            location: l.device?.location || "",
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

/**
 * =========================================================================
 * 11. ALIN NILM Disaggregation & Realtime Load Profiling (Khusus Kos)
 * =========================================================================
 */

// GET /pzem/:id/available-dates
router.get("/pzem/:id/available-dates", async (req, res) => {
    try {
        const { id } = req.params;
        const curDate = new Date();
        const curYear = curDate.getFullYear();
        const curMonth = curDate.getMonth() + 1;

        // Ambil snapshot 60 hari terakhir
        const snapshots = await prisma.pzemDailySnapshot.findMany({
            where: { deviceId: id, deltaKwh: { gt: 0 } },
            orderBy: { date: "desc" },
            take: 60
        });

        const monthNames = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
        const todayStr = curDate.toISOString().slice(0, 10);
        const yesterday = new Date(curDate);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().slice(0, 10);

        const dateMap = new Map();

        // Tambahkan hari ini dan kemarin
        dateMap.set(todayStr, {
            date: todayStr,
            label: `${String(curDate.getDate()).padStart(2, '0')} ${monthNames[curMonth - 1]} ${curYear} (Hari Ini)`,
            kwh: 0,
            isToday: true,
            isYesterday: false
        });

        snapshots.forEach(s => {
            const dateStr = s.date.toISOString().slice(0, 10);
            const d = new Date(s.date);
            const isToday = (dateStr === todayStr);
            const isYesterday = (dateStr === yesterdayStr);
            let label = `${String(d.getDate()).padStart(2, '0')} ${monthNames[d.getMonth()]} ${d.getFullYear()}`;
            if (isToday) label += " (Hari Ini)";
            else if (isYesterday) label += " (Kemarin)";

            dateMap.set(dateStr, {
                date: dateStr,
                label,
                kwh: Number(s.deltaKwh) || 0,
                isToday,
                isYesterday
            });
        });

        const dates = Array.from(dateMap.values()).sort((a, b) => b.date.localeCompare(a.date));

        // Format bulan
        const monthMap = new Map();
        snapshots.forEach(s => {
            const d = new Date(s.date);
            const m = d.getMonth() + 1;
            const y = d.getFullYear();
            const key = `${y}-${m}`;
            const existing = monthMap.get(key) || { month: m, year: y, label: `${monthNames[m - 1]} ${y}`, kwh: 0 };
            existing.kwh += Number(s.deltaKwh) || 0;
            monthMap.set(key, existing);
        });

        const months = Array.from(monthMap.values()).sort((a, b) => (b.year * 100 + b.month) - (a.year * 100 + a.month));

        res.json({
            deviceId: id,
            dates,
            months,
            years: [2026]
        });
    } catch (error) {
        log.error("available-dates error", error.message);
        res.status(500).json({ error: error.message });
    }
});

// GET /pzem/:id/alin-realtime
router.get("/pzem/:id/alin-realtime", async (req, res) => {
    try {
        const { id } = req.params;
        const latestLog = await prisma.pzemLog.findFirst({
            where: { deviceId: id },
            orderBy: { createdAt: "desc" }
        });

        const analysis = analyzeRealtimeLoad(latestLog);
        res.json({
            deviceId: id,
            ...analysis
        });
    } catch (error) {
        log.error("alin-realtime error", error.message);
        res.status(500).json({ error: error.message });
    }
});

// GET /pzem/:id/alin-disaggregation?granularity=minutely|hourly|daily|monthly|yearly&date=YYYY-MM-DD&hour=14&year=2026&month=11
router.get("/pzem/:id/alin-disaggregation", async (req, res) => {
    try {
        const { id } = req.params;
        const granularity = req.query.granularity || "hourly";
        const targetDateStr = req.query.date ? String(req.query.date) : new Date().toISOString().slice(0, 10);
        const [yearStr, monthStr, dayStr] = targetDateStr.split("-").map(Number);
        const reqYear = Number(req.query.year) || yearStr || new Date().getFullYear();
        const reqMonth = Number(req.query.month) || monthStr || (new Date().getMonth() + 1);

        let series = [];
        let stepDurationHours = 1 / 60;

        if (granularity === "minutely") {
            const reqHour = req.query.hour !== undefined && req.query.hour !== "" ? Number(req.query.hour) : null;
            let startDate, endDate;

            if (reqHour !== null && !isNaN(reqHour)) {
                startDate = new Date(yearStr, monthStr - 1, dayStr, reqHour, 0, 0, 0);
                endDate = new Date(yearStr, monthStr - 1, dayStr, reqHour, 59, 59, 999);
            } else {
                startDate = new Date(yearStr, monthStr - 1, dayStr, 0, 0, 0, 0);
                endDate = new Date(yearStr, monthStr - 1, dayStr, 23, 59, 59, 999);
            }

            const logs = await prisma.pzemLog.findMany({
                where: { deviceId: id, createdAt: { gte: startDate, lte: endDate } },
                orderBy: { createdAt: "asc" }
            });

            const minMap = {};
            const totalMinutes = reqHour !== null ? 60 : 1440;
            const startOffsetMin = reqHour !== null ? reqHour * 60 : 0;

            for (let idx = 0; idx < totalMinutes; idx++) {
                const totalM = startOffsetMin + idx;
                const h = Math.floor(totalM / 60);
                const m = totalM % 60;
                const label = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
                minMap[totalM] = {
                    minuteIndex: totalM,
                    label,
                    count: 0,
                    _powerSum: 0,
                    _voltageSum: 0,
                    _currentSum: 0
                };
            }

            for (const l of logs) {
                const d = new Date(l.createdAt);
                const totalM = d.getHours() * 60 + d.getMinutes();
                if (minMap[totalM]) {
                    minMap[totalM].count++;
                    minMap[totalM]._powerSum += Number(l.power) || 0;
                    minMap[totalM]._voltageSum += Number(l.voltage) || 0;
                    minMap[totalM]._currentSum += Number(l.current) || 0;
                }
            }

            series = Object.values(minMap).map(m => {
                const avgPower = m.count > 0 ? +(m._powerSum / m.count).toFixed(1) : 0;
                const avgVoltage = m.count > 0 ? +(m._voltageSum / m.count).toFixed(1) : 220;
                const avgCurrent = m.count > 0 ? +(m._currentSum / m.count).toFixed(2) : +(avgPower / avgVoltage).toFixed(2);
                return {
                    label: m.label,
                    avgPower,
                    avgVoltage,
                    avgCurrent,
                    usageKwh: +(avgPower / 1000 / 60).toFixed(5)
                };
            });
            stepDurationHours = 1 / 60;

        } else if (granularity === "hourly") {
            const startDate = new Date(yearStr, monthStr - 1, dayStr, 0, 0, 0, 0);
            const endDate = new Date(yearStr, monthStr - 1, dayStr, 23, 59, 59, 999);

            const logs = await prisma.pzemLog.findMany({
                where: { deviceId: id, createdAt: { gte: startDate, lte: endDate } },
                orderBy: { createdAt: "asc" }
            });

            const hourMap = {};
            for (let h = 0; h < 24; h++) {
                hourMap[h] = {
                    hour: h,
                    label: `${String(h).padStart(2, '0')}:00`,
                    count: 0,
                    _powerSum: 0,
                    _voltageSum: 0,
                    _currentSum: 0
                };
            }

            for (const l of logs) {
                const h = new Date(l.createdAt).getHours();
                if (hourMap[h]) {
                    hourMap[h].count++;
                    hourMap[h]._powerSum += Number(l.power) || 0;
                    hourMap[h]._voltageSum += Number(l.voltage) || 0;
                    hourMap[h]._currentSum += Number(l.current) || 0;
                }
            }

            series = Object.values(hourMap).map(h => {
                const avgPower = h.count > 0 ? +(h._powerSum / h.count).toFixed(1) : 0;
                const avgVoltage = h.count > 0 ? +(h._voltageSum / h.count).toFixed(1) : 220;
                const avgCurrent = h.count > 0 ? +(h._currentSum / h.count).toFixed(2) : +(avgPower / avgVoltage).toFixed(2);
                return {
                    label: h.label,
                    avgPower,
                    avgVoltage,
                    avgCurrent,
                    usageKwh: +(avgPower / 1000).toFixed(4)
                };
            });
            stepDurationHours = 1;

        } else if (granularity === "daily") {
            const daysInMonth = new Date(reqYear, reqMonth, 0).getDate();
            const startDate = new Date(reqYear, reqMonth - 1, 1, 0, 0, 0);
            const endDate = new Date(reqYear, reqMonth - 1, daysInMonth, 23, 59, 59);

            const snapshots = await prisma.pzemDailySnapshot.findMany({
                where: { deviceId: id, date: { gte: startDate, lte: endDate } },
                orderBy: { date: "asc" }
            });

            const snapMap = {};
            snapshots.forEach(s => {
                const dayNum = new Date(s.date).getDate();
                snapMap[dayNum] = s;
            });

            series = Array.from({ length: daysInMonth }, (_, idx) => {
                const day = idx + 1;
                const snap = snapMap[day];
                const kwh = snap ? Number(snap.deltaKwh) || 0 : 0;
                const avgPower = +(kwh * 1000 / 24).toFixed(1);
                const avgVoltage = snap ? Number(snap.avgVoltage) || 220 : 220;
                const avgCurrent = +(avgPower / avgVoltage).toFixed(2);
                return {
                    label: `Tgl ${String(day).padStart(2, '0')}`,
                    avgPower,
                    avgVoltage,
                    avgCurrent,
                    usageKwh: kwh
                };
            });
            stepDurationHours = 24;

        } else if (granularity === "monthly") {
            const startDate = new Date(reqYear, 0, 1);
            const endDate = new Date(reqYear, 11, 31, 23, 59, 59);

            const snapshots = await prisma.pzemDailySnapshot.findMany({
                where: { deviceId: id, date: { gte: startDate, lte: endDate } },
                orderBy: { date: "asc" }
            });

            const monthMap = {};
            for (let m = 1; m <= 12; m++) monthMap[m] = 0;
            snapshots.forEach(s => {
                const m = new Date(s.date).getMonth() + 1;
                monthMap[m] += Number(s.deltaKwh) || 0;
            });

            const monthNames = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
            series = Array.from({ length: 12 }, (_, idx) => {
                const m = idx + 1;
                const kwh = +monthMap[m].toFixed(3);
                const avgPower = +(kwh * 1000 / (30 * 24)).toFixed(1);
                return {
                    label: `${monthNames[idx]} ${reqYear}`,
                    avgPower,
                    avgVoltage: 220,
                    avgCurrent: +(avgPower / 220).toFixed(2),
                    usageKwh: kwh
                };
            });
            stepDurationHours = 24 * 30;

        } else if (granularity === "yearly") {
            const curY = new Date().getFullYear();
            const startY = curY - 4;
            const startDate = new Date(startY, 0, 1);
            const endDate = new Date(curY, 11, 31, 23, 59, 59);

            const snapshots = await prisma.pzemDailySnapshot.findMany({
                where: { deviceId: id, date: { gte: startDate, lte: endDate } },
                orderBy: { date: "asc" }
            });

            const yearMap = {};
            for (let y = startY; y <= curY; y++) yearMap[y] = 0;
            snapshots.forEach(s => {
                const y = new Date(s.date).getFullYear();
                if (yearMap[y] !== undefined) yearMap[y] += Number(s.deltaKwh) || 0;
            });

            series = Object.keys(yearMap).map(y => {
                const kwh = +yearMap[y].toFixed(3);
                const avgPower = +(kwh * 1000 / (365 * 24)).toFixed(1);
                return {
                    label: `Tahun ${y}`,
                    avgPower,
                    avgVoltage: 220,
                    avgCurrent: +(avgPower / 220).toFixed(2),
                    usageKwh: kwh
                };
            });
            stepDurationHours = 24 * 365;
        }

        const result = disaggregateTimeSeries(series, stepDurationHours);
        res.json({
            deviceId: id,
            granularity,
            targetDate: targetDateStr,
            year: reqYear,
            month: reqMonth,
            ...result
        });
    } catch (error) {
        log.error("alin-disaggregation error", error.message);
        res.status(500).json({ error: error.message });
    }
});

export default router;