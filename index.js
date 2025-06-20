const express   = require("express");
const fetch     = require("node-fetch");
const WebSocket = require("ws");
require("dotenv").config();

const app  = express();
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const DERIV_TOKEN    = process.env.DERIV_TOKEN;
const APP_ID         = process.env.APP_ID;
const PORT           = process.env.PORT || 3000;

/* ----------------- Telegram webhook ----------------- */
app.post("/webhook", async (req, res) => {
  const chat_id = req.body.message?.chat?.id;
  const text    = (req.body.message?.text || "").trim().toLowerCase();

  if (text === "/start") {
    await sendTelegram(chat_id, "B.A.Y.N.E.X activated. Awaiting your commands.");
  } else if (text === "/balance") {
    await sendTelegram(chat_id, "Fetching your Deriv balance…");
    getDerivBalance(chat_id);
  } else {
    await sendTelegram(chat_id, "Command not recognized.");
  }

  res.sendStatus(200);
});

/* ----------------- Helpers ----------------- */
async function sendTelegram(chat_id, text) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method : "POST",
    headers: { "Content-Type": "application/json" },
    body   : JSON.stringify({ chat_id, text }),
  });
}

function getDerivBalance(chat_id) {
  /* ✅ 1) FIXED: use the official Deriv endpoint + your APP_ID  */
  const DERIV_WS = `wss://ws.binaryws.com/websockets/v3?app_id=${APP_ID}`;

  const ws = new WebSocket(DERIV_WS);

  ws.onopen = () => {
    ws.send(JSON.stringify({ authorize: DERIV_TOKEN }));
  };

  /* ✅ 2) FIXED: send a **valid** balance request once authorized */
  ws.onmessage = async (evt) => {
    try {
      const data = JSON.parse(evt.data);

      if (data.msg_type === "authorize") {
        ws.send(
          JSON.stringify({
            balance: 1,
            account: "current",   // <-- required by Deriv for one-shot balance
          })
        );
      } else if (data.msg_type === "balance") {
        const { balance, currency } = data.balance;
        await sendTelegram(chat_id, `Your Deriv balance is: ${balance} ${currency}`);
        ws.close();
      } else if (data.error) {
        await sendTelegram(chat_id, `❌ Deriv error: ${data.error.message}`);
        ws.close();
      }
    } catch (e) {
      await sendTelegram(chat_id, `❌ JSON parse error: ${e.message}`);
      ws.close();
    }
  };

  /* optional: extra visibility if DNS / TLS fails */
  ws.onerror = async (err) => {
    await sendTelegram(chat_id, `❌ Deriv connection error: ${err.message}`);
  };
}

app.listen(PORT, () => {
  console.log(`BAYNEX is live on port ${PORT}`);
});
