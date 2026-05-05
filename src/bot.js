const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const db = require('./db');

// ─── SUPABASE SESSION STORE ───────────────────────────────────────────────────
// Vercel serverless не зберігає пам'ять між запитами,
// тому session зберігаємо в Supabase таблиці bot_sessions

function supabaseSession() {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
  );

  return async (ctx, next) => {
    const key = String(ctx.from?.id || ctx.chat?.id || 'unknown');

    let sessionData = { flow: null, step: null, data: {} };
    try {
      const { data } = await supabase
        .from('bot_sessions')
        .select('session')
        .eq('key', key)
        .single();
      if (data?.session) sessionData = data.session;
    } catch (_) {}

    if (!sessionData.data) sessionData.data = {};
    ctx.session = sessionData;

    await next();

    try {
      await supabase
        .from('bot_sessions')
        .upsert({ key, session: ctx.session }, { onConflict: 'key' });
    } catch (e) {
      console.error('Session save error:', e);
    }
  };
}

// ─── КЛАВІАТУРИ ──────────────────────────────────────────────────────────────

const mainKeyboard = Markup.keyboard([
  ['➕ Витрата',  '💸 Надходження'],
  ['💳 Баланси',  '📋 Історія'],
  ['🗂 Карти',    '🏷 Категорії'],
]).resize();

const cancelKeyboard = Markup.keyboard([
  ['❌ Скасувати'],
]).resize();

const skipCancelKeyboard = Markup.keyboard([
  ['⏭ Пропустити'],
  ['❌ Скасувати'],
]).resize();

function listKeyboard(items) {
  const rows = items.map(item => [item]);
  rows.push(['❌ Скасувати']);
  return Markup.keyboard(rows).resize();
}

// ─── КОНСТАНТИ ───────────────────────────────────────────────────────────────

const CURRENCIES = ['🇺🇦 UAH', '🇺🇸 USD', '🇪🇺 EUR'];
const CARD_ICONS  = ['💳 Картка', '🏦 Банк', '💵 Готівка', '🟡 Монобанк', '🟢 Приват', '🔵 Ощад'];
const EMOJIS      = ['🍔','🚗','🏠','💊','🎮','👕','📦','💰','💻','🎁','📥','✈️','🎓','⚽','🛒'];

function parseCurrency(label) { return label.split(' ')[1]; }
function parseIcon(label)     { return label.split(' ')[0]; }

// ─── SESSION HELPERS ──────────────────────────────────────────────────────────

function resetSession(ctx) {
  ctx.session.flow = null;
  ctx.session.step = null;
  ctx.session.data = {};
}

async function cancel(ctx) {
  resetSession(ctx);
  await ctx.reply('❌ Скасовано.', mainKeyboard);
}

// ─── БОТ ─────────────────────────────────────────────────────────────────────

function createBot() {
  const bot = new Telegraf(process.env.BOT_TOKEN);

  bot.use(supabaseSession());

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
    if (text === '❌ Скасувати') return cancel(ctx);
    if (ctx.session.flow) return handleFlow(ctx, text);

    switch (text) {
      case '➕ Витрата':      return startFlow(ctx, 'expense');
      case '💸 Надходження':  return startFlow(ctx, 'income');
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

// ─── FLOW ROUTER ─────────────────────────────────────────────────────────────

async function handleFlow(ctx, text) {
  switch (ctx.session.flow) {
    case 'expense':
    case 'income':       return handleTransactionFlow(ctx, text);
    case 'add_card':     return handleAddCardFlow(ctx, text);
    case 'add_category': return handleAddCategoryFlow(ctx, text);
    case 'manage_cards': return handleManageCards(ctx, text);
    case 'manage_cats':  return handleManageCats(ctx, text);
    default:
      resetSession(ctx);
      await ctx.reply('Оберіть дію з меню 👇', mainKeyboard);
  }
}

// ─── FLOW: ВИТРАТА / НАДХОДЖЕННЯ ─────────────────────────────────────────────

async function startFlow(ctx, type) {
  const cards = await db.getCards(ctx.from.id);
  if (!cards.length) {
    return ctx.reply('❗ Спочатку додайте карту через "🗂 Карти"', mainKeyboard);
  }
  ctx.session.flow = type;
  ctx.session.step = 'select_card';
  ctx.session.data = { cards };

  const labels = cards.map(c => `${c.color} ${c.name} (${c.currency})`);
  const prompt = type === 'expense' ? '💳 Виберіть карту для списання:' : '💳 Виберіть карту для зарахування:';
  await ctx.reply(prompt, listKeyboard(labels));
}

async function handleTransactionFlow(ctx, text) {
  const { flow, step, data } = ctx.session;
  const type = flow;

  if (step === 'select_card') {
    const card = data.cards.find(c => text.startsWith(`${c.color} ${c.name}`));
    if (!card) return ctx.reply('❗ Виберіть карту зі списку 👇');

    const categories = await db.getCategories(ctx.from.id, type);
    ctx.session.data = { ...data, cardId: card.id, categories };
    ctx.session.step = 'select_category';

    return ctx.reply('🏷 Виберіть категорію:', listKeyboard(categories.map(c => `${c.emoji} ${c.name}`)));
  }

  if (step === 'select_category') {
    const cat = data.categories.find(c => text === `${c.emoji} ${c.name}`);
    if (!cat) return ctx.reply('❗ Виберіть категорію зі списку 👇');

    ctx.session.data = { ...data, categoryId: cat.id };
    ctx.session.step = 'enter_amount';

    const label = type === 'expense' ? 'витрати' : 'надходження';
    return ctx.reply(
      `💰 Введіть суму ${label}:\n_(наприклад: 150 або 1500.50)_`,
      { parse_mode: 'Markdown', ...cancelKeyboard }
    );
  }

  if (step === 'enter_amount') {
    const amount = parseFloat(text.replace(',', '.'));
    if (isNaN(amount) || amount <= 0) return ctx.reply('❗ Введіть коректну суму (число більше 0):');
    ctx.session.data = { ...data, amount };
    ctx.session.step = 'select_currency';
    return ctx.reply('💱 Виберіть валюту:', listKeyboard(CURRENCIES));
  }

  if (step === 'select_currency') {
    if (!CURRENCIES.includes(text)) return ctx.reply('❗ Виберіть валюту зі списку 👇');
    ctx.session.data = { ...data, currency: parseCurrency(text) };
    ctx.session.step = 'enter_note';
    return ctx.reply('📝 Додайте коментар або пропустіть:', skipCancelKeyboard);
  }

  if (step === 'enter_note') {
    const note = text === '⏭ Пропустити' ? null : text;
    const { cardId, categoryId, amount, currency } = ctx.session.data;

    const { error } = await db.addTransaction(ctx.from.id, cardId, categoryId, type, amount, currency, note);
    resetSession(ctx);

    if (error) {
      console.error('addTransaction error:', error);
      return ctx.reply('❌ Помилка збереження. Спробуйте ще раз.', mainKeyboard);
    }

    const icon  = type === 'expense' ? '💸' : '💰';
    const label = type === 'expense' ? 'Витрату' : 'Надходження';
    return ctx.reply(
      `✅ *${label} збережено!*\n${icon} ${amount} ${currency}${note ? `\n📝 ${note}` : ''}`,
      { parse_mode: 'Markdown', ...mainKeyboard }
    );
  }
}

// ─── FLOW: КАРТИ ─────────────────────────────────────────────────────────────

async function showCards(ctx) {
  const cards = await db.getCards(ctx.from.id);
  ctx.session.flow = 'manage_cards';
  ctx.session.step = 'menu';
  ctx.session.data = { cards };

  if (!cards.length) {
    return ctx.reply(
      '🗂 Карт немає. Додайте першу!',
      Markup.keyboard([['➕ Додати карту'], ['🏠 Головне меню']]).resize()
    );
  }

  let text = '🗂 *Ваші карти:*\n\n';
  cards.forEach((c, i) => { text += `${i + 1}. ${c.color} *${c.name}* — ${c.currency}\n`; });

  const rows = cards.map(c => [`🗑 Видалити: ${c.color} ${c.name}`]);
  rows.push(['➕ Додати карту'], ['🏠 Головне меню']);

  await ctx.reply(text, { parse_mode: 'Markdown', ...Markup.keyboard(rows).resize() });
}

async function handleManageCards(ctx, text) {
  if (text === '➕ Додати карту') {
    ctx.session.flow = 'add_card';
    ctx.session.step = 'enter_name';
    ctx.session.data = {};
    return ctx.reply(
      '🏦 Введіть назву карти:\n_(наприклад: Monobank, Готівка)_',
      { parse_mode: 'Markdown', ...cancelKeyboard }
    );
  }
  if (text === '🏠 Головне меню') {
    resetSession(ctx);
    return ctx.reply('📱 Головне меню:', mainKeyboard);
  }
  if (text.startsWith('🗑 Видалити: ')) {
    const label = text.replace('🗑 Видалити: ', '');
    const cards = ctx.session.data.cards || await db.getCards(ctx.from.id);
    const card  = cards.find(c => `${c.color} ${c.name}` === label);
    if (card) await db.deleteCard(card.id);
    await ctx.reply(`✅ Карту *${label}* видалено.`, { parse_mode: 'Markdown' });
    resetSession(ctx);
    return showCards(ctx);
  }
  return ctx.reply('❗ Виберіть дію зі списку 👇');
}

async function handleAddCardFlow(ctx, text) {
  const { step, data } = ctx.session;

  if (step === 'enter_name') {
    if (text.length < 1 || text.length > 30) return ctx.reply('❗ Назва має бути від 1 до 30 символів:');
    ctx.session.data = { ...data, name: text };
    ctx.session.step = 'select_icon';
    return ctx.reply('🎨 Виберіть іконку для карти:', listKeyboard(CARD_ICONS));
  }
  if (step === 'select_icon') {
    if (!CARD_ICONS.includes(text)) return ctx.reply('❗ Виберіть іконку зі списку 👇');
    ctx.session.data = { ...data, color: parseIcon(text) };
    ctx.session.step = 'select_currency';
    return ctx.reply('💱 Виберіть валюту карти:', listKeyboard(CURRENCIES));
  }
  if (step === 'select_currency') {
    if (!CURRENCIES.includes(text)) return ctx.reply('❗ Виберіть валюту зі списку 👇');
    const { name, color } = ctx.session.data;
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

// ─── FLOW: КАТЕГОРІЇ ─────────────────────────────────────────────────────────

async function showCategories(ctx) {
  ctx.session.flow = 'manage_cats';
  ctx.session.step = 'menu';
  ctx.session.data = {};
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

async function handleManageCats(ctx, text) {
  if (text === '➕ Категорія витрат') {
    ctx.session.flow = 'add_category';
    ctx.session.step = 'enter_name';
    ctx.session.data = { type: 'expense' };
    return ctx.reply('🏷 Введіть назву нової категорії витрат:', cancelKeyboard);
  }
  if (text === '➕ Категорія надходжень') {
    ctx.session.flow = 'add_category';
    ctx.session.step = 'enter_name';
    ctx.session.data = { type: 'income' };
    return ctx.reply('🏷 Введіть назву нової категорії надходжень:', cancelKeyboard);
  }
  if (text === '🏠 Головне меню') {
    resetSession(ctx);
    return ctx.reply('📱 Головне меню:', mainKeyboard);
  }
  return ctx.reply('❗ Виберіть дію зі списку 👇');
}

async function handleAddCategoryFlow(ctx, text) {
  const { step, data } = ctx.session;

  if (step === 'enter_name') {
    if (text.length < 1 || text.length > 25) return ctx.reply('❗ Назва має бути від 1 до 25 символів:');
    ctx.session.data = { ...data, name: text };
    ctx.session.step = 'select_emoji';
    return ctx.reply('🎨 Виберіть emoji для категорії:', listKeyboard(EMOJIS));
  }
  if (step === 'select_emoji') {
    if (!EMOJIS.includes(text)) return ctx.reply('❗ Виберіть emoji зі списку 👇');
    const { name, type } = ctx.session.data;
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

async function showHistory(ctx) {
  const transactions = await db.getTransactions(ctx.from.id, 15);
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
    if (card) text += `   ${card}\n`;
    if (tx.note) text += `   📝 ${tx.note}\n`;
    text += `   📅 ${date}\n\n`;
  }
  await ctx.reply(text, { parse_mode: 'Markdown', ...mainKeyboard });
}

module.exports = { createBot };