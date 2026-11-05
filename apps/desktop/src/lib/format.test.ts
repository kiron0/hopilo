import { describe, expect, it } from "vitest";
import { basename, bytes, formatDate, humanizeDateTime, plural, relativeTime, tokens } from "./format";

describe("format", () => {
  const now = new Date("2026-11-03T12:00:00Z");
  it("relative time", () => {
    expect(relativeTime("2026-11-03T11:59:50Z", now)).toBe("just now");
    expect(relativeTime("2026-11-03T11:58:00Z", now)).toBe("2m ago");
    expect(relativeTime("2026-11-02T11:00:00Z", now)).toBe("yesterday");
    expect(relativeTime(null, now)).toBe("never");
  });
  it("humanize date time", () => {
    expect(humanizeDateTime("2026-11-03T08:30:00Z", now)).toContain("Today at");
    expect(humanizeDateTime("2026-11-02T15:45:00Z", now)).toContain("Yesterday at");
    expect(humanizeDateTime(null, now)).toBe("");
    expect(formatDate("2026-11-04T18:29:59Z")).toContain("2026");
  });
  it("sizes", () => {
    expect(bytes(512)).toBe("512 B");
    expect(bytes(1536)).toBe("1.5 KB");
    expect(tokens(1234)).toBe("~1.2k");
    expect(plural(1, "message")).toBe("1 message");
    expect(plural(2, "message")).toBe("2 messages");
  });
  it("basename", () => {
    expect(basename("/Users/me/work/api/")).toBe("api");
    expect(basename("C:\\work\\web")).toBe("web");
  });
});
