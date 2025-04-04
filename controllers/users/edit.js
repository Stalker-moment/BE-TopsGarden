import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();
const prisma = new PrismaClient();

const authenticate = (authorization) => {
  if (!authorization) {
    throw new Error("Unauthorized");
  }

  const token = authorization.replace("Bearer ", "");
  const decoded = jwt.verify(token, process.env.JWT_SECRET);

  if (decoded.expired < Date.now()) {
    throw new Error("Unauthorized");
  }

  return decoded;
};

const updateAccountData = async (email, data) => {
  return await prisma.account.update({
    where: { email },
    data,
  });
};

router.put("/edit", async (req, res) => {
  const { password, firstName, lastName, phone, noreg, birthday } = req.body;
  const { authorization } = req.headers;

  try {
    const decoded = authenticate(authorization);

    const account = await prisma.account.findUnique({
      where: { email: decoded.email },
      include: { contact: true },
    });

    if (!account) {
      return res.status(404).json({ success: false, message: "Account not found" });
    }

    if (birthday) {
      var date = new Date(birthday);
      if (date > new Date()) {
        return res.status(400).json({ success: false, message: "Invalid birthday" });
      }
    }

    const hashedPassword = password
      ? await bcrypt.hash(password, 10)
      : account.password;
    const updatedContact = {
      firstName: firstName || account.contact.firstName,
      lastName: lastName || account.contact.lastName,
      phone: phone || account.contact.phone,
      noreg: noreg || account.contact.noreg,
      birthday: birthday || account.contact.birthday,
    };

    const updatedAccount = await updateAccountData(decoded.email, {
      password: hashedPassword,
      contact: { update: updatedContact },
    });

    //delete password from response
    delete updatedAccount.password;

    if (password) {
      return res
        .status(201)
        .json({ message: "Success update account and password" });
    }

    const newToken = jwt.sign(
      {
        ...decoded,
        ...updatedAccount,
        expired: Date.now() + 60 * 60 * 60 * 1000,
      },
      process.env.JWT_SECRET
    );

    return res.status(200).json({
      message: `Success update account (${decoded.email})`,
      token: newToken,
      data: updatedAccount,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/edit/others", async (req, res) => {
  const { email, password, firstName, lastName, phone, noreg } = req.body;
  const { authorization } = req.headers;

  try {
    const decoded = authenticate(authorization);

    if (decoded.role !== "ADMIN") {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const account = await prisma.account.findUnique({
      where: { email },
      include: { contact: true },
    });

    if (!account) {
      return res.status(404).json({ error: "Account not found" });
    }

    const hashedPassword = password
      ? await bcrypt.hash(password, 10)
      : account.password;
    const updatedContact = {
      firstName: firstName || account.contact.firstName,
      lastName: lastName || account.contact.lastName,
      phone: phone || account.contact.phone,
      noReg: noreg || account.contact.noreg,
    };

    await updateAccountData(email, {
      password: hashedPassword,
      contact: { update: updatedContact },
    });

    return res.status(200).json({
      message: `Success update account (${email}) by (${decoded.email})`,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/edit/delete", async (req, res) => {
  const { email } = req.body;
  const { authorization } = req.headers;

  try {
    const decoded = authenticate(authorization);

    if (decoded.role !== "ADMIN" || email === decoded.email) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const account = await prisma.account.findUnique({ where: { email } });

    if (!account) {
      return res.status(404).json({ error: "Account not found" });
    }

    await prisma.contact.delete({ where: { id: account.id } });
    await prisma.account.delete({ where: { email } });

    return res.status(200).json({
      message: `Success delete account (${email}) by (${decoded.email})`,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/validate-password", async (req, res) => {
  const { currentPassword } = req.body;
  const { authorization } = req.headers;

  try {
    const decoded = authenticate(authorization);

    const account = await prisma.account.findUnique({
      where: { email: decoded.email },
    });

    if (!account) {
      return res.status(404).json({ error: "Account not found" });
    }

    const match = await bcrypt.compare(currentPassword, account.password);

    return res.status(200).json({ valid: match });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/change-password", async (req, res) => {
  const { newPassword, logoutAllSessions } = req.body;
  const { authorization } = req.headers;

  try {
    const decoded = authenticate(authorization);

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await updateAccountData(decoded.email, { password: hashedPassword });

    if (logoutAllSessions) {
      await prisma.session.deleteMany({ where: { accountId: decoded.id } });
    }

    return res.status(200).json({
      success: true,
      message: `Success change password for account (${decoded.email})`,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/edit/password", async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const { authorization } = req.headers;

  try {
    const decoded = authenticate(authorization);

    const account = await prisma.account.findUnique({
      where: { email: decoded.email },
    });

    if (!account) {
      return res.status(404).json({ error: "Account not found" });
    }

    const match = await bcrypt.compare(oldPassword, account.password);

    if (!match) {
      return res.status(400).json({ error: "Invalid old password" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await updateAccountData(decoded.email, { password: hashedPassword });

    return res.status(200).json({
      message: `Success update password for account (${decoded.email})`,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
