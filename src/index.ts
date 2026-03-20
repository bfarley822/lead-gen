#!/usr/bin/env node

import { Command } from "commander";
import { loadConfig } from "./config.js";
import {
  runIncrementalPipeline,
  runRefreshCycle,
  runRescore,
  showReport,
  showStatus,
  runMultiCity,
  showMultiCityStatus,
  parseLocation,
} from "./pipeline.js";

const program = new Command();

program
  .name("lead-gen")
  .description(
    "Autonomous agent that researches local events for a cookie business"
  )
  .version("0.3.0")
  .option("-l, --location <location>", "search location (e.g. 'Spanish Fork, UT')")
  .option("-r, --radius <miles>", "search radius in miles", parseInt)
  .option(
    "-k, --keywords <keywords>",
    "comma-separated search keywords",
    (val: string) =>
      val
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
  )
  .option("--ollama-model <model>", "Ollama model identifier")
  .option(
    "--min-score <score>",
    "minimum relevance score to keep in final output",
    parseInt
  )
  .option("--store-address <address>", "full store address (e.g. '79795 US Highway 111, La Quinta, CA 92253')")
  .option("--store-name <name>", "franchise store name used as the pipeline identifier")
  .option("--cities-file <path>", "path to a franchise locations file (one address per line)")
  .option("--report", "show cached events without re-collecting")
  .option("--refresh", "re-fetch pages for cached events and update if changed")
  .option("--rescore", "re-score all cached events without re-collecting or researching")
  .option("--status", "show database statistics")
  .option("--city-status", "show multi-city progress")
  .option("--reset-failed", "reset failed cities so they re-run on next --cities-file invocation")
  .option("--import-locations", "scrape all Crumbl franchise locations and import them into the database")
  .option("--db-path <path>", "path to SQLite database file")
  .action(async (opts) => {
    try {
      let locationOverrides: Partial<{ searchLocation: string; searchArea: string; storeAddress: string }> = {};
      if (opts.location && opts.storeAddress) {
        const parsedLoc = parseLocation(opts.location);
        const parsedAddr = parseLocation(opts.storeAddress);
        locationOverrides = {
          searchLocation: parsedLoc.searchCity,
          searchArea: parsedAddr.searchCity,
          storeAddress: opts.storeAddress,
        };
      } else if (opts.storeAddress) {
        const parsed = parseLocation(opts.storeAddress);
        locationOverrides = {
          searchLocation: parsed.searchCity,
          searchArea: parsed.searchCity,
          storeAddress: parsed.fullAddress,
        };
      } else if (opts.location) {
        const parsed = parseLocation(opts.location);
        locationOverrides = {
          searchLocation: parsed.searchCity,
          searchArea: parsed.searchCity,
          storeAddress: parsed.fullAddress,
        };
      }

      const config = loadConfig({
        ...locationOverrides,
        ...(opts.radius ? { searchRadiusMiles: opts.radius } : {}),
        ...(opts.keywords ? { searchKeywords: opts.keywords } : {}),
        ...(opts.ollamaModel ? { ollamaModel: opts.ollamaModel } : {}),
        ...(opts.minScore ? { minRelevanceScore: opts.minScore } : {}),
        ...(opts.storeName ? { storeName: opts.storeName } : {}),
        ...(opts.dbPath ? { dbPath: opts.dbPath } : {}),
      });

      if (opts.cityStatus) {
        await showMultiCityStatus(config);
        return;
      }

      if (opts.status) {
        await showStatus(config);
        return;
      }

      if (opts.report) {
        await showReport(config);
        return;
      }

      if (opts.refresh) {
        await runRefreshCycle(config);
        return;
      }

      if (opts.rescore) {
        await runRescore(config);
        return;
      }

      if (opts.resetFailed) {
        const { openDb, getAllCityProgress, upsertCityProgress } = await import("./db.js");
        const db = openDb(config.dbPath);
        const all = getAllCityProgress(db);
        const failedRows = all.filter((c) => c.status === "failed");
        for (const c of failedRows) {
          upsertCityProgress(db, c.city, { status: "pending", error: null });
        }
        db.close();
        console.log(`Reset ${failedRows.length} failed cities to pending.`);
        return;
      }

      if (opts.importLocations) {
        const { scrapeLocations } = await import("./scripts/scrape-locations.js");
        const { openDb, importFranchiseLocations, getFranchiseLocationCount } = await import("./db.js");
        console.log("Scraping Crumbl franchise locations from crumblcookies.com/stores...");
        const locations = await scrapeLocations();
        console.log(`Found ${locations.length} locations`);
        const db = openDb(config.dbPath);
        const result = importFranchiseLocations(db, locations);
        const total = getFranchiseLocationCount(db);
        db.close();
        console.log(`Import complete: ${result.inserted} new, ${result.updated} updated (${total} total in DB)`);
        return;
      }

      if (opts.citiesFile) {
        await runMultiCity(config, opts.citiesFile);
        return;
      }

      await runIncrementalPipeline(config);
    } catch (err) {
      console.error(
        "Error:",
        err instanceof Error ? err.message : String(err)
      );
      process.exit(1);
    }
  });

program.parse();
