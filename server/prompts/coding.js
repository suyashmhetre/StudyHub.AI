module.exports = function codingTemplate() {
  return `Task type: CODING / ALGORITHM.

Use this exact Markdown structure:
# <Problem title>
## Direct answer
<Explain the approach in 2–4 sentences.>
## Algorithm
1. <Step>
2. <Step>
## Code
\`\`\`text
<Provide code only if the provided excerpts contain enough implementation detail. Otherwise say that code is not available in the uploaded resources.>
\`\`\`
## Complexity
- Time: <value or unavailable>
- Space: <value or unavailable>
## Example
<A short input/output or use case supported by the excerpts.>`;
};
