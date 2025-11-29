import { readFile, writeFile } from "fs/promises";
import { createHash } from "crypto";
import { config } from "dotenv";
import * as path from "path";

// Load environment variables
config();

interface YouTubeMetadata {
  videoId: string;
  datetime: number;
  userId: string | null;
}

interface IdMap {
  [filename: string]: Array<[string | null, string]>;
}

interface FileConfig {
  path: string;
  filename: string;
}

/**
 * Creates a hash of the input string using SHA-256 with salt
 */
const hashWithSalt = (input: string, salt: string): string => {
  const hash = createHash("sha256");
  hash.update(input + salt);
  return hash.digest("hex");
};

/**
 * Replaces userIds with mapped values from id_map.json using the new tuple format
 */
const replaceUserIds = (
  data: YouTubeMetadata[],
  filename: string,
  idMap: IdMap,
): YouTubeMetadata[] => {
  const mappings = idMap[filename];

  if (!mappings) {
    console.warn(
      `⚠️  No mapping found for ${filename}, keeping original userIds`,
    );
    return data;
  }

  // Create a map from original IDs to mapped IDs
  const mappingMap = new Map<string | null, string>();
  mappings.forEach(([originalId, mappedId]) => {
    mappingMap.set(originalId, mappedId);
  });

  return data.map((item) => {
    const mappedId = mappingMap.get(item.userId);
    return {
      ...item,
      userId: mappedId || item.userId,
    };
  });
};

/**
 * Anonymizes user IDs in YouTube metadata by replacing them with hashed values
 */
const anonymizeMetadata = (
  data: YouTubeMetadata[],
  salt: string,
): YouTubeMetadata[] =>
  data.map((item) => ({
    ...item,
    userId: item.userId ? hashWithSalt(item.userId, salt) : null,
  }));

/**
 * Deduplicates entries based on videoId and userId combination
 * When duplicates are found, keeps the entry with the earlier datetime
 */
const deduplicateEntries = (data: YouTubeMetadata[]): YouTubeMetadata[] => {
  const deduplicated = Array.from(
    data
      .reduce((map, entry) => {
        const key = `${entry.videoId}:${entry.userId}:${entry.datetime}`;
        const existing = map.get(key);
        return map.set(key, !existing ? entry : existing);
      }, new Map<string, YouTubeMetadata>())
      .values(),
  );

  const duplicatesCount = data.length - deduplicated.length;
  console.log(`🔄 Deduplication: ${duplicatesCount} duplicates removed`);
  console.log(`   Before: ${data.length} entries`);
  console.log(`   After: ${deduplicated.length} entries`);

  return deduplicated;
};

/**
 * Sorts entries chronologically by datetime
 */
const sortByDatetime = (data: YouTubeMetadata[]): YouTubeMetadata[] =>
  [...data].sort((a, b) => a.datetime - b.datetime);

/**
 * Filters out entries with null userIds
 */
const filterValidUserIds = (data: YouTubeMetadata[]): YouTubeMetadata[] =>
  data.filter((item) => item.userId !== null);

/**
 * Reads and processes a metadata file with ID mapping
 */
const processMetadataFile = async (
  fileConfig: FileConfig,
  idMap: IdMap,
): Promise<YouTubeMetadata[]> => {
  try {
    console.log(`Reading ${fileConfig.filename}...`);
    const fileContent = await readFile(fileConfig.path, "utf-8");
    const data: YouTubeMetadata[] = JSON.parse(fileContent);

    const dataWithMappedIds = replaceUserIds(data, fileConfig.filename, idMap);

    console.log(`✅ Processed ${fileConfig.filename}: ${data.length} entries`);
    return dataWithMappedIds;
  } catch (error) {
    console.error(`❌ Error reading ${fileConfig.filename}:`, error);
    throw error;
  }
};

/**
 * Processes all metadata files and returns combined data
 */
const processAllFiles = async (
  files: FileConfig[],
  idMap: IdMap,
): Promise<YouTubeMetadata[]> => {
  const filePromises = files.map((file) => processMetadataFile(file, idMap));
  const fileResults = await Promise.all(filePromises);
  return fileResults.flat();
};

/**
 * Creates the data processing pipeline
 */
const createProcessingPipeline =
  (salt: string) => (data: YouTubeMetadata[]) => {
    const pipeline = [
      deduplicateEntries,
      sortByDatetime,
      (data: YouTubeMetadata[]) => anonymizeMetadata(data, salt),
      filterValidUserIds,
    ];

    return pipeline.reduce((result, fn) => fn(result), data);
  };

/**
 * Writes processed data to output file
 */
const writeOutputFile = async (
  data: YouTubeMetadata[],
  outputPath: string,
  originalCount: number,
): Promise<void> => {
  await writeFile(outputPath, JSON.stringify(data, null, 2), "utf-8");

  console.log(`✅ Created fused anonymized file: ${outputPath}`);
  console.log(`   Original total entries: ${originalCount}`);
  console.log(`   Valid anonymized entries: ${data.length}`);
  console.log(
    `   Entries with null userIds (excluded): ${originalCount - data.length}`,
  );
};

/**
 * Main function to fuse and anonymize YouTube metadata files
 */
const main = async (): Promise<void> => {
  const salt = process.env.SALT;

  if (!salt) {
    console.error("❌ Error: SALT environment variable is not set");
    console.error("Please make sure your .env file contains a SALT value");
    process.exit(1);
  }

  console.log("🔐 Starting metadata fusion and anonymization process...");
  console.log(
    `   Using salt: ${salt.substring(0, 8)}... (truncated for security)`,
  );

  const dataDir = path.join(process.cwd(), "data");
  const idMapPath = path.join(dataDir, "id_map.json");

  try {
    // Read the ID map
    console.log("📖 Reading ID mapping...");
    const idMapContent = await readFile(idMapPath, "utf-8");
    const idMap: IdMap = JSON.parse(idMapContent);
    console.log("✅ ID map loaded successfully");

    // Define input files
    const files: FileConfig[] = [
      {
        path: path.join(dataDir, "youtube_links_metadata.json"),
        filename: "youtube_links_metadata.json",
      },
      {
        path: path.join(dataDir, "youtube_links_metadata_legacy.json"),
        filename: "youtube_links_metadata_legacy.json",
      },
      {
        path: path.join(dataDir, "youtube_links_metadata_whatsapp.json"),
        filename: "youtube_links_metadata_whatsapp.json",
      },
    ];

    // Process all files and create processing pipeline
    const allData = await processAllFiles(files, idMap);
    console.log(`\n📊 Total entries before processing: ${allData.length}`);

    const processData = createProcessingPipeline(salt);
    const processedData = processData(allData);

    // Write the result
    const outputPath = path.join(dataDir, "anonymized-metadata.json");
    await writeOutputFile(processedData, outputPath, allData.length);

    console.log("\n🎉 Fusion and anonymization completed successfully!");
  } catch (error) {
    console.error("\n❌ Process failed:", error);
    process.exit(1);
  }
};

// Run the script if executed directly
const isMainModule =
  process.argv[1]?.endsWith("anonymize.ts") ||
  process.argv[1]?.endsWith("anonymize.js");

if (isMainModule) {
  main().catch(console.error);
}

export { anonymizeMetadata, hashWithSalt, deduplicateEntries };
