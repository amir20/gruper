// utils/openrouter.ts
//
// Minimal OpenRouter API client using the OpenAI-compatible chat completions endpoint.

const BASE_URL = "https://openrouter.ai/api/v1";

interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionResponse {
  choices: { message: { content: string }; finish_reason?: string }[];
}

export async function chatCompletion(
  apiKey: string,
  model: string,
  messages: Message[],
  options: { temperature?: number; max_tokens?: number } = {},
): Promise<string> {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/nicedoctor/gruper",
      "X-Title": "Gruper",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: options.temperature ?? 0.3,
      // Most current models reason before answering, and reasoning tokens count
      // against max_tokens — leave headroom so the JSON isn't cut off.
      max_tokens: options.max_tokens ?? 8192,
      reasoning: { effort: "low" },
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenRouter API error (${res.status}): ${body}`);
  }

  const data: ChatCompletionResponse = await res.json();
  const choice = data.choices[0];
  if (choice?.finish_reason === "length") {
    throw new Error("Model response was cut off before finishing. Try a different model or fewer tabs.");
  }
  return choice?.message?.content ?? "";
}
