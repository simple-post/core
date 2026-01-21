/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow external packages that use native binaries
  serverExternalPackages: ["sharp", "fluent-ffmpeg", "@ffmpeg-installer/ffmpeg"],

  // Enable Turbopack (default in Next.js 16)
  turbopack: {},
};

export default nextConfig;
