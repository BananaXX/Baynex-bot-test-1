// index.js – BAYNEX v2
const express = require("express");
const fetch = require("node-fetch");
const WebSocket = require("ws");
require("dotenv").config();

const app = express();
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const DERIV_TOKEN    = process.env.DERIV_TOKEN;
const APP_ID         = process.env.APP_ID;
const PORT           = process.env.PORT || 3000;

// ────────────────────────────────────────────────────────────────
// 1)  SET WEBHOOK ON COLD START ONLY
//    (Render restarts always call this file, but setWebhook runs
//     once because we await it before starting the server.)
(async () => {
  const WEBHOOK_URL = `https://${process.env.RENDER_EXTERNAL_HOSTNAME}/webhook`;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/setWebhook`, {
    method : "POST",
    headers: { "Content-Type": "application/json" },
    body   : JSON.stringify({ url: WEBHOOK_URL })
  }).then(r => r.json())
    .then(j => console.log("Telegram webhook set ▶", j))
    .catch(e => console.log("Webhook already set (ignoring)", e.message));
})();
// ────────────────────────────────────────────────────────────────

// 2)  TELEGRAM WEBHOOK HANDLER
app.post("/webhook", async (req, res) => {
  const chat_id = req.body.message?.chat?.id;
  const text    = (req.body.message?.text || "").trim().toLowerCase();

  switch (text) {
    case "/start":
      await sendTelegram(chat_id, "🤖 B.A.Y.N.E.X is online and smarter than ever. Ready for commands.");
      break;

    case "/balance":
      await sendTelegram(chat_id, "📡 Fetching your Deriv balance…");
      getDerivBalance(chat_id);
      break;

    case "/help":
      await sendTelegram(chat_id,
        "🆘 *BAYNEX Help*\n" +
        "• /start – wake the bot\n" +
        "• /balance – show Deriv balance\n" +
        "• /help – this message", { parse_mode: "Markdown" });
      break;

    default:
      await sendTelegram(chat_id, "⚠️ Unrecognised command. Type /help");
  }
  res.sendStatus(200);
});

// 3)  HELPERS
async function sendTelegram(chat_id, text, extra = {}) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method : "POST",
    headers: { "Content-Type": "application/json" },
    body   : JSON.stringify({ chat_id, text, ...extra })
  });
}

function getDerivBalance(chat_id, attempt = 0) {
  // Two endpoints – primary + fallback
  const ENDPOINTS = [
    `wss://ws.deriv.com/websockets/v3?app_id=${APP_ID}`,
    `wss://ws.binaryws.com/websockets/v3?app_id=${APP_ID}`
  ];
  const ws = new WebSocket(ENDPOINTS[attempt]);

  ws.onopen = () => ws.send(JSON.stringify({ authorize: DERIV_TOKEN }));

  ws.onmessage = async (ev) => {
    const d = JSON.parse(ev.data);
    if (d.msg_type === "authorize") {
      ws.send(JSON.stringify({ balance: 1, account: "current" }));
    } else if (d.msg_type === "balance") {
      await sendTelegram(chat_id, `💰 Your Deriv balance is: ${d.balance.balance} ${d.balance.currency}`);
      ws.close();
    } else if (d.error) {
      await sendTelegram(chat_id, `❌ Deriv error: ${d.error.message}`);
      ws.close();
    }
  };

  ws.onerror = async (err) => {
    await sendTelegram(chat_id, `❌ Deriv connection error: ${err.message}`);
    ws.close();
  };

  ws.onclose = () => {
    // Retry once with the fallback endpoint if first try failed
    if (attempt === 0) getDerivBalance(chat_id, 1);
  };
}

// 4)  LAUNCH
app.listen(PORT, () => console.log(`✅ BAYNEX Webhook live on ${PORT}`));

