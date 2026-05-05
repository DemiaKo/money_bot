const { Scenes, Markup } = require('telegraf');
const db = require('../db');
const { cardsKeyboard, categoriesKeyboard, currencyKeyboard } = require('../keyboards');

const addExpenseScene = new Scenes.WizardScene(
  'add_expense',

  // Крок 1: Вибір карти
  async (ctx) => {
    const cards = await db.getCards(ctx.from.id);
    if (!cards.length) {
      await ctx.reply('❗ У вас немає карт. Спочатку додайте карту через "🗂 Карти".');
      return ctx.scene.leave();
    }
    await ctx.reply('💳 Виберіть карту для списання:', cardsKeyboard(cards));
    return ctx.wizard.next();
  },

  // Крок 2: Вибір категорії
  async (ctx) => {
    if (!ctx.callbackQuery?.data?.startsWith('select_card:')) return;
    ctx.wizard.state.cardId = ctx.callbackQuery.data.split(':')[1];
    await ctx.answerCbQuery();

    const categories = await db.getCategories(ctx.from.id, 'expense');
    await ctx.editMessageText('🏷 Виберіть категорію:', categoriesKeyboard(categories));
    return ctx.wizard.next();
  },

  // Крок 3: Введення суми
  async (ctx) => {
    if (!ctx.callbackQuery?.data?.startsWith('select_category:')) return;
    ctx.wizard.state.categoryId = ctx.callbackQuery.data.split(':')[1];
    await ctx.answerCbQuery();

    await ctx.editMessageText(
      '💰 Введіть суму витрати:\n_(наприклад: 150 або 1500.50)_',
      { parse_mode: 'Markdown' }
    );
    return ctx.wizard.next();
  },

  // Крок 4: Вибір валюти
  async (ctx) => {
    const text = ctx.message?.text?.trim();
    const amount = parseFloat(text);
    if (!text || isNaN(amount) || amount <= 0) {
      await ctx.reply('❗ Введіть коректну суму (число більше 0):');
      return;
    }
    ctx.wizard.state.amount = amount;
    await ctx.reply('💱 Виберіть валюту:', currencyKeyboard);
    return ctx.wizard.next();
  },

  // Крок 5: Нотатка (опційно)
  async (ctx) => {
    if (!ctx.callbackQuery?.data?.startsWith('currency:')) return;
    ctx.wizard.state.currency = ctx.callbackQuery.data.split(':')[1];
    await ctx.answerCbQuery();

    await ctx.editMessageText(
      '📝 Додайте коментар до витрати або натисніть "Пропустити":',
      Markup.inlineKeyboard([
        Markup.button.callback('⏭ Пропустити', 'skip_note'),
      ])
    );
    return ctx.wizard.next();
  },

  // Крок 6: Збереження
  async (ctx) => {
    const note = ctx.callbackQuery?.data === 'skip_note'
      ? null
      : ctx.message?.text || null;

    if (ctx.callbackQuery) await ctx.answerCbQuery();

    const { cardId, categoryId, amount, currency } = ctx.wizard.state;

    const { error } = await db.addTransaction(
      ctx.from.id, cardId, categoryId, 'expense', amount, currency, note
    );

    if (error) {
      await ctx.reply('❌ Помилка збереження. Спробуйте ще раз.');
    } else {
      const { mainMenu } = require('../keyboards');
      await ctx.reply(
        `✅ *Витрату збережено!*\n💸 ${amount} ${currency}${note ? `\n📝 ${note}` : ''}`,
        { parse_mode: 'Markdown', ...mainMenu }
      );
    }

    return ctx.scene.leave();
  }
);

// Обробка скасування всередині сцени
addExpenseScene.action('cancel', async (ctx) => {
  await ctx.answerCbQuery();
  const { mainMenu } = require('../keyboards');
  await ctx.editMessageText('❌ Скасовано.', mainMenu);
  return ctx.scene.leave();
});

module.exports = addExpenseScene;