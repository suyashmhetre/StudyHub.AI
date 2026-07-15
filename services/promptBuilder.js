const systemInstruction = require('../config/systemPrompt');

function loadTemplate(type) {
  try { return require(`../server/prompts/${type}.js`); } catch { return require('../server/prompts/theory.js'); }
}

async function buildPrompt({ question, type, contextChunks = [] }) {
  const template = loadTemplate(type);
  const answerFormat = typeof template === 'function' ? template(question, contextChunks) : String(template);
  const excerpts = contextChunks.map((chunk, index) => `[${index + 1}] ${chunk.resourceTitle || 'Resource'}\n${chunk.content}`).join('\n\n');
  const userPrompt = `Student question:\n${question}\n\nAnswer format to use:\n${answerFormat}\n\nCourse excerpts:\n${excerpts || '[No relevant readable excerpts were retrieved.]'}\n\nWrite the final answer now. If the excerpts are not relevant to the question, do not use the requested sections; instead give only the not-covered message.`;
  return { systemInstruction, userPrompt };
}

module.exports = { buildPrompt };
