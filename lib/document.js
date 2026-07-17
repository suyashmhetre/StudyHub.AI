const JSZip = require('jszip');
const mammoth = require('mammoth');

function decodeEntities(value) {
  return value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function normalizeText(value) {
  return String(value || '').replace(/\u0000/g, '').replace(/[ \t]+/g, ' ').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

async function extractPdfText(buffer) {
    const pdf = require("pdf-parse");

    const result = await pdf(buffer);

    return normalizeText(result.text);
}

async function extractPptxText(buffer) {
  const archive = await JSZip.loadAsync(buffer);
  const slideNames = Object.keys(archive.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((left, right) => Number(left.match(/\d+/)?.[0]) - Number(right.match(/\d+/)?.[0]));
  const slides = await Promise.all(slideNames.map(async (name) => {
    const xml = await archive.file(name).async('text');
    return [...xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map((match) => decodeEntities(match[1])).join(' ');
  }));
  return normalizeText(slides.join('\n\n'));
}

async function extractText({ buffer, mimeType, fileName }) {
  const extension = String(fileName).split('.').pop().toLowerCase();
  if (mimeType === 'application/pdf' || extension === 'pdf') return extractPdfText(buffer);
  if (extension === 'docx' || mimeType.includes('wordprocessingml')) return normalizeText((await mammoth.extractRawText({ buffer })).value);
  if (extension === 'pptx' || mimeType.includes('presentationml')) return extractPptxText(buffer);
  if (['txt', 'md', 'markdown', 'csv'].includes(extension) || mimeType.startsWith('text/')) return normalizeText(buffer.toString('utf8'));
  throw new Error('StudyHub can index PDF, DOCX, PPTX, TXT, Markdown, and CSV files.');
}

function chunkText(text, { maxChars = 1100, overlap = 150 } = {}) {
  const paragraphs = normalizeText(text).split(/\n{2,}/).filter(Boolean);
  const chunks = []; let current = '';
  for (const paragraph of paragraphs) {
    if ((current + '\n\n' + paragraph).length <= maxChars) { current = current ? `${current}\n\n${paragraph}` : paragraph; continue; }
    if (current) chunks.push(current);
    if (paragraph.length <= maxChars) current = paragraph;
    else { for (let start = 0; start < paragraph.length; start += maxChars - overlap) { chunks.push(paragraph.slice(start, start + maxChars)); } current = ''; }
  }
  if (current) chunks.push(current);
  return chunks.slice(0, 500);
}

module.exports = { extractText, chunkText, normalizeText };
