/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow external packages that use native binaries
  serverExternalPackages: ["sharp", "fluent-ffmpeg", "@ffmpeg-installer/ffmpeg"],

  // Webpack configuration for native modules
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Don't bundle these packages on the server
      config.externals = [...(config.externals || []), "sharp", "fluent-ffmpeg"];
    }
    return config;
  },
};

export default nextConfig;
