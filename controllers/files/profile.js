import express from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

const router = express.Router();
const prisma = new PrismaClient();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "./img/profile"),
  filename: (req, file, cb) =>
    cb(null, uuidv4() + path.extname(file.originalname)),
});

const upload = multer({ storage });

const authenticate = (req, res, next) => {
  const { authorization } = req.headers;
  if (!authorization) return res.status(401).json({ error: "Unauthorized" });

  const token = authorization.replace("Bearer ", "");
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.expired < Date.now())
      return res.status(401).json({ error: "Unauthorized" });
    req.userId = decoded.id;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Unauthorized" });
  }
};

const getContact = async (id) => {
  return await prisma.account.findFirst({
    where: { id },
    include: { contact: true },
  });
};

router.get("/img/profile/:name", (req, res) => {
  const filePath = `./img/profile/${req.params.name}`;
  res.sendFile(
    path.resolve(fs.existsSync(filePath) ? filePath : "./img/nofound.jpg")
  );
});

router.get("/img/profile", authenticate, async (req, res) => {
  const data = await getContact(req.userId);
  if (!data) return res.status(404).json({ error: "Contact not found" });

  const pathimage = `./img/profile/${data.contact.picture}`;
  res.sendFile(
    path.resolve(
      fs.existsSync(pathimage) ? pathimage : "./img/profile/default.png"
    )
  );
});

router.post(
  "/img/profile",
  authenticate,
  upload.single("image"),
  async (req, res) => {
    const contact = await prisma.contact.findFirst({
      where: { id: req.userId },
    });
    if (!contact) return res.status(404).json({ error: "Contact not found" });

    const newPicture = req.file.filename;
    if (!newPicture)
      return res.status(400).json({ error: "Image is required" });

    if (contact.picture && contact.picture !== "/default.png") {
      fs.unlinkSync(`./img/profile/${contact.picture}`);
    }

    await prisma.contact.update({
      where: { id: contact.id },
      data: { picture: "/" + newPicture },
    });

    const dataNew = await getContact(req.userId);
    if (!dataNew) return res.status(404).json({ error: "Contact not found" });

    dataNew.contact.picture = `${process.env.HOST}/files/img/profile${dataNew.contact.picture}`;
    delete dataNew.password;
    res
      .status(200)
      .json({ message: "Profile picture updated successfully", data: dataNew });
  }
);

router.delete("/img/profile", authenticate, async (req, res) => {
  const contact = await prisma.contact.findFirst({ where: { id: req.userId } });
  if (!contact) return res.status(404).json({ error: "Contact not found" });

  if (contact.picture && contact.picture !== "/default.png") {
    fs.unlinkSync(`./img/profile/${contact.picture}`);
  }

  await prisma.contact.update({
    where: { id: contact.id },
    data: { picture: "/default.png" },
  });

  const dataNew = await getContact(req.userId);
  if (!dataNew) return res.status(404).json({ error: "Contact not found" });

  dataNew.contact.picture = `${process.env.HOST}/files/img/profile${dataNew.contact.picture}`;
  res
    .status(200)
    .json({ message: "Profile picture deleted successfully", data: dataNew });
});

export default router;
