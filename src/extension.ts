import * as vscode from 'vscode';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ClaudeAgent } from './agents/claude';
import { CodexAgent } from './agents/codex';
import { BridgeServer, newToken } from './server';
import { hub } from './hub';
import type { Agent, AgentId, HubEvent } from './types';

const AGENT_LABEL: Record<AgentId, string> = { claude: 'Claude', codex: 'Codex' };

let server: BridgeServer | undefined;
let agents: Record<AgentId, Agent> | undefined;
let status: vscode.StatusBarItem;
let output: vscode.OutputChannel;
let pairingPanel: vscode.WebviewPanel | undefined;
let mirrorPanel: vscode.WebviewPanel | undefined;
let state: 'starting' | 'running' | 'elsewhere' | 'error' = 'starting';
let lastError = '';

const log = (s: string) => output.appendLine(`${new Date().toISOString().slice(11, 19)} ${s}`);

function claudeExe(): string | undefined {
  const ext = vscode.extensions.getExtension('anthropic.claude-code');
  if (!ext) return undefined;
  const exe = path.join(ext.extensionPath, 'resources', 'native-binary', process.platform === 'win32' ? 'claude.exe' : 'claude');
  return existsSync(exe) ? exe : undefined;
}

function codexExe(): string | undefined {
  const ext = vscode.extensions.getExtension('openai.chatgpt');
  if (!ext) return undefined;
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
  const plat = process.platform === 'win32' ? `windows-${arch}` : process.platform === 'darwin' ? `macos-${arch}` : `linux-${arch}`;
  const exe = path.join(ext.extensionPath, 'bin', plat, process.platform === 'win32' ? 'codex.exe' : 'codex');
  return existsSync(exe) ? exe : undefined;
}

async function openInVSCode(agent: AgentId, sessionId: string) {
  await agents?.[agent].release(sessionId);
  if (agent === 'claude') await vscode.commands.executeCommand('claude-vscode.editor.open', sessionId);
  else await vscode.env.openExternal(vscode.Uri.parse(`${vscode.env.uriScheme}://openai.chatgpt/local/${sessionId}`));
}

export async function activate(context: vscode.ExtensionContext) {
  output = vscode.window.createOutputChannel('Pocket Bridge');
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 200);
  status.command = 'pocketBridge.showPairing';
  status.show();
  context.subscriptions.push(output, status);

  let token = context.globalState.get<string>('token');
  if (!token) { token = newToken(); await context.globalState.update('token', token); }

  context.subscriptions.push(
    vscode.commands.registerCommand('pocketBridge.showPairing', () => showPairing(context)),
    vscode.commands.registerCommand('pocketBridge.openMirror', () => openMirror()),
    vscode.commands.registerCommand('pocketBridge.showLogs', () => output.show()),
    vscode.commands.registerCommand('pocketBridge.restart', async () => { stop(); await start(context); }),
    vscode.commands.registerCommand('pocketBridge.resetToken', async () => {
      const t = newToken();
      await context.globalState.update('token', t);
      server?.setToken(t);
      await server?.push.clear();
      vscode.window.showInformationMessage('Pocket Bridge : tous les téléphones ont été déconnectés. Scanne le nouveau QR code.');
      if (pairingPanel) await renderPairing(context);
    }),
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration('pocketBridge.httpsPort') || e.affectsConfiguration('pocketBridge.httpPort')) { stop(); await start(context); }
    }),
    { dispose: () => stop() },
  );

  const unsub = hub.onEvent((ev) => onHubEvent(ev));
  context.subscriptions.push({ dispose: unsub });
  await start(context);
}

async function start(context: vscode.ExtensionContext) {
  state = 'starting';
  refreshStatus();
  const cfg = vscode.workspace.getConfiguration('pocketBridge');
  agents = { claude: new ClaudeAgent(claudeExe(), log), codex: new CodexAgent(codexExe(), log) };
  server = new BridgeServer({
    agents,
    storageDir: context.globalStorageUri.fsPath,
    webDir: path.join(context.extensionPath, 'dist', 'web'),
    httpPort: cfg.get('httpPort', 8787),
    httpsPort: cfg.get('httpsPort', 8788),
    token: context.globalState.get<string>('token')!,
    log,
    openInVSCode,
    workspaceFolders: () => (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
  });
  try {
    await server.start();
    state = 'running';
  } catch (e: any) {
    stop();
    if (e?.code === 'EADDRINUSE') {
      // Another VS Code window already serves the phone; it sees every session anyway.
      state = 'elsewhere';
      log('[server] ports already in use: another VS Code window is serving Pocket Bridge');
    } else {
      state = 'error';
      lastError = e?.message ?? String(e);
      log(`[server] start failed: ${e?.stack ?? e}`);
    }
  }
  refreshStatus();
}

function stop() {
  server?.stop();
  server = undefined;
  if (agents) for (const a of Object.values(agents)) a.dispose();
  agents = undefined;
}

function refreshStatus() {
  if (!status) return;
  const running = [...hub.statuses.values()].filter((s) => s === 'running').length;
  const waiting = hub.requests.size;
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = true;
  if (state === 'running' && server) {
    status.text = waiting ? `$(bell-dot) Pocket · ${waiting} en attente` : running ? `$(sync~spin) Pocket · ${running}` : `$(device-mobile) Pocket`;
    status.backgroundColor = waiting ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
    md.appendMarkdown(`**Pocket Bridge** actif\n\n`);
    md.appendMarkdown(`Téléphone : \`${server.phoneUrl}\`\n\n`);
    md.appendMarkdown(`${server.phoneClients} téléphone(s) connecté(s) · ${running} session(s) en cours\n\n`);
    md.appendMarkdown(`[Connecter un téléphone](command:pocketBridge.showPairing) · [Miroir](command:pocketBridge.openMirror) · [Journaux](command:pocketBridge.showLogs)`);
  } else if (state === 'elsewhere') {
    status.text = '$(device-mobile) Pocket (autre fenêtre)';
    status.backgroundColor = undefined;
    md.appendMarkdown('Pocket Bridge tourne déjà dans une autre fenêtre VS Code — il y voit toutes tes sessions.\n\n[Réessayer ici](command:pocketBridge.restart)');
  } else if (state === 'error') {
    status.text = '$(error) Pocket';
    status.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    md.appendMarkdown(`Pocket Bridge n’a pas pu démarrer : ${lastError}\n\n[Réessayer](command:pocketBridge.restart) · [Journaux](command:pocketBridge.showLogs)`);
  } else {
    status.text = '$(loading~spin) Pocket';
  }
  status.tooltip = md;
}

function onHubEvent(ev: HubEvent) {
  if (ev.t === 'status' || ev.t === 'request' || ev.t === 'request-resolved') refreshStatus();
  if (ev.t === 'turn-done') vscode.window.setStatusBarMessage(`$(check) ${AGENT_LABEL[ev.agent]} a terminé : ${ev.summary.slice(0, 80)}`, 6000);
  if (ev.t === 'request' && vscode.workspace.getConfiguration('pocketBridge').get('approvalNotificationsInVSCode', true)) {
    const r = ev.request;
    if (r.questions) return; // answered from the phone or the mirror, where options are shown
    const picks = r.choices.map((c) => c.label);
    void vscode.window.showWarningMessage(`📱 ${AGENT_LABEL[r.agent]} : ${r.title}`, { detail: r.detail?.slice(0, 600) }, ...picks).then((label) => {
      const choice = r.choices.find((c) => c.label === label);
      if (choice && hub.requests.has(r.id)) agents?.[r.agent].answer(r.id, { choice: choice.id });
    });
  }
}

// ---------- Pairing panel ----------

async function showPairing(context: vscode.ExtensionContext) {
  if (state === 'elsewhere' || state === 'error') {
    const pick = await vscode.window.showWarningMessage(
      state === 'elsewhere' ? 'Pocket Bridge tourne déjà dans une autre fenêtre VS Code. Ouvre le QR code depuis celle-ci.' : `Pocket Bridge n’a pas démarré : ${lastError}`,
      'Réessayer ici', 'Journaux',
    );
    if (pick === 'Réessayer ici') await vscode.commands.executeCommand('pocketBridge.restart');
    if (pick === 'Journaux') output.show();
    return;
  }
  if (pairingPanel) { pairingPanel.reveal(); await renderPairing(context); return; }
  pairingPanel = vscode.window.createWebviewPanel('pocketBridge.pairing', 'Pocket Bridge · Téléphone', vscode.ViewColumn.Active, { enableScripts: false });
  pairingPanel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon-256.png');
  pairingPanel.onDidDispose(() => (pairingPanel = undefined));
  await renderPairing(context);
}

async function renderPairing(_context: vscode.ExtensionContext) {
  if (!pairingPanel || !server) return;
  const [pairQr, setupQr] = await Promise.all([server.qrDataUrl(), server.setupQrDataUrl()]);
  pairingPanel.webview.html = /* html */ `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline';">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 28px; max-width: 980px; margin: auto; line-height: 1.5; }
  h1 { font-size: 22px; margin: 0 0 4px; } .sub { opacity: .75; margin: 0 0 24px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; }
  .card { border: 1px solid var(--vscode-panel-border); border-radius: 14px; padding: 20px; background: var(--vscode-editorWidget-background); }
  .step { display: inline-flex; width: 26px; height: 26px; border-radius: 50%; align-items: center; justify-content: center; background: var(--vscode-button-background); color: var(--vscode-button-foreground); font-weight: 600; margin-right: 8px; }
  h2 { font-size: 16px; margin: 0 0 12px; display: flex; align-items: center; }
  img { width: 220px; height: 220px; background: #fff; border-radius: 12px; padding: 8px; display: block; margin: 8px auto 12px; }
  code { font-family: var(--vscode-editor-font-family); background: var(--vscode-textCodeBlock-background); padding: 2px 6px; border-radius: 6px; word-break: break-all; }
  ol { padding-left: 20px; margin: 8px 0 0; } li { margin: 4px 0; } .muted { opacity: .7; font-size: 12px; }
  .ok { color: var(--vscode-testing-iconPassed); }
</style></head><body>
<h1>📱 Connecter ton téléphone</h1>
<p class="sub">Le téléphone doit être sur le même Wi-Fi que ce PC (ou sur Tailscale, via le sous-réseau partagé par ton NAS). ${server.phoneClients ? `<span class="ok">● ${server.phoneClients} téléphone(s) connecté(s)</span>` : ''}</p>
<div class="grid">
  <div class="card">
    <h2><span class="step">1</span>Une seule fois : le certificat</h2>
    <img src="${setupQr}" alt="QR installation du certificat">
    <ol>
      <li>Scanne avec l’appareil photo, ouvre <code>${server.setupUrl}</code></li>
      <li>Touche <b>Télécharger le certificat</b></li>
      <li>Paramètres → <b>Sécurité et confidentialité</b> → <b>Autres paramètres de sécurité</b> → <b>Installer depuis le stockage</b> → <b>Certificat CA</b> → choisis <code>pocket-bridge-ca.crt</code></li>
    </ol>
    <p class="muted">Ce certificat n’est valable que pour ce PC. Il permet le HTTPS, l’installation de l’app et les notifications.</p>
  </div>
  <div class="card">
    <h2><span class="step">2</span>Appairer et installer l’app</h2>
    <img src="${pairQr}" alt="QR appairage">
    <ol>
      <li>Scanne ce QR code : Chrome ouvre Pocket Bridge, déjà connecté</li>
      <li>Menu ⋮ de Chrome → <b>Ajouter à l’écran d’accueil</b> → <b>Installer</b></li>
      <li>Dans l’app, ⚙︎ → <b>Activer les notifications</b></li>
    </ol>
    <p class="muted">Adresse : <code>${server.phoneUrl}</code><br>Pour révoquer l’accès : commande « Pocket Bridge : Révoquer les téléphones connectés ».</p>
  </div>
</div>
</body></html>`;
}

// ---------- Mirror panel (same app, embedded in VS Code) ----------

function openMirror() {
  if (!server) { void vscode.window.showWarningMessage('Pocket Bridge n’est pas actif dans cette fenêtre VS Code.'); return; }
  if (mirrorPanel) { mirrorPanel.reveal(); return; }
  mirrorPanel = vscode.window.createWebviewPanel('pocketBridge.mirror', 'Pocket Bridge', vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true });
  mirrorPanel.onDidDispose(() => (mirrorPanel = undefined));
  const url = server.mirrorUrl;
  const origin = new URL(url).origin;
  mirrorPanel.webview.html = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${origin}; style-src 'unsafe-inline';">
<style>html,body,iframe{margin:0;padding:0;border:0;width:100%;height:100%;overflow:hidden;background:transparent}</style></head>
<body><iframe src="${url}" allow="clipboard-read; clipboard-write"></iframe></body></html>`;
}

export function deactivate() {
  stop();
}
