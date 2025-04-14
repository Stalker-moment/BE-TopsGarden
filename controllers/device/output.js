import express from "express";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();
const prisma = new PrismaClient();

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

    res.status(201).json({
      message: "Output berhasil dibuat",
      output: newOutput,
    });
  } catch (error) {
    console.error(error);
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
      console.log("State diabaikan karena mode AUTO_DATETIME atau AUTO_SUN");
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

    res.status(200).json({
      message: "Output berhasil diperbarui",
      output: newState,
    });
  } catch (error) {
    console.error(error);
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

    res.status(200).json({
      message: "Nama output berhasil diperbarui",
      output: updatedOutput,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

// 🟢 Mendapatkan Semua Output
router.get("/outputs", async (req, res) => {
  try {
    const timestamp = new Date().toISOString(); // Ambil timestamp saat ini
    console.log(`${timestamp} - Mendapatkan semua output`);
    const outputs = await prisma.output.findMany({
      include: {
        states: {
          orderBy: { createdAt: "desc" },
          take: 1, // Ambil status terbaru
        },
      },
    });

    res.status(200).json({
      message: "Data semua output berhasil diambil",
      outputs,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

router.get("/output-device", async (req, res) => {
  try {
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
    console.error(error);
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
    console.error(error);
    res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

export default router;
