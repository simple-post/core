/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow external packages that use native binaries
  serverExternalPackages: ["sharp", "fluent-ffmpeg", "@ffmpeg-installer/ffmpeg"],

  // Enable Turbopack (default in Next.js 16)
  turbopack: {},

  allowedDevOrigins: ["http://localhost:3000", "vlad.creafexlab.com"],
};

export default nextConfig;
