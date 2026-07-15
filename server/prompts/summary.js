module.exports = function summaryTemplate() {
  return `Task type: SUMMARY.

Use this exact Markdown structure:
# <Topic summary>
## Overview
<A concise 2–3 sentence summary.>
## Key points
- <5–8 revision facts with citations>
## Example or application
<One short context-supported example, or state that it is unavailable.>
## What to revise next
1. <Specific revision action>
2. <Specific revision action>`;
};
