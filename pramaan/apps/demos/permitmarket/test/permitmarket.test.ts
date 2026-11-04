import { describe, expect, it } from "vitest";
import { fmt, parseAmount, countdown, short } from "../src/lib/format";
import { humanError, ERROR_TEXT } from "../src/lib/errors";
import { passSvg } from "../src/art";
import { escapeHtml } from "../src/ui";
import { marketAbi, nftAbi, tokenAbi } from "../src/abi";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

describe("PermitMarket SVG Generator (art.ts)", () => {
  it("generates deterministic SVG data URL for a token", () => {
    const url1 = passSvg(1n);
    const url2 = passSvg(1n);
    const url3 = passSvg(2n);

    expect(url1).toBe(url2);
    expect(url1).not.toBe(url3);
    expect(url1.startsWith("data:image/svg+xml;utf8,")).toBe(true);
    expect(decodeURIComponent(url1)).toContain("PASS #1");
  });
});

describe("PermitMarket Formatter & Errors", () => {
  it("formats prices and amounts correctly", () => {
    expect(fmt(10_000_000n, 6)).toBe("10");
    expect(fmt(25_500_000n, 6)).toBe("25.5");
    expect(parseAmount("10", 6)).toBe(10_000_000n);
    expect(parseAmount("0.1", 6)).toBe(100_000n);
  });

  it("maps marketplace custom errors to plain words", () => {
    expect(ERROR_TEXT["SellerIsBuyer"]).toBe("You can't buy your own listing.");
    expect(ERROR_TEXT["MintLimit"]).toBe("You've minted the maximum of 5 passes.");
    expect(ERROR_TEXT["MarketplaceNotApproved"]).toBe("First allow the marketplace to transfer your NFTs.");
    expect(ERROR_TEXT["AlreadyListed"]).toBe("This pass is already listed for sale.");
    expect(ERROR_TEXT["ListingNotActive"]).toBe("This listing is no longer active.");
    expect(ERROR_TEXT["NotSeller"]).toBe("Only the seller can cancel this listing.");
    expect(ERROR_TEXT["PermitAllowanceTooLow"]).toBe("The permit signature did not grant enough allowance for this price.");
  });

  it("handles wallet rejection (code 4001)", () => {
    expect(humanError({ code: 4001 })).toBe("You rejected the request in your wallet.");
  });
});

describe("PermitMarket ABI Definitions", () => {
  it("includes all marketAbi methods and errors", () => {
    const fnNames = marketAbi.filter((x) => x.type === "function").map((x) => x.name);
    expect(fnNames).toContain("listingCount");
    expect(fnNames).toContain("listingsPage");
    expect(fnNames).toContain("isBuyable");
    expect(fnNames).toContain("activeListingOf");
    expect(fnNames).toContain("list");
    expect(fnNames).toContain("cancel");
    expect(fnNames).toContain("buy");
    expect(fnNames).toContain("buyWithPermit");

    const errNames = marketAbi.filter((x) => x.type === "error").map((x) => x.name);
    expect(errNames).toContain("SellerIsBuyer");
    expect(errNames).toContain("NotTokenOwner");
    expect(errNames).toContain("MarketplaceNotApproved");
    expect(errNames).toContain("PermitAllowanceTooLow");
  });

  it("includes all nftAbi methods and errors", () => {
    const fnNames = nftAbi.filter((x) => x.type === "function").map((x) => x.name);
    expect(fnNames).toContain("mint");
    expect(fnNames).toContain("totalMinted");
    expect(fnNames).toContain("mintedBy");
    expect(fnNames).toContain("MAX_PER_ACCOUNT");
    expect(fnNames).toContain("ownerOf");
    expect(fnNames).toContain("isApprovedForAll");
    expect(fnNames).toContain("setApprovalForAll");

    const errNames = nftAbi.filter((x) => x.type === "error").map((x) => x.name);
    expect(errNames).toContain("MintLimit");
  });

  it("includes all tokenAbi methods and errors", () => {
    const fnNames = tokenAbi.filter((x) => x.type === "function").map((x) => x.name);
    expect(fnNames).toContain("balanceOf");
    expect(fnNames).toContain("allowance");
    expect(fnNames).toContain("approve");
    expect(fnNames).toContain("faucet");
    expect(fnNames).toContain("nonces");
    expect(fnNames).toContain("name");
    expect(fnNames).toContain("DOMAIN_SEPARATOR");
  });
});

describe("PermitMarket Source Integrity & Isolation", () => {
  it("contains no hardcoded ethereum addresses in src/", () => {
    const srcDir = join(__dirname, "../src");
    const addressRegex = /0x[a-fA-F0-9]{40}/g;

    function checkDir(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          checkDir(fullPath);
        } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".html")) {
          const content = readFileSync(fullPath, "utf-8");
          const matches = content.match(addressRegex);
          expect(matches, `Found hardcoded address in ${fullPath}`).toBeNull();
        }
      }
    }

    checkDir(srcDir);
  });

  it("ensures index.html and src/ never import or reference fixtures", () => {
    const indexHtml = readFileSync(join(__dirname, "../index.html"), "utf-8");
    expect(indexHtml).not.toContain("fixture");
    expect(indexHtml).not.toContain("leak");

    const srcDir = join(__dirname, "../src");
    function checkDir(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          checkDir(fullPath);
        } else if (entry.name.endsWith(".ts")) {
          const content = readFileSync(fullPath, "utf-8");
          expect(content, `${fullPath} references fixtures`).not.toContain("fixtures/");
          expect(content, `${fullPath} references leak`).not.toContain("leak");
        }
      }
    }
    checkDir(srcDir);
  });
});

