import express from "express";
import dotenv from "dotenv";
import { prisma } from "../../prisma/client.js";
import { createLogger } from "../../helper/logger.js";

dotenv.config();

const router = express.Router();
const log = createLogger("DeviceOutputController");

// 🟢 Tambah Output Baru
router.post("/output", async (req, res) => {
  try {
    const { name } = req.body;

    // Cek apakah output sudah ada
    const existingOutput = await prisma.output.findUnique({
      where: { name },
    });

    if (existingOutput) {
      return res.status(400).json({ message: "Output sudah ada" });
    }

    const newOutput = await prisma.output.create({
      data: { name },
    });

    log.info("Output baru dibuat", { outputId: newOutput.id, name });

    res.status(201).json({
      message: "Output berhasil dibuat",
      output: newOutput,
    });
  } catch (error) {
    log.error("Gagal membuat output", error.message);
    res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

router.put("/output/:id", async (req, res) => {
  try {
    const { id } = req.params;
    let { state, mode, turnOnTime, turnOffTime } = req.body;

    // Cek apakah output ada
    const output = await prisma.output.findUnique({
      where: { id },
    });

    if (!output) {
      return res.status(404).json({ message: "Output tidak ditemukan" });
    }

    // Ambil state terbaru
    const lastState = await prisma.outputState.findFirst({
      where: { outputId: id },
      orderBy: { createdAt: "desc" },
    });

    // Jika mode adalah AUTO_DATETIME atau AUTO_SUN, state tidak boleh diubah oleh user
    if (mode === "AUTO_DATETIME" || mode === "AUTO_SUN") {
      state = lastState?.state ?? false; // Abaikan state dari user
      log.warn("State diabaikan karena mode AUTO", { mode, requestedState: req.body.state });
    }

    // 🔥 Perbaikan: Hanya gunakan state sebelumnya jika mode AUTO_DATETIME / AUTO_SUN
    const newState = await prisma.outputState.create({
      data: {
        outputId: id,
        state: mode === "MANUAL" ? state : lastState?.state ?? false, // Mode MANUAL pakai state dari frontend
        mode,
        turnOnTime: mode === "AUTO_DATETIME" ? turnOnTime : null,
        turnOffTime: mode === "AUTO_DATETIME" ? turnOffTime : null,
      },
    });

    log.info("Output diperbarui", { outputId: id, mode, state: newState.state });

    res.status(200).json({
      message: "Output berhasil diperbarui",
      output: newState,
    });
  } catch (error) {
    log.error("Gagal memperbarui output", error.message);
    res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

// 🔵 Edit Nama Output
router.patch("/output/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    if (!name) {
      return res
        .status(400)
        .json({ message: "Nama output tidak boleh kosong" });
    }

    const updatedOutput = await prisma.output.update({
      where: { id },
      data: { name },
    });

    log.info("Nama output diperbarui", { outputId: id, name });

    res.status(200).json({
      message: "Nama output berhasil diperbarui",
      output: updatedOutput,
    });
  } catch (error) {
    log.error("Gagal memperbarui nama output", error.message);
    res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

// 🟢 Mendapatkan Semua Output dengan Pagination
router.get("/outputs", async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit, 10) || 10, 1);
    const skip = (page - 1) * limit;

    log.info("Mengambil semua output dengan pagination", { page, limit });

    const [outputs, total] = await Promise.all([
      prisma.output.findMany({
        skip,
        take: limit,
        include: {
          states: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      }),
      prisma.output.count(),
    ]);

    res.status(200).json({
      message: "Data output berhasil diambil",
      data: {
        items: outputs,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    log.error("Gagal mengambil semua output", error.message);
    res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

router.get("/output-device", async (req, res) => {
  try {
    log.info("Device IoT mengambil output");
    const outputs = await prisma.output.findMany({
      include: {
        states: {
          orderBy: { createdAt: "desc" },
          take: 1, // Ambil status terbaru
        },
      },
    });

    const formattedResponse = outputs.map((output) => ({
      name: output.name,
      state: output.states.length > 0 ? output.states[0].state : false,
    }));

    res.status(200).json(formattedResponse);
  } catch (error) {
    log.error("Device IoT gagal mengambil output", error.message);
    res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

// 🟡 Mendapatkan Output Berdasarkan ID
router.get("/output/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const output = await prisma.output.findUnique({
      where: { id },
      include: {
        states: {
          orderBy: { createdAt: "desc" },
          take: 1, // Ambil status terbaru
        },
      },
    });

    if (!output) {
      return res.status(404).json({ message: "Output tidak ditemukan" });
    }

    res.status(200).json({
      message: "Data output berhasil diambil",
      output,
    });
  } catch (error) {
    log.error("Gagal mengambil detail output", { error: error.message, outputId: req.params.id });
    res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

export default router;
