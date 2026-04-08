import { db } from '../../db/connection.js';
import { library, researchLog } from '../../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { LLM } from '../../llm/llm.js';
import { generateEmbedding } from '../../llm/embeddings.js';
import { embeddings } from '../../db/schema.js';

const CATALOGUE_PROMPT = `Du er en bibliotekar/katalogiserer for et bibelforskning-system. Klassifiser dette materialet.

Tittel: {{title}}
Type: {{contentType}}
Innhold (forkortet):
{{content}}

Katalogiser materialet:
1. Skriv et kort sammendrag (2-3 setninger)
2. Sett tags (nøkkelord for søk)
3. Identifiser relevante temaer (bibelske konsepter, personer, steder)
4. Hvilke forskningsmetoder er dette relevant for?
5. Hvilke bibelbøker berøres?
6. Vurder kvalitet (1-5): Er dette pålitelig akademisk materiale?
7. Er dette fagfellevurdert? (yes/no/unknown)
8. Kildetroverdighet: academic (universitet/journal), encyclopedia (oppslagsverk), popular (populærvitenskap), blog, unknown
9. Forfatter og publiseringsår (om mulig å identifisere)

Bibelbøker som tall: 1=Genesis, 2=Exodus, ..., 19=Salmene, 23=Jesaja, ..., 40=Matteus, 43=Johannes, etc.

Svar med JSON:
\`\`\`json
{
  "summary": "kort sammendrag",
  "tags": ["tag1", "tag2"],
  "topics": ["hesed", "paktstroskap"],
  "relevantMethods": ["hermeneutics", "textual-criticism"],
  "relevantBooks": [1, 19],
  "qualityScore": 4,
  "language": "no",
  "peerReviewed": "yes|no|unknown",
  "sourceCredibility": "academic|encyclopedia|popular|blog|unknown",
  "author": "forfatter eller null",
  "publicationYear": 2020
}
\`\`\``;

interface CatalogueResult {
  summary: string;
  tags: string[];
  topics: string[];
  relevantMethods: string[];
  relevantBooks: number[];
  qualityScore: number;
  language: string;
  peerReviewed: string;
  sourceCredibility: string;
  author: string | null;
  publicationYear: number | null;
}

export class Cataloguer {
  private llm: LLM;

  constructor(llm: LLM) {
    this.llm = llm;
  }

  async catalogueNew(): Promise<number> {
    let totalCount = 0;

    // Keep going until all raw materials are catalogued
    while (true) {
      const raw = await db
        .select()
        .from(library)
        .where(eq(library.status, 'raw'))
        .limit(3);

      if (raw.length === 0) break;

      for (const item of raw) {
      try {
        const prompt = LLM.formatPrompt(CATALOGUE_PROMPT, {
          title: item.title,
          contentType: item.contentType,
          content: item.content.slice(0, 3000), // Truncate for prompt
        });

        const response = await this.llm.callJSON<CatalogueResult>(prompt);
        const cat = response.data;

        await db.update(library)
          .set({
            summary: cat.summary,
            tags: cat.tags,
            topics: cat.topics,
            relevantMethods: cat.relevantMethods,
            relevantBooks: cat.relevantBooks,
            qualityScore: cat.qualityScore,
            peerReviewed: cat.peerReviewed ?? 'unknown',
            sourceCredibility: cat.sourceCredibility ?? 'unknown',
            author: cat.author ?? null,
            publicationYear: cat.publicationYear ?? null,
            language: cat.language,
            status: 'catalogued',
            cataloguedAt: new Date(),
          })
          .where(eq(library.id, item.id));

        // Generate embedding for the material
        try {
          const textForEmbedding = `${item.title}\n${cat.summary}\n${cat.tags.join(', ')}\n${cat.topics.join(', ')}`;
          const vector = await generateEmbedding(textForEmbedding);
          await db.insert(embeddings).values({
            sourceType: 'library',
            sourceId: item.id,
            content: textForEmbedding,
            embedding: vector,
          });

          await db.update(library)
            .set({ status: 'embedded' })
            .where(eq(library.id, item.id));
        } catch {
          // Ollama might not be running
        }

        totalCount++;
      } catch (e) {
        console.error(`Cataloguing failed for ${item.id}:`, e instanceof Error ? e.message : e);
      }
    }

      // Log each batch
      if (totalCount > 0 && totalCount % 3 === 0) {
        await db.insert(researchLog).values({
          eventType: 'catalogue_complete',
          agentType: 'cataloguer',
          details: { cataloguedSoFar: totalCount },
        });
      }
    } // end while

    if (totalCount > 0) {
      await db.insert(researchLog).values({
        eventType: 'catalogue_complete',
        agentType: 'cataloguer',
        details: { catalogued: totalCount },
      });
      console.log(`Cataloguer: catalogued ${totalCount} materials total.`);
    }

    return totalCount;
  }
}
