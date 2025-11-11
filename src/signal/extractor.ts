import { join } from "node:path";
import { readFile } from "node:fs/promises";
import Database from "better-sqlite3-multiple-ciphers";
import { config } from "dotenv";

// Load environment variables from .env file
config();

interface Message {
  id: string;
  body: string;
  sent_at: number;
  timestamp: number;
  sourceServiceId: string | null;
  type: string;
}

interface Conversation {
  id: string;
}

export interface YouTubeLinkWithMetadata {
  videoId: string;
  datetime: number;
  userId: string | null;
}

interface SignalConfig {
  signalPath: string;
  groupName: string;
  youTubeRegexes: RegExp[];
}

interface DbConnection {
  db: Database.Database;
  config: SignalConfig;
}

// Configuration
const createSignalConfig = (): SignalConfig => ({
  signalPath: join(process.env.HOME!, process.env.SIGNAL_PATH!),
  groupName: process.env.SIGNAL_GROUP_NAME || "",
  youTubeRegexes: [
    /youtu\.be\/([\w-]+)/g,
    /youtube\.com\/watch\?.*v=([\w-]+)/g,
  ],
});

// Database initialization
const readSignalCredentials = async (signalPath: string) => {
  const configPath = join(signalPath, "config.json");
  const configText = await readFile(configPath, "utf-8");
  return JSON.parse(configText);
};

const openEncryptedDatabase = (
  dbPath: string,
  key: string,
): Database.Database => {
  console.log("dbPath", dbPath);
  const db = new Database(dbPath, { readonly: true });
  db.pragma("cipher='sqlcipher'");
  db.pragma("legacy=4");
  db.pragma(`key="x'${key}'"`);
  // db.pragma("journal_mode = WAL");
  return db;
};

export const initializeDatabase = async (): Promise<DbConnection> => {
  const config = createSignalConfig();

  if (!config.groupName) {
    throw new Error("SIGNAL_GROUP_NAME environment variable is required");
  }

  const credentials = await readSignalCredentials(config.signalPath);
  const dbPath = join(config.signalPath, "sql/db.sqlite");
  const db = openEncryptedDatabase(dbPath, credentials.key);

  return { db, config };
};

// Database queries
const findConversation = (
  db: Database.Database,
  groupName: string,
): Conversation => {
  const conversation = db
    .prepare(`SELECT id FROM conversations WHERE name=?`)
    .get(groupName) as Conversation | undefined;

  if (!conversation) {
    throw new Error(`Conversation '${groupName}' not found`);
  }

  return conversation;
};

const fetchMessages = (
  db: Database.Database,
  conversationId: string,
): Message[] =>
  db
    .prepare(
      `SELECT id, body, sent_at, timestamp, sourceServiceId, type FROM messages WHERE conversationId=? AND body IS NOT NULL AND body != 'NULL'`,
    )
    .all(conversationId) as Message[];

// Video extraction
const extractLinksWithMetadataFromMessages = (
  messages: Message[],
  regexes: RegExp[],
): YouTubeLinkWithMetadata[] =>
  messages.flatMap((message) =>
    regexes.flatMap((regex) => {
      regex.lastIndex = 0;
      const links: YouTubeLinkWithMetadata[] = [];
      let match;
      while ((match = regex.exec(message.body)) !== null) {
        links.push({
          videoId: match[1]!,
          datetime: message.sent_at || message.timestamp,
          userId: message.type === "incoming" ? message.sourceServiceId : null,
        });
      }
      return links;
    }),
  );

// Main functions
export const extractLinksWithMetadata = (
  connection: DbConnection,
): YouTubeLinkWithMetadata[] => {
  const conversation = findConversation(
    connection.db,
    connection.config.groupName,
  );
  const messages = fetchMessages(connection.db, conversation.id);
  return extractLinksWithMetadataFromMessages(
    messages,
    connection.config.youTubeRegexes,
  );
};

export const closeDatabase = (connection: DbConnection): void => {
  connection.db.close();
};
