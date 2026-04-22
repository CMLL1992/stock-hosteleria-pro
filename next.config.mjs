import withSerwistInit from "@serwist/next";
import createNextIntlPlugin from "next-intl/plugin";

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

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withSerwist(withNextIntl(baseConfig));

