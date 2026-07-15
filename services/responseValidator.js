function ensureString(value) { return value == null ? '' : String(value); }

function validate(schemaType, parsed) {
  // Basic validation - ensure object and type
  if (!parsed || typeof parsed !== 'object') return { valid: false, error: 'Response is not a JSON object.' };
  if (!parsed.type) parsed.type = schemaType || 'answer';
  // Provide defaults for common fields
  if (!parsed.title) parsed.title = ensureString(parsed.title) || 'Untitled';
  if (!parsed.keyTakeaways && parsed.keyTakeaways !== undefined) parsed.keyTakeaways = parsed.keyTakeaways || [];
  return { valid: true, parsed };
}

module.exports = { validate };
