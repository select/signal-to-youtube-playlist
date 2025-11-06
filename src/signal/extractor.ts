import { join } from "node:path";
import { readFile } from "node:fs/promises";
import Database from "better-sqlite3-multiple-ciphers";
import { config } from "dotenv";

// Load environment variables from .env file
config();

interface Message {
  id: string;
  body: string;
}

interface Conversation {
  id: string;
}

export interface YouTubeLink {
  videoId: string;
  url: string;
  messageId: string;
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
  signalPath: join(process.env.HOME!, process.env.SIGNAL_PATH),
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
      `SELECT id, body FROM messages WHERE conversationId=? AND body IS NOT NULL AND body != 'NULL'`,
    )
    .all(conversationId) as Message[];

// Video extraction
const extractVideoIdsFromText = (text: string, regexes: RegExp[]): string[] =>
  regexes.flatMap((regex) => {
    regex.lastIndex = 0;
    const matches: string[] = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
      matches.push(match[1]);
    }
    return matches;
  });

const extractVideoIdsFromMessages = (
  messages: Message[],
  regexes: RegExp[],
): string[] =>
  messages.flatMap((message) => extractVideoIdsFromText(message.body, regexes));

const extractLinksFromMessages = (
  messages: Message[],
  regexes: RegExp[],
): YouTubeLink[] =>
  messages.flatMap((message) =>
    regexes.flatMap((regex) => {
      regex.lastIndex = 0;
      const links: YouTubeLink[] = [];
      let match;
      while ((match = regex.exec(message.body)) !== null) {
        links.push({
          videoId: match[1],
          url: match[0],
          messageId: message.id,
        });
      }
      return links;
    }),
  );

// Main functions
export const extractVideoIds = (connection: DbConnection): string[] => {
  const conversation = findConversation(
    connection.db,
    connection.config.groupName,
  );
  const messages = fetchMessages(connection.db, conversation.id);
  return extractVideoIdsFromMessages(
    messages,
    connection.config.youTubeRegexes,
  );
};

export const extractLinks = (connection: DbConnection): YouTubeLink[] => {
  const conversation = findConversation(
    connection.db,
    connection.config.groupName,
  );
  const messages = fetchMessages(connection.db, conversation.id);
  return extractLinksFromMessages(messages, connection.config.youTubeRegexes);
};

export const getUniqueVideoIds = (connection: DbConnection): string[] => [
  ...new Set(extractVideoIds(connection)),
];

export const closeDatabase = (connection: DbConnection): void => {
  connection.db.close();
};

// Helper function for quick extraction
export const extractYouTubeVideosFromSignal = async (): Promise<string[]> => {
  const connection = await initializeDatabase();
  try {
    return getUniqueVideoIds(connection);
  } finally {
    closeDatabase(connection);
  }
};
