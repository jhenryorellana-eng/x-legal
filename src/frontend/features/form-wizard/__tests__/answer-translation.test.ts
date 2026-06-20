import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the platform-bridge translator before importing the SUT.
const isSupportedMock = vi.fn();
const translateMock = vi.fn();
vi.mock("@/frontend/platform-bridge", () => ({
  getBridge: () => ({
    translator: { isSupported: isSupportedMock, translate: translateMock, detect: vi.fn() },
  }),
}));

import { translateClientAnswers } from "../answer-translation";
import type { WizardGroup, WizardQuestion } from "../types";

function q(id: string, fieldType: string): WizardQuestion {
  return {
    id,
    groupId: "g1",
    questionI18n: { en: id, es: id },
    helpI18n: null,
    fieldType,
    options: null,
    isRequired: false,
    position: 0,
    source: "client_answer",
    validation: null,
    prefillValue: null,
    isPrefilled: false,
    currentAnswer: null,
  };
}

function groups(questions: WizardQuestion[]): WizardGroup[] {
  return [{ id: "g1", titleI18n: { en: "G", es: "G" }, position: 0, questions }];
}

beforeEach(() => {
  isSupportedMock.mockReset();
  translateMock.mockReset();
});

describe("translateClientAnswers", () => {
  it("returns status 'none' and does nothing when from === to", async () => {
    const res = await translateClientAnswers({
      groups: groups([q("a", "text")]),
      answers: { a: "hola" },
      from: "es",
      to: "es",
    });
    expect(res).toEqual({ translated: {}, status: "none" });
    expect(isSupportedMock).not.toHaveBeenCalled();
  });

  it("returns status 'none' when there are no textual answers to translate", async () => {
    isSupportedMock.mockResolvedValue(true);
    const res = await translateClientAnswers({
      groups: groups([q("d", "date"), q("n", "number"), q("s", "select")]),
      answers: { d: "2020-01-01", n: 5, s: "opt1" },
      from: "es",
      to: "en",
    });
    expect(res.status).toBe("none");
    expect(translateMock).not.toHaveBeenCalled();
  });

  it("translates only text/textarea fields on-device (Chrome) → status 'done'", async () => {
    isSupportedMock.mockResolvedValue(true);
    translateMock.mockImplementation((text: string) => Promise.resolve(`EN:${text}`));
    const res = await translateClientAnswers({
      groups: groups([q("a", "text"), q("b", "textarea"), q("c", "date")]),
      answers: { a: "hola", b: "mundo", c: "2020-01-01" },
      from: "es",
      to: "en",
    });
    expect(res.status).toBe("done");
    expect(res.translated).toEqual({ a: "EN:hola", b: "EN:mundo" });
    // date field is never translated
    expect(translateMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to the server translator when on-device is unsupported", async () => {
    isSupportedMock.mockResolvedValue(false);
    const serverFallback = vi.fn().mockResolvedValue({ ok: true, translations: { a: "EN:hola" } });
    const res = await translateClientAnswers({
      groups: groups([q("a", "text")]),
      answers: { a: "hola" },
      from: "es",
      to: "en",
      serverFallback,
    });
    expect(translateMock).not.toHaveBeenCalled();
    expect(serverFallback).toHaveBeenCalledWith({ items: [{ id: "a", text: "hola" }], from: "es", to: "en" });
    expect(res).toEqual({ translated: { a: "EN:hola" }, status: "done" });
  });

  it("uses server fallback for the items on-device could not handle (partial → done)", async () => {
    isSupportedMock.mockResolvedValue(true);
    translateMock.mockImplementation((text: string) => Promise.resolve(text === "hola" ? "EN:hola" : null));
    const serverFallback = vi.fn().mockResolvedValue({ ok: true, translations: { b: "EN:mundo" } });
    const res = await translateClientAnswers({
      groups: groups([q("a", "text"), q("b", "text")]),
      answers: { a: "hola", b: "mundo" },
      from: "es",
      to: "en",
      serverFallback,
    });
    expect(serverFallback).toHaveBeenCalledWith({ items: [{ id: "b", text: "mundo" }], from: "es", to: "en" });
    expect(res).toEqual({ translated: { a: "EN:hola", b: "EN:mundo" }, status: "done" });
  });

  it("returns 'pending_server' when nothing could be translated and no fallback exists", async () => {
    isSupportedMock.mockResolvedValue(false);
    const res = await translateClientAnswers({
      groups: groups([q("a", "text")]),
      answers: { a: "hola" },
      from: "es",
      to: "en",
    });
    expect(res.status).toBe("pending_server");
    expect(res.translated).toEqual({});
  });

  it("survives a thrown on-device translate and degrades to pending_server", async () => {
    isSupportedMock.mockResolvedValue(true);
    translateMock.mockRejectedValue(new Error("model crashed"));
    const res = await translateClientAnswers({
      groups: groups([q("a", "text")]),
      answers: { a: "hola" },
      from: "es",
      to: "en",
    });
    expect(res.status).toBe("pending_server");
  });
});
