// ────────────────────────────
//  BAYNEX  – 7 · 2025 edition
// ────────────────────────────
const express   = require("express");
const fetch     = require("node-fetch");
const WebSocket = require("ws");
require("dotenv").config();

const app  = express();
app.use(express.json());

const TELE_TOKEN = process.env.TELEGRAM_TOKEN;
const DERIV_TOKEN = process.env.DERIV_TOKEN;
const APP_ID      = process.env.APP_ID || 1;      // Deriv demo app_id fallback
const PORT        = process.env.PORT || 10000;    // Render detects this automatically

// ── 1️⃣  Telegram webhook (runs once at boot) ──────────────────────────────
(async () => {
  try {
    const url = `https://${process.env.RENDER_EXTERNAL_HOSTNAME}/webhook`;
    const r   = await fetch(`https://api.telegram.org/bot${TELE_TOKEN}/setWebhook`, {
      method : "POST",
      headers: { "Content-Type": "application/json" },
      body   : JSON.stringify({ url })
    }).then(r => r.json());
    console.log("✅ Telegram webhook set:", r);
  } catch (err) {
    console.error("❌ Failed to set webhook:", err.message);
  }
})();

// ── 2️⃣  Helper: send a Telegram message ───────────────────────────────────
async function sendTG(chat, text) {
  try {
    await fetch(`https://api.telegram.org/bot${TELE_TOKEN}/sendMessage`, {
      method : "POST",
      headers: { "Content-Type": "application/json" },
      body   : JSON.stringify({ chat_id: chat, text, parse_mode: "Markdown" })
    });
    console.log("→ Telegram", text);
  } catch (e) {
    console.error("❌ Telegram send error:", e.message);
  }
}

// ── 3️⃣  Deriv balance with automatic fallback host ───────────────────────
function getDerivBalance(chat) {
  const PRIMARY_WS  = `wss://ws.deriv.com/websockets/v3?app_id=${APP_ID}`;
  const FALLBACK_WS = `wss://ws.binaryws.com/websockets/v3?app_id=${APP_ID}`;

  connectWS(PRIMARY_WS);

  function connectWS(url, isFallback = false) {
    console.log("🌐 Opening WS:", url);
    const ws = new WebSocket(url);

    ws.onopen = () => {
      console.log("✔️  WS open, authorising");
      ws.send(JSON.stringify({ authorize: DERIV_TOKEN }));
    };

    ws.onmessage = async ev => {
      const data = JSON.parse(ev.data);
      if (data.msg_type === "authorize") {
        ws.send(JSON.stringify({ balance: 1, account: "current" }));
      } else if (data.msg_type === "balance") {
        const { balance: balObj = {} } = data;
        const { balance = "?", currency = "" } = balObj;
        await sendTG(chat, `💰 Your Deriv balance is: *${balance} ${currency}*`);
        ws.close();
      } else if (data.error) {
        await sendTG(chat, `❌ Deriv error: ${data.error.message}`);
        ws.close();
      }
    };

    ws.onerror = async err => {
      console.error("WS error", err.message);
      ws.close();
    };

    ws.onclose = async e => {
      if (!isFallback) {
        console.warn("WS closed – trying fallback host…");
        // try fallback once
        connectWS(FALLBACK_WS, true);
      } else {
        await sendTG(chat, `❌ Deriv connection error: ${e.reason || "Unknown"}`);
      }
    };
  }
}

// ── 4️⃣  Main webhook handler  ────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  const chat = req.body.message?.chat?.id;
  const text = (req.body.message?.text || "").trim();
  const [cmd, ...args] = text.split(/\s+/);

  console.log("← Telegram", { cmd, args });

  switch (cmd) {
    case "/start":
      return sendTG(chat, "🤖 B.A.Y.N.E.X online. Type /help.");
    case "/help":
      return sendTG(chat, "B.A.Y.N.E.X Commands\n/start – boot\n/balance – Deriv balance");
    case "/balance":
      await sendTG(chat, "📡 Fetching your Deriv balance…");
      return getDerivBalance(chat);
    default:
      return sendTG(chat, "❓ Unknown command. /help");
  }
});

// ── 5️⃣  Start Express server ─────────────────────────────────────────────
app.listen(PORT, () =>
  console.log(`🚀 BAYNEX listening on ${PORT}`)
);
