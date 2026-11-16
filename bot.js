
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { Bot, InlineKeyboard, InputFile } = require("grammy");
const products = require("./products");

if (!process.env.BOT_TOKEN) {
  throw new Error("Добавь BOT_TOKEN в .env");
}

const bot = new Bot(process.env.BOT_TOKEN);

const ADMIN_ID = Number(process.env.ADMIN_ID);
const ADMIN_USERNAME = "Standoff_Bexruz";
const CARD_NUMBER = "4916 9903 1516 3920";

const assets = path.join(__dirname, "assets");
const welcome = path.join(assets, "welcome.jpg");
const dbPath = path.join(__dirname, "orders.json");

const paynetPhotos = [1, 2, 3, 4].map(
  n => path.join(assets, `paynet${n}.jpg`)
);

const sessions = new Map();
const screens = new Map();

let db = { nextId: 1, orders: [] };

if (fs.existsSync(dbPath)) {
  db = JSON.parse(fs.readFileSync(dbPath, "utf8"));
}

if (!Array.isArray(db.orders)) db.orders = [];
if (!Number.isSafeInteger(db.nextId)) db.nextId = 1;

function saveDB() {
  const temp = dbPath + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(db, null, 2));
  fs.renameSync(temp, dbPath);
}

const money = n =>
  Math.round(n).toLocaleString("ru-RU") + " сум";

const isAdmin = ctx =>
  ADMIN_ID > 0 && ctx.from?.id === ADMIN_ID;

const adminUrl = `https://t.me/${ADMIN_USERNAME}`;

// ==================================
// ГЛАВНОЕ МЕНЮ
// ==================================

function mainMenu() {
  return new InlineKeyboard()
    .text("🎮 Robux", "cat:robux")
    .text("💎 TG Premium", "cat:premium")
    .row()
    .text("⭐ TG Stars", "cat:stars")
    .text("💳 Steam СНГ", "cat:steam")
    .row()
    .text("📦 Мои заказы", "orders")
    .row()
    .text("👨‍💼 Поддержка", "support");
}

function home(name) {
  return {
    photo: welcome,
    text: `🛍️ UBER-SHOP

👋 Привет, ${name}!

Добро пожаловать в магазин цифровых товаров.

🎮 Robux
💎 Telegram Premium
⭐ Telegram Stars
💳 Пополнение Steam СНГ

👇 Выберите категорию.

👨‍💼 Администратор: @${ADMIN_USERNAME}
⏳ Ожидание ответа — до 20 часов.`,
    keyboard: mainMenu()
  };
}

// ==================================
// СООБЩЕНИЯ
// ==================================

async function remove(ctx, id) {
  if (!id) return;

  try {
    await ctx.api.deleteMessage(ctx.chat.id, id);
  } catch (error) {
    console.log("Удаление:", error.message);
  }
}

async function sendPage(ctx, page) {
  let sent;

  if (
    page.photo &&
    fs.existsSync(page.photo) &&
    fs.statSync(page.photo).size > 0
  ) {
    try {
      sent = await ctx.replyWithPhoto(
        new InputFile(page.photo),
        {
          caption: page.text,
          reply_markup: page.keyboard
        }
      );
    } catch (error) {
      console.error("Фото:", error.message);
    }
  }

  if (!sent) {
    sent = await ctx.reply(page.text, {
      reply_markup: page.keyboard
    });
  }

  screens.set(ctx.from.id, sent.message_id);
  return sent;
}

// Старое сообщение удаляется,
// вместо него приходит новое.
async function navigate(ctx, page) {
  await ctx.answerCallbackQuery();

  const old = ctx.callbackQuery.message?.message_id;
  const sent = await sendPage(ctx, page);

  await remove(ctx, old);
  return sent;
}

async function afterInput(ctx, page) {
  const old = screens.get(ctx.from.id);
  const sent = await sendPage(ctx, page);

  await remove(ctx, old);
  await remove(ctx, ctx.message.message_id);

  return sent;
}

// ==================================
// КАТАЛОГ
// ==================================

function categoryPage(key) {
  const category = products[key];
  const kb = new InlineKeyboard();

  category.items.forEach((item, i) => {
    kb.text(
      `${item.name} — ${money(item.price)}`,
      `item:${key}:${i}`
    ).row();
  });

  kb.text("🏠 Главное меню", "home");

  return {
    text: `${category.title}

${category.description}

👇 Выберите товар:`,
    keyboard: kb
  };
}

function productPage(key, index) {
  const item = products[key]?.items[index];

  if (!item) return null;

  return {
    text: `🛍️ UBER-SHOP

📦 ${products[key].title}
🎁 ${item.name}
💰 Цена: ${money(item.price)}

Для оформления потребуются данные получателя.

🔐 Пароли и коды входа не отправляйте.`,
    keyboard: new InlineKeyboard()
      .text("✅ Оформить", `buy:${key}:${index}`)
      .row()
      .text("⬅️ К товарам", `cat:${key}`)
      .row()
      .text("🏠 Главное меню", "home")
  };
}

function steamPage() {
  return {
    text: `💳 STEAM СНГ

🌍 Регион: СНГ

💰 Минимум: 12 000 сум без комиссии
📈 Комиссия: 17%
💵 Максимальная оплата: 470 000 сум

Итог округляется до ближайшей 1 000 сум.

Для оформления потребуется логин Steam.`,
    keyboard: new InlineKeyboard()
      .text("🧮 Рассчитать пополнение", "steam:start")
      .row()
      .text("🏠 Главное меню", "home")
  };
}

// ==================================
// СЕССИИ И ДАННЫЕ
// ==================================

function beginSession(order, stage, userId) {
  const session = {
    order: { ...order },
    stage
  };

  sessions.set(userId, session);
  return session;
}

function cancelKeyboard() {
  return new InlineKeyboard()
    .text("❌ Отменить", "order:cancel");
}

function fieldPage(s) {
  let prompt = "";

  if (s.stage === "amount") {
    prompt = `Введите сумму пополнения Steam.

Минимум: 12 000 сум без комиссии.
Итог с комиссией — не более 470 000 сум.`;
  }

  if (s.stage === "account") {
    prompt =
      s.order.type === "robux"
        ? "Введите Roblox username."
        : s.order.type === "steam"
        ? "Введите логин Steam."
        : "Введите Telegram username получателя.";
  }

  if (s.stage === "phone") {
    prompt = `Введите номер телефона получателя Telegram.

Формат: +998901234567

Указывайте номер с согласия владельца.`;
  }

  return {
    text: `📝 ОФОРМЛЕНИЕ

📦 ${s.order.title}

${prompt}

⚠️ Не отправляйте пароли, коды входа и данные банковских карт.`,
    keyboard: cancelKeyboard()
  };
}

function validAccount(value, type) {
  if (type === "robux") {
    return /^[A-Za-z0-9_]{3,20}$/.test(value);
  }

  if (["premium", "stars"].includes(type)) {
    return /^@?[A-Za-z][A-Za-z0-9_]{4,31}$/.test(value);
  }

  return (
    value.length >= 2 &&
    value.length <= 64 &&
    !/[\r\n]/.test(value)
  );
}

function validPhone(value) {
  return /^\+[1-9]\d{8,14}$/.test(
    value.replace(/[\s()-]/g, "")
  );
}

// ==================================
// ПРОВЕРКА ДАННЫХ
// ==================================

function detailsPage(o) {
  return {
    text: `📋 ПРОВЕРЬТЕ ДАННЫЕ

📦 ${o.title}
💰 Стоимость: ${money(o.price)}

👤 Получатель: ${o.account}
${o.phone ? `📱 Телефон: ${o.phone}` : ""}

Если всё правильно, продолжите оформление.`,
    keyboard: new InlineKeyboard()
      .text("✅ Продолжить", "payment:choose")
      .row()
      .text("✏️ Изменить данные", "order:edit")
      .row()
      .text("❌ Отменить", "order:cancel")
  };
}

// ==================================
// ВЫБОР СПОСОБА ОПЛАТЫ
// ==================================

function paymentPage(o) {
  return {
    text: `💳 UBER-SHOP | ОПЛАТА

📦 ${o.title}
💰 Сумма: ${money(o.price)}

Выберите удобный способ оплаты:

🏧 Paynet
Оплата через терминал самообслуживания.

💳 Картой онлайн
Перевод на карту через банковское приложение.

📸 В обоих случаях потребуется фотография чека.

⚠️ Поступление денег администратор проверяет самостоятельно.`,
    keyboard: new InlineKeyboard()
      .text("🏧 Через Paynet", "payment:paynet")
      .row()
      .text("💳 Картой онлайн", "payment:card")
      .row()
      .text("⬅️ К данным", "payment:back")
      .row()
      .text("❌ Отмена", "order:cancel")
  };
}

// ==================================
// PAYNET — 4 ФОТОИНСТРУКЦИИ
// ==================================

const paynetTexts = [
  `🏧 PAYNET — ШАГ 1/4

Подойдите к терминалу самообслуживания Paynet.

Откройте главное меню терминала.`,

  `🔎 PAYNET — ШАГ 2/4

Найдите строку поиска.

Введите:

VISA`,

  `💳 PAYNET — ШАГ 3/4

Выберите услугу:

«Пополнение карт VISA (без идентификации)».`,

  `💳 PAYNET — ШАГ 4/4

Введите номер карты:

4916 9903 1516 3920

Затем введите свой номер телефона и нажмите «Далее».

Внесите указанную сумму, проверьте данные и подтвердите операцию.

Обязательно сохраните чек!`
];

function paynetPage(step, price) {
  const kb = new InlineKeyboard();

  if (step > 0) {
    kb.text("⬅️ Назад", `paynet:${step - 1}`);
  } else {
    kb.text("⬅️ Оплата", "payment:choose");
  }

  if (step < 3) {
    kb.text("➡️ Далее", `paynet:${step + 1}`);
  } else {
    kb.text("📸 Прикрепить чек", "receipt:start");
  }

  kb.row().text("❌ Отмена", "order:cancel");

  return {
    photo: paynetPhotos[step],
    text: `${paynetTexts[step]}

💰 Сумма заказа: ${money(price)}`,
    keyboard: kb
  };
}

// ==================================
// ОПЛАТА КАРТОЙ ОНЛАЙН
// ==================================

function onlineCardPage(o) {
  return {
    text: `💳 ОПЛАТА КАРТОЙ ОНЛАЙН

🛍️ UBER-SHOP

📦 ${o.title}

💰 К оплате:
${money(o.price)}

━━━━━━━━━━━━━━

💳 Номер карты VISA:

${CARD_NUMBER}

━━━━━━━━━━━━━━

1. Откройте банковское приложение.
2. Выберите перевод на карту.
3. Введите реквизиты получателя.
4. Укажите точную сумму заказа.
5. Проверьте данные и подтвердите перевод.
6. Сохраните квитанцию.

📸 После оплаты прикрепите скриншот чека.`,
    keyboard: new InlineKeyboard()
      .text("📸 Прикрепить чек", "receipt:start")
      .row()
      .text("⬅️ Способы оплаты", "payment:choose")
      .row()
      .text("❌ Отмена", "order:cancel")
  };
}

// ==================================
// ПОЛУЧЕНИЕ ЧЕКА
// ==================================

function receiptPage(method) {
  return {
    text: `📸 ПРИКРЕПИТЕ ЧЕК

💳 Способ: ${method}

Отправьте фотографию чека или скриншот квитанции одним сообщением.

✅ Фото обязательно для отправки заявки.

⚠️ Чек может быть подделан. Поступление денег проверяет администратор.

Не отправляйте PIN-коды, CVV и другие секретные данные.`,
    keyboard: new InlineKeyboard()
      .text("⬅️ Способы оплаты", "payment:choose")
      .row()
      .text("❌ Отмена", "order:cancel")
  };
}

function confirmPage(o) {
  return {
    text: `✅ ЧЕК ПРИКРЕПЛЁН!

📦 ${o.title}
💰 ${money(o.price)}

💳 Способ оплаты: ${o.paymentMethod}
📸 Фото чека: получено

👤 Получатель: ${o.account}
${o.phone ? `📱 ${o.phone}` : ""}

Проверьте данные и отправьте заявку.

⚠️ Оплата пока не подтверждена администратором.`,
    keyboard: new InlineKeyboard()
      .text("✅ Отправить заявку", "order:submit")
      .row()
      .text("📸 Заменить чек", "receipt:start")
      .row()
      .text("❌ Отмена", "order:cancel")
  };
}

// ==================================
// УСПЕШНАЯ ЗАЯВКА
// ==================================

function successPage(o) {
  return {
    text: `✅ ВАША ЗАЯВКА ОТПРАВЛЕНА!

🛍️ UBER-SHOP

📦 Заказ #${o.id}
🎁 ${o.title}
💰 Сумма: ${money(o.price)}

💳 Способ: ${o.paymentMethod}
📸 Чек прикреплён

📌 Статус: Ожидает проверки

━━━━━━━━━━━━━━

👨‍💼 С вами свяжется наш администратор @${ADMIN_USERNAME}, как только освободится.

⏳ Ожидание может занять до 20 часов в зависимости от времени оформления заказа и загруженности.

💜 Спасибо за выбор UBER-SHOP!`,
    keyboard: new InlineKeyboard()
      .url("💬 Написать администратору", adminUrl)
      .row()
      .text("📦 Мои заказы", "orders")
      .row()
      .text("🏠 Главное меню", "home")
  };
}

function myOrders(userId) {
  const list = db.orders
    .filter(o => o.userId === userId)
    .slice(-10)
    .reverse();

  return {
    text: `📦 МОИ ЗАКАЗЫ

${list.length
  ? list.map(o => `🧾 #${o.id}
📦 ${o.title}
💰 ${money(o.price)}
📌 ${o.status}`).join("\n\n")
  : "Заказов пока нет."}`,
    keyboard: new InlineKeyboard()
      .text("🏠 Главное меню", "home")
  };
}

// ==================================
// АДМИН-ПАНЕЛЬ
// ==================================

function adminText(o) {
  return `🛒 UBER-SHOP | ЗАКАЗ #${o.id}

📦 ${o.title}
💰 ${money(o.price)}

💳 Оплата: ${o.paymentMethod || "Не указана"}

👤 Получатель: ${o.account}
${o.phone ? `📱 Телефон: ${o.phone}` : ""}

👨‍💼 Покупатель: ${
  o.username ? "@" + o.username : "Без username"
}

🆔 Telegram ID: ${o.userId}
📅 ${o.createdAt}

📸 Чек: ${o.receiptFileId ? "Есть" : "Нет"}

📌 Статус: ${o.status}

⚠️ Проверьте поступление средств вручную.`;
}

function adminKeyboard(o) {
  const kb = new InlineKeyboard();

  if (["Новый", "Ожидает проверки"].includes(o.status)) {
    kb.text("📥 Взять в работу", `adm:take:${o.id}`)
      .row();
  }

  if (
    ["Новый", "Ожидает проверки", "В работе"]
      .includes(o.status)
  ) {
    kb.text("✅ Выполнено", `adm:done:${o.id}`)
      .row()
      .text("❌ Отменить", `adm:cancel:${o.id}`)
      .row();
  }

  if (o.receiptFileId) {
    kb.text("📸 Посмотреть чек", `adm:receipt:${o.id}`)
      .row();
  }

  if (o.username) {
    kb.url(
      "💬 Написать покупателю",
      `https://t.me/${o.username}`
    ).row();
  }

  kb.text("👑 Админ-панель", "admin:menu");

  return kb;
}

function adminMenu() {
  return {
    text: `👑 UBER-SHOP ADMIN

Выберите раздел управления магазином.`,
    keyboard: new InlineKeyboard()
      .text("🆕 Новые", "admin:list:new")
      .text("🔄 В работе", "admin:list:work")
      .row()
      .text("✅ Выполненные", "admin:list:done")
      .text("❌ Отменённые", "admin:list:cancel")
      .row()
      .text("📋 Все заказы", "admin:list:all")
      .row()
      .text("📊 Статистика", "admin:stats")
      .row()
      .text("🏠 Магазин", "home")
  };
}

const filters = {
  new: ["Новый", "Ожидает проверки"],
  work: ["В работе"],
  done: ["Выполнен"],
  cancel: ["Отменён"],
  all: null
};

function adminList(filter, page = 0) {
  const list = db.orders
    .filter(o =>
      !filters[filter] ||
      filters[filter].includes(o.status)
    )
    .sort((a, b) => b.id - a.id);

  const max = Math.max(0, Math.ceil(list.length / 5) - 1);
  page = Math.max(0, Math.min(page, max));

  const kb = new InlineKeyboard();

  list.slice(page * 5, page * 5 + 5).forEach(o => {
    kb.text(
      `#${o.id} | ${o.title.slice(0, 25)}`,
      `admin:order:${o.id}`
    ).row();
  });

  if (page > 0) {
    kb.text("⬅️", `admin:list:${filter}:${page - 1}`);
  }

  if (page < max) {
    kb.text("➡️", `admin:list:${filter}:${page + 1}`);
  }

  kb.row().text("👑 Админ-панель", "admin:menu");

  return {
    text: `📋 ЗАКАЗЫ

Всего: ${list.length}
Страница: ${page + 1}/${max + 1}`,
    keyboard: kb
  };
}

function statsPage() {
  const count = status =>
    db.orders.filter(o => o.status === status).length;

  const completed = db.orders.filter(
    o => o.status === "Выполнен"
  );

  const amount = completed.reduce(
    (sum, o) => sum + Number(o.price || 0),
    0
  );

  return {
    text: `📊 СТАТИСТИКА UBER-SHOP

📦 Всего заявок: ${db.orders.length}

🆕 Новые: ${
  count("Новый") + count("Ожидает проверки")
}
🔄 В работе: ${count("В работе")}
✅ Выполнены: ${count("Выполнен")}
❌ Отменены: ${count("Отменён")}

💰 Стоимость выполненных заказов:
${money(amount)}

⚠️ Это не подтверждённая выручка.`,
    keyboard: new InlineKeyboard()
      .text("⬅️ Назад", "admin:menu")
  };
}

// ==================================
// КОМАНДЫ
// ==================================

bot.command("start", async ctx => {
  sessions.delete(ctx.from.id);

  const old = screens.get(ctx.from.id);

  await sendPage(ctx, home(ctx.from.first_name));
  await remove(ctx, old);
});

bot.command("id", async ctx => {
  await ctx.reply(`🆔 Telegram ID: ${ctx.from.id}`);
});

bot.command("admin", async ctx => {
  if (!isAdmin(ctx)) {
    return ctx.reply("⛔ Доступ запрещён.");
  }

  await sendPage(ctx, adminMenu());
});

// ==================================
// НАВИГАЦИЯ
// ==================================

bot.callbackQuery("home", async ctx => {
  sessions.delete(ctx.from.id);
  await navigate(ctx, home(ctx.from.first_name));
});

bot.callbackQuery(
  /^cat:(robux|premium|stars)$/,
  async ctx => {
    sessions.delete(ctx.from.id);
    await navigate(ctx, categoryPage(ctx.match[1]));
  }
);

bot.callbackQuery("cat:steam", async ctx => {
  sessions.delete(ctx.from.id);
  await navigate(ctx, steamPage());
});

bot.callbackQuery(
  /^item:(robux|premium|stars):(\d+)$/,
  async ctx => {
    const page = productPage(
      ctx.match[1],
      Number(ctx.match[2])
    );

    if (!page) {
      return ctx.answerCallbackQuery("Товар не найден.");
    }

    sessions.delete(ctx.from.id);
    await navigate(ctx, page);
  }
);

bot.callbackQuery("orders", async ctx => {
  sessions.delete(ctx.from.id);
  await navigate(ctx, myOrders(ctx.from.id));
});

bot.callbackQuery("support", async ctx => {
  sessions.delete(ctx.from.id);

  await navigate(ctx, {
    text: `👨‍💼 ПОДДЕРЖКА UBER-SHOP

Администратор: @${ADMIN_USERNAME}

С вами свяжется первый освободившийся администратор.

⏳ Ожидание может занять до 20 часов.`,
    keyboard: new InlineKeyboard()
      .url("💬 Написать админу", adminUrl)
      .row()
      .text("🏠 Главное меню", "home")
  });
});

// ==================================
// НАЧАЛО ОФОРМЛЕНИЯ
// ==================================

bot.callbackQuery(
  /^buy:(robux|premium|stars):(\d+)$/,
  async ctx => {
    const type = ctx.match[1];
    const index = Number(ctx.match[2]);
    const item = products[type]?.items[index];

    if (!item) {
      return ctx.answerCallbackQuery("Товар не найден.");
    }

    const s = beginSession({
      type,
      index,
      title: `${products[type].title} — ${item.name}`,
      price: item.price
    }, "account", ctx.from.id);

    await navigate(ctx, fieldPage(s));
  }
);

bot.callbackQuery("steam:start", async ctx => {
  const s = beginSession({
    type: "steam",
    title: "Steam СНГ"
  }, "amount", ctx.from.id);

  await navigate(ctx, fieldPage(s));
});

bot.callbackQuery("order:cancel", async ctx => {
  sessions.delete(ctx.from.id);
  await navigate(ctx, home(ctx.from.first_name));
});

bot.callbackQuery("order:edit", async ctx => {
  const s = sessions.get(ctx.from.id);

  if (!s) {
    return ctx.answerCallbackQuery("Заявка устарела.");
  }

  delete s.order.account;
  delete s.order.phone;
  delete s.order.receiptFileId;
  delete s.order.paymentMethod;

  s.stage = s.order.type === "steam"
    ? "amount"
    : "account";

  await navigate(ctx, fieldPage(s));
});

// ==================================
// ВЫБОР ОПЛАТЫ
// ==================================

bot.callbackQuery("payment:choose", async ctx => {
  const s = sessions.get(ctx.from.id);

  if (!s || !s.order.account) {
    return ctx.answerCallbackQuery("Заполните данные.");
  }

  s.stage = "payment";
  delete s.order.receiptFileId;

  await navigate(ctx, paymentPage(s.order));
});

bot.callbackQuery("payment:back", async ctx => {
  const s = sessions.get(ctx.from.id);

  if (!s) {
    return ctx.answerCallbackQuery("Заявка устарела.");
  }

  s.stage = "details";
  await navigate(ctx, detailsPage(s.order));
});

// Оплата через Paynet
bot.callbackQuery("payment:paynet", async ctx => {
  const s = sessions.get(ctx.from.id);

  if (!s || s.stage !== "payment") {
    return ctx.answerCallbackQuery("Сначала выберите оплату.");
  }

  s.order.paymentMethod = "Paynet";
  s.stage = "paynet";

  await navigate(ctx, paynetPage(0, s.order.price));
});

// Оплата картой онлайн
bot.callbackQuery("payment:card", async ctx => {
  const s = sessions.get(ctx.from.id);

  if (!s || s.stage !== "payment") {
    return ctx.answerCallbackQuery("Сначала выберите оплату.");
  }

  s.order.paymentMethod = "Картой онлайн";
  s.stage = "card";

  await navigate(ctx, onlineCardPage(s.order));
});

// Четыре шага Paynet
bot.callbackQuery(/^paynet:([0-3])$/, async ctx => {
  const s = sessions.get(ctx.from.id);

  if (!s || s.stage !== "paynet") {
    return ctx.answerCallbackQuery("Выберите Paynet.");
  }

  await navigate(
    ctx,
    paynetPage(Number(ctx.match[1]), s.order.price)
  );
});

// ==================================
// ОБЯЗАТЕЛЬНЫЙ ЧЕК
// ==================================

bot.callbackQuery("receipt:start", async ctx => {
  const s = sessions.get(ctx.from.id);

  if (
    !s ||
    !["paynet", "card", "ready", "receipt"]
      .includes(s.stage)
  ) {
    return ctx.answerCallbackQuery("Сначала выберите оплату.");
  }

  if (!s.order.paymentMethod) {
    return ctx.answerCallbackQuery("Способ оплаты не выбран.");
  }

  s.stage = "receipt";
  delete s.order.receiptFileId;

  await navigate(
    ctx,
    receiptPage(s.order.paymentMethod)
  );
});

// ==================================
// ВВОД ДАННЫХ
// ==================================

bot.on("message:text", async ctx => {
  const s = sessions.get(ctx.from.id);

  if (!s || ctx.message.text.startsWith("/")) return;

  const value = ctx.message.text.trim();

  // Сумма Steam
  if (s.stage === "amount") {
    const amount = Number(value.replace(/\s/g, ""));
    const total = Math.round(amount * 1.17 / 1000) * 1000;

    if (
      !Number.isSafeInteger(amount) ||
      amount < 12000 ||
      total > 470000
    ) {
      await afterInput(ctx, {
        text: `❌ Неверная сумма!

Введите сумму от 12 000 сум.
Итог с комиссией не должен превышать 470 000 сум.`,
        keyboard: cancelKeyboard()
      });
      return;
    }

    s.order.amount = amount;
    s.order.price = total;
    s.order.title = `Steam СНГ — ${money(amount)}`;
    s.stage = "account";

    await afterInput(ctx, fieldPage(s));
    return;
  }

  // Username или логин Steam
  if (s.stage === "account") {
    if (!validAccount(value, s.order.type)) {
      await afterInput(ctx, {
        text: `❌ Некорректный username или логин.

Попробуйте ещё раз.

🔐 Не отправляйте пароли.`,
        keyboard: cancelKeyboard()
      });
      return;
    }

    s.order.account = value;

    if (["premium", "stars"].includes(s.order.type)) {
      s.stage = "phone";
      await afterInput(ctx, fieldPage(s));
    } else {
      s.stage = "details";
      await afterInput(ctx, detailsPage(s.order));
    }

    return;
  }

  // Телефон для Telegram
  if (s.stage === "phone") {
    if (!validPhone(value)) {
      await afterInput(ctx, {
        text: `❌ Неверный номер телефона.

Пример: +998901234567

Введите ещё раз.`,
        keyboard: cancelKeyboard()
      });
      return;
    }

    s.order.phone = value.replace(/[\s()-]/g, "");
    s.stage = "details";

    await afterInput(ctx, detailsPage(s.order));
    return;
  }

  // Ожидаем фотографию, не текст
  if (s.stage === "receipt") {
    await afterInput(
      ctx,
      receiptPage(s.order.paymentMethod)
    );
  }
});

// ==================================
// ПРИЁМ ФОТО ЧЕКА
// ==================================

bot.on("message:photo", async ctx => {
  const s = sessions.get(ctx.from.id);

  if (!s || s.stage !== "receipt") return;

  const photo = ctx.message.photo.at(-1);

  s.order.receiptFileId = photo.file_id;
  s.stage = "ready";

  await afterInput(ctx, confirmPage(s.order));
});

// ==================================
// СОЗДАНИЕ ЗАКАЗА
// ==================================

bot.callbackQuery("order:submit", async ctx => {
  const s = sessions.get(ctx.from.id);

  if (
    !s ||
    s.stage !== "ready" ||
    !s.order.receiptFileId ||
    !s.order.paymentMethod
  ) {
    return ctx.answerCallbackQuery({
      text: "Сначала прикрепите чек.",
      show_alert: true
    });
  }

  if (!Number.isSafeInteger(ADMIN_ID) || ADMIN_ID <= 0) {
    return ctx.answerCallbackQuery({
      text: "Администратор не настроен.",
      show_alert: true
    });
  }

  s.stage = "submitting";

  const order = {
    id: db.nextId,
    userId: ctx.from.id,
    username: ctx.from.username || null,

    title: s.order.title,
    type: s.order.type,
    price: s.order.price,
    account: s.order.account,
    phone: s.order.phone || null,

    paymentMethod: s.order.paymentMethod,
    receiptFileId: s.order.receiptFileId,

    status: "Ожидает проверки",
    createdAt: new Date().toLocaleString("ru-RU", {
      timeZone: "Asia/Tashkent"
    })
  };

  db.nextId++;
  db.orders.push(order);

  try {
    saveDB();
  } catch (error) {
    db.nextId--;
    db.orders.pop();
    s.stage = "ready";
    throw error;
  }

  sessions.delete(ctx.from.id);

  await navigate(ctx, successPage(order));

  try {
    await ctx.api.sendMessage(
      ADMIN_ID,
      adminText(order),
      { reply_markup: adminKeyboard(order) }
    );

    await ctx.api.sendPhoto(
      ADMIN_ID,
      order.receiptFileId,
      {
        caption: `📸 Чек заказа #${order.id}

💳 Способ: ${order.paymentMethod}
💰 Сумма: ${money(order.price)}

⚠️ Проверьте поступление средств.`
      }
    );
  } catch (error) {
    console.error(
      "Ошибка уведомления администратора:",
      error.message
    );
  }
});

// ==================================
// АДМИН-ПАНЕЛЬ
// ==================================

bot.callbackQuery("admin:menu", async ctx => {
  if (!isAdmin(ctx)) {
    return ctx.answerCallbackQuery("Нет доступа.");
  }

  await navigate(ctx, adminMenu());
});

bot.callbackQuery("admin:stats", async ctx => {
  if (!isAdmin(ctx)) {
    return ctx.answerCallbackQuery("Нет доступа.");
  }

  await navigate(ctx, statsPage());
});

bot.callbackQuery(
  /^admin:list:(new|work|done|cancel|all)(?::(\d+))?$/,
  async ctx => {
    if (!isAdmin(ctx)) {
      return ctx.answerCallbackQuery("Нет доступа.");
    }

    await navigate(
      ctx,
      adminList(
        ctx.match[1],
        Number(ctx.match[2] || 0)
      )
    );
  }
);

bot.callbackQuery(/^admin:order:(\d+)$/, async ctx => {
  if (!isAdmin(ctx)) {
    return ctx.answerCallbackQuery("Нет доступа.");
  }

  const order = db.orders.find(
    o => o.id === Number(ctx.match[1])
  );

  if (!order) {
    return ctx.answerCallbackQuery("Заказ не найден.");
  }

  await navigate(ctx, {
    text: adminText(order),
    keyboard: adminKeyboard(order)
  });
});

// Посмотреть чек
bot.callbackQuery(/^adm:receipt:(\d+)$/, async ctx => {
  if (!isAdmin(ctx)) {
    return ctx.answerCallbackQuery("Нет доступа.");
  }

  const order = db.orders.find(
    o => o.id === Number(ctx.match[1])
  );

  if (!order?.receiptFileId) {
    return ctx.answerCallbackQuery("Чек не найден.");
  }

  await ctx.answerCallbackQuery();

  await ctx.replyWithPhoto(order.receiptFileId, {
    caption: `📸 Чек заказа #${order.id}

💳 ${order.paymentMethod}
💰 ${money(order.price)}

Проверьте поступление денег.`
  });
});

// Изменение статуса
bot.callbackQuery(
  /^adm:(take|done|cancel):(\d+)$/,
  async ctx => {
    if (!isAdmin(ctx)) {
      return ctx.answerCallbackQuery("Нет доступа.");
    }

    const action = ctx.match[1];
    const order = db.orders.find(
      o => o.id === Number(ctx.match[2])
    );

    if (!order) {
      return ctx.answerCallbackQuery("Заказ не найден.");
    }

    if (
      ["Выполнен", "Отменён"].includes(order.status) ||
      (action === "take" && order.status === "В работе")
    ) {
      return ctx.answerCallbackQuery({
        text: "Статус уже изменён.",
        show_alert: true
      });
    }

    const oldStatus = order.status;

    order.status = {
      take: "В работе",
      done: "Выполнен",
      cancel: "Отменён"
    }[action];

    try {
      saveDB();
    } catch (error) {
      order.status = oldStatus;
      throw error;
    }

    await navigate(ctx, {
      text: adminText(order),
      keyboard: adminKeyboard(order)
    });

    try {
      await ctx.api.sendMessage(
        order.userId,
        `📦 UBER-SHOP | Заказ #${order.id}

📌 Новый статус: ${order.status}

👨‍💼 Администратор: @${ADMIN_USERNAME}`
      );
    } catch (error) {
      console.error(
        "Ошибка уведомления покупателю:",
        error.message
      );
    }
  }
);

// ==================================
// ОШИБКИ И ЗАПУСК
// ==================================

bot.catch(error => {
  console.error(
    "❌ Ошибка UBER-SHOP:",
    error.error?.message || error.message
  );
});

console.log("🚀 UBER-SHOP 3.3 запущен!");
bot.start();
