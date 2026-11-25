const path = require("path");
require("dotenv").config({
  path: path.resolve(__dirname, "../.env"),
});

const express = require("express");
const cors = require("cors");
const pool = require("./db");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Confirm the backend is running
app.get("/api/health", (req, res) => {
  res.json({ message: "CivicFix backend is running" });
});

// Check the Supabase connection through the backend
app.get("/api/db-health", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({
      message: "Supabase database connected",
      time: result.rows[0].now,
    });
  } catch (error) {
    console.error("Database health check failed:", error.message);
    res.status(500).json({ error: "Could not connect to the database" });
  }
});

// Issue reporting routes
app.use("/api/issues", require("./routes/issues"));

app.listen(PORT, () => {
  console.log(`Backend running at http://localhost:${PORT}`);
});