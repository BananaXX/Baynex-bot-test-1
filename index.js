const TelegramBot = require('node-telegram-bot-api');
const WebSocket = require('ws');
require('dotenv').config();

// Load environment variables
const token = process.env.TELEGRAM_TOKEN;
const derivToken = process.env.DERIV_TOKEN;
const appId = process.env.APP_ID;
const chatId = process.env.CHAT_ID;

// Initialize Telegram Bot
const bot = new TelegramBot(token, { polling: true });

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, 'B.A.Y.N.E.X activated. Awaiting your commands.');
});

// ✅ NEW: /help command
bot.onText(/\/help/, (msg) => {
  const helpText = `
🤖 *B.A.Y.N.E.X Commands:*

/start - Activate the bot  
/balance - Fetch your Deriv account balance  
/help - Show this help message

More features coming soon...`;
  bot.sendMessage(msg.chat.id, helpText, { parse_mode: "Markdown" });
});

// Handle /balance
bot.onText(/\/balance/, (msg) => {
  bot.sendMessage(msg.chat.id, 'Fetching your Deriv balance...');

  const ws = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=${appId}`);

  ws.onopen = () => {
    ws.send(JSON.stringify({
      authorize: derivToken
    }));
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.msg_type === 'authorize') {
      ws.send(JSON.stringify({ balance: 1 }));
    } else if (data.msg_type === 'balance') {
      const balance = data.balance.balance;
      const currency = data.balance.currency;
      bot.sendMessage(msg.chat.id, `💰 Your Deriv balance: ${balance} ${currency}`);
      ws.close();
    } else if (data.error) {
      bot.sendMessage(msg.chat.id, `❌ Deriv error: ${data.error.message}`);
      ws.close();
    }
  };

  ws.onerror = (error) => {
    console.error("WebSocket Error:", error);
    bot.sendMessage(msg.chat.id, '❌ Connection error while connecting to Deriv.');
  };
});
