import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerGenerateDiscoveryQuestionsPrompt(server: McpServer) {
  server.prompt(
    'generate_discovery_questions',
    {
      idea: z.string().describe('The product idea you\'re testing'),
      target_user: z
        .string()
        .describe('Specific person with this pain — not a segment. e.g. "a PM at a 50-person B2B SaaS who runs 3 sprints at once"'),
      stage: z
        .enum(['cold_outreach', 'first_call', 'follow_up'])
        .optional()
        .default('first_call')
        .describe('What stage of the discovery conversation is this?'),
    },
    ({ idea, target_user, stage }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Generate customer discovery questions using the Jeff Weinstein (Stripe) framework. The goal is NOT to validate the idea — it's to understand the customer's actual world before you've decided what to build.

## The Idea (for context only — don't pitch it)
${idea}

## Target User
${target_user}

## Stage: ${stage}

## The Framework (Jeff Weinstein / Stripe)

**Core principle:** Don't pitch. Don't ask if they'd use your product. Ask about their world.

**The opening question:** "What would you be doing if you weren't talking to me right now?"
Then sit in silence. The answer tells you what their actual workday looks like, what's urgent, what they interrupted to talk to you.

**The burning problem test:** People don't get out of bed for their second problem. If what you're building solves their second problem, they'll never actually use it — they'll say they would, but they won't.

**The paying test:** "Willing to pay" ≠ paying. Practice charging someone $1. The moment money is on the table, the conversation gets honest. People who won't pay $1 definitely won't pay $10/month.

**The signal you're listening for:**
- Do they have language for this problem already? (People name problems that matter to them)
- How often do they encounter it? (Once a month = not a burning problem)
- What do they do today to solve it? (Every workaround is a business waiting to be built)
- Have they paid for a solution before? (Prior purchase = validated willingness to pay)

## Questions to Generate

### For ${stage === 'cold_outreach' ? 'Cold Outreach' : stage === 'first_call' ? 'First Call' : 'Follow-Up'}

Generate 8-10 questions. Do not generate softball questions. Every question should be designed to reveal something that would cause you to change or kill the idea.

**Format for each question:**
- The question itself
- What you're actually listening for (what answer validates vs. kills)
- A follow-up if they give a surface answer

## Anti-patterns to Avoid
- "Would you use a product that..." → leading question, always get yes
- "How much would you pay for..." → hypothetical, meaningless
- "What features would you want?" → you're the product person, not them
- "Does this resonate?" → fishing for validation
- Filling silence with your own pitch

## Output Format
OPENING QUESTION: [the one question to start with]

DISCOVERY QUESTIONS:
1. [Question] → Listening for: [X] → Follow-up: [Y]
2. ...

THE CLOSE (if stage is first_call):
"Before we wrap — is there anyone else I should talk to who has this problem even more acutely?"
(The best referrals come at the end of honest conversations, not from intros)

RED FLAGS TO LISTEN FOR:
- [Signals that would cause you to kill or pivot the idea]

GREEN FLAGS TO LISTEN FOR:
- [Signals that would cause you to move to the next stage]`,
          },
        },
      ],
    }),
  );
}
