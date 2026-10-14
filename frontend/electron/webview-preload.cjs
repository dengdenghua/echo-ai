/**
 * Echo browser tabs — page preload (main frame, isolated world).
 *
 * Reports a submitted login (username + password) to the main process so
 * the browser can offer to save it. It exposes nothing to the page and
 * only reads a form when the user submits it.
 */
const { ipcRenderer } = require("electron");

const USER_FIELD = [
  'input[autocomplete="username"]',
  'input[type="email"]',
  'input[name*="user" i]',
  'input[name*="email" i]',
  'input[name*="login" i]',
  'input[name*="account" i]',
  'input[type="text"]',
  'input[type="tel"]',
].join(", ");

function readLogin(scope) {
  const root = scope && scope.querySelectorAll ? scope : document;
  const password = Array.from(
    root.querySelectorAll('input[type="password"]'),
  ).find((input) => input.value);
  if (!password) return null;
  const form = password.form || root;
  const user = Array.from(form.querySelectorAll(USER_FIELD)).find(
    (input) => input.value && input.value.trim(),
  );
  if (!user) return null;
  return {
    username: user.value.trim().slice(0, 200),
    password: password.value.slice(0, 500),
  };
}

let lastReported = "";
function report(scope) {
  const login = readLogin(scope);
  if (!login) return;
  const key = `${login.username}\u0000${login.password}`;
  if (key === lastReported) return;
  lastReported = key;
  ipcRenderer.send("browser-page:login-submitted", login);
}

window.addEventListener(
  "submit",
  (event) =>
    report(
      event.target && event.target.form ? event.target.form : event.target,
    ),
  true,
);
// Script-driven logins often skip the submit event.
window.addEventListener(
  "click",
  (event) => {
    const target = event.target;
    const button =
      target && target.closest
        ? target.closest('button, input[type="submit"], [role="button"]')
        : null;
    if (button) report(button.closest("form") || document);
  },
  true,
);
window.addEventListener(
  "keydown",
  (event) => {
    const target = event.target;
    if (event.key === "Enter" && target && target.type === "password")
      report(target.form || document);
  },
  true,
);
