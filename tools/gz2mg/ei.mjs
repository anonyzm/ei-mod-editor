// tiny in-process driver for Editor/mcp.js tools
import { handle } from 'file:///C:/GOG%20Games/EI_edit/Editor/mcp.js';
export async function call(name, args = {}) {
  const r = await handle({ id: 1, method: 'tools/call', params: { name, arguments: args } });
  const t = r.content.find(c => c.type === 'text')?.text;
  if (r.isError) throw new Error(name + ': ' + t);
  const img = r.content.find(c => c.type === 'image');
  if (img) return { img: Buffer.from(img.data, 'base64'), text: t };
  try { return JSON.parse(t); } catch { return t; }
}
