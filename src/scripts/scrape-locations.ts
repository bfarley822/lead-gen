import * as cheerio from "cheerio";

type CrumblStoreRaw = {
  storeId: string;
  slug: string;
  name: string;
  address: string;
  city: string;
  state: string;
  stateInitials: string;
  zip: string;
  street: string;
  latitude: string;
  longitude: string;
  phone: string;
  email: string;
};

export type ScrapedLocation = {
  storeName: string;
  address: string;
  city: string;
  state: string;
  stateInitials: string;
  zip: string;
  lat: number;
  lng: number;
  slug: string;
};

const STORES_URL = "https://crumblcookies.com/stores";

export async function scrapeLocations(): Promise<ScrapedLocation[]> {
  const response = await fetch(STORES_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch stores page: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  const scriptContent = $("#__NEXT_DATA__").html();
  if (!scriptContent) {
    throw new Error("Could not find __NEXT_DATA__ in the stores page — the site structure may have changed");
  }

  const nextData = JSON.parse(scriptContent);
  const stores: CrumblStoreRaw[] = nextData?.props?.pageProps?.allActiveStores;
  if (!stores || !Array.isArray(stores)) {
    throw new Error("Could not find allActiveStores in __NEXT_DATA__ — the site structure may have changed");
  }

  return stores.map((store) => ({
    storeName: store.name,
    address: store.address,
    city: store.city,
    state: store.state,
    stateInitials: store.stateInitials,
    zip: store.zip,
    lat: Number.parseFloat(store.latitude),
    lng: Number.parseFloat(store.longitude),
    slug: store.slug,
  }));
}
