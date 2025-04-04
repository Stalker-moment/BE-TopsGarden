// src/routes/inventory.js

import express from "express";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";

const router = express.Router();
const prisma = new PrismaClient();

// Middleware Autentikasi
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

// ====== Category CRUD ======

// Create Category
router.post("/categories", authenticate, async (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: "Name is required" });

  try {
    const category = await prisma.category.create({
      data: {
        name,
        description,
      },
    });
    return res.status(201).json(category);
  } catch (err) {
    if (err.code === 'P2002') { // Prisma unique constraint failed
      return res.status(409).json({ error: "Category name must be unique" });
    }
    console.error(err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// Get All Categories
router.get("/categories", authenticate, async (req, res) => {
  try {
    const categories = await prisma.category.findMany({
      include: { products: true },
    });
    return res.status(200).json(categories);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// Get Single Category
router.get("/categories/:id", authenticate, async (req, res) => {
  const { id } = req.params;
  try {
    const category = await prisma.category.findUnique({
      where: { id },
      include: { products: true },
    });
    if (!category) return res.status(404).json({ error: "Category not found" });
    return res.status(200).json(category);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// Update Category
router.put("/categories/:id", authenticate, async (req, res) => {
  const { id } = req.params;
  const { name, description } = req.body;

  try {
    const updatedCategory = await prisma.category.update({
      where: { id },
      data: {
        name,
        description,
      },
    });
    return res.status(200).json(updatedCategory);
  } catch (err) {
    if (err.code === 'P2025') { // Prisma record not found
      return res.status(404).json({ error: "Category not found" });
    }
    if (err.code === 'P2002') { // Unique constraint failed
      return res.status(409).json({ error: "Category name must be unique" });
    }
    console.error(err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// Delete Category
router.delete("/categories/:id", authenticate, async (req, res) => {
  const { id } = req.params;
  try {
    // Optional: Check if category has associated products
    const products = await prisma.product.findMany({
      where: { categoryId: id },
    });
    if (products.length > 0) {
      return res.status(400).json({ error: "Cannot delete category with associated products" });
    }

    await prisma.category.delete({
      where: { id },
    });
    return res.status(204).send();
  } catch (err) {
    if (err.code === 'P2025') { // Prisma record not found
      return res.status(404).json({ error: "Category not found" });
    }
    console.error(err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// ====== Rack CRUD ======

// Create Rack
router.post("/racks", authenticate, async (req, res) => {
  const { name, location } = req.body;
  if (!name || !location)
    return res.status(400).json({ error: "Name and location are required" });

  try {
    const rack = await prisma.rack.create({
      data: {
        name,
        location,
      },
    });
    return res.status(201).json(rack);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// Get All Racks
router.get("/racks", authenticate, async (req, res) => {
  try {
    const racks = await prisma.rack.findMany({
      include: { products: true },
    });
    return res.status(200).json(racks);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// Get Single Rack
router.get("/racks/:id", authenticate, async (req, res) => {
  const { id } = req.params;
  try {
    const rack = await prisma.rack.findUnique({
      where: { id },
      include: { products: true },
    });
    if (!rack) return res.status(404).json({ error: "Rack not found" });
    return res.status(200).json(rack);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// Update Rack
router.put("/racks/:id", authenticate, async (req, res) => {
  const { id } = req.params;
  const { name, location } = req.body;

  try {
    const updatedRack = await prisma.rack.update({
      where: { id },
      data: {
        name,
        location,
      },
    });
    return res.status(200).json(updatedRack);
  } catch (err) {
    if (err.code === 'P2025') { // Prisma record not found
      return res.status(404).json({ error: "Rack not found" });
    }
    console.error(err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// Delete Rack
router.delete("/racks/:id", authenticate, async (req, res) => {
  const { id } = req.params;
  try {
    // Optional: Check if rack has associated products
    const products = await prisma.product.findMany({
      where: { rack: { some: { id } } },
    });
    if (products.length > 0) {
      return res.status(400).json({ error: "Cannot delete rack with associated products" });
    }

    await prisma.rack.delete({
      where: { id },
    });
    return res.status(204).send();
  } catch (err) {
    if (err.code === 'P2025') { // Prisma record not found
      return res.status(404).json({ error: "Rack not found" });
    }
    console.error(err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// ====== Product CRUD ======

// Create Product
router.post("/products", authenticate, async (req, res) => {
  const { name, price, stock, categoryId, rackIds, description } = req.body;

  if (!name || price == null || stock == null || !categoryId || !rackIds || !description) {
    return res.status(400).json({ error: "All fields are required" });
  }

  try {
    // Ensure category exists
    const category = await prisma.category.findUnique({
      where: { id: categoryId },
    });
    if (!category) {
      return res.status(404).json({ error: "Category not found" });
    }

    // Ensure racks exist
    const racks = await prisma.rack.findMany({
      where: { id: { in: rackIds } },
    });
    if (racks.length !== rackIds.length) {
      return res.status(404).json({ error: "One or more racks not found" });
    }

    const product = await prisma.product.create({
      data: {
        name,
        price,
        stock,
        description,
        category: {
          connect: { id: categoryId },
        },
        rack: {
          connect: rackIds.map((rackId) => ({ id: rackId })),
        },
      },
      include: {
        category: true,
        rack: true,
      },
    });

    return res.status(201).json(product);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// Get All Products
router.get("/products", authenticate, async (req, res) => {
  try {
    const products = await prisma.product.findMany({
      include: {
        category: true,
        rack: true,
        images: true, // Assuming you want to include images later
      },
    });
    return res.status(200).json(products);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// Get Single Product
router.get("/products/:id", authenticate, async (req, res) => {
  const { id } = req.params;
  try {
    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        category: true,
        rack: true,
        images: true, // Assuming you want to include images later
      },
    });
    if (!product) return res.status(404).json({ error: "Product not found" });
    return res.status(200).json(product);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// Update Product
router.put("/products/:id", authenticate, async (req, res) => {
  const { id } = req.params;
  const { name, price, stock, categoryId, rackIds, description } = req.body;

  if (!name || price == null || stock == null || !categoryId || !rackIds || !description) {
    return res.status(400).json({ error: "All fields are required" });
  }

  try {
    // Ensure category exists
    const category = await prisma.category.findUnique({
      where: { id: categoryId },
    });
    if (!category) {
      return res.status(404).json({ error: "Category not found" });
    }

    // Ensure racks exist
    const racks = await prisma.rack.findMany({
      where: { id: { in: rackIds } },
    });
    if (racks.length !== rackIds.length) {
      return res.status(404).json({ error: "One or more racks not found" });
    }

    const updatedProduct = await prisma.product.update({
      where: { id },
      data: {
        name,
        price,
        stock,
        description,
        category: {
          connect: { id: categoryId },
        },
        rack: {
          set: rackIds.map((rackId) => ({ id: rackId })), // Update rack associations
        },
      },
      include: {
        category: true,
        rack: true,
      },
    });

    return res.status(200).json(updatedProduct);
  } catch (err) {
    if (err.code === 'P2025') { // Prisma record not found
      return res.status(404).json({ error: "Product not found" });
    }
    console.error(err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// Delete Product
router.delete("/products/:id", authenticate, async (req, res) => {
  const { id } = req.params;
  try {
    await prisma.product.delete({
      where: { id },
    });
    return res.status(204).send();
  } catch (err) {
    if (err.code === 'P2025') { // Prisma record not found
      return res.status(404).json({ error: "Product not found" });
    }
    console.error(err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;