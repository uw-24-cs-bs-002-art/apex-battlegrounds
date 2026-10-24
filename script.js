const splash = document.querySelector("#splash");
const loginTab = document.querySelector("#login-tab");
const registerTab = document.querySelector("#register-tab");
const loginForm = document.querySelector("#login-panel");
const registerForm = document.querySelector("#register-panel");
const authCard = document.querySelector("#auth-card");
const welcomeCard = document.querySelector("#welcome-card");
const recoveryBackdrop = document.querySelector("#recovery-backdrop");
const requestCodeForm = document.querySelector("#request-code-form");
const verifyCodeForm = document.querySelector("#verify-code-form");
let recoveryEmail = "";

window.setTimeout(() => {
  splash.classList.add("is-gone");
}, 2500);

function setAuthTab(mode) {
  const isLogin = mode === "login";
  loginTab.classList.toggle("active", isLogin);
  registerTab.classList.toggle("active", !isLogin);
  loginTab.setAttribute("aria-selected", String(isLogin));
  registerTab.setAttribute("aria-selected", String(!isLogin));
  loginForm.hidden = !isLogin;
  registerForm.hidden = isLogin;
  loginForm.classList.toggle("active", isLogin);
  registerForm.classList.toggle("active", !isLogin);
}

function showMessage(form, message, isSuccess = false) {
  const messageElement = form.querySelector(".form-message");
  messageElement.textContent = message;
  messageElement.classList.toggle("success", isSuccess);
}

async function sendRequest(url, data) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(data),
  });
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || "The request could not be completed.");
  }
  return result;
}

function displayWelcome(user, isGuest = false) {
  authCard.hidden = true;
  welcomeCard.hidden = false;
  document.querySelector("#welcome-name").textContent = user.username;
  document.querySelector("#welcome-copy").textContent = isGuest
    ? "You’re playing as a guest. Create an account to save your progress."
    : "Your squad is ready. The arena is yours.";
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const mode = form.dataset.mode;
  const button = form.querySelector(".primary-button");
  const formData = new FormData(form);
  const data = Object.fromEntries(formData.entries());

  showMessage(form, "");
  button.disabled = true;

  try {
    const result = await sendRequest(`/api/${mode}`, data);
    displayWelcome(result.user);
  } catch (error) {
    showMessage(form, error.message);
  } finally {
    button.disabled = false;
  }
}

loginTab.addEventListener("click", () => setAuthTab("login"));
registerTab.addEventListener("click", () => setAuthTab("register"));
document.querySelector(".switch-register").addEventListener("click", () => setAuthTab("register"));
document.querySelector(".switch-login").addEventListener("click", () => setAuthTab("login"));
loginForm.addEventListener("submit", handleAuthSubmit);
registerForm.addEventListener("submit", handleAuthSubmit);

document.querySelectorAll(".password-toggle").forEach((toggle) => {
  toggle.addEventListener("click", () => {
    const input = toggle.parentElement.querySelector("input");
    const shouldShow = input.type === "password";
    input.type = shouldShow ? "text" : "password";
    toggle.setAttribute("aria-label", shouldShow ? "Hide password" : "Show password");
    toggle.setAttribute("aria-pressed", String(shouldShow));
  });
});

document.querySelectorAll(".guest-button").forEach((button) => {
  button.addEventListener("click", () => displayWelcome({ username: "Guest Operative" }, true));
});

function openRecovery() {
  recoveryBackdrop.hidden = false;
  requestCodeForm.hidden = false;
  verifyCodeForm.hidden = true;
  requestCodeForm.reset();
  verifyCodeForm.reset();
  showMessage(requestCodeForm, "");
  showMessage(verifyCodeForm, "");
  document.querySelector("#recovery-description").textContent =
    "Enter the email linked to your account and we’ll send you a recovery code.";
  document.querySelector("#recovery-email").focus();
}

function closeRecovery() {
  recoveryBackdrop.hidden = true;
}

document.querySelectorAll(".forgot-link").forEach((button) => button.addEventListener("click", openRecovery));
document.querySelector("#close-recovery").addEventListener("click", closeRecovery);
recoveryBackdrop.addEventListener("click", (event) => {
  if (event.target === recoveryBackdrop) closeRecovery();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !recoveryBackdrop.hidden) closeRecovery();
});

requestCodeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = requestCodeForm.querySelector(".primary-button");
  recoveryEmail = new FormData(requestCodeForm).get("email").toString().trim();
  button.disabled = true;
  showMessage(requestCodeForm, "");

  try {
    const result = await sendRequest("/api/forgot-password", { email: recoveryEmail });
    requestCodeForm.hidden = true;
    verifyCodeForm.hidden = false;
    document.querySelector("#recovery-description").textContent = result.message;
    document.querySelector("#recovery-otp").focus();
  } catch (error) {
    showMessage(requestCodeForm, error.message);
  } finally {
    button.disabled = false;
  }
});

verifyCodeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = verifyCodeForm.querySelector(".primary-button");
  const formData = new FormData(verifyCodeForm);
  button.disabled = true;
  showMessage(verifyCodeForm, "");

  try {
    await sendRequest("/api/verify-otp", {
      email: recoveryEmail,
      otp: formData.get("otp"),
      password: formData.get("password"),
    });
    closeRecovery();
    setAuthTab("login");
    document.querySelector("#login-email").value = recoveryEmail;
    showMessage(loginForm, "Password updated. Sign in with your new password.", true);
  } catch (error) {
    showMessage(verifyCodeForm, error.message);
  } finally {
    button.disabled = false;
  }
});

document.querySelector(".resend-link").addEventListener("click", () => {
  document.querySelector("#recovery-email").value = recoveryEmail;
  requestCodeForm.hidden = false;
  verifyCodeForm.hidden = true;
  document.querySelector("#recovery-description").textContent =
    "Enter the email linked to your account and we’ll send you a new recovery code.";
  showMessage(requestCodeForm, "");
});

document.querySelector("#logout-button").addEventListener("click", async () => {
  try {
    await fetch("/api/logout", { method: "POST", credentials: "same-origin" });
  } finally {
    welcomeCard.hidden = true;
    authCard.hidden = false;
    loginForm.reset();
    registerForm.reset();
    setAuthTab("login");
  }
});

fetch("/api/me", { credentials: "same-origin" })
  .then(async (response) => {
    if (!response.ok) return;
    const result = await response.json();
    displayWelcome(result.user);
  })
  .catch((error) => {
    console.error("Could not check the current session:", error);
  });
