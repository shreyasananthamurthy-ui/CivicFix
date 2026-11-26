const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

function makeToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function safeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    notifyStatus: user.notify_status ?? true,
    notifyCrew: user.notify_crew ?? true,
    ward: user.neighbourhood || "Chikkamagaluru",
  };
}

router.post("/register", async (req, res) => {
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  if (
    name.length < 2 ||
    !/^\S+@\S+\.\S+$/.test(email) ||
    password.length < 8
  ) {
    return res.status(400).json({
      error:
        "Enter your name, a valid email, and a password with at least 8 characters.",
    });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);

    const { rows } = await pool.query(
      `INSERT INTO public.users (name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, name, email, role,
                 notify_status, notify_crew, neighbourhood`,
      [name, email, passwordHash]
    );

    const user = rows[0];

    return res.status(201).json({
      user: safeUser(user),
      token: makeToken(user),
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        error: "An account with this email already exists.",
      });
    }

    console.error("Registration failed:", error.message);
    return res.status(500).json({
      error: "Could not create the account.",
    });
  }
});

router.post("/login", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, role, password_hash,
              notify_status, notify_crew, neighbourhood
       FROM public.users
       WHERE email = $1`,
      [email]
    );

    const user = rows[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({
        error: "Email or password is incorrect.",
      });
    }

    return res.json({
      user: safeUser(user),
      token: makeToken(user),
    });
  } catch (error) {
    console.error("Login failed:", error.message);
    return res.status(500).json({ error: "Could not sign in." });
  }
});

router.get("/me", authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, role,
              notify_status, notify_crew, neighbourhood
       FROM public.users
       WHERE id = $1`,
      [req.user.id]
    );

    if (!rows[0]) {
      return res.status(401).json({ error: "Account no longer exists" });
    }

    return res.json({ user: safeUser(rows[0]) });
  } catch (error) {
    console.error("Profile fetch failed:", error.message);
    return res.status(500).json({
      error: "Could not load the profile.",
    });
  }
});

router.patch("/me", authenticate, async (req, res) => {
  const { notifyStatus, notifyCrew, ward } = req.body;

  if (
    typeof notifyStatus !== "boolean" ||
    typeof notifyCrew !== "boolean" ||
    typeof ward !== "string"
  ) {
    return res.status(400).json({
      error: "Provide notification preferences and a neighbourhood.",
    });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE public.users
       SET notify_status = $2,
           notify_crew = $3,
           neighbourhood = $4
       WHERE id = $1
       RETURNING id, name, email, role,
                 notify_status, notify_crew, neighbourhood`,
      [req.user.id, notifyStatus, notifyCrew, ward.trim()]
    );

    if (!rows[0]) {
      return res.status(404).json({ error: "Account not found" });
    }

    return res.json({ user: safeUser(rows[0]) });
  } catch (error) {
    console.error("Profile update failed:", error.message);
    return res.status(500).json({
      error: "Could not save profile settings.",
    });
  }
});

module.exports = router;