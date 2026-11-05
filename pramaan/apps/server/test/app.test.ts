import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

describe("public API", () => {
  it("decodes a wallet approval, rejects unsupported methods, and reports unfinished routes", async () => {
    const app = await createApp();
    try {
      const response = await app.inject({
        method: "POST",
        url: "/v1/decode",
        payload: {
          method: "eth_sendTransaction",
          params: [
            {
              to: "0x2222222222222222222222222222222222222222",
              data: "0x095ea7b30000000000000000000000003333333333333333333333333333333333333333ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            },
          ],
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().assessment.level).not.toBe("low");
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/v1/decode",
            payload: { method: "eth_accounts", params: [] },
          })
        ).statusCode,
      ).toBe(400);
      expect((await app.inject({ method: "GET", url: "/readyz" })).statusCode).toBe(503);
      // Unfinished routes in this bounded slice return 501
      expect((await app.inject({ method: "GET", url: "/v1/releases" })).statusCode).toBe(501);
      // Implemented routes enforce authentication
      expect((await app.inject({ method: "GET", url: "/v1/projects" })).statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});
