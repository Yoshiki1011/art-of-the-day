const fs = require('fs/promises');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env') });

const MET_BASE = 'https://collectionapi.metmuseum.org/public/collection/v1';
const MANYAIPROXY_BASE_URL = process.env.MANYAIPROXY_BASE_URL || 'https://manyaiproxy.kazuhiro-ogura-dev.prototypers.net';
const DEEPL_ENDPOINT = 'https://manyaiproxy.kazuhiro-ogura-dev.prototypers.net/proxy/deepl/v2/translate';
const OPENAI_ENDPOINT = `${MANYAIPROXY_BASE_URL}/proxy/openai/v1/chat/completions`;
const DEEPL_TOKEN = process.env.MANYAIPROXY_DEEPL_TOKEN;
const OPENAI_TOKEN = process.env.MANYAIPROXY_OPENAI_TOKEN;
const SUMMARY_MODEL = process.env.ART_OF_THE_DAY_SUMMARY_MODEL || 'gpt-4.1-mini';
const TARGET_COUNT = 365;
const DELAY_MS = 300;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shuffle(array) {
  const result = [...array];

  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildContextLabel(detail) {
  return [
    cleanText(detail.classification),
    cleanText(detail.objectName),
    cleanText(detail.culture),
    cleanText(detail.period),
    cleanText(detail.reign),
    cleanText(detail.artistNationality),
  ].filter(Boolean).join(' / ');
}

function buildEnglishMetadata(detail) {
  return {
    title: cleanText(detail.title),
    artist: cleanText(detail.artistDisplayName),
    artistBio: cleanText(detail.artistDisplayBio),
    date: cleanText(detail.objectDate),
    medium: cleanText(detail.medium),
    dimensions: cleanText(detail.dimensions),
    classification: cleanText(detail.classification),
    objectName: cleanText(detail.objectName),
    culture: cleanText(detail.culture),
    period: cleanText(detail.period),
    reign: cleanText(detail.reign),
    department: cleanText(detail.department),
    creditLine: cleanText(detail.creditLine),
    repository: cleanText(detail.repository),
    primaryImageSmall: cleanText(detail.primaryImageSmall),
    tags: Array.isArray(detail.tags) ? detail.tags.slice(0, 8).map((tag) => cleanText(tag.term)).filter(Boolean) : [],
    objectDescription: cleanText(detail.objectDescription),
  };
}

function parseArgs(argv) {
  const options = {
    limit: TARGET_COUNT,
    output: path.join(__dirname, 'translations.json'),
    useAi: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--limit') {
      const value = Number.parseInt(argv[index + 1], 10);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error('Invalid value for --limit.');
      }
      options.limit = value;
      index += 1;
      continue;
    }

    if (arg === '--output') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('Missing value for --output.');
      }
      options.output = path.resolve(process.cwd(), value);
      index += 1;
      continue;
    }

    if (arg === '--no-ai') {
      options.useAi = false;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

async function fetchJson(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function translateTexts(texts) {
  if (!DEEPL_TOKEN) {
    throw new Error('MANYAIPROXY_DEEPL_TOKEN is not set.');
  }

  const validTexts = texts.map((text) => text || '');
  const response = await fetch(DEEPL_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `DeepL-Auth-Key ${DEEPL_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: validTexts,
      target_lang: 'JA',
      source_lang: 'EN',
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`DeepL translation failed: ${response.status} ${body}`);
  }

  const data = await response.json();

  if (!Array.isArray(data.translations)) {
    throw new Error('DeepL translation response was missing translations.');
  }

  return data.translations.map((item) => item.text || '');
}

function buildFallbackDescription(detail, translated) {
  const title = translated.titleJa || cleanText(detail.title) || 'この作品';
  const artist = translated.artistJa || cleanText(detail.artistDisplayName) || '作者不詳';
  const date = cleanText(detail.objectDate) || '制作年不詳';
  const medium = translated.mediumJa || cleanText(detail.medium) || '素材不詳';
  const department = cleanText(detail.department) || '収蔵部門';
  const artistBio = translated.artistBioJa;
  const contextJa = translated.contextJa;
  const seed = translated.descriptionSeedJa;

  const sentences = [
    `《${title}》は、${artist}による${date}頃の作品です。${medium}で制作され、メトロポリタン美術館の${department}部門で公開されています。`,
  ];

  if (artistBio) {
    sentences.push(`作者については、${artistBio}と紹介されています。`);
  } else if (contextJa) {
    sentences.push(`作品は${contextJa}に位置づけられます。`);
  }

  if (seed) {
    sentences.push(seed);
  } else if (cleanText(detail.dimensions)) {
    sentences.push(`作品寸法は${cleanText(detail.dimensions)}です。`);
  }

  return sentences.join(' ').replace(/\s+/g, ' ').trim();
}

function isRichEnough(text) {
  return cleanText(text).length >= 60;
}

async function generateDescriptionJa(detail, translated, options) {
  if (!options.useAi || !OPENAI_TOKEN) {
    return buildFallbackDescription(detail, translated);
  }

  const metadata = buildEnglishMetadata(detail);
  const response = await fetch(OPENAI_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: SUMMARY_MODEL,
      temperature: 0.7,
      messages: [
        {
          role: 'system',
          content: [
            {
              type: 'text',
              text: [
                'You are a museum guide writing concise Japanese descriptions for public-domain artworks.',
                'Write 2 or 3 natural sentences in Japanese.',
                'Mention what kind of work it is, one visual or thematic point, and a short historical/contextual note when possible.',
                'Do not use bullet points, markdown, or headings.',
                'If the metadata is sparse, still write a smooth description and avoid saying that information is insufficient.',
              ].join(' '),
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  metadata,
                  japaneseHints: {
                    titleJa: translated.titleJa,
                    artistJa: translated.artistJa,
                    mediumJa: translated.mediumJa,
                    descriptionSeedJa: translated.descriptionSeedJa,
                    artistBioJa: translated.artistBioJa,
                    contextJa: translated.contextJa,
                  },
                },
                null,
                2
              ),
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI description generation failed: ${response.status} ${body}`);
  }

  const data = await response.json();
  const text = cleanText(data?.choices?.[0]?.message?.content);

  if (!isRichEnough(text)) {
    return buildFallbackDescription(detail, translated);
  }

  return text;
}

async function buildArtwork(detail, options) {
  const descriptionSource =
    cleanText(detail.objectDescription) ||
    cleanText(detail.creditLine);
  const contextLabel = buildContextLabel(detail);

  console.log(`Translating: "${cleanText(detail.title)}"...`);
  const [
    titleJa,
    artistJa,
    mediumJa,
    descriptionSeedJa,
    artistBioJa,
    contextJa,
  ] = await translateTexts([
    cleanText(detail.title),
    cleanText(detail.artistDisplayName),
    cleanText(detail.medium),
    descriptionSource,
    cleanText(detail.artistDisplayBio),
    contextLabel,
  ]);

  const translated = {
    titleJa: cleanText(titleJa) || cleanText(detail.title),
    artistJa: cleanText(artistJa) || cleanText(detail.artistDisplayName) || '作者不詳',
    mediumJa: cleanText(mediumJa) || cleanText(detail.medium),
    descriptionSeedJa: cleanText(descriptionSeedJa),
    artistBioJa: cleanText(artistBioJa),
    contextJa: cleanText(contextJa),
  };

  let descriptionJa = '';

  try {
    descriptionJa = await generateDescriptionJa(detail, translated, options);
  } catch (error) {
    console.warn(`Description fallback for ${detail.objectID}: ${error.message}`);
    descriptionJa = buildFallbackDescription(detail, translated);
  }

  return {
    titleEn: cleanText(detail.title),
    titleJa: translated.titleJa,
    artist: cleanText(detail.artistDisplayName) || 'Unknown artist',
    artistJa: translated.artistJa,
    date: cleanText(detail.objectDate),
    medium: cleanText(detail.medium),
    mediumJa: translated.mediumJa,
    department: cleanText(detail.department),
    imageSmall: cleanText(detail.primaryImageSmall),
    image: cleanText(detail.primaryImage),
    descriptionJa: cleanText(descriptionJa) || buildFallbackDescription(detail, translated),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!DEEPL_TOKEN) {
    throw new Error('MANYAIPROXY_DEEPL_TOKEN is not configured. Add it to the root or local .env file.');
  }

  if (!OPENAI_TOKEN && options.useAi) {
    console.warn('MANYAIPROXY_OPENAI_TOKEN is not configured. Falling back to template-based descriptions.');
    options.useAi = false;
  }

  console.log('Fetching highlight object list from the Met...');
  const list = await fetchJson(
    `${MET_BASE}/objects?isHighlight=true&hasImages=true&isPublicDomain=true&departmentIds=11`
  );

  if (!Array.isArray(list.objectIDs) || list.objectIDs.length === 0) {
    throw new Error('Met API returned no object IDs.');
  }

  const shuffledIds = shuffle(list.objectIDs);
  const objectIds = [];
  const artworks = {};

  for (const objectId of shuffledIds) {
    if (objectIds.length >= options.limit) {
      break;
    }

    const progress = objectIds.length + 1;

    try {
      console.log(`[${progress}/${options.limit}] Fetching objectId ${objectId}...`);
      const detail = await fetchJson(`${MET_BASE}/objects/${objectId}`);
      const hasImage = Boolean(detail.primaryImageSmall || detail.primaryImage);

      if (!detail.isPublicDomain || !hasImage) {
        continue;
      }

      artworks[String(detail.objectID)] = await buildArtwork(detail, options);
      objectIds.push(detail.objectID);
    } catch (error) {
      console.warn(`Skipping objectId ${objectId}: ${error.message}`);
    }

    await delay(DELAY_MS);
  }

  if (objectIds.length === 0) {
    throw new Error('No artworks were collected. Check the tokens and network access, then try again.');
  }

  if (objectIds.length < options.limit) {
    console.warn(`Collected ${objectIds.length} artworks, fewer than the target ${options.limit}.`);
  }

  const payload = {
    generated: new Date().toISOString().slice(0, 10),
    objectIds,
    artworks,
  };

  await fs.writeFile(options.output, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`Done! ${path.basename(options.output)} written (${objectIds.length} artworks)`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
