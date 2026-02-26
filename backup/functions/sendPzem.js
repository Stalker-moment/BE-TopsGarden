import { prisma } from "../prisma/client.js";

// Mengambil data terakhir dari setiap device PZEM yang aktif
const sendPzem = async () => {
    try {
        const devices = await prisma.pzemDevice.findMany({
            where: { isActive: true },
            select: { id: true, name: true, location: true }
        });

        const results = await Promise.all(devices.map(async (device) => {
            const latest = await prisma.pzemLog.findFirst({
                where: { deviceId: device.id },
                orderBy: { createdAt: 'desc' }
            });
            // Gabungkan info device dengan log terakhir
            return {
                ...device,
                lastUpdate: latest ? latest.createdAt : null,
                data: latest || null
            };
        }));

        return results;
    } catch (error) {
        console.error("Error fetching PZEM data:", error);
        return [];
    }
};

export default sendPzem;
