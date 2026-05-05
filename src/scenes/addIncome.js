const { Scenes, Markup } = require('telegraf');
const db = require('../db');
const { cardsKeyboard, categoriesKeyboard, currencyKeyboard } = require('../keyboards');

const addIncomeScene = new Scenes.WizardScene(
  'add_income',

  async (ctx) => {
    const cards = await db.getCards(ctx.from.id);
    if (!cards.length) {
      await ctx.reply('❗ Спочатку додайте карту через "🗂 Карти".');
      return ctx.scene.leave();
    }
    await ctx.reply('💳 Виберіть карту для зарахування:', cardsKeyboard(cards));
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!ctx.callbackQuery?.data?.startsWith('select_card:')) return;
    ctx.wizard.state.cardId = ctx.callbackQuery.data.split(':')[1];
    await ctx.answerCbQuery();
    const categories = await db.getCategories(ctx.from.id, 'income');
    await ctx.editMessageText('🏷 Виберіть категорію:', categoriesKeyboard(categories));
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!ctx.callbackQuery?.data?.startsWith('select_category:')) return;
    ctx.wizard.state.categoryId = ctx.callbackQuery.data.split(':')[1];
    await ctx.answerCbQuery();
    await ctx.editMessageText('💰 Введіть суму надходження:');
    return ctx.wizard.next();
  },

  async (ctx) => {
    const amount = parseFloat(ctx.message?.text?.trim());
    if (isNaN(amount) || amount <= 0) {
      await ctx.reply('❗ Введіть коректну суму:');
      return;
    }
    ctx.wizard.state.amount = amount;
    await ctx.reply('💱 Виберіть валюту:', currencyKeyboard);
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!ctx.callbackQuery?.data?.startsWith('currency:')) return;
    ctx.wizard.state.currency = ctx.callbackQuery.data.split(':')[1];
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      '📝 Коментар або пропустіть:',
      Markup.inlineKeyboard([Markup.button.callback('⏭ Пропустити', 'skip_note')])
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    const note = ctx.callbackQuery?.data === 'skip_note' ? null : ctx.message?.text || null;
    if (ctx.callbackQuery) await ctx.answerCbQuery();

    const { cardId, categoryId, amount, currency } = ctx.wizard.state;
    const { error } = await db.addTransaction(
      ctx.from.id, cardId, categoryId, 'income', amount, currency, note
    );

    const { mainMenu } = require('../keyboards');
    if (error) {
      await ctx.reply('❌ Помилка збереження.');
    } else {
      await ctx.reply(
        `✅ *Надходження збережено!*\n💰 ${amount} ${currency}${note ? `\n📝 ${note}` : ''}`,
        { parse_mode: 'Markdown', ...mainMenu }
      );
    }
    return ctx.scene.leave();
  }
);

addIncomeScene.action('cancel', async (ctx) => {
  await ctx.answerCbQuery();
  const { mainMenu } = require('../keyboards');
  await ctx.editMessageText('❌ Скасовано.', mainMenu);
  return ctx.scene.leave();
});

module.exports = addIncomeScene;