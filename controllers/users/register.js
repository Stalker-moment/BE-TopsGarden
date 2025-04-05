import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();
const prisma = new PrismaClient();

router.post("/register", async (req, res) => {
  let { email, password, role, firstName, lastName, phone } = req.body;
  const { authorization } = req.headers;

  email = email.toLowerCase(); // Normalisasi email ke huruf kecil

  if (!authorization) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const token = authorization.replace("Bearer ", "");

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (
      !["ADMIN", "DOSEN"].includes(decoded.role) ||
      decoded.expired < Date.now()
    ) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!email || !password || !role || !firstName || !lastName || !phone) {
      return res.status(400).json({ error: "Please fill all required fields" });
    }

    if (!["ADMIN", "USER", "MAHASISWA", "DOSEN", "MAGANG"].includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }

    const accountExists = await prisma.account.findUnique({ where: { email } });

    if (accountExists) {
      return res.status(400).json({ error: "Account already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newAccount = await prisma.account.create({
      data: {
        email,
        password: hashedPassword,
        role,
        contact: {
          create: { firstName, lastName, email, phone },
        },
      },
    });

    return res.status(201).json({ message: "Account created" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

export default router;
