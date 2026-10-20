// Claude checking with a visitor's own API key, for the public site. Loaded on demand as js/claude.js.
// The key goes from this browser straight to api.anthropic.com; nothing else sees it.
import Anthropic from "@anthropic-ai/sdk";

const b64 = (blob) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(",")[1]);
  r.onerror = () => rej(r.error);
  r.readAsDataURL(blob);
});

// Models a visitor can pick. Fallbacks re-run a declined request on another model; Haiku has none.
const FALLBACKS = new Set(["claude-opus-5-5", "claude-sonnet-5-5"]);

async function askClaude({ apiKey, model, prompt, images }) {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 120000 });
  const content = [];
  for (const img of images) content.push({ type: "image", source: { type: "base64", media_type: "image/png", data: await b64(img) } });
  content.push({ type: "text", text: prompt });
  const fb = FALLBACKS.has(model);
  let res;
  try {
    res = await client.beta.messages.create({
      model,
      max_tokens: 16000,
      output_config: { effort: "medium" },
      ...(fb ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
      messages: [{ role: "user", content }],
    });
  } catch (e) {
    throw { code: errCode(e), message: e?.error?.error?.message || e?.message || "" };
  }
  if (res.stop_reason === "refusal") throw { code: "key_refused" };
  return { text: res.content.filter((b) => b.type === "text").map((b) => b.text).join("") };
}
function errCode(e) {
  if (e instanceof Anthropic.AuthenticationError) return "key_invalid";
  if (e instanceof Anthropic.PermissionDeniedError) return "key_denied";
  if (e instanceof Anthropic.RateLimitError) return "key_rate";
  if (e instanceof Anthropic.NotFoundError) return "key_model";
  if (e instanceof Anthropic.BadRequestError) return /credit|billing|balance/i.test(e?.error?.error?.message || e?.message || "") ? "key_credit" : "key_bad";
  if (e instanceof Anthropic.APIConnectionError) return "key_network";
  if (e instanceof Anthropic.InternalServerError || e?.status === 529) return "key_busy";
  return "key_error";
}

window.qcardClaude = { ask: askClaude };
