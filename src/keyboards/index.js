const { Markup } = require('telegraf');

// Головне меню
const mainMenu = Markup.inlineKeyboard([
  [
    Markup.button.callback('➕ Витрата', 'add_expense'),
    Markup.button.callback('💸 Надходження', 'add_income'),
  ],
  [
    Markup.button.callback('💳 Баланси', 'show_balances'),
    Markup.button.callback('📋 Історія', 'show_history'),
  ],
  [
    Markup.button.callback('🗂 Карти', 'manage_cards'),
    Markup.button.callback('🏷 Категорії', 'manage_categories'),
  ],
]);

// Кнопка "Назад до меню"
const backToMenu = Markup.inlineKeyboard([
  Markup.button.callback('🏠 Головне меню', 'main_menu'),
]);

// Динамічна клавіатура карт
function cardsKeyboard(cards, action = 'select_card') {
  const buttons = cards.map(c =>
    [Markup.button.callback(`${c.color} ${c.name} (${c.currency})`, `${action}:${c.id}`)]
  );
  buttons.push([Markup.button.callback('❌ Скасувати', 'cancel')]);
  return Markup.inlineKeyboard(buttons);
}

// Динамічна клавіатура категорій
function categoriesKeyboard(categories) {
  const rows = [];
  for (let i = 0; i < categories.length; i += 2) {
    const row = [
      Markup.button.callback(
        `${categories[i].emoji} ${categories[i].name}`,
        `select_category:${categories[i].id}`
      ),
    ];
    if (categories[i + 1]) {
      row.push(
        Markup.button.callback(
          `${categories[i + 1].emoji} ${categories[i + 1].name}`,
          `select_category:${categories[i + 1].id}`
        )
      );
    }
    rows.push(row);
  }
  rows.push([Markup.button.callback('❌ Скасувати', 'cancel')]);
  return Markup.inlineKeyboard(rows);
}

// Валюти
const currencyKeyboard = Markup.inlineKeyboard([
  [
    Markup.button.callback('🇺🇦 UAH', 'currency:UAH'),
    Markup.button.callback('🇺🇸 USD', 'currency:USD'),
    Markup.button.callback('🇪🇺 EUR', 'currency:EUR'),
  ],
  [Markup.button.callback('❌ Скасувати', 'cancel')],
]);

// Emoji для карти
const cardColorKeyboard = Markup.inlineKeyboard([
  [
    Markup.button.callback('💳 Картка', 'cardcolor:💳'),
    Markup.button.callback('🏦 Банк', 'cardcolor:🏦'),
    Markup.button.callback('💵 Готівка', 'cardcolor:💵'),
  ],
  [
    Markup.button.callback('🟡 Монобанк', 'cardcolor:🟡'),
    Markup.button.callback('🟢 Приват', 'cardcolor:🟢'),
    Markup.button.callback('🔵 Ощад', 'cardcolor:🔵'),
  ],
  [Markup.button.callback('❌ Скасувати', 'cancel')],
]);

// Управління картами
function manageCardsKeyboard(cards) {
  const buttons = cards.map(c => [
    Markup.button.callback(`${c.color} ${c.name}`, `card_info:${c.id}`),
    Markup.button.callback('🗑 Видалити', `delete_card:${c.id}`),
  ]);
  buttons.push([Markup.button.callback('➕ Додати карту', 'add_card')]);
  buttons.push([Markup.button.callback('🏠 Головне меню', 'main_menu')]);
  return Markup.inlineKeyboard(buttons);
}

// Управління категоріями
function manageCategoriesKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('➕ Додати витрат.', 'add_category:expense'),
      Markup.button.callback('➕ Додати надх.', 'add_category:income'),
    ],
    [Markup.button.callback('🏠 Головне меню', 'main_menu')],
  ]);
}

// Підтвердження транзакції
function confirmTransactionKeyboard(data) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Підтвердити', `confirm_tx:${JSON.stringify(data)}`),
      Markup.button.callback('❌ Скасувати', 'cancel'),
    ],
  ]);
}

module.exports = {
  mainMenu, backToMenu, cardsKeyboard, categoriesKeyboard,
  currencyKeyboard, cardColorKeyboard, manageCardsKeyboard,
  manageCategoriesKeyboard, confirmTransactionKeyboard,
};