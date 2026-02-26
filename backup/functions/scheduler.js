import cron from "node-cron";
import moment from "moment-timezone";
import { prisma } from "../prisma/client.js";
import { createLogger } from "../helper/logger.js";

const log = createLogger("Scheduler");

// Scheduler jalan tiap 10 detik
cron.schedule("*/10 * * * * *", async () => {
    try {
        log.info("Menjalankan pengecekan mode AUTO");

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
                        onTime.subtract(1, "day"); // Mundurkan onTime agar logika tetap valid
                    } else {
                        offTime.add(1, "day"); // Geser offTime ke hari berikutnya
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
        log.error("Error pada scheduler", error.message);
    }
});