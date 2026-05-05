const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ─── USERS ───────────────────────────────────────────────
async function ensureUser(telegramUser) {
  const { data } = await supabase
    .from('users')
    .select('id')
    .eq('id', telegramUser.id)
    .single();

  if (!data) {
    await supabase.from('users').insert({
      id: telegramUser.id,
      username: telegramUser.username || telegramUser.first_name,
    });
    await createDefaultCategories(telegramUser.id);
  }
}

async function createDefaultCategories(userId) {
  const defaults = [
    { name: 'Їжа',        type: 'expense', emoji: '🍔' },
    { name: 'Транспорт',  type: 'expense', emoji: '🚗' },
    { name: 'Комунальні', type: 'expense', emoji: '🏠' },
    { name: 'Здоров\'я',  type: 'expense', emoji: '💊' },
    { name: 'Розваги',    type: 'expense', emoji: '🎮' },
    { name: 'Одяг',       type: 'expense', emoji: '👕' },
    { name: 'Інше',       type: 'expense', emoji: '📦' },
    { name: 'Зарплата',   type: 'income',  emoji: '💰' },
    { name: 'Фріланс',    type: 'income',  emoji: '💻' },
    { name: 'Подарунок',  type: 'income',  emoji: '🎁' },
    { name: 'Інше',       type: 'income',  emoji: '📥' },
  ];
  await supabase.from('categories').insert(
    defaults.map(c => ({ ...c, user_id: userId, is_default: true }))
  );
}

// ─── CARDS ───────────────────────────────────────────────
async function getCards(userId) {
  const { data } = await supabase
    .from('cards')
    .select('*')
    .eq('user_id', userId)
    .order('created_at');
  return data || [];
}

async function addCard(userId, name, currency, color) {
  const { data, error } = await supabase
    .from('cards')
    .insert({ user_id: userId, name, currency, color })
    .select()
    .single();
  return { data, error };
}

async function deleteCard(cardId) {
  return supabase.from('cards').delete().eq('id', cardId);
}

// ─── CATEGORIES ──────────────────────────────────────────
async function getCategories(userId, type) {
  const { data } = await supabase
    .from('categories')
    .select('*')
    .eq('user_id', userId)
    .eq('type', type)
    .order('name');
  return data || [];
}

async function addCategory(userId, name, type, emoji) {
  const { data, error } = await supabase
    .from('categories')
    .insert({ user_id: userId, name, type, emoji })
    .select()
    .single();
  return { data, error };
}

// ─── TRANSACTIONS ─────────────────────────────────────────
async function addTransaction(userId, cardId, categoryId, type, amount, currency, note) {
  const { data, error } = await supabase
    .from('transactions')
    .insert({ user_id: userId, card_id: cardId, category_id: categoryId, type, amount, currency, note })
    .select()
    .single();
  return { data, error };
}

async function getTransactions(userId, limit = 10, cardId = null) {
  let query = supabase
    .from('transactions')
    .select('*, cards(name, color, currency), categories(name, emoji)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (cardId) query = query.eq('card_id', cardId);

  const { data } = await query;
  return data || [];
}

// ─── BALANCE ──────────────────────────────────────────────
async function getCardBalance(cardId) {
  const { data } = await supabase
    .from('transactions')
    .select('type, amount')
    .eq('card_id', cardId);

  if (!data) return 0;
  return data.reduce((acc, t) => {
    return t.type === 'income' ? acc + Number(t.amount) : acc - Number(t.amount);
  }, 0);
}

async function getAllBalances(userId) {
  const cards = await getCards(userId);
  const result = [];
  for (const card of cards) {
    const balance = await getCardBalance(card.id);
    result.push({ ...card, balance });
  }
  return result;
}

async function deleteTransaction(txId) {
  return supabase.from('transactions').delete().eq('id', txId);
}

module.exports = {
  ensureUser, getCards, addCard, deleteCard,
  getCategories, addCategory,
  addTransaction, getTransactions, deleteTransaction,
  getCardBalance, getAllBalances,
};