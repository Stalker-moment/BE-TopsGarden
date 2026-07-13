import { PrismaClient } from "@prisma/client";
import axios from "axios";

const prisma = new PrismaClient();
const deviceId = "fa7daf1f-b10f-4480-80f3-80e306484365";
const apiUrl = "http://localhost:2025/api/device/pzem/data";

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
    console.log("=== PZEM DELAY & AUTO-RECONNECT SIMULATOR ===");
    
    // 1. Initializing / Resetting device parameters in DB
    const device = await prisma.pzemDevice.upsert({
        where: { id: deviceId },
        update: {
            name: "Washing Machine & Booster",
            location: "Laundry Room",
            hasRelay: true,
            overcurrentThreshold: 5.0,
            overcurrentDelay: 3,       // 3 seconds delay before trip
            autoReconnect: true,       // Enable auto-reconnect
            reconnectDelay: 6,         // 6 seconds cooldown
            relayState: true,
            isActive: true
        },
        create: {
            id: deviceId,
            name: "Washing Machine & Booster",
            location: "Laundry Room",
            hasRelay: true,
            overcurrentThreshold: 5.0,
            overcurrentDelay: 3,
            autoReconnect: true,
            reconnectDelay: 6,
            relayState: true,
            isActive: true
        }
    });

    console.log("Device upserted in DB:", {
        id: device.id,
        name: device.name,
        overcurrentThreshold: 5.0,
        overcurrentDelay: 3,
        autoReconnect: true,
        reconnectDelay: 6
    });

    let current = 1.2; // 1.2A is normal load
    let relayState = true;
    let overcurrentThreshold = 5.0;
    let overcurrentDelaySec = 3;
    let autoReconnectVal = true;
    let reconnectDelaySec = 6;

    // Timer variables matching ESP32 firmware
    let overcurrentStartTime = 0;
    let isLocalTripped = false;
    let tripTime = 0;

    for (let step = 1; step <= 10; step++) {
        console.log(`\n--- Step ${step} ---`);
        let elapsedMillis = step * 2000; // 2 seconds per loop

        // At Step 3, we simulate a spike (current goes to 6.5A, exceeding limit of 5.0A)
        // This spike will persist until we trip.
        if (step >= 3 && step < 5) {
            console.log("[SIMULATION] Booster Pump experiences overcurrent (6.5A). Testing delay filter...");
            current = 6.5;
        }

        // ESP32 LOCAL OVERCURRENT TIMER LOGIC
        if (relayState && current > overcurrentThreshold) {
            if (overcurrentDelaySec === 0) {
                relayState = false;
                isLocalTripped = true;
                tripTime = elapsedMillis;
                console.log(`[LOCAL TRIP] Instant trip! Current: ${current}A > Threshold: ${overcurrentThreshold}A.`);
            } else {
                if (overcurrentStartTime === 0) {
                    overcurrentStartTime = elapsedMillis;
                    console.log(`[LOCAL TIMER] Overcurrent detected. Starting trip delay timer (${overcurrentDelaySec}s)...`);
                } else if (elapsedMillis - overcurrentStartTime >= (overcurrentDelaySec * 1000)) {
                    relayState = false;
                    isLocalTripped = true;
                    tripTime = elapsedMillis;
                    console.log(`[LOCAL TRIP] Overcurrent limit exceeded for consistently ${overcurrentDelaySec}s! Relay physically TRIPPED to OFF.`);
                    overcurrentStartTime = 0;
                } else {
                    console.log(`[LOCAL TIMER] Overcurrent count: ${((elapsedMillis - overcurrentStartTime) / 1000).toFixed(1)}s / ${overcurrentDelaySec}s. Relay stays CONNECTED.`);
                }
            }
        } else {
            overcurrentStartTime = 0;
        }

        // ESP32 LOCAL AUTO-RECONNECT LOGIC
        if (isLocalTripped && !relayState && autoReconnectVal) {
            let elapsedCooldown = (elapsedMillis - tripTime) / 1000;
            if (elapsedCooldown >= reconnectDelaySec) {
                relayState = true;
                isLocalTripped = false;
                current = 1.2; // Load returns to normal after reconnecting
                console.log(`[AUTO-RECONNECT] Cooldown completed (${reconnectDelaySec}s). Relay automatically reconnected to ON.`);
            } else {
                console.log(`[AUTO-RECONNECT] Cooldown countdown: ${elapsedCooldown}s / ${reconnectDelaySec}s.`);
            }
        }

        // If relay is OFF, current drops to 0
        if (!relayState) {
            current = 0.0;
        }

        console.log(`[ESP32 -> API] Sending: V=220V, A=${current}A, W=${(220 * current).toFixed(1)}W, RelayState=${relayState}, Threshold=${overcurrentThreshold}A, Delay=${overcurrentDelaySec}s, AutoRec=${autoReconnectVal}, RecDelay=${reconnectDelaySec}s`);

        try {
            const res = await axios.post(apiUrl, {
                deviceId,
                voltage: 220.0,
                current: current,
                power: 220 * current,
                energy: 12.45 + (step * 0.001),
                frequency: 50.0,
                pf: 0.95,
                relayState: relayState,
                overcurrentThreshold: overcurrentThreshold,
                overcurrentDelay: overcurrentDelaySec,
                autoReconnect: autoReconnectVal,
                reconnectDelay: reconnectDelaySec
            });

            console.log("[API -> ESP32] Response:", {
                status: res.data.status,
                relayState: res.data.relayState,
                overcurrentThreshold: res.data.overcurrentThreshold,
                overcurrentDelay: res.data.overcurrentDelay,
                autoReconnect: res.data.autoReconnect,
                reconnectDelay: res.data.reconnectDelay
            });

            // Sync from server
            if (res.data.relayState !== undefined && relayState !== res.data.relayState) {
                // If it wasn't a local trip, sync relay from server
                if (!isLocalTripped) {
                    relayState = res.data.relayState;
                    console.log(`[ESP32] Syncing relayState from server: ${relayState}`);
                }
            }
            if (res.data.overcurrentThreshold !== undefined) overcurrentThreshold = res.data.overcurrentThreshold;
            if (res.data.overcurrentDelay !== undefined) overcurrentDelaySec = res.data.overcurrentDelay;
            if (res.data.autoReconnect !== undefined) autoReconnectVal = res.data.autoReconnect;
            if (res.data.reconnectDelay !== undefined) reconnectDelaySec = res.data.reconnectDelay;

        } catch (err) {
            console.error("[ERROR] Failed to send telemetry:", err.message);
        }

        await delay(2000);
    }

    console.log("\n=== SIMULATION ENDED ===");
    process.exit(0);
}

main().catch(err => {
    console.error("Simulator failed:", err);
    process.exit(1);
});
