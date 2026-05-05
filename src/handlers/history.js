const db = require('../db');
const { mainMenu, cardsKeyboard } = require('../keyboards');
const { Markup } = require('telegraf');

async function showHistory(ctx, cardId = null) {
  const transactions = await db.getTransactions(ctx.from.id, 15, cardId);

  if (!transactions.length) {
    const text = cardId
      ? '📋 По цій карті транзакцій немає.'
      : '📋 Транзакцій ще немає.';
    return ctx.editMessageText(text, mainMenu);
  }

  let text = cardId ? '📋 *Остання активність по карті:*\n\n' : '📋 *Остання активність:*\n\n';

  for (const tx of transactions) {
    const date = new Date(tx.created_at).toLocaleDateString('uk-UA');
    const emoji = tx.type === 'expense' ? '🔴' : '🟢';
    const cat = tx.categories ? `${tx.categories.emoji} ${tx.categories.name}` : 'Без категорії';
    const card = tx.cards ? `${tx.cards.color} ${tx.cards.name}` : '';
    text += `${emoji} *${tx.amount} ${tx.currency}* — ${cat}\n`;
    if (!cardId) text += `   ${card}\n`;
    if (tx.note) text += `   📝 ${tx.note}\n`;
    text += `   📅 ${date}\n\n`;
  }

  const buttons = [[Markup.button.callback('🏠 Головне меню', 'main_menu')]];
  if (!cardId) {
    const cards = await db.getCards(ctx.from.id);
    if (cards.length) {
      buttons.unshift([Markup.button.callback('🔍 По карті', 'history_by_card')]);
    }
  }

  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buttons),
  });
}

module.exports = { showHistory };