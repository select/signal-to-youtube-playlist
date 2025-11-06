import { generateAuthUrl, exchangeCodeForToken } from "./playlist.js";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const log = (message: string) => console.log(message);

const createInterface = () => readline.createInterface({ input, output });

const askForCode = async (rl: readline.Interface): Promise<string> => {
  const code = await rl.question(
    "Paste the authorization code from the browser here: ",
  );
  rl.close();
  return code.trim();
};

const handleAuthSuccess = () => {
  log("\n✅ Authentication successful!");
  log("You can now use the YouTube API.");
};

const handleAuthFailure = (error: any): never => {
  console.error("\n❌ Authentication failed:", error);
  process.exit(1);
};

const runAuthentication = async (): Promise<void> => {
  log("YouTube API Authentication");
  log("==========================\n");

  const authUrl = await generateAuthUrl();

  log("\n📋 Copy this URL and paste it in your browser:");
  log(authUrl);
  log("\n");

  const rl = createInterface();
  const code = await askForCode(rl);

  try {
    await exchangeCodeForToken(code);
    handleAuthSuccess();
  } catch (error) {
    handleAuthFailure(error);
  }
};

runAuthentication().catch(console.error);
