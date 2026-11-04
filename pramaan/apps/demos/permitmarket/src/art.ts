/** Deterministic 240x240 SVG art for each Demo Pass NFT. */
export function passSvg(tokenId: bigint): string {
  const h1 = Number((tokenId * 47n) % 360n);
  const h2 = (h1 + 40) % 360;
  const h3 = (h1 + 80) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" width="240" height="240">
  <defs>
    <radialGradient id="bg-${tokenId}" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="hsl(${h1}, 75%, 22%)"/>
      <stop offset="100%" stop-color="hsl(${h1}, 80%, 10%)"/>
    </radialGradient>
  </defs>
  <rect width="240" height="240" rx="16" fill="url(#bg-${tokenId})"/>
  <circle cx="120" cy="105" r="70" fill="none" stroke="hsl(${h1}, 85%, 65%)" stroke-width="2" opacity="0.3"/>
  <circle cx="120" cy="105" r="50" fill="none" stroke="hsl(${h2}, 85%, 65%)" stroke-width="3" opacity="0.5"/>
  <circle cx="120" cy="105" r="30" fill="none" stroke="hsl(${h3}, 90%, 70%)" stroke-width="4" opacity="0.8"/>
  <text x="120" y="200" text-anchor="middle" font-family="system-ui, -apple-system, BlinkMacSystemFont, sans-serif" font-weight="700" font-size="18" fill="#ffffff" letter-spacing="1">PASS #${tokenId}</text>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

