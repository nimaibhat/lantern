import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Phones and other laptops open the dev server by its hotspot or Wi-Fi address.
  allowedDevOrigins: [
    "172.20.10.*",
    "192.168.1.*",
    "10.0.0.1",
  ],
};

export default nextConfig;
