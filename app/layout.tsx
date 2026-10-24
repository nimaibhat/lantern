import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Geist, Geist_Mono, Tomorrow } from "next/font/google";
import "./globals.css";

// next/font self-hosts these at build time, so there is no request to Google at runtime.
const tomorrow = Tomorrow({ subsets: ["latin"], weight: ["300", "400", "500"], variable: "--font-heading" });
const geist = Geist({ subsets: ["latin"], variable: "--font-body" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Lantern",
  description: "Lantern scans the home, guides the day, and responds to risky movement so caregivers are woken only when it matters.",
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#0a0806",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${tomorrow.variable} ${geist.variable} ${geistMono.variable}`}>
      <body>
        {/* Autofill tools stamp fdprocessedid onto buttons and inputs before hydrate. */}
        <Script id="strip-fdprocessedid" strategy="beforeInteractive">{`
          (function () {
            var key = "fdprocessedid";
            function strip(el) {
              if (el && el.removeAttribute && el.hasAttribute && el.hasAttribute(key)) el.removeAttribute(key);
            }
            new MutationObserver(function (records) {
              for (var i = 0; i < records.length; i++) {
                var rec = records[i];
                if (rec.type === "attributes") strip(rec.target);
                var nodes = rec.addedNodes;
                for (var j = 0; nodes && j < nodes.length; j++) {
                  var node = nodes[j];
                  if (!node || node.nodeType !== 1) continue;
                  strip(node);
                  var found = node.querySelectorAll("[" + key + "]");
                  for (var k = 0; k < found.length; k++) strip(found[k]);
                }
              }
            }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: [key] });
          })();
        `}</Script>
        {children}
      </body>
    </html>
  );
}
