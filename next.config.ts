import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  // Nagłówki bezpieczeństwa (w tym CSP z nonce) dochodzą w E2 przez proxy.ts.
};

export default config;
