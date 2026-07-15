function uniqueSources(chunks) {
  const seen = new Set();
  return chunks.filter((chunk) => !seen.has(chunk.resourceId) && seen.add(chunk.resourceId)).map((chunk) => ({ id: chunk.resourceId, title: chunk.resourceTitle || 'Group resource' })).slice(0, 4);
}

function terms(text) { return String(text || '').toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) || []; }

function fallback(action, question, chunks) {
  const sources = uniqueSources(chunks);
  if (!chunks.length) return { type: 'answer', sources: [], answer: '# No indexed material found\n\n## What to do next\nUpload a supported file and wait for it to show as **Indexed** before asking StudyBot a question.' };
  const excerpt = String(chunks[0].content || '').replace(/\s+/g, ' ').trim().slice(0, 900);
  const topic = [...new Set(terms(question))].slice(0, 4).join(', ') || 'this topic';
  if (action === 'flashcards') return { type: 'flashcards', sources, flashcards: chunks.slice(0, 5).map((chunk, index) => ({ front: `What does the resource say about ${terms(question)[index] || 'this concept'}?`, back: chunk.content.slice(0, 280) })) };
  if (action === 'quiz') return { type: 'quiz', sources, quiz: chunks.slice(0, 3).map((chunk, index) => ({ question: `Based on source ${index + 1}, which statement is correct?`, options: [String(chunk.content).replace(/\s+/g, ' ').slice(0, 160), 'This idea is not supported by the source.', 'This statement contradicts the source.', 'This is a different topic than the source covers.'], answer: 0 })) };
  if (action === 'plan') return { type: 'plan', sources, plan: [{ label: '25 min • Understand', detail: `Read the excerpts about ${topic} and write three recall questions.` }, { label: '20 min • Recall', detail: 'Answer your questions without looking at the resources, then correct gaps.' }, { label: '15 min • Retain', detail: 'Create flashcards from the details you missed and revisit them tomorrow.' }] };
  return { type: 'answer', sources, answer: `# Study response\n\n## Direct answer\n${excerpt}\n\n## Key points\n- Review the definition, conditions, and example in the source.\n- Test yourself by explaining **${topic}** without looking at the notes.\n\n## Sources used\n- [1] ${sources[0]?.title || 'Group resource'}` };
}

function isMetaResponse(value) {
  const text = String(value || '').toLowerCase();
  return text.length < 45 || /refining and formatting|review against writing rules|polished markdown only|hidden reasoning|requested heading structure|output schema|return raw json/.test(text);
}

function cleanAnswer(value) {
  return String(value || '')
    .replace(/^\s*```markdown\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .replace(/^\s*\[\d+\]\.?\s*(?=#)/, '')
    .trim();
}

async function callGemini(parts, config, systemInstruction) {
  if (!config.apiKey) return null;
  const apiKey = String(config.apiKey).trim();
  if (!apiKey) return null;
  const preferred = String(config.model || '').trim();
  const candidates = [...new Set([preferred, 'gemini-flash-latest', 'gemini-pro-latest'].filter(Boolean))];
  let lastError = null;
  for (const model of candidates) {
    try {
      const payload = { contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.2, maxOutputTokens: 1500 } };
      if (systemInstruction) payload.systemInstruction = { parts: [{ text: systemInstruction }] };
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { lastError = new Error(body?.error?.message || 'The AI provider could not complete this request.'); if (response.status === 404) continue; break; }
      return body.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim() || null;
    } catch (error) { lastError = error; }
  }
  throw lastError || new Error('The AI provider did not return a response.');
}

async function generateStudyAid({ action, question, chunks, config, pdfBuffer }) {
  const fallbackResult = fallback(action, question, chunks);
  const { buildPrompt } = require('../services/promptBuilder');
  const { classify } = require('../services/queryClassifier');
  const type = classify(question || '');
  const prompt = await buildPrompt({ question: question || 'Summarize the most important concepts in these resources.', type, contextChunks: chunks.slice(0, 8) });
  if (!prompt?.userPrompt) return fallbackResult;
  const parts = [{ text: prompt.userPrompt }];
  if (!chunks.length && pdfBuffer && pdfBuffer.length <= 8 * 1024 * 1024) parts.unshift({ inlineData: { mimeType: 'application/pdf', data: pdfBuffer.toString('base64') } });
  try {
    const answer = cleanAnswer(await callGemini(parts, config, prompt.systemInstruction));
    return answer && !isMetaResponse(answer) ? { type: 'answer', sources: fallbackResult.sources, answer } : fallbackResult;
  } catch (error) {
    console.error('Gemini response failed; returning an extractive study response.', error.message);
    return { ...fallbackResult, warning: error.message };
  }
}

module.exports = { generateStudyAid, fallback };
