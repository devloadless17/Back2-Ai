import 'server-only';

import { z } from 'zod';

import { ai } from '@/lib/ai';
import { isAiConfigured } from '@/lib/env';

/**
 * Reordering retrieved passages by reading them.
 *
 * The measurement this exists for: on questions students would actually ask,
 * the passage that answers the question is in the top twenty every time, and
 * ranked first only 29% of the time in Arabic against 54% in French. The
 * material is being found and mis-ordered. An embedding compares two texts as
 * wholes; whether a passage answers a question is a judgement about the
 * question, which is what a model can make and cosine cannot.
 *
 * Deliberately narrow:
 *
 *   It only reorders. It cannot introduce a passage the search did not return,
 *   and it cannot change any similarity score, so the retrieval tiers still
 *   decide whether to answer at all on the same numbers as before. A reranker
 *   that could admit material would be a second, unmeasured gate.
 *
 *   It sees openings, not whole passages. Three hundred characters is enough to
 *   judge relevance and keeps twenty candidates inside one small prompt.
 *
 *   It fails open. A timeout, a refusal or a malformed reply returns the
 *   original order rather than an error: a worse ordering is a worse answer, a
 *   thrown exception is no answer.
 */

const SNIPPET = 300;

const rankingSchema = z.object({ order: z.array(z.number()) });

const RANKING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['order'],
  properties: {
    order: { type: 'array', items: { type: 'number' } },
  },
} as const;

export type Rerankable = { contentText: string };

/**
 * Which model does the reading, and how hard it thinks.
 *
 * Exists so the choice can be MEASURED rather than assumed. The default — the
 * fast model at low effort — is what the Arabic-only policy in `retrieval.ts`
 * was measured against, and that policy exists because reranking as configured
 * HURT French (top-1 52% -> 39%). Whether that is reranking being wrong for
 * French or the cheap model being wrong for French is a different question, and
 * it is answerable: see `scripts/compare-rerank-models.ts`.
 *
 * It used to read `verifyModel` and call it "the cheap verify model", which was
 * true of the OpenAI config and false of the Anthropic one, where that name
 * points at Opus. `fastModel` defaults to the same gpt-5.4-mini the measurement
 * above was taken on, so the rename moves no number — but if you repoint
 * `*_MODEL_FAST`, the French and Arabic figures quoted here no longer describe
 * what is running, and that script is how you get new ones.
 */
export type RerankOptions = { model?: string; effort?: 'low' | 'medium' | 'high' };

export async function rerankByRelevance<T extends Rerankable>(
  query: string,
  hits: T[],
  keep: number,
  opts: RerankOptions = {},
): Promise<T[]> {
  if (hits.length <= 1 || !isAiConfigured()) return hits;

  try {
    const response = await ai().completeJson({
      system: [
        'You order retrieved passages by how directly each one answers the question.',
        '',
        'Return the passage numbers, best first. Include only passages that help answer the',
        'question; leave out ones that merely mention the topic. Never invent a number that is',
        'not in the list. Do not explain.',
        '',
        'A passage that defines or explains what is asked about ranks above one that sets an',
        'exercise on it, and above one that mentions it in passing.',
      ].join('\n'),
      messages: [
        {
          role: 'user',
          content: [
            `Question: ${query}`,
            '',
            ...hits.map((hit, index) => {
              const opening = hit.contentText.replace(/\s+/g, ' ').slice(0, SNIPPET);
              return `${index + 1}. ${opening}`;
            }),
          ].join('\n'),
        },
      ],
      schema: RANKING_SCHEMA as unknown as Record<string, unknown>,
      schemaName: 'passage_ranking',
      effort: opts.effort ?? 'low',
      maxTokens: 400,
      model: opts.model ?? ai().fastModel,
      parse: (value) => rankingSchema.parse(value),
    });

    const seen = new Set<number>();
    const ordered: T[] = [];
    for (const position of response.data.order) {
      const index = position - 1;
      if (index < 0 || index >= hits.length || seen.has(index)) continue;
      seen.add(index);
      ordered.push(hits[index]!);
      if (ordered.length >= keep) break;
    }

    // Anything the model left out keeps its original relative order behind the
    // passages it chose. Dropping them outright would let one bad ranking throw
    // away material that cleared the tier gate.
    for (const [index, hit] of hits.entries()) {
      if (ordered.length >= keep) break;
      if (!seen.has(index)) ordered.push(hit);
    }

    return ordered;
  } catch {
    return hits.slice(0, keep);
  }
}
