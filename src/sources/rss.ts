import Parser from "rss-parser";
import ical from "node-ical";
import type { VEvent } from "node-ical";
import type { RawEvent } from "../types.js";

const rssParser = new Parser();

function isIcalUrl(url: string): boolean {
  return url.endsWith(".ics") || url.includes("ical");
}

async function parseRssFeed(url: string): Promise<RawEvent[]> {
  const feed = await rssParser.parseURL(url);
  return (feed.items ?? []).map((item) => ({
    title: item.title ?? "Untitled",
    description: item.contentSnippet ?? item.content ?? "",
    url: item.link ?? url,
    date: item.isoDate ?? item.pubDate ?? undefined,
    location: undefined,
    source: "rss" as const,
  }));
}

function isVEvent(component: ical.CalendarComponent): component is VEvent {
  return component.type === "VEVENT";
}

function parameterValueToString(val: ical.ParameterValue | undefined): string {
  if (val === undefined) return "";
  if (typeof val === "string") return val;
  if (typeof val === "object" && val !== null && "val" in val) return String(val.val);
  return String(val);
}

async function parseIcalFeed(url: string): Promise<RawEvent[]> {
  const data = await ical.async.fromURL(url);
  const events: RawEvent[] = [];

  for (const component of Object.values(data)) {
    if (!component || !isVEvent(component)) continue;

    const startDate = component.start
      ? new Date(component.start as unknown as string).toISOString()
      : undefined;

    const locationStr = parameterValueToString(component.location);

    events.push({
      title: parameterValueToString(component.summary) || "Untitled",
      description: parameterValueToString(component.description),
      url: component.url ?? "",
      date: startDate,
      location: locationStr || undefined,
      source: "rss",
    });
  }

  return events;
}

export async function searchFeeds(feedUrls: string[]): Promise<RawEvent[]> {
  if (feedUrls.length === 0) return [];

  const results = await Promise.allSettled(
    feedUrls.map((url) =>
      isIcalUrl(url) ? parseIcalFeed(url) : parseRssFeed(url)
    )
  );

  const events: RawEvent[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      events.push(...result.value);
    } else {
      console.warn(`Feed fetch failed: ${result.reason}`);
    }
  }

  return events;
}
