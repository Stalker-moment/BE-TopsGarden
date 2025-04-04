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
  destination: (req, file, cb) => cb(null, "./img/warehouse"),
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

router.get("/img/warehouse/:name", (req, res) => {
  const filePath = `./img/warehouse/${req.params.name}`;
  res.sendFile(
    path.resolve(fs.existsSync(filePath) ? filePath : "./img/warehouse/default.jpg")
  );
});

router.get("/img/warehouse", authenticate, async (req, res) => {
  const data = await getContact(req.userId);
  if (!data) return res.status(404).json({ error: "Contact not found" });

  const pathimage = `./img/warehouse/${data.contact.warehouse}`;
  res.sendFile(
    path.resolve(
      fs.existsSync(pathimage) ? pathimage : "./img/warehouse/default.jpg"
    )
  );
});

router.post(
  "/img/warehouse",
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

    if (contact.warehouse && contact.warehouse !== "/default.jpg") {
      fs.unlinkSync(`./img/warehouse/${contact.warehouse}`);
    }

    await prisma.contact.update({
      where: { id: contact.id },
      data: { warehouse: "/" + newPicture },
    });

    const dataNew = await getContact(req.userId);
    if (!dataNew) return res.status(404).json({ error: "Contact not found" });

    dataNew.contact.warehouse = `${process.env.HOST}/files/img/warehouse${dataNew.contact.warehouse}`;
    delete dataNew.password;
    res
      .status(200)
      .json({ message: "Profile picture updated successfully", data: dataNew });
  }
);

router.delete("/img/warehouse", authenticate, async (req, res) => {
  const contact = await prisma.contact.findFirst({ where: { id: req.userId } });
  if (!contact) return res.status(404).json({ error: "Contact not found" });

  if (contact.warehouse && contact.warehouse !== "/default.png") {
    fs.unlinkSync(`./img/warehouse/${contact.warehouse}`);
  }

  await prisma.contact.update({
    where: { id: contact.id },
    data: { warehouse: "/default.jpg" },
  });

  const dataNew = await getContact(req.userId);
  if (!dataNew) return res.status(404).json({ error: "Contact not found" });

  dataNew.contact.warehouse = `${process.env.HOST}/files/img/warehouse${dataNew.contact.warehouse}`;
  res
    .status(200)
    .json({ message: "warehouse picture deleted successfully", data: dataNew });
});

export default router;  