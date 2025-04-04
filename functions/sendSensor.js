import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function sendSensor() {
  try {
    const sensors = await prisma.sensor.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    if (sensors.length === 0) {
      return {
        latest: null,
        history: {
          voltage: { value: [], timestamp: [] },
          ph: { value: [], timestamp: [] },
          temperature: { value: [], timestamp: [] },
          humidity: { value: [], timestamp: [] },
          ldr: { value: [], timestamp: [] },
        }
      };
    }

    const latest = {
      voltage: sensors[0].voltage,
      ph: sensors[0].ph,
      temperature: sensors[0].temperature,
      humidity: sensors[0].humidity,
      ldr: sensors[0].ldr,
      updatedAt: sensors[0].updatedAt.toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    };

    const reversedSensors = [...sensors].reverse();

    const formatTime = (date) =>
      date.toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

    const history = {
      voltage: {
        value: reversedSensors.map(s => s.voltage),
        timestamp: reversedSensors.map(s => formatTime(s.updatedAt)),
      },
      ph: {
        value: reversedSensors.map(s => s.ph),
        timestamp: reversedSensors.map(s => formatTime(s.updatedAt)),
      },
      temperature: {
        value: reversedSensors.map(s => s.temperature),
        timestamp: reversedSensors.map(s => formatTime(s.updatedAt)),
      },
      humidity: {
        value: reversedSensors.map(s => s.humidity),
        timestamp: reversedSensors.map(s => formatTime(s.updatedAt)),
      },
      ldr: {
        value: reversedSensors.map(s => s.ldr),
        timestamp: reversedSensors.map(s => formatTime(s.updatedAt)),
      },
    };

    return { latest, history };
  } catch (error) {
    console.error("Error fetching sensors:", error);
    throw error;
  }
}

export default sendSensor;