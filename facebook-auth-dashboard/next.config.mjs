/** @type {import('next').NextConfig} */
const nextConfig = {
  /* config options here */
  reactStrictMode: true,
  async redirects() {
    // The Rules tab became Recommendations; keep old bookmarks and links working.
    return [{ source: "/rules", destination: "/recommendations", permanent: true }];
  },
};

export default nextConfig;
