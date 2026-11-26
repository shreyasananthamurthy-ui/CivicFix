require("dotenv").config({
  path: require("path").resolve(__dirname, "../.env"),
});
const express = require("express");
const path = require("path");
const fs = require("fs");
const pool = require("./db");

const app = express();
const cors = require("cors");

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
    ],
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
const PORT = process.env.PORT || 5000;
const uploadsPath = path.resolve(__dirname, "../uploads");

fs.mkdirSync(uploadsPath, { recursive: true });

app.use(cors({ origin: true }));
app.use(express.json());
app.use("/uploads", express.static(uploadsPath));

app.get("/api/health", (_req, res) => {
  res.json({ message: "CivicFix backend is running" });
});

app.get("/api/db-health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ message: "Supabase database connected" });
  } catch (error) {
    console.error("Database connection error:", error.message);
    res.status(500).json({
      error: "Could not connect to the database",
    });
  }
});

app.use("/api/auth", require("./routes/auth"));
app.use("/api/issues", require("./routes/issues"));
app.use("/api/notifications", require("./routes/notifications"));

app.use((error, _req, res, _next) => {
  console.error("Request failed:", error.message);
  const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
  res.status(status).json({
    error: error.message || "Invalid request",
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend running on port ${PORT}`);
});