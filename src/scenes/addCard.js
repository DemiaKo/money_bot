const { Scenes } = require('telegraf');
const db = require('../db');
const { currencyKeyboard, cardColorKeyboard } = require('../keyboards');

const addCardScene = new Scenes.WizardScene(
  'add_card',

  async (ctx) => {
    await ctx.reply('🏦 Введіть назву карти/рахунку:\n_(наприклад: Monobank, Готівка)_', {
      parse_mode: 'Markdown',
    });
    return ctx.wizard.next();
  },

  async (ctx) => {
    const name = ctx.message?.text?.trim();
    if (!name || name.length > 30) {
      await ctx.reply('❗ Назва має бути від 1 до 30 символів:');
      return;
    }
    ctx.wizard.state.name = name;
    await ctx.reply('🎨 Виберіть іконку для карти:', cardColorKeyboard);
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!ctx.callbackQuery?.data?.startsWith('cardcolor:')) return;
    ctx.wizard.state.color = ctx.callbackQuery.data.split(':')[1];
    await ctx.answerCbQuery();
    await ctx.editMessageText('💱 Виберіть валюту карти:', currencyKeyboard);
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!ctx.callbackQuery?.data?.startsWith('currency:')) return;
    ctx.wizard.state.currency = ctx.callbackQuery.data.split(':')[1];
    await ctx.answerCbQuery();

    const { name, color, currency } = ctx.wizard.state;
    const { error } = await db.addCard(ctx.from.id, name, currency, color);

    const { mainMenu } = require('../keyboards');
    if (error) {
      await ctx.editMessageText('❌ Помилка створення карти.');
    } else {
      await ctx.editMessageText(
        `✅ Карту *${color} ${name}* (${currency}) створено!`,
        { parse_mode: 'Markdown', ...mainMenu }
      );
    }
    return ctx.scene.leave();
  }
);

addCardScene.action('cancel', async (ctx) => {
  await ctx.answerCbQuery();
  const { mainMenu } = require('../keyboards');
  await ctx.editMessageText('❌ Скасовано.', mainMenu);
  return ctx.scene.leave();
});

module.exports = addCardScene;