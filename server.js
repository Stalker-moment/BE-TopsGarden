// Import Modul
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import dotenv from "dotenv";
import { WebSocketServer } from "ws"; 
import fs from "fs";
import path from "path";
import http from "http";
import cronjob from "node-cron";
import pkg from "jsonwebtoken";
const { verify } = pkg;
import { createLogger } from "./helper/logger.js";

dotenv.config();

import usersLogin from "./controllers/users/login.js";
import usersRegister from "./controllers/users/register.js";
import userEdit from "./controllers/users/edit.js";
import userAccount from "./controllers/users/account.js";
import userForgot from "./controllers/users/forgot.js";

import filesAssets from "./controllers/files/assets.js";
import filesProfile from "./controllers/files/profile.js";
import filesBanner from "./controllers/files/banner.js";
import filesMachine from "./controllers/files/machine.js";
import notification from "./controllers/internal/notification.js";

import handleDataAccountsSocket from "./sockets/dataAccounts.js";
import handleDataSessionId from "./sockets/dataSessionId.js";
import handleDataSessionAccount from "./sockets/dataSessionAccount.js";
import handleDataOutputSocket from "./sockets/dataOutput.js";
import handleDataSensorSocket from "./sockets/dataSensor.js";
import handleDataLogsSocket from "./sockets/dataLogs.js";

import deviceSensor from "./controllers/device/receiveSensor.js";
import deviceOutput from "./controllers/device/output.js";

//import cronjob from "./functions/scheduler.js";
import "./functions/scheduler.js";

const app = express();
const log = createLogger("Server");

//-----------------Configuration------------------//
app.use(bodyParser.json());
app.use(cors());
app.use(bodyParser.json({ limit: "500000mb" }));
app.use(bodyParser.urlencoded({ extended: true }));

app.enable("trust proxy");
app.set("view engine", "ejs");

const PORT = process.env.PORT || 1777;

//-----------------Routes------------------//

app.get("/", (req, res) => {
  res.status(200).json({ message: "Welcome to the API", status: 200, developer: "Internship AKTI" });
});

//===============[User Routes]=================//
app.use("/api/users", usersLogin);
app.use("/api/users", usersRegister);
app.use("/api/users", userEdit);
app.use("/api/users", userAccount);
app.use("/api/users", userForgot);

//===============[Internal Routes]=================//
app.use("/api/internal", notification);

//===============[File Routes]=================//
app.use("/files", filesAssets);
app.use("/files", filesProfile);
app.use("/files", filesBanner);
app.use("/files", filesMachine);

//===============[Device Routes]=================//
app.use("/api/device", deviceSensor);
app.use("/api/device", deviceOutput);

app.use((req, res) => {
  res.status(404).send({ error: "Not found" });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on("connection", (ws, req) => {
  const routes = {
    "/accounts": handleDataAccountsSocket,
    "/dataSessionId": handleDataSessionId,
    "/dataSessionAccount": handleDataSessionAccount,
    "/dataOutput": handleDataOutputSocket,
    "/dataSensor": handleDataSensorSocket,
    "/logs": handleDataLogsSocket,
  };

  const matchedRoute = Object.keys(routes).find((route) =>
    req.url.startsWith(route)
  );

  if (matchedRoute) {
    log.info("WebSocket connected", { route: matchedRoute, ip: req.socket.remoteAddress });
    routes[matchedRoute](ws, req);
  } else {
    log.warn("WebSocket invalid route", { url: req.url });
    ws.send(JSON.stringify({ error: "Invalid request URL" }));
    ws.close();
  }
});

server.listen(PORT, () => {
  log.info("Server started", { port: PORT });
  log.info("WebSocket server ready", { url: `ws://localhost:${PORT}` });
});