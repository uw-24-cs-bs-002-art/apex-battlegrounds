# Apex Battlegrounds

A beginner-friendly Express and SQLite app with registration, login, guest access, and email-based password recovery.

## Run it locally

1. Install [Node.js](https://nodejs.org/) (version 20.17 or newer).
2. Open a terminal in this project folder and run `npm.cmd install` (or `npm install` in Command Prompt/macOS/Linux).
3. Copy `.env.example` to `.env`. To send recovery emails, enter SMTP credentials from your email provider. For Gmail, use a Google App Password rather than your normal password.
4. Run `npm.cmd start` and open [http://localhost:3000](http://localhost:3000).

The app creates `database.db` automatically. Registered passwords are stored as bcrypt hashes, not plain text. Recovery codes expire after 10 minutes and are held in memory, so restarting the server invalidates outstanding codes.

Email delivery requires valid SMTP settings. The rest of the app, including registration and login, works without email configured; password-recovery requests return a clear configuration error until SMTP is set up.

## Deploying

Set the same SMTP variables in your hosting provider's environment settings. The server listens on `0.0.0.0` and uses the host-provided `PORT` when available. SQLite data is stored in `database.db`; use a persistent disk/volume on hosts with ephemeral filesystems.

This is a small demo app. Its in-memory sessions and OTPs are cleared when the server restarts and are not shared across multiple server instances.
