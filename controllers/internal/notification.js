import express from "express";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();
const prisma = new PrismaClient();

const authenticate = async (req, res, next) => {
  const { authorization } = req.headers;

  if (!authorization) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const token = authorization.replace("Bearer ", "");
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.expired < Date.now()) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const account = await prisma.account.findUnique({
      where: { email: decoded.email },
    });

    if (!account) {
      return res.status(404).json({ error: "Account not found" });
    }

    req.account = account;
    next();
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

router.get("/type", authenticate, (req, res) => {
  const type = ["BASIC", "INFO", "WARNING", "ERROR"];
  res.status(200).json({ type });
});

router.post("/add", authenticate, async (req, res) => {
  const { title, message, type, receive } = req.body;

  try {
    const notification = await prisma.notification.create({
      data: { title, message, type, receive },
    });

    res.status(200).json({ message: "Notification added successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/read", authenticate, async (req, res) => {
  const { id } = req.body;

  try {
    const notification = await prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });

    res.status(200).json({ message: "Notification updated successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;