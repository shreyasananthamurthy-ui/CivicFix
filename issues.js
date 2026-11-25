const express = require("express");
const router = express.Router();
const pool = require("../db");

router.post("/", async (req, res) => {
  const { title, description, category, latitude, longitude } = req.body;

  if (!title || !description || !category) {
    return res.status(400).json({
      error: "Title, description, and category are required",
    });
  }

  try {
    const result = await pool.query(
      `INSERT INTO public.issues
        (title, description, category, latitude, longitude)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [title, description, category, latitude ?? null, longitude ?? null]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Issue save failed:", error.message);
    res.status(500).json({ error: "Could not save the issue" });
  }
});

module.exports = router;