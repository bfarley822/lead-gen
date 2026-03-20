import type { CollectedEvent } from "../types.js";

const hardRejectTitlePatterns = [
  /^free .+ events? - eventbrite/i,
  /^best \d+ .+ \| eventbrite/i,
  /^discover .+ events?/i,
  /^things to do in /i,
  /^events\s*[-–—|]?\s*.+\.(gov|org|com)/i,
  /^city events$/i,
  /history.*achievements/i,
  /\bsalary\b.*\bjob\b/i,
  /\bjob\b.*\bsalary\b/i,
  /^top \d+ .+ near /i,
  /\d+ venues? - eventective/i,
  /\bcareer\b.*\bopportunit/i,
  /^login to meetup/i,
  /^about\s*[-–—|]\s*meetup/i,
  /^find a meetup group/i,
  /^find events & groups/i,
  /^how to start a group/i,
  /^popular topics/i,
  /^socialize and make friends/i,
  /^online events \|.*meetup/i,
  /cookie.*を削除/i,
  /cookie.*מוחקים/i,
  /^classic cookie recipes/i,
  /^easy recipes/i,
  /\bcookie\s+(policy|consent|settings|notice)\b/i,
  /\bmanage\s+cookie/i,
  /\bdelete\s+cookie/i,
  /chrome.*cookie/i,
  /^business entities\s*[-–—]/i,

  // Competitor food / catering businesses
  /\bchipotle\s+catering\b/i,
  /\bchick-?fil-?a\s+catering\b/i,
  /\bpanda\s+express\b.*catering/i,
  /\bcracker\s+barrel\s+catering\b/i,
  /\bcatering\s+near\s+me\b/i,
  /\bcatering\s+services\b.*\b(panda|chipotle|chick)/i,
  /^.{0,30}\bcatering\b.{0,5}[-–—|]\s*(airway|spokane|facebook)/i,
  /\bcatering\b.*\border online\b/i,

  // Wholesale marketplace pages
  /^sell wholesale/i,
  /^wholesale .+ for (your store|retailers)/i,
  /^your one-stop shop for wholesale/i,
  /^discover thousands of vendors/i,
  /^online wholesale marketplace/i,
  /\bfaire\b.*\bwholesale\b/i,
  /\bwholesale\b.*\bfaire\b/i,
  /^faire markets/i,
  /^faire\b.*marknadsplatsen/i,

  // Financial / stock market pages
  /^markets:\s*indexes/i,
  /^stock market quotes/i,

  // Wedding venue listings (not specific events)
  /^\d+ .+ wedding venues/i,
  /^the \d+ best wedding venues/i,
  /^wedding venues in /i,
  /^all-inclusive .+ wedding venues/i,
  /wedding venues with lodging/i,

  // Photo booth services
  /\bphoto\s*booth\s+rentals?\b/i,

  // Food truck directories (not specific events)
  /\bfood trucks?\b.*\bstreetfoodfinder\b/i,
  /^guide to .+ food trucks/i,
  /^food truck catering near/i,

  // Stock photo / media library pages
  /^\d[\d,]+ .+ stock photos/i,
  /^\d[\d,]+ .+ high res/i,
  /^\d[\d,]+ .+ illustrations/i,
  /^\d[\d,]+ .+ - getty images/i,
  /stock photos.*getty/i,

  // Map / directions pages
  /map & directions/i,
  /driving directions to /i,

  // Real estate / housing
  /\bhome for sale\b/i,
  /\bhouses? for sale\b/i,
  /\bapartments? for rent\b/i,
  /\bcorporate housing\b/i,
  /\bfurnished apartments\b/i,
  /\bproperty records\b/i,
  /\bwho lives at\b/i,

  // Athlete / sports roster pages
  /- (men's|women's) (volleyball|basketball|football|soccer|tennis|track|swimming|baseball|softball|golf|wrestling|gymnastics|lacrosse|hockey|rowing|cross country|water polo) -/i,
  /\b(roster|stats|bio)\b.*\bathletics\b/i,

  // Academic / faculty profiles (not events)
  /faculty profile/i,
  /- research -.*university/i,

  // University library / generic academic pages
  /\buniversity guest house\b/i,

  // Non-English content that's clearly not local events
  /[\u4e00-\u9fff]{3,}/,
  /[\u0590-\u05ff]{3,}/,
  /[\u0600-\u06ff]{3,}/,

  // Crypto / trading platforms
  /\bdex aggregator\b/i,
  /\bswap tokens?\b/i,
  /\bcross-chain swap/i,

  // Generic government / education pages from other countries
  /government.*education.*loan.*schemes/i,
  /\bscholarships?\b.*\bgov\b.*\b(india|\.in)\b/i,

  // Political figure pages
  /\bnetanyahu\b/i,

  // Celebrity / musician pages (not events)
  /^katy perry\b/i,
  /^taylor swift\b/i,
];

const hardRejectUrlSubstrings = [
  "eventbrite.com/d/",
  "eventbrite.com/discover",
  "/search?",
  "/category/",
  "/tag/",
  "dictionary.cambridge.org",
  "ieee.org",
  "wikipedia.org",
  "merriam-webster.com",
  "conferencelists.org",
  "allconferencealert.com",
  "allconferencealert.net",
  "waset.org",
  "resurchify.com",
  "theknot.com",
  "realyellowpages.com",
  "yellowpages.com",
  "yelp.com",
  "tripadvisor.com",
  "indeed.com",
  "glassdoor.com",
  "linkedin.com/jobs",
  "salary.com",
  "ziprecruiter.com",
  "coursera.org/articles",
  "verywellmind.com",
  "verywellhealth.com",
  "healthline.com",
  "webmd.com",
  "support.google.com",
  "opencorporates.com",
  "sos.ca.gov",
  "imdb.com",

  // Meetup generic pages (specific event URLs like /group-name/events/123 are fine)
  "meetup.com/login",
  "meetup.com/about",
  "meetup.com/how-to",
  "meetup.com/topics",
  "meetup.com/cities",
  "meetup.com/find/",
  "meetup.com/find?",
  "meetup.com/lp/",
  "meetup.com/apps",
  "meetup.com/media",

  // Wholesale / e-commerce platforms (not events)
  "faire.com",
  "alibaba.com",

  // Competitor food chains & catering platforms
  "chick-fil-a.com",
  "chipotle.com",
  "catering.chipotle.com",
  "pandaexpress.com",
  "crackerbarrel.com",
  "catering.crackerbarrel.com",
  "ezcater.com",
  "doordash.com",
  "grubhub.com",
  "ubereats.com",
  "postmates.com",

  // Financial / stock market pages
  "cnbc.com/markets",
  "barchart.com",
  "finance.yahoo.com",
  "marketwatch.com",

  // Venue listing aggregators (not specific events)
  "peerspace.com",
  "wedding-spot.com",
  "herecomestheguide.com",
  "weddingwire.com",
  "zola.com/wedding-vendors",
  "breezit.com",
  "thewedstay.com",
  "blogthismoment.com",
  "eventective.com",

  // Photo booth / vendor service companies (not events)
  "photoboothfunction.com",

  // Food truck listing platforms (not specific events)
  "streetfoodfinder.com",
  "roaminghunger.com",
  "foodtruckclub.com",
  "foodtrucks.truckstrend.com",

  // Generic listing/review sites
  "townandtourist.com",
  "happeningnext.com",
  "allevents.in",
  "webmobi.com",

  // Stock photo / media libraries
  "gettyimages.com",
  "shutterstock.com",
  "istockphoto.com",
  "unsplash.com",
  "pexels.com",
  "stock.adobe.com",

  // Maps / directions
  "mapquest.com",
  "maps.google.com",

  // Real estate / housing
  "redfin.com",
  "zillow.com",
  "realtor.com",
  "apartments.com",
  "apartmenthomeliving.com",
  "corporates.com/corporate-housing",
  "rent.com",
  "trulia.com",

  // Encyclopedia / reference
  "britannica.com",
  "encyclopedia.com",

  // News / media (not event sources)
  "voachinese.com",
  "people.com",
  "country.iheart.com",
  "moneycontrol.com",

  // Crypto / trading
  "matcha.xyz",
  "coinbase.com",
  "binance.com",
  "dappgrid.com",
  "thecoinzone.com",

  // Political / government sites from other countries
  "netanyahu.org",
  ".gov.in/",
  "scholarships.gov.in",
  "ugc.gov.in",
  "nsfdc.nic.in",

  // Celebrity / musician sites
  "katyperry.com",
  "instagram.com/katyperry",

  // University sports / athletics (not events)
  "ovcsports.com",
  "utmsports.com",
  "uttylerpatriots.com",

  // Grocery store / food company sites (not events)
  "festfoods.com",
  "perryssteakhouse.com",

  // Loan / finance from other countries
  "latestsarkariyojana.com",
  "emicalculator.net.in",
  "propelld.com",
  "loanbazaar.co",
  "bankbazaar.com",

  // University housing / conferences generic pages (not specific events)
  "universityguesthouse.com",
  "shoresandislands.com",

  // Generic property records / county office
  "countyoffice.org",
];

function containsAny(text: string, values: string[]) {
  return values.some((value) => text.includes(value));
}

function matchesPattern(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

function isHardReject(event: CollectedEvent): boolean {
  const title = event.title;
  const url = event.url.toLowerCase();

  const isBareListingUrl =
    /\.(gov|org|com|net)\/events\/?$/.test(url) ||
    /\.(gov|org|com|net)\/events\/?[?#]/.test(url);

  return (
    containsAny(url, hardRejectUrlSubstrings) ||
    matchesPattern(title, hardRejectTitlePatterns) ||
    isBareListingUrl
  );
}

export function hardRejectFilter(events: CollectedEvent[]) {
  const kept: CollectedEvent[] = [];
  const rejected: string[] = [];

  for (const event of events) {
    if (isHardReject(event)) {
      rejected.push(event.title.slice(0, 60));
    } else {
      kept.push(event);
    }
  }

  return { kept, rejectedCount: rejected.length, rejectedTitles: rejected };
}
