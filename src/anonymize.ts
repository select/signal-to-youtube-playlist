import { readFile, writeFile } from "fs/promises";
import { createHash } from "crypto";
import { config } from "dotenv";
import * as path from "path";

// Load environment variables
config();

interface YouTubeMetadata {
  videoId: string;
  datetime: number;
  userId: string;
}

/**
 * Creates a hash of the input string using SHA-256 with salt
 */
function hashWithSalt(input: string, salt: string): string {
  const hash = createHash("sha256");
  hash.update(input + salt);
  return hash.digest("hex");
}

/**
 * Anonymizes user IDs in YouTube metadata by replacing them with hashed values
 */
function anonymizeMetadata(
  data: YouTubeMetadata[],
  salt: string,
): YouTubeMetadata[] {
  return data.map((item) => ({
    ...item,
    userId: hashWithSalt(item.userId, salt),
  }));
}

/**
 * Processes a single JSON file and creates an anonymized copy
 */
async function processFile(
  inputPath: string,
  outputPath: string,
  salt: string,
): Promise<void> {
  try {
    console.log(`Processing ${inputPath}...`);

    // Read the original file
    const fileContent = await readFile(inputPath, "utf-8");
    const data: YouTubeMetadata[] = JSON.parse(fileContent);

    // Anonymize the data
    const anonymizedData = anonymizeMetadata(data, salt);

    // Write the anonymized data to the output file
    await writeFile(
      outputPath,
      JSON.stringify(anonymizedData, null, 2),
      "utf-8",
    );

    console.log(`✅ Created anonymized file: ${outputPath}`);
    console.log(`   Original entries: ${data.length}`);
    console.log(`   Anonymized entries: ${anonymizedData.length}`);
  } catch (error) {
    console.error(`❌ Error processing ${inputPath}:`, error);
    throw error;
  }
}

/**
 * Main function to anonymize YouTube metadata files
 */
async function main(): Promise<void> {
  const salt = process.env.SALT;

  if (!salt) {
    console.error("❌ Error: SALT environment variable is not set");
    console.error("Please make sure your .env file contains a SALT value");
    process.exit(1);
  }

  console.log("🔐 Starting anonymization process...");
  console.log(
    `   Using salt: ${salt.substring(0, 8)}... (truncated for security)`,
  );

  const dataDir = path.join(process.cwd(), "data");
  const files = [
    {
      input: path.join(dataDir, "youtube_links_metadata.json"),
      output: path.join(dataDir, "youtube_links_metadata_anonymized.json"),
    },
    {
      input: path.join(dataDir, "youtube_links_metadata_1.json"),
      output: path.join(dataDir, "youtube_links_metadata_1_anonymized.json"),
    },
  ];

  try {
    for (const file of files) {
      await processFile(file.input, file.output, salt);
    }

    console.log("\n🎉 Anonymization completed successfully!");
    console.log("\nAnonymized files created:");
    files.forEach((file) => {
      console.log(`   • ${path.relative(process.cwd(), file.output)}`);
    });
  } catch (error) {
    console.error("\n❌ Anonymization failed:", error);
    process.exit(1);
  }
}

// Run the script if executed directly
// Check if this module is being run directly by comparing the resolved URL
const isMainModule =
  process.argv[1]?.endsWith("anonymize.ts") ||
  process.argv[1]?.endsWith("anonymize.js");
if (isMainModule) {
  main().catch(console.error);
}

export { anonymizeMetadata, hashWithSalt };
