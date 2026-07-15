const KEYWORDS = {
  theory: ['explain', 'what is', 'define', 'definition', 'theory', 'concept'],
  coding: ['code', 'implement', 'program', 'write a', 'algorithm', 'function', 'solve'],
  comparison: ['difference', 'vs', 'compare', 'compare with', 'difference between'],
  numerical: ['calculate', 'compute', 'solve', 'evaluate'],
  viva: ['short answer', 'viva', 'what is the', 'one-line'],
  assignment: ['assignment', 'task', 'project', 'homework'],
  summary: ['summarize', 'summary', 'summarise', 'key points', 'recap'],
  mcq: ['mcq', 'multiple choice', 'choose the correct']
};

function classify(question) {
  const q = String(question || '').toLowerCase();
  for (const [type, kws] of Object.entries(KEYWORDS)) {
    for (const kw of kws) if (q.includes(kw)) return type === 'mcq' ? 'quiz' : type;
  }
  // default to theory
  return 'theory';
}

module.exports = { classify };
