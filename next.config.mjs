import nextPwa from "next-pwa";

/** @type {import('next').NextConfig} */
const baseConfig = {
  reactStrictMode: true
};

const withPwa = nextPwa({
  dest: "public",
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development",
  // Caché razonable: assets Next + imágenes + manifest.
  runtimeCaching: [
    {
      urlPattern: ({ request }) => request.destination === "document",
      handler: "NetworkFirst",
      options: {
        cacheName: "pages",
        networkTimeoutSeconds: 3
      }
    },
    {
      urlPattern: ({ request }) => request.destination === "script" || request.destination === "style",
      handler: "StaleWhileRevalidate",
      options: { cacheName: "assets" }
    },
    {
      urlPattern: ({ request }) => request.destination === "image",
      handler: "CacheFirst",
      options: {
        cacheName: "images",
        expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 }
      }
    }
  ]
});

export default withPwa(baseConfig);

