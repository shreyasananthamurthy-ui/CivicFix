const express = require("express");
const pool = require("../db");
const { authenticate } = require("../middleware/auth");

const router = express.Router();
router.use(authenticate);

router.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, issue_id, type, message, is_read, created_at
       FROM public.notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [req.user.id]
    );

    res.json(rows);
  } catch (error) {
    console.error("Notification fetch failed:", error.message);
    res.status(500).json({
      error: "Could not load notifications",
    });
  }
});

router.patch("/:id/read", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE public.notifications
       SET is_read = true
       WHERE id = $1 AND user_id = $2
       RETURNING id, is_read`,
      [req.params.id, req.user.id]
    );

    if (!rows[0]) {
      return res.status(404).json({ error: "Notification not found" });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error("Notification update failed:", error.message);
    res.status(500).json({
      error: "Could not update notification",
    });
  }
});

router.patch("/read-all", async (req, res) => {
  try {
    await pool.query(
      "UPDATE public.notifications SET is_read = true WHERE user_id = $1",
      [req.user.id]
    );

    res.json({ message: "Notifications marked as read" });
  } catch (error) {
    console.error("Notification update failed:", error.message);
    res.status(500).json({
      error: "Could not update notifications",
    });
  }
});

module.exports = router;