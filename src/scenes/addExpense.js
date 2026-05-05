const { Scenes, Markup } = require('telegraf');
const db = require('../db');
const { cardsKeyboard, categoriesKeyboard, currencyKeyboard } = require('../keyboards');

const addExpenseScene = new Scenes.WizardScene('add_expense',

  // Крок 1: Показуємо карти
  async (ctx) => {
    const cards = await db.getCards(ctx.from.id);
    if (!cards.length) {
      await ctx.reply('❗ У вас немає карт. Спочатку додайте карту через "🗂 Карти".');
      return ctx.scene.leave();
    }
    await ctx.reply('💳 Виберіть карту для списання:', cardsKeyboard(cards));
    return ctx.wizard.next();
  },

  // Крок 2: Чекаємо вибір карти → показуємо категорії
  async (ctx) => {
    if (!ctx.callbackQuery) return; // ігноруємо не-кліки
    const data = ctx.callbackQuery.data;

    if (!data.startsWith('select_card:')) {
      await ctx.answerCbQuery('Будь ласка, виберіть карту зі списку');
      return;
    }

    ctx.wizard.state.cardId = data.split(':')[1];
    await ctx.answerCbQuery();

    const categories = await db.getCategories(ctx.from.id, 'expense');
    await ctx.editMessageText('🏷 Виберіть категорію:', categoriesKeyboard(categories));
    return ctx.wizard.next();
  },

  // Крок 3: Чекаємо вибір категорії → просимо суму
  async (ctx) => {
    if (!ctx.callbackQuery) return;
    const data = ctx.callbackQuery.data;

    if (!data.startsWith('select_category:')) {
      await ctx.answerCbQuery('Будь ласка, виберіть категорію зі списку');
      return;
    }

    ctx.wizard.state.categoryId = data.split(':')[1];
    await ctx.answerCbQuery();

    await ctx.editMessageText(
      '💰 Введіть суму витрати:\n_(наприклад: 150 або 1500.50)_',
      { parse_mode: 'Markdown' }
    );
    return ctx.wizard.next();
  },

  // Крок 4: Чекаємо текст із сумою → показуємо валюти
  async (ctx) => {
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery('Введіть суму текстом');
      return;
    }

    const text = ctx.message?.text?.trim();
    const amount = parseFloat(text?.replace(',', '.'));

    if (!text || isNaN(amount) || amount <= 0) {
      await ctx.reply('❗ Введіть коректну суму (число більше 0):');
      return;
    }

    ctx.wizard.state.amount = amount;
    await ctx.reply('💱 Виберіть валюту:', currencyKeyboard);
    return ctx.wizard.next();
  },

  // Крок 5: Чекаємо вибір валюти → просимо нотатку
  async (ctx) => {
    if (!ctx.callbackQuery) return;
    const data = ctx.callbackQuery.data;

    if (!data.startsWith('currency:')) {
      await ctx.answerCbQuery('Будь ласка, виберіть валюту');
      return;
    }

    ctx.wizard.state.currency = data.split(':')[1];
    await ctx.answerCbQuery();

    await ctx.editMessageText(
      '📝 Додайте коментар до витрати або натисніть "Пропустити":',
      Markup.inlineKeyboard([
        [Markup.button.callback('⏭ Пропустити', 'skip_note')],
        [Markup.button.callback('❌ Скасувати', 'cancel')],
      ])
    );
    return ctx.wizard.next();
  },

  // Крок 6: Нотатка або пропуск → зберігаємо
  async (ctx) => {
    let note = null;

    if (ctx.callbackQuery) {
      if (ctx.callbackQuery.data === 'skip_note') {
        await ctx.answerCbQuery();
      } else {
        await ctx.answerCbQuery('Введіть коментар або натисніть Пропустити');
        return;
      }
    } else if (ctx.message?.text) {
      note = ctx.message.text.trim();
    } else {
      return;
    }

    const { cardId, categoryId, amount, currency } = ctx.wizard.state;

    const { error } = await db.addTransaction(
      ctx.from.id, cardId, categoryId, 'expense', amount, currency, note
    );

    const { mainMenu } = require('../keyboards');

    if (error) {
      console.error('addTransaction error:', error);
      await ctx.reply('❌ Помилка збереження. Спробуйте ще раз.');
    } else {
      const replyText = `✅ *Витрату збережено!*\n💸 ${amount} ${currency}${note ? `\n📝 ${note}` : ''}`;
      if (ctx.callbackQuery) {
        await ctx.editMessageText(replyText, { parse_mode: 'Markdown', ...mainMenu });
      } else {
        await ctx.reply(replyText, { parse_mode: 'Markdown', ...mainMenu });
      }
    }

    return ctx.scene.leave();
  }
);

addExpenseScene.action('cancel', async (ctx) => {
  await ctx.answerCbQuery();
  const { mainMenu } = require('../keyboards');
  await ctx.editMessageText('❌ Скасовано.', mainMenu).catch(() => ctx.reply('❌ Скасовано.', mainMenu));
  return ctx.scene.leave();
});

module.exports = addExpenseScene;