const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

// Перевіряємо, чи підтягнулися змінні середовища
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const botToken = process.env.BOT_TOKEN;

if (!supabaseUrl || !supabaseKey || !botToken) {
  console.error('Увага: Не вистачає змінних середовища!');
}

// Ініціалізація клієнтів
const supabase = createClient(supabaseUrl, supabaseKey);
const bot = new Telegraf(botToken);

/* 
  Словник для збереження поточного кроку користувача. 
  Примітка: на Vercel цей стан може зникати, якщо функція "засинає" між запитами.
  Для 100% надійності в майбутньому стан можна зберігати в окремій таблиці Supabase.
*/
const userState = new Map();

// Головна клавіатура
const mainKeyboard = Markup.keyboard([
  ['💸 Витрата', '💰 Дохід'],
  ['🏦 Мої баланси']
]).resize();

// Команда /start
bot.start((ctx) => {
  ctx.reply('Привіт! Я твій фінансовий бот. Обери дію нижче:', mainKeyboard);
});

// Перегляд балансів
bot.hears('🏦 Мої баланси', async (ctx) => {
  const { data: banks, error } = await supabase.from('banks').select('*');
  
  if (error) return ctx.reply('Помилка отримання даних з бази.');
  if (!banks || banks.length === 0) return ctx.reply('Ти ще не додав жодного банку в базу Supabase.');

  let text = '<b>Твої баланси:</b>\n\n';
  banks.forEach(bank => {
    // Використовуємо parseFloat, щоб відкинути зайві нулі після коми
    text += `🏦 ${bank.name}: ${parseFloat(bank.balance)} грн\n`;
  });
  
  ctx.replyWithHTML(text);
});

// Універсальна функція для старту витрати або доходу
const handleTransactionStart = async (ctx, type) => {
  const { data: banks, error } = await supabase.from('banks').select('*');
  
  if (error || !banks) return ctx.reply('Помилка отримання списку банків.');
  if (banks.length === 0) return ctx.reply('Додай банки в базу даних.');

  // Генеруємо inline-кнопки
  const buttons = banks.map(bank => 
    Markup.button.callback(bank.name, `select_${type}_${bank.id}`)
  );

  ctx.reply('Обери картку/банк:', Markup.inlineKeyboard(buttons, { columns: 2 }));
};

bot.hears('💸 Витрата', (ctx) => handleTransactionStart(ctx, 'expense'));
bot.hears('💰 Дохід', (ctx) => handleTransactionStart(ctx, 'income'));

// Обробка натискання на inline-кнопку з банком
bot.action(/select_(expense|income)_(.+)/, async (ctx) => {
  const type = ctx.match[1];
  const bankId = ctx.match[2];
  
  // Запам'ятовуємо, що користувач зараз має ввести суму
  userState.set(ctx.from.id, { step: 'WAITING_FOR_AMOUNT', type, bankId });
  
  const actionText = type === 'expense' ? 'витрати' : 'доходу';
  
  // Закриваємо стан "завантаження" на кнопці, щоб вона не блимала
  await ctx.answerCbQuery(); 
  ctx.reply(`Введи суму ${actionText} цифрами (наприклад: 150 або 50.50):`);
});

// Обробка тексту (коли користувач вводить суму)
bot.on('text', async (ctx) => {
  const state = userState.get(ctx.from.id);
  
  // Якщо ми не чекали на суму від цього користувача, ігноруємо текст
  if (!state || state.step !== 'WAITING_FOR_AMOUNT') return;

  // Замінюємо кому на крапку, якщо користувач ввів дробове число з комою
  const amountText = ctx.message.text.replace(',', '.');
  const amount = parseFloat(amountText);

  if (isNaN(amount) || amount <= 0) {
    return ctx.reply('Будь ласка, введи коректне додатнє число.');
  }

  // 1. Отримуємо поточний баланс
  const { data: bankData, error: bankError } = await supabase
    .from('banks')
    .select('balance')
    .eq('id', state.bankId)
    .single();

  if (bankError || !bankData) return ctx.reply('Помилка: банк не знайдено в базі.');

  const currentBalance = parseFloat(bankData.balance) || 0;
  
  // 2. Рахуємо новий баланс
  const newBalance = state.type === 'expense' 
    ? currentBalance - amount 
    : currentBalance + amount;

  // 3. Оновлюємо баланс та записуємо транзакцію
  const { error: updateError } = await supabase
    .from('banks')
    .update({ balance: newBalance })
    .eq('id', state.bankId);

  const { error: insertError } = await supabase
    .from('transactions')
    .insert([{ 
      bank_id: state.bankId, 
      type: state.type, 
      amount: amount 
    }]);

  if (updateError || insertError) {
    return ctx.reply('Сталася помилка при збереженні в базу.');
  }

  // Очищаємо стан, щоб бот більше не чекав суму
  userState.delete(ctx.from.id); 
  
  const actionWord = state.type === 'expense' ? 'Витрату' : 'Дохід';
  ctx.reply(`✅ ${actionWord} на ${amount} грн успішно записано!`, mainKeyboard);
});

// ГОЛОВНИЙ ЕКСПОРТ ДЛЯ VERCEL (Серверна частина)
module.exports = async function (req, res) {
  try {
    // 1. Обробка переходу за посиланням з браузера
    if (req.method === 'GET') {
      return res.status(200).send('Бот живий! Цей ендпоінт чекає на POST-запити від Telegram.');
    }

    // 2. Обробка вебхуків від Telegram
    if (req.method === 'POST') {
      // Vercel зазвичай сам парсить JSON, але іноді віддає як рядок
      let body;
      try {
        body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      } catch (e) {
        console.error('Не вдалося розпарсити тіло запиту:', req.body);
        return res.status(400).send('Invalid JSON');
      }

      // Захист від порожніх запитів (щоб Telegraf не падав)
      if (!body || !body.update_id) {
        console.error('Отримано POST-запит без update_id:', body);
        return res.status(400).send('Bad Request: Missing update_id');
      }

      // Якщо все добре, передаємо дані боту
      await bot.handleUpdate(body, res); 
      return; 
    }

    // Якщо це не GET і не POST
    res.status(405).send('Method Not Allowed');
  } catch (error) {
    console.error('Помилка обробки webhook:', error);
    // Повертаємо 200 навіть при помилці, щоб Telegram не спамив повторними запитами
    res.status(200).send('Error ignored');
  }
};