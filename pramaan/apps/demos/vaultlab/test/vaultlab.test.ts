import { describe, expect, it } from "vitest";
import { formatUnits } from "viem";
import { fmt, parseAmount, countdown, short } from "../src/lib/format";
import { humanError, ERROR_TEXT } from "../src/lib/errors";
import { escapeHtml } from "../src/ui";
import { vaultAbi, tokenAbi } from "../src/abi";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

describe("VaultLab Formatter & Math", () => {
  it("formats token units correctly without trailing zeroes", () => {
    expect(fmt(1_000_000_000n, 6)).toBe("1,000");
    expect(fmt(1_500_000n, 6)).toBe("1.5");
    expect(fmt(123_456_789n, 6)).toBe("123.4567");
    expect(fmt(1_000_000_000_000_000_000n, 18)).toBe("1");
  });

  it("parses valid token and ETH amounts", () => {
    expect(parseAmount("1000", 6)).toBe(1_000_000_000n);
    expect(parseAmount("0.5", 6)).toBe(500_000n);
    expect(parseAmount("1.25", 18)).toBe(1_250_000_000_000_000_000n);
  });

  it("rejects zero, negative, or invalid amounts", () => {
    expect(() => parseAmount("0", 6)).toThrow("Amount must be greater than zero.");
    expect(() => parseAmount("-10", 6)).toThrow("Enter a positive number.");
    expect(() => parseAmount("abc", 6)).toThrow("Enter a positive number.");
    expect(() => parseAmount("", 6)).toThrow("Enter a positive number.");
  });

  it("formats short addresses", () => {
    expect(short("0x70997970C51812dc3A010C7d01b50e0d17dc79C8")).toBe("0x7099…79C8");
  });

  it("computes countdown properly", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    expect(countdown(nowSec - 10)).toBe("ended");
    expect(countdown(nowSec + 120)).toMatch(/\d+m \d+s/);
  });
});

describe("VaultLab Human Errors", () => {
  it("maps custom errors to plain-words explanations", () => {
    expect(ERROR_TEXT["ZeroAmount"]).toBe("Enter an amount greater than zero.");
    expect(ERROR_TEXT["FaucetCooldown"]).toBe("The faucet can be used once per hour per address. Try again later.");
    expect(ERROR_TEXT["InsufficientBalance"]).toBe("You don't have that much in the vault.");
    expect(ERROR_TEXT["EthTransferFailed"]).toBe("The ETH transfer failed.");
    expect(ERROR_TEXT["ERC20InsufficientBalance"]).toBe("Your wallet doesn't have enough pUSD.");
    expect(ERROR_TEXT["ERC20InsufficientAllowance"]).toBe("Approve the vault for this amount first.");
    expect(ERROR_TEXT["OwnableUnauthorizedAccount"]).toBe("Only the vault owner (a timelock) can do that.");
  });

  it("handles wallet rejection (code 4001)", () => {
    expect(humanError({ code: 4001 })).toBe("You rejected the request in your wallet.");
  });

  it("handles standard error fallback", () => {
    expect(humanError(new Error("Network connection dropped"))).toBe("Network connection dropped");
  });
});

describe("VaultLab DOM & Security Helpers", () => {
  it("escapes malicious HTML characters", () => {
    expect(escapeHtml("<script>alert(1)</script>")).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(escapeHtml(`"hello" & 'world'`)).toBe("&quot;hello&quot; &amp; &#39;world&#39;");
  });
});

describe("VaultLab ABI Definitions", () => {
  it("includes all necessary vault function and error definitions", () => {
    const fnNames = vaultAbi.filter((x) => x.type === "function").map((x) => x.name);
    expect(fnNames).toContain("version");
    expect(fnNames).toContain("owner");
    expect(fnNames).toContain("token");
    expect(fnNames).toContain("totalEthDeposits");
    expect(fnNames).toContain("totalTokenDeposits");
    expect(fnNames).toContain("ethBalanceOf");
    expect(fnNames).toContain("tokenBalanceOf");
    expect(fnNames).toContain("deposit");
    expect(fnNames).toContain("depositToken");
    expect(fnNames).toContain("withdraw");
    expect(fnNames).toContain("withdrawToken");

    const errNames = vaultAbi.filter((x) => x.type === "error").map((x) => x.name);
    expect(errNames).toContain("ZeroAmount");
    expect(errNames).toContain("InsufficientBalance");
    expect(errNames).toContain("EthTransferFailed");
    expect(errNames).toContain("OwnableUnauthorizedAccount");
  });

  it("includes all necessary token function and error definitions", () => {
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

describe("VaultLab Source Code Integrity", () => {
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
});

