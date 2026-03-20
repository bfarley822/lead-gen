# Lead Gen

An autonomous AI agent that discovers, researches, and scores local events for a cookie business. It finds events like festivals, fairs, farmers markets, and expos where the business could either set up a popup booth or land a catering order.

The pipeline runs entirely locally using [SearXNG](https://github.com/searxng/searxng) for web search and [Ollama](https://ollama.com) for AI inference -- no paid API keys required.

## How It Works

The pipeline is designed to run daily or weekly. The first run for a city takes 15-30 minutes (collecting and researching everything from scratch). Subsequent runs take 1-2 minutes because most data is cached in a local SQLite database.

### Pipeline Stages

```
Collect --> Diff --> Hard-Reject --> AI Dedup --> AI Triage --> AI Research --> AI Score --> Report
```

1. **Collect** -- Fires ~95 search queries per city through SearXNG (a self-hosted meta-search engine that aggregates Google, Bing, DuckDuckGo, and Brave). Queries cover event types like farmers markets, craft fairs, 5K runs, parades, rodeos, holiday events, and more. Also pulls from optional RSS/iCal feeds.

2. **Diff** -- Compares collected URLs against the SQLite cache. Only new URLs proceed; already-seen URLs are skipped. This is what makes repeat runs fast.

3. **Hard-Reject** -- Rule-based pre-filter that instantly drops obvious junk: generic Eventbrite listing pages, job sites, Wikipedia, Yellow Pages, etc. Costs zero time and no AI calls.

4. **AI Dedup** -- Sends new event titles/URLs to the LLM in batches of 30. The LLM groups events that refer to the same real-world event (e.g., "Fiesta Days Vendor Application" and "Fiesta Days Food Vendor") and assigns them to existing canonical events or creates new groups. Uses fuzzy string matching and transitive merging as a post-processing step.

5. **AI Triage** -- Lightweight LLM call using only titles and snippets (no page fetching). Batches 40 events per call. Asks "is this a specific, real event worth researching?" Filters out generic directory pages, competitor businesses, job postings, etc. This is the key optimization -- it eliminates 40-60% of groups before the expensive research step.

6. **AI Research** -- For events that passed triage: fetches the actual web page (with parallel fetching via `p-limit`), extracts the HTML content, and sends it to the LLM in batches of 5. The LLM extracts structured data: event name, type, location, dates, estimated attendance, organizer, contact info, registration URL, and whether the event is recurring.

7. **AI Score** -- Scores events on a 0-100 scale for cookie sales potential. Runs in batches of 20 events per LLM call. Only scores newly created events during regular runs (cached events keep their scores). Can be re-run independently with `--rescore` to re-evaluate all events when scoring criteria change.

8. **Report** -- Writes a JSON file to `output/` with all events above the minimum score threshold, and prints a summary to the console.

### Data Flow

```
SearXNG Queries           SQLite Database              Ollama LLM
     |                         |                           |
     v                         v                           v
  Raw URLs  ----diff---->  raw_events table          Dedup groups
                               |                     Triage filter
                               v                     Research data
                          canonical_events  <------   Score + reason
                               |
                               v
                          event_sources
                         (URL -> event mapping)
```

### Caching Strategy

All data is stored in a local SQLite database (`data/lead-gen.db`):

- **`raw_events`** -- Every URL ever seen, with title, snippet, and timestamps. Used by the diff stage to detect new URLs.
- **`canonical_events`** -- Deduplicated, researched events with full structured data, scores, and status. Each has a `page_content_hash` for change detection during refresh cycles.
- **`event_sources`** -- Many-to-many mapping between canonical events and their source URLs.
- **`city_progress`** -- Tracks multi-city run progress for resume support.

### Refresh Cycle

Run monthly with `--refresh` to re-fetch web pages for existing events. If the page content has changed (detected via SHA-256 hash), the event is re-researched and re-scored. Useful for catching updated dates, new vendor registration links, etc.

## Prerequisites

- **Node.js** >= 18
- **Docker** (for SearXNG)
- **Ollama** with `qwen2.5:14b` model

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Start SearXNG

SearXNG is a self-hosted meta-search engine. It runs in Docker and provides unlimited, free, API-key-free search:

```bash
docker compose -f docker/docker-compose.yml up -d
```

This starts two containers:
- `lead-gen-searxng` -- The search engine (port 8888)
- `lead-gen-valkey` -- Redis-compatible cache for SearXNG

### 3. Install Ollama and pull the model

```bash
# Install Ollama: https://ollama.com
ollama pull qwen2.5:14b
```

### 4. Configure environment

```bash
cp .env.example .env
```

Edit `.env` to set your search location:

```
SEARCH_LOCATION="Spanish Fork, UT"
OLLAMA_MODEL=qwen2.5:14b
OLLAMA_DEDUP_MODEL=qwen2.5:14b
```

## Usage

### Single city

```bash
# Run the full pipeline for a single city
npx tsx src/index.ts --location "Spanish Fork, UT"

# View cached results without re-collecting
npx tsx src/index.ts --location "Spanish Fork, UT" --report

# Re-score all events (useful when scoring criteria change)
npx tsx src/index.ts --location "Spanish Fork, UT" --rescore

# Re-fetch and re-research changed pages (monthly)
npx tsx src/index.ts --location "Spanish Fork, UT" --refresh

# Show database statistics
npx tsx src/index.ts --status
```

### Multi-city

Create a text file with one city per line:

```
# cities.txt
Spanish Fork, UT
Provo, UT
Boise, ID
Fort Collins, CO
```

Run across all cities with resume support:

```bash
# Process all cities (skips already-completed ones)
npx tsx src/index.ts --cities-file cities.txt

# Check progress
npx tsx src/index.ts --city-status

# Retry failed cities
npx tsx src/index.ts --reset-failed
npx tsx src/index.ts --cities-file cities.txt
```

### CLI Reference

| Flag | Description |
|------|-------------|
| `-l, --location <city>` | Search location (e.g., `"Spanish Fork, UT"`) |
| `--cities-file <path>` | Multi-city mode: path to file with one city per line |
| `--report` | Show cached events without re-collecting |
| `--rescore` | Re-score all cached events using the scorer LLM |
| `--refresh` | Re-fetch pages and update changed events |
| `--status` | Show database statistics |
| `--city-status` | Show multi-city run progress |
| `--reset-failed` | Reset failed cities to pending for retry |
| `--min-score <n>` | Minimum score threshold for report output (default: 40) |
| `--ollama-model <model>` | Override the Ollama model |
| `--db-path <path>` | Override the database file path |

## Project Structure

```
src/
  index.ts              CLI entry point (commander)
  config.ts             Environment variable loading and defaults
  types.ts              TypeScript types and Zod schemas
  db.ts                 SQLite database (schema, migrations, queries)
  pipeline.ts           Pipeline orchestration and report generation
  stages/
    collector.ts        SearXNG query builder and result collection
    qualifier.ts        Rule-based hard-reject filter
    deduplicator.ts     LLM-based event grouping and deduplication
    triage.ts           LLM-based lightweight relevance filter
    researcher.ts       Page fetching + LLM data extraction
    scorer.ts           LLM-based batch event scoring
  sources/
    rss.ts              RSS and iCal feed parsing
docker/
  docker-compose.yml    SearXNG + Valkey (Redis) containers
  settings.yml          SearXNG configuration (engines, rate limits)
data/
  lead-gen.db           SQLite database (gitignored)
output/
  events-*.json         Generated reports (gitignored)
```

## Configuration

All configuration is via environment variables (see `.env.example`):

| Variable | Default | Description |
|----------|---------|-------------|
| `SCORING_PROVIDER` | `ollama` | LLM provider (`ollama` or `openrouter`) |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama API endpoint |
| `OLLAMA_MODEL` | `qwen2.5:14b` | Model for research, triage, and scoring |
| `OLLAMA_DEDUP_MODEL` | `qwen2.5:14b` | Model for deduplication |
| `SEARXNG_BASE_URL` | `http://localhost:8888` | SearXNG API endpoint |
| `SEARCH_LOCATION` | `Austin, TX` | Default search city |
| `SEARCH_KEYWORDS` | `farmers market, food festival, ...` | Comma-separated search keywords |
| `MIN_RELEVANCE_SCORE` | `60` | Minimum score for report inclusion |
| `DB_PATH` | `data/lead-gen.db` | SQLite database path |
| `FEED_URLS` | *(empty)* | Optional RSS/iCal feed URLs |

## Performance

Benchmarks on an M-series Mac with `qwen2.5:14b`:

| Scenario | Time |
|----------|------|
| First run (new city, ~250 new URLs) | ~15-30 min |
| Subsequent run (mostly cached) | ~1-2 min |
| Re-score all events | ~5-6 min |
| Refresh cycle (re-fetch pages) | ~10-15 min |

The incremental caching design means the pipeline gets faster over time as more URLs are seen and cached. The triage stage is the key optimization: by filtering with a cheap LLM call (titles only, no page fetch) before the expensive research step (page fetch + deep analysis), it avoids 40-60% of the heavy lifting.

## Tech Stack

- **TypeScript** + **Node.js** -- Application runtime
- **SearXNG** -- Self-hosted meta-search engine (Google, Bing, DuckDuckGo, Brave)
- **Ollama** -- Local LLM inference (qwen2.5:14b)
- **SQLite** (`better-sqlite3`) -- Persistent local database with WAL mode
- **Cheerio** -- HTML parsing for page content extraction
- **Zod** -- Schema validation for LLM outputs
- **Commander** -- CLI framework
- **p-limit** -- Concurrency control for parallel page fetching
- **Docker Compose** -- Container orchestration for SearXNG
