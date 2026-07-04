import cron from "node-cron";
import moment from "moment-timezone";
import { prisma } from "../prisma/client.js";
import { createLogger } from "../helper/logger.js";

const log = createLogger("Scheduler");

// === CRON 1: Auto Mode Output (setiap 10 detik) ===
cron.schedule("*/10 * * * * *", async () => {
    try {
        const outputs = await prisma.output.findMany({
            include: {
                states: {
                    orderBy: { createdAt: "desc" },
                    take: 1,
                },
            },
        });

        const now = moment().tz("Asia/Jakarta");

        for (const output of outputs) {
            const lastState = output.states[0];
            if (!lastState) continue;

            let newState = lastState.state;

            // Mode AUTO_SUN
            if (lastState.mode === "AUTO_SUN") {
                const currentTime = now.format("HH:mm");
                newState = currentTime >= "17:30" || currentTime < "06:00";
            }

            // Mode AUTO_DATETIME
            if (
                lastState.mode === "AUTO_DATETIME" &&
                lastState.turnOnTime &&
                lastState.turnOffTime
            ) {
                const onTime = moment.tz(lastState.turnOnTime, "HH:mm", "Asia/Jakarta");
                let offTime = moment.tz(lastState.turnOffTime, "HH:mm", "Asia/Jakarta");

                // Tambah hari ke offTime jika offTime < onTime (lintas tengah malam)
                if (offTime.isBefore(onTime)) {
                    if (now.isBefore(offTime)) {
                        onTime.subtract(1, "day");
                    } else {
                        offTime.add(1, "day");
                    }
                }

                newState = now.isBetween(onTime, offTime);
            }

            // Update state jika berubah
            if (newState !== lastState.state) {
                await prisma.outputState.create({
                    data: {
                        outputId: output.id,
                        state: newState,
                        mode: lastState.mode,
                        turnOnTime: lastState.turnOnTime,
                        turnOffTime: lastState.turnOffTime,
                    },
                });

                log.info("Output berubah karena mode", {
                    outputName: output.name,
                    state: newState,
                    mode: lastState.mode,
                });
            }
        }
    } catch (error) {
        log.error("Error pada scheduler output auto mode", error.message);
    }
});


// === CRON 2: Midnight Snapshot kWh PZEM (setiap tengah malam WIB) ===
// Dijalankan jam 00:00:00 setiap hari (Asia/Jakarta)
cron.schedule("0 0 * * *", async () => {
    const snapshotTime = moment().tz("Asia/Jakarta");
    log.info("Menjalankan midnight snapshot kWh PZEM", { time: snapshotTime.format() });

    try {
        const devices = await prisma.pzemDevice.findMany({
            where: { isActive: true },
        });

        for (const device of devices) {
            try {
                // Ambil log terbaru untuk mendapatkan nilai energy saat ini
                const latestLog = await prisma.pzemLog.findFirst({
                    where: { deviceId: device.id },
                    orderBy: { createdAt: "desc" },
                });

                if (!latestLog) {
                    log.warn("No PZEM log for snapshot", { deviceId: device.id });
                    continue;
                }

                const currentEnergy = latestLog.energy;

                // Ambil snapshot kemarin untuk menghitung delta
                const yesterdayStart = snapshotTime.clone().subtract(1, "day").startOf("day").toDate();
                const yesterdayEnd = snapshotTime.clone().subtract(1, "day").endOf("day").toDate();

                const yesterdaySnapshot = await prisma.pzemDailySnapshot.findFirst({
                    where: {
                        deviceId: device.id,
                        date: { gte: yesterdayStart, lte: yesterdayEnd },
                    },
                });

                let deltaKwh = null;
                let isResetDay = false;

                if (yesterdaySnapshot) {
                    if (currentEnergy >= yesterdaySnapshot.energyKwh) {
                        // Normal: hitung selisih
                        deltaKwh = currentEnergy - yesterdaySnapshot.energyKwh;
                    } else {
                        // KWh counter di-reset! Gunakan nilai saat ini sebagai konsumsi sejak reset
                        deltaKwh = currentEnergy;
                        isResetDay = true;
                        log.warn("KWh reset terdeteksi pada snapshot", {
                            deviceId: device.id,
                            prev: yesterdaySnapshot.energyKwh,
                            current: currentEnergy,
                        });
                    }
                }

                // Tanggal snapshot (hari ini, pukul 00:00 WIB, dalam UTC)
                const snapshotDate = snapshotTime.clone().startOf("day").toDate();

                // Simpan atau update snapshot (upsert)
                await prisma.pzemDailySnapshot.upsert({
                    where: {
                        deviceId_date: {
                            deviceId: device.id,
                            date: snapshotDate,
                        },
                    },
                    update: { energyKwh: currentEnergy, deltaKwh, isResetDay },
                    create: {
                        deviceId: device.id,
                        energyKwh: currentEnergy,
                        deltaKwh,
                        isResetDay,
                        date: snapshotDate,
                    },
                });

                log.info("Snapshot kWh tersimpan", {
                    deviceId: device.id,
                    energy: currentEnergy,
                    delta: deltaKwh,
                    isResetDay,
                });
            } catch (deviceErr) {
                log.error("Gagal snapshot kWh untuk device", { deviceId: device.id, error: deviceErr.message });
            }
        }
    } catch (error) {
        log.error("Error pada midnight snapshot kWh", error.message);
    }
}, {
    timezone: "Asia/Jakarta"
});


// === CRON 3: Monitor Mati Listrik / Matlis (setiap 30 detik) ===
// Jika voltage < VOLTAGE_OUTAGE_THRESHOLD → catat mulai matlis
// Jika voltage normal kembali → catat selesai & hitung durasi
const VOLTAGE_OUTAGE_THRESHOLD = Number(process.env.VOLTAGE_OUTAGE_THRESHOLD || 10); // Volt

// Map untuk melacak state matlis per device: { deviceId -> outageLogId }
const activeOutages = new Map();

cron.schedule("*/30 * * * * *", async () => {
    try {
        const devices = await prisma.pzemDevice.findMany({
            where: { isActive: true },
        });

        for (const device of devices) {
            try {
                // Ambil log terbaru dalam 2 menit terakhir
                const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
                const latestLog = await prisma.pzemLog.findFirst({
                    where: {
                        deviceId: device.id,
                        createdAt: { gte: twoMinutesAgo },
                    },
                    orderBy: { createdAt: "desc" },
                });

                const now = new Date();
                const isOutage = !latestLog || latestLog.voltage < VOLTAGE_OUTAGE_THRESHOLD;
                const lastVoltage = latestLog ? latestLog.voltage : 0;
                const activeOutageId = activeOutages.get(device.id);

                if (isOutage && !activeOutageId) {
                    // Matlis baru terdeteksi → buat log
                    const outageLog = await prisma.powerOutageLog.create({
                        data: {
                            deviceId: device.id,
                            startedAt: now,
                            lastVoltage,
                        },
                    });
                    activeOutages.set(device.id, outageLog.id);
                    log.warn("Matlis terdeteksi!", {
                        deviceId: device.id,
                        voltage: lastVoltage,
                        outageLogId: outageLog.id,
                    });

                } else if (!isOutage && activeOutageId) {
                    // Tegangan normal kembali → tutup log matlis
                    const outageLog = await prisma.powerOutageLog.findUnique({
                        where: { id: activeOutageId },
                    });

                    if (outageLog) {
                        const durationSec = Math.round((now.getTime() - outageLog.startedAt.getTime()) / 1000);
                        await prisma.powerOutageLog.update({
                            where: { id: activeOutageId },
                            data: {
                                endedAt: now,
                                durationSec,
                            },
                        });
                        log.info("Listrik kembali normal", {
                            deviceId: device.id,
                            durationSec,
                        });
                    }
                    activeOutages.delete(device.id);
                }
            } catch (deviceErr) {
                log.error("Gagal monitor matlis untuk device", { deviceId: device.id, error: deviceErr.message });
            }
        }
    } catch (error) {
        log.error("Error pada monitor matlis", error.message);
    }
});