const { Telegraf, Scenes, session } = require('telegraf');
const db = require('./db');
const { mainMenu, manageCardsKeyboard, manageCategoriesKeyboard, cardsKeyboard } = require('./keyboards');
const { showAllBalances } = require('./handlers/balance');
const { showHistory } = require('./handlers/history');

// Сцени
const addExpenseScene = require('./scenes/addExpense');
const addIncomeScene = require('./scenes/addIncome');
const addCardScene = require('./scenes/addCard');
const addCategoryScene = require('./scenes/addCategory');

function createBot() {
  const bot = new Telegraf(process.env.BOT_TOKEN);

  // Stage (менеджер сцен)
  const stage = new Scenes.Stage([
    addExpenseScene,
    addIncomeScene,
    addCardScene,
    addCategoryScene,
  ]);

  bot.use(session());
  bot.use(stage.middleware());

  // Middleware: реєстрація юзера
  bot.use(async (ctx, next) => {
    if (ctx.from) await db.ensureUser(ctx.from);
    return next();
  });

  // ─── КОМАНДИ ─────────────────────────────────────────────
  bot.start(async (ctx) => {
    await ctx.reply(
      `👋 Привіт, *${ctx.from.first_name}*!\n\nЯ — твій особистий фінансовий помічник 💰\nОбери дію:`,
      { parse_mode: 'Markdown', ...mainMenu }
    );
  });

  bot.command('menu', async (ctx) => {
    await ctx.reply('📱 Головне меню:', mainMenu);
  });

  // ─── ГОЛОВНЕ МЕНЮ ─────────────────────────────────────────
  bot.action('main_menu', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText('📱 Головне меню:', mainMenu);
  });

  // ─── ТРАНЗАКЦІЇ ───────────────────────────────────────────
  bot.action('add_expense', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.scene.enter('add_expense');
  });

  bot.action('add_income', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.scene.enter('add_income');
  });

  // ─── БАЛАНСИ ──────────────────────────────────────────────
  bot.action('show_balances', async (ctx) => {
    await ctx.answerCbQuery();
    await showAllBalances(ctx);
  });

  // ─── ІСТОРІЯ ──────────────────────────────────────────────
  bot.action('show_history', async (ctx) => {
    await ctx.answerCbQuery();
    await showHistory(ctx);
  });

  bot.action('history_by_card', async (ctx) => {
    await ctx.answerCbQuery();
    const cards = await db.getCards(ctx.from.id);
    await ctx.editMessageText('💳 Виберіть карту:', cardsKeyboard(cards, 'history_card'));
  });

  bot.action(/^history_card:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const cardId = ctx.match[1];
    await showHistory(ctx, cardId);
  });

  // ─── УПРАВЛІННЯ КАРТАМИ ───────────────────────────────────
  bot.action('manage_cards', async (ctx) => {
    await ctx.answerCbQuery();
    const cards = await db.getCards(ctx.from.id);
    const text = cards.length ? '🗂 *Ваші карти:*' : '🗂 Карт немає. Додайте першу!';
  
    try {
      await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...manageCardsKeyboard(cards),
      });
    } catch (err) {
      if (err.description?.includes('message is not modified')) return;
      throw err;
    }
  });

  bot.action('add_card', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.scene.enter('add_card');
  });

  bot.action(/^delete_card:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery('Карту видалено');
    const cardId = ctx.match[1];
    await db.deleteCard(cardId);
    const cards = await db.getCards(ctx.from.id);
    await ctx.editMessageText('🗂 *Ваші карти:*', {
      parse_mode: 'Markdown',
      ...manageCardsKeyboard(cards),
    });
  });

  // ─── УПРАВЛІННЯ КАТЕГОРІЯМИ ───────────────────────────────
  bot.action('manage_categories', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      '🏷 *Управління категоріями:*',
      { parse_mode: 'Markdown', ...manageCategoriesKeyboard() }
    );
  });

  bot.action(/^add_category:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const type = ctx.match[1];
    await ctx.scene.enter('add_category', { type });
  });

  // ─── СКАСУВАННЯ ───────────────────────────────────────────
  bot.action('cancel', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText('❌ Скасовано.', mainMenu);
  });

  return bot;
}

module.exports = { createBot };