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

            let newState = lastState.state; // Default tetap sama

            // 🔵 Mode AUTO_SUN
            if (lastState.mode === "AUTO_SUN") {
                if (currentTime >= "17:30" || currentTime < "06:00") {
                    newState = true; // Hidup di malam hari
                } else {
                    newState = false; // Mati di siang hari
                }
            }

            // 🟡 Mode AUTO_DATETIME
            if (lastState.mode === "AUTO_DATETIME" && lastState.turnOnTime && lastState.turnOffTime) {
                if (currentTime >= lastState.turnOnTime && currentTime < lastState.turnOffTime) {
                    newState = true; // Hidup dalam rentang waktu yang ditentukan
                } else {
                    newState = false; // Mati di luar rentang waktu
                }
            }

            // Jika state berubah, update ke database
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