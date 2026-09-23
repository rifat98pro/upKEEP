/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // The SDK is consumed straight from source via the @upkeep/sdk path alias,
  // so Next has to transpile it like first-party code.
  transpilePackages: ['@upkeep/sdk'],

  experimental: {
    /*
     * Barrel-file optimization. `wagmi/connectors`, `viem` and `lucide-react`
     * all re-export very large surfaces, and without this every cold compile
     * walks the whole graph even though the app touches a fraction of it.
     * This rewrites the imports to the specific modules actually used.
     */
    optimizePackageImports: ['wagmi', 'viem', '@wagmi/connectors', 'lucide-react'],
  },

  webpack: (config) => {
    // wagmi/viem pull in optional peer deps this app does not use.
    config.externals.push('pino-pretty', 'lokijs', 'encoding');

    /*
     * The SDK writes ESM-correct relative imports ending in `.js`, which is what
     * a published package needs. Since we import it from TypeScript source,
     * webpack has to know that `./foo.js` may resolve to `./foo.ts`.
     */
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };

    /*
     * `wagmi/connectors` is a barrel: importing `injected` from it also drags in
     * the MetaMask SDK, Coinbase's CDP/Base Account stack and the Gemini wallet
     * core. upKEEP registers *only* the injected connector, so none of that is
     * ever constructed - it is pure compile cost, and it dominated the dev cold
     * start.
     *
     * Stubbing them is safe because each is referenced only inside a connector
     * factory this app never calls. In particular the MetaMask *extension* is
     * reached through `window.ethereum` by the injected connector; the SDK is
     * for mobile deep-linking, which upKEEP does not use.
     *
     * Adding another connector means removing the matching line here.
     */
    config.resolve.alias = {
      ...config.resolve.alias,
      '@base-org/account': false,
      '@coinbase/cdp-sdk': false,
      '@metamask/sdk': false,
      '@gemini-wallet/core': false,
      // Pulled in by the MetaMask SDK for React Native, which never applies here.
      '@react-native-async-storage/async-storage': false,
    };

    return config;
  },
};

export default nextConfig;
