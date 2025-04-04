import express from "express";
import bcrypt from "bcrypt";
import crypto from "crypto"; // Untuk generate token acak
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
dotenv.config();

import sendEmailResetPassword from "../../helper/sendEmail.js";

const prisma = new PrismaClient();
const router = express.Router();

router.post("/forgot/request", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: "Email is required" });
  }

  const account = await prisma.account.findUnique({
    where: { email },
  });

  if (!account) {
    return res
      .status(404)
      .json({ success: false, message: "Account not found" });
  }

  const lastRequest = await prisma.forgotPassword.findFirst({
    where: { accountId: account.id },
    orderBy: { createdAt: "desc" },
  });

  if (lastRequest) {
    const timeSinceLastRequest =
      (new Date() - new Date(lastRequest.createdAt)) / 1000 / 60;
    if (timeSinceLastRequest < 5) {
      return res.status(429).json({
        success: false,
        message: `You can request password reset again in ${Math.ceil(
          5 - timeSinceLastRequest
        )} minutes.`,
      });
    }
  }

  await prisma.forgotPassword.deleteMany({
    where: { accountId: account.id },
  });

  const token = crypto.randomBytes(32).toString("hex");
  const expiredAt = new Date(Date.now() + 1000 * 60 * 60); // Token berlaku 60 menit

  await prisma.forgotPassword.create({
    data: {
      token,
      accountId: account.id,
      expiredAt,
    },
  });

  const emailSend = await sendEmailResetPassword(account.email, token);

  if (emailSend.success) {
    return res
      .status(200)
      .json({ success: true, message: "Reset password email sent" });
  }
  //if failed delete token
  await prisma.forgotPassword.delete({
    where: { token },
  });
  return res.status(500).json({ message: "Failed to send email" });
});

router.post("/forgot/reset", async (req, res) => {
  const { token, password } = req.body;

  if (!token || !password) {
    return res.status(400).json({ message: "Token and password are required" });
  }

  try {
    const resetToken = await prisma.forgotPassword.findUnique({
      where: { token },
      include: { account: true },
    });

    if (!resetToken || resetToken.expiredAt < new Date()) {
      return res.status(400).json({ message: "Invalid or expired token" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await prisma.account.update({
      where: { id: resetToken.accountId },
      data: { password: hashedPassword },
    });

    await prisma.forgotPassword.delete({
      where: { token },
    });

    return res
      .status(200)
      .json({ success: true, message: "Password updated successfully" });
  } catch (err) {
    console.error(err);
    return res.status(400).json({ message: "Invalid or expired token" });
  }
});

router.post("/forgot/validate", async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ message: "Token is required", valid: false });
  }

  const resetToken = await prisma.forgotPassword.findUnique({
    where: { token },
  });

  if (!resetToken) {
    return res.status(400).json({ message: "Invalid or expired token", valid: false });
  }

  if (resetToken.expiredAt < new Date()) {
    await prisma.forgotPassword.delete({
      where: { token },
    });
    return res.status(400).json({ message: "Invalid or expired token", valid: false });
  }

  return res.status(200).json({ success: true, message: "Token is valid", valid: true });
});

export default router;
