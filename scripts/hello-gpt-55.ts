import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required to run this script.");
}

const result = await generateText({
  model: openai("gpt-5.5"),
  prompt: "Hello, GPT-5.5. Please respond with a short friendly greeting.",
});

console.log("Text output:");
console.log(result.text);
console.log("\nFinish reason:", result.finishReason);
console.log("Usage:", result.usage);
