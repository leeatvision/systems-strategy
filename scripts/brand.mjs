// Puts the brand (name, colours, icons, server address) in place before a dev run or build.
// Uses brand/ when it exists (the private brand files, checked out by the deploy workflow),
// otherwise the neutral placeholders in brand-default/. Set REQUIRE_BRAND=1 to refuse the fallback.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";

const dir = existsSync("brand/brand.json") ? "brand" : "brand-default";
if (dir === "brand-default" && process.env.REQUIRE_BRAND) {
  console.error("brand/ is missing: the private brand files didn't check out.");
  process.exit(1);
}
rmSync("public/icons", { recursive: true, force: true });
cpSync(`${dir}/icons`, "public/icons", { recursive: true });
mkdirSync("src/brand", { recursive: true });
cpSync(`${dir}/brand.json`, "src/brand/brand.json");
cpSync(`${dir}/brand.css`, "src/brand/brand.css");
console.log(`Brand: ${dir}/`);
