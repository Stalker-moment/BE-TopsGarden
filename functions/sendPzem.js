import { prisma } from "../prisma/client.js";

// Mengambil data terakhir dari setiap device PZEM yang aktif
const sendPzem = async () => {
    try {
        const devices = await prisma.pzemDevice.findMany({
            where: { isActive: true },
            select: { id: true, name: true, location: true }
        });

        const results = await Promise.all(devices.map(async (device) => {
            const logs = await prisma.pzemLog.findMany({
                where: { deviceId: device.id },
                orderBy: { createdAt: 'desc' },
                take: 50 // Ambil 50 data untuk kebutuhan realtime chart & logs
            });
            
            const latest = logs.length > 0 ? logs[0] : null;

            // Gabungkan info device dengan log terakhir
            return {
                ...device,
                lastUpdate: latest ? latest.createdAt : null,
                data: latest || null, // data terupdate (kartu dashboard)
                logs: logs.slice(0, 20), // 20 data terakhir untuk tabel riwayat
                chart: [...logs].reverse() // 50 data di-reverse untuk grafik (dari lama ke baru)
            };
        }));

        return results;
    } catch (error) {
        console.error("Error fetching PZEM data:", error);
        return [];
    }
};

export default sendPzem;