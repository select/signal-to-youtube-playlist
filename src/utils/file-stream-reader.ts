import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

export interface StreamReaderOptions {
  encoding?: BufferEncoding;
  chunkSize?: number;
  startLine?: number;
  maxLines?: number;
}

export interface LineProcessorCallback<T> {
  (line: string, lineNumber: number): T | null;
}

/**
 * Reads a file line by line and processes each line with a callback
 * @param filePath Path to the file to read
 * @param processor Callback function to process each line
 * @param options Optional configuration for reading
 * @returns Promise that resolves to array of processed results
 */
export const processFileByLines = async <T>(
  filePath: string,
  processor: LineProcessorCallback<T>,
  options: StreamReaderOptions = {},
): Promise<T[]> => {
  const {
    encoding = "utf8",
    startLine = 1,
    maxLines,
  } = options;

  const results: T[] = [];
  let currentLine = 0;
  let processedLines = 0;

  const fileStream = createReadStream(filePath, { encoding });
  const rl = createInterface({
    input: fileStream,
    crlfDelay: Infinity, // Handle Windows line endings
  });

  return new Promise((resolve, reject) => {
    rl.on("line", (line) => {
      currentLine++;

      // Skip lines before startLine
      if (currentLine < startLine) {
        return;
      }

      // Stop if we've reached maxLines
      if (maxLines && processedLines >= maxLines) {
        rl.close();
        return;
      }

      try {
        const result = processor(line, currentLine);
        if (result !== null) {
          results.push(result);
        }
        processedLines++;
      } catch (error) {
        rl.close();
        reject(new Error(`Error processing line ${currentLine}: ${error}`));
        return;
      }
    });

    rl.on("close", () => {
      resolve(results);
    });

    rl.on("error", (error) => {
      reject(new Error(`Error reading file: ${error}`));
    });
  });
};

/**
 * Reads a specific range of lines from a file
 * @param filePath Path to the file to read
 * @param startLine Line number to start reading from (1-based)
 * @param endLine Line number to stop reading at (1-based, inclusive)
 * @returns Promise that resolves to array of lines
 */
export const readFileLines = async (
  filePath: string,
  startLine: number = 1,
  endLine?: number,
): Promise<string[]> => {
  const maxLines = endLine ? endLine - startLine + 1 : undefined;

  return processFileByLines(
    filePath,
    (line) => line,
    { startLine, maxLines },
  );
};

/**
 * Counts the total number of lines in a file efficiently
 * @param filePath Path to the file to count
 * @returns Promise that resolves to the number of lines
 */
export const countFileLines = async (filePath: string): Promise<number> => {
  let lineCount = 0;

  const fileStream = createReadStream(filePath);
  const rl = createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  return new Promise((resolve, reject) => {
    rl.on("line", () => {
      lineCount++;
    });

    rl.on("close", () => {
      resolve(lineCount);
    });

    rl.on("error", (error) => {
      reject(new Error(`Error counting lines: ${error}`));
    });
  });
};

/**
 * Reads file in batches and processes each batch
 * @param filePath Path to the file to read
 * @param batchProcessor Function to process each batch of lines
 * @param batchSize Number of lines per batch
 * @returns Promise that resolves when all batches are processed
 */
export const procesFileInBatches = async <T>(
  filePath: string,
  batchProcessor: (batch: string[], batchNumber: number) => Promise<T[]> | T[],
  batchSize: number = 1000,
): Promise<T[]> => {
  const allResults: T[] = [];
  let currentBatch: string[] = [];
  let batchNumber = 0;

  const fileStream = createReadStream(filePath, { encoding: "utf8" });
  const rl = createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  return new Promise((resolve, reject) => {
    const processBatch = async () => {
      if (currentBatch.length === 0) return;

      try {
        const results = await batchProcessor(currentBatch, batchNumber);
        allResults.push(...results);
        currentBatch = [];
        batchNumber++;
      } catch (error) {
        rl.close();
        reject(new Error(`Error processing batch ${batchNumber}: ${error}`));
      }
    };

    rl.on("line", async (line) => {
      currentBatch.push(line);

      if (currentBatch.length >= batchSize) {
        rl.pause();
        await processBatch();
        rl.resume();
      }
    });

    rl.on("close", async () => {
      try {
        await processBatch(); // Process remaining lines
        resolve(allResults);
      } catch (error) {
        reject(error);
      }
    });

    rl.on("error", (error) => {
      reject(new Error(`Error reading file: ${error}`));
    });
  });
};
