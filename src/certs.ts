// A private certificate authority installed once on the phone, and a server certificate it
// signs for every LAN address of this PC. HTTPS is what lets Chrome install the PWA and
// deliver push notifications; the CA stays valid when the IP changes (only the leaf is re-issued).
import forge from 'node-forge';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface Certs {
  caPem: string;
  caDer: Buffer;
  key: string;
  cert: string;
}

const pki = forge.pki;

function serial() {
  return forge.util.bytesToHex(forge.random.getBytesSync(16)).replace(/^[89a-f]/, '1');
}

export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) out.push(a.address);
    }
  }
  return out;
}

export async function loadCerts(dir: string): Promise<Certs> {
  await mkdir(dir, { recursive: true });
  const caKeyFile = path.join(dir, 'ca-key.pem');
  const caFile = path.join(dir, 'ca.pem');
  let caKey: forge.pki.rsa.PrivateKey;
  let ca: forge.pki.Certificate;
  if (existsSync(caKeyFile) && existsSync(caFile)) {
    caKey = pki.privateKeyFromPem(await readFile(caKeyFile, 'utf8')) as forge.pki.rsa.PrivateKey;
    ca = pki.certificateFromPem(await readFile(caFile, 'utf8'));
  } else {
    const keys = pki.rsa.generateKeyPair(2048);
    ca = pki.createCertificate();
    ca.publicKey = keys.publicKey;
    ca.serialNumber = serial();
    ca.validity.notBefore = new Date(Date.now() - 86_400_000);
    ca.validity.notAfter = new Date(Date.now() + 10 * 365 * 86_400_000);
    const attrs = [{ name: 'commonName', value: `Pocket Bridge CA (${os.hostname()})` }, { name: 'organizationName', value: 'Pocket Bridge' }];
    ca.setSubject(attrs);
    ca.setIssuer(attrs);
    ca.setExtensions([
      { name: 'basicConstraints', cA: true, critical: true },
      { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
      { name: 'subjectKeyIdentifier' },
    ]);
    ca.sign(keys.privateKey, forge.md.sha256.create());
    caKey = keys.privateKey;
    await writeFile(caKeyFile, pki.privateKeyToPem(caKey));
    await writeFile(caFile, pki.certificateToPem(ca));
  }

  const hosts = ['localhost', os.hostname(), `${os.hostname()}.local`];
  const ips = ['127.0.0.1', ...lanAddresses()];
  const leafFile = path.join(dir, 'server.json');
  const wanted = JSON.stringify([...hosts, ...ips]);
  if (existsSync(leafFile)) {
    const saved = JSON.parse(await readFile(leafFile, 'utf8'));
    const cert = pki.certificateFromPem(saved.cert);
    const fresh = cert.validity.notAfter.getTime() - Date.now() > 30 * 86_400_000;
    if (fresh && saved.names === wanted) return { caPem: pki.certificateToPem(ca), caDer: der(ca), key: saved.key, cert: saved.cert };
  }

  const keys = pki.rsa.generateKeyPair(2048);
  const cert = pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = serial();
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 397 * 86_400_000);
  cert.setSubject([{ name: 'commonName', value: os.hostname() }]);
  cert.setIssuer(ca.subject.attributes);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectAltName', altNames: [...hosts.map((value) => ({ type: 2, value })), ...ips.map((ip) => ({ type: 7, ip }))] },
  ]);
  cert.sign(caKey, forge.md.sha256.create());
  const out = { key: pki.privateKeyToPem(keys.privateKey), cert: pki.certificateToPem(cert) + pki.certificateToPem(ca) };
  await writeFile(leafFile, JSON.stringify({ ...out, names: wanted }));
  return { caPem: pki.certificateToPem(ca), caDer: der(ca), ...out };
}

function der(c: forge.pki.Certificate) {
  return Buffer.from(forge.asn1.toDer(pki.certificateToAsn1(c)).getBytes(), 'binary');
}
