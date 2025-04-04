import express from "express";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();
const prisma = new PrismaClient();

router.get("/sensor/:voltage/:ph/:temp/:humi/:ldr", async (req, res) => {
    const voltage = parseFloat(req.params.voltage);
    const ph = parseFloat(req.params.ph);
    const temp = parseFloat(req.params.temp);
    const humi = parseFloat(req.params.humi);
    let ldr = parseInt(req.params.ldr);
    
    try {
        //if no data return 0
        if (isNaN(voltage)) voltage = 0;
        if (isNaN(ph)) ph = 0;
        if (isNaN(temp)) temp = 0;
        if (isNaN(humi)) humi = 0;
        if (isNaN(ldr)) ldr = 0;

        //convert ldr to boolean (if 0 then true else false)
        if (ldr === 0) ldr = true;
        else ldr = false;

        //insert data to database
        await prisma.sensor.create({
            data: {
                voltage: voltage,
                ph: ph,
                temperature: temp,
                humidity: humi,
                ldr: ldr,
                createdAt: new Date(),
            },
        });

        console.log("Sensor data received:", { voltage, ph, temp, humi, ldr });
    
        res.status(200).json({ message: "Sensor data received successfully", data: { voltage, ph, temp, humi, ldr } });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Internal Server Error" });
    }
    }
);

export default router;