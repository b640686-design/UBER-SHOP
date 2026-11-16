
require("dotenv").config({ quiet: true });

const { Bot } = require("grammy");

const bot = new Bot(process.env.BOT_TOKEN);

console.log("🚀 Диагностика UBER-SHOP");

bot.command("start", async ctx => {
  console.log("✅ Команда /start получена");
  console.log("📤 Отправляем ответ...");

  try {
    const result = await ctx.reply(
      "✅ UBER-SHOP работает! 🎉"
    );

    console.log(
      "✅ Telegram принял сообщение:",
      result.message_id
    );
  } catch (error) {
    console.error("❌ Не удалось отправить сообщение!");
    console.error("Ошибка:", error.message);
  }
});

bot.catch(error => {
  console.error(
    "❌ Ошибка grammY:",
    error.error?.message || error.message
  );
});

bot.start({
  onStart: info => {
    console.log("✅ Бот запущен:", info.username);
  }
}).catch(error => {
  console.error("❌ Ошибка запуска:", error.message);
});
