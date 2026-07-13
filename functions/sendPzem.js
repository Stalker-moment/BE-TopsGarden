import { prisma } from "../prisma/client.js";
import si from "systeminformation";

const DEVICE_ONLINE_THRESHOLD_MS = 30_000; // 30 detik

// Cache untuk data yang jarang berubah (server battery & outage logs)
let batteryCache = null;
let batteryCacheAt = 0;
const BATTERY_CACHE_TTL = 30_000; // refresh baterai tiap 30s

// Outage log cache per deviceId
const outageLogCache = new Map(); // deviceId -> { logs, total, cachedAt }
const OUTAGE_CACHE_TTL = 60_000; // refresh outage tiap 60s

// Mengambil data terakhir dari setiap device PZEM yang aktif
const sendPzem = async () => {
    try {
        const devices = await prisma.pzemDevice.findMany({
            where: { isActive: true },
            select: {
                id: true,
                name: true,
                location: true,
                hasRelay: true,
                relayState: true,
                overcurrentThreshold: true,
                overcurrentDelay: true,
                autoReconnect: true,
                reconnectDelay: true
            }
        });

        const now = Date.now();

        // === Server Battery (cached 30s) ===
        if (now - batteryCacheAt > BATTERY_CACHE_TTL) {
            try {
                const batteryInfo = await si.battery();
                if (batteryInfo.hasBattery) {
                    const [cpuTemp, mem] = await Promise.all([
                        si.cpuTemperature().catch(() => null),
                        si.mem().catch(() => null),
                    ]);
                    batteryCache = {
                        hasBattery: true,
                        percent: batteryInfo.percent ?? null,
                        isCharging: batteryInfo.isCharging ?? false,
                        acConnected: batteryInfo.acConnected ?? false,
                        timeRemaining: batteryInfo.timeRemaining ?? null,
                        cpuTempMax: cpuTemp ? (cpuTemp.max || cpuTemp.main || null) : null,
                        memUsedPercent: mem ? parseFloat(((mem.active / mem.total) * 100).toFixed(1)) : null,
                        fetchedAt: new Date().toISOString(),
                    };
                } else {
                    batteryCache = { hasBattery: false };
                }
                batteryCacheAt = now;
            } catch { /* silent — server battery optional */ }
        }

        const results = await Promise.all(devices.map(async (device) => {
            const logs = await prisma.pzemLog.findMany({
                where: { deviceId: device.id },
                orderBy: { createdAt: 'desc' },
                take: 50
            });

            const latest = logs.length > 0 ? logs[0] : null;
            const lastUpdateMs = latest ? new Date(latest.createdAt).getTime() : null;

            // isOnline: true jika data terakhir diterima dalam 30 detik terakhir
            const isOnline = lastUpdateMs !== null && (now - lastUpdateMs) < DEVICE_ONLINE_THRESHOLD_MS;

            // === Outage Logs (cached 60s per device) ===
            let outageData = outageLogCache.get(device.id);
            if (!outageData || (now - outageData.cachedAt) > OUTAGE_CACHE_TTL) {
                try {
                    const [outageLogs, outageTotal] = await Promise.all([
                        prisma.powerOutageLog.findMany({
                            where: { deviceId: device.id },
                            orderBy: { startedAt: 'desc' },
                            take: 10,
                        }),
                        prisma.powerOutageLog.count({ where: { deviceId: device.id } })
                    ]);
                    outageData = { logs: outageLogs, total: outageTotal, cachedAt: now };
                    outageLogCache.set(device.id, outageData);
                } catch {
                    outageData = { logs: [], total: 0, cachedAt: now };
                }
            }

            return {
                ...device,
                lastUpdate: latest ? latest.createdAt : null,
                isOnline,                          // dari backend
                data: latest || null,              // data terupdate (kartu dashboard)
                logs: logs.slice(0, 20),           // 20 data terakhir untuk tabel riwayat
                chart: [...logs].reverse(),        // 50 data di-reverse untuk grafik
                outageLogs: outageData.logs,       // outage logs per device (cached)
                outageTotal: outageData.total,
            };
        }));

        return {
            devices: results,
            serverBattery: batteryCache,
        };
    } catch (error) {
        console.error("Error fetching PZEM data:", error);
        return { devices: [], serverBattery: null };
    }
};

export default sendPzem;