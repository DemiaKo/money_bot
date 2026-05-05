const db = require('../db');
const { mainMenu, cardsKeyboard } = require('../keyboards');

async function showAllBalances(ctx) {
  const balances = await db.getAllBalances(ctx.from.id);

  if (!balances.length) {
    await ctx.editMessageText(
      '❗ У вас немає карт.\nДодайте карту через "🗂 Карти".',
      mainMenu
    );
    return;
  }

  let text = '💼 *Ваші баланси:*\n\n';
  for (const card of balances) {
    const sign = card.balance >= 0 ? '✅' : '🔴';
    text += `${sign} ${card.color} *${card.name}*\n`;
    text += `   ${card.balance.toFixed(2)} ${card.currency}\n\n`;
  }

  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...mainMenu });
}

async function showCardBalance(ctx, cardId) {
  const [card] = await db.getCards(ctx.from.id).then(cards =>
    cards.filter(c => c.id === cardId)
  );
  if (!card) return ctx.answerCbQuery('Карту не знайдено');

  const balance = await db.getCardBalance(cardId);
  const sign = balance >= 0 ? '✅' : '🔴';
  const text = `${sign} ${card.color} *${card.name}*\nБаланс: *${balance.toFixed(2)} ${card.currency}*`;

  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...mainMenu });
}

module.exports = { showAllBalances, showCardBalance };