import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import useragent from "express-useragent";
import getIpInfo from "../../functions/getIpInfo.js";

dotenv.config();

const prisma = new PrismaClient();
const router = express.Router();

router.use(useragent.express());

const createSession = async (account, ip, ipInfo, deviceType, expire) => {
  const expired = expire;
  let token = "initial";

  const sessionManager = await prisma.session.create({
    data: {
      token: token,
      expiredAt: new Date(expired),
      device: deviceType,
      ip: ip,
      region: ipInfo.region,
      city: ipInfo.city,
      loc: ipInfo.loc,
      org: ipInfo.org,
      timezone: ipInfo.timezone,
      account: { connect: { id: account.id } },
    },
  });

  token = jwt.sign(
    {
      id: account.id,
      role: account.role,
      email: account.email,
      expiredAt: expired,
      device: deviceType,
      sessionId: sessionManager.id,
    },
    process.env.JWT_SECRET
  );

  await prisma.session.update({
    where: { id: sessionManager.id },
    data: { token: token },
  });

  return { token, sessionId: sessionManager.id, deviceType };
};

const findSession = async (sessionId) => {
  return await prisma.session.findFirst({
    where: { id: sessionId },
  });
};

const deleteSession = async (sessionId) => {
  await prisma.session.delete({ where: { id: sessionId } });
};

router.post("/login", async (req, res) => {
  let { email, password, remember } = req.body;
  const ip = req.headers["x-forwarded-for"] || req.connection.remoteAddress;
  const ipInfo = await getIpInfo(ip);

  email = email.toLowerCase();

  try {
    if (!email || !password) {
      return res.status(400).json({ error: "Please fill all required fields" });
    }

    const account = await prisma.account.findUnique({ where: { email } });
    if (!account) return res.status(404).json({ error: "Account not found" });

    const passwordMatch = await bcrypt.compare(password, account.password);
    if (!passwordMatch)
      return res.status(401).json({ error: "Invalid password" });

    const contact = await prisma.contact.findUnique({ where: { email } });
    if (!contact) return res.status(404).json({ error: "Contact not found" });

    const deviceType = req.useragent.isMobile
      ? "MOBILE"
      : req.useragent.isTablet
      ? "TABLET"
      : req.useragent.isDesktop
      ? "DESKTOP"
      : "UNKNOWN";

    // 7 day : 1 day
    const expired = remember
      ? Date.now() + 7 * 24 * 60 * 60 * 1000
      : Date.now() + 24 * 60 * 60 * 1000;

    const {
      token,
      sessionId,
      deviceType: device,
      expire,
    } = await createSession(account, ip, ipInfo, deviceType, expired);

    return res
      .status(200)
      .json({ token, deviceType: device, sessionId, expired: expired });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ error: error.message });
  }
});

router.post("/logout", async (req, res) => {
  const { token } = req.body;

  try {
    if (!token) return res.status(400).json({ error: "Token is required" });

    const decoded = jwt.decode(token);
    const sessionId = decoded.sessionId;

    const session = await findSession(sessionId);
    if (!session)
      return res
        .status(200)
        .json({ message: "Logout success, but the session loses" });

    await deleteSession(sessionId);
    return res.status(200).json({ message: "Logout success" });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ error: error.message });
  }
});

const handleRemoteLogout = async (req, res, checkAdmin = false) => {
  const { authorization } = req.headers;
  const { sessionId } = req.body;

  try {
    if (!authorization)
      return res.status(400).json({ error: "auth is required" });

    const decoded = jwt.decode(authorization.replace("Bearer ", ""));
    const sessionNow = decoded.sessionId;

    if (sessionNow == sessionId)
      return res.status(401).json({ error: "Cannot logout current session" });

    if (checkAdmin && decoded.role !== "ADMIN")
      return res.status(401).json({ error: "Unauthorized" });

    if (!sessionId)
      return res.status(400).json({ error: "Session ID is required" });

    const session = await findSession(sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });

    await deleteSession(sessionId);
    return res.status(200).json({ message: "Remote logout success" });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ error: error.message });
  }
};

router.post("/remote-logout", (req, res) => handleRemoteLogout(req, res));
router.post("/remote-logout-others", (req, res) =>
  handleRemoteLogout(req, res, true)
);

export default router;
