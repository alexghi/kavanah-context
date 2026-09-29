import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import { AnthropicProvider, MAX_PAUSE_TURN_RESUMES, mapAnthropicError, type AnthropicClientLike } from "./anthropic.js";

type Message = Anthropic.Messages.Message;
type Block = Anthropic.Messages.ContentBlock;

function message(content: Block[], stop_reason: Message["stop_reason"] = "end_turn", extra: Partial<Message> = {}): Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-test",
    content,
    stop_reason,
    stop_sequence: null,
    stop_details: null,
    container: null,
    usage: { input_tokens: 10, output_tokens: 5 },
    ...extra,
  } as unknown as Message;
}

const text = (t: string, citations: Anthropic.Messages.TextCitation[] | null = null): Block => ({ type: "text", text: t, citations });

function searchResult(tool_use_id: string, urls: string[]): Block {
  return {
    type: "web_search_tool_result",
    tool_use_id,
    caller: { type: "direct" },
    content: urls.map((url, i) => ({ type: "web_search_result", url, title: `Result ${i + 1}`, page_age: null, encrypted_content: "x" })),
  } as unknown as Block;
}

function fakeClient(responses: Array<Message | Error>): AnthropicClientLike & { create: ReturnType<typeof vi.fn> } {
  const create = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error("fake client: no more responses");
    if (next instanceof Error) throw next;
    return next;
  });
  return { messages: { create }, create };
}

const Schema = z.object({ answer: z.string(), score: z.number() });

function provider(client: AnthropicClientLike, webSearch = true) {
  return new AnthropicProvider({ model: "claude-test", effort: "low", webSearch, client });
}

describe("AnthropicProvider.structured", () => {
  it("sends a structured-output request (no thinking, no tool_choice) and parses the JSON text", async () => {
    const client = fakeClient([message([text('{"answer":"yes","score":3}')])]);
    const result = await provider(client).structured({ stage: "t", system: "sys", user: "usr", schema: Schema });
    expect(result).toEqual({ ok: true, value: { answer: "yes", score: 3 }, usage: { inputTokens: 10, outputTokens: 5 } });
    const params = client.create.mock.calls[0]![0] as Anthropic.Messages.MessageCreateParamsNonStreaming;
    expect(params.model).toBe("claude-test");
    expect(params.system).toBe("sys");
    expect(params.messages).toEqual([{ role: "user", content: "usr" }]);
    expect(params.output_config?.effort).toBe("low");
    expect(params.output_config?.format?.type).toBe("json_schema");
    expect(params.output_config?.format?.schema).toMatchObject({ type: "object", additionalProperties: false });
    expect(params).not.toHaveProperty("thinking");
    expect(params).not.toHaveProperty("tool_choice");
    expect(params).not.toHaveProperty("tools");
    expect(JSON.parse(JSON.stringify(params.output_config?.format))).not.toHaveProperty("parse"); // the parse fn never reaches the wire
  });

  it("stop_reason refusal → refusal (checked before parsing non-JSON text)", async () => {
    const client = fakeClient([message([text("I can't help with that.")], "refusal", { stop_details: { type: "refusal", category: null, explanation: "policy" } } as Partial<Message>)]);
    const result = await provider(client).structured({ stage: "t", system: "s", user: "u", schema: Schema });
    expect(result).toMatchObject({ ok: false, reason: "refusal" });
  });

  it("stop_reason max_tokens → invalid_output", async () => {
    const client = fakeClient([message([text('{"answer":"ye')], "max_tokens")]);
    const result = await provider(client).structured({ stage: "t", system: "s", user: "u", schema: Schema });
    expect(result).toMatchObject({ ok: false, reason: "invalid_output" });
  });

  it("malformed JSON or off-schema output → invalid_output", async () => {
    const bad = fakeClient([message([text("not json")])]);
    expect(await provider(bad).structured({ stage: "t", system: "s", user: "u", schema: Schema })).toMatchObject({ ok: false, reason: "invalid_output" });
    const offSchema = fakeClient([message([text('{"answer":"yes","score":"high"}')])]);
    expect(await provider(offSchema).structured({ stage: "t", system: "s", user: "u", schema: Schema })).toMatchObject({ ok: false, reason: "invalid_output" });
    const empty = fakeClient([message([])]);
    expect(await provider(empty).structured({ stage: "t", system: "s", user: "u", schema: Schema })).toMatchObject({ ok: false, reason: "invalid_output" });
  });

  it("maps SDK errors to the failure vocabulary", async () => {
    const headers = new Headers();
    const body = (type: string) => ({ type: "error", error: { type, message: "m" } });
    expect(mapAnthropicError(new Anthropic.AuthenticationError(401, body("authentication_error"), "bad key", headers))).toMatchObject({ ok: false, reason: "auth" });
    expect(mapAnthropicError(new Anthropic.RateLimitError(429, body("rate_limit_error"), "slow down", headers))).toMatchObject({ ok: false, reason: "rate_limited" });
    expect(mapAnthropicError(new Anthropic.APIConnectionTimeoutError())).toMatchObject({ ok: false, reason: "timeout" });
    expect(mapAnthropicError(new Anthropic.APIConnectionError({ message: "ECONNREFUSED" }))).toMatchObject({ ok: false, reason: "api_error" });
    expect(mapAnthropicError(new Anthropic.InternalServerError(500, body("api_error"), "boom", headers))).toMatchObject({ ok: false, reason: "api_error" });
    expect(mapAnthropicError(new Anthropic.InternalServerError(529, body("overloaded_error"), "overloaded", headers))).toMatchObject({ ok: false, reason: "rate_limited" });
    expect(mapAnthropicError(new Anthropic.BadRequestError(400, body("invalid_request_error"), "bad", headers))).toMatchObject({ ok: false, reason: "api_error" });
    expect(mapAnthropicError(new Anthropic.AnthropicError("Failed to parse structured output"))).toMatchObject({ ok: false, reason: "invalid_output" });
    expect(mapAnthropicError(new Error("weird"))).toMatchObject({ ok: false, reason: "api_error", message: "weird" });

    const client = fakeClient([new Anthropic.RateLimitError(429, body("rate_limit_error"), "slow down", headers)]);
    expect(await provider(client).structured({ stage: "t", system: "s", user: "u", schema: Schema })).toMatchObject({ ok: false, reason: "rate_limited" });
  });
});

describe("AnthropicProvider.search", () => {
  it("sends the web_search tool without structured output and collects candidates", async () => {
    const client = fakeClient([
      message([
        { type: "server_tool_use", id: "tu1", name: "web_search", input: { query: "moon rock" }, caller: { type: "direct" } } as unknown as Block,
        searchResult("tu1", ["https://www.example.org/a", "https://example.org/b"]),
        text("Notes.", [{ type: "web_search_result_location", url: "https://www.example.org/a", title: "A", cited_text: "The Moon is rock.", encrypted_index: "e" }]),
      ]),
    ]);
    const result = await provider(client).search({ stage: "retrieveEvidence", system: "s", user: "u", maxUses: 4 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.candidates).toHaveLength(2);
    expect(result.value.candidates[0]).toMatchObject({ id: "s1", url: "https://www.example.org/a", publisher: "example.org", snippet: "The Moon is rock." });
    expect(result.value.searches).toBe(1);
    expect(result.value.queries).toEqual(["moon rock"]);
    expect(result.value.notes).toBe("Notes.");
    const params = client.create.mock.calls[0]![0] as Anthropic.Messages.MessageCreateParamsNonStreaming;
    expect(params.tools).toEqual([{ type: "web_search_20260209", name: "web_search", max_uses: 4 }]);
    expect(params.output_config).toEqual({ effort: "low" });
    expect(params.max_tokens).toBe(8000);
  });

  it("resumes pause_turn by re-sending the assistant content, at most MAX_PAUSE_TURN_RESUMES times", async () => {
    const paused = (id: string, url: string) =>
      message([{ type: "server_tool_use", id, name: "web_search", input: { query: id }, caller: { type: "direct" } } as unknown as Block, searchResult(id, [url])], "pause_turn");
    const client = fakeClient([paused("a", "https://a.org/1"), paused("b", "https://b.org/1"), paused("c", "https://c.org/1"), message([text("done")])]);
    const result = await provider(client).search({ stage: "r", system: "s", user: "u" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(client.create).toHaveBeenCalledTimes(MAX_PAUSE_TURN_RESUMES + 1); // the 3rd pause is not resumed
    expect(result.value.resumed).toBe(MAX_PAUSE_TURN_RESUMES);
    expect(result.value.candidates.map((c) => c.url)).toEqual(["https://a.org/1", "https://b.org/1", "https://c.org/1"]);
    const second = client.create.mock.calls[1]![0] as Anthropic.Messages.MessageCreateParamsNonStreaming;
    expect(second.messages).toHaveLength(2);
    expect(second.messages[1]?.role).toBe("assistant");
    const third = client.create.mock.calls[2]![0] as Anthropic.Messages.MessageCreateParamsNonStreaming;
    expect(third.messages).toHaveLength(3);
    expect(third.messages.every((m) => m.role !== "user" || m === third.messages[0])).toBe(true); // no extra user text added
  });

  it("handles the error-object result shape and refusal; does not call the API when web search is disabled", async () => {
    const client = fakeClient([
      message([
        { type: "web_search_tool_result", tool_use_id: "x", caller: { type: "direct" }, content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" } } as unknown as Block,
        text("nothing"),
      ]),
    ]);
    const result = await provider(client).search({ stage: "r", system: "s", user: "u" });
    expect(result).toMatchObject({ ok: true, value: { candidates: [], toolErrors: ["max_uses_exceeded"] } });

    const refused = fakeClient([message([text("no")], "refusal")]);
    expect(await provider(refused).search({ stage: "r", system: "s", user: "u" })).toMatchObject({ ok: false, reason: "refusal" });

    const disabled = fakeClient([]);
    expect(await provider(disabled, false).search({ stage: "r", system: "s", user: "u" })).toMatchObject({ ok: false, reason: "api_error" });
    expect(disabled.create).not.toHaveBeenCalled();

    const errored = fakeClient([new Anthropic.APIConnectionTimeoutError()]);
    expect(await provider(errored).search({ stage: "r", system: "s", user: "u" })).toMatchObject({ ok: false, reason: "timeout" });
  });
});
