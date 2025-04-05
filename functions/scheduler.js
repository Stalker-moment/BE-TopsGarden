import cron from "node-cron";
import { PrismaClient } from "@prisma/client";
import moment from "moment-timezone";

const prisma = new PrismaClient();

// 🟢 Scheduler untuk AUTO_SUN dan AUTO_DATETIME
cron.schedule("*/10 * * * * *", async () => {
    try {
        console.log("⏳ Menjalankan pengecekan mode AUTO_DATETIME & AUTO_SUN...");

        const outputs = await prisma.output.findMany({
            include: {
                states: {
                    orderBy: { createdAt: "desc" },
                    take: 1, // Ambil status terbaru
                },
            },
        });

        const now = moment().tz("Asia/Jakarta");
        const currentTime = now.format("HH:mm");

        for (const output of outputs) {
            const lastState = output.states[0];
            if (!lastState) continue; // Skip jika tidak ada state sebelumnya

            let newState = lastState.state; // Default: tetap pada state sebelumnya

            // 🔵 Mode AUTO_SUN
            if (lastState.mode === "AUTO_SUN") {
                newState = currentTime >= "17:30" || currentTime < "06:00";
            }

            // 🟡 Mode AUTO_DATETIME
            if (lastState.mode === "AUTO_DATETIME" && lastState.turnOnTime && lastState.turnOffTime) {
                const onTime = moment.tz(lastState.turnOnTime, "HH:mm", "Asia/Jakarta");
                const offTime = moment.tz(lastState.turnOffTime, "HH:mm", "Asia/Jakarta");

                if (onTime.isBefore(offTime)) {
                    // Kasus normal: 08:00 - 17:00
                    newState = now.isBetween(onTime, offTime);
                } else {
                    // Kasus melewati tengah malam: 17:30 - 05:30
                    const inFirstRange = now.isSameOrAfter(onTime);
                    const inSecondRange = now.isBefore(offTime);
                    newState = inFirstRange || inSecondRange;
                }
            }

            // ⬆️ Update ke DB jika ada perubahan
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

                console.log(`✅ Output ${output.name} berubah ke ${newState ? "HIDUP" : "MATI"} karena mode ${lastState.mode}`);
            }
        }
    } catch (error) {
        console.error("❌ Error pada scheduler:", error);
    }
});