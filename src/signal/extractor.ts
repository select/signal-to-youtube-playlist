import { join } from "node:path";
import { readFile } from "node:fs/promises";
import Database from "better-sqlite3-multiple-ciphers";
import { config } from "dotenv";
import {
  extractYouTubeLinksFromMessages,
  type YouTubeLinkWithMetadata,
  type MessageData,
} from "../utils/youtube-extractor.js";

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

interface SignalConfig {
  signalPath: string;
  groupName: string;
}

interface DbConnection {
  db: Database.Database;
  config: SignalConfig;
}

// Configuration
const createSignalConfig = (): SignalConfig => ({
  signalPath: join(process.env.HOME!, process.env.SIGNAL_PATH!),
  groupName: process.env.SIGNAL_GROUP_NAME || "",
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

// Convert Signal messages to MessageData format
const signalMessageToMessageData = (message: Message): MessageData => ({
  body: message.body,
  datetime: message.sent_at || message.timestamp,
  userId: message.type === "incoming" ? message.sourceServiceId : null,
});

// Main functions
export const extractLinksWithMetadata = (
  connection: DbConnection,
): YouTubeLinkWithMetadata[] => {
  const conversation = findConversation(
    connection.db,
    connection.config.groupName,
  );
  const messages = fetchMessages(connection.db, conversation.id);
  const messageData = messages.map(signalMessageToMessageData);
  return extractYouTubeLinksFromMessages(messageData);
};

export const closeDatabase = (connection: DbConnection): void => {
  connection.db.close();
};
