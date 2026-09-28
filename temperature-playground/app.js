/*
 * LLM Temperature Playground
 *
 * Everything happens right here in your browser:
 *   1. Read the settings from the page and build a JSON request body.
 *   2. POST it to OpenAI's Chat Completions endpoint, with your API key
 *      in the Authorization header.
 *   3. Show the assistant's reply, plus the raw JSON that came back.
 *
 * Your API key is kept only in this browser's localStorage and is only ever
 * sent to api.openai.com. (The Content-Security-Policy in index.html also
 * stops this page from sending requests anywhere else.)
 */
"use strict";

const API_URL = "https://api.openai.com/v1/chat/completions";
const KEY_STORAGE_NAME = "temperature-playground.openai-api-key";
const TIMEOUT_SECONDS = 60;
const MAX_RUNS = 20;
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

// Where the reply text lives inside a successful response.
const REPLY_PATH = ["choices", 0, "message", "content"];

// Chrome and Firefox leave response.statusText empty for HTTP/2 responses
// (which is what OpenAI uses), so we keep our own names for common codes.
const STATUS_NAMES = {
  200: "OK",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

const $ = (id) => document.getElementById(id);

const ui = {
  apiKey: $("api-key"),
  toggleKey: $("toggle-key"),
  forgetKey: $("forget-key"),
  keyStatus: $("key-status"),
  prompt: $("prompt"),
  temperatureField: $("temperature-field"),
  temperature: $("temperature"),
  temperatureValue: $("temperature-value"),
  temperatureHint: $("temperature-hint"),
  model: $("model"),
  customModel: $("custom-model"),
  maxTokens: $("max-tokens"),
  send: $("send"),
  shortcutKey: $("shortcut-key"),
  sendProblem: $("send-problem"),
  responseCard: $("response-card"),
  responseEmpty: $("response-empty"),
  responseStatus: $("response-status"),
  responseError: $("response-error"),
  errorMessage: $("error-message"),
  errorHint: $("error-hint"),
  errorSource: $("error-source"),
  replyBlock: $("reply-block"),
  reply: $("reply"),
  finishNote: $("finish-note"),
  rawBlock: $("raw-block"),
  rawHeading: $("raw-heading"),
  responseJson: $("response-json"),
  requestJson: $("request-json"),
  curl: $("curl"),
  historyCard: $("history-card"),
  history: $("history"),
  clearHistory: $("clear-history"),
};

let sending = false;
const runs = [];

/* ---------- API key (stored only in this browser) ---------- */

function readSavedKey() {
  try {
    return localStorage.getItem(KEY_STORAGE_NAME) || "";
  } catch {
    return ""; // Storage is blocked (e.g. some private windows).
  }
}

// Returns false if the browser won't let us save it.
function saveKey(key) {
  try {
    if (key) localStorage.setItem(KEY_STORAGE_NAME, key);
    else localStorage.removeItem(KEY_STORAGE_NAME);
    return true;
  } catch {
    return false;
  }
}

function showKeyStatus(saved) {
  const key = ui.apiKey.value.trim();
  let message = "No key saved yet.";
  let tone = "";
  if (key && !saved) {
    message = "This browser won't let the page save your key, so you'll need to paste it again next time.";
    tone = "warn";
  } else if (key && !key.startsWith("sk-")) {
    message = "Saved in this browser. Heads-up: OpenAI keys normally start with “sk-”.";
    tone = "warn";
  } else if (key) {
    message = "✓ Saved in this browser.";
    tone = "ok";
  }
  ui.keyStatus.textContent = message;
  ui.keyStatus.className = `key-status ${tone}`;
}

/* ---------- Reading the settings ---------- */

function currentModel() {
  return ui.model.value === "custom" ? ui.customModel.value.trim() : ui.model.value;
}

function currentTemperature() {
  // Rounding hides float noise like 0.30000000000000004 from the JSON.
  return Math.round(Number(ui.temperature.value) * 100) / 100;
}

function describeTemperature(t) {
  if (t === 0) return "Most predictable. The model takes its top choice every time, so repeat sends give (almost) identical replies.";
  if (t <= 0.5) return "Focused. Replies stay close to the most likely wording, with small variations.";
  if (t < 1) return "Balanced. Some variety, still sensible.";
  if (t === 1) return "OpenAI's default. The model's odds are used exactly as they are.";
  if (t <= 1.4) return "Creative. Less common words get picked more often, so replies vary more.";
  if (t <= 1.7) return "Wild. Replies can drift off-topic or get strange.";
  return "Chaotic. Unlikely words get picked all the time. Expect gibberish.";
}

function showTemperature() {
  const t = currentTemperature();
  const description = describeTemperature(t);
  ui.temperatureValue.textContent = t.toFixed(1);
  ui.temperatureHint.textContent = `At ${t.toFixed(1)}: ${description}`;
  ui.temperature.setAttribute("aria-valuetext", `${t.toFixed(1)}. ${description}`);
  ui.temperatureField.style.setProperty("--temp", t); // drives the blue → red color
}

/* ---------- Building the request ---------- */

// This object becomes the JSON body of the request.
function buildRequestBody() {
  const body = {
    model: currentModel(),
    messages: [{ role: "user", content: ui.prompt.value.trim() }],
    temperature: currentTemperature(),
  };
  const maxTokens = Number(ui.maxTokens.value);
  if (Number.isInteger(maxTokens) && maxTokens > 0) {
    body.max_completion_tokens = maxTokens;
  }
  return body;
}

function curlCommand(body) {
  // Inside '...' a shell treats everything literally, except ' itself.
  const json = JSON.stringify(body, null, 2).replaceAll("'", "'\\''");
  return [
    "# 1. Put your key in an environment variable (once per terminal window):",
    'export OPENAI_API_KEY="paste-your-key-here"',
    "",
    "# 2. Send the same request this page sends:",
    `curl ${API_URL} \\`,
    '  -H "Content-Type: application/json" \\',
    '  -H "Authorization: Bearer $OPENAI_API_KEY" \\',
    `  -d '${json}'`,
  ].join("\n");
}

function updateRequestPreview() {
  const body = buildRequestBody();
  renderJson(ui.requestJson, body, ["temperature"]);
  ui.curl.textContent = curlCommand(body);
}

/* ---------- Sending it ---------- */

async function send() {
  if (sending) return;

  const apiKey = ui.apiKey.value.trim();
  const body = buildRequestBody();
  if (!apiKey) return showProblem("Paste your OpenAI API key into step 1 first.", ui.apiKey);
  if (!body.messages[0].content) return showProblem("Type a prompt first.", ui.prompt);
  if (!body.model) return showProblem("Type a model name, or pick one from the list.", ui.customModel);
  showProblem("");

  setSending(true);
  const startedAt = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_SECONDS * 1000);

  let response;
  let text;
  try {
    // ---- The actual API call ----
    response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    text = await response.text();
  } catch (error) {
    showStatus("No response", "bad");
    showError(
      error.name === "AbortError"
        ? `OpenAI didn't answer within ${TIMEOUT_SECONDS} seconds, so the request was cancelled.`
        : "Couldn't reach OpenAI.",
      error.name === "AbortError"
        ? "Try again, or lower the max reply length."
        : "Check your internet connection. Some ad blockers, VPNs and work networks block api.openai.com."
    );
    return;
  } finally {
    clearTimeout(timer);
    setSending(false);
  }

  const seconds = (performance.now() - startedAt) / 1000;
  showResponse(response, text, body, seconds);
}

function setSending(on) {
  sending = on;
  ui.send.disabled = on;
  ui.send.textContent = on ? "Sending…" : "Send to OpenAI";
  ui.responseCard.setAttribute("aria-busy", String(on));
  if (on) {
    clearResponse();
    showStatus("Waiting for OpenAI…", "pending");
    bringIntoView(ui.responseCard);
  }
}

/* ---------- Showing the result ---------- */

function showResponse(response, text, body, seconds) {
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    // Not JSON (rare, e.g. an HTML error page from a proxy). We'll show it as plain text.
  }

  const statusName = response.statusText || STATUS_NAMES[response.status] || "";
  const facts = [`HTTP ${response.status} ${statusName}`.trim(), `${seconds.toFixed(1)} s`];
  if (typeof data?.usage?.total_tokens === "number") facts.push(`${data.usage.total_tokens} tokens`);
  showStatus(facts.join(" · "), response.ok ? "ok" : "bad");

  ui.rawBlock.hidden = false;
  if (data !== null) {
    ui.rawHeading.textContent = "Raw JSON response";
    renderJson(ui.responseJson, data, response.ok ? REPLY_PATH : ["error", "message"]);
  } else {
    ui.rawHeading.textContent = "Raw response (not JSON)";
    ui.responseJson.textContent = text || "(The response was empty.)";
  }

  if (!response.ok) {
    const error = data?.error;
    showError(error?.message || `OpenAI answered with HTTP ${response.status}.`, errorHint(response.status, error));
    ui.errorSource.hidden = !error?.message;
    return;
  }

  const choice = data?.choices?.[0];
  const content = choice?.message?.content;
  const refusal = choice?.message?.refusal;
  const reply = content || refusal || "(The model sent back no text.)";

  ui.replyBlock.hidden = false;
  ui.reply.textContent = reply;

  const reasoningTokens = data?.usage?.completion_tokens_details?.reasoning_tokens || 0;
  let note = "";
  if (choice?.finish_reason === "length" && !content && reasoningTokens) {
    note = `✂ This is a reasoning model: it spent your whole max reply length thinking (${reasoningTokens} reasoning tokens) before writing anything. Raise the limit, or pick one of the listed models.`;
  } else if (choice?.finish_reason === "length") {
    note = '✂ The reply hit your max reply length and was cut off. That\'s why finish_reason is "length" instead of "stop".';
  } else if (!content && refusal) {
    note = "The model declined to answer. Its explanation is in choices[0].message.refusal.";
  }
  ui.finishNote.hidden = !note;
  ui.finishNote.textContent = note;

  addRun({
    temperature: body.temperature,
    model: data?.model || body.model,
    prompt: body.messages[0].content,
    reply,
  });
}

// Friendly advice for the errors beginners hit most often.
function errorHint(status, error) {
  const code = error?.code || "";
  const param = error?.param || "";
  const message = error?.message || "";

  if (status === 401) {
    return "Check the key in step 1: paste the whole thing (it starts with “sk-”), and make sure it hasn't been deleted in your OpenAI dashboard.";
  }
  if (code === "insufficient_quota") {
    return "Your OpenAI account is out of credit. Add some under Settings → Billing at platform.openai.com, then try again.";
  }
  if (status === 429) {
    return "Too many requests in a short time. Wait a few seconds and try again.";
  }
  if (param === "temperature" || /temperature/i.test(message)) {
    return "This model doesn't let you change the temperature. Many reasoning models (like gpt-5-mini and the o-series) keep it fixed. Switch back to one of the listed models.";
  }
  if (param === "max_completion_tokens" || /max_completion_tokens/.test(message)) {
    return "Try a smaller max reply length, or clear the box to leave it out of the request.";
  }
  if (status === 404 || code === "model_not_found") {
    return "Check the model name for typos, or pick one from the list. Not every account can use every model.";
  }
  if (status === 403) {
    return "Your key isn't allowed to do this. If you created a restricted key, give it permission to make model requests.";
  }
  if (status >= 500) {
    return "Something went wrong on OpenAI's side. Wait a moment and try again.";
  }
  return "";
}

function clearResponse() {
  ui.responseEmpty.hidden = true;
  ui.responseError.hidden = true;
  ui.replyBlock.hidden = true;
  ui.finishNote.hidden = true;
  ui.rawBlock.hidden = true;
}

function showStatus(text, tone) {
  ui.responseStatus.hidden = false;
  ui.responseStatus.textContent = text;
  ui.responseStatus.className = `status ${tone}`;
}

function showError(message, hint = "") {
  ui.responseError.hidden = false;
  ui.errorSource.hidden = true;
  ui.errorMessage.textContent = message;
  ui.errorHint.textContent = hint;
}

// Problems we can spot before sending anything (missing key, empty prompt...).
function showProblem(message, focusElement) {
  ui.sendProblem.hidden = !message;
  ui.sendProblem.textContent = message;
  focusElement?.focus();
}

function bringIntoView(element) {
  const { top } = element.getBoundingClientRect();
  if (top < 0 || top > window.innerHeight - 120) {
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
  }
}

/*
 * Pretty-prints `value` into a <pre> exactly like JSON.stringify(value, null, 2),
 * color-coding keys, strings, numbers and true/false/null, and wrapping the
 * entry at `markPath` (e.g. ["choices", 0, "message", "content"]) in a <mark>.
 * It only ever creates text nodes, so nothing in a response can inject HTML.
 */
function renderJson(pre, value, markPath) {
  const markId = JSON.stringify(markPath);
  pre.replaceChildren();

  function write(parent, text, className) {
    if (!className) {
      parent.append(text);
      return;
    }
    const span = document.createElement("span");
    span.className = className;
    span.textContent = text;
    parent.append(span);
  }

  function writeEntry(parent, key, entryValue, path, indent) {
    let target = parent;
    if (JSON.stringify(path) === markId) {
      target = document.createElement("mark");
      parent.append(target);
    }
    if (key !== null) {
      write(target, JSON.stringify(key), "json-key");
      write(target, ": ");
    }
    writeValue(target, entryValue, path, indent);
  }

  function writeValue(parent, v, path, indent) {
    if (v === null) return write(parent, "null", "json-literal");
    if (typeof v === "boolean") return write(parent, String(v), "json-literal");
    if (typeof v === "number") return write(parent, JSON.stringify(v), "json-number");
    if (typeof v === "string") return write(parent, JSON.stringify(v), "json-string");

    const isArray = Array.isArray(v);
    const keys = isArray ? v.map((_, i) => i) : Object.keys(v);
    const [open, close] = isArray ? ["[", "]"] : ["{", "}"];
    if (keys.length === 0) return write(parent, open + close);

    const inner = indent + "  ";
    write(parent, open + "\n");
    keys.forEach((key, i) => {
      write(parent, inner);
      writeEntry(parent, isArray ? null : key, v[key], [...path, key], inner);
      write(parent, i < keys.length - 1 ? ",\n" : "\n");
    });
    write(parent, indent + close);
  }

  writeValue(pre, value, [], "");
}

/* ---------- Comparing runs ---------- */

function addRun(run) {
  runs.unshift(run);
  runs.length = Math.min(runs.length, MAX_RUNS);
  renderRuns();
}

function renderRuns() {
  ui.historyCard.hidden = runs.length < 2;
  ui.history.replaceChildren(
    ...runs.map((run) => {
      const chip = document.createElement("span");
      chip.className = "temp-chip";
      chip.style.setProperty("--temp", run.temperature);
      chip.textContent = `T = ${run.temperature.toFixed(1)}`;

      const model = document.createElement("span");
      model.textContent = run.model;

      const prompt = document.createElement("span");
      prompt.className = "run-prompt";
      prompt.textContent = `“${run.prompt}”`;

      const meta = document.createElement("div");
      meta.className = "run-meta";
      meta.append(chip, model, prompt);

      const text = document.createElement("p");
      text.className = "run-text";
      text.textContent = run.reply;

      const item = document.createElement("li");
      item.className = "run";
      item.append(meta, text);
      return item;
    })
  );
}

/* ---------- Copy buttons ---------- */

async function copyText(button) {
  const source = $(button.dataset.copyTarget);
  const label = (button.dataset.label ??= button.textContent);
  try {
    await navigator.clipboard.writeText(source.textContent);
    button.textContent = "Copied!";
  } catch {
    // Clipboard blocked: select the text so it can be copied by hand.
    window.getSelection().selectAllChildren(source);
    button.textContent = `Selected. Press ${IS_MAC ? "⌘C" : "Ctrl+C"}`;
  }
  setTimeout(() => (button.textContent = label), 1800);
}

/* ---------- Wiring it all up ---------- */

ui.apiKey.value = readSavedKey();
showKeyStatus(true);
showTemperature();
updateRequestPreview();

if (IS_MAC) ui.shortcutKey.textContent = "⌘";

ui.apiKey.addEventListener("input", () => {
  showKeyStatus(saveKey(ui.apiKey.value.trim()));
  showProblem("");
});

ui.toggleKey.addEventListener("click", () => {
  const show = ui.apiKey.type === "password";
  ui.apiKey.type = show ? "text" : "password";
  ui.toggleKey.textContent = show ? "Hide" : "Show";
  ui.toggleKey.setAttribute("aria-pressed", String(show));
});

ui.forgetKey.addEventListener("click", () => {
  ui.apiKey.value = "";
  saveKey("");
  showKeyStatus(true);
  ui.apiKey.focus();
});

ui.temperature.addEventListener("input", () => {
  showTemperature();
  updateRequestPreview();
});

ui.model.addEventListener("change", () => {
  const custom = ui.model.value === "custom";
  ui.customModel.hidden = !custom;
  if (custom) ui.customModel.focus();
  updateRequestPreview();
});

for (const input of [ui.prompt, ui.customModel, ui.maxTokens]) {
  input.addEventListener("input", () => {
    updateRequestPreview();
    showProblem("");
  });
}

ui.send.addEventListener("click", send);

document.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    send();
  }
});

ui.clearHistory.addEventListener("click", () => {
  runs.length = 0;
  renderRuns();
});

for (const button of document.querySelectorAll("[data-copy-target]")) {
  button.addEventListener("click", () => copyText(button));
}
