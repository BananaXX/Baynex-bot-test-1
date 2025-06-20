/**
 * BAYNEX Telegram – Deriv helper bot
 * ----------------------------------
 *  ✅ Webhook mode (Express)
 *  ✅ /start and /help
 *  ✅ /balance  – shows authorised Deriv balance
 *  ✅ /ping     – health-check endpoint (for UptimeRobot / Render)
 *  ✅ Minimal console logging for easy debugging
 */

const express   = require("express");
const fetch     = require("node-fetch");
const WebSocket = require("ws");
require("dotenv").config();

const app = express();
app.use(express.json());

// 🔑 ENV VARS -------------------------------------------------
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const DERIV_TOKEN    = process.env.DERIV_TOKEN;
const APP_ID         = process.env.APP_ID;              // Deriv App-ID
const PORT           = process.env.PORT || 10000;       // Render sees the port we listen on

// 🔧 tiny helper so every log line is time-stamped
const log = (...args) => console.log(new Date().toISOString(), ...args);

// ────────────────────────────────────────────────────────────
// 0)  Health-check route (so external pings never hit /webhook)
// ────────────────────────────────────────────────────────────
app.get("/ping", (_, res) => res.send("👌 Baynex OK"));

// ────────────────────────────────────────────────────────────
// 1)  Ensure Telegram webhook is set (runs once at boot)
// ────────────────────────────────────────────────────────────
(async () => {
  try {
    const hookURL = `https://${process.env.RENDER_EXTERNAL_HOSTNAME}/webhook`;
    const res     = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/setWebhook`,
      {
        method : "POST",
        headers: { "Content-Type": "application/json" },
        body   : JSON.stringify({ url: hookURL })
      }
    );
    log("Telegram webhook set:", await res.json());
  } catch (e) {
    log("❌ Error setting webhook", e);
  }
})();

// ────────────────────────────────────────────────────────────
// 2)  Handle *all* Telegram updates
// ────────────────────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  const chat = req.body.message?.chat?.id;
  const text = (req.body.message?.text || "").trim();
  const [cmd, ...args] = text.split(/\s+/);

  log("← Telegram", { cmd, args });

  switch ((cmd || "").toLowerCase()) {
    case "/start":
      // reply only to exact “/start”, ignore any echoes
      if (text === "/start") {
        await sendTG(chat, "🤖 B.A.Y.N.E.X online. Type /help.");
      }
      break;

    case "/help":
      await sendTG(
        chat,
`B.A.Y.N.E.X Commands
/start      – boot
/balance    – Deriv balance`
      );
      break;

    case "/balance":
      await sendTG(chat, "📡 Fetching your Deriv balance…");
      getDerivBalance(chat);
      break;

    default:
      // answer only if the message *looks* like a command
      if (cmd.startsWith("/")) {
        await sendTG(chat, "❓ Unknown command. Type /help");
      }
  }

  // always ACK so Telegram stops retrying
  res.sendStatus(200);
});

// ────────────────────────────────────────────────────────────
// 3)  Telegram send helper
// ────────────────────────────────────────────────────────────
async function sendTG(chat_id, text) {
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method : "POST",
      headers: { "Content-Type": "application/json" },
      body   : JSON.stringify({ chat_id, text })
    });
    log("→ Telegram", text.replace(/\n/g, " "));
  } catch (e) {
    log("❌ sendTG error", e);
  }
}

// ────────────────────────────────────────────────────────────
// 4)  Deriv balance helper
// ────────────────────────────────────────────────────────────
function getDerivBalance(chat) {
  const ws = new WebSocket(
    `wss://ws.deriv.com/websockets/v3?app_id=${APP_ID}`
  );

  ws.onopen = () => {
    log("WS open → authorising");
    ws.send(JSON.stringify({ authorize: DERIV_TOKEN }));
  };

  ws.onmessage = async (event) => {
    const data = JSON.parse(event.data);
    log("WS msg_type:", data.msg_type);

    if (data.msg_type === "authorize") {
      ws.send(JSON.stringify({ balance: 1, account: "current" }));
    } else if (data.msg_type === "balance") {
      const bal  = data.balance.balance;
      const curr = data.balance.currency;
      await sendTG(chat, `💰 Balance: ${bal} ${curr}`);
      ws.close();
    } else if (data.error) {
      await sendTG(chat, `⚠️ Deriv error: ${data.error.message}`);
      ws.close();
    }
  };

  ws.onerror = async (err) => {
    log("WS error", err.message);
    await sendTG(chat, `❌ Deriv connection error: ${err.message}`);
  };
}

// ────────────────────────────────────────────────────────────
// 5)  Start server
// ────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  log(`🚀 BAYNEX listening on ${PORT}`);
});
