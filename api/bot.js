require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

// Підключення до Supabase та Telegram
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const bot = new Telegraf(process.env.BOT_TOKEN);

// Простий об'єкт для збереження стану користувача (щоб знати, що він зараз вводить)
const userState = new Map();

// Головна клавіатура
const mainKeyboard = Markup.keyboard([
  ['💸 Витрата', '💰 Дохід'],
  ['🏦 Мої баланси']
]).resize();

bot.start((ctx) => {
  ctx.reply('Привіт! Я твій фінансовий помічник.', mainKeyboard);
});

// Обробка натискання на "Мої баланси"
bot.hears('🏦 Мої баланси', async (ctx) => {
  const { data: banks, error } = await supabase.from('banks').select('*');
  if (error) return ctx.reply('Помилка отримання даних.');

  if (!banks.length) return ctx.reply('У тебе ще немає доданих банків у базі.');

  let text = '<b>Твої баланси:</b>\n\n';
  banks.forEach(bank => {
    text += `🏦 ${bank.name}: ${bank.balance} грн\n`;
  });
  
  ctx.replyWithHTML(text);
});

// Обробка натискання на "Витрата" або "Дохід"
const handleTransactionStart = async (ctx, type) => {
  const { data: banks } = await supabase.from('banks').select('*');
  
  // Створюємо inline-кнопки з банками
  const buttons = banks.map(bank => 
    Markup.button.callback(bank.name, `select_bank_${type}_${bank.id}`)
  );

  ctx.reply('Обери картку:', Markup.inlineKeyboard(buttons, { columns: 2 }));
};

bot.hears('💸 Витрата', (ctx) => handleTransactionStart(ctx, 'expense'));
bot.hears('💰 Дохід', (ctx) => handleTransactionStart(ctx, 'income'));

// Обробка вибору банку через inline-кнопку
bot.action(/select_bank_(expense|income)_(.+)/, async (ctx) => {
  const type = ctx.match[1];
  const bankId = ctx.match[2];
  
  // Зберігаємо стан: чекаємо на введення суми для конкретного банку
  userState.set(ctx.from.id, { step: 'WAITING_FOR_AMOUNT', type, bankId });
  
  const actionText = type === 'expense' ? 'витрати' : 'доходу';
  ctx.reply(`Введи суму ${actionText} цифрами (наприклад: 150.50):`);
  ctx.answerCbQuery(); // Закриваємо стан "завантаження" на кнопці
});

// Обробка текстових повідомлень (коли очікуємо суму)
bot.on('text', async (ctx) => {
  const state = userState.get(ctx.from.id);
  if (!state || state.step !== 'WAITING_FOR_AMOUNT') return;

  const amount = parseFloat(ctx.message.text);
  if (isNaN(amount)) {
    return ctx.reply('Будь ласка, введи коректне число.');
  }

  // Отримуємо поточний баланс банку
  const { data: bankData } = await supabase
    .from('banks')
    .select('balance')
    .eq('id', state.bankId)
    .single();

  const newBalance = state.type === 'expense' 
    ? bankData.balance - amount 
    : parseFloat(bankData.balance) + amount;

  // Оновлюємо баланс і записуємо транзакцію паралельно
  await Promise.all([
    supabase.from('banks').update({ balance: newBalance }).eq('id', state.bankId),
    supabase.from('transactions').insert([{ 
      bank_id: state.bankId, 
      type: state.type, 
      amount: amount 
    }])
  ]);

  userState.delete(ctx.from.id); // Очищаємо стан
  
  const actionText = state.type === 'expense' ? 'Витрату' : 'Дохід';
  ctx.reply(`${actionText} на суму ${amount} грн успішно записано!`, mainKeyboard);
});

bot.launch().then(() => console.log('Bot is running...'));

// Безпечне завершення роботи
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));