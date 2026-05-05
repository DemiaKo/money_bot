const { Telegraf, session, Markup } = require('telegraf');
const db = require('./db');

// ─── REPLY KEYBOARDS (під рядком вводу) ──────────────────────────────────────

const mainKeyboard = Markup.keyboard([
  ['➕ Витрата', '💸 Надходження'],
  ['💳 Баланси', '📋 Історія'],
  ['🗂 Карти',   '🏷 Категорії'],
]).resize();

const cancelKeyboard = Markup.keyboard([['❌ Скасувати']]).resize();

const skipCancelKeyboard = Markup.keyboard([
  ['⏭ Пропустити'],
  ['❌ Скасувати'],
]).resize();

// Динамічна клавіатура зі списком рядків
function listKeyboard(items, extraRows = []) {
  const rows = items.map(item => [item]);
  extraRows.forEach(r => rows.push(r));
  rows.push(['❌ Скасувати']);
  return Markup.keyboard(rows).resize();
}

// ─── СТАНИ FLOW ──────────────────────────────────────────────────────────────

const FLOWS = {
  ADD_EXPENSE:  'add_expense',
  ADD_INCOME:   'add_income',
  ADD_CARD:     'add_card',
  ADD_CATEGORY: 'add_category',
};

// Стани всередині flow
const STEPS = {
  // expense / income
  SELECT_CARD:     'select_card',
  SELECT_CATEGORY: 'select_category',
  ENTER_AMOUNT:    'enter_amount',
  SELECT_CURRENCY: 'select_currency',
  ENTER_NOTE:      'enter_note',

  // add_card
  ENTER_CARD_NAME:  'enter_card_name',
  SELECT_CARD_ICON: 'select_card_icon',
  SELECT_CARD_CUR:  'select_card_cur',

  // add_category
  ENTER_CAT_NAME:  'enter_cat_name',
  SELECT_CAT_EMOJI:'select_cat_emoji',
};

const CURRENCIES = ['🇺🇦 UAH', '🇺🇸 USD', '🇪🇺 EUR'];
const CARD_ICONS  = ['💳 Картка', '🏦 Банк', '💵 Готівка', '🟡 Монобанк', '🟢 Приват', '🔵 Ощад'];
const EMOJIS      = ['🍔','🚗','🏠','💊','🎮','👕','📦','💰','💻','🎁','📥','✈️','🎓','⚽','🛒'];

function parseCurrency(label) { return label.split(' ')[1]; }
function parseIcon(label)     { return label.split(' ')[0]; }

// ─── ДОПОМІЖНІ ───────────────────────────────────────────────────────────────

function resetSession(ctx) {
  ctx.session.flow = null;
  ctx.session.step = null;
  ctx.session.data = {};
}

async function cancel(ctx, msg = '❌ Скасовано.') {
  resetSession(ctx);
  await ctx.reply(msg, mainKeyboard);
}

// ─── ГОЛОВНА ФУНКЦІЯ ─────────────────────────────────────────────────────────

function createBot() {
  const bot = new Telegraf(process.env.BOT_TOKEN);

  bot.use(session());

  // Ініціалізація session
  bot.use((ctx, next) => {
    if (!ctx.session.data) ctx.session.data = {};
    return next();
  });

  // Реєстрація юзера
  bot.use(async (ctx, next) => {
    if (ctx.from) await db.ensureUser(ctx.from);
    return next();
  });

  // ─── /start ────────────────────────────────────────────────────────────────
  bot.start(async (ctx) => {
    resetSession(ctx);
    await ctx.reply(
      `👋 Привіт, *${ctx.from.first_name}*! Я твій фінансовий помічник 💰`,
      { parse_mode: 'Markdown', ...mainKeyboard }
    );
  });

  // ─── ГОЛОВНИЙ ОБРОБНИК ТЕКСТУ ──────────────────────────────────────────────
  bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();

    // Скасування з будь-якого місця
    if (text === '❌ Скасувати') {
      return cancel(ctx);
    }

    // Якщо є активний flow — продовжуємо його
    if (ctx.session.flow) {
      return handleFlowText(ctx, text);
    }

    // Головне меню
    switch (text) {
      case '➕ Витрата':     return startExpenseFlow(ctx);
      case '💸 Надходження': return startIncomeFlow(ctx);
      case '💳 Баланси':     return showBalances(ctx);
      case '📋 Історія':     return showHistory(ctx);
      case '🗂 Карти':       return showCards(ctx);
      case '🏷 Категорії':   return showCategories(ctx);
      default:
        await ctx.reply('Оберіть дію з меню 👇', mainKeyboard);
    }
  });

  return bot;
}

// ─── FLOW: ВИТРАТА ────────────────────────────────────────────────────────────

async function startExpenseFlow(ctx) {
  const cards = await db.getCards(ctx.from.id);
  if (!cards.length) {
    return ctx.reply('❗ Спочатку додайте карту через "🗂 Карти"', mainKeyboard);
  }
  ctx.session.flow = FLOWS.ADD_EXPENSE;
  ctx.session.step = STEPS.SELECT_CARD;
  ctx.session.data = { cards };

  const labels = cards.map(c => `${c.color} ${c.name} (${c.currency})`);
  await ctx.reply('💳 Виберіть карту для списання:', listKeyboard(labels));
}

async function startIncomeFlow(ctx) {
  const cards = await db.getCards(ctx.from.id);
  if (!cards.length) {
    return ctx.reply('❗ Спочатку додайте карту через "🗂 Карти"', mainKeyboard);
  }
  ctx.session.flow = FLOWS.ADD_INCOME;
  ctx.session.step = STEPS.SELECT_CARD;
  ctx.session.data = { cards };

  const labels = cards.map(c => `${c.color} ${c.name} (${c.currency})`);
  await ctx.reply('💳 Виберіть карту для зарахування:', listKeyboard(labels));
}

// ─── FLOW: КАРТА ──────────────────────────────────────────────────────────────

async function startAddCardFlow(ctx) {
  ctx.session.flow = FLOWS.ADD_CARD;
  ctx.session.step = STEPS.ENTER_CARD_NAME;
  ctx.session.data = {};
  await ctx.reply(
    '🏦 Введіть назву карти/рахунку:\n_(наприклад: Monobank, Готівка)_',
    { parse_mode: 'Markdown', ...cancelKeyboard }
  );
}

// ─── FLOW: КАТЕГОРІЯ ──────────────────────────────────────────────────────────

async function startAddCategoryFlow(ctx, type) {
  ctx.session.flow = FLOWS.ADD_CATEGORY;
  ctx.session.step = STEPS.ENTER_CAT_NAME;
  ctx.session.data = { type };
  const label = type === 'expense' ? 'витрат' : 'надходжень';
  await ctx.reply(`🏷 Введіть назву нової категорії ${label}:`, cancelKeyboard);
}

// ─── ОБРОБНИК ТЕКСТУ В FLOW ───────────────────────────────────────────────────

async function handleFlowText(ctx, text) {
  const { flow, step, data } = ctx.session;

  // ── ADD EXPENSE / INCOME ──────────────────────────────────────────────────
  if (flow === FLOWS.ADD_EXPENSE || flow === FLOWS.ADD_INCOME) {
    const type = flow === FLOWS.ADD_EXPENSE ? 'expense' : 'income';

    if (step === STEPS.SELECT_CARD) {
      const card = data.cards.find(c => text.startsWith(`${c.color} ${c.name}`));
      if (!card) return ctx.reply('❗ Виберіть карту зі списку 👇');
      ctx.session.data.cardId = card.id;

      const categories = await db.getCategories(ctx.from.id, type);
      ctx.session.data.categories = categories;
      ctx.session.step = STEPS.SELECT_CATEGORY;

      const labels = categories.map(c => `${c.emoji} ${c.name}`);
      return ctx.reply('🏷 Виберіть категорію:', listKeyboard(labels));
    }

    if (step === STEPS.SELECT_CATEGORY) {
      const cat = data.categories.find(c => text === `${c.emoji} ${c.name}`);
      if (!cat) return ctx.reply('❗ Виберіть категорію зі списку 👇');
      ctx.session.data.categoryId = cat.id;
      ctx.session.step = STEPS.ENTER_AMOUNT;

      const action = type === 'expense' ? 'витрати' : 'надходження';
      return ctx.reply(
        `💰 Введіть суму ${action}:\n_(наприклад: 150 або 1500.50)_`,
        { parse_mode: 'Markdown', ...cancelKeyboard }
      );
    }

    if (step === STEPS.ENTER_AMOUNT) {
      const amount = parseFloat(text.replace(',', '.'));
      if (isNaN(amount) || amount <= 0) {
        return ctx.reply('❗ Введіть коректну суму (число більше 0):');
      }
      ctx.session.data.amount = amount;
      ctx.session.step = STEPS.SELECT_CURRENCY;

      return ctx.reply(
        '💱 Виберіть валюту:',
        listKeyboard(CURRENCIES)
      );
    }

    if (step === STEPS.SELECT_CURRENCY) {
      if (!CURRENCIES.includes(text)) return ctx.reply('❗ Виберіть валюту зі списку 👇');
      ctx.session.data.currency = parseCurrency(text);
      ctx.session.step = STEPS.ENTER_NOTE;

      return ctx.reply('📝 Додайте коментар або пропустіть:', skipCancelKeyboard);
    }

    if (step === STEPS.ENTER_NOTE) {
      const note = text === '⏭ Пропустити' ? null : text;
      const { cardId, categoryId, amount, currency } = data;

      const { error } = await db.addTransaction(
        ctx.from.id, cardId, categoryId, type, amount, currency, note
      );

      resetSession(ctx);
      if (error) {
        console.error('addTransaction error:', error);
        return ctx.reply('❌ Помилка збереження. Спробуйте ще раз.', mainKeyboard);
      }

      const icon   = type === 'expense' ? '💸' : '💰';
      const action = type === 'expense' ? 'Витрату' : 'Надходження';
      return ctx.reply(
        `✅ *${action} збережено!*\n${icon} ${amount} ${currency}${note ? `\n📝 ${note}` : ''}`,
        { parse_mode: 'Markdown', ...mainKeyboard }
      );
    }
  }

  // ── ADD CARD ──────────────────────────────────────────────────────────────
  if (flow === FLOWS.ADD_CARD) {
    if (step === STEPS.ENTER_CARD_NAME) {
      if (text.length < 1 || text.length > 30) {
        return ctx.reply('❗ Назва має бути від 1 до 30 символів:');
      }
      ctx.session.data.name = text;
      ctx.session.step = STEPS.SELECT_CARD_ICON;

      return ctx.reply('🎨 Виберіть іконку для карти:', listKeyboard(CARD_ICONS));
    }

    if (step === STEPS.SELECT_CARD_ICON) {
      if (!CARD_ICONS.includes(text)) return ctx.reply('❗ Виберіть іконку зі списку 👇');
      ctx.session.data.color = parseIcon(text);
      ctx.session.step = STEPS.SELECT_CARD_CUR;

      return ctx.reply('💱 Виберіть валюту карти:', listKeyboard(CURRENCIES));
    }

    if (step === STEPS.SELECT_CARD_CUR) {
      if (!CURRENCIES.includes(text)) return ctx.reply('❗ Виберіть валюту зі списку 👇');
      const { name, color } = data;
      const currency = parseCurrency(text);

      const { error } = await db.addCard(ctx.from.id, name, currency, color);
      resetSession(ctx);

      if (error) {
        console.error('addCard error:', error);
        return ctx.reply('❌ Помилка створення карти.', mainKeyboard);
      }
      return ctx.reply(
        `✅ Карту *${color} ${name}* (${currency}) створено!`,
        { parse_mode: 'Markdown', ...mainKeyboard }
      );
    }
  }

  // ── ADD CATEGORY ──────────────────────────────────────────────────────────
  if (flow === FLOWS.ADD_CATEGORY) {
    if (step === STEPS.ENTER_CAT_NAME) {
      if (text.length < 1 || text.length > 25) {
        return ctx.reply('❗ Назва має бути від 1 до 25 символів:');
      }
      ctx.session.data.name = text;
      ctx.session.step = STEPS.SELECT_CAT_EMOJI;

      return ctx.reply('🎨 Виберіть emoji для категорії:', listKeyboard(EMOJIS));
    }

    if (step === STEPS.SELECT_CAT_EMOJI) {
      if (!EMOJIS.includes(text)) return ctx.reply('❗ Виберіть emoji зі списку 👇');
      const { name, type } = data;

      const { error } = await db.addCategory(ctx.from.id, name, type, text);
      resetSession(ctx);

      if (error) {
        console.error('addCategory error:', error);
        return ctx.reply('❌ Помилка створення категорії.', mainKeyboard);
      }
      return ctx.reply(
        `✅ Категорію *${text} ${name}* додано!`,
        { parse_mode: 'Markdown', ...mainKeyboard }
      );
    }
  }
}

// ─── БАЛАНСИ ─────────────────────────────────────────────────────────────────

async function showBalances(ctx) {
  const balances = await db.getAllBalances(ctx.from.id);

  if (!balances.length) {
    return ctx.reply('❗ У вас немає карт.\nДодайте карту через "🗂 Карти".', mainKeyboard);
  }

  let text = '💼 *Ваші баланси:*\n\n';
  for (const card of balances) {
    const sign = card.balance >= 0 ? '✅' : '🔴';
    text += `${sign} ${card.color} *${card.name}*\n`;
    text += `   ${card.balance.toFixed(2)} ${card.currency}\n\n`;
  }

  await ctx.reply(text, { parse_mode: 'Markdown', ...mainKeyboard });
}

// ─── ІСТОРІЯ ─────────────────────────────────────────────────────────────────

async function showHistory(ctx, cardId = null) {
  const transactions = await db.getTransactions(ctx.from.id, 15, cardId);

  if (!transactions.length) {
    return ctx.reply('📋 Транзакцій ще немає.', mainKeyboard);
  }

  let text = '📋 *Остання активність:*\n\n';
  for (const tx of transactions) {
    const date = new Date(tx.created_at).toLocaleDateString('uk-UA');
    const icon = tx.type === 'expense' ? '🔴' : '🟢';
    const cat  = tx.categories ? `${tx.categories.emoji} ${tx.categories.name}` : 'Без категорії';
    const card = tx.cards ? `${tx.cards.color} ${tx.cards.name}` : '';
    text += `${icon} *${tx.amount} ${tx.currency}* — ${cat}\n`;
    if (!cardId && card) text += `   ${card}\n`;
    if (tx.note) text += `   📝 ${tx.note}\n`;
    text += `   📅 ${date}\n\n`;
  }

  await ctx.reply(text, { parse_mode: 'Markdown', ...mainKeyboard });
}

// ─── КАРТИ ───────────────────────────────────────────────────────────────────

async function showCards(ctx) {
  const cards = await db.getCards(ctx.from.id);

  if (!cards.length) {
    await ctx.reply(
      '🗂 Карт немає. Додайте першу!',
      Markup.keyboard([['➕ Додати карту'], ['🏠 Головне меню']]).resize()
    );
  } else {
    let text = '🗂 *Ваші карти:*\n\n';
    cards.forEach((c, i) => {
      text += `${i + 1}. ${c.color} *${c.name}* — ${c.currency}\n`;
    });

    // Кнопки видалення + додати
    const rows = cards.map(c => [`🗑 Видалити: ${c.color} ${c.name}`]);
    rows.push(['➕ Додати карту']);
    rows.push(['🏠 Головне меню']);

    ctx.session.data.cards = cards; // зберігаємо для видалення
    await ctx.reply(text, { parse_mode: 'Markdown', ...Markup.keyboard(rows).resize() });
  }

  // Підвішуємо flow для обробки наступного натискання
  ctx.session.flow = 'manage_cards';
  ctx.session.step = 'menu';
}

// ─── КАТЕГОРІЇ ───────────────────────────────────────────────────────────────

async function showCategories(ctx) {
  ctx.session.flow = 'manage_categories';
  ctx.session.step = 'menu';

  await ctx.reply(
    '🏷 *Управління категоріями:*',
    {
      parse_mode: 'Markdown',
      ...Markup.keyboard([
        ['➕ Категорія витрат', '➕ Категорія надходжень'],
        ['🏠 Головне меню'],
      ]).resize(),
    }
  );
}

// ─── РОЗШИРЕНИЙ ОБРОБНИК ТЕКСТУ — підключаємо manage flows ───────────────────
// (Інжектуємо в handleFlowText через патч нижче)

const _origHandleFlowText = handleFlowText;

// Перевизначаємо через модуль — оскільки JS hoisting не діє на async functions
// у цьому файлі, викликаємо через bot.on яке вже посилається на handleFlowText.
// Додаємо manage_cards / manage_categories безпосередньо тут:

async function handleFlowTextFull(ctx, text) {
  const { flow } = ctx.session;

  if (flow === 'manage_cards') {
    if (text === '➕ Додати карту') {
      return startAddCardFlow(ctx);
    }
    if (text === '🏠 Головне меню') {
      resetSession(ctx);
      return ctx.reply('📱 Головне меню:', mainKeyboard);
    }
    // Видалення карти
    if (text.startsWith('🗑 Видалити: ')) {
      const label = text.replace('🗑 Видалити: ', '');
      const cards = ctx.session.data.cards || await db.getCards(ctx.from.id);
      const card  = cards.find(c => `${c.color} ${c.name}` === label);
      if (card) {
        await db.deleteCard(card.id);
        await ctx.reply(`✅ Карту *${label}* видалено.`, { parse_mode: 'Markdown' });
      }
      resetSession(ctx);
      return showCards(ctx);
    }
    return ctx.reply('❗ Виберіть дію зі списку 👇');
  }

  if (flow === 'manage_categories') {
    if (text === '➕ Категорія витрат') {
      return startAddCategoryFlow(ctx, 'expense');
    }
    if (text === '➕ Категорія надходжень') {
      return startAddCategoryFlow(ctx, 'income');
    }
    if (text === '🏠 Головне меню') {
      resetSession(ctx);
      return ctx.reply('📱 Головне меню:', mainKeyboard);
    }
    return ctx.reply('❗ Виберіть дію зі списку 👇');
  }

  return _origHandleFlowText(ctx, text);
}

// Патчимо createBot щоб використовував handleFlowTextFull
function createBot() {
  const bot = new Telegraf(process.env.BOT_TOKEN);

  bot.use(session());

  bot.use((ctx, next) => {
    if (!ctx.session.data) ctx.session.data = {};
    return next();
  });

  bot.use(async (ctx, next) => {
    if (ctx.from) await db.ensureUser(ctx.from);
    return next();
  });

  bot.start(async (ctx) => {
    resetSession(ctx);
    await ctx.reply(
      `👋 Привіт, *${ctx.from.first_name}*! Я твій фінансовий помічник 💰\n\nОберіть дію:`,
      { parse_mode: 'Markdown', ...mainKeyboard }
    );
  });

  bot.command('menu', async (ctx) => {
    resetSession(ctx);
    await ctx.reply('📱 Головне меню:', mainKeyboard);
  });

  bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();

    if (text === '❌ Скасувати') {
      return cancel(ctx);
    }

    if (ctx.session.flow) {
      return handleFlowTextFull(ctx, text);
    }

    switch (text) {
      case '➕ Витрата':      return startExpenseFlow(ctx);
      case '💸 Надходження':  return startIncomeFlow(ctx);
      case '💳 Баланси':      return showBalances(ctx);
      case '📋 Історія':      return showHistory(ctx);
      case '🗂 Карти':        return showCards(ctx);
      case '🏷 Категорії':    return showCategories(ctx);
      default:
        await ctx.reply('Оберіть дію з меню 👇', mainKeyboard);
    }
  });

  return bot;
}

module.exports = { createBot };