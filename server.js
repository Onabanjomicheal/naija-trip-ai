import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import handler from "./api/chat.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.all("/api/chat", (req, res) => handler(req, res));

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`[naija-trip-ai] API listening on http://localhost:${port}`);
});

