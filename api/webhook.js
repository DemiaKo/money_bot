const { createBot } = require('../src/bot');

const bot = createBot();

module.exports = async (req, res) => {
  if (req.method === 'POST') {
    try {
      await bot.handleUpdate(req.body, res);
    } catch (err) {
      console.error('Webhook error:', err);
      res.status(200).json({ ok: true });
    }
  } else {
    res.status(200).json({ status: 'Finance Bot is running 🤖' });
  }
};