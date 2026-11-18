module.exports = ({ config }) => {
  // EAS builds must not silently ship an APK with no backend or login setup.
  if (process.env.EAS_BUILD === 'true') {
    const required = ['API_URL', 'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID'];
    if (process.env.EAS_BUILD_PLATFORM === 'android') required.push('EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID');
    if (process.env.EAS_BUILD_PLATFORM === 'ios') required.push('EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID');
    const missing = required.filter(name => !process.env[name]?.trim());
    if (missing.length) throw new Error(`Missing mobile build configuration: ${missing.join(', ')}. Set these in the EAS environment selected by eas.json, then rebuild.`);
    if (!/^https?:\/\/[^/\s?#]+(?:\/[^\s?#]*)?\/?$/i.test(process.env.API_URL.trim())) {
      throw new Error('API_URL must be a valid HTTP or HTTPS URL reachable from the phone.');
    }
  }
  return ({
  ...config,
  scheme: config.scheme || 'invoice-warranty-vault',
  plugins: [...(config.plugins || []), 'expo-sharing', 'expo-web-browser', './plugins/with-local-api-network-security'],
  extra: {
    ...config.extra,
    apiUrl: process.env.API_URL,
    googleAuth: {
      webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
      androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
      iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    },
  },
  });
};
