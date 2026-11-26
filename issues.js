const express = require("express");
const multer = require("multer");
const path = require("path");
const crypto = require("crypto");
const pool = require("../db");
const {
  authenticate,
  optionalAuthenticate,
  requireAdmin,
} = require("../middleware/auth");

const router = express.Router();
const uploadDir = path.resolve(__dirname, "../../uploads");

const storage = multer.diskStorage({
  destination: (_req, _file, done) => done(null, uploadDir),
  filename: (_req, file, done) => {
    const extension = path.extname(file.originalname).toLowerCase();
    done(null, `${Date.now()}-${crypto.randomUUID()}${extension}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, done) => {
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];

    if (!allowedTypes.includes(file.mimetype)) {
      return done(new Error("Upload a JPG, PNG, or WebP image."));
    }

    done(null, true);
  },
});

// Store a relative path so uploaded photos still work if the backend IP changes.
function imageUrl(file) {
  return file ? `/uploads/${file.filename}` : null;
}

router.get("/", optionalAuthenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT i.*,
        (SELECT COUNT(*)::int
         FROM public.issue_upvotes v
         WHERE v.issue_id = i.id) AS upvotes,
        COALESCE(
          (SELECT bool_or(v.user_id = $1::uuid)
           FROM public.issue_upvotes v
           WHERE v.issue_id = i.id),
          false
        ) AS has_upvoted
       FROM public.issues i
       ORDER BY i.created_at DESC`,
      [req.user?.id || null]
    );

    res.json(rows);
  } catch (error) {
    console.error("Issue fetch failed:", error.message);
    res.status(500).json({ error: "Could not fetch issues" });
  }
});

router.post("/", authenticate, upload.single("photo"), async (req, res) => {
  const { title, description, category } = req.body;

  const latitude =
    req.body.latitude === "" || req.body.latitude == null
      ? null
      : Number(req.body.latitude);

  const longitude =
    req.body.longitude === "" || req.body.longitude == null
      ? null
      : Number(req.body.longitude);

  if (!title?.trim() || !description?.trim() || !category?.trim()) {
    return res.status(400).json({
      error: "Title, description, and category are required",
    });
  }

  if (
    (latitude !== null && !Number.isFinite(latitude)) ||
    (longitude !== null && !Number.isFinite(longitude))
  ) {
    return res.status(400).json({
      error: "Latitude and longitude must be valid numbers",
    });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO public.issues
        (title, description, category, latitude, longitude, reporter_id, photo_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        title.trim(),
        description.trim(),
        category.trim(),
        latitude,
        longitude,
        req.user.id,
        imageUrl(req.file),
      ]
    );

    res.status(201).json({
      ...rows[0],
      upvotes: 0,
      has_upvoted: false,
    });
  } catch (error) {
    console.error("Issue save failed:", error.message);
    res.status(500).json({ error: "Could not save the issue" });
  }
});

router.post("/:id/upvote", authenticate, async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO public.issue_upvotes (issue_id, user_id)
       VALUES ($1, $2)`,
      [req.params.id, req.user.id]
    );

    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS upvotes
       FROM public.issue_upvotes
       WHERE issue_id = $1`,
      [req.params.id]
    );

    res.json({
      upvotes: rows[0].upvotes,
      has_upvoted: true,
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        error: "You have already upvoted this report.",
      });
    }

    if (error.code === "23503") {
      return res.status(404).json({ error: "Issue not found" });
    }

    console.error("Issue upvote failed:", error.message);
    res.status(500).json({ error: "Could not upvote this issue" });
  }
});

router.patch("/:id", authenticate, requireAdmin, async (req, res) => {
  const { status, crew } = req.body;
  const validStatuses = ["Open", "In Progress", "Resolved"];

  if (status !== undefined && !validStatuses.includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }

  if (crew !== undefined && typeof crew !== "string") {
    return res.status(400).json({ error: "Invalid crew" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const oldResult = await client.query(
      "SELECT * FROM public.issues WHERE id = $1 FOR UPDATE",
      [req.params.id]
    );

    const old = oldResult.rows[0];

    if (!old) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Issue not found" });
    }

    const nextStatus =
      status ?? (old.status === "reported" ? "Open" : old.status);

    const nextCrew = crew ?? old.crew ?? "";

    const result = await client.query(
      `UPDATE public.issues
       SET status = $2,
           crew = $3,
           resolved_at = CASE
             WHEN $2 = 'Resolved' THEN COALESCE(resolved_at, now())
             ELSE NULL
           END
       WHERE id = $1
       RETURNING *`,
      [req.params.id, nextStatus, nextCrew]
    );

    if (old.reporter_id && crew !== undefined && crew !== (old.crew || "")) {
      await client.query(
        `INSERT INTO public.notifications (user_id, issue_id, type, message)
         SELECT id, $2, 'crew', $3
         FROM public.users
         WHERE id = $1 AND notify_crew = true`,
        [
          old.reporter_id,
          old.id,
          crew
            ? `A crew was assigned to “${old.title}”: ${crew}.`
            : `The crew assignment for “${old.title}” was removed.`,
        ]
      );
    }

    if (old.reporter_id && status !== undefined && status !== old.status) {
      await client.query(
        `INSERT INTO public.notifications (user_id, issue_id, type, message)
         SELECT id, $2, 'status', $3
         FROM public.users
         WHERE id = $1 AND notify_status = true`,
        [
          old.reporter_id,
          old.id,
          `“${old.title}” status changed to ${status}.`,
        ]
      );
    }

    await client.query("COMMIT");
    res.json(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Issue update failed:", error.message);
    res.status(500).json({ error: "Could not update the issue" });
  } finally {
    client.release();
  }
});

router.patch(
  "/:id/after-photo",
  authenticate,
  requireAdmin,
  upload.single("photo"),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "Choose a repair photo" });
    }

    try {
      const { rows } = await pool.query(
        `UPDATE public.issues
         SET after_photo_url = $2
         WHERE id = $1
         RETURNING *`,
        [req.params.id, imageUrl(req.file)]
      );

      if (!rows[0]) {
        return res.status(404).json({ error: "Issue not found" });
      }

      res.json(rows[0]);
    } catch (error) {
      console.error("Repair photo upload failed:", error.message);
      res.status(500).json({
        error: "Could not save the repair photo",
      });
    }
  }
);

module.exports = router;