import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();
const prisma = new PrismaClient();

import encryptData from "../../helper/encyptJson.js";

const authenticate = (req, res, next) => {
  const { authorization } = req.headers;
  if (!authorization) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const token = authorization.replace("Bearer ", "");
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.expired < Date.now()) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Unauthorized" });
  }
};

const formatAccount = (account) => {
  delete account.password;
  account.contact.picture = account.contact.picture
    ? `${process.env.HOST}/files/img/profile${account.contact.picture}`
    : null;
  account.contact.banner = account.contact.banner
    ? `${process.env.HOST}/files/img/banner${account.contact.banner}`
    : null;
  return account;
};

router.post("/account/all", authenticate, async (req, res) => {
  try {
    let accounts = await prisma.account.findMany({
      include: {
        contact: true,
      },
    });

    accounts = accounts.map(formatAccount);

    return res.status(200).json(accounts);
  } catch (err) {
    console.log(err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/account", authenticate, async (req, res) => {
  try {
    const account = await prisma.account.findUnique({
      where: {
        id: req.user.id,
      },
      include: {
        contact: true,
      },
    });

    if (!account) {
      return res.status(404).json({ error: "Account not found" });
    }

    return res.status(200).json(formatAccount(account));
  } catch (err) {
    console.log(err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/token/validator", authenticate, async (req, res) => {
  const userId = req.user.id;
  const foundUser = await prisma.account.findUnique({
    where: {
      id: userId,
    },
  });

  if (foundUser) {
    const role = foundUser.role;
    return res.status(200).json({ message: "Token is valid", role: role });
  }

  return res.status(404).json({ error: "User not found" });
});

router.post("/token/info", authenticate, async (req, res) => {
  try {
    const account = await prisma.account.findUnique({
      where: {
        id: req.user.id,
      },
      include: {
        contact: true,
      },
    });

    console.log(account);

    const result = await encryptData(formatAccount(account));

    return res.status(200).json(result);
  } catch (err) {
    console.log(err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
