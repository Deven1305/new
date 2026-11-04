import { describe, expect, it } from "vitest";
import { isPrivateAddress } from "../src/net.js";
describe("network address classification", () => {
  it("recognizes hexadecimal and dotted IPv4-mapped private addresses", () => {
    for (const ip of ["::ffff:7f00:1", "::ffff:a00:1", "0:0:0:0:0:ffff:7f00:1", "::ffff:127.0.0.1"]) expect(isPrivateAddress(ip)).toBe(true);
    expect(isPrivateAddress("::ffff:808:808")).toBe(false);
  });
});
