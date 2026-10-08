/** The product's own domain (BOOL). Everything that names it (hosts, CORS, credit link, mail sender) reads it from here. */
export const brandDomain = (): string => (process.env.BRAND_DOMAIN || "boolai.co.il").toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
export const brandUrl = (): string => `https://${brandDomain()}`;
