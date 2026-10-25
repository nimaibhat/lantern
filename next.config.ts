import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Phones and other laptops open the dev server by its hotspot or Wi-Fi address.
  allowedDevOrigins: [
    "172.20.10.*",
    "192.168.1.2",
    "192.168.1.3",
    "192.168.1.4",
    "192.168.1.5",
    "192.168.1.10",
    "192.168.1.50",
    "192.168.1.68",
    "192.168.1.100",
    "10.0.0.1",
  ],
};

export default nextConfig;
