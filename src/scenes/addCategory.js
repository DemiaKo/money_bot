const { Scenes } = require('telegraf');
const db = require('../db');

const EMOJIS = ['🍔','🚗','🏠','💊','🎮','👕','📦','💰','💻','🎁','📥','✈️','🎓','⚽','🛒'];

const addCategoryScene = new Scenes.WizardScene(
  'add_category',

  async (ctx) => {
    const type = ctx.scene.state.type; // 'expense' або 'income'
    ctx.wizard.state.type = type;
    const label = type === 'expense' ? 'витрат' : 'надходжень';
    await ctx.reply(`🏷 Введіть назву нової категорії ${label}:`);
    return ctx.wizard.next();
  },

  async (ctx) => {
    const name = ctx.message?.text?.trim();
    if (!name || name.length > 25) {
      await ctx.reply('❗ Назва має бути від 1 до 25 символів:');
      return;
    }
    ctx.wizard.state.name = name;

    const { Markup } = require('telegraf');
    const buttons = [];
    for (let i = 0; i < EMOJIS.length; i += 5) {
      buttons.push(EMOJIS.slice(i, i + 5).map(e =>
        Markup.button.callback(e, `emoji:${e}`)
      ));
    }
    await ctx.reply('🎨 Виберіть emoji для категорії:', Markup.inlineKeyboard(buttons));
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!ctx.callbackQuery?.data?.startsWith('emoji:')) return;
    const emoji = ctx.callbackQuery.data.split(':')[1];
    await ctx.answerCbQuery();

    const { name, type } = ctx.wizard.state;
    const { error } = await db.addCategory(ctx.from.id, name, type, emoji);

    const { mainMenu } = require('../keyboards');
    if (error) {
      await ctx.editMessageText('❌ Помилка створення категорії.');
    } else {
      await ctx.editMessageText(
        `✅ Категорію *${emoji} ${name}* додано!`,
        { parse_mode: 'Markdown', ...mainMenu }
      );
    }
    return ctx.scene.leave();
  }
);

module.exports = addCategoryScene;