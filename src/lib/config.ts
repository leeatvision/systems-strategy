import brand from "../brand/brand.json";

// From the brand files (see scripts/brand.mjs). The publishable key is public by design:
// it only allows what the database's row-level security rules allow, and those require a signed-in member.
export const SUPABASE_URL: string = brand.supabaseUrl;
export const SUPABASE_KEY: string = brand.supabaseKey;
export const APP_NAME: string = brand.name;
