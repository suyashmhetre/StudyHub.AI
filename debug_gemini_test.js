require('dotenv').config();
const { generateStudyAid } = require('./lib/ai');
(async () => {
  try {
    const result = await generateStudyAid({
      action: 'answer',
      question: 'What is a database transaction?',
      chunks: [{ resourceId: 'res1', resourceTitle: 'Database notes', content: 'A database transaction is an atomic unit of work that must be completed entirely or not at all. Transactions ensure consistency using ACID properties.' }],
      config: { apiKey: process.env.GEMINI_API_KEY, model: 'gemini-3.5-pro' }
    });
    console.log(JSON.stringify({ type: result.type, answer: result.answer ? result.answer.slice(0, 240) : null, warning: result.warning || null }, null, 2));
  } catch (error) {
    console.error('ERROR', error.message);
  }
})();
