import { describe, expect, it } from "vitest";
import { fmt, parseAmount, countdown, short } from "../src/lib/format";
import { humanError, ERROR_TEXT } from "../src/lib/errors";
import { escapeHtml } from "../src/ui";
import { farmAbi, tokenAbi } from "../src/abi";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

describe("MirrorYield Formatter & Math", () => {
  it("formats token units correctly without trailing zeroes", () => {
    expect(fmt(1_000_000_000n, 6)).toBe("1,000");
    expect(fmt(1_500_000n, 6)).toBe("1.5");
    expect(fmt(123_456_789n, 6)).toBe("123.4567");
    expect(fmt(1_000_000_000_000_000_000n, 18)).toBe("1");
    expect(fmt(0n, 6)).toBe("0");
  });

  it("parses valid amounts into bigints", () => {
    expect(parseAmount("1000", 6)).toBe(1_000_000_000n);
    expect(parseAmount("0.5", 6)).toBe(500_000n);
    expect(parseAmount("25.123456", 6)).toBe(25_123_456n);
  });

  it("rejects zero, negative, or invalid amounts", () => {
    expect(() => parseAmount("0", 6)).toThrow("Amount must be greater than zero.");
    expect(() => parseAmount("-5", 6)).toThrow("Enter a positive number.");
    expect(() => parseAmount("abc", 6)).toThrow("Enter a positive number.");
    expect(() => parseAmount("", 6)).toThrow("Enter a positive number.");
  });

  it("formats short addresses", () => {
    expect(short("0x70997970C51812dc3A010C7d01b50e0d17dc79C8")).toBe("0x7099…79C8");
  });

  it("computes countdown properly", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    expect(countdown(nowSec - 5)).toBe("ended");
    expect(countdown(nowSec + 65)).toMatch(/\d+m \d+s/);
    expect(countdown(nowSec + 86400 * 3 + 3600 * 2)).toMatch(/3d 2h/);
  });

  it("calculates APR correctly using the formula", () => {
    const rewardRate = 38580n; // ~100,000 tokens (6 decimals) over 30 days
    const totalStaked = 1_000_000_000n; // 1,000 tokens (6 decimals)
    // aprPct = Number(rewardRate * 31_536_000n * 10_000n / totalStaked) / 100
    const aprPct = Number((rewardRate * 31_536_000n * 10_000n) / totalStaked) / 100;
    expect(aprPct).toBeGreaterThan(0);
    expect(aprPct.toFixed(2)).toBe("121665.88");
  });
});

describe("MirrorYield Human Errors", () => {
  it("maps custom errors to plain-words explanations", () => {
    expect(ERROR_TEXT["ZeroAmount"]).toBe("Enter an amount greater than zero.");
    expect(ERROR_TEXT["FaucetCooldown"]).toBe("The faucet can be used once per hour per address. Try again later.");
    expect(ERROR_TEXT["InsufficientStake"]).toBe("You can't unstake more than you have staked.");
    expect(ERROR_TEXT["NothingToClaim"]).toBe("You have no rewards to claim yet.");
    expect(ERROR_TEXT["ERC20InsufficientBalance"]).toBe("Your wallet doesn't have enough pUSD.");
    expect(ERROR_TEXT["ERC20InsufficientAllowance"]).toBe("Approve the farm for this amount first.");
  });

  it("handles wallet rejection (code 4001)", () => {
    expect(humanError({ code: 4001 })).toBe("You rejected the request in your wallet.");
  });

  it("handles standard error fallback", () => {
    expect(humanError(new Error("RPC timeout"))).toBe("RPC timeout");
  });
});

describe("MirrorYield DOM & Security Helpers", () => {
  it("escapes malicious HTML characters", () => {
    expect(escapeHtml("<script>alert(1)</script>")).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(escapeHtml(`"hello" & 'world'`)).toBe("&quot;hello&quot; &amp; &#39;world&#39;");
  });
});

describe("MirrorYield ABI Definitions", () => {
  it("includes all necessary farm functions and errors", () => {
    const fnNames = farmAbi.filter((x) => x.type === "function").map((x) => x.name);
    expect(fnNames).toContain("stakingToken");
    expect(fnNames).toContain("rewardToken");
    expect(fnNames).toContain("rewardRate");
    expect(fnNames).toContain("periodFinish");
    expect(fnNames).toContain("totalStaked");
    expect(fnNames).toContain("totalRewardsFunded");
    expect(fnNames).toContain("totalRewardsPaid");
    expect(fnNames).toContain("stakedOf");
    expect(fnNames).toContain("earned");
    expect(fnNames).toContain("rewardsRemaining");
    expect(fnNames).toContain("stake");
    expect(fnNames).toContain("unstake");
    expect(fnNames).toContain("claim");
    expect(fnNames).toContain("exit");

    const errNames = farmAbi.filter((x) => x.type === "error").map((x) => x.name);
    expect(errNames).toContain("ZeroAmount");
    expect(errNames).toContain("InsufficientStake");
    expect(errNames).toContain("NothingToClaim");
  });

  it("includes all necessary token functions and errors", () => {
    const fnNames = tokenAbi.filter((x) => x.type === "function").map((x) => x.name);
    expect(fnNames).toContain("balanceOf");
    expect(fnNames).toContain("allowance");
    expect(fnNames).toContain("approve");
    expect(fnNames).toContain("decimals");
    expect(fnNames).toContain("symbol");
    expect(fnNames).toContain("faucet");
    expect(fnNames).toContain("lastFaucetAt");

    const errNames = tokenAbi.filter((x) => x.type === "error").map((x) => x.name);
    expect(errNames).toContain("FaucetCooldown");
    expect(errNames).toContain("ERC20InsufficientBalance");
    expect(errNames).toContain("ERC20InsufficientAllowance");
  });
});

describe("MirrorYield Source Code Integrity & Tamper Rules", () => {
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

  it("reads contract('farm') in exactly one place (src/state.ts)", () => {
    const srcDir = join(__dirname, "../src");
    let contractFarmCount = 0;

    function scan(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          scan(fullPath);
        } else if (entry.name.endsWith(".ts")) {
          const content = readFileSync(fullPath, "utf-8");
          const matches = content.match(/contract\(["']farm["']\)/g);
          if (matches) {
            contractFarmCount += matches.length;
            expect(fullPath.endsWith("state.ts")).toBe(true);
          }
        }
      }
    }

    scan(srcDir);
    expect(contractFarmCount).toBe(1);
  });
});
