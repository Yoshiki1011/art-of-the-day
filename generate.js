const fs = require('fs/promises');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env') });

const MET_BASE = 'https://collectionapi.metmuseum.org/public/collection/v1';
const TRANSLATION_API_URL = process.env.TRANSLATION_API_URL;
const TRANSLATION_API_KEY = process.env.TRANSLATION_API_KEY;
const TRANSLATION_API_AUTH_SCHEME = process.env.TRANSLATION_API_AUTH_SCHEME || 'DeepL-Auth-Key';
const LLM_API_URL = process.env.LLM_API_URL;
const LLM_API_KEY = process.env.LLM_API_KEY;
const LLM_API_AUTH_SCHEME = process.env.LLM_API_AUTH_SCHEME || 'Bearer';
const SUMMARY_MODEL = process.env.ART_OF_THE_DAY_SUMMARY_MODEL || process.env.LLM_MODEL || 'gpt-4.1-mini';
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
    mode: 'rebuild',
    batchSize: null,
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

    if (arg === '--target-count') {
      const value = Number.parseInt(argv[index + 1], 10);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error('Invalid value for --target-count.');
      }
      options.limit = value;
      options.mode = 'append';
      index += 1;
      continue;
    }

    if (arg === '--batch-size') {
      const value = Number.parseInt(argv[index + 1], 10);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error('Invalid value for --batch-size.');
      }
      options.batchSize = value;
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

async function loadExistingPayload(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const data = JSON.parse(raw);
    const objectIds = Array.isArray(data.objectIds) ? data.objectIds : [];
    const artworks = data && typeof data.artworks === 'object' && data.artworks ? data.artworks : {};

    return {
      generated: cleanText(data.generated),
      objectIds,
      artworks,
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }

    throw new Error(`Failed to read existing payload: ${error.message}`);
  }
}

async function fetchJson(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function translateTexts(texts) {
  if (!TRANSLATION_API_URL || !TRANSLATION_API_KEY) {
    throw new Error('TRANSLATION_API_URL or TRANSLATION_API_KEY is not set.');
  }

  const validTexts = texts.map((text) => text || '');
  const response = await fetch(TRANSLATION_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `${TRANSLATION_API_AUTH_SCHEME} ${TRANSLATION_API_KEY}`,
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
    throw new Error(`Translation API failed: ${response.status} ${body}`);
  }

  const data = await response.json();

  if (!Array.isArray(data.translations)) {
    throw new Error('Translation response was missing translations.');
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
  if (!options.useAi || !LLM_API_URL || !LLM_API_KEY) {
    return buildFallbackDescription(detail, translated);
  }

  const metadata = buildEnglishMetadata(detail);
  const response = await fetch(LLM_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `${LLM_API_AUTH_SCHEME} ${LLM_API_KEY}`,
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
    throw new Error(`LLM description generation failed: ${response.status} ${body}`);
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

  if (!TRANSLATION_API_URL || !TRANSLATION_API_KEY) {
    throw new Error('TRANSLATION_API_URL and TRANSLATION_API_KEY must be configured in .env.');
  }

  if ((!LLM_API_URL || !LLM_API_KEY) && options.useAi) {
    console.warn('LLM_API_URL or LLM_API_KEY is not configured. Falling back to template-based descriptions.');
    options.useAi = false;
  }

  const existingPayload = options.mode === 'append'
    ? await loadExistingPayload(options.output)
    : null;
  const existingObjectIds = existingPayload?.objectIds ?? [];
  const existingArtworks = existingPayload?.artworks ?? {};
  const existingIdSet = new Set(existingObjectIds.map((id) => Number(id)));

  if (options.mode === 'append') {
    console.log(`Loaded existing artworks: ${existingObjectIds.length}`);

    if (existingObjectIds.length >= options.limit) {
      console.log(`No generation needed. Existing file already has ${existingObjectIds.length} artworks.`);
      return;
    }
  }

  console.log('Fetching highlight object list from the Met...');
  const list = await fetchJson(
    `${MET_BASE}/objects?isHighlight=true&hasImages=true&isPublicDomain=true&departmentIds=11`
  );

  if (!Array.isArray(list.objectIDs) || list.objectIDs.length === 0) {
    throw new Error('Met API returned no object IDs.');
  }

  const shuffledIds = shuffle(list.objectIDs);
  const objectIds = [...existingObjectIds];
  const artworks = { ...existingArtworks };
  const remainingNeeded = Math.max(0, options.limit - existingObjectIds.length);
  const generateCount = options.mode === 'append' && options.batchSize
    ? Math.min(remainingNeeded, options.batchSize)
    : remainingNeeded;
  const finalTarget = existingObjectIds.length + generateCount;

  if (generateCount === 0) {
    console.log('No generation needed for this run.');
    return;
  }

  for (const objectId of shuffledIds) {
    if (objectIds.length >= finalTarget) {
      break;
    }

    const progress = objectIds.length + 1;

    try {
      if (existingIdSet.has(Number(objectId))) {
        continue;
      }

      console.log(`[${progress}/${finalTarget}] Fetching objectId ${objectId}...`);
      const detail = await fetchJson(`${MET_BASE}/objects/${objectId}`);
      const hasImage = Boolean(detail.primaryImageSmall || detail.primaryImage);

      if (!detail.isPublicDomain || !hasImage) {
        continue;
      }

      if (existingIdSet.has(Number(detail.objectID))) {
        continue;
      }

      artworks[String(detail.objectID)] = await buildArtwork(detail, options);
      objectIds.push(detail.objectID);
      existingIdSet.add(Number(detail.objectID));
    } catch (error) {
      console.warn(`Skipping objectId ${objectId}: ${error.message}`);
    }

    await delay(DELAY_MS);
  }

  if (objectIds.length === 0) {
    throw new Error('No artworks were collected. Check the tokens and network access, then try again.');
  }

  if (objectIds.length < finalTarget) {
    console.warn(`Collected ${objectIds.length} artworks, fewer than the target ${finalTarget}.`);
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
