// Turns Claude Code tool calls into compact, readable cards for the phone.
import type { Entry } from '../types';

type Tool = NonNullable<Entry['tool']>;

const short = (p: unknown) => (typeof p === 'string' ? p : '');

export function lineDiff(oldText: string, newText: string): string {
  const a = oldText ? oldText.split('\n') : [];
  const b = newText.split('\n');
  // Trim the common prefix/suffix so the card shows only what changed.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) { endA--; endB--; }
  const out: string[] = [];
  for (let i = Math.max(0, start - 2); i < start; i++) out.push(' ' + a[i]);
  for (let i = start; i <= endA; i++) out.push('-' + a[i]);
  for (let i = start; i <= endB; i++) out.push('+' + b[i]);
  for (let i = endA + 1; i <= Math.min(a.length - 1, endA + 2); i++) out.push(' ' + a[i]);
  return out.join('\n');
}

export function describeTool(name: string, input: any): Omit<Tool, 'status'> {
  input = input ?? {};
  switch (name) {
    case 'Bash':
    case 'PowerShell':
      return { icon: 'terminal', title: input.description || 'Commande', subtitle: short(input.command).split('\n')[0], code: input.command };
    case 'Read':
      return { icon: 'file', title: 'Lecture', subtitle: input.file_path };
    case 'Write':
      return { icon: 'edit', title: 'Création de fichier', subtitle: input.file_path, diff: lineDiff('', short(input.content)) };
    case 'Edit':
      return { icon: 'edit', title: 'Modification', subtitle: input.file_path, diff: lineDiff(short(input.old_string), short(input.new_string)) };
    case 'MultiEdit':
      return {
        icon: 'edit', title: 'Modifications', subtitle: input.file_path,
        diff: (input.edits ?? []).map((e: any) => lineDiff(short(e.old_string), short(e.new_string))).join('\n…\n'),
      };
    case 'NotebookEdit':
      return { icon: 'edit', title: 'Modification de notebook', subtitle: input.notebook_path, code: input.new_source };
    case 'Glob':
      return { icon: 'search', title: 'Recherche de fichiers', subtitle: input.pattern };
    case 'Grep':
      return { icon: 'search', title: 'Recherche dans le code', subtitle: input.pattern + (input.path ? `  ·  ${input.path}` : '') };
    case 'WebFetch':
      return { icon: 'web', title: 'Lecture web', subtitle: input.url };
    case 'WebSearch':
      return { icon: 'web', title: 'Recherche web', subtitle: input.query };
    case 'Task':
    case 'Agent':
      return { icon: 'agent', title: `Sous-agent${input.subagent_type ? ` · ${input.subagent_type}` : ''}`, subtitle: input.description, code: input.prompt };
    case 'TodoWrite':
      return {
        icon: 'todo', title: 'Liste de tâches',
        code: (input.todos ?? []).map((t: any) => `${t.status === 'completed' ? '✔' : t.status === 'in_progress' ? '▶' : '○'} ${t.content}`).join('\n'),
      };
    case 'ExitPlanMode':
      return { icon: 'plan', title: 'Plan proposé', code: input.plan };
    case 'AskUserQuestion':
      return { icon: 'tool', title: 'Question', subtitle: (input.questions ?? []).map((q: any) => q.question).join(' · ') };
    default:
      if (name.startsWith('mcp__')) {
        const [, server, tool] = name.split('__');
        return { icon: 'mcp', title: `${server} · ${tool}`, code: JSON.stringify(input, null, 2) };
      }
      return { icon: 'tool', title: name, code: JSON.stringify(input, null, 2) };
  }
}

/** Plain text out of a tool_result content (string or content blocks). */
export function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((b: any) => (b?.type === 'text' ? b.text : b?.type === 'image' ? '[image]' : '')).join('\n');
  }
  return '';
}

/** Sentence used as the approval title on the phone. */
export function permissionTitle(name: string, input: any): string {
  switch (name) {
    case 'Bash': case 'PowerShell': return 'Exécuter une commande';
    case 'Write': return `Créer ${basename(input?.file_path)}`;
    case 'Edit': case 'MultiEdit': return `Modifier ${basename(input?.file_path)}`;
    case 'WebFetch': return 'Accéder à une page web';
    case 'ExitPlanMode': return 'Valider le plan et passer à l’action';
    default: return `Utiliser ${name.startsWith('mcp__') ? name.split('__').slice(1).join(' · ') : name}`;
  }
}

const basename = (p: unknown) => (typeof p === 'string' ? p.split(/[\\/]/).pop() : 'un fichier');
