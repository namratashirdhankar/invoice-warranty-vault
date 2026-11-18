const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const fs = require('node:fs/promises');
const path = require('node:path');

// Scope cleartext access to the configured HTTP backend, never all hosts.
module.exports = function withLocalApiNetworkSecurity(config) {
  const apiUrl = config.extra?.apiUrl ? new URL(config.extra.apiUrl.trim()) : null;
  const domainConfig = apiUrl?.protocol === 'http:' ? `
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">${apiUrl.hostname}</domain>
    </domain-config>` : '';
  const networkSecurityConfig = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="false" />
${domainConfig}
</network-security-config>
`;
  config = withAndroidManifest(config, config => {
    const application = config.modResults.manifest.application[0];
    application.$['android:networkSecurityConfig'] = '@xml/network_security_config';
    return config;
  });
  return withDangerousMod(config, ['android', async config => {
    const directory = path.join(config.modRequest.platformProjectRoot, 'app/src/main/res/xml');
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'network_security_config.xml'), networkSecurityConfig);
    return config;
  }]);
};
