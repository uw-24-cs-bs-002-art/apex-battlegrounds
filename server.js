require("dotenv").config();

const crypto = require("node:crypto");
const path = require("node:path");
const express = require("express");
const { createClient } = require("@libsql/client");
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");

const app = express();
const port = Number(process.env.PORT) || 3000;

if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
  throw new Error("Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN to connect to Turso.");
}

const databaseClient = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const database = {
  run(sql, parameters, callback) {
    if (typeof parameters === "function") {
      callback = parameters;
      parameters = [];
    }

    databaseClient.execute({ sql, args: parameters }).then(
      (result) => callback.call({
        lastID: Number(result.lastInsertRowid || 0),
        changes: result.rowsAffected,
      }, null),
      (error) => {
        const callbackError = typeof error.code === "string" && error.code.startsWith("SQLITE_CONSTRAINT")
          ? Object.assign(new Error(error.message), { code: "SQLITE_CONSTRAINT" })
          : error;
        callback.call({ lastID: 0, changes: 0 }, callbackError);
      }
    );
  },
  get(sql, parameters, callback) {
    if (typeof parameters === "function") {
      callback = parameters;
      parameters = [];
    }

    databaseClient.execute({ sql, args: parameters }).then(
      (result) => callback(null, result.rows[0]),
      (error) => callback(error)
    );
  },
};
const sessions = new Map();
const recoveryCodes = new Map();
const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const OTP_LIFETIME_MS = 10 * 60 * 1000;
const COOKIE_NAME = "apex_session";

app.disable("x-powered-by");
app.use(express.json({ limit: "10kb" }));
app.use((request, response, next) => {
  if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) {
    request.body = {};
  }
  next();
});
app.get("/", (request, response) => {
  response.sendFile(path.join(__dirname, "index.html"));
});
app.get("/styles.css", (request, response) => {
  response.sendFile(path.join(__dirname, "styles.css"));
});
app.get("/script.js", (request, response) => {
  response.sendFile(path.join(__dirname, "script.js"));
});

async function initializeDatabase() {
  await databaseClient.execute({
    sql: `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  });
}

function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function readCookie(request, name) {
  const cookieHeader = request.headers.cookie || "";
  const cookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));

  return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : "";
}

function getSessionUser(request) {
  const sessionId = readCookie(request, COOKIE_NAME);
  const session = sessions.get(sessionId);

  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    return null;
  }

  session.expiresAt = Date.now() + SESSION_LIFETIME_MS;
  return session.user;
}

function startSession(response, user) {
  const sessionId = crypto.randomBytes(32).toString("hex");
  sessions.set(sessionId, {
    user: { id: user.id, username: user.username, email: user.email },
    expiresAt: Date.now() + SESSION_LIFETIME_MS,
  });

  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_LIFETIME_MS / 1000}${secure}`
  );
}

function getSmtpSettings() {
  const smtpPort = Number(process.env.SMTP_PORT);
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const password = process.env.SMTP_PASS;

  if (!host || !user || !password || !Number.isInteger(smtpPort)) {
    throw new Error("Email recovery is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, and SMTP_PASS in .env.");
  }

  return {
    transporter: nodemailer.createTransport({
      host,
      port: smtpPort,
      secure: process.env.SMTP_SECURE
        ? process.env.SMTP_SECURE.toLowerCase() === "true"
        : smtpPort === 465,
      auth: { user, pass: password },
    }),
    from: process.env.EMAIL_FROM || user,
  };
}

function asyncRoute(handler) {
  return (request, response) => {
    Promise.resolve(handler(request, response)).catch((error) => {
      console.error("Request failed:", error.message);
      if (!response.headersSent) {
        response.status(500).json({ error: "An unexpected server error occurred." });
      }
    });
  };
}

app.post("/api/register", asyncRoute(async (request, response) => {
  const username = typeof request.body.username === "string" ? request.body.username.trim() : "";
  const email = normalizeEmail(request.body.email);
  const password = typeof request.body.password === "string" ? request.body.password : "";

  if (username.length < 2 || username.length > 30) {
    return response.status(400).json({ error: "Username must be between 2 and 30 characters." });
  }
  if (!isValidEmail(email)) {
    return response.status(400).json({ error: "Enter a valid email address." });
  }
  if (password.length < 8 || password.length > 72) {
    return response.status(400).json({ error: "Password must be between 8 and 72 characters." });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  database.run(
    "INSERT INTO users (username, email, password) VALUES (?, ?, ?)",
    [username, email, passwordHash],
    function (error) {
      if (error) {
        if (error.code === "SQLITE_CONSTRAINT") {
          return response.status(409).json({ error: "An account with that email already exists." });
        }
        console.error("Could not create user:", error.message);
        return response.status(500).json({ error: "Could not create your account." });
      }

      const user = { id: this.lastID, username, email };
      startSession(response, user);
      return response.status(201).json({ message: "Account created.", user });
    }
  );
}));

app.post("/api/login", (request, response) => {
  const email = normalizeEmail(request.body.email);
  const password = typeof request.body.password === "string" ? request.body.password : "";

  if (!isValidEmail(email) || !password) {
    return response.status(400).json({ error: "Enter a valid email and password." });
  }

  database.get("SELECT id, username, email, password FROM users WHERE email = ?", [email], async (error, user) => {
    if (error) {
      console.error("Could not look up user:", error.message);
      return response.status(500).json({ error: "Could not sign in right now." });
    }

    const passwordMatches = user && await bcrypt.compare(password, user.password);
    if (!passwordMatches) {
      return response.status(401).json({ error: "Email or password is incorrect." });
    }

    const safeUser = { id: user.id, username: user.username, email: user.email };
    startSession(response, safeUser);
    return response.json({ message: "Signed in.", user: safeUser });
  });
});

app.post("/api/forgot-password", asyncRoute(async (request, response) => {
  const email = normalizeEmail(request.body.email);
  if (!isValidEmail(email)) {
    return response.status(400).json({ error: "Enter a valid email address." });
  }

  let transporter;
  let from;
  try {
    ({ transporter, from } = getSmtpSettings());
  } catch (error) {
    return response.status(503).json({ error: error.message });
  }
  const otp = crypto.randomInt(100000, 1000000).toString();
  const otpHash = crypto.createHash("sha256").update(otp).digest("hex");
  const userExists = await new Promise((resolve, reject) => {
    database.get("SELECT id FROM users WHERE email = ?", [email], (error, user) => {
      if (error) return reject(error);
      resolve(Boolean(user));
    });
  });

  if (userExists) {
    recoveryCodes.set(email, { hash: otpHash, expiresAt: Date.now() + OTP_LIFETIME_MS, attempts: 0 });
    try {
      await transporter.sendMail({
        from,
        to: email,
        subject: "Your Apex Battlegrounds recovery code",
        text: `Your password recovery code is ${otp}. It expires in 10 minutes. If you did not request this, you can ignore this email.`,
      });
    } catch (error) {
      recoveryCodes.delete(email);
      console.error("Could not send recovery email:", error.message);
      return response.status(502).json({ error: "Could not send recovery email. Check SMTP settings and try again." });
    }
  }

  return response.json({ message: "If an account exists for that email, a recovery code has been sent." });
}));

app.post("/api/verify-otp", asyncRoute(async (request, response) => {
  const email = normalizeEmail(request.body.email);
  const otp = typeof request.body.otp === "string" ? request.body.otp.trim() : "";
  const password = typeof request.body.password === "string" ? request.body.password : "";

  if (!isValidEmail(email) || !/^\d{6}$/.test(otp)) {
    return response.status(400).json({ error: "Enter the email address and 6-digit recovery code." });
  }
  if (password.length < 8 || password.length > 72) {
    return response.status(400).json({ error: "New password must be between 8 and 72 characters." });
  }

  const recovery = recoveryCodes.get(email);
  if (!recovery || recovery.expiresAt <= Date.now()) {
    recoveryCodes.delete(email);
    return response.status(400).json({ error: "That code is invalid or expired. Request a new one." });
  }
  if (recovery.attempts >= 5) {
    recoveryCodes.delete(email);
    return response.status(429).json({ error: "Too many attempts. Request a new recovery code." });
  }

  const submittedHash = crypto.createHash("sha256").update(otp).digest("hex");
  const matches = crypto.timingSafeEqual(Buffer.from(submittedHash), Buffer.from(recovery.hash));
  if (!matches) {
    recovery.attempts += 1;
    return response.status(400).json({ error: "That code is incorrect." });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  database.run("UPDATE users SET password = ? WHERE email = ?", [passwordHash, email], function (error) {
    if (error) {
      console.error("Could not update password:", error.message);
      return response.status(500).json({ error: "Could not update your password." });
    }
    if (this.changes === 0) {
      recoveryCodes.delete(email);
      return response.status(400).json({ error: "That code is invalid or expired. Request a new one." });
    }

    recoveryCodes.delete(email);
    return response.json({ message: "Password updated. You can now sign in." });
  });
}));

app.get("/api/me", (request, response) => {
  const user = getSessionUser(request);
  if (!user) return response.status(401).json({ error: "You are not signed in." });
  return response.json({ user });
});

app.post("/api/logout", (request, response) => {
  const sessionId = readCookie(request, COOKIE_NAME);
  sessions.delete(sessionId);
  response.setHeader("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  return response.json({ message: "Signed out." });
});

if (require.main === module) {
  initializeDatabase()
    .then(() => {
      app.listen(port, "0.0.0.0", () => {
        console.log(`Apex Battlegrounds is running at http://localhost:${port}`);
      });
    })
    .catch((error) => {
      console.error("Could not initialize the users table:", error.message);
      process.exitCode = 1;
    });
}

module.exports = app;
