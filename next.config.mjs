import withSerwistInit from "@serwist/next";

/** @type {import('next').NextConfig} */
const baseConfig = {
  reactStrictMode: true
};

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  register: true,
  disable: process.env.NODE_ENV === "development"
});

export default withSerwist(baseConfig);

